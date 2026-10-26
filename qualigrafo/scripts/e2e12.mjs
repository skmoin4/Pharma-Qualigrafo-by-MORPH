// Run (fixtures loaded + preview server on :8081): node scripts/e2e12.mjs
// Periodic user-access review: schedule, start, decisions (incl. disabling an account), e-signature, PDF, history.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { INSECURE, CHROME, ACCOUNTS, PASSWORD, isNoise, loginAs, signIn, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
page.on('dialog', (d) => d.type() === 'prompt' ? d.accept('Started by mistake') : d.accept())
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 8000)
const shot = (n) => page.screenshot({ path: `${OUT}/e2e12-${n}.png`, fullPage: true })
const openTab = async () => { await page.goto(`${BASE}#/admin`); await page.waitForTimeout(400); await page.getByRole('button', { name: /Access review/ }).click(); await page.waitForTimeout(500) }
const decide = async (email, decision, note) => {
  await page.getByLabel(`Decision for ${email}`).selectOption(decision)
  if (note) await page.getByLabel(`Note for ${email}`).fill(note)
  await page.locator('tr', { has: page.getByLabel(`Decision for ${email}`) }).getByRole('button', { name: 'Save decision' }).click()
}

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
await loginAs(page, 'Owner / QA')
await openTab()
ok(await vis(page.getByText('A user-access review is due.')), 'a review is due on a new installation')
ok(await vis(page.getByText('No access reviews yet')), 'history is empty')

// interval
await page.getByLabel('Every (days)').fill('180')
await page.getByRole('button', { name: 'Save interval' }).click()
ok(await toast('Review interval saved'), 'review interval saved')

// start
await page.getByRole('button', { name: 'Start access review' }).click()
ok(await toast(/AR-001 started: 4 account\(s\) to review/), 'AR-001 started for the 4 active accounts')
ok(await page.getByRole('button', { name: 'Start access review' }).isDisabled(), 'no second review while one is open')
ok(await vis(page.getByText('0 of 4 decided').first()), 'progress shown')
await page.getByRole('button', { name: 'Flagged', exact: true }).click()
ok(await vis(page.locator('tbody tr', { hasText: ACCOUNTS['Owner / QA'] }).getByText('Administrator').first()), 'administrator rights are flagged')
await page.getByRole('button', { name: 'All', exact: true }).click()
ok(await page.getByRole('button', { name: 'Sign and complete review' }).isDisabled(), 'cannot sign while accounts are undecided')
const ownOptions = await page.getByLabel(`Decision for ${ACCOUNTS['Owner / QA']}`).locator('option').allTextContents()
ok(!ownOptions.includes('Disable account') && await vis(page.getByText('Your own account: recorded as self-review.')), 'own account: no disable option, self-review warning')

// decisions
await decide(ACCOUNTS.Vendor, 'Disable account', 'AirCo package finished')
ok(await toast('Demo Vendor (AirCo): Disable account'), 'vendor account disabled from the review')
await decide(ACCOUNTS.Contractor, 'Keep with changes', 'Removed PRJ-018 access under Users')
ok(await toast('Demo Contractor: Keep with changes'), 'keep with changes recorded')
await decide(ACCOUNTS.Consultant, 'Keep')
await decide(ACCOUNTS['Owner / QA'], 'Keep')
ok(await vis(page.getByText('4 of 4 decided').first()), 'all four accounts decided')
await shot('decisions')

// sign
await page.getByLabel('Conclusion').fill('All remaining access is appropriate.')
ok(await vis(page.getByText('Access review completed — remaining user access confirmed appropriate').first()), 'signature meaning shown before signing')
await page.getByLabel('Password to sign').fill('wrong-password-1')
await page.getByRole('button', { name: 'Sign and complete review' }).click()
ok(await vis(page.getByRole('alert').filter({ hasText: 'Password is incorrect' })), 'wrong password: not signed')
await page.getByLabel('Password to sign').fill(PASSWORD)
await page.getByRole('button', { name: 'Sign and complete review' }).click()
ok(await toast('AR-001 completed and signed'), 'review signed with the password')
ok(await vis(page.getByText(/Signature Valid/)), 'signature verified as Valid')

// PDF + history
const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('tr', { hasText: 'AR-001' }).last().getByRole('button', { name: 'PDF' }).click()])
const file = `${OUT}/${d.suggestedFilename()}`
await d.saveAs(file)
ok(fs.readFileSync(file).subarray(0, 5).toString() === '%PDF-' && d.suggestedFilename() === 'Qualigrafo_Access_Review_AR-001.pdf', 'access review PDF downloaded')
ok(await vis(page.locator('tr', { hasText: 'AR-001' }).last().getByText('1 changed · 1 disabled')), 'history shows the outcome')
ok(!(await vis(page.getByText('A user-access review is due.'), 500)) && await page.getByRole('button', { name: 'Start access review' }).isEnabled(), 'no longer due after completion')
await shot('completed')

await page.getByRole('button', { name: /Security log/ }).click()
ok(await vis(page.locator('td', { hasText: 'access.review.completed' }).first()) && await vis(page.getByText(/AR-001: Demo Vendor \(AirCo\) -> "Disable account"/)), 'review in the security log')

// the disabled vendor can no longer sign in
await page.getByRole('button', { name: 'Sign out' }).click()
await page.getByRole('heading', { name: 'Sign in' }).waitFor()
await signIn(page, ACCOUNTS.Vendor)
ok(await vis(page.getByText('Email or password is incorrect.')), 'disabled vendor account cannot sign in')

// mobile
await loginAs(page, 'Owner / QA')
await page.setViewportSize({ width: 390, height: 844 })
await openTab()
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'access review has no horizontal page scroll on mobile')
await shot('mobile')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
