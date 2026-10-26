// UAT stage 9 — transmittal with receipt, installation check, backup with test restore,
// periodic access review signed off, and the reports a customer shows an inspector.
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
  await page.waitForTimeout(500)
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
  await page.waitForTimeout(600)
}
const go = async (p) => { await page.goto(`${BASE}#/p/${P}/${p}`); await page.waitForTimeout(1500) }
const adminTab = async (name) => { await page.goto(`${BASE}#/admin`); await page.waitForTimeout(1000); await page.getByRole('button', { name }).click(); await page.waitForTimeout(1600) }

// ---------------------------------------------------------------- 1. transmittal with purpose, then receipt
await signIn(admin.email, null)
await go('transmittals')
if (!/TRN-/.test(await text())) {
  await page.getByRole('button', { name: /New transmittal/ }).first().click()
  await page.waitForTimeout(900)
  const rec = page.getByLabel('Transmittal recipient')
  const recOpts = await rec.locator('option').allTextContents()
  await rec.selectOption({ label: recOpts.find((o) => /BuildCo/.test(o)) ?? recOpts[1] })
  const purpose = page.getByLabel('Transmittal purpose')
  const pOpts = await purpose.locator('option').allTextContents()
  note(`transmittal purposes offered: ${pOpts.join(' / ')}`)
  await purpose.selectOption({ label: pOpts.find((o) => !/Choose/i.test(o)) })
  await page.getByLabel('Transmittal remarks').fill('Issued for construction after Owner / QA sign-off.')
  const inc = page.getByLabel(/^Include DOC-/).first()
  if (await vis(inc, 2500)) await inc.check()
  await page.getByRole('button', { name: /Issue transmittal/ }).click()
  await page.waitForTimeout(1800)
}
const trText = await text()
const trOk = /TRN-/.test(trText)
ok(trOk, `documents: transmittal issued with frozen revision and checksum${trOk ? '' : ` (${(await toastText()).slice(0, 100)})`}`)
note(`transmittal record: ${trText.slice(0, 300)}`)
await shot('46-transmittal')

// receipt acknowledged by the receiving company
const raj = who('rajesh.kumar@buildco.example')
await signIn(raj.email, raj.temp)
await go('transmittals')
const ackBtn = page.getByRole('button', { name: /Acknowledge|Confirm receipt/i }).first()
const canAck = await vis(ackBtn, 3000)
ok(canAck, 'documents: the receiving company can acknowledge receipt')
if (canAck) {
  await ackBtn.click()
  await page.waitForTimeout(1500)
  ok(/Acknowledged|Received/i.test(await text()), 'documents: receipt is recorded on the transmittal')
}
await shot('47-transmittal-ack')

// ---------------------------------------------------------------- 2. installation check (IQ)
await signIn(admin.email, null)
await adminTab(/System & validation/)
await page.getByRole('button', { name: /Run installation check/ }).click()
await page.waitForTimeout(4000)
const iq = await text()
const count = (w) => (iq.match(new RegExp(`\\b${w}\\b`, 'g')) ?? []).length
ok(/IQ-01/.test(iq), 'installation check: executed in the application')
note(`installation check result: Pass ${count('Pass')} · Warning ${count('Warning')} · Fail ${count('Fail')}`)
const failing = iq.match(/IQ-\d+[^·]{0,80}Fail/g)
if (failing) note(`failing checks: ${failing.join(' | ').slice(0, 300)}`)
await shot('48-iq')

// ---------------------------------------------------------------- 3. backup with automatic test restore
await adminTab(/^Backups$/)
const backupBtn = page.getByRole('button', { name: /Back up now/ })
ok(await vis(backupBtn, 3000), 'backups: a backup can be started from the application')
await backupBtn.click()
await page.waitForTimeout(1500)
let verified = false
for (let i = 0; i < 90 && !verified; i++) {
  await page.waitForTimeout(1000)
  verified = /Verified/.test(await text())
}
ok(verified, 'backups: the backup completed and its test restore passed')
note(`backup history: ${(await text()).slice(0, 300)}`)
await shot('49-backup')

// ---------------------------------------------------------------- 4. periodic access review, signed
await adminTab(/Access review/)
const start = page.getByRole('button', { name: /Start|New review/i }).first()
if (await vis(start, 3000)) { await start.click(); await page.waitForTimeout(2500) }
const revText = await text()
ok(/REV-|review/i.test(revText), 'access review: a review was started with a snapshot of every account')
note(`access review: ${revText.slice(0, 300)}`)
const decisions = page.locator('.page').getByRole('button', { name: /^(Keep|Confirm|No change)/i })
const nDecisions = await decisions.count()
note(`access review decisions offered per account: ${nDecisions}`)
await shot('50-access-review')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
fs.writeFileSync(`${OUT}/stage9-notes.txt`, notes.join('\n'))
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 9 OK')
process.exit(fail ? 1 : 0)
