export type Role = 'Consultant' | 'Contractor' | 'Owner / QA'
export type MarketKey = 'SA' | 'IN' | 'EU' | 'US' | 'UK'
export type DocStatus = 'Missing' | 'Draft' | 'Under review' | 'Changes requested' | 'Accepted'
export type Applicability = 'Assessment pending' | 'Required' | 'Not applicable'
export type EvidenceDecision = 'Pending' | 'Accepted' | 'Rejected'

export interface Signature {
  role: Role
  name: string
  at: string
  rev: number
  reason: string
}

export interface Doc {
  id: string
  title: string
  discipline: string
  system: string
  rev: number
  status: DocStatus
  owner: string
  due: string
  critical: boolean
  signStage: 0 | 1 | 2 // 0 consultant, 1 owner/QA, 2 complete
  source?: 'Standalone' | 'Revit'
  checksum?: string
  signatures: Signature[]
  history: { rev: number; status: DocStatus; at: string; by: Role; note?: string }[]
}

export interface EvidenceLink {
  doc: string
  rev: number
  decision: EvidenceDecision
  note: string
  by: Role
  at: string
  reviewedBy?: Role
  reason?: string
}

export interface Requirement {
  id: string
  title: string
  market: MarketKey
  topic: string
  discipline: string
  system: string
  applicability: Applicability
  rationale: string
  owner: string
  due: string
  critical: boolean
  evidence: EvidenceLink[]
  clause: string
  sourceVersion: string
  effective: string
  sourceAttested: boolean
}

export interface Pin {
  id: string
  text: string
  doc: string
  rev: number
  room: string
  x: number
  y: number
  model: string | null
  element: string | null
  status: 'Open' | 'Closed'
  by: Role
  replies: { by: Role; text: string; at: string }[]
}

export interface RegUpdate {
  id: string
  market: MarketKey
  title: string
  summary: string
  reqs: string[]
  status: 'Awaiting assessment' | 'Applied to draft baseline' | 'Not applicable'
  reason?: string
}

export interface GapAction {
  id: string
  req: string
  title: string
  owner: string
  due: string
  priority: 'High' | 'Medium' | 'Low'
  status: 'Open' | 'Ready for verification' | 'Closed'
  submittedBy?: Role
}

export interface AuditEvent {
  at: string
  role: Role
  text: string
}

export interface ToastMsg {
  id: number
  text: string
  tone: 'ok' | 'warn'
}

export type EvidenceState =
  | 'Not applicable'
  | 'Assessment pending'
  | 'Evidence missing'
  | 'Revision changed'
  | 'Correction required'
  | 'Evidence accepted'
  | 'Under assessment'

export type Facility = 'API' | 'Non-sterile formulation' | 'Sterile products' | 'Biologics' | 'Warehouse'
export type Scope = 'New plant' | 'Expansion' | 'Renovation' | 'Equipment installation'

export interface Profile {
  id: string
  name: string
  client: string
  site: string
  facility: Facility
  scope: Scope
  phase: string
  plantCountry: MarketKey
  ownerStandards: string
}

export interface Rfi {
  id: string
  title: string
  discipline: string
  system: string
  status: 'Awaiting response' | 'Answered' | 'Closed'
  raisedBy: Role
  due: string
  response: string
}

export interface Inspection {
  id: string
  title: string
  system: string
  status: 'Requested' | 'Submitted' | 'Accepted' | 'Correction required'
  evidence: string
  drawingRev: string
  decision?: string
}

export interface Finding {
  id: string
  title: string
  doc: string
  severity: 'High' | 'Medium' | 'Low'
  status: 'Open' | 'Resolved' | 'Accepted exception'
  source: string
  rule: string
  disposition?: string
}

export interface Change {
  id: string
  title: string
  system: string
  status: 'Proposed' | 'Impact review' | 'Authorized' | 'Rejected'
  docs: string[]
  reqs: string[]
  impact: Record<string, 'Unassessed' | 'Impacted' | 'Not impacted'>
  decision?: string
}

export interface Snapshot {
  id: string
  at: string
  by: Role
  baseline: number
  markets: MarketKey[]
  required: number
  accepted: number
  blockers: string[]
  rows: { id: string; title: string; market: MarketKey; applicability: string; state: string; links: string }[]
}

export interface BaselineRec {
  v: number
  at: string
  by: Role
  reason: string
}

export type EventCategory = 'Routing' | 'Signature' | 'Reminder' | 'Revision' | 'Issue' | 'Source' | 'Issue status'
export interface Notice {
  id: string
  at: string
  category: EventCategory
  text: string
  doc?: string
  forRole?: Role
  read: boolean
}
export interface Automation { routing: boolean; reminders: boolean; autoIssue: boolean }
export interface ImportBatch {
  id: string
  at: string
  mode: 'Standalone' | 'Revit'
  doc: string
  fromRev: number
  toRev: number
  checksum: string
  label: string
  cancelledRoute: boolean
}
export interface IssuedPackage {
  id: string
  at: string
  doc: string
  title: string
  rev: number
  signers: { role: Role; name: string; at: string }[]
  checksum: string | null
}

export type Rating = 1 | 2 | 3 | 4 | 5
export interface Risk {
  id: string
  title: string
  detail: string
  system: string
  likelihood: Rating
  impact: Rating
  owner: string
  mitigation: string
  due: string
  status: 'Open' | 'Mitigating' | 'Accepted' | 'Closed'
  decision?: string
}

export type NcrSeverity = 'Critical' | 'Major' | 'Minor'
export interface Ncr {
  id: string
  title: string
  description: string
  system: string
  severity: NcrSeverity
  doc?: string
  req?: string
  raisedBy: Role
  raisedAt: string
  due: string
  status: 'Open' | 'Response submitted' | 'Closed'
  rootCause?: string
  containment?: string
  correctiveAction?: string
  respondedBy?: Role
  closedBy?: Role
  closeReason?: string
}
