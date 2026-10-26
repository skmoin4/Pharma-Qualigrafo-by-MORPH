// Portfolio derivations (Phase 3 / P1), computed on the server so the portfolio does not need full project payloads.
// workFor was ported 1:1 from qualigrafo/src/work.ts; projectSummary adds what the portfolio cards show.
import { coverage, evidenceState, isActiveDoc, isOverdue, stats, today } from './rules.ts'
import type { AuditEvent, ProjectData, Role } from './types.ts'

export interface WorkItem { project: string; kind: string; title: string; detail: string; due?: string; page: string; overdue: boolean }

/** What each role has to do next, derived from record state (no invented tasks). */
export function workFor(id: string, p: ProjectData, role: Role): WorkItem[] {
  const now = today()
  const w: WorkItem[] = []
  const add = (kind: string, title: string, detail: string, page: string, due?: string) => w.push({ project: id, kind, title, detail, due, page, overdue: !!due && due < now })

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

/** Everything a portfolio card, My work and Regulatory watch need for one project — and nothing more. */
export function projectSummary(p: ProjectData, role: Role, scope: string | null, recent: AuditEvent[]) {
  const st = stats(p)
  const scoped = p.reqs.filter((r) => p.markets.includes(r.market))
  const cov = coverage(scoped, p.docs)
  const open = p.docs.filter((d) => isActiveDoc(d) && d.status !== 'Accepted')
  const flags: string[] = []
  if (st.overdue) flags.push(`${st.overdue} overdue`)
  if (st.criticalGaps) flags.push(`${st.criticalGaps} critical gap${st.criticalGaps > 1 ? 's' : ''}`)
  if (cov.pending.length) flags.push(`${cov.pending.length} undecided`)
  if (st.criticalNcrs) flags.push(`${st.criticalNcrs} critical NCR`)
  const stale = scoped.filter((r) => evidenceState(r, p.docs) === 'Revision changed').length
  if (stale) flags.push(`${stale} stale`)
  return {
    role, scope,
    profile: p.profile, markets: p.markets, baseline: p.baseline,
    stats: { ...st, gates: st.gates.map(({ key, label, n, of }) => ({ key, label, n, of })), upcoming: open.map((d) => d.due).sort()[0] ?? null, flags },
    work: workFor(p.profile.id, p, role),
    updates: p.updates.map((u) => ({ id: u.id, market: u.market, title: u.title, status: u.status, reqs: u.reqs })),
    deadlines: [...open].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 7).map((d) => ({ id: d.id, title: d.title, owner: d.owner, due: d.due, overdue: isOverdue(d) })),
    recent: recent.slice(0, 4),
  }
}
export type ProjectSummary = ReturnType<typeof projectSummary>
