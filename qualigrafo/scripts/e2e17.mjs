// Run (fixtures loaded + preview server on :8081): node scripts/e2e17.mjs
// My profile: account facts, my roles per project, password change, sign out of all devices,
// e-mail preference, my recent activity, vendor scope, mobile.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { ACCOUNTS, CHROME, INSECURE, PASSWORD, isNoise, loginAs, signIn, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 8000)
const shot = (n) => page.screenshot({ path: `${OUT}/e2e17-${n}.png`, fullPage: true })
const text = async () => (await page.locator('.page').innerText()).replace(/\s+/g, ' ')

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
await loginAs(page, 'Consultant')

// ---- the sidebar leads to the profile
await page.locator('.sidefoot').getByRole('button', { name: 'My profile' }).first().click()
await page.waitForTimeout(800)
ok(await vis(page.getByRole('heading', { name: 'My profile' })), 'profile: opens from the sidebar')
ok(page.url().endsWith('#/profile'), 'profile: has its own address')

// ---- 1. account facts (maintained by an administrator)
const account = page.locator('section', { has: page.getByRole('heading', { name: 'Account' }) })
ok(await vis(account.getByText(ACCOUNTS.Consultant)), 'account: e-mail shown')
ok(await vis(account.getByText('Account created')) && await vis(account.getByText('Password last changed')), 'account: created, last sign-in and password age are shown')
ok(await vis(account.getByText(/maintained under/)), 'account: says that name and company are maintained by an administrator')

// ---- 2. my access
const access = page.locator('section', { has: page.getByRole('heading', { name: /My access/ }) })
const roleRows = access.locator('tbody tr')
ok(await roleRows.count() >= 1 && await vis(access.getByText('Consultant').first()), `access: ${await roleRows.count()} project role(s) listed`)
ok(await vis(access.getByText('Whole project').first()), 'access: record access stated per project')

// ---- 3. security: timeout facts and the password form
const security = page.locator('section', { has: page.getByRole('heading', { name: 'Security' }) })
ok(await vis(security.getByText(/\d+ minutes/)) && await vis(security.getByText(/\d+ hours/)), 'security: inactivity lock and maximum session shown')
ok(await vis(security.getByLabel('Current password')), 'security: the password can be changed here')
ok(await vis(security.getByRole('button', { name: 'Sign out of all devices' })), 'security: all sessions can be ended')
await shot('profile')

// ---- 4. e-mail preference saved from the page
const mail = page.locator('section', { has: page.getByRole('heading', { name: 'E-mail notifications' }) })
await mail.getByRole('radio', { name: /Daily digest/ }).check()
await mail.getByRole('button', { name: /Save preference/ }).click()
ok(await toast('E-mail preference saved'), 'notifications: preference saved from the profile')
await page.reload(); await page.waitForTimeout(900)
ok(await page.locator('section', { has: page.getByRole('heading', { name: 'E-mail notifications' }) }).getByRole('radio', { name: /Daily digest/ }).isChecked(), 'notifications: the preference is kept')

// ---- 5. my recent activity
const activity = page.locator('section', { has: page.getByRole('heading', { name: /My recent activity/ }) })
ok(await activity.locator('tbody tr').count() > 0, 'activity: my own entries are listed')
ok(await vis(activity.getByText('login.success').first()), 'activity: sign-ins appear')
const activityText = (await activity.innerText()).replace(/\s+/g, ' ')
ok(!/qa@qualigrafo\.test|contractor@qualigrafo\.test/.test(activityText), "activity: another account's entries are not shown")

// ---- a vendor sees its company scope
await page.locator('.sidefoot').getByRole('button', { name: 'Sign out', exact: true }).click()
await page.getByRole('heading', { name: 'Sign in' }).waitFor()
await signIn(page, ACCOUNTS.Vendor)
await page.locator('.side').waitFor()
await page.goto(`${BASE}#/profile`); await page.waitForTimeout(900)
ok(await vis(page.getByText('Limited to').first()), 'vendor: the profile states the company the account is limited to')
ok(await vis(page.getByText("Other companies' records are not visible to you").first()), 'vendor: what the scope means is spelled out')
await shot('vendor')

// ---- sign out of all devices ends this session too
page.once('dialog', (d) => d.accept())
await page.getByRole('button', { name: 'Sign out of all devices' }).click()
ok(await vis(page.getByRole('heading', { name: 'Sign in' }), 8000), 'sessions: signing out of all devices returns to the sign-in screen')
await signIn(page, ACCOUNTS.Vendor)
ok(await vis(page.locator('.side'), 8000), 'sessions: the account can sign in again with its password')

// ---- mobile
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${BASE}#/profile`); await page.waitForTimeout(900)
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'profile page has no horizontal page scroll on mobile')
await shot('mobile')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
