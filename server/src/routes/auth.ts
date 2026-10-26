import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.ts'
import { HttpError, rule, unauthorized } from '../lib/http.ts'
import { loginLimiter, passwordProblem, securityLog } from '../lib/security.ts'
import { EMAIL_PREFS, securityAlert } from '../services/mail.ts'
import { changeList } from '../lib/audit.ts'
import { config, sessionMaxSeconds } from '../config.ts'
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
    // Alert the account holder once, when the failure that triggers the lockout happens.
    if (u?.active && loginLimiter.blockedFor(ip, email)) await securityAlert(u, 'Sign-in blocked after failed attempts', [`Sign-in to your account was blocked for 15 minutes after repeated wrong passwords from address ${ip}.`, 'If this was you, wait and try again, or ask your administrator to reset your password.'])
    throw unauthorized('Email or password is incorrect.')
  }
  loginLimiter.succeed(ip, email)
  await prisma.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } })
  await securityLog('login.success', { email, userId: u.id, ip })
  res.json({ token: signToken(u.id, u.tokenVersion), user: await sessionUser(u) })
})

auth.get('/me', requireSession, async (req, res) => {
  const user = currentUser(req)
  const [ms, row] = await Promise.all([
    prisma.membership.findMany({ where: { userId: user.id }, include: { project: { select: { code: true, name: true } } }, orderBy: { project: { code: 'asc' } } }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { createdAt: true, lastLoginAt: true, passwordChangedAt: true } }),
  ])
  res.json({
    user: await sessionUser(user),
    memberships: ms.map((m) => ({ project: m.project.code, name: m.project.name, role: m.role, scope: m.companyScope })),
    // Facts about the account itself, for the personal profile page. The account record is maintained by an
    // administrator (Users & access); a person can change their password and their notification preference.
    account: {
      createdAt: row.createdAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      passwordChangedAt: row.passwordChangedAt?.toISOString() ?? null,
      idleMinutes: config.IDLE_TIMEOUT_MIN,
      sessionMaxHours: Math.round(sessionMaxSeconds / 3600),
    },
  })
})

/** What this account did lately: its own security events and the audit entries it wrote, newest first. */
auth.get('/activity', requireSession, async (req, res) => {
  const user = currentUser(req)
  const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query)
  const [sec, work] = await Promise.all([
    prisma.securityEvent.findMany({ where: { OR: [{ userId: user.id }, { actorId: user.id }] }, orderBy: { id: 'desc' }, take: q.limit }),
    prisma.auditEvent.findMany({ where: { userId: user.id }, orderBy: { at: 'desc' }, take: q.limit, include: { project: { select: { code: true } } } }),
  ])
  const items = [
    ...sec.map((e) => ({ at: e.at.toISOString(), kind: 'Account' as const, what: e.type, detail: e.detail, project: null as string | null, ip: e.ip })),
    ...work.map((e) => ({ at: e.at.toISOString(), kind: 'Project' as const, what: e.role, detail: e.text, project: e.project.code, ip: null as string | null })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, q.limit)
  res.json({ items })
})

/**
 * Sign out of every device, including this one: the token version is bumped, so every token issued so far is
 * refused. Used when a laptop is lost or a session was left open somewhere.
 */
auth.post('/sign-out-everywhere', requireSession, async (req, res) => {
  const user = currentUser(req)
  const u = await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } })
  await securityLog('sessions.revoked', { email: u.email, userId: u.id, actorId: u.id, actorName: u.name, ip: req.ip, detail: 'Signed out of all devices by the account holder' })
  await securityAlert(u, 'Signed out of all devices', [`All Qualigrafo sessions of your account (${u.email}) were signed out from address ${req.ip ?? 'unknown'}.`, 'Sign in again with your password to continue.'])
  res.json({ ok: true })
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
  await securityAlert(u, 'Your password was changed', [`The password of your Qualigrafo account (${u.email}) was changed from address ${req.ip ?? 'unknown'}.`, 'All your other sessions were signed out.'])
  res.json({ token: signToken(updated.id, updated.tokenVersion, req.sessionStart), user: await sessionUser(updated) })
})

/** Extend an active session by another idle period (never past the absolute session length). */
auth.post('/refresh', requireSession, async (req, res) => {
  const u = currentUser(req)
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
  res.json({ token: signToken(fresh.id, fresh.tokenVersion, req.sessionStart), idleMinutes: config.IDLE_TIMEOUT_MIN })
})

/** Own e-mail notification preference: Immediate (each item addressed to my role), Daily digest, or Off. */
auth.put('/preferences', requireSession, async (req, res) => {
  const user = currentUser(req)
  const b = z.object({ emailPref: z.enum(EMAIL_PREFS) }).parse(req.body ?? {})
  const updated = await prisma.user.update({ where: { id: user.id }, data: { emailPref: b.emailPref, ...(b.emailPref === 'Daily digest' && user.emailPref !== 'Daily digest' ? { lastDigestAt: new Date() } : {}) } })
  const changes = changeList([['e-mail notifications', user.emailPref, b.emailPref]])
  if (changes.length) await securityLog('user.updated', { email: user.email, userId: user.id, actorId: user.id, actorName: user.name, ip: req.ip, detail: changes.join('; ') })
  res.json({ user: await sessionUser(updated) })
})
