// E-mail (Phase 2 / C5): a transactional outbox plus SMTP delivery with retries.
// Messages are queued inside the transaction of the action that caused them, so a rolled-back action never sends mail;
// the mailer delivers them afterwards. Every message stays in the outbox as delivery evidence.
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { config } from '../config.ts'
import { prisma } from '../db.ts'
import type { Tx } from '../db.ts'
import { rule } from '../lib/http.ts'

export const EMAIL_PREFS = ['Immediate', 'Daily digest', 'Off'] as const
export type EmailPref = (typeof EMAIL_PREFS)[number]
export type EmailKind = 'Assignment' | 'Reminder' | 'Digest' | 'Security' | 'Test'
export interface Recipient { id?: string | null; email: string; name: string }
type Db = Tx | typeof prisma

/** Attempts per message; after the last one the message is Failed and an administrator can retry it. */
export const MAX_ATTEMPTS = 5
/** Minutes to wait after failed attempt 1, 2, 3, 4. */
const RETRY_MINUTES = [1, 5, 15, 60]
/** A claimed message not finished within this time (process crashed mid-send) is picked up again. */
const LEASE_MS = 10 * 60_000
export const NOT_CONFIGURED = 'E-mail delivery is not configured (SMTP_HOST is empty).'

export const appUrl = () => (config.APP_URL || config.CORS_ORIGIN.split(',')[0].trim()).replace(/\/+$/, '')
/** Link into the web application (hash routes). */
export const appLink = (project?: string, page = 'overview') => `${appUrl()}/#/${project ? `p/${project}/${page}` : ''}`

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function prefFooter(pref: string) {
  return pref === 'Off'
    ? 'This is a security notice; it is sent even when e-mail notifications are switched off.'
    : `You receive this e-mail because your Qualigrafo e-mail notifications are set to "${pref}". You can change this in Qualigrafo: sidebar → E-mail notifications.`
}

export async function queueEmail(db: Db, kind: EmailKind, to: Recipient, subject: string, body: string, projectCode?: string | null) {
  await db.emailMessage.create({ data: { kind, userId: to.id ?? null, toEmail: to.email, toName: to.name, projectCode: projectCode ?? null, subject: clip(oneLine(subject), 200), body } })
  kickMailer()
}

/** Security notice to the account holder; always sent, whatever the notification preference. */
export async function securityAlert(u: Recipient, subject: string, lines: string[]) {
  const body = [`Hello ${u.name},`, '', ...lines, '', `Sign in: ${appLink()}`, '', 'If you did not expect this, contact your Qualigrafo administrator immediately.', '', '—', prefFooter('Off')].join('\n')
  await queueEmail(prisma, 'Security', u, `[Qualigrafo] ${subject}`, body)
}

/* ------------------------------------------------------------ delivery */

let transport: Transporter | null = null
export const deliveryConfigured = () => !!config.SMTP_HOST
export const deliveryInfo = () => ({ configured: deliveryConfigured(), host: config.SMTP_HOST || null, port: config.SMTP_PORT, secure: config.SMTP_SECURE, from: config.MAIL_FROM || null, appUrl: appUrl() })

function getTransport() {
  transport ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  })
  return transport
}
/** Drops the cached SMTP connection settings (after a configuration change; used by the tests). */
export function resetTransport() { transport?.close(); transport = null }

let busy = false
/** Sends every queued message that is due. Safe to call from several processes: rows are claimed with SKIP LOCKED. */
export async function deliverDue(now = new Date()) {
  const result = { sent: 0, retry: 0, failed: 0, notSent: 0 }
  if (busy) return result
  busy = true
  try {
    if (!deliveryConfigured()) {
      result.notSent = (await prisma.emailMessage.updateMany({ where: { status: 'Queued' }, data: { status: 'Not sent', lastError: NOT_CONFIGURED } })).count
      return result
    }
    for (;;) {
      const claimed = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "EmailMessage" SET status = 'Sending', "nextAttemptAt" = ${new Date(now.getTime() + LEASE_MS)}
        WHERE id IN (SELECT id FROM "EmailMessage" WHERE status IN ('Queued', 'Sending') AND "nextAttemptAt" <= ${now}
                     ORDER BY "createdAt" LIMIT 20 FOR UPDATE SKIP LOCKED)
        RETURNING id`
      if (!claimed.length) break
      for (const { id } of claimed) {
        const m = await prisma.emailMessage.findUniqueOrThrow({ where: { id } })
        try {
          const info = await getTransport().sendMail({ from: config.MAIL_FROM, to: { name: m.toName, address: m.toEmail }, subject: m.subject, text: m.body, headers: { 'X-Qualigrafo-Kind': m.kind } })
          await prisma.emailMessage.update({ where: { id }, data: { status: 'Sent', attempts: { increment: 1 }, sentAt: new Date(), messageId: info.messageId ?? null, lastError: null } })
          result.sent++
        } catch (e) {
          const attempts = m.attempts + 1
          const last = attempts >= MAX_ATTEMPTS
          await prisma.emailMessage.update({
            where: { id },
            data: { attempts, status: last ? 'Failed' : 'Queued', lastError: clip(e instanceof Error ? e.message : String(e), 500), nextAttemptAt: new Date(now.getTime() + (last ? 0 : RETRY_MINUTES[attempts - 1] * 60_000)) },
          })
          if (last) result.failed++
          else result.retry++
        }
      }
    }
    return result
  } finally {
    busy = false
  }
}

/** Puts a failed or unsent message back into the queue for a fresh series of attempts. */
export async function retryEmail(id: string) {
  const m = await prisma.emailMessage.findUnique({ where: { id } })
  if (!m) return null
  if (m.status !== 'Failed' && m.status !== 'Not sent') throw rule('Only failed or unsent e-mails can be retried.')
  if (!deliveryConfigured()) throw rule(NOT_CONFIGURED)
  const updated = await prisma.emailMessage.update({ where: { id }, data: { status: 'Queued', attempts: 0, nextAttemptAt: new Date(), lastError: null } })
  kickMailer()
  return updated
}

let started = false
let kick: NodeJS.Timeout | null = null
/** Delivers new mail shortly after it is queued (only once the background mailer runs; tests call deliverDue directly). */
/** One delivery pass with a heartbeat for the monitoring watchdog (P6). */
async function pass() {
  const { heartbeat, jobFailed } = await import('./monitoring.ts')
  try {
    const r = await deliverDue()
    await heartbeat('mailer', { ok: true, detail: `${r.sent} sent, ${r.retry} to retry, ${r.failed} failed, ${r.notSent} not sent` })
  } catch (e) {
    await jobFailed('mailer', e)
  }
}
export function kickMailer() {
  if (!started || kick) return
  kick = setTimeout(() => { kick = null; void pass() }, 1_000)
}
export function startMailer(everyMs = 15_000) {
  if (started) return
  started = true
  setInterval(() => { void pass() }, everyMs).unref()
  kickMailer()
}
