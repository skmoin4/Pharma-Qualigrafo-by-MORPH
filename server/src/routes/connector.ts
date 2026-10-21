// API for the Revit add-in. Authenticates with a project connector token:  Authorization: Connector <token>
//   GET  /api/connector/v1/project                  project + published models
//   POST /api/connector/v1/snapshots                publish a model snapshot (changed elements)
//   GET  /api/connector/v1/navigation               take pending "Open in Revit" requests
//   POST /api/connector/v1/navigation/:id/result    report the outcome of a request
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../db.ts'
import type { Tx } from '../db.ts'
import { HttpError, notFound, rule, unauthorized } from '../lib/http.ts'
import { NAV_OUTCOMES, hashToken } from '../services/revit.ts'

declare global {
  namespace Express {
    interface Request { connector?: { tokenId: string; name: string; projectId: string; projectCode: string } }
  }
}

export const connector = Router()

connector.use(async (req: Request, _res: Response, next: NextFunction) => {
  const h = req.headers.authorization ?? ''
  const token = h.startsWith('Connector ') ? h.slice(10).trim() : ''
  if (!token) throw unauthorized('Connector token required (Authorization: Connector <token>).')
  const t = await prisma.connectorToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { project: { select: { id: true, code: true } } } })
  if (!t || t.revokedAt) throw unauthorized('Connector token is invalid or revoked.')
  await prisma.connectorToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } })
  req.connector = { tokenId: t.id, name: t.name, projectId: t.project.id, projectCode: t.project.code }
  next()
})

const ctxOf = (req: Request) => req.connector!

/** Writes need an active project with Revit integration switched on. Runs under the project lock like user actions. */
async function write<T>(req: Request, fn: (tx: Tx, audit: (text: string) => Promise<void>, notice: (text: string, forRole?: string) => Promise<void>) => Promise<T>) {
  const k = ctxOf(req)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${k.projectId}))::text AS locked`
    const p = await tx.project.findUniqueOrThrow({ where: { id: k.projectId } })
    if (p.status === 'Archived') throw rule(`${p.code} is archived and read-only.`)
    if (!p.revitMode) throw new HttpError(409, `Revit integration is switched off for ${p.code}. Owner / QA or the Consultant can switch it on under Setup → Integrations.`)
    const audit = async (text: string) => { await tx.auditEvent.create({ data: { projectId: p.id, role: 'Connector', userName: `Revit connector: ${k.name}`, text, requestId: req.requestId } }) }
    const notice = async (text: string, forRole?: string) => {
      const seq = ((await tx.notice.aggregate({ where: { projectId: p.id }, _max: { seq: true } }))._max.seq ?? 0) + 1
      await tx.notice.create({ data: { projectId: p.id, seq, category: 'Source', text, forRole } })
    }
    return fn(tx, audit, notice)
  }, { timeout: 15_000 })
}

connector.get('/v1/project', async (req, res) => {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: ctxOf(req).projectId }, include: { revitModels: { orderBy: { name: 'asc' } } } })
  res.json({
    code: p.code, name: p.name, status: p.status, revitEnabled: p.revitMode,
    models: p.revitModels.map((m) => ({ guid: m.guid, name: m.name, lastSnapshotAt: m.lastSnapshotAt?.toISOString() ?? null })),
  })
})

const zChange = z.object({ elementId: z.string().min(1).max(100), kind: z.enum(['Added', 'Modified', 'Deleted', 'Parameter changed', 'Sheet revised']), detail: z.string().max(500).default('') })

connector.post('/v1/snapshots', async (req, res) => {
  const b = z.object({
    model: z.object({ guid: z.string().min(1).max(100), name: z.string().min(1).max(200) }),
    version: z.string().min(1).max(100),
    elementCount: z.number().int().min(0).optional(),
    changes: z.array(zChange).max(10_000),
  }).parse(req.body ?? {})
  const k = ctxOf(req)
  const out = await write(req, async (tx, audit, notice) => {
    const m = await tx.revitModel.upsert({
      where: { projectId_guid: { projectId: k.projectId, guid: b.model.guid } },
      update: { name: b.model.name, lastSnapshotAt: new Date() },
      create: { projectId: k.projectId, guid: b.model.guid, name: b.model.name, lastSnapshotAt: new Date() },
    })
    if (await tx.modelSnapshot.findUnique({ where: { modelId_version: { modelId: m.id, version: b.version } } })) throw new HttpError(409, `Version ${b.version} of ${b.model.name} was already published.`)
    const sn = await tx.modelSnapshot.create({ data: { projectId: k.projectId, modelId: m.id, version: b.version, publishedBy: k.name, elementCount: b.elementCount ?? b.changes.length, changes: b.changes } })
    await audit(`Revit model ${b.model.name} published version ${b.version} (${b.changes.length} element change(s))`)
    await notice(`Revit model ${b.model.name} published version ${b.version} (${b.changes.length} change(s)). Import it into the affected documents under Source files.`, 'Contractor')
    return { snapshotId: sn.id }
  })
  res.status(201).json(out)
})

/** Hands pending requests to the add-in and marks them delivered. */
connector.get('/v1/navigation', async (req, res) => {
  const k = ctxOf(req)
  const now = new Date()
  const pending = await prisma.navigationRequest.findMany({ where: { projectId: k.projectId, status: 'Pending', expiresAt: { gt: now } }, include: { pin: { select: { code: true, text: true } } }, orderBy: { createdAt: 'asc' } })
  if (pending.length) await prisma.navigationRequest.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: 'Delivered', deliveredAt: now } })
  res.json({
    requests: pending.map((n) => ({ id: n.id, comment: n.pin.code, text: n.pin.text, modelGuid: n.modelGuid, elementId: n.elementId, revision: n.rev, requestedBy: n.requestedByName, createdAt: n.createdAt.toISOString(), expiresAt: n.expiresAt.toISOString() })),
  })
})

connector.post('/v1/navigation/:id/result', async (req, res) => {
  const b = z.object({ outcome: z.enum(NAV_OUTCOMES), detail: z.string().max(500).optional() }).parse(req.body ?? {})
  const k = ctxOf(req)
  await write(req, async (tx, audit) => {
    const n = await tx.navigationRequest.findFirst({ where: { id: req.params.id as string, projectId: k.projectId }, include: { pin: { select: { code: true } } } })
    if (!n) throw notFound('Navigation request not found.')
    if (n.status !== 'Pending' && n.status !== 'Delivered') throw new HttpError(409, `This request is already ${n.status}.`)
    if (n.expiresAt < new Date()) throw new HttpError(409, 'This request has expired; ask the user to send it again.')
    await tx.navigationRequest.update({ where: { id: n.id }, data: { status: b.outcome, detail: b.detail ?? null, completedAt: new Date() } })
    await audit(`Revit navigation for ${n.pin.code}: ${b.outcome}${b.detail ? ` (${b.detail})` : ''}`)
  })
  res.json({ ok: true })
})
