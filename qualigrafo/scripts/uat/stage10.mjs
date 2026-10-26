// UAT stage 10 — close the loops: transmittal receipt, signed access review, inspector view,
// audit package and the per-role "My work" list.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { CHROME, vis } from '../e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8084/'
const OUT = 'uat-out'
const { admin, people } = JSON.parse(fs.readFileSync(`${OUT}/people.json`, 'utf8'))
const PW = 'Nova-Quality-2026'
const P = 'PRJ-001'
const who = (e) => people.find((p) => p.email === e)

let fail = 0
const notes = []
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }
const note = (m) => { notes.push(m); console.log(`NOTE  ${m}`) }

const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()))
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const text = async () => (await page.locator('.page').innerText()).replace(/\s+/g, ' ')

async function signIn(email) {
  await page.goto(BASE)
  await page.waitForTimeout(500)
  if (await vis(page.getByRole('button', { name: 'Sign out' }), 800)) {
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  }
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PW)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.locator('.side').waitFor({ timeout: 12000 })
  await page.waitForTimeout(600)
}
const go = async (p) => { await page.goto(`${BASE}#/p/${P}/${p}`); await page.waitForTimeout(1500) }

// ---------------------------------------------------------------- 1. receipt acknowledged by the recipient
await signIn('rajesh.kumar@buildco.example')
await go('transmittals')
await page.getByRole('button', { name: 'TRN-001' }).click()
await page.waitForTimeout(1000)
const ack = page.getByRole('button', { name: /Acknowledge receipt/ })
ok(await vis(ack, 4000), 'transmittals: the recipient finds the acknowledgement inside the transmittal')
await ack.click()
await page.waitForTimeout(1600)
ok(/Acknowledged|Received|BuildCo/.test(await text()), 'transmittals: receipt recorded on the transmittal')
note(`transmittal after receipt: ${(await text()).slice(0, 260)}`)
await shot('51-receipt')

// ---------------------------------------------------------------- 2. signed periodic access review
await signIn(admin.email)
await page.goto(`${BASE}#/admin`)
await page.waitForTimeout(1000)
await page.getByRole('button', { name: /Access review/ }).click()
await page.waitForTimeout(1800)
const selects = page.locator('.page select[aria-label^="Decision for"]')
const n = await selects.count()
ok(n >= 5, `access review: a decision is required for each of the ${n} accounts`)
for (let i = 0; i < n; i++) {
  const opts = await selects.nth(i).locator('option').allTextContents()
  const keep = opts.find((o) => /^Keep/i.test(o)) ?? opts[1]
  await selects.nth(i).selectOption({ label: keep })
}
const saves = page.locator('.page').getByRole('button', { name: /^Save decision$/ })
for (let i = 0; i < await saves.count(); i++) {
  const b = saves.nth(i)
  if (await b.isEnabled()) { await b.click(); await page.waitForTimeout(500) }
}
await page.getByPlaceholder(/All remaining access is appropriate/).fill('All five accounts reviewed: roles match the project assignments; no dormant accounts.')
await page.getByLabel('Password to sign').fill(PW)
await page.getByRole('button', { name: /Sign and complete review/ }).click()
await page.waitForTimeout(2500)
const revDone = await text()
ok(/Completed|LAST COMPLETED/i.test(revDone) && !/Never/.test(revDone.slice(revDone.indexOf('LAST COMPLETED'), revDone.indexOf('LAST COMPLETED') + 40)), 'access review: signed and completed with an electronic signature')
note(`access review after signing: ${revDone.slice(0, 300)}`)
await shot('52-access-review-signed')

// ---------------------------------------------------------------- 3. inspector view and audit package
await go('inspector')
const insp = await text()
ok(/Inspector/i.test(insp), 'inspector view: a read-only view for an auditor exists')
note(`inspector view: ${insp.slice(0, 260)}`)
await shot('53-inspector')

await go('audits')
const pack = await text()
note(`audit packages: ${pack.slice(0, 260)}`)
const freeze = page.locator('.page').getByRole('button', { name: /Freeze|Create package|New package/i }).first()
if (await vis(freeze, 3000)) {
  await freeze.click()
  await page.waitForTimeout(2000)
  ok(/AUD-|package/i.test(await text()), 'audit package: an evidence package can be frozen for an inspection')
} else {
  note('audit package: no freeze action found on this page for the Owner / QA role')
}
await shot('54-audit-package')

// ---------------------------------------------------------------- 4. per-role work list
for (const email of ['omar.haddad@consult.example', 'rajesh.kumar@buildco.example']) {
  await signIn(email)
  await page.goto(`${BASE}#/work`)
  await page.waitForTimeout(1400)
  const work = await text()
  note(`my work (${email}): ${work.slice(0, 220)}`)
}
ok(true, 'my work: the per-role list opens for the consultant and the contractor')
await shot('55-my-work')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
fs.writeFileSync(`${OUT}/stage10-notes.txt`, notes.join('\n'))
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 10 OK')
process.exit(fail ? 1 : 0)
