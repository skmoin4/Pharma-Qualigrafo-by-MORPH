import { expectedSigner } from '../domain/rules.ts'
import { SIGNATURE_MEANING, signatureHash } from '../lib/esign.ts'
import { requireCompany, requireDiscipline, requireSystem } from './registers.ts'
import type { Role } from '../domain/types.ts'
import { forbidden, notFound, rule } from '../lib/http.ts'
import { getDoc, nextCode } from './ctx.ts'
import { assertActive } from './docRegister.ts'
import { markReturned, openForReview, recordSignature, supersedeEarlier } from './revisions.ts'
export { setSuitability } from './revisions.ts'
import type { Ctx } from './ctx.ts'

export const toDate = (d: string) => new Date(`${d}T00:00:00Z`)
const SUBMITTABLE = ['Missing', 'Draft', 'Changes requested']

export async function submitDoc(c: Ctx, code: string, note: string, issue: { reasonForIssue?: string; changeSummary?: string; suitability?: string } = {}) {
  const d = await getDoc(c, code)
  if (c.role !== 'Contractor') throw forbidden('Only the Contractor submits documents for review.')
  assertActive(d)
  if (!SUBMITTABLE.includes(d.status)) throw rule(`${d.code} is ${d.status}; only Missing, Draft or Changes requested documents can be submitted.`)
  if (!hasCurrentSource(d)) throw rule(`Attach the source file for ${d.code} ${pad(d.rev)} before submitting.`)
  if (!note.trim()) throw rule('Add a submission note.')
  await c.tx.document.update({ where: { id: d.id }, data: { status: 'Under review', signStage: 0 } })
  await c.tx.docHistory.create({ data: { documentId: d.id, rev: d.rev, status: 'Under review', byRole: c.role, byUserId: c.user.id, note } })
  // Submitting opens the formal revision: a working version becomes something offered for a stated purpose.
  // The submission note is the default reason for issue, so a project that states nothing more still records why.
  await openForReview(c, d, {
    reasonForIssue: issue.reasonForIssue?.trim() || note.trim(),
    changeSummary: issue.changeSummary ?? '',
    suitability: issue.suitability ?? '',
  })
  await c.log(`${d.code} R${d.rev} submitted for review${issue.suitability ? ` (suitability ${issue.suitability.trim()})` : ''}`)
  if (c.project.autoRouting) await c.notify('Routing', `${d.code} R${d.rev} submitted. Signature request routed to Consultant.`, d.code, 'Consultant')
}

export async function signDoc(c: Ctx, code: string, reason: string, intent: boolean) {
  const d = await getDoc(c, code)
  const expected = expectedSigner(d.signStage)
  if (d.status !== 'Under review' || d.signStage === 2) throw rule('Document is not awaiting sign-off.')
  if (c.role !== expected) throw forbidden(`Awaiting ${expected}. Only ${expected} can sign this stage.`)
  if (!reason.trim()) throw rule('A sign-off reason is required.')
  if (!intent) throw rule('Explicit confirmation required: tick that you reviewed this exact revision.')
  if (!hasCurrentSource(d)) throw rule(`${d.code} ${pad(d.rev)} has no source file to sign.`)
  const stage = d.signStage + 1
  const done = stage === 2
  // Signer identity always comes from the authenticated (and re-authenticated) account, never from the request body.
  const meaning = SIGNATURE_MEANING[d.signStage]
  const at = new Date()
  const sigHash = signatureHash({ doc: d.code, rev: d.rev, checksum: d.checksum!, userId: c.user.id, email: c.user.email, name: c.user.name, role: c.role, meaning, reason, at })
  await c.tx.docSignature.create({ data: { documentId: d.id, role: c.role, name: c.user.name, userId: c.user.id, email: c.user.email, rev: d.rev, reason, meaning, checksum: d.checksum, sigHash, at } })
  await c.tx.document.update({ where: { id: d.id }, data: { signStage: stage, status: done ? 'Accepted' : d.status } })
  await recordSignature(c, d.id, d.rev, stage)
  if (done) await supersedeEarlier(c, d.id, d.rev)
  if (done) await c.tx.docHistory.create({ data: { documentId: d.id, rev: d.rev, status: 'Accepted', byRole: c.role, byUserId: c.user.id, note: reason } })
  await c.log(`${d.code} R${d.rev} sign-off by ${c.role}${done ? ' - revision accepted' : ''} (e-signature: ${c.user.name}, "${meaning}", content ${d.checksum!.slice(0, 12)}…)`)

  await c.notify('Signature', `${c.role} (${c.user.name}) signed ${d.code} R${d.rev}.`, d.code)
  if (!done && c.project.autoRouting) await c.notify('Routing', `${d.code} R${d.rev} automatically routed to Owner / QA for stage 2.`, d.code, 'Owner / QA')
  if (!done) return
  await c.notify('Issue status', `${d.code} R${d.rev} accepted. Dependent evidence and readiness recalculated.`, d.code)
  if (!c.project.autoIssue) return
  const sigs = await c.tx.docSignature.findMany({ where: { documentId: d.id, rev: d.rev }, orderBy: { at: 'asc' } })
  const codes = await c.tx.issuedPackage.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  await c.tx.issuedPackage.create({
    data: {
      projectId: c.project.id, code: nextCode('ISS', codes), documentId: d.id, title: d.title, rev: d.rev, checksum: d.checksum,
      signers: sigs.map((s) => ({ role: s.role, name: s.name, email: s.email, at: s.at.toISOString(), meaning: s.meaning, sigHash: s.sigHash })),
    },
  })
  await c.notify('Issue', `Controlled issue manifest generated for ${d.code} R${d.rev}.`, d.code)
}

export async function returnDoc(c: Ctx, code: string, reason: string) {
  const d = await getDoc(c, code)
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA can return a document.')
  if (d.status !== 'Under review') throw rule('Document is not awaiting sign-off.')
  if (!reason.trim()) throw rule('Explain the required changes.')
  await c.tx.document.update({ where: { id: d.id }, data: { status: 'Changes requested', signStage: 0 } })
  await c.tx.docHistory.create({ data: { documentId: d.id, rev: d.rev, status: 'Changes requested', byRole: c.role, byUserId: c.user.id, note: reason } })
  await markReturned(c, d.id, d.rev)
  await c.log(`${d.code} R${d.rev} returned for changes (status "Under review" -> "Changes requested"): ${reason.trim()}`)
  await c.notify('Issue status', `${d.code} returned for changes: approval route cancelled. Earlier sign-offs are kept as history only.`, d.code, 'Contractor')
}

export async function newRevision(c: Ctx, code: string) {
  const d = await getDoc(c, code)
  if (c.role !== 'Contractor') throw forbidden('Only the responsible contractor starts a new revision.')
  assertActive(d)
  if (d.status !== 'Accepted') throw rule('A new revision can only be started from an accepted revision.')
  const rev = d.rev + 1
  await c.tx.document.update({ where: { id: d.id }, data: { rev, status: 'Draft', signStage: 0 } })
  await c.tx.docHistory.create({ data: { documentId: d.id, rev, status: 'Draft', byRole: c.role, byUserId: c.user.id } })
  await c.log(`${d.code} new revision started - linked evidence needs reassessment`)
  await c.notify('Revision', `${d.code} R${rev} started. Earlier signatures stay with R${d.rev} only; fresh approval is required.`, d.code)
}

type DocRow = Awaited<ReturnType<typeof getDoc>>
const pad = (n: number) => `R${String(n).padStart(2, '0')}`
export const hasCurrentSource = (d: Pick<DocRow, 'rev' | 'sourceRev' | 'checksum'>) => d.sourceRev === d.rev && !!d.checksum

/**
 * A Missing/Draft revision has never been submitted, so a source attaches to it (replacing any earlier draft file).
 * Any other state (Under review, Changes requested, Accepted) gets a new draft revision: submitted content is never overwritten.
 */
async function applySource(c: Ctx, d: DocRow, s: { mode: 'Standalone' | 'Revit'; label: string; checksum: string; fileId?: string }) {
  if (c.role !== 'Contractor') throw forbidden('Only the responsible contractor provides document sources.')
  assertActive(d)
  const dup = await c.tx.importBatch.findUnique({ where: { documentId_checksum: { documentId: d.id, checksum: s.checksum } } })
  if (dup) throw rule(`Duplicate source: identical content was already imported for ${d.code} (${dup.code}).`)
  const inPlace = d.status === 'Missing' || d.status === 'Draft'
  const cancelled = d.status === 'Under review'
  const toRev = inPlace ? d.rev : d.rev + 1
  await c.tx.document.update({ where: { id: d.id }, data: { rev: toRev, status: 'Draft', signStage: 0, source: s.mode, checksum: s.checksum, sourceRev: toRev, fileId: s.fileId ?? null } })
  await c.tx.docHistory.create({ data: { documentId: d.id, rev: toRev, status: 'Draft', byRole: c.role, byUserId: c.user.id, note: `${s.mode === 'Revit' ? 'Revit snapshot' : 'File'} ${inPlace ? 'attached' : 'imported'}: ${s.label}` } })
  const codes = await c.tx.importBatch.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('IMP', codes)
  await c.tx.importBatch.create({ data: { projectId: c.project.id, code, mode: s.mode, documentId: d.id, fromRev: d.rev, toRev, checksum: s.checksum, label: s.label, cancelledRoute: cancelled, byUserId: c.user.id, fileId: s.fileId } })
  if (inPlace) {
    await c.notify('Source', `${s.mode === 'Revit' ? 'Revit snapshot' : 'Source file'} ${hasCurrentSource(d) ? 'replaced on' : 'attached to'} draft ${d.code} ${pad(toRev)} (${s.label}). Ready to submit.`, d.code)
  } else {
    await c.notify('Source', `${s.mode} source imported for ${d.code}: new draft ${pad(toRev)}. The previous revision is untouched; fresh approval is required.`, d.code)
    if (cancelled) await c.notify('Issue status', `Pending approval route for ${d.code} ${pad(d.rev)} cancelled because the source changed.`, d.code)
  }
  await c.log(`${code}: ${s.mode} source ${inPlace ? 'attached to' : 'imported as'} ${d.code} ${pad(toRev)} (${s.label})`)
}

/** Revit connector snapshot (no bytes are transferred; the model id + version form the checksum). */
/** Import a model snapshot published by the Revit add-in as the source of a document (attaches to a draft or starts a new revision). */
export async function importRevit(c: Ctx, code: string, snapshotId: string) {
  const d = await getDoc(c, code)
  const sn = await c.tx.modelSnapshot.findFirst({ where: { id: snapshotId, projectId: c.project.id }, include: { model: true } })
  if (!sn) throw notFound('Model snapshot not found in this project.')
  await applySource(c, d, { mode: 'Revit', label: `${sn.model.name} · ${sn.version}`, checksum: `revit:${sn.model.guid}:${sn.version}` })
}

/** Uploaded file: the checksum is the SHA-256 the server computed over the received bytes. */
export async function uploadSource(c: Ctx, code: string, f: { sha256: string; size: number; mimeType: string; name: string; label?: string }) {
  const d = await getDoc(c, code)
  const file = await c.tx.storedFile.upsert({
    where: { projectId_sha256: { projectId: c.project.id, sha256: f.sha256 } },
    update: {},
    create: { projectId: c.project.id, sha256: f.sha256, size: f.size, mimeType: f.mimeType, originalName: f.name, uploadedByUserId: c.user.id, uploadedByName: c.user.name, uploadedByRole: c.role },
  })
  await applySource(c, d, { mode: 'Standalone', label: f.label?.trim() || f.name, checksum: f.sha256, fileId: file.id })
}

export async function generateDeliverables(c: Ctx, g: { tag: string; vendor: string; discipline: string; due: string }) {
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA can generate a deliverable package.')
  const tag = g.tag.trim()
  const vendor = g.vendor.trim()
  if (!tag || !vendor) throw rule('Equipment tag and vendor are required.')
  await requireSystem(c, tag)
  await requireCompany(c, vendor)
  await requireDiscipline(c, g.discipline)
  const exists = await c.tx.document.findFirst({ where: { projectId: c.project.id, system: tag, owner: vendor, title: { startsWith: `${tag} · ` } } })
  if (exists) throw rule('This package already exists for the same tag and vendor.')
  const codes = await c.tx.document.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const added: string[] = []
  for (const kind of ['Vendor datasheet', 'Approved-drawing submission', 'O&M manual']) {
    const code = nextCode('DOC', [...codes, ...added.map((a) => ({ code: a }))])
    added.push(code)
    await c.tx.document.create({
      data: {
        projectId: c.project.id, code, title: `${tag} · ${kind}`, discipline: g.discipline, system: tag, rev: 0, status: 'Draft', owner: vendor, due: toDate(g.due), critical: false, signStage: 0,
        history: { create: { rev: 0, status: 'Draft', byRole: c.role as Role, byUserId: c.user.id } },
      },
    })
  }
  await c.log(`Draft vendor package generated for ${tag} (${vendor}): ${added.join(', ')}`)
  await c.notify('Routing', `Draft package for ${tag}: ${added.length} deliverables assigned to ${vendor}. Confirm requirements before treating them as required evidence.`)
}
