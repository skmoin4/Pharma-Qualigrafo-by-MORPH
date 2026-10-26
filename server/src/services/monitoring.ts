// Monitoring (Phase 3 / P6): structured logs (see lib/logger.ts), error tracking, background-job health and alerts.
// What it does:
//   · every request is logged with its request id, status and duration; counters give the figures on the Monitoring page
//   · every unexpected server error (request, background job, process) is grouped by fingerprint and counted, instead
//     of being lost in the console; administrators acknowledge or resolve a group
//   · every background job writes a heartbeat; the watchdog alerts when a job stops running, when the API itself was
//     not running (gap in its own heartbeat = outage), when errors come in a burst or when disk space runs low
//   · GET /api/metrics exposes the same figures to an external uptime / monitoring tool (token in METRICS_TOKEN)
// Alerts are e-mails to the administrators, written to the security log as well, and never sent more than once per
// hour per subject so a failing installation does not flood the outbox.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { config } from '../config.ts'
import { prisma } from '../db.ts'
import { changeList } from '../lib/audit.ts'
import { log, logTarget } from '../lib/logger.ts'
import { securityLog } from '../lib/security.ts'
import { appLink, prefFooter, queueEmail } from './mail.ts'
import { APP_VERSION } from './iq.ts'

/* ------------------------------------------------------------ settings */

export const zMonitorSettings = z.object({
  /** Master switch for the alert e-mails (logging, error tracking and metrics stay on). */
  alerts: z.boolean(),
  /** Alert on the first occurrence of a new error (and when a resolved one happens again). */
  onNewError: z.boolean(),
  /** Alert when more than this many errors are recorded within an hour; 0 = off. */
  errorBurst: z.number().int().min(0, 'Error burst must be 0–1000.').max(1000, 'Error burst must be 0–1000.'),
  /** Alert when a background job has not run for this many minutes. */
  staleJobMin: z.number().int().min(5, 'Stale-job time must be 5–1440 minutes.').max(1440, 'Stale-job time must be 5–1440 minutes.'),
  /** Alert when free space on the file storage falls below this percentage; 0 = off. */
  diskMinFreePct: z.number().int().min(0, 'Free-space warning must be 0–90 %.').max(90, 'Free-space warning must be 0–90 %.'),
})
export type MonitorSettings = z.infer<typeof zMonitorSettings>
const DEFAULTS: MonitorSettings = { alerts: true, onNewError: true, errorBurst: 25, staleJobMin: 90, diskMinFreePct: 10 }
const KEY = 'monitoring'

export async function getMonitorSettings(): Promise<MonitorSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } })
  return { ...DEFAULTS, ...((row?.value as Partial<MonitorSettings> | undefined) ?? {}) }
}

export async function setMonitorSettings(next: MonitorSettings, by: string) {
  const old = await getMonitorSettings()
  const changes = changeList([
    ['alert e-mails', old.alerts ? 'on' : 'off', next.alerts ? 'on' : 'off'],
    ['alert on a new error', old.onNewError ? 'on' : 'off', next.onNewError ? 'on' : 'off'],
    ['errors per hour before an alert', old.errorBurst, next.errorBurst],
    ['stale-job time (minutes)', old.staleJobMin, next.staleJobMin],
    ['free-space warning (%)', old.diskMinFreePct, next.diskMinFreePct],
  ])
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value: next, updatedBy: by }, create: { key: KEY, value: next, updatedBy: by } })
  return changes
}

/* ------------------------------------------------------------ request counters (since this process started) */

const MAX_SAMPLES = 2000
const counters = {
  startedAt: new Date(),
  total: 0,
  byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 } as Record<string, number>,
  durations: [] as number[],
  slowest: { path: '', ms: 0 },
}

export function recordRequest(status: number, ms: number, route: string) {
  counters.total++
  const cls = `${Math.floor(status / 100)}xx`
  if (cls in counters.byClass) counters.byClass[cls]++
  if (counters.durations.length >= MAX_SAMPLES) counters.durations.shift()
  counters.durations.push(ms)
  if (ms > counters.slowest.ms) counters.slowest = { path: route, ms }
}

const percentile = (p: number) => {
  if (!counters.durations.length) return 0
  const s = [...counters.durations].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))])
}

export const requestStats = () => ({
  since: counters.startedAt.toISOString(),
  total: counters.total,
  byClass: { ...counters.byClass },
  p50ms: percentile(50),
  p95ms: percentile(95),
  slowest: counters.slowest.ms ? { ...counters.slowest } : null,
})

/** Used by the API test suite so counters do not carry over between checks. */
export function resetRequestStats() {
  counters.startedAt = new Date()
  counters.total = 0
  counters.byClass = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
  counters.durations = []
  counters.slowest = { path: '', ms: 0 }
}

/* ------------------------------------------------------------ error tracking */

/** Same error from the same place = same group: numbers, ids and quoted values in the message are masked. */
export const fingerprintOf = (kind: string, place: string, message: string) =>
  createHash('sha256').update(`${kind}|${place}|${message.replace(/[0-9a-f]{8,}/gi, '#').replace(/\d+/g, '#').replace(/"[^"]*"/g, '"#"').slice(0, 300)}`).digest('hex')

export interface Captured { id: string; fingerprint: string; count: number; isNew: boolean }

/**
 * Records one unexpected error. Never throws: monitoring must not turn an error into a second one.
 * A group that was resolved and happens again is reopened (and alerted) — the fix did not hold.
 */
export async function captureError(o: { kind: 'Request' | 'Job' | 'Process'; place: string; error: unknown; requestId?: string; user?: string }): Promise<Captured | null> {
  const err = o.error instanceof Error ? o.error : new Error(String(o.error))
  const message = (err.message || String(o.error)).slice(0, 1000)
  const fingerprint = fingerprintOf(o.kind, o.place, message)
  log.error('error', { kind: o.kind, place: o.place, message, requestId: o.requestId, user: o.user, fingerprint: fingerprint.slice(0, 12) })
  try {
    const existing = await prisma.errorEvent.findUnique({ where: { fingerprint } })
    const row = existing
      ? await prisma.errorEvent.update({
        where: { fingerprint },
        data: {
          count: { increment: 1 }, lastAt: new Date(), message, stack: err.stack?.slice(0, 4000) ?? null,
          lastRequestId: o.requestId ?? null, lastUser: o.user ?? null,
          ...(existing.status === 'Resolved' ? { status: 'New', handledBy: null, handledAt: null } : {}),
        },
      })
      : await prisma.errorEvent.create({
        data: { fingerprint, kind: o.kind, place: o.place, message, stack: err.stack?.slice(0, 4000) ?? null, lastRequestId: o.requestId ?? null, lastUser: o.user ?? null },
      })
    const isNew = !existing || existing.status === 'Resolved'
    const s = await getMonitorSettings()
    if (isNew && s.onNewError) {
      await alert(`error:${fingerprint}:${existing ? 'again' : 'new'}`, `${existing ? 'Error happened again' : 'New error'}: ${message.slice(0, 80)}`, [
        `${existing ? 'An error that was marked resolved happened again' : 'A new error was recorded'} in Qualigrafo.`,
        '', `Place: ${o.place} (${o.kind})`, `Message: ${message}`, o.requestId ? `Request id: ${o.requestId}` : '', o.user ? `User: ${o.user}` : '',
        '', 'Open Users & access → Monitoring to see the details and the server log line with this request id.',
      ].filter(Boolean))
    }
    burst.push(Date.now())
    await checkBurst(s)
    return { id: row.id, fingerprint, count: row.count, isNew }
  } catch (e) {
    log.error('monitoring.capture-failed', { message: e instanceof Error ? e.message : String(e) })
    return null
  }
}

const burst: number[] = []
async function checkBurst(s: MonitorSettings) {
  if (!s.errorBurst) return
  const hourAgo = Date.now() - 3600_000
  while (burst.length && burst[0] < hourAgo) burst.shift()
  if (burst.length > s.errorBurst) {
    await alert('error:burst', `${burst.length} errors in the last hour`, [
      `Qualigrafo recorded ${burst.length} errors within the last hour (alert above ${s.errorBurst}).`,
      'Open Users & access → Monitoring; the error groups there show what is failing.',
    ])
  }
}

export async function setErrorStatus(id: string, status: 'Acknowledged' | 'Resolved' | 'New', note: string, by: string) {
  const e = await prisma.errorEvent.findUnique({ where: { id } })
  if (!e) return null
  return prisma.errorEvent.update({
    where: { id },
    data: { status, note: note || e.note, handledBy: status === 'New' ? null : by, handledAt: status === 'New' ? null : new Date() },
  })
}

/* ------------------------------------------------------------ background-job heartbeats */

export const JOBS = {
  api: { title: 'API process (watchdog)', everyMin: 1 },
  mailer: { title: 'E-mail delivery', everyMin: 1 },
  reminders: { title: 'Daily reminders', everyMin: 1 },
  backups: { title: 'Backups', everyMin: 1 },
} as const
export type JobName = keyof typeof JOBS

const lastWrite = new Map<JobName, number>()

/** Records that a job ran. Writes at most once a minute per job (a tick every 15 seconds must not fill the table). */
export async function heartbeat(name: JobName, o: { ok: boolean; detail?: string; error?: string } = { ok: true }) {
  const now = Date.now()
  if (o.ok && now - (lastWrite.get(name) ?? 0) < 55_000) return
  lastWrite.set(name, now)
  const at = new Date(now)
  try {
    await prisma.jobHeartbeat.upsert({
      where: { name },
      update: { lastRunAt: at, runs: { increment: 1 }, ...(o.ok ? { lastOkAt: at, detail: o.detail ?? null } : { failures: { increment: 1 }, lastError: (o.error ?? '').slice(0, 1000) }) },
      create: { name, lastRunAt: at, runs: 1, ...(o.ok ? { lastOkAt: at, detail: o.detail ?? null } : { failures: 1, lastError: (o.error ?? '').slice(0, 1000) }) },
    })
  } catch (e) {
    log.warn('monitoring.heartbeat-failed', { job: name, message: e instanceof Error ? e.message : String(e) })
  }
}

/** A background job that threw: heartbeat as failed, error group, alert. */
export async function jobFailed(name: JobName, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error)
  await heartbeat(name, { ok: false, error: msg })
  await captureError({ kind: 'Job', place: name, error })
}

export async function jobHealth(now = new Date()) {
  const s = await getMonitorSettings()
  const rows = await prisma.jobHeartbeat.findMany()
  return (Object.keys(JOBS) as JobName[]).map((name) => {
    const r = rows.find((x) => x.name === name)
    const ageMin = r ? Math.floor((now.getTime() - r.lastRunAt.getTime()) / 60_000) : null
    const status = !r ? 'Never run' : ageMin! > s.staleJobMin ? 'Stale' : r.lastError && r.lastOkAt && r.lastOkAt < r.lastRunAt ? 'Failing' : 'Running'
    return {
      name, title: JOBS[name].title, status, ageMin,
      lastRunAt: r?.lastRunAt.toISOString() ?? null, lastOkAt: r?.lastOkAt?.toISOString() ?? null,
      runs: r?.runs ?? 0, failures: r?.failures ?? 0, lastError: r?.lastError ?? null, detail: r?.detail ?? null,
    }
  })
}

/* ------------------------------------------------------------ alerts */

const sentAt = new Map<string, number>()
const THROTTLE_MS = 3600_000

/** One e-mail per subject per hour to every active administrator, plus a security-log entry. */
export async function alert(key: string, subject: string, lines: string[], force = false) {
  const s = await getMonitorSettings()
  if (!s.alerts && !force) return false
  const now = Date.now()
  if (!force && now - (sentAt.get(key) ?? 0) < THROTTLE_MS) return false
  sentAt.set(key, now)
  const admins = await prisma.user.findMany({ where: { active: true, isAdmin: true } })
  for (const a of admins) {
    await queueEmail(prisma, 'Reminder', a, `[Qualigrafo] ${subject}`, [`Hello ${a.name},`, '', ...lines, '', `Open: ${appLink()}admin`, '', '—', prefFooter('Off')].join('\n'))
  }
  await securityLog('monitor.alert', { detail: `${subject} (${admins.length} administrator(s) notified)` })
  log.warn('monitoring.alert', { subject, recipients: admins.length })
  return true
}

/** Used by the API suite and the "Send test alert" button so a throttled subject can be sent again. */
export const resetAlertThrottle = () => sentAt.clear()

/* ------------------------------------------------------------ health snapshot */

function diskFree(dir: string) {
  try {
    fs.mkdirSync(path.resolve(dir), { recursive: true })
    const st = fs.statfsSync(path.resolve(dir))
    const total = st.blocks * st.bsize
    const free = st.bavail * st.bsize
    return { total, free, freePct: total ? Math.round((free / total) * 100) : null }
  } catch {
    return { total: null, free: null, freePct: null }
  }
}

export async function healthSnapshot() {
  const t0 = process.hrtime.bigint()
  let db = { ok: true, latencyMs: 0, problem: '' }
  try {
    await prisma.$queryRaw`SELECT 1`
    db.latencyMs = Math.max(1, Math.round(Number(process.hrtime.bigint() - t0) / 1e6))
  } catch (e) {
    db = { ok: false, latencyMs: 0, problem: e instanceof Error ? e.message : String(e) }
  }
  const mem = process.memoryUsage()
  const errors = db.ok
    ? await prisma.errorEvent.groupBy({ by: ['status'], _count: { _all: true }, _sum: { count: true } })
    : []
  const day = new Date(Date.now() - 86_400_000)
  return {
    version: APP_VERSION,
    node: process.versions.node,
    env: config.NODE_ENV,
    pid: process.pid,
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    uptimeSec: Math.round(process.uptime()),
    memory: { rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576) },
    db,
    storage: { dir: path.resolve(config.STORAGE_DIR), ...diskFree(config.STORAGE_DIR) },
    requests: requestStats(),
    errors: {
      open: errors.filter((e) => e.status !== 'Resolved').reduce((n, e) => n + e._count._all, 0),
      occurrences: errors.reduce((n, e) => n + (e._sum.count ?? 0), 0),
      last24h: db.ok ? await prisma.errorEvent.count({ where: { lastAt: { gte: day } } }) : 0,
    },
    log: logTarget(),
    metrics: { enabled: !!config.METRICS_TOKEN, path: '/api/metrics' },
  }
}

/* ------------------------------------------------------------ watchdog */

/**
 * Runs every minute: writes the API heartbeat, notices a gap in it (the application was not running), and alerts on
 * stale jobs and low disk space. A gap is reported once, as an Outage row, with the admins notified.
 */
export async function watchdog(now = new Date()) {
  const s = await getMonitorSettings()
  const previous = await prisma.jobHeartbeat.findUnique({ where: { name: 'api' } })
  const out: { outage: { minutes: number } | null; stale: string[] } = { outage: null, stale: [] }
  if (previous) {
    const minutes = Math.floor((now.getTime() - previous.lastRunAt.getTime()) / 60_000)
    // The watchdog ticks every minute; more than 5 minutes without a heartbeat means the API was not running.
    if (minutes > 5) {
      const o = await prisma.outage.create({ data: { from: previous.lastRunAt, to: now, minutes, detail: `No API heartbeat for ${minutes} minutes (the application was stopped or could not reach its database).` } })
      out.outage = { minutes: o.minutes }
      log.warn('monitoring.outage', { minutes, from: previous.lastRunAt.toISOString() })
      await alert(`outage:${o.id}`, `The API was not running for ${minutes} minutes`, [
        `Qualigrafo recorded no heartbeat between ${previous.lastRunAt.toISOString()} and ${now.toISOString()} (${minutes} minutes).`,
        'The application was stopped, restarted or could not reach its database in that time. Check the server log and the service status.',
      ])
    }
  }
  lastWrite.delete('api')
  await heartbeat('api', { ok: true, detail: `uptime ${Math.round(process.uptime() / 60)} min` })

  for (const j of await jobHealth(now)) {
    if (j.name === 'api' || j.status === 'Running') continue
    if (j.status === 'Never run' && process.uptime() < 600) continue
    out.stale.push(j.name)
    await alert(`job:${j.name}:${j.status}`, `Background job "${j.title}" is ${j.status.toLowerCase()}`, [
      `The background job ${j.title} (${j.name}) is ${j.status.toLowerCase()}.`,
      j.lastRunAt ? `Last run: ${j.lastRunAt} (${j.ageMin} minutes ago; alert above ${s.staleJobMin} minutes).` : 'It has not run since this installation started.',
      j.lastError ? `Last error: ${j.lastError}` : '',
      'Without it e-mails, reminders or backups stop. Check the server log and restart the API if needed.',
    ].filter(Boolean))
  }

  if (s.diskMinFreePct) {
    const d = diskFree(config.STORAGE_DIR)
    if (d.freePct !== null && d.freePct < s.diskMinFreePct) {
      await alert('disk:storage', `Only ${d.freePct} % free space left on the file storage`, [
        `The file storage ${path.resolve(config.STORAGE_DIR)} has ${d.freePct} % free space left (alert below ${s.diskMinFreePct} %).`,
        'Uploads and backups fail when the disk is full. Free space or extend the volume.',
      ])
    }
  }
  return out
}

let started = false
export function startWatchdog(everyMs = 60_000) {
  if (started) return
  started = true
  const tick = () => { void watchdog().catch((e) => void captureError({ kind: 'Job', place: 'watchdog', error: e })) }
  setTimeout(tick, 2_000).unref()
  setInterval(tick, everyMs).unref()
}

/* ------------------------------------------------------------ metrics endpoint (Prometheus text format) */

export async function metricsText() {
  const h = await healthSnapshot()
  const jobs = await jobHealth()
  const l: string[] = []
  const m = (name: string, help: string, type: 'gauge' | 'counter', lines: string[]) => l.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...lines)
  m('qualigrafo_up', 'API answering and database reachable (1/0).', 'gauge', [`qualigrafo_up ${h.db.ok ? 1 : 0}`])
  m('qualigrafo_uptime_seconds', 'Seconds since this API process started.', 'gauge', [`qualigrafo_uptime_seconds ${h.uptimeSec}`])
  m('qualigrafo_build_info', 'Application version and Node.js runtime.', 'gauge', [`qualigrafo_build_info{version="${h.version}",node="${h.node}",env="${h.env}"} 1`])
  m('qualigrafo_db_latency_ms', 'Round trip of SELECT 1 against PostgreSQL.', 'gauge', [`qualigrafo_db_latency_ms ${h.db.latencyMs}`])
  m('qualigrafo_requests_total', 'HTTP requests since this process started, by status class.', 'counter', Object.entries(h.requests.byClass).map(([k, v]) => `qualigrafo_requests_total{class="${k}"} ${v}`))
  m('qualigrafo_request_duration_ms', 'Request duration since this process started.', 'gauge', [`qualigrafo_request_duration_ms{quantile="0.5"} ${h.requests.p50ms}`, `qualigrafo_request_duration_ms{quantile="0.95"} ${h.requests.p95ms}`])
  m('qualigrafo_errors_open', 'Error groups that are not resolved.', 'gauge', [`qualigrafo_errors_open ${h.errors.open}`])
  m('qualigrafo_errors_24h', 'Error groups that occurred in the last 24 hours.', 'gauge', [`qualigrafo_errors_24h ${h.errors.last24h}`])
  m('qualigrafo_memory_rss_bytes', 'Resident memory of the API process.', 'gauge', [`qualigrafo_memory_rss_bytes ${h.memory.rssMb * 1048576}`])
  if (h.storage.free !== null) m('qualigrafo_storage_free_bytes', 'Free space on the file storage volume.', 'gauge', [`qualigrafo_storage_free_bytes ${h.storage.free}`])
  m('qualigrafo_job_age_seconds', 'Seconds since each background job last ran.', 'gauge', jobs.map((j) => `qualigrafo_job_age_seconds{job="${j.name}"} ${j.ageMin === null ? -1 : j.ageMin * 60}`))
  m('qualigrafo_job_failures_total', 'Failed runs per background job.', 'counter', jobs.map((j) => `qualigrafo_job_failures_total{job="${j.name}"} ${j.failures}`))
  const B = await import('./backups.ts')
  const { verified } = await B.backupStatus().catch(() => ({ verified: null }))
  m('qualigrafo_backup_age_hours', 'Age of the newest backup whose test restore passed (-1 = none).', 'gauge', [`qualigrafo_backup_age_hours ${verified ? Math.round((Date.now() - verified.startedAt.getTime()) / 3600_000) : -1}`])
  return `${l.join('\n')}\n`
}

/* ------------------------------------------------------------ overview for the admin page */

export async function monitoringOverview() {
  const [settings, health, jobs, errors, outages] = await Promise.all([
    getMonitorSettings(),
    healthSnapshot(),
    jobHealth(),
    prisma.errorEvent.findMany({ orderBy: { lastAt: 'desc' }, take: 100 }),
    prisma.outage.findMany({ orderBy: { from: 'desc' }, take: 20 }),
  ])
  return {
    settings, health, jobs,
    errors: errors.map((e) => ({
      id: e.id, kind: e.kind, place: e.place, message: e.message, stack: e.stack, count: e.count,
      firstAt: e.firstAt.toISOString(), lastAt: e.lastAt.toISOString(), lastRequestId: e.lastRequestId, lastUser: e.lastUser,
      status: e.status, note: e.note, handledBy: e.handledBy, handledAt: e.handledAt?.toISOString() ?? null,
      fingerprint: e.fingerprint,
    })),
    outages: outages.map((o) => ({ id: o.id, from: o.from.toISOString(), to: o.to.toISOString(), minutes: o.minutes, detail: o.detail })),
  }
}
