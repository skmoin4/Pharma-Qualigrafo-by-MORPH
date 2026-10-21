import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config.ts'
import { prisma } from '../db.ts'
import { HttpError, forbidden, unauthorized } from '../lib/http.ts'

export interface AuthUser {
  id: string
  email: string
  name: string
  company: string | null
  isAdmin: boolean
  mustChangePassword: boolean
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      requestId: string
    }
  }
}

/** `tv` (token version) must match the user's current tokenVersion, so a password change or deactivation revokes old tokens. */
export function signToken(userId: string, tokenVersion: number) {
  return jwt.sign({ tv: tokenVersion }, config.JWT_SECRET, { subject: userId, expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] })
}

export const publicUser = (u: AuthUser) => ({ id: u.id, email: u.email, name: u.name, company: u.company, isAdmin: u.isAdmin, mustChangePassword: u.mustChangePassword })

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
  req.user = { id: u.id, email: u.email, name: u.name, company: u.company, isAdmin: u.isAdmin, mustChangePassword: u.mustChangePassword }
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
