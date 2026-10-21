// Run (fixtures loaded + preview server on :8081): node scripts/e2e8.mjs
// Editing records after creation (RFI, risk, NCR, corrective action) with a reason and old -> new audit,
// and raising a consistency finding manually.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
page.on('dialog', (d) => d.accept())
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 6000)
const go = async (p) => { await page.goto(`${BASE}#/p/PRJ-026/${p}`); await page.waitForTimeout(500) }

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()

// ---- contractor raises an RFI and corrects it
await loginAs(page, 'Contractor')
await go('rfis')
await page.getByRole('button', { name: 'Raise RFI' }).click()
await page.getByPlaceholder('Question — include drawing / revision reference').fill('Confirm AHU-01 filter grade')
await page.locator('section.card select').nth(0).selectOption({ index: 1 })
await page.locator('section.card select').nth(1).selectOption({ index: 1 })
await page.getByRole('button', { name: 'Submit RFI' }).click()
ok(await toast('RFI raised'), 'contractor raised an RFI')
const row = page.locator('tr', { hasText: 'Confirm AHU-01 filter grade' })
const rfiId = (await row.locator('small').first().innerText()).split(' ')[0]
await row.getByRole('button', { name: 'Edit' }).click()
await page.getByLabel(`${rfiId} question`).fill('Confirm AHU-01 final filter grade (H13 or H14) per drawing HV-101 R02')
await page.getByRole('button', { name: 'Save changes' }).click()
ok(await toast('State the reason'), 'edit refused without a reason')
await page.getByLabel(`${rfiId} change reason`).fill('Added drawing reference')
await page.getByRole('button', { name: 'Save changes' }).click()
ok(await toast(`${rfiId} updated`), 'requester edited the RFI question')
ok(await vis(page.getByText('Confirm AHU-01 final filter grade (H13 or H14)')), 'RFI shows the new question')

await go('actions')
ok(!(await vis(page.getByRole('button', { name: /^Edit GAP-/ }), 800)), 'contractor cannot edit corrective actions')
await go('findings')
ok(!(await vis(page.getByRole('button', { name: 'Raise finding' }), 800)), 'contractor cannot raise findings')

// ---- consultant: answered RFI keeps its question, risks / NCRs / actions edited with reasons
await switchRole(page, 'Consultant')
await go('rfis')
const r2 = page.locator('tr', { hasText: 'Confirm AHU-01 final filter grade' })
await r2.getByPlaceholder('Response…').fill('H14, per URS section 6.2')
await r2.getByRole('button', { name: 'Record response' }).click()
ok(await toast('Response recorded'), 'RFI answered')
await page.locator('tr', { hasText: 'Confirm AHU-01 final filter grade' }).getByRole('button', { name: 'Edit' }).click()
ok(await page.getByLabel(`${rfiId} question`).isDisabled(), 'answered RFI: question locked in the editor')
await page.getByRole('button', { name: 'Cancel' }).click()

await go('risks')
await page.locator('tr.clickrow').first().click()
const riskId = (await page.locator('tr.clickrow').first().locator('small').first().innerText()).split(' ')[0]
await page.getByRole('button', { name: `Edit ${riskId}` }).click()
await page.getByLabel(`${riskId} likelihood`).selectOption('1')
await page.getByLabel(`${riskId} owner`).fill('QA Lead')
await page.getByLabel(`${riskId} change reason`).fill('Mitigation trial passed, likelihood re-rated')
await page.getByRole('button', { name: 'Save changes' }).click()
ok(await toast(`${riskId} updated`), 'risk re-rated and reassigned')

await go('ncrs')
const crit = page.locator('section.card', { has: page.locator('.badge', { hasText: 'Critical' }) }).filter({ hasNot: page.locator('.badge', { hasText: 'Closed' }) }).first()
const ncrId = (await crit.locator('h2').innerText()).split(' ')[0]
await crit.getByRole('button', { name: `Edit ${ncrId}` }).click()
ok(await page.getByLabel(`${ncrId} severity`).isDisabled(), 'consultant cannot downgrade a Critical NCR')
await page.getByLabel(`${ncrId} response due`).fill('2027-01-15')
await page.getByLabel(`${ncrId} change reason`).fill('Contractor shutdown window agreed')
await page.getByRole('button', { name: 'Save changes' }).click()
ok(await toast(`${ncrId} updated`), 'NCR response date moved with a reason')
ok(await vis(page.locator('section.card', { hasText: ncrId }).getByText('2027-01-15').first()), 'NCR shows the new due date')

await go('actions')
const gap = page.locator('tr', { has: page.getByRole('button', { name: /^Edit GAP-/ }) }).first()
const gapId = (await gap.getByRole('button', { name: /^Edit GAP-/ }).getAttribute('aria-label')).slice(5)
await gap.getByRole('button', { name: `Edit ${gapId}` }).click()
await page.getByLabel(`${gapId} owner`).fill('EquipCo')
await page.getByLabel(`${gapId} priority`).selectOption('High')
await page.getByLabel(`${gapId} change reason`).fill('Vendor owns the correction')
await page.getByRole('button', { name: 'Save changes' }).click()
ok(await toast(`${gapId} updated`), 'corrective action reassigned')

// ---- manual finding
await go('findings')
await page.getByRole('button', { name: 'Raise finding' }).click()
await page.getByLabel('Finding title').fill('Pump duty point differs between datasheet and P&ID')
await page.getByLabel('Finding severity').selectOption('High')
await page.getByLabel('Finding document').selectOption({ index: 1 })
await page.getByLabel('Finding compared values').fill('Datasheet: 12 m3/h @ 40 m · P&ID R03: 15 m3/h @ 40 m')
await page.locator('section.card').getByRole('button', { name: 'Raise finding' }).click()
ok(await toast('Finding raised'), 'finding raised manually')
const card = page.locator('section.card', { hasText: 'Pump duty point differs' })
ok(await vis(card.getByText('Consultant ·').first()), 'manual finding shows who raised it')
await card.getByPlaceholder('Disposition rationale…').fill('P&ID corrected to 12 m3/h in R04')
await card.getByRole('button', { name: 'Resolve' }).click()
ok(await toast('Finding resolved'), 'manual finding dispositioned')
await page.screenshot({ path: `${OUT}/e8-findings.png`, fullPage: true })

// ---- audit trail shows old -> new with reasons
await go('audit')
ok(await vis(page.getByText(new RegExp(`${riskId} edited: .*likelihood .* -> "1".*Reason: Mitigation trial passed`)).first()), 'audit trail: risk edit with old -> new and reason')
ok(await vis(page.getByText(new RegExp(`${gapId} edited: owner .* -> "EquipCo"`)).first()), 'audit trail: action reassignment')

await page.setViewportSize({ width: 390, height: 844 })
await go('ncrs')
await page.getByRole('button', { name: /^Edit NCR-/ }).first().click()
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'NCR editor has no horizontal page scroll on mobile')
await page.screenshot({ path: `${OUT}/e8-ncr-mobile.png`, fullPage: true })

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
