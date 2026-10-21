// Project team: memberships (project role + optional vendor company scope).
// Shared rules for the project's Owner / QA (Team page) and platform administrators (Users & access).
import { prisma } from '../db.ts'
import type { Tx } from '../db.ts'
import type { Role } from '../domain/types.ts'
import { forbidden, notFound, rule } from '../lib/http.ts'
import { securityLog } from '../lib/security.ts'
import type { Ctx } from './ctx.ts'

type Db = typeof prisma | Tx

/**
 * Every project needs at least one active Owner / QA: stage-2 sign-off, change authorisation and baselines depend on it.
 * Throws if removing `userId` from that role (on one project, or everywhere when projectId is omitted) would leave none.
 */
export async function assertOwnerQaRemains(db: Db, userId: string, projectId?: string) {
  const held = await db.membership.findMany({ where: { userId, role: 'Owner / QA', ...(projectId ? { projectId } : {}) }, include: { project: { select: { code: true } } } })
  for (const m of held) {
    const others = await db.membership.count({ where: { projectId: m.projectId, role: 'Owner / QA', userId: { not: userId }, user: { active: true } } })
    if (!others) throw rule(`${m.project.code} would have no active Owner / QA. Assign another Owner / QA first.`)
  }
}

/** A vendor scope is only for Contractor memberships and must name an active company of that project. */
export async function assertScope(db: Db, projectId: string, projectCode: string, role: Role, scope: string | null) {
  if (!scope) return
  if (role !== 'Contractor') throw rule('Only Contractor memberships can be limited to one company.')
  if (!(await db.company.findFirst({ where: { projectId, name: scope, active: true } }))) throw rule(`${scope} is not an active company in ${projectCode}'s company register.`)
}

const ownerQa = (c: Ctx) => {
  if (c.role !== 'Owner / QA') throw forbidden('Only Owner / QA manages the project team.')
}

export async function setMember(c: Ctx, userId: string, role: Role, rawScope: string | null | undefined) {
  ownerQa(c)
  const u = await c.tx.user.findUnique({ where: { id: userId } })
  if (!u) throw notFound('User not found.')
  if (!u.active) throw rule(`${u.name} is disabled. An administrator must enable the account first.`)
  const scope = rawScope?.trim() || null
  await assertScope(c.tx, c.project.id, c.project.code, role, scope)
  if (role !== 'Owner / QA') await assertOwnerQaRemains(c.tx, u.id, c.project.id)
  const before = await c.tx.membership.findUnique({ where: { userId_projectId: { userId: u.id, projectId: c.project.id } } })
  await c.tx.membership.upsert({
    where: { userId_projectId: { userId: u.id, projectId: c.project.id } },
    update: { role, companyScope: scope },
    create: { userId: u.id, projectId: c.project.id, role, companyScope: scope },
  })
  const desc = `${u.name} <${u.email}> ${before ? `changed from ${before.role}${before.companyScope ? ` (${before.companyScope})` : ''} to` : 'added as'} ${role}${scope ? ` limited to ${scope}` : ''}`
  await c.log(`Team: ${desc}`)
  await securityLog('membership.set', { email: u.email, userId: u.id, actorId: c.user.id, actorName: c.user.name, detail: `${c.project.code}: ${role}${scope ? ` (${scope})` : ''}` })
}

export async function removeMember(c: Ctx, userId: string) {
  ownerQa(c)
  const m = await c.tx.membership.findUnique({ where: { userId_projectId: { userId, projectId: c.project.id } }, include: { user: true } })
  if (!m) throw notFound('This user is not on the project team.')
  await assertOwnerQaRemains(c.tx, userId, c.project.id)
  await c.tx.membership.delete({ where: { userId_projectId: { userId, projectId: c.project.id } } })
  await c.log(`Team: ${m.user.name} <${m.user.email}> removed (was ${m.role})`)
  await securityLog('membership.removed', { email: m.user.email, userId, actorId: c.user.id, actorName: c.user.name, detail: c.project.code })
}
