import { activeDocs, coverage, evidenceState, handoverGates, isActiveDoc, isOverdue, TODAY } from './store'
import type { ProjectData } from './store'
import type { Role } from './types'
import type { PageKey } from './components/ui'

export interface WorkItem {
  project: string
  kind: string
  title: string
  detail: string
  due?: string
  page: PageKey
  overdue: boolean
}

/** What each role has to do next, derived from record state (no invented tasks). */
export function workFor(id: string, p: ProjectData, role: Role): WorkItem[] {
  const w: WorkItem[] = []
  const add = (kind: string, title: string, detail: string, page: PageKey, due?: string) => w.push({ project: id, kind, title, detail, due, page, overdue: !!due && due < TODAY })

  p.docs.forEach((d) => {
    if (role === 'Contractor' && ['Missing', 'Draft', 'Changes requested'].includes(d.status)) add(d.status === 'Changes requested' ? 'Resubmit' : 'Submit', d.title, `${d.id} · ${d.status} · ${d.owner}`, 'documents', d.due)
    if (d.status === 'Under review') {
      const exp: Role = d.signStage === 0 ? 'Consultant' : 'Owner / QA'
      if (exp === role) add('Sign-off', d.title, `${d.id} R${String(d.rev).padStart(2, '0')} · stage ${d.signStage + 1} of 2`, 'reviews', d.due)
    }
  })
  p.rfis.forEach((r) => {
    if (r.status === 'Awaiting response' && role !== 'Contractor') add('RFI response', r.title, `${r.id} · ${r.discipline}`, 'rfis', r.due)
    if (r.status === 'Answered' && r.raisedBy === role) add('Close RFI', r.title, `${r.id} · answered`, 'rfis', r.due)
  })
  p.inspections.forEach((i) => {
    if (role === 'Contractor' && (i.status === 'Requested' || i.status === 'Correction required')) add('Inspection evidence', i.title, `${i.id} · ${i.system}`, 'inspections')
    if (role !== 'Contractor' && i.status === 'Submitted') add('Inspection decision', i.title, `${i.id} · ${i.system}`, 'inspections')
  })
  if (role !== 'Contractor') p.findings.filter((f) => f.status === 'Open').forEach((f) => add('Finding', f.title, `${f.id} · ${f.severity}`, 'findings'))
  p.actions.forEach((a) => {
    if (role === 'Contractor' && a.status === 'Open') add('Corrective action', a.title, `${a.id} · ${a.owner}`, 'actions', a.due)
    if (role !== 'Contractor' && a.status === 'Ready for verification' && a.submittedBy !== role) add('Verify action', a.title, `${a.id}`, 'actions', a.due)
  })
  p.ncrs.forEach((n) => {
    if (role === 'Contractor' && n.status === 'Open') add('NCR response', n.title, `${n.id} · ${n.severity}`, 'ncrs', n.due)
    if (role !== 'Contractor' && n.status === 'Response submitted' && (n.severity !== 'Critical' || role === 'Owner / QA')) add('Verify NCR', n.title, `${n.id} · ${n.severity}`, 'ncrs', n.due)
  })
  if (role === 'Owner / QA') p.risks.filter((r) => r.status === 'Open' && r.likelihood * r.impact >= 15).forEach((r) => add('High risk', r.title, `${r.id} · rating ${r.likelihood * r.impact}`, 'risks', r.due))
  if (role === 'Owner / QA') {
    p.updates.filter((u) => u.status === 'Awaiting assessment').forEach((u) => add('Regulatory update', u.title, `${u.id} · ${u.market}`, 'updates'))
    p.changes.filter((c) => c.status === 'Impact review').forEach((c) => add('Authorise change', c.title, `${c.id} · ${c.system}`, 'changes'))
  }
  if (role !== 'Contractor') {
    const pend = p.reqs.filter((r) => p.markets.includes(r.market) && r.applicability === 'Assessment pending').length
    if (pend) add('Applicability', `${pend} requirement(s) need an applicability decision`, 'Reviewer rationale required', 'requirements')
  }
  return w
}

export function stats(p: ProjectData) {
  const scoped = p.reqs.filter((r) => p.markets.includes(r.market))
  const cov = coverage(scoped, p.docs)
  const gates = handoverGates(p)
  const overdue = p.docs.filter(isOverdue)
  const critGaps = cov.gaps.filter((r) => r.critical).length
  const upcoming = activeDocs(p.docs).filter((d) => d.status !== 'Accepted').map((d) => d.due).sort()[0]
  const flags: string[] = []
  if (overdue.length) flags.push(`${overdue.length} overdue`)
  if (critGaps) flags.push(`${critGaps} critical gap${critGaps > 1 ? 's' : ''}`)
  if (cov.pending.length) flags.push(`${cov.pending.length} undecided`)
  const critNcr = p.ncrs.filter((n) => n.severity === 'Critical' && n.status !== 'Closed').length
  if (critNcr) flags.push(`${critNcr} critical NCR`)
  const stale = scoped.filter((r) => evidenceState(r, p.docs) === 'Revision changed').length
  if (stale) flags.push(`${stale} stale`)
  return { cov, gates, overdue, flags, upcoming, attention: overdue.length > 0 || critGaps > 0 || stale > 0 || critNcr > 0 }
}

export type Holder = 'Contractor' | 'Consultant' | 'Owner / QA'
export interface Ball { holder: Holder; kind: string; title: string; ref: string; due?: string; page: PageKey }

/** Who currently holds each open item ("ball in court"), derived from status only. */
export function ballInCourt(p: ProjectData): Ball[] {
  const b: Ball[] = []
  p.docs.forEach((d) => {
    if (d.status === 'Accepted' || !isActiveDoc(d)) return
    if (d.status === 'Under review') b.push({ holder: d.signStage === 0 ? 'Consultant' : 'Owner / QA', kind: 'Sign-off', title: d.title, ref: d.id, due: d.due, page: 'reviews' })
    else b.push({ holder: 'Contractor', kind: d.status === 'Changes requested' ? 'Resubmit' : d.status === 'Missing' ? 'Provide' : 'Complete draft', title: d.title, ref: d.id, due: d.due, page: 'documents' })
  })
  p.rfis.forEach((r) => { if (r.status === 'Awaiting response') b.push({ holder: 'Consultant', kind: 'RFI response', title: r.title, ref: r.id, due: r.due, page: 'rfis' }) })
  p.ncrs.forEach((n) => { if (n.status === 'Open') b.push({ holder: 'Contractor', kind: 'NCR response', title: n.title, ref: n.id, due: n.due, page: 'ncrs' }); if (n.status === 'Response submitted') b.push({ holder: n.severity === 'Critical' ? 'Owner / QA' : 'Consultant', kind: 'NCR verification', title: n.title, ref: n.id, due: n.due, page: 'ncrs' }) })
  p.inspections.forEach((i) => { if (i.status === 'Requested' || i.status === 'Correction required') b.push({ holder: 'Contractor', kind: 'Inspection evidence', title: i.title, ref: i.id, page: 'inspections' }); if (i.status === 'Submitted') b.push({ holder: 'Consultant', kind: 'Inspection decision', title: i.title, ref: i.id, page: 'inspections' }) })
  p.actions.forEach((a) => { if (a.status === 'Open') b.push({ holder: 'Contractor', kind: 'Corrective action', title: a.title, ref: a.id, due: a.due, page: 'actions' }); if (a.status === 'Ready for verification') b.push({ holder: 'Consultant', kind: 'Verify action', title: a.title, ref: a.id, due: a.due, page: 'actions' }) })
  p.changes.forEach((c) => { if (c.status === 'Impact review') b.push({ holder: 'Owner / QA', kind: 'Authorise change', title: c.title, ref: c.id, page: 'changes' }) })
  return b
}
