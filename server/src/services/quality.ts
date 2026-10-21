import type { NcrSeverity, Rating, Risk } from '../domain/types.ts'
import { requireSystem } from './registers.ts'
import { forbidden, notFound, rule } from '../lib/http.ts'
import { codeKey, getDoc, getOr404, nextCode } from './ctx.ts'
import type { Ctx } from './ctx.ts'
import { toDate } from './documents.ts'

/* ----------------------------------------------------------------- risks */

export async function addRisk(c: Ctx, r: { title: string; detail: string; system: string; likelihood: Rating; impact: Rating; owner: string; mitigation: string; due: string }) {
  if (!r.title.trim() || !r.mitigation.trim() || !r.owner.trim()) throw rule('Title, owner and mitigation are required.')
  await requireSystem(c, r.system)
  const codes = await c.tx.risk.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('RSK', codes)
  await c.tx.risk.create({ data: { projectId: c.project.id, code, title: r.title, detail: r.detail, system: r.system, likelihood: r.likelihood, impact: r.impact, owner: r.owner, mitigation: r.mitigation, due: toDate(r.due) } })
  await c.log(`${code} risk raised (rating ${r.likelihood * r.impact})`)
}

export async function updateRisk(c: Ctx, code: string, status: Risk['status'], note: string) {
  const r = await getOr404(c.tx.risk.findUnique({ where: codeKey(c, code) }), `Risk ${code}`)
  if (!note.trim()) throw rule('A note is required for every risk status change.')
  if ((status === 'Closed' || status === 'Accepted') && c.role === 'Contractor') throw forbidden('Only a reviewer can close or accept a risk.')
  await c.tx.risk.update({ where: { id: r.id }, data: { status, decision: note } })
  await c.log(`${r.code} -> ${status}`)
}

/* ------------------------------------------------------------------ NCRs */

export async function raiseNcr(c: Ctx, n: { title: string; description: string; system: string; severity: NcrSeverity; doc?: string; due: string }) {
  if (!n.title.trim() || !n.description.trim()) throw rule('Title and description are required.')
  await requireSystem(c, n.system)
  const doc = n.doc ? await getDoc(c, n.doc) : null
  const codes = await c.tx.ncr.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('NCR', codes)
  await c.tx.ncr.create({ data: { projectId: c.project.id, code, title: n.title, description: n.description, system: n.system, severity: n.severity, documentId: doc?.id, due: toDate(n.due), raisedBy: c.role, raisedByUserId: c.user.id } })
  await c.log(`${code} raised (${n.severity})`)
  await c.notify('Issue status', `${code} (${n.severity}) raised against ${n.system}. Contractor response required.`, doc?.code, 'Contractor')
}

export async function respondNcr(c: Ctx, code: string, r: { rootCause: string; containment: string; correctiveAction: string }) {
  const n = await getOr404(c.tx.ncr.findUnique({ where: codeKey(c, code), include: { document: { select: { owner: true } } } }), `NCR ${code}`)
  if (c.scope && n.document?.owner !== c.scope) throw notFound(`NCR ${code} not found.`)
  if (c.role !== 'Contractor') throw forbidden('The responsible contractor submits the NCR response.')
  if (n.status !== 'Open') throw rule('Only an open NCR can receive a response.')
  if (!r.rootCause.trim() || !r.containment.trim() || !r.correctiveAction.trim()) throw rule('Root cause, containment and corrective action are all required.')
  await c.tx.ncr.update({ where: { id: n.id }, data: { status: 'Response submitted', rootCause: r.rootCause, containment: r.containment, correctiveAction: r.correctiveAction, respondedBy: 'Contractor' } })
  await c.log(`${n.code} response submitted`)
}

export async function closeNcr(c: Ctx, code: string, reason: string) {
  const n = await getOr404(c.tx.ncr.findUnique({ where: codeKey(c, code) }), `NCR ${code}`)
  if (c.role === 'Contractor') throw forbidden('Only an independent reviewer can verify and close an NCR.')
  if (n.severity === 'Critical' && c.role !== 'Owner / QA') throw forbidden('A Critical NCR can only be closed by Owner / QA.')
  if (n.status !== 'Response submitted') throw rule('The contractor must submit a response before closure.')
  if (!reason.trim()) throw rule('Record how the corrective action was verified.')
  await c.tx.ncr.update({ where: { id: n.id }, data: { status: 'Closed', closedBy: c.role, closeReason: reason } })
  await c.log(`${n.code} verified and closed`)
}

export async function reopenNcr(c: Ctx, code: string, reason: string) {
  const n = await getOr404(c.tx.ncr.findUnique({ where: codeKey(c, code) }), `NCR ${code}`)
  if (c.role === 'Contractor') throw forbidden('Only a reviewer can reopen an NCR.')
  if (n.status === 'Open') throw rule('This NCR is already open.')
  if (!reason.trim()) throw rule('Explain why the response is not accepted.')
  await c.tx.ncr.update({ where: { id: n.id }, data: { status: 'Open', closeReason: null, closedBy: null } })
  await c.log(`${n.code} returned to contractor: ${reason}`)
}
