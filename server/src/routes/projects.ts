import { Router } from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { ASSET_HANDOVER, INDUSTRY_GROUPS, LOD_LEVELS, SERVICE_TYPES } from '../domain/industries.ts'
import { prisma } from '../db.ts'
import {
  ACTION_STATUS, APPLICABILITY, AUTOMATION_KEYS, COMPANY_KINDS, MARKETS, zRole, NCR_SEVERITY, PRIORITY, RISK_STATUS, SCOPES, zDate, zMarket, zRating, zText,
} from '../domain/enums.ts'
import { currentUser, reauthenticate } from '../middleware/auth.ts'
import { signatureHash } from '../lib/esign.ts'
import { securityLog } from '../lib/security.ts'
import { inProject, membership } from '../services/ctx.ts'
import type { Ctx } from '../services/ctx.ts'
import { portfolio } from '../services/portfolio.ts'
import { loadProject } from '../services/loadProject.ts'
import { assertObject, cleanName, commitObject, discardTemp, dropIfUnreferenced, mimeFor, sha256File, upload } from '../services/storage.ts'
import { forbidden, notFound, rule } from '../lib/http.ts'
import * as D from '../services/documents.ts'
import * as Reg from '../services/docRegister.ts'
import * as Ed from '../services/edits.ts'
import * as Rp from '../services/reports.ts'
import * as Tr from '../services/transmittals.ts'
import * as Q from '../services/quality.ts'
import * as R from '../services/requirements.ts'
import * as S from '../services/site.ts'
import * as W from '../services/workflow.ts'
import * as Rg from '../services/registers.ts'
import * as Tm from '../services/team.ts'
import * as Pj from '../services/projects.ts'
import * as Rv from '../services/revit.ts'

export const projects = Router()

/* ------------------------------------------------------------------ create */

projects.post('/', async (req, res) => {
  const user = currentUser(req)
  const b = z.object({
    code: z.string().max(20).optional(),
    name: z.string().max(160), client: z.string().max(160), site: z.string().max(160),
    projectCountry: z.enum(MARKETS), markets: z.array(z.enum(MARKETS)).max(5),
    industryGroup: z.enum(INDUSTRY_GROUPS), facilityType: z.string().max(120),
    secondaryFacilityType: z.string().max(120).optional(), customFacilityType: z.string().max(120).optional(),
    serviceType: z.enum(SERVICE_TYPES),
    bimRequirement: z.object({ lod: z.enum(LOD_LEVELS), coordination: z.boolean(), assetHandover: z.enum(ASSET_HANDOVER) }).optional(),
    scope: z.enum(SCOPES), projectStage: z.string().max(120), ownerStandards: z.string().max(1000),
    disciplines: z.array(z.string().max(80)).max(40), generateDeliverables: z.boolean().optional(),
    companies: z.array(z.object({ name: z.string().max(120), kind: z.enum(COMPANY_KINDS) })).max(200),
    members: z.array(z.object({ userId: z.string().min(1), role: zRole, scope: z.string().max(120).nullable().optional() })).min(1).max(500),
  }).parse(req.body ?? {})
  const code = await Pj.createProject(user, b, req.requestId)
  res.status(201).json({ code })
})

/* ------------------------------------------------------------------ reads */

/** Every project the caller is a member of, with full data (the portfolio and "My work" views aggregate across projects). */
/** Portfolio: one summary per project (stats, gates, work for the user's role, updates, deadlines, recent activity). */
projects.get('/', async (req, res) => {
  res.json({ projects: await portfolio(currentUser(req).id) })
})

projects.get('/:projectCode', async (req, res) => {
  const user = currentUser(req)
  const { project, role, scope } = await membership(req.params.projectCode, user.id)
  res.json({ role, scope, project: await loadProject(project.id, user.id, scope, role) })
})

/** Recompute every signature hash of a document: a mismatch means a stored signature field was altered. */
projects.get('/:projectCode/docs/:id/signatures/verify', async (req, res) => {
  const user = currentUser(req)
  const { project, scope } = await membership(req.params.projectCode, user.id)
  const d = await prisma.document.findUnique({ where: { projectId_code: { projectId: project.id, code: req.params.id } }, include: { signatures: { orderBy: { at: 'asc' } } } })
  if (!d || (scope && d.owner !== scope)) throw notFound(`Document ${req.params.id} not found.`)
  res.json({
    doc: d.code,
    signatures: d.signatures.map((s) => {
      const legacy = !s.sigHash
      const valid = !legacy && s.sigHash === signatureHash({ doc: d.code, rev: s.rev, checksum: s.checksum ?? '', userId: s.userId ?? '', email: s.email ?? '', name: s.name, role: s.role, meaning: s.meaning, reason: s.reason, at: s.at })
      return { rev: s.rev, name: s.name, role: s.role, meaning: s.meaning, at: s.at.toISOString(), checksum: s.checksum, status: legacy ? 'Not an electronic signature (recorded before e-signatures)' : valid ? 'Valid' : 'Altered' }
    }),
  })
})

/* ---------------------------------------------------------------- PDF reports */

/** Sends a generated PDF and records the generation (with the file's SHA-256) in the project audit trail. */
async function sendReport(req: Request, res: Response, projectId: string, role: string, file: string, label: string, r: { pdf: Buffer; sha256: string }) {
  const user = currentUser(req)
  await prisma.auditEvent.create({ data: { projectId, role, userId: user.id, userName: user.name, text: `Report generated: ${label} (PDF, SHA-256 ${r.sha256})`, requestId: req.requestId } })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`)
  res.setHeader('X-Content-SHA256', r.sha256)
  res.send(r.pdf)
}
const reportStamp = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-')

projects.get('/:projectCode/reports/handover.pdf', async (req, res) => {
  const user = currentUser(req)
  const { project, role, scope } = await membership(req.params.projectCode, user.id)
  if (scope) throw forbidden('Reports are not available to vendor accounts.')
  const data = await loadProject(project.id, user.id, null, role)
  const id = `HOD-${reportStamp()}`
  await sendReport(req, res, project.id, role, `${project.code}_Handover_Dossier_${id}.pdf`, `Handover dossier ${id}`, await Rp.handoverPdf(data, `${user.name} (${role})`, id))
})

projects.get('/:projectCode/snapshots/:id/report.pdf', async (req, res) => {
  const user = currentUser(req)
  const { project, role, scope } = await membership(req.params.projectCode, user.id)
  if (scope) throw forbidden('Reports are not available to vendor accounts.')
  const s = await prisma.snapshot.findUnique({ where: { projectId_code: { projectId: project.id, code: req.params.id } } })
  if (!s) throw notFound(`Package ${req.params.id} not found.`)
  const data = await loadProject(project.id, user.id, null, role)
  const pdf = await Rp.auditPackagePdf(data, { code: s.code, at: s.at, byRole: s.byRole, baseline: s.baseline, markets: s.markets as string[], required: s.required, accepted: s.accepted, blockers: s.blockers as string[], rows: s.rows as never }, `${user.name} (${role})`, s.code)
  await sendReport(req, res, project.id, role, `${project.code}_${s.code}_B${s.baseline}.pdf`, `Audit evidence package ${s.code}`, pdf)
})

projects.get('/:projectCode/transmittals/:id/report.pdf', async (req, res) => {
  const user = currentUser(req)
  const { project, role, scope } = await membership(req.params.projectCode, user.id)
  const t = await prisma.transmittal.findUnique({ where: { projectId_code: { projectId: project.id, code: req.params.id } } })
  if (!t || (scope && t.toCompany !== scope)) throw notFound(`Transmittal ${req.params.id} not found.`)
  const data = await loadProject(project.id, user.id, null, role)
  const pdf = await Rp.transmittalPdf(data, { ...t, items: t.items as unknown as Tr.TransmittalItem[] }, `${user.name} (${role})`, t.code)
  await sendReport(req, res, project.id, role, `${project.code}_${t.code}.pdf`, `Transmittal ${t.code}`, pdf)
})

/** Full, unbounded audit trail (the project payload only carries the latest entries). */
projects.get('/:projectCode/audit', async (req, res) => {
  const user = currentUser(req)
  const { project, scope } = await membership(req.params.projectCode, user.id)
  if (scope) throw forbidden('The project audit trail is not available to vendor accounts.')
  const q = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200), before: z.coerce.bigint().optional(), format: z.enum(['json', 'csv']).default('json') }).parse(req.query)
  const rows = await prisma.auditEvent.findMany({
    where: { projectId: project.id, ...(q.before ? { id: { lt: q.before } } : {}) },
    orderBy: { id: 'desc' },
    take: q.format === 'csv' ? undefined : q.limit,
  })
  if (q.format === 'csv') {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const body = [['Seq', 'Time (UTC)', 'Role', 'User', 'Event', 'Request ID'], ...rows.map((a) => [String(a.id), a.at.toISOString(), a.role, a.userName ?? '', a.text, a.requestId ?? ''])]
      .map((r) => r.map(cell).join(',')).join('\r\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${project.code}_Audit_Trail.csv"`)
    return res.send(body)
  }
  res.json({
    events: rows.map((a) => ({ seq: String(a.id), at: a.at.toISOString(), role: a.role, user: a.userName, text: a.text, requestId: a.requestId })),
    next: rows.length === q.limit ? String(rows[rows.length - 1].id) : null,
  })
})

/* ------------------------------------------------------------------ files */

/** Upload a source file for a document (multipart field "file", optional "label"). Membership is checked before any bytes are accepted. */
projects.post(
  '/:projectCode/docs/:id/files',
  async (req, _res, next) => { await membership(req.params.projectCode as string, currentUser(req).id); next() },
  (req, res, next) => upload(req, res, next),
  async (req, res) => {
    const user = currentUser(req)
    const f = req.file
    if (!f) throw rule('Choose a file to upload.')
    const params = req.params as Params
    let sha: string | null = null
    try {
      if (f.size === 0) throw rule('The file is empty.')
      const label = z.string().max(300).optional().parse(req.body?.label)
      const name = cleanName(f.originalname)
      sha = await sha256File(f.path)
      await commitObject(f.path, sha)
      const s = sha
      const projectId = await inProject(params.projectCode, user, req.requestId, (c) => D.uploadSource(c, params.id, { sha256: s, size: f.size, mimeType: mimeFor(name), name, label }))
      const { role, scope } = await membership(params.projectCode, user.id)
      res.json({ role, scope, project: await loadProject(projectId, user.id, scope, role) })
    } catch (e) {
      if (sha) await dropIfUnreferenced(sha)
      throw e
    } finally {
      await discardTemp(f.path)
    }
  },
)

/** Download a stored file. Only members of the owning project can read it. */
projects.get('/:projectCode/files/:fileId', async (req, res) => {
  const user = currentUser(req)
  const { project, scope } = await membership(req.params.projectCode, user.id)
  const file = await prisma.storedFile.findFirst({
    where: { id: req.params.fileId, projectId: project.id, ...(scope ? { imports: { some: { document: { owner: scope } } } } : {}) },
  })
  if (!file) throw notFound('File not found.')
  const p = await assertObject(file.sha256)
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('Content-Disposition', `attachment; filename="${file.originalName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('ETag', `"${file.sha256}"`)
  res.setHeader('X-Checksum-SHA256', file.sha256)
  res.sendFile(p)
})

/** Create a Revit connector token: the plain token is returned once, with the refreshed project. */
projects.post('/:projectCode/connector-tokens', async (req, res) => {
  const user = currentUser(req)
  const b = z.object({ name: z.string().max(80) }).parse(req.body ?? {})
  let token = ''
  const projectId = await inProject(req.params.projectCode as string, user, req.requestId, async (c) => {
    if (c.scope) throw forbidden('This action is not available to vendor accounts.')
    token = await Rv.createToken(c, b.name)
  })
  const { role, scope } = await membership(req.params.projectCode as string, user.id)
  res.status(201).json({ token, role, scope, project: await loadProject(projectId, user.id, scope, role) })
})

const zRegisterRow = z.object({
  number: z.string().max(60), title: z.string().max(300).optional(), discipline: z.string().max(80).optional(), system: z.string().max(40).optional(),
  company: z.string().max(120).optional(), due: z.string().max(20).optional(), critical: z.boolean().optional(),
})
const zRegisterImport = z.object({ rows: z.array(zRegisterRow).min(1).max(5000), source: z.string().max(200) })

/** Document register import, dry run: what would be created / updated, and every row error. Changes nothing. */
projects.post('/:projectCode/docs/import/preview', async (req, res) => {
  const user = currentUser(req)
  const b = zRegisterImport.parse(req.body ?? {})
  let preview: Reg.ImportPreview | null = null
  await inProject(req.params.projectCode as string, user, req.requestId, async (c) => {
    if (c.scope) throw forbidden('This action is not available to vendor accounts.')
    preview = await Reg.importRegister(c, b.rows, false, b.source)
  })
  res.json({ preview })
})

/* ---------------------------------------------------------------- actions */

type Params = Record<string, string>
/**
 * Registers a workflow action: validate body -> run atomically in the project -> return the fresh project.
 * Vendor-scoped accounts may only call actions flagged `vendor` (and those still check record ownership).
 */
function act<T extends z.ZodType>(method: 'post' | 'put' | 'delete', path: string, schema: T, fn: (c: Ctx, body: z.infer<T>, p: Params) => Promise<unknown>, opts: { vendor?: boolean; archived?: boolean; reauth?: string } = {}) {
  projects[method](`/:projectCode${path}`, async (req: Request, res: Response) => {
    const user = currentUser(req)
    const body = schema.parse(req.body ?? {})
    const params = req.params as Params
    const purpose = opts.reauth ? `${opts.reauth} ${params.projectCode}/${params.id ?? ''}` : ''
    if (opts.reauth) await reauthenticate(req, (body as { password?: string }).password, purpose)
    const projectId = await inProject(params.projectCode, user, req.requestId, async (c) => {
      if (c.scope && !opts.vendor) throw forbidden('This action is not available to vendor accounts.')
      await fn(c, body, params)
    }, { allowArchived: opts.archived })
    if (opts.reauth) await securityLog('esign.signed', { email: user.email, userId: user.id, actorId: user.id, actorName: user.name, ip: req.ip, detail: purpose })
    const { role, scope } = await membership(params.projectCode, user.id)
    res.json({ role, scope, project: await loadProject(projectId, user.id, scope, role) })
  })
}
const V = { vendor: true }

const none = z.object({}).strict()
const reasonBody = z.object({ reason: zText })

// project setup & settings
act('put', '/suitability', z.object({ codes: z.array(z.object({ code: z.string().max(10), label: z.string().max(120), kind: z.string().max(20) })).max(40), reason: zText }), (c, b) => D.setSuitability(c, b.codes, b.reason))
act('put', '/profile', z.object({
    industryGroup: z.enum(INDUSTRY_GROUPS), facilityType: z.string().max(120),
    secondaryFacilityType: z.string().max(120).optional(), customFacilityType: z.string().max(120).optional(),
    serviceType: z.enum(SERVICE_TYPES),
    bimRequirement: z.object({ lod: z.enum(LOD_LEVELS), coordination: z.boolean(), assetHandover: z.enum(ASSET_HANDOVER) }).optional(),
    scope: z.enum(SCOPES), projectStage: z.string().max(200), ownerStandards: z.string().max(500), markets: z.array(zMarket).max(5), reason: zText,
}), (c, b) => R.saveProfile(c, b))
act('put', '/settings/automation', z.object({ key: z.enum(AUTOMATION_KEYS), value: z.boolean() }), (c, b) => W.setAutomation(c, b.key, b.value))
act('post', '/reminders/send', none, (c) => W.sendReminders(c))
act('post', '/notices/read-all', none, (c) => W.markAllRead(c), { vendor: true, archived: true })

// project lifecycle + team
act('put', '/details', z.object({ name: z.string().max(160), client: z.string().max(160), site: z.string().max(160) }), (c, b) => Pj.updateDetails(c, b))
act('post', '/archive', reasonBody, (c, b) => Pj.archiveProject(c, b.reason))
act('post', '/restore', reasonBody, (c, b) => Pj.restoreProject(c, b.reason), { archived: true })
act('put', '/members/:userId', z.object({ role: zRole, scope: z.string().max(120).nullable().optional() }), (c, b, p) => Tm.setMember(c, p.userId, b.role, b.scope))
act('delete', '/members/:userId', none, (c, _b, p) => Tm.removeMember(c, p.userId))

// project registers
const zOptText = (max: number) => z.string().max(max).nullable().optional()
const zSystem = z.object({ tag: z.string().max(40), name: z.string().max(200), discipline: zOptText(80), area: zOptText(120), gmpCritical: z.boolean().optional() })
act('post', '/companies', z.object({ name: z.string().max(120), kind: z.enum(COMPANY_KINDS), contactName: zOptText(120), contactEmail: z.union([z.email(), z.literal('')]).nullable().optional() }), (c, b) => Rg.addCompany(c, b))
act('put', '/companies/:id', z.object({ name: z.string().max(120).optional(), kind: z.enum(COMPANY_KINDS).optional(), contactName: zOptText(120), contactEmail: z.union([z.email(), z.literal('')]).nullable().optional(), active: z.boolean().optional() }), (c, b, p) => Rg.updateCompany(c, p.id, b))
act('post', '/systems', zSystem, (c, b) => Rg.addSystem(c, b))
act('post', '/systems/import', z.object({ rows: z.array(zSystem).min(1).max(2000) }), (c, b) => Rg.importSystems(c, b.rows))
act('put', '/systems/:tag', zSystem.omit({ tag: true }).partial().extend({ active: z.boolean().optional() }), (c, b, p) => Rg.updateSystem(c, p.tag, b))
act('post', '/disciplines', z.object({ name: z.string().max(80) }), (c, b) => Rg.addDiscipline(c, b.name))
act('put', '/disciplines/:id', z.object({ name: z.string().max(80).optional(), active: z.boolean().optional(), move: z.enum(['up', 'down']).optional() }), (c, b, p) => Rg.updateDiscipline(c, p.id, b))

// documents
const zDocFields = z.object({ title: z.string().max(300), number: z.string().max(60), discipline: z.string().max(80), system: z.string().max(40), owner: z.string().max(120), due: zDate, critical: z.boolean() })
act('post', '/docs', zDocFields, (c, b) => Reg.createDocument(c, b))
act('post', '/docs/import', zRegisterImport, (c, b) => Reg.importRegister(c, b.rows, true, b.source))
act('put', '/docs/:id/details', zDocFields.extend({ reason: zText }), (c, b, p) => Reg.updateDocument(c, p.id, b))
act('post', '/docs/:id/void', z.object({ reason: zText, supersededBy: z.string().max(40).optional() }), (c, b, p) => Reg.voidDocument(c, p.id, b))
act('post', '/docs/:id/reinstate', reasonBody, (c, b, p) => Reg.reinstateDocument(c, p.id, b.reason))
act('post', '/docs/:id/submit', z.object({ note: zText, reasonForIssue: z.string().max(500).optional(), changeSummary: z.string().max(1000).optional(), suitability: z.string().max(10).optional() }),
  (c, b, p) => D.submitDoc(c, p.id, b.note, b), V)
act('post', '/docs/:id/sign', z.object({ reason: zText, intent: z.boolean(), password: z.string().max(200) }), (c, b, p) => D.signDoc(c, p.id, b.reason, b.intent), { reauth: 'document sign-off' })
act('post', '/docs/:id/return', reasonBody, (c, b, p) => D.returnDoc(c, p.id, b.reason))
act('post', '/docs/:id/revisions', none, (c, _b, p) => D.newRevision(c, p.id), V)
act('post', '/docs/:id/imports', z.object({ snapshotId: z.string().min(1) }), (c, b, p) => D.importRevit(c, p.id, b.snapshotId), V)
act('post', '/deliverables', z.object({ tag: z.string().max(60), vendor: z.string().max(120), discipline: z.string().min(1).max(80), due: zDate }), (c, b) => D.generateDeliverables(c, b))

// requirements & evidence
act('post', '/reqs', z.object({ title: z.string().max(300), market: zMarket, discipline: z.string().max(80), system: z.string().max(40), topic: z.string().max(500), critical: z.boolean(), owner: z.string().max(120), due: zDate }), (c, b) => R.addRequirement(c, b))
act('put', '/reqs/:id/details', z.object({ system: z.string().max(40), owner: z.string().max(120), due: zDate }), (c, b, p) => R.updateRequirement(c, p.id, b))
act('post', '/reqs/:id/applicability', z.object({ applicability: z.enum(APPLICABILITY), rationale: zText }), (c, b, p) => R.decideApplicability(c, p.id, b.applicability, b.rationale))
act('post', '/reqs/applicability', z.object({ ids: z.array(z.string().min(1)).min(1).max(500), applicability: z.enum(APPLICABILITY), rationale: zText }), (c, b) => R.decideApplicabilityBulk(c, b.ids, b.applicability, b.rationale))
act('put', '/reqs/:id/source-ref', z.object({ clause: z.string().max(300), version: z.string().max(200), effective: z.union([zDate, z.literal('')]), attest: z.boolean() }), (c, b, p) => R.setSourceRef(c, p.id, b))
act('post', '/reqs/:id/evidence', z.object({ doc: z.string().min(1), note: zText }), (c, b, p) => R.linkEvidence(c, p.id, b.doc, b.note))
act('post', '/reqs/:id/evidence/:evidenceId/assess', z.object({ accept: z.boolean(), reason: zText }), (c, b, p) => R.assessEvidence(c, p.id, p.evidenceId, b.accept, b.reason))
act('post', '/reqs/:id/evidence/:evidenceId/withdraw', reasonBody, (c, b, p) => R.withdrawEvidence(c, p.id, p.evidenceId, b.reason))
const editReason = z.object({ reason: zText })
act('put', '/rfis/:id', z.object({ title: zText, discipline: z.string().max(80), system: z.string().max(60), due: zDate }).merge(editReason), (c, b, p) => Ed.editRfi(c, p.id, b), V)
act('put', '/risks/:id', z.object({ title: z.string().max(300), detail: zText, system: z.string().max(60), likelihood: zRating, impact: zRating, owner: z.string().max(120), mitigation: zText, due: zDate }).merge(editReason), (c, b, p) => Ed.editRisk(c, p.id, b as Parameters<typeof Ed.editRisk>[2]))
act('put', '/ncrs/:id', z.object({ title: z.string().max(300), description: zText, system: z.string().max(60), severity: z.enum(NCR_SEVERITY), doc: z.string().max(40), due: zDate }).merge(editReason), (c, b, p) => Ed.editNcr(c, p.id, b))
act('put', '/actions/:id', z.object({ title: zText, owner: z.string().max(120), due: zDate, priority: z.enum(PRIORITY) }).merge(editReason), (c, b, p) => Ed.editAction(c, p.id, b))
act('post', '/findings', z.object({ title: z.string().max(300), doc: z.string().min(1).max(40), severity: z.enum(['High', 'Medium', 'Low']), source: zText, rule: z.string().max(300) }), (c, b) => Ed.raiseFinding(c, b))
act('post', '/transmittals', z.object({ to: z.string().min(1).max(120), purpose: z.string().max(60), note: z.string().max(2000), docs: z.array(z.string().max(40)).min(1).max(500) }), (c, b) => Tr.createTransmittal(c, b))
act('post', '/transmittals/:id/acknowledge', z.object({ note: z.string().max(1000) }), (c, b, p) => Tr.acknowledgeTransmittal(c, p.id, b.note), V)
act('post', '/actions', z.object({ req: z.string().min(1), title: zText, owner: z.string().max(120), due: zDate, priority: z.enum(PRIORITY) }), (c, b) => R.addAction(c, b))
act('post', '/actions/:id/progress', z.object({ to: z.enum(ACTION_STATUS) }), (c, b, p) => R.progressAction(c, p.id, b.to))
act('post', '/updates/:id/assess', z.object({ applicable: z.boolean(), reason: zText }), (c, b, p) => R.assessUpdate(c, p.id, b.applicable, b.reason))
act('post', '/snapshots', none, (c) => R.createSnapshot(c))

// technical comments
const zPlace = z.object({ page: z.number().int().min(1).max(5000), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
act('post', '/pins', z.object({ text: zText, doc: z.string().min(1), room: z.string().max(120), place: zPlace.optional() }), (c, b) => S.addPin(c, b), V)
act('put', '/pins/:id/anchor', zPlace, (c, b, p) => S.anchorPin(c, p.id, b), V)
act('put', '/pins/:id/element', z.object({ model: z.string().max(100).nullable(), element: z.string().max(100).nullable() }), (c, b, p) => Rv.linkElement(c, p.id, b))
act('post', '/pins/:id/navigate', none, (c, _b, p) => Rv.requestNavigation(c, p.id))
act('put', '/settings/revit', z.object({ on: z.boolean() }), (c, b) => Rv.setRevit(c, b.on))
act('delete', '/connector-tokens/:id', none, (c, _b, p) => Rv.revokeToken(c, p.id))
act('post', '/pins/:id/replies', z.object({ text: zText, close: z.boolean().default(false) }), (c, b, p) => S.replyPin(c, p.id, b.text, b.close), V)

// site
act('post', '/rfis', z.object({ title: zText, discipline: z.string().max(80), system: z.string().max(60), due: zDate }), (c, b) => S.raiseRfi(c, b), V)
act('post', '/rfis/:id/answer', z.object({ response: zText }), (c, b, p) => S.answerRfi(c, p.id, b.response))
act('post', '/rfis/:id/close', none, (c, _b, p) => S.closeRfi(c, p.id), V)
act('post', '/inspections', z.object({ title: zText, system: z.string().max(60) }), (c, b) => S.requestInspection(c, b))
act('post', '/inspections/:id/submit', z.object({ evidence: zText }), (c, b, p) => S.submitInspection(c, p.id, b.evidence))
act('post', '/inspections/:id/decide', z.object({ accept: z.boolean(), reason: zText }), (c, b, p) => S.decideInspection(c, p.id, b.accept, b.reason))
act('post', '/findings/:id/dispose', z.object({ status: z.enum(['Resolved', 'Accepted exception']), reason: zText }), (c, b, p) => S.disposeFinding(c, p.id, b.status, b.reason))
act('post', '/changes', z.object({ title: zText, system: z.string().max(60), docs: z.array(z.string()).max(200), reqs: z.array(z.string()).max(200) }), (c, b) => S.addChange(c, b))
act('post', '/changes/:id/impact', z.object({ item: z.string().min(1), impact: z.enum(['Impacted', 'Not impacted']) }), (c, b, p) => S.assessChangeItem(c, p.id, b.item, b.impact))
act('post', '/changes/:id/decide', z.object({ authorize: z.boolean(), reason: zText }), (c, b, p) => S.decideChange(c, p.id, b.authorize, b.reason))

// quality
act('post', '/risks', z.object({ title: zText, detail: zText.default(''), system: z.string().max(60), likelihood: zRating, impact: zRating, owner: z.string().max(120), mitigation: zText, due: zDate }), (c, b) => Q.addRisk(c, b as Parameters<typeof Q.addRisk>[1]))
act('post', '/risks/:id/status', z.object({ status: z.enum(RISK_STATUS), note: zText }), (c, b, p) => Q.updateRisk(c, p.id, b.status, b.note))
act('post', '/ncrs', z.object({ title: zText, description: zText, system: z.string().max(60), severity: z.enum(NCR_SEVERITY), doc: z.string().optional(), due: zDate }), (c, b) => Q.raiseNcr(c, b))
act('post', '/ncrs/:id/respond', z.object({ rootCause: zText, containment: zText, correctiveAction: zText }), (c, b, p) => Q.respondNcr(c, p.id, b), V)
act('post', '/ncrs/:id/close', reasonBody, (c, b, p) => Q.closeNcr(c, p.id, b.reason))
act('post', '/ncrs/:id/reopen', reasonBody, (c, b, p) => Q.reopenNcr(c, p.id, b.reason))
