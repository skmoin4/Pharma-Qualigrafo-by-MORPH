// Run (preview server on :8081): node scripts/e2e.mjs
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
const PAGES = ['overview', 'setup', 'requirements', 'evidence', 'inspector', 'updates', 'actions', 'documents', 'sources', 'reviews', 'activity', 'comments', 'rfis', 'inspections', 'findings', 'changes', 'handover', 'packages', 'schedule', 'audit', 'templates', 'team', 'risks', 'ncrs', 'vendor', 'rehearsal']

let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function fresh(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(BASE + '#/')
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE + '#/')
  await page.reload()
  return { ctx, page, errors }
}
const setRole = (page, r) => page.selectOption('select[aria-label="Preview role"]', r)
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

// ---------- 1. every page, desktop + mobile: no errors, no horizontal overflow, content rendered
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  const { ctx, page, errors } = await fresh(w, h)
  for (const proj of ['PRJ-026', 'PRJ-031', 'PRJ-018']) {
    for (const p of PAGES) {
      await page.goto(`${BASE}#/p/${proj}/${p}`)
      await page.waitForTimeout(120)
      const h1 = await page.locator('main h1').first().textContent().catch(() => null)
      const ov = await overflow(page)
      ok(!!h1, `[${tag}] ${proj}/${p} renders (“${(h1 ?? '').slice(0, 30)}”)`)
      if (ov > 1) ok(false, `[${tag}] ${proj}/${p} horizontal overflow ${ov}px`)
      if (proj === 'PRJ-026') await page.screenshot({ path: `${OUT}/${tag}-${p}.png`, fullPage: false })
    }
  }
  for (const h of ['', 'work', 'watch']) {
    await page.goto(BASE + '#/' + h)
    await page.waitForTimeout(120)
    ok(!!(await page.locator('main h1').first().textContent().catch(() => null)), `[${tag}] home /${h} renders`)
    ok((await overflow(page)) <= 1, `[${tag}] home /${h} no overflow`)
    await page.screenshot({ path: `${OUT}/${tag}-home-${h || 'portfolio'}.png` })
  }
  ok(errors.length === 0, `[${tag}] no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
}

// ---------- 2. approval workflow through the real UI
{
  const { ctx, page, errors } = await fresh(1440, 900)
  await page.goto(BASE + '#/p/PRJ-026/documents')
  await setRole(page, 'Contractor')
  await page.getByRole('button', { name: 'Airflow balancing report' }).first().click()
  // Missing doc: submit
  await page.locator('textarea').first().fill('Test report attached')
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await page.waitForTimeout(150)
  ok(await page.locator('.drawer').getByText('Under review').first().isVisible(), 'UI: contractor submit moves doc to Under review')
  await page.keyboard.press('Escape')

  await page.goto(BASE + '#/p/PRJ-026/activity')
  ok(await page.getByText('Signature request routed to Consultant').first().isVisible(), 'UI: routing event appears in feed')

  await setRole(page, 'Consultant')
  await page.goto(BASE + '#/p/PRJ-026/documents')
  await page.getByRole('button', { name: 'Airflow balancing report' }).first().click()
  await page.locator('textarea').first().fill('Reviewed')
  const signBtn = page.getByRole('button', { name: /Record sign-off as Consultant/ })
  await signBtn.click()
  ok(await page.getByText('Explicit confirmation required').isVisible().catch(() => false), 'UI: sign blocked without confirmation checkbox')
  await page.locator('.dbody input[type=checkbox]').first().check()
  await signBtn.click()
  await page.waitForTimeout(150)
  ok(await page.getByRole('button', { name: /Record sign-off as Owner/ }).isVisible(), 'UI: auto-advanced to Owner / QA stage')
  await page.keyboard.press('Escape')

  await setRole(page, 'Owner / QA')
  await page.getByRole('button', { name: 'Airflow balancing report' }).first().click().catch(async () => { await page.goto(BASE + '#/p/PRJ-026/documents'); await page.getByRole('button', { name: 'Airflow balancing report' }).first().click() })
  await page.locator('textarea').first().fill('QA approved')
  await page.locator('.dbody input[type=checkbox]').first().check()
  await page.getByRole('button', { name: /Record sign-off as Owner/ }).click()
  await page.waitForTimeout(150)
  ok(await page.locator('.drawer').getByText('Accepted').first().isVisible(), 'UI: revision Accepted after final sign-off')
  await page.keyboard.press('Escape')
  await page.goto(BASE + '#/p/PRJ-026/reviews')
  ok(await page.getByText('DOC-012').first().isVisible(), 'UI: controlled issue lists DOC-012')

  // new revision invalidates evidence
  await setRole(page, 'Contractor')
  await page.goto(BASE + '#/p/PRJ-026/documents')
  await page.getByRole('button', { name: 'Purified water P&ID' }).first().click()
  await page.getByRole('button', { name: 'Start new revision' }).click()
  await page.keyboard.press('Escape')
  await page.goto(BASE + '#/p/PRJ-026/requirements')
  ok((await page.getByText('Revision changed').count()) > 0, 'UI: requirements show “Revision changed” after new revision')
  await page.screenshot({ path: `${OUT}/flow-requirements-stale.png` })

  // sources: standalone import
  await page.goto(BASE + '#/p/PRJ-026/sources')
  await page.setInputFiles('input[type=file]', { name: 'sld.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello-' + Date.now()) })
  await page.waitForTimeout(300)
  ok(await page.getByText('SHA-256').isVisible(), 'UI: checksum shown for chosen file')
  await page.getByRole('button', { name: /Create draft R/ }).click()
  await page.waitForTimeout(200)
  ok(await page.getByText('IMP-001').isVisible(), 'UI: import recorded in history')
  await page.getByRole('button', { name: 'Revit connector' }).click()
  await page.getByRole('button', { name: /Preview sample Revit update/ }).click()
  ok(await page.getByText('DEMO-ELEMENT-MDB-01').isVisible(), 'UI: Revit preview lists changed elements')
  await page.getByRole('button', { name: /Import as draft/ }).click()
  await page.waitForTimeout(200)
  ok(await page.getByText('IMP-002').isVisible(), 'UI: Revit import recorded')
  await page.screenshot({ path: `${OUT}/flow-sources.png` })

  // comments: revit mode outcome
  await page.goto(BASE + '#/p/PRJ-026/comments')
  await page.getByRole('button', { name: 'Revit connector' }).first().click()
  ok(await page.getByText('Revit navigation request').isVisible(), 'UI: Revit panel shows')
  await page.getByRole('button', { name: 'Zoom to comment' }).click()
  const vb = await page.locator('svg[role=img]').first().getAttribute('viewBox')
  ok(vb !== '0 0 800 460', `UI: zoom changes viewBox (${vb})`)

  // handover gates and package
  await setRole(page, 'Owner / QA')
  await page.goto(BASE + '#/p/PRJ-026/packages')
  await page.getByRole('button', { name: /Freeze package/ }).click()
  await page.waitForTimeout(150)
  ok(await page.getByText('AUD-001').first().isVisible(), 'UI: audit package frozen')

  ok(errors.length === 0, `workflow session no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
}

// ---------- 3. persistence + project isolation
{
  const { ctx, page } = await fresh(1440, 900)
  await page.goto(BASE + '#/p/PRJ-026/documents')
  await setRole(page, 'Contractor')
  await page.getByRole('button', { name: 'Instrument calibration certificates' }).first().click()
  await page.locator('textarea').first().fill('n')
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await page.keyboard.press('Escape')
  await page.goto(BASE + '#/p/PRJ-031/documents')
  await page.waitForTimeout(150)
  const other = await page.locator('tbody tr', { hasText: 'Instrument calibration certificates' }).first().textContent()
  ok(!/Under review/.test(other), 'isolation: change in PRJ-026 does not leak into PRJ-031')
  await page.reload()
  await page.goto(BASE + '#/p/PRJ-026/documents')
  await page.waitForTimeout(150)
  const mine = await page.locator('tbody tr', { hasText: 'Instrument calibration certificates' }).first().textContent()
  ok(/Under review/.test(mine), 'persistence: PRJ-026 change survives reload')
  await ctx.close()
}

await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
