import { prisma } from '../db.ts'
import type { Tx } from '../db.ts'
import type { Project } from '../generated/prisma/client.ts'
import { forbidden, notFound, rule } from '../lib/http.ts'
import type { AuthUser } from '../middleware/auth.ts'
import type { EventCategory, Role } from '../domain/types.ts'

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
  /** Notification feed entry (Updates & automation); optionally targeted at one role. */
  notify: (category: EventCategory, text: string, doc?: string, forRole?: Role) => Promise<void>
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
      let seq: number | null = null
      const c: Ctx = {
        tx, project: fresh, user, role, scope, requestId,
        log: async (text) => {
          await tx.auditEvent.create({ data: { projectId: project.id, role, userId: user.id, userName: user.name, text, requestId } })
        },
        notify: async (category, text, doc, forRole) => {
          if (seq === null) seq = (await tx.notice.aggregate({ where: { projectId: project.id }, _max: { seq: true } }))._max.seq ?? 0
          seq += 1
          await tx.notice.create({ data: { projectId: project.id, seq, category, text, docCode: doc, forRole } })
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
