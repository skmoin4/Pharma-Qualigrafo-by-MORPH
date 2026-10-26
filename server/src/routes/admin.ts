// Platform administration: users, project memberships (role + vendor scope), password resets, security log,
// e-mail / reminders, access reviews, validation, backups and monitoring.
import bcrypt from 'bcryptjs'
import { changeList } from '../lib/audit.ts'
import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { prisma } from '../db.ts'
import { zRole } from '../domain/enums.ts'
import { notFound, rule } from '../lib/http.ts'
import { securityLog, tempPassword } from '../lib/security.ts'
import { deliveryInfo, queueEmail, retryEmail, securityAlert, prefFooter, appLink } from '../services/mail.ts'
import { getReminderSettings, runReminders, runView, setReminderSettings, zReminderSettings } from '../services/reminders.ts'
import { currentUser, reauthenticate } from '../middleware/auth.ts'
import * as AR from '../services/accessReview.ts'
import { reviewSchedule } from '../services/accessReview.ts'
import { accessReviewPdf, iqPdf } from '../services/reports.ts'
import { APP_VERSION, codeFingerprint, runIq } from '../services/iq.ts'
import type { IqResult } from '../services/iq.ts'
import { OQ_CASES, URS } from '../validation/catalogue.ts'
import * as BK from '../services/backups.ts'
import * as MON from '../services/monitoring.ts'
import { logTarget, tailLog } from '../lib/logger.ts'
import { config } from '../config.ts'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BCRYPT_COST } from './auth.ts'
import { assertOwnerQaRemains, assertScope } from '../services/team.ts'
import type { Role } from '../domain/types.ts'

export const admin = Router()

const actor = (req: Request) => { const u = currentUser(req); return { actorId: u.id, actorName: u.name, ip: req.ip } }

const userView = (u: { id: string; email: string; name: string; company: string | null; isAdmin: boolean; active: boolean; mustChangePassword: boolean; lastLoginAt: Date | null; createdAt: Date; memberships: { role: string; companyScope: string | null; project: { code: string; name: string } }[] }) => ({
  id: u.id, email: u.email, name: u.name, company: u.company, isAdmin: u.isAdmin, active: u.active, mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
  memberships: u.memberships.map((m) => ({ project: m.project.code, projectName: m.project.name, role: m.role, scope: m.companyScope })).sort((a, b) => a.project.localeCompare(b.project)),
})
const withMemberships = { memberships: { include: { project: { select: { code: true, name: true } } } } } as const

async function getUser(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, include: withMemberships })
  if (!u) throw notFound('User not found.')
  return u
}

/** Writes a membership change into the affected project's audit trail as well as the security log. */
async function projectAudit(projectId: string, req: Request, text: string) {
  const u = currentUser(req)
  await prisma.auditEvent.create({ data: { projectId, role: 'Administrator', userId: u.id, userName: u.name, text, requestId: req.requestId } })
}

admin.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({ include: withMemberships, orderBy: [{ active: 'desc' }, { name: 'asc' }] })
  res.json({ users: users.map(userView) })
})

admin.get('/projects', async (_req, res) => {
  const ps = await prisma.project.findMany({ select: { code: true, name: true, companies: { where: { active: true }, select: { name: true }, orderBy: { name: 'asc' } } }, orderBy: { code: 'asc' } })
  res.json({ projects: ps.map((p) => ({ code: p.code, name: p.name, companies: p.companies.map((c) => c.name) })), companies: [...new Set(ps.flatMap((p) => p.companies.map((c) => c.name)))].sort() })
})

const zName = z.string().trim().min(2, 'Name is required.').max(120)
const zCompany = z.string().trim().max(120).nullable().optional()

admin.post('/users', async (req, res) => {
  const b = z.object({ email: z.email(), name: zName, company: zCompany, isAdmin: z.boolean().default(false) }).parse(req.body ?? {})
  const email = b.email.toLowerCase()
  if (await prisma.user.findUnique({ where: { email } })) throw rule('A user with this email already exists.')
  const temp = tempPassword()
  const u = await prisma.user.create({
    data: { email, name: b.name, company: b.company || null, isAdmin: b.isAdmin, passwordHash: await bcrypt.hash(temp, BCRYPT_COST), mustChangePassword: true },
    include: withMemberships,
  })
  await securityLog('user.created', { email, userId: u.id, ...actor(req), detail: b.isAdmin ? 'administrator' : '' })
  await securityAlert(u, 'Your Qualigrafo account', [`${currentUser(req).name} created a Qualigrafo account for you (${email})${b.isAdmin ? ' with administrator rights' : ''}.`, 'Your administrator gives you a temporary password separately; you choose your own password at the first sign-in.'])
  res.status(201).json({ user: userView(u), tempPassword: temp })
})

admin.patch('/users/:id', async (req, res) => {
  const me = currentUser(req)
  const b = z.object({ name: zName.optional(), company: zCompany, isAdmin: z.boolean().optional(), active: z.boolean().optional() }).parse(req.body ?? {})
  const u = await getUser(req.params.id as string)
  if (u.id === me.id && (b.active === false || b.isAdmin === false)) throw rule('You cannot deactivate or demote your own account.')
  if ((b.active === false || b.isAdmin === false) && u.isAdmin) {
    const others = await prisma.user.count({ where: { isAdmin: true, active: true, id: { not: u.id } } })
    if (!others) throw rule('At least one active administrator must remain.')
  }
  const deactivating = b.active === false && u.active
  if (deactivating) await assertOwnerQaRemains(prisma, u.id)
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: { name: b.name, company: b.company === undefined ? undefined : b.company || null, isAdmin: b.isAdmin, active: b.active, ...(deactivating ? { tokenVersion: { increment: 1 } } : {}) },
    include: withMemberships,
  })
  const type = deactivating ? 'user.deactivated' : b.active === true && !u.active ? 'user.activated' : 'user.updated'
  const changes = changeList([['name', u.name, b.name ?? u.name], ['company', u.company, b.company === undefined ? u.company : b.company || null], ['administrator', u.isAdmin, b.isAdmin ?? u.isAdmin], ['active', u.active, b.active ?? u.active]]).join('; ') || 'no change'
  await securityLog(type, { email: u.email, userId: u.id, ...actor(req), detail: changes })
  const by = currentUser(req).name
  if (deactivating) await securityAlert(u, 'Your account was disabled', [`${by} disabled your Qualigrafo account. You were signed out and cannot sign in until it is enabled again.`])
  else if (type === 'user.activated') await securityAlert(u, 'Your account was enabled', [`${by} enabled your Qualigrafo account again.`])
  if (b.isAdmin !== undefined && b.isAdmin !== u.isAdmin) await securityAlert(u, b.isAdmin ? 'Administrator rights granted' : 'Administrator rights removed', [`${by} ${b.isAdmin ? 'gave your account administrator rights (users, access and installation settings)' : 'removed the administrator rights from your account'}.`])
  res.json({ user: userView(updated) })
})

admin.post('/users/:id/reset-password', async (req, res) => {
  const u = await getUser(req.params.id as string)
  const temp = tempPassword()
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(temp, BCRYPT_COST), mustChangePassword: true, tokenVersion: { increment: 1 } } })
  await securityLog('password.reset', { email: u.email, userId: u.id, ...actor(req) })
  await securityAlert(u, 'Your password was reset', [`${currentUser(req).name} reset the password of your Qualigrafo account. All your sessions were signed out.`, 'Your administrator gives you a temporary password separately; you choose your own password at the next sign-in.'])
  res.json({ user: userView(await getUser(u.id)), tempPassword: temp })
})

admin.put('/users/:id/memberships/:projectCode', async (req, res) => {
  const b = z.object({ role: zRole, scope: z.string().trim().max(120).nullable().optional() }).parse(req.body ?? {})
  const u = await getUser(req.params.id as string)
  const p = await prisma.project.findUnique({ where: { code: req.params.projectCode as string } })
  if (!p) throw notFound('Project not found.')
  const scope = b.scope || null
  await assertScope(prisma, p.id, p.code, b.role as Role, scope)
  if (b.role !== 'Owner / QA') await assertOwnerQaRemains(prisma, u.id, p.id)
  await prisma.membership.upsert({
    where: { userId_projectId: { userId: u.id, projectId: p.id } },
    update: { role: b.role, companyScope: scope },
    create: { userId: u.id, projectId: p.id, role: b.role, companyScope: scope },
  })
  const desc = `${u.name} <${u.email}> set as ${b.role}${scope ? ` limited to ${scope}` : ''}`
  await projectAudit(p.id, req, `Membership: ${desc}`)
  await securityLog('membership.set', { email: u.email, userId: u.id, ...actor(req), detail: `${p.code}: ${b.role}${scope ? ` (${scope})` : ''}` })
  res.json({ user: userView(await getUser(u.id)) })
})

admin.delete('/users/:id/memberships/:projectCode', async (req, res) => {
  const u = await getUser(req.params.id as string)
  const p = await prisma.project.findUnique({ where: { code: req.params.projectCode as string } })
  if (!p) throw notFound('Project not found.')
  await assertOwnerQaRemains(prisma, u.id, p.id)
  const { count } = await prisma.membership.deleteMany({ where: { userId: u.id, projectId: p.id } })
  if (!count) throw notFound('Membership not found.')
  await projectAudit(p.id, req, `Membership removed: ${u.name} <${u.email}>`)
  await securityLog('membership.removed', { email: u.email, userId: u.id, ...actor(req), detail: p.code })
  res.json({ user: userView(await getUser(u.id)) })
})

admin.get('/security-events', async (req, res) => {
  const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query)
  const rows = await prisma.securityEvent.findMany({ orderBy: { id: 'desc' }, take: q.limit })
  res.json({ events: rows.map((e) => ({ id: String(e.id), at: e.at.toISOString(), type: e.type, email: e.email, actor: e.actorName, ip: e.ip, detail: e.detail })) })
})

/* ------------------------------------------------------------ e-mail and reminders (Phase 2 / C5) */

/** Delivery configuration (from the environment, secrets never returned), reminder schedule, recent runs, outbox counts. */
admin.get('/notifications', async (_req, res) => {
  const [settings, runs, counts] = await Promise.all([
    getReminderSettings(),
    prisma.reminderRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
    prisma.emailMessage.groupBy({ by: ['status'], _count: { _all: true } }),
  ])
  res.json({ delivery: deliveryInfo(), settings, runs: runs.map(runView), counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) })
})

admin.put('/notifications/settings', async (req, res) => {
  const b = zReminderSettings.parse(req.body ?? {})
  const u = currentUser(req)
  const changes = await setReminderSettings(b, u.name)
  if (changes.length) await securityLog('settings.updated', { ...actor(req), detail: `Reminder schedule: ${changes.join('; ')}` })
  res.json({ settings: await getReminderSettings() })
})

/** Runs the reminder job now (in addition to the scheduled daily run). */
admin.post('/notifications/run', async (req, res) => {
  const u = currentUser(req)
  const run = await runReminders({ trigger: 'Manual', startedBy: u.name })
  await securityLog('reminders.run', { ...actor(req), detail: `${run!.items} item(s) in ${run!.projects} project(s); ${run!.emails} e-mail(s) queued` })
  res.json({ run })
})

/** Test message to the administrator's own address. */
admin.post('/notifications/test', async (req, res) => {
  const u = currentUser(req)
  await queueEmail(prisma, 'Test', u, '[Qualigrafo] Test e-mail', [`Hello ${u.name},`, '', 'This is a test e-mail from Qualigrafo. If you can read it, e-mail delivery works.', '', `Application: ${appLink()}`, '', '—', prefFooter('Off')].join('\n'))
  res.json({ ok: true, delivery: deliveryInfo() })
})

const emailView = (m: { id: string; createdAt: Date; kind: string; toEmail: string; toName: string; projectCode: string | null; subject: string; body: string; status: string; attempts: number; nextAttemptAt: Date; lastError: string | null; sentAt: Date | null }) => ({
  id: m.id, at: m.createdAt.toISOString(), kind: m.kind, to: m.toEmail, toName: m.toName, project: m.projectCode, subject: m.subject, body: m.body,
  status: m.status, attempts: m.attempts, nextAttemptAt: m.nextAttemptAt.toISOString(), error: m.lastError, sentAt: m.sentAt?.toISOString() ?? null,
})

admin.get('/emails', async (req, res) => {
  const q = z.object({ status: z.enum(['Queued', 'Sending', 'Sent', 'Failed', 'Not sent']).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query)
  const rows = await prisma.emailMessage.findMany({ where: q.status ? { status: q.status } : {}, orderBy: { createdAt: 'desc' }, take: q.limit })
  res.json({ emails: rows.map(emailView) })
})

admin.post('/emails/:id/retry', async (req, res) => {
  const m = await retryEmail(req.params.id as string)
  if (!m) throw notFound('E-mail not found.')
  await securityLog('email.retried', { email: m.toEmail, userId: m.userId ?? undefined, ...actor(req), detail: m.subject })
  res.json({ email: emailView(m) })
})

/* ------------------------------------------------------------ periodic user-access review (Phase 2 / C6) */

admin.get('/access-reviews', async (_req, res) => {
  const reviews = await prisma.accessReview.findMany({ orderBy: { startedAt: 'desc' }, include: { items: { select: { decision: true, flags: true } } } })
  res.json({ schedule: await reviewSchedule(), reviews: reviews.map(AR.summary), meaning: AR.REVIEW_MEANING, decisions: AR.DECISIONS })
})

admin.put('/access-reviews/settings', async (req, res) => {
  const b = AR.zReviewSettings.parse(req.body ?? {})
  const change = await AR.setReviewSettings(b, currentUser(req).name)
  if (change) await securityLog('settings.updated', { ...actor(req), detail: change })
  res.json({ schedule: await reviewSchedule() })
})

admin.post('/access-reviews', async (req, res) => {
  const r = await AR.startReview(currentUser(req))
  res.status(201).json({ review: await AR.reviewDetail(r.id) })
})

admin.get('/access-reviews/:id', async (req, res) => {
  res.json({ review: await AR.reviewDetail(req.params.id as string) })
})

admin.put('/access-reviews/:id/items/:item', async (req, res) => {
  const b = z.object({ decision: z.enum(AR.DECISIONS), note: z.string().max(1000).default('') }).parse(req.body ?? {})
  await AR.decide(currentUser(req), req.params.id as string, req.params.item as string, b, req.ip)
  res.json({ review: await AR.reviewDetail(req.params.id as string) })
})

/** Completion is an electronic signature: password again, meaning shown, hash over every decision. */
admin.post('/access-reviews/:id/complete', async (req, res) => {
  const b = z.object({ conclusion: z.string().max(3000), password: z.string().max(200) }).parse(req.body ?? {})
  const id = req.params.id as string
  const r = await prisma.accessReview.findUnique({ where: { id } })
  if (!r) throw notFound('Access review not found.')
  await reauthenticate(req, b.password, `access review ${r.code}`)
  await AR.completeReview(currentUser(req), id, b.conclusion, req.ip)
  res.json({ review: await AR.reviewDetail(id) })
})

admin.post('/access-reviews/:id/cancel', async (req, res) => {
  const b = z.object({ reason: z.string().max(1000) }).parse(req.body ?? {})
  await AR.cancelReview(currentUser(req), req.params.id as string, b.reason, req.ip)
  res.json({ review: await AR.reviewDetail(req.params.id as string) })
})

admin.get('/access-reviews/:id/report.pdf', async (req, res) => {
  const u = currentUser(req)
  const r = await AR.reviewDetail(req.params.id as string)
  const id = `${r.code}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-')}`
  const pdf = await accessReviewPdf(r, u.name, id)
  await securityLog('report.generated', { ...actor(req), detail: `Access review report ${id} (PDF, SHA-256 ${pdf.sha256})` })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="Qualigrafo_Access_Review_${r.code}.pdf"`)
  res.setHeader('X-Content-SHA256', pdf.sha256)
  res.send(pdf.pdf)
})

/* ------------------------------------------------------------ system & validation (Phase 2 / C7) */

const packDir = () => path.resolve(config.VALIDATION_DIR)
const PACK_NAME = /^[\w.-]+\.pdf$/

admin.get('/validation', async (_req, res) => {
  const last = await prisma.appSetting.findUnique({ where: { key: 'iq.last' } })
  const dir = packDir()
  const packs = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => PACK_NAME.test(f)).map((name) => {
      const full = path.join(dir, name)
      return { name, size: fs.statSync(full).size, at: fs.statSync(full).mtime.toISOString(), sha256: createHash('sha256').update(fs.readFileSync(full)).digest('hex') }
    }).sort((a, b) => b.at.localeCompare(a.at))
    : []
  res.json({ version: APP_VERSION, fingerprint: codeFingerprint().sha256, iq: last?.value ?? null, packs, catalogue: { urs: URS.length, oqCases: OQ_CASES.length } })
})

/** Executes the installation check now and keeps the latest result. */
admin.post('/validation/iq', async (req, res) => {
  const u = currentUser(req)
  const iq = await runIq(u.name)
  await prisma.appSetting.upsert({ where: { key: 'iq.last' }, update: { value: iq as object, updatedBy: u.name }, create: { key: 'iq.last', value: iq as object, updatedBy: u.name } })
  const n = (s: string) => iq.checks.filter((c) => c.status === s).length
  await securityLog('iq.executed', { ...actor(req), detail: `Installation check ${iq.overall}: ${n('Pass')} pass, ${n('Warning')} warning, ${n('Fail')} fail; version ${iq.version}; fingerprint ${iq.fingerprint}` })
  res.json({ iq })
})

admin.get('/validation/iq.pdf', async (req, res) => {
  const u = currentUser(req)
  const last = await prisma.appSetting.findUnique({ where: { key: 'iq.last' } })
  if (!last) throw rule('Run the installation check first.')
  const iq = last.value as unknown as IqResult
  const id = `IQ-${iq.executedAt.replace(/[-:]/g, '').slice(0, 13).replace('T', '-')}`
  const pdf = await iqPdf(iq, u.name, id, config.APP_URL || config.CORS_ORIGIN.split(',')[0])
  await securityLog('report.generated', { ...actor(req), detail: `Installation qualification record ${id} (PDF, SHA-256 ${pdf.sha256})` })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="Qualigrafo_IQ_${id}.pdf"`)
  res.setHeader('X-Content-SHA256', pdf.sha256)
  res.send(pdf.pdf)
})

/** Validation packs produced with `npm run validation:pack` (supplier OQ evidence for this release). */
admin.get('/validation/packs/:name', async (req, res) => {
  const name = req.params.name as string
  const full = path.join(packDir(), name)
  if (!PACK_NAME.test(name) || !fs.existsSync(full)) throw notFound('Validation pack not found.')
  const buf = fs.readFileSync(full)
  const sha = createHash('sha256').update(buf).digest('hex')
  await securityLog('report.generated', { ...actor(req), detail: `Validation pack ${name} downloaded (SHA-256 ${sha})` })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.setHeader('X-Content-SHA256', sha)
  res.send(buf)
})

/* ------------------------------------------------------------ backups (Phase 3 / P3) */

const backupView = (r: { id: string; name: string; trigger: string; startedBy: string | null; startedAt: Date; finishedAt: Date | null; status: string; sizeBytes: bigint | null; files: number; manifestSha: string | null; error: string | null; verifyStatus: string | null; verifiedAt: Date | null; verifyDetail: string | null }) => ({
  id: r.id, name: r.name, trigger: r.trigger, startedBy: r.startedBy, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
  status: r.status, sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes), files: r.files, manifestSha: r.manifestSha, error: r.error,
  verifyStatus: r.verifyStatus, verifiedAt: r.verifiedAt?.toISOString() ?? null, verifyDetail: r.verifyDetail,
})

admin.get('/backups', async (_req, res) => {
  const [settings, runs, tools] = await Promise.all([BK.getBackupSettings(), prisma.backupRun.findMany({ where: { status: { not: 'Deleted' } }, orderBy: { startedAt: 'desc' }, take: 60 }), BK.toolsInfo()])
  res.json({ settings, runs: runs.map(backupView), tools, dir: BK.backupDir(), busy: BK.backupBusy() })
})

admin.put('/backups/settings', async (req, res) => {
  const b = BK.zBackupSettings.parse(req.body ?? {})
  const changes = await BK.setBackupSettings(b, currentUser(req).name)
  if (changes.length) await securityLog('settings.updated', { ...actor(req), detail: `Backups: ${changes.join('; ')}` })
  res.json({ settings: await BK.getBackupSettings() })
})

/** Starts a backup (and its test restore when configured) in the background; the page polls GET /backups. */
admin.post('/backups', async (req, res) => {
  const u = currentUser(req)
  if (BK.backupBusy()) throw rule(`A ${BK.backupBusy()} is already running.`)
  const { verify } = await BK.getBackupSettings()
  const started = BK.createBackup({ trigger: 'Manual', startedBy: u.name })
  void started.then(async (r) => {
    if (!r) return
    await securityLog('backup.created', { actorId: u.id, actorName: u.name, detail: `${r.name}: ${r.files} file(s), ${Number(r.sizeBytes ?? 0)} bytes, manifest SHA-256 ${r.manifestSha}` })
    if (verify) {
      const v = await BK.verifyBackup(r.id, u.name)
      await securityLog('backup.verified', { actorId: u.id, actorName: u.name, detail: `${r.name}: ${v.verifyStatus}` })
    }
  }).catch((e) => console.error('backup:', e))
  // Give the run a moment to register, so the answer already lists it.
  await new Promise((r) => setTimeout(r, 300))
  res.status(202).json({ started: true })
})

admin.post('/backups/:id/verify', async (req, res) => {
  const u = currentUser(req)
  if (BK.backupBusy()) throw rule(`A ${BK.backupBusy()} is already running.`)
  const r = await prisma.backupRun.findUnique({ where: { id: req.params.id as string } })
  if (!r) throw notFound('Backup not found.')
  if (r.status !== 'Done') throw rule('Only a completed backup can be verified.')
  void BK.verifyBackup(r.id, u.name).then((v) => securityLog('backup.verified', { actorId: u.id, actorName: u.name, detail: `${r.name}: ${v.verifyStatus}` })).catch((e) => console.error('verify:', e))
  await new Promise((rr) => setTimeout(rr, 300))
  res.status(202).json({ started: true })
})

/* ------------------------------------------------------------ monitoring (Phase 3 / P6) */

/** Health of this installation, background jobs, grouped errors, detected outages and the alert settings. */
admin.get('/monitoring', async (_req, res) => {
  res.json(await MON.monitoringOverview())
})

admin.put('/monitoring/settings', async (req, res) => {
  const b = MON.zMonitorSettings.parse(req.body ?? {})
  const changes = await MON.setMonitorSettings(b, currentUser(req).name)
  if (changes.length) await securityLog('settings.updated', { ...actor(req), detail: `Monitoring: ${changes.join('; ')}` })
  res.json({ settings: await MON.getMonitorSettings() })
})

/** Acknowledge or resolve an error group (New = reopen it); the decision is kept with the group and logged. */
admin.post('/monitoring/errors/:id', async (req, res) => {
  const b = z.object({ status: z.enum(['New', 'Acknowledged', 'Resolved']), note: z.string().trim().max(1000).default('') }).parse(req.body ?? {})
  if (b.status !== 'New' && !b.note) throw rule('Say what was found or done (note).')
  const u = currentUser(req)
  const e = await MON.setErrorStatus(req.params.id as string, b.status, b.note, u.name)
  if (!e) throw notFound('Error not found.')
  await securityLog('monitor.handled', { ...actor(req), detail: `Error ${e.place} "${e.message.slice(0, 80)}" set to ${b.status}${b.note ? `: ${b.note}` : ''}` })
  res.json({ error: { id: e.id, status: e.status, note: e.note, handledBy: e.handledBy, handledAt: e.handledAt?.toISOString() ?? null } })
})

/** Sends the alert e-mail that a real problem would send, so the administrator can check that alerts arrive. */
admin.post('/monitoring/test-alert', async (req, res) => {
  const u = currentUser(req)
  const sent = await MON.alert('test', 'Test alert', [
    `${u.name} sent this test alert from Users & access → Monitoring.`,
    'Real alerts are sent when a background job stops running, when the API was not reachable, when a new error appears or when disk space runs low.',
  ], true)
  await securityLog('monitor.alert', { ...actor(req), detail: 'Test alert sent' })
  res.json({ sent, delivery: deliveryInfo() })
})

/** Tail of today's log file (only when LOG_DIR is configured; the console output is read on the server). */
admin.get('/monitoring/log', (req, res) => {
  const q = z.object({ lines: z.coerce.number().int().min(10).max(500).default(200) }).parse(req.query)
  res.json({ target: logTarget(), lines: tailLog(q.lines) })
})
