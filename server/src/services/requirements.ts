import { coverage, evidenceState } from '../domain/rules.ts'
import { changeList } from '../lib/audit.ts'
import type { Applicability, GapAction, MarketKey, Scope } from '../domain/types.ts'
import type { BimRequirement, IndustryGroup, ServiceType } from '../domain/industries.ts'
import { bimJson, checkClassification, classificationLine } from './projects.ts'
import { forbidden, notFound, rule } from '../lib/http.ts'
import { getDoc, getOr404, getReq, nextCode, codeKey } from './ctx.ts'
import type { Ctx } from './ctx.ts'
import { toDate } from './documents.ts'
import { assertActive } from './docRegister.ts'
import { applyLibraryVersion, instantiateMarket } from './libraryProjects.ts'
import { requireDiscipline, requireSystem } from './registers.ts'
import { loadProject } from './loadProject.ts'

/** The BIM block as audit text, so a change inside it is reported like any other field. */
const bimText = (b: unknown) => {
  const r = b as BimRequirement | null | undefined
  return r ? `${r.lod}, coordination ${r.coordination ? 'yes' : 'no'}, handover ${r.assetHandover}` : 'none'
}

export async function saveProfile(c: Ctx, p: {
  industryGroup: IndustryGroup
  facilityType: string
  secondaryFacilityType?: string
  customFacilityType?: string
  serviceType: ServiceType
  scope: Scope
  projectStage: string
  bimRequirement?: BimRequirement
  ownerStandards: string
  markets: MarketKey[]
  reason: string
}) {
  if (c.role !== 'Owner / QA') throw forbidden('Owner / QA role required to change project scope.')
  if (!p.reason.trim()) throw rule('A change rationale is required.')
  if (!p.markets.length) throw rule('Select at least one target market.')
  const cls = checkClassification(p)
  // A different facility type or scope changes which requirements apply; the industry group changes it even more.
  const material = cls.facilityType !== c.project.facilityType || p.scope !== c.project.scope || cls.industryGroup !== c.project.industryGroup
  const v = c.project.baseline + 1
  const markets = [...new Set([c.project.projectCountry, ...p.markets])]
  const fields = changeList([
    ['industry group', c.project.industryGroup, cls.industryGroup],
    ['facility type', c.project.facilityType, cls.facilityType],
    ['secondary facility type', c.project.secondaryFacilityType ?? '', cls.secondaryFacilityType ?? ''],
    ['custom facility type', c.project.customFacilityType ?? '', cls.customFacilityType ?? ''],
    ['service type', c.project.serviceType, cls.serviceType],
    ['scope', c.project.scope, p.scope],
    ['project stage', c.project.projectStage, cls.projectStage],
    ['BIM requirement', bimText(c.project.bimRequirement), bimText(cls.bimRequirement)],
    ['owner standards', c.project.ownerStandards, p.ownerStandards],
    ['markets', c.project.markets as string[], markets],
  ])
  await c.tx.project.update({
    where: { id: c.project.id },
    data: { ...cls, bimRequirement: bimJson(cls.bimRequirement), scope: p.scope, ownerStandards: p.ownerStandards, markets, baseline: v },
  })
  await c.tx.baseline.create({ data: { projectId: c.project.id, v, byRole: c.role, byUserId: c.user.id, reason: p.reason } })
  if (material) {
    await c.tx.requirement.updateMany({ where: { projectId: c.project.id }, data: { applicability: 'Assessment pending', rationale: 'Industry group, facility type or scope changed; reassess applicability.' } })
  }
  await c.log(`Baseline B${v} created (${classificationLine(cls)}): ${fields.join('; ') || 'no profile field changed'}. Reason: ${p.reason}${material ? ' (applicability reset)' : ''}`)
  // A newly targeted market brings in its approved library requirements.
  const before = (c.project.markets as string[]) ?? []
  const added = [...new Set([c.project.projectCountry, ...p.markets])].filter((m) => !before.includes(m))
  for (const m of added) {
    const r = await instantiateMarket(c.tx, { id: c.project.id, industryGroup: cls.industryGroup, facilityType: cls.facilityType }, m)
    if (r.version) await c.log(`${r.codes.length} requirement(s) added from library ${m} v${r.version.version}${r.disciplines.length ? `; disciplines added: ${r.disciplines.join(', ')}` : ''}`)
    else await c.log(`No approved library pack for ${m}: no requirements added`)
  }
}

/** Project-specific requirement (owner standard, SOP, client specification) — not from the library. */
export async function addRequirement(c: Ctx, b: { title: string; market: MarketKey; discipline: string; system: string; topic: string; critical: boolean; owner: string; due: string }) {
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA adds requirements.')
  const title = b.title.trim()
  if (title.length < 3) throw rule('Describe the requirement (at least 3 characters).')
  if (!((c.project.markets as string[]) ?? []).includes(b.market)) throw rule(`${b.market} is not a target market of this project.`)
  await requireDiscipline(c, b.discipline)
  if (b.system) await requireSystem(c, b.system)
  if (!b.owner.trim()) throw rule('Name the owner of the requirement.')
  const codes = await c.tx.requirement.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('REQ', codes)
  await c.tx.requirement.create({
    data: { projectId: c.project.id, code, title, market: b.market, topic: b.topic.trim() || 'Project-specific requirement', discipline: b.discipline, system: b.system, applicability: 'Required', rationale: 'Project-specific requirement added by a reviewer.', owner: b.owner.trim(), due: toDate(b.due), critical: b.critical },
  })
  await c.log(`${code} project-specific requirement added: ${title}`)
}

/** Assign the system, owner and due date of a requirement (library items arrive without a system). */
export async function updateRequirement(c: Ctx, code: string, b: { system: string; owner: string; due: string }) {
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA edits requirements.')
  const r = await getReq(c, code)
  if (b.system) await requireSystem(c, b.system)
  if (!b.owner.trim()) throw rule('Name the owner of the requirement.')
  const changes = [b.system !== r.system && `system ${r.system || '—'} -> ${b.system || '—'}`, b.owner.trim() !== r.owner && `owner ${r.owner} -> ${b.owner.trim()}`, toDate(b.due).getTime() !== r.due.getTime() && `due ${r.due.toISOString().slice(0, 10)} -> ${b.due}`].filter(Boolean)
  if (!changes.length) throw rule('Nothing changed.')
  await c.tx.requirement.update({ where: { id: r.id }, data: { system: b.system, owner: b.owner.trim(), due: toDate(b.due) } })
  await c.log(`${r.code} updated: ${changes.join('; ')}`)
}

export async function decideApplicability(c: Ctx, code: string, a: Applicability, rationale: string) {
  const r = await getReq(c, code)
  if (c.role === 'Contractor') throw forbidden('A contractor cannot decide applicability.')
  if (!rationale.trim()) throw rule('Decision rationale is required.')
  await c.tx.requirement.update({ where: { id: r.id }, data: { applicability: a, rationale } })
  await c.log(`${r.code} ${changeList([['applicability', r.applicability, a]])[0] ?? `applicability "${a}" confirmed`}. Rationale: ${rationale.trim()}`)
}

/**
 * The same decision for several requirements at once (first set-up of a project: a market pack arrives with dozens of
 * topics). The rationale is written to every requirement and every one gets its own audit entry, marked as part of
 * the batch, so the trail stays per record.
 */
export async function decideApplicabilityBulk(c: Ctx, codes: string[], a: Applicability, rationale: string) {
  if (c.role === 'Contractor') throw forbidden('A contractor cannot decide applicability.')
  if (!rationale.trim()) throw rule('Decision rationale is required.')
  const unique = [...new Set(codes)]
  if (!unique.length) throw rule('Select at least one requirement.')
  if (unique.length > 500) throw rule('Decide at most 500 requirements at a time.')
  const reqs = await Promise.all(unique.map((code) => getReq(c, code)))
  for (const r of reqs) {
    await c.tx.requirement.update({ where: { id: r.id }, data: { applicability: a, rationale } })
    await c.log(`${r.code} ${changeList([['applicability', r.applicability, a]])[0] ?? `applicability "${a}" confirmed`} (one of ${reqs.length} decided together). Rationale: ${rationale.trim()}`)
  }
}

export async function setSourceRef(c: Ctx, code: string, s: { clause: string; version: string; effective: string; attest: boolean }) {
  const r = await getReq(c, code)
  if (c.role === 'Contractor') throw forbidden('Only a reviewer can record source references.')
  if (s.attest && (!s.clause.trim() || !s.version.trim() || !s.effective.trim())) throw rule('Clause, source version and effective date are all required before attesting.')
  await c.tx.requirement.update({ where: { id: r.id }, data: { clause: s.clause, sourceVersion: s.version, effective: s.effective, sourceAttested: s.attest } })
  const fields = changeList([['clause', r.clause, s.clause], ['source version', r.sourceVersion, s.version], ['effective', r.effective, s.effective], ['attested', r.sourceAttested, s.attest]])
  await c.log(`${r.code} source reference ${s.attest ? 'recorded (user-attested, not a released rule pack)' : 'saved as draft'}${fields.length ? `: ${fields.join('; ')}` : ''}`)
}

export async function linkEvidence(c: Ctx, reqCode: string, docCode: string, note: string) {
  const r = await getReq(c, reqCode)
  const d = await getDoc(c, docCode)
  if (!note.trim()) throw rule('State what this evidence supports.')
  assertActive(d)
  if (d.status === 'Missing') throw rule('A missing document cannot be linked as evidence.')
  const existing = await c.tx.evidenceLink.findMany({ where: { requirementId: r.id }, select: { documentId: true, rev: true, decision: true } })
  if (existing.some((e) => e.documentId === d.id && e.rev === d.rev && e.decision !== 'Withdrawn')) throw rule('This revision is already linked.')
  await c.tx.evidenceLink.create({ data: { requirementId: r.id, documentId: d.id, position: existing.length, rev: d.rev, decision: 'Pending', note, byRole: c.role, byUserId: c.user.id } })
  await c.log(`Evidence linked ${r.code} <- ${d.code} R${d.rev}`)
}

export async function assessEvidence(c: Ctx, reqCode: string, evidenceId: string, accept: boolean, reason: string) {
  const r = await getReq(c, reqCode)
  const e = await c.tx.evidenceLink.findFirst({ where: { id: evidenceId, requirementId: r.id }, include: { document: true } })
  if (!e) throw notFound('Evidence link not found on this requirement.')
  if (c.role === 'Contractor') throw forbidden('Contractors cannot assess evidence.')
  if (e.decision === 'Withdrawn') throw rule('This link was withdrawn; link the current document again instead.')
  if (!reason.trim()) throw rule('Rationale is required.')
  if (e.byRole === c.role || e.byUserId === c.user.id) throw rule('Self-acceptance is blocked. Another reviewer must assess evidence you linked.')
  if (accept && (e.document.rev !== e.rev || e.document.status !== 'Accepted')) throw rule('Only a current, accepted document revision can satisfy this requirement.')
  await c.tx.evidenceLink.update({ where: { id: e.id }, data: { decision: accept ? 'Accepted' : 'Rejected', reason, reviewedBy: c.role, reviewedByUserId: c.user.id } })
  await c.log(`Evidence ${accept ? 'accepted' : 'rejected'}: ${r.code} <- ${e.document.code} R${e.rev} (decision "${e.decision}" -> "${accept ? 'Accepted' : 'Rejected'}"). Rationale: ${reason.trim()}`)
}

/** Withdraw an evidence link (wrong document, replaced evidence). It stays visible as history but no longer counts. */
export async function withdrawEvidence(c: Ctx, reqCode: string, evidenceId: string, reason: string) {
  const r = await getReq(c, reqCode)
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA withdraws evidence links.')
  const e = await c.tx.evidenceLink.findFirst({ where: { id: evidenceId, requirementId: r.id }, include: { document: true } })
  if (!e) throw notFound('Evidence link not found on this requirement.')
  if (e.decision === 'Withdrawn') throw rule('This link is already withdrawn.')
  if (!reason.trim()) throw rule('State why the link is withdrawn.')
  await c.tx.evidenceLink.update({ where: { id: e.id }, data: { decision: 'Withdrawn', reason, reviewedBy: c.role, reviewedByUserId: c.user.id } })
  await c.log(`Evidence withdrawn: ${r.code} <- ${e.document.code} R${e.rev}. Reason: ${reason.trim()}`)
}

export async function addAction(c: Ctx, a: { req: string; title: string; owner: string; due: string; priority: GapAction['priority'] }) {
  const r = await getReq(c, a.req)
  if (!a.title.trim()) throw rule('Describe the action first.')
  if (!a.owner.trim()) throw rule('An action owner is required.')
  const codes = await c.tx.gapAction.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('GAP', codes)
  await c.tx.gapAction.create({ data: { projectId: c.project.id, code, requirementId: r.id, title: a.title, owner: a.owner, due: toDate(a.due), priority: a.priority } })
  await c.log(`Corrective action ${code} assigned`)
}

export async function progressAction(c: Ctx, code: string, to: GapAction['status']) {
  const a = await getOr404(c.tx.gapAction.findUnique({ where: codeKey(c, code) }), `Action ${code}`)
  if (to === 'Ready for verification' && a.status !== 'Open') throw rule('Only an open action can be submitted for verification.')
  if (to === 'Closed') {
    if (c.role === 'Contractor' || a.submittedBy === c.role) throw forbidden('Independent consultant / QA verification is required to close.')
    if (a.status !== 'Ready for verification') throw rule('The action must be submitted for verification before it can be closed.')
  }
  if (to === 'Open') throw rule('Actions cannot be moved back to Open.')
  await c.tx.gapAction.update({ where: { id: a.id }, data: { status: to, submittedBy: to === 'Ready for verification' ? c.role : a.submittedBy } })
  await c.log(`${a.code} status "${a.status}" -> "${to}"`)
}

export async function assessUpdate(c: Ctx, code: string, applicable: boolean, reason: string) {
  if (c.role !== 'Owner / QA') throw forbidden('Owner / QA role required.')
  if (!reason.trim()) throw rule('Rationale is required.')
  const u = await getOr404(c.tx.regUpdate.findUnique({ where: codeKey(c, code) }), `Regulatory update ${code}`)
  if (u.status !== 'Awaiting assessment') throw rule('Already assessed.')
  await c.tx.regUpdate.update({ where: { id: u.id }, data: { status: applicable ? 'Applied to draft baseline' : 'Not applicable', reason } })
  if (applicable && u.kind === 'Library' && u.libraryVersionId) {
    const r = await applyLibraryVersion(c.tx, c.project, u.market, u.libraryVersionId)
    const v = c.project.baseline + 1
    await c.tx.project.update({ where: { id: c.project.id }, data: { baseline: v } })
    await c.tx.baseline.create({ data: { projectId: c.project.id, v, byRole: c.role, byUserId: c.user.id, reason: `${u.code}: ${reason}` } })
    await c.tx.regUpdate.update({ where: { id: u.id }, data: { reqs: [...r.added, ...r.changed, ...r.removed] } })
    await c.log(`${u.code} applied: baseline B${v}; ${r.added.length} added (${r.added.join(', ') || '—'}), ${r.changed.length} changed and reopened (${r.changed.join(', ') || '—'}), ${r.removed.length} marked not applicable (${r.removed.join(', ') || '—'})`)
    return
  }
  if (applicable) {
    const v = c.project.baseline + 1
    await c.tx.project.update({ where: { id: c.project.id }, data: { baseline: v } })
    await c.tx.baseline.create({ data: { projectId: c.project.id, v, byRole: c.role, byUserId: c.user.id, reason: `${u.code}: ${reason}` } })
    await c.tx.evidenceLink.updateMany({ where: { requirement: { projectId: c.project.id, code: { in: u.reqs as string[] } }, decision: { not: 'Withdrawn' } }, data: { decision: 'Pending' } })
    await c.log(`${u.code} applicable: baseline B${v} created, affected evidence reopened`)
  } else {
    await c.log(`${u.code} judged not applicable`)
  }
}

/** Freezes the current evidence position into an immutable audit package. Reads committed state; the project lock is held. */
export async function createSnapshot(c: Ctx) {
  const s = await loadProject(c.project.id, c.user.id)
  const scoped = s.reqs.filter((r) => s.markets.includes(r.market))
  const rows = scoped.map((r) => ({ id: r.id, title: r.title, market: r.market, applicability: r.applicability, state: evidenceState(r, s.docs), links: r.evidence.map((e) => `${e.doc}/R${e.rev}:${e.decision}`).join('; ') }))
  const cov = coverage(scoped, s.docs)
  const codes = await c.tx.snapshot.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('AUD', codes)
  await c.tx.snapshot.create({
    data: {
      projectId: c.project.id, code, byRole: c.role, byUserId: c.user.id, baseline: s.baseline, markets: [...s.markets], required: cov.required.length, accepted: cov.accepted.length,
      blockers: rows.filter((r) => !['Not applicable', 'Evidence accepted'].includes(r.state)).map((r) => `${r.id}: ${r.state}`), rows,
    },
  })
  await c.log(`Audit snapshot ${code} frozen`)
}
