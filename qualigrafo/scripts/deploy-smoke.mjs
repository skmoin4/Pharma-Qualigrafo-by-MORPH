// Deployment smoke test (Phase 3 / P2): checks a fresh production installation (deploy/docker-compose.yml) end to end:
// HTTPS + redirect, security headers, health, first administrator, forced password change, client address behind
// the proxy, installation check (IQ) in production mode, and the web client under the Content-Security-Policy.
//   BASE=https://localhost/ HTTP_BASE=http://localhost/ NODE_EXTRA_CA_CERTS=caddy-root.crt E2E_IGNORE_HTTPS_ERRORS=1 \
//     node scripts/deploy-smoke.mjs                 # first run: creates the administrator
//   ... node scripts/deploy-smoke.mjs --after-restart   # after `docker compose restart` / `down` + `up`: data kept
// The administrator is created with SMOKE_CREATE_ADMIN (shell command; default: docker compose exec into the api).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { chromium } from 'playwright-core'
import { CHROME, INSECURE, isNoise, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'https://localhost/'
const HTTP_BASE = process.env.HTTP_BASE ?? 'http://localhost/'
const EMAIL = 'first.admin@customer.example'
const NEW_PASSWORD = 'Smoke-Test-2026-Secure'
const STATE = process.env.SMOKE_STATE ?? 'e2e-out/deploy-smoke.json'
const COMPOSE = process.env.COMPOSE_FILE ?? '../deploy/docker-compose.yml'
const AFTER = process.argv.includes('--after-restart')
fs.mkdirSync('e2e-out', { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }
const api = async (method, path, body, token) => {
  const r = await fetch(`${BASE}api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body?.headers ?? {}) }, body: body && !body.headers ? JSON.stringify(body) : body?.json ? JSON.stringify(body.json) : undefined })
  return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) }
}

if (!AFTER) {
  // ---- transport and headers
  const redirect = await fetch(HTTP_BASE, { redirect: 'manual' }).catch((e) => ({ status: 0, headers: new Headers(), e }))
  ok([301, 302, 307, 308].includes(redirect.status) && (redirect.headers.get('location') ?? '').startsWith('https://'), `plain HTTP redirects to HTTPS (${redirect.status})`)
  const home = await fetch(BASE)
  const html = await home.text()
  ok(home.status === 200 && html.includes('<div id="root">'), 'web client served over HTTPS')
  const h = (n) => home.headers.get(n) ?? ''
  ok(h('strict-transport-security').includes('max-age=') && h('x-content-type-options') === 'nosniff' && h('x-frame-options') === 'DENY' && h('referrer-policy') === 'no-referrer', 'security headers (HSTS, nosniff, frame DENY, referrer)')
  ok(h('content-security-policy').includes("default-src 'self'") && h('content-security-policy').includes("script-src 'self';") && h('content-security-policy').includes("frame-ancestors 'none'"), 'Content-Security-Policy without eval or inline scripts')
  ok(!home.headers.has('server') && !home.headers.has('x-powered-by'), 'no server banner')
  ok(h('cache-control') === 'no-cache', 'index.html is revalidated')
  const asset = /src="\/(assets\/[^"]+\.js)"/.exec(html)?.[1]
  const a = asset ? await fetch(BASE + asset) : null
  ok(!!a && a.status === 200 && (a.headers.get('cache-control') ?? '').includes('immutable'), 'hashed assets cached as immutable')
  ok((await fetch(`${BASE}some/deep/link`)).status === 200, 'unknown paths fall back to the web client')

  // ---- API through the proxy
  const health = await api('GET', '/health')
  ok(health.status === 200 && health.json?.db === 'up' && /^\d+\.\d+\.\d+/.test(health.json?.version ?? ''), `API and database up (version ${health.json?.version})`)
  ok((await api('GET', '/health/live')).json?.ok === true, 'liveness endpoint')
  ok((await api('GET', '/no-such-route')).status === 404, 'unknown API route answers 404')
  ok((await api('GET', '/projects')).status === 401, 'API requires sign-in')

  // ---- first administrator (fresh installation has no accounts)
  const cmd = process.env.SMOKE_CREATE_ADMIN ?? `docker compose -f ${COMPOSE} exec -T api npm run create-admin -- --email ${EMAIL} --name "First Administrator" --company "Customer Ltd"`
  const out = execSync(cmd, { encoding: 'utf8' })
  const temp = /Temporary password:\s+(\S+)/.exec(out)?.[1]
  ok(!!temp, 'create-admin issues a one-time temporary password')
  const first = await api('POST', '/auth/login', { email: EMAIL, password: temp })
  ok(first.status === 200 && first.json.user.mustChangePassword === true, 'temporary password signs in and forces a change')
  ok((await api('GET', '/projects', undefined, first.json.token)).status === 403, 'nothing else is allowed before the change')
  const changed = await api('POST', '/auth/password', { current: temp, next: NEW_PASSWORD }, first.json.token)
  ok(changed.status === 200 && changed.json.user.mustChangePassword === false, 'administrator sets their own password')
  const token = changed.json.token

  // ---- client address behind the proxy: a forged X-Forwarded-For is not believed
  await api('POST', '/auth/login', { headers: { 'x-forwarded-for': '203.0.113.9' }, json: { email: EMAIL, password: 'wrong-password-1' } })
  const ev = (await api('GET', '/admin/security-events?limit=5', undefined, token)).json.events.find((e) => e.type === 'login.failure')
  ok(!!ev?.ip && ev.ip !== '203.0.113.9', `sign-in failures logged with the real client address (${ev?.ip}), not a forged header`)

  // ---- backup with test restore inside the container (pg tools, backup volume)
  ok((await api('POST', '/admin/backups', {}, token)).status === 202, 'backup started')
  let bk = null
  for (let i = 0; i < 120; i++) { bk = (await api('GET', '/admin/backups', undefined, token)).json; if (!bk.busy && bk.runs[0]?.verifyStatus && bk.runs[0].verifyStatus !== 'Running') break; await new Promise((r) => setTimeout(r, 1000)) }
  ok(bk?.tools.ok && bk.runs[0]?.status === 'Done' && bk.runs[0].verifyStatus === 'Verified', `backup ${bk?.runs[0]?.name} verified by a test restore (${bk?.tools.pgDump})`)

  // ---- installation check in production mode
  const iq = (await api('POST', '/admin/validation/iq', {}, token)).json.iq
  const chk = (id) => iq?.checks.find((c) => c.id === id)
  ok(iq?.overall === 'Pass', `installation check passes (${iq?.checks.filter((c) => c.status === 'Warning').map((c) => c.id).join(', ') || 'no'} warnings)`)
  ok(chk('IQ-10')?.status === 'Pass' && chk('IQ-13')?.status === 'Pass' && chk('IQ-05')?.status === 'Pass' && chk('IQ-11')?.status === 'Pass' && chk('IQ-07')?.status === 'Pass' && chk('IQ-17')?.status === 'Pass' && chk('IQ-18')?.status === 'Pass', 'production mode, no test data, migrations applied, storage writable, strong secret, backup tools, verified backup')
  fs.writeFileSync(STATE, JSON.stringify({ fingerprint: iq?.fingerprint }))
}

// ---- web client under the CSP (both runs)
const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
/**
 * Sign in, and try once more if the first attempt does not land.
 *
 * Seen once in CI (run 41027957207, the restart stage): Caddy logged `POST /api/auth/login` as **status 0 after
 * 59 ms** — the browser cancelled the request — and the API never received it, so nothing was wrong with the
 * server. The cause of the cancellation is not established, so this does not pretend to fix it: it retries the way
 * a person would, and leaves a screenshot of the failed attempt as evidence for the next time it happens.
 */
const signIn = async () => {
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  return await vis(page.locator('.side'), 20000)
}
await page.goto(BASE)
let signedIn = await signIn()
if (!signedIn) {
  await page.screenshot({ path: `e2e-out/deploy-smoke-signin-retry${AFTER ? '-after-restart' : ''}.png`, fullPage: true })
  console.log('  sign-in did not land on the first attempt; reloading and trying once more')
  await page.reload()
  await page.waitForTimeout(1000)
  signedIn = await signIn()
}
ok(signedIn, `administrator signs in through the web client${AFTER ? ' after the restart' : ''}`)
if (!AFTER) {
  ok(await vis(page.getByRole('button', { name: /New project/ }).first()), 'empty installation offers a first project')
  await page.goto(`${BASE}#/admin`)
  for (const tab of [/Access review/, /E-mail & reminders/, /System & validation/]) {
    await page.getByRole('button', { name: tab }).click()
    await page.waitForTimeout(700)
  }
  await page.getByRole('button', { name: 'Run installation check' }).click()
  ok(await vis(page.getByText('Overall Pass')), 'installation check from the administration page')
  await page.goto(`${BASE}#/library`)
  await page.waitForTimeout(700)
  await page.screenshot({ path: 'e2e-out/deploy-smoke.png', fullPage: true })
} else {
  await page.goto(`${BASE}#/admin`)
  await page.getByRole('button', { name: /System & validation/ }).click()
  ok(await vis(page.getByText('Overall Pass')), 'the earlier installation check is still there (data kept)')
  const before = JSON.parse(fs.readFileSync(STATE, 'utf8'))
  ok(await vis(page.getByText(before.fingerprint ?? 'missing').first()), 'same code fingerprint after the restart')
}
ok(!errors.length, `no browser errors (incl. Content-Security-Policy violations)${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
