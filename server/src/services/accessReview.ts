// Periodic user-access review (Phase 2 / C6; EU GMP Annex 11 §12, 21 CFR 11.10(d)).
// An administrator starts a review: every active account is snapshotted with its project roles and findings that need
// attention. Each account gets a decision (keep / keep with changes / disable — applied at once); the review is closed
// with an electronic signature and documented in a PDF report. Everything is written to the security log.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../db.ts'
import { today } from '../domain/rules.ts'
import { rule, notFound } from '../lib/http.ts'
import { securityLog } from '../lib/security.ts'
import type { AuthUser } from '../middleware/auth.ts'
import { securityAlert } from './mail.ts'
import { addDays } from './reminders.ts'
import { assertOwnerQaRemains } from './team.ts'

export const DECISIONS = ['Keep', 'Keep with changes', 'Disable account'] as const
export type Decision = (typeof DECISIONS)[number]
export const REVIEW_MEANING = 'Access review completed — remaining user access confirmed appropriate'
/** Days without sign-in after which an account is flagged. */
export const DORMANT_DAYS = 90
/** Days an open review has to be completed. */
export const REVIEW_WINDOW_DAYS = 14

/* ------------------------------------------------------------ schedule */

export const zReviewSettings = z.object({ intervalDays: z.number().int().min(30, 'Interval must be 30–365 days.').max(365, 'Interval must be 30–365 days.') })
export type ReviewSettings = z.infer<typeof zReviewSettings>
const KEY = 'accessReview'

export async function getReviewSettings(): Promise<ReviewSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } })
  return { intervalDays: 90, ...((row?.value as Partial<ReviewSettings> | undefined) ?? {}) }
}
export async function setReviewSettings(v: ReviewSettings, by: string) {
  const old = await getReviewSettings()
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value: v, updatedBy: by }, create: { key: KEY, value: v, updatedBy: by } })
  return old.intervalDays === v.intervalDays ? null : `Access review interval "${old.intervalDays} days" -> "${v.intervalDays} days"`
}

/** When the next review is due: interval after the last completed one (or today when there has never been one). */
export async function reviewSchedule() {
  const [s, last, open] = await Promise.all([
    getReviewSettings(),
    prisma.accessReview.findFirst({ where: { status: 'Completed' }, orderBy: { completedAt: 'desc' } }),
    prisma.accessReview.findFirst({ where: { status: 'Open' } }),
  ])
  const date = today()
  const nextDue = last?.completedAt ? addDays(last.completedAt.toISOString().slice(0, 10), s.intervalDays) : date
  return {
    intervalDays: s.intervalDays,
    lastCompleted: last ? { code: last.code, at: last.completedAt!.toISOString(), by: last.completedBy } : null,
    nextDue,
    due: !open && nextDue <= date,
    open: open ? { code: open.code, id: open.id, dueDate: open.dueDate, overdue: open.dueDate < date } : null,
  }
}

/* ------------------------------------------------------------ start */

const daysSince = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / 86_400_000)

export async function startReview(actor: AuthUser) {
  if (await prisma.accessReview.findFirst({ where: { status: 'Open' } })) throw rule('An access review is already open. Complete or cancel it first.')
  const now = new Date()
  const last = await prisma.accessReview.findFirst({ where: { status: 'Completed' }, orderBy: { completedAt: 'desc' } })
  const users = await prisma.user.findMany({ where: { active: true }, include: { memberships: { include: { project: { select: { code: true, name: true, status: true } } } } }, orderBy: { name: 'asc' } })
  const all = await prisma.accessReview.findMany({ select: { code: true } })
  const code = `AR-${String(all.reduce((m, r) => Math.max(m, Number(r.code.slice(3)) || 0), 0) + 1).padStart(3, '0')}`
  const review = await prisma.accessReview.create({
    data: {
      code, startedById: actor.id, startedBy: actor.name, dueDate: addDays(today(), REVIEW_WINDOW_DAYS),
      items: {
        create: users.map((u) => {
          const ms = u.memberships.map((m) => ({ project: m.project.code, name: m.project.name, role: m.role, scope: m.companyScope, archived: m.project.status === 'Archived' })).sort((a, b) => a.project.localeCompare(b.project))
          const flags: string[] = []
          if (u.isAdmin) flags.push('Administrator')
          if (!u.lastLoginAt) flags.push('Never signed in')
          else if (daysSince(u.lastLoginAt, now) >= DORMANT_DAYS) flags.push(`No sign-in for ${DORMANT_DAYS}+ days`)
          if (u.mustChangePassword) flags.push('Temporary password not changed')
          if (!ms.length && !u.isAdmin) flags.push('No project access')
          else if (ms.length && ms.every((m) => m.archived)) flags.push('Only archived projects')
          if (last?.completedAt && u.createdAt > last.completedAt) flags.push(`New since ${last.code}`)
          return { userId: u.id, email: u.email, name: u.name, company: u.company, isAdmin: u.isAdmin, mustChangePassword: u.mustChangePassword, lastLoginAt: u.lastLoginAt, accountCreatedAt: u.createdAt, memberships: ms, flags }
        }),
      },
    },
  })
  await securityLog('access.review.started', { actorId: actor.id, actorName: actor.name, detail: `${code}: ${users.length} active account(s) to review, due ${review.dueDate}` })
  return review
}

/* ------------------------------------------------------------ decide */

async function openReview(id: string) {
  const r = await prisma.accessReview.findUnique({ where: { id } })
  if (!r) throw notFound('Access review not found.')
  if (r.status !== 'Open') throw rule(`${r.code} is ${r.status.toLowerCase()} and can no longer change.`)
  return r
}

export async function decide(actor: AuthUser, reviewId: string, itemId: string, b: { decision: Decision; note: string }, ip?: string) {
  const r = await openReview(reviewId)
  const item = await prisma.accessReviewItem.findFirst({ where: { id: itemId, reviewId } })
  if (!item) throw notFound('Review item not found.')
  const note = b.note.trim()
  if (item.decision === 'Disable account') throw rule(`${item.name} was already disabled in this review; enable the account under Users if that was wrong.`)
  if (b.decision !== 'Keep' && !note) throw rule(b.decision === 'Disable account' ? 'State why the account is disabled.' : 'Describe the change (role, project, scope or rights) made under Users.')
  if (b.decision === 'Disable account') {
    if (item.userId === actor.id) throw rule('You cannot disable your own account.')
    const u = await prisma.user.findUnique({ where: { id: item.userId } })
    if (u?.active) {
      if (u.isAdmin && !(await prisma.user.count({ where: { isAdmin: true, active: true, id: { not: u.id } } }))) throw rule('At least one active administrator must remain.')
      await assertOwnerQaRemains(prisma, u.id)
      await prisma.user.update({ where: { id: u.id }, data: { active: false, tokenVersion: { increment: 1 } } })
      await securityLog('user.deactivated', { email: u.email, userId: u.id, actorId: actor.id, actorName: actor.name, ip, detail: `active "yes" -> "no" (access review ${r.code}: ${note})` })
      await securityAlert(u, 'Your account was disabled', [`${actor.name} disabled your Qualigrafo account during access review ${r.code}. You were signed out and cannot sign in until it is enabled again.`])
    }
  }
  const updated = await prisma.accessReviewItem.update({ where: { id: item.id }, data: { decision: b.decision, note, decidedById: actor.id, decidedBy: actor.name, decidedAt: new Date() } })
  const before = item.decision ? ` (was "${item.decision}")` : ''
  await securityLog('access.review.decided', { email: item.email, userId: item.userId, actorId: actor.id, actorName: actor.name, ip, detail: `${r.code}: ${item.name} -> "${b.decision}"${before}${note ? `. Note: ${note}` : ''}${item.userId === actor.id ? ' (self-review)' : ''}` })
  return updated
}

/* ------------------------------------------------------------ complete / cancel */

type ItemRow = { email: string; decision: string | null; note: string; decidedById: string | null }
export function reviewHash(r: { code: string; completedById: string; completedByEmail: string; completedBy: string; meaning: string; conclusion: string; completedAt: Date }, items: ItemRow[]) {
  const decisions = [...items].sort((a, b) => a.email.localeCompare(b.email)).map((i) => [i.email, i.decision, i.note, i.decidedById])
  return createHash('sha256').update(JSON.stringify([r.code, decisions, r.completedById, r.completedByEmail, r.completedBy, r.meaning, r.conclusion, r.completedAt.toISOString()])).digest('hex')
}

export async function completeReview(actor: AuthUser, id: string, conclusion: string, ip?: string) {
  const r = await openReview(id)
  const items = await prisma.accessReviewItem.findMany({ where: { reviewId: id } })
  const open = items.filter((i) => !i.decision)
  if (open.length) throw rule(`${open.length} account(s) still need a decision: ${open.slice(0, 5).map((i) => i.name).join(', ')}${open.length > 5 ? ' …' : ''}.`)
  if (!conclusion.trim()) throw rule('Write the review conclusion.')
  const completedAt = new Date()
  const fields = { code: r.code, completedById: actor.id, completedByEmail: actor.email, completedBy: actor.name, meaning: REVIEW_MEANING, conclusion: conclusion.trim(), completedAt }
  const done = await prisma.accessReview.update({ where: { id }, data: { status: 'Completed', ...fields, sigHash: reviewHash(fields, items) } })
  const n = (d: Decision) => items.filter((i) => i.decision === d).length
  await securityLog('access.review.completed', { actorId: actor.id, actorName: actor.name, ip, detail: `${r.code}: ${items.length} account(s) — ${n('Keep')} kept, ${n('Keep with changes')} changed, ${n('Disable account')} disabled. Signed: ${REVIEW_MEANING}` })
  await securityLog('esign.signed', { email: actor.email, userId: actor.id, actorId: actor.id, actorName: actor.name, ip, detail: `access review ${r.code}` })
  return done
}

export async function cancelReview(actor: AuthUser, id: string, reason: string, ip?: string) {
  const r = await openReview(id)
  if (!reason.trim()) throw rule('A reason is required to cancel a review.')
  await prisma.accessReview.update({ where: { id }, data: { status: 'Cancelled', cancelReason: reason.trim() } })
  await securityLog('access.review.cancelled', { actorId: actor.id, actorName: actor.name, ip, detail: `${r.code}: ${reason.trim()}` })
}

/* ------------------------------------------------------------ views */

export async function reviewDetail(id: string) {
  const r = await prisma.accessReview.findUnique({ where: { id }, include: { items: { orderBy: { name: 'asc' } } } })
  if (!r) throw notFound('Access review not found.')
  const valid = r.status === 'Completed' && r.sigHash ? reviewHash({ code: r.code, completedById: r.completedById!, completedByEmail: r.completedByEmail!, completedBy: r.completedBy!, meaning: r.meaning!, conclusion: r.conclusion!, completedAt: r.completedAt! }, r.items) === r.sigHash : null
  return {
    ...summary(r),
    conclusion: r.conclusion, meaning: r.meaning, sigHash: r.sigHash, signature: valid === null ? null : valid ? 'Valid' : 'Altered', cancelReason: r.cancelReason,
    items: r.items.map((i) => ({
      id: i.id, userId: i.userId, email: i.email, name: i.name, company: i.company, isAdmin: i.isAdmin, mustChangePassword: i.mustChangePassword,
      lastLoginAt: i.lastLoginAt?.toISOString() ?? null, accountCreatedAt: i.accountCreatedAt.toISOString(),
      memberships: i.memberships as { project: string; name: string; role: string; scope: string | null; archived: boolean }[],
      flags: i.flags as string[], decision: i.decision, note: i.note, decidedBy: i.decidedBy, decidedAt: i.decidedAt?.toISOString() ?? null,
      selfReview: !!i.decidedById && i.decidedById === i.userId,
    })),
  }
}
export type ReviewDetail = Awaited<ReturnType<typeof reviewDetail>>

export function summary(r: { id: string; code: string; status: string; startedBy: string; startedAt: Date; dueDate: string; completedBy: string | null; completedAt: Date | null; items?: { decision: string | null; flags: unknown }[] }) {
  const items = r.items ?? []
  return {
    id: r.id, code: r.code, status: r.status, startedBy: r.startedBy, startedAt: r.startedAt.toISOString(), dueDate: r.dueDate,
    completedBy: r.completedBy, completedAt: r.completedAt?.toISOString() ?? null,
    total: items.length, decided: items.filter((i) => i.decision).length, flagged: items.filter((i) => (i.flags as string[]).length).length,
    disabled: items.filter((i) => i.decision === 'Disable account').length, changed: items.filter((i) => i.decision === 'Keep with changes').length,
  }
}
