// Reads one project from the database and returns it in the exact ProjectData shape the frontend store uses.
import { prisma } from '../db.ts'
import type {
  FileMeta, AuditEvent, Company, SystemRec, DisciplineRec, Member, ElementChange, NavStatus, Change, Doc, GapAction, ImportBatch, Inspection, IssuedPackage, MarketKey, Ncr, Notice, Pin, ProjectData, RegUpdate, Requirement, Rfi, Risk, Role, Snapshot,
} from '../domain/types.ts'

export const AUDIT_LIMIT = 300
export const EVENT_LIMIT = 200

const iso = (d: Date) => d.toISOString()
const day = (d: Date) => d.toISOString().slice(0, 10)
const num = (code: string) => Number(code.slice(code.lastIndexOf('-') + 1))
const byCode = <T extends { code: string }>(a: T[]) => [...a].sort((x, y) => num(x.code) - num(y.code))
const opt = <T>(v: T | null): T | undefined => v ?? undefined
/** Pending / delivered requests the add-in never answered count as expired. */
export const navStatus = (n: { id: string; status: string; detail: string | null; createdAt: Date; completedAt: Date | null; expiresAt: Date; requestedByName: string }): NavStatus => ({
  id: n.id, detail: n.detail, by: n.requestedByName, at: iso(n.completedAt ?? n.createdAt),
  status: (n.status === 'Pending' || n.status === 'Delivered') && n.expiresAt < new Date() ? 'Expired' : n.status,
})
type FileRow = { id: string; originalName: string; size: number; mimeType: string; sha256: string; uploadedAt: Date; uploadedByName: string | null }
const fileMeta = (f: FileRow | null): FileMeta | undefined => (f ? { id: f.id, name: f.originalName, size: f.size, mimeType: f.mimeType, sha256: f.sha256, at: iso(f.uploadedAt), by: f.uploadedByName } : undefined)

/** `scope` (vendor company) limits the payload to that company's documents and what hangs off them. */
export async function loadProject(projectId: string, userId: string, scope: string | null = null, role: string | null = null): Promise<ProjectData> {
  const docRef = { select: { code: true } } as const
  const [p, docs, reqs, pins, updates, actions, rfis, inspections, findings, changes, snapshots, baselines, audit, notices, imports, issued, risks, ncrs, companies, systems, disciplines, members, tokens, models] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.document.findMany({ where: { projectId }, include: { file: true, signatures: { orderBy: { at: 'asc' } }, history: { orderBy: { at: 'asc' } } } }),
    prisma.requirement.findMany({ where: { projectId }, include: { evidence: { orderBy: { position: 'asc' }, include: { document: docRef } } } }),
    prisma.pin.findMany({ where: { projectId }, include: { document: docRef, replies: { orderBy: { at: 'asc' } }, navigation: { orderBy: { createdAt: 'desc' }, take: 1 } } }),
    prisma.regUpdate.findMany({ where: { projectId } }),
    prisma.gapAction.findMany({ where: { projectId }, include: { requirement: docRef } }),
    prisma.rfi.findMany({ where: { projectId } }),
    prisma.inspection.findMany({ where: { projectId } }),
    prisma.finding.findMany({ where: { projectId }, include: { document: docRef } }),
    prisma.change.findMany({ where: { projectId }, include: { items: { orderBy: { position: 'asc' } } } }),
    prisma.snapshot.findMany({ where: { projectId }, orderBy: { at: 'desc' } }),
    prisma.baseline.findMany({ where: { projectId }, orderBy: { v: 'asc' } }),
    prisma.auditEvent.findMany({ where: { projectId }, orderBy: { id: 'desc' }, take: AUDIT_LIMIT }),
    prisma.notice.findMany({ where: { projectId }, orderBy: { seq: 'desc' }, take: EVENT_LIMIT, include: { reads: { where: { userId }, select: { userId: true } } } }),
    prisma.importBatch.findMany({ where: { projectId }, orderBy: { at: 'desc' }, include: { document: docRef, file: true } }),
    prisma.issuedPackage.findMany({ where: { projectId }, orderBy: { at: 'desc' }, include: { document: docRef } }),
    prisma.risk.findMany({ where: { projectId } }),
    prisma.ncr.findMany({ where: { projectId }, include: { document: docRef, requirement: docRef } }),
    prisma.company.findMany({ where: { projectId }, orderBy: { name: 'asc' } }),
    prisma.system.findMany({ where: { projectId }, orderBy: { tag: 'asc' } }),
    prisma.discipline.findMany({ where: { projectId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
    prisma.membership.findMany({ where: { projectId }, include: { user: { select: { id: true, name: true, email: true, company: true, active: true } } }, orderBy: { user: { name: 'asc' } } }),
    role === 'Owner / QA' ? prisma.connectorToken.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
    prisma.revitModel.findMany({ where: { projectId }, orderBy: { name: 'asc' }, include: { snapshots: { orderBy: { publishedAt: 'desc' }, take: 10 } } }),
  ])

  const libVersions = new Map((await prisma.libraryVersion.findMany({ where: { id: { in: [...new Set(reqs.map((r) => r.libraryVersionId).filter((x): x is string => !!x))] } }, select: { id: true, version: true } })).map((v) => [v.id, v.version]))
  const out: ProjectData = {
    profile: { id: p.code, name: p.name, client: p.client, site: p.site, facility: p.facility as ProjectData['profile']['facility'], scope: p.scope as ProjectData['profile']['scope'], phase: p.phase, plantCountry: p.plantCountry as MarketKey, ownerStandards: p.ownerStandards, status: p.status as 'Active', archivedAt: p.archivedAt ? iso(p.archivedAt) : undefined, archivedReason: opt(p.archivedReason) },
    markets: p.markets as MarketKey[],
    baseline: p.baseline,
    revitMode: p.revitMode,
    automation: { routing: p.autoRouting, reminders: p.autoReminders, autoIssue: p.autoIssue },

    docs: byCode(docs).map((d): Doc => ({
      id: d.code, title: d.title, discipline: d.discipline, system: d.system, rev: d.rev, status: d.status as Doc['status'], owner: d.owner, due: day(d.due), critical: d.critical,
      signStage: d.signStage as Doc['signStage'], source: opt(d.source) as Doc['source'], checksum: opt(d.checksum), sourceRev: opt(d.sourceRev), file: fileMeta(d.file), number: d.number,
      voided: d.voidedAt ? { reason: d.voidReason ?? '', at: iso(d.voidedAt), by: d.voidedBy ?? '', supersededBy: opt(d.supersededBy) } : undefined,
      signatures: d.signatures.map((s) => ({ role: s.role as Role, name: s.name, at: iso(s.at), rev: s.rev, reason: s.reason, meaning: s.meaning || undefined, email: opt(s.email), checksum: opt(s.checksum), sigHash: opt(s.sigHash) })),
      history: d.history.map((h) => ({ rev: h.rev, status: h.status as Doc['status'], at: iso(h.at), by: h.byRole as Role, note: opt(h.note) })),
    })),

    reqs: byCode(reqs).map((r): Requirement => ({
      id: r.code, title: r.title, market: r.market as MarketKey, topic: r.topic, discipline: r.discipline, system: r.system, applicability: r.applicability as Requirement['applicability'],
      rationale: r.rationale, owner: r.owner, due: day(r.due), critical: r.critical, clause: r.clause, sourceVersion: r.sourceVersion, effective: r.effective, sourceAttested: r.sourceAttested, libraryKey: r.libraryKey, libraryVersion: r.libraryVersionId ? libVersions.get(r.libraryVersionId) ?? null : null,
      evidence: r.evidence.map((e) => ({ id: e.id, doc: e.document.code, rev: e.rev, decision: e.decision as 'Pending', note: e.note, by: e.byRole as Role, at: iso(e.at), reviewedBy: opt(e.reviewedBy) as Role | undefined, reason: opt(e.reason) })),
    })),

    pins: byCode(pins).map((x): Pin => ({
      id: x.code, text: x.text, doc: x.document.code, rev: x.rev, room: x.room, anchored: x.anchored, page: x.page, x: x.x, y: x.y, model: x.model, element: x.element, status: x.status as Pin['status'], by: x.byRole as Role,
      nav: x.navigation[0] ? navStatus(x.navigation[0]) : null,
      replies: x.replies.map((r) => ({ by: r.byRole as Role, text: r.text, at: iso(r.at) })),
    })),

    updates: byCode(updates).map((u): RegUpdate => ({ id: u.code, market: u.market as MarketKey, title: u.title, summary: u.summary, reqs: u.reqs as string[], status: u.status as RegUpdate['status'], reason: opt(u.reason), kind: u.kind as RegUpdate['kind'] })),

    actions: byCode(actions).map((a): GapAction => ({ id: a.code, req: a.requirement.code, title: a.title, owner: a.owner, due: day(a.due), priority: a.priority as GapAction['priority'], status: a.status as GapAction['status'], submittedBy: opt(a.submittedBy) as Role | undefined })),

    rfis: byCode(rfis).map((r): Rfi => ({ id: r.code, title: r.title, discipline: r.discipline, system: r.system, status: r.status as Rfi['status'], raisedBy: r.raisedBy as Role, due: day(r.due), response: r.response })),

    inspections: byCode(inspections).map((i): Inspection => ({ id: i.code, title: i.title, system: i.system, status: i.status as Inspection['status'], evidence: i.evidence, drawingRev: i.drawingRev, decision: opt(i.decision) })),

    findings: byCode(findings).map((f) => ({ id: f.code, title: f.title, doc: f.document.code, severity: f.severity as 'High', status: f.status as 'Open', source: f.source, rule: f.rule, disposition: opt(f.disposition), raisedBy: opt(f.raisedBy) as Role | undefined, raisedAt: f.raisedBy ? iso(f.createdAt) : undefined })),

    changes: byCode(changes).map((c): Change => ({
      id: c.code, title: c.title, system: c.system, status: c.status as Change['status'], decision: opt(c.decision),
      docs: c.items.filter((i) => i.kind === 'doc').map((i) => i.ref),
      reqs: c.items.filter((i) => i.kind === 'req').map((i) => i.ref),
      impact: Object.fromEntries(c.items.map((i) => [i.ref, i.impact as Change['impact'][string]])),
    })),

    snapshots: snapshots.map((s): Snapshot => ({ id: s.code, at: iso(s.at), by: s.byRole as Role, baseline: s.baseline, markets: s.markets as MarketKey[], required: s.required, accepted: s.accepted, blockers: s.blockers as string[], rows: s.rows as Snapshot['rows'] })),

    baselines: baselines.map((b) => ({ v: b.v, at: iso(b.at), by: b.byRole as Role, reason: b.reason })),

    audit: audit.map((a): AuditEvent => ({ at: iso(a.at), role: a.role as Role, text: a.text, user: opt(a.userName) })),

    events: notices.map((n): Notice => ({ id: `EVT-${n.seq}`, at: iso(n.at), category: n.category as Notice['category'], text: n.text, doc: opt(n.docCode), forRole: opt(n.forRole) as Role | undefined, read: n.reads.length > 0 })),

    imports: imports.map((i): ImportBatch => ({ id: i.code, at: iso(i.at), mode: i.mode as ImportBatch['mode'], doc: i.document.code, fromRev: i.fromRev, toRev: i.toRev, checksum: i.checksum, label: i.label, cancelledRoute: i.cancelledRoute, file: fileMeta(i.file) })),

    issued: issued.map((i): IssuedPackage => ({ id: i.code, at: iso(i.at), doc: i.document.code, title: i.title, rev: i.rev, signers: i.signers as IssuedPackage['signers'], checksum: i.checksum })),

    risks: byCode(risks).map((r): Risk => ({ id: r.code, title: r.title, detail: r.detail, system: r.system, likelihood: r.likelihood as Risk['likelihood'], impact: r.impact as Risk['impact'], owner: r.owner, mitigation: r.mitigation, due: day(r.due), status: r.status as Risk['status'], decision: opt(r.decision) })),

    ncrs: byCode(ncrs).map((n): Ncr => ({
      id: n.code, title: n.title, description: n.description, system: n.system, severity: n.severity as Ncr['severity'], doc: n.document?.code, req: n.requirement?.code, raisedBy: n.raisedBy as Role, raisedAt: iso(n.raisedAt), due: day(n.due), status: n.status as Ncr['status'],
      rootCause: opt(n.rootCause), containment: opt(n.containment), correctiveAction: opt(n.correctiveAction), respondedBy: opt(n.respondedBy) as Role | undefined, closedBy: opt(n.closedBy) as Role | undefined, closeReason: opt(n.closeReason),
    })),

    companies: companies.map((c): Company => ({ id: c.id, name: c.name, kind: c.kind, contactName: c.contactName, contactEmail: c.contactEmail, active: c.active })),
    systems: systems.map((x): SystemRec => ({ id: x.id, tag: x.tag, name: x.name, discipline: x.discipline, area: x.area, gmpCritical: x.gmpCritical, active: x.active })),
    disciplines: disciplines.map((d): DisciplineRec => ({ id: d.id, name: d.name, position: d.position, active: d.active })),
    connector: {
      tokens: tokens.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, createdAt: iso(t.createdAt), lastUsedAt: t.lastUsedAt ? iso(t.lastUsedAt) : null, revokedAt: t.revokedAt ? iso(t.revokedAt) : null })),
      models: models.map((m) => ({
        id: m.id, guid: m.guid, name: m.name, lastSnapshotAt: m.lastSnapshotAt ? iso(m.lastSnapshotAt) : null,
        snapshots: m.snapshots.map((sn) => ({ id: sn.id, version: sn.version, publishedAt: iso(sn.publishedAt), publishedBy: sn.publishedBy, elementCount: sn.elementCount, changes: sn.changes as unknown as ElementChange[] })),
      })),
    },
    members: members.map((m): Member => ({ userId: m.user.id, name: m.user.name, email: m.user.email, company: m.user.company, role: m.role as Role, scope: m.companyScope, active: m.user.active })),
  }
  if (!scope) return out

  const own = new Set(out.docs.filter((d) => d.owner === scope).map((d) => d.id))
  const myRfis = new Set(rfis.filter((r) => r.raisedByUserId === userId).map((r) => r.code))
  return {
    ...out,
    docs: out.docs.filter((d) => own.has(d.id)),
    pins: out.pins.filter((x) => own.has(x.doc)),
    rfis: out.rfis.filter((r) => myRfis.has(r.id)),
    ncrs: out.ncrs.filter((n) => !!n.doc && own.has(n.doc)),
    imports: out.imports.filter((i) => own.has(i.doc)),
    issued: out.issued.filter((i) => own.has(i.doc)),
    events: out.events.filter((e) => !!e.doc && own.has(e.doc)),
    audit: audit.filter((a) => a.userId === userId).map((a): AuditEvent => ({ at: iso(a.at), role: a.role as Role, text: a.text, user: opt(a.userName) })),
    reqs: [], updates: [], actions: [], inspections: [], findings: [], changes: [], snapshots: [], risks: [],
    companies: out.companies.filter((c) => c.name === scope),
    systems: out.systems.filter((x) => out.docs.some((d) => own.has(d.id) && d.system === x.tag)),
    members: out.members.filter((m) => m.userId === userId),
    connector: { tokens: [], models: [] },
  }
}
