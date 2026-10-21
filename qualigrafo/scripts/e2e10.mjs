// Run (fixtures loaded + preview server on :8081): node scripts/e2e10.mjs
// PDF reports (handover dossier, audit package) and document transmittals (issue, vendor receipt, PDF).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
page.on('dialog', (d) => d.accept())
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 6000)
const go = async (p) => { await page.goto(`${BASE}#/p/PRJ-026/${p}`); await page.waitForTimeout(500) }
/** Click, wait for the browser download, return its name and whether the bytes are a PDF. */
async function download(click) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), click()])
  const file = `${OUT}/${d.suggestedFilename()}`
  await d.saveAs(file)
  const head = fs.readFileSync(file).subarray(0, 5).toString()
  return { name: d.suggestedFilename(), pdf: head === '%PDF-', size: fs.statSync(file).size }
}

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()

// ---- contractor: no reports, no transmittal issuing
await loginAs(page, 'Contractor')
await go('handover')
ok(!(await vis(page.getByRole('button', { name: /Handover dossier \(PDF\)/ }), 800)), 'contractor has no handover dossier button')
await go('transmittals')
ok(!(await vis(page.getByRole('button', { name: 'New transmittal' }), 800)), 'contractor cannot issue transmittals')

// ---- consultant: handover dossier and audit package PDFs
await switchRole(page, 'Consultant')
await go('handover')
const hd = await download(() => page.getByRole('button', { name: /Handover dossier \(PDF\)/ }).click())
ok(hd.pdf && /^PRJ-026_Handover_Dossier\.pdf$/.test(hd.name) && hd.size > 5000, `handover dossier downloaded (${hd.name}, ${Math.round(hd.size / 1024)} KB)`)
await go('packages')
await page.getByRole('button', { name: /Freeze/ }).first().click()
await page.waitForTimeout(600)
const ap = await download(() => page.getByRole('button', { name: 'PDF' }).first().click())
ok(ap.pdf && /^PRJ-026_AUD-\d{3}_B\d+\.pdf$/.test(ap.name), `audit package PDF downloaded (${ap.name})`)

// ---- consultant issues a transmittal to AirCo
await go('transmittals')
await page.getByRole('button', { name: 'New transmittal' }).click()
await page.getByLabel('Transmittal recipient').selectOption('AirCo')
await page.getByLabel('Transmittal purpose').selectOption('For construction')
await page.getByLabel('Transmittal remarks').fill('Issued for AHU installation')
ok(await page.getByRole('button', { name: 'Issue transmittal' }).isDisabled(), 'transmittal needs at least one document')
const boxes = page.getByRole('checkbox', { name: /^Include DOC-/ })
await boxes.nth(0).check()
await boxes.nth(1).check()
await page.getByRole('button', { name: 'Issue transmittal' }).click()
ok(await toast('Transmittal issued'), 'transmittal issued')
const row = page.locator('tr', { hasText: 'TRN-001' })
ok(await vis(row.getByText('AirCo')) && await vis(row.getByText('Awaiting receipt')), 'TRN-001 listed, awaiting receipt')
const tp = await download(() => row.getByRole('button', { name: 'PDF' }).click())
ok(tp.pdf && tp.name === 'PRJ-026_TRN-001.pdf', 'transmittal PDF downloaded')
await page.screenshot({ path: `${OUT}/e10-transmittals.png`, fullPage: true })

// ---- vendor (AirCo) acknowledges receipt
await switchRole(page, 'Vendor')
await go('transmittals')
ok(await vis(page.locator('.side').getByText('Transmittals')), 'vendor navigation includes Transmittals')
await page.getByRole('button', { name: 'TRN-001' }).click()
await page.getByLabel('Receipt remark').fill('Received complete')
await page.getByRole('button', { name: 'Acknowledge receipt' }).click()
ok(await toast('TRN-001 receipt acknowledged'), 'vendor acknowledged receipt')
ok(await vis(page.locator('tr', { hasText: 'TRN-001' }).getByText('Acknowledged')), 'transmittal shows acknowledged')
const vp = await download(() => page.locator('tr', { hasText: 'TRN-001' }).getByRole('button', { name: 'PDF' }).click())
ok(vp.pdf, 'vendor downloads the acknowledged transmittal PDF')

// ---- report generation is in the audit trail
await switchRole(page, 'Consultant')
await go('audit')
ok(await vis(page.getByText(/Report generated: Handover dossier HOD-.*SHA-256 [0-9a-f]{64}/).first()), 'audit trail records the report with its SHA-256')
ok(await vis(page.getByText(/TRN-001 issued to AirCo \(For construction\)/).first()), 'audit trail records the transmittal')

await page.setViewportSize({ width: 390, height: 844 })
await go('transmittals')
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'transmittals page has no horizontal page scroll on mobile')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
