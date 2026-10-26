// Run (fixtures loaded + preview server on :8081): node scripts/e2e4.mjs  - project lifecycle through the real UI
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
const next = () => page.getByRole('button', { name: /^Next/ }).click()
/** Pick a person in a team row by e-mail (option values are user ids). */
const pickPerson = async (label, email) => {
  const value = await page.locator(`select[aria-label="${label}"] option`, { hasText: email }).first().getAttribute('value')
  await page.selectOption(`select[aria-label="${label}"]`, value)
}

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()

// ---- who may create
await loginAs(page, 'Consultant')
ok(!(await page.getByRole('button', { name: 'New project' }).isVisible()), 'consultant without Owner / QA rights sees no "New project"')
await switchRole(page, 'Owner / QA')
await page.goto(BASE + '#/')
ok(await vis(page.getByRole('button', { name: 'New project' })), 'Owner / QA sees "New project"')

// ---- wizard
await page.getByRole('button', { name: 'New project' }).click()
ok(await vis(page.getByRole('heading', { name: 'New project' })), 'wizard opens')
ok(await page.getByRole('button', { name: /^Next/ }).isDisabled() && await vis(page.getByText(/Still needed: Project name/)), 'basics: Next blocked until required fields are filled')
await page.getByPlaceholder('e.g. Riyadh Oral Solids Line 3').fill('Dammam Sterile Fill-Finish')
await page.getByPlaceholder('Company that owns the plant').fill('Gulf Biologics Co')
await page.getByPlaceholder('City, country').fill('Dammam, Saudi Arabia')
await next()
await page.getByLabel('Facility type').selectOption('Sterile products')
await page.getByLabel('Project scope').selectOption('New plant')
await page.locator('label', { hasText: 'European Union' }).locator('input').check()
await next()
await page.locator('label', { hasText: 'Fire & Life Safety' }).locator('input').uncheck()
await page.getByRole('button', { name: 'Add company' }).click()
await page.getByLabel('Company 1 name').fill('BuildCo')
await page.getByRole('button', { name: 'Add company' }).click()
await page.getByLabel('Company 2 name').fill('AirCo')
await page.getByLabel('Company 2 type').selectOption('Vendor / supplier')
await next()
ok(await page.getByLabel('Role of team member 1').inputValue() === 'Owner / QA', 'team: creator pre-filled as Owner / QA')
await page.getByRole('button', { name: 'Add person' }).click()
await pickPerson('Team member 2', 'consultant@qualigrafo.test')
await page.getByLabel('Role of team member 2').selectOption('Consultant')
await page.getByRole('button', { name: 'Add person' }).click()
await pickPerson('Team member 3', 'vendor@qualigrafo.test')
await page.getByLabel('Record access of team member 3').selectOption('AirCo')
await next()
ok(await vis(page.getByText('Gulf Biologics Co, BuildCo, AirCo')), 'review lists the companies')
await page.screenshot({ path: `${OUT}/s15-wizard-review.png` })
await page.getByRole('button', { name: 'Create project' }).click()
ok(await vis(page.getByRole('heading', { name: 'Companies & systems' })), 'created project opens on its registers')
ok(await vis(page.locator('.crumb').getByText('Dammam Sterile Fill-Finish')), 'new project is the open workspace')
// a new project is empty: the overview says what still has to be set up
await page.goto(BASE + '#/p/PRJ-032/overview'); await page.waitForTimeout(500)
const setup = page.locator('section', { has: page.getByRole('heading', { name: /Finish the project set-up/ }) })
ok(await vis(setup), 'new project: the overview lists the remaining set-up steps')
ok(await vis(setup.getByText('Register the systems and equipment')) && await vis(setup.getByText('Decide applicability')), 'new project: systems and applicability are named as open steps')
await page.goto(BASE + '#/p/PRJ-026/overview'); await page.waitForTimeout(500)
ok(!(await vis(page.getByRole('heading', { name: /Finish the project set-up/ }), 800)), 'a project in use does not show the set-up checklist')
await page.goto(BASE + '#/p/PRJ-032/registers'); await page.waitForTimeout(400)
await page.getByRole('button', { name: /Disciplines/ }).click()
ok(!(await page.locator('tbody').getByText('Fire & Life Safety').isVisible()) && await vis(page.locator('tbody').getByText('CQV')), 'only the chosen disciplines were created')

// ---- team management
await page.goto(BASE + '#/p/PRJ-032/team'); await page.waitForTimeout(400)
ok((await page.locator('section', { hasText: 'Project team' }).locator('tbody tr').count()) === 3, 'team page lists the three members')
await page.getByLabel('Record access of Demo Vendor (AirCo)').selectOption('')
await page.getByLabel('Record access of Demo Vendor (AirCo)').selectOption('BuildCo')
await page.locator('tr', { hasText: 'Demo Vendor (AirCo)' }).getByRole('button', { name: 'Save' }).click()
ok(await vis(page.getByText('Demo Vendor (AirCo): Contractor (only BuildCo)')), 'Owner / QA changes a member\'s record access')
await page.locator('tr', { hasText: 'Demo Vendor (AirCo)' }).getByRole('button', { name: 'Remove' }).click()
await page.waitForTimeout(400)
ok((await page.locator('section', { hasText: 'Project team' }).locator('tbody tr').count()) === 2, 'member removed')
await page.getByRole('button', { name: 'Add person' }).click()
await pickPerson('Person to add', 'contractor@qualigrafo.test')
await page.getByRole('button', { name: 'Add to team' }).click()
ok(await vis(page.locator('tr', { hasText: 'contractor@qualigrafo.test' })), 'person added from the directory')
await page.screenshot({ path: `${OUT}/s15-team.png` })

// ---- details, archive, restore
await page.goto(BASE + '#/p/PRJ-032/setup'); await page.waitForTimeout(300)
await page.getByLabel('Project name').fill('Dammam Sterile Fill-Finish Phase 1')
await page.getByRole('button', { name: 'Save details' }).click()
ok(await vis(page.locator('.crumb').getByText('Dammam Sterile Fill-Finish Phase 1')), 'project renamed')
await page.getByLabel('Archive reason').fill('Project cancelled by client')
await page.getByRole('button', { name: 'Archive project' }).click()
ok(await vis(page.getByText('Archived · read-only.')), 'archived banner shown')
await page.goto(BASE + '#/p/PRJ-032/registers'); await page.waitForTimeout(300)
await page.getByRole('button', { name: /Systems & equipment/ }).click()
await page.getByLabel('New system tag').fill('FL-01')
await page.getByLabel('New system description').fill('Filling line')
await page.getByRole('button', { name: 'Add system' }).click()
ok(await vis(page.locator('.toastmsg', { hasText: 'archived and read-only' })), 'archived project refuses changes in the UI')
await page.goto(BASE + '#/')
await page.waitForTimeout(300)
ok(!(await page.locator('tbody').getByText('Dammam Sterile Fill-Finish Phase 1').isVisible()), 'archived project hidden from the active portfolio')
await page.getByRole('button', { name: /Archived \(1\)/ }).click()
ok(await vis(page.locator('tbody').getByText('Dammam Sterile Fill-Finish Phase 1')), 'archived project listed under Archived')
await page.goto(BASE + '#/p/PRJ-032/setup'); await page.waitForTimeout(300)
await page.getByLabel('Restore reason').fill('Budget re-approved')
await page.getByRole('button', { name: 'Restore project' }).click()
ok(await vis(page.getByRole('button', { name: 'Archive project' })), 'project restored')

ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
