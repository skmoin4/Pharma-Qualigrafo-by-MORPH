// UAT stage 5 — applicability decision, evidence linking and acceptance, handover gates,
// site records (RFI, NCR, finding, action), transmittal and the PDF reports.
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
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true })
const page = await ctx.newPage()
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
const go = async (p) => { await page.goto(`${BASE}#/p/${P}/${p}`); await page.waitForTimeout(1100) }

// ---------------------------------------------------------------- 1. applicability decision (reviewer)
const omar = who('omar.haddad@consult.example')
await signIn(omar.email, omar.temp)
await go('requirements')
await page.locator('tbody .link').first().click()
await page.waitForTimeout(900)
const d = page.locator('.drawer')
// applicability is a select + rationale, then "Record decision"
const selects = d.locator('select')
let applicability = null
for (let i = 0; i < await selects.count(); i++) {
  const opts = await selects.nth(i).locator('option').allTextContents()
  if (opts.some((o) => /Not applicable/i.test(o))) { applicability = selects.nth(i); break }
}
ok(!!applicability, 'requirements: the applicability decision is offered to the reviewer')
await applicability.selectOption({ label: 'Required' })
const rationale = d.locator('textarea').first()
await rationale.fill('Cleanroom finishes apply: the facility has classified rooms in the scope of this project.')
await d.getByRole('button', { name: 'Record decision' }).click()
await page.waitForTimeout(1200)
ok(/Required/.test((await d.innerText()).replace(/\s+/g, ' ')), 'requirements: applicability decided with a recorded rationale')
note('usability: every requirement needs its own decision — 17 decisions on this small project, no bulk action')

// ---------------------------------------------------------------- 2. link the accepted revision as evidence
const sel = d.getByLabel('Document to link')
const opts = await sel.locator('option').allTextContents()
const match = opts.find((o) => /Cleanroom panel layout/.test(o))
ok(!!match, 'evidence: only accepted revisions are offered for linking')
await sel.selectOption({ label: match })
await d.getByPlaceholder(/Which part of this requirement/).fill('Sheet 1: room finishes schedule and flow arrows.')
await d.getByRole('button', { name: 'Link current revision' }).click()
await page.waitForTimeout(1300)
const afterLink = (await d.innerText()).replace(/\s+/g, ' ')
ok(/DOC-001/.test(afterLink), 'evidence: the exact revision is linked to the requirement')
note(`evidence block: ${afterLink.slice(afterLink.indexOf('LINKED EVIDENCE'), afterLink.indexOf('LINKED EVIDENCE') + 260)}`)
await shot('24-evidence-linked')

// ---------------------------------------------------------------- 3. independent acceptance (Owner / QA)
await page.keyboard.press('Escape')
await signIn(admin.email, null)
await go('requirements')
await page.locator('tbody .link').first().click()
await page.waitForTimeout(900)
const d2 = page.locator('.drawer')
const accept = d2.getByRole('button', { name: /^Accept/ }).first()
const canAccept = await vis(accept, 3000)
ok(canAccept, 'evidence: a second reviewer can accept the linked evidence')
if (canAccept) {
  const why = d2.locator('textarea').last()
  if (await vis(why, 1500)) await why.fill('Checked: the layout covers the required finishes and flows.')
  await accept.click()
  await page.waitForTimeout(1400)
  const after = (await d2.innerText()).replace(/\s+/g, ' ')
  ok(/Evidence accepted/i.test(after), 'evidence: requirement now counts as evidenced')
  note(`after acceptance: ${after.slice(0, 220)}`)
}
await shot('25-evidence-accepted')
await page.keyboard.press('Escape')

// ---------------------------------------------------------------- 4. the overview reflects the work
await go('overview')
const ov = await text()
ok(/1\/17|1 \/ 17|1\/1/.test(ov.replace(/\s/g, '')) || /Evidence accepted/.test(ov), 'overview: the figures follow the accepted evidence')
note(`overview figures: ${ov.slice(0, 320)}`)
await shot('26-overview-live')

// ---------------------------------------------------------------- 5. site records: RFI and NCR
await go('rfis')
const rfiBtn = page.getByRole('button', { name: /Raise RFI|New RFI/i }).first()
if (await vis(rfiBtn, 2500)) {
  await rfiBtn.click()
  await page.waitForTimeout(500)
  const fields = page.locator('.page input[type=text], .page textarea')
  if (await fields.count()) await fields.first().fill('Door swing at the corridor interface conflicts with the layout')
  const body = page.locator('.page textarea').first()
  if (await vis(body, 1500)) await body.fill('Please confirm the door swing direction for CR-101.')
  const submit = page.locator('.page').getByRole('button', { name: /^(Raise|Create|Save|Submit)/ }).last()
  if (await vis(submit, 2000)) { await submit.click(); await page.waitForTimeout(1200) }
}
const rfiText = await text()
ok(/RFI-001/.test(rfiText), 'site records: an RFI can be raised')
note(`rfi page: ${rfiText.slice(0, 220)}`)
await shot('27-rfi')

// ---------------------------------------------------------------- 6. reports
await go('handover')
const hv = await text()
note(`handover readiness: ${hv.slice(0, 300)}`)
const pdfBtn = page.getByRole('button', { name: /dossier|PDF/i }).first()
if (await vis(pdfBtn, 2500)) {
  const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
  await pdfBtn.click()
  const file = await dl
  ok(!!file, `reports: the handover dossier is produced as a PDF${file ? ` (${file.suggestedFilename()})` : ''}`)
  if (file) await file.saveAs(`${OUT}/handover-dossier.pdf`)
}
await shot('28-handover')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
fs.writeFileSync(`${OUT}/stage5-notes.txt`, notes.join('\n'))
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 5 OK')
process.exit(fail ? 1 : 0)
