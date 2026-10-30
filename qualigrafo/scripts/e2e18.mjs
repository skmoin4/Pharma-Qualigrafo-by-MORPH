// Run (fixtures loaded + preview server on :8081): node scripts/e2e18.mjs
// Phase 5 / step 0 — the client's own test case and the first-contact fixes it exposed:
// the wizard reaches the end with their configuration, the draft survives a reload, a disabled "Next" says why,
// project creation is reachable from the sidebar, an unknown address says so, and a project created while no
// library version is approved tells the user that it has no requirements and why.
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
const shot = (n) => page.screenshot({ path: `${OUT}/e2e18-${n}.png`, fullPage: true })
const text = async () => (await page.locator('.page').innerText()).replace(/\s+/g, ' ')
const curStep = () => page.locator('.step.cur').first().innerText()
const country = () => page.locator('.page select').first().inputValue()
const next = () => page.getByRole('button', { name: /Next/ })

await page.goto(BASE + '#/'); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() }); await page.reload()
await loginAs(page, 'Owner / QA')

// ---- 1. project creation is reachable without knowing a URL (the client could not find it)
const sidebarCreate = page.locator('.side').getByRole('button', { name: 'Start a project', exact: true })
ok(await vis(sidebarCreate), 'sidebar: a user who may create projects has a Start a project action')
await sidebarCreate.click()
await page.waitForTimeout(700)
ok(await vis(page.getByRole('heading', { name: 'New project' })), 'sidebar: the action opens the wizard')
ok(page.url().endsWith('#/new-project'), 'wizard: has its own address')

// ---- 2. the short address people guess resolves instead of silently showing the portfolio
await page.evaluate(() => { window.location.hash = '#/new' })
await page.waitForTimeout(700)
ok(await vis(page.getByRole('heading', { name: 'New project' })), 'routing: #/new opens the wizard too')
await page.evaluate(() => { window.location.hash = '#/does-not-exist' })
await page.waitForTimeout(700)
// the notice is a shell-level banner, like the load error, so it sits beside <main> rather than inside it
ok(((await page.locator('body').innerText()).replace(/\s+/g, ' ')).includes('That address does not exist'), 'routing: an unknown address says so instead of showing the portfolio in silence')
ok(await vis(page.getByRole('heading', { name: 'Portfolio' })), 'routing: and still shows the portfolio underneath')
await shot('01-unknown-address')

// ---- 3. a disabled Next names the reason, and every field carries its own message
await page.locator('.side').getByRole('button', { name: 'Start a project', exact: true }).click()
await page.waitForTimeout(700)
ok(await next().isDisabled(), 'step 1: Next is disabled while the step is incomplete')
ok((await text()).includes('Project name needs at least 3 characters'), 'step 1: the reason is on screen, not only in a tooltip')
await page.getByPlaceholder('e.g. Riyadh Oral Solids Line 3').fill('De')
await page.waitForTimeout(250)
ok((await text()).includes('Project name needs at least 3 characters'), 'step 1: too short a name is reported on the field')

// ---- 4. the client's own configuration: Demo Project / Demo Client / India / Non-sterile / New plant / Design
await page.getByPlaceholder('e.g. Riyadh Oral Solids Line 3').fill('Demo Project')
await page.getByPlaceholder('Company that owns the plant').fill('Demo Client')
await page.getByPlaceholder('City, country').fill('India')
await page.locator('.page select').first().selectOption('IN')
await page.waitForTimeout(250)
ok(!(await next().isDisabled()), 'step 1: complete data enables Next')
ok(!(await text()).includes('needs at least 3 characters'), 'step 1: the field message disappears once the field is right')
await shot('02-step1-client-configuration')

await next().click(); await page.waitForTimeout(500)
ok((await curStep()).includes('Scope & classification'), 'Next moves forward to step 2, never backwards')
// Phase 5 / step 1: the industry group and the service type are a choice, so the step cannot pass without them.
ok(await next().isDisabled(), 'step 2: Next is blocked until the project is classified')
ok((await text()).includes('Choose the industry group'), 'step 2: and says that the industry group is what is missing')
await page.getByRole('button', { name: /^Pharma/ }).click()
await page.getByLabel('Facility type').selectOption('Non-sterile formulation')
await page.waitForTimeout(250)
ok((await text()).includes('Choose the service type'), 'step 2: with an industry chosen, the service type is named as the next thing needed')
await page.getByRole('button', { name: /^Design only/ }).click()
await page.waitForTimeout(250)
ok(!(await next().isDisabled()), 'step 2: a complete classification opens the way forward')
const marketRow = page.locator('label', { hasText: 'India' }).first()
ok(await marketRow.locator('input[type=checkbox]').isChecked(), 'step 2: the plant country is already a target market')
ok(await marketRow.locator('input[type=checkbox]').isDisabled(), 'step 2: and cannot be unticked, because it is always in scope')

// ---- 5. the draft survives a reload — the defect behind "my country reset and my entries were lost"
await page.reload()
await page.waitForTimeout(1500)
ok((await curStep()).includes('Scope & classification'), 'reload: the wizard comes back on the step it was left on')
ok((await text()).includes('Draft restored'), 'reload: the restored draft is announced')
await page.getByRole('button', { name: /Back/ }).click()
await page.waitForTimeout(500)
ok((await country()) === 'IN', 'reload: the chosen country is still India, not the default')
ok((await page.getByPlaceholder('e.g. Riyadh Oral Solids Line 3').inputValue()) === 'Demo Project', 'reload: the typed project name is still there')
await next().click()
await page.waitForTimeout(500)
ok((await page.getByLabel('Facility type').inputValue()) === 'Non-sterile formulation', 'reload: the classification survives too, not only the basics')
await shot('03-draft-restored-after-reload')

// ---- 6. walk to the end and create the project
for (const step of ['Registers', 'Team', 'Review']) {
  const b = next()
  ok(!(await b.isDisabled()), `step ${step}: nothing blocks the way forward`)
  await b.click()
  await page.waitForTimeout(600)
}
ok((await curStep()).includes('Review'), 'the wizard reaches the Review step')
const summary = await text()
ok(summary.includes('Demo Project') && summary.includes('Demo Client'), 'review: shows what will be created')
ok(summary.includes('No approved pack'), 'review: says in advance that no requirements will arrive for India')
await shot('04-review')

await page.getByRole('button', { name: /Create project/ }).click()
await page.waitForTimeout(2500)
ok(await vis(page.getByRole('heading', { name: 'Companies & systems' }), 12000), 'the project is created and opens on its registers')

// ---- 7. the empty project says it is empty, and why — instead of looking merely unused
await page.evaluate(() => { window.location.hash = window.location.hash.replace(/\/registers$/, '/overview') })
await page.waitForTimeout(1200)
const ov = await text()
ok(ov.includes('Finish the project set-up'), 'overview: the new project shows the set-up checklist')
ok(ov.includes('This project has no requirements, and cannot get any yet'), 'overview: an empty project says it cannot get requirements yet')
ok(ov.includes('India'), 'overview: and names the market that has nothing approved')
ok(ov.includes('four-eyes') || ov.includes('two library editors'), 'overview: and explains that approval needs a second editor')
await shot('05-empty-project-explains-itself')

// ---- 8. the requirement library states the same blocker at its source
await page.evaluate(() => { window.location.hash = '#/library' })
await page.waitForTimeout(1200)
const lib = await text()
ok(lib.includes('No version is approved yet'), 'library: says that no project can receive a requirement yet')
ok(lib.includes('cannot') && lib.includes('four-eyes'), 'library: states the four-eyes rule as the blocker it is')
ok(lib.includes('temporary password'), 'library: warns that an invited account that never signed in does not count')
await shot('06-library-blocker')

// ---- 9. Users & access surfaces accounts that were invited but never used
await page.evaluate(() => { window.location.hash = '#/admin' })
await page.waitForTimeout(1500)
const admin = await text()
ok(admin.includes('Two are needed for the four-eyes rule'), 'users: the administrator count explains why two are needed')
ok(!/invited accounts? ha(s|ve) never been used/.test(admin), 'users: no stuck-account warning while every account can sign in')
await shot('07-users-and-access')

// ---- 10. an administrator is told about the projects that are missing from their own portfolio
await page.evaluate(() => { window.location.hash = '#/' })
await page.waitForTimeout(1500)
const otherCard = page.locator('section', { has: page.getByRole('heading', { name: /Other projects on this installation/ }) })
ok(await vis(otherCard), 'portfolio: an administrator gets the projects outside their own portfolio')
const otherText = (await otherCard.innerText()).replace(/\s+/g, ' ')
ok(/you are not a member of/.test(otherText), 'administrator view says what the list is: projects without a membership of theirs')
// the fixture administrator is on every project, so the honest answer here is "nothing is hidden from you"
ok(otherText.includes('You are a member of every project on this installation'), 'administrator view says so plainly when nothing is hidden')
const rowsOnPage = await page.locator('tbody tr').count()
const rowsInCard = await otherCard.locator('tbody tr').count()
ok(rowsOnPage > rowsInCard, `and the portfolio above still lists the administrator's own projects (${rowsOnPage} rows on the page, ${rowsInCard} in this card)`)
await shot('08-other-projects-admin-view')

// ---- 11. cancelling the wizard drops the draft, so the next project starts clean
await page.locator('.side').getByRole('button', { name: 'Start a project', exact: true }).click()
await page.waitForTimeout(700)
await page.getByPlaceholder('e.g. Riyadh Oral Solids Line 3').fill('Thrown away')
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Cancel' }).click()
await page.waitForTimeout(700)
await page.locator('.side').getByRole('button', { name: 'Start a project', exact: true }).click()
await page.waitForTimeout(800)
ok((await page.getByPlaceholder('e.g. Riyadh Oral Solids Line 3').inputValue()) === '', 'cancel: the abandoned draft is not offered again')
ok((await country()) === 'SA', 'cancel: a fresh wizard starts from the default country')

ok(!errors.length, `no unexpected browser errors (${errors.slice(0, 2).join(' | ') || 'none'})`)
console.log(`\n${fail ? `${fail} FAILED` : 'all passed'}`)
await browser.close()
process.exit(fail ? 1 : 0)
