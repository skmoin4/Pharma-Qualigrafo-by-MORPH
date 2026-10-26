// Editing records after creation (RFIs, risks, NCRs, corrective actions) and raising findings manually.
// Every edit needs a reason and writes each changed field as old -> new to the audit trail.
import type { NcrSeverity, Rating } from '../domain/types.ts'
import { forbidden, notFound, rule } from '../lib/http.ts'
import { codeKey, getDoc, getOr404, nextCode } from './ctx.ts'
import type { Ctx } from './ctx.ts'
import { toDate } from './documents.ts'
import { assertActive } from './docRegister.ts'
import { requireDiscipline, requireSystem } from './registers.ts'

import { changeList, changed } from '../lib/audit.ts'

/** Common checks; returns the change list. */
function prepare(pairs: [string, unknown, unknown][], reason: string) {
  const list = changeList(pairs)
  if (!list.length) throw rule('Nothing changed.')
  if (!reason.trim()) throw rule('State the reason for the change (kept in the audit trail).')
  return list
}
const reviewer = (c: Ctx, what: string) => { if (c.role === 'Contractor') throw forbidden(`Only Consultant or Owner / QA ${what}.`) }
const clean = (s: string) => s.trim()

/* ------------------------------------------------------------------ RFIs */

export async function editRfi(c: Ctx, code: string, b: { title: string; discipline: string; system: string; due: string; reason: string }) {
  const r = await getOr404(c.tx.rfi.findUnique({ where: codeKey(c, code) }), `RFI ${code}`)
  if (c.scope && r.raisedByUserId !== c.user.id) throw notFound(`RFI ${code} not found.`)
  if (c.role === 'Contractor' && r.raisedByUserId !== c.user.id) throw forbidden('Only the requester or a reviewer can edit an RFI.')
  if (r.status === 'Closed') throw rule(`${r.code} is closed. Raise a new RFI instead.`)
  const pairs: [string, unknown, unknown][] = [['question', r.title, clean(b.title)], ['discipline', r.discipline, b.discipline], ['system', r.system, b.system], ['due', r.due, b.due]]
  const list = prepare(pairs, b.reason)
  if (changed(pairs, 'question')) {
    if (r.status !== 'Awaiting response') throw rule(`${r.code} has been answered: the question cannot change. Raise a new RFI for a different question.`)
    if (!clean(b.title)) throw rule('Enter the question.')
  }
  if (changed(pairs, 'discipline')) await requireDiscipline(c, b.discipline)
  if (changed(pairs, 'system')) await requireSystem(c, b.system)
  await c.tx.rfi.update({ where: { id: r.id }, data: { title: clean(b.title), discipline: b.discipline, system: b.system, due: toDate(b.due) } })
  await c.log(`${r.code} edited: ${list.join('; ')}. Reason: ${b.reason.trim()}`)
}

/* ----------------------------------------------------------------- risks */

export async function editRisk(c: Ctx, code: string, b: { title: string; detail: string; system: string; likelihood: Rating; impact: Rating; owner: string; mitigation: string; due: string; reason: string }) {
  reviewer(c, 'edit risks')
  const r = await getOr404(c.tx.risk.findUnique({ where: codeKey(c, code) }), `Risk ${code}`)
  if (r.status === 'Closed') throw rule(`${r.code} is closed. Reopen it with a status change first.`)
  const pairs: [string, unknown, unknown][] = [
    ['title', r.title, clean(b.title)], ['detail', r.detail, clean(b.detail)], ['system', r.system, b.system],
    ['likelihood', r.likelihood, b.likelihood], ['impact', r.impact, b.impact], ['owner', r.owner, clean(b.owner)], ['mitigation', r.mitigation, clean(b.mitigation)], ['due', r.due, b.due],
  ]
  const list = prepare(pairs, b.reason)
  if (!clean(b.title) || !clean(b.owner) || !clean(b.mitigation)) throw rule('Title, owner and mitigation are required.')
  if (changed(pairs, 'system')) await requireSystem(c, b.system)
  const rating = r.likelihood * r.impact !== b.likelihood * b.impact ? `; rating ${r.likelihood * r.impact} -> ${b.likelihood * b.impact}` : ''
  await c.tx.risk.update({ where: { id: r.id }, data: { title: clean(b.title), detail: clean(b.detail), system: b.system, likelihood: b.likelihood, impact: b.impact, owner: clean(b.owner), mitigation: clean(b.mitigation), due: toDate(b.due) } })
  await c.log(`${r.code} edited: ${list.join('; ')}${rating}. Reason: ${b.reason.trim()}`)
}

/* ------------------------------------------------------------------ NCRs */

const RANK: Record<string, number> = { Minor: 1, Major: 2, Critical: 3 }

export async function editNcr(c: Ctx, code: string, b: { title: string; description: string; system: string; severity: NcrSeverity; doc: string; due: string; reason: string }) {
  reviewer(c, 'edit NCRs')
  const n = await getOr404(c.tx.ncr.findUnique({ where: codeKey(c, code), include: { document: { select: { code: true } } } }), `NCR ${code}`)
  if (n.status === 'Closed') throw rule(`${n.code} is closed. Reopen it first.`)
  const pairs: [string, unknown, unknown][] = [
    ['title', n.title, clean(b.title)], ['description', n.description, clean(b.description)], ['system', n.system, b.system],
    ['severity', n.severity, b.severity], ['document', n.document?.code ?? '', b.doc], ['due', n.due, b.due],
  ]
  const list = prepare(pairs, b.reason)
  if (!clean(b.title) || !clean(b.description)) throw rule('Title and description are required.')
  // Only Owner / QA closes a Critical NCR, so only Owner / QA may take an NCR out of Critical.
  if (n.severity === 'Critical' && b.severity !== 'Critical' && c.role !== 'Owner / QA') throw forbidden('Only Owner / QA can downgrade a Critical NCR.')
  if (changed(pairs, 'system')) await requireSystem(c, b.system)
  let documentId = n.documentId
  if (changed(pairs, 'document')) {
    if (!b.doc) documentId = null
    else { const d = await getDoc(c, b.doc); assertActive(d); documentId = d.id }
  }
  await c.tx.ncr.update({ where: { id: n.id }, data: { title: clean(b.title), description: clean(b.description), system: b.system, severity: b.severity, documentId, due: toDate(b.due) } })
  await c.log(`${n.code} edited: ${list.join('; ')}. Reason: ${b.reason.trim()}`)
  if (changed(pairs, 'severity') || changed(pairs, 'due')) {
    const what = [changed(pairs, 'severity') && `severity ${RANK[b.severity] > RANK[n.severity] ? 'raised' : 'lowered'} to ${b.severity}`, changed(pairs, 'due') && `response due ${b.due}`].filter(Boolean).join(', ')
    await c.notify('Issue status', `${n.code} ${what}: ${b.reason.trim()}`, b.doc || undefined, 'Contractor', { page: 'ncrs' })
  }
}

/* ---------------------------------------------------- corrective actions */

const PRIORITIES = ['High', 'Medium', 'Low']

export async function editAction(c: Ctx, code: string, b: { title: string; owner: string; due: string; priority: string; reason: string }) {
  reviewer(c, 'edit corrective actions')
  const a = await getOr404(c.tx.gapAction.findUnique({ where: codeKey(c, code) }), `Action ${code}`)
  if (a.status === 'Closed') throw rule(`${a.code} is closed.`)
  if (!PRIORITIES.includes(b.priority)) throw rule('Priority must be High, Medium or Low.')
  const pairs: [string, unknown, unknown][] = [['title', a.title, clean(b.title)], ['owner', a.owner, clean(b.owner)], ['due', a.due, b.due], ['priority', a.priority, b.priority]]
  const list = prepare(pairs, b.reason)
  if (!clean(b.title)) throw rule('Describe the action.')
  if (!clean(b.owner)) throw rule('An action owner is required.')
  await c.tx.gapAction.update({ where: { id: a.id }, data: { title: clean(b.title), owner: clean(b.owner), due: toDate(b.due), priority: b.priority } })
  await c.log(`${a.code} edited: ${list.join('; ')}. Reason: ${b.reason.trim()}`)
  if (changed(pairs, 'owner')) await c.notify('Routing', `${a.code} reassigned to ${clean(b.owner)}: ${b.reason.trim()}`, undefined, 'Contractor', { page: 'actions' })
}

/* -------------------------------------------------------------- findings */

const FINDING_SEVERITY = ['High', 'Medium', 'Low']

/** A reviewer records a consistency finding found by manual review (automated rule checks are a later step). */
export async function raiseFinding(c: Ctx, f: { title: string; doc: string; severity: string; source: string; rule: string }) {
  reviewer(c, 'raise findings')
  if (clean(f.title).length < 3) throw rule('Describe the finding (at least 3 characters).')
  if (!FINDING_SEVERITY.includes(f.severity)) throw rule('Severity must be High, Medium or Low.')
  if (!clean(f.source)) throw rule('Record the values or observation compared (e.g. "Schedule: RE-201 · Datasheet: RE-210").')
  const d = await getDoc(c, f.doc)
  assertActive(d)
  const codes = await c.tx.finding.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('CHK', codes, 2)
  await c.tx.finding.create({ data: { projectId: c.project.id, code, title: clean(f.title), documentId: d.id, severity: f.severity, source: clean(f.source), rule: clean(f.rule) || 'Manual review', raisedBy: c.role, raisedByUserId: c.user.id } })
  await c.log(`${code} finding raised on ${d.code} (${f.severity}): ${clean(f.title)}`)
  await c.notify('Issue status', `${code} (${f.severity}) raised on ${d.code} ${d.title}. A reviewer will disposition it.`, d.code)
}
