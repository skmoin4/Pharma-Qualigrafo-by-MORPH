// Derived logic shared with the frontend (ported 1:1 from qualigrafo/src/store.ts and work.ts).
import type { Doc, EvidenceState, ProjectData, Requirement, Role } from './types.ts'

/**
 * Working date (YYYY-MM-DD) for due / overdue logic, in the installation's time zone (APP_TIMEZONE, default UTC).
 * CLOCK_DATE pins the date for automated tests only.
 */
export function today(): string {
  const pinned = process.env.CLOCK_DATE
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function evidenceState(r: Requirement, docs: Doc[]): EvidenceState {
  if (r.applicability === 'Not applicable') return 'Not applicable'
  if (r.applicability === 'Assessment pending') return 'Assessment pending'
  // Withdrawn links (wrong document, voided or superseded document) are history only.
  const ev = r.evidence.filter((e) => e.decision !== 'Withdrawn')
  if (!ev.length) return 'Evidence missing'
  const byId = (id: string) => docs.find((d) => d.id === id)
  if (ev.some((e) => byId(e.doc)?.rev !== e.rev)) return 'Revision changed'
  if (ev.some((e) => e.decision === 'Rejected')) return 'Correction required'
  if (ev.every((e) => e.decision === 'Accepted' && byId(e.doc)?.status === 'Accepted')) return 'Evidence accepted'
  return 'Under assessment'
}

export function coverage(reqs: Requirement[], docs: Doc[]) {
  const required = reqs.filter((r) => r.applicability === 'Required')
  const accepted = required.filter((r) => evidenceState(r, docs) === 'Evidence accepted')
  const pending = reqs.filter((r) => r.applicability === 'Assessment pending')
  const gaps = required.filter((r) => evidenceState(r, docs) !== 'Evidence accepted')
  return { required, accepted, pending, gaps, pct: required.length ? Math.round((accepted.length / required.length) * 100) : null }
}

/** Void and superseded documents are register history: never overdue, never counted. */
export const isActiveDoc = (d: Doc) => d.status !== 'Void' && d.status !== 'Superseded'
export const isOverdue = (d: Doc) => d.due < today() && d.status !== 'Accepted' && isActiveDoc(d)

export function handoverGates(p: ProjectData) {
  const scoped = p.reqs.filter((r) => p.markets.includes(r.market))
  const cov = coverage(scoped, p.docs)
  return [
    { key: 'pending', label: 'Applicability decisions made', n: cov.pending.length, of: scoped.length },
    { key: 'evidence', label: 'Required evidence accepted', n: cov.gaps.length, of: cov.required.length },
    { key: 'docs', label: 'Critical documents accepted', n: p.docs.filter((d) => isActiveDoc(d) && d.critical && d.status !== 'Accepted').length, of: p.docs.filter((d) => isActiveDoc(d) && d.critical).length },
    { key: 'comments', label: 'Technical comments closed', n: p.pins.filter((x) => x.status === 'Open').length, of: p.pins.length },
    { key: 'rfis', label: 'RFIs closed', n: p.rfis.filter((x) => x.status !== 'Closed').length, of: p.rfis.length },
    { key: 'insp', label: 'Inspections accepted', n: p.inspections.filter((x) => x.status !== 'Accepted').length, of: p.inspections.length },
    { key: 'find', label: 'Consistency findings dispositioned', n: p.findings.filter((x) => x.status === 'Open').length, of: p.findings.length },
    { key: 'gaps', label: 'Corrective actions closed', n: p.actions.filter((x) => x.status !== 'Closed').length, of: p.actions.length },
    { key: 'ncr', label: 'Non-conformances closed', n: p.ncrs.filter((x) => x.status !== 'Closed').length, of: p.ncrs.length },
    { key: 'chg', label: 'Changes resolved', n: p.changes.filter((x) => x.status === 'Impact review' || x.status === 'Proposed').length, of: p.changes.length },
  ]
}

/** Who must act next on a document that is under review. */
export const expectedSigner = (signStage: number): Role => (signStage === 0 ? 'Consultant' : 'Owner / QA')

export function stats(p: ProjectData) {
  const scoped = p.reqs.filter((r) => p.markets.includes(r.market))
  const cov = coverage(scoped, p.docs)
  const overdue = p.docs.filter(isOverdue)
  const critGaps = cov.gaps.filter((r) => r.critical).length
  const critNcr = p.ncrs.filter((n) => n.severity === 'Critical' && n.status !== 'Closed').length
  const stale = scoped.filter((r) => evidenceState(r, p.docs) === 'Revision changed').length
  return {
    required: cov.required.length,
    accepted: cov.accepted.length,
    pending: cov.pending.length,
    gaps: cov.gaps.length,
    pct: cov.pct,
    overdue: overdue.length,
    criticalGaps: critGaps,
    criticalNcrs: critNcr,
    stale,
    attention: overdue.length > 0 || critGaps > 0 || stale > 0 || critNcr > 0,
    gates: handoverGates(p),
  }
}
