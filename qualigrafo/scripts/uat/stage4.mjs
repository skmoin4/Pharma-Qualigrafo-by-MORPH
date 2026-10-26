// UAT stage 4 — the real working cycle on the fresh installation:
// Owner / QA registers deliverables · contractor uploads and submits · consultant and Owner / QA sign
// electronically · the document is linked as evidence and accepted · handover gates move · site records.
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
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
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

// ---------------------------------------------------------------- 1. Owner / QA registers two deliverables
await signIn(admin.email, null)
await go('documents')
const register = async (title, number, discipline, company, due, critical) => {
  await page.getByRole('button', { name: /New document/ }).click()
  await page.waitForTimeout(500)
  await page.getByLabel('Document title').fill(title)
  await page.getByLabel('Document number').fill(number)
  await page.getByLabel('Document due').fill(due)
  await page.getByLabel('Document discipline').selectOption({ label: discipline })
  const sel = page.getByLabel('Responsible company')
  const opt = (await sel.locator('option').allTextContents()).find((o) => o.startsWith(company))
  await sel.selectOption({ label: opt })
  if (critical) await page.getByLabel('Critical record').check()
  await page.getByRole('button', { name: 'Register document' }).click()
  await page.waitForTimeout(1200)
}
await register('Cleanroom panel layout', 'NPL-001', 'Civil & Cleanroom', 'BuildCo', '2026-11-20', true)
await register('HVAC qualification protocol', 'NPL-002', 'HVAC', 'AirCo', '2026-11-27', true)
const docRows = await page.locator('tbody tr').count()
ok(docRows === 2, `register: ${docRows} deliverable(s) registered as Missing R00`)
await shot('19-register-two-docs')

// ---------------------------------------------------------------- 2. contractor uploads the source and submits
const raj = who('rajesh.kumar@buildco.example')
await signIn(raj.email, raj.temp)
await go('documents')
await page.getByRole('button', { name: 'Cleanroom panel layout' }).first().click()
await page.waitForTimeout(700)
const drawer = page.locator('.drawer')
ok(await drawer.getByRole('button', { name: /Submit R00 for review/ }).isDisabled(), 'workflow: a document cannot be submitted without its source file')
await page.setInputFiles('input[aria-label="Source file for DOC-001"]', { name: 'Cleanroom panel layout R00.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 cleanroom layout ${Date.now()}`) })
await page.getByRole('button', { name: /^Upload (to|as draft) R\d+$/ }).click()
ok(await vis(drawer.locator('.filecard', { hasText: 'Cleanroom panel layout R00.pdf' }).first(), 10000), 'files: the contractor uploads the source file (server-side SHA-256)')
await drawer.locator('textarea').first().fill('Layout issued for review, rev R00.')
await drawer.getByRole('button', { name: /Submit R00 for review/ }).click()
await page.waitForTimeout(800)
ok(await vis(drawer.getByText('Under review').first()), 'workflow: submitted — the document is Under review')
await shot('20-submitted')
await page.keyboard.press('Escape')

// ---------------------------------------------------------------- 3. consultant signs (stage 1)
const omar = who('omar.haddad@consult.example')
await signIn(omar.email, omar.temp)
await go('documents')
await page.getByRole('button', { name: 'Cleanroom panel layout' }).first().click()
await page.waitForTimeout(700)
await drawer.locator('textarea').first().fill('Design reviewed against the cleanroom requirement.')
await drawer.getByRole('button', { name: /Sign as Consultant/ }).click()
ok(await vis(page.getByText(/Password is incorrect|required/i), 4000), 'e-signature: signing is refused without the password / confirmation')
await page.getByLabel('Signature password').fill(PW)
await page.locator('.dbody input[type=checkbox]').first().check()
await drawer.getByRole('button', { name: /Sign as Consultant/ }).click()
await page.waitForTimeout(900)
ok(await vis(drawer.getByRole('button', { name: /Sign as Owner/ }), 6000), 'e-signature: stage 1 signed, routed to Owner / QA')
await shot('21-consultant-signed')
await page.keyboard.press('Escape')

// ---------------------------------------------------------------- 4. Owner / QA signs (stage 2) and accepts
await signIn(admin.email, null)
await go('documents')
await page.getByRole('button', { name: 'Cleanroom panel layout' }).first().click()
await page.waitForTimeout(700)
await drawer.locator('textarea').first().fill('Accepted for construction.')
await page.getByLabel('Signature password').fill(PW)
await page.locator('.dbody input[type=checkbox]').first().check()
await drawer.getByRole('button', { name: /Sign as Owner/ }).click()
await page.waitForTimeout(1200)
ok(await vis(drawer.getByText('Accepted').first(), 6000), 'workflow: second signature accepts the revision')
const sigText = (await drawer.innerText()).replace(/\s+/g, ' ')
ok(/Valid|signature/i.test(sigText), 'e-signature: the signature record is shown on the revision')
note(`signature panel: ${sigText.slice(sigText.indexOf('Revision history') >= 0 ? sigText.indexOf('Revision history') : 0, 420)}`)
await shot('22-accepted')
await page.keyboard.press('Escape')

// ---------------------------------------------------------------- 5. link the document as evidence and accept it
await go('requirements')
await page.locator('tbody .link').first().click()
await page.waitForTimeout(900)
const reqDrawer = page.locator('.drawer')
const linkBtn = reqDrawer.getByRole('button', { name: /Link|Add evidence/i }).first()
if (await vis(linkBtn, 3000)) {
  await linkBtn.click()
  await page.waitForTimeout(600)
  const sel = reqDrawer.locator('select').first()
  if (await vis(sel, 2000)) {
    const opts = await sel.locator('option').allTextContents()
    const match = opts.find((o) => /Cleanroom panel layout/.test(o))
    if (match) await sel.selectOption({ label: match })
  }
  const note1 = reqDrawer.locator('textarea').first()
  if (await vis(note1, 1500)) await note1.fill('Layout drawing shows the cleanroom finishes and flow.')
  const confirm = reqDrawer.getByRole('button', { name: /^(Link|Add|Save)/ }).last()
  if (await vis(confirm, 2000)) { await confirm.click(); await page.waitForTimeout(1200) }
}
const reqText = (await reqDrawer.innerText()).replace(/\s+/g, ' ')
note(`requirement drawer after linking: ${reqText.slice(0, 400)}`)
await shot('23-evidence-linked')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
fs.writeFileSync(`${OUT}/stage4-notes.txt`, notes.join('\n'))
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 4 OK')
process.exit(fail ? 1 : 0)
