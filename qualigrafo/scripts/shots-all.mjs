// Design review (not a test): node scripts/shots-all.mjs — every page as Owner / QA, plus a few overlays and mobile.
// Needs fixtures + a preview server. OUT=dir overrides the output folder (default design-all).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { CHROME, INSECURE, loginAs, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8082/'
const OUT = process.env.OUT ?? 'design-all'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/${name}.png` }) }

await page.goto(BASE + '#/')
await page.evaluate(() => localStorage.clear())
await page.reload()
await loginAs(page, 'Owner / QA')

for (const h of ['work', 'watch', 'library', 'profile', 'new']) {
  await page.goto(`${BASE}#/${h === 'new' ? 'new-project' : h}`)
  await shot(`h-${h}`)
}
await page.goto(`${BASE}#/admin`)
for (const t of ['Access review', 'Security log', 'E-mail & reminders', 'System & validation', 'Backups', 'Monitoring']) {
  await page.getByRole('button', { name: new RegExp(t.replace('&', '&')) }).first().click()
  await shot(`admin-${t.split(' ')[0].toLowerCase()}`)
}
const pages = ['setup', 'registers', 'schedule', 'evidence', 'inspector', 'documents', 'reviews', 'comments', 'rfis', 'inspections', 'findings', 'changes', 'actions', 'handover', 'packages', 'transmittals', 'updates', 'activity', 'sources', 'audit', 'templates', 'team', 'risks', 'ncrs', 'vendor', 'rehearsal']
for (const p of pages) {
  await page.goto(`${BASE}#/p/PRJ-026/${p}`)
  await page.waitForTimeout(500)
  await shot(`p-${p}`)
}
await page.setViewportSize({ width: 414, height: 896 })
for (const p of ['overview', 'requirements', 'documents']) { await page.goto(`${BASE}#/p/PRJ-026/${p}`); await shot(`m-${p}`) }
await browser.close()
console.log(`screenshots in ${OUT}/`)
