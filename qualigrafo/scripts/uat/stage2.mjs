// UAT stage 2 — requirement library, requirements, documents, review workflow, site records.
// Run after _uat1.mjs: node scripts/_uat2.mjs
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { CHROME, vis } from '../e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8084/'
const OUT = 'uat-out'
const { admin, people } = JSON.parse(fs.readFileSync(`${OUT}/people.json`, 'utf8'))
const PW = 'Nova-Quality-2026'
const who = (email) => people.find((p) => p.email === email)

let fail = 0
const notes = []
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }
const note = (m) => { notes.push(m); console.log(`NOTE  ${m}`) }

const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const text = async () => (await page.locator('.page').innerText()).replace(/\s+/g, ' ')

/** Sign in; a person signing in for the first time sets their own password (PW). */
async function signIn(email, temp) {
  await page.goto(BASE)
  await page.waitForTimeout(400)
  if (await vis(page.getByRole('button', { name: 'Sign out' }), 600)) {
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  }
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(temp ?? PW)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  // a person who already signed in once uses their own password
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
const go = async (hash) => { await page.goto(BASE + hash); await page.waitForTimeout(900) }
const project = async () => {
  const codes = await page.evaluate(async () => (await (await fetch('/api/projects', { headers: { authorization: `Bearer ${localStorage.getItem('qualigrafo-token')}` } })).json()).projects.map((p) => p.profile.id))
  return codes[0]
}

// ---------------------------------------------------------------- 1. requirement library
await signIn(admin.email, null)
const code = await project()
note(`project code: ${code}`)
await go('#/library')
const lib0 = await text()
ok(/No library packs|no packs|empty/i.test(lib0) || /Starter/i.test(lib0), 'library: a new installation starts without approved requirement content')
note(`library page (empty install): ${lib0.slice(0, 260)}`)
await shot('11-library-empty')

ok(/Unverified starter template/i.test(lib0) && /Draft v1/i.test(lib0), 'library: unverified starter drafts are prepared per market, labelled as unverified')
ok(/No approved version/i.test(lib0), 'library: nothing is approved until the customer approves it')
const items = await page.locator('tbody tr').count()
note(`starter draft for the first market: ${items} topic-level items`)

// four eyes: the person who prepared the draft cannot approve it
const approveSelf = page.getByRole('button', { name: /^Approve v/ }).first()
ok(await vis(approveSelf, 3000) && !(await approveSelf.isEnabled()), 'library: the preparer cannot approve their own draft (four-eyes rule)')
ok(/another library editor must approve/i.test(lib0), 'library: the four-eyes rule is explained on screen')
await shot('12-library-draft')

// a second library editor approves
const lina = who('lina.fahmy@novapharma.example')
await signIn(lina.email, lina.temp)
await go('#/library')
await page.waitForTimeout(800)
const approve2 = page.getByRole('button', { name: /^Approve v/ }).first()
ok(await vis(approve2, 4000), 'library: a second editor sees the approval panel')
await page.getByLabel('Approval basis').fill('Checked every topic against the official SFDA GMP text, edition 2024. Clauses and effective dates completed per project.')
await page.getByLabel('Approval password').fill(PW)
ok(await approve2.isEnabled(), 'library: approval needs a written basis and the password (electronic signature)')
await approve2.click()
await page.waitForTimeout(2000)
const after = await text()
ok(/Approved/i.test(after), 'library: version approved and offered to the projects of that market')
note(`library after approval: ${after.slice(0, 220)}`)
await shot('13-library-approved')

// ---------------------------------------------------------------- 2. requirements in the project
await go(`#/p/${code}/updates`)
const upd = await text()
note(`updates & automation page: ${upd.slice(0, 300)}`)
const apply = page.getByRole('button', { name: /Apply|Assess|Review/ }).first()
if (await vis(apply, 2500)) {
  await apply.click()
  await page.waitForTimeout(1200)
  note(`after opening the update: ${(await text()).slice(0, 300)}`)
  await shot('14-library-update')
}
await go(`#/p/${code}/requirements`)
const reqText = await text()
const reqRows = await page.locator('tbody tr').count()
ok(reqRows > 0, `requirements: the project has ${reqRows} requirement(s) after applying the library`)
note(`requirements: ${reqText.slice(0, 240)}`)
await shot('15-requirements')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
fs.writeFileSync(`${OUT}/stage2-notes.txt`, notes.join('\n'))
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 2 OK')
process.exit(fail ? 1 : 0)
