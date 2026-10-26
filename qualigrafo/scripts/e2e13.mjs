// Run (fixtures loaded + preview server on :8081): node scripts/e2e13.mjs
// System & validation: installed version and code fingerprint, installation check (IQ) with PDF record, validation packs.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { INSECURE, CHROME, isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 10000)
const shot = (n) => page.screenshot({ path: `${OUT}/e2e13-${n}.png`, fullPage: true })
const openTab = async () => { await page.goto(`${BASE}#/admin`); await page.waitForTimeout(400); await page.getByRole('button', { name: /System & validation/ }).click(); await page.waitForTimeout(600) }
async function download(click) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), click()])
  const file = `${OUT}/${d.suggestedFilename()}`
  await d.saveAs(file)
  return { name: d.suggestedFilename(), pdf: fs.readFileSync(file).subarray(0, 5).toString() === '%PDF-' }
}

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
await loginAs(page, 'Consultant')
ok(!(await vis(page.locator('.side').getByRole('button', { name: 'Users & access' }), 600)), 'non-administrators have no system & validation page')

await switchRole(page, 'Owner / QA')
await openTab()
ok(await vis(page.locator('.kv').getByText(/Qualigrafo \d+\.\d+\.\d+/).first()), 'installed version shown')
ok(await vis(page.getByText(/^[0-9a-f]{64}$/).first()), 'code fingerprint shown')
ok(await vis(page.getByText(/\d+ requirements · \d+ OQ test cases/)), 'validation catalogue size shown')
ok(await page.getByRole('button', { name: 'IQ record (PDF)' }).isDisabled(), 'IQ record needs a completed installation check')

await page.getByRole('button', { name: 'Run installation check' }).click()
ok(await toast(/Installation check: (Pass|Fail)/), 'installation check executed')
// Test fixtures are present: outside production that is a warning (overall Pass); against a production-mode server
// (CI deployment stack) IQ-13 correctly fails, and it must be the only failure.
const failed = await page.locator('tbody tr', { has: page.getByText('Fail', { exact: true }) }).allInnerTexts()
ok(failed.every((t) => t.includes('IQ-13')), `installation check passes apart from test data in production${failed.length ? ' (IQ-13 failed as expected)' : ''}`)
const row = (id) => page.locator('tr', { hasText: id })
ok(await vis(row('IQ-05').getByText('Pass')) && await vis(row('IQ-05').getByText(/\d+ of \d+ applied/)), 'database migrations check shown as Pass')
ok(await vis(row('IQ-14').getByText('Warning')), 'missing SMTP shown as a warning')
ok(await vis(page.getByText(/^Overall (Pass|Fail)$/)), 'overall result shown')
const iq = await download(() => page.getByRole('button', { name: 'IQ record (PDF)' }).click())
ok(iq.pdf && iq.name === 'Qualigrafo_IQ.pdf', 'IQ record PDF downloaded')

const packs = page.locator('tr', { hasText: 'Qualigrafo_Validation_Pack_' })
if (await packs.count()) {
  const vp = await download(() => packs.first().getByRole('button', { name: 'PDF' }).click())
  ok(vp.pdf && vp.name.startsWith('Qualigrafo_Validation_Pack_'), `validation pack downloaded (${vp.name})`)
} else ok(await vis(page.getByText('No validation pack on this installation')), 'no validation pack yet: explained')
await shot('system')

await page.reload(); await page.waitForTimeout(400)
await page.getByRole('button', { name: /System & validation/ }).click()
ok(await vis(page.getByText(/^Overall (Pass|Fail)$/)), 'latest installation check kept after reload')
await page.getByRole('button', { name: /Security log/ }).click()
ok(await vis(page.locator('td', { hasText: 'iq.executed' }).first()) && await vis(page.getByText(/Installation qualification record IQ-/).first()), 'installation check and PDF in the security log')

await page.setViewportSize({ width: 390, height: 844 })
await openTab()
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'system & validation has no horizontal page scroll on mobile')
await shot('mobile')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
