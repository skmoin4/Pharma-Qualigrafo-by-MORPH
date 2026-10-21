// Run (fixtures loaded + preview server on :8081): node scripts/e2e5.mjs
// Drawing-anchored comments on a real PDF, and the Revit connector round trip (the add-in is played by this script).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

/** A small but valid one-page PDF (A4 landscape) with a frame, a grid and a title block, built with correct xref offsets. */
function samplePdf() {
  const draw = ['2 w 30 30 782 535 re S', '0.6 w', ...Array.from({ length: 7 }, (_, i) => `${130 + i * 100} 30 m ${130 + i * 100} 565 l S`), ...Array.from({ length: 4 }, (_, i) => `30 ${140 + i * 110} m 812 ${140 + i * 110} l S`), 'BT /F1 18 Tf 560 50 Td (FIRE PUMP ROOM - GA) Tj ET'].join('\n')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
page.on('dialog', (d) => d.accept())
const go = async (p) => { await page.goto(`${BASE}#/p/PRJ-026/${p}`); await page.waitForTimeout(400) }

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()

// ---- contractor uploads the drawing (PDF) for DOC-007 R00
await loginAs(page, 'Contractor')
await go('documents')
await page.getByRole('button', { name: 'Fire pump installation inspection' }).first().click()
await page.setInputFiles('input[aria-label="Source file for DOC-007"]', { name: 'FP-01 GA drawing.pdf', mimeType: 'application/pdf', buffer: samplePdf() })
await page.getByRole('button', { name: /^Upload (to|as draft) R\d+$/ }).click()
ok(await vis(page.locator('.drawer .filecard', { hasText: 'FP-01 GA drawing.pdf' })), 'drawing PDF uploaded to DOC-007 R00')
await page.keyboard.press('Escape')

// ---- consultant places a comment on the drawing
await switchRole(page, 'Consultant')
await go('comments')
await page.getByRole('button', { name: 'New comment' }).click()
await page.locator('select').filter({ hasText: 'DOC-007' }).first().selectOption('DOC-007')
await page.getByPlaceholder('What needs to change, and why?').fill('Pump suction pipe clashes with the cable tray')
ok(await vis(page.locator('.viewer canvas'), 10000), 'PDF drawing rendered in the comment form')
await page.waitForTimeout(600)
const sheet = page.locator('.sheet').first()
const box = await sheet.boundingBox()
await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4)
ok(await vis(page.getByText(/page 1 selected/)), 'click on the drawing selects the position')
await page.getByRole('button', { name: 'Raise comment' }).click()
ok(await vis(page.getByRole('heading', { name: 'CMT-004' })), 'comment raised on the drawing')
ok(await vis(page.locator('.pin.pin-sel')), 'pin shown on the drawing for the selected comment')
await page.getByRole('button', { name: 'Zoom to comment' }).click()
await page.waitForTimeout(700)
const zoomed = await page.locator('.sheet').first().evaluate((el) => el.offsetWidth)
await page.getByRole('button', { name: 'Full sheet' }).click()
await page.waitForTimeout(500)
const full = await page.locator('.sheet').first().evaluate((el) => el.offsetWidth)
ok(zoomed > full * 2, `zoom to comment enlarges the sheet (${zoomed}px vs ${full}px)`)
await page.screenshot({ path: `${OUT}/s16-drawing-comment.png` })

// ---- Revit: Owner / QA switches the connector on and creates a token
await switchRole(page, 'Owner / QA')
await go('setup')
await page.getByRole('button', { name: 'Revit connector', exact: true }).click()
ok(await vis(page.locator('.badge', { hasText: 'Revit connector' })), 'header shows the Revit input mode')
await page.getByLabel('Token name').fill('CAD workstation 1')
await page.getByRole('button', { name: 'Create token' }).click()
const tokenEl = page.locator('.secret span').first()
ok(await vis(tokenEl), 'connector token shown once')
const token = (await tokenEl.textContent()).trim()
ok(token.startsWith('qgc_'), 'token format')
await page.screenshot({ path: `${OUT}/s16-integrations.png` })

// ---- the add-in publishes a snapshot (this script plays the add-in)
const addin = (method, path, body) => fetch(`${BASE}api/connector/v1${path}`, { method, headers: { authorization: `Connector ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
const pub = await addin('POST', '/snapshots', { model: { guid: 'MDL-MEP-01', name: 'MEP model' }, version: 'Publish 7', changes: [{ elementId: 'E-PUMP-01', kind: 'Modified', detail: 'Suction pipe rerouted' }, { elementId: 'E-TRAY-114', kind: 'Added', detail: 'New cable tray segment' }] })
ok(pub.status === 201, 'add-in published a model snapshot')

// ---- contractor imports the snapshot into a document
await switchRole(page, 'Contractor')
await go('sources')
await page.getByRole('button', { name: 'Revit snapshots' }).click()
ok(await vis(page.getByText('E-TRAY-114')), 'snapshot element changes listed')
await page.getByLabel('Document for the snapshot').selectOption('DOC-005')
await page.getByRole('button', { name: /Import as draft R02/ }).click()
ok(await vis(page.locator('.toastmsg', { hasText: 'DOC-005 R02 created from MEP model Publish 7' })), 'snapshot imported as a new draft revision')

// ---- consultant links the comment to the element and opens it in Revit
await switchRole(page, 'Consultant')
await go('comments')
await page.locator('.cmt', { hasText: 'CMT-004' }).click()
await page.getByLabel('Revit model').selectOption('MDL-MEP-01')
await page.getByLabel('Revit element').fill('E-PUMP-01')
await page.getByRole('button', { name: 'Save link' }).click()
ok(await vis(page.locator('.toastmsg', { hasText: 'Revit element linked' })), 'comment linked to a Revit element')
await page.getByRole('button', { name: 'Open in Revit' }).click()
ok(await vis(page.locator('.revit-panel').getByText('Pending')), 'request waiting for the add-in')
const navs = await (await addin('GET', '/navigation')).json()
ok(navs.requests.length === 1 && navs.requests[0].elementId === 'E-PUMP-01', 'add-in received the request')
await addin('POST', `/navigation/${navs.requests[0].id}/result`, { outcome: 'Focused', detail: 'Selected in 3D view' })
ok(await vis(page.locator('.revit-panel').getByText('Focused · Selected in 3D view'), 8000), 'outcome reported by the add-in appears on the comment')
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Request JSON' }).click()])
ok(dl.suggestedFilename() === 'CMT-004_Revit_navigation.json', 'navigation request JSON can be downloaded')
const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON', exact: true }).click()])
ok(csv.suggestedFilename() === 'Technical_Comments.json', 'comments JSON export')
await page.screenshot({ path: `${OUT}/s16-revit-comment.png` })

ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
