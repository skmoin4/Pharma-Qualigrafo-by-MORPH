// Scheduled reminders (Phase 2 / C5): a daily job that finds work waiting on people (sign-offs, overdue and
// soon-due items), posts in-app reminders, writes the audit trail and e-mails one consolidated message per person.
// The scheduled run is unique per working date (ReminderRun.slot), so restarts or several API instances never
// send the same day's reminders twice. A reminder never approves, closes or changes a record.
import { z } from 'zod'
import { prisma } from '../db.ts'
import type { Tx } from '../db.ts'
import { config } from '../config.ts'
import { expectedSigner, today } from '../domain/rules.ts'
import type { Role } from '../domain/types.ts'
import { changeList } from '../lib/audit.ts'
import { addNotice } from './ctx.ts'
import { appLink, appUrl, prefFooter, queueEmail } from './mail.ts'

/* ------------------------------------------------------------ settings */

export const zReminderSettings = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24-hour).'),
  dueSoonDays: z.number().int().min(0, 'Due-soon window must be 0–14 days.').max(14, 'Due-soon window must be 0–14 days.'),
})
export type ReminderSettings = z.infer<typeof zReminderSettings>
const DEFAULTS: ReminderSettings = { enabled: true, time: '08:00', dueSoonDays: 3 }
const KEY = 'reminders'

export async function getReminderSettings(): Promise<ReminderSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } })
  return { ...DEFAULTS, ...((row?.value as Partial<ReminderSettings> | undefined) ?? {}) }
}

/** Saves the schedule; returns the old -> new change list for the security log (empty when nothing changed). */
export async function setReminderSettings(next: ReminderSettings, by: string) {
  const old = await getReminderSettings()
  const changes = changeList([['daily reminders', old.enabled ? 'on' : 'off', next.enabled ? 'on' : 'off'], ['time', old.time, next.time], ['due-soon window (days)', old.dueSoonDays, next.dueSoonDays]])
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value: next, updatedBy: by }, create: { key: KEY, value: next, updatedBy: by } })
  return changes
}

/* ------------------------------------------------------------ what needs attention */

export type ItemKind = 'Sign-off' | 'Overdue' | 'Due soon'
export interface ReminderItem {
  role: Role
  /** Company whose vendor accounts may see the item; null = only members with whole-project access. */
  company: string | null
  kind: ItemKind
  code: string
  text: string
  page: string
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (date: string, n: number) => ymd(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000))
const ROLE_ORDER: Role[] = ['Consultant', 'Owner / QA', 'Contractor']

/** Items of one project that need someone's action today, per role. */
export async function collectItems(tx: Tx, projectId: string, date: string, dueSoonDays: number): Promise<ReminderItem[]> {
  const limit = new Date(`${addDays(date, dueSoonDays)}T00:00:00Z`)
  const when = (due: Date): ItemKind => (ymd(due) < date ? 'Overdue' : 'Due soon')
  const dueText = (due: Date) => (ymd(due) < date ? `overdue since ${ymd(due)}` : `due ${ymd(due)}`)
  const [review, docs, rfis, ncrs, actions] = await Promise.all([
    tx.document.findMany({ where: { projectId, status: 'Under review' }, orderBy: { code: 'asc' } }),
    tx.document.findMany({ where: { projectId, status: { in: ['Missing', 'Draft', 'Changes requested'] }, due: { lte: limit } }, orderBy: [{ due: 'asc' }, { code: 'asc' }] }),
    tx.rfi.findMany({ where: { projectId, status: 'Awaiting response', due: { lte: limit } }, orderBy: [{ due: 'asc' }, { code: 'asc' }] }),
    tx.ncr.findMany({ where: { projectId, status: 'Open', due: { lte: limit } }, include: { document: { select: { owner: true } } }, orderBy: [{ due: 'asc' }, { code: 'asc' }] }),
    tx.gapAction.findMany({ where: { projectId, status: 'Open', due: { lte: limit } }, orderBy: [{ due: 'asc' }, { code: 'asc' }] }),
  ])
  const items: ReminderItem[] = []
  for (const d of review) items.push({ role: expectedSigner(d.signStage), company: null, kind: 'Sign-off', code: d.code, text: `${d.code} R${String(d.rev).padStart(2, '0')} ${d.title} — waiting for your sign-off (stage ${d.signStage + 1})`, page: 'reviews' })
  for (const d of docs) items.push({ role: 'Contractor', company: d.owner, kind: when(d.due), code: d.code, text: `${d.code} ${d.title} (${d.status}, ${d.owner}) — ${dueText(d.due)}`, page: 'documents' })
  for (const r of rfis) for (const role of ['Consultant', 'Owner / QA'] as Role[]) items.push({ role, company: null, kind: when(r.due), code: r.code, text: `${r.code} ${r.title} — response ${dueText(r.due)}`, page: 'rfis' })
  for (const n of ncrs) items.push({ role: 'Contractor', company: n.document?.owner ?? null, kind: when(n.due), code: n.code, text: `${n.code} (${n.severity}) ${n.title} — response ${dueText(n.due)}`, page: 'ncrs' })
  for (const a of actions) items.push({ role: 'Contractor', company: null, kind: when(a.due), code: a.code, text: `${a.code} ${a.title} (owner ${a.owner}) — ${dueText(a.due)}`, page: 'actions' })
  return items
}

const countText = (its: ReminderItem[], date: string, soon: number) => {
  const n = (k: ItemKind) => its.filter((i) => i.kind === k).length
  return [n('Sign-off') && `${n('Sign-off')} waiting for sign-off`, n('Overdue') && `${n('Overdue')} overdue`, n('Due soon') && `${n('Due soon')} due by ${addDays(date, soon)}`].filter(Boolean).join(', ')
}

/* ------------------------------------------------------------ the run */

interface Section { code: string; name: string; role: string; scope: string | null; items: ReminderItem[]; notices: { text: string; at: Date }[] }
interface Person { id: string; email: string; name: string; pref: string; sections: Map<string, Section> }

export interface RunResult { id: string; runDate: string; trigger: string; status: string; projects: number; items: number; emails: number; startedBy: string | null; startedAt: string; finishedAt: string | null; error: string | null }
export const runView = (r: { id: string; runDate: string; trigger: string; status: string; projects: number; items: number; emails: number; startedBy: string | null; startedAt: Date; finishedAt: Date | null; error: string | null }): RunResult =>
  ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null })

/**
 * Runs the reminder job once. `slot` makes a scheduled run unique per date: returns null when that slot already ran.
 * Projects that are archived or have the reminder rule switched off are skipped.
 */
export async function runReminders(o: { trigger: 'Scheduled' | 'Manual'; startedBy?: string; slot?: string; now?: Date }): Promise<RunResult | null> {
  const now = o.now ?? new Date()
  const date = today()
  const settings = await getReminderSettings()
  let run
  try {
    run = await prisma.reminderRun.create({ data: { runDate: date, trigger: o.trigger, slot: o.slot ?? null, startedBy: o.startedBy ?? null } })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return null
    throw e
  }
  try {
    const people = new Map<string, Person>()
    const section = (u: { id: string; email: string; name: string; emailPref: string }, p: { code: string; name: string }, role: string, scope: string | null) => {
      const person = people.get(u.id) ?? { id: u.id, email: u.email, name: u.name, pref: u.emailPref, sections: new Map() }
      people.set(u.id, person)
      const s = person.sections.get(p.code) ?? { code: p.code, name: p.name, role, scope, items: [], notices: [] }
      person.sections.set(p.code, s)
      return s
    }
    let projectsWithItems = 0
    let itemCount = 0
    const projects = await prisma.project.findMany({ where: { status: 'Active', autoReminders: true }, orderBy: { code: 'asc' } })
    const by = o.trigger === 'Scheduled' ? 'Scheduler' : `Scheduler (run by ${o.startedBy ?? 'administrator'})`
    for (const p of projects) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${p.id}))::text AS locked`
        const items = await collectItems(tx, p.id, date, settings.dueSoonDays)
        if (!items.length) return
        projectsWithItems++
        itemCount += new Set(items.map((i) => i.code)).size
        const perRole = ROLE_ORDER.map((role) => ({ role, its: items.filter((i) => i.role === role) })).filter((x) => x.its.length)
        for (const { role, its } of perRole) {
          const codes = [...new Set(its.map((i) => i.code))]
          await addNotice(tx, p.id, 'Reminder', `Daily reminder: ${countText(its, date, settings.dueSoonDays)} — ${codes.slice(0, 8).join(', ')}${codes.length > 8 ? ` and ${codes.length - 8} more` : ''}. A reminder never approves or closes anything.`, null, role)
        }
        const ms = await tx.membership.findMany({ where: { projectId: p.id, user: { active: true, emailPref: { not: 'Off' } } }, include: { user: true } })
        let mailed = 0
        for (const m of ms) {
          const mine = items.filter((i) => i.role === m.role && (!m.companyScope || i.company === m.companyScope))
          if (!mine.length) continue
          section(m.user, p, m.role, m.companyScope).items.push(...mine)
          mailed++
        }
        await tx.auditEvent.create({ data: { projectId: p.id, role: 'System', userName: by, text: `Reminders (${o.trigger === 'Scheduled' ? `daily run ${date}` : 'manual run'}): ${perRole.map(({ role, its }) => `${role} ${countText(its, date, settings.dueSoonDays)}`).join('; ')}. E-mail to ${mailed} member(s).` } })
      }, { timeout: 30_000 })
    }

    // Daily digest: role-targeted notices since the previous digest, for people who chose one e-mail a day.
    const digest = await prisma.user.findMany({ where: { active: true, emailPref: 'Daily digest' }, include: { memberships: { include: { project: true } } } })
    for (const u of digest) {
      const since = u.lastDigestAt ?? new Date(now.getTime() - 86_400_000)
      for (const m of u.memberships) {
        if (m.project.status !== 'Active') continue
        const ns = await prisma.notice.findMany({ where: { projectId: m.projectId, forRole: m.role, at: { gt: since, lte: now }, NOT: { category: 'Reminder' } }, orderBy: { seq: 'asc' } })
        let visible = ns
        if (m.companyScope) {
          const owners = new Map((await prisma.document.findMany({ where: { projectId: m.projectId, code: { in: ns.map((n) => n.docCode).filter((c): c is string => !!c) } }, select: { code: true, owner: true } })).map((d) => [d.code, d.owner]))
          visible = ns.filter((n) => n.docCode && owners.get(n.docCode) === m.companyScope)
        }
        if (visible.length) section(u, m.project, m.role, m.companyScope).notices.push(...visible.map((n) => ({ text: n.text, at: n.at })))
      }
      await prisma.user.update({ where: { id: u.id }, data: { lastDigestAt: now } })
    }

    let emails = 0
    for (const person of people.values()) {
      const sections = [...person.sections.values()].filter((s) => s.items.length || s.notices.length)
      if (!sections.length) continue
      const items = sections.reduce((n, s) => n + s.items.length, 0)
      const notices = sections.reduce((n, s) => n + s.notices.length, 0)
      const lines = [`Hello ${person.name},`, '', `Your Qualigrafo ${person.pref === 'Daily digest' ? 'daily digest' : 'reminders'} for ${date}:`]
      for (const s of sections) {
        lines.push('', `${s.code} — ${s.name} (your role: ${s.role}${s.scope ? `, records of ${s.scope}` : ''})`)
        for (const k of ['Sign-off', 'Overdue', 'Due soon'] as ItemKind[]) {
          const its = s.items.filter((i) => i.kind === k)
          if (!its.length) continue
          lines.push(`  ${k === 'Sign-off' ? 'Waiting for your sign-off' : k === 'Overdue' ? 'Overdue' : `Due by ${addDays(date, settings.dueSoonDays)}`}:`)
          for (const i of its) lines.push(`    • ${i.text}`)
        }
        if (s.notices.length) {
          lines.push('  Notifications for you:')
          for (const n of s.notices) lines.push(`    • ${n.text} (${n.at.toISOString().slice(0, 16).replace('T', ' ')} UTC)`)
        }
        lines.push(`  Open: ${appLink(s.code, s.items[0]?.page ?? 'activity')}`)
      }
      lines.push('', 'A reminder never approves, signs or closes anything; each item still needs a decision in Qualigrafo.', '', '—', prefFooter(person.pref))
      const subject = person.pref === 'Daily digest'
        ? `[Qualigrafo] Daily digest ${date}: ${[items && `${items} item(s) need your attention`, notices && `${notices} notification(s)`].filter(Boolean).join(', ')}`
        : `[Qualigrafo] Daily reminder ${date}: ${items} item(s) need your attention`
      await queueEmail(prisma, person.pref === 'Daily digest' ? 'Digest' : 'Reminder', person, subject, lines.join('\n'), sections.length === 1 ? sections[0].code : null)
      emails++
    }
    // Periodic user-access review (C6): administrators are reminded while a review is due or an open one is overdue.
    const { reviewSchedule } = await import('./accessReview.ts')
    const rs = await reviewSchedule()
    if (rs.due || rs.open?.overdue) {
      const what = rs.open ? `Access review ${rs.open.code} is overdue (target date ${rs.open.dueDate}).` : `The periodic user-access review is due (every ${rs.intervalDays} days; ${rs.lastCompleted ? `last: ${rs.lastCompleted.code}, ${rs.lastCompleted.at.slice(0, 10)}` : 'no review completed yet'}).`
      const admins = await prisma.user.findMany({ where: { active: true, isAdmin: true, emailPref: { not: 'Off' } } })
      for (const a of admins) {
        await queueEmail(prisma, 'Reminder', a, `[Qualigrafo] ${rs.open ? `Access review ${rs.open.code} overdue` : 'User-access review due'}`, [
          `Hello ${a.name},`, '', what, '', 'Review every active account and its project roles, record a decision for each, and complete the review with your electronic signature.',
          `Open: ${appUrl()}/#/admin`, '', '—', prefFooter(a.emailPref),
        ].join('\n'))
        emails++
      }
    }
    const done = await prisma.reminderRun.update({ where: { id: run.id }, data: { status: 'Done', finishedAt: new Date(), projects: projectsWithItems, items: itemCount, emails } })
    return runView(done)
  } catch (e) {
    await prisma.reminderRun.update({ where: { id: run.id }, data: { status: 'Failed', finishedAt: new Date(), error: e instanceof Error ? e.message.slice(0, 500) : String(e) } })
    throw e
  }
}

/* ------------------------------------------------------------ scheduler */

/** Local clock time HH:MM in the installation's time zone. */
export const localTime = (now: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: config.APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)

/** Runs today's scheduled reminders once the configured time has passed (and only once per date). */
export async function maybeRunDaily(now = new Date()) {
  const s = await getReminderSettings()
  if (!s.enabled || localTime(now) < s.time) return null
  return runReminders({ trigger: 'Scheduled', slot: `daily:${today()}`, now })
}

let started = false
export function startScheduler(everyMs = 60_000) {
  if (started) return
  started = true
  const tick = async () => {
    const { heartbeat, jobFailed } = await import('./monitoring.ts')
    try {
      const run = await maybeRunDaily()
      await heartbeat('reminders', { ok: true, detail: run ? `${run.runDate}: ${run.items} item(s), ${run.emails} e-mail(s)` : 'waiting for the next scheduled time' })
    } catch (e) {
      await jobFailed('reminders', e)
    }
  }
  setTimeout(() => void tick(), 5_000).unref()
  setInterval(() => void tick(), everyMs).unref()
}
