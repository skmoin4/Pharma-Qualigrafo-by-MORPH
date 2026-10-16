import type { Doc, EvidenceLink, GapAction, MarketKey, Pin, RegUpdate, Requirement } from '../types'

export const disciplines = ['Civil & Cleanroom', 'Process Equipment', 'Piping & Utilities', 'HVAC', 'Electrical', 'Instrumentation', 'Fire & Life Safety', 'CQV']

export const markets: Record<MarketKey, { name: string; short: string; authority: string; base: string; url: string }> = {
  SA: { name: 'Saudi Arabia', short: 'KSA', authority: 'SFDA', base: 'SFDA GMP guide and applicable local supplementary provisions', url: 'https://www.sfda.gov.sa/en/guide/69378' },
  IN: { name: 'India', short: 'IN', authority: 'CDSCO / State licensing', base: 'Applicable Drugs Rules and Schedule M, as amended', url: 'https://www.cdsco.gov.in/opencms/opencms/en/Notifications/Gazette-Notifications/' },
  EU: { name: 'European Union', short: 'EU', authority: 'EMA / national authorities', base: 'EudraLex Volume 4, parts and annexes by activity', url: 'https://health.ec.europa.eu/medicinal-products/eudralex/eudralex-volume-4_en' },
  US: { name: 'United States', short: 'US', authority: 'FDA', base: 'Applicable drug cGMP (21 CFR 210/211); Part 11 where relevant', url: 'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-C/part-211' },
  UK: { name: 'United Kingdom', short: 'UK', authority: 'MHRA', base: 'Applicable MHRA GMP framework', url: 'https://www.gov.uk/guidance/good-manufacturing-practice-and-good-distribution-practice' },
}

const d = (id: string, title: string, discipline: string, system: string, rev: number, status: Doc['status'], owner: string, due: string, critical = false): Doc => ({
  id, title, discipline, system, rev, status, owner, due, critical,
  signStage: status === 'Accepted' ? 2 : 0,
  signatures: status === 'Accepted'
    ? [
        { role: 'Consultant', name: 'Demo Consultant', at: '2026-10-08T09:00:00Z', rev, reason: 'Engineering review approval' },
        { role: 'Owner / QA', name: 'Demo Owner / QA', at: '2026-10-09T09:00:00Z', rev, reason: 'Owner / QA approval' },
      ]
    : [],
  history: [{ rev, status, at: '2026-10-12T00:00:00Z', by: 'Contractor' }],
})

export const seedDocs: Doc[] = [
  d('DOC-001', 'Cleanroom panel layout', 'Civil & Cleanroom', 'CR-101', 2, 'Under review', 'BuildCo', '2026-10-18', true),
  d('DOC-002', 'Reactor vendor datasheet', 'Process Equipment', 'RE-201', 1, 'Changes requested', 'EquipCo', '2026-10-20'),
  d('DOC-003', 'Purified water P&ID', 'Piping & Utilities', 'PW-001', 3, 'Accepted', 'BuildCo', '2026-10-11', true),
  d('DOC-004', 'AHU technical submittal', 'HVAC', 'AHU-01', 2, 'Under review', 'AirCo', '2026-10-19', true),
  d('DOC-005', 'Main panel single-line diagram', 'Electrical', 'MDB-01', 1, 'Accepted', 'VoltCo', '2026-10-10'),
  d('DOC-006', 'Instrument calibration certificates', 'Instrumentation', 'BMS-01', 0, 'Missing', 'ControlCo', '2026-10-15', true),
  d('DOC-007', 'Fire pump installation inspection', 'Fire & Life Safety', 'FP-01', 0, 'Draft', 'SafeCo', '2026-10-23'),
  d('DOC-008', 'System qualification protocol', 'CQV', 'PW-001', 1, 'Under review', 'QualiCo', '2026-10-19', true),
  d('DOC-009', 'PW weld map and material certificates', 'Piping & Utilities', 'PW-001', 0, 'Missing', 'BuildCo', '2026-10-14', true),
  d('DOC-010', 'Room finishes schedule', 'Civil & Cleanroom', 'CR-101', 1, 'Accepted', 'BuildCo', '2026-10-09'),
  d('DOC-011', 'Electrical insulation test records', 'Electrical', 'MDB-01', 0, 'Draft', 'VoltCo', '2026-10-24'),
  d('DOC-012', 'Airflow balancing report', 'HVAC', 'AHU-01', 0, 'Missing', 'AirCo', '2026-10-25', true),
]

const ev = (doc: string, rev: number, accepted: boolean, note: string): EvidenceLink => ({
  doc, rev, note, by: 'Contractor', at: '2026-10-10T00:00:00Z',
  decision: accepted ? 'Accepted' : 'Pending',
  ...(accepted ? { reviewedBy: 'Owner / QA' as const, reason: 'Fit for the stated requirement scope.' } : {}),
})

const T = 'Topic mapping — exact clause, version and effective date require expert verification'

const r = (id: string, title: string, market: MarketKey, discipline: string, system: string, applicability: Requirement['applicability'], evidence: EvidenceLink[], critical = false, topic = T): Requirement => ({
  id, title, market, topic, discipline, system, applicability, critical, evidence,
  rationale: applicability === 'Required' ? 'Assessed against facility type and project scope.' : applicability === 'Not applicable' ? 'Demo: exempted by owner QA for this scope (sample rationale).' : '',
  owner: 'Consultant', due: '2026-10-28',
  clause: '', sourceVersion: '', effective: '', sourceAttested: false,
})

export const seedReqs: Requirement[] = [
  r('REQ-001', 'Premises layout, flow and cleanroom finishes', 'SA', 'Civil & Cleanroom', 'CR-101', 'Required', [ev('DOC-010', 1, true, 'Finishes schedule supports surface requirements.'), ev('DOC-001', 2, false, 'Layout shows personnel and material flow.')], true),
  r('REQ-002', 'Premises layout, flow and cleanroom finishes', 'EU', 'Civil & Cleanroom', 'CR-101', 'Required', [ev('DOC-010', 1, true, 'Same finishes schedule, assessed separately for EU scope.'), ev('DOC-001', 2, false, 'Layout reused; EU assessment pending.')], true),
  r('REQ-003', 'Premises layout, flow and cleanroom finishes', 'IN', 'Civil & Cleanroom', 'CR-101', 'Assessment pending', []),
  r('REQ-004', 'Equipment design and vendor evidence', 'SA', 'Process Equipment', 'RE-201', 'Required', [ev('DOC-002', 1, false, 'Vendor datasheet for reactor RE-201.')]),
  r('REQ-005', 'Equipment design and vendor evidence', 'IN', 'Process Equipment', 'RE-201', 'Required', []),
  r('REQ-006', 'Purified water system documentation', 'SA', 'Piping & Utilities', 'PW-001', 'Required', [ev('DOC-003', 3, true, 'Approved P&ID R03.')], true),
  r('REQ-007', 'Purified water system documentation', 'EU', 'Piping & Utilities', 'PW-001', 'Required', [ev('DOC-003', 3, true, 'P&ID reused for EU assessment.')], true),
  r('REQ-008', 'Material traceability for utility piping', 'SA', 'Piping & Utilities', 'PW-001', 'Required', [], true),
  r('REQ-009', 'Material traceability for utility piping', 'IN', 'Piping & Utilities', 'PW-001', 'Required', [], true),
  r('REQ-010', 'HVAC design and verification evidence', 'SA', 'HVAC', 'AHU-01', 'Required', [ev('DOC-004', 2, false, 'AHU technical submittal.')], true),
  r('REQ-011', 'HVAC design and verification evidence', 'EU', 'HVAC', 'AHU-01', 'Assessment pending', []),
  r('REQ-012', 'Electrical installation evidence', 'SA', 'Electrical', 'MDB-01', 'Required', [ev('DOC-005', 1, true, 'Single-line diagram R01.')]),
  r('REQ-013', 'Electrical installation evidence', 'IN', 'Electrical', 'MDB-01', 'Required', [ev('DOC-005', 1, true, 'Single-line diagram reused.')]),
  r('REQ-014', 'Instrument calibration evidence', 'SA', 'Instrumentation', 'BMS-01', 'Required', [], true),
  r('REQ-015', 'Instrument calibration evidence', 'EU', 'Instrumentation', 'BMS-01', 'Required', [], true),
  r('REQ-016', 'Fire-system project approvals', 'SA', 'Fire & Life Safety', 'FP-01', 'Required', [], false, 'Local authority / project-specific review (not GMP)'),
  r('REQ-017', 'Qualification planning and traceability', 'SA', 'CQV', 'PW-001', 'Required', [ev('DOC-008', 1, false, 'Qualification protocol draft.')], true),
  r('REQ-018', 'Qualification planning and traceability', 'EU', 'CQV', 'PW-001', 'Required', [ev('DOC-008', 1, false, 'Protocol reused; EU assessment pending.')], true),
  r('REQ-019', 'Qualification planning and traceability', 'IN', 'CQV', 'PW-001', 'Not applicable', []),
  r('REQ-020', 'Electronic records and signatures scope check', 'US', 'CQV', 'BMS-01', 'Assessment pending', []),
  r('REQ-021', 'Personnel and material flow, gowning interface', 'SA', 'Civil & Cleanroom', 'CR-101', 'Assessment pending', []),
  r('REQ-022', 'Pressure cascade and environmental control design', 'SA', 'HVAC', 'AHU-01', 'Required', [], true),
  r('REQ-023', 'Cleanroom classification and room-integrity verification', 'SA', 'HVAC', 'AHU-01', 'Required', [], true),
  r('REQ-024', 'Water system sanitisation and monitoring provisions', 'SA', 'Piping & Utilities', 'PW-001', 'Required', []),
  r('REQ-025', 'Equipment installation qualification documentation', 'SA', 'Process Equipment', 'RE-201', 'Required', [], true),
  r('REQ-026', 'Building monitoring system documentation', 'SA', 'Instrumentation', 'BMS-01', 'Assessment pending', []),
  r('REQ-027', 'Emergency power and utility continuity for critical systems', 'SA', 'Electrical', 'MDB-01', 'Assessment pending', []),
  r('REQ-028', 'Fire compartmentation and evacuation approvals', 'SA', 'Fire & Life Safety', 'FP-01', 'Required', [], false, 'Local authority / project-specific review (not GMP)'),
  r('REQ-029', 'HVAC design and verification evidence', 'IN', 'HVAC', 'AHU-01', 'Required', [], true),
  r('REQ-030', 'Purified water system documentation', 'IN', 'Piping & Utilities', 'PW-001', 'Required', [ev('DOC-003', 3, true, 'P&ID reused for Indian-market assessment.')], true),
  r('REQ-031', 'Instrument calibration evidence', 'IN', 'Instrumentation', 'BMS-01', 'Required', [], true),
  r('REQ-032', 'Equipment installation qualification documentation', 'IN', 'Process Equipment', 'RE-201', 'Assessment pending', []),
  r('REQ-033', 'Computerised system documentation (monitoring and control)', 'EU', 'Instrumentation', 'BMS-01', 'Assessment pending', []),
  r('REQ-034', 'Equipment installation qualification documentation', 'EU', 'Process Equipment', 'RE-201', 'Required', [], true),
  r('REQ-035', 'Equipment and facility design documentation', 'US', 'Process Equipment', 'RE-201', 'Assessment pending', []),
  r('REQ-036', 'Electronic signature controls for engineering records (scope check)', 'US', 'CQV', 'BMS-01', 'Assessment pending', []),
]

export const seedPins: Pin[] = [
  { id: 'CMT-001', text: 'Confirm door swing and access at the cleanroom corridor interface.', doc: 'DOC-001', rev: 2, room: 'CR-101', x: 0.39, y: 0.43, model: 'DEMO-MODEL-ARCH-A', element: 'DEMO-ELEMENT-DOOR-101', status: 'Open', by: 'Consultant', replies: [] },
  { id: 'CMT-002', text: 'Review terminal access clearance; coordinate with ceiling panel joints.', doc: 'DOC-004', rev: 2, room: 'CR-102', x: 0.7, y: 0.4, model: 'DEMO-MODEL-MEP-A', element: 'DEMO-ELEMENT-TERMINAL-102', status: 'Open', by: 'Consultant', replies: [] },
  { id: 'CMT-003', text: 'Verify equipment-maintenance access; attach revised layout evidence.', doc: 'DOC-002', rev: 1, room: 'Equipment area', x: 0.23, y: 0.76, model: null, element: null, status: 'Open', by: 'Owner / QA', replies: [] },
]

export const seedUpdates: RegUpdate[] = [
  { id: 'UPD-1', market: 'SA', title: 'Sample: revised evidence-index format (FICTIONAL)', summary: 'Fictional exercise: a reviewed publication changes how premises evidence should be indexed.', reqs: ['REQ-001', 'REQ-006'], status: 'Awaiting assessment' },
]

export const seedActions: GapAction[] = [
  { id: 'GAP-001', req: 'REQ-008', title: 'Link material certificates to installed spools and line numbers', owner: 'Piping contractor (BuildCo)', due: '2026-10-22', priority: 'High', status: 'Open' },
]

import type { Change, Finding, Inspection, Profile, Rfi } from './../types'

export const projectIndex: Profile[] = [
  { id: 'PRJ-026', name: 'Nova Pharma Expansion', client: 'Nova Pharma Ltd', site: 'Riyadh, Saudi Arabia', facility: 'Non-sterile formulation', scope: 'Expansion', phase: 'Engineering & construction', plantCountry: 'SA', ownerStandards: 'NPL-QMS-014 Engineering documentation procedure (rev 4)' },
  { id: 'PRJ-031', name: 'Al Noor API Plant', client: 'Al Noor Chemicals', site: 'Jubail, Saudi Arabia', facility: 'API', scope: 'New plant', phase: 'Design', plantCountry: 'SA', ownerStandards: 'ANC-ENG-002 Project documentation standard' },
  { id: 'PRJ-018', name: 'Hyderabad Sterile Block', client: 'Deccan Life Sciences', site: 'Hyderabad, India', facility: 'Sterile products', scope: 'Renovation', phase: 'Commissioning & qualification', plantCountry: 'IN', ownerStandards: 'DLS-VMP-009 Validation master plan' },
]
export const projectMarkets: Record<string, MarketKey[]> = { 'PRJ-026': ['SA', 'EU', 'IN'], 'PRJ-031': ['SA'], 'PRJ-018': ['IN', 'EU'] }

export const seedRfis: Rfi[] = [
  { id: 'RFI-001', title: 'Confirm cleanroom door swing at corridor interface', discipline: 'Civil & Cleanroom', system: 'CR-101', status: 'Awaiting response', raisedBy: 'Contractor', due: '2026-10-20', response: '' },
  { id: 'RFI-002', title: 'Confirm purified-water sample-point access clearance', discipline: 'Piping & Utilities', system: 'PW-001', status: 'Answered', raisedBy: 'Contractor', due: '2026-10-15', response: 'Maintain access per approved vendor maintenance envelope; update layout for review.' },
]
export const seedInspections: Inspection[] = [
  { id: 'INS-001', title: 'Cleanroom panel installation', system: 'CR-101', status: 'Submitted', evidence: 'Checklist CL-CR-07 and site photographs (sample references)', drawingRev: 'DOC-001 R02' },
  { id: 'INS-002', title: 'Main distribution board installation', system: 'MDB-01', status: 'Accepted', evidence: 'Checklist CL-EL-02 (sample reference)', drawingRev: 'DOC-005 R01', decision: 'Installation matches approved single-line diagram R01.' },
  { id: 'INS-003', title: 'Fire pump installation', system: 'FP-01', status: 'Requested', evidence: 'Not yet submitted', drawingRev: 'DOC-007 R00' },
]
export const seedFindings: Finding[] = [
  { id: 'CHK-01', title: 'Equipment tag differs between schedule and vendor document', doc: 'DOC-002', severity: 'High', status: 'Open', source: 'Equipment schedule: RE-201 · Vendor datasheet: RE-210', rule: 'TAG-MATCH v1 · exact comparison; confirm whether an approved alias exists' },
  { id: 'CHK-02', title: 'Inspection cites an older drawing revision', doc: 'DOC-007', severity: 'Medium', status: 'Open', source: 'Inspection cites R00 · Drawing register shows R01', rule: 'REV-CURRENT v1 · reviewer decides whether the revision affects inspected scope' },
]
export const seedChanges: Change[] = [
  { id: 'CHG-001', title: 'Relocate PW sampling valve', system: 'PW-001', status: 'Impact review', docs: ['DOC-003', 'DOC-008', 'DOC-009'], reqs: ['REQ-006', 'REQ-008', 'REQ-017'], impact: { 'DOC-003': 'Unassessed', 'DOC-008': 'Unassessed', 'DOC-009': 'Unassessed', 'REQ-006': 'Unassessed', 'REQ-008': 'Unassessed', 'REQ-017': 'Unassessed' } },
]

import type { Ncr, Risk } from '../types'

export const seedRisks: Risk[] = [
  { id: 'RSK-001', title: 'Reactor vendor delivery slips past installation window', detail: 'RE-201 datasheet is still under correction; long-lead items may miss the planned installation slot.', system: 'RE-201', likelihood: 4, impact: 4, owner: 'EquipCo', mitigation: 'Weekly vendor progress call; pre-approve datasheet scope; agree interim storage with site.', due: '2026-10-30', status: 'Mitigating' },
  { id: 'RSK-002', title: 'Material traceability gap on purified-water piping', detail: 'Certificates exist but are not linked to installed spools; may block qualification and handover.', system: 'PW-001', likelihood: 4, impact: 5, owner: 'BuildCo', mitigation: 'Spool-by-spool traceability log; reviewer spot-check before pressure test.', due: '2026-10-24', status: 'Open' },
  { id: 'RSK-003', title: 'HVAC balancing report not available before PQ activities', detail: 'Airflow balancing is outstanding; downstream room qualification depends on it.', system: 'AHU-01', likelihood: 3, impact: 4, owner: 'AirCo', mitigation: 'Book balancing contractor; agree acceptance criteria with consultant early.', due: '2026-10-28', status: 'Open' },
  { id: 'RSK-004', title: 'Late change to sampling valve position', detail: 'CHG-001 may invalidate approved P&ID and qualification protocol.', system: 'PW-001', likelihood: 2, impact: 3, owner: 'Consultant', mitigation: 'Complete impact assessment before authorisation.', due: '2026-10-20', status: 'Open' },
]

export const seedNcrs: Ncr[] = [
  { id: 'NCR-001', title: 'Weld records missing for PW loop section B', description: 'During walk-down, weld identification marks on section B do not match the weld map; three joints cannot be traced to a welder or procedure.', system: 'PW-001', severity: 'Critical', doc: 'DOC-009', raisedBy: 'Consultant', raisedAt: '2026-10-13T08:30:00Z', due: '2026-10-21', status: 'Open' },
  { id: 'NCR-002', title: 'Ceiling panel joint sealant not as specified', description: 'Sealant used at CR-101 ceiling joints differs from the approved finishes schedule.', system: 'CR-101', severity: 'Major', doc: 'DOC-010', raisedBy: 'Owner / QA', raisedAt: '2026-10-11T10:00:00Z', due: '2026-10-23', status: 'Response submitted', rootCause: 'Substitute product supplied by site store without approval.', containment: 'Affected joints marked and further work on the panel stopped.', correctiveAction: 'Remove and reseal with specified product; add pre-use material approval check.', respondedBy: 'Contractor' },
  { id: 'NCR-003', title: 'Label missing on distribution board MDB-01', description: 'Circuit identification labels were not fitted at first inspection.', system: 'MDB-01', severity: 'Minor', doc: 'DOC-005', raisedBy: 'Consultant', raisedAt: '2026-10-05T09:00:00Z', due: '2026-10-12', status: 'Closed', rootCause: 'Labels delivered late.', containment: 'Temporary tags fitted.', correctiveAction: 'Permanent labels fitted and photographed.', respondedBy: 'Contractor', closedBy: 'Consultant', closeReason: 'Verified on site against the circuit schedule.' },
]
