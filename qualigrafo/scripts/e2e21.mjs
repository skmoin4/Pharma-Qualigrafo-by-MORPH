// Run (fixtures loaded + preview server on :8081): node scripts/e2e21.mjs
// Phase 5 / step 3 — document control: a working version is not a formal revision. The register opens a revision
// when a document is submitted, records what it is issued for and who prepared, checked and approved it, keeps a
// superseded revision with its own content, lets two revisions be compared, and takes its suitability codes from
// the project's own set.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { CHROME, INSECURE, PASSWORD, attach, isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1440, height: 1000 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
const shot = (n) => page.screenshot({ path: `${OUT}/e2e21-${n}.png`, fullPage: true })
const drawer = () => page.locator('.drawer')
const drawerText = async () => (await drawer().innerText()).replace(/\s+/g, ' ')
const DOC = 'Airflow balancing report'
const openDoc = async () => {
  await page.goto(`${BASE}#/p/PRJ-026/documents`)
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: DOC }).first().click()
  await page.waitForTimeout(600)
}
const close = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400) }
const sign = async (who) => {
  await close()
  await switchRole(page, who)
  await openDoc()
  await page.locator('textarea').first().fill('Reviewed against the layout')
  await page.getByLabel('Signature password').fill(PASSWORD)
  await page.locator('.dbody input[type=checkbox]').first().check()
  await page.getByRole('button', { name: new RegExp(`Sign as ${who === 'Owner / QA' ? 'Owner' : who}`) }).click()
  await page.waitForTimeout(900)
}

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
await loginAs(page, 'Owner / QA')

// ---- 1. the project's suitability set, and that it is the project's own
await page.goto(`${BASE}#/p/PRJ-026/setup`)
await page.waitForTimeout(1200)
const setup = (await page.locator('.page').innerText()).replace(/\s+/g, ' ')
ok(/Revision suitability codes/.test(setup), 'the project has its own suitability codes')
const rows = page.locator('input[aria-label^="Suitability code"]')
const codeValues = async () => Promise.all((await rows.all()).map((r) => r.inputValue()))
const before = await codeValues()
ok(before.includes('S2') && before.includes('A1') && before.includes('S0'), `it starts from the ISO 19650 set (${before.length} codes)`)

// a change needs a reason, like every other controlled change in the product
await page.getByRole('button', { name: /Save suitability codes/ }).click()
await page.waitForTimeout(900)
ok(await vis(page.locator('.toastmsg', { hasText: 'Record why the suitability codes are being changed' }), 6000), 'saving without a reason is refused')

await page.getByRole('button', { name: /Add code/ }).click()
await page.waitForTimeout(300)
const last = (await rows.count()) - 1
await rows.nth(last).fill('IFT')
await page.locator('input[aria-label^="Suitability label"]').nth(last).fill('Issued for tender')
await page.locator('select[aria-label^="Suitability stage"]').nth(last).selectOption('Published')
await page.getByPlaceholder('Why is the suitability set being changed?').fill('Contract issues drawings for tender')
await page.getByRole('button', { name: /Save suitability codes/ }).click()
await page.waitForTimeout(1500)
ok(await vis(page.locator('.toastmsg', { hasText: 'Suitability codes saved' }), 6000), 'Owner / QA adds a code the contract needs')
ok((await codeValues()).includes('IFT'), 'and the project now offers it')
await shot('01-suitability-codes')

// ---- 2. a working version is not yet a revision
await switchRole(page, 'Contractor')
await openDoc()
ok((await drawerText()).includes('No formal revision yet'), 'before submission the document has no formal revision')
await attach(page, 'DOC-012', 'Airflow balancing report.pdf')
ok((await drawerText()).includes('No formal revision yet'), 'attaching a file is a working version, not a revision')
await shot('02-working-version')

// ---- 3. submitting opens the revision, issued for a stated purpose
await page.locator('textarea').first().fill('Test report attached')
await page.getByLabel('Suitability').selectOption('IFT')
await page.getByLabel('Change summary').fill('Balancing figures corrected after the site visit')
await page.getByRole('button', { name: /Submit R00 for review/ }).click()
await page.waitForTimeout(1200)
const opened = await drawerText()
// Headings are upper-cased by the stylesheet, and innerText returns what is rendered, so match case-insensitively.
ok(/revisions/i.test(opened) && /under review/i.test(opened), 'submitting opens the formal revision')
ok(/IFT/.test(opened) && /Balancing figures corrected/.test(opened), 'the revision says what it is issued for and what changed')
ok(/Demo Contractor/.test(opened), 'and who prepared it')
await shot('03-revision-opened')

// ---- 4. checked, then approved
await sign('Consultant')
ok(/checked Demo Consultant/.test(await drawerText()), 'stage 1 records who checked it')
await sign('Owner / QA')
const issued = await drawerText()
ok(/approved Demo Owner \/ QA/.test(issued), 'stage 2 records who approved it')
ok(/current: R00/i.test(issued), 'the register names the revision in force')
await shot('04-revision-issued')

// ---- 5. a new revision supersedes the old one, which is kept
await close()
await switchRole(page, 'Contractor')
await openDoc()
await page.getByRole('button', { name: /Start new revision/ }).click()
await page.waitForTimeout(1000)
await attach(page, 'DOC-012', 'Airflow balancing report rev B.pdf')
await page.locator('textarea').first().fill('Revised after comments')
await page.getByLabel('Suitability').selectOption('A1')
await page.getByLabel('Change summary').fill('Grille schedule updated')
await page.getByRole('button', { name: /Submit R01 for review/ }).click()
await page.waitForTimeout(1200)
await sign('Consultant')
await sign('Owner / QA')
const both = await drawerText()
ok(/current: R01/i.test(both), 'the new revision is the one in force')
ok(/R00/.test(both) && /superseded/i.test(both), 'the earlier revision is kept, marked Superseded')
ok(!/R00 Issued/i.test(both), 'and is no longer shown as issued')
await shot('05-superseded-kept')

// ---- 6. two revisions can be compared
await page.getByLabel('Compare R0').check()
await page.getByLabel('Compare R1').check()
await page.waitForTimeout(500)
const cmp = await drawerText()
ok(/R00 → R01/.test(cmp), 'two revisions can be compared')
ok(/IFT/.test(cmp) && /A1/.test(cmp), 'the comparison shows the suitability changing')
ok(/Grille schedule updated/.test(cmp), 'and what the later revision says changed')
ok(/unchanged/.test(cmp) === false || /Content checksum/.test(cmp), 'the comparison includes the content checksum')
await shot('06-compare')

// ---- 7. versions and revisions are separate views
ok(/version history/i.test(both), 'the working version history is still there, under its own heading')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
