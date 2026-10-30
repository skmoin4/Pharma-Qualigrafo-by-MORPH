// Suitability / status codes for document revisions (Phase 5 / step 3).
//
// A revision is issued *for a purpose*, and the code says which: shared for coordination, issued for construction,
// authorised for a specific use. The set below is the ISO 19650 one, which is what most of the client's sectors
// already use, and it is only a **default** — every project can edit it, because naming and the permitted set are
// set by the contract, the country and sometimes the client's own CDE, not by this software.
//
// Nothing here is a regulatory claim: these are labels for a workflow state.
export interface SuitabilityCode {
  code: string
  label: string
  /** WIP | Shared | Published | Archived — which part of the CDE flow the code belongs to. */
  kind: string
}

export const ISO19650_SUITABILITY: SuitabilityCode[] = [
  { code: 'S0', label: 'Work in progress', kind: 'WIP' },
  { code: 'S1', label: 'Shared for coordination', kind: 'Shared' },
  { code: 'S2', label: 'Shared for information', kind: 'Shared' },
  { code: 'S3', label: 'Shared for review and comment', kind: 'Shared' },
  { code: 'S4', label: 'Shared for stage approval', kind: 'Shared' },
  { code: 'S6', label: 'Shared for PIM authorisation', kind: 'Shared' },
  { code: 'S7', label: 'Shared for AIM authorisation', kind: 'Shared' },
  { code: 'A1', label: 'Authorised and accepted', kind: 'Published' },
  { code: 'B1', label: 'Partial sign-off, with comments', kind: 'Published' },
  { code: 'CR', label: 'Issued for construction', kind: 'Published' },
  { code: 'AB', label: 'As-built record', kind: 'Archived' },
]

/** What a new project starts with. A project may add, rename or remove codes afterwards. */
export const defaultSuitability = () => ISO19650_SUITABILITY.map((c) => ({ ...c }))

export const SUITABILITY_KINDS = ['WIP', 'Shared', 'Published', 'Archived']

/** The states a formal revision moves through. */
export const REVISION_STATES = ['Under review', 'Returned', 'Issued', 'Superseded'] as const
export type RevisionState = (typeof REVISION_STATES)[number]
