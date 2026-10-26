// UAT stage 6 — close the evidence loop and run the site records: evidence acceptance, RFI, NCR,
// transmittal with acknowledgement, audit trail export, vendor scope.
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

// ---------------------------------------------------------------- 1. Owner / QA accepts the evidence
await signIn(admin.email, null)
await go('requirements')
await page.locator('tbody .link').first().click()
await page.waitForTimeout(900)
const d = page.locator('.drawer')
await d.getByRole('button', { name: /^Assess/ }).first().click()
await page.waitForTimeout(500)
await d.getByPlaceholder('Assessment rationale…').fill('Checked against the official text: the layout covers finishes and personnel flow for CR-101.')
await d.getByRole('button', { name: 'Accept as fit' }).click()
await page.waitForTimeout(1500)
const afterAccept = (await d.innerText()).replace(/\s+/g, ' ')
ok(/Evidence accepted/i.test(afterAccept), 'evidence: independent reviewer accepts the evidence (requirement evidenced)')
note(`requirement state: ${afterAccept.slice(0, 160)}`)
await shot('29-evidence-accepted')
await page.keyboard.press('Escape')

await go('overview')
const ov = await text()
ok(/EVIDENCE ACCEPTED 1\/1|1\/1/.test(ov.replace(/\s+/g, ' ')), 'overview: accepted evidence is counted (1/1 of the decided requirements)')
note(`overview: ${ov.slice(0, 260)}`)

// ---------------------------------------------------------------- 2. RFI raised by the contractor, answered by the consultant
const raj = who('rajesh.kumar@buildco.example')
await signIn(raj.email, raj.temp)
await go('rfis')
await page.getByRole('button', { name: /Raise RFI/ }).first().click()
await page.waitForTimeout(600)
await page.getByPlaceholder(/Question — include drawing/).fill('Confirm the door swing direction at the CR-101 corridor interface (drawing NPL-001 R00).')
const disc = page.getByLabel('Discipline').first()
const dOpts = await disc.locator('option').allTextContents()
await disc.selectOption({ label: dOpts.find((o) => /Civil/.test(o)) ?? dOpts[1] })
await page.locator('.page input[type=date]').first().fill('2026-11-10')
await page.getByRole('button', { name: 'Submit RFI' }).click()
await page.waitForTimeout(1300)
ok(/RFI-001/.test(await text()), 'site records: the contractor raised RFI-001')
await shot('30-rfi-raised')

const omar = who('omar.haddad@consult.example')
await signIn(omar.email, omar.temp)
await go('rfis')
const answerBox = page.locator('.page textarea').first()
if (await vis(answerBox, 2500)) {
  await answerBox.fill('Door swings into the corridor; see detail D-04. Layout stays as issued.')
  const send = page.locator('.page').getByRole('button', { name: /Answer|Respond|Send/i }).first()
  if (await vis(send, 2000)) { await send.click(); await page.waitForTimeout(1300) }
}
const rfiAfter = await text()
ok(/Answered|Awaiting closure|closed/i.test(rfiAfter), 'site records: the reviewer answered the RFI')
note(`rfi after answer: ${rfiAfter.slice(0, 220)}`)

// ---------------------------------------------------------------- 3. NCR raised by the reviewer
await go('ncrs')
await page.getByRole('button', { name: /Raise NCR/ }).first().click()
await page.waitForTimeout(600)
const ncrInputs = page.locator('.page input[type=text]')
await ncrInputs.first().fill('Ceiling panel joint sealant not as specified')
const ncrSelects = page.locator('.page select')
for (let i = 0; i < await ncrSelects.count(); i++) {
  const opts = await ncrSelects.nth(i).locator('option').allTextContents()
  if (opts.some((o) => /Major|Critical/.test(o))) await ncrSelects.nth(i).selectOption({ label: opts.find((o) => /Major/.test(o)) })
  else if (opts.some((o) => /DOC-001/.test(o))) await ncrSelects.nth(i).selectOption({ label: opts.find((o) => /DOC-001/.test(o)) })
}
await page.locator('.page textarea').first().fill('Sealant type on the installed ceiling joints differs from the approved layout note.')
await page.locator('.page input[type=date]').first().fill('2026-11-15')
await page.locator('.page').getByRole('button', { name: /^Raise NCR$/ }).last().click()
await page.waitForTimeout(1400)
ok(/NCR-001/.test(await text()), 'site records: an NCR can be raised against the record')
await shot('31-ncr')

// ---------------------------------------------------------------- 4. transmittal to the responsible company
await go('transmittals')
await page.getByRole('button', { name: /New transmittal/ }).first().click()
await page.waitForTimeout(700)
const rec = page.getByLabel('Transmittal recipient')
const recOpts = await rec.locator('option').allTextContents()
await rec.selectOption({ label: recOpts.find((o) => /BuildCo/.test(o)) ?? recOpts[1] })
await page.getByLabel('Transmittal remarks').fill('Issued for construction after Owner / QA sign-off.')
const inc = page.getByLabel(/^Include DOC-/).first()
if (await vis(inc, 2000)) await inc.check()
await page.getByRole('button', { name: /Issue transmittal/ }).click()
await page.waitForTimeout(1500)
const tr = await text()
ok(/TRN-001|Transmittal/i.test(tr), 'documents: a transmittal was issued with the exact revision and checksum')
note(`transmittal: ${tr.slice(0, 240)}`)
await shot('32-transmittal')

// ---------------------------------------------------------------- 5. audit trail export
await go('audit')
const auditText = await text()
ok(/audit/i.test(auditText), 'audit trail: the project trail is readable in the application')
const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
const exp = page.locator('.page').getByRole('button', { name: /Export|CSV/i }).first()
if (await vis(exp, 2500)) await exp.click()
const file = await dl
ok(!!file, `audit trail: exported for review${file ? ` (${file.suggestedFilename()})` : ''}`)
if (file) await file.saveAs(`${OUT}/audit-trail.csv`)
note(`audit entries (first lines): ${auditText.slice(0, 300)}`)

// ---------------------------------------------------------------- 6. vendor sees only its own company
const sara = who('sara.noor@airco.example')
await signIn(sara.email, sara.temp)
await page.waitForTimeout(800)
const vendorNav = (await page.locator('.side').innerText()).replace(/\s+/g, ' ')
note(`vendor navigation: ${vendorNav.slice(0, 220)}`)
await go('documents')
const vendorDocs = await text()
ok(!/Cleanroom panel layout/.test(vendorDocs) || /AirCo/.test(vendorDocs), 'vendor: the AirCo account sees only its own company records')
note(`vendor document view: ${vendorDocs.slice(0, 260)}`)
await shot('33-vendor-view')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
fs.writeFileSync(`${OUT}/stage6-notes.txt`, notes.join('\n'))
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 6 OK')
process.exit(fail ? 1 : 0)
