// Run (API seeded + preview server on :8081): node scripts/e2e3.mjs  - security flows through the real UI
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { INSECURE, CHROME, ACCOUNTS, PASSWORD } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }
const isNoise = (t) => /Failed to load resource: the server responded with a status of 4\d\d/.test(t)
const vis = (loc, timeout = 5000) => loc.waitFor({ state: 'visible', timeout }).then(() => true, () => false)

const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
page.on('dialog', (d) => d.accept())

const signIn = async (email, password) => {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
const signOut = async () => { await page.getByRole('button', { name: 'Sign out' }).click(); await page.getByRole('heading', { name: 'Sign in' }).waitFor() }

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()

// ---- lockout after repeated failures
for (let i = 0; i < 5; i++) { await signIn('intruder@qualigrafo.test', 'Wrong-password-1'); await page.getByText('Email or password is incorrect.').waitFor() }
await signIn('intruder@qualigrafo.test', 'Wrong-password-1')
ok(await vis(page.getByText(/Too many failed sign-in attempts/)), 'login: lockout message after 5 failures')

// ---- admin creates a user and grants scoped access
await signIn(ACCOUNTS['Owner / QA'], PASSWORD)
await page.locator('.side').waitFor()
ok(await vis(page.getByRole('button', { name: 'Users & access' })), 'admin: sidebar shows Users & access for administrators')
await page.getByRole('button', { name: 'Users & access' }).click()
ok(await vis(page.getByRole('heading', { name: 'Users & access' })), 'admin: page opens')
ok(await vis(page.getByRole('button', { name: 'Demo Vendor (AirCo)' })), 'admin: users list loaded')
await page.getByRole('button', { name: 'New user' }).click()
await page.getByLabel('Full name').fill('Volt Site Engineer')
await page.getByLabel('Email').fill('site.engineer.voltco@qualigrafo.test')
await page.getByLabel('Company').first().fill('VoltCo')
await page.getByRole('button', { name: 'Create user' }).click()
const secret = page.locator('.secret span').first()
ok(await vis(secret), 'admin: temporary password shown once after creation')
const temp = (await secret.textContent()).trim()
ok(/^[A-Za-z]{5}-\d{4}-[A-Za-z]{4}$/.test(temp), `admin: temporary password format (${temp.length} chars)`)
await page.getByLabel('Role on PRJ-026').selectOption('Contractor')
await page.getByLabel('Record scope on PRJ-026').selectOption('VoltCo')
await page.locator('tr', { hasText: 'PRJ-026' }).getByRole('button', { name: 'Save' }).click()
ok(await vis(page.locator('.chips').getByText('PRJ-026 · Contractor (VoltCo)')), 'admin: scoped membership saved and listed')
await page.screenshot({ path: `${OUT}/s13-admin.png` })
await page.getByRole('button', { name: 'Security log' }).click()
ok(await vis(page.locator('tbody').getByText('membership.set').first()) && await vis(page.locator('tbody').getByText('login.locked').first()), 'admin: security log lists membership change and lockout')
await page.screenshot({ path: `${OUT}/s13-security-log.png` })
await signOut()

// ---- first sign-in with the temporary password forces a password change
await signIn('site.engineer.voltco@qualigrafo.test', temp)
ok(await vis(page.getByRole('heading', { name: 'Set a new password' })), 'first sign-in: forced password change screen')
await page.getByLabel('Temporary password').fill(temp)
await page.getByLabel('New password', { exact: true }).fill('short')
ok(await page.getByRole('button', { name: 'Change password' }).isDisabled(), 'first sign-in: weak password cannot be submitted')
await page.getByLabel('New password', { exact: true }).fill('Volt-Engineer-2026')
await page.getByLabel('Confirm new password').fill('Volt-Engineer-2026')
await page.screenshot({ path: `${OUT}/s13-forced-password.png` })
await page.getByRole('button', { name: 'Change password' }).click()
ok(await vis(page.locator('.side')), 'first sign-in: app opens after setting a password')

// ---- scoped user sees only its company and vendor pages
await page.goto(BASE + '#/p/PRJ-026/documents'); await page.waitForTimeout(400)
const owners = await page.locator('tbody tr td:nth-child(6)').allTextContents()
ok(owners.length > 0 && owners.every((o) => o.trim() === 'VoltCo'), `scope: register lists only VoltCo documents (${owners.length})`)
ok(await vis(page.getByText('Vendor · VoltCo').first()), 'scope: vendor badge in the header')
ok(!(await page.getByRole('button', { name: 'Risk register' }).isVisible()) && !(await page.getByRole('button', { name: 'Requirements' }).isVisible()), 'scope: navigation hides pages with other companies\' data')
await page.goto(BASE + '#/p/PRJ-026/risks'); await page.waitForTimeout(300)
ok(await vis(page.getByRole('heading', { name: 'VoltCo: my deliverables' })), 'scope: blocked page falls back to the vendor view')
await page.screenshot({ path: `${OUT}/s13-vendor.png` })

// ---- change password dialog
await page.getByRole('button', { name: 'Change password' }).click()
await page.getByLabel('Current password').fill('not-my-password1')
await page.getByLabel('New password', { exact: true }).fill('Volt-Engineer-2027')
await page.getByLabel('Confirm new password').fill('Volt-Engineer-2027')
await page.getByRole('dialog').getByRole('button', { name: 'Change password' }).click()
ok(await vis(page.getByText('Current password is incorrect.')), 'dialog: wrong current password is reported')
await page.keyboard.press('Escape')
ok(await page.getByRole('dialog').count() === 0, 'dialog: Escape closes it')
await signOut()

// ---- AirCo vendor account
await signIn(ACCOUNTS.Vendor, PASSWORD)
await page.locator('.side').waitFor()
await page.goto(BASE + '#/p/PRJ-026/overview'); await page.waitForTimeout(400)
ok(await vis(page.getByRole('heading', { name: 'AirCo: my deliverables' })), 'vendor: opens on its own deliverables')
ok(await vis(page.getByRole('button', { name: 'AHU technical submittal' }).first()) && !(await page.getByText('Cleanroom panel layout').first().isVisible()), 'vendor: sees AirCo documents only')

ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
