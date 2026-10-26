// UAT stage 1 — a brand-new installation: first admin signs in, creates the team, creates a project.
// Run: node scripts/_uat1.mjs   (UAT API on 4200, web on 8084, empty database + create-admin done)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { CHROME, vis } from '../e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8084/'
const OUT = 'uat-out'
const ADMIN = { email: 'head.qa@novapharma.example', temp: process.env.ADMIN_TEMP, password: 'Nova-Quality-2026' }
fs.mkdirSync(OUT, { recursive: true })

let fail = 0
const notes = []
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }
const note = (m) => { notes.push(m); console.log(`NOTE  ${m}`) }

const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })

await page.goto(BASE)
await page.waitForTimeout(800)

// ---------- 1. first sign-in with the one-time password
ok(await vis(page.getByRole('heading', { name: 'Sign in' })), 'install: the app opens on the sign-in screen')
await page.getByLabel('Email').fill(ADMIN.email)
await page.getByLabel('Password', { exact: true }).fill(ADMIN.temp)
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
ok(await vis(page.getByRole('heading', { name: 'Set a new password' }), 8000), 'install: the temporary password forces a password change')
await page.getByLabel('Temporary password').fill(ADMIN.temp)
await page.getByLabel('New password', { exact: true }).fill(ADMIN.password)
await page.getByLabel('Confirm new password').fill(ADMIN.password)
await page.getByRole('button', { name: 'Change password' }).click()
ok(await vis(page.locator('.side'), 10000), 'install: the workspace opens after setting a password')
await shot('01-first-login')

// ---------- 2. what does an empty installation look like?
const emptyPortfolio = await page.locator('.page').innerText()
note(`empty portfolio text: ${emptyPortfolio.replace(/\s+/g, ' ').slice(0, 220)}`)
ok(await vis(page.getByRole('button', { name: /New project/ }).first()), 'empty install: the administrator can start a project')
await shot('02-empty-portfolio')

// ---------- 3. create the people who will work on the project
const people = [
  { name: 'Omar Haddad', email: 'omar.haddad@consult.example', company: 'Consult Partners', admin: false },
  { name: 'Lina Fahmy', email: 'lina.fahmy@novapharma.example', company: 'Nova Pharma Ltd', admin: true },
  { name: 'Rajesh Kumar', email: 'rajesh.kumar@buildco.example', company: 'BuildCo', admin: false },
  { name: 'Sara Noor', email: 'sara.noor@airco.example', company: 'AirCo', admin: false },
]
await page.goto(`${BASE}#/admin`)
await page.waitForTimeout(700)
for (const p of people) {
  await page.getByRole('button', { name: 'New user' }).click()
  await page.getByLabel('Full name').fill(p.name)
  await page.getByLabel('Email', { exact: true }).fill(p.email)
  await page.getByLabel('Company').fill(p.company)
  if (p.admin) await page.getByLabel(/administrator/i).check()
  await page.getByRole('button', { name: /^Create user$/ }).click()
  const secret = page.locator('.secret').first()
  const shown = await vis(secret, 6000)
  p.temp = shown ? (await secret.innerText()).trim().split('\n')[0] : null
  ok(shown && !!p.temp, `admin: created ${p.name} (${p.email})${p.temp ? ` · one-time password ${p.temp}` : ''}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}
fs.writeFileSync(`${OUT}/people.json`, JSON.stringify({ admin: ADMIN, people }, null, 2))
await shot('03-users')

// ---------- 4. create the project through the wizard
await page.goto(`${BASE}#/`)
await page.waitForTimeout(500)
await page.getByRole('button', { name: /New project/ }).first().click()
await page.waitForTimeout(500)
ok(await vis(page.getByRole('heading', { name: 'New project' })), 'wizard: step 1 opens')
await page.getByLabel('Project name').fill('Riyadh Oral Solids Line 3')
await page.getByLabel('Client (plant owner)').fill('Nova Pharma Ltd')
await page.getByLabel('Site / location').fill('Riyadh, Saudi Arabia')
await page.getByLabel('Plant country').selectOption({ index: 0 })
await shot('04-wizard-1')
await page.getByRole('button', { name: /^Next/ }).click()
await page.waitForTimeout(400)

// step 2: facility, scope, markets
await page.getByLabel('Facility type').selectOption({ index: 1 })
await page.getByLabel('Project scope').selectOption({ index: 0 })
await page.getByLabel('Project phase').fill('Design')
const marketBoxes = page.locator('.card').first().locator('input[type=checkbox]')
const nMarkets = await marketBoxes.count()
for (let i = 0; i < Math.min(2, nMarkets); i++) await marketBoxes.nth(i).check()
await shot('05-wizard-2')
await page.getByRole('button', { name: /^Next/ }).click()
await page.waitForTimeout(400)

// step 3: disciplines + companies (the register starts empty — each company is added)
ok(await vis(page.getByRole('button', { name: /Add company/ })), 'wizard: step 3 (registers) opens with an empty company register')
await page.getByRole('button', { name: /Add company/ }).click()
await page.getByLabel('Company 1 name').fill('BuildCo')
await page.getByLabel('Company 1 type').selectOption({ index: 0 })
await page.getByRole('button', { name: /Add company/ }).click()
await page.getByLabel('Company 2 name').fill('AirCo')
await page.getByLabel('Company 2 type').selectOption({ label: 'Vendor' }).catch(() => undefined)
await page.getByRole('button', { name: /Add company/ }).click()
await page.getByLabel('Company 3 name').fill('Consult Partners')
await page.getByLabel('Company 3 type').selectOption({ label: 'Consultant' }).catch(() => undefined)
await shot('06-wizard-3')
await page.getByRole('button', { name: /^Next/ }).click()
await page.waitForTimeout(400)

// step 4: team — row 1 is the person creating the project (Owner / QA)
const rowCount = () => page.locator('select[aria-label^="Team member"]').count()
ok(await rowCount() === 1, 'wizard: the creator is already on the team as Owner / QA')
const pick = async (email, role, scope) => {
  await page.getByRole('button', { name: /Add person/ }).click()
  const i = await rowCount()
  const sel = page.getByLabel(`Team member ${i}`, { exact: true })
  const opts = await sel.locator('option').allTextContents()
  const match = opts.find((o) => o.includes(email))
  ok(!!match, `wizard: ${email} can be picked from the user directory`)
  if (match) await sel.selectOption({ label: match })
  await page.getByLabel(`Role of team member ${i}`).selectOption(role)
  if (scope) await page.getByLabel(`Record access of team member ${i}`).selectOption(scope)
}
await pick('omar.haddad@consult.example', 'Consultant')
await pick('lina.fahmy@novapharma.example', 'Owner / QA')
await pick('rajesh.kumar@buildco.example', 'Contractor')
await pick('sara.noor@airco.example', 'Contractor', 'AirCo')
await shot('07-wizard-4')
await page.getByRole('button', { name: /^Next/ }).click()
await page.waitForTimeout(400)
await shot('08-wizard-review')
const review = (await page.locator('.page').innerText()).replace(/\s+/g, ' ')
note(`wizard review says: ${review.slice(0, 300)}`)
await page.getByRole('button', { name: /Create project/ }).click()
ok(await vis(page.getByRole('heading', { name: 'Companies & systems' }), 15000) && await vis(page.locator('.crumb').getByText('Riyadh Oral Solids Line 3')), 'wizard: project created and opened on its registers')
await page.waitForTimeout(800)
await shot('09-new-project-overview')

// ---------- 5. what did the new project start with?
const overview = (await page.locator('.page').innerText()).replace(/\s+/g, ' ')
note(`new project overview: ${overview.slice(0, 400)}`)
await page.locator('.side').getByRole('button', { name: /^Requirements/ }).click()
await page.waitForTimeout(900)
const reqs = (await page.locator('.page').innerText()).replace(/\s+/g, ' ')
note(`requirements page on a new project: ${reqs.slice(0, 300)}`)
await shot('10-requirements-empty')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
fs.writeFileSync(`${OUT}/stage1-notes.txt`, notes.join('\n'))
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 1 OK')
process.exit(fail ? 1 : 0)
