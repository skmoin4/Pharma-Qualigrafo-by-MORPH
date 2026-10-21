// End-to-end API test against freshly loaded fixtures: `npm run fixtures:load && npm test`.
// Mirrors qualigrafo/scripts/workflow.test.ts, but every rule is enforced by the server.
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { app } from '../src/app.ts'
import { prisma } from '../src/db.ts'
import { evidenceState, handoverGates } from '../src/domain/rules.ts'
import type { ProjectData, Role } from '../src/domain/types.ts'

const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
const P = '/projects/PRJ-026'
const PASSWORD = process.env.SEED_PASSWORD ?? 'Demo@12345'
const EMAIL: Record<Role, string> = { Consultant: 'consultant@qualigrafo.test', Contractor: 'contractor@qualigrafo.test', 'Owner / QA': 'qa@qualigrafo.test' }

let fail = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

async function call(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = text }
  return { status: r.status, json }
}

const tokens = {} as Record<Role, string>
let role: Role = 'Consultant'
let last = {} as ProjectData
const as = (r: Role) => { role = r }
/** Runs an action as the current role; returns the error message or null (same contract as the frontend store). */
async function act(path: string, body: unknown = {}): Promise<string | null> {
  const r = await call('POST', P + path, body, tokens[role])
  if (r.status === 200) { last = r.json.project; return null }
  return r.json?.error ?? `HTTP ${r.status}`
}
async function put(path: string, body: unknown): Promise<string | null> {
  const r = await call('PUT', P + path, body, tokens[role])
  if (r.status === 200) { last = r.json.project; return null }
  return r.json?.error ?? `HTTP ${r.status}`
}
const refresh = async () => { last = (await call('GET', P, undefined, tokens[role])).json.project; return last }
const doc = (id: string) => last.docs.find((d) => d.id === id)!
const sha = (b: string) => createHash('sha256').update(b).digest('hex')
/** Multipart upload as the current role; returns error message or null. */
async function upload(docId: string, name: string, content: string, label?: string): Promise<string | null> {
  const fd = new FormData()
  fd.append('file', new Blob([content]), name)
  if (label) fd.append('label', label)
  const r = await fetch(`${base}${P}/docs/${docId}/files`, { method: 'POST', headers: { authorization: `Bearer ${tokens[role]}` }, body: fd })
  const j: any = await r.json().catch(() => null)
  if (r.status === 200) { last = j.project; return null }
  return j?.error ?? `HTTP ${r.status}`
}

try {
  // ---- health & auth
  ok((await call('GET', '/health')).json.ok === true, 'health check reaches the database')
  ok((await call('GET', P)).status === 401, 'project data requires authentication')
  ok((await call('POST', '/auth/login', { email: EMAIL.Consultant, password: 'wrong' })).status === 401, 'wrong password rejected')
  for (const r of Object.keys(EMAIL) as Role[]) {
    const res = await call('POST', '/auth/login', { email: EMAIL[r], password: PASSWORD })
    tokens[r] = res.json.token
  }
  ok(Object.values(tokens).every(Boolean), 'all three demo users can sign in')
  const me = await call('GET', '/auth/me', undefined, tokens.Contractor)
  ok(me.json.memberships.length === 3 && me.json.memberships.every((m: any) => m.role === 'Contractor'), '/auth/me lists project memberships with role')
  const all = await call('GET', '/projects', undefined, tokens['Owner / QA'])
  ok(all.json.projects.length === 3 && typeof all.json.projects[0].stats.attention === 'boolean', 'portfolio returns every project with stats')
  ok((await call('GET', '/projects/PRJ-999', undefined, tokens.Consultant)).status === 404, 'unknown project is 404')
  await refresh()
  ok(last.docs.length === 12 && last.reqs.length === 36 && last.events[0].id === 'EVT-3', 'fixtures loaded')
  ok((await call('POST', P + '/docs/DOC-007/submit', { note: 123 }, tokens.Contractor)).status === 400, 'invalid body is rejected with 400')

  // ---- submission & two-stage sign-off
  as('Contractor')
  ok((await act('/docs/DOC-007/submit', { note: 'Ready' }))?.startsWith('Attach the source file') === true, 'submit blocked until the revision has a source file')

  // ---- file upload & storage
  const pdf = '%PDF-1.4 fire pump inspection ' + Date.now()
  as('Consultant')
  ok(await upload('DOC-007', 'inspection.pdf', pdf) !== null, 'only the contractor uploads source files')
  as('Contractor')
  ok((await upload('DOC-007', 'malware.exe', 'MZ')) ?.includes('not allowed') === true, 'disallowed file type rejected (415)')
  ok((await upload('DOC-007', 'empty.pdf', '')) === 'The file is empty.', 'empty file rejected')
  ok(await upload('DOC-007', 'Fire pump inspection — R00.pdf', pdf) === null, 'contractor uploads the source file')
  ok(doc('DOC-007').rev === 0 && doc('DOC-007').status === 'Draft' && doc('DOC-007').sourceRev === 0, 'file attaches to the unsubmitted draft revision (no new revision)')
  ok(doc('DOC-007').file?.sha256 === sha(pdf) && doc('DOC-007').checksum === sha(pdf), 'server computed SHA-256 of the received bytes')
  ok(doc('DOC-007').file?.name === 'Fire pump inspection — R00.pdf' && doc('DOC-007').file?.mimeType === 'application/pdf', 'UTF-8 filename and MIME type recorded')
  ok(last.imports[0].file?.id === doc('DOC-007').file?.id, 'import history links the stored file')
  ok((await upload('DOC-007', 'copy.pdf', pdf))?.startsWith('Duplicate source') === true, 'identical bytes cannot be imported twice for one document')
  const dl = await fetch(`${base}${P}/files/${doc('DOC-007').file!.id}`, { headers: { authorization: `Bearer ${tokens.Consultant}` } })
  ok(dl.status === 200 && (await dl.text()) === pdf && dl.headers.get('x-checksum-sha256') === sha(pdf), 'download returns the exact bytes with checksum header')
  ok((await fetch(`${base}${P}/files/${doc('DOC-007').file!.id}`)).status === 401, 'download requires authentication')
  ok((await fetch(`${base}/projects/PRJ-031/files/${doc('DOC-007').file!.id}`, { headers: { authorization: `Bearer ${tokens.Consultant}` } })).status === 404, 'file is not reachable through another project')

  ok(await act('/docs/DOC-007/submit', { note: '' }) !== null, 'submit needs a note')
  ok(await act('/docs/DOC-007/submit', { note: 'Ready' }) === null, 'contractor submits DOC-007')
  ok(doc('DOC-007').status === 'Under review', 'status -> Under review')
  ok(last.events[0].category === 'Routing' && last.events[0].forRole === 'Consultant', 'routing event to Consultant created automatically')
  ok(await act('/docs/DOC-007/submit', { note: 'again' }) !== null, 'cannot resubmit a document already under review')

  as('Owner / QA')
  ok(await act('/docs/DOC-007/sign', { reason: 'ok', intent: true }) !== null, 'Owner/QA cannot sign stage 1 (wrong role)')
  as('Consultant')
  ok(await act('/docs/DOC-007/sign', { reason: 'ok', intent: false }) !== null, 'sign blocked without explicit intent confirmation')
  ok(await act('/docs/DOC-007/sign', { reason: 'ok', intent: true }) === null, 'Consultant signs stage 1')
  ok(doc('DOC-007').signStage === 1 && doc('DOC-007').status === 'Under review', 'auto-advanced to stage 2, still under review')
  ok(doc('DOC-007').signatures[0].name === 'Demo Consultant', 'signer name comes from the authenticated account')
  ok(last.events.some((e) => e.category === 'Routing' && e.forRole === 'Owner / QA' && e.doc === 'DOC-007'), 'auto-routed to Owner / QA')
  const issuedBefore = last.issued.length
  as('Owner / QA')
  ok(await act('/docs/DOC-007/sign', { reason: 'ok', intent: true }) === null, 'Owner/QA signs stage 2')
  ok(doc('DOC-007').status === 'Accepted', 'revision accepted after both stages')
  ok(last.issued.length === issuedBefore + 1 && last.issued[0].doc === 'DOC-007', 'controlled issue manifest generated')

  // ---- fresh revision = fresh approval
  as('Consultant')
  ok(await act('/docs/DOC-007/revisions') !== null, 'only the contractor starts a new revision')
  as('Contractor')
  ok(await act('/docs/DOC-007/revisions') === null, 'contractor starts a new revision')
  ok(doc('DOC-007').rev === 1 && doc('DOC-007').status === 'Draft' && doc('DOC-007').signStage === 0, 'new revision starts as Draft at stage 0')
  ok(doc('DOC-007').signatures.every((s) => s.rev === 0), 'old signatures stay bound to R00 only')
  ok(last.events[0].category === 'Revision', 'revision event logged')

  // ---- stale evidence after revision
  ok(evidenceState(last.reqs.find((r) => r.id === 'REQ-006')!, last.docs) === 'Evidence accepted', 'REQ-006 accepted before revising DOC-003')
  ok(await act('/docs/DOC-003/revisions') === null, 'DOC-003 revised')
  ok(evidenceState(last.reqs.find((r) => r.id === 'REQ-006')!, last.docs) === 'Revision changed', 'revising DOC-003 makes linked evidence stale')

  // ---- source import cancels pending route and rejects duplicates
  await upload('DOC-011', 'insulation-tests.pdf', 'IR test sheet A')
  await act('/docs/DOC-011/submit', { note: 'x' })
  ok(doc('DOC-011').status === 'Under review', 'DOC-011 under review')
  ok(await upload('DOC-011', 'insulation-tests-v2.pdf', 'IR test sheet B') === null, 'new file while under review is accepted')
  ok(doc('DOC-011').status === 'Draft' && doc('DOC-011').rev === 1 && doc('DOC-011').file?.name === 'insulation-tests-v2.pdf', 'upload on a submitted revision -> new draft revision')
  ok(last.imports[0].cancelledRoute === true, 'pending route cancelled by source change')
  ok(await upload('DOC-011', 'insulation-tests-v3.pdf', 'IR test sheet C') === null && doc('DOC-011').rev === 1, 'replacing the file of an unsubmitted draft keeps the revision')
  ok((await call('POST', `${P}/docs/DOC-011/imports`, { mode: 'Standalone', label: 'x.pdf', checksum: 'abc' }, tokens.Contractor)).status === 400, 'client-declared checksums are not accepted for files')
  ok((await call('POST', `${P}/docs/DOC-005/imports`, { snapshotId: 'nope' }, tokens.Contractor)).status === 404, 'Revit import needs a snapshot published by the add-in')

  // ---- return for changes
  await act('/docs/DOC-001/submit', { note: 'again' })
  as('Consultant')
  ok(await act('/docs/DOC-001/return', { reason: '' }) !== null, 'return needs a reason')
  ok(await act('/docs/DOC-001/return', { reason: 'fix door swing' }) === null && doc('DOC-001').status === 'Changes requested', 'returned for changes')

  // ---- source reference attestation
  ok(await put('/reqs/REQ-001/source-ref', { clause: 'x', version: '', effective: '', attest: true }) !== null, 'attestation needs clause + version + date')
  ok(await put('/reqs/REQ-001/source-ref', { clause: 'Sec 3', version: '2024 ed', effective: '2024-01-01', attest: true }) === null, 'source reference saved')
  as('Contractor')
  ok(await put('/reqs/REQ-001/source-ref', { clause: 'a', version: 'b', effective: '', attest: false }) !== null, 'contractor cannot edit source reference')

  // ---- evidence: link, self-acceptance block, only current accepted revisions
  ok(await act('/reqs/REQ-008/evidence', { doc: 'DOC-009', note: 'certs' }) !== null, 'missing document cannot be linked')
  ok(await act('/reqs/REQ-008/evidence', { doc: 'DOC-003', note: 'P&ID R04 draft' }) === null, 'contractor links evidence')
  const link = last.reqs.find((r) => r.id === 'REQ-008')!.evidence[0]
  ok(await act('/reqs/REQ-008/evidence', { doc: 'DOC-003', note: 'again' }) !== null, 'same revision cannot be linked twice')
  ok(await act(`/reqs/REQ-008/evidence/${link.id}/assess`, { accept: true, reason: 'x' }) !== null, 'contractor cannot assess evidence')
  as('Consultant')
  ok(await act(`/reqs/REQ-008/evidence/${link.id}/assess`, { accept: true, reason: 'fit' }) !== null, 'draft revision cannot satisfy a requirement')
  ok(await act(`/reqs/REQ-008/evidence/${link.id}/assess`, { accept: false, reason: 'draft only' }) === null, 'reviewer rejects evidence')
  ok(await act('/reqs/REQ-003/applicability', { applicability: 'Required', rationale: '' }) !== null, 'applicability needs rationale')
  ok(await act('/reqs/REQ-003/applicability', { applicability: 'Required', rationale: 'IN scope confirmed' }) === null, 'applicability decided')

  // ---- NCR rules
  ok(await act('/ncrs', { title: 'x', description: '', system: 'PW-001', severity: 'Major', due: '2026-10-30' }) !== null, 'NCR needs a description')
  ok(await act('/ncrs', { title: 'Gasket wrong grade', description: 'EPDM specified, found silicone', system: 'PW-001', severity: 'Critical', due: '2026-10-30' }) === null, 'consultant raises a Critical NCR')
  const nid = last.ncrs[last.ncrs.length - 1].id
  ok(nid === 'NCR-004', 'NCR code continues the sequence')
  ok(await act(`/ncrs/${nid}/respond`, { rootCause: 'a', containment: 'b', correctiveAction: 'c' }) !== null, 'only the contractor can respond')
  as('Contractor')
  ok(await act(`/ncrs/${nid}/respond`, { rootCause: 'a', containment: '', correctiveAction: 'c' }) !== null, 'response needs root cause + containment + corrective action')
  ok(await act(`/ncrs/${nid}/close`, { reason: 'ok' }) !== null, 'contractor cannot close an NCR')
  ok(await act(`/ncrs/${nid}/respond`, { rootCause: 'wrong stock', containment: 'quarantined', correctiveAction: 'replace + check' }) === null, 'contractor submits full response')
  as('Consultant')
  ok(await act(`/ncrs/${nid}/close`, { reason: 'verified' }) !== null, 'Critical NCR cannot be closed by Consultant')
  as('Owner / QA')
  ok(await act(`/ncrs/${nid}/close`, { reason: '' }) !== null, 'closure needs a verification note')
  ok(await act(`/ncrs/${nid}/close`, { reason: 'Replaced and inspected' }) === null, 'Owner/QA closes the Critical NCR')
  ok(last.ncrs.find((n) => n.id === nid)!.status === 'Closed', 'NCR is Closed')
  as('Contractor')
  ok(await act('/ncrs/NCR-002/reopen', { reason: 'x' }) !== null, 'contractor cannot reopen')

  // ---- risk rules
  ok(await act('/risks', { title: 'r', detail: '', system: 'PW-001', likelihood: 4, impact: 5, owner: '', mitigation: '', due: '2026-11-01' }) !== null, 'risk needs owner + mitigation')
  ok(await act('/risks/RSK-001/status', { status: 'Closed', note: 'done' }) !== null, 'contractor cannot close a risk')
  as('Owner / QA')
  ok(await act('/risks/RSK-001/status', { status: 'Closed', note: '' }) !== null, 'risk status change needs a note')
  ok(await act('/risks/RSK-001/status', { status: 'Accepted', note: 'Residual risk accepted by QA' }) === null, 'reviewer accepts a risk with a note')

  // ---- RFIs, inspections, changes, regulatory update, snapshot
  as('Contractor')
  ok(await act('/rfis', { title: 'Confirm valve type', discipline: 'Piping & Utilities', system: 'PW-001', due: '2026-10-25' }) === null && last.rfis.at(-1)!.id === 'RFI-003', 'contractor raises RFI-003')
  ok(await act('/rfis/RFI-003/answer', { response: 'x' }) !== null, 'contractor cannot answer an RFI')
  as('Consultant')
  ok(await act('/rfis/RFI-003/close') !== null, 'unanswered RFI cannot be closed')
  ok(await act('/rfis/RFI-003/answer', { response: 'Use diaphragm valve' }) === null, 'consultant answers RFI')
  as('Contractor')
  ok(await act('/rfis/RFI-003/close') === null, 'requester closes answered RFI')
  ok(await act('/inspections/INS-003/submit', { evidence: 'CL-FP-01' }) === null, 'contractor submits inspection evidence')
  as('Consultant')
  ok(await act('/inspections/INS-003/decide', { accept: true, reason: 'Matches drawing' }) === null, 'consultant accepts inspection')
  ok(await act('/changes/CHG-001/decide', { authorize: true, reason: 'x' }) !== null, 'only Owner / QA authorises changes')
  as('Owner / QA')
  ok(await act('/changes/CHG-001/decide', { authorize: true, reason: 'go' }) !== null, 'cannot authorise with unassessed items')
  for (const item of ['DOC-003', 'DOC-008', 'DOC-009', 'REQ-006', 'REQ-008', 'REQ-017']) await act('/changes/CHG-001/impact', { item, impact: 'Not impacted' })
  ok(await act('/changes/CHG-001/decide', { authorize: true, reason: 'All assessed' }) === null && last.changes[0].status === 'Authorized', 'change authorised after full assessment')
  const b0 = last.baseline
  ok(await act('/updates/UPD-1/assess', { applicable: true, reason: 'Index format adopted' }) === null && last.baseline === b0 + 1, 'applicable update creates a new baseline')
  ok(last.reqs.find((r) => r.id === 'REQ-001')!.evidence.every((e) => e.decision === 'Pending'), 'affected evidence reopened')
  ok(await act('/updates/UPD-1/assess', { applicable: false, reason: 'again' }) !== null, 'update cannot be assessed twice')
  ok(await act('/snapshots') === null && last.snapshots[0].id === 'AUD-001' && last.snapshots[0].rows.length > 0, 'audit snapshot frozen')

  // ---- reminders are sent by reviewers; simulation endpoints are gone
  as('Contractor')
  ok(await act('/reminders/send') !== null, 'contractor cannot send reminders')
  as('Consultant')
  ok(await act('/reminders/send') === null && last.events[0].category === 'Reminder' && last.events[0].text.startsWith('Reminder:'), 'reviewer sends in-app reminders to waiting signers')
  ok((await call('POST', `${P}/pins/CMT-001/revit-navigation`, { requestId: 'NAV-1' }, tokens.Consultant)).status === 404, 'old simulation endpoint removed')
  ok(/^\d{4}-\d{2}-\d{2}$/.test((await call('GET', '/reference/config')).json.today), 'server publishes its working date')
  as('Owner / QA')

  // ---- notifications are per user
  const unread = (p: ProjectData) => p.events.filter((e) => !e.read).length
  ok(await act('/notices/read-all') === null && unread(last) === 0, 'Owner / QA marks all read')
  as('Consultant')
  ok(unread(await refresh()) > 0, 'read state is per user (Consultant still has unread)')

  // ---- audit trail is server-side and attributed
  const audit = await call('GET', `${P}/audit?limit=5`, undefined, tokens.Consultant)
  ok(audit.json.events.length === 5 && audit.json.events.every((e: any) => e.user && e.requestId), 'audit entries carry user identity and request id')
  const csv = await call('GET', `${P}/audit?format=csv`, undefined, tokens.Consultant)
  ok(typeof csv.json === 'string' && csv.json.startsWith('"Seq"'), 'audit CSV export')

  ok(handoverGates(last).some((g) => g.key === 'ncr'), 'handover gates include non-conformances')

  // ======================================================== step 13: security hardening
  const login = (email: string, password: string) => call('POST', '/auth/login', { email, password })
  const get = (path: string, token: string) => call('GET', path, undefined, token)
  const send = (method: string, path: string, body: unknown, token: string) => call(method, path, body, token)
  const QA = tokens['Owner / QA']

  // ---- sign-in limiter + security log
  for (let i = 0; i < 5; i++) await login('nobody@qualigrafo.test', 'wrong-password-1')
  const locked = await login('nobody@qualigrafo.test', 'wrong-password-1')
  ok(locked.status === 429 && /Too many failed sign-in attempts/.test(locked.json.error), '6th failed sign-in for the same account is locked out (429)')
  ok((await login(EMAIL.Consultant, PASSWORD)).status === 200, 'lockout is per account: other users can still sign in')
  const sec = await get('/admin/security-events?limit=50', QA)
  ok(sec.json.events.some((e: any) => e.type === 'login.locked') && sec.json.events.some((e: any) => e.type === 'login.failure' && e.detail === 'unknown account'), 'security log records failures and lockouts')
  ok((await get('/admin/users', tokens.Consultant)).status === 403, 'non-administrators cannot open user administration')

  // ---- vendor isolation (AirCo-scoped Contractor)
  const vendor = (await login('vendor@qualigrafo.test', PASSWORD)).json.token as string
  const vp = (await get(P, vendor)).json
  ok(vp.scope === 'AirCo' && vp.project.docs.length > 0 && vp.project.docs.every((d: any) => d.owner === 'AirCo'), 'vendor sees only its own company documents')
  ok(vp.project.reqs.length === 0 && vp.project.risks.length === 0 && vp.project.changes.length === 0, 'vendor does not see requirements, risks or changes')
  ok(vp.project.pins.every((p: any) => vp.project.docs.some((d: any) => d.id === p.doc)), 'vendor sees only comments on its own documents')
  ok(vp.project.events.every((e: any) => vp.project.docs.some((d: any) => d.id === e.doc)), 'vendor notifications are limited to its own documents')
  const vact = (path: string, body: unknown = {}) => send('POST', P + path, body, vendor)
  ok((await vact('/docs/DOC-001/submit', { note: 'x' })).status === 404, 'another company\'s document is reported as not found')
  ok((await vact('/ncrs', { title: 't', description: 'd', system: 'AHU-01', severity: 'Minor', due: '2026-11-01' })).status === 403, 'vendor cannot raise NCRs')
  ok((await get(`${P}/audit`, vendor)).status === 403, 'vendor cannot read the project audit trail')
  const fd = new FormData()
  fd.append('file', new Blob(['AirCo balancing report v1']), 'airflow-balancing.pdf')
  const up = await fetch(`${base}${P}/docs/DOC-012/files`, { method: 'POST', headers: { authorization: `Bearer ${vendor}` }, body: fd })
  ok(up.status === 200, 'vendor uploads a file to its own document')
  ok((await vact('/docs/DOC-012/submit', { note: 'Balancing report attached' })).status === 200, 'vendor submits its own document')
  const otherFile = last.docs.find((d) => d.file && d.owner !== 'AirCo')?.file
  ok(!!otherFile && (await fetch(`${base}${P}/files/${otherFile.id}`, { headers: { authorization: `Bearer ${vendor}` } })).status === 404, 'vendor cannot download another company\'s file')
  ok((await vact('/pins/CMT-002/replies', { text: 'Access panel moved 200 mm', close: false })).status === 200, 'vendor replies to a comment on its own document')
  ok((await vact('/pins/CMT-001/replies', { text: 'x', close: false })).status === 404, 'vendor cannot reach comments on other documents')
  ok((await vact('/rfis', { title: 'Confirm filter class', discipline: 'HVAC', system: 'AHU-01', due: '2026-10-30' })).status === 200, 'vendor raises an RFI')
  const vp2 = (await get(P, vendor)).json.project
  ok(vp2.rfis.length === 1 && vp2.rfis[0].title === 'Confirm filter class', 'vendor sees only its own RFIs')
  ok(vp2.audit.length > 0 && vp2.audit.every((a: any) => a.user === 'Demo Vendor (AirCo)'), 'vendor audit view lists only its own actions')

  // ---- user administration, temporary passwords, forced change, token revocation
  const created = await send('POST', '/admin/users', { email: 'new.engineer.voltco@qualigrafo.test', name: 'New Engineer', company: 'VoltCo' }, QA)
  ok(created.status === 201 && /^[A-Za-z]{5}-\d{4}-[A-Za-z]{4}$/.test(created.json.tempPassword), 'admin creates a user with a one-time temporary password')
  ok((await send('POST', '/admin/users', { email: 'NEW.engineer.voltco@qualigrafo.test', name: 'Dup' }, QA)).status === 422, 'duplicate email rejected (case-insensitive)')
  const newId = created.json.user.id as string
  let nt = (await login('new.engineer.voltco@qualigrafo.test', created.json.tempPassword)).json.token as string
  ok((await get('/auth/me', nt)).json.user.mustChangePassword === true, 'temporary password forces a password change')
  ok((await get('/projects', nt)).status === 403, 'API is blocked until the password is changed')
  ok((await send('POST', '/auth/password', { current: created.json.tempPassword, next: 'short1' }, nt)).status === 422, 'weak password rejected by policy')
  ok((await send('POST', '/auth/password', { current: 'wrong', next: 'Engineer-2026-ok' }, nt)).status === 422, 'password change needs the current password')
  const changed = await send('POST', '/auth/password', { current: created.json.tempPassword, next: 'Engineer-2026-ok' }, nt)
  ok(changed.status === 200 && changed.json.user.mustChangePassword === false, 'password changed')
  ok((await get('/auth/me', nt)).status === 401, 'old session token is revoked after a password change')
  nt = changed.json.token
  ok((await get('/projects', nt)).json.projects.length === 0, 'a new user without memberships sees no projects')
  ok((await send('PUT', `/admin/users/${newId}/memberships/PRJ-026`, { role: 'Consultant', scope: 'VoltCo' }, QA)).status === 422, 'company scope is only allowed for Contractor memberships')
  ok((await send('PUT', `/admin/users/${newId}/memberships/PRJ-026`, { role: 'Contractor', scope: 'VoltCo' }, QA)).status === 200, 'admin grants a VoltCo-scoped Contractor membership')
  const np = (await get(P, nt)).json
  ok(np.role === 'Contractor' && np.project.docs.every((d: any) => d.owner === 'VoltCo') && np.project.docs.length > 0, 'membership scope applies immediately')
  ok((await get(`${P}/audit?limit=20`, QA)).json.events.some((e: any) => e.text.startsWith('Membership: New Engineer')), 'membership change is written to the project audit trail')
  ok((await send('PATCH', `/admin/users/${(await get('/auth/me', QA)).json.user.id}`, { active: false }, QA)).status === 422, 'admin cannot deactivate their own account')
  const reset = await send('POST', `/admin/users/${newId}/reset-password`, {}, QA)
  ok(reset.status === 200 && (await get('/auth/me', nt)).status === 401, 'admin password reset revokes existing sessions')
  nt = (await login('new.engineer.voltco@qualigrafo.test', reset.json.tempPassword)).json.token
  ok((await send('PATCH', `/admin/users/${newId}`, { active: false }, QA)).status === 200, 'admin deactivates the user')
  ok((await get('/auth/me', nt)).status === 401 && (await login('new.engineer.voltco@qualigrafo.test', reset.json.tempPassword)).status === 401, 'deactivated user is signed out and cannot sign in')
  ok((await send('DELETE', `/admin/users/${newId}/memberships/PRJ-026`, undefined, QA)).status === 200, 'admin removes the membership')
  const qaId = (await get('/auth/me', QA)).json.user.id as string
  const consultantId = (await get('/auth/me', tokens.Consultant)).json.user.id as string
  ok((await send('PUT', `/admin/users/${qaId}/memberships/PRJ-031`, { role: 'Consultant' }, QA)).json.error?.includes('no active Owner / QA') === true, 'the last Owner / QA of a project cannot be downgraded')
  ok((await send('DELETE', `/admin/users/${qaId}/memberships/PRJ-031`, undefined, QA)).status === 422, 'the last Owner / QA of a project cannot be removed')
  ok((await send('PUT', `/admin/users/${consultantId}/memberships/PRJ-031`, { role: 'Owner / QA' }, QA)).status === 200
    && (await send('PUT', `/admin/users/${qaId}/memberships/PRJ-031`, { role: 'Consultant' }, QA)).status === 200, 'Owner / QA can be handed over once another exists')
  await send('PUT', `/admin/users/${qaId}/memberships/PRJ-031`, { role: 'Owner / QA' }, QA)
  await send('PUT', `/admin/users/${consultantId}/memberships/PRJ-031`, { role: 'Consultant' }, QA)
  const types = (await get('/admin/security-events?limit=100', QA)).json.events.map((e: any) => e.type)
  ok(['user.created', 'password.changed', 'password.reset', 'user.deactivated', 'membership.set', 'membership.removed'].every((t) => types.includes(t)), 'every administrative action is in the security log')

  // ======================================================== production step 2: project registers
  const reg = (who: Role, method: string, path: string, body?: unknown) => call(method, P + path, body, tokens[who])
  const proj = async () => (await get(P, QA)).json.project as ProjectData

  let pr = await proj()
  ok(pr.companies.some((c) => c.name === 'Nova Pharma Ltd' && c.kind === 'Owner') && pr.systems.some((s) => s.tag === 'PW-001') && pr.disciplines.length === 8, 'project payload carries companies, systems and disciplines')
  ok((await get(P, vendor)).json.project.companies.every((c: any) => c.name === 'AirCo'), 'vendor sees only its own company in the register')

  // systems
  ok((await reg('Contractor', 'POST', '/systems', { tag: 'RE-202', name: 'Reactor 202' })).status === 403, 'contractor cannot add systems')
  ok((await reg('Consultant', 'POST', '/systems', { tag: 're-202', name: 'Reactor 202', discipline: 'Process Equipment', gmpCritical: true })).status === 200, 'consultant adds a system (tag normalised to upper case)')
  pr = await proj()
  ok(pr.systems.some((s) => s.tag === 'RE-202' && s.gmpCritical && s.discipline === 'Process Equipment'), 'system stored with discipline and GMP flag')
  ok((await reg('Consultant', 'POST', '/systems', { tag: 'RE-202', name: 'Again' })).json.error?.includes('already') === true, 'duplicate tag rejected')
  ok((await reg('Consultant', 'POST', '/systems', { tag: 'BAD TAG!', name: 'x' })).status === 422, 'invalid tag rejected')
  ok((await reg('Consultant', 'POST', '/systems', { tag: 'TK-301', name: 'Tank', discipline: 'Astrology' })).json.error?.includes('not an active discipline') === true, 'unknown discipline rejected')
  const dupImport = await reg('Owner / QA', 'POST', '/systems/import', { rows: [{ tag: 'TK-301', name: 'Buffer tank 301' }, { tag: 'tk-301', name: 'Duplicate' }] })
  ok(dupImport.status === 422 && dupImport.json.error.startsWith('Row 2:'), 'import reports the failing row')
  ok(!(await proj()).systems.some((s) => s.tag === 'TK-301'), 'failed import adds nothing (all or nothing)')
  ok((await reg('Owner / QA', 'POST', '/systems/import', { rows: [{ tag: 'TK-301', name: 'Buffer tank 301', area: 'Utility block' }, { tag: 'PU-302', name: 'Transfer pump 302', discipline: 'Process Equipment' }] })).status === 200, 'equipment list imported')
  ok((await reg('Contractor', 'POST', '/rfis', { title: 'Nozzle orientation?', discipline: 'Process Equipment', system: 'XX-999', due: '2026-11-01' })).json.error?.includes('not in the system register') === true, 'RFI against an unregistered system is rejected')
  ok((await reg('Consultant', 'PUT', '/systems/TK-301', { active: false })).status === 200, 'system deactivated')
  ok((await reg('Owner / QA', 'POST', '/risks', { title: 'Tank delivery late', detail: '', system: 'TK-301', likelihood: 2, impact: 2, owner: 'EquipCo', mitigation: 'Expedite', due: '2026-11-10' })).json.error?.includes('inactive') === true, 'inactive system cannot be used for new records')
  ok((await reg('Consultant', 'PUT', '/systems/TK-301', { name: 'Buffer tank 301 (WFI)', active: true })).status === 200 && (await proj()).systems.find((s) => s.tag === 'TK-301')?.name === 'Buffer tank 301 (WFI)', 'system description edited and reactivated')

  // companies
  ok((await reg('Consultant', 'POST', '/companies', { name: 'Delta Valves', kind: 'Vendor / supplier' })).status === 403, 'only Owner / QA maintains the company register')
  ok((await reg('Owner / QA', 'POST', '/companies', { name: 'Delta  Valves', kind: 'Vendor / supplier', contactEmail: 'sales@delta.test' })).status === 200, 'Owner / QA adds a company')
  pr = await proj()
  ok(pr.companies.some((c) => c.name === 'Delta Valves' && c.contactEmail === 'sales@delta.test'), 'company name normalised, contact stored')
  ok((await reg('Owner / QA', 'POST', '/deliverables', { tag: 'RE-202', vendor: 'Unknown Ltd', discipline: 'Process Equipment', due: '2026-11-20' })).json.error?.includes('company') === true, 'deliverables need a registered vendor')
  ok((await reg('Owner / QA', 'POST', '/deliverables', { tag: 'RE-202', vendor: 'Delta Valves', discipline: 'Process Equipment', due: '2026-11-20' })).status === 200, 'deliverables generated for a registered system and vendor')
  const airco = pr.companies.find((c) => c.name === 'AirCo')!
  ok((await reg('Owner / QA', 'PUT', `/companies/${airco.id}`, { active: false })).json.error?.includes('vendor account') === true, 'a company with vendor accounts cannot be deactivated')
  ok((await reg('Owner / QA', 'PUT', `/companies/${airco.id}`, { name: 'AirCo Systems' })).status === 200, 'company renamed')
  pr = await proj()
  ok(pr.docs.filter((d) => d.owner === 'AirCo Systems').length >= 2 && !pr.docs.some((d) => d.owner === 'AirCo'), 'rename carries over to every document')
  const vp3 = (await get(P, vendor)).json
  ok(vp3.scope === 'AirCo Systems' && vp3.project.docs.length >= 2, 'rename carries over to the vendor scope (access unchanged)')
  await reg('Owner / QA', 'PUT', `/companies/${airco.id}`, { name: 'AirCo' })

  // disciplines
  const hvac = pr.disciplines.find((d) => d.name === 'HVAC')!
  ok((await reg('Contractor', 'POST', '/disciplines', { name: 'Automation' })).status === 403, 'contractor cannot change disciplines')
  ok((await reg('Consultant', 'POST', '/disciplines', { name: 'Automation' })).status === 200 && (await proj()).disciplines.at(-1)?.name === 'Automation', 'discipline added at the end')
  ok((await reg('Consultant', 'PUT', `/disciplines/${hvac.id}`, { name: 'HVAC & Cleanroom Air' })).status === 200, 'discipline renamed')
  pr = await proj()
  ok(pr.docs.find((d) => d.id === 'DOC-004')?.discipline === 'HVAC & Cleanroom Air' && pr.reqs.find((r) => r.id === 'REQ-010')?.discipline === 'HVAC & Cleanroom Air', 'discipline rename carries over to documents and requirements')
  ok((await reg('Consultant', 'PUT', `/disciplines/${hvac.id}`, { move: 'up' })).status === 200 && (await proj()).disciplines.findIndex((d) => d.id === hvac.id) === 2, 'discipline moved up one place')
  await reg('Consultant', 'PUT', `/disciplines/${hvac.id}`, { name: 'HVAC', move: 'down' })

  // admin scopes must name a registered company
  const someone = (await get('/admin/users', QA)).json.users.find((u: any) => u.email === 'consultant@qualigrafo.test')
  ok((await send('PUT', `/admin/users/${someone.id}/memberships/PRJ-018`, { role: 'Contractor', scope: 'Ghost Ltd' }, QA)).json.error?.includes('company register') === true, 'vendor scope must be a registered company')
  ok((await get('/admin/projects', QA)).json.projects.find((p: any) => p.code === 'PRJ-026').companies.includes('Delta Valves'), 'admin sees each project\'s companies for scoping')

  // ======================================================== production step 3: project lifecycle + team
  const ids: Record<string, string> = {}
  for (const r of Object.keys(EMAIL) as Role[]) ids[r] = (await get('/auth/me', tokens[r])).json.user.id
  ids.Vendor = (await get('/auth/me', vendor)).json.user.id
  ok((await get('/auth/me', QA)).json.user.canCreateProjects === true && (await get('/auth/me', tokens.Consultant)).json.user.canCreateProjects === false, 'session says who may create projects')
  ok((await get('/directory/users', tokens.Consultant)).status === 403 && (await get('/directory/users', QA)).json.users.length >= 4, 'user directory only for project creators')

  const spec = {
    name: 'Riyadh Oral Solids Line 3', client: 'Nova Pharma Ltd', site: 'Riyadh 2nd Industrial City', plantCountry: 'SA', markets: ['EU'],
    facility: 'Non-sterile formulation', scope: 'Expansion', phase: 'Design', ownerStandards: 'NPL-QMS-014 rev 5',
    disciplines: ['Process Equipment', 'HVAC', 'Electrical', 'CQV'],
    companies: [{ name: 'AirCo', kind: 'Vendor / supplier' }, { name: 'BuildCo', kind: 'Main contractor' }],
    members: [
      { userId: ids['Owner / QA'], role: 'Owner / QA' }, { userId: ids.Consultant, role: 'Consultant' },
      { userId: ids.Contractor, role: 'Contractor' }, { userId: ids.Vendor, role: 'Contractor', scope: 'AirCo' },
    ],
  }
  const create = (body: unknown, who = QA) => call('POST', '/projects', body, who)
  ok((await create(spec, tokens.Consultant)).status === 403, 'a Consultant without Owner / QA rights cannot create projects')
  ok((await create({ ...spec, members: spec.members.filter((m) => m.role !== 'Owner / QA') })).json.error?.includes('Owner / QA') === true, 'a project needs an Owner / QA')
  ok((await create({ ...spec, members: [...spec.members, { userId: ids.Consultant, role: 'Contractor' }] })).json.error?.includes('one role') === true, 'one role per person')
  ok((await create({ ...spec, members: [spec.members[0], { userId: ids.Consultant, role: 'Consultant', scope: 'AirCo' }] })).status === 422, 'only Contractors can be scoped')
  ok((await create({ ...spec, members: [spec.members[0], { userId: ids.Vendor, role: 'Contractor', scope: 'Ghost Ltd' }] })).json.error?.includes('not one of the project companies') === true, 'scope must be a project company')
  ok((await create({ ...spec, disciplines: [] })).status === 422, 'at least one discipline')
  ok((await create({ ...spec, code: 'x' })).status === 422, 'invalid project code rejected')
  const made = await create(spec)
  ok(made.status === 201 && made.json.code === 'PRJ-032', `project created with the next code (${made.json.code})`)
  const NP = `/projects/${made.json.code}`
  const np2 = (await get(NP, QA)).json.project as ProjectData
  ok(np2.profile.status === 'Active' && np2.baseline === 1 && np2.baselines[0].reason === 'Project created', 'new project starts active at baseline B1')
  ok(np2.markets.join() === 'SA,EU' && np2.docs.length === 0 && np2.reqs.length === 0, 'plant country kept in scope; starts with no records')
  ok(np2.disciplines.map((d) => d.name).join('|') === 'Process Equipment|HVAC|Electrical|CQV', 'chosen disciplines in chosen order')
  ok(np2.companies.some((c) => c.name === 'Nova Pharma Ltd' && c.kind === 'Owner') && np2.companies.length === 3, 'client registered as Owner plus the listed companies')
  ok(np2.members.length === 4 && np2.members.some((m) => m.scope === 'AirCo'), 'team created with roles and vendor scope')
  ok(np2.audit.some((a) => a.text.startsWith(`Project ${made.json.code} created`)), 'creation recorded in the project audit trail')
  ok((await get(NP, vendor)).json.scope === 'AirCo', 'vendor scope applies on the new project')
  ok((await create({ ...spec, code: 'np-2026-07' })).json.code === 'NP-2026-07' && (await create({ ...spec, code: 'NP-2026-07' })).json.error?.includes('already used') === true, 'custom project code (upper-cased, unique)')
  ok((await get('/auth/me', tokens.Contractor)).json.memberships.length === 5, 'members see the new projects')

  // team management by the project's Owner / QA
  const team = (who: string, method: string, userId: string, body?: unknown) => call(method, `${NP}/members/${userId}`, body, who)
  ok((await team(tokens.Consultant, 'PUT', ids.Contractor, { role: 'Consultant' })).status === 403, 'only Owner / QA manages the team')
  ok((await team(QA, 'PUT', ids['Owner / QA'], { role: 'Consultant' })).json.error?.includes('no active Owner / QA') === true, 'the last Owner / QA cannot step down')
  ok((await team(QA, 'PUT', ids.Contractor, { role: 'Contractor', scope: 'Ghost Ltd' })).status === 422, 'team scope must be a registered company')
  ok((await team(QA, 'PUT', ids.Contractor, { role: 'Contractor', scope: 'BuildCo' })).status === 200 && (await get(NP, tokens.Contractor)).json.scope === 'BuildCo', 'Owner / QA limits a contractor to its company')
  ok((await team(QA, 'DELETE', ids.Contractor)).status === 200 && (await get(NP, tokens.Contractor)).status === 403, 'removed member loses access')
  ok((await get(`${NP}/audit?limit=10`, QA)).json.events.some((e: any) => e.text.startsWith('Team: Demo Contractor')), 'team changes are audited')

  // details + archive / restore
  ok((await call('PUT', `${NP}/details`, { name: 'Riyadh OSD Line 3', client: 'Nova Pharma Ltd', site: 'Riyadh 2nd Industrial City' }, tokens.Consultant)).status === 403, 'only Owner / QA edits project details')
  ok((await call('PUT', `${NP}/details`, { name: 'Riyadh OSD Line 3', client: 'Nova Pharma Ltd', site: 'Riyadh 2nd Industrial City' }, QA)).status === 200, 'project renamed')
  ok((await call('PUT', `${NP}/details`, { name: 'Riyadh OSD Line 3', client: 'Nova Pharma Ltd', site: 'Riyadh 2nd Industrial City' }, QA)).json.error === 'Nothing changed.', 'no-op edit rejected')
  ok((await call('POST', `${NP}/archive`, { reason: '' }, QA)).status === 422, 'archiving needs a reason')
  ok((await call('POST', `${NP}/archive`, { reason: 'Cancelled by client' }, QA)).json.project.profile.status === 'Archived', 'project archived')
  ok((await call('POST', `${NP}/systems`, { tag: 'GR-01', name: 'Granulator' }, tokens.Consultant)).json.error?.includes('archived and read-only') === true, 'archived project refuses changes')
  ok((await get(NP, tokens.Consultant)).status === 200, 'archived project stays readable')
  ok((await call('POST', `${NP}/notices/read-all`, {}, tokens.Consultant)).status === 200, 'personal read markers still work when archived')
  ok((await call('POST', `${NP}/restore`, { reason: 'Client re-approved the budget' }, QA)).json.project.profile.status === 'Active', 'project restored')
  ok((await call('POST', `${NP}/systems`, { tag: 'GR-01', name: 'Granulator', discipline: 'Process Equipment' }, tokens.Consultant)).status === 200, 'restored project accepts changes again')

  // ======================================================== step 3b: drawing comments + Revit connector
  const pr3 = () => get(P, QA).then((r) => r.json.project as ProjectData)
  const pin = async (code: string) => (await pr3()).pins.find((x) => x.id === code)!
  // drawing placement: DOC-012 R00 carries the vendor's uploaded PDF
  const placed = await call('POST', `${P}/pins`, { text: 'Damper access panel too small', doc: 'DOC-012', room: 'Sheet 1', place: { page: 1, x: 0.42, y: 0.31 } }, tokens.Consultant)
  ok(placed.status === 200, 'comment placed on the uploaded drawing')
  const placedCode = (placed.json.project as ProjectData).pins.at(-1)!.id
  const pp = await pin(placedCode)
  ok(pp.anchored && pp.page === 1 && pp.x === 0.42 && pp.rev === 0, 'position, page and revision stored')
  ok((await call('POST', `${P}/pins`, { text: 'x', doc: 'DOC-001', room: '', place: { page: 1, x: 0.5, y: 0.5 } }, tokens.Consultant)).json.error?.includes('no PDF or image drawing') === true, 'cannot place a comment on a revision without a drawing file')
  ok((await call('POST', `${P}/pins`, { text: 'x', doc: 'DOC-012', room: '', place: { page: 0, x: 2, y: 0.5 } }, tokens.Consultant)).status === 400, 'invalid position rejected')
  ok((await call('PUT', `${P}/pins/${placedCode}/anchor`, { page: 1, x: 0.1, y: 0.1 }, tokens.Contractor)).status === 403, 'a contractor cannot move someone else\'s comment')
  ok((await call('PUT', `${P}/pins/${placedCode}/anchor`, { page: 1, x: 0.45, y: 0.33 }, tokens.Consultant)).status === 200 && (await pin(placedCode)).x === 0.45, 'author moves the comment on the drawing')
  ok((await call('PUT', `${P}/pins/CMT-001/anchor`, { page: 1, x: 0.5, y: 0.5 }, tokens.Consultant)).json.error?.includes('no PDF or image') === true, 'remap needs a drawing on the current revision')

  // Revit integration switch
  ok((await call('PUT', `${P}/settings/revit`, { on: true }, tokens.Contractor)).status === 403, 'contractor cannot switch the Revit integration')
  ok((await call('PUT', `${P}/settings/revit`, { on: true }, tokens.Consultant)).json.project.revitMode === true, 'reviewer switches the Revit integration on')
  ok((await call('PUT', `${P}/settings/revit`, { on: true }, tokens.Consultant)).status === 422, 'no-op switch rejected')

  // connector tokens
  ok((await call('POST', `${P}/connector-tokens`, { name: 'CAD workstation 1' }, tokens.Consultant)).status === 403, 'only Owner / QA creates connector tokens')
  const tk = await call('POST', `${P}/connector-tokens`, { name: 'CAD workstation 1' }, QA)
  const ctoken = tk.json.token as string
  ok(tk.status === 201 && ctoken.startsWith('qgc_') && tk.json.project.connector.tokens[0].prefix === ctoken.slice(0, 12), 'token returned once; only its prefix is listed')
  ok((await get(P, tokens.Consultant)).json.project.connector.tokens.length === 0, 'tokens are listed only to Owner / QA')
  const addin = (method: string, path: string, body?: unknown, t = ctoken) => fetch(`${base}/connector/v1${path}`, { method, headers: { authorization: `Connector ${t}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  ok((await addin('GET', '/project', undefined, 'qgc_wrong')).status === 401, 'add-in with a wrong token is refused')
  ok((await addin('GET', '/project', undefined, tokens.Consultant)).status === 401, 'a user session token is not a connector token')
  const ping: any = await (await addin('GET', '/project')).json()
  ok(ping.code === 'PRJ-026' && ping.revitEnabled === true, 'add-in sees its project')

  // snapshots
  const snap = { model: { guid: 'MDL-ELEC-01', name: 'Electrical model' }, version: 'Publish 12', changes: [{ elementId: 'E-MDB-01', kind: 'Parameter changed', detail: 'Feeder rating 400 A -> 630 A' }, { elementId: 'E-SHT-E05', kind: 'Sheet revised', detail: 'Single-line diagram re-issued' }] }
  ok((await addin('POST', '/snapshots', snap)).status === 201, 'add-in publishes a model snapshot')
  ok((await addin('POST', '/snapshots', snap)).status === 409, 'the same version cannot be published twice')
  ok((await addin('POST', '/snapshots', { ...snap, changes: [{ elementId: '', kind: 'Teleported' }] })).status === 400, 'malformed snapshot rejected')
  let pv = await pr3()
  const model = pv.connector.models.find((m) => m.guid === 'MDL-ELEC-01')!
  ok(!!model && model.snapshots[0].changes.length === 2 && model.snapshots[0].publishedBy === 'CAD workstation 1', 'snapshot with element changes listed in the project')
  ok(pv.events.some((e) => e.text.startsWith('Revit model Electrical model published')) && pv.audit.some((a) => a.user === 'Revit connector: CAD workstation 1'), 'publication notified and audited under the connector name')
  const snapId = model.snapshots[0].id
  ok((await call('POST', `${P}/docs/DOC-005/imports`, { snapshotId: snapId }, tokens.Consultant)).status === 403, 'only the contractor imports a snapshot into a document')
  ok((await call('POST', `${P}/docs/DOC-005/imports`, { snapshotId: snapId }, tokens.Contractor)).status === 200, 'contractor imports the snapshot into DOC-005')
  pv = await pr3()
  const d5 = pv.docs.find((d) => d.id === 'DOC-005')!
  ok(d5.source === 'Revit' && d5.status === 'Draft' && d5.rev === 2 && d5.checksum === 'revit:MDL-ELEC-01:Publish 12', 'accepted revision kept; new draft revision from the snapshot')
  ok((await call('POST', `${P}/docs/DOC-005/imports`, { snapshotId: snapId }, tokens.Contractor)).json.error?.startsWith('Duplicate source') === true, 'the same snapshot cannot be imported twice into one document')

  // comment <-> element, Open in Revit
  ok((await call('PUT', `${P}/pins/CMT-001/element`, { model: 'MDL-UNKNOWN', element: 'E-1' }, tokens.Consultant)).json.error?.includes('not been published') === true, 'element link needs a published model')
  ok((await call('PUT', `${P}/pins/CMT-001/element`, { model: 'MDL-ELEC-01', element: null }, tokens.Consultant)).status === 422, 'model and element go together')
  ok((await call('PUT', `${P}/pins/CMT-001/element`, { model: 'MDL-ELEC-01', element: 'E-DOOR-101' }, tokens.Consultant)).status === 200, 'comment linked to a Revit element')
  ok((await call('POST', `${P}/pins/CMT-001/navigate`, {}, tokens.Consultant)).json.project.pins.find((x: any) => x.id === 'CMT-001').nav.status === 'Pending', '"Open in Revit" queued for the add-in')
  ok((await call('POST', `${P}/pins/CMT-001/navigate`, {}, tokens.Consultant)).json.error?.includes('already waiting') === true, 'one waiting request per comment')
  const navs: any = await (await addin('GET', '/navigation')).json()
  ok(navs.requests.length === 1 && navs.requests[0].comment === 'CMT-001' && navs.requests[0].elementId === 'E-DOOR-101', 'add-in receives the request')
  ok(((await (await addin('GET', '/navigation')).json()) as any).requests.length === 0 && (await pin('CMT-001')).nav?.status === 'Delivered', 'a delivered request is not handed out twice')
  ok((await addin('POST', `/navigation/${navs.requests[0].id}/result`, { outcome: 'Teleported' })).status === 400, 'unknown outcome rejected')
  ok((await addin('POST', `/navigation/${navs.requests[0].id}/result`, { outcome: 'Focused', detail: 'Selected in 3D view' })).status === 200, 'add-in reports the outcome')
  const nv = (await pin('CMT-001')).nav!
  ok(nv.status === 'Focused' && nv.detail === 'Selected in 3D view', 'user sees the add-in outcome on the comment')
  ok((await addin('POST', `/navigation/${navs.requests[0].id}/result`, { outcome: 'Focused' })).status === 409, 'an outcome cannot be reported twice')
  ok((await call('POST', `${P}/pins/CMT-001/navigate`, {}, vendor)).status === 403, 'vendor accounts cannot use the Revit navigation')

  // switching off / revoking
  ok((await call('PUT', `${P}/settings/revit`, { on: false }, QA)).status === 200 && (await addin('POST', '/snapshots', { ...snap, version: 'Publish 13' })).status === 409, 'add-in cannot publish while the integration is off')
  ok((await call('POST', `${P}/pins/CMT-001/navigate`, {}, tokens.Consultant)).json.error?.includes('Revit integration is off') === true, 'no navigation while the integration is off')
  const tokId = (await pr3()).connector.tokens[0].id
  ok((await call('DELETE', `${P}/connector-tokens/${tokId}`, undefined, QA)).status === 200 && (await addin('GET', '/project')).status === 401, 'revoked token stops working immediately')

  // ======================================================== step 4: requirement library
  const lib = (who: string, method: string, path: string, body?: unknown) => call(method, `/library${path}`, body, who)
  // a second library editor (administrator) for the four-eyes rule
  const rv = await send('POST', '/admin/users', { email: 'lib.reviewer@qualigrafo.test', name: 'Library Reviewer', isAdmin: true }, QA)
  let RV = (await login('lib.reviewer@qualigrafo.test', rv.json.tempPassword)).json.token as string
  RV = (await send('POST', '/auth/password', { current: rv.json.tempPassword, next: 'Reviewer-2026-lib' }, RV)).json.token

  let packs = (await lib(tokens.Contractor, 'GET', '')).json.packs
  ok(packs.length === 5 && packs.every((p: any) => p.versions.length === 0), 'library readable by every user; empty on a new installation')
  ok((await lib(tokens.Contractor, 'POST', '/starter')).status === 403, 'only library editors load the starter template')
  const st = await lib(QA, 'POST', '/starter')
  ok(st.status === 201 && st.json.created.join() === 'SA (17),EU (7),IN (9),US (3)', `starter template loaded as drafts (${st.json.created.join(', ')})`)
  ok((await lib(QA, 'POST', '/starter')).status === 422, 'starter cannot be loaded twice')
  packs = st.json.packs
  const vid = (m: string, status = 'Draft') => packs.find((p: any) => p.market === m).versions.find((v: any) => v.status === status)?.id as string
  const sa1 = vid('SA')
  const v1 = (await lib(QA, 'GET', `/versions/${sa1}`)).json.version
  ok(v1.starter && v1.items.length === 17 && v1.items[0].key === 'TOPIC-01' && v1.items.every((i: any) => i.clause === ''), 'starter items are topic-level, without clauses')

  // editing a draft
  ok((await lib(QA, 'POST', `/versions/${sa1}/items`, { key: 'bad key!', title: 'x', discipline: 'HVAC' })).status === 422, 'invalid item key rejected')
  ok((await lib(QA, 'POST', `/versions/${sa1}/items`, { key: 'TOPIC-01', title: 'Duplicate', discipline: 'HVAC' })).json.error?.includes('already exists') === true, 'duplicate key rejected')
  ok((await lib(QA, 'POST', `/versions/${sa1}/items`, { key: 'X-1', title: 'Tablet press', discipline: 'Process Equipment', facilities: ['Spaceport'] })).json.error?.includes('unknown facility') === true, 'unknown facility type rejected')
  const imp = await lib(QA, 'POST', `/versions/${sa1}/import`, { mode: 'append', rows: [{ key: 'SOP-01', title: 'Owner change control SOP applies', discipline: 'CQV' }, { key: 'sop-01', title: 'Again', discipline: 'CQV' }] })
  ok(imp.status === 422 && imp.json.error.includes('appears twice'), 'import rejects duplicate keys in the file')
  ok((await lib(QA, 'POST', `/versions/${sa1}/import`, { mode: 'append', rows: [{ key: 'TOPIC-01', title: 'Clash', discipline: 'CQV' }] })).json.error?.includes('replace') === true, 'append refuses keys already in the version')

  // four-eyes approval
  ok((await lib(QA, 'POST', `/versions/${sa1}/approve`, { reason: 'Checked' })).json.error?.includes('Four-eyes') === true, 'the author cannot approve their own draft')
  ok((await lib(tokens.Consultant, 'POST', `/versions/${sa1}/approve`, { reason: 'Checked' })).status === 403, 'non-editors cannot approve')
  ok((await lib(RV, 'POST', `/versions/${sa1}/approve`, { reason: '' })).status === 422, 'approval needs its basis recorded')
  const ap = await lib(RV, 'POST', `/versions/${sa1}/approve`, { reason: 'Topics accepted as starting scope; clauses to follow in v2' })
  ok(ap.status === 200 && ap.json.version.status === 'Approved' && ap.json.version.approvedByName === 'Library Reviewer', 'second editor approves SA v1')
  ok(ap.json.notified.includes('PRJ-026') && ap.json.notified.includes('PRJ-031') && !ap.json.notified.includes('PRJ-018'), `projects targeting SA notified (${ap.json.notified.join(', ')})`)
  ok((await lib(QA, 'POST', `/versions/${sa1}/items`, { key: 'LATE-1', title: 'Late edit', discipline: 'CQV' })).json.error?.includes('cannot be changed') === true, 'an approved version is frozen')

  // the library update in a project
  let p26 = (await get(P, QA)).json.project as ProjectData
  const libUpd = p26.updates.find((u) => u.kind === 'Library')!
  ok(!!libUpd && libUpd.title === 'Requirement library SA v1 approved' && libUpd.status === 'Awaiting assessment', 'project receives a "Library update" to assess')
  ok((await call('POST', `${P}/updates/${libUpd.id}/assess`, { applicable: true, reason: 'Adopt the library' }, tokens.Consultant)).status === 403, 'only Owner / QA applies a library update')
  const base26 = p26.baseline
  const applied = await call('POST', `${P}/updates/${libUpd.id}/assess`, { applicable: true, reason: 'Adopt the SA library' }, QA)
  p26 = applied.json.project
  const fromLib = p26.reqs.filter((r) => r.libraryKey && r.market === 'SA')
  ok(fromLib.length === 17 && fromLib.every((r) => r.applicability === 'Assessment pending' && r.libraryVersion === 1) && p26.baseline === base26 + 1, '17 SA library requirements added as "Assessment pending" with a new baseline')

  // a new project gets the approved library automatically
  const mk = await call('POST', '/projects', { ...spec, name: 'Library Test Plant', code: 'LIB-001', markets: [], plantCountry: 'SA', facility: 'Non-sterile formulation', members: [spec.members[0], spec.members[1]] }, QA)
  ok(mk.status === 201, 'project created after the library approval')
  const LP = '/projects/LIB-001'
  let lp = (await get(LP, QA)).json.project as ProjectData
  ok(lp.reqs.length === 17 && lp.reqs.every((r) => r.libraryKey && r.applicability === 'Assessment pending'), 'new project starts with the approved SA requirements')
  ok(lp.disciplines.some((d) => d.name === 'Civil & Cleanroom') && lp.audit.some((a) => a.text.includes('17 requirement(s) from library SA v1')), 'missing disciplines added and the import audited')

  // v2: change, remove and a sterile-only item
  const d2 = await lib(RV, 'POST', '/packs/SA/drafts')
  ok(d2.status === 201 && d2.json.version.version === 2 && d2.json.version.items.length === 17, 'new draft v2 starts as a copy of v1')
  ok((await lib(QA, 'POST', '/packs/SA/drafts')).status === 422, 'only one draft per pack')
  const items2 = d2.json.version.items
  const t1 = items2.find((i: any) => i.key === 'TOPIC-01'), t2 = items2.find((i: any) => i.key === 'TOPIC-02')
  ok((await lib(RV, 'PUT', `/items/${t1.id}`, { title: t1.title, discipline: t1.discipline, clause: 'Chapter 3, 3.1-3.5', sourceVersion: 'GMP guide 2024', effective: '2024-06-01' })).status === 200, 'clause, source version and effective date recorded')
  ok((await lib(RV, 'DELETE', `/items/${t2.id}`)).status === 200, 'item removed from the draft')
  ok((await lib(RV, 'POST', `/versions/${d2.json.version.id}/items`, { key: 'STERILE-01', title: 'Grade A air supply qualification', discipline: 'HVAC', facilities: ['Sterile products'], critical: true })).status === 201, 'sterile-only item added')
  const view = (await lib(QA, 'GET', `/versions/${d2.json.version.id}`)).json.version
  ok(view.comparedWith === 1 && view.items.find((i: any) => i.key === 'TOPIC-01').change.startsWith('Changed: clause') && view.removed[0].key === 'TOPIC-02' && view.items.find((i: any) => i.key === 'STERILE-01').change === 'Added', 'draft shows its differences from v1')
  ok((await lib(RV, 'POST', `/versions/${d2.json.version.id}/approve`, { reason: 'x' })).status === 403, 'the editor of v2 cannot approve it')
  ok((await lib(QA, 'POST', `/versions/${d2.json.version.id}/approve`, { reason: 'Clauses verified against the 2024 guide' })).status === 200, 'Owner / QA approves v2')
  packs = (await lib(QA, 'GET', '')).json.packs
  ok(packs.find((p: any) => p.market === 'SA').versions.map((v: any) => v.status).join() === 'Approved,Superseded', 'v1 superseded by v2')
  lp = (await get(LP, QA)).json.project
  const u2 = lp.updates.find((u) => u.kind === 'Library')!
  ok(u2.summary.startsWith('0 new, 1 changed, 1 removed'), `non-sterile project: sterile-only item filtered out (${u2.summary.slice(0, 32)})`)
  lp = (await call('POST', `${LP}/updates/${u2.id}/assess`, { applicable: true, reason: 'Adopt v2' }, QA)).json.project
  const r1 = lp.reqs.find((r) => r.libraryKey === 'TOPIC-01')!, r2 = lp.reqs.find((r) => r.libraryKey === 'TOPIC-02')!
  ok(r1.clause === 'Chapter 3, 3.1-3.5' && r1.libraryVersion === 2 && r1.applicability === 'Assessment pending', 'changed requirement updated and sent back for reassessment')
  ok(r2.applicability === 'Not applicable' && r2.rationale.includes('Removed from library SA v2'), 'removed item kept as "Not applicable" with the reason (history preserved)')
  ok(!lp.reqs.some((r) => r.libraryKey === 'STERILE-01'), 'facility filter respected')

  // adding a market in Setup brings its library
  ok((await lib(RV, 'POST', `/versions/${vid('IN')}/approve`, { reason: 'Accepted as starting scope' })).status === 200, 'IN pack approved')
  const before = lp.reqs.length
  lp = (await call('PUT', `${LP}/profile`, { facility: lp.profile.facility, scope: lp.profile.scope, phase: lp.profile.phase, ownerStandards: '', markets: ['SA', 'IN'], reason: 'Product will also be supplied to India' }, QA)).json.project
  ok(lp.reqs.length === before + 9 && lp.reqs.filter((r) => r.market === 'IN').every((r) => r.libraryKey), 'new target market adds its approved library requirements')

  // project-specific requirements and requirement details
  ok((await call('POST', `${P}/reqs`, { title: 'x', market: 'SA', discipline: 'Process Equipment', system: '', topic: '', critical: false, owner: 'Consultant', due: '2026-12-01' }, tokens.Contractor)).status === 403, 'contractors cannot add requirements')
  ok((await call('POST', `${P}/reqs`, { title: 'Client spec: 316L for product contact', market: 'UK', discipline: 'Process Equipment', system: '', topic: '', critical: false, owner: 'Consultant', due: '2026-12-01' }, tokens.Consultant)).json.error?.includes('not a target market') === true, 'market must be a project market')
  const own = await call('POST', `${P}/reqs`, { title: 'Client spec: 316L stainless for product contact parts', market: 'SA', discipline: 'Process Equipment', system: 'RE-201', topic: 'NPL-ENG-007 rev 2', critical: true, owner: 'Consultant', due: '2026-12-01' }, tokens.Consultant)
  const ownReq = (own.json.project as ProjectData).reqs.at(-1)!
  ok(own.status === 200 && ownReq.libraryKey == null && ownReq.applicability === 'Required' && ownReq.system === 'RE-201', 'project-specific requirement added (no library origin)')
  const libReq = (own.json.project as ProjectData).reqs.find((r) => r.libraryKey && r.market === 'SA')!
  ok((await call('PUT', `${P}/reqs/${libReq.id}/details`, { system: 'XX-9', owner: 'Consultant', due: '2026-12-15' }, tokens.Consultant)).status === 422, 'requirement system must be registered')
  ok((await call('PUT', `${P}/reqs/${libReq.id}/details`, { system: 'CR-101', owner: 'Consultant', due: '2026-12-15' }, tokens.Consultant)).json.project.reqs.find((r: any) => r.id === libReq.id).system === 'CR-101', 'library requirement assigned to a system')
  const secTypes = (await get('/admin/security-events?limit=100', QA)).json.events.map((e: any) => e.type)
  ok(['library.draft', 'library.edit', 'library.approved'].every((t) => secTypes.includes(t)), 'library changes are in the security log')
  // ======================================================== step 5: document register
  {
    const C = tokens.Consultant, K = tokens.Contractor
    const proj = (r: { json: any }) => r.json.project as ProjectData
    let pd = (await call('GET', P, undefined, QA)).json.project as ProjectData
    const company = pd.docs.find((d) => d.owner !== 'Consult Partners')!.owner
    const spec = { title: 'HVAC air balancing report', number: 'NPL-HVAC-RP-0101', discipline: 'HVAC', system: '', owner: company, due: '2026-12-10', critical: true }
    ok((await call('POST', `${P}/docs`, spec, K)).status === 403, 'contractors cannot register documents')
    ok((await call('POST', `${P}/docs`, { ...spec, owner: 'Nobody Ltd' }, C)).status === 422, 'responsible company must be in the register')
    ok((await call('POST', `${P}/docs`, { ...spec, number: pd.docs[0].number.toLowerCase() }, C)).json.error?.includes('already used'), 'document numbers are unique (case-insensitive)')
    const cr = await call('POST', `${P}/docs`, spec, C)
    pd = proj(cr)
    const nd = pd.docs.find((d) => d.number === spec.number)!
    ok(cr.status === 200 && nd.status === 'Missing' && nd.rev === 0 && nd.critical && nd.owner === company, `document registered as Missing R00 (${nd?.id})`)

    // edit metadata: reason required, audit old -> new, content fields locked during review
    ok((await call('PUT', `${P}/docs/${nd.id}/details`, { ...spec, reason: '' }, C)).json.error === 'Nothing changed.', 'edit without changes refused')
    ok((await call('PUT', `${P}/docs/${nd.id}/details`, { ...spec, due: '2026-12-20', reason: '' }, C)).status === 422, 'edit needs a reason')
    ok((await call('PUT', `${P}/docs/${nd.id}/details`, { ...spec, due: '2026-12-20', reason: 'x' }, K)).status === 403, 'contractors cannot edit the register')
    pd = proj(await call('PUT', `${P}/docs/${nd.id}/details`, { ...spec, title: 'HVAC air and water balancing report', due: '2026-12-20', reason: 'Scope widened per MOM-14' }, C))
    ok(pd.docs.find((d) => d.id === nd.id)!.due === '2026-12-20', 'register details changed')
    const ad = (await call('GET', `${P}/audit?limit=5`, undefined, C)).json.events.map((e: any) => e.text).join('\n')
    ok(ad.includes('title "HVAC air balancing report" -> "HVAC air and water balancing report"') && ad.includes('due 2026-12-10 -> 2026-12-20') && ad.includes('Scope widened per MOM-14'), 'audit records old -> new values and the reason')
    const inReview = pd.docs.find((d) => d.status === 'Under review')
    if (inReview) {
      const f = { title: inReview.title + ' (rev)', number: inReview.number, discipline: inReview.discipline, system: inReview.system, owner: inReview.owner, due: inReview.due, critical: inReview.critical, reason: 'x' }
      ok((await call('PUT', `${P}/docs/${inReview.id}/details`, f, C)).json.error?.includes('under review'), 'title cannot change while a revision is under review')
      ok((await call('POST', `${P}/docs/${inReview.id}/void`, { reason: 'x' }, QA)).json.error?.includes('Return it first'), 'a document with an open approval route cannot be voided')
    }

    // void: evidence withdrawn, workflow blocked, reinstate
    ok((await call('POST', `${P}/docs/${nd.id}/void`, { reason: 'x' }, C)).status === 403, 'only Owner / QA voids documents')
    ok((await call('POST', `${P}/docs/${nd.id}/void`, { reason: '' }, QA)).status === 422, 'void needs a reason')
    pd = proj(await call('POST', `${P}/docs/${nd.id}/void`, { reason: 'Balancing covered by the TAB contractor report' }, QA))
    const vd = pd.docs.find((d) => d.id === nd.id)!
    ok(vd.status === 'Void' && !!vd.voided?.reason.includes('TAB contractor') && !!vd.voided?.by, 'document voided with reason and who')
    ok((await call('POST', `${P}/docs/${nd.id}/submit`, { note: 'x' }, K)).json.error?.includes('is void'), 'void document cannot be submitted')
    ok((await call('POST', `${P}/pins`, { text: 'x', doc: nd.id, room: '' }, C)).json.error?.includes('is void'), 'void document cannot get new comments')
    ok((await call('POST', `${P}/docs/${nd.id}/void`, { reason: 'again' }, QA)).status === 422, 'cannot void twice')
    ok((await call('POST', `${P}/docs/${nd.id}/reinstate`, { reason: 'x' }, C)).status === 403, 'only Owner / QA reinstates')
    pd = proj(await call('POST', `${P}/docs/${nd.id}/reinstate`, { reason: 'Voided by mistake' }, QA))
    ok(pd.docs.find((d) => d.id === nd.id)!.status === 'Missing' && !pd.docs.find((d) => d.id === nd.id)!.voided, 'reinstated to its previous status')

    // supersede: links withdrawn on the old document, replacement linked for assessment
    const live = (st: string) => !['Missing', 'Void', 'Superseded'].includes(st)
    const linked = pd.docs.find((d) => live(d.status) && d.status !== 'Under review' && pd.reqs.some((r) => r.evidence.some((e) => e.doc === d.id && e.decision !== 'Withdrawn')))!
    const repl = pd.docs.find((d) => d.id !== linked.id && live(d.status))!
    const reqsOf = pd.reqs.filter((r) => r.evidence.some((e) => e.doc === linked.id && e.decision !== 'Withdrawn')).map((r) => r.id)
    ok((await call('POST', `${P}/docs/${linked.id}/void`, { reason: 'x', supersededBy: linked.id }, QA)).status === 422, 'a document cannot supersede itself')
    pd = proj(await call('POST', `${P}/docs/${linked.id}/void`, { reason: 'Combined into the replacement document', supersededBy: repl.id }, QA))
    const sd = pd.docs.find((d) => d.id === linked.id)!
    ok(sd.status === 'Superseded' && sd.voided?.supersededBy === repl.id, `${linked.id} superseded by ${repl.id}`)
    const after = pd.reqs.filter((r) => reqsOf.includes(r.id))
    ok(after.length > 0 && after.every((r) => r.evidence.filter((e) => e.doc === linked.id).every((e) => e.decision === 'Withdrawn')), `old evidence links withdrawn on ${reqsOf.join(', ')}`)
    ok(after.every((r) => r.evidence.some((e) => e.doc === repl.id && e.decision !== 'Withdrawn')), 'replacement linked to the same requirements')
    const onlyWithdrawn = { ...after[0], applicability: 'Required' as const, evidence: after[0].evidence.map((e) => ({ ...e, decision: 'Withdrawn' as const })) }
    ok(evidenceState(onlyWithdrawn, pd.docs) === 'Evidence missing', 'withdrawn links do not count in the evidence state')
    ok(handoverGates(pd).find((g) => g.key === 'docs')!.of === pd.docs.filter((d) => d.critical && !['Void', 'Superseded'].includes(d.status)).length, 'handover gate ignores void / superseded documents')

    // withdraw a single evidence link manually
    const wr = pd.reqs.find((r) => r.evidence.some((e) => e.doc === repl.id && e.decision === 'Pending'))!
    const we = wr.evidence.find((e) => e.doc === repl.id && e.decision === 'Pending')!
    ok((await call('POST', `${P}/reqs/${wr.id}/evidence/${we.id}/withdraw`, { reason: 'x' }, K)).status === 403, 'contractors cannot withdraw evidence links')
    pd = proj(await call('POST', `${P}/reqs/${wr.id}/evidence/${we.id}/withdraw`, { reason: 'Wrong section referenced' }, C))
    ok(pd.reqs.find((r) => r.id === wr.id)!.evidence.find((e) => e.id === we.id)!.decision === 'Withdrawn', 'evidence link withdrawn and kept as history')
    ok((await call('POST', `${P}/reqs/${wr.id}/evidence/${we.id}/assess`, { accept: true, reason: 'x' }, QA)).json.error?.includes('withdrawn'), 'withdrawn link cannot be assessed')

    // register import: preview lists every problem, commit is all-or-nothing
    const rows = [
      { number: 'NPL-ELE-DS-0201', title: 'MCC-01 vendor datasheet', discipline: 'electrical', company, due: '2027-01-15', critical: false },
      { number: 'NPL-ELE-DS-0202', title: 'MCC-02 vendor datasheet', discipline: 'Electrical', company, due: '2027-01-15' },
      { number: spec.number, due: '2027-01-05' },
      { number: pd.docs.find((d) => d.number && live(d.status) && d.id !== nd.id)!.number },
      { number: 'NPL-ELE-DS-0201', title: 'dup', discipline: 'Electrical', company, due: '2027-01-15' },
      { number: 'NPL-X-1', title: 'Bad', discipline: 'Plumbing', company, due: '15/01/2027' },
      { number: '', title: 'No number' },
    ]
    const pv = await call('POST', `${P}/docs/import/preview`, { rows, source: 'MDR rev C.xlsx' }, C)
    const pr = pv.json.preview
    ok(pv.status === 200 && pr.created.length === 2 && pr.updated.length === 1 && pr.unchanged === 1 && pr.errors.length === 4, `preview: ${pr?.created.length} new, ${pr?.updated.length} updated, ${pr?.unchanged} unchanged, ${pr?.errors.length} errors`)
    ok(pr.errors.map((e: any) => e.row).join() === '6,7,7,8' && pr.errors[1].error.includes('Plumbing') && pr.errors[2].error.includes('YYYY-MM-DD'), 'preview lists every error with its spreadsheet row number')
    ok(pr.updated[0].changes.join().includes('due 2026-12-20 -> 2027-01-05'), 'preview shows the change per field')
    ok((await call('POST', `${P}/docs/import/preview`, { rows, source: 'x' }, K)).status === 403, 'contractors cannot import the register')
    const n0 = pd.docs.length
    const bad = await call('POST', `${P}/docs/import`, { rows, source: 'MDR rev C.xlsx' }, C)
    ok(bad.status === 422 && bad.json.error.includes('Row 6'), 'import with errors refused')
    pd = (await call('GET', P, undefined, C)).json.project
    ok(pd.docs.length === n0, 'refused import changed nothing')
    const good = await call('POST', `${P}/docs/import`, { rows: rows.slice(0, 4), source: 'MDR rev C.xlsx' }, C)
    pd = proj(good)
    ok(good.status === 200 && pd.docs.length === n0 + 2 && pd.docs.find((d) => d.number === 'NPL-ELE-DS-0201')?.discipline === 'Electrical', 'import registered new documents (names matched case-insensitively)')
    ok(pd.docs.find((d) => d.number === spec.number)!.due === '2027-01-05', 'import updated the matched document')
    ok((await call('POST', `${P}/docs/import`, { rows: rows.slice(0, 4), source: 'MDR rev C.xlsx' }, C)).json.error?.includes('Nothing to import'), 're-importing the same file changes nothing')
    ok((await call('POST', `${P}/docs/import/preview`, { rows: [{ number: sd.number, due: '2027-02-01' }], source: 'x' }, C)).json.preview.errors[0]?.error.includes('superseded'), 'import does not update superseded documents')
  }
  // ======================================================== step 6: edit records, manual findings
  {
    const C = tokens.Consultant, K = tokens.Contractor
    const proj = (r: { json: any }) => r.json.project as ProjectData
    const lastAudit = async () => (await call('GET', `${P}/audit?limit=3`, undefined, C)).json.events.map((e: any) => e.text).join('\n') as string
    let pd = (await call('GET', P, undefined, C)).json.project as ProjectData

    // RFIs: requester or reviewer; question locked once answered; closed RFIs frozen
    const mine = proj(await call('POST', `${P}/rfis`, { title: 'Confirm the AHU-01 filter grade', discipline: 'HVAC', system: pd.rfis[0].system, due: '2026-11-30' }, K)).rfis.at(-1)!
    const rf = { title: mine.title, discipline: mine.discipline, system: mine.system, due: mine.due }
    ok((await call('PUT', `${P}/rfis/${mine.id}`, { ...rf, reason: 'x' }, K)).json.error === 'Nothing changed.', 'RFI edit without changes refused')
    ok((await call('PUT', `${P}/rfis/${mine.id}`, { ...rf, due: '2026-12-05', reason: '' }, K)).status === 422, 'RFI edit needs a reason')
    pd = proj(await call('PUT', `${P}/rfis/${mine.id}`, { ...rf, title: 'Confirm the AHU-01 final filter grade (H13 or H14)', due: '2026-12-05', reason: 'Clarified after site meeting' }, K))
    ok(pd.rfis.find((r) => r.id === mine.id)!.due === '2026-12-05', 'requester edited the RFI')
    ok((await lastAudit()).includes(`${mine.id} edited: question "Confirm the AHU-01 filter grade" -> "Confirm the AHU-01 final filter grade (H13 or H14)"; due "2026-11-30" -> "2026-12-05". Reason: Clarified after site meeting`), 'RFI audit shows old -> new and the reason')
    const other = pd.rfis.find((r) => r.raisedBy !== 'Contractor' && r.status !== 'Closed')
    if (other) ok((await call('PUT', `${P}/rfis/${other.id}`, { title: other.title, discipline: other.discipline, system: other.system, due: '2027-01-01', reason: 'x' }, K)).status === 403, "contractor cannot edit someone else's RFI")
    ok((await call('PUT', `${P}/rfis/${mine.id}`, { ...rf, system: 'XX-404', reason: 'x' }, C)).status === 422, 'RFI system must be registered')
    await call('POST', `${P}/rfis/${mine.id}/answer`, { response: 'H14 per URS section 6' }, C)
    ok((await call('PUT', `${P}/rfis/${mine.id}`, { ...rf, title: 'A different question', due: '2026-12-05', reason: 'x' }, K)).json.error?.includes('cannot change'), 'answered RFI question is locked')
    ok((await call('PUT', `${P}/rfis/${mine.id}`, { ...rf, title: 'Confirm the AHU-01 final filter grade (H13 or H14)', due: '2026-12-09', reason: 'Answer review moved' }, C)).status === 200, 'answered RFI can still be rescheduled')
    await call('POST', `${P}/rfis/${mine.id}/close`, {}, K)
    ok((await call('PUT', `${P}/rfis/${mine.id}`, { ...rf, due: '2026-12-20', reason: 'x' }, C)).json.error?.includes('closed'), 'closed RFI cannot be edited')

    // risks
    pd = (await call('GET', P, undefined, C)).json.project
    const rk = pd.risks.find((r) => r.status !== 'Closed')!
    const rb = { title: rk.title, detail: rk.detail, system: rk.system, likelihood: rk.likelihood, impact: rk.impact, owner: rk.owner, mitigation: rk.mitigation, due: rk.due }
    ok((await call('PUT', `${P}/risks/${rk.id}`, { ...rb, impact: 1, reason: 'x' }, K)).status === 403, 'contractors cannot edit risks')
    ok((await call('PUT', `${P}/risks/${rk.id}`, { ...rb, likelihood: 9, reason: 'x' }, C)).status === 400, 'risk rating outside 1-5 rejected')
    const newL = rk.likelihood === 1 ? 2 : 1
    pd = proj(await call('PUT', `${P}/risks/${rk.id}`, { ...rb, likelihood: newL, owner: 'QA Lead', reason: 'Mitigation trial passed' }, C))
    ok(pd.risks.find((r) => r.id === rk.id)!.owner === 'QA Lead', 'risk edited (owner, likelihood)')
    ok((await lastAudit()).includes(`rating ${rk.likelihood * rk.impact} -> ${newL * rk.impact}`), 'risk audit records the rating change')

    // NCRs: Critical downgrade only by Owner / QA, contractor notified of severity / due changes
    pd = proj(await call('POST', `${P}/ncrs`, { title: 'Weld discolouration on PW loop', description: 'Heat tint beyond acceptance at joint W-14 (drawing R03)', system: pd.ncrs[0].system, severity: 'Major', due: '2026-12-15' }, C))
    const nc = pd.ncrs.at(-1)!
    const nb = { title: nc.title, description: nc.description, system: nc.system, severity: nc.severity, doc: nc.doc ?? '', due: nc.due }
    ok((await call('PUT', `${P}/ncrs/${nc.id}`, { ...nb, due: '2027-01-10', reason: 'x' }, K)).status === 403, 'contractors cannot edit NCRs')
    pd = proj(await call('PUT', `${P}/ncrs/${nc.id}`, { ...nb, severity: 'Critical', reason: 'Product-contact surface affected' }, C))
    ok(pd.ncrs.find((n) => n.id === nc.id)!.severity === 'Critical', 'NCR raised to Critical')
    ok((await call('PUT', `${P}/ncrs/${nc.id}`, { ...nb, severity: 'Minor', reason: 'x' }, C)).status === 403, 'only Owner / QA downgrades a Critical NCR')
    pd = proj(await call('PUT', `${P}/ncrs/${nc.id}`, { ...nb, severity: 'Major', due: '2027-01-12', reason: 'Contact surface ruled out by QA inspection' }, QA))
    const nn = pd.ncrs.find((n) => n.id === nc.id)!
    ok(nn.severity === 'Major' && nn.due === '2027-01-12', 'Owner / QA downgraded and rescheduled the NCR')
    ok(pd.events.some((e) => e.text.includes(`${nc.id} severity lowered to Major, response due 2027-01-12`)), 'contractor notified of the severity / due change')
    const voidDoc = pd.docs.find((d) => d.status === 'Void' || d.status === 'Superseded')
    if (voidDoc) ok((await call('PUT', `${P}/ncrs/${nc.id}`, { ...nb, severity: 'Major', due: '2027-01-12', doc: voidDoc.id, reason: 'x' }, QA)).status === 422, 'NCR cannot point at a void / superseded document')

    // corrective actions
    const ga = pd.actions.find((a) => a.status !== 'Closed')!
    const gb = { title: ga.title, owner: ga.owner, due: ga.due, priority: ga.priority }
    ok((await call('PUT', `${P}/actions/${ga.id}`, { ...gb, priority: 'Low', reason: 'x' }, K)).status === 403, 'contractors cannot edit corrective actions')
    pd = proj(await call('PUT', `${P}/actions/${ga.id}`, { ...gb, owner: 'EquipCo', due: '2027-01-20', reason: 'Vendor owns the fix' }, C))
    ok(pd.actions.find((a) => a.id === ga.id)!.owner === 'EquipCo', 'corrective action reassigned')
    ok(pd.events.some((e) => e.text.startsWith(`${ga.id} reassigned to EquipCo`)), 'reassignment notified')
    const closedAction = pd.actions.find((a) => a.status === 'Closed')
    if (closedAction) ok((await call('PUT', `${P}/actions/${closedAction.id}`, { title: closedAction.title, owner: closedAction.owner, due: '2027-02-01', priority: closedAction.priority, reason: 'x' }, C)).status === 422, 'closed action cannot be edited')

    // manual findings
    const fdoc = pd.docs.find((d) => d.status !== 'Void' && d.status !== 'Superseded')!
    const fd = { title: 'Pump duty point differs between datasheet and P&ID', doc: fdoc.id, severity: 'High', source: 'Datasheet: 12 m3/h @ 40 m · P&ID: 15 m3/h @ 40 m', rule: 'Manual review of vendor data vs P&ID' }
    ok((await call('POST', `${P}/findings`, fd, K)).status === 403, 'contractors cannot raise findings')
    ok((await call('POST', `${P}/findings`, { ...fd, source: '' }, C)).status === 422, 'finding needs the compared values')
    if (voidDoc) ok((await call('POST', `${P}/findings`, { ...fd, doc: voidDoc.id }, C)).status === 422, 'no findings on void / superseded documents')
    const n0 = pd.findings.length
    pd = proj(await call('POST', `${P}/findings`, fd, C))
    const nf = pd.findings.at(-1)!
    ok(pd.findings.length === n0 + 1 && nf.status === 'Open' && nf.raisedBy === 'Consultant' && !!nf.raisedAt && /^CHK-\d{2}$/.test(nf.id), `manual finding ${nf.id} raised by the Consultant`)
    pd = proj(await call('POST', `${P}/findings/${nf.id}/dispose`, { status: 'Resolved', reason: 'P&ID corrected to 12 m3/h in R02' }, QA))
    ok(pd.findings.find((f) => f.id === nf.id)!.status === 'Resolved', 'manual finding dispositioned like any other')
  }
} finally {
  server.close()
  await prisma.$disconnect()
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
