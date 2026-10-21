// Revit integration, user side: enable per project, connector tokens, comment <-> model element links,
// "Open in Revit" navigation requests, importing a published model snapshot into a document.
// The add-in side lives in routes/connector.ts.
import { createHash, randomBytes } from 'node:crypto'
import { forbidden, notFound, rule } from '../lib/http.ts'
import { getPin } from './site.ts'
import type { Ctx } from './ctx.ts'

export const NAV_TTL_MS = 5 * 60_000
export const NAV_OUTCOMES = ['Focused', 'Wrong model', 'Stale version', 'Element missing', 'Link unloaded'] as const
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

const reviewer = (c: Ctx) => {
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA can change the Revit integration setting.')
}
const ownerQa = (c: Ctx) => {
  if (c.role !== 'Owner / QA') throw forbidden('Only Owner / QA manages connector tokens.')
}

export async function setRevit(c: Ctx, on: boolean) {
  reviewer(c)
  if (c.project.revitMode === on) throw rule(`Revit integration is already ${on ? 'on' : 'off'}.`)
  await c.tx.project.update({ where: { id: c.project.id }, data: { revitMode: on } })
  await c.log(`Input mode set to ${on ? 'Revit connector' : 'Standalone'}`)
}

/** Returns the token once; only its SHA-256 is stored. */
export async function createToken(c: Ctx, rawName: string) {
  ownerQa(c)
  const name = rawName.trim()
  if (name.length < 2) throw rule('Name the token after the machine or person using the add-in.')
  const token = `qgc_${randomBytes(24).toString('base64url')}`
  await c.tx.connectorToken.create({ data: { projectId: c.project.id, name, prefix: token.slice(0, 12), tokenHash: hashToken(token), createdByUserId: c.user.id } })
  await c.log(`Revit connector token "${name}" created`)
  return token
}

export async function revokeToken(c: Ctx, id: string) {
  ownerQa(c)
  const t = await c.tx.connectorToken.findFirst({ where: { id, projectId: c.project.id } })
  if (!t) throw notFound('Token not found.')
  if (t.revokedAt) throw rule('The token is already revoked.')
  await c.tx.connectorToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } })
  await c.log(`Revit connector token "${t.name}" revoked`)
}

/** Link (or unlink with nulls) a comment to a Revit element of a model the add-in has published. */
export async function linkElement(c: Ctx, code: string, b: { model: string | null; element: string | null }) {
  const p = await getPin(c, code)
  const element = b.element?.trim() || null
  if (!!b.model !== !!element) throw rule('Choose both the model and the element, or clear both.')
  if (b.model) {
    const m = await c.tx.revitModel.findUnique({ where: { projectId_guid: { projectId: c.project.id, guid: b.model } } })
    if (!m) throw rule('This model has not been published by the Revit add-in for this project.')
  }
  await c.tx.pin.update({ where: { id: p.id }, data: { model: b.model, element } })
  await c.log(b.model ? `${p.code} linked to Revit element ${element}` : `${p.code} Revit link removed`)
}

export async function requestNavigation(c: Ctx, code: string) {
  if (!c.project.revitMode) throw rule('Revit integration is off for this project (Setup → Integrations).')
  const p = await getPin(c, code)
  if (!p.model || !p.element) throw rule('Link the comment to a Revit model element first.')
  const d = await c.tx.document.findUniqueOrThrow({ where: { id: p.documentId } })
  if (p.rev !== d.rev) throw rule(`The comment refers to R${p.rev} but the document is now R${d.rev}. Remap it before opening the current model.`)
  const pending = await c.tx.navigationRequest.findFirst({ where: { pinId: p.id, status: { in: ['Pending', 'Delivered'] }, expiresAt: { gt: new Date() } } })
  if (pending) throw rule('A request for this comment is already waiting for the Revit add-in.')
  await c.tx.navigationRequest.create({
    data: { projectId: c.project.id, pinId: p.id, modelGuid: p.model, elementId: p.element, rev: p.rev, requestedByUserId: c.user.id, requestedByName: c.user.name, expiresAt: new Date(Date.now() + NAV_TTL_MS) },
  })
  await c.log(`Revit navigation requested for ${p.code} (element ${p.element})`)
}
