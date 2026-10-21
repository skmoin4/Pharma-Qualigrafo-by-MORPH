import type { NextFunction, Request, Response } from 'express'
import { randomInt } from 'node:crypto'
import { prisma } from '../db.ts'

/* ------------------------------------------------------------ password policy */

export const PASSWORD_RULE = 'At least 10 characters, with at least one letter and one number.'

export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < 10) return `Password is too short. ${PASSWORD_RULE}`
  if (pw.length > 200) return 'Password is too long (max 200 characters).'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return `Password is too weak. ${PASSWORD_RULE}`
  if (email && pw.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'Password must not contain your email name.'
  return null
}

/** Readable temporary password for admin resets (no ambiguous characters). */
export function tempPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ'
  const d = '23456789'
  const pick = (s: string, n: number) => Array.from({ length: n }, () => s[randomInt(s.length)]).join('')
  return `${pick(a, 5)}-${pick(d, 4)}-${pick(a, 4)}`
}

/* ------------------------------------------------------------ sign-in limiter */

const WINDOW_MS = 15 * 60_000
const MAX_PER_ACCOUNT = 5
const MAX_PER_IP = 20
interface Bucket { count: number; first: number }
const byAccount = new Map<string, Bucket>()
const byIp = new Map<string, Bucket>()

const live = (m: Map<string, Bucket>, k: string, now: number) => {
  const b = m.get(k)
  if (b && now - b.first > WINDOW_MS) { m.delete(k); return undefined }
  return b
}

/**
 * Counts failed sign-ins per (IP, email) and per IP within a 15-minute window.
 * In-memory: correct for a single API process; use a shared store (Redis) when running several instances.
 */
export const loginLimiter = {
  /** Minutes until the caller may try again, or 0 when allowed. */
  blockedFor(ip: string, email: string, now = Date.now()) {
    const a = live(byAccount, `${ip}|${email}`, now)
    const i = live(byIp, ip, now)
    const until = Math.max(a && a.count >= MAX_PER_ACCOUNT ? a.first + WINDOW_MS : 0, i && i.count >= MAX_PER_IP ? i.first + WINDOW_MS : 0)
    return until > now ? Math.ceil((until - now) / 60_000) : 0
  },
  fail(ip: string, email: string, now = Date.now()) {
    for (const [m, k] of [[byAccount, `${ip}|${email}`], [byIp, ip]] as const) {
      const b = live(m, k, now)
      if (b) b.count += 1
      else m.set(k, { count: 1, first: now })
    }
  },
  succeed(ip: string, email: string) {
    byAccount.delete(`${ip}|${email}`)
  },
  reset() { byAccount.clear(); byIp.clear() },
}

/* ------------------------------------------------------------ general API rate limit */

const hits = new Map<string, Bucket>()
/** Coarse per-IP ceiling for the whole API (protects against runaway clients and scraping). */
export function apiRateLimit(limitPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const k = req.ip ?? 'unknown'
    const b = hits.get(k)
    if (!b || now - b.first > 60_000) { hits.set(k, { count: 1, first: now }); return next() }
    b.count += 1
    if (b.count > limitPerMinute) {
      res.setHeader('Retry-After', String(Math.ceil((b.first + 60_000 - now) / 1000)))
      return res.status(429).json({ error: 'Too many requests. Slow down and try again shortly.' })
    }
    next()
  }
}

/** Drop expired buckets so long-running processes do not accumulate one entry per IP / email forever. */
setInterval(() => {
  const now = Date.now()
  for (const m of [byAccount, byIp]) for (const [k, b] of m) if (now - b.first > WINDOW_MS) m.delete(k)
  for (const [k, b] of hits) if (now - b.first > 60_000) hits.delete(k)
}, 5 * 60_000).unref()

/* ------------------------------------------------------------ security log */

export type SecurityType =
  | 'login.success' | 'login.failure' | 'login.locked'
  | 'password.changed' | 'password.reset'
  | 'user.created' | 'user.updated' | 'user.deactivated' | 'user.activated'
  | 'membership.set' | 'membership.removed'
  | 'library.draft' | 'library.edit' | 'library.import' | 'library.approved' | 'library.discarded'
  | 'esign.signed' | 'esign.failure' | 'esign.locked'

export async function securityLog(type: SecurityType, e: { email?: string; userId?: string; actorId?: string; actorName?: string; ip?: string; detail?: string }) {
  await prisma.securityEvent.create({ data: { type, ...e, detail: e.detail ?? '' } })
}
