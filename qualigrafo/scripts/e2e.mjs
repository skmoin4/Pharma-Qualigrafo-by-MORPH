// Run (preview server on :8081): node scripts/e2e.mjs
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { INSECURE, CHROME, PASSWORD, attach, forget, isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
const PAGES = ['overview', 'setup', 'registers', 'requirements', 'evidence', 'inspector', 'updates', 'actions', 'documents', 'sources', 'reviews', 'activity', 'comments', 'rfis', 'inspections', 'findings', 'changes', 'handover', 'packages', 'schedule', 'audit', 'templates', 'team', 'risks', 'ncrs', 'vendor', 'rehearsal']

let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

async function fresh(width, height) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width, height } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('console: ' + m.text()) })
  await page.goto(BASE + '#/')
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE + '#/')
  await page.reload()
  forget(page)
  await loginAs(page, 'Consultant')
  return { ctx, page, errors }
}
const setRole = switchRole
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
  // Missing doc: submit is blocked until the revision has a source file
  ok(await page.getByRole('button', { name: /Submit R00 for review/ }).isDisabled(), 'UI: submit disabled without a source file')
  await attach(page, 'DOC-012', 'Airflow balancing report.pdf')
  ok(await vis(page.locator('.drawer').getByText('Source of R00')), 'UI: uploaded file shown as source of R00')
  await page.locator('textarea').first().fill('Test report attached')
  await page.getByRole('button', { name: /Submit R00 for review/ }).click()
  await page.waitForTimeout(150)
  ok(await vis(page.locator('.drawer').getByText('Under review').first()), 'UI: contractor submit moves doc to Under review')
  await page.keyboard.press('Escape')

  await page.goto(BASE + '#/p/PRJ-026/activity')
  ok(await vis(page.getByText('Signature request routed to Consultant').first()), 'UI: routing event appears in feed')

  await setRole(page, 'Consultant')
  await page.goto(BASE + '#/p/PRJ-026/documents')
  await page.getByRole('button', { name: 'Airflow balancing report' }).first().click()
  await page.locator('textarea').first().fill('Reviewed')
  const signBtn = page.getByRole('button', { name: /Sign as Consultant/ })
  await signBtn.click()
  ok(await vis(page.getByText('Password is incorrect')), 'UI: e-signature refused without the password')
  await page.getByLabel('Signature password').fill(PASSWORD)
  await signBtn.click()
  ok(await vis(page.getByText('Explicit confirmation required')), 'UI: sign blocked without confirmation checkbox')
  await page.getByLabel('Signature password').fill(PASSWORD)
  await page.locator('.dbody input[type=checkbox]').first().check()
  await signBtn.click()
  await page.waitForTimeout(150)
  ok(await vis(page.getByRole('button', { name: /Sign as Owner/ })), 'UI: auto-advanced to Owner / QA stage')
  await page.keyboard.press('Escape')

  await setRole(page, 'Owner / QA')
  await page.getByRole('button', { name: 'Airflow balancing report' }).first().click().catch(async () => { await page.goto(BASE + '#/p/PRJ-026/documents'); await page.getByRole('button', { name: 'Airflow balancing report' }).first().click() })
  await page.locator('textarea').first().fill('QA approved')
  await page.getByLabel('Signature password').fill(PASSWORD)
  await page.locator('.dbody input[type=checkbox]').first().check()
  await page.getByRole('button', { name: /Sign as Owner/ }).click()
  await page.waitForTimeout(150)
  ok(await vis(page.locator('.drawer').getByText('Accepted').first()), 'UI: revision Accepted after final sign-off')
  await page.keyboard.press('Escape')
  await page.goto(BASE + '#/p/PRJ-026/reviews')
  ok(await vis(page.getByText('DOC-012').first()), 'UI: controlled issue lists DOC-012')

  // new revision invalidates evidence
  await setRole(page, 'Contractor')
  await page.goto(BASE + '#/p/PRJ-026/documents')
  await page.getByRole('button', { name: 'Purified water P&ID' }).first().click()
  await page.getByRole('button', { name: 'Start new revision' }).click()
  await vis(page.locator('.drawer').getByText('Draft').first())
  await page.keyboard.press('Escape')
  await page.goto(BASE + '#/p/PRJ-026/requirements')
  ok((await page.getByText('Revision changed').count()) > 0, 'UI: requirements show “Revision changed” after new revision')
  await page.screenshot({ path: `${OUT}/flow-requirements-stale.png` })

  // sources: standalone import
  await page.goto(BASE + '#/p/PRJ-026/sources')
  await page.setInputFiles('input[type=file]', { name: 'sld.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello-' + Date.now()) })
  await page.waitForTimeout(300)
  ok(await vis(page.getByText(/SHA-256 [0-9a-f]{12}/)), 'UI: checksum shown for chosen file')
  await page.getByRole('button', { name: /^Upload (to|as draft) R\d+$/ }).click()
  ok(await vis(page.getByText('IMP-002')), 'UI: upload recorded in import history')
  ok(await vis(page.getByRole('button', { name: 'Download' }).first()), 'UI: stored file can be downloaded from history')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).first().click()])
  ok(dl.suggestedFilename() === 'sld.pdf', 'UI: download returns the original file name')
  await page.screenshot({ path: `${OUT}/flow-sources.png` })

  // technical comments: raise, respond, close
  await page.goto(BASE + '#/p/PRJ-026/comments')
  await page.getByRole('button', { name: 'New comment' }).click()
  await page.getByPlaceholder(/Sheet 2, grid C-4/).fill('Sheet 1, grid B-2')
  await page.getByPlaceholder('What needs to change, and why?').fill('Add isolation valve tag on the panel feeder')
  // DOC-001 now has an uploaded drawing; this comment is raised without a position on it
  const onDrawing = page.locator('label', { hasText: 'Place on the drawing' }).locator('input')
  if (await onDrawing.count()) await onDrawing.uncheck()
  await page.getByRole('button', { name: 'Raise comment' }).click()
  ok(await vis(page.getByRole('heading', { name: 'CMT-004' })), 'UI: comment raised against the current revision')
  await page.getByPlaceholder('Response or closure rationale…').fill('Tag added on sheet 1')
  await page.getByRole('button', { name: 'Add response' }).click()
  ok(await vis(page.getByText('Tag added on sheet 1')), 'UI: contractor responds to the comment')
  ok(await page.getByRole('button', { name: 'Close comment' }).isDisabled(), 'UI: contractor cannot close a comment')

  // handover gates and package
  await setRole(page, 'Owner / QA')
  await page.goto(BASE + '#/p/PRJ-026/packages')
  await page.getByRole('button', { name: /Freeze package/ }).click()
  await page.waitForTimeout(150)
  ok(await vis(page.getByText('AUD-001').first()), 'UI: audit package frozen')

  ok(errors.length === 0, `workflow session no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
}

// ---------- 3. persistence + project isolation
{
  const { ctx, page } = await fresh(1440, 900)
  await page.goto(BASE + '#/p/PRJ-026/documents')
  await setRole(page, 'Contractor')
  await page.getByRole('button', { name: 'Instrument calibration certificates' }).first().click()
  await attach(page, 'DOC-006', 'calibration-certificates.pdf')
  await page.locator('textarea').first().fill('n')
  await page.getByRole('button', { name: /Submit R00 for review/ }).click()
  await vis(page.locator('.drawer').getByText('Under review').first())
  await page.keyboard.press('Escape')
  await page.goto(BASE + '#/p/PRJ-031/documents')
  await page.waitForTimeout(150)
  const other = await page.locator('tbody tr', { hasText: 'Instrument calibration certificates' }).first().textContent()
  ok(!/Under review/.test(other), 'isolation: change in PRJ-026 does not leak into PRJ-031')
  await page.reload()
  await page.locator('.side').waitFor()
  await page.goto(BASE + '#/p/PRJ-026/documents')
  await page.waitForTimeout(300)
  const mine = await page.locator('tbody tr', { hasText: 'Instrument calibration certificates' }).first().textContent()
  ok(/Under review/.test(mine), 'persistence: PRJ-026 change is stored on the server and survives reload')
  await ctx.close()
}

await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
