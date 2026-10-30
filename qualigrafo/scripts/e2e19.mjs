// Run (fixtures loaded + preview server on :8081): node scripts/e2e19.mjs
// Phase 5 / step 1 — project classification and the unified wizard: the four industry groups, facility lists that
// follow the chosen group, the custom facility type, the optional secondary sub-type, the mandatory service type,
// the BIM requirement block that only exists for a BIM service, the review screen, the portfolio filters, and
// changing the classification of an existing project as a new baseline.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { CHROME, INSECURE, isNoise, loginAs, vis } from './e2e-lib.mjs'

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
const shot = (n) => page.screenshot({ path: `${OUT}/e2e19-${n}.png`, fullPage: true })
const text = async () => (await page.locator('.page').innerText()).replace(/\s+/g, ' ')
const next = () => page.getByRole('button', { name: /Next/ })
const group = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) })
const facilities = () => page.getByLabel('Facility type').locator('option').allInnerTexts()

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
await loginAs(page, 'Owner / QA')

// ---- 1. the wizard opens and reaches the classification step
await page.goto(BASE + '#/new-project')
await page.waitForTimeout(900)
ok(await vis(page.getByRole('heading', { name: 'New project' })), 'the wizard opens')
await page.getByPlaceholder('e.g. Riyadh Oral Solids Line 3').fill('Jaipur Green Hydrogen Pilot')
await page.getByPlaceholder('Company that owns the plant').fill('Rajasthan Renewables Ltd')
await page.getByPlaceholder('City, country').fill('Jaipur, India')
await page.locator('.page select').first().selectOption('IN')
await next().click()
await page.waitForTimeout(500)
ok((await text()).includes('Scope & classification'), 'step 2 is the one classification step — no separate industry page')

// ---- 2. all four industry groups are offered, and nothing is pre-selected
for (const g of ['Energy & High-Tech', 'Hospital / Healthcare', 'Pharma', 'Common buildings']) {
  ok(await vis(group(g)), `industry group offered: ${g}`)
}
ok(await next().isDisabled() && (await text()).includes('Choose the industry group'), 'the industry group is a choice: nothing is pre-selected and the step says so')
ok(await page.getByLabel('Facility type').isDisabled(), 'the facility list stays disabled until a group is chosen')
await shot('01-industry-groups')

// ---- 3. the facility list follows the industry group
await group('Hospital / Healthcare').click()
await page.waitForTimeout(300)
const hospital = await facilities()
ok(hospital.includes('Multi-speciality hospital') && !hospital.includes('API'), 'hospital facilities are offered and pharma ones are not')
await group('Energy & High-Tech').click()
await page.waitForTimeout(300)
const energy = await facilities()
ok(energy.includes('Solar PV – rooftop') && energy.some((x) => x.startsWith('Semiconductor')), 'energy & high-tech covers both solar / renewable and semiconductor')
ok(!energy.includes('Multi-speciality hospital'), 'changing the group replaces the facility list, it does not add to it')
ok((await page.getByLabel('Facility type').inputValue()) === '', 'changing the group clears a facility chosen for the previous one')
ok(energy.at(-1) === 'Other / custom facility', 'every group ends with "Other / custom facility"')

// ---- 4. the custom facility type has to be named
await page.getByLabel('Facility type').selectOption('Other / custom facility')
await page.waitForTimeout(300)
ok(await vis(page.getByLabel('Name of the custom facility')), 'choosing the custom entry asks for the name')
ok(await next().isDisabled() && (await text()).includes('Name the custom facility type'), 'an unnamed custom facility blocks the step, and says why')
await page.getByLabel('Name of the custom facility').fill('Green hydrogen pilot and test loop')
await page.waitForTimeout(250)
ok(!(await text()).includes('Name the custom facility type'), 'naming it clears the message')

// ---- 5. the service type is mandatory, and the BIM block belongs to it
ok(await next().isDisabled() && (await text()).includes('Choose the service type'), 'the service type is mandatory — an enquiry can be design, BIM, or both')
ok(!(await vis(page.getByLabel('Level of development'), 800)), 'no BIM requirement is asked for before a service type is chosen')
await group('Design only').click()
await page.waitForTimeout(300)
ok(!(await vis(page.getByLabel('Level of development'), 800)), 'Design only: the BIM block stays hidden')
ok(!(await next().isDisabled()), 'Design only: the step is complete')
await group('Design \\+ BIM').click()
await page.waitForTimeout(300)
ok(await vis(page.getByLabel('Level of development')), 'Design + BIM: the BIM requirement block appears')
await page.getByLabel('Level of development').selectOption('LOD 400')
await page.getByLabel('Coordination / clash detection').selectOption('Yes')
await page.getByLabel('Asset / handover deliverable').selectOption('COBie + as-built')
await shot('02-classification-complete')

// ---- 6. the secondary sub-type is optional and cannot repeat the primary one
const secondary = await page.getByLabel('Secondary sub-type').locator('option').allInnerTexts()
ok(secondary[0] === 'None', 'the secondary sub-type is optional')
ok(!secondary.includes('Other / custom facility'), 'the custom entry is not offered as a secondary sub-type')
await page.getByLabel('Secondary sub-type').selectOption('Battery energy storage system (BESS)')

// ---- 7. the stage list is the client's, and the review screen shows the whole classification
const stages = await page.getByLabel('Project stage').locator('option').allInnerTexts()
ok(stages.includes('Concept') && stages.includes('GFC / IFC') && stages.includes('Handover / FM'), 'the project stages are the ten the client listed')
await page.getByLabel('Project stage').selectOption('Detailed design')
for (const step of ['Registers', 'Team', 'Review']) {
  await next().click()
  await page.waitForTimeout(600)
}
const review = await text()
ok(review.includes('Energy & High-Tech') && review.includes('Green hydrogen pilot and test loop'), 'review: the industry group and the custom facility name are shown')
ok(review.includes('Battery energy storage system (BESS)') && review.includes('Design + BIM'), 'review: the secondary sub-type and the service type are shown')
ok(review.includes('LOD 400') && review.includes('COBie + as-built'), 'review: the BIM requirement is part of the record')
await shot('03-review-classification')

await page.getByRole('button', { name: /Create project/ }).click()
await page.waitForTimeout(2500)
ok(await vis(page.getByRole('heading', { name: 'Companies & systems' }), 15000), 'a non-pharma project is created and opens on its registers')

// ---- 8. the classification is on the project, in the audit trail, and in the header
await page.evaluate(() => { window.location.hash = window.location.hash.replace(/\/registers$/, '/overview') })
await page.waitForTimeout(1200)
ok((await text()).includes('Energy & High-Tech'), 'the project header states the industry, the facility and the service type')
await page.evaluate(() => { window.location.hash = window.location.hash.replace(/\/overview$/, '/audit') })
await page.waitForTimeout(1200)
const audit = await text()
ok(audit.includes('Energy & High-Tech · Green hydrogen pilot and test loop'), 'creation is recorded with the classification, not only the name')

// ---- 9. the classification can be changed, and that is a new baseline
await page.evaluate(() => { window.location.hash = window.location.hash.replace(/\/audit$/, '/setup') })
await page.waitForTimeout(1200)
ok(await vis(page.getByLabel('Industry group')), 'the set-up page edits the same classification')
await page.getByLabel('Project stage').selectOption('Tender')
await page.getByRole('textbox', { name: /Change rationale/ }).fill('Design issued for tender')
await page.getByRole('button', { name: /Save as new baseline/ }).click()
await page.waitForTimeout(1800)
await page.evaluate(() => { window.location.hash = window.location.hash.replace(/\/setup$/, '/audit') })
await page.waitForTimeout(1200)
ok((await text()).includes('project stage "Detailed design" -> "Tender"'), 'a classification change is logged old -> new on the new baseline')
await shot('04-classification-changed')

// ---- 10. the portfolio can be filtered by the classification
await page.goto(BASE + '#/')
await page.waitForTimeout(1500)
const rowsNow = await page.locator('tbody tr.clickrow').count()
await page.getByLabel('Industry').selectOption('Energy & High-Tech')
await page.waitForTimeout(500)
ok((await page.locator('tbody tr.clickrow').count()) === 1, 'filtering by industry leaves only the energy project')
ok((await text()).includes('1 of'), 'the portfolio says how many of how many are shown')
await page.getByLabel('Service').selectOption('Design only')
await page.waitForTimeout(500)
ok((await text()).includes('No project matches these filters'), 'filters combine, and an empty result says so instead of looking like an empty portfolio')
await page.getByRole('button', { name: 'Clear filters' }).click()
await page.waitForTimeout(500)
ok((await page.locator('tbody tr.clickrow').count()) === rowsNow, 'clearing the filters brings every project back')
await shot('05-portfolio-filters')

// ---- 11. a pharma project is untouched by any of this
await page.getByLabel('Industry').selectOption('Pharma')
await page.waitForTimeout(500)
ok((await text()).includes('Non-sterile formulation') || (await text()).includes('API'), 'the pharma projects carry their original facility type after the migration')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
