// Run (fixtures loaded WITH load-test projects: npm run fixtures:load -- --projects 100, preview server on :8081):
//   node scripts/e2e15.mjs
// Portfolio at scale (P1): 100+ projects from server summaries, small payload, project data loaded only when opened.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { CHROME, INSECURE, isNoise, loginAs, vis } from './e2e-lib.mjs'

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
// Every API response: path, size, time.
const calls = []
page.on('response', async (r) => {
  const u = new URL(r.url())
  if (!u.pathname.startsWith('/api/projects')) return
  const body = await r.body().catch(() => Buffer.alloc(0))
  calls.push({ path: u.pathname, bytes: body.length, ms: r.request().timing().responseEnd })
})
const portfolioCalls = () => calls.filter((c) => c.path === '/api/projects')

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
const t0 = Date.now()
await loginAs(page, 'Consultant')
await page.getByRole('heading', { name: 'Portfolio' }).waitFor()
const firstRow = page.locator('tbody tr.clickrow')
await firstRow.first().waitFor()
const shownAfter = Date.now() - t0
const rows = await firstRow.count()
ok(rows >= 100, `portfolio lists all ${rows} projects`)
const list = portfolioCalls()[0]
ok(!!list && list.bytes < 1024 * 1024, `portfolio data is one summary request of ${Math.round((list?.bytes ?? 0) / 1024)} kB (< 1 MB)`)
ok(shownAfter < 8000, `sign-in to complete portfolio in ${shownAfter} ms`)
ok(!calls.some((c) => /^\/api\/projects\/[^/]+$/.test(c.path)), 'no project is loaded in full for the portfolio')

// Figures come from the server summaries
const sum = await page.evaluate(async () => {
  const r = await fetch('/api/projects', { headers: { authorization: `Bearer ${localStorage.getItem('qualigrafo-token')}` } })
  const ps = (await r.json()).projects.filter((p) => p.profile.status !== 'Archived')
  return { n: ps.length, work: ps.reduce((n, p) => n + p.work.length, 0), overdue: ps.reduce((n, p) => n + p.stats.overdue, 0), updates: ps.reduce((n, p) => n + p.updates.length, 0) }
})
const tile = async (label) => (await page.locator('.stat', { hasText: label }).locator('.v').innerText()).trim()
ok(await tile('Active projects') === String(sum.n), `active projects tile shows ${sum.n}`)
ok(await tile('Waiting for Consultant') === String(sum.work), `work tile shows ${sum.work} items from the summaries`)
ok(await tile('Overdue records') === String(sum.overdue), `overdue tile shows ${sum.overdue}`)
await page.screenshot({ path: `${OUT}/e2e15-portfolio.png` })

// Opening one project loads exactly that project
const before = calls.length
await page.locator('tr.clickrow', { hasText: 'Load test project 50' }).first().click()
await page.waitForURL(/#\/p\/LT-050\//)
ok(await vis(page.locator('.crumb').getByText('Load test project 50'), 10000), 'opened project shows its name')
await page.getByRole('heading', { name: 'Overview' }).first().waitFor({ timeout: 10000 }).catch(() => undefined)
const opened = calls.slice(before).filter((c) => /^\/api\/projects\/[^/]+$/.test(c.path))
ok(opened.length >= 1 && opened.every((c) => c.path === '/api/projects/LT-050'), `only LT-050 is loaded in full (${opened.length} request(s), ${Math.round((opened[0]?.bytes ?? 0) / 1024)} kB)`)
ok(await vis(page.locator('.nav').getByText('Document register')) && !(await vis(page.getByText('Loading project…'), 300)), 'project workspace ready')
await page.goto(`${BASE}#/p/LT-050/documents`)
ok(await vis(page.getByText('DOC-001').first(), 8000), 'project pages show the loaded project data')

// Switch project from the sidebar
await page.getByLabel('Switch project').selectOption('LT-099')
ok(await vis(page.locator('.crumb').getByText('Load test project 99'), 10000) && await vis(page.getByText('DOC-001').first(), 8000), 'switching project loads the other project')

// Back to the portfolio: fresh summaries
const pc = portfolioCalls().length
await page.locator('.crumb').getByRole('button', { name: 'Portfolio' }).click()
await firstRow.first().waitFor()
await page.waitForTimeout(500)
ok(portfolioCalls().length > pc, 'returning to the portfolio fetches fresh summaries')

// My work and Regulatory watch from the same summaries
await page.goto(`${BASE}#/work`); await page.waitForTimeout(600)
ok(await vis(page.getByText(`${sum.work} item(s) · overdue first`)), `My work lists ${sum.work} items`)
await page.getByLabel('Project').selectOption({ label: 'Load test project 7' })
await page.waitForTimeout(300)
const one = Number(/(\d+) item/.exec(await page.getByText(/item\(s\) · overdue first/).innerText())?.[1])
ok(one > 0 && one < sum.work, `My work filters to one project (${one} items)`)
await page.goto(`${BASE}#/watch`); await page.waitForTimeout(600)
ok(await page.locator('section', { hasText: 'Change inbox' }).locator('tbody tr').count() === sum.updates, `Regulatory watch lists ${sum.updates} updates`)

await page.setViewportSize({ width: 390, height: 844 })
await page.goto(BASE + '#/'); await page.waitForTimeout(800)
ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'portfolio with 100+ projects has no horizontal page scroll on mobile')

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
