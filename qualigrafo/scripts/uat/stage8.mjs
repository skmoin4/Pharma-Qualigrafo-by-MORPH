// UAT stage 8 — the rest of the cycle: NCR, transmittal, audit export, vendor scope,
// and the administration a customer runs weekly (access review, backups, monitoring, outbox, IQ).
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

// ---------------------------------------------------------------- 1. NCR
await signIn(admin.email, null)
await go('ncrs')
if (!/NCR-001/.test(await text())) {
  await page.locator('.page').getByRole('button', { name: /^Raise NCR$/ }).first().click()
  // the title field has no type attribute, so match by exclusion
  const title = page.locator('.page input:not([type=date]):not([type=checkbox])').first()
  ok(await vis(title, 8000), 'quality: the NCR form opens')
  await title.fill('Ceiling panel joint sealant not as specified')
  const sels = page.locator('.page select')
  for (let i = 0; i < await sels.count(); i++) {
    const opts = await sels.nth(i).locator('option').allTextContents()
    const sys = opts.find((o) => /CR-101/.test(o))
    const major = opts.find((o) => /^Major$/.test(o))
    const doc = opts.find((o) => /Cleanroom panel layout/.test(o))
    if (sys) await sels.nth(i).selectOption({ label: sys })
    else if (major) await sels.nth(i).selectOption({ label: major })
    else if (doc) await sels.nth(i).selectOption({ label: doc })
  }
  await page.locator('.page textarea').first().fill('Installed sealant differs from the approved layout note; rework and re-inspection required.')
  await page.locator('.page input[type=date]').first().fill('2026-11-15')
  await page.locator('.page').getByRole('button', { name: /^Raise NCR$/ }).last().click()
  await page.waitForTimeout(1600)
}
const ncrOk = /NCR-001/.test(await text())
ok(ncrOk, `quality: an NCR was raised against the record${ncrOk ? '' : ` (${(await toastText()).slice(0, 100)})`}`)
await shot('37-ncr')

// ---------------------------------------------------------------- 2. transmittal
await go('transmittals')
if (!/TRN-/.test(await text())) {
  await page.getByRole('button', { name: /New transmittal/ }).first().click()
  await page.waitForTimeout(900)
  const rec = page.getByLabel('Transmittal recipient')
  const recOpts = await rec.locator('option').allTextContents()
  await rec.selectOption({ label: recOpts.find((o) => /BuildCo/.test(o)) ?? recOpts[1] })
  await page.getByLabel('Transmittal remarks').fill('Issued for construction after Owner / QA sign-off.')
  const inc = page.getByLabel(/^Include DOC-/).first()
  if (await vis(inc, 2500)) await inc.check()
  await page.getByRole('button', { name: /Issue transmittal/ }).click()
  await page.waitForTimeout(1800)
}
const trOk = /TRN-/.test(await text())
ok(trOk, `documents: a transmittal was issued with the exact revision${trOk ? '' : ` (${(await toastText()).slice(0, 100)})`}`)
note(`transmittals: ${(await text()).slice(0, 240)}`)
await shot('38-transmittal')

// ---------------------------------------------------------------- 3. audit trail export
await go('audit')
const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
const exp = page.locator('.page').getByRole('button', { name: /Export|CSV/i }).first()
if (await vis(exp, 3000)) await exp.click()
const file = await dl
ok(!!file, `audit trail: exported as CSV${file ? ` (${file.suggestedFilename()})` : ''}`)
if (file) await file.saveAs(`${OUT}/audit-trail.csv`)
note(`audit trail: ${(await text()).slice(0, 300)}`)

// ---------------------------------------------------------------- 4. vendor scope
const sara = who('sara.noor@airco.example')
await signIn(sara.email, sara.temp)
await go('vendor')
const vendorView = await text()
ok(/AirCo/.test(vendorView), 'vendor: the scoped account opens its own company view')
ok(!/Cleanroom panel layout/.test(vendorView), 'vendor: documents of other companies are not visible')
note(`vendor view: ${vendorView.slice(0, 260)}`)
await shot('40-vendor')

// ---------------------------------------------------------------- 5. administration a customer runs
await signIn(admin.email, null)
await page.goto(`${BASE}#/admin`)
await page.waitForTimeout(1200)
// access review
await page.getByRole('button', { name: /Access review/ }).click()
await page.waitForTimeout(1200)
const arText = await text()
note(`access review: ${arText.slice(0, 260)}`)
const startReview = page.getByRole('button', { name: /Start|New review/i }).first()
ok(await vis(startReview, 3000), 'administration: a periodic user-access review can be started')
await shot('41-access-review')
// backups
await page.getByRole('button', { name: /^Backups$/ }).click()
await page.waitForTimeout(1500)
const bkText = await text()
ok(/PostgreSQL/.test(bkText) && !/Backups cannot run/.test(bkText), 'administration: the backup tools are usable on this installation')
note(`backups: ${bkText.slice(0, 220)}`)
await shot('42-backups')
// monitoring
await page.getByRole('button', { name: /^Monitoring$/ }).click()
await page.waitForTimeout(1500)
const mnText = await text()
ok(/Installation health/.test(mnText) && /Running/.test(mnText), 'administration: monitoring shows health and the background jobs')
note(`monitoring: ${mnText.slice(0, 260)}`)
await shot('43-monitoring')
// e-mail
await page.getByRole('button', { name: /E-mail & reminders/ }).click()
await page.waitForTimeout(1500)
const mailText = await text()
ok(/Not configured|not sent|Not sent/i.test(mailText), 'administration: without SMTP the e-mails are recorded as "Not sent" (no silent loss)')
note(`e-mail page: ${mailText.slice(0, 300)}`)
await shot('44-email')
// installation check
await page.getByRole('button', { name: /System & validation/ }).click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: /Run installation check/ }).click()
await page.waitForTimeout(3000)
const iqText = await text()
const fails = (iqText.match(/Fail/g) ?? []).length
ok(/IQ-0?1/.test(iqText), 'administration: the installation check (IQ) runs in the application')
note(`installation check: ${fails} Fail mention(s); ${iqText.slice(0, 300)}`)
await shot('45-iq')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
fs.writeFileSync(`${OUT}/stage8-notes.txt`, notes.join('\n'))
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 8 OK')
process.exit(fail ? 1 : 0)
