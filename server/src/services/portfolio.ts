// Portfolio summaries (Phase 3 / P1). Instead of loading every project in full (≈25 queries and the whole payload per
// project), whole-project memberships are read with one query per table for all projects at once, selecting only the
// columns the summary needs. Vendor-scoped memberships (few) go through loadProject, which applies the scoping rules.
import { prisma } from '../db.ts'
import { projectSummary } from '../domain/work.ts'
import type { ProjectSummary } from '../domain/work.ts'
import type { AuditEvent, Doc, MarketKey, ProjectData, Role } from '../domain/types.ts'
import { loadProject } from './loadProject.ts'

const day = (d: Date) => d.toISOString().slice(0, 10)
const num = (code: string) => Number(code.slice(code.lastIndexOf('-') + 1))
const byCode = <T extends { code: string }>(a: T[]) => [...a].sort((x, y) => num(x.code) - num(y.code))
function group<T extends { projectId: string }>(rows: T[]) {
  const m = new Map<string, T[]>()
  for (const r of rows) { const a = m.get(r.projectId); if (a) a.push(r); else m.set(r.projectId, [r]) }
  return (id: string) => m.get(id) ?? []
}

/** Lean ProjectData for many projects: only the fields stats, gates and work items read; heavy parts stay empty. */
async function leanProjects(ids: string[]) {
  const where = { projectId: { in: ids } }
  const [projects, docs, reqs, pins, updates, actions, rfis, inspections, findings, changes, ncrs, risks, audit] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: ids } } }),
    prisma.document.findMany({ where, select: { projectId: true, code: true, title: true, rev: true, status: true, owner: true, due: true, critical: true, signStage: true } }),
    prisma.requirement.findMany({ where, select: { projectId: true, code: true, market: true, applicability: true, critical: true, evidence: { select: { rev: true, decision: true, document: { select: { code: true } } } } } }),
    prisma.pin.findMany({ where, select: { projectId: true, status: true } }),
    prisma.regUpdate.findMany({ where, select: { projectId: true, code: true, market: true, title: true, reqs: true, status: true } }),
    prisma.gapAction.findMany({ where, select: { projectId: true, code: true, title: true, owner: true, due: true, status: true, submittedBy: true } }),
    prisma.rfi.findMany({ where, select: { projectId: true, code: true, title: true, discipline: true, status: true, raisedBy: true, due: true } }),
    prisma.inspection.findMany({ where, select: { projectId: true, code: true, title: true, system: true, status: true } }),
    prisma.finding.findMany({ where, select: { projectId: true, code: true, title: true, severity: true, status: true } }),
    prisma.change.findMany({ where, select: { projectId: true, code: true, title: true, system: true, status: true } }),
    prisma.ncr.findMany({ where, select: { projectId: true, code: true, title: true, severity: true, status: true, due: true } }),
    prisma.risk.findMany({ where, select: { projectId: true, code: true, title: true, likelihood: true, impact: true, status: true, due: true } }),
    // The 4 newest audit entries of each project in one query.
    prisma.$queryRaw<{ projectId: string; at: Date; role: string; text: string; userName: string | null }[]>`
      SELECT "projectId", at, role, text, "userName" FROM (
        SELECT "projectId", at, role, text, "userName", row_number() OVER (PARTITION BY "projectId" ORDER BY id DESC) AS rn
        FROM "AuditEvent" WHERE "projectId" = ANY(${ids})) a
      WHERE rn <= 4 ORDER BY "projectId", rn`,
  ])
  const g = { docs: group(docs), reqs: group(reqs), pins: group(pins), updates: group(updates), actions: group(actions), rfis: group(rfis), inspections: group(inspections), findings: group(findings), changes: group(changes), ncrs: group(ncrs), risks: group(risks), audit: group(audit) }
  const out = new Map<string, { data: ProjectData; recent: AuditEvent[] }>()
  for (const p of projects) {
    const data = {
      profile: { id: p.code, name: p.name, client: p.client, site: p.site, industryGroup: p.industryGroup, facilityType: p.facilityType, secondaryFacilityType: p.secondaryFacilityType ?? undefined, customFacilityType: p.customFacilityType ?? undefined, serviceType: p.serviceType, scope: p.scope, projectStage: p.projectStage, bimRequirement: p.bimRequirement ?? undefined, projectCountry: p.projectCountry, ownerStandards: p.ownerStandards, status: p.status, archivedAt: p.archivedAt?.toISOString(), archivedReason: p.archivedReason ?? undefined },
      markets: p.markets as MarketKey[], baseline: p.baseline,
      docs: byCode(g.docs(p.id)).map((d) => ({ id: d.code, title: d.title, rev: d.rev, status: d.status as Doc['status'], owner: d.owner, due: day(d.due), critical: d.critical, signStage: d.signStage as Doc['signStage'] })),
      reqs: byCode(g.reqs(p.id)).map((r) => ({ id: r.code, market: r.market, applicability: r.applicability, critical: r.critical, evidence: r.evidence.map((e) => ({ doc: e.document.code, rev: e.rev, decision: e.decision })) })),
      pins: g.pins(p.id).map((x) => ({ status: x.status })),
      updates: byCode(g.updates(p.id)).map((u) => ({ id: u.code, market: u.market, title: u.title, reqs: u.reqs as string[], status: u.status })),
      actions: byCode(g.actions(p.id)).map((a) => ({ id: a.code, title: a.title, owner: a.owner, due: day(a.due), status: a.status, submittedBy: a.submittedBy ?? undefined })),
      rfis: byCode(g.rfis(p.id)).map((r) => ({ id: r.code, title: r.title, discipline: r.discipline, status: r.status, raisedBy: r.raisedBy, due: day(r.due) })),
      inspections: byCode(g.inspections(p.id)).map((i) => ({ id: i.code, title: i.title, system: i.system, status: i.status })),
      findings: byCode(g.findings(p.id)).map((f) => ({ id: f.code, title: f.title, severity: f.severity, status: f.status })),
      changes: byCode(g.changes(p.id)).map((c) => ({ id: c.code, title: c.title, system: c.system, status: c.status })),
      ncrs: byCode(g.ncrs(p.id)).map((n) => ({ id: n.code, title: n.title, severity: n.severity, status: n.status, due: day(n.due) })),
      risks: byCode(g.risks(p.id)).map((r) => ({ id: r.code, title: r.title, likelihood: r.likelihood, impact: r.impact, status: r.status, due: day(r.due) })),
    } as unknown as ProjectData
    const recent = g.audit(p.id).map((a): AuditEvent => ({ at: a.at.toISOString(), role: a.role as Role, text: a.text, user: a.userName ?? undefined }))
    out.set(p.id, { data, recent })
  }
  return out
}

/** Summaries of every project the user belongs to, in project-code order. */
export async function portfolio(userId: string): Promise<ProjectSummary[]> {
  const ms = await prisma.membership.findMany({ where: { userId }, include: { project: { select: { id: true, code: true } } }, orderBy: { project: { code: 'asc' } } })
  const whole = ms.filter((m) => !m.companyScope)
  const lean = await leanProjects(whole.map((m) => m.projectId))
  return Promise.all(ms.map(async (m) => {
    const role = m.role as Role
    if (!m.companyScope) {
      const l = lean.get(m.projectId)!
      return projectSummary(l.data, role, null, l.recent)
    }
    const full = await loadProject(m.projectId, userId, m.companyScope, role)
    return projectSummary(full, role, m.companyScope, full.audit)
  }))
}
