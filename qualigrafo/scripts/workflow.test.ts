// Run: npx tsx scripts/workflow.test.ts  (checks the approval / revision / source-import rules in src/store.ts)
import { evidenceState, useStore } from '../src/store'

let fail = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }
const S = () => useStore.getState()
const doc = (id: string) => S().docs.find((d) => d.id === id)!

S().openProject('PRJ-026')
S().setRole('Contractor')
ok(S().submitDoc('DOC-007', '') !== null, 'submit needs a note')
ok(S().submitDoc('DOC-007', 'Ready') === null, 'contractor submits DOC-007')
ok(doc('DOC-007').status === 'Under review', 'status -> Under review')
ok(S().events[0].category === 'Routing' && S().events[0].forRole === 'Consultant', 'routing event to Consultant created automatically')

S().setRole('Owner / QA')
ok(S().signDoc('DOC-007', 'QA', 'ok', true) !== null, 'Owner/QA cannot sign stage 1 (wrong role)')
S().setRole('Consultant')
ok(S().signDoc('DOC-007', 'C', 'ok', false) !== null, 'sign blocked without explicit intent confirmation')
ok(S().signDoc('DOC-007', 'C', 'ok', true) === null, 'Consultant signs stage 1')
ok(doc('DOC-007').signStage === 1 && doc('DOC-007').status === 'Under review', 'auto-advanced to stage 2, still under review')
ok(S().events.some((e) => e.category === 'Routing' && e.forRole === 'Owner / QA' && e.doc === 'DOC-007'), 'auto-routed to Owner / QA')
const issuedBefore = S().issued.length
S().setRole('Owner / QA')
ok(S().signDoc('DOC-007', 'Q', 'ok', true) === null, 'Owner/QA signs stage 2')
ok(doc('DOC-007').status === 'Accepted', 'revision accepted after both stages')
ok(S().issued.length === issuedBefore + 1 && S().issued[0].doc === 'DOC-007', 'controlled issue manifest generated')

// fresh revision = fresh approval
S().setRole('Contractor')
S().newRevision('DOC-007')
ok(doc('DOC-007').rev === 1 && doc('DOC-007').status === 'Draft' && doc('DOC-007').signStage === 0, 'new revision starts as Draft at stage 0')
ok(doc('DOC-007').signatures.every((s) => s.rev === 0), 'old signatures stay bound to R00 only')
ok(S().events[0].category === 'Revision', 'revision event logged')

// stale evidence after revision
const req = S().reqs.find((r) => r.id === 'REQ-006')!
ok(evidenceState(req, S().docs) === 'Evidence accepted', 'REQ-006 accepted before revising DOC-003')
S().newRevision('DOC-003')
ok(evidenceState(S().reqs.find((r) => r.id === 'REQ-006')!, S().docs) === 'Revision changed', 'revising DOC-003 makes linked evidence stale')

// source import cancels pending route and rejects duplicates
S().setRole('Contractor')
S().submitDoc('DOC-011', 'x')
ok(doc('DOC-011').status === 'Under review', 'DOC-011 under review')
ok(S().importSource('DOC-011', 'Standalone', 'file.pdf', 'abc') === null, 'standalone import creates draft')
ok(doc('DOC-011').status === 'Draft' && doc('DOC-011').rev === 1, 'import -> new draft revision')
ok(S().imports[0].cancelledRoute === true, 'pending route cancelled by source change')
ok(S().importSource('DOC-011', 'Standalone', 'file.pdf', 'abc') !== null, 'duplicate checksum rejected')
ok(S().importSource('DOC-005', 'Revit', 'DEMO-MODEL v1', 'revit:1') === null && doc('DOC-005').source === 'Revit', 'Revit import creates draft revision')

// return for changes cancels
S().setRole('Contractor'); S().submitDoc('DOC-001', 'again')
S().setRole('Consultant')
ok(S().returnDoc('DOC-001', '') !== null, 'return needs a reason')
ok(S().returnDoc('DOC-001', 'fix door swing') === null && doc('DOC-001').status === 'Changes requested', 'returned for changes')

// source reference attestation
ok(S().setSourceRef('REQ-001', 'x', '', '', true) !== null, 'attestation needs clause + version + date')
ok(S().setSourceRef('REQ-001', 'Sec 3', '2024 ed', '2024-01-01', true) === null, 'source reference saved')
S().setRole('Contractor')
ok(S().setSourceRef('REQ-001', 'a', 'b', 'c', false) !== null, 'contractor cannot edit source reference')


// ---- NCR rules
S().setRole('Consultant')
ok(S().raiseNcr({ title: 'x', description: '', system: 'PW-001', severity: 'Major', due: '2026-10-30' }) !== null, 'NCR needs a description')
ok(S().raiseNcr({ title: 'Gasket wrong grade', description: 'EPDM specified, found silicone', system: 'PW-001', severity: 'Critical', due: '2026-10-30' }) === null, 'consultant raises a Critical NCR')
const nid = S().ncrs[S().ncrs.length - 1].id
ok(S().respondNcr(nid, 'a', 'b', 'c') !== null, 'only the contractor can respond')
S().setRole('Contractor')
ok(S().respondNcr(nid, 'a', '', 'c') !== null, 'response needs root cause + containment + corrective action')
ok(S().closeNcr(nid, 'ok') !== null, 'contractor cannot close an NCR')
ok(S().respondNcr(nid, 'wrong stock', 'quarantined', 'replace + check') === null, 'contractor submits full response')
S().setRole('Consultant')
ok(S().closeNcr(nid, 'verified') !== null, 'Critical NCR cannot be closed by Consultant')
S().setRole('Owner / QA')
ok(S().closeNcr(nid, '') !== null, 'closure needs a verification note')
ok(S().closeNcr(nid, 'Replaced and inspected') === null, 'Owner/QA closes the Critical NCR')
ok(S().ncrs.find((n) => n.id === nid)!.status === 'Closed', 'NCR is Closed')
S().setRole('Contractor')
ok(S().reopenNcr('NCR-002', 'x') !== null, 'contractor cannot reopen')

// ---- risk rules
ok(S().addRisk({ title: 'r', detail: '', system: 'PW-001', likelihood: 4, impact: 5, owner: '', mitigation: '', due: '2026-11-01' }) !== null, 'risk needs owner + mitigation')
ok(S().updateRisk('RSK-001', 'Closed', 'done') !== null, 'contractor cannot close a risk')
S().setRole('Owner / QA')
ok(S().updateRisk('RSK-001', 'Closed', '') !== null, 'risk status change needs a note')
ok(S().updateRisk('RSK-001', 'Accepted', 'Residual risk accepted by QA') === null, 'reviewer accepts a risk with a note')

// ---- gates include NCRs
import { handoverGates } from '../src/store'
ok(handoverGates(S()).some((g) => g.key === 'ncr'), 'handover gates include non-conformances')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
