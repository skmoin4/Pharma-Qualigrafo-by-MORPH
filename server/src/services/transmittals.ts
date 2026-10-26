// Document transmittals: a controlled, numbered record of which document revisions were sent to which company and why.
import { forbidden, notFound, rule } from '../lib/http.ts'
import { codeKey, getOr404, nextCode } from './ctx.ts'
import type { Ctx } from './ctx.ts'
import { INACTIVE } from './docRegister.ts'
import { requireCompany } from './registers.ts'

export const PURPOSES = ['For approval', 'For review / comment', 'For information', 'For construction', 'As built'] as const

export interface TransmittalItem {
  doc: string
  number: string
  title: string
  rev: number
  status: string
  checksum: string | null
  fileName: string | null
  signatures: { name: string; role: string; meaning: string; at: string }[]
}

export async function createTransmittal(c: Ctx, b: { to: string; purpose: string; note: string; docs: string[] }) {
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA issue transmittals.')
  if (!PURPOSES.includes(b.purpose as (typeof PURPOSES)[number])) throw rule('Choose the purpose of the transmittal.')
  await requireCompany(c, b.to)
  const codes = [...new Set(b.docs)]
  if (!codes.length) throw rule('Select at least one document.')
  const docs = await c.tx.document.findMany({
    where: { projectId: c.project.id, code: { in: codes } },
    include: { file: { select: { originalName: true } }, signatures: { orderBy: { at: 'asc' } } },
  })
  const missing = codes.filter((x) => !docs.some((d) => d.code === x))
  if (missing.length) throw notFound(`Document(s) not found: ${missing.join(', ')}.`)
  const items: TransmittalItem[] = codes.map((code) => {
    const d = docs.find((x) => x.code === code)!
    if (INACTIVE.includes(d.status)) throw rule(`${d.code} is ${d.status.toLowerCase()} and cannot be transmitted.`)
    if (d.status === 'Missing') throw rule(`${d.code} has no revision yet.`)
    const current = d.sourceRev === d.rev && !!d.checksum
    return {
      doc: d.code, number: d.number, title: d.title, rev: d.rev, status: d.status,
      checksum: current ? d.checksum : null, fileName: current ? d.file?.originalName ?? null : null,
      signatures: d.signatures.filter((s) => s.rev === d.rev).map((s) => ({ name: s.name, role: s.role, meaning: s.meaning, at: s.at.toISOString() })),
    }
  })
  const used = await c.tx.transmittal.findMany({ where: { projectId: c.project.id }, select: { code: true } })
  const code = nextCode('TRN', used)
  await c.tx.transmittal.create({
    data: { projectId: c.project.id, code, toCompany: b.to, purpose: b.purpose, note: b.note.trim(), items: items as object[], createdByUserId: c.user.id, createdByName: c.user.name, createdByRole: c.role },
  })
  await c.log(`${code} issued to ${b.to} (${b.purpose}): ${items.map((i) => `${i.doc} R${String(i.rev).padStart(2, '0')}`).join(', ')}`)
  await c.notify('Issue', `${code}: ${items.length} document(s) transmitted to ${b.to} ${b.purpose.toLowerCase()}.`, undefined, 'Contractor', { company: b.to, page: 'transmittals' })
  return code
}

/** The receiving company confirms receipt (any contractor account; a vendor account only for its own company). */
export async function acknowledgeTransmittal(c: Ctx, code: string, note: string) {
  const t = await getOr404(c.tx.transmittal.findUnique({ where: codeKey(c, code) }), `Transmittal ${code}`)
  if (c.scope && t.toCompany !== c.scope) throw notFound(`Transmittal ${code} not found.`)
  if (c.role !== 'Contractor') throw forbidden('The receiving company acknowledges a transmittal.')
  if (t.ackAt) throw rule(`${t.code} was already acknowledged by ${t.ackByName}.`)
  await c.tx.transmittal.update({ where: { id: t.id }, data: { ackAt: new Date(), ackByName: c.user.name, ackByUserId: c.user.id, ackNote: note.trim() || null } })
  await c.log(`${t.code} receipt acknowledged by ${c.user.name}${note.trim() ? `: ${note.trim()}` : ''}`)
}
