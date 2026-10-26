// Run (preview server on :8081): node scripts/e2e2.mjs  - remaining feature flows through the real UI
import { chromium } from 'playwright-core'
import { INSECURE, CHROME, attach, isNoise, loginAs, switchRole, vis } from './e2e-lib.mjs'
const BASE = process.env.BASE ?? 'http://localhost:8081/'
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }
const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '#/'); await page.evaluate(() => localStorage.clear()); await page.reload()
await loginAs(page, 'Consultant')
const role = (r) => switchRole(page, r)
const go = async (p) => { await page.goto(`${BASE}#/p/PRJ-026/${p}`); await page.waitForTimeout(120) }
const toastText = async () => { await page.waitForTimeout(500); return page.locator('.toastmsg').last().textContent().catch(() => '') }

// ---- RFI
await go('rfis'); await role('Contractor')
await page.getByRole('button', { name: 'Raise RFI' }).click()
await page.getByPlaceholder(/Question/).fill('Confirm gasket material at PW sample point')
await page.getByLabel('Discipline', { exact: true }).selectOption('Piping & Utilities')
// the server refuses an RFI without a registered system: the form says so before the click
ok(await page.getByRole('button', { name: 'Submit RFI' }).isDisabled(), 'RFI: submit stays disabled until a system is chosen')
ok(await vis(page.getByText('Choose the system or equipment the question is about.')), 'RFI: the form explains what is missing')
await page.getByLabel('System', { exact: true }).selectOption('PW-001')
await page.getByRole('button', { name: 'Submit RFI' }).click()
ok(await vis(page.getByText('RFI-003').first()), 'RFI raised (RFI-003)')
await role('Consultant')
const row = page.locator('tbody tr', { hasText: 'RFI-003' })
await row.getByPlaceholder('Response…').fill('Use EPDM per approved spec')
await row.getByRole('button', { name: 'Record response' }).click()
await vis(row.getByRole('button', { name: /Acknowledge/ }))
await row.getByRole('button', { name: /Acknowledge/ }).click()
ok(await vis(page.locator('tbody tr', { hasText: 'RFI-003' }).getByText('Closed').first()), 'RFI answered then closed')

// ---- inspection (contractor submits, consultant accepts)
await go('inspections'); await role('Contractor')
const ins3 = page.locator('tbody tr', { hasText: 'INS-003' })
await ins3.getByPlaceholder(/Checklist/).fill('Checklist CL-FP-01, photos 12-18')
await ins3.getByRole('button', { name: 'Submit evidence' }).click()
await page.waitForTimeout(400)
await role('Consultant')
const ins3b = page.locator('tbody tr', { hasText: 'INS-003' })
await ins3b.getByPlaceholder('Decision reason…').fill('Matches approved drawing')
await ins3b.getByRole('button', { name: 'Accept', exact: true }).click()
ok(await vis(page.locator('tbody tr', { hasText: 'INS-003' }).getByText('Accepted').first()), 'inspection submitted then accepted')

// ---- finding disposition needs reason; contractor blocked
await go('findings'); await role('Contractor')
ok(await page.getByText('A reviewer must disposition').first().isVisible(), 'finding: contractor cannot disposition')
await role('Consultant')
await page.getByRole('button', { name: 'Resolve', exact: true }).first().click()
ok(/rationale/i.test((await toastText()) ?? ''), 'finding: empty rationale rejected')
await page.getByPlaceholder('Disposition rationale…').first().fill('Alias RE-210 approved in vendor change note')
await page.getByRole('button', { name: 'Resolve', exact: true }).first().click()
ok(await vis(page.getByText('Disposition:').first()), 'finding resolved with rationale')

// ---- change impact: cannot authorise unassessed, then can
await go('changes'); await role('Owner / QA')
await page.getByPlaceholder(/Authorisation decision/).fill('Proceed')
await page.getByRole('button', { name: 'Authorise change' }).click()
ok(/Assess every linked record/.test((await toastText()) ?? ''), 'change: authorise blocked while records unassessed')
const impacted = page.getByRole('button', { name: 'Not impacted' })
for (let i = await impacted.count(); i > 0; i--) { await impacted.nth(i - 1).click(); await page.waitForTimeout(250) }
await page.getByRole('button', { name: 'Authorise change' }).click()
ok(await vis(page.getByText('Authorized').first()), 'change authorised after full assessment')

// ---- gap action: submitter cannot close own action
await go('actions'); await role('Contractor')
await page.getByRole('button', { name: 'Submit for verification' }).first().click()
ok(await vis(page.getByText('Ready for verification').first()), 'gap action submitted for verification')
await role('Consultant')
await page.getByRole('button', { name: /Verify/ }).first().click()
ok(await vis(page.locator('tbody').getByText('Closed').first()), 'independent reviewer closed the action')

// ---- regulatory update
await go('updates'); await role('Consultant')
ok(await page.getByRole('button', { name: /Applicable: create new baseline/ }).isDisabled(), 'update: non-QA cannot decide')
await role('Owner / QA')
ok(await page.getByRole('button', { name: /Applicable: create new baseline/ }).isDisabled(), 'update: the decision is blocked until the rationale is written')
ok(await vis(page.getByText('Write the reviewer rationale first')), 'update: the missing rationale is explained in place')
await page.getByPlaceholder(/Qualified-reviewer rationale/).fill('Affects premises evidence index')
await page.getByRole('button', { name: /Applicable: create new baseline/ }).click()
ok(await vis(page.getByText('B2').first()), 'update applied: baseline B2 created, B1 kept')
ok(await page.getByText('B1').first().isVisible(), 'baseline B1 preserved in history')

// ---- setup: scope change needs rationale and QA
await go('setup'); await role('Contractor')
ok(await page.getByRole('button', { name: /Save as new baseline/ }).isDisabled(), 'setup: contractor cannot save scope')
await role('Owner / QA')
await page.getByRole('button', { name: /Save as new baseline/ }).click()
ok(/rationale/i.test((await toastText()) ?? ''), 'setup: rationale required')

// ---- gap filter chips work
await go('requirements')
await page.getByRole('button', { name: /Missing evidence/ }).click()
const n = await page.locator('tbody tr').count()
ok(n > 0 && (await page.locator('tbody tr').first().textContent()).includes('Evidence missing'), `requirements: gap chip filters (${n} rows)`)

// ---- source reference attestation via drawer
await role('Consultant') // signing in again opens the register unfiltered
await go('requirements')
await page.getByRole('button', { name: 'Premises layout, flow and cleanroom finishes' }).first().click()
await page.getByPlaceholder('Enter from the official text').fill('Section 4.2 (example)')
await page.getByPlaceholder('Edition / amendment').fill('2024 edition')
await page.getByLabel('Source effective date').fill('2024-06-01')
await page.locator('.dbody input[type=checkbox]').first().check()
await page.getByRole('button', { name: 'Save source reference' }).click()
ok(await vis(page.getByText('Reviewer-attested, not expert-verified')), 'source reference saved and labelled as not expert-verified')
await page.keyboard.press('Escape')
ok(await vis(page.getByText('Section 4.2').first()), 'register shows the clause column')

// ---- command palette (Ctrl+K): typed immediately, Enter opens the requirement drawer
await go('overview')
await page.keyboard.press('Control+k')
await page.keyboard.type('material traceab')
ok((await page.getByLabel('Search', { exact: true }).last().inputValue()) === 'material traceab', 'palette: no keystrokes lost')
await page.keyboard.press('Enter')
await page.waitForTimeout(150)
ok(await page.locator('.drawer').getByText('Material traceability for utility piping').first().isVisible(), 'palette: Enter opens the requirement')
await page.keyboard.press('Escape')

// ---- notifications bell
await role('Consultant')
await page.getByRole('button', { name: /Notifications/ }).click()
ok(await vis(page.getByText('Updates for Consultant')), 'bell opens with role-specific updates')
await page.getByRole('button', { name: 'Mark all read' }).click()
ok(await vis(page.getByRole('button', { name: 'Notifications, 0 unread' })), 'bell: mark all read clears the count')
await page.keyboard.press('Escape'); await page.mouse.click(700, 500)

// ---- project registers (Consultant): add a system, import an equipment list; company register is Owner / QA only
await go('registers')
ok(await vis(page.getByRole('heading', { name: 'Companies & systems' })), 'registers: page opens')
ok(await vis(page.getByText('maintained by Owner / QA')), 'registers: consultant sees the company register read-only')
await page.getByRole('button', { name: /Systems & equipment/ }).click()
await page.getByLabel('New system tag').fill('re-202')
await page.getByLabel('New system description').fill('Reactor 202')
await page.getByLabel('Discipline', { exact: true }).first().selectOption('Process Equipment')
await page.getByRole('button', { name: 'Add system' }).click()
ok(await vis(page.locator('tbody tr', { hasText: 'Reactor 202' }).getByText('RE-202')), 'registers: system added with upper-case tag')
await page.getByRole('button', { name: 'Import CSV' }).click()
await page.getByLabel('CSV content').fill('Tag,Description,Discipline,Area,GMP critical\nTK-301,Buffer tank 301,Process Equipment,Utility block,yes\nPU-302,Transfer pump 302,,Utility block,no')
ok(await vis(page.getByRole('button', { name: 'Import 2 system(s)' })), 'registers: CSV preview shows 2 rows')
await page.getByRole('button', { name: 'Import 2 system(s)' }).click()
ok(await vis(page.locator('tbody tr', { hasText: 'Buffer tank 301' }).getByText('GMP critical')), 'registers: imported system with GMP flag listed')
await page.getByRole('button', { name: /Disciplines/ }).click()
await page.getByLabel('New discipline').fill('Automation')
await page.getByRole('button', { name: 'Add', exact: true }).click()
ok(await vis(page.locator('tbody tr', { hasText: 'Automation' })), 'registers: discipline added')
await page.screenshot({ path: 'e2e-out/s14-registers.png' })

// ---- templates & vendors: generate from registered system + company, duplicate blocked, contractor blocked
await go('templates')
await page.getByLabel('Equipment / system tag').selectOption('RE-202')
await page.getByLabel('Assigned vendor').selectOption('EquipCo')
await page.getByLabel('Discipline', { exact: true }).selectOption('Process Equipment')
await page.getByRole('button', { name: 'Generate 3 draft deliverables' }).click()
await page.waitForTimeout(500)
await go('documents')
ok((await page.locator('tbody tr', { hasText: 'RE-202' }).count()) === 3, 'templates: 3 draft deliverables created')
await go('templates')
await page.getByLabel('Equipment / system tag').selectOption('RE-202')
await page.getByLabel('Assigned vendor').selectOption('EquipCo')
await page.getByLabel('Discipline', { exact: true }).selectOption('Process Equipment')
await page.getByRole('button', { name: 'Generate 3 draft deliverables' }).click()
ok(/already exists/.test((await toastText()) ?? ''), 'templates: duplicate package rejected')
await role('Contractor')
ok(await page.getByRole('button', { name: 'Generate 3 draft deliverables' }).isDisabled(), 'templates: contractor cannot generate')

// ---- my work and project switcher
await page.goto(BASE + '#/work'); await page.waitForTimeout(150)
await role('Contractor')
ok((await page.locator('tbody tr').count()) > 0, 'my work: contractor has items')
await role('Owner / QA')
ok((await page.locator('tbody tr').count()) > 0, 'my work: QA has items (sign-offs, applicability decisions)')
await go('overview')
await page.selectOption('select[aria-label="Switch project"]', 'PRJ-018')
await page.waitForTimeout(200)
ok(/Hyderabad Sterile Block/.test(await page.locator('main h1').first().textContent()), 'project switcher opens another project on the same page')

// ---- audit trail records the actions made above
await go('audit')
ok((await page.locator('tbody tr').count()) >= 1, 'audit trail lists events')

// ---- NCR through the UI: contractor responds, Consultant cannot close Critical, QA can
await go('ncrs'); await role('Contractor')
const ncr1 = page.locator('section', { hasText: 'NCR-001' }).first()
await ncr1.getByRole('button', { name: 'Submit response' }).click()
ok(/required/i.test((await toastText()) ?? ''), 'NCR: incomplete response rejected')
const tas = ncr1.locator('textarea')
await tas.nth(0).fill('Welder IDs not transferred to the weld map'); await tas.nth(1).fill('Section B isolated, no further welding'); await tas.nth(2).fill('Re-survey joints, update weld map, NDT sample')
await ncr1.getByRole('button', { name: 'Submit response' }).click()
await page.waitForTimeout(500)
await role('Consultant')
const ncr1b = page.locator('section', { hasText: 'NCR-001' }).first()
await ncr1b.locator('textarea').first().fill('Checked weld map against site marks')
await ncr1b.getByRole('button', { name: /Verify & close/ }).click()
ok(/Owner \/ QA/.test((await toastText()) ?? ''), 'NCR: Consultant cannot close a Critical NCR')
await role('Owner / QA')
await page.locator('section', { hasText: 'NCR-001' }).first().locator('textarea').first().fill('Re-survey and NDT records reviewed')
await page.locator('section', { hasText: 'NCR-001' }).first().getByRole('button', { name: /Verify & close/ }).click()
ok(await vis(page.locator('section', { hasText: 'NCR-001' }).first().getByText('Closed').first()), 'NCR: Owner / QA closed the Critical NCR')

// ---- risk register: heat map + status change
await go('risks')
ok((await page.locator('.hdot').count()) >= 3, 'risks: heat map plots open risks')
await page.getByText('Material traceability gap on purified-water piping').first().click()
await page.getByRole('button', { name: 'Accept risk' }).click()
ok(/note/i.test((await toastText()) ?? ''), 'risks: status change needs a note')
await page.getByLabel('Note (required for every status change)').fill('Residual risk accepted after spot-check plan')
await page.getByRole('button', { name: 'Accept risk' }).click()
ok(await vis(page.getByText('Accepted').first()), 'risks: reviewer accepted a risk')
await page.getByRole('button', { name: 'Raise risk' }).click()
await page.getByRole('button', { name: 'Add to register' }).click()
ok(/required/i.test((await toastText()) ?? ''), 'risks: new risk needs title, owner, mitigation')

// ---- vendor portal: contractor submits from the vendor view
await go('vendor'); await role('Contractor')
await page.selectOption('select[aria-label="Company"]', 'ControlCo')
ok(await vis(page.getByRole('button', { name: /Attach file for R00/ }).first()), 'vendor view: deliverable without a file asks for an attachment')
await page.getByRole('button', { name: /Attach file for R00/ }).first().click()
await attach(page, 'DOC-006', 'calibration-certificates.pdf')
await page.keyboard.press('Escape')
await page.getByPlaceholder('Submission note').first().fill('Calibration certificates attached')
await page.getByRole('button', { name: 'Submit', exact: true }).first().click()
ok(await vis(page.getByText('Awaiting Consultant').first()), 'vendor view: submission routed to Consultant')
await role('Consultant')
ok(await vis(page.getByText('You are signed in as Consultant')), 'vendor view: reviewers see the contractor position read-only')

// ---- applicability for several requirements at once (first set-up of a market pack)
await go('requirements'); await role('Owner / QA')
const pickReq = async (id) => page.locator('tbody tr', { hasText: id }).getByRole('checkbox').check()
await pickReq('REQ-012')
await pickReq('REQ-013')
ok(await vis(page.getByText('2 selected')), 'requirements: several requirements can be selected')
const bulkBtn = page.getByRole('button', { name: /Record decision for 2/ })
ok(await bulkBtn.isDisabled(), 'requirements: a batch decision is blocked until the rationale is written')
await page.getByLabel('Applicability for the selected requirements').selectOption('Not applicable')
await page.getByLabel('Rationale for the selected requirements').fill('No sterile area in this project; both topics excluded.')
await bulkBtn.click()
ok((await toastText()).includes('2 requirement(s) set to Not applicable'), 'requirements: one decision recorded for both')
await go('audit')
ok(await vis(page.getByText(/REQ-01[23].*decided together/).first()), 'requirements: each requirement of the batch has its own audit entry')

// ---- audit rehearsal
await go('rehearsal'); await role('Owner / QA')
ok(await page.getByText('Can answer now', { exact: true }).first().isVisible(), 'rehearsal: summary renders')
await page.getByRole('button', { name: 'Cannot answer yet' }).click()
ok((await page.locator('tbody tr').count()) > 0 && /Cannot answer yet/.test(await page.locator('tbody tr').first().textContent()), 'rehearsal: filter lists unanswerable questions')
await page.getByRole('button', { name: 'European Union' }).click()
ok((await page.locator('tbody tr').count()) > 0, 'rehearsal: switching market works')

// ---- ball in court on the overview
await go('overview')
ok(await page.getByText('Ball in court').isVisible() && (await page.getByText('open', { exact: false }).count()) > 0, 'overview: ball-in-court card renders')

// ---- inspector + evidence map + sign out
await go('inspector'); ok(await page.getByText('Evidence position', { exact: true }).isVisible(), 'inspector renders verdict')
await page.getByLabel('Requirement', { exact: true }).selectOption({ label: 'SA · REQ-008 · Material traceability for utility piping (PW-001)' })
ok(await page.getByText('No evidence linked').first().isVisible(), 'inspector: missing evidence is stated plainly')
await page.getByRole('button', { name: 'Sign out' }).click()
ok(await vis(page.getByRole('heading', { name: 'Sign in' })), 'sign out returns to the login screen')
await page.reload()
ok(await vis(page.getByRole('heading', { name: 'Sign in' })), 'session is cleared after reload')

ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
