// Who holds each open item of the open project. Portfolio work items and figures are computed on the server
// (server/src/domain/work.ts) from the same record states.
import { isActiveDoc } from './store'
import type { ProjectData } from './store'
import type { PageKey } from './components/ui'

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
