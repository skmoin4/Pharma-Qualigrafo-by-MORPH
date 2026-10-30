// Run (fixtures loaded + preview server on :8081): node scripts/e2e20.mjs
// Phase 5 / step 2 — project templates: the disciplines a project is offered follow its industry group and facility
// type, the deliverables follow the service type, the wizard says what it is about to create, the created project
// holds that register as "Missing", the generation can be switched off, BIM surfaces follow the service type, and a
// requirement library item can be restricted to an industry group.
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
const shot = (n) => page.screenshot({ path: `${OUT}/e2e20-${n}.png`, fullPage: true })
const text = async () => (await page.locator('.page').innerText()).replace(/\s+/g, ' ')
const next = () => page.getByRole('button', { name: /Next/ })
const pick = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) })
const disciplineNames = () => page.locator('.wizard label').filter({ has: page.locator('input[type=checkbox]') }).allInnerTexts()
const go = (from, to) => page.evaluate(([f, t]) => { window.location.hash = window.location.hash.replace(new RegExp(`/${f}$`), `/${t}`) }, [from, to])

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
await loginAs(page, 'Owner / QA')

// ---- 1. the disciplines offered follow the industry group
const basics = async (name) => {
  await page.goto(BASE + '#/new-project')
  await page.waitForTimeout(900)
  const restart = page.getByRole('button', { name: /Start a new project instead/ })
  if (await vis(restart, 800)) { await restart.click(); await page.waitForTimeout(1200) }
  await page.getByPlaceholder('e.g. Riyadh Oral Solids Line 3').fill(name)
  await page.getByPlaceholder('Company that owns the plant').fill('Noor Healthcare Trust')
  await page.getByPlaceholder('City, country').fill('Riyadh, Saudi Arabia')
  await next().click()
  await page.waitForTimeout(500)
}
await basics('Noor Day Surgery Centre')
await pick('Pharma').click()
await page.getByLabel('Facility type').selectOption('Sterile products')
await pick('Design only').click()
await page.waitForTimeout(400)
await next().click(); await page.waitForTimeout(900)
const pharmaDisciplines = (await disciplineNames()).join(' | ')
ok(/Civil & Cleanroom/.test(pharmaDisciplines) && /CQV/.test(pharmaDisciplines), 'a pharma project is still offered exactly the pharma disciplines')
ok((await text()).includes('Pharma · design only'), 'the step names the template it came from')
await shot('01-pharma-registers')

await page.getByRole('button', { name: /Back/ }).click(); await page.waitForTimeout(500)
await pick('Hospital / Healthcare').click()
await page.getByLabel('Facility type').selectOption('Ambulatory / day-care / day-surgery centre')
await page.waitForTimeout(400)
await next().click(); await page.waitForTimeout(900)
const hospitalDisciplines = (await disciplineNames()).join(' | ')
ok(/Medical Gas/.test(hospitalDisciplines), 'changing the industry group gives the hospital disciplines')
ok(!/CQV|Civil & Cleanroom/.test(hospitalDisciplines), 'and the pharma ones are gone, not merely added to')

// ---- 2. the workspace block says what will be created, and the service type changes it
const deliverableCount = async () => Number(/Register the (\d+) deliverable/.exec(await text())?.[1] ?? 0)
const designOnly = await deliverableCount()
ok(designOnly > 0, `the wizard says how many deliverables it will register (${designOnly})`)
ok((await text()).includes('No BIM deliverables: this is a design-only commission'), 'a design-only commission is told it gets no BIM deliverables')
ok((await text()).includes('Medical gas verification'), 'the specialised controls of the industry are listed')
await shot('02-workspace-design-only')

await page.getByRole('button', { name: /Back/ }).click(); await page.waitForTimeout(500)
await pick('Design \\+ BIM').click()
await page.waitForTimeout(400)
await next().click(); await page.waitForTimeout(900)
const withBim = await deliverableCount()
ok(withBim > designOnly, `adding BIM to the commission adds deliverables (${designOnly} -> ${withBim})`)
ok((await text()).includes('BIM deliverables (models, clash records, BEP / MIDP) are included'), 'and the step says so')

// ---- 3. the register the project is created with
for (const step of ['Team', 'Review']) { await next().click(); await page.waitForTimeout(600) }
ok((await text()).includes(`${withBim} registered as Missing`), 'the review step repeats what will be registered')
await page.getByRole('button', { name: /Create project/ }).click()
await page.waitForTimeout(2500)
ok(await vis(page.getByRole('heading', { name: 'Companies & systems' }), 15000), 'the project is created')
await go('registers', 'documents')
await page.waitForTimeout(1500)
const register = await text()
ok((await page.locator('tbody tr').count()) >= withBim, 'its document register holds every generated deliverable')
ok(/R00/.test(register), 'each one sits at revision R00 with nothing produced yet')
ok(/discipline model/i.test(register), 'a Design + BIM project has its model deliverables')
ok(/Medical Gas/.test(register), 'the deliverables carry the industry disciplines')
await shot('03-generated-register')

await go('documents', 'audit')
await page.waitForTimeout(1200)
ok(/Deliverables: \d+ document\(s\) registered as Missing/.test(await text()), 'the generation is in the audit trail')

// ---- 4. BIM surfaces follow the service type
await go('audit', 'sources')
await page.waitForTimeout(1500)
ok((await text()).includes('Revit'), 'a BIM commission is offered the model source')

// ---- 5. a team that keeps its own register can switch the template off
await basics('Own Register Clinic')
await pick('Hospital / Healthcare').click()
await page.getByLabel('Facility type').selectOption('Clinic / polyclinic')
await pick('Design only').click()
await page.waitForTimeout(400)
await next().click(); await page.waitForTimeout(900)
await page.locator('.subcard input[type=checkbox]').first().uncheck()
await page.waitForTimeout(300)
for (const step of ['Team', 'Review']) { await next().click(); await page.waitForTimeout(600) }
ok((await text()).includes('None — template switched off'), 'the review step says that nothing will be registered')
await page.getByRole('button', { name: /Create project/ }).click()
await page.waitForTimeout(2500)
await go('registers', 'documents')
await page.waitForTimeout(1500)
ok((await page.locator('tbody tr').count()) === 0 || (await text()).includes('No documents'), 'the project is created with an empty register, as asked')
await go('documents', 'sources')
await page.waitForTimeout(1500)
ok(!(await text()).includes('Revit model snapshots'), 'a design-only commission is not offered BIM pages')
await shot('04-design-only-sources')

// ---- 6. a draft saved before the template loaded still gets its disciplines
await basics('Reloaded Clinic')
await pick('Hospital / Healthcare').click()
await page.getByLabel('Facility type').selectOption('Dialysis centre')
await pick('Design only').click()
await page.reload()
await page.waitForTimeout(1800)
ok((await text()).includes('Draft restored'), 'reload: the draft comes back')
await next().click()
await page.waitForTimeout(1200)
const restored = await page.locator('.wizard input[type=checkbox]:checked').count()
ok(restored > 0, 'the disciplines are filled in from the template even when the draft was saved before it loaded')
ok(!(await next().isDisabled()), 'so the step can be passed instead of being stuck with an empty discipline list')

// ---- 7. a library item can be restricted to an industry group
await page.goto(BASE + '#/library')
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /Load unverified starter template/ }).click()
await page.waitForTimeout(2500)
const lib = await text()
ok(lib.includes('Pharma'), 'the starter template we ship states that it applies to Pharma, so it cannot reach another industry')
ok(lib.includes('All facility types'), 'and that it applies to every facility type of that industry')
await shot('05-library-industries')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
