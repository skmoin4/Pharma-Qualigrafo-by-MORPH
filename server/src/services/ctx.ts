import { prisma } from '../db.ts'
import type { Tx } from '../db.ts'
import type { Project } from '../generated/prisma/client.ts'
import { forbidden, notFound, rule } from '../lib/http.ts'
import type { AuthUser } from '../middleware/auth.ts'
import type { EventCategory, Role } from '../domain/types.ts'
import { appLink, clip, prefFooter, queueEmail } from './mail.ts'

export interface NotifyOpts {
  /** Company the notice concerns when it has no document (e.g. a transmittal): vendor accounts of it get the e-mail. */
  company?: string
  /** Page the e-mail links to (default: documents for a document notice, otherwise updates & automation). */
  page?: string
  /** false = in-app only (the caller sends its own consolidated e-mail). */
  email?: boolean
}

export interface Ctx {
  tx: Tx
  project: Project
  user: AuthUser
  role: Role
  /** Company a vendor-scoped Contractor is limited to; null = whole project. */
  scope: string | null
  requestId: string
  /** Append-only audit entry, attributed to the authenticated user and their project role. */
  log: (text: string) => Promise<void>
  /**
   * Notification feed entry (Updates & automation); optionally targeted at one role. A targeted notice is also
   * e-mailed to that role's members whose notifications are "Immediate" (not to the person acting).
   */
  notify: (category: EventCategory, text: string, doc?: string, forRole?: Role, opts?: NotifyOpts) => Promise<void>
}

/** Appends a notice to a project's feed (sequence number per project). */
export async function addNotice(tx: Tx, projectId: string, category: string, text: string, doc?: string | null, forRole?: string | null) {
  const seq = ((await tx.notice.aggregate({ where: { projectId }, _max: { seq: true } }))._max.seq ?? 0) + 1
  return tx.notice.create({ data: { projectId, seq, category, text, docCode: doc ?? null, forRole: forRole ?? null } })
}

/** E-mails a role-targeted notice to the members of that role (vendor accounts only for their own company's records). */
async function emailNotice(tx: Tx, project: Project, actorId: string, category: string, text: string, forRole: Role, doc?: string, opts: NotifyOpts = {}) {
  const ms = await tx.membership.findMany({ where: { projectId: project.id, role: forRole, userId: { not: actorId }, user: { active: true, emailPref: 'Immediate' } }, include: { user: true } })
  if (!ms.length) return
  const company = opts.company ?? (doc && ms.some((m) => m.companyScope) ? (await tx.document.findUnique({ where: { projectId_code: { projectId: project.id, code: doc } }, select: { owner: true } }))?.owner : undefined)
  const page = opts.page ?? (category === 'Reminder' ? 'reviews' : doc ? 'documents' : 'activity')
  for (const m of ms) {
    if (m.companyScope && m.companyScope !== company) continue
    const body = [
      `Hello ${m.user.name},`, '', text, '',
      `Project: ${project.code} — ${project.name}`,
      `Your role: ${m.role}${m.companyScope ? ` (records of ${m.companyScope})` : ''}`,
      `Open in Qualigrafo: ${appLink(project.code, page)}`,
      '', '—', prefFooter('Immediate'),
    ].join('\n')
    await queueEmail(tx, category === 'Reminder' ? 'Reminder' : 'Assignment', m.user, `[${project.code}] ${clip(text, 110)}`, body, project.code)
  }
}


export async function membership(projectCode: string, userId: string) {
  const project = await prisma.project.findUnique({ where: { code: projectCode } })
  if (!project) throw notFound(`Project ${projectCode} not found.`)
  const m = await prisma.membership.findUnique({ where: { userId_projectId: { userId, projectId: project.id } } })
  if (!m) throw forbidden('You are not a member of this project.')
  return { project, role: m.role as Role, scope: m.companyScope }
}

/**
 * Runs one workflow action atomically. A per-project advisory lock serialises writers,
 * so read-check-write rules (sign stages, code numbering, duplicate checks) cannot race.
 */
export async function inProject(projectCode: string, user: AuthUser, requestId: string, fn: (c: Ctx) => Promise<void>, opts: { allowArchived?: boolean } = {}) {
  const { project, role, scope } = await membership(projectCode, user.id)
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${project.id}))::text AS locked`
      const fresh = await tx.project.findUniqueOrThrow({ where: { id: project.id } })
      // Archived projects are read-only: every change is refused except restoring them (and personal read markers).
      if (fresh.status === 'Archived' && !opts.allowArchived) throw rule(`${fresh.code} is archived and read-only. Owner / QA can restore it under Setup.`)
      const c: Ctx = {
        tx, project: fresh, user, role, scope, requestId,
        log: async (text) => {
          await tx.auditEvent.create({ data: { projectId: project.id, role, userId: user.id, userName: user.name, text, requestId } })
        },
        notify: async (category, text, doc, forRole, opts) => {
          await addNotice(tx, project.id, category, text, doc, forRole)
          if (forRole && opts?.email !== false) await emailNotice(tx, fresh, user.id, category, text, forRole, doc, opts)
        },
      }
      await fn(c)
    },
    { timeout: 15_000 },
  )
  return project.id
}

/** Next human code: DOC-013, RFI-003 ... (max existing number + 1, zero-padded). */
export function nextCode(prefix: string, codes: { code: string }[], width = 3) {
  const max = codes.reduce((m, { code }) => Math.max(m, Number(code.slice(code.lastIndexOf('-') + 1)) || 0), 0)
  return `${prefix}-${String(max + 1).padStart(width, '0')}`
}

const key = (c: Ctx, code: string) => ({ projectId_code: { projectId: c.project.id, code } })

/** Vendor-scoped users only ever see their own company's documents; others are reported as not found. */
export async function getDoc(c: Ctx, code: string) {
  const d = await c.tx.document.findUnique({ where: key(c, code) })
  if (!d || (c.scope && d.owner !== c.scope)) throw notFound(`Document ${code} not found.`)
  return d
}
export async function getReq(c: Ctx, code: string) {
  const r = await c.tx.requirement.findUnique({ where: key(c, code) })
  if (!r) throw notFound(`Requirement ${code} not found.`)
  return r
}
export async function getOr404<T>(p: Promise<T | null>, what: string): Promise<T> {
  const v = await p
  if (!v) throw notFound(`${what} not found.`)
  return v
}
export { key as codeKey }
