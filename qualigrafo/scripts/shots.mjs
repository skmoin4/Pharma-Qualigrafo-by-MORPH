// Design screenshots (not a test): node scripts/shots.mjs  — needs fixtures + a preview server.
// Captures the main screens as Owner / QA for reviewing the look of the interface.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { CHROME, INSECURE, loginAs, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8082/'
const OUT = process.env.OUT ?? 'design-out'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const shot = async (name, full = false) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }) }

await page.goto(BASE + '#/')
await page.evaluate(() => localStorage.clear())
await page.reload()
await shot('01-signin')

await loginAs(page, 'Owner / QA')
await page.waitForTimeout(800)
await shot('02-portfolio')

await page.getByRole('button', { name: /Nova Pharma Expansion/ }).click()
await page.waitForTimeout(1200)
await shot('03-overview')

for (const [name, nav] of [['04-documents', 'Document register'], ['05-requirements', 'Requirements'], ['06-reviews', 'Reviews & approvals'], ['07-schedule', 'Schedule']]) {
  const b = page.locator('.side').getByRole('button', { name: new RegExp(`^${nav}`) }).first()
  if (await vis(b, 2500)) { await b.click(); await shot(name) }
}

await page.goto(`${BASE}#/admin`)
await page.waitForTimeout(600)
await page.getByRole('button', { name: /^Monitoring$/ }).click()
await shot('08-monitoring')
await page.getByRole('button', { name: /^Users$/ }).click()
await shot('09-users')

// overlays (the glass reads best with content behind it)
await page.goto(`${BASE}#/p/PRJ-026/documents`)
await page.waitForTimeout(1200)
const doc = page.locator('tbody .link').first()
if (await vis(doc, 4000)) { await doc.click(); await shot('11-drawer'); await page.keyboard.press('Escape') }
await page.goto(`${BASE}#/p/PRJ-026/comments`); await shot('12-comments')
await page.goto(`${BASE}#/p/PRJ-026/risks`); await shot('13-risks')
await page.keyboard.press('Control+k'); await shot('14-command-palette'); await page.keyboard.press('Escape')

await page.setViewportSize({ width: 414, height: 896 })
await page.goto(`${BASE}#/`)
await page.waitForTimeout(900)
await shot('10-mobile-portfolio')
// mobile sign-in
await page.evaluate(() => localStorage.clear())
await page.reload()
await shot('15-mobile-signin')

await browser.close()
console.log(`screenshots in ${OUT}/`)
