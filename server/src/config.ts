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
  /** E-mail delivery (SMTP). Without SMTP_HOST, e-mails are recorded in the outbox as "Not sent". */
  SMTP_HOST: z.string().trim().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  /** true = implicit TLS (port 465); false = STARTTLS when the server offers it (port 587 / 25). */
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default(''),
  /** Address of the web application, used for links in e-mails (default: the first CORS origin). */
  APP_URL: z.string().default(''),
  /** Where `npm run validation:pack` writes validation packs; listed under Administration → System & validation. */
  VALIDATION_DIR: z.string().default('validation/out'),
  /**
   * Which proxies may set X-Forwarded-For (client address for the sign-in lockout and logs): Express "trust proxy"
   * value — loopback (default, proxy on the same host), uniquelocal (proxy in a private Docker network), a hop count,
   * or a comma-separated list of addresses / subnets.
   */
  TRUST_PROXY: z.string().trim().default('loopback'),
  /** Backup sets (database dump + files + manifest). Put it on separate storage (NAS / other disk). */
  BACKUP_DIR: z.string().default('backups'),
  /** Folder of the PostgreSQL client tools (pg_dump, pg_restore) matching the server version; empty = PATH. */
  PG_BIN_DIR: z.string().default(''),
  /* Monitoring (P6). */
  /** Least severe level written to the log: debug | info | warn | error. */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** json = one JSON object per line (for a log collector); text = readable lines; auto = json in production. */
  LOG_FORMAT: z.enum(['auto', 'json', 'text']).default('auto'),
  /** Folder for daily log files (qualigrafo-YYYY-MM-DD.log) next to the console output; empty = console only. */
  LOG_DIR: z.string().default(''),
  LOG_KEEP_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  /** Token for GET /api/metrics (uptime / monitoring tools). Empty = the endpoint is switched off. */
  METRICS_TOKEN: z.string().trim().default(''),
  /** Folder of the built frontend (qualigrafo/dist) to serve alongside the API; empty = API only (Docker deployment, Vite dev server). */
  STATIC_DIR: z.string().default(''),
})

const parsed = Env.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment configuration:')
  for (const i of parsed.error.issues) console.error(`  ${i.path.join('.')}: ${i.message}`)
  process.exit(1)
}

export const config = parsed.data
if (config.SMTP_HOST && !config.MAIL_FROM) {
  console.error('Invalid environment configuration:\n  MAIL_FROM is required when SMTP_HOST is set (e.g. "Qualigrafo <qualigrafo@customer.com>")')
  process.exit(1)
}

/** TRUST_PROXY as Express expects it: a hop count, true / false, or a list of names / addresses / subnets. */
export function parseTrustProxy(v: string) {
  if (/^\d+$/.test(v)) return Number(v)
  if (v === 'true' || v === 'false') return v === 'true'
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}
export const trustProxy = parseTrustProxy(config.TRUST_PROXY)

/** LOG_FORMAT with `auto` resolved: JSON lines on a productive installation, readable lines while developing. */
export const logFormat = (): 'json' | 'text' => (config.LOG_FORMAT === 'auto' ? (config.NODE_ENV === 'production' ? 'json' : 'text') : config.LOG_FORMAT)

/** JWT_EXPIRES_IN in seconds. */
export const sessionMaxSeconds = (() => {
  const m = /^(\d+)([mhd])$/.exec(config.JWT_EXPIRES_IN)!
  return Number(m[1]) * { m: 60, h: 3600, d: 86400 }[m[2] as 'm' | 'h' | 'd']
})()
