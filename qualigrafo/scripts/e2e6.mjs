// Run (fixtures loaded + preview server on :8081): node scripts/e2e6.mjs
// Requirement library: starter template, editing, CSV import, four-eyes approval, fan-out to projects as a
// "Library update", applying it, project-specific requirements and the requirement details editor.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { ACCOUNTS, PASSWORD, forget, isNoise, loginAs, signIn, switchRole, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

// A second library editor (administrator) for the four-eyes rule, prepared through the API.
const api = async (method, path, body, token) => {
  const r = await fetch(`${BASE}api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const REVIEWER = 'library.reviewer@qualigrafo.test', REVIEWER_PW = 'Reviewer-2026-e2e'
const qaToken = (await api('POST', '/auth/login', { email: ACCOUNTS['Owner / QA'], password: PASSWORD })).json.token
const made = await api('POST', '/admin/users', { email: REVIEWER, name: 'Library Reviewer', isAdmin: true }, qaToken)
if (made.status === 201) {
  const t = (await api('POST', '/auth/login', { email: REVIEWER, password: made.json.tempPassword })).json.token
  await api('POST', '/auth/password', { current: made.json.tempPassword, next: REVIEWER_PW }, t)
}
ok(made.status === 201, 'second library editor created for the four-eyes rule')

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
page.on('dialog', (d) => d.accept())
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 6000)
const lib = async () => { await page.goto(`${BASE}#/library`); await page.getByRole('heading', { name: 'Requirement library' }).waitFor(); await page.waitForTimeout(400) }
const go = async (p) => { await page.goto(`${BASE}#/p/PRJ-026/${p}`); await page.waitForTimeout(500) }
const asReviewer = async () => {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  forget(page)
  await signIn(page, REVIEWER, REVIEWER_PW)
  await page.locator('.side').waitFor()
}
const backToQa = async () => {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  await loginAs(page, 'Owner / QA')
}

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()

// ---- read-only for a contractor
await loginAs(page, 'Contractor')
await lib()
ok(await vis(page.getByText('No requirement library yet')), 'empty library explained on a new installation')
ok(!(await vis(page.getByRole('button', { name: 'Load unverified starter template' }), 800)), 'contractor cannot load the starter template')
await go('requirements')
ok(!(await vis(page.getByRole('button', { name: 'Add requirement' }), 800)), 'contractor cannot add requirements')

// ---- Owner / QA loads the starter and edits the SA draft
await switchRole(page, 'Owner / QA')
await lib()
await page.getByRole('button', { name: 'Load unverified starter template' }).click()
ok(await toast('Starter drafts created'), 'starter template loaded as drafts')
ok(await vis(page.locator('.lib-grid h2', { hasText: 'v1' }).first()), 'first pack draft v1 opened')
ok(await vis(page.getByText('Topic-level starter content')), 'unverified starter banner shown on the draft')
await page.locator('.lib-grid .cmt', { hasText: 'Saudi Arabia' }).click()
await page.waitForTimeout(400)
ok(await vis(page.locator('.lib-grid h2', { hasText: 'v1' }).first()), 'SA draft v1 selected')

await page.getByRole('button', { name: 'Edit TOPIC-01' }).click()
await page.getByLabel('Item clause').fill('Chapter 3.1')
await page.getByLabel('Item source version').fill('2024 edition')
await page.getByRole('button', { name: 'Save item' }).click()
ok(await toast('TOPIC-01 saved'), 'item edited (clause and edition)')
ok(await vis(page.locator('tr', { hasText: 'TOPIC-01' }).getByText('Chapter 3.1')), 'clause shown in the items table')

await page.getByRole('button', { name: 'Add item' }).click()
await page.getByLabel('Item key').fill('e2e-01')
await page.getByLabel('Item title').fill('Pressure cascade alarm verified at commissioning')
await page.getByLabel('Item discipline').fill('HVAC')
await page.getByRole('button', { name: 'Save item' }).click()
ok(await toast('E2E-01 added'), 'item added (key upper-cased)')

await page.getByRole('button', { name: 'Import CSV' }).click()
await page.getByLabel('Library CSV content').fill('Key,Title,Discipline,Facilities,Critical\r\nE2E-02,Grade A air supply qualified,HVAC,Sterile products|Biologics,yes\r\n')
await page.getByRole('button', { name: /^Append 1 item/ }).click()
ok(await toast('1 item(s) appended'), 'CSV import appended one item')
ok(await vis(page.locator('tr', { hasText: 'E2E-02' }).getByText('Sterile products, Biologics')), 'imported facilities shown')
await page.getByRole('button', { name: 'Import CSV' }).click()
await page.getByLabel('Library CSV content').fill('Title,Discipline\r\nNo key,HVAC\r\n')
ok(await vis(page.getByText('Header must contain Key, Title and Discipline')), 'CSV without a Key column is rejected before upload')
await page.getByRole('button', { name: 'Import CSV' }).click()

ok(await vis(page.getByText('Under the four-eyes rule another library editor must approve it.')), 'four-eyes: preparer is told another editor approves')
ok(await page.getByRole('button', { name: 'Approve v1' }).isDisabled(), 'four-eyes: approve disabled for the preparer')
await page.screenshot({ path: `${OUT}/e6-library-draft.png`, fullPage: true })

// ---- second editor approves v1
await asReviewer()
await lib()
await page.locator('.lib-grid .cmt', { hasText: 'Saudi Arabia' }).click()
await page.getByLabel('Approval basis').fill('Checked TOPIC-01 against SFDA GMP guide 2024; remaining items accepted as topic level.')
await page.getByLabel('Approval password').fill(REVIEWER_PW)
await page.getByRole('button', { name: 'Approve v1' }).click()
ok(await toast('SA v1 approved'), 'second editor approved SA v1')
ok(await vis(page.locator('.lib-grid .cmt', { hasText: 'Saudi Arabia' }).getByText(/v1 approved · 19/)), 'pack list shows v1 approved with 19 items')

// ---- QA prepares v2, reviewer approves -> library update to PRJ-026
await backToQa()
await lib()
await page.locator('.lib-grid .cmt', { hasText: 'Saudi Arabia' }).click()
await page.getByRole('button', { name: 'New draft from v1' }).click()
ok(await toast('Draft v2 created'), 'new draft v2 copied from approved v1')
await page.getByRole('button', { name: 'Edit TOPIC-01' }).click()
await page.getByLabel('Item effective date').fill('2025-01-01')
await page.getByRole('button', { name: 'Save item' }).click()
ok(await vis(page.locator('tr', { hasText: 'TOPIC-01' }).getByText(/Changed/)), 'changed item flagged against v1')
await asReviewer()
await lib()
await page.locator('.lib-grid .cmt', { hasText: 'Saudi Arabia' }).click()
await page.getByLabel('Approval basis').fill('Effective date of TOPIC-01 confirmed from the official notice.')
await page.getByLabel('Approval password').fill(REVIEWER_PW)
await page.getByRole('button', { name: 'Approve v2' }).click()
ok(await toast(/update sent to .*PRJ-026/), 'v2 approved and sent to PRJ-026')

// ---- QA applies the library update on PRJ-026
await backToQa()
await go('updates')
const card = page.locator('section.card', { hasText: 'Requirement library SA v2 approved' })
ok(await vis(card.getByText('Library update')), 'library update listed with its badge')
ok(await vis(page.locator('section.card', { hasText: 'Requirement library SA v1 approved' }).getByText('Not applicable').first()), 'older unassessed library update superseded')
await card.getByPlaceholder('Qualified-reviewer rationale…').fill('Project adopts the approved SA library v2.')
await card.getByRole('button', { name: 'Apply to project: new baseline' }).click()
ok(await toast('Library version applied'), 'library update applied to the project')
await go('requirements')
ok(await vis(page.getByText(/Library v2 · TOPIC-01/).first()), 'register shows library origin of the new requirements')
ok(await vis(page.getByText('System not assigned').first()), 'library requirements arrive without a system')

// ---- project-specific requirement + details editor
await page.getByRole('button', { name: 'Add requirement' }).first().click()
await page.getByLabel('New requirement title').fill('Owner standard OS-12: HVAC alarms routed to BMS')
await page.getByLabel('Discipline', { exact: true }).selectOption({ index: 1 })
await page.locator('section.card').getByRole('button', { name: 'Add requirement' }).click()
ok(await toast('Project-specific requirement added'), 'project-specific requirement added')
await page.getByLabel('Search requirements').fill('OS-12')
const row = page.locator('tr', { hasText: 'OS-12' })
ok(await vis(row.getByText(/Project-specific/)), 'register marks it Project-specific')
await row.getByRole('button', { name: /OS-12/ }).click()
ok(await vis(page.locator('.drawer').getByText('Project-specific requirement').first()), 'drawer shows the origin')
await page.getByLabel('Requirement owner').fill('QA Lead')
await page.getByRole('button', { name: 'Save details' }).click()
ok(await toast('Requirement details saved'), 'owner changed through the details editor')
await page.keyboard.press('Escape')

await go('setup')
ok(await vis(page.getByText('Library v2 approved')), 'setup source inventory shows the approved library version')
await page.screenshot({ path: `${OUT}/e6-setup-inventory.png`, fullPage: true })

await page.setViewportSize({ width: 390, height: 844 })
await lib()
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'library page has no horizontal page scroll on mobile')
await page.screenshot({ path: `${OUT}/e6-library-mobile.png`, fullPage: true })

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
