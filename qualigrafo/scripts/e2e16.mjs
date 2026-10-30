// Run (fixtures loaded + preview server on :8081): node scripts/e2e16.mjs
// Monitoring (P6): installation health, background jobs, error groups (acknowledge / resolve / reopen), interruptions,
// alert settings, test alert, server-log card, mobile.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { CHROME, INSECURE, isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 8000)
const shot = (n) => page.screenshot({ path: `${OUT}/e2e16-${n}.png`, fullPage: true })
const openTab = async () => { await page.goto(`${BASE}#/admin`); await page.waitForTimeout(400); await page.getByRole('button', { name: /^Monitoring$/ }).click(); await page.waitForTimeout(600) }

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
await loginAs(page, 'Contractor')
ok(!(await vis(page.locator('.side').getByRole('button', { name: 'Users & access' }), 600)), 'non-administrators have no monitoring page')

await switchRole(page, 'Owner / QA')
await openTab()

// installation health
const health = page.locator('section', { has: page.getByRole('heading', { name: 'Installation health' }) })
ok(await vis(health.getByText(/Qualigrafo \d+\.\d+\.\d+ · Node \d+/)), 'health card shows the application version and the Node.js runtime')
ok(await vis(health.getByText(/answers in \d+ ms/)) && await vis(health.getByText(/median \d+ ms · 95th percentile \d+ ms/)), 'database round trip and response times shown')
ok(await vis(health.getByText(/\d+ \(\d+ 2xx/)), 'requests since start counted by status class')
// Development logs to the console; a productive installation (the CI Docker stack) sets LOG_FORMAT=json and LOG_DIR,
// so the card names the log file instead. Either destination has to be reported.
ok(await vis(health.getByText(/level \w+, format (text|json), (console only|.+kept \d+ days)/)), 'log destination shown (console, or the log file when LOG_DIR is set)')
ok(await vis(health.getByText(/off — set METRICS_TOKEN/)), 'metrics endpoint reported as switched off')

// background jobs
const jobs = page.locator('section', { has: page.getByRole('heading', { name: 'Background jobs' }) })
ok(await jobs.locator('tbody tr').count() === 4 && await jobs.locator('tbody tr', { hasText: 'Running' }).count() === 4, 'four background jobs, all running')
ok(await vis(jobs.locator('tbody tr', { hasText: 'E-mail delivery' }).getByText('mailer')) && !(await vis(page.getByText('is not running'), 400)), 'jobs listed by name, no stale-job banner')

// error group: details, acknowledge, resolve, reopen
const errs = page.locator('section', { has: page.getByRole('heading', { name: /^Errors/ }) })
const row = errs.locator('tbody tr', { hasText: 'no space left on device' })
ok(await row.count() === 1 && await vis(row.getByText('New')) && await vis(row.getByText('3', { exact: true })), 'recorded error listed with its count and state')
await row.getByRole('button', { name: /no space left on device/ }).click()
ok(await vis(row.getByText(/Request id 2f4c1e90/)) && await vis(row.getByText(/storeFile/)), 'error details: request id of the failing call, user and stack')
ok(!(await row.getByRole('button', { name: 'Acknowledge' }).isEnabled()), 'an error cannot be acknowledged without a note')
await row.getByLabel('Error note').fill('Disk extended on the server; watching it')
await row.getByRole('button', { name: 'Acknowledge' }).click()
ok(await toast('Error acknowledged') && await vis(row.getByText('Acknowledged')), 'error acknowledged with a note')
await row.getByLabel('Error note').fill('Fixed: storage volume extended')
await row.getByRole('button', { name: 'Resolve' }).click()
ok(await toast('Error resolved') && await vis(row.getByText('Resolved')), 'error resolved')
ok(await vis(row.getByText(/Note: Fixed: storage volume extended — /)), 'the note is kept with the person and time')
await row.getByRole('button', { name: 'Reopen' }).click()
ok(await toast('Error reopened') && await vis(row.getByText('New')), 'a resolved error can be reopened')

// interruptions
const outages = page.locator('section', { has: page.getByRole('heading', { name: 'Interruptions' }) })
ok(await vis(outages.locator('tbody tr', { hasText: '12 min' }).getByText(/No API heartbeat/)), 'recorded interruption of the API listed')
await shot('monitoring')

// alert settings and test alert
await page.getByLabel('Job silent for (minutes)').fill('45')
await page.getByLabel('Free space warning (%)').fill('15')
await page.getByLabel('Errors per hour before an alert').fill('40')
await page.getByRole('button', { name: 'Save alert settings' }).click()
ok(await toast('Alert settings saved'), 'alert settings saved')
await page.getByRole('button', { name: 'Send test alert' }).click()
ok(await toast('Test alert sent'), 'test alert sent')

await page.reload(); await page.waitForTimeout(400)
await page.getByRole('button', { name: /^Monitoring$/ }).click(); await page.waitForTimeout(600)
ok(await page.getByLabel('Job silent for (minutes)').inputValue() === '45' && await page.getByLabel('Free space warning (%)').inputValue() === '15', 'alert settings kept after reload')

await page.getByRole('button', { name: /E-mail & reminders/ }).click()
await page.waitForTimeout(600)
ok(await vis(page.locator('tbody tr', { hasText: 'Test alert' }).first()), 'the test alert is in the e-mail outbox')
await page.getByRole('button', { name: /Security log/ }).click()
ok(await vis(page.locator('td', { hasText: 'monitor.handled' }).first()) && await vis(page.locator('td', { hasText: 'monitor.alert' }).first()), 'handled errors and sent alerts are in the security log')

await page.setViewportSize({ width: 390, height: 844 })
await openTab()
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'monitoring page has no horizontal page scroll on mobile')
await shot('mobile')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
