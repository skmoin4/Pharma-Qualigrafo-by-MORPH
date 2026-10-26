// Structured logging (Phase 3 / P6). One event per line: JSON for a log collector (LOG_FORMAT=json, the default on a
// productive installation) or readable text while developing. Every request line carries the request id that also
// appears in the X-Request-Id header and on the audit entries of that request, so a record can be traced to the call
// that wrote it. Request bodies, tokens and passwords are never logged — only method, path, status, duration and who.
import fs from 'node:fs'
import path from 'node:path'
import { config, logFormat } from '../config.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
export type Fields = Record<string, string | number | boolean | null | undefined>

const logDir = () => (config.LOG_DIR ? path.resolve(config.LOG_DIR) : '')
const fileFor = (d: Date) => path.join(logDir(), `qualigrafo-${d.toISOString().slice(0, 10)}.log`)

let openDay = ''
let stream: fs.WriteStream | null = null

/** Opens the log file of `now` and deletes files older than LOG_KEEP_DAYS. Called at the first write of every day. */
export function rotate(now = new Date()) {
  if (!logDir()) return null
  fs.mkdirSync(logDir(), { recursive: true })
  stream?.end()
  stream = fs.createWriteStream(fileFor(now), { flags: 'a' })
  openDay = now.toISOString().slice(0, 10)
  const cutoff = new Date(now.getTime() - config.LOG_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
  for (const f of fs.readdirSync(logDir())) {
    const m = /^qualigrafo-(\d{4}-\d{2}-\d{2})\.log$/.exec(f)
    if (m && m[1] < cutoff) fs.rmSync(path.join(logDir(), f), { force: true })
  }
  return stream
}

const sink = (now: Date) => (!logDir() ? null : now.toISOString().slice(0, 10) === openDay && stream ? stream : rotate(now))

const value = (v: unknown) => (typeof v === 'string' && (v.includes(' ') || v === '') ? JSON.stringify(v) : String(v))

export function write(level: LogLevel, event: string, fields: Fields = {}) {
  if (ORDER[level] < ORDER[config.LOG_LEVEL]) return
  const now = new Date()
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null))
  const line = logFormat() === 'json'
    ? JSON.stringify({ ts: now.toISOString(), level, event, ...clean })
    : `${now.toISOString()} ${level.toUpperCase().padEnd(5)} ${event}${Object.entries(clean).map(([k, v]) => ` ${k}=${value(v)}`).join('')}`
  if (config.NODE_ENV !== 'test') (level === 'error' || level === 'warn' ? console.error : console.log)(line)
  try { sink(now)?.write(`${line}\n`) } catch { /* a log file that cannot be written must not stop the API */ }
}

export const log = {
  debug: (event: string, fields?: Fields) => write('debug', event, fields),
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
}

/** Where the log goes, for the Monitoring page and the installation check. */
export function logTarget() {
  const dir = logDir()
  let writable = !dir
  let problem = ''
  if (dir) {
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); writable = true } catch (e) { problem = e instanceof Error ? e.message : String(e) }
  }
  return { level: config.LOG_LEVEL, format: logFormat(), dir: dir || null, file: dir ? fileFor(new Date()) : null, keepDays: config.LOG_KEEP_DAYS, writable, problem }
}

/** Last `lines` log lines of today's file, newest last (empty when no LOG_DIR is configured). */
export function tailLog(lines: number) {
  const dir = logDir()
  if (!dir) return []
  const f = fileFor(new Date())
  if (!fs.existsSync(f)) return []
  const text = fs.readFileSync(f, 'utf8')
  return text.split('\n').filter(Boolean).slice(-lines)
}
