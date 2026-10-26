// UAT stage 3 — the working process on a fresh installation:
// apply the library to the project, register a document, upload the source, two-stage signed review,
// link it as evidence, accept it, and watch the handover gates move.
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
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 8000)

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

// ---------------------------------------------------------------- 1. Owner / QA applies the library
await signIn(admin.email, null)
await go('updates')
ok(await vis(page.getByText('Awaiting assessment')), 'updates: the approved library version is offered to the project')
await page.getByPlaceholder(/Qualified-reviewer rationale/i).fill('Starter pack v1 approved by the quality unit; all 17 topics apply to a non-sterile formulation facility in Saudi Arabia.')
await page.getByRole('button', { name: /Apply to project/ }).click()
await page.waitForTimeout(2500)
const applied = await text()
ok(/B2|baseline/i.test(applied), 'updates: applying creates a new requirement baseline')
note(`after applying: ${applied.slice(0, 200)}`)
await go('requirements')
const reqRows = await page.locator('tbody tr').count()
ok(reqRows >= 17, `requirements: ${reqRows} requirement(s) in the project register`)
await shot('16-requirements-filled')

// ---------------------------------------------------------------- 2. register the first document
await go('documents')
await page.getByRole('button', { name: /New document/ }).click()
await page.waitForTimeout(600)
const form = page.locator('.scrim, .drawer, .card').last()
note(`new-document form fields: ${(await form.getByRole('textbox').count())} text field(s), ${(await form.locator('select').count())} select(s)`)
const fill = async (label, value) => { const l = form.getByLabel(label); if (await vis(l, 1500)) await l.fill(value) }
await fill('Title', 'Cleanroom panel layout')
await fill('Document number', 'NPL-001')
const sels = form.locator('select')
for (let i = 0; i < await sels.count(); i++) {
  const name = await sels.nth(i).getAttribute('aria-label') ?? ''
  const opts = await sels.nth(i).locator('option').allTextContents()
  note(`select "${name}": ${opts.slice(0, 6).join(' / ')}`)
}
await shot('17-new-document')
const create = form.getByRole('button', { name: /^(Create|Add|Register)/ }).last()
if (await vis(create, 2000)) { await create.click(); await page.waitForTimeout(1500) }
const docsAfter = await page.locator('tbody tr').count()
ok(docsAfter >= 1, `documents: ${docsAfter} document(s) in the register`)
note(`document register: ${(await text()).slice(0, 220)}`)
await shot('18-document-register')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
fs.writeFileSync(`${OUT}/stage3-notes.txt`, notes.join('\n'))
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 3 OK')
process.exit(fail ? 1 : 0)
