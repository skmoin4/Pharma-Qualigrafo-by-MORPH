import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { config, sessionMaxSeconds } from '../config.ts'
import { prisma } from '../db.ts'
import { HttpError, forbidden, rule, unauthorized } from '../lib/http.ts'
import { loginLimiter, securityLog } from '../lib/security.ts'
import { securityAlert } from '../services/mail.ts'

export interface AuthUser {
  id: string
  email: string
  name: string
  company: string | null
  isAdmin: boolean
  mustChangePassword: boolean
  /** E-mail notifications: Immediate | Daily digest | Off. */
  emailPref: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      requestId: string
      /** Session start (epoch seconds) carried from token to token. */
      sessionStart?: number
    }
  }
}

/**
 * Session token. `tv` (token version) must match the user's current tokenVersion, so a password change or deactivation
 * revokes old tokens. Tokens live only IDLE_TIMEOUT_MIN minutes: an active client refreshes them (POST /auth/refresh),
 * an idle one is signed out by the server too. `ss` (session start) caps the whole session at JWT_EXPIRES_IN.
 */
export function signToken(userId: string, tokenVersion: number, sessionStart = Math.floor(Date.now() / 1000)) {
  return jwt.sign({ tv: tokenVersion, ss: sessionStart }, config.JWT_SECRET, { subject: userId, expiresIn: config.IDLE_TIMEOUT_MIN * 60 })
}

export const publicUser = (u: AuthUser) => ({ id: u.id, email: u.email, name: u.name, company: u.company, isAdmin: u.isAdmin, mustChangePassword: u.mustChangePassword, emailPref: u.emailPref })

async function authenticate(req: Request) {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) throw unauthorized()
  let payload: jwt.JwtPayload
  try {
    payload = jwt.verify(h.slice(7), config.JWT_SECRET) as jwt.JwtPayload
  } catch {
    throw unauthorized('Session expired or invalid. Sign in again.')
  }
  const u = payload.sub ? await prisma.user.findUnique({ where: { id: payload.sub } }) : null
  if (!u || !u.active) throw unauthorized('Account not found or disabled.')
  if (payload.tv !== u.tokenVersion) throw unauthorized('Your session was ended (password changed or access revoked). Sign in again.')
  const start = typeof payload.ss === 'number' ? payload.ss : payload.iat ?? 0
  if (Date.now() / 1000 - start > sessionMaxSeconds) throw unauthorized('Your session reached its maximum length. Sign in again.')
  req.sessionStart = start
  req.user = { id: u.id, email: u.email, name: u.name, company: u.company, isAdmin: u.isAdmin, mustChangePassword: u.mustChangePassword, emailPref: u.emailPref }
}

/** Normal API access. Blocked while the account still has to replace a temporary password. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  await authenticate(req)
  if (req.user!.mustChangePassword) throw new HttpError(403, 'Set a new password before continuing.')
  next()
}

/** Only for /auth/me and /auth/password, which must work while a password change is pending. */
export async function requireSession(req: Request, _res: Response, next: NextFunction) {
  await authenticate(req)
  next()
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.isAdmin) throw forbidden('Administrator access required.')
  next()
}

export const currentUser = (req: Request): AuthUser => {
  if (!req.user) throw unauthorized()
  return req.user
}

/**
 * Electronic-signature re-authentication (21 CFR 11.200, Annex 11 §14): the signer enters the password again for
 * every signature. Failures are logged and count towards the same lockout as sign-in.
 */
export async function reauthenticate(req: Request, password: string | undefined, purpose: string) {
  const user = currentUser(req)
  const ip = req.ip ?? 'unknown'
  const wait = loginLimiter.blockedFor(ip, user.email)
  if (wait) {
    await securityLog('esign.locked', { email: user.email, userId: user.id, ip, detail: `${purpose}; blocked for ${wait} min` })
    throw new HttpError(429, `Too many failed attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`)
  }
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  if (!password || !(await bcrypt.compare(password, u.passwordHash))) {
    loginLimiter.fail(ip, user.email)
    await securityLog('esign.failure', { email: user.email, userId: user.id, ip, detail: purpose })
    if (loginLimiter.blockedFor(ip, user.email)) await securityAlert(user, 'Electronic signing blocked after failed password attempts', [`Electronic signing with your account was blocked for 15 minutes after repeated wrong passwords (${purpose.trim()}, address ${ip}).`, 'Nothing was signed with a wrong password.'])
    throw rule('Password is incorrect. The signature was not recorded.')
  }
  loginLimiter.succeed(ip, user.email)
}
