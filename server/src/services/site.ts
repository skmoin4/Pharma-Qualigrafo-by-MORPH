import { forbidden, notFound, rule } from '../lib/http.ts'
import { requireDiscipline, requireSystem } from './registers.ts'
import { codeKey, getDoc, getOr404, nextCode } from './ctx.ts'
import type { Ctx } from './ctx.ts'
import { toDate } from './documents.ts'
import { assertActive } from './docRegister.ts'

/* ------------------------------------------------------------------ RFIs */

export async function raiseRfi(c: Ctx, r: { title: string; discipline: string; system: string; due: string }) {
  if (!r.title.trim()) throw rule('Enter the question.')
  await requireDiscipline(c, r.discipline)
  await requireSystem(c, r.system)
  const codes = await c.tx.rfi.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('RFI', codes)
  await c.tx.rfi.create({ data: { projectId: c.project.id, code, title: r.title, discipline: r.discipline, system: r.system, due: toDate(r.due), raisedBy: c.role, raisedByUserId: c.user.id } })
  await c.log(`${code} raised`)
}

export async function answerRfi(c: Ctx, code: string, response: string) {
  const r = await getOr404(c.tx.rfi.findUnique({ where: codeKey(c, code) }), `RFI ${code}`)
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA can respond.')
  if (r.status !== 'Awaiting response') throw rule('Only an RFI awaiting response can be answered.')
  if (!response.trim()) throw rule('A response is required.')
  await c.tx.rfi.update({ where: { id: r.id }, data: { response, status: 'Answered' } })
  await c.log(`${r.code} answered`)
}

export async function closeRfi(c: Ctx, code: string) {
  const r = await getOr404(c.tx.rfi.findUnique({ where: codeKey(c, code) }), `RFI ${code}`)
  if (c.scope && r.raisedByUserId !== c.user.id) throw notFound(`RFI ${code} not found.`)
  if (r.raisedBy !== c.role && c.role === 'Contractor') throw forbidden('Only the requester or a reviewer can close.')
  if (r.status !== 'Answered') throw rule('Only an answered RFI can be closed.')
  await c.tx.rfi.update({ where: { id: r.id }, data: { status: 'Closed' } })
  await c.log(`${r.code} closed`)
}

/* ----------------------------------------------------------- inspections */

export async function requestInspection(c: Ctx, i: { title: string; system: string }) {
  if (!i.title.trim() || !i.system.trim()) throw rule('Title and system are required.')
  await requireSystem(c, i.system)
  const codes = await c.tx.inspection.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('INS', codes)
  await c.tx.inspection.create({ data: { projectId: c.project.id, code, title: i.title, system: i.system } })
  await c.log(`${code} requested`)
}

export async function submitInspection(c: Ctx, code: string, evidence: string) {
  const i = await getOr404(c.tx.inspection.findUnique({ where: codeKey(c, code) }), `Inspection ${code}`)
  if (c.role !== 'Contractor') throw forbidden('Only the Contractor submits inspection evidence.')
  if (i.status !== 'Requested' && i.status !== 'Correction required') throw rule('Evidence can only be submitted for a requested inspection or one needing correction.')
  if (!evidence.trim()) throw rule('Reference the checklist and site evidence.')
  await c.tx.inspection.update({ where: { id: i.id }, data: { status: 'Submitted', evidence } })
  await c.log(`${i.code} submitted`)
}

export async function decideInspection(c: Ctx, code: string, accept: boolean, reason: string) {
  const i = await getOr404(c.tx.inspection.findUnique({ where: codeKey(c, code) }), `Inspection ${code}`)
  if (c.role === 'Contractor') throw forbidden('Only a reviewer can decide an inspection.')
  if (i.status !== 'Submitted') throw rule('Only a submitted inspection can be decided.')
  if (!reason.trim()) throw rule('Decision reason is required.')
  await c.tx.inspection.update({ where: { id: i.id }, data: { status: accept ? 'Accepted' : 'Correction required', decision: reason } })
  await c.log(`${i.code} ${accept ? 'accepted' : 'correction required'}`)
}

/* -------------------------------------------------------------- findings */

export async function disposeFinding(c: Ctx, code: string, status: 'Resolved' | 'Accepted exception', reason: string) {
  const f = await getOr404(c.tx.finding.findUnique({ where: codeKey(c, code) }), `Finding ${code}`)
  if (c.role === 'Contractor') throw forbidden('Only a reviewer can disposition a finding.')
  if (f.status !== 'Open') throw rule('This finding has already been dispositioned.')
  if (!reason.trim()) throw rule('A disposition rationale is required.')
  await c.tx.finding.update({ where: { id: f.id }, data: { status, disposition: reason } })
  await c.log(`${f.code} ${status}`)
}

/* --------------------------------------------------------------- changes */

export async function addChange(c: Ctx, ch: { title: string; system: string; docs: string[]; reqs: string[] }) {
  if (!ch.title.trim()) throw rule('Describe the proposed change.')
  await requireSystem(c, ch.system)
  const docs = [...new Set(ch.docs)]
  const reqs = [...new Set(ch.reqs)]
  const [foundDocs, foundReqs] = await Promise.all([
    c.tx.document.count({ where: { projectId: c.project.id, code: { in: docs } } }),
    c.tx.requirement.count({ where: { projectId: c.project.id, code: { in: reqs } } }),
  ])
  if (foundDocs !== docs.length || foundReqs !== reqs.length) throw rule('One or more linked records do not exist in this project.')
  const codes = await c.tx.change.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('CHG', codes)
  const items = [...docs.map((ref) => ({ kind: 'doc', ref })), ...reqs.map((ref) => ({ kind: 'req', ref }))].map((x, position) => ({ ...x, position }))
  await c.tx.change.create({ data: { projectId: c.project.id, code, title: ch.title, system: ch.system, status: 'Impact review', items: { create: items } } })
  await c.log(`${code} proposed`)
}

export async function assessChangeItem(c: Ctx, code: string, item: string, v: 'Impacted' | 'Not impacted') {
  const ch = await getOr404(c.tx.change.findUnique({ where: codeKey(c, code), include: { items: true } }), `Change ${code}`)
  if (c.role === 'Contractor') throw forbidden('Only a reviewer can assess change impact.')
  if (ch.status !== 'Impact review') throw rule('Impact can only be assessed while the change is in impact review.')
  const it = ch.items.find((x) => x.ref === item)
  if (!it) throw rule(`${item} is not linked to ${ch.code}.`)
  await c.tx.changeItem.update({ where: { id: it.id }, data: { impact: v } })
  await c.log(`${ch.code}: ${item} assessed as ${v}`)
}

export async function decideChange(c: Ctx, code: string, authorize: boolean, reason: string) {
  const ch = await getOr404(c.tx.change.findUnique({ where: codeKey(c, code), include: { items: true } }), `Change ${code}`)
  if (c.role !== 'Owner / QA') throw forbidden('Owner / QA authorisation required.')
  if (!reason.trim()) throw rule('A decision reason is required.')
  if (ch.status !== 'Impact review' && ch.status !== 'Proposed') throw rule('This change has already been decided.')
  if (authorize && ch.items.some((i) => i.impact === 'Unassessed')) throw rule('Assess every linked record before authorising.')
  await c.tx.change.update({ where: { id: ch.id }, data: { status: authorize ? 'Authorized' : 'Rejected', decision: reason } })
  await c.log(`${ch.code} ${authorize ? 'authorised' : 'rejected'}`)
}

/* ------------------------------------------------- anchored comments (pins) */

/** Drawing formats the comment viewer can render and anchor on. */
export const DRAWING_TYPES = ['application/pdf', 'image/png', 'image/jpeg']

/** The current revision's own source file, if it is a drawing (PDF / PNG / JPEG). */
async function currentDrawing(c: Ctx, d: { rev: number; sourceRev: number | null; checksum: string | null; fileId: string | null }) {
  if (d.sourceRev !== d.rev || !d.checksum || !d.fileId) return null
  const f = await c.tx.storedFile.findUnique({ where: { id: d.fileId } })
  return f && DRAWING_TYPES.includes(f.mimeType) ? f : null
}

type Place = { page: number; x: number; y: number }

/** A comment always refers to the document's current revision; with `place` it is also pinned on that revision's drawing. */
export async function addPin(c: Ctx, p: { text: string; doc: string; room: string; place?: Place }) {
  const d = await getDoc(c, p.doc)
  assertActive(d)
  if (!p.text.trim()) throw rule('Enter the comment text.')
  if (p.place && !(await currentDrawing(c, d))) throw rule(`${d.code} R${d.rev} has no PDF or image drawing to place the comment on. Upload the drawing first, or raise the comment without a position.`)
  const codes = await c.tx.pin.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('CMT', codes)
  await c.tx.pin.create({
    data: {
      projectId: c.project.id, code, text: p.text, documentId: d.id, rev: d.rev, room: p.room,
      anchored: !!p.place, page: p.place?.page ?? 1, x: p.place?.x ?? 0.5, y: p.place?.y ?? 0.5,
      byRole: c.role, byUserId: c.user.id,
    },
  })
  await c.log(p.place ? `Comment ${code} placed on ${d.code} R${d.rev}, page ${p.place.page}` : `Comment ${code} raised on ${d.code} R${d.rev}`)
  return code
}

/** Place a comment on the drawing of the document's current revision (first placement, or remap after a new revision). */
export async function anchorPin(c: Ctx, code: string, place: Place) {
  const p = await getPin(c, code)
  if (p.status !== 'Open') throw rule('A closed comment cannot be moved.')
  if (c.role === 'Contractor' && p.byUserId !== c.user.id) throw forbidden('Only the author or a reviewer can position this comment.')
  const d = await c.tx.document.findUniqueOrThrow({ where: { id: p.documentId } })
  if (!(await currentDrawing(c, d))) throw rule(`${d.code} R${d.rev} has no PDF or image drawing to place the comment on.`)
  await c.tx.pin.update({ where: { id: p.id }, data: { rev: d.rev, anchored: true, page: place.page, x: place.x, y: place.y } })
  await c.log(p.rev !== d.rev ? `${p.code} remapped from R${p.rev} to R${d.rev} (page ${place.page})` : `${p.code} ${p.anchored ? 'moved' : 'placed'} on ${d.code} R${d.rev}, page ${place.page}`)
}

/** Comments are visible to a vendor-scoped user only when anchored to one of its own documents. */
export async function getPin(c: Ctx, code: string) {
  const p = await getOr404(c.tx.pin.findUnique({ where: codeKey(c, code), include: { document: { select: { owner: true } } } }), `Comment ${code}`)
  if (c.scope && p.document.owner !== c.scope) throw notFound(`Comment ${code} not found.`)
  return p
}

export async function replyPin(c: Ctx, code: string, text: string, close: boolean) {
  const p = await getPin(c, code)
  if (!text.trim()) throw rule('Enter a response or closure rationale.')
  if (close && c.role === 'Contractor') throw forbidden('Only a reviewer can close a comment.')
  if (p.status === 'Closed') throw rule('This comment is already closed.')
  await c.tx.pinReply.create({ data: { pinId: p.id, byRole: c.role, byUserId: c.user.id, text } })
  if (close) await c.tx.pin.update({ where: { id: p.id }, data: { status: 'Closed' } })
  await c.log(`${close ? 'Closed' : 'Responded to'} ${p.code}`)
}
