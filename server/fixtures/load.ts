// Test fixtures: WIPES the database and loads three fictional sample projects + test users.
// Used only by the automated test suites and local development. Never run against a customer database:
//   npm run fixtures:load        (passes --confirm-wipe)
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '../src/generated/prisma/client.ts'
import type { ProjectData, Role } from '../src/domain/types.ts'
import { disciplines as DISCIPLINES } from '../src/domain/reference.ts'
import { projectIndex, projectMarkets, seedActions, seedChanges, seedDocs, seedFindings, seedInspections, seedNcrs, seedPins, seedReqs, seedRfis, seedRisks, seedUpdates } from './data.ts'

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load test fixtures in production.')
if (!process.argv.includes('--confirm-wipe')) throw new Error('This wipes the whole database. Re-run with --confirm-wipe (npm run fixtures:load).')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
const clone = <T>(v: T): T => structuredClone(v)
const SEEDED_AT = '2026-10-16T08:00:00Z'
const PASSWORD = process.env.SEED_PASSWORD ?? 'Demo@12345'

/** `scope` limits a Contractor to one company's records (vendor account); `admin` manages users. */
const USERS: { email: string; name: string; company: string; role: Role; scope?: string; admin?: boolean }[] = [
  { email: 'consultant@qualigrafo.test', name: 'Demo Consultant', company: 'Consult Partners', role: 'Consultant' },
  { email: 'contractor@qualigrafo.test', name: 'Demo Contractor', company: 'BuildCo', role: 'Contractor' },
  { email: 'qa@qualigrafo.test', name: 'Demo Owner / QA', company: 'Nova Pharma Ltd', role: 'Owner / QA', admin: true },
  { email: 'vendor@qualigrafo.test', name: 'Demo Vendor (AirCo)', company: 'AirCo', role: 'Contractor', scope: 'AirCo' },
]

/** Port of makeProject() in qualigrafo/src/store.ts. */
function makeProject(id: string): ProjectData {
  const profile = clone(projectIndex.find((p) => p.id === id)!)
  const base: ProjectData = {
    profile,
    markets: [...(projectMarkets[id] ?? ['SA'])],
    docs: clone(seedDocs), reqs: clone(seedReqs), pins: clone(seedPins), updates: clone(seedUpdates), actions: clone(seedActions),
    rfis: clone(seedRfis), inspections: clone(seedInspections), findings: clone(seedFindings), changes: clone(seedChanges),
    snapshots: [], baselines: [{ v: 1, at: '2026-09-01T09:00:00Z', by: 'Owner / QA', reason: 'Initial requirement baseline' }],
    audit: [{ at: SEEDED_AT, role: 'Owner / QA', text: 'Sample project initialised' }], baseline: 1, revitMode: false,
    events: [
      { id: 'EVT-3', at: '2026-10-14T08:00:00Z', category: 'Reminder', text: 'Reminder preview: DOC-004 R02 is waiting for Consultant sign-off.', doc: 'DOC-004', forRole: 'Consultant', read: false },
      { id: 'EVT-2', at: '2026-10-13T10:00:00Z', category: 'Routing', text: 'Signature request routed to Consultant for DOC-001 R02.', doc: 'DOC-001', forRole: 'Consultant', read: false },
      { id: 'EVT-1', at: '2026-10-09T09:00:00Z', category: 'Issue', text: 'DOC-003 R03 fully signed; controlled issue manifest generated (prototype).', doc: 'DOC-003', read: true },
    ],
    automation: { routing: true, reminders: true, autoIssue: true }, imports: [], risks: clone(seedRisks), ncrs: clone(seedNcrs),
    companies: [], systems: [], disciplines: [], members: [], connector: { tokens: [], models: [] },
    issued: [{ id: 'ISS-001', at: '2026-10-09T09:00:00Z', doc: 'DOC-003', title: 'Purified water P&ID', rev: 3, signers: seedDocs[2].signatures.map((x) => ({ role: x.role, name: x.name, at: x.at })), checksum: null }],
    transmittals: [],
  }
  if (id === 'PRJ-031') {
    base.docs = base.docs.map((d, i) => ({ ...d, rev: 0, status: i % 3 === 0 ? 'Draft' : 'Missing', signStage: 0, signatures: [], history: [{ rev: 0, status: i % 3 === 0 ? 'Draft' : 'Missing', at: SEEDED_AT, by: 'Contractor' }] }))
    base.reqs = base.reqs.map((r, i) => ({ ...r, evidence: [], applicability: i % 2 ? 'Assessment pending' : r.applicability }))
    base.rfis = []; base.inspections = []; base.findings = []; base.changes = []; base.updates = []; base.actions = []; base.pins = []
    base.ncrs = []; base.risks = base.risks.slice(0, 2).map((r) => ({ ...r, status: 'Open' as const }))
    base.issued = []
  }
  if (id === 'PRJ-018') {
    base.findings = []; base.updates = []; base.actions = []
    base.docs = base.docs.map((d) => ({ ...d, status: 'Accepted', signStage: 2 as const, signatures: seedDocs[2].signatures.map((x) => ({ ...x, rev: d.rev })) }))
    base.reqs = base.reqs.map((r) => ({
      ...r,
      applicability: r.applicability === 'Assessment pending' ? 'Required' as const : r.applicability,
      evidence: (r.evidence.length ? r.evidence : [{ id: '', doc: r.discipline === 'CQV' ? 'DOC-008' : 'DOC-003', rev: 1, decision: 'Accepted' as const, note: 'Sample evidence link.', by: 'Contractor' as const, at: SEEDED_AT }])
        .map((e) => ({ ...e, decision: 'Accepted' as const, reviewedBy: 'Owner / QA' as const, reason: 'Fit for scope (sample).' })),
    }))
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

const day = (d: string) => new Date(`${d}T00:00:00Z`)
const SYSTEM_NAMES: Record<string, string> = {
  'CR-101': 'Cleanroom suite 101', 'RE-201': 'Reactor 201', 'PW-001': 'Purified water generation and loop', 'AHU-01': 'Air handling unit 01',
  'MDB-01': 'Main distribution board 01', 'BMS-01': 'Building monitoring system', 'FP-01': 'Fire pump set 01',
}
const GMP_CRITICAL = new Set(['CR-101', 'RE-201', 'PW-001', 'AHU-01', 'BMS-01'])

async function writeProject(p: ProjectData, userIds: Record<string, string>) {
  const projectId = randomUUID()
  const docId: Record<string, string> = {}
  const reqId: Record<string, string> = {}
  p.docs.forEach((d) => (docId[d.id] = randomUUID()))
  p.reqs.forEach((r) => (reqId[r.id] = randomUUID()))

  await prisma.$transaction(async (tx) => {
    await tx.project.create({
      data: {
        id: projectId, code: p.profile.id, name: p.profile.name, client: p.profile.client, site: p.profile.site,
        industryGroup: p.profile.industryGroup, facilityType: p.profile.facilityType, secondaryFacilityType: p.profile.secondaryFacilityType ?? null,
        customFacilityType: p.profile.customFacilityType ?? null, serviceType: p.profile.serviceType, bimRequirement: (p.profile.bimRequirement as unknown as Prisma.InputJsonObject | undefined),
        scope: p.profile.scope, projectStage: p.profile.projectStage,
        projectCountry: p.profile.projectCountry, ownerStandards: p.profile.ownerStandards, markets: p.markets, baseline: p.baseline, revitMode: p.revitMode,
        autoRouting: p.automation.routing, autoReminders: p.automation.reminders, autoIssue: p.automation.autoIssue,
      },
    })
    await tx.membership.createMany({ data: USERS.map((u) => ({ userId: userIds[u.email], projectId, role: u.role, companyScope: u.scope ?? null })) })
    await tx.baseline.createMany({ data: p.baselines.map((b) => ({ projectId, v: b.v, at: new Date(b.at), byRole: b.by, reason: b.reason })) })

    await tx.document.createMany({ data: p.docs.map((d) => ({ id: docId[d.id], projectId, code: d.id, number: d.number, title: d.title, discipline: d.discipline, system: d.system, rev: d.rev, status: d.status, owner: d.owner, due: day(d.due), critical: d.critical, signStage: d.signStage, source: d.source, checksum: d.checksum })) })
    await tx.docSignature.createMany({ data: p.docs.flatMap((d) => d.signatures.map((s) => ({ documentId: docId[d.id], role: s.role, name: s.name, at: new Date(s.at), rev: s.rev, reason: s.reason }))) })
    await tx.docHistory.createMany({ data: p.docs.flatMap((d) => d.history.map((h) => ({ documentId: docId[d.id], rev: h.rev, status: h.status, at: new Date(h.at), byRole: h.by, note: h.note }))) })

    await tx.requirement.createMany({ data: p.reqs.map((r) => ({ id: reqId[r.id], projectId, code: r.id, title: r.title, market: r.market, topic: r.topic, discipline: r.discipline, system: r.system, applicability: r.applicability, rationale: r.rationale, owner: r.owner, due: day(r.due), critical: r.critical, clause: r.clause, sourceVersion: r.sourceVersion, effective: r.effective, sourceAttested: r.sourceAttested })) })
    await tx.evidenceLink.createMany({ data: p.reqs.flatMap((r) => r.evidence.map((e, position) => ({ requirementId: reqId[r.id], documentId: docId[e.doc], position, rev: e.rev, decision: e.decision, note: e.note, byRole: e.by, at: new Date(e.at), reviewedBy: e.reviewedBy, reason: e.reason }))) })

    for (const x of p.pins) {
      await tx.pin.create({ data: { projectId, code: x.id, text: x.text, documentId: docId[x.doc], rev: x.rev, room: x.room, x: x.x, y: x.y, model: x.model, element: x.element, status: x.status, byRole: x.by, createdAt: new Date(SEEDED_AT), replies: { create: x.replies.map((r) => ({ byRole: r.by, text: r.text, at: new Date(r.at) })) } } })
    }
    await tx.regUpdate.createMany({ data: p.updates.map((u) => ({ projectId, code: u.id, market: u.market, title: u.title, summary: u.summary, reqs: u.reqs, status: u.status, reason: u.reason })) })
    await tx.gapAction.createMany({ data: p.actions.map((a) => ({ projectId, code: a.id, requirementId: reqId[a.req], title: a.title, owner: a.owner, due: day(a.due), priority: a.priority, status: a.status, submittedBy: a.submittedBy })) })
    await tx.rfi.createMany({ data: p.rfis.map((r) => ({ projectId, code: r.id, title: r.title, discipline: r.discipline, system: r.system, status: r.status, raisedBy: r.raisedBy, due: day(r.due), response: r.response })) })
    await tx.inspection.createMany({ data: p.inspections.map((i) => ({ projectId, code: i.id, title: i.title, system: i.system, status: i.status, evidence: i.evidence, drawingRev: i.drawingRev, decision: i.decision })) })
    await tx.finding.createMany({ data: p.findings.map((f) => ({ projectId, code: f.id, title: f.title, documentId: docId[f.doc], severity: f.severity, status: f.status, source: f.source, rule: f.rule, disposition: f.disposition })) })
    for (const ch of p.changes) {
      const items = [...ch.docs.map((ref) => ({ kind: 'doc', ref })), ...ch.reqs.map((ref) => ({ kind: 'req', ref }))].map((x, position) => ({ ...x, position, impact: ch.impact[x.ref] ?? 'Unassessed' }))
      await tx.change.create({ data: { projectId, code: ch.id, title: ch.title, system: ch.system, status: ch.status, decision: ch.decision, items: { create: items } } })
    }
    await tx.risk.createMany({ data: p.risks.map((r) => ({ projectId, code: r.id, title: r.title, detail: r.detail, system: r.system, likelihood: r.likelihood, impact: r.impact, owner: r.owner, mitigation: r.mitigation, due: day(r.due), status: r.status, decision: r.decision })) })
    await tx.ncr.createMany({ data: p.ncrs.map((n) => ({ projectId, code: n.id, title: n.title, description: n.description, system: n.system, severity: n.severity, documentId: n.doc ? docId[n.doc] : null, requirementId: n.req ? reqId[n.req] : null, raisedBy: n.raisedBy, raisedAt: new Date(n.raisedAt), due: day(n.due), status: n.status, rootCause: n.rootCause, containment: n.containment, correctiveAction: n.correctiveAction, respondedBy: n.respondedBy, closedBy: n.closedBy, closeReason: n.closeReason })) })
    await tx.issuedPackage.createMany({ data: p.issued.map((i) => ({ projectId, code: i.id, at: new Date(i.at), documentId: docId[i.doc], title: i.title, rev: i.rev, signers: i.signers, checksum: i.checksum })) })

    for (const e of p.events) {
      const n = await tx.notice.create({ data: { projectId, seq: Number(e.id.split('-')[1]), at: new Date(e.at), category: e.category, text: e.text, docCode: e.doc, forRole: e.forRole } })
      if (e.read) await tx.noticeRead.createMany({ data: Object.values(userIds).map((userId) => ({ noticeId: n.id, userId })) })
    }
    // Registers: client as Owner, consultant, every responsible party, the standard disciplines, every referenced system.
    const kindOf = (n: string) => (n === 'BuildCo' ? 'Main contractor' : 'Vendor / supplier')
    const parties = [...new Set([...p.docs.map((d) => d.owner), ...USERS.filter((u) => u.scope).map((u) => u.scope!)])]
    await tx.company.createMany({
      data: [
        { projectId, name: p.profile.client, kind: 'Owner' },
        { projectId, name: 'Consult Partners', kind: 'Engineering consultant' },
        ...parties.filter((n) => n !== p.profile.client).map((n) => ({ projectId, name: n, kind: kindOf(n) })),
      ],
    })
    await tx.discipline.createMany({ data: DISCIPLINES.map((name, i) => ({ projectId, name, position: i + 1 })) })
    const tags = new Set([...p.docs, ...p.reqs, ...p.rfis, ...p.inspections, ...p.changes, ...p.risks, ...p.ncrs].map((x) => x.system).filter(Boolean))
    await tx.system.createMany({
      data: [...tags].map((tag) => ({ projectId, tag, name: SYSTEM_NAMES[tag] ?? tag, discipline: p.docs.find((d) => d.system === tag)?.discipline ?? null, gmpCritical: GMP_CRITICAL.has(tag) })),
    })

    await tx.auditEvent.createMany({ data: [...p.audit].reverse().map((a) => ({ projectId, at: new Date(a.at), role: a.role, text: a.text, userName: 'Seed' })) })
  })
}

async function main() {
  // Safety net: refuse if the database holds any account that is not a fixture account.
  const real = await prisma.user.count({ where: { NOT: { email: { endsWith: '@qualigrafo.test' } } } })
  if (real && !process.argv.includes('--force')) throw new Error(`Database contains ${real} non-test account(s). Refusing to wipe it (use --force only on a disposable database).`)
  console.log('Wiping existing data and stored files...')
  await prisma.project.deleteMany()
  await prisma.user.deleteMany()
  await prisma.securityEvent.deleteMany()
  await prisma.emailMessage.deleteMany()
  await prisma.reminderRun.deleteMany()
  await prisma.accessReview.deleteMany()
  await prisma.backupRun.deleteMany()
  await prisma.errorEvent.deleteMany()
  await prisma.jobHeartbeat.deleteMany()
  await prisma.outage.deleteMany()
  await prisma.appSetting.deleteMany()
  // Test data: the scheduled daily run stays off so it never alters fixtures while a test suite runs.
  await prisma.appSetting.create({ data: { key: 'reminders', value: { enabled: false, time: '08:00', dueSoonDays: 3 }, updatedBy: 'fixtures' } })
  await prisma.appSetting.create({ data: { key: 'backups', value: { enabled: false, time: '02:00', keep: 14, verify: true }, updatedBy: 'fixtures' } })
  await prisma.libraryPack.deleteMany()
  // Monitoring (P6): heartbeats of the background jobs as if they had just run, one recorded error and one past
  // interruption, so the Monitoring page has something to show in a test installation.
  const now = new Date()
  for (const name of ['api', 'mailer', 'reminders', 'backups']) {
    await prisma.jobHeartbeat.create({ data: { name, lastRunAt: now, lastOkAt: now, runs: 12, detail: 'seeded by fixtures' } })
  }
  await prisma.errorEvent.create({
    data: {
      fingerprint: 'fixture-0000000000000000000000000000000000000000000000000000000001', kind: 'Request',
      place: 'POST /api/projects/PRJ-026/docs/DOC-003/files', message: 'Storage write failed: no space left on device',
      stack: 'Error: Storage write failed: no space left on device\n    at storeFile (src/services/storage.ts:48:11)',
      count: 3, firstAt: new Date(now.getTime() - 3 * 3600_000), lastAt: new Date(now.getTime() - 90 * 60_000),
      lastRequestId: '2f4c1e90-0000-4000-8000-00000000f1x7', lastUser: 'contractor@qualigrafo.test',
    },
  })
  await prisma.outage.create({ data: { from: new Date(now.getTime() - 26 * 3600_000), to: new Date(now.getTime() - 25.8 * 3600_000), minutes: 12, detail: 'No API heartbeat for 12 minutes (the application was stopped or could not reach its database).' } })
  await rm(path.resolve(process.env.STORAGE_DIR ?? 'storage', 'objects'), { recursive: true, force: true })

  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const userIds: Record<string, string> = {}
  for (const u of USERS) {
    const row = await prisma.user.create({ data: { email: u.email, name: u.name, company: u.company, passwordHash, isAdmin: !!u.admin, passwordChangedAt: new Date() } })
    userIds[u.email] = row.id
  }

  for (const meta of projectIndex) {
    await writeProject(makeProject(meta.id), userIds)
    console.log(`  seeded ${meta.id} ${meta.name}`)
  }
  // Load test (P1 scale): --projects N adds N copies of PRJ-026 with the history of a project in use
  // (300 audit entries, 150 notifications), e.g. npm run fixtures:load -- --projects 100.
  const extra = Number(process.argv[process.argv.indexOf('--projects') + 1] ?? 0)
  if (process.argv.includes('--projects') && extra > 0) {
    for (let i = 1; i <= extra; i++) {
      const p = makeProject('PRJ-026')
      p.profile.id = `LT-${String(i).padStart(3, '0')}`
      p.profile.name = `Load test project ${i}`
      p.audit = Array.from({ length: 300 }, (_, k) => ({ at: new Date(Date.parse(SEEDED_AT) + k * 60_000).toISOString(), role: 'Consultant' as Role, text: `Load-test audit entry ${k + 1}: DOC-00${(k % 9) + 1} reviewed, field "status" "Draft" -> "Under review". Reason: load test.` }))
      p.events = Array.from({ length: 150 }, (_, k) => ({ id: `EVT-${k + 1}`, at: new Date(Date.parse(SEEDED_AT) + k * 60_000).toISOString(), category: 'Routing' as const, text: `Load-test notification ${k + 1}: signature request routed.`, doc: 'DOC-001', forRole: 'Consultant' as Role, read: false }))
      await writeProject(p, userIds)
    }
    console.log(`  seeded ${extra} load-test project(s) LT-001 … LT-${String(extra).padStart(3, '0')}`)
  }
  console.log(`\nTest users (password: ${PASSWORD})`)
  for (const u of USERS) console.log(`  ${u.role.padEnd(11)} ${u.email}${u.scope ? `  (vendor: ${u.scope} only)` : ''}${u.admin ? '  (administrator)' : ''}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
