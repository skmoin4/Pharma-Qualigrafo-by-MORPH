// Formal document revisions (Phase 5 / step 3).
//
// The distinction the client asked for: a **version** is an internal working iteration — attaching a file to a draft
// replaces what is there — while a **revision** is formal and controlled. Submitting a document for review opens a
// revision; it records why it is being issued, under which suitability code, who prepared it and the exact content
// it carries. Signing fills in who checked and who approved it. Acceptance issues it and supersedes the one before.
//
// An issued revision is never overwritten. Starting a new revision leaves the old row in place, marked Superseded,
// with its own checksum and file, so the register and the revision tree keep the whole history.
import { Prisma } from '../generated/prisma/client.ts'
import { SUITABILITY_KINDS, defaultSuitability } from '../domain/suitability.ts'
import type { SuitabilityCode } from '../domain/suitability.ts'
import { forbidden, rule } from '../lib/http.ts'
import type { Ctx } from './ctx.ts'

/** A project's suitability set: what it was given at creation, or the ISO 19650 default for projects created before. */
export const suitabilityOf = (project: { suitabilityCodes: unknown }) =>
  ((project.suitabilityCodes as SuitabilityCode[] | null) ?? defaultSuitability())

/** The revision a document is working on, if one is open. */
export const openRevision = (c: Ctx, documentId: string, rev: number) =>
  c.tx.docRevision.findUnique({ where: { documentId_rev: { documentId, rev } } })

/**
 * Opens (or re-opens) the formal revision a submission is for. A revision that was returned and submitted again
 * keeps its row: it is the same revision, being offered a second time.
 */
export async function openForReview(c: Ctx, d: { id: string; rev: number; checksum: string | null; fileId: string | null }, b: { reasonForIssue: string; changeSummary: string; suitability: string }) {
  const codes = suitabilityOf(c.project)
  const suitability = b.suitability.trim()
  if (suitability && !codes.some((x) => x.code === suitability)) {
    throw rule(`${suitability} is not one of this project's suitability codes (${codes.map((x) => x.code).join(', ')}).`)
  }
  const existing = await openRevision(c, d.id, d.rev)
  const previous = existing?.previousId
    ? null
    : await c.tx.docRevision.findFirst({ where: { documentId: d.id, rev: { lt: d.rev } }, orderBy: { rev: 'desc' }, select: { id: true } })
  const data = {
    state: 'Under review',
    reasonForIssue: b.reasonForIssue.trim(),
    changeSummary: b.changeSummary.trim(),
    suitability,
    preparedBy: c.user.name,
    preparedAt: new Date(),
    checksum: d.checksum,
    fileId: d.fileId,
    // A re-submission replaces the earlier reviewers: they have not seen this content.
    checkedBy: '', checkedAt: null, approvedBy: '', approvedAt: null,
  }
  if (existing) {
    await c.tx.docRevision.update({ where: { id: existing.id }, data })
    return existing.id
  }
  const made = await c.tx.docRevision.create({
    data: { ...data, projectId: c.project.id, documentId: d.id, rev: d.rev, previousId: previous?.id ?? null },
  })
  return made.id
}

/** Stage 1 of the sign-off is the check; stage 2 is the approval, which issues the revision. */
export async function recordSignature(c: Ctx, documentId: string, rev: number, stage: number) {
  const r = await openRevision(c, documentId, rev)
  if (!r) return
  const at = new Date()
  if (stage === 1) await c.tx.docRevision.update({ where: { id: r.id }, data: { checkedBy: c.user.name, checkedAt: at } })
  else await c.tx.docRevision.update({ where: { id: r.id }, data: { approvedBy: c.user.name, approvedAt: at, state: 'Issued' } })
}

/** The revision was sent back: it is not issued, and it keeps saying so until it is submitted again. */
export async function markReturned(c: Ctx, documentId: string, rev: number) {
  const r = await openRevision(c, documentId, rev)
  if (r) await c.tx.docRevision.update({ where: { id: r.id }, data: { state: 'Returned' } })
}

/** Everything issued before this revision is superseded by it — never deleted. */
export async function supersedeEarlier(c: Ctx, documentId: string, rev: number) {
  await c.tx.docRevision.updateMany({
    where: { documentId, rev: { lt: rev }, state: 'Issued' },
    data: { state: 'Superseded', supersededAt: new Date() },
  })
}

/** The revision that is currently in force for a document, if any has been issued. */
export const currentIssued = (c: Ctx, documentId: string) =>
  c.tx.docRevision.findFirst({ where: { documentId, state: 'Issued' }, orderBy: { rev: 'desc' } })

/**
 * Replaces the project's suitability set. Codes already used by a revision stay valid records of what was issued —
 * removing a code from the set does not rewrite history, it only stops new revisions from using it.
 */
export async function setSuitability(c: Ctx, codes: SuitabilityCode[], reason: string) {
  if (c.role !== 'Owner / QA') throw forbidden('Only Owner / QA can change the suitability codes.')
  if (!reason.trim()) throw rule('Record why the suitability codes are being changed.')
  const clean = codes.map((x) => ({ code: x.code.trim().toUpperCase(), label: x.label.trim(), kind: x.kind.trim() }))
  if (!clean.length) throw rule('A project needs at least one suitability code.')
  const bad = clean.find((x) => !x.code || !x.label)
  if (bad) throw rule('Every suitability code needs a code and a label.')
  if (new Set(clean.map((x) => x.code)).size !== clean.length) throw rule('Suitability codes must be unique.')
  const badKind = clean.find((x) => !SUITABILITY_KINDS.includes(x.kind))
  if (badKind) throw rule(`${badKind.code}: unknown kind "${badKind.kind}". Use one of: ${SUITABILITY_KINDS.join(', ')}.`)

  const before = suitabilityOf(c.project).map((x) => x.code)
  const after = clean.map((x) => x.code)
  const inUse = await c.tx.docRevision.findMany({ where: { projectId: c.project.id, suitability: { notIn: [...after, ''] } }, select: { suitability: true } })
  const lost = [...new Set(inUse.map((x) => x.suitability))]
  await c.tx.project.update({ where: { id: c.project.id }, data: { suitabilityCodes: clean as unknown as Prisma.InputJsonValue } })
  await c.log(`Suitability codes changed: "${before.join(', ')}" -> "${after.join(', ')}". Reason: ${reason.trim()}${lost.length ? `. Revisions already issued under ${lost.join(', ')} keep that code.` : ''}`)
}
