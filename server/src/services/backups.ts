// Backups with a tested restore (Phase 3 / P3; EU GMP Annex 11 §7.2).
// A backup set is a folder in BACKUP_DIR (qualigrafo-YYYYMMDD-HHMMSS-mmm, UTC):  database.dump (pg_dump custom format) · files/<aa>/<sha256> (stored files,
// content-addressed; unchanged files are hard-linked to the previous set) · manifest.json (+ manifest.sha256).
// Consistency: the record counts in the manifest and the dump come from one database snapshot (pg_export_snapshot);
// files are copied after the dump — an object is written before any record refers to it and is never changed, so
// every file the dump refers to exists. Verification restores the dump into a temporary database and compares counts,
// migrations and every file hash, then drops it. Restore (disaster recovery) is a CLI: npm run backup:restore.
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { z } from 'zod'
import { config } from '../config.ts'
import { prisma } from '../db.ts'
import { today } from '../domain/rules.ts'
import { changeList } from '../lib/audit.ts'
import { codeFingerprint, APP_VERSION } from './iq.ts'
import { appLink, prefFooter, queueEmail } from './mail.ts'
import { localTime } from './reminders.ts'

/* ------------------------------------------------------------ settings */

export const zBackupSettings = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24-hour).'),
  keep: z.number().int().min(3, 'Keep 3–90 backups.').max(90, 'Keep 3–90 backups.'),
  verify: z.boolean(),
})
export type BackupSettings = z.infer<typeof zBackupSettings>
const DEFAULTS: BackupSettings = { enabled: true, time: '02:00', keep: 14, verify: true }
const KEY = 'backups'

export async function getBackupSettings(): Promise<BackupSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } })
  return { ...DEFAULTS, ...((row?.value as Partial<BackupSettings> | undefined) ?? {}) }
}
export async function setBackupSettings(next: BackupSettings, by: string) {
  const old = await getBackupSettings()
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value: next, updatedBy: by }, create: { key: KEY, value: next, updatedBy: by } })
  return changeList([['scheduled backups', old.enabled ? 'on' : 'off', next.enabled ? 'on' : 'off'], ['time', old.time, next.time], ['keep', old.keep, next.keep], ['test restore after each backup', old.verify ? 'on' : 'off', next.verify ? 'on' : 'off']])
}

/* ------------------------------------------------------------ tools */

export const backupDir = () => path.resolve(config.BACKUP_DIR)
const storageObjects = (storageDir = config.STORAGE_DIR) => path.join(path.resolve(storageDir), 'objects')

/** pg_dump / pg_restore: PG_BIN_DIR, else on Windows the newest PostgreSQL install, else PATH. */
export function pgTool(name: 'pg_dump' | 'pg_restore') {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  if (config.PG_BIN_DIR) return path.join(config.PG_BIN_DIR, exe)
  if (process.platform === 'win32') {
    const root = 'C:/Program Files/PostgreSQL'
    const v = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^\d+$/.test(d)).sort((a, b) => Number(b) - Number(a))[0] : undefined
    if (v && fs.existsSync(path.join(root, v, 'bin', exe))) return path.join(root, v, 'bin', exe)
  }
  return exe
}

function exec(cmd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env } })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { out += d })
    p.on('error', (e) => reject(new Error(`${path.basename(cmd)} could not be started: ${e.message}. Install the PostgreSQL client tools or set PG_BIN_DIR.`)))
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} failed (exit ${code}): ${out.trim().slice(-600)}`))))
  })
}

/** Connection settings for libpq tools: the URL without Prisma's ?schema= parameter. */
export function libpqUrl(url = config.DATABASE_URL, database?: string) {
  const u = new URL(url)
  u.searchParams.delete('schema')
  if (database) u.pathname = `/${database}`
  return u.toString()
}

export async function toolsInfo() {
  const info = { pgDump: '', pgRestore: '', server: '', ok: false, problem: '' }
  try {
    info.pgDump = (await exec(pgTool('pg_dump'), ['--version'])).trim()
    info.pgRestore = (await exec(pgTool('pg_restore'), ['--version'])).trim()
    const [{ v }] = await prisma.$queryRaw<{ v: string }[]>`SELECT current_setting('server_version') AS v`
    info.server = v
    const major = (s: string) => Number(/(\d+)/.exec(s.replace(/^[^\d]*/, ''))?.[1] ?? 0)
    info.ok = major(info.pgDump.split(')').pop() ?? '') >= major(v)
    if (!info.ok) info.problem = `pg_dump ${info.pgDump} is older than the database server ${v}.`
  } catch (e) {
    info.problem = e instanceof Error ? e.message : String(e)
  }
  return info
}

/* ------------------------------------------------------------ helpers */

const sha256File = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const COUNT_TABLES = ['User', 'Project', 'Document', 'Requirement', 'AuditEvent', 'SecurityEvent', 'StoredFile', 'DocSignature', 'EmailMessage'] as const
type Counts = Record<string, number>

async function countAll(c: pg.Client): Promise<Counts> {
  const counts: Counts = {}
  for (const t of COUNT_TABLES) counts[t] = Number((await c.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n)
  return counts
}
async function migrationsOf(c: pg.Client) {
  return (await c.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`)).rows.map((r) => r.migration_name as string)
}
function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]))
}
const dirSize = (dir: string) => walkFiles(dir).reduce((n, f) => n + fs.statSync(f).size, 0)

export interface Manifest {
  format: 1
  name: string
  createdAt: string
  appVersion: string
  codeFingerprint: string
  migrations: string[]
  counts: Counts
  database: { file: 'database.dump'; sha256: string; bytes: number }
  files: { count: number; bytes: number; sha256: string }
}

/* ------------------------------------------------------------ backup */

let busy: string | null = null
export const backupBusy = () => busy

export async function createBackup(o: { trigger: 'Scheduled' | 'Manual'; startedBy?: string; slot?: string }) {
  if (busy) throw new Error(`A ${busy} is already running.`)
  const now = new Date()
  const name = `qualigrafo-${now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').slice(0, 19)}`
  let run
  try {
    run = await prisma.backupRun.create({ data: { name, trigger: o.trigger, slot: o.slot ?? null, startedBy: o.startedBy ?? null } })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return null
    throw e
  }
  busy = 'backup'
  const dir = path.join(backupDir(), name)
  try {
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true })
    // 1. database: dump and counts from one snapshot
    const c = new pg.Client({ connectionString: libpqUrl() })
    await c.connect()
    let counts: Counts
    let migrations: string[]
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const snap = (await c.query('SELECT pg_export_snapshot() AS s')).rows[0].s as string
      counts = await countAll(c)
      migrations = await migrationsOf(c)
      await exec(pgTool('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', `--snapshot=${snap}`, `--file=${path.join(dir, 'database.dump')}`, `--dbname=${libpqUrl()}`])
      await c.query('COMMIT')
    } finally {
      await c.end()
    }
    // 2. files: content-addressed; hard-link unchanged objects from the previous set
    const prev = await prisma.backupRun.findFirst({ where: { status: 'Done', id: { not: run.id } }, orderBy: { startedAt: 'desc' } })
    const prevFiles = prev ? path.join(backupDir(), prev.name, 'files') : null
    const fh = createHash('sha256')
    let count = 0
    let bytes = 0
    for (const src of walkFiles(storageObjects()).sort()) {
      const sha = path.basename(src)
      if (!/^[0-9a-f]{64}$/.test(sha)) continue
      const rel = path.join(sha.slice(0, 2), sha)
      const dst = path.join(dir, 'files', rel)
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      const old = prevFiles && path.join(prevFiles, rel)
      try { if (old && fs.existsSync(old)) fs.linkSync(old, dst); else fs.copyFileSync(src, dst) } catch { fs.copyFileSync(src, dst) }
      fh.update(sha)
      count++
      bytes += fs.statSync(dst).size
    }
    // 3. manifest
    const dump = path.join(dir, 'database.dump')
    const manifest: Manifest = {
      format: 1, name, createdAt: now.toISOString(), appVersion: APP_VERSION, codeFingerprint: codeFingerprint().sha256, migrations, counts,
      database: { file: 'database.dump', sha256: sha256File(dump), bytes: fs.statSync(dump).size },
      files: { count, bytes, sha256: fh.digest('hex') },
    }
    const text = JSON.stringify(manifest, null, 2)
    fs.writeFileSync(path.join(dir, 'manifest.json'), text)
    const manifestSha = createHash('sha256').update(text).digest('hex')
    fs.writeFileSync(path.join(dir, 'manifest.sha256'), `${manifestSha}  manifest.json\n`)
    const done = await prisma.backupRun.update({ where: { id: run.id }, data: { status: 'Done', finishedAt: new Date(), sizeBytes: BigInt(dirSize(dir)), files: count, manifestSha } })
    busy = null
    await applyRetention()
    return done
  } catch (e) {
    busy = null
    const msg = e instanceof Error ? e.message : String(e)
    await prisma.backupRun.update({ where: { id: run.id }, data: { status: 'Failed', finishedAt: new Date(), error: msg.slice(0, 1000) } })
    fs.rmSync(dir, { recursive: true, force: true })
    await alertAdmins(`Backup ${name} FAILED`, [`The backup ${name} failed: ${msg.slice(0, 400)}`, 'Check the server log and the backup settings (Users & access → Backups).'])
    throw e
  }
}

/** Keeps the newest `keep` completed sets; never removes the newest verified one. */
export async function applyRetention() {
  const { keep } = await getBackupSettings()
  const done = await prisma.backupRun.findMany({ where: { status: 'Done' }, orderBy: { startedAt: 'desc' } })
  const newestVerified = done.find((r) => r.verifyStatus === 'Verified')
  for (const r of done.slice(keep)) {
    if (r.id === newestVerified?.id) continue
    fs.rmSync(path.join(backupDir(), r.name), { recursive: true, force: true })
    await prisma.backupRun.update({ where: { id: r.id }, data: { status: 'Deleted' } })
  }
}

/* ------------------------------------------------------------ verification (test restore) */

/** Checks manifest and file hashes; returns the manifest. Throws with the first problem. */
export function checkSet(dir: string): Manifest {
  const text = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')
  const expected = fs.readFileSync(path.join(dir, 'manifest.sha256'), 'utf8').split(/\s+/)[0]
  if (createHash('sha256').update(text).digest('hex') !== expected) throw new Error('manifest.json does not match manifest.sha256 (changed after the backup).')
  const m = JSON.parse(text) as Manifest
  if (sha256File(path.join(dir, m.database.file)) !== m.database.sha256) throw new Error('database.dump is damaged (SHA-256 differs from the manifest).')
  const files = walkFiles(path.join(dir, 'files'))
  if (files.length !== m.files.count) throw new Error(`File count ${files.length} differs from the manifest (${m.files.count}).`)
  for (const f of files) if (sha256File(f) !== path.basename(f)) throw new Error(`Stored file ${path.basename(f)} is damaged.`)
  return m
}

async function adminClient(url: string) {
  const c = new pg.Client({ connectionString: libpqUrl(url, 'postgres') })
  await c.connect()
  return c
}

/** Restores the dump into `targetUrl` (an empty database) and checks it against the manifest. */
async function restoreAndCompare(dir: string, m: Manifest, targetUrl: string, clean: boolean) {
  await exec(pgTool('pg_restore'), ['--no-owner', '--no-privileges', '--exit-on-error', ...(clean ? ['--clean', '--if-exists'] : []), `--dbname=${libpqUrl(targetUrl)}`, path.join(dir, m.database.file)])
  const c = new pg.Client({ connectionString: libpqUrl(targetUrl) })
  await c.connect()
  try {
    const counts = await countAll(c)
    const diff = Object.keys(m.counts).filter((k) => counts[k] !== m.counts[k])
    if (diff.length) throw new Error(`Restored counts differ: ${diff.map((k) => `${k} ${counts[k]} (backup ${m.counts[k]})`).join(', ')}.`)
    const migrations = await migrationsOf(c)
    if (migrations.join() !== m.migrations.join()) throw new Error('Restored migration history differs from the manifest.')
    const shas = (await c.query('SELECT sha256 FROM "StoredFile"')).rows.map((r) => r.sha256 as string)
    const missing = shas.filter((s) => !fs.existsSync(path.join(dir, 'files', s.slice(0, 2), s)))
    if (missing.length) throw new Error(`${missing.length} file(s) referenced by the database are missing from the set.`)
    return { counts, files: shas.length }
  } finally {
    await c.end()
  }
}

export async function verifyBackup(id: string, by?: string) {
  if (busy) throw new Error(`A ${busy} is already running.`)
  const r = await prisma.backupRun.findUnique({ where: { id } })
  if (!r || r.status !== 'Done') throw new Error('Only a completed backup can be verified.')
  busy = 'verification'
  await prisma.backupRun.update({ where: { id }, data: { verifyStatus: 'Running', verifyDetail: null } })
  const dir = path.join(backupDir(), r.name)
  const temp = `qualigrafo_verify_${randomBytes(4).toString('hex')}`
  const admin = await adminClient(config.DATABASE_URL)
  try {
    const m = checkSet(dir)
    // A verification that was interrupted (process killed) leaves its temporary database behind. Only one
    // verification runs at a time, so anything left over here is ours and can go.
    for (const r of (await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'qualigrafo_verify_%'")).rows) {
      await admin.query(`DROP DATABASE IF EXISTS "${r.datname as string}" WITH (FORCE)`).catch(() => undefined)
    }
    await admin.query(`CREATE DATABASE "${temp}"`)
    const res = await restoreAndCompare(dir, m, libpqUrl(config.DATABASE_URL, temp), false)
    const detail = `Test restore into a temporary database: ${Object.entries(res.counts).map(([k, v]) => `${k} ${v}`).join(', ')}; ${m.migrations.length} migrations; ${m.files.count} files, every SHA-256 checked; ${res.files} file reference(s) resolved.${by ? ` Run by ${by}.` : ''}`
    return await prisma.backupRun.update({ where: { id }, data: { verifyStatus: 'Verified', verifiedAt: new Date(), verifyDetail: detail } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await alertAdmins(`Backup ${r.name}: test restore FAILED`, [`The test restore of backup ${r.name} failed: ${msg.slice(0, 400)}`, 'This backup cannot be relied on. Run a new backup and check the server log.'])
    return await prisma.backupRun.update({ where: { id }, data: { verifyStatus: 'Failed', verifiedAt: new Date(), verifyDetail: msg.slice(0, 1000) } })
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${temp}" WITH (FORCE)`).catch(() => undefined)
    await admin.end()
    busy = null
  }
}

/* ------------------------------------------------------------ restore (disaster recovery, CLI only) */

/**
 * Restores a set into `databaseUrl` (existing content is replaced) and copies its files into `storageDir`.
 * The caller applies pending migrations afterwards (the set may come from an older release).
 */
export async function restoreBackup(o: { dir: string; databaseUrl: string; storageDir: string }) {
  const m = checkSet(o.dir)
  const target = new URL(o.databaseUrl).pathname.slice(1)
  const admin = await adminClient(o.databaseUrl)
  try {
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [target])).rowCount) await admin.query(`CREATE DATABASE "${target}"`)
  } finally {
    await admin.end()
  }
  const res = await restoreAndCompare(o.dir, m, o.databaseUrl, true)
  let copied = 0
  for (const f of walkFiles(path.join(o.dir, 'files'))) {
    const sha = path.basename(f)
    const dst = path.join(storageObjects(o.storageDir), sha.slice(0, 2), sha)
    if (fs.existsSync(dst) && sha256File(dst) === sha) continue
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(f, dst)
    copied++
  }
  return { manifest: m, counts: res.counts, filesCopied: copied }
}

/* ------------------------------------------------------------ alerts, schedule */

async function alertAdmins(subject: string, lines: string[]) {
  const admins = await prisma.user.findMany({ where: { active: true, isAdmin: true } })
  for (const a of admins) await queueEmail(prisma, 'Reminder', a, `[Qualigrafo] ${subject}`, [`Hello ${a.name},`, '', ...lines, '', `Open: ${appLink()}admin`, '', '—', prefFooter('Off')].join('\n'))
}

/** Last completed backup and last verified one, for the installation check and the admin page. */
export async function backupStatus() {
  const [last, verified] = await Promise.all([
    prisma.backupRun.findFirst({ where: { status: { in: ['Done', 'Failed'] } }, orderBy: { startedAt: 'desc' } }),
    prisma.backupRun.findFirst({ where: { status: 'Done', verifyStatus: 'Verified' }, orderBy: { startedAt: 'desc' } }),
  ])
  return { last, verified }
}

export async function maybeRunDailyBackup(now = new Date()) {
  const s = await getBackupSettings()
  if (!s.enabled || localTime(now) < s.time || busy) return null
  const run = await createBackup({ trigger: 'Scheduled', slot: `backup:${today()}` }).catch(() => null)
  if (run && s.verify) await verifyBackup(run.id, 'Scheduler').catch(() => undefined)
  return run
}

let started = false
export function startBackupScheduler(everyMs = 60_000) {
  if (started) return
  started = true
  // A process that stopped mid-run leaves "Running" rows behind: mark them failed.
  void prisma.backupRun.updateMany({ where: { status: 'Running', startedAt: { lt: new Date(Date.now() - 6 * 3600_000) } }, data: { status: 'Failed', error: 'Interrupted (the API stopped during the backup).' } }).catch(() => undefined)
  const tick = async () => {
    const { heartbeat, jobFailed } = await import('./monitoring.ts')
    try {
      const run = await maybeRunDailyBackup()
      await heartbeat('backups', { ok: true, detail: run ? `${run.name}: ${run.status}` : 'waiting for the next scheduled time' })
    } catch (e) {
      await jobFailed('backups', e)
    }
  }
  setTimeout(() => void tick(), 15_000).unref()
  setInterval(() => void tick(), everyMs).unref()
}
