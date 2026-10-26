// Operational qualification run (Phase 2 / C7): executes the API suite and every browser suite against freshly loaded
// test fixtures and records each check under its OQ test case in VALIDATION_DIR/oq-results.json.
//   npm run validation:oq -- --by "Name, role"            (WIPES the test database, like fixtures:load)
//   options: --api-port 4100 --web-port 8082 --skip-browser
// Needs: test database (never production), Chrome (CHROME_PATH or the platform default, see qualigrafo/scripts/e2e-lib.mjs), ports free.
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../src/config.ts'
import { prisma } from '../src/db.ts'
import { APP_VERSION, codeFingerprint } from '../src/services/iq.ts'
import { OQ_CASES } from '../src/validation/catalogue.ts'
import type { OqCaseResult, OqResults } from '../src/validation/catalogue.ts'

if (config.NODE_ENV === 'production') throw new Error('The OQ run wipes the database; it never runs with NODE_ENV=production.')
const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def }
const by = arg('by', os.userInfo().username)
// Commands are run through the shell as one string (fixed arguments only, no user input).
const apiPort = Number(arg('api-port', '4100'))
const webPort = Number(arg('web-port', '8082'))
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = path.resolve(SERVER, '../qualigrafo')
const started = Date.now()

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn([cmd, ...args].join(' '), { cwd, env: { ...process.env, ...env }, shell: true })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { out += d })
    p.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}
function background(cmd: string, args: string[], cwd: string, env: Record<string, string>) {
  return spawn([cmd, ...args].join(' '), { cwd, env: { ...process.env, ...env }, shell: true, stdio: 'ignore', detached: process.platform !== 'win32' })
}
function stop(p: ChildProcess | null) {
  if (!p?.pid) return
  // Synchronous: the whole process tree must be gone before this script exits.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
  else try { process.kill(-p.pid, 'SIGTERM') } catch { /* already gone */ }
}
async function up(url: string) { try { return (await fetch(url)).status < 500 } catch { return false } }
async function waitUp(url: string, label: string) {
  for (let i = 0; i < 60; i++) { if (await up(url)) return; await new Promise((r) => setTimeout(r, 1000)) }
  throw new Error(`${label} did not start (${url}).`)
}
/** PASS / FAIL lines of a suite; SECTION lines switch the test case (API suite). */
function parse(out: string, fallback: string | null) {
  const res = new Map<string, OqCaseResult>()
  let current = fallback
  for (const raw of out.split(/\r?\n/)) {
    const sec = /^SECTION (\S+)/.exec(raw)
    if (sec) { current = sec[1]; continue }
    const m = /^(PASS|FAIL) {2}(.*)$/.exec(raw)
    if (!m || !current) continue
    const c = OQ_CASES.find((x) => x.id === current)!
    const r = res.get(current) ?? { id: c.id, title: c.title, suite: c.suite, checks: [], passed: 0, failed: 0 }
    r.checks.push({ text: m[2], pass: m[1] === 'PASS' })
    if (m[1] === 'PASS') r.passed++
    else r.failed++
    res.set(current, r)
  }
  return res
}

const results = new Map<string, OqCaseResult>()
const log = (s: string) => console.log(`[OQ] ${s}`)

// ---- API suite (in-process server, fresh fixtures)
log('loading fixtures, running the API suite …')
await run('npm', ['run', 'fixtures:load'], SERVER)
const api = await run('npx', ['tsx', 'scripts/api.test.ts'], SERVER)
for (const [k, v] of parse(api.out, null)) results.set(k, v)
log(`API suite: ${[...results.values()].reduce((n, c) => n + c.checks.length, 0)} checks`)

// ---- browser suites against a separate API + preview server
let apiProc: ChildProcess | null = null
let webProc: ChildProcess | null = null
let chrome = 'not run'
if (!process.argv.includes('--skip-browser')) {
  if (await up(`http://localhost:${apiPort}/api/health`) || await up(`http://localhost:${webPort}/`)) throw new Error(`Port ${apiPort} or ${webPort} is in use; choose others with --api-port / --web-port.`)
  try {
    log('building the web client …')
    const b = await run('npm', ['run', 'build'], WEB)
    if (b.code) throw new Error(`Web build failed:\n${b.out.slice(-2000)}`)
    apiProc = background('npx', ['tsx', 'src/index.ts'], SERVER, { PORT: String(apiPort) })
    webProc = background('npx', ['vite', 'preview', '--port', String(webPort), '--strictPort'], WEB, { API_URL: `http://localhost:${apiPort}` })
    await waitUp(`http://localhost:${apiPort}/api/health`, 'API')
    await waitUp(`http://localhost:${webPort}/`, 'Web preview')
    const v = await run('node', ['-e', JSON.stringify("Promise.all([import('playwright-core'), import('./scripts/e2e-lib.mjs')]).then(async ([{ chromium }, { CHROME }]) => { const b = await chromium.launch({ executablePath: CHROME }); console.log('Chrome ' + b.version()); await b.close() })")], WEB)
    chrome = v.out.trim().split(/\r?\n/).pop() ?? 'unknown'
    for (const c of OQ_CASES.filter((x) => x.suite !== 'api')) {
      await run('npm', ['run', 'fixtures:load', ...(c.fixtures ? ['--', ...c.fixtures.split(' ')] : [])], SERVER)
      const r = await run('node', [`scripts/${c.suite}.mjs`], WEB, { BASE: `http://localhost:${webPort}/` })
      const parsed = parse(r.out, c.id).get(c.id) ?? { id: c.id, title: c.title, suite: c.suite, checks: [], passed: 0, failed: 0 }
      if (r.code && !parsed.failed) { parsed.checks.push({ text: `Suite ended abnormally (exit ${r.code}): ${r.out.trim().split(/\r?\n/).slice(-3).join(' | ')}`, pass: false }); parsed.failed++ }
      results.set(c.id, parsed)
      log(`${c.id} (${c.suite}): ${parsed.passed}/${parsed.checks.length}`)
    }
  } finally {
    stop(apiProc); stop(webProc)
    for (let i = 0; i < 20 && (await up(`http://localhost:${apiPort}/api/health`) || await up(`http://localhost:${webPort}/`)); i++) await new Promise((r) => setTimeout(r, 500))
    if (await up(`http://localhost:${apiPort}/api/health`) || await up(`http://localhost:${webPort}/`)) log(`warning: a test server on ${apiPort} / ${webPort} is still running; stop it manually`)
  }
}

const cases = OQ_CASES.map((c) => results.get(c.id) ?? { id: c.id, title: c.title, suite: c.suite, checks: [], passed: 0, failed: 0 })
  .filter((c) => c.checks.length || !process.argv.includes('--skip-browser') || c.suite === 'api')
const [{ v: pg }] = await prisma.$queryRaw<{ v: string }[]>`SELECT current_setting('server_version') AS v`
let commit = 'unknown'
const g = await run('git', ['rev-parse', '--short', 'HEAD'], SERVER)
if (!g.code) commit = g.out.trim() + ((await run('git', ['status', '--porcelain'], SERVER)).out.trim() ? ' (uncommitted changes)' : '')
const fp = codeFingerprint()
const result: OqResults = {
  executedAt: new Date(started).toISOString(), executedBy: by, durationSec: Math.round((Date.now() - started) / 1000),
  environment: {
    'Software version': `Qualigrafo ${APP_VERSION}`, 'Code fingerprint': fp.sha256, 'Source revision': commit,
    'Operating system': `${os.type()} ${os.release()} (${os.arch()})`, 'Node.js': process.versions.node, PostgreSQL: pg, Browser: chrome,
    'Test data': 'Fictional test fixtures (npm run fixtures:load), reloaded before every suite',
  },
  cases,
  totals: { cases: cases.length, checks: cases.reduce((n, c) => n + c.checks.length, 0), passed: cases.reduce((n, c) => n + c.passed, 0), failed: cases.reduce((n, c) => n + c.failed, 0) },
}
const dir = path.resolve(SERVER, config.VALIDATION_DIR)
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'oq-results.json'), JSON.stringify(result, null, 2))
await prisma.$disconnect()
log(`done: ${result.totals.passed}/${result.totals.checks} checks passed in ${result.totals.cases} test cases (${result.durationSec}s) -> ${path.join(dir, 'oq-results.json')}`)
process.exit(result.totals.failed ? 1 : 0)
