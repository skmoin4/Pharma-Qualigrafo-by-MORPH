// Installation qualification (Phase 2 / C7): checks that an installation is complete and configured as specified.
// Run from Administration → System & validation (with a PDF record) or included in the validation pack.
// Each check states what is expected and what was found; Fail = must be corrected, Warning = review and justify.
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config.ts'
import { prisma } from '../db.ts'
import { deliveryConfigured } from './mail.ts'

export type IqStatus = 'Pass' | 'Fail' | 'Warning' | 'Info'
export interface IqCheck { id: string; title: string; expected: string; actual: string; status: IqStatus }
export interface IqResult { executedAt: string; executedBy: string; overall: 'Pass' | 'Fail'; version: string; fingerprint: string; checks: IqCheck[] }

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const pkg = JSON.parse(fs.readFileSync(path.join(SERVER, 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string> }
export const APP_VERSION = pkg.version

function walk(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'generated' && e.name !== 'node_modules') walk(p, out) } else out.push(p)
  }
  return out
}

/** SHA-256 over the application's server code, schema, migrations and lock file (sorted relative paths + contents). */
export function codeFingerprint() {
  const files = [...walk(path.join(SERVER, 'src')), ...walk(path.join(SERVER, 'prisma')), path.join(SERVER, 'package.json'), path.join(SERVER, 'package-lock.json')]
    .map((f) => path.relative(SERVER, f).split(path.sep).join('/')).sort()
  const h = createHash('sha256')
  for (const f of files) h.update(f).update('\0').update(fs.readFileSync(path.join(SERVER, f))).update('\0')
  return { sha256: h.digest('hex'), files: files.length }
}

const minMajor = (v: string) => Number(/(\d+)/.exec(v)?.[1] ?? 0)

export async function runIq(executedBy: string): Promise<IqResult> {
  const checks: IqCheck[] = []
  const add = (id: string, title: string, expected: string, actual: string, status: IqStatus) => checks.push({ id, title, expected, actual, status })
  const fp = codeFingerprint()

  add('IQ-01', 'Application version', 'Version of the release being qualified', `Qualigrafo server ${APP_VERSION}`, 'Info')
  add('IQ-02', 'Application code fingerprint', 'Equal to the fingerprint in the vendor validation pack of this release', `SHA-256 ${fp.sha256} over ${fp.files} files`, 'Info')
  const node = process.versions.node
  add('IQ-03', 'Node.js runtime', 'Node.js 22 or later', `Node.js ${node}`, minMajor(node) >= 22 ? 'Pass' : 'Fail')

  let dbOk = false
  try {
    const [{ v }] = await prisma.$queryRaw<{ v: string }[]>`SELECT current_setting('server_version') AS v`
    dbOk = true
    add('IQ-04', 'Database', 'PostgreSQL 16 or later, reachable', `PostgreSQL ${v}`, minMajor(v) >= 16 ? 'Pass' : 'Fail')
  } catch (e) {
    add('IQ-04', 'Database', 'PostgreSQL 16 or later, reachable', `Not reachable: ${e instanceof Error ? e.message : String(e)}`, 'Fail')
  }

  const shipped = fs.readdirSync(path.join(SERVER, 'prisma/migrations'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  if (dbOk) {
    const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`
    const applied = new Set(rows.filter((m) => m.finished_at && !m.rolled_back_at).map((m) => m.migration_name))
    const missing = shipped.filter((m) => !applied.has(m))
    const failed = rows.filter((m) => !m.finished_at && !m.rolled_back_at).map((m) => m.migration_name)
    add('IQ-05', 'Database schema', `All ${shipped.length} migrations of the release applied, none failed`, missing.length || failed.length ? `Missing: ${missing.join(', ') || 'none'}; failed: ${failed.join(', ') || 'none'}` : `${shipped.length} of ${shipped.length} applied (latest ${shipped.at(-1)})`, missing.length || failed.length ? 'Fail' : 'Pass')
  } else add('IQ-05', 'Database schema', `All ${shipped.length} migrations applied`, 'Not checked: database not reachable', 'Fail')

  // Installed dependencies match the lock file (the reviewed versions).
  const lock = JSON.parse(fs.readFileSync(path.join(SERVER, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string }> }
  const diffs: string[] = []
  for (const name of Object.keys(pkg.dependencies)) {
    const want = lock.packages[`node_modules/${name}`]?.version
    let have = 'missing'
    try { have = (JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`, { paths: [SERVER] }), 'utf8')) as { version: string }).version } catch { /* not resolvable via exports */ try { have = (JSON.parse(fs.readFileSync(path.join(SERVER, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version } catch { /* missing */ } }
    if (have !== want) diffs.push(`${name} ${have} (lock ${want})`)
  }
  add('IQ-06', 'Dependencies', `${Object.keys(pkg.dependencies).length} runtime packages installed exactly as in package-lock.json`, diffs.length ? diffs.join('; ') : `${Object.keys(pkg.dependencies).length} of ${Object.keys(pkg.dependencies).length} match`, diffs.length ? 'Fail' : 'Pass')

  const weakSecret = config.JWT_SECRET.length < 48 || /change-me/i.test(config.JWT_SECRET)
  add('IQ-07', 'Session secret', 'JWT_SECRET set, at least 48 random characters, not the example value', weakSecret ? `Length ${config.JWT_SECRET.length}${/change-me/i.test(config.JWT_SECRET) ? ', example value' : ''}` : `Length ${config.JWT_SECRET.length}`, weakSecret ? 'Warning' : 'Pass')
  add('IQ-08', 'Session limits', 'Inactivity timeout 1–30 minutes; absolute session length set', `Inactivity ${config.IDLE_TIMEOUT_MIN} min; absolute ${config.JWT_EXPIRES_IN}`, config.IDLE_TIMEOUT_MIN <= 30 ? 'Pass' : 'Warning')
  const pinned = process.env.CLOCK_DATE
  add('IQ-09', 'Date and time zone', 'Site time zone configured; real clock (CLOCK_DATE not set)', `APP_TIMEZONE ${config.APP_TIMEZONE}; server time ${new Date().toISOString()}${pinned ? `; CLOCK_DATE pinned to ${pinned}` : ''}`, pinned ? (config.NODE_ENV === 'production' ? 'Fail' : 'Warning') : config.APP_TIMEZONE === 'UTC' ? 'Warning' : 'Pass')
  add('IQ-10', 'Run mode', 'NODE_ENV=production on a productive installation', `NODE_ENV=${config.NODE_ENV}`, config.NODE_ENV === 'production' ? 'Pass' : 'Warning')

  // File storage: write, read back with the same hash, delete.
  const dir = path.resolve(config.STORAGE_DIR, 'tmp')
  try {
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, `iq-${randomUUID()}`)
    const data = Buffer.from(`Qualigrafo IQ ${new Date().toISOString()}`)
    fs.writeFileSync(f, data)
    const same = createHash('sha256').update(fs.readFileSync(f)).digest('hex') === createHash('sha256').update(data).digest('hex')
    fs.unlinkSync(f)
    add('IQ-11', 'File storage', 'Storage directory writable; content read back unchanged', `${path.resolve(config.STORAGE_DIR)}: write, read (SHA-256 ${same ? 'equal' : 'DIFFERENT'}), delete`, same ? 'Pass' : 'Fail')
  } catch (e) {
    add('IQ-11', 'File storage', 'Storage directory writable', `${path.resolve(config.STORAGE_DIR)}: ${e instanceof Error ? e.message : String(e)}`, 'Fail')
  }

  if (dbOk) {
    const admins = await prisma.user.count({ where: { isAdmin: true, active: true } })
    add('IQ-12', 'Administrator access', 'At least one active administrator', `${admins} active administrator(s)`, admins ? 'Pass' : 'Fail')
    const fixtures = await prisma.user.count({ where: { email: { endsWith: '@qualigrafo.test' } } })
    add('IQ-13', 'No test data', 'No test-fixture accounts (@qualigrafo.test) in a productive database', fixtures ? `${fixtures} test account(s) present` : 'None', fixtures ? (config.NODE_ENV === 'production' ? 'Fail' : 'Warning') : 'Pass')
  }
  add('IQ-14', 'E-mail delivery', 'SMTP configured (reminders, notifications, security alerts)', deliveryConfigured() ? `${config.SMTP_HOST}:${config.SMTP_PORT}, sender ${config.MAIL_FROM}` : 'Not configured: e-mails are recorded as Not sent', deliveryConfigured() ? 'Pass' : 'Warning')
  let font = false
  try { font = fs.existsSync(path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf', 'DejaVuSans.ttf')) } catch { /* missing */ }
  add('IQ-15', 'Report font', 'DejaVu Sans font available for PDF reports', font ? 'Present' : 'Missing', font ? 'Pass' : 'Fail')
  add('IQ-16', 'Upload limits', 'Maximum upload size and file types as configured', `${config.MAX_UPLOAD_MB} MB`, 'Info')

  // Backups (P3): tools usable for this database server, and a recent backup whose test restore succeeded.
  const B = await import('./backups.ts')
  const tools = await B.toolsInfo()
  add('IQ-17', 'Backup tools', 'pg_dump / pg_restore available, at least the database server version', tools.ok ? `${tools.pgDump}; server ${tools.server}` : tools.problem, tools.ok ? 'Pass' : 'Fail')
  if (dbOk) {
    const { verified, last } = await B.backupStatus()
    const ageH = verified ? (Date.now() - verified.startedAt.getTime()) / 3600_000 : null
    add('IQ-18', 'Backups', `A verified backup (test restore passed) less than 48 hours old, in ${B.backupDir()}`, verified ? `${verified.name}, ${Math.round(ageH!)} h old, verified${last?.status === 'Failed' ? `; the latest attempt ${last.name} FAILED` : ''}` : last ? `No verified backup (latest ${last.name}: ${last.status}${last.verifyStatus ? `, test restore ${last.verifyStatus}` : ''})` : 'No backup yet', verified && ageH! < 48 && last?.status !== 'Failed' ? 'Pass' : 'Warning')
  }

  // Monitoring (P6): where the log goes, whether alerts can be sent, and the state of the background jobs.
  const M = await import('./monitoring.ts')
  const t = (await import('../lib/logger.ts')).logTarget()
  add('IQ-19', 'Logging', 'Structured log (JSON on a productive installation) written to a readable destination', `Level ${t.level}, format ${t.format}, ${t.dir ? `file ${t.file}, kept ${t.keepDays} days` : 'console only (collected by the container runtime)'}${t.problem ? `; ${t.problem}` : ''}`, !t.writable ? 'Fail' : config.NODE_ENV === 'production' && t.format !== 'json' ? 'Warning' : 'Pass')
  const mon = await M.getMonitorSettings()
  add('IQ-20', 'Monitoring alerts', 'Alert e-mails switched on; metrics endpoint protected by a token when used', `Alerts ${mon.alerts ? 'on' : 'off'} (new error ${mon.onNewError ? 'on' : 'off'}, stale job ${mon.staleJobMin} min, errors/hour ${mon.errorBurst || 'off'}, free space ${mon.diskMinFreePct || 'off'} %); metrics endpoint ${config.METRICS_TOKEN ? 'on (token set)' : 'off'}`, mon.alerts ? 'Pass' : 'Warning')
  if (dbOk) {
    const jobs = await M.jobHealth()
    const bad = jobs.filter((j) => j.status !== 'Running' && j.status !== 'Never run')
    const never = jobs.filter((j) => j.status === 'Never run')
    add('IQ-21', 'Background jobs', 'E-mail delivery, reminders, backups and the watchdog have run recently', jobs.map((j) => `${j.name} ${j.status.toLowerCase()}${j.ageMin === null ? '' : ` (${j.ageMin} min ago)`}`).join('; '), bad.length ? 'Fail' : never.length ? 'Warning' : 'Pass')
    const free = (await M.healthSnapshot()).storage
    add('IQ-22', 'Free space', `More than ${mon.diskMinFreePct || 10} % free space on the file storage`, free.freePct === null ? 'Not readable on this platform' : `${free.freePct} % free of ${Math.round((free.total ?? 0) / 1073741824)} GB (${path.resolve(config.STORAGE_DIR)})`, free.freePct === null ? 'Info' : free.freePct < (mon.diskMinFreePct || 10) ? 'Warning' : 'Pass')
  }

  return { executedAt: new Date().toISOString(), executedBy, overall: checks.some((c) => c.status === 'Fail') ? 'Fail' : 'Pass', version: APP_VERSION, fingerprint: fp.sha256, checks }
}
