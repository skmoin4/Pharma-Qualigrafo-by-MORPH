import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.ts'
import { HttpError, rule, unauthorized } from '../lib/http.ts'
import { loginLimiter, passwordProblem, securityLog } from '../lib/security.ts'
import { config } from '../config.ts'
import { currentUser, publicUser, requireSession, signToken } from '../middleware/auth.ts'
import { canCreateProjects } from '../services/projects.ts'

/** Session user plus capabilities the UI needs to show or hide entry points. */
const sessionUser = async (u: Parameters<typeof publicUser>[0]) => ({ ...publicUser(u), canCreateProjects: await canCreateProjects(u) })

export const auth = Router()

// Constant-cost dummy hash so unknown emails take as long as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)
export const BCRYPT_COST = 10

auth.post('/login', async (req, res) => {
  const body = z.object({ email: z.email(), password: z.string().min(1).max(200) }).parse(req.body ?? {})
  const email = body.email.toLowerCase()
  const ip = req.ip ?? 'unknown'
  const wait = loginLimiter.blockedFor(ip, email)
  if (wait) {
    await securityLog('login.locked', { email, ip, detail: `blocked for ${wait} min` })
    res.setHeader('Retry-After', String(wait * 60))
    throw new HttpError(429, `Too many failed sign-in attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`)
  }
  const u = await prisma.user.findUnique({ where: { email } })
  const ok = await bcrypt.compare(body.password, u?.passwordHash ?? DUMMY_HASH)
  if (!u || !ok || !u.active) {
    loginLimiter.fail(ip, email)
    await securityLog('login.failure', { email, userId: u?.id, ip, detail: !u ? 'unknown account' : !u.active ? 'account disabled' : 'wrong password' })
    throw unauthorized('Email or password is incorrect.')
  }
  loginLimiter.succeed(ip, email)
  await prisma.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } })
  await securityLog('login.success', { email, userId: u.id, ip })
  res.json({ token: signToken(u.id, u.tokenVersion), user: await sessionUser(u) })
})

auth.get('/me', requireSession, async (req, res) => {
  const user = currentUser(req)
  const ms = await prisma.membership.findMany({ where: { userId: user.id }, include: { project: { select: { code: true, name: true } } }, orderBy: { project: { code: 'asc' } } })
  res.json({ user: await sessionUser(user), memberships: ms.map((m) => ({ project: m.project.code, name: m.project.name, role: m.role, scope: m.companyScope })) })
})

/** Change own password. Signs the account out everywhere else and returns a fresh token for this session. */
auth.post('/password', requireSession, async (req, res) => {
  const user = currentUser(req)
  const b = z.object({ current: z.string().min(1).max(200), next: z.string().max(200) }).parse(req.body ?? {})
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  if (!(await bcrypt.compare(b.current, u.passwordHash))) throw rule('Current password is incorrect.')
  const problem = passwordProblem(b.next, u.email)
  if (problem) throw rule(problem)
  if (await bcrypt.compare(b.next, u.passwordHash)) throw rule('Choose a password different from the current one.')
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: { passwordHash: await bcrypt.hash(b.next, BCRYPT_COST), tokenVersion: { increment: 1 }, mustChangePassword: false, passwordChangedAt: new Date() },
  })
  await securityLog('password.changed', { email: u.email, userId: u.id, actorId: u.id, actorName: u.name, ip: req.ip })
  res.json({ token: signToken(updated.id, updated.tokenVersion, req.sessionStart), user: await sessionUser(updated) })
})

/** Extend an active session by another idle period (never past the absolute session length). */
auth.post('/refresh', requireSession, async (req, res) => {
  const u = currentUser(req)
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
  res.json({ token: signToken(fresh.id, fresh.tokenVersion, req.sessionStart), idleMinutes: config.IDLE_TIMEOUT_MIN })
})
