// Run (fixtures loaded + preview server on :8081): node scripts/e2e7.mjs
// Document register: register a document, import the Master Document Register from a real .xlsx (preview, row
// errors, all-or-nothing), edit details with a reason, supersede with evidence hand-over, withdraw a link, reinstate.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { INSECURE, CHROME, ACCOUNTS, PASSWORD, isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'

const BASE = process.env.BASE ?? 'http://localhost:8081/'
const OUT = process.env.OUT ?? 'e2e-out'
fs.mkdirSync(OUT, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

/** A real Excel workbook: shared strings for the header, inline strings for text, a numeric date serial for Due. */
function workbook(rows) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const head = rows[0]
  const col = (i) => String.fromCharCode(65 + i)
  const cell = (v, r, i) => {
    const ref = `${col(i)}${r}`
    if (r === 1) return `<c r="${ref}" t="s"><v>${i}</v></c>`
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`
    return v === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`
  }
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, k) => `<row r="${k + 1}">${r.map((v, i) => cell(v, k + 1, i)).join('')}</row>`).join('')}</sheetData></worksheet>`
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="MDR" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${head.map((h) => `<si><t>${esc(h)}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }))
}
const serial = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000)

// pick a document with live evidence links and a replacement, from the fresh fixtures
const api = async (method, path, body, token) => {
  const r = await fetch(`${BASE}api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return r.json().catch(() => ({}))
}
const qa = (await api('POST', '/auth/login', { email: ACCOUNTS['Owner / QA'], password: PASSWORD })).token
const pd = (await api('GET', '/projects/PRJ-026', undefined, qa)).project
const live = (d) => !['Missing', 'Under review', 'Void', 'Superseded'].includes(d.status)
const OLD = pd.docs.find((d) => live(d) && pd.reqs.some((r) => r.evidence.some((e) => e.doc === d.id)))
const NEW = pd.docs.find((d) => d.id !== OLD.id && live(d))
const REQ = pd.reqs.find((r) => r.evidence.some((e) => e.doc === OLD.id))
const company = pd.docs.find((d) => d.owner !== 'Consult Partners').owner
const existing = pd.docs.find((d) => d.id !== OLD.id && d.number)

const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
page.on('dialog', (d) => d.accept())
const toast = (t) => vis(page.locator('.toastmsg', { hasText: t }).last(), 6000)
const go = async (p) => { await page.goto(`${BASE}#/p/PRJ-026/${p}`); await page.waitForTimeout(500) }
const drawer = page.locator('.drawer')

await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()

// ---- contractor: read-only register
await loginAs(page, 'Contractor')
await go('documents')
ok(!(await vis(page.getByRole('button', { name: 'New document' }), 800)), 'contractor cannot register documents')
ok(!(await vis(page.getByRole('button', { name: 'Import register' }), 800)), 'contractor cannot import the register')

// ---- consultant registers one document
await switchRole(page, 'Consultant')
await go('documents')
await page.getByRole('button', { name: 'New document' }).click()
await page.getByLabel('Document title').fill('Cleanroom pressure cascade test report')
await page.getByLabel('Document number').fill('NPL-HVAC-TR-0301')
await page.getByLabel('Document discipline').selectOption('HVAC')
await page.getByLabel('Responsible company').selectOption(company)
await page.getByRole('button', { name: 'Register document' }).click()
ok(await toast('Document registered'), 'document registered')
ok(await vis(page.locator('tr', { hasText: 'NPL-HVAC-TR-0301' }).getByText('Missing')), 'new document listed as Missing with its number')

// ---- MDR import from a real .xlsx: first with a bad row, then the corrected file
await page.getByRole('button', { name: 'Import register' }).click()
const head = ['Document No.', 'Title', 'Discipline', 'Company', 'Due Date', 'Critical']
const badBook = workbook([head, ['NPL-ELE-DS-0401', 'MCC-04 vendor datasheet', 'Electrical', company, serial('2027-01-20'), 'no'], ['NPL-ELE-DS-0402', 'MCC-05 vendor datasheet', 'Plumbing', company, serial('2027-01-20'), '']])
await page.setInputFiles('input[aria-label="Register file"]', { name: 'MDR rev B.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: badBook })
ok(await vis(page.getByText('1 error(s)'), 8000), 'xlsx read and previewed: invalid row reported')
ok(await vis(page.locator('tr', { hasText: 'Plumbing' }).getByText('3')), 'error shows the spreadsheet row number')
ok(!(await vis(page.getByRole('button', { name: /^Import \d+ new/ }), 800)), 'import button withheld while rows have errors')
const goodBook = workbook([head, ['NPL-ELE-DS-0401', 'MCC-04 vendor datasheet', 'Electrical', company, serial('2027-01-20'), 'no'], ['NPL-ELE-DS-0402', 'MCC-05 vendor datasheet', 'electrical', company, serial('2027-01-22'), 'yes'], [existing.number, '', '', '', serial('2027-02-01'), '']])
await page.setInputFiles('input[aria-label="Register file"]', { name: 'MDR rev C.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: goodBook })
ok(await vis(page.locator('.chips').getByText('2 new'), 8000) && await vis(page.locator('.chips').getByText('1 updated')), 'corrected workbook: 2 new, 1 updated')
ok(await vis(page.getByText(/due \d{4}-\d{2}-\d{2} -> 2027-02-01/)), 'preview shows the due-date change (Excel date serial converted)')
await page.getByRole('button', { name: 'Import 2 new and 1 updated' }).click()
ok(await toast('Register imported: 2 new, 1 updated'), 'register imported')
ok(await vis(page.locator('tr', { hasText: 'NPL-ELE-DS-0402' }).getByText('Critical')), 'imported row keeps criticality')
await page.screenshot({ path: `${OUT}/e7-register.png`, fullPage: true })

// ---- edit details with a reason
await page.locator('tr', { hasText: 'NPL-HVAC-TR-0301' }).getByRole('button').first().click()
await drawer.getByRole('button', { name: 'Edit details' }).click()
await page.getByLabel('Edit due').fill('2027-01-31')
await drawer.getByRole('button', { name: 'Save details' }).click()
ok(await toast('State the reason'), 'details change needs a reason')
await page.getByLabel('Change reason').fill('Test window moved after HVAC balancing')
await drawer.getByRole('button', { name: 'Save details' }).click()
ok(await toast('Register details saved'), 'details saved with a reason')
ok(!(await vis(drawer.getByRole('button', { name: 'Void / supersede' }), 800)), 'consultant cannot void documents')
await page.keyboard.press('Escape')

// ---- Owner / QA supersedes a document that carries evidence
await switchRole(page, 'Owner / QA')
await go('documents')
await page.getByLabel('Search documents').fill(OLD.id)
await page.locator('tr', { hasText: OLD.id }).getByRole('button').first().click()
await drawer.getByRole('button', { name: 'Void / supersede' }).click()
await page.getByLabel('Superseded by').selectOption(NEW.id)
await page.getByLabel('Void reason').fill('Merged into the combined qualification report')
await drawer.getByRole('button', { name: `Supersede by ${NEW.id}` }).click()
ok(await toast(`${OLD.id} superseded by ${NEW.id}`), `${OLD.id} superseded by ${NEW.id}`)
ok(await vis(drawer.getByText(`Superseded by ${NEW.id}`).first()), 'drawer shows the superseded banner')
ok(!(await vis(drawer.getByRole('heading', { name: 'Review workflow' }), 800)), 'workflow actions hidden on a superseded document')
await page.keyboard.press('Escape')
ok(await vis(page.getByText('void / superseded hidden')), 'register hides superseded documents by default')
await page.getByLabel('Status').selectOption('Superseded')
ok(await vis(page.locator('tr', { hasText: OLD.id }).getByText(`by ${NEW.id}`)), 'status filter shows the superseded document')

// ---- evidence handed over to the replacement, then a link withdrawn manually
await go('requirements')
await page.getByRole('button', { name: REQ.title }).first().click()
ok(await vis(drawer.getByText('Withdrawn').first()), 'old evidence link shown as withdrawn history')
ok(await vis(drawer.locator('tr', { hasText: NEW.title }).getByText('Pending').first()), 'replacement linked for assessment')
await drawer.getByRole('button', { name: `Withdraw ${NEW.id} link` }).first().click()
await page.getByLabel('Withdraw reason').fill('Wrong section of the replacement referenced')
await drawer.getByRole('button', { name: 'Withdraw link' }).click()
ok(await toast('Evidence link withdrawn'), 'evidence link withdrawn manually')
await page.keyboard.press('Escape')

// ---- reinstate
await go('documents')
await page.getByLabel('Status').selectOption('Superseded')
await page.locator('tr', { hasText: OLD.id }).getByRole('button').first().click()
await page.getByLabel('Reinstate reason').fill('Superseded by mistake: the reports stay separate')
await drawer.getByRole('button', { name: `Reinstate ${OLD.id}` }).click()
ok(await toast('Document reinstated'), 'document reinstated')
ok(await vis(drawer.getByRole('heading', { name: 'Review workflow' })), 'workflow available again after reinstating')
await page.keyboard.press('Escape')

// ---- mobile
await page.setViewportSize({ width: 390, height: 844 })
await go('documents')
await page.getByRole('button', { name: 'Import register' }).click()
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!over, 'document register has no horizontal page scroll on mobile')
await page.screenshot({ path: `${OUT}/e7-register-mobile.png`, fullPage: true })

ok(!errors.length, `no browser errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
