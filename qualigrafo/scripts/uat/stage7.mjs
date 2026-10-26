// UAT stage 7 — complete the project set-up the way a customer must (system register), then run the
// site records that depend on it: RFI question and answer, NCR, transmittal, audit export, vendor scope.
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
const toastText = () => page.locator('.toastmsg').last().innerText().catch(() => '')

async function signIn(email, temp) {
  await page.goto(BASE)
  await page.waitForTimeout(400)
  if (await vis(page.getByRole('button', { name: 'Sign out' }), 800)) {
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  }
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(temp ?? PW)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  if (temp && await vis(page.getByText('Email or password is incorrect'), 2500)) {
    await page.getByLabel('Password', { exact: true }).fill(PW)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  }
  if (await vis(page.getByRole('heading', { name: 'Set a new password' }), 4000)) {
    await page.getByLabel('Temporary password').fill(temp)
    await page.getByLabel('New password', { exact: true }).fill(PW)
    await page.getByLabel('Confirm new password').fill(PW)
    await page.getByRole('button', { name: 'Change password' }).click()
  }
  await page.locator('.side').waitFor({ timeout: 12000 })
}
const go = async (p) => { await page.goto(`${BASE}#/p/${P}/${p}`); await page.waitForTimeout(1200) }

// ---------------------------------------------------------------- 1. the system register (needed by RFIs and NCRs)
await signIn(admin.email, null)
await go('registers')
await page.locator('.page').getByRole('button', { name: /Systems & equipment/ }).click()
await page.waitForTimeout(700)
const addSystem = async (tag, desc, discipline, area) => {
  await page.getByLabel('New system tag').fill(tag)
  await page.getByLabel('New system description').fill(desc)
  const sel = page.getByLabel('Discipline').first()
  const opts = await sel.locator('option').allTextContents()
  await sel.selectOption({ label: opts.find((o) => o.includes(discipline)) ?? opts[1] })
  await page.getByLabel('New system area').fill(area)
  await page.locator('.page').getByRole('button', { name: /Add system/ }).last().click()
  await page.waitForTimeout(900)
}
const already = await text()
if (!/CR-101/.test(already)) await addSystem('CR-101', 'Cleanroom suite 101', 'Civil & Cleanroom', 'Block A')
if (!/AHU-01/.test(already)) await addSystem('AHU-01', 'Air handling unit 1', 'HVAC', 'Roof')
const sysText = await text()
ok(/CR-101/.test(sysText) && /AHU-01/.test(sysText), 'registers: systems / equipment can be added by the Owner / QA')
note(`system register: ${sysText.slice(0, 200)}`)
await shot('34-systems')

// ---------------------------------------------------------------- 2. RFI: raise, answer, close
const raj = who('rajesh.kumar@buildco.example')
await signIn(raj.email, raj.temp)
await go('rfis')
if (!/RFI-001/.test(await text())) {
await page.getByRole('button', { name: /Raise RFI/ }).first().click()
await page.waitForTimeout(700)
await page.getByPlaceholder(/Question — include drawing/).fill('Confirm the door swing direction at the CR-101 corridor interface (drawing NPL-001 R00).')
const sels = page.locator('.page select')
for (let i = 0; i < await sels.count(); i++) {
  const opts = await sels.nth(i).locator('option').allTextContents()
  const civil = opts.find((o) => /Civil/.test(o))
  const sys = opts.find((o) => /CR-101/.test(o))
  if (sys) await sels.nth(i).selectOption({ label: sys })
  else if (civil) await sels.nth(i).selectOption({ label: civil })
}
await page.locator('.page input[type=date]').first().fill('2026-11-10')
await page.getByRole('button', { name: 'Submit RFI' }).click()
await page.waitForTimeout(1500)
}
const rfiMade = /RFI-001/.test(await text())
ok(rfiMade, `site records: the contractor raised RFI-001${rfiMade ? '' : ` (${(await toastText()).slice(0, 90)})`}`)
await shot('35-rfi')

const omar = who('omar.haddad@consult.example')
await signIn(omar.email, omar.temp)
await go('rfis')
const row = page.locator('tbody tr').first()
if (await vis(row, 3000)) {
  const open = row.getByRole('button').first()
  if (await vis(open, 1500)) { await open.click(); await page.waitForTimeout(700) }
}
const answer = page.locator('.page textarea:not([disabled]), .drawer textarea:not([disabled])').first()
if (await vis(answer, 2500)) {
  await answer.fill('Door swings into the corridor as detail D-04; the layout stays as issued.')
  const send = page.getByRole('button', { name: /^(Answer|Respond|Send|Record)/i }).first()
  if (await vis(send, 2000)) { await send.click(); await page.waitForTimeout(1400) }
}
const rfiAfter = (await text()) + ' ' + (await page.locator('.drawer').innerText().catch(() => ''))
ok(/Answered|Awaiting closure|Closed/i.test(rfiAfter), 'site records: the reviewer answered the RFI')
note(`rfi state: ${rfiAfter.replace(/\s+/g, ' ').slice(0, 220)}`)
await shot('36-rfi-answered')

// ---------------------------------------------------------------- 3. NCR
await signIn(admin.email, null)
await go('ncrs')
await page.getByRole('button', { name: /Raise NCR/ }).first().click()
await page.waitForTimeout(700)
await page.locator('.page input[type=text]').first().fill('Ceiling panel joint sealant not as specified')
const ncrSel = page.locator('.page select')
for (let i = 0; i < await ncrSel.count(); i++) {
  const opts = await ncrSel.nth(i).locator('option').allTextContents()
  const major = opts.find((o) => /^Major/.test(o))
  const doc = opts.find((o) => /DOC-001|Cleanroom/.test(o))
  if (major) await ncrSel.nth(i).selectOption({ label: major })
  else if (doc) await ncrSel.nth(i).selectOption({ label: doc })
}
await page.locator('.page textarea').first().fill('Installed sealant type differs from the approved layout note; rework and re-inspection needed.')
await page.locator('.page input[type=date]').first().fill('2026-11-15')
await page.locator('.page').getByRole('button', { name: /^Raise NCR$/ }).last().click()
await page.waitForTimeout(1500)
const ncrMade = /NCR-001/.test(await text())
ok(ncrMade, `site records: an NCR was raised${ncrMade ? '' : ` (${(await toastText()).slice(0, 90)})`}`)
await shot('37-ncr')

// ---------------------------------------------------------------- 4. transmittal
await go('transmittals')
await page.getByRole('button', { name: /New transmittal/ }).first().click()
await page.waitForTimeout(800)
const rec = page.getByLabel('Transmittal recipient')
const recOpts = await rec.locator('option').allTextContents()
await rec.selectOption({ label: recOpts.find((o) => /BuildCo/.test(o)) ?? recOpts[1] })
await page.getByLabel('Transmittal remarks').fill('Issued for construction after Owner / QA sign-off.')
const inc = page.getByLabel(/^Include DOC-/).first()
if (await vis(inc, 2000)) await inc.check()
await page.getByRole('button', { name: /Issue transmittal/ }).click()
await page.waitForTimeout(1700)
const tr = await text()
ok(/TRN-/.test(tr), `documents: a transmittal was issued${/TRN-/.test(tr) ? '' : ` (${(await toastText()).slice(0, 90)})`}`)
note(`transmittal: ${tr.slice(0, 240)}`)
await shot('38-transmittal')

// ---------------------------------------------------------------- 5. audit trail export
await go('audit')
const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
const exp = page.locator('.page').getByRole('button', { name: /Export|CSV/i }).first()
if (await vis(exp, 2500)) await exp.click()
const file = await dl
ok(!!file, `audit trail: exported as CSV${file ? ` (${file.suggestedFilename()})` : ''}`)
if (file) await file.saveAs(`${OUT}/audit-trail.csv`)
const auditText = await text()
note(`audit trail: ${auditText.slice(0, 260)}`)
await shot('39-audit')

// ---------------------------------------------------------------- 6. vendor scope
const sara = who('sara.noor@airco.example')
await signIn(sara.email, sara.temp)
await page.waitForTimeout(900)
await go('vendor')
const vendorView = await text()
ok(/AirCo/.test(vendorView), 'vendor: the scoped account opens its own company view')
ok(!/Cleanroom panel layout/.test(vendorView), 'vendor: records of other companies are not shown')
note(`vendor view: ${vendorView.slice(0, 260)}`)
await shot('40-vendor')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
fs.writeFileSync(`${OUT}/stage7-notes.txt`, notes.join('\n'))
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 7 OK')
process.exit(fail ? 1 : 0)
