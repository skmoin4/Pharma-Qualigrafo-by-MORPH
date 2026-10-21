export type Role = 'Consultant' | 'Contractor' | 'Owner / QA'
export type MarketKey = 'SA' | 'IN' | 'EU' | 'US' | 'UK'
export type DocStatus = 'Missing' | 'Draft' | 'Under review' | 'Changes requested' | 'Accepted' | 'Void' | 'Superseded'
export type Applicability = 'Assessment pending' | 'Required' | 'Not applicable'
export type EvidenceDecision = 'Pending' | 'Accepted' | 'Rejected' | 'Withdrawn'

export interface Signature {
  role: Role
  name: string
  at: string
  rev: number
  reason: string
}

/** Metadata of an uploaded file; bytes are downloaded from /api/projects/:code/files/:id. */
export interface FileMeta {
  id: string
  name: string
  size: number
  mimeType: string
  sha256: string
  at: string
  by: string | null
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
  /** Revision the current source belongs to; the source is current only when sourceRev === rev. */
  sourceRev?: number
  file?: FileMeta
  /** Client / MDR document number ('' when not assigned). */
  number: string
  /** Set when the document is Void or Superseded. */
  voided?: { reason: string; at: string; by: string; supersededBy?: string }
  signatures: Signature[]
  history: { rev: number; status: DocStatus; at: string; by: Role; note?: string }[]
}

export interface EvidenceLink {
  id?: string
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
  /** Library origin (item key + pack version number); null for project-specific requirements. */
  libraryKey?: string | null
  libraryVersion?: number | null
}

export interface Pin {
  id: string
  text: string
  doc: string
  rev: number
  room: string
  x: number
  y: number
  /** Placed on the drawing of revision `rev` (page, normalised x / y). */
  anchored: boolean
  page: number
  model: string | null
  element: string | null
  /** Latest "Open in Revit" request for this comment. */
  nav: NavStatus | null
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
  kind?: 'Regulatory' | 'Library'
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
  user?: string
}

export interface SessionUser {
  id: string
  email: string
  name: string
  company: string | null
  isAdmin: boolean
  mustChangePassword: boolean
  canCreateProjects: boolean
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
  status: 'Active' | 'Archived'
  archivedAt?: string
  archivedReason?: string
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
  /** Set for findings raised manually by a reviewer. */
  raisedBy?: Role
  raisedAt?: string
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
  file?: FileMeta
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

export interface Company {
  id: string
  name: string
  kind: string
  contactName: string | null
  contactEmail: string | null
  active: boolean
}
export interface SystemRec {
  id: string
  tag: string
  name: string
  discipline: string | null
  area: string | null
  gmpCritical: boolean
  active: boolean
}
export interface DisciplineRec {
  id: string
  name: string
  position: number
  active: boolean
}
/** A person on the project team (project role, optional vendor company scope). */
export interface Member {
  userId: string
  name: string
  email: string
  company: string | null
  role: Role
  scope: string | null
  active: boolean
}
export interface NavStatus { id: string; status: string; detail: string | null; at: string; by: string }
export interface ConnectorTokenRec { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
export interface ElementChange { elementId: string; kind: string; detail: string }
export interface SnapshotRec { id: string; version: string; publishedAt: string; publishedBy: string; elementCount: number; changes: ElementChange[] }
export interface RevitModelRec { id: string; guid: string; name: string; lastSnapshotAt: string | null; snapshots: SnapshotRec[] }
/** Revit connector state of a project. Tokens are listed only for Owner / QA. */
export interface ConnectorState { tokens: ConnectorTokenRec[]; models: RevitModelRec[] }
