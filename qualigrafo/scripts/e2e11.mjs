// Run (fixtures loaded + preview server on :8081): node scripts/e2e11.mjs
// E-mail notifications and scheduled reminders: own preference, admin schedule, run now, outbox, in-app reminders.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { INSECURE, CHROME, isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'

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
page.on('dialog', (d) => d.accept())
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 8000)
const go = async (p) => { await page.goto(`${BASE}#/p/PRJ-026/${p}`); await page.waitForTimeout(500) }
const shot = (n) => page.screenshot({ path: `${OUT}/e2e11-${n}.png`, fullPage: true })

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()

// ---- contractor chooses a daily digest
await loginAs(page, 'Contractor')
await page.getByRole('button', { name: 'E-mail notifications' }).click()
const dlg = page.getByRole('dialog', { name: 'E-mail notifications' })
ok(await vis(dlg) && await dlg.getByRole('radio', { name: /Immediate/ }).isChecked(), 'preference dialog opens with Immediate selected')
ok(await vis(dlg.getByText('Security alerts (password changed or reset, account locked, administrator rights) are always e-mailed.')), 'dialog states that security alerts are always sent')
ok(await dlg.getByRole('button', { name: 'Save' }).isDisabled(), 'save disabled until the preference changes')
await dlg.getByRole('radio', { name: /Daily digest/ }).check()
await shot('preference')
await dlg.getByRole('button', { name: 'Save' }).click()
ok(await toast('E-mail notifications: Daily digest'), 'preference saved')
await page.reload(); await page.locator('.side').waitFor()
await page.getByRole('button', { name: 'E-mail notifications' }).click()
ok(await dlg.getByRole('radio', { name: /Daily digest/ }).isChecked(), 'preference kept after reload')
await page.keyboard.press('Escape')
ok(!(await vis(dlg, 800)), 'dialog closes with Escape')
ok(!(await vis(page.locator('.side').getByRole('button', { name: 'Users & access' }), 500)), 'non-administrators have no e-mail administration')
await go('activity')
ok(await vis(page.getByText(/Daily reminders \(in-app and e-mail\)/)), 'Reminders rule explains the daily reminders')

// ---- administrator: delivery status and schedule
await switchRole(page, 'Owner / QA')
await page.goto(`${BASE}#/admin`); await page.waitForTimeout(500)
await page.getByRole('button', { name: /E-mail & reminders/ }).click()
ok(await vis(page.getByText('Not configured')), 'delivery shows Not configured without SMTP settings')
ok(await vis(page.getByText(/recorded in the outbox as/)), 'the page explains which settings enable delivery')
const enabled = page.getByRole('checkbox', { name: 'Send daily reminders' })
ok(!(await enabled.isChecked()), 'daily reminders are off in the test fixtures')
ok(await page.getByRole('button', { name: 'Save schedule' }).isDisabled(), 'save disabled until the schedule changes')
await enabled.check()
await page.getByLabel('Time (site time zone)').fill('23:59')
await page.getByLabel('"Due soon" window (days)').fill('5')
await page.getByRole('button', { name: 'Save schedule' }).click()
ok(await toast('Reminder schedule saved'), 'schedule saved')
await page.reload(); await page.waitForTimeout(400)
await page.getByRole('button', { name: /E-mail & reminders/ }).click()
ok(await enabled.isChecked() && await page.getByLabel('Time (site time zone)').inputValue() === '23:59' && await page.getByLabel('"Due soon" window (days)').inputValue() === '5', 'schedule kept after reload')

// ---- run now
await page.getByRole('button', { name: 'Run reminders now' }).click()
ok(await toast(/Reminders run: \d+ item\(s\), \d+ e-mail\(s\)/), 'administrator ran the reminders')
const runRow = page.locator('tr', { hasText: 'Manual ·' }).first()
ok(await vis(runRow) && await vis(runRow.getByText('Done')), 'run history shows the manual run as Done')

// ---- outbox: without SMTP the mailer records Not sent
await page.getByRole('button', { name: 'Send test e-mail to me' }).click()
ok(await toast('Test e-mail queued to your address'), 'test e-mail queued')
let notSent = false
for (let i = 0; i < 12 && !notSent; i++) {
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Refresh' }).click()
  await page.waitForTimeout(400)
  notSent = await vis(page.locator('tr', { hasText: '[Qualigrafo] Test e-mail' }).getByText('Not sent'), 500)
}
ok(notSent, 'the mailer marks e-mails Not sent while delivery is not configured')
ok(!(await vis(page.getByRole('button', { name: 'Retry' }), 500)), 'no Retry while delivery is not configured')
const digest = page.locator('tr', { hasText: 'Daily digest' }).first()
ok(await vis(digest) && await vis(digest.getByText('contractor@qualigrafo.test')), 'the contractor gets a daily digest instead of separate e-mails')
const reminder = page.getByRole('button', { name: /\[Qualigrafo\] Daily reminder/ }).first()
ok(await vis(reminder), 'members with Immediate notifications get the daily reminder')
await reminder.click()
const body = page.locator('pre.mailbody').first()
ok(await vis(body) && /PRJ-\d{3} — /.test(await body.innerText()) && (await body.innerText()).includes('never approves'), 'opening an e-mail shows its text grouped by project')
await page.getByLabel('E-mail status').selectOption('Not sent')
await page.waitForTimeout(600)
ok(await page.locator('tbody tr').count() > 0 && !(await vis(page.locator('tbody').getByText('Sent', { exact: true }), 500)), 'outbox filters by status')
await page.getByLabel('E-mail status').selectOption('all')
await page.waitForTimeout(500)
await shot('admin-mail')

await page.getByRole('button', { name: /Security log/ }).click()
ok(await vis(page.getByText(/Reminder schedule: daily reminders "off" -> "on"; time "08:00" -> "23:59"/)), 'schedule change in the security log (old -> new)')
ok(await vis(page.locator('td', { hasText: 'reminders.run' }).first()), 'manual run in the security log')

// ---- the run left in-app reminders and an audit entry in the project
await go('activity')
ok(await vis(page.getByText(/^Daily reminder: /).first()), 'in-app daily reminder in the update feed')
await go('audit')
ok(await vis(page.getByText(/Reminders \(manual run\):/).first()), 'the run is in the project audit trail')

// ---- mobile
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${BASE}#/admin`); await page.waitForTimeout(500)
await page.getByRole('button', { name: /E-mail & reminders/ }).click()
await page.waitForTimeout(600)
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'e-mail administration has no horizontal page scroll on mobile')
await shot('admin-mail-mobile')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
