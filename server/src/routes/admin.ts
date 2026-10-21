// Platform administration: users, project memberships (role + vendor scope), password resets, security log.
import bcrypt from 'bcryptjs'
import { changeList } from '../lib/audit.ts'
import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { prisma } from '../db.ts'
import { zRole } from '../domain/enums.ts'
import { notFound, rule } from '../lib/http.ts'
import { securityLog, tempPassword } from '../lib/security.ts'
import { currentUser } from '../middleware/auth.ts'
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
  res.json({ user: userView(updated) })
})

admin.post('/users/:id/reset-password', async (req, res) => {
  const u = await getUser(req.params.id as string)
  const temp = tempPassword()
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(temp, BCRYPT_COST), mustChangePassword: true, tokenVersion: { increment: 1 } } })
  await securityLog('password.reset', { email: u.email, userId: u.id, ...actor(req) })
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
