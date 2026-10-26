// Run (fixtures loaded + preview server on :8081): node scripts/e2e14.mjs
// Backups: tools and schedule, back up now with automatic test restore, manual test restore, history, IQ, mobile.
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
const shot = (n) => page.screenshot({ path: `${OUT}/e2e14-${n}.png`, fullPage: true })
const openTab = async () => { await page.goto(`${BASE}#/admin`); await page.waitForTimeout(400); await page.getByRole('button', { name: /^Backups$/ }).click(); await page.waitForTimeout(600) }

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
await loginAs(page, 'Contractor')
ok(!(await vis(page.locator('.side').getByRole('button', { name: 'Users & access' }), 600)), 'non-administrators have no backup page')

await switchRole(page, 'Owner / QA')
await openTab()
ok(await vis(page.getByText(/PostgreSQL \d+/).first()), 'backup tools shown')
ok(!(await vis(page.getByText('Backups cannot run'), 500)), 'tools usable for this database')
const hist = page.locator('section', { has: page.getByRole('heading', { name: 'Backup history' }) })
const histRows = () => hist.locator('tbody tr', { hasText: 'qualigrafo-' })
const before = await histRows().count()

// schedule
await page.getByRole('checkbox', { name: 'Daily backup' }).check()
await page.getByLabel('Time (site time zone)').fill('23:59')
await page.getByLabel('Keep (newest backups)').fill('7')
await page.getByRole('button', { name: 'Save schedule' }).click()
ok(await toast('Backup schedule saved'), 'backup schedule saved')

// back up now -> automatic test restore
await page.getByRole('button', { name: 'Back up now' }).click()
ok(await toast('Backup started'), 'backup started')
let verified = false
for (let i = 0; i < 60 && !verified; i++) { await page.waitForTimeout(1000); verified = await vis(histRows().first().getByText('Verified'), 300) }
ok(verified && await histRows().count() === before + 1, 'backup completed and verified by a test restore')
ok(await vis(histRows().first().getByText('Done')) && await vis(histRows().first().getByText(/\d+ file\(s\)/)), 'history shows status, size and files')
ok(await vis(page.getByText(/^Last verified backup/).locator('..').getByText(/qualigrafo-/)), 'last verified backup shown')
await histRows().first().getByRole('button', { name: /^qualigrafo-/ }).click()
ok(await vis(page.getByText(/Manifest SHA-256 [0-9a-f]{64}/)) && await vis(page.getByText(/Test restore into a temporary database/)), 'details: manifest checksum and test-restore result')

// manual test restore
await histRows().first().getByRole('button', { name: 'Test restore' }).click()
ok(await toast(/Test restore of qualigrafo-.* started/), 'manual test restore started')
let again = false
for (let i = 0; i < 60 && !again; i++) { await page.waitForTimeout(1000); again = await page.getByRole('button', { name: 'Back up now' }).isEnabled() && await vis(histRows().first().getByText('Verified'), 300) }
ok(again, 'manual test restore verified')
await shot('backups')

await page.reload(); await page.waitForTimeout(400)
await page.getByRole('button', { name: /^Backups$/ }).click(); await page.waitForTimeout(500)
ok(await page.getByRole('checkbox', { name: 'Daily backup' }).isChecked() && await page.getByLabel('Time (site time zone)').inputValue() === '23:59', 'schedule kept after reload')

await page.getByRole('button', { name: /Security log/ }).click()
ok(await vis(page.locator('td', { hasText: 'backup.created' }).first()) && await vis(page.locator('td', { hasText: 'backup.verified' }).first()), 'backup and test restore in the security log')
await page.getByRole('button', { name: /System & validation/ }).click()
await page.getByRole('button', { name: 'Run installation check' }).click()
await page.waitForTimeout(1500)
ok(await vis(page.locator('tr', { hasText: 'IQ-18' }).getByText('Pass', { exact: true }), 8000), 'installation check: verified backup less than 48 hours old')

await page.setViewportSize({ width: 390, height: 844 })
await openTab()
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'backups page has no horizontal page scroll on mobile')
await shot('mobile')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
