// Run (fixtures loaded + preview server on :8081): node scripts/e2e9.mjs
// Electronic signature in the UI (password, meaning, verification) and the inactivity lock (warning, lock screen,
// unlock in place, server-ended session).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { INSECURE, CHROME, ACCOUNTS, PASSWORD, attach, isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

// a document the contractor can provide and submit
const api = async (method, path, body, token) => (await fetch(`${BASE}api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json()
const qa = (await api('POST', '/auth/login', { email: ACCOUNTS['Owner / QA'], password: PASSWORD })).token
const pd = (await api('GET', '/projects/PRJ-026', undefined, qa)).project
const DOC = pd.docs.find((d) => d.status === 'Missing' || d.status === 'Draft')

const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
page.on('dialog', (d) => d.accept())
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 6000)
const drawer = page.locator('.drawer')
const openDoc = async () => { await page.goto(`${BASE}#/p/PRJ-026/documents`); await page.waitForTimeout(400); await page.getByLabel('Search documents').fill(DOC.id); await page.locator('tr', { hasText: DOC.id }).getByRole('button').first().click() }

await page.clock.install()
await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()

// ---- contractor provides and submits the revision
await loginAs(page, 'Contractor')
await openDoc()
await attach(page, DOC.id, 'e-sign-test.pdf')
await page.getByPlaceholder('Record the submission note or decision reason…').fill('Ready for review')
await drawer.getByRole('button', { name: /^Submit R\d+ for review$/ }).click()
ok(await toast('Submitted for review'), `${DOC.id} submitted`)
await page.keyboard.press('Escape')

// ---- consultant signs electronically
await switchRole(page, 'Consultant')
await openDoc()
ok(await vis(drawer.getByText('Meaning: Reviewed — technically acceptable')), 'signer sees the meaning before signing')
ok(await vis(drawer.locator('.notice', { hasText: 'Electronic signature' }).getByText(/[0-9a-f]{12}…/)), 'signer sees the file checksum the signature binds to')
await page.getByPlaceholder('Record the submission note or decision reason…').fill('Datasheet matches the URS')
await drawer.locator('input[type=checkbox]').first().check()
await page.getByLabel('Signature password').fill('wrong-password-1')
await drawer.getByRole('button', { name: 'Sign as Consultant' }).click()
ok(await toast('Password is incorrect'), 'wrong password: not signed')
ok(await page.getByLabel('Signature password').inputValue() === '', 'password field cleared after an attempt')
await page.getByLabel('Signature password').fill(PASSWORD)
await drawer.getByRole('button', { name: 'Sign as Consultant' }).click()
ok(await toast('Consultant sign-off recorded'), 'signed with the password')
ok(await vis(drawer.getByText('Reviewed — technically acceptable').first()) && await vis(drawer.getByText(ACCOUNTS.Consultant).first()), 'sign-off record shows meaning and signer e-mail')
await drawer.getByRole('button', { name: 'Verify signatures' }).click()
ok(await vis(drawer.getByText('Signature verified')), 'signature hash verifies')
await page.screenshot({ path: `${OUT}/e9-esign.png`, fullPage: true })
await page.keyboard.press('Escape')

// ---- inactivity: warning, stay signed in, lock, unlock in place
await page.goto(`${BASE}#/p/PRJ-026/requirements`); await page.waitForTimeout(500)
await page.clock.fastForward('14:10')
ok(await vis(page.getByText('your session will lock in about a minute')), 'warning one minute before the lock')
await page.getByRole('button', { name: 'Stay signed in' }).click()
ok(!(await vis(page.getByText('your session will lock in about a minute'), 800)), 'activity dismisses the warning')
await page.clock.fastForward('15:30')
ok(await vis(page.getByRole('heading', { name: 'Session locked' })), 'session locked after the idle timeout')
ok(await vis(page.getByText('Locked after 15 minutes without activity')), 'lock screen explains why')
ok(await page.evaluate(() => localStorage.getItem('qualigrafo-token')) === null, 'token dropped when locking')
await page.getByLabel('Unlock password').fill('wrong-password-2')
await page.getByRole('button', { name: 'Unlock' }).click()
ok(await vis(page.locator('.lockscreen').getByText('Email or password is incorrect')), 'wrong password keeps it locked')
await page.getByLabel('Unlock password').fill(PASSWORD)
await page.getByRole('button', { name: 'Unlock' }).click()
ok(await page.locator('.lockscreen').waitFor({ state: 'hidden', timeout: 6000 }).then(() => true, () => false) && page.url().endsWith('/requirements'), 'unlocked on the same page')
ok(await vis(page.getByRole('heading', { name: 'Requirements & evidence' })), 'work continues after unlocking')

// ---- server-ended session (token refused) -> lock, not a lost page
await page.evaluate(() => localStorage.setItem('qualigrafo-token', 'invalid.token.value'))
page.on('response', (r) => { if (process.env.DEBUG && r.url().includes('/api/')) console.log('  resp', r.status(), r.url()) })
await page.evaluate(() => window.dispatchEvent(new Event('focus')))
ok(await vis(page.getByText('Your session has ended')), 'refused token shows the lock screen')
await page.getByLabel('Unlock password').fill(PASSWORD)
await page.getByRole('button', { name: 'Unlock' }).click()
ok(await page.locator('.lockscreen').waitFor({ state: 'hidden', timeout: 6000 }).then(() => true, () => false), 'unlocked again')

await page.setViewportSize({ width: 390, height: 844 })
await page.clock.fastForward('16:00')
ok(await vis(page.getByRole('heading', { name: 'Session locked' })), 'lock works on mobile too')
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'lock screen has no horizontal scroll on mobile')
await page.screenshot({ path: `${OUT}/e9-lock-mobile.png` })
await page.locator('.lockscreen').getByRole('button', { name: 'Sign out' }).click()
ok(await vis(page.getByRole('heading', { name: 'Sign in' })), 'sign out from the lock screen')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
