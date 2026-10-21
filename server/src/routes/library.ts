// Requirement library API. Reading is open to every signed-in user (projects show where requirements come from);
// changes are for library editors (administrators and Owner / QA users), approval follows the four-eyes rule.
import { Router } from 'express'
import { z } from 'zod'
import { FACILITIES, MARKETS } from '../domain/enums.ts'
import { currentUser, reauthenticate } from '../middleware/auth.ts'
import { securityLog } from '../lib/security.ts'
import * as L from '../services/library.ts'

export const library = Router()

const zItem = z.object({
  key: z.string().max(40), title: z.string().max(300), topic: z.string().max(500).optional(), discipline: z.string().max(80),
  facilities: z.array(z.string().max(60)).max(FACILITIES.length).optional(), critical: z.boolean().optional(),
  clause: z.string().max(300).optional(), sourceVersion: z.string().max(200).optional(), effective: z.string().max(10).optional(), guidance: z.string().max(4000).optional(),
})

library.get('/', async (_req, res) => { res.json({ packs: await L.listLibrary() }) })
library.get('/versions/:id', async (req, res) => { res.json({ version: await L.getVersion(req.params.id) }) })

library.post('/starter', async (req, res) => {
  const made = await L.loadStarter(currentUser(req))
  res.status(201).json({ created: made, packs: await L.listLibrary() })
})
library.post('/packs/:market/drafts', async (req, res) => {
  const market = z.enum(MARKETS).parse(req.params.market)
  const id = await L.newDraft(currentUser(req), market)
  res.status(201).json({ version: await L.getVersion(id), packs: await L.listLibrary() })
})
library.put('/versions/:id', async (req, res) => {
  const b = z.object({ note: z.string().max(4000) }).parse(req.body ?? {})
  await L.updateDraft(currentUser(req), req.params.id, b.note)
  res.json({ version: await L.getVersion(req.params.id) })
})
library.delete('/versions/:id', async (req, res) => {
  await L.discardDraft(currentUser(req), req.params.id)
  res.json({ packs: await L.listLibrary() })
})
library.post('/versions/:id/items', async (req, res) => {
  await L.addItem(currentUser(req), req.params.id, zItem.parse(req.body ?? {}))
  res.status(201).json({ version: await L.getVersion(req.params.id) })
})
library.post('/versions/:id/import', async (req, res) => {
  const b = z.object({ rows: z.array(zItem).min(1).max(5000), mode: z.enum(['append', 'replace']) }).parse(req.body ?? {})
  await L.importItems(currentUser(req), req.params.id, b.rows, b.mode)
  res.json({ version: await L.getVersion(req.params.id) })
})
library.put('/items/:id', async (req, res) => {
  const b = zItem.omit({ key: true }).partial().parse(req.body ?? {})
  await L.updateItem(currentUser(req), req.params.id, b)
  res.json({ ok: true })
})
library.delete('/items/:id', async (req, res) => {
  await L.deleteItem(currentUser(req), req.params.id)
  res.json({ ok: true })
})
library.post('/versions/:id/approve', async (req, res) => {
  const b = z.object({ reason: z.string().max(2000), password: z.string().max(200) }).parse(req.body ?? {})
  const user = currentUser(req)
  await reauthenticate(req, b.password, `library approval ${req.params.id}`)
  const r = await L.approveVersion(user, req.params.id, b.reason)
  await securityLog('esign.signed', { email: user.email, userId: user.id, actorId: user.id, actorName: user.name, ip: req.ip, detail: `library approval ${r.market} v${r.version}` })
  res.json({ ...r, version: await L.getVersion(req.params.id), packs: await L.listLibrary() })
})
