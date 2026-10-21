import 'dotenv/config'
import { z } from 'zod'

const Env = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** Absolute session length (e.g. 12h): refreshing never extends a session beyond it. */
  JWT_EXPIRES_IN: z.string().regex(/^\d+[mhd]$/, 'JWT_EXPIRES_IN must look like 30m, 12h or 1d').default('12h'),
  /** Inactivity timeout in minutes (Annex 11 §12): a token not refreshed within this time expires. */
  IDLE_TIMEOUT_MIN: z.coerce.number().int().min(1).max(240).default(15),
  PORT: z.coerce.number().int().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.string().default('development'),
  STORAGE_DIR: z.string().default('storage'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2048).default(50),
  /** IANA time zone of the customer site, e.g. Asia/Riyadh or Asia/Kolkata; decides what "today" and "overdue" mean. */
  APP_TIMEZONE: z.string().default('UTC').refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false } }, 'APP_TIMEZONE must be a valid IANA time zone'),
})

const parsed = Env.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment configuration:')
  for (const i of parsed.error.issues) console.error(`  ${i.path.join('.')}: ${i.message}`)
  process.exit(1)
}

export const config = parsed.data

/** JWT_EXPIRES_IN in seconds. */
export const sessionMaxSeconds = (() => {
  const m = /^(\d+)([mhd])$/.exec(config.JWT_EXPIRES_IN)!
  return Number(m[1]) * { m: 60, h: 3600, d: 86400 }[m[2] as 'm' | 'h' | 'd']
})()
