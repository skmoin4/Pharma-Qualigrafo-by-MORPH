import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { projectIndex, projectMarkets, seedNcrs, seedRisks, seedActions, seedChanges, seedDocs, seedFindings, seedInspections, seedPins, seedReqs, seedRfis, seedUpdates } from './data/seed'
import type { Applicability, AuditEvent, BaselineRec, Change, Doc, EvidenceState, Finding, GapAction, Inspection, MarketKey, Pin, Profile, RegUpdate, Requirement, Rfi, Role, Scope, Facility, Snapshot, ToastMsg, Notice, Automation, ImportBatch, IssuedPackage, EventCategory, Risk, Ncr, NcrSeverity, Rating } from './types'

export const TODAY = '2026-10-16'
const now = () => new Date().toISOString()
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** Everything that belongs to one project workspace. */
export interface ProjectData {
  profile: Profile
  markets: MarketKey[]
  docs: Doc[]
  reqs: Requirement[]
  pins: Pin[]
  updates: RegUpdate[]
  actions: GapAction[]
  rfis: Rfi[]
  inspections: Inspection[]
  findings: Finding[]
  changes: Change[]
  snapshots: Snapshot[]
  baselines: BaselineRec[]
  audit: AuditEvent[]
  baseline: number
  revitMode: boolean
  events: Notice[]
  automation: Automation
  imports: ImportBatch[]
  issued: IssuedPackage[]
  risks: Risk[]
  ncrs: Ncr[]
}
const KEYS: (keyof ProjectData)[] = ['profile', 'markets', 'docs', 'reqs', 'pins', 'updates', 'actions', 'rfis', 'inspections', 'findings', 'changes', 'snapshots', 'baselines', 'audit', 'baseline', 'revitMode', 'events', 'automation', 'imports', 'issued', 'risks', 'ncrs']

export function makeProject(id: string): ProjectData {
  const profile = clone(projectIndex.find((p) => p.id === id) ?? projectIndex[0])
  const base: ProjectData = {
    profile,
    markets: [...(projectMarkets[id] ?? ['SA'])],
    docs: clone(seedDocs), reqs: clone(seedReqs), pins: clone(seedPins), updates: clone(seedUpdates), actions: clone(seedActions),
    rfis: clone(seedRfis), inspections: clone(seedInspections), findings: clone(seedFindings), changes: clone(seedChanges),
    snapshots: [], baselines: [{ v: 1, at: '2026-09-01T09:00:00Z', by: 'Owner / QA', reason: 'Initial requirement baseline' }],
    audit: [{ at: now(), role: 'Owner / QA', text: 'Sample project initialised' }], baseline: 1, revitMode: false,
    events: [
      { id: 'EVT-3', at: '2026-10-14T08:00:00Z', category: 'Reminder', text: 'Reminder preview: DOC-004 R02 is waiting for Consultant sign-off.', doc: 'DOC-004', forRole: 'Consultant', read: false },
      { id: 'EVT-2', at: '2026-10-13T10:00:00Z', category: 'Routing', text: 'Signature request routed to Consultant for DOC-001 R02.', doc: 'DOC-001', forRole: 'Consultant', read: false },
      { id: 'EVT-1', at: '2026-10-09T09:00:00Z', category: 'Issue', text: 'DOC-003 R03 fully signed; controlled issue manifest generated (prototype).', doc: 'DOC-003', read: true },
    ],
    automation: { routing: true, reminders: true, autoIssue: true }, imports: [], risks: clone(seedRisks), ncrs: clone(seedNcrs),
    issued: [{ id: 'ISS-001', at: '2026-10-09T09:00:00Z', doc: 'DOC-003', title: 'Purified water P&ID', rev: 3, signers: seedDocs[2].signatures.map((x) => ({ role: x.role, name: x.name, at: x.at })), checksum: null }],
  }
  if (id === 'PRJ-031') {
    // early design stage: mostly missing / draft evidence
    base.docs = base.docs.map((d, i) => ({ ...d, rev: 0, status: i % 3 === 0 ? 'Draft' : 'Missing', signStage: 0, signatures: [], history: [{ rev: 0, status: i % 3 === 0 ? 'Draft' : 'Missing', at: now(), by: 'Contractor' }] }))
    base.reqs = base.reqs.map((r, i) => ({ ...r, evidence: [], applicability: i % 2 ? 'Assessment pending' : r.applicability }))
    base.rfis = []; base.inspections = []; base.findings = []; base.changes = []; base.updates = []; base.actions = []; base.pins = []
    base.ncrs = []; base.risks = base.risks.slice(0, 2).map((r) => ({ ...r, status: 'Open' as const }))
  }
  if (id === 'PRJ-018') {
    // late stage: most evidence accepted
    base.docs = base.docs.map((d, i) => (i < 9 ? { ...d, status: 'Accepted', signStage: 2, signatures: seedDocs[2].signatures.map((s) => ({ ...s, rev: d.rev })) } : d))
    base.reqs = base.reqs.map((r) => ({ ...r, evidence: r.evidence.map((e) => ({ ...e, decision: 'Accepted' as const, reviewedBy: 'Owner / QA' as const, reason: 'Fit for scope (sample).' })) }))
    base.findings = []; base.updates = []; base.actions = []
    base.docs = base.docs.map((d) => ({ ...d, status: 'Accepted', signStage: 2 as const, signatures: seedDocs[2].signatures.map((x) => ({ ...x, rev: d.rev })) }))
    base.reqs = base.reqs.map((r) => ({ ...r, applicability: r.applicability === 'Assessment pending' ? 'Required' as const : r.applicability, evidence: r.evidence.length ? r.evidence : [{ doc: r.discipline === 'CQV' ? 'DOC-008' : 'DOC-003', rev: 1, decision: 'Accepted' as const, note: 'Sample evidence link.', by: 'Contractor' as const, at: now(), reviewedBy: 'Owner / QA' as const, reason: 'Fit for scope (sample).' }] }))
    base.reqs.forEach((r) => r.evidence.forEach((e) => { e.rev = base.docs.find((d) => d.id === e.doc)!.rev }))
    base.rfis = base.rfis.map((x) => ({ ...x, status: 'Closed' as const, response: x.response || 'Resolved (sample).' }))
    base.inspections = base.inspections.map((x) => ({ ...x, status: 'Accepted' as const, decision: 'Accepted (sample).' }))
    base.pins = base.pins.map((x) => ({ ...x, status: 'Closed' as const }))
    base.risks = base.risks.map((x) => ({ ...x, status: 'Closed' as const, decision: 'Closed (sample).' }))
    base.ncrs = base.ncrs.map((x) => (x.status === 'Closed' ? x : { ...x, status: 'Closed' as const, rootCause: x.rootCause ?? 'Sample.', containment: x.containment ?? 'Sample.', correctiveAction: x.correctiveAction ?? 'Sample.', respondedBy: 'Contractor' as const, closedBy: 'Owner / QA' as const, closeReason: 'Verified (sample).' }))
    base.changes = base.changes.map((x) => ({ ...x, status: 'Authorized' as const, impact: Object.fromEntries(Object.keys(x.impact).map((k) => [k, 'Not impacted' as const])), decision: 'Authorised (sample).' }))
  }
  return base
}

interface State extends ProjectData {
  role: Role
  current: string | null
  saved: Record<string, ProjectData>
  toasts: ToastMsg[]
  openProject: (id: string | null) => void
  snapshotOf: (id: string) => ProjectData
  setRole: (r: Role) => void
  setRevit: (v: boolean) => void
  toast: (text: string, tone?: 'ok' | 'warn') => void
  dismissToast: (id: number) => void
  log: (text: string) => void
  saveProfile: (p: { facility: Facility; scope: Scope; phase: string; ownerStandards: string; markets: MarketKey[]; reason: string }) => string | null
  submitDoc: (id: string, note: string) => string | null
  signDoc: (id: string, name: string, reason: string, intent: boolean) => string | null
  setAutomation: (k: keyof Automation, v: boolean) => void
  simulateReminders: () => string | null
  markAllRead: () => void
  addRisk: (r: { title: string; detail: string; system: string; likelihood: Rating; impact: Rating; owner: string; mitigation: string; due: string }) => string | null
  updateRisk: (id: string, status: Risk['status'], note: string) => string | null
  raiseNcr: (n: { title: string; description: string; system: string; severity: NcrSeverity; doc?: string; due: string }) => string | null
  respondNcr: (id: string, rootCause: string, containment: string, correctiveAction: string) => string | null
  closeNcr: (id: string, reason: string) => string | null
  reopenNcr: (id: string, reason: string) => string | null
  generateDeliverables: (g: { tag: string; vendor: string; discipline: string; due: string }) => string | null
  importSource: (docId: string, mode: 'Standalone' | 'Revit', label: string, checksum: string) => string | null
  setSourceRef: (id: string, clause: string, version: string, effective: string, attest: boolean) => string | null
  returnDoc: (id: string, reason: string) => string | null
  newRevision: (id: string) => void
  decideApplicability: (id: string, a: Applicability, rationale: string) => string | null
  linkEvidence: (reqId: string, docId: string, note: string) => string | null
  assessEvidence: (reqId: string, idx: number, accept: boolean, reason: string) => string | null
  addPin: (p: Omit<Pin, 'id' | 'status' | 'replies' | 'model' | 'element' | 'by'>) => string
  replyPin: (id: string, text: string, close: boolean) => string | null
  assessUpdate: (id: string, applicable: boolean, reason: string) => string | null
  addAction: (a: Omit<GapAction, 'id' | 'status'>) => void
  progressAction: (id: string, to: GapAction['status']) => string | null
  raiseRfi: (r: { title: string; discipline: string; system: string; due: string }) => string | null
  answerRfi: (id: string, response: string) => string | null
  closeRfi: (id: string) => string | null
  requestInspection: (i: { title: string; system: string }) => string | null
  submitInspection: (id: string, evidence: string) => string | null
  decideInspection: (id: string, accept: boolean, reason: string) => string | null
  disposeFinding: (id: string, status: 'Resolved' | 'Accepted exception', reason: string) => string | null
  addChange: (c: { title: string; system: string; docs: string[]; reqs: string[] }) => string | null
  assessChangeItem: (id: string, item: string, v: 'Impacted' | 'Not impacted') => void
  decideChange: (id: string, authorize: boolean, reason: string) => string | null
  createSnapshot: () => string
  reset: () => void
}

const pick = (s: ProjectData): ProjectData => KEYS.reduce((o, k) => ({ ...o, [k]: s[k] }), {} as ProjectData)
let tid = 0
const notice = (s: { events: Notice[] }, category: EventCategory, text: string, doc?: string, forRole?: Role): Notice[] => [{ id: `EVT-${s.events.length + 1}`, at: now(), category, text, doc, forRole, read: false }, ...s.events].slice(0, 200)

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...makeProject('PRJ-026'),
      role: 'Consultant',
      current: null,
      saved: {},
      toasts: [],
      openProject: (id) => {
        const s = get()
        const saved = { ...s.saved }
        if (s.current) saved[s.current] = pick(s)
        if (id === null) return set({ saved, current: null })
        set({ saved, current: id, ...(saved[id] ?? makeProject(id)) })
      },
      snapshotOf: (id) => {
        const s = get()
        return id === s.current ? pick(s) : s.saved[id] ?? makeProject(id)
      },
      setRole: (role) => set({ role }),
      setRevit: (revitMode) => {
        set({ revitMode })
        get().log(`Input mode set to ${revitMode ? 'Revit connector (simulation)' : 'Standalone'}`)
      },
      toast: (text, tone = 'ok') => {
        const id = ++tid
        set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
        setTimeout(() => get().dismissToast(id), 3800)
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      log: (text) => set((s) => ({ audit: [{ at: now(), role: s.role, text }, ...s.audit].slice(0, 300) })),

      saveProfile: (p) => {
        const s = get()
        if (s.role !== 'Owner / QA') return 'Owner / QA role required to change project scope.'
        if (!p.reason.trim()) return 'A change rationale is required.'
        if (!p.markets.length) return 'Select at least one target market.'
        const material = p.facility !== s.profile.facility || p.scope !== s.profile.scope
        const v = s.baseline + 1
        set({
          profile: { ...s.profile, facility: p.facility, scope: p.scope, phase: p.phase, ownerStandards: p.ownerStandards },
          markets: [...new Set([s.profile.plantCountry, ...p.markets])],
          baseline: v,
          baselines: [...s.baselines, { v, at: now(), by: s.role, reason: p.reason }],
          reqs: material ? s.reqs.map((r) => ({ ...r, applicability: 'Assessment pending' as const, rationale: 'Facility type or scope changed; reassess applicability.' })) : s.reqs,
        })
        get().log(`Baseline B${v} created: ${p.reason}${material ? ' (applicability reset)' : ''}`)
        return null
      },
      submitDoc: (id, note) => {
        const { role, docs } = get()
        const doc = docs.find((x) => x.id === id)!
        if (role !== 'Contractor') return 'Switch to the Contractor role to submit.'
        if (!note.trim()) return 'Add a submission note.'
        set({ docs: docs.map((x) => (x.id === id ? { ...x, status: 'Under review', signStage: 0, history: [...x.history, { rev: x.rev, status: 'Under review', at: now(), by: role, note }] } : x)) })
        get().log(`${doc.id} R${doc.rev} submitted for review`)
        if (get().automation.routing) set((st) => ({ events: notice(st, 'Routing', `${doc.id} R${doc.rev} submitted. Signature request routed to Consultant.`, doc.id, 'Consultant') }))
        return null
      },
      signDoc: (id, name, reason, intent) => {
        const { role, docs } = get()
        const doc = docs.find((x) => x.id === id)!
        const expected: Role = doc.signStage === 0 ? 'Consultant' : 'Owner / QA'
        if (doc.status !== 'Under review' || doc.signStage === 2) return 'Document is not awaiting sign-off.'
        if (role !== expected) return `Awaiting ${expected}. Switch role to sign this stage.`
        if (!name.trim() || !reason.trim()) return 'Name and reason are required.'
        if (!intent) return 'Explicit confirmation required: tick that you reviewed this exact revision.'
        const stage = (doc.signStage + 1) as 0 | 1 | 2
        const done = stage === 2
        set({
          docs: docs.map((x) =>
            x.id === id ? { ...x, signStage: stage, status: done ? 'Accepted' : x.status, signatures: [...x.signatures, { role, name, at: now(), rev: x.rev, reason }], history: done ? [...x.history, { rev: x.rev, status: 'Accepted', at: now(), by: role, note: reason }] : x.history } : x,
          ),
        })
        get().log(`${doc.id} R${doc.rev} sign-off by ${role}${done ? ' - revision accepted' : ''}`)
        set((st) => {
          let ev = notice(st, 'Signature', `${role} signed ${doc.id} R${doc.rev} (prototype sign-off).`, doc.id)
          if (!done && st.automation.routing) ev = notice({ events: ev }, 'Routing', `${doc.id} R${doc.rev} automatically routed to Owner / QA for stage 2.`, doc.id, 'Owner / QA')
          if (done) {
            ev = notice({ events: ev }, 'Issue status', `${doc.id} R${doc.rev} accepted. Dependent evidence and readiness recalculated.`, doc.id)
            if (st.automation.autoIssue) {
              const d2 = st.docs.find((x) => x.id === id)!
              ev = notice({ events: ev }, 'Issue', `Controlled issue manifest generated for ${doc.id} R${doc.rev} (prototype, no signed file).`, doc.id)
              return { events: ev, issued: [{ id: `ISS-${String(st.issued.length + 1).padStart(3, '0')}`, at: now(), doc: id, title: doc.title, rev: doc.rev, signers: d2.signatures.map((x) => ({ role: x.role, name: x.name, at: x.at })), checksum: d2.checksum ?? null }, ...st.issued] }
            }
          }
          return { events: ev }
        })
        return null
      },
      returnDoc: (id, reason) => {
        const { role, docs } = get()
        if (role === 'Contractor') return 'Only Consultant or Owner / QA can return a document.'
        if (!reason.trim()) return 'Explain the required changes.'
        set({ docs: docs.map((x) => (x.id === id ? { ...x, status: 'Changes requested', signStage: 0, history: [...x.history, { rev: x.rev, status: 'Changes requested', at: now(), by: role, note: reason }] } : x)) })
        get().log(`${id} returned for changes`)
        set((st) => ({ events: notice(st, 'Issue status', `${id} returned for changes: approval route cancelled. Earlier sign-offs are kept as history only.`, id, 'Contractor') }))
        return null
      },
      newRevision: (id) => {
        const { role, docs } = get()
        set({ docs: docs.map((x) => (x.id === id ? { ...x, rev: x.rev + 1, status: 'Draft', signStage: 0, history: [...x.history, { rev: x.rev + 1, status: 'Draft', at: now(), by: role }] } : x)) })
        get().log(`${id} new revision started - linked evidence needs reassessment`)
        const prev = docs.find((x) => x.id === id)!.rev
        set((st) => ({ events: notice(st, 'Revision', `${id} R${prev + 1} started. Earlier signatures stay with R${prev} only; fresh approval is required.`, id) }))
      },
      addRisk: (r) => {
        if (!r.title.trim() || !r.mitigation.trim() || !r.owner.trim()) return 'Title, owner and mitigation are required.'
        const id = `RSK-${String(get().risks.length + 1).padStart(3, '0')}`
        set({ risks: [...get().risks, { ...r, id, status: 'Open' }] })
        get().log(`${id} risk raised (rating ${r.likelihood * r.impact})`)
        return null
      },
      updateRisk: (id, status, note) => {
        const { role, risks } = get()
        if (!note.trim()) return 'A note is required for every risk status change.'
        if ((status === 'Closed' || status === 'Accepted') && role === 'Contractor') return 'Only a reviewer can close or accept a risk.'
        set({ risks: risks.map((x) => (x.id === id ? { ...x, status, decision: note } : x)) })
        get().log(`${id} -> ${status}`)
        return null
      },
      raiseNcr: (n) => {
        if (!n.title.trim() || !n.description.trim()) return 'Title and description are required.'
        const id = `NCR-${String(get().ncrs.length + 1).padStart(3, '0')}`
        set({ ncrs: [...get().ncrs, { ...n, id, raisedBy: get().role, raisedAt: now(), status: 'Open' }] })
        get().log(`${id} raised (${n.severity})`)
        set((s2) => ({ events: notice(s2, 'Issue status', `${id} (${n.severity}) raised against ${n.system}. Contractor response required.`, n.doc, 'Contractor') }))
        return null
      },
      respondNcr: (id, rootCause, containment, correctiveAction) => {
        if (get().role !== 'Contractor') return 'The responsible contractor submits the NCR response.'
        if (!rootCause.trim() || !containment.trim() || !correctiveAction.trim()) return 'Root cause, containment and corrective action are all required.'
        set({ ncrs: get().ncrs.map((x) => (x.id === id ? { ...x, status: 'Response submitted', rootCause, containment, correctiveAction, respondedBy: 'Contractor' } : x)) })
        get().log(`${id} response submitted`)
        return null
      },
      closeNcr: (id, reason) => {
        const { role, ncrs } = get()
        const n = ncrs.find((x) => x.id === id)!
        if (role === 'Contractor') return 'Only an independent reviewer can verify and close an NCR.'
        if (n.severity === 'Critical' && role !== 'Owner / QA') return 'A Critical NCR can only be closed by Owner / QA.'
        if (n.status !== 'Response submitted') return 'The contractor must submit a response before closure.'
        if (!reason.trim()) return 'Record how the corrective action was verified.'
        set({ ncrs: ncrs.map((x) => (x.id === id ? { ...x, status: 'Closed', closedBy: role, closeReason: reason } : x)) })
        get().log(`${id} verified and closed`)
        return null
      },
      reopenNcr: (id, reason) => {
        if (get().role === 'Contractor') return 'Only a reviewer can reopen an NCR.'
        if (!reason.trim()) return 'Explain why the response is not accepted.'
        set({ ncrs: get().ncrs.map((x) => (x.id === id ? { ...x, status: 'Open', closeReason: undefined, closedBy: undefined } : x)) })
        get().log(`${id} returned to contractor: ${reason}`)
        return null
      },
      generateDeliverables: (g) => {
        const st = get()
        if (st.role === 'Contractor') return 'Only Consultant or Owner / QA can generate a deliverable package.'
        const tag = g.tag.trim(); const vendor = g.vendor.trim()
        if (!tag || !vendor) return 'Equipment tag and vendor are required.'
        const kinds: [string, boolean][] = [['Vendor datasheet', false], ['Approved-drawing submission', false], ['O&M manual', false]]
        if (st.docs.some((d) => d.system === tag && d.owner === vendor && d.title.startsWith(`${tag} · `))) return 'This package already exists for the same tag and vendor.'
        let n = Math.max(...st.docs.map((d) => Number(d.id.split('-')[1])))
        const added: Doc[] = kinds.map(([t]) => ({ id: `DOC-${String(++n).padStart(3, '0')}`, title: `${tag} · ${t}`, discipline: g.discipline, system: tag, rev: 0, status: 'Draft' as const, owner: vendor, due: g.due, critical: false, signStage: 0 as const, signatures: [], history: [{ rev: 0, status: 'Draft' as const, at: now(), by: st.role }] }))
        set({ docs: [...st.docs, ...added] })
        get().log(`Draft vendor package generated for ${tag} (${vendor}): ${added.map((a) => a.id).join(', ')}`)
        set((s2) => ({ events: notice(s2, 'Routing', `Draft package for ${tag}: ${added.length} deliverables assigned to ${vendor}. Confirm requirements before treating them as required evidence.`) }))
        return null
      },
      setAutomation: (k, v) => {
        set((st) => ({ automation: { ...st.automation, [k]: v } }))
        get().log(`Automation rule ${k} ${v ? 'enabled' : 'disabled'}`)
      },
      markAllRead: () => set((st) => ({ events: st.events.map((e) => ({ ...e, read: true })) })),
      simulateReminders: () => {
        const st = get()
        if (!st.automation.reminders) return 'Reminder rule is disabled.'
        const waiting = st.docs.filter((d) => d.status === 'Under review')
        if (!waiting.length) return 'No documents are waiting for sign-off.'
        let ev = st.events
        waiting.forEach((d) => {
          const who: Role = d.signStage === 0 ? 'Consultant' : 'Owner / QA'
          ev = notice({ events: ev }, 'Reminder', `Reminder preview: ${d.id} R${d.rev} is waiting for ${who}. A deadline never approves a document.`, d.id, who)
        })
        set({ events: ev })
        get().log(`Reminder preview cycle: ${waiting.length} waiting`)
        return null
      },
      importSource: (docId, mode, label, checksum) => {
        const st = get()
        const d = st.docs.find((x) => x.id === docId)!
        if (!label.trim()) return 'Identify the source file or model snapshot.'
        if (st.imports.some((i) => i.doc === docId && i.checksum === checksum)) return 'Duplicate source: this checksum was already imported for this document.'
        const cancelled = d.status === 'Under review'
        const toRev = d.rev + 1
        set({
          docs: st.docs.map((x) => (x.id === docId ? { ...x, rev: toRev, status: 'Draft', signStage: 0, source: mode, checksum, history: [...x.history, { rev: toRev, status: 'Draft', at: now(), by: st.role, note: `${mode} source imported: ${label}` }] } : x)),
          imports: [{ id: `IMP-${String(st.imports.length + 1).padStart(3, '0')}`, at: now(), mode, doc: docId, fromRev: d.rev, toRev, checksum, label, cancelledRoute: cancelled }, ...st.imports],
        })
        set((s2) => {
          let ev = notice(s2, 'Source', `${mode} source imported for ${docId}: new draft R${toRev}. The previous revision is untouched; fresh approval is required.`, docId)
          if (cancelled) ev = notice({ events: ev }, 'Issue status', `Pending approval route for ${docId} R${d.rev} cancelled because the source changed.`, docId)
          return { events: ev }
        })
        get().log(`${mode} source imported: ${docId} R${toRev}`)
        return null
      },
      setSourceRef: (id, clause, version, effective, attest) => {
        if (get().role === 'Contractor') return 'Only a reviewer can record source references.'
        if (attest && (!clause.trim() || !version.trim() || !effective.trim())) return 'Clause, source version and effective date are all required before attesting.'
        set({ reqs: get().reqs.map((x) => (x.id === id ? { ...x, clause, sourceVersion: version, effective, sourceAttested: attest } : x)) })
        get().log(`${id} source reference ${attest ? 'recorded (user-attested, not a released rule pack)' : 'saved as draft'}`)
        return null
      },
      decideApplicability: (id, a, rationale) => {
        if (get().role === 'Contractor') return 'A contractor cannot decide applicability.'
        if (!rationale.trim()) return 'Decision rationale is required.'
        set({ reqs: get().reqs.map((x) => (x.id === id ? { ...x, applicability: a, rationale } : x)) })
        get().log(`${id} applicability: ${a}`)
        return null
      },
      linkEvidence: (reqId, docId, note) => {
        const { reqs, docs, role } = get()
        const doc = docs.find((x) => x.id === docId)!
        const req = reqs.find((x) => x.id === reqId)!
        if (!note.trim()) return 'State what this evidence supports.'
        if (doc.status === 'Missing') return 'A missing document cannot be linked as evidence.'
        if (req.evidence.some((e) => e.doc === docId && e.rev === doc.rev)) return 'This revision is already linked.'
        set({ reqs: reqs.map((x) => (x.id === reqId ? { ...x, evidence: [...x.evidence, { doc: docId, rev: doc.rev, decision: 'Pending', note, by: role, at: now() }] } : x)) })
        get().log(`Evidence linked ${reqId} <- ${docId} R${doc.rev}`)
        return null
      },
      assessEvidence: (reqId, idx, accept, reason) => {
        const { reqs, docs, role } = get()
        const req = reqs.find((x) => x.id === reqId)!
        const e = req.evidence[idx]
        const doc = docs.find((x) => x.id === e.doc)!
        if (role === 'Contractor') return 'Contractors cannot assess evidence.'
        if (!reason.trim()) return 'Rationale is required.'
        if (e.by === role) return 'Self-acceptance is blocked. Switch to another reviewer role.'
        if (accept && (doc.rev !== e.rev || doc.status !== 'Accepted')) return 'Only a current, accepted document revision can satisfy this requirement.'
        set({ reqs: reqs.map((x) => (x.id === reqId ? { ...x, evidence: x.evidence.map((v, i) => (i === idx ? { ...v, decision: accept ? 'Accepted' : 'Rejected', reason, reviewedBy: role } : v)) } : x)) })
        get().log(`Evidence ${accept ? 'accepted' : 'rejected'}: ${reqId} <- ${e.doc} R${e.rev}`)
        return null
      },
      addPin: (p) => {
        const id = `CMT-${String(get().pins.length + 1).padStart(3, '0')}`
        set({ pins: [...get().pins, { ...p, id, status: 'Open', replies: [], model: null, element: null, by: get().role }] })
        get().log(`Anchored comment ${id} created`)
        return id
      },
      replyPin: (id, text, close) => {
        const { role, pins } = get()
        if (!text.trim()) return 'Enter a response or closure rationale.'
        if (close && role === 'Contractor') return 'Only a reviewer can close a comment.'
        set({ pins: pins.map((x) => (x.id === id ? { ...x, status: close ? 'Closed' : x.status, replies: [...x.replies, { by: role, text, at: now() }] } : x)) })
        get().log(`${close ? 'Closed' : 'Responded to'} ${id}`)
        return null
      },
      assessUpdate: (id, applicable, reason) => {
        const { role, updates, reqs, baseline, baselines } = get()
        if (role !== 'Owner / QA') return 'Owner / QA role required.'
        if (!reason.trim()) return 'Rationale is required.'
        const u = updates.find((x) => x.id === id)!
        if (u.status !== 'Awaiting assessment') return 'Already assessed.'
        set({
          updates: updates.map((x) => (x.id === id ? { ...x, status: applicable ? 'Applied to draft baseline' : 'Not applicable', reason } : x)),
          baseline: applicable ? baseline + 1 : baseline,
          baselines: applicable ? [...baselines, { v: baseline + 1, at: now(), by: role, reason: `${id}: ${reason}` }] : baselines,
          reqs: applicable ? reqs.map((x) => (u.reqs.includes(x.id) ? { ...x, evidence: x.evidence.map((e) => ({ ...e, decision: 'Pending' as const })) } : x)) : reqs,
        })
        get().log(applicable ? `${id} applicable: baseline B${baseline + 1} created, affected evidence reopened` : `${id} judged not applicable`)
        return null
      },
      addAction: (a) => {
        set({ actions: [...get().actions, { ...a, id: `GAP-${String(get().actions.length + 1).padStart(3, '0')}`, status: 'Open' }] })
        get().log('Corrective action assigned')
      },
      progressAction: (id, to) => {
        const { role, actions } = get()
        const a = actions.find((x) => x.id === id)!
        if (to === 'Closed' && (role === 'Contractor' || a.submittedBy === role)) return 'Independent consultant / QA verification is required to close.'
        set({ actions: actions.map((x) => (x.id === id ? { ...x, status: to, submittedBy: to === 'Ready for verification' ? role : x.submittedBy } : x)) })
        get().log(`${id} -> ${to}`)
        return null
      },
      raiseRfi: (r) => {
        if (!r.title.trim()) return 'Enter the question.'
        const id = `RFI-${String(get().rfis.length + 1).padStart(3, '0')}`
        set({ rfis: [...get().rfis, { ...r, id, status: 'Awaiting response', raisedBy: get().role, response: '' }] })
        get().log(`${id} raised`)
        return null
      },
      answerRfi: (id, response) => {
        if (get().role === 'Contractor') return 'Only Consultant or Owner / QA can respond.'
        if (!response.trim()) return 'A response is required.'
        set({ rfis: get().rfis.map((x) => (x.id === id ? { ...x, response, status: 'Answered' } : x)) })
        get().log(`${id} answered`)
        return null
      },
      closeRfi: (id) => {
        const r = get().rfis.find((x) => x.id === id)!
        if (r.raisedBy !== get().role && get().role === 'Contractor') return 'Only the requester or a reviewer can close.'
        set({ rfis: get().rfis.map((x) => (x.id === id ? { ...x, status: 'Closed' } : x)) })
        get().log(`${id} closed`)
        return null
      },
      requestInspection: (i) => {
        if (!i.title.trim() || !i.system.trim()) return 'Title and system are required.'
        const id = `INS-${String(get().inspections.length + 1).padStart(3, '0')}`
        set({ inspections: [...get().inspections, { id, title: i.title, system: i.system, status: 'Requested', evidence: 'Not yet submitted', drawingRev: '—' }] })
        get().log(`${id} requested`)
        return null
      },
      submitInspection: (id, evidence) => {
        if (get().role !== 'Contractor') return 'Switch to the Contractor role to submit inspection evidence.'
        if (!evidence.trim()) return 'Reference the checklist and site evidence.'
        set({ inspections: get().inspections.map((x) => (x.id === id ? { ...x, status: 'Submitted', evidence } : x)) })
        get().log(`${id} submitted`)
        return null
      },
      decideInspection: (id, accept, reason) => {
        if (get().role === 'Contractor') return 'Only a reviewer can decide an inspection.'
        if (!reason.trim()) return 'Decision reason is required.'
        set({ inspections: get().inspections.map((x) => (x.id === id ? { ...x, status: accept ? 'Accepted' : 'Correction required', decision: reason } : x)) })
        get().log(`${id} ${accept ? 'accepted' : 'correction required'}`)
        return null
      },
      disposeFinding: (id, status, reason) => {
        if (get().role === 'Contractor') return 'Only a reviewer can disposition a finding.'
        if (!reason.trim()) return 'A disposition rationale is required.'
        set({ findings: get().findings.map((x) => (x.id === id ? { ...x, status, disposition: reason } : x)) })
        get().log(`${id} ${status}`)
        return null
      },
      addChange: (c) => {
        if (!c.title.trim()) return 'Describe the proposed change.'
        const id = `CHG-${String(get().changes.length + 1).padStart(3, '0')}`
        const impact: Change['impact'] = {}
        ;[...c.docs, ...c.reqs].forEach((k) => (impact[k] = 'Unassessed'))
        set({ changes: [...get().changes, { id, title: c.title, system: c.system, status: 'Impact review', docs: c.docs, reqs: c.reqs, impact }] })
        get().log(`${id} proposed`)
        return null
      },
      assessChangeItem: (id, item, v) => {
        set({ changes: get().changes.map((x) => (x.id === id ? { ...x, impact: { ...x.impact, [item]: v } } : x)) })
        get().log(`${id}: ${item} assessed as ${v}`)
      },
      decideChange: (id, authorize, reason) => {
        const c = get().changes.find((x) => x.id === id)!
        if (get().role !== 'Owner / QA') return 'Owner / QA authorisation required.'
        if (!reason.trim()) return 'A decision reason is required.'
        if (authorize && Object.values(c.impact).includes('Unassessed')) return 'Assess every linked record before authorising.'
        set({ changes: get().changes.map((x) => (x.id === id ? { ...x, status: authorize ? 'Authorized' : 'Rejected', decision: reason } : x)) })
        get().log(`${id} ${authorize ? 'authorised' : 'rejected'}`)
        return null
      },
      createSnapshot: () => {
        const s = get()
        const scoped = s.reqs.filter((r) => s.markets.includes(r.market))
        const rows = scoped.map((r) => ({ id: r.id, title: r.title, market: r.market, applicability: r.applicability, state: evidenceState(r, s.docs), links: r.evidence.map((e) => `${e.doc}/R${e.rev}:${e.decision}`).join('; ') }))
        const cov = coverage(scoped, s.docs)
        const id = `AUD-${String(s.snapshots.length + 1).padStart(3, '0')}`
        set({ snapshots: [{ id, at: now(), by: s.role, baseline: s.baseline, markets: [...s.markets], required: cov.required.length, accepted: cov.accepted.length, blockers: rows.filter((r) => !['Not applicable', 'Evidence accepted'].includes(r.state)).map((r) => `${r.id}: ${r.state}`), rows }, ...s.snapshots] })
        get().log(`Audit snapshot ${id} frozen`)
        return id
      },
      reset: () => {
        const id = get().current
        set({ saved: {}, toasts: [], current: id, ...makeProject(id ?? 'PRJ-026') })
      },
    }),
    {
      name: 'qualigrafo-v4',
      partialize: (s) => ({ ...pick(s), role: s.role, current: s.current, saved: s.saved }),
    },
  ),
)

/* ---------- derived logic ---------- */
export function evidenceState(r: Requirement, docs: Doc[]): EvidenceState {
  if (r.applicability === 'Not applicable') return 'Not applicable'
  if (r.applicability === 'Assessment pending') return 'Assessment pending'
  if (!r.evidence.length) return 'Evidence missing'
  const byId = (id: string) => docs.find((d) => d.id === id)
  if (r.evidence.some((e) => byId(e.doc)?.rev !== e.rev)) return 'Revision changed'
  if (r.evidence.some((e) => e.decision === 'Rejected')) return 'Correction required'
  if (r.evidence.every((e) => e.decision === 'Accepted' && byId(e.doc)?.status === 'Accepted')) return 'Evidence accepted'
  return 'Under assessment'
}

export function coverage(reqs: Requirement[], docs: Doc[]) {
  const required = reqs.filter((r) => r.applicability === 'Required')
  const accepted = required.filter((r) => evidenceState(r, docs) === 'Evidence accepted')
  const pending = reqs.filter((r) => r.applicability === 'Assessment pending')
  const gaps = required.filter((r) => evidenceState(r, docs) !== 'Evidence accepted')
  return { required, accepted, pending, gaps, pct: required.length ? Math.round((accepted.length / required.length) * 100) : null }
}

export const isOverdue = (d: Doc) => d.due < TODAY && d.status !== 'Accepted'

/** Handover document gate: every condition listed separately, never one blended score. */
export function handoverGates(p: ProjectData) {
  const scoped = p.reqs.filter((r) => p.markets.includes(r.market))
  const cov = coverage(scoped, p.docs)
  const gates = [
    { key: 'pending', label: 'Applicability decisions made', n: cov.pending.length, of: scoped.length, note: 'Requirements still “Assessment pending”', page: 'requirements' },
    { key: 'evidence', label: 'Required evidence accepted', n: cov.gaps.length, of: cov.required.length, note: 'Required topics without accepted, current evidence', page: 'requirements' },
    { key: 'docs', label: 'Critical documents accepted', n: p.docs.filter((d) => d.critical && d.status !== 'Accepted').length, of: p.docs.filter((d) => d.critical).length, note: 'Critical records not yet accepted', page: 'documents' },
    { key: 'comments', label: 'Technical comments closed', n: p.pins.filter((x) => x.status === 'Open').length, of: p.pins.length, note: 'Open anchored comments', page: 'comments' },
    { key: 'rfis', label: 'RFIs closed', n: p.rfis.filter((x) => x.status !== 'Closed').length, of: p.rfis.length, note: 'RFIs awaiting response or closure', page: 'rfis' },
    { key: 'insp', label: 'Inspections accepted', n: p.inspections.filter((x) => x.status !== 'Accepted').length, of: p.inspections.length, note: 'Inspections not yet accepted', page: 'inspections' },
    { key: 'find', label: 'Consistency findings dispositioned', n: p.findings.filter((x) => x.status === 'Open').length, of: p.findings.length, note: 'Open findings', page: 'findings' },
    { key: 'gaps', label: 'Corrective actions closed', n: p.actions.filter((x) => x.status !== 'Closed').length, of: p.actions.length, note: 'Actions not independently verified', page: 'actions' },
    { key: 'ncr', label: 'Non-conformances closed', n: p.ncrs.filter((x) => x.status !== 'Closed').length, of: p.ncrs.length, note: 'NCRs not yet verified and closed', page: 'ncrs' },
    { key: 'chg', label: 'Changes resolved', n: p.changes.filter((x) => x.status === 'Impact review' || x.status === 'Proposed').length, of: p.changes.length, note: 'Changes without an authorisation decision', page: 'changes' },
  ]
  return gates
}
