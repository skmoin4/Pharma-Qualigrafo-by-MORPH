// Document register (Master Document Register): create, edit metadata, void / supersede, reinstate, bulk import.
// Content (files, revisions, sign-off) stays in documents.ts; this file only manages what the register says.
import { forbidden, rule } from '../lib/http.ts'
import { getDoc, nextCode } from './ctx.ts'
import type { Ctx } from './ctx.ts'
import { toDate } from './documents.ts'
import { requireCompany, requireDiscipline, requireSystem } from './registers.ts'

export const INACTIVE = ['Void', 'Superseded']

/** Workflow actions on a void or superseded document are refused; the register keeps it as read-only history. */
export function assertActive(d: { code: string; status: string; supersededBy?: string | null }) {
  if (d.status === 'Void') throw rule(`${d.code} is void. Owner / QA can reinstate it if it was voided by mistake.`)
  if (d.status === 'Superseded') throw rule(`${d.code} is superseded by ${d.supersededBy}. Work on ${d.supersededBy} instead.`)
}

const reviewer = (c: Ctx, what: string) => { if (c.role === 'Contractor') throw forbidden(`Only Consultant or Owner / QA ${what}.`) }
const day = (d: Date) => d.toISOString().slice(0, 10)
const R = (n: number) => `R${String(n).padStart(2, '0')}`

export interface DocFields { title: string; number: string; discipline: string; system: string; owner: string; due: string; critical: boolean }

async function numberTaken(c: Ctx, number: string, selfId?: string) {
  if (!number) return null
  return c.tx.document.findFirst({ where: { projectId: c.project.id, number: { equals: number, mode: 'insensitive' }, ...(selfId ? { NOT: { id: selfId } } : {}) }, select: { code: true } })
}

export async function createDocument(c: Ctx, f: DocFields) {
  reviewer(c, 'register documents')
  const title = f.title.trim()
  const number = f.number.trim()
  if (title.length < 3) throw rule('Document title needs at least 3 characters.')
  const dup = await numberTaken(c, number)
  if (dup) throw rule(`Document number ${number} is already used by ${dup.code}.`)
  await requireDiscipline(c, f.discipline)
  if (f.system) await requireSystem(c, f.system)
  await requireCompany(c, f.owner)
  const codes = await c.tx.document.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('DOC', codes)
  await c.tx.document.create({
    data: {
      projectId: c.project.id, code, number, title, discipline: f.discipline, system: f.system, rev: 0, status: 'Missing', owner: f.owner, due: toDate(f.due), critical: f.critical, signStage: 0,
      history: { create: { rev: 0, status: 'Missing', byRole: c.role, byUserId: c.user.id, note: 'Registered' } },
    },
  })
  await c.log(`${code} registered${number ? ` (${number})` : ''}: ${title} · ${f.owner} · due ${f.due}${f.critical ? ' · critical' : ''}`)
  await c.notify('Routing', `${code} ${title} registered and assigned to ${f.owner}, due ${f.due}.`, code, 'Contractor')
  return code
}

/** Field-by-field differences, as "field old -> new" lines for the audit trail. */
function diff(d: { title: string; number: string; discipline: string; system: string; owner: string; due: Date; critical: boolean }, f: Partial<DocFields>) {
  const out: { field: keyof DocFields; text: string }[] = []
  const str = (k: 'title' | 'number' | 'discipline' | 'system' | 'owner') => {
    const v = f[k]
    if (v === undefined) return
    const nv = v.trim()
    if (nv !== d[k]) out.push({ field: k, text: `${k} "${d[k] || '—'}" -> "${nv || '—'}"` })
  }
  ;(['title', 'number', 'discipline', 'system', 'owner'] as const).forEach(str)
  if (f.due !== undefined && f.due !== day(d.due)) out.push({ field: 'due', text: `due ${day(d.due)} -> ${f.due}` })
  if (f.critical !== undefined && f.critical !== d.critical) out.push({ field: 'critical', text: `critical ${d.critical ? 'yes' : 'no'} -> ${f.critical ? 'yes' : 'no'}` })
  return out
}

/** Content-defining fields cannot change while a revision is being signed: the signers must see what they sign. */
const LOCKED_IN_REVIEW: (keyof DocFields)[] = ['title', 'number', 'discipline']

export async function updateDocument(c: Ctx, code: string, f: DocFields & { reason: string }) {
  reviewer(c, 'edit the document register')
  const d = await getDoc(c, code)
  assertActive(d)
  const changes = diff(d, f)
  if (!changes.length) throw rule('Nothing changed.')
  if (!f.reason.trim()) throw rule('State the reason for the change (kept in the audit trail).')
  const locked = changes.filter((x) => LOCKED_IN_REVIEW.includes(x.field))
  if (d.status === 'Under review' && locked.length) throw rule(`${d.code} ${R(d.rev)} is under review: ${locked.map((x) => x.field).join(', ')} cannot change until the review is finished or the document is returned.`)
  const has = (k: keyof DocFields) => changes.some((x) => x.field === k)
  if (has('title') && f.title.trim().length < 3) throw rule('Document title needs at least 3 characters.')
  if (has('number')) { const dup = await numberTaken(c, f.number.trim(), d.id); if (dup) throw rule(`Document number ${f.number.trim()} is already used by ${dup.code}.`) }
  if (has('discipline')) await requireDiscipline(c, f.discipline)
  if (has('system') && f.system) await requireSystem(c, f.system)
  if (has('owner')) await requireCompany(c, f.owner)
  await c.tx.document.update({ where: { id: d.id }, data: { title: f.title.trim(), number: f.number.trim(), discipline: f.discipline, system: f.system, owner: f.owner, due: toDate(f.due), critical: f.critical } })
  await c.log(`${d.code} register details changed: ${changes.map((x) => x.text).join('; ')}. Reason: ${f.reason.trim()}`)
  if (has('owner')) await c.notify('Routing', `${d.code} reassigned from ${d.owner} to ${f.owner}.`, d.code, 'Contractor')
  else if (has('due')) await c.notify('Routing', `${d.code} due date changed to ${f.due}: ${f.reason.trim()}`, d.code, 'Contractor')
}

/**
 * Void (no longer required) or supersede (replaced by another document). Owner / QA decision with a reason.
 * Evidence links of the document are withdrawn (kept as history, no longer counted); on supersede the replacement is
 * linked to the same requirements for fresh assessment.
 */
export async function voidDocument(c: Ctx, code: string, b: { reason: string; supersededBy?: string }) {
  if (c.role !== 'Owner / QA') throw forbidden('Only Owner / QA voids or supersedes a document.')
  const d = await getDoc(c, code)
  assertActive(d)
  if (d.status === 'Under review') throw rule(`${d.code} ${R(d.rev)} has an open approval route. Return it first, then void it.`)
  if (!b.reason.trim()) throw rule('State why the document is voided or superseded.')
  const target = b.supersededBy ? await getDoc(c, b.supersededBy) : null
  if (target) {
    if (target.id === d.id) throw rule('A document cannot supersede itself.')
    assertActive(target)
  }
  const status = target ? 'Superseded' : 'Void'
  const why = target ? `Superseded by ${target.code}: ${b.reason.trim()}` : `Voided: ${b.reason.trim()}`
  await c.tx.document.update({ where: { id: d.id }, data: { status, statusBeforeVoid: d.status, voidReason: b.reason.trim(), voidedAt: new Date(), voidedBy: c.user.name, supersededBy: target?.code ?? null, signStage: 0 } })
  await c.tx.docHistory.create({ data: { documentId: d.id, rev: d.rev, status, byRole: c.role, byUserId: c.user.id, note: why } })

  const links = await c.tx.evidenceLink.findMany({ where: { documentId: d.id, decision: { not: 'Withdrawn' } }, include: { requirement: { select: { id: true, code: true } } } })
  await c.tx.evidenceLink.updateMany({ where: { id: { in: links.map((l) => l.id) } }, data: { decision: 'Withdrawn', reason: `${d.code} ${why}`, reviewedBy: c.role, reviewedByUserId: c.user.id } })
  const reqCodes = [...new Set(links.map((l) => l.requirement.code))]
  let moved = 0
  if (target && target.status !== 'Missing') {
    for (const reqId of new Set(links.map((l) => l.requirement.id))) {
      const existing = await c.tx.evidenceLink.findMany({ where: { requirementId: reqId }, select: { documentId: true, rev: true, decision: true } })
      if (existing.some((e) => e.documentId === target.id && e.rev === target.rev && e.decision !== 'Withdrawn')) continue
      await c.tx.evidenceLink.create({ data: { requirementId: reqId, documentId: target.id, position: existing.length, rev: target.rev, decision: 'Pending', note: `Replaces ${d.code} (superseded)`, byRole: c.role, byUserId: c.user.id } })
      moved++
    }
  }
  const evidenceNote = !links.length ? '' : ` Evidence withdrawn on ${reqCodes.join(', ')}${target ? (moved ? `; ${target.code} ${R(target.rev)} linked for assessment` : target.status === 'Missing' ? `; ${target.code} has no revision yet, link it once received` : '') : ''}.`
  await c.log(`${d.code} ${status === 'Void' ? 'voided' : `superseded by ${target!.code}`}: ${b.reason.trim()}.${evidenceNote}`)
  await c.notify('Issue status', `${d.code} ${d.title} ${status === 'Void' ? 'voided' : `superseded by ${target!.code}`}.${evidenceNote}`, d.code)
}

export async function reinstateDocument(c: Ctx, code: string, reason: string) {
  if (c.role !== 'Owner / QA') throw forbidden('Only Owner / QA reinstates a document.')
  const d = await getDoc(c, code)
  if (!INACTIVE.includes(d.status)) throw rule(`${d.code} is not void or superseded.`)
  if (!reason.trim()) throw rule('State why the document is reinstated.')
  const back = d.statusBeforeVoid && !INACTIVE.includes(d.statusBeforeVoid) ? d.statusBeforeVoid : 'Draft'
  await c.tx.document.update({ where: { id: d.id }, data: { status: back, statusBeforeVoid: null, voidReason: null, voidedAt: null, voidedBy: null, supersededBy: null } })
  await c.tx.docHistory.create({ data: { documentId: d.id, rev: d.rev, status: back, byRole: c.role, byUserId: c.user.id, note: `Reinstated: ${reason.trim()}` } })
  await c.log(`${d.code} reinstated as ${back}: ${reason.trim()}. Withdrawn evidence links stay withdrawn; link the document again where it applies.`)
}

/* ---------------------------------------------------------------- register import */

export interface RegisterRow { number: string; title?: string; discipline?: string; system?: string; company?: string; due?: string; critical?: boolean }
export interface ImportPreview {
  created: { row: number; number: string; title: string }[]
  updated: { row: number; code: string; number: string; changes: string[] }[]
  unchanged: number
  errors: { row: number; error: string }[]
}

/**
 * Match rows on the document number: unknown numbers become new documents (Missing, R00), known ones get their
 * register fields updated (blank cells keep the current value). Validation never stops at the first problem so the
 * preview can list every row error; committing is all-or-nothing.
 */
export async function importRegister(c: Ctx, rows: RegisterRow[], commit: boolean, source: string): Promise<ImportPreview> {
  reviewer(c, 'import the document register')
  if (!rows.length) throw rule('The file contains no rows.')
  const pid = c.project.id
  const [docs, disciplines, systems, companies] = await Promise.all([
    c.tx.document.findMany({ where: { projectId: pid } }),
    c.tx.discipline.findMany({ where: { projectId: pid, active: true }, select: { name: true } }),
    c.tx.system.findMany({ where: { projectId: pid, active: true }, select: { tag: true } }),
    c.tx.company.findMany({ where: { projectId: pid, active: true }, select: { name: true } }),
  ])
  const byNumber = new Map(docs.filter((d) => d.number).map((d) => [d.number.toLowerCase(), d]))
  const disc = new Map(disciplines.map((x) => [x.name.toLowerCase(), x.name]))
  const sys = new Map(systems.map((x) => [x.tag.toLowerCase(), x.tag]))
  const comp = new Map(companies.map((x) => [x.name.toLowerCase(), x.name]))
  const out: ImportPreview = { created: [], updated: [], unchanged: 0, errors: [] }
  const plan: { row: number; create?: DocFields; update?: { id: string; code: string; fields: DocFields; text: string[]; ownerChanged: boolean } }[] = []
  const seen = new Set<string>()

  for (const [i, r] of rows.entries()) {
    const row = i + 2 // spreadsheet row (row 1 = header)
    const err = (error: string) => out.errors.push({ row, error })
    const number = (r.number ?? '').trim()
    if (!number) { err('Document number is required.'); continue }
    if (seen.has(number.toLowerCase())) { err(`Document number ${number} appears twice in the file.`); continue }
    seen.add(number.toLowerCase())
    const pick = (m: Map<string, string>, v: string | undefined, what: string) => {
      const t = (v ?? '').trim()
      if (!t) return undefined
      const hit = m.get(t.toLowerCase())
      if (!hit) { err(`${what} "${t}" is not active in this project's register.`); return null }
      return hit
    }
    const discipline = pick(disc, r.discipline, 'Discipline')
    const system = pick(sys, r.system, 'System')
    const owner = pick(comp, r.company, 'Company')
    const due = (r.due ?? '').trim()
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) err(`Due date "${due}" must be YYYY-MM-DD.`)
    if (discipline === null || system === null || owner === null || (due && !/^\d{4}-\d{2}-\d{2}$/.test(due))) continue
    const title = (r.title ?? '').trim()
    const d = byNumber.get(number.toLowerCase())

    if (!d) {
      const missing = [title.length < 3 && 'title', !discipline && 'discipline', !owner && 'company', !due && 'due date'].filter(Boolean)
      if (missing.length) { err(`New document ${number} needs ${missing.join(', ')}.`); continue }
      plan.push({ row, create: { number, title, discipline: discipline!, system: system ?? '', owner: owner!, due, critical: !!r.critical } })
      out.created.push({ row, number, title })
      continue
    }
    if (INACTIVE.includes(d.status)) { err(`${d.code} (${number}) is ${d.status.toLowerCase()}; reinstate it before updating it from the register.`); continue }
    if (c.scope && d.owner !== c.scope) { err(`${number} is not one of your documents.`); continue }
    const fields: DocFields = {
      title: title || d.title, number: d.number, discipline: discipline ?? d.discipline, system: system ?? d.system, owner: owner ?? d.owner, due: due || day(d.due), critical: r.critical ?? d.critical,
    }
    if (title && title.length < 3) { err('Title needs at least 3 characters.'); continue }
    const changes = diff(d, fields)
    if (!changes.length) { out.unchanged++; continue }
    const locked = changes.filter((x) => LOCKED_IN_REVIEW.includes(x.field))
    if (d.status === 'Under review' && locked.length) { err(`${d.code} is under review: ${locked.map((x) => x.field).join(', ')} cannot change now.`); continue }
    plan.push({ row, update: { id: d.id, code: d.code, fields, text: changes.map((x) => x.text), ownerChanged: changes.some((x) => x.field === 'owner') } })
    out.updated.push({ row, code: d.code, number, changes: changes.map((x) => x.text) })
  }

  if (!commit) return out
  if (out.errors.length) throw rule(`Import refused, nothing was changed. ${out.errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.error}`).join(' ')}${out.errors.length > 5 ? ` …and ${out.errors.length - 5} more.` : ''}`)
  if (!plan.length) throw rule('Nothing to import: every row matches the register already.')

  const codes = docs.map((d) => ({ code: d.code }))
  const created: string[] = []
  for (const p of plan) {
    if (p.create) {
      const code = nextCode('DOC', codes)
      codes.push({ code })
      created.push(code)
      const f = p.create
      await c.tx.document.create({
        data: {
          projectId: pid, code, number: f.number, title: f.title, discipline: f.discipline, system: f.system, rev: 0, status: 'Missing', owner: f.owner, due: toDate(f.due), critical: f.critical, signStage: 0,
          history: { create: { rev: 0, status: 'Missing', byRole: c.role, byUserId: c.user.id, note: `Registered by import (${source})` } },
        },
      })
    } else if (p.update) {
      const f = p.update.fields
      await c.tx.document.update({ where: { id: p.update.id }, data: { title: f.title, discipline: f.discipline, system: f.system, owner: f.owner, due: toDate(f.due), critical: f.critical } })
      await c.log(`${p.update.code} register details changed by import: ${p.update.text.join('; ')}. Reason: register import ${source}`)
      if (p.update.ownerChanged) await c.notify('Routing', `${p.update.code} reassigned to ${f.owner} by register import.`, p.update.code, 'Contractor')
    }
  }
  await c.log(`Document register import (${source}): ${created.length} registered${created.length ? ` (${created[0]}${created.length > 1 ? `…${created[created.length - 1]}` : ''})` : ''}, ${out.updated.length} updated, ${out.unchanged} unchanged`)
  if (created.length) await c.notify('Routing', `${created.length} document(s) registered from ${source}. Check the register for your deliverables.`, undefined, 'Contractor')
  return out
}
