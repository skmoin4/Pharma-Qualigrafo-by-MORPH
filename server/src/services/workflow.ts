import { expectedSigner } from '../domain/rules.ts'
import type { Automation } from '../domain/types.ts'
import { forbidden, rule } from '../lib/http.ts'
import type { Ctx } from './ctx.ts'
import { appLink, prefFooter, queueEmail } from './mail.ts'

const AUTOMATION_FIELD = { routing: 'autoRouting', reminders: 'autoReminders', autoIssue: 'autoIssue' } as const

export async function setAutomation(c: Ctx, k: keyof Automation, v: boolean) {
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA can change automation rules.')
  await c.tx.project.update({ where: { id: c.project.id }, data: { [AUTOMATION_FIELD[k]]: v } })
  await c.log(`Automation rule ${k} ${v ? 'enabled' : 'disabled'} ("${v ? 'off' : 'on'}" -> "${v ? 'on' : 'off'}")`)
}

/** Reminders to every signer whose sign-off is waiting: in-app per document, one e-mail per person. */
export async function sendReminders(c: Ctx) {
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA can send reminders.')
  if (!c.project.autoReminders) throw rule('Reminder rule is disabled.')
  const waiting = await c.tx.document.findMany({ where: { projectId: c.project.id, status: 'Under review' }, orderBy: { code: 'asc' } })
  if (!waiting.length) throw rule('No documents are waiting for sign-off.')
  for (const d of waiting) {
    const who = expectedSigner(d.signStage)
    await c.notify('Reminder', `Reminder: ${d.code} R${d.rev} is waiting for your sign-off (${who}). A deadline never approves a document.`, d.code, who, { email: false })
  }
  const ms = await c.tx.membership.findMany({ where: { projectId: c.project.id, role: { in: [...new Set(waiting.map((d) => expectedSigner(d.signStage)))] }, userId: { not: c.user.id }, user: { active: true, emailPref: { not: 'Off' } } }, include: { user: true } })
  for (const m of ms) {
    const mine = waiting.filter((d) => expectedSigner(d.signStage) === m.role)
    const body = [
      `Hello ${m.user.name},`, '', `${c.user.name} (${c.role}) sent a reminder: ${mine.length} document(s) on ${c.project.code} are waiting for your sign-off as ${m.role}:`, '',
      ...mine.map((d) => `  • ${d.code} R${String(d.rev).padStart(2, '0')} ${d.title} (due ${d.due.toISOString().slice(0, 10)})`), '',
      'A deadline never approves a document; each sign-off needs your password in Qualigrafo.',
      `Open: ${appLink(c.project.code, 'reviews')}`, '', '—', prefFooter(m.user.emailPref),
    ].join('\n')
    await queueEmail(c.tx, 'Reminder', m.user, `[${c.project.code}] Reminder: ${mine.length} document(s) waiting for your sign-off`, body, c.project.code)
  }
  await c.log(`Reminders sent for ${waiting.length} document(s) waiting for sign-off; e-mail to ${ms.length} member(s)`)
}

/** Read state is per user; marks every notice in the project as read for the caller. */
export async function markAllRead(c: Ctx) {
  const notices = await c.tx.notice.findMany({ where: { projectId: c.project.id, reads: { none: { userId: c.user.id } } }, select: { id: true } })
  if (notices.length) await c.tx.noticeRead.createMany({ data: notices.map((n) => ({ noticeId: n.id, userId: c.user.id })), skipDuplicates: true })
}
