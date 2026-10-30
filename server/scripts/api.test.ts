// End-to-end API test against freshly loaded fixtures: `npm run fixtures:load && npm test`.
// Mirrors qualigrafo/scripts/workflow.test.ts, but every rule is enforced by the server.
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { app } from '../src/app.ts'
import { prisma } from '../src/db.ts'
import jwt from 'jsonwebtoken'
import { config, parseTrustProxy, sessionMaxSeconds } from '../src/config.ts'
import { loginLimiter, resetApiRate } from '../src/lib/security.ts'
import { MAX_ATTEMPTS, deliverDue, resetTransport } from '../src/services/mail.ts'
import { maybeRunDaily, runReminders } from '../src/services/reminders.ts'
import { createServer } from 'node:net'
import { OQ_CASES, URS, catalogueProblems, oqCase, riskPriority, traceability } from '../src/validation/catalogue.ts'
import { runIq } from '../src/services/iq.ts'
import { evidenceState, handoverGates, today } from '../src/domain/rules.ts'
import { starterFor } from '../src/domain/starterLibrary.ts'
import type { ProjectData, Role } from '../src/domain/types.ts'

const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
const P = '/projects/PRJ-026'
const PASSWORD = process.env.SEED_PASSWORD ?? 'Demo@12345'
const EMAIL: Record<Role, string> = { Consultant: 'consultant@qualigrafo.test', Contractor: 'contractor@qualigrafo.test', 'Owner / QA': 'qa@qualigrafo.test' }

let fail = 0
/** OQ test case marker: every check printed after it belongs to that test case (validation pack, C7). */
const section = (id: string) => { const c = oqCase(id); if (!c) throw new Error(`Unknown OQ test case ${id}`); console.log(`SECTION ${id}  ${c.title}`) }
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

/** Echoes a project's current classification, so a profile PUT only changes the field a test is about. */
const classificationOf = (p: ProjectData['profile']) => ({
  industryGroup: p.industryGroup, facilityType: p.facilityType, secondaryFacilityType: p.secondaryFacilityType,
  customFacilityType: p.customFacilityType, serviceType: p.serviceType, projectStage: p.projectStage,
  bimRequirement: p.bimRequirement,
})

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

/** Minimal SMTP server for the e-mail tests: records messages; `refuse` answers MAIL FROM with a temporary failure. */
async function fakeSmtp() {
  const mails: { to: string[]; data: string }[] = []
  const state = { refuse: false }
  const srv = createServer((sock) => {
    sock.setEncoding('utf8')
    let buf = ''
    let inData = false
    let cur = { to: [] as string[], data: '' }
    sock.on('error', () => {})
    sock.write('220 fake ESMTP\r\n')
    sock.on('data', (chunk: string) => {
      buf += chunk
      for (let i = buf.indexOf('\r\n'); i >= 0; i = buf.indexOf('\r\n')) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (inData) {
          if (line === '.') { inData = false; mails.push(cur); cur = { to: [], data: '' }; sock.write('250 OK queued\r\n') }
          else cur.data += `${line.startsWith('..') ? line.slice(1) : line}\n`
          continue
        }
        const cmd = line.slice(0, 4).toUpperCase()
        if (cmd === 'EHLO') sock.write('250-fake\r\n250 8BITMIME\r\n')
        else if (cmd === 'MAIL') sock.write(state.refuse ? '451 Temporary local problem\r\n' : '250 OK\r\n')
        else if (cmd === 'RCPT') { cur.to.push(line); sock.write('250 OK\r\n') }
        else if (cmd === 'DATA') { inData = true; sock.write('354 End data with .\r\n') }
        else if (cmd === 'QUIT') { sock.write('221 Bye\r\n'); sock.end() }
        else sock.write('250 OK\r\n')
      }
    })
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  return {
    mails,
    port: (srv.address() as AddressInfo).port,
    get refuse() { return state.refuse },
    set refuse(v: boolean) { state.refuse = v },
    close: () => srv.close(),
  }
}

try {
  // ---- health & auth
  section('OQ-API-01')
  const hc = (await call('GET', '/health')).json
  ok(hc.ok === true && hc.db === 'up' && /^\d+\.\d+\.\d+/.test(hc.version), 'health check reaches the database and reports the version')
  ok((await call('GET', '/health/live')).json?.ok === true, 'liveness check answers without the database')
  ok(JSON.stringify(parseTrustProxy('loopback')) === '["loopback"]' && parseTrustProxy('1') === 1 && parseTrustProxy('true') === true && JSON.stringify(parseTrustProxy('uniquelocal, 10.0.0.0/8')) === '["uniquelocal","10.0.0.0/8"]', 'TRUST_PROXY: names, hop count, true / false, address lists')
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
  section('OQ-API-02')
  as('Contractor')
  ok((await act('/docs/DOC-007/submit', { note: 'Ready' }))?.startsWith('Attach the source file') === true, 'submit blocked until the revision has a source file')

  // ---- file upload & storage
  section('OQ-API-03')
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
  ok(await act('/docs/DOC-007/sign', { reason: 'ok', intent: true, password: PASSWORD }) !== null, 'Owner/QA cannot sign stage 1 (wrong role)')
  as('Consultant')
  ok(await act('/docs/DOC-007/sign', { reason: 'ok', intent: false, password: PASSWORD }) !== null, 'sign blocked without explicit intent confirmation')
  ok(await act('/docs/DOC-007/sign', { reason: 'ok', intent: true, password: PASSWORD }) === null, 'Consultant signs stage 1')
  ok(doc('DOC-007').signStage === 1 && doc('DOC-007').status === 'Under review', 'auto-advanced to stage 2, still under review')
  ok(doc('DOC-007').signatures[0].name === 'Demo Consultant', 'signer name comes from the authenticated account')
  ok(last.events.some((e) => e.category === 'Routing' && e.forRole === 'Owner / QA' && e.doc === 'DOC-007'), 'auto-routed to Owner / QA')
  const issuedBefore = last.issued.length
  as('Owner / QA')
  ok(await act('/docs/DOC-007/sign', { reason: 'ok', intent: true, password: PASSWORD }) === null, 'Owner/QA signs stage 2')
  ok(doc('DOC-007').status === 'Accepted', 'revision accepted after both stages')
  ok(last.issued.length === issuedBefore + 1 && last.issued[0].doc === 'DOC-007', 'controlled issue manifest generated')

  // ---- fresh revision = fresh approval
  section('OQ-API-04')
  as('Consultant')
  ok(await act('/docs/DOC-007/revisions') !== null, 'only the contractor starts a new revision')
  as('Contractor')
  ok(await act('/docs/DOC-007/revisions') === null, 'contractor starts a new revision')
  ok(doc('DOC-007').rev === 1 && doc('DOC-007').status === 'Draft' && doc('DOC-007').signStage === 0, 'new revision starts as Draft at stage 0')
  ok(doc('DOC-007').signatures.every((s) => s.rev === 0), 'old signatures stay bound to R00 only')
  ok(last.events[0].category === 'Revision', 'revision event logged')

  // ---- stale evidence after revision
  section('OQ-API-05')
  ok(evidenceState(last.reqs.find((r) => r.id === 'REQ-006')!, last.docs) === 'Evidence accepted', 'REQ-006 accepted before revising DOC-003')
  ok(await act('/docs/DOC-003/revisions') === null, 'DOC-003 revised')
  ok(evidenceState(last.reqs.find((r) => r.id === 'REQ-006')!, last.docs) === 'Revision changed', 'revising DOC-003 makes linked evidence stale')

  // ---- source import cancels pending route and rejects duplicates
  section('OQ-API-06')
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
  section('OQ-API-07')
  await act('/docs/DOC-001/submit', { note: 'again' })
  as('Consultant')
  ok(await act('/docs/DOC-001/return', { reason: '' }) !== null, 'return needs a reason')
  ok(await act('/docs/DOC-001/return', { reason: 'fix door swing' }) === null && doc('DOC-001').status === 'Changes requested', 'returned for changes')

  // ---- source reference attestation
  section('OQ-API-08')
  ok(await put('/reqs/REQ-001/source-ref', { clause: 'x', version: '', effective: '', attest: true }) !== null, 'attestation needs clause + version + date')
  ok(await put('/reqs/REQ-001/source-ref', { clause: 'Sec 3', version: '2024 ed', effective: '2024-01-01', attest: true }) === null, 'source reference saved')
  as('Contractor')
  ok(await put('/reqs/REQ-001/source-ref', { clause: 'a', version: 'b', effective: '', attest: false }) !== null, 'contractor cannot edit source reference')

  // ---- evidence: link, self-acceptance block, only current accepted revisions
  section('OQ-API-09')
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
  // one decision for several requirements (a freshly applied market pack), audited per requirement
  ok(await act('/reqs/applicability', { ids: ['REQ-004', 'REQ-005'], applicability: 'Required', rationale: '' }) !== null, 'a decision for several requirements still needs a rationale')
  ok(await act('/reqs/applicability', { ids: ['REQ-004', 'REQ-999'], applicability: 'Required', rationale: 'in scope' }) !== null, 'an unknown requirement rejects the whole batch')
  const beforeBulk = last.reqs.filter((r) => ['REQ-004', 'REQ-005'].includes(r.id)).map((r) => r.applicability)
  ok(await act('/reqs/applicability', { ids: ['REQ-004', 'REQ-005', 'REQ-004'], applicability: 'Not applicable', rationale: 'Single-storey layout: no interstitial plant room in this project.' }) === null, 'reviewer decides several requirements at once')
  const afterBulk = last.reqs.filter((r) => ['REQ-004', 'REQ-005'].includes(r.id))
  ok(afterBulk.every((r) => r.applicability === 'Not applicable' && r.rationale.startsWith('Single-storey layout')), `both requirements carry the decision and its rationale (was ${beforeBulk.join(', ')})`)
  const bulkAudit = last.audit.filter((a) => /decided together/.test(a.text))
  ok(bulkAudit.length === 2 && bulkAudit.every((a) => /REQ-00[45]/.test(a.text) && /Rationale: Single-storey/.test(a.text)), 'every requirement of the batch keeps its own audit entry with old -> new and the rationale')
  as('Contractor')
  ok(await act('/reqs/applicability', { ids: ['REQ-004'], applicability: 'Required', rationale: 'mine now' }) !== null, 'a contractor cannot decide applicability for a batch either')
  as('Consultant')

  // ---- NCR rules
  section('OQ-API-10')
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
  section('OQ-API-11')
  ok(await act('/risks', { title: 'r', detail: '', system: 'PW-001', likelihood: 4, impact: 5, owner: '', mitigation: '', due: '2026-11-01' }) !== null, 'risk needs owner + mitigation')
  ok(await act('/risks/RSK-001/status', { status: 'Closed', note: 'done' }) !== null, 'contractor cannot close a risk')
  as('Owner / QA')
  ok(await act('/risks/RSK-001/status', { status: 'Closed', note: '' }) !== null, 'risk status change needs a note')
  ok(await act('/risks/RSK-001/status', { status: 'Accepted', note: 'Residual risk accepted by QA' }) === null, 'reviewer accepts a risk with a note')

  // ---- RFIs, inspections, changes, regulatory update, snapshot
  section('OQ-API-12')
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
  section('OQ-API-13')
  as('Contractor')
  ok(await act('/reminders/send') !== null, 'contractor cannot send reminders')
  as('Consultant')
  ok(await act('/reminders/send') === null && last.events[0].category === 'Reminder' && last.events[0].text.startsWith('Reminder:'), 'reviewer sends in-app reminders to waiting signers')
  ok((await call('POST', `${P}/pins/CMT-001/revit-navigation`, { requestId: 'NAV-1' }, tokens.Consultant)).status === 404, 'old simulation endpoint removed')
  ok(/^\d{4}-\d{2}-\d{2}$/.test((await call('GET', '/reference/config')).json.today), 'server publishes its working date')
  as('Owner / QA')

  // ---- notifications are per user
  section('OQ-API-14')
  const unread = (p: ProjectData) => p.events.filter((e) => !e.read).length
  ok(await act('/notices/read-all') === null && unread(last) === 0, 'Owner / QA marks all read')
  as('Consultant')
  ok(unread(await refresh()) > 0, 'read state is per user (Consultant still has unread)')

  // ---- audit trail is server-side and attributed
  section('OQ-API-15')
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
  section('OQ-API-16')
  for (let i = 0; i < 5; i++) await login('nobody@qualigrafo.test', 'wrong-password-1')
  const locked = await login('nobody@qualigrafo.test', 'wrong-password-1')
  ok(locked.status === 429 && /Too many failed sign-in attempts/.test(locked.json.error), '6th failed sign-in for the same account is locked out (429)')
  ok((await login(EMAIL.Consultant, PASSWORD)).status === 200, 'lockout is per account: other users can still sign in')
  const sec = await get('/admin/security-events?limit=50', QA)
  ok(sec.json.events.some((e: any) => e.type === 'login.locked') && sec.json.events.some((e: any) => e.type === 'login.failure' && e.detail === 'unknown account'), 'security log records failures and lockouts')
  ok((await get('/admin/users', tokens.Consultant)).status === 403, 'non-administrators cannot open user administration')

  // ---- vendor isolation (AirCo-scoped Contractor)
  section('OQ-API-17')
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
  section('OQ-API-18')
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
  section('OQ-API-19')
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
  section('OQ-API-20')
  const ids: Record<string, string> = {}
  for (const r of Object.keys(EMAIL) as Role[]) ids[r] = (await get('/auth/me', tokens[r])).json.user.id
  ids.Vendor = (await get('/auth/me', vendor)).json.user.id
  ok((await get('/auth/me', QA)).json.user.canCreateProjects === true && (await get('/auth/me', tokens.Consultant)).json.user.canCreateProjects === false, 'session says who may create projects')
  ok((await get('/directory/users', tokens.Consultant)).status === 403 && (await get('/directory/users', QA)).json.users.length >= 4, 'user directory only for project creators')

  const spec = {
    name: 'Riyadh Oral Solids Line 3', client: 'Nova Pharma Ltd', site: 'Riyadh 2nd Industrial City', projectCountry: 'SA', markets: ['EU'],
    industryGroup: 'Pharma', facilityType: 'Non-sterile formulation', serviceType: 'Design only', scope: 'Expansion', projectStage: 'Detailed design', ownerStandards: 'NPL-QMS-014 rev 5',
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
  // Phase 5 / step 2: a new project is no longer empty — the industry template registers its deliverables as
  // "Missing". Requirements still need an approved library version, which these fixtures do not have.
  ok(np2.markets.join() === 'SA,EU' && np2.reqs.length === 0, 'project country kept in scope; no requirements without an approved library')
  ok(np2.docs.length > 0 && np2.docs.every((d) => d.status === 'Missing' && d.rev === 0), 'the project starts with its deliverables registered as Missing, not with nothing')
  ok(np2.docs.every((d) => np2.disciplines.some((x) => x.name === d.discipline)), 'every generated deliverable belongs to a discipline of the project')
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
  section('OQ-API-21')
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
  section('OQ-API-22')
  const lib = (who: string, method: string, path: string, body?: unknown) => call(method, `/library${path}`, body, who)
  // a second library editor (administrator) for the four-eyes rule
  const rv = await send('POST', '/admin/users', { email: 'lib.reviewer@qualigrafo.test', name: 'Library Reviewer', isAdmin: true }, QA)
  let RV = (await login('lib.reviewer@qualigrafo.test', rv.json.tempPassword)).json.token as string
  RV = (await send('POST', '/auth/password', { current: rv.json.tempPassword, next: 'Reviewer-2026-lib' }, RV)).json.token

  let packs = (await lib(tokens.Contractor, 'GET', '')).json.packs
  ok(packs.length === 5 && packs.every((p: any) => p.versions.length === 0), 'library readable by every user; empty on a new installation')
  ok((await lib(tokens.Contractor, 'POST', '/starter')).status === 403, 'only library editors load the starter template')
  ok((await lib(QA, 'POST', '/starter', { industries: [] })).status === 422, 'at least one industry group has to be chosen')
  // Phase 5 / step 2b: an installation loads only the industries it works in. This one is pharma.
  const st = await lib(QA, 'POST', '/starter', { industries: ['Pharma'] })
  ok(st.status === 201 && st.json.created.join() === 'SA (17),IN (9),EU (7),US (3)', `starter template loaded as drafts (${st.json.created.join(', ')})`)
  ok((await lib(QA, 'POST', '/starter', { industries: ['Pharma'] })).status === 422, 'starter cannot be loaded twice')
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
  ok((await lib(QA, 'POST', `/versions/${sa1}/approve`, { reason: 'Checked', password: PASSWORD })).json.error?.includes('Four-eyes') === true, 'the author cannot approve their own draft')
  ok((await lib(tokens.Consultant, 'POST', `/versions/${sa1}/approve`, { reason: 'Checked', password: PASSWORD })).status === 403, 'non-editors cannot approve')
  ok((await lib(RV, 'POST', `/versions/${sa1}/approve`, { reason: '', password: 'Reviewer-2026-lib' })).status === 422, 'approval needs its basis recorded')
  const ap = await lib(RV, 'POST', `/versions/${sa1}/approve`, { reason: 'Topics accepted as starting scope; clauses to follow in v2', password: 'Reviewer-2026-lib' })
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
  const mk = await call('POST', '/projects', { ...spec, name: 'Library Test Plant', code: 'LIB-001', markets: [], projectCountry: 'SA', facilityType: 'Non-sterile formulation', members: [spec.members[0], spec.members[1]] }, QA)
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
  ok((await lib(RV, 'POST', `/versions/${d2.json.version.id}/approve`, { reason: 'x', password: 'Reviewer-2026-lib' })).status === 403, 'the editor of v2 cannot approve it')
  ok((await lib(QA, 'POST', `/versions/${d2.json.version.id}/approve`, { reason: 'Clauses verified against the 2024 guide', password: PASSWORD })).status === 200, 'Owner / QA approves v2')
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

  // v3: an item restricted to one industry group (Phase 5 / step 2). An item that filters on nothing still
  // applies everywhere — that is what every item authored before this step holds.
  const d3 = await lib(RV, 'POST', '/packs/SA/drafts')
  ok((await lib(RV, 'POST', `/versions/${d3.json.version.id}/items`, { key: 'PHARMA-ONLY-01', title: 'Qualification master plan for the facility', discipline: 'CQV', industries: ['Pharma'], critical: true })).status === 201, 'an item can be restricted to an industry group')
  ok((await lib(RV, 'POST', `/versions/${d3.json.version.id}/items`, { key: 'BAD-INDUSTRY-01', title: 'Should not be accepted', discipline: 'CQV', industries: ['Shipbuilding'] })).json.error?.includes('unknown industry group') === true, 'an unknown industry group is refused')
  ok((await lib(QA, 'POST', `/versions/${d3.json.version.id}/approve`, { reason: 'Industry applicability recorded', password: PASSWORD })).status === 200, 'v3 approved')

  const hos = await call('POST', '/projects', {
    name: 'Riyadh Day Surgery Centre', client: 'Nova Pharma Ltd', site: 'Riyadh', projectCountry: 'SA', markets: [],
    industryGroup: 'Hospital / Healthcare', facilityType: 'Ambulatory / day-care / day-surgery centre', serviceType: 'Design only',
    scope: 'New plant', projectStage: 'Detailed design', ownerStandards: '', disciplines: ['HVAC', 'Electrical'],
    companies: [], members: [{ userId: ids['Owner / QA'], role: 'Owner / QA' }],
  }, QA)
  ok(hos.status === 201, 'a hospital project is created on the same installation as the pharma ones')
  const hp = (await get(`/projects/${hos.json.code}`, QA)).json.project as ProjectData
  ok(!hp.reqs.some((r) => r.libraryKey === 'PHARMA-ONLY-01'), 'the industry filter keeps a pharma-only requirement off a hospital project')
  ok(hp.reqs.some((r) => r.libraryKey === 'TOPIC-01'), 'but an item that filters on no industry still applies to it')
  const pharmaNow = (await get(LP, QA)).json.project as ProjectData
  ok(pharmaNow.updates.some((u) => u.kind === 'Library' && u.summary.includes('1 new')), 'the pharma project is offered the new pharma-only item as a library update')

  // ---------------------------------------------------------------- industry starter packs (Phase 5 / step 2b)
  section('OQ-API-37')
  {
    // The pharma content is unchanged by this step: the per-market sets a pharma installation already approved.
    ok(starterFor('Pharma', 'SA').length === 17 && starterFor('Pharma', 'EU').length === 7 && starterFor('Pharma', 'IN').length === 9 && starterFor('Pharma', 'US').length === 3, 'the pharma starter sets are exactly the ones that shipped before')
    ok(starterFor('Pharma', 'UK').length === 0, 'and pharma still has no UK content')

    const hospital = starterFor('Hospital / Healthcare', 'SA')
    const energy = starterFor('Energy & High-Tech', 'SA')
    const common = starterFor('Common buildings', 'SA')
    ok(hospital.length > 0 && energy.length > 0 && common.length > 0, `the three new industry groups have starter content (${hospital.length}, ${energy.length}, ${common.length} topics)`)
    ok(hospital.some((i) => /medical gas/i.test(i.title)) && common.some((i) => /fire strategy/i.test(i.title)), 'the topics are the ones those industries actually evidence')

    // Energy holds two worlds, so its items say which: a solar farm must not inherit cleanroom requirements.
    const semi = energy.filter((i) => i.key.startsWith('SEM-'))
    const solar = energy.filter((i) => i.key.startsWith('SOL-'))
    ok(semi.length > 0 && semi.every((i) => (i.facilities ?? []).length > 0 && (i.facilities ?? []).every((f) => /^Semiconductor/.test(f))), 'semiconductor items are limited to semiconductor facilities')
    ok(solar.length > 0 && solar.every((i) => (i.facilities ?? []).length > 0 && (i.facilities ?? []).every((f) => !/^Semiconductor/.test(f))), 'solar and renewable items are limited to the renewable facilities')

    // End to end: this installation adds hospital content. Only UK has no version yet, so that is where it lands.
    const hos = await lib(QA, 'POST', '/starter', { industries: ['Hospital / Healthcare'] })
    ok(hos.status === 201 && hos.json.created.join() === `UK (${hospital.length})`, `a second industry can be added later (${hos.json.created.join(', ')})`)
    const ukDraft = (await lib(QA, 'GET', '')).json.packs.find((p: any) => p.market === 'UK').versions[0]
    const ukItems = (await lib(QA, 'GET', `/versions/${ukDraft.id}`)).json.version.items
    ok(ukItems.length > 0 && ukItems.every((i: any) => i.industries.join() === 'Hospital / Healthcare'), 'every loaded item carries the industry group it belongs to')
    ok(ukItems.every((i: any) => i.clause === ''), 'and stays topic-level: no clause is asserted for it')
    ok((await lib(RV, 'POST', `/versions/${ukDraft.id}/approve`, { reason: 'Hospital topics accepted as starting scope', password: 'Reviewer-2026-lib' })).status === 200, 'the hospital pack is approved under the same four-eyes rule')

    const mk2 = (industryGroup: string, facilityType: string, code: string, disciplines: string[]) => call('POST', '/projects', {
      name: `UK ${code}`, client: 'Nova Pharma Ltd', site: 'London', projectCountry: 'UK', markets: [],
      industryGroup, facilityType, serviceType: 'Design only', scope: 'New plant', projectStage: 'Detailed design',
      ownerStandards: '', disciplines, companies: [], code,
      members: [{ userId: ids['Owner / QA'], role: 'Owner / QA' }],
    }, QA)

    ok((await mk2('Hospital / Healthcare', 'General hospital', 'UK-HOS', ['HVAC', 'Medical Gas'])).status === 201, 'a UK hospital project is created')
    const uh = (await get('/projects/UK-HOS', QA)).json.project as ProjectData
    ok(uh.reqs.length > 0 && uh.reqs.every((r) => r.libraryKey?.startsWith('HOS-')), 'it receives the hospital requirements, and only those')
    ok(uh.reqs.every((r) => r.applicability === 'Assessment pending'), 'they arrive for assessment, not pre-decided')

    ok((await mk2('Pharma', 'Sterile products', 'UK-PHA', ['HVAC'])).status === 201, 'a UK pharma project is created on the same installation')
    const up = (await get('/projects/UK-PHA', QA)).json.project as ProjectData
    ok(up.reqs.length === 0, 'and receives nothing: the only approved UK pack is for another industry')
  }

  // adding a market in Setup brings its library
  ok((await lib(RV, 'POST', `/versions/${vid('IN')}/approve`, { reason: 'Accepted as starting scope', password: 'Reviewer-2026-lib' })).status === 200, 'IN pack approved')
  const before = lp.reqs.length
  lp = (await call('PUT', `${LP}/profile`, { ...classificationOf(lp.profile), scope: lp.profile.scope, ownerStandards: '', markets: ['SA', 'IN'], reason: 'Product will also be supplied to India' }, QA)).json.project
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
  section('OQ-API-23')
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
  section('OQ-API-24')
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
  // ======================================================== phase 2 / step 1: e-signatures, session timeout
  section('OQ-API-25')
  {
    const C = tokens.Consultant, K = tokens.Contractor
    loginLimiter.reset()
    // a fresh document with a real file, submitted for review
    let pd = (await call('GET', P, undefined, C)).json.project as ProjectData
    const company = pd.docs.find((d) => d.owner !== 'Consult Partners')!.owner
    pd = (await call('POST', `${P}/docs`, { title: 'Chiller vendor datasheet', number: 'NPL-HVAC-DS-0901', discipline: 'HVAC', system: '', owner: company, due: '2026-12-30', critical: false }, C)).json.project
    const sd = pd.docs.find((d) => d.number === 'NPL-HVAC-DS-0901')!.id
    as('Contractor')
    const content = '%PDF-1.4 chiller datasheet ' + Date.now()
    ok((await upload(sd, 'chiller.pdf', content)) === null, 'source uploaded for signing')
    ok((await act(`/docs/${sd}/submit`, { note: 'For review' })) === null, 'submitted')

    const sign = (token: string, body: object) => call('POST', `${P}/docs/${sd}/sign`, { reason: 'Checked against URS', intent: true, ...body }, token)
    ok((await sign(C, {})).status === 400, 'signature without the password field is rejected')
    const wrong = await sign(C, { password: 'not-my-password1' })
    ok(wrong.status === 422 && wrong.json.error.includes('Password is incorrect'), 'wrong password: signature not recorded')
    pd = (await call('GET', P, undefined, C)).json.project
    ok(pd.docs.find((d) => d.id === sd)!.signatures.length === 0, 'nothing signed after a failed re-authentication')
    const s1 = await sign(C, { password: PASSWORD })
    ok(s1.status === 200, 'Consultant signs with the password')
    const sig = (s1.json.project as ProjectData).docs.find((d) => d.id === sd)!.signatures[0]
    ok(sig.meaning === 'Reviewed — technically acceptable' && sig.email === EMAIL.Consultant && sig.checksum === sha(content) && /^[0-9a-f]{64}$/.test(sig.sigHash ?? ''), 'signature records meaning, signer e-mail, file checksum and hash')
    const s2 = await sign(QA, { password: PASSWORD, reason: 'Approved for construction' })
    const sig2 = (s2.json.project as ProjectData).docs.find((d) => d.id === sd)!.signatures[1]
    ok(s2.status === 200 && sig2.meaning === 'Approved for use', 'Owner / QA approval carries its own meaning')
    const iss = (s2.json.project as ProjectData).issued.find((i) => i.doc === sd)
    ok(!iss || (iss.signers as any[]).every((x) => x.meaning && x.sigHash), 'issue manifest lists meaning and signature hash per signer')

    // verification: valid, then detect tampering, legacy signatures labelled
    const verify = async (doc: string) => (await call('GET', `${P}/docs/${doc}/signatures/verify`, undefined, C)).json.signatures as { status: string }[]
    ok((await verify(sd)).every((v) => v.status === 'Valid'), 'signature hashes verify')
    const row = await prisma.docSignature.findFirstOrThrow({ where: { document: { code: sd, project: { code: 'PRJ-026' } } }, orderBy: { at: 'asc' } })
    await prisma.docSignature.update({ where: { id: row.id }, data: { reason: 'Changed behind the application' } })
    ok((await verify(sd))[0].status === 'Altered', 'a signature changed directly in the database is detected')
    await prisma.docSignature.update({ where: { id: row.id }, data: { reason: row.reason } })
    const legacyDoc = pd.docs.find((d) => d.signatures.some((s) => !s.sigHash))
    if (legacyDoc) ok((await verify(legacyDoc.id)).some((v) => v.status.startsWith('Not an electronic signature')), 'signatures from before e-signatures are labelled as such')
    ok((await call('GET', `${P}/docs/${sd}/signatures/verify`, undefined, tokens.Contractor)).status === 200, 'project members can verify signatures')

    // security log + lockout after repeated wrong passwords
    const sec = (await call('GET', '/admin/security-events?limit=50', undefined, QA)).json.events.map((e: any) => e.type)
    ok(sec.includes('esign.signed') && sec.includes('esign.failure'), 'signatures and failed re-authentications are in the security log')
    for (let i = 0; i < 5; i++) await call('POST', `${P}/docs/DOC-001/sign`, { reason: 'x', intent: true, password: 'wrong-password-9' }, K)
    ok((await call('POST', `${P}/docs/DOC-001/sign`, { reason: 'x', intent: true, password: PASSWORD }, K)).status === 429, 'five wrong signature passwords lock the account temporarily')
    loginLimiter.reset()

    // library approval needs the password too
    const anyDraft = (await call('GET', '/library', undefined, QA)).json.packs.flatMap((p: any) => p.versions).find((v: any) => v.status === 'Draft')
    if (anyDraft) ok((await call('POST', `/library/versions/${anyDraft.id}/approve`, { reason: 'x', password: 'wrong-password-1' }, QA)).json.error?.includes('Password is incorrect'), 'library approval re-authenticates')

    // session: short-lived tokens, refresh while active, absolute maximum
    const cfg = (await call('GET', '/reference/config')).json
    ok(cfg.idleMinutes === config.IDLE_TIMEOUT_MIN, `inactivity timeout published (${cfg.idleMinutes} min)`)
    const claims = jwt.decode(C) as jwt.JwtPayload
    ok(claims.exp! - claims.iat! === config.IDLE_TIMEOUT_MIN * 60 && typeof claims.ss === 'number', 'tokens expire after the idle timeout and carry the session start')
    const rf = await call('POST', '/auth/refresh', undefined, C)
    ok(rf.status === 200 && (jwt.decode(rf.json.token) as jwt.JwtPayload).ss === claims.ss, 'refresh extends the session, keeping its start')
    const consultant = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL.Consultant } })
    const expired = jwt.sign({ tv: consultant.tokenVersion, ss: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 3600, exp: Math.floor(Date.now() / 1000) - 60 }, config.JWT_SECRET, { subject: consultant.id })
    const idle = await call('GET', P, undefined, expired)
    ok(idle.status === 401 && idle.json.error.includes('expired'), 'an idle (expired) token is refused')
    ok((await call('POST', '/auth/refresh', undefined, expired)).status === 401, 'an expired token cannot be refreshed')
    const old = jwt.sign({ tv: consultant.tokenVersion, ss: Math.floor(Date.now() / 1000) - sessionMaxSeconds - 60 }, config.JWT_SECRET, { subject: consultant.id, expiresIn: 600 })
    const tooLong = await call('POST', '/auth/refresh', undefined, old)
    ok(tooLong.status === 401 && tooLong.json.error.includes('maximum length'), 'sessions end at the absolute maximum even when active')
  }
  // ======================================================== phase 2 / step 2: old -> new everywhere (C2)
  section('OQ-API-26')
  {
    const C = tokens.Consultant
    const audit = async (n = 6) => (await call('GET', `${P}/audit?limit=${n}`, undefined, C)).json.events.map((e: any) => e.text).join('\n') as string
    let pd = (await call('GET', P, undefined, QA)).json.project as ProjectData

    // registers
    const co = pd.companies.find((x) => x.kind !== 'Owner' && x.active)!
    const kind2 = co.kind === 'Subcontractor' ? 'Vendor / supplier' : 'Subcontractor'
    await call('PUT', `${P}/companies/${co.id}`, { kind: kind2, contactName: 'R. Sharma' }, QA)
    ok((await audit()).includes(`Company ${co.name} updated: kind "${co.kind}" -> "${kind2}"; contact "${co.contactName || '—'}" -> "R. Sharma"`), 'company change logged old -> new')
    const sy = pd.systems.find((x) => x.active)!
    await call('PUT', `${P}/systems/${sy.tag}`, { name: `${sy.name} (rev)`, gmpCritical: !sy.gmpCritical }, C)
    ok((await audit()).includes(`System ${sy.tag} updated: description "${sy.name}" -> "${sy.name} (rev)"; GMP-critical "${sy.gmpCritical ? 'yes' : 'no'}" -> "${sy.gmpCritical ? 'no' : 'yes'}"`), 'system change logged old -> new')

    // requirements: applicability and source reference
    const rq = pd.reqs.find((r) => r.applicability === 'Assessment pending')!
    await call('POST', `${P}/reqs/${rq.id}/applicability`, { applicability: 'Required', rationale: 'Applies to the oral solid line' }, C)
    ok((await audit()).includes(`${rq.id} applicability "Assessment pending" -> "Required". Rationale: Applies to the oral solid line`), 'applicability logged old -> new with rationale')
    await call('PUT', `${P}/reqs/${rq.id}/source-ref`, { clause: '4.2.1', version: '2024 edition', effective: '2024-06-01', attest: false }, C)
    ok((await audit()).includes(`clause "${rq.clause || '—'}" -> "4.2.1"`), 'source reference logged old -> new')

    // profile (new baseline)
    const prof = pd.profile
    await call('PUT', `${P}/profile`, { ...classificationOf(prof), projectStage: 'Commissioning', scope: prof.scope, ownerStandards: prof.ownerStandards, markets: pd.markets, reason: 'Moved into commissioning' }, QA)
    ok((await audit()).includes(`project stage "${prof.projectStage}" -> "Commissioning". Reason: Moved into commissioning`), 'profile change logged old -> new on the new baseline')

    // statuses
    pd = (await call('GET', P, undefined, QA)).json.project
    const rk = pd.risks.find((r) => r.status === 'Open' || r.status === 'Mitigating')!
    const to = rk.status === 'Open' ? 'Mitigating' : 'Open'
    await call('POST', `${P}/risks/${rk.id}/status`, { status: to, note: 'Mitigation started' }, C)
    ok((await audit()).includes(`${rk.id} status "${rk.status}" -> "${to}". Note: Mitigation started`), 'risk status logged old -> new')
    const ga = pd.actions.find((a) => a.status === 'Open')
    if (ga) {
      await call('POST', `${P}/actions/${ga.id}/progress`, { to: 'Ready for verification' }, tokens.Contractor)
      ok((await audit()).includes(`${ga.id} status "Open" -> "Ready for verification"`), 'action status logged old -> new')
    }
    const fnd = pd.findings.find((f) => f.status === 'Open')
    if (fnd) {
      await call('POST', `${P}/findings/${fnd.id}/dispose`, { status: 'Accepted exception', reason: 'Alias approved by the owner' }, C)
      ok((await audit()).includes(`${fnd.id} status "Open" -> "Accepted exception". Rationale: Alias approved by the owner`), 'finding disposition logged with the rationale')
    }

    // library: item edits and the draft note, in the security log
    const packs = (await call('GET', '/library', undefined, QA)).json.packs
    const sa = packs.find((p: any) => p.market === 'SA')
    let draft = sa.versions.find((v: any) => v.status === 'Draft')
    if (!draft) draft = (await call('POST', '/library/packs/SA/drafts', undefined, QA)).json.version
    const full = (await call('GET', `/library/versions/${draft.id}`, undefined, QA)).json.version
    const it = full.items[0]
    await call('PUT', `/library/items/${it.id}`, { clause: 'Chapter 9.9' }, QA)
    await call('PUT', `/library/versions/${draft.id}`, { note: 'Clause review round 3' }, QA)
    const sec = (await call('GET', '/admin/security-events?limit=10', undefined, QA)).json.events.map((e: any) => e.detail).join('\n')
    ok(sec.includes(`${it.key} edited: clause "${it.clause || '—'}" -> "Chapter 9.9"`), 'library item edit logged old -> new')
    ok(sec.includes('note ') && sec.includes('-> "Clause review round 3"'), 'library draft note change logged')
    await call('DELETE', `/library/versions/${draft.id}`, undefined, QA)

    // administration
    const users = (await call('GET', '/admin/users', undefined, QA)).json.users
    const target = users.find((u: any) => u.email === EMAIL.Contractor)
    await call('PATCH', `/admin/users/${target.id}`, { name: 'Demo Contractor (BuildCo)' }, QA)
    const sec2 = (await call('GET', '/admin/security-events?limit=5', undefined, QA)).json.events.find((e: any) => e.type === 'user.updated')
    ok(sec2?.detail === `name "${target.name}" -> "Demo Contractor (BuildCo)"`, 'user change logged old -> new')
    await call('PATCH', `/admin/users/${target.id}`, { name: target.name }, QA)
  }
  // ======================================================== phase 2 / step 3: PDF reports and transmittals (C4)
  section('OQ-API-27')
  {
    const C = tokens.Consultant, K = tokens.Contractor
    const VND = (await call('POST', '/auth/login', { email: 'vendor@qualigrafo.test', password: PASSWORD })).json.token as string
    const pdfGet = async (path: string, token: string) => {
      const r = await fetch(`${base}${P}${path}`, { headers: { authorization: `Bearer ${token}` } })
      const buf = Buffer.from(await r.arrayBuffer())
      if (r.ok && process.env.REPORT_OUT) (await import('node:fs')).writeFileSync(`${process.env.REPORT_OUT}/${path.replace(/[^\w.-]+/g, '_')}`, buf)
      return { status: r.status, type: r.headers.get('content-type'), sha: r.headers.get('x-content-sha256'), buf }
    }
    const shaBuf = (b: Buffer) => createHash('sha256').update(b).digest('hex')

    // handover dossier
    const hd = await pdfGet('/reports/handover.pdf', C)
    ok(hd.status === 200 && hd.type === 'application/pdf' && hd.buf.subarray(0, 5).toString() === '%PDF-', `handover dossier is a PDF (${Math.round(hd.buf.length / 1024)} KB)`)
    ok(hd.sha === shaBuf(hd.buf), 'response carries the SHA-256 of the PDF')
    const au = (await call('GET', `${P}/audit?limit=3`, undefined, C)).json.events.map((e: any) => e.text).join('\n')
    ok(au.includes(`Report generated: Handover dossier HOD-`) && au.includes(hd.sha!), 'generation recorded in the audit trail with the file hash')
    ok((await pdfGet('/reports/handover.pdf', VND)).status === 403, 'vendor accounts cannot pull project reports')

    // audit evidence package from a frozen snapshot
    const snap = await call('POST', `${P}/snapshots`, {}, C)
    const code = (snap.json.project as ProjectData).snapshots[0].id
    const ap = await pdfGet(`/snapshots/${code}/report.pdf`, C)
    ok(ap.status === 200 && ap.buf.subarray(0, 5).toString() === '%PDF-' && ap.sha === shaBuf(ap.buf), `audit package ${code} as PDF`)
    ok((await pdfGet('/snapshots/AUD-999/report.pdf', C)).status === 404, 'unknown package is 404')

    // transmittals
    let pd = (await call('GET', P, undefined, QA)).json.project as ProjectData
    const sendable = pd.docs.filter((d) => !['Missing', 'Void', 'Superseded'].includes(d.status))
    const airDoc = pd.docs.find((d) => d.owner === 'AirCo' && !['Missing', 'Void', 'Superseded'].includes(d.status))
    const pick = [...new Set([sendable[0].id, sendable[1].id, ...(airDoc ? [airDoc.id] : [])])]
    const body = { to: 'AirCo', purpose: 'For construction', note: 'Issued for site installation', docs: pick }
    ok((await call('POST', `${P}/transmittals`, body, K)).status === 403, 'contractors cannot issue transmittals')
    ok((await call('POST', `${P}/transmittals`, { ...body, purpose: 'Because' }, C)).status === 422, 'purpose must be one of the controlled values')
    ok((await call('POST', `${P}/transmittals`, { ...body, to: 'Nobody Ltd' }, C)).status === 422, 'recipient must be in the company register')
    const missingDoc = pd.docs.find((d) => d.status === 'Missing')
    if (missingDoc) ok((await call('POST', `${P}/transmittals`, { ...body, docs: [missingDoc.id] }, C)).json.error?.includes('no revision'), 'a document without a revision cannot be transmitted')
    const voidDoc = pd.docs.find((d) => d.status === 'Void' || d.status === 'Superseded')
    if (voidDoc) ok((await call('POST', `${P}/transmittals`, { ...body, docs: [voidDoc.id] }, C)).status === 422, 'void / superseded documents cannot be transmitted')
    pd = (await call('POST', `${P}/transmittals`, body, C)).json.project
    const tr = pd.transmittals[0]
    const first = pd.docs.find((d) => d.id === pick[0])!
    ok(/^TRN-\d{3}$/.test(tr.id) && tr.items.length === pick.length && tr.to === 'AirCo' && tr.by === 'Demo Consultant', `${tr.id} issued with ${tr.items.length} document(s)`)
    ok(tr.items[0].rev === first.rev && tr.items[0].checksum === (first.sourceRev === first.rev ? first.checksum ?? null : null), 'items frozen with revision and checksum')
    ok((await call('GET', '/projects/PRJ-026', undefined, VND)).json.project.transmittals.some((t: any) => t.id === tr.id), 'the receiving vendor sees the transmittal')
    const t2 = (await call('POST', `${P}/transmittals`, { ...body, to: pd.companies.find((c) => c.name !== 'AirCo' && c.active)!.name }, C)).json.project.transmittals[0]
    ok(!(await call('GET', '/projects/PRJ-026', undefined, VND)).json.project.transmittals.some((t: any) => t.id === t2.id), "a vendor does not see other companies' transmittals")
    ok((await pdfGet(`/transmittals/${t2.id}/report.pdf`, VND)).status === 404, "a vendor cannot download another company's transmittal")
    const tp = await pdfGet(`/transmittals/${tr.id}/report.pdf`, VND)
    ok(tp.status === 200 && tp.sha === shaBuf(tp.buf), 'the receiving vendor downloads the transmittal PDF')

    ok((await call('POST', `${P}/transmittals/${tr.id}/acknowledge`, { note: '' }, C)).status === 403, 'the issuer cannot acknowledge receipt')
    ok((await call('POST', `${P}/transmittals/${t2.id}/acknowledge`, { note: '' }, VND)).status === 404, "a vendor cannot acknowledge another company's transmittal")
    const ack = await call('POST', `${P}/transmittals/${tr.id}/acknowledge`, { note: 'Received complete' }, VND)
    ok(ack.status === 200 && ack.json.project.transmittals.find((t: any) => t.id === tr.id).ack?.note === 'Received complete', 'receiving company acknowledged receipt')
    ok((await call('POST', `${P}/transmittals/${tr.id}/acknowledge`, { note: '' }, K)).status === 422, 'receipt is acknowledged once')
    const ap2 = await pdfGet(`/transmittals/${tr.id}/report.pdf`, C)
    ok(ap2.status === 200, 'acknowledged transmittal PDF')
  }
  // ======================================================== phase 2 / step 4: e-mail notifications and scheduled reminders (C5)
  section('OQ-API-28')
  {
    const C = tokens.Consultant, K = tokens.Contractor
    const mails = (where: object = {}) => prisma.emailMessage.findMany({ where, orderBy: { createdAt: 'asc' } })
    const secEvents = async () => (await call('GET', '/admin/security-events?limit=30', undefined, QA)).json.events as any[]
    const smtp = await fakeSmtp()

    // security alerts queued by the earlier sections (always sent, whatever the preference)
    const nu = await mails({ toEmail: 'new.engineer.voltco@qualigrafo.test', kind: 'Security' })
    ok(nu.some((m) => m.subject.includes('Your Qualigrafo account')) && nu.some((m) => m.subject.includes('Your password was changed')), 'account holder is e-mailed about account creation and password change')
    ok(!(await mails({ kind: 'Security' })).some((m) => /[A-Za-z]{5}-\d{4}-[A-Za-z]{4}/.test(m.body)), 'temporary passwords are never e-mailed')
    ok((await mails({ toEmail: EMAIL.Contractor, subject: { contains: 'Electronic signing blocked' } })).length === 1, 'one alert when electronic signing locks after wrong passwords')
    ok((await mails({ toEmail: 'nobody@qualigrafo.test' })).length === 0, 'no e-mail for sign-in attempts on unknown accounts')

    // preferences
    ok((await call('GET', '/auth/me', undefined, K)).json.user.emailPref === 'Immediate', 'e-mail notifications default to Immediate')
    ok((await call('PUT', '/auth/preferences', { emailPref: 'Hourly' }, K)).status === 400, 'unknown preference rejected')

    // immediate e-mail for a targeted notice: not to the actor, vendor accounts only for their company
    await prisma.emailMessage.deleteMany()
    let pd = (await call('GET', P, undefined, C)).json.project as ProjectData
    const disc = pd.disciplines.find((d) => d.active)!.name
    const other = pd.companies.find((c) => c.active && c.name !== 'AirCo')!.name
    const mk = (title: string, owner: string) => call('POST', `${P}/docs`, { title, number: '', discipline: disc, system: '', owner, due: '2026-01-01', critical: false }, C)
    pd = (await mk('Mail test AirCo datasheet', 'AirCo')).json.project
    const airDoc = pd.docs.find((d) => d.title === 'Mail test AirCo datasheet')!
    let out = await mails()
    ok(out.some((m) => m.toEmail === EMAIL.Contractor && m.kind === 'Assignment' && m.subject.startsWith('[PRJ-026]') && m.body.includes(`${airDoc.id} Mail test AirCo datasheet registered`)), 'the contractor is e-mailed about a document assigned to them')
    ok(out.some((m) => m.toEmail === 'vendor@qualigrafo.test' && m.body.includes('#/p/PRJ-026/documents')), 'the vendor of that company is e-mailed, with a link to the page')
    ok(!out.some((m) => m.toEmail === EMAIL.Consultant), 'the person acting is not e-mailed about their own action')
    await prisma.emailMessage.deleteMany()
    await mk('Mail test other company', other)
    out = await mails()
    ok(out.some((m) => m.toEmail === EMAIL.Contractor) && !out.some((m) => m.toEmail === 'vendor@qualigrafo.test'), "vendor accounts get no e-mail about another company's documents")
    await call('PUT', '/auth/preferences', { emailPref: 'Off' }, K)
    await prisma.emailMessage.deleteMany()
    await mk('Mail test pref off', other)
    ok((await mails({ toEmail: EMAIL.Contractor })).length === 0, 'no work e-mails when notifications are Off')
    await call('PUT', '/auth/preferences', { emailPref: 'Immediate' }, K)
    await mk('Mail test delivery', other)
    ok((await secEvents()).some((e) => e.type === 'user.updated' && e.detail === 'e-mail notifications "Off" -> "Immediate"'), 'preference change logged old -> new')

    // delivery: without SMTP the outbox records "Not sent"
    ok(!config.SMTP_HOST, 'test run starts without SMTP configuration')
    let d = await deliverDue()
    out = await mails()
    ok(d.notSent > 0 && out.every((m) => m.status === 'Not sent' && !!m.lastError?.includes('not configured')), 'without SMTP e-mails are recorded as Not sent')
    ok((await call('POST', `/admin/emails/${out[0].id}/retry`, {}, QA)).status === 422, 'retry refused while delivery is not configured')
    // ... with SMTP they are delivered
    Object.assign(config, { SMTP_HOST: '127.0.0.1', SMTP_PORT: smtp.port, MAIL_FROM: 'Qualigrafo <noreply@qualigrafo.test>' })
    resetTransport()
    ok((await call('GET', '/admin/notifications', undefined, C)).status === 403, 'only administrators see e-mail and reminder settings')
    const info = (await call('GET', '/admin/notifications', undefined, QA)).json
    ok(info.delivery.configured && info.delivery.host === '127.0.0.1' && !JSON.stringify(info.delivery).toLowerCase().includes('pass') && info.settings.enabled === false, 'delivery status shown without secrets; fixtures keep the daily run off')
    ok((await call('POST', `/admin/emails/${out[0].id}/retry`, {}, QA)).json.email?.status === 'Queued', 'administrator re-queues an unsent e-mail')
    d = await deliverDue()
    let m0 = (await mails({ id: out[0].id }))[0]
    ok(d.sent === 1 && m0.status === 'Sent' && !!m0.sentAt && smtp.mails.length === 1, 'queued e-mail delivered over SMTP')
    ok(smtp.mails[0]?.to.some((t) => t.includes(m0.toEmail)) && smtp.mails[0].data.includes('X-Qualigrafo-Kind: Assignment') && /Subject: \[PRJ-026\]/.test(smtp.mails[0].data), 'the SMTP server received recipient, subject and kind header')
    ok((await call('POST', '/admin/notifications/test', {}, QA)).status === 200 && (await deliverDue()).sent === 1 && !!smtp.mails[1]?.to.some((t) => t.includes(EMAIL['Owner / QA'])), 'test e-mail goes to the administrator')
    // ... temporary failures are retried, then marked Failed
    smtp.refuse = true
    await call('POST', '/admin/notifications/test', {}, QA)
    d = await deliverDue()
    m0 = (await mails({ kind: 'Test', status: { not: 'Sent' } }))[0]
    ok(d.retry === 1 && m0?.status === 'Queued' && m0.attempts === 1 && !!m0.lastError?.includes('451') && m0.nextAttemptAt > new Date(), 'a refused e-mail is retried later with the error kept')
    await prisma.emailMessage.update({ where: { id: m0.id }, data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(Date.now() - 1000) } })
    d = await deliverDue()
    ok(d.failed === 1 && (await mails({ id: m0.id }))[0].status === 'Failed', `after ${MAX_ATTEMPTS} attempts the e-mail is Failed`)
    ok((await call('GET', '/admin/emails?status=Failed', undefined, QA)).json.emails.some((e: any) => e.id === m0.id && e.error.includes('451')), 'outbox lists failed e-mails with the error')
    smtp.refuse = false
    await call('POST', `/admin/emails/${m0.id}/retry`, {}, QA)
    ok((await deliverDue()).sent === 1 && (await mails({ id: m0.id }))[0].status === 'Sent', 'retried e-mail delivered')
    ok((await call('POST', `/admin/emails/${m0.id}/retry`, {}, QA)).status === 422, 'a sent e-mail cannot be retried')
    ok((await secEvents()).some((e) => e.type === 'email.retried'), 'retries are in the security log')

    // reminder schedule settings
    ok((await call('PUT', '/admin/notifications/settings', { enabled: true, time: '25:00', dueSoonDays: 3 }, QA)).status === 400, 'invalid reminder time rejected')
    ok((await call('PUT', '/admin/notifications/settings', { enabled: true, time: '08:00', dueSoonDays: 99 }, QA)).status === 400, 'due-soon window limited to 14 days')
    ok((await call('PUT', '/admin/notifications/settings', { enabled: true, time: '00:00', dueSoonDays: 3 }, C)).status === 403, 'only administrators change the schedule')
    ok((await call('PUT', '/admin/notifications/settings', { enabled: false, time: '00:00', dueSoonDays: 3 }, QA)).json.settings?.time === '00:00', 'schedule saved')
    ok((await secEvents()).some((e) => e.type === 'settings.updated' && e.detail.includes('time "08:00" -> "00:00"')), 'schedule change logged old -> new')
    ok((await maybeRunDaily()) === null, 'no scheduled run while daily reminders are off')

    // preferences for the run: Consultant daily digest, Owner / QA off
    await call('PUT', '/auth/preferences', { emailPref: 'Daily digest' }, C)
    await call('PUT', '/auth/preferences', { emailPref: 'Off' }, QA)
    await prisma.emailMessage.deleteMany()
    // a notice for the Consultant (submission routed for review) waits for the digest instead of going out immediately
    as('Contractor')
    ok(await upload(airDoc.id, 'mail-test.pdf', '%PDF-1.4 mail test') === null && await act(`/docs/${airDoc.id}/submit`, { note: 'For the digest' }) === null, 'document submitted for review')
    ok((await mails({ toEmail: EMAIL.Consultant })).length === 0, 'digest users get no immediate e-mail')

    await call('PUT', '/admin/notifications/settings', { enabled: true, time: '00:00', dueSoonDays: 3 }, QA)
    const run = await maybeRunDaily()
    ok(!!run && run.trigger === 'Scheduled' && run.status === 'Done' && run.items > 0 && run.emails > 0, `scheduled daily run: ${run?.items} item(s), ${run?.emails} e-mail(s)`)
    ok((await maybeRunDaily()) === null, 'the scheduled run happens once per day')
    pd = (await call('GET', P, undefined, K)).json.project
    ok(pd.events.some((e) => e.category === 'Reminder' && e.forRole === 'Contractor' && e.text.startsWith('Daily reminder:')), 'in-app daily reminder for the Contractor')
    ok(pd.events.some((e) => e.category === 'Reminder' && e.forRole === 'Consultant' && e.text.includes(airDoc.id)), 'in-app daily reminder for the Consultant names the waiting sign-off')
    ok((await prisma.auditEvent.count({ where: { project: { code: 'PRJ-026' }, role: 'System', text: { startsWith: 'Reminders (daily run' } } })) === 1, 'the run is in the project audit trail')
    out = await mails()
    const cm = out.find((m) => m.toEmail === EMAIL.Contractor)
    ok(cm?.kind === 'Reminder' && cm.subject.includes('Daily reminder') && cm.body.includes('Overdue:') && cm.body.includes('PRJ-026'), 'the contractor gets one reminder e-mail grouping overdue items per project')
    ok(out.filter((m) => m.toEmail === EMAIL.Contractor).length === 1, 'one e-mail per person per run, across all projects')
    const vm = out.find((m) => m.toEmail === 'vendor@qualigrafo.test')
    const vCodes = [...(vm?.body ?? '').matchAll(/• (DOC-\d+)/g)].map((x) => x[1])
    const docsAll = (await call('GET', P, undefined, QA)).json.project.docs as ProjectData['docs']
    ok(!!vm && vCodes.length > 0 && vCodes.every((c) => docsAll.find((x) => x.id === c)?.owner === 'AirCo'), "the vendor's reminder lists only AirCo documents")
    const dm = out.find((m) => m.toEmail === EMAIL.Consultant)
    ok(dm?.kind === 'Digest' && dm.body.includes('Waiting for your sign-off') && dm.body.includes(`${airDoc.id} R`) && dm.body.includes('Notifications for you:') && dm.body.includes('submitted. Signature request routed'), 'digest users get reminders and their notifications in one daily e-mail')
    ok(!out.some((m) => m.toEmail === EMAIL['Owner / QA']), 'people with notifications Off get no reminder e-mail')
    ok(out.filter((m) => !/access review/i.test(m.subject)).every((m) => m.body.includes('never approves')), 'every reminder states that it approves nothing')

    // manual run by an administrator; projects with the reminder rule off are skipped
    await call('PUT', `${P}/settings/automation`, { key: 'reminders', value: false }, QA)
    const count = () => prisma.auditEvent.count({ where: { project: { code: 'PRJ-026' }, text: { startsWith: 'Reminders (' } } })
    const before = await count()
    const manual = (await call('POST', '/admin/notifications/run', {}, QA)).json.run
    ok(manual?.trigger === 'Manual' && manual.status === 'Done' && manual.startedBy === (await call('GET', '/auth/me', undefined, QA)).json.user.name, 'administrator runs the reminders on demand')
    ok((await count()) === before, 'projects with the reminder rule off are skipped')
    ok((await call('POST', '/admin/notifications/run', {}, C)).status === 403, 'only administrators run reminders on demand')
    const runs = (await call('GET', '/admin/notifications', undefined, QA)).json.runs
    ok(runs.length >= 2 && runs[0].trigger === 'Manual' && runs.some((r: any) => r.trigger === 'Scheduled'), 'run history lists scheduled and manual runs')
    await call('PUT', `${P}/settings/automation`, { key: 'reminders', value: true }, QA)

    // restore
    await call('PUT', '/auth/preferences', { emailPref: 'Immediate' }, C)
    await call('PUT', '/auth/preferences', { emailPref: 'Immediate' }, QA)
    await call('PUT', '/admin/notifications/settings', { enabled: false, time: '08:00', dueSoonDays: 3 }, QA)
    // "Send reminders now" on the project: one e-mail per waiting signer, never to the sender
    await prisma.emailMessage.deleteMany()
    ok((await call('POST', `${P}/reminders/send`, {}, QA)).status === 200, 'Owner / QA sends reminders now')
    const rem = await mails({ kind: 'Reminder' })
    ok(rem.filter((m) => m.toEmail === EMAIL.Consultant).length === 1 && rem.find((m) => m.toEmail === EMAIL.Consultant)!.body.includes(`${airDoc.id} R`) && !rem.some((m) => m.toEmail === EMAIL['Owner / QA']), 'the waiting signer gets one e-mail listing the documents; the sender gets none')
    Object.assign(config, { SMTP_HOST: '', MAIL_FROM: '' })
    resetTransport()
    smtp.close()
  }
  // ======================================================== phase 2 / step 5: periodic user-access review (C6)
  section('OQ-API-29')
  {
    const C = tokens.Consultant
    const VEMAIL = 'vendor@qualigrafo.test'
    const qa = (method: string, path: string, body?: unknown) => call(method, path, body, QA)
    const secEvents = async () => (await qa('GET', '/admin/security-events?limit=40')).json.events as any[]

    let ov = (await qa('GET', '/admin/access-reviews')).json
    ok(ov.schedule.due === true && ov.schedule.intervalDays === 90 && !ov.schedule.lastCompleted && !ov.schedule.open, 'the first access review is due at once (default every 90 days)')
    ok((await call('GET', '/admin/access-reviews', undefined, C)).status === 403, 'only administrators open access reviews')
    ok((await qa('PUT', '/admin/access-reviews/settings', { intervalDays: 10 })).status === 400, 'review interval limited to 30–365 days')
    ok((await qa('PUT', '/admin/access-reviews/settings', { intervalDays: 180 })).json.schedule.intervalDays === 180, 'review interval saved')
    ok((await secEvents()).some((e) => e.type === 'settings.updated' && e.detail === 'Access review interval "90 days" -> "180 days"'), 'interval change logged old -> new')

    // start: snapshot of every active account with findings
    await prisma.user.update({ where: { email: VEMAIL }, data: { lastLoginAt: new Date(Date.now() - 200 * 86_400_000) } })
    const active = await prisma.user.count({ where: { active: true } })
    const st = await qa('POST', '/admin/access-reviews', {})
    let rv = st.json.review
    ok(st.status === 201 && rv.code === 'AR-001' && rv.status === 'Open' && rv.total === active && rv.decided === 0, `AR-001 started with ${rv.total} active account(s)`)
    ok((await qa('POST', '/admin/access-reviews', {})).status === 422, 'only one review can be open at a time')
    ok((await call('POST', '/admin/access-reviews', {}, C)).status === 403, 'only administrators start a review')
    const item = (email: string) => rv.items.find((i: any) => i.email === email)
    ok(item(VEMAIL).flags.includes('No sign-in for 90+ days') && item(VEMAIL).memberships.some((m: any) => m.scope === 'AirCo'), 'dormant account flagged; vendor scope captured')
    ok(item(EMAIL['Owner / QA']).flags.includes('Administrator') && item(EMAIL.Consultant).memberships.length === await prisma.membership.count({ where: { user: { email: EMAIL.Consultant } } }), 'administrator rights flagged; project roles captured')
    ok((await qa('GET', '/admin/access-reviews')).json.schedule.open?.code === 'AR-001', 'schedule shows the open review')

    // completion needs every decision
    ok(/still need a decision/.test((await qa('POST', `/admin/access-reviews/${rv.id}/complete`, { conclusion: 'x', password: PASSWORD })).json.error), 'a review cannot be completed with undecided accounts')

    // decisions
    const dec = (email: string, decision: string, note = '') => qa('PUT', `/admin/access-reviews/${rv.id}/items/${item(email).id}`, { decision, note })
    ok((await dec(EMAIL.Contractor, 'Keep with changes')).status === 422, 'keep-with-changes needs a description of the change')
    ok((await dec(EMAIL['Owner / QA'], 'Disable account', 'test')).json.error === 'You cannot disable your own account.', 'the reviewer cannot disable their own account')
    ok((await dec(VEMAIL, 'Disable account')).status === 422, 'disabling needs a reason')
    const dv = await dec(VEMAIL, 'Disable account', 'No longer working on AirCo package')
    ok(dv.status === 200 && dv.json.review.disabled === 1, 'vendor account disabled through the review')
    ok(!(await prisma.user.findUniqueOrThrow({ where: { email: VEMAIL } })).active && (await call('POST', '/auth/login', { email: VEMAIL, password: PASSWORD })).status === 401, 'the disabled account can no longer sign in')
    ok((await prisma.emailMessage.count({ where: { toEmail: VEMAIL, subject: { contains: 'Your account was disabled' } } })) === 1, 'the account holder is e-mailed')
    ok((await dec(VEMAIL, 'Keep')).status === 422, 'a disable decision cannot be silently reversed in the review')
    ok((await dec(EMAIL.Contractor, 'Keep with changes', 'Removed PRJ-018 access under Users')).status === 200, 'keep with changes recorded')
    for (const i of rv.items) if (!['Disable account', 'Keep with changes'].includes(item(i.email).decision ?? '') && i.email !== VEMAIL && i.email !== EMAIL.Contractor) rv = (await dec(i.email, 'Keep')).json.review
    ok(rv.decided === rv.total && rv.items.find((i: any) => i.email === EMAIL['Owner / QA']).selfReview === true, 'all accounts decided; own account marked as self-review')
    const sec = await secEvents()
    ok(sec.some((e) => e.type === 'access.review.decided' && e.detail.includes('(self-review)')) && sec.some((e) => e.type === 'user.deactivated' && e.detail.includes('access review AR-001')), 'decisions and the deactivation are in the security log')

    // completion = electronic signature
    ok(/Password is incorrect/.test((await qa('POST', `/admin/access-reviews/${rv.id}/complete`, { conclusion: 'Access appropriate', password: 'wrong-password-1' })).json.error) && (await qa('GET', `/admin/access-reviews/${rv.id}`)).json.review.status === 'Open', 'wrong password: nothing signed')
    ok((await qa('POST', `/admin/access-reviews/${rv.id}/complete`, { conclusion: ' ', password: PASSWORD })).status === 422, 'a conclusion is required')
    const cp = await qa('POST', `/admin/access-reviews/${rv.id}/complete`, { conclusion: 'All remaining access is appropriate.', password: PASSWORD })
    rv = cp.json.review
    ok(cp.status === 200 && rv.status === 'Completed' && rv.signature === 'Valid' && /^[0-9a-f]{64}$/.test(rv.sigHash) && rv.meaning.startsWith('Access review completed'), 'review completed with a valid electronic signature and meaning')
    ok((await dec(EMAIL.Consultant, 'Keep')).status === 422, 'a completed review cannot change')
    const row = await prisma.accessReviewItem.findFirstOrThrow({ where: { reviewId: rv.id, email: EMAIL.Contractor } })
    await prisma.accessReviewItem.update({ where: { id: row.id }, data: { note: 'edited outside the app' } })
    ok((await qa('GET', `/admin/access-reviews/${rv.id}`)).json.review.signature === 'Altered', 'a decision changed outside the application breaks the signature')
    await prisma.accessReviewItem.update({ where: { id: row.id }, data: { note: row.note } })
    ok((await secEvents()).some((e) => e.type === 'access.review.completed' && e.detail.includes('1 disabled')), 'completion in the security log with the outcome')

    // report
    const pr = await fetch(`${base}/admin/access-reviews/${rv.id}/report.pdf`, { headers: { authorization: `Bearer ${QA}` } })
    const buf = Buffer.from(await pr.arrayBuffer())
    if (process.env.REPORT_OUT) (await import('node:fs')).writeFileSync(`${process.env.REPORT_OUT}/access-review.pdf`, buf)
    ok(pr.status === 200 && buf.subarray(0, 5).toString() === '%PDF-' && pr.headers.get('x-content-sha256') === createHash('sha256').update(buf).digest('hex'), 'access review PDF with SHA-256 header')
    ok((await secEvents()).some((e) => e.type === 'report.generated' && e.detail.includes(pr.headers.get('x-content-sha256')!)), 'report generation logged with its SHA-256')
    ok((await call('GET', `/admin/access-reviews/${rv.id}/report.pdf`, undefined, C)).status === 403, 'only administrators download the report')

    // schedule after completion, reminder when due again
    ov = (await qa('GET', '/admin/access-reviews')).json
    ok(ov.schedule.lastCompleted?.code === 'AR-001' && ov.schedule.due === false && ov.reviews[0].status === 'Completed', 'next review not due until the interval has passed')
    await prisma.accessReview.update({ where: { id: rv.id }, data: { completedAt: new Date(Date.now() - 200 * 86_400_000) } })
    ok((await qa('GET', '/admin/access-reviews')).json.schedule.due === true, 'review due again after the interval')
    await prisma.emailMessage.deleteMany()
    await runReminders({ trigger: 'Manual', startedBy: 'API test' })
    const due = await prisma.emailMessage.findMany({ where: { subject: { contains: 'User-access review due' } } })
    ok(due.some((m) => m.toEmail === EMAIL['Owner / QA']) && !due.some((m) => m.toEmail === EMAIL.Consultant), 'the daily run reminds administrators (only) that a review is due')

    // cancel
    const r2 = (await qa('POST', '/admin/access-reviews', {})).json.review
    ok(r2.code === 'AR-002' && !r2.items.some((i: any) => i.email === VEMAIL), 'AR-002 lists only active accounts')
    ok((await qa('POST', `/admin/access-reviews/${r2.id}/cancel`, { reason: '' })).status === 422, 'cancelling needs a reason')
    ok((await qa('POST', `/admin/access-reviews/${r2.id}/cancel`, { reason: 'Started by mistake' })).json.review.status === 'Cancelled', 'review cancelled with a reason')

    // restore
    const v = await prisma.user.findUniqueOrThrow({ where: { email: VEMAIL } })
    await qa('PATCH', `/admin/users/${v.id}`, { active: true })
    await qa('PUT', '/admin/access-reviews/settings', { intervalDays: 90 })
  }
  // ======================================================== phase 2 / step 6: installation check and validation catalogue (C7)
  section('OQ-API-30')
  {
    const C = tokens.Consultant
    // catalogue: every requirement traced, every test case verifies something, risk method as specified
    ok(catalogueProblems().length === 0, `validation catalogue consistent${catalogueProblems().length ? ': ' + catalogueProblems().join('; ') : ''}`)
    ok(URS.every((u) => u.tests.length || u.procedural) && OQ_CASES.filter((c) => c.suite === 'api').length === 37, `${URS.length} requirements, ${OQ_CASES.length} OQ test cases`)
    ok(riskPriority('High', 'High', 'Low') === 'High' && riskPriority('High', 'Medium', 'Medium') === 'High' && riskPriority('Medium', 'Medium', 'High') === 'Low' && riskPriority('Low', 'Low', 'Low') === 'Medium', 'GAMP 5 risk priority: class from severity x probability, priority from class x detectability')
    const t = traceability(null)
    ok(t.every((u) => u.verdict === 'Not executed' || u.verdict === 'Procedural') && t.length === URS.length, 'traceability without results: Not executed / Procedural, never Pass')
    const src = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8')
    ok(OQ_CASES.filter((c) => c.suite === 'api').every((c) => src.includes(`section('${c.id}')`)), 'every API test case has its section in this suite')

    // installation check
    ok((await call('POST', '/admin/validation/iq', {}, C)).status === 403, 'only administrators run the installation check')
    const r = await call('POST', '/admin/validation/iq', {}, QA)
    const iq = r.json.iq
    const chk = (id: string) => iq.checks.find((c: any) => c.id === id)
    ok(r.status === 200 && iq.checks.length >= 15 && /^[0-9a-f]{64}$/.test(iq.fingerprint), `installation check executed: ${iq.checks.length} checks, overall ${iq.overall}`)
    ok(chk('IQ-05').status === 'Pass' && /applied/.test(chk('IQ-05').actual), 'all database migrations applied')
    ok(chk('IQ-04').status === 'Pass' && chk('IQ-11').status === 'Pass' && chk('IQ-12').status === 'Pass' && chk('IQ-06').status === 'Pass', 'database, file storage, administrator and dependencies pass')
    ok(chk('IQ-13').status === 'Warning' && chk('IQ-14').status === 'Warning', 'test accounts and missing SMTP are warnings outside production')
    ok(iq.overall === 'Pass', 'installation check passes in the test environment')
    const again = await runIq('API test')
    ok(again.fingerprint === iq.fingerprint, 'code fingerprint is stable')
    const v = (await call('GET', '/admin/validation', undefined, QA)).json
    ok(v.iq?.executedAt === iq.executedAt && v.version === iq.version && v.catalogue.urs === URS.length && Array.isArray(v.packs), 'latest installation check, version and validation packs listed')
    ok((await call('GET', '/admin/validation', undefined, C)).status === 403, 'only administrators see system & validation')
    const pr = await fetch(`${base}/admin/validation/iq.pdf`, { headers: { authorization: `Bearer ${QA}` } })
    const buf = Buffer.from(await pr.arrayBuffer())
    if (process.env.REPORT_OUT) (await import('node:fs')).writeFileSync(`${process.env.REPORT_OUT}/iq.pdf`, buf)
    ok(pr.status === 200 && buf.subarray(0, 5).toString() === '%PDF-' && pr.headers.get('x-content-sha256') === createHash('sha256').update(buf).digest('hex'), 'IQ record PDF with SHA-256 header')
    const sec = (await call('GET', '/admin/security-events?limit=10', undefined, QA)).json.events
    ok(sec.some((e: any) => e.type === 'iq.executed' && e.detail.includes(iq.fingerprint)) && sec.some((e: any) => e.type === 'report.generated' && e.detail.startsWith('Installation qualification record')), 'installation check and its PDF in the security log')
    ok((await call('GET', '/admin/validation/packs/..%2F..%2Fpackage.json', undefined, QA)).status === 404 && (await call('GET', '/admin/validation/packs/missing.pdf', undefined, QA)).status === 404, 'pack download refuses unknown names and path tricks')
  }
  // ======================================================== phase 3 / step 3: backups and tested restore (P3)
  section('OQ-API-31')
  {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const pg = (await import('pg')).default
    const BK = await import('../src/services/backups.ts')
    const C = tokens.Consultant
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qbk-'))
    const savedDir = config.BACKUP_DIR
    Object.assign(config, { BACKUP_DIR: path.join(tmp, 'sets') })
    const ov = async () => (await call('GET', '/admin/backups', undefined, QA)).json
    /**
     * Waits for a backup *and* its test restore. A run stops being "busy" before the restore starts, and the
     * restore has no status at all until it does, so going idle is not the signal: wait for busy to clear, give
     * the verification a moment to appear, then wait for it to leave 'Running'. Without this, a slower or larger
     * database makes the next check read `null` or `'Running'` instead of `'Verified'`.
     */
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const waitIdle = async () => {
      for (let i = 0; i < 240 && (await ov()).busy; i++) await pause(250)
      for (let i = 0; i < 20 && (await ov()).runs[0]?.verifyStatus == null; i++) await pause(250)
      for (let i = 0; i < 240 && (await ov()).runs[0]?.verifyStatus === 'Running'; i++) await pause(250)
    }
    const sets = () => fs.existsSync(BK.backupDir()) ? fs.readdirSync(BK.backupDir()).sort() : []

    let o = await ov()
    ok((await call('GET', '/admin/backups', undefined, C)).status === 403, 'only administrators manage backups')
    ok(o.tools.ok && /pg_dump/.test(o.tools.pgDump) && o.settings.enabled === false && o.settings.keep === 14, `backup tools usable (${o.tools.pgDump}); fixtures keep the schedule off`)
    ok((await call('PUT', '/admin/backups/settings', { enabled: true, time: '2:00', keep: 14, verify: true }, QA)).status === 400 && (await call('PUT', '/admin/backups/settings', { enabled: true, time: '02:00', keep: 1, verify: true }, QA)).status === 400, 'schedule validated (HH:MM, keep 3–90)')
    ok((await call('PUT', '/admin/backups/settings', { enabled: false, time: '02:30', keep: 14, verify: true }, QA)).json.settings.time === '02:30', 'schedule saved')

    // back up now (background) -> done and verified by a test restore
    ok((await call('POST', '/admin/backups', {}, QA)).status === 202, 'backup started')
    await waitIdle()
    o = await ov()
    const b1 = o.runs[0]
    ok(b1?.status === 'Done' && b1.verifyStatus === 'Verified' && b1.files > 0 && b1.sizeBytes > 0 && /^[0-9a-f]{64}$/.test(b1.manifestSha), `backup ${b1?.name} done: ${b1?.files} file(s), test restore ${b1?.verifyStatus}`)
    const dir1 = path.join(BK.backupDir(), b1.name)
    const m1 = JSON.parse(fs.readFileSync(path.join(dir1, 'manifest.json'), 'utf8'))
    ok(m1.counts.User === await prisma.user.count() && m1.counts.StoredFile === await prisma.storedFile.count() && m1.migrations.length === fs.readdirSync('prisma/migrations').filter((d) => d.startsWith('2')).length, 'manifest: record counts and migration history of the snapshot')
    ok(/Test restore into a temporary database/.test(b1.verifyDetail) && !(await (async () => { const c = new pg.Client({ connectionString: BK.libpqUrl(config.DATABASE_URL, 'postgres') }); await c.connect(); const n = (await c.query("SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'qualigrafo_verify_%'")).rows[0].n; await c.end(); return n })()), 'test restore detail recorded; temporary database removed')
    const sec = (await call('GET', '/admin/security-events?limit=10', undefined, QA)).json.events
    ok(sec.some((e: any) => e.type === 'backup.created' && e.detail.includes(b1.manifestSha)) && sec.some((e: any) => e.type === 'backup.verified' && e.detail.includes('Verified')), 'backup and test restore in the security log')

    // second backup hard-links unchanged files
    const b2 = await BK.createBackup({ trigger: 'Manual', startedBy: 'API test' })
    const f2 = (fs.readdirSync(path.join(BK.backupDir(), b2!.name, 'files'), { recursive: true }) as string[]).map((f) => path.join(BK.backupDir(), b2!.name, 'files', f)).find((f) => fs.statSync(f).isFile())!
    ok(fs.statSync(f2).nlink >= 2, 'unchanged files are hard-linked to the previous set (no second copy)')

    // tamper detection
    const orig = fs.readFileSync(f2)
    fs.unlinkSync(f2); fs.writeFileSync(f2, Buffer.concat([orig, Buffer.from('x')]))
    let v = await BK.verifyBackup(b2!.id, 'API test')
    ok(v.verifyStatus === 'Failed' && /damaged/.test(v.verifyDetail ?? ''), 'a changed file fails the verification')
    ok((await prisma.emailMessage.count({ where: { subject: { contains: 'test restore FAILED' } } })) > 0, 'administrators are e-mailed about a failed test restore')
    fs.writeFileSync(f2, orig)
    const mf = path.join(BK.backupDir(), b2!.name, 'manifest.json')
    const mtext = fs.readFileSync(mf, 'utf8')
    fs.writeFileSync(mf, mtext.replace('"format": 1', '"format": 1 '))
    v = await BK.verifyBackup(b2!.id, 'API test')
    ok(v.verifyStatus === 'Failed' && /manifest/.test(v.verifyDetail ?? ''), 'a changed manifest fails the verification')
    fs.writeFileSync(mf, mtext)
    ok((await BK.verifyBackup(b2!.id, 'API test')).verifyStatus === 'Verified', 'the repaired set verifies again')

    // disaster recovery: restore into another database and storage folder
    const target = BK.libpqUrl(config.DATABASE_URL, 'qualigrafo_restore_test')
    const store = path.join(tmp, 'restored-storage')
    const rr = await BK.restoreBackup({ dir: dir1, databaseUrl: target, storageDir: store })
    const restoredFiles = (fs.readdirSync(path.join(store, 'objects'), { recursive: true }) as string[]).filter((f) => /[0-9a-f]{64}$/.test(f)).length
    ok(rr.counts.Document === m1.counts.Document && rr.counts.AuditEvent === m1.counts.AuditEvent && restoredFiles === m1.files.count, `restore into an empty database: ${rr.counts.Document} documents, ${rr.counts.AuditEvent} audit entries, ${restoredFiles} files`)
    const rr2 = await BK.restoreBackup({ dir: dir1, databaseUrl: target, storageDir: store })
    ok(rr2.counts.User === m1.counts.User && rr2.filesCopied === 0, 'restoring again over existing data replaces it (files already present are kept)')
    { const c = new pg.Client({ connectionString: BK.libpqUrl(config.DATABASE_URL, 'postgres') }); await c.connect(); await c.query('DROP DATABASE IF EXISTS qualigrafo_restore_test WITH (FORCE)'); await c.end() }

    // retention keeps the newest sets, never the last verified one
    await call('PUT', '/admin/backups/settings', { enabled: false, time: '02:30', keep: 3, verify: false }, QA)
    await BK.createBackup({ trigger: 'Manual', startedBy: 'API test' })
    await BK.createBackup({ trigger: 'Manual', startedBy: 'API test' })
    const kept = sets()
    ok(kept.length === 3 && !kept.includes(b1.name) && kept.includes(b2!.name), `retention keeps the newest 3 sets incl. the newest verified one (${kept.length} kept)`)
    ok((await prisma.backupRun.count({ where: { status: 'Deleted' } })) >= 1 && !fs.existsSync(path.join(BK.backupDir(), (await prisma.backupRun.findFirstOrThrow({ where: { status: 'Deleted' } })).name)), 'older sets are deleted from disk and marked Deleted')

    // schedule: once per day
    await call('PUT', '/admin/backups/settings', { enabled: true, time: '00:00', keep: 14, verify: true }, QA)
    const s1 = await BK.maybeRunDailyBackup()
    ok(!!s1 && s1.trigger === 'Scheduled' && (await prisma.backupRun.findUniqueOrThrow({ where: { id: s1.id } })).verifyStatus === 'Verified', 'scheduled backup runs and is verified')
    ok((await BK.maybeRunDailyBackup()) === null, 'the scheduled backup runs once per day')

    // installation check
    const iq = (await call('POST', '/admin/validation/iq', {}, QA)).json.iq
    ok(iq.checks.find((c: any) => c.id === 'IQ-17')?.status === 'Pass' && iq.checks.find((c: any) => c.id === 'IQ-18')?.status === 'Pass', 'installation check: backup tools and a verified backup less than 48 h old')

    await call('PUT', '/admin/backups/settings', { enabled: false, time: '02:00', keep: 14, verify: true }, QA)
    Object.assign(config, { BACKUP_DIR: savedDir })
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  // ======================================================== phase 3 / step 4: portfolio summaries at scale (P1)
  section('OQ-API-32')
  {
    const { loadProject } = await import('../src/services/loadProject.ts')
    const { projectSummary } = await import('../src/domain/work.ts')
    const VND = (await call('POST', '/auth/login', { email: 'vendor@qualigrafo.test', password: PASSWORD })).json.token as string
    const who: [string, string, string][] = [['Consultant', EMAIL.Consultant, tokens.Consultant], ['Contractor', EMAIL.Contractor, tokens.Contractor], ['Owner / QA', EMAIL['Owner / QA'], QA], ['Vendor (AirCo)', 'vendor@qualigrafo.test', VND]]
    for (const [label, email, token] of who) {
      const got = (await call('GET', '/projects', undefined, token)).json.projects as any[]
      const u = await prisma.user.findUniqueOrThrow({ where: { email } })
      const ms = await prisma.membership.findMany({ where: { userId: u.id }, include: { project: true }, orderBy: { project: { code: 'asc' } } })
      const expected = await Promise.all(ms.map(async (m) => {
        const full = await loadProject(m.projectId, u.id, m.companyScope, m.role)
        return JSON.parse(JSON.stringify(projectSummary(full, m.role as Role, m.companyScope, full.audit)))
      }))
      const diff = got.map((g, i) => JSON.stringify(g) === JSON.stringify(expected[i]) ? null : g.profile.id).filter(Boolean)
      ok(got.length === ms.length && !diff.length, `${label}: ${got.length} portfolio summaries equal the full project computation${diff.length ? ` (differs: ${diff.join(', ')})` : ''}`)
    }
    const all = (await call('GET', '/projects', undefined, QA)).json.projects as any[]
    const p26 = all.find((p) => p.profile.id === 'PRJ-026')
    ok(['role', 'scope', 'profile', 'markets', 'baseline', 'stats', 'work', 'updates', 'deadlines', 'recent'].every((k) => k in p26) && !('docs' in p26) && !('audit' in p26) && !('events' in p26), 'summaries carry no full project data (no documents, audit trail or notifications)')
    ok(p26.recent.length === 4 && p26.deadlines.length <= 7 && p26.stats.gates.length === 10 && p26.work.every((w: any) => w.project === 'PRJ-026'), 'summary: 4 latest audit entries, up to 7 deadlines, 10 gates, work items of this project')
    const vend = (await call('GET', '/projects', undefined, VND)).json.projects.find((p: any) => p.profile.id === 'PRJ-026')
    const docs = (await call('GET', '/projects/PRJ-026', undefined, QA)).json.project.docs as any[]
    ok(vend.scope === 'AirCo' && vend.deadlines.every((d: any) => docs.find((x) => x.id === d.id)?.owner === 'AirCo') && vend.work.every((w: any) => w.detail.includes('AirCo')), "vendor summary contains only the company's documents")
    ok(vend.stats.required === 0 && vend.updates.length === 0, 'vendor summary has no requirements or regulatory updates')
  }

  section('OQ-API-33')
  {
    // The API rate limit is 600 requests per window outside NODE_ENV=test, and the suite is now long enough to
    // reach it before this block starts; every later block resets it for the same reason.
    resetApiRate()
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const MON = await import('../src/services/monitoring.ts')
    const LOG = await import('../src/lib/logger.ts')
    const { errorHandler } = await import('../src/middleware/errors.ts')
    const C = tokens.Consultant
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qmon-'))
    const logs = path.join(tmp, 'logs')
    Object.assign(config, { LOG_DIR: logs, LOG_LEVEL: 'info', METRICS_TOKEN: 'oq-metrics-token' })
    MON.resetRequestStats()
    MON.resetAlertThrottle()

    // 1. structured request log, traceable by request id
    const resp = await fetch(`${base}/reference/markets`)
    const rid = resp.headers.get('x-request-id') ?? ''
    await wait(50)
    const reqLine = LOG.tailLog(50).find((l) => l.includes('request') && l.includes(rid))
    ok(/^[0-9a-f-]{36}$/.test(rid) && !!reqLine && /status=200/.test(reqLine!) && /ms=\d+/.test(reqLine!) && /path=.*reference\/markets/.test(reqLine!), 'every request is logged with its request id, path, status and duration')
    const target = LOG.logTarget()
    ok(target.writable && target.file === path.join(logs, `qualigrafo-${new Date().toISOString().slice(0, 10)}.log`) && target.keepDays === config.LOG_KEEP_DAYS, `log file ${path.basename(target.file!)} writable, kept ${target.keepDays} days`)

    // 2. JSON lines for a log collector; no credentials in the log
    Object.assign(config, { LOG_FORMAT: 'json' })
    await call('POST', '/auth/login', { email: EMAIL.Consultant, password: PASSWORD })
    await wait(50)
    const jsonLine = LOG.tailLog(10).reverse().find((l) => l.startsWith('{') && l.includes('"event":"request"'))
    const parsed = jsonLine ? JSON.parse(jsonLine) : {}
    ok(parsed.event === 'request' && parsed.level === 'info' && /^\d{4}-/.test(parsed.ts) && parsed.path === '/api/auth/login' && !jsonLine!.includes(PASSWORD) && !/password|token|authorization/i.test(jsonLine!), 'JSON log line per request; passwords, tokens and bodies are never logged')
    Object.assign(config, { LOG_FORMAT: 'auto' })

    // 3. daily file with retention
    const oldFile = path.join(logs, 'qualigrafo-2020-01-01.log')
    fs.writeFileSync(oldFile, 'old\n')
    LOG.rotate()
    ok(!fs.existsSync(oldFile) && fs.existsSync(target.file!), 'log files older than LOG_KEEP_DAYS are deleted at the daily rotation')

    // 4. request figures
    const before = MON.requestStats().total
    for (let i = 0; i < 5; i++) await call('GET', '/reference/config')
    const st = MON.requestStats()
    ok(st.total >= before + 5 && st.byClass['2xx'] > 0 && st.p95ms >= 0 && !!st.slowest, `request figures: ${st.total} requests, p95 ${st.p95ms} ms`)

    // 5. errors are grouped, not repeated
    await prisma.errorEvent.deleteMany({})
    await MON.captureError({ kind: 'Job', place: 'oq-test', error: new Error('Widget 17 could not be read') })
    const g2 = await MON.captureError({ kind: 'Job', place: 'oq-test', error: new Error('Widget 4711 could not be read') })
    const other = await MON.captureError({ kind: 'Job', place: 'oq-other', error: new Error('Widget 17 could not be read') })
    ok(g2?.count === 2 && !g2.isNew && other?.count === 1 && other.fingerprint !== g2.fingerprint, 'the same error from the same place is counted in one group; another place is its own group')

    // 6. a request that fails with 500 is recorded with its request id and user
    let status = 0
    let payload: any = null
    const req: any = { method: 'POST', path: '/api/projects/PRJ-026/docs', requestId: 'oq-33-request', user: { email: EMAIL['Owner / QA'] } }
    const res: any = { status(c: number) { status = c; return this }, json(b: unknown) { payload = b; return this } }
    errorHandler(new Error('Simulated unexpected failure'), req, res, () => undefined)
    await wait(300)
    const reqGroup = await prisma.errorEvent.findFirst({ where: { message: 'Simulated unexpected failure' } })
    ok(status === 500 && payload?.error === 'Internal server error.' && payload?.requestId === 'oq-33-request' && reqGroup?.kind === 'Request' && reqGroup.place === 'POST /api/projects/PRJ-026/docs' && reqGroup.lastRequestId === 'oq-33-request' && reqGroup.lastUser === EMAIL['Owner / QA'], 'a 500 answers with its request id and is recorded as an error group with route and user')

    // 7. the monitoring page: health, jobs, error groups, log tail
    ok((await call('GET', '/admin/monitoring', undefined, C)).status === 403 && (await call('GET', '/admin/monitoring/log', undefined, C)).status === 403, 'only administrators see monitoring')
    const overview = (await call('GET', '/admin/monitoring', undefined, QA)).json
    ok(overview.health.version === (await import('../src/services/iq.ts')).APP_VERSION && overview.health.db.ok && overview.health.db.latencyMs > 0 && overview.health.log.level === 'info' && overview.health.metrics.enabled && overview.jobs.length === 4, `health: version ${overview.health.version}, database ${overview.health.db.latencyMs} ms, 4 background jobs, log level ${overview.health.log.level}`)
    ok(overview.errors.length === 3 && overview.errors.some((e: any) => e.place === 'oq-test' && e.count === 2 && e.status === 'New' && e.kind === 'Job'), 'monitoring lists the error groups with their count and state')
    ok((await call('GET', '/admin/monitoring/log?lines=20', undefined, QA)).json.lines.length > 0, 'administrators can read the tail of the server log')

    // 8. alert settings
    ok((await call('PUT', '/admin/monitoring/settings', { alerts: true, onNewError: true, errorBurst: 25, staleJobMin: 1, diskMinFreePct: 10 }, QA)).status === 400, 'alert settings validated (stale-job time 5-1440 minutes)')
    ok((await call('PUT', '/admin/monitoring/settings', { alerts: true, onNewError: true, errorBurst: 25, staleJobMin: 30, diskMinFreePct: 5 }, QA)).json.settings.staleJobMin === 30, 'alert settings saved')
    const secs = async () => (await call('GET', '/admin/security-events?limit=20', undefined, QA)).json.events as any[]
    ok((await secs()).some((e) => e.type === 'settings.updated' && /Monitoring:/.test(e.detail) && /stale-job time \(minutes\) "90" -> "30"/.test(e.detail)), 'changed alert settings are in the security log with old -> new values')

    // 9. an error group is acknowledged and resolved; a resolved error that happens again is reopened
    const grp = (await call('GET', '/admin/monitoring', undefined, QA)).json.errors.find((e: any) => e.place === 'oq-test')
    ok((await call('POST', `/admin/monitoring/errors/${grp.id}`, { status: 'Resolved' }, QA)).status === 422, 'acknowledging or resolving an error needs a note')
    const resolved = (await call('POST', `/admin/monitoring/errors/${grp.id}`, { status: 'Resolved', note: 'Fixed in 0.1.1' }, QA)).json.error
    ok(resolved.status === 'Resolved' && !!resolved.handledBy && resolved.note === 'Fixed in 0.1.1' && (await secs()).some((e) => e.type === 'monitor.handled' && e.detail.includes('Resolved')), 'an error group is resolved with a note, recorded in the security log')
    const again = await MON.captureError({ kind: 'Job', place: 'oq-test', error: new Error('Widget 99 could not be read') })
    const reopened = await prisma.errorEvent.findUnique({ where: { id: grp.id } })
    ok(again?.isNew === true && reopened?.status === 'New' && reopened.count === 3 && reopened.handledBy === null, 'an error that happens again after it was resolved is reopened')
    ok((await prisma.emailMessage.count({ where: { subject: { contains: 'Error happened again' } } })) > 0, 'administrators are e-mailed about a new or returning error')

    // 10. background-job health, stale-job alert, throttling
    await MON.heartbeat('mailer', { ok: true, detail: 'oq test' })
    const mailerJob = async () => (await MON.jobHealth()).find((j) => j.name === 'mailer')!
    ok((await mailerJob()).status === 'Running' && (await mailerJob()).detail === 'oq test', 'a background job that ran is shown as running')
    await prisma.jobHeartbeat.update({ where: { name: 'mailer' }, data: { lastRunAt: new Date(Date.now() - 120 * 60_000) } })
    const stale = await mailerJob()
    ok(stale.status === 'Stale' && stale.ageMin! >= 120, `a job that stopped running is shown as stale (${stale.ageMin} minutes)`)
    MON.resetAlertThrottle()
    await MON.watchdog()
    ok((await prisma.emailMessage.count({ where: { subject: { contains: 'is stale' } } })) > 0 && (await secs()).some((e) => e.type === 'monitor.alert'), 'the watchdog e-mails the administrators about a stale background job and logs the alert')
    ok((await MON.alert('oq-throttle', 'Throttle check', ['once per hour'])) === true && (await MON.alert('oq-throttle', 'Throttle check', ['once per hour'])) === false && (await MON.alert('oq-throttle', 'Throttle check', ['forced'], true)) === true, 'the same alert is sent at most once per hour; a test alert is forced')

    // 11. a gap in the API heartbeat is an outage
    await prisma.outage.deleteMany({})
    await prisma.jobHeartbeat.upsert({ where: { name: 'api' }, update: { lastRunAt: new Date(Date.now() - 30 * 60_000) }, create: { name: 'api', lastRunAt: new Date(Date.now() - 30 * 60_000) } })
    MON.resetAlertThrottle()
    const w = await MON.watchdog()
    const outage = await prisma.outage.findFirst()
    ok(w.outage?.minutes === 30 && outage?.minutes === 30 && (await prisma.emailMessage.count({ where: { subject: { contains: 'was not running' } } })) > 0, 'a 30-minute gap in the API heartbeat is recorded as an outage and alerted')
    ok((await call('GET', '/admin/monitoring', undefined, QA)).json.outages[0]?.minutes === 30, 'outages are listed on the monitoring page')
    ok((await call('POST', '/admin/monitoring/test-alert', {}, QA)).json.sent === true, 'the test alert reaches the administrators')

    // 12. metrics endpoint for an external uptime tool
    const metrics = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer oq-metrics-token' } })
    const text = await metrics.text()
    ok(metrics.status === 200 && /qualigrafo_up 1/.test(text) && /qualigrafo_requests_total\{class="2xx"\}/.test(text) && /qualigrafo_job_age_seconds\{job="mailer"\}/.test(text) && /qualigrafo_errors_open \d+/.test(text), 'GET /api/metrics returns up, request, error and job figures')
    ok((await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer wrong' } })).status === 401 && (await fetch(`${base}/metrics?token=oq-metrics-token`)).status === 200, 'the metrics endpoint needs its token')
    Object.assign(config, { METRICS_TOKEN: '' })
    ok((await fetch(`${base}/metrics`)).status === 404, 'without METRICS_TOKEN the metrics endpoint does not exist')

    // 13. the installation check covers monitoring (the stale job above runs again first)
    await prisma.jobHeartbeat.update({ where: { name: 'mailer' }, data: { lastRunAt: new Date(), lastOkAt: new Date() } })
    const monIq = await runIq('API test')
    const chk = (id: string) => monIq.checks.find((c) => c.id === id)!
    ok(chk('IQ-19').status === 'Pass' && chk('IQ-20').status === 'Pass' && ['Pass', 'Warning'].includes(chk('IQ-21').status) && !!chk('IQ-22'), `installation check: logging ${chk('IQ-19').status}, alerts ${chk('IQ-20').status}, jobs ${chk('IQ-21').status}, free space ${chk('IQ-22').status}`)
    Object.assign(config, { LOG_DIR: '' })
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  section('OQ-API-34')
  {
    resetApiRate()
    const C = tokens.Consultant
    const me = (await call('GET', '/auth/me', undefined, C)).json
    ok(me.user.email === EMAIL.Consultant && Array.isArray(me.memberships) && me.memberships.length > 0, `own account read back with ${me.memberships.length} project role(s)`)
    ok(typeof me.account?.createdAt === 'string' && me.account.idleMinutes === config.IDLE_TIMEOUT_MIN && me.account.sessionMaxHours >= 1, `account facts: created ${me.account?.createdAt?.slice(0, 10)}, lock after ${me.account?.idleMinutes} min, session ${me.account?.sessionMaxHours} h`)
    ok(me.memberships.every((m: any) => m.project && m.role && 'scope' in m), 'each membership states the project, the role and the record access')
    const vendorToken = (await call('POST', '/auth/login', { email: 'vendor@qualigrafo.test', password: PASSWORD })).json.token as string
    const vendorMe = (await call('GET', '/auth/me', undefined, vendorToken)).json
    ok(vendorMe.memberships.every((m: any) => m.scope === 'AirCo'), 'a vendor account sees its company scope on every project role')

    // own activity: this account's security events and the audit entries it wrote, nothing else
    const act34 = (await call('GET', '/auth/activity?limit=25', undefined, C)).json.items as any[]
    ok(act34.length > 0 && act34.every((a) => ['Account', 'Project'].includes(a.kind)), `${act34.length} recent entries of my own (account + project work)`)
    ok(act34.some((a) => a.kind === 'Account' && a.what === 'login.success'), 'my sign-ins are listed')
    const mine = act34.filter((a) => a.kind === 'Project')
    const trail = (await call('GET', `${P}/audit?limit=500`, undefined, C)).json.events as any[]
    ok(mine.every((a) => trail.some((e: any) => e.text === a.detail)), 'project entries in my activity come from the project audit trail')
    const consultantName = (await call('GET', '/auth/me', undefined, C)).json.user.name as string
    ok(mine.every((a) => trail.some((e: any) => e.text === a.detail && e.user === consultantName)), 'my activity shows only the records I changed, not another role\'s')
    ok((await call('GET', '/auth/activity')).status === 401, 'activity needs a session')

    // sign out of all devices: every token issued so far is refused afterwards
    loginLimiter.reset()
    const extra = (await call('POST', '/auth/login', { email: EMAIL.Consultant, password: PASSWORD })).json.token as string
    ok((await call('GET', '/auth/me', undefined, extra)).status === 200, 'a second session of the same account works')
    ok((await call('POST', '/auth/sign-out-everywhere', {}, extra)).json.ok === true, 'the account holder signs out of all devices')
    const afterExtra = (await call('GET', '/auth/me', undefined, extra)).status
    const afterC = (await call('GET', '/auth/me', undefined, C)).status
    ok(afterExtra === 401 && afterC === 401, `every token of that account is refused, including the one that asked (extra ${afterExtra}, first session ${afterC})`)
    const sec34 = (await call('GET', '/admin/security-events?limit=10', undefined, QA)).json.events as any[]
    ok(sec34.some((e) => e.type === 'sessions.revoked' && e.email === EMAIL.Consultant), 'signing out of all devices is in the security log')
    ok((await prisma.emailMessage.count({ where: { subject: { contains: 'Signed out of all devices' } } })) > 0, 'the account holder is e-mailed about it')
    loginLimiter.reset()
    tokens.Consultant = (await call('POST', '/auth/login', { email: EMAIL.Consultant, password: PASSWORD })).json.token
  }

  // An administrator sees that every project exists, including the ones they are not a member of, while the portfolio
  // itself stays membership-driven. Proven with a project whose team is the Owner / QA alone, read by a second
  // administrator who is not on it (the consultant, promoted for the length of this check and demoted again).
  // Placed last on purpose: granting and withdrawing administrator rights writes security events and queues e-mails,
  // which would otherwise disturb the job-health figures asserted in OQ-API-33.
  {
    ok((await call('GET', '/admin/projects', undefined, tokens.Consultant)).status === 403, 'a non-administrator cannot list every project')
    const solo = await call('POST', '/projects', { ...spec, name: 'Administrator Visibility Plant', code: 'ADM-001', companies: [], members: [spec.members[0]] }, QA)
    ok(solo.status === 201, 'a project can be created with the Owner / QA as its only member')
    const all = (await call('GET', '/admin/projects', undefined, QA)).json.projects
    ok(all.every((p: any) => typeof p.members === 'number' && 'myRole' in p && typeof p.status === 'string'), 'each row carries the team size, the role the reader holds and the status')
    ok(all.find((p: any) => p.code === 'ADM-001').members === 1, 'the team size is reported')

    const cons = (await call('GET', '/admin/users', undefined, QA)).json.users.find((u: any) => u.email === 'consultant@qualigrafo.test')
    ok((await call('PATCH', `/admin/users/${cons.id}`, { isAdmin: true }, QA)).status === 200, 'an administrator can grant administrator rights')
    const seen = (await call('GET', '/admin/projects', undefined, tokens.Consultant)).json.projects
    const theirs = new Set((await call('GET', '/projects', undefined, tokens.Consultant)).json.projects.map((p: any) => p.profile.id))
    ok(seen.length === all.length, 'a second administrator sees every project on the installation, not only their own')
    ok(!theirs.has('ADM-001'), 'the project they are not on stays out of their membership-driven portfolio')
    ok(seen.find((p: any) => p.code === 'ADM-001')?.myRole === null, 'but it is listed for them, with no role of their own')
    ok(seen.filter((p: any) => theirs.has(p.code)).every((p: any) => p.myRole !== null), 'and the projects they are on carry their role')
    ok((await call('GET', '/projects/ADM-001', undefined, tokens.Consultant)).status === 403, 'listing a project is not access to it: opening it is still refused')
    ok((await call('PATCH', `/admin/users/${cons.id}`, { isAdmin: false }, QA)).status === 200, 'administrator rights can be withdrawn again')
    ok((await call('GET', '/admin/projects', undefined, tokens.Consultant)).status === 403, 'after the withdrawal the list is refused again')
  }

  // ---------------------------------------------------------------- project classification (Phase 5 / step 1)
  section('OQ-API-35')
  {
    resetApiRate()
    const ref = (await call('GET', '/reference/industries', undefined, QA)).json
    ok(ref.groups.length === 4 && ref.groups.map((g: any) => g.key).join(' | ') === 'Energy & High-Tech | Hospital / Healthcare | Pharma | Common buildings', 'the four industry groups are served from the server')
    ok(ref.groups.every((g: any) => g.facilities.at(-1) === 'Other / custom facility'), 'every group ends with "Other / custom facility"')
    const pharma = ref.groups.find((g: any) => g.key === 'Pharma').facilities
    ok(['API', 'Non-sterile formulation', 'Sterile products', 'Biologics', 'Warehouse'].every((f) => pharma.includes(f)), 'the pharma facility types the product shipped with are still offered')
    ok(ref.serviceTypes.join() === 'Design only,BIM only,Design + BIM' && ref.stages.includes('GFC / IFC'), 'service types and project stages are served too')
    ok((await call('GET', '/reference/industries')).status === 200, 'the lists are reference data, served without a session like the market list')

    const base = {
      client: 'Noor Healthcare Trust', site: 'Pune, India', projectCountry: 'IN', markets: [],
      industryGroup: 'Hospital / Healthcare', facilityType: 'Multi-speciality hospital', serviceType: 'Design + BIM',
      scope: 'New plant', projectStage: 'Detailed design', ownerStandards: '',
      bimRequirement: { lod: 'LOD 400', coordination: true, assetHandover: 'COBie + as-built' },
      disciplines: ['HVAC', 'Electrical'], companies: [],
      members: [{ userId: ids['Owner / QA'], role: 'Owner / QA' }],
    }
    const mk = (patch: Record<string, unknown>) => call('POST', '/projects', { ...base, ...patch }, QA)

    ok((await mk({ name: 'Bad Industry Plant', industryGroup: 'Shipbuilding' })).status === 400, 'an unknown industry group is rejected by the schema')
    ok((await mk({ name: 'No Service Plant', serviceType: '' })).status === 400, 'the service type is mandatory')
    ok((await mk({ name: 'Wrong Facility Plant', facilityType: 'API' })).json.error?.includes('is not a facility type of Hospital / Healthcare') === true, 'a facility type has to belong to the chosen industry group')
    ok((await mk({ name: 'Unnamed Custom Plant', facilityType: 'Other / custom facility' })).json.error?.includes('Name the custom facility type') === true, 'the custom facility entry requires a name')
    ok((await mk({ name: 'Repeated Subtype Plant', secondaryFacilityType: 'Multi-speciality hospital' })).json.error?.includes('has to differ') === true, 'the secondary sub-type cannot repeat the primary one')
    ok((await mk({ name: 'Custom Secondary Plant', secondaryFacilityType: 'Other / custom facility' })).json.error?.includes('cannot be the custom entry') === true, 'the custom entry is not a secondary sub-type')

    const made = await mk({ name: 'Noor Hospital Block C', code: 'HOS-001', secondaryFacilityType: 'Diagnostic / imaging centre' })
    ok(made.status === 201, 'a hospital project is created through the same endpoint as a pharma one')
    const hp = (await get('/projects/HOS-001', QA)).json.project as ProjectData
    ok(hp.profile.industryGroup === 'Hospital / Healthcare' && hp.profile.facilityType === 'Multi-speciality hospital' && hp.profile.secondaryFacilityType === 'Diagnostic / imaging centre', 'the classification is stored and returned')
    ok(hp.profile.serviceType === 'Design + BIM' && hp.profile.bimRequirement?.lod === 'LOD 400' && hp.profile.bimRequirement?.assetHandover === 'COBie + as-built', 'the BIM requirement is stored for a BIM service')
    ok(hp.profile.customFacilityType === undefined && hp.profile.projectStage === 'Detailed design', 'no custom name is kept when the facility type is a listed one')
    ok(hp.audit.some((a) => a.text.includes('Hospital / Healthcare · Multi-speciality hospital · Diagnostic / imaging centre · Design + BIM · Detailed design')), 'the classification is in the creation audit entry')

    const design = await mk({ name: 'Design Only Clinic', code: 'HOS-002', facilityType: 'Clinic / polyclinic', serviceType: 'Design only' })
    ok(design.status === 201, 'a design-only project is created')
    const dp = (await get('/projects/HOS-002', QA)).json.project as ProjectData
    ok(dp.profile.bimRequirement === undefined, 'a design-only project stores no BIM requirement, even when one is sent')

    // changing the classification is a new baseline, and a material change resets applicability
    const before = dp.baseline
    const up = await call('PUT', '/projects/HOS-002/profile', { ...classificationOf(dp.profile), projectStage: 'Tender', scope: dp.profile.scope, ownerStandards: '', markets: ['IN'], reason: 'Issued for tender' }, QA)
    ok(up.status === 200 && (up.json.project as ProjectData).baseline === before + 1, 'a classification change creates the next baseline')
    ok((up.json.project as ProjectData).audit.some((a) => a.text.includes('project stage "Detailed design" -> "Tender"')), 'the change is logged old -> new')
    const toBim = await call('PUT', '/projects/HOS-002/profile', { ...classificationOf(dp.profile), serviceType: 'Design + BIM', projectStage: 'Tender', scope: dp.profile.scope, ownerStandards: '', markets: ['IN'], reason: 'BIM added to the commission' }, QA)
    ok((toBim.json.project as ProjectData).profile.bimRequirement?.lod === 'LOD 300', 'adding BIM to the service brings the BIM requirement with its defaults')
    ok((toBim.json.project as ProjectData).audit.some((a) => a.text.includes('BIM requirement "none" -> "LOD 300')), 'and that is audited as a field change like any other')

    // the pharma projects the fixtures hold are untouched by the migration
    const nova = (await get('/projects/PRJ-026', QA)).json.project as ProjectData
    ok(nova.profile.industryGroup === 'Pharma' && nova.profile.facilityType === 'Non-sterile formulation', 'an existing pharma project keeps its facility type as the pharma group facility type')
    ok(nova.profile.projectCountry === 'SA' && !!nova.profile.projectStage, 'the renamed country and stage columns carry their original values')
  }

  // ---------------------------------------------------------------- project templates (Phase 5 / step 2)
  section('OQ-API-36')
  {
    resetApiRate()
    const tpl = (q: Record<string, string>) => call('GET', `/reference/template?${new URLSearchParams(q)}`, undefined, QA)

    const pharma = (await tpl({ industryGroup: 'Pharma', facilityType: 'Sterile products', serviceType: 'Design only' })).json
    ok(pharma.disciplines.join() === 'Civil & Cleanroom,Process Equipment,Piping & Utilities,HVAC,Electrical,Instrumentation,Fire & Life Safety,CQV', 'a pharma project still starts with exactly the disciplines it always did')
    const hospital = (await tpl({ industryGroup: 'Hospital / Healthcare', facilityType: 'General hospital', serviceType: 'Design only' })).json
    ok(hospital.disciplines.includes('Medical Gas') && !hospital.disciplines.includes('CQV'), 'a hospital project gets medical gas, not pharma qualification')
    const solar = (await tpl({ industryGroup: 'Energy & High-Tech', facilityType: 'Solar PV – rooftop', serviceType: 'Design only' })).json
    const fab = (await tpl({ industryGroup: 'Energy & High-Tech', facilityType: 'Semiconductor – front-end wafer fab / foundry', serviceType: 'Design only' })).json
    ok(solar.disciplines.includes('Solar PV & Array') && fab.disciplines.includes('High-Purity Piping'), 'inside one industry group the facility type still decides: solar and semiconductor differ')
    ok(!solar.disciplines.includes('High-Purity Piping') && !fab.disciplines.includes('Solar PV & Array'), 'and neither borrows the disciplines of the other')
    ok(hospital.addOns.some((a: string) => /medical gas/i.test(a)) && pharma.addOns.some((a: string) => /IQ \/ OQ \/ PQ/.test(a)), 'each industry names the specialised controls it expects')
    ok((await tpl({ industryGroup: 'Shipbuilding', facilityType: 'x', serviceType: 'Design only' })).status === 400, 'an unknown classification cannot resolve a template')

    // the service type decides which deliverables exist at all
    const q = { industryGroup: 'Hospital / Healthcare', facilityType: 'General hospital', disciplines: 'HVAC' }
    const design = (await tpl({ ...q, serviceType: 'Design only' })).json
    const bim = (await tpl({ ...q, serviceType: 'BIM only' })).json
    const both = (await tpl({ ...q, serviceType: 'Design + BIM' })).json
    const titles = (t: any) => t.deliverables.map((d: any) => d.title).join(' | ')
    ok(!/model|BEP|MIDP/i.test(titles(design)), 'a design-only commission is given no BIM deliverable')
    ok(!/calculations|specification/i.test(titles(bim)), 'a BIM-only commission is given no design calculations or specifications')
    ok(/model/i.test(titles(bim)) && /calculations/i.test(titles(design)), 'each one is given the deliverables of its own track')
    ok(both.summary.total > design.summary.total && both.summary.total > bim.summary.total, 'Design + BIM is given both tracks')
    ok(both.deliverables.every((d: any) => d.discipline === 'HVAC' || !hospital.disciplines.includes(d.discipline)), 'deliverables follow the disciplines that were chosen, not the whole list')

    // creation registers them
    const base = {
      client: 'Nova Pharma Ltd', site: 'Riyadh', projectCountry: 'SA', markets: [],
      industryGroup: 'Energy & High-Tech', facilityType: 'Solar PV – rooftop', serviceType: 'Design + BIM',
      scope: 'New plant', projectStage: 'Detailed design', ownerStandards: '',
      disciplines: ['Solar PV & Array', 'Electrical (LV / HV)'], companies: [],
      members: [{ userId: ids['Owner / QA'], role: 'Owner / QA' }],
    }
    const made = await call('POST', '/projects', { ...base, name: 'Rooftop Solar Array', code: 'SOL-001' }, QA)
    ok(made.status === 201, 'a solar project is created')
    const sp = (await get('/projects/SOL-001', QA)).json.project as ProjectData
    ok(sp.docs.length > 0 && sp.docs.every((d) => d.status === 'Missing' && d.rev === 0), 'its deliverables are registered as Missing')
    ok(sp.docs.every((d) => d.owner === 'Nova Pharma Ltd'), 'each one is assigned to the client, for the team to reassign')
    ok(sp.docs.some((d) => /discipline model/i.test(d.title)) && sp.docs.some((d) => /calculations/i.test(d.title)), 'a Design + BIM project gets both tracks')
    ok(sp.docs.every((d) => sp.disciplines.some((x) => x.name === d.discipline)), 'every deliverable belongs to a discipline of the project')
    ok(sp.revitMode === true, 'a BIM commission starts with the Revit connector on')
    ok(sp.audit.some((a) => a.text.startsWith('Deliverables:') && a.text.includes('registered as Missing')), 'the generation is recorded in the audit trail')
    const dues = sp.docs.map((d) => d.due)
    ok(new Set(dues).size > 1 && dues.every((d) => d >= today()), 'due dates are a staged starting plan, not all the same day and not in the past')

    const off = await call('POST', '/projects', { ...base, name: 'Own Register Solar', code: 'SOL-002', generateDeliverables: false }, QA)
    ok(off.status === 201, 'a team that keeps its own register can switch the template off')
    const sp2 = (await get('/projects/SOL-002', QA)).json.project as ProjectData
    ok(sp2.docs.length === 0 && sp2.audit.some((a) => a.text.includes('no template applied')), 'then nothing is registered, and that choice is audited')

    const designOnly = await call('POST', '/projects', { ...base, name: 'Design Only Solar', code: 'SOL-003', serviceType: 'Design only' }, QA)
    const sp3 = (await get('/projects/SOL-003', QA)).json.project as ProjectData
    ok(designOnly.status === 201 && !sp3.docs.some((d) => /model/i.test(d.title)), 'a design-only project registers no model deliverable')
    ok(sp3.revitMode === false, 'and it starts standalone, without the Revit connector')
  }
} finally {
  server.close()
  await prisma.$disconnect()
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
