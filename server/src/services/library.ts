// Requirement library management (installation-wide): packs per market, versions Draft -> Approved -> Superseded,
// item editing and CSV import on drafts, four-eyes approval, and fan-out of approved versions to projects.
import { prisma } from '../db.ts'
import type { Tx } from '../db.ts'
import { ALL_FACILITIES, MARKETS } from '../domain/enums.ts'
import { markets as MARKET_INFO } from '../domain/reference.ts'
import { STARTER_LIBRARY } from '../domain/starterLibrary.ts'
import type { MarketKey } from '../domain/types.ts'
import { forbidden, notFound, rule } from '../lib/http.ts'
import { securityLog } from '../lib/security.ts'
import { changeList } from '../lib/audit.ts'
import type { AuthUser } from '../middleware/auth.ts'
import { nextCode } from './ctx.ts'
import { diffForProject } from './libraryProjects.ts'
import { canCreateProjects } from './projects.ts'

export interface ItemInput {
  key: string; title: string; topic?: string; discipline: string; facilities?: string[]; critical?: boolean
  clause?: string; sourceVersion?: string; effective?: string; guidance?: string
}

/** Library editors: administrators and Owner / QA users (the same people who may create projects). */
export async function assertEditor(user: AuthUser) {
  if (!(await canCreateProjects(user))) throw forbidden('Only administrators and Owner / QA users maintain the requirement library.')
}

const clean = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ')
const lock = (tx: Tx) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('qualigrafo:library'))::text AS locked`
const log = (user: AuthUser, type: 'library.draft' | 'library.edit' | 'library.import' | 'library.approved' | 'library.discarded', detail: string) =>
  securityLog(type, { actorId: user.id, actorName: user.name, detail })

/** Validates and normalises one item; throws with a clear message. */
function normalise(i: ItemInput) {
  const key = clean(i.key).toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(key)) throw rule(`Key "${i.key}" is invalid: letters, digits and - _ . (max 40).`)
  const title = clean(i.title)
  if (title.length < 3) throw rule(`${key}: a title is required.`)
  const discipline = clean(i.discipline)
  if (!discipline) throw rule(`${key}: a discipline is required.`)
  const facilities = [...new Set((i.facilities ?? []).map(clean).filter(Boolean))]
  const bad = facilities.find((f) => !ALL_FACILITIES.includes(f))
  if (bad) throw rule(`${key}: unknown facility type "${bad}". Use a facility type of one of the industry groups (or leave empty for all).`)
  const effective = clean(i.effective)
  if (effective && !/^\d{4}-\d{2}-\d{2}$/.test(effective)) throw rule(`${key}: effective date must be YYYY-MM-DD.`)
  return { key, title, topic: clean(i.topic), discipline, facilities, critical: !!i.critical, clause: clean(i.clause), sourceVersion: clean(i.sourceVersion), effective, guidance: (i.guidance ?? '').trim() }
}

async function draftOf(tx: Tx, versionId: string) {
  const v = await tx.libraryVersion.findUnique({ where: { id: versionId }, include: { pack: true } })
  if (!v) throw notFound('Library version not found.')
  if (v.status !== 'Draft') throw rule(`${v.pack.market} v${v.version} is ${v.status.toLowerCase()} and cannot be changed. Create a new draft.`)
  return v
}
const touch = (tx: Tx, versionId: string, user: AuthUser) => tx.libraryVersion.update({ where: { id: versionId }, data: { updatedByUserId: user.id, updatedAt: new Date() } })

/* ---------------------------------------------------------------- reads */

export async function listLibrary() {
  const packs = await prisma.libraryPack.findMany({ include: { versions: { orderBy: { version: 'desc' }, include: { _count: { select: { items: true } } } } } })
  return MARKETS.map((m) => {
    const p = packs.find((x) => x.market === m)
    return {
      market: m, name: p?.name ?? `${MARKET_INFO[m].name} (${MARKET_INFO[m].authority})`, hasStarter: !!STARTER_LIBRARY[m]?.length,
      versions: (p?.versions ?? []).map((v) => ({
        id: v.id, version: v.version, status: v.status, note: v.note, starter: v.starter, items: v._count.items,
        createdByName: v.createdByName, createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString(),
        approvedByName: v.approvedByName, approvedAt: v.approvedAt?.toISOString() ?? null, approvalReason: v.approvalReason,
      })),
    }
  })
}

/** A version with its items and the comparison with the currently approved version of the same pack. */
export async function getVersion(id: string) {
  const v = await prisma.libraryVersion.findUnique({ where: { id }, include: { pack: true, items: { orderBy: { position: 'asc' } } } })
  if (!v) throw notFound('Library version not found.')
  const base = await prisma.libraryVersion.findFirst({
    where: { packId: v.packId, id: { not: v.id }, status: { in: ['Approved', 'Superseded'] }, version: { lt: v.version } },
    orderBy: { version: 'desc' }, include: { items: true },
  })
  const prev = new Map((base?.items ?? []).map((i) => [i.key, i]))
  const fields = ['title', 'topic', 'discipline', 'critical', 'clause', 'sourceVersion', 'effective', 'guidance'] as const
  const status = (i: (typeof v.items)[number]) => {
    const p = prev.get(i.key)
    if (!p) return base ? 'Added' : 'New'
    const diff = fields.filter((f) => p[f] !== i[f])
    if (JSON.stringify(p.facilities) !== JSON.stringify(i.facilities)) diff.push('facilities' as never)
    return diff.length ? `Changed: ${diff.join(', ')}` : 'Unchanged'
  }
  return {
    id: v.id, market: v.pack.market, packName: v.pack.name, version: v.version, status: v.status, note: v.note, starter: v.starter,
    createdByName: v.createdByName, createdByUserId: v.createdByUserId, updatedByUserId: v.updatedByUserId, approvedByName: v.approvedByName, approvedAt: v.approvedAt?.toISOString() ?? null, approvalReason: v.approvalReason,
    comparedWith: base ? base.version : null,
    removed: base ? base.items.filter((i) => !v.items.some((x) => x.key === i.key)).map((i) => ({ key: i.key, title: i.title })) : [],
    items: v.items.map((i) => ({ id: i.id, key: i.key, title: i.title, topic: i.topic, discipline: i.discipline, facilities: i.facilities as string[], critical: i.critical, clause: i.clause, sourceVersion: i.sourceVersion, effective: i.effective, guidance: i.guidance, change: status(i) })),
  }
}

/* ---------------------------------------------------------------- drafts */

async function packFor(tx: Tx, market: MarketKey) {
  return tx.libraryPack.upsert({ where: { market }, update: {}, create: { market, name: `${MARKET_INFO[market].name} (${MARKET_INFO[market].authority})` } })
}

/** Creates DRAFT v1 packs from the unverified starter template for every market that has no library yet. */
export async function loadStarter(user: AuthUser) {
  await assertEditor(user)
  const made = await prisma.$transaction(async (tx) => {
    await lock(tx)
    const out: string[] = []
    for (const [m, items] of Object.entries(STARTER_LIBRARY) as [MarketKey, NonNullable<(typeof STARTER_LIBRARY)[MarketKey]>][]) {
      const pack = await packFor(tx, m)
      if (await tx.libraryVersion.count({ where: { packId: pack.id } })) continue
      await tx.libraryVersion.create({
        data: {
          packId: pack.id, version: 1, status: 'Draft', starter: true, note: 'Unverified starter template: topic-level entries. Verify against the official texts, add clause, source version and effective date, then approve.',
          createdByUserId: user.id, createdByName: user.name, updatedByUserId: user.id,
          items: { create: items.map((i, position) => ({ ...i, position, facilities: [] })) },
        },
      })
      out.push(`${m} (${items.length})`)
    }
    if (!out.length) throw rule('Every market with starter content already has a library. Create a new draft instead.')
    return out
  })
  await log(user, 'library.draft', `Starter template loaded as drafts: ${made.join(', ')}`)
  return made
}

/** New draft: a copy of the approved version (or empty). One draft per pack at a time. */
export async function newDraft(user: AuthUser, market: MarketKey) {
  await assertEditor(user)
  const id = await prisma.$transaction(async (tx) => {
    await lock(tx)
    const pack = await packFor(tx, market)
    if (await tx.libraryVersion.findFirst({ where: { packId: pack.id, status: 'Draft' } })) throw rule(`${market} already has a draft. Finish or discard it first.`)
    const approved = await tx.libraryVersion.findFirst({ where: { packId: pack.id, status: 'Approved' }, include: { items: true } })
    const last = await tx.libraryVersion.aggregate({ where: { packId: pack.id }, _max: { version: true } })
    const v = await tx.libraryVersion.create({
      data: {
        packId: pack.id, version: (last._max.version ?? 0) + 1, status: 'Draft', createdByUserId: user.id, createdByName: user.name, updatedByUserId: user.id,
        note: approved ? `Draft based on v${approved.version}.` : '',
        items: { create: (approved?.items ?? []).map(({ key, position, title, topic, discipline, facilities, critical, clause, sourceVersion, effective, guidance }) => ({ key, position, title, topic, discipline, facilities: facilities as string[], critical, clause, sourceVersion, effective, guidance })) },
      },
    })
    return v.id
  })
  await log(user, 'library.draft', `${market}: new draft created`)
  return id
}

export async function updateDraft(user: AuthUser, versionId: string, note: string) {
  await assertEditor(user)
  await prisma.$transaction(async (tx) => {
    const v = await draftOf(tx, versionId)
    await tx.libraryVersion.update({ where: { id: versionId }, data: { note: note.trim(), updatedByUserId: user.id, updatedAt: new Date() } })
    const fields = changeList([['note', v.note, note.trim()]])
    if (fields.length) await log(user, 'library.edit', `${v.pack.market} v${v.version}: ${fields.join('; ')}`)
  })
}

export async function discardDraft(user: AuthUser, versionId: string) {
  await assertEditor(user)
  const v = await prisma.$transaction(async (tx) => {
    const v = await draftOf(tx, versionId)
    await tx.libraryVersion.delete({ where: { id: v.id } })
    return v
  })
  await log(user, 'library.discarded', `${v.pack.market} v${v.version} draft discarded`)
}

export async function addItem(user: AuthUser, versionId: string, input: ItemInput) {
  await assertEditor(user)
  const it = normalise(input)
  await prisma.$transaction(async (tx) => {
    const v = await draftOf(tx, versionId)
    if (await tx.libraryItem.findUnique({ where: { versionId_key: { versionId, key: it.key } } })) throw rule(`${it.key} already exists in this version.`)
    const last = await tx.libraryItem.aggregate({ where: { versionId }, _max: { position: true } })
    await tx.libraryItem.create({ data: { ...it, versionId, position: (last._max.position ?? -1) + 1 } })
    await touch(tx, versionId, user)
    await log(user, 'library.edit', `${v.pack.market} v${v.version}: ${it.key} added`)
  })
}

/** The key is the stable identity used to update projects, so it cannot be changed; delete and add instead. */
export async function updateItem(user: AuthUser, itemId: string, input: Partial<Omit<ItemInput, 'key'>>) {
  await assertEditor(user)
  await prisma.$transaction(async (tx) => {
    const i = await tx.libraryItem.findUnique({ where: { id: itemId } })
    if (!i) throw notFound('Library item not found.')
    const v = await draftOf(tx, i.versionId)
    // Fields left out of the request keep their current value.
    const current = { title: i.title, topic: i.topic, discipline: i.discipline, facilities: i.facilities as string[], critical: i.critical, clause: i.clause, sourceVersion: i.sourceVersion, effective: i.effective, guidance: i.guidance }
    const merged = Object.fromEntries(Object.entries({ ...current, ...input }).map(([k, v]) => [k, v === undefined ? current[k as keyof typeof current] : v])) as Omit<ItemInput, 'key'>
    const it = normalise({ ...merged, key: i.key })
    await tx.libraryItem.update({ where: { id: i.id }, data: { ...it, key: i.key } })
    await touch(tx, v.id, user)
    const fields = changeList((Object.keys(current) as (keyof typeof current)[]).map((k) => [k, current[k], it[k as keyof typeof it]]))
    await log(user, 'library.edit', `${v.pack.market} v${v.version}: ${i.key} edited${fields.length ? `: ${fields.join('; ')}` : ' (no change)'}`)
  })
}

export async function deleteItem(user: AuthUser, itemId: string) {
  await assertEditor(user)
  await prisma.$transaction(async (tx) => {
    const i = await tx.libraryItem.findUnique({ where: { id: itemId } })
    if (!i) throw notFound('Library item not found.')
    const v = await draftOf(tx, i.versionId)
    await tx.libraryItem.delete({ where: { id: i.id } })
    await touch(tx, v.id, user)
    await log(user, 'library.edit', `${v.pack.market} v${v.version}: ${i.key} removed`)
  })
}

/** All-or-nothing import into a draft: append (keys must be new) or replace every item. */
export async function importItems(user: AuthUser, versionId: string, rows: ItemInput[], mode: 'append' | 'replace') {
  await assertEditor(user)
  if (!rows.length) throw rule('The import contains no rows.')
  const items = rows.map((r, i) => { try { return normalise(r) } catch (e) { throw rule(`Row ${i + 1}: ${(e as Error).message}`) } })
  const dup = items.find((x, i) => items.findIndex((y) => y.key === x.key) !== i)
  if (dup) throw rule(`Key ${dup.key} appears twice in the file.`)
  await prisma.$transaction(async (tx) => {
    const v = await draftOf(tx, versionId)
    let start = 0
    if (mode === 'replace') await tx.libraryItem.deleteMany({ where: { versionId } })
    else {
      const existing = await tx.libraryItem.findMany({ where: { versionId }, select: { key: true, position: true } })
      const clash = items.find((x) => existing.some((e) => e.key === x.key))
      if (clash) throw rule(`${clash.key} already exists in this version (use "replace" to load a complete list).`)
      start = existing.reduce((m, e) => Math.max(m, e.position + 1), 0)
    }
    await tx.libraryItem.createMany({ data: items.map((it, i) => ({ ...it, versionId, position: start + i })) })
    await touch(tx, versionId, user)
    await log(user, 'library.import', `${v.pack.market} v${v.version}: ${items.length} item(s) ${mode === 'replace' ? 'loaded (replace)' : 'appended'}`)
  })
}

/* ---------------------------------------------------------------- approval */

/**
 * Four-eyes approval: neither the draft's author nor its last editor may approve it.
 * The previous approved version becomes Superseded, and every active project in that market receives a
 * "Library update" to assess (nothing changes in a project until its Owner / QA applies it).
 */
export async function approveVersion(user: AuthUser, versionId: string, reason: string) {
  await assertEditor(user)
  if (!reason.trim()) throw rule('Record the basis of the approval (what was verified, against which official text).')
  const result = await prisma.$transaction(async (tx) => {
    await lock(tx)
    const v = await draftOf(tx, versionId)
    if (v.createdByUserId === user.id || v.updatedByUserId === user.id) throw forbidden('Four-eyes rule: the author or last editor of a draft cannot approve it. Ask another library editor.')
    const n = await tx.libraryItem.count({ where: { versionId } })
    if (!n) throw rule('An empty version cannot be approved.')
    await tx.libraryVersion.updateMany({ where: { packId: v.packId, status: 'Approved' }, data: { status: 'Superseded' } })
    await tx.libraryVersion.update({ where: { id: v.id }, data: { status: 'Approved', approvedByUserId: user.id, approvedByName: user.name, approvedAt: new Date(), approvalReason: reason.trim() } })

    // fan out: one "Library update" per active project that targets this market
    const projects = await tx.project.findMany({ where: { status: 'Active' } })
    const notified: string[] = []
    for (const p of projects) {
      if (!((p.markets as string[]) ?? []).includes(v.pack.market)) continue
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${p.id}))::text AS locked`
      const d = await diffForProject(tx, p, v.pack.market, v.id)
      if (!d.added.length && !d.changed.length && !d.removed.length) continue
      // an older, still unassessed library update for the same market is replaced by this one
      await tx.regUpdate.updateMany({ where: { projectId: p.id, kind: 'Library', market: v.pack.market, status: 'Awaiting assessment' }, data: { status: 'Not applicable', reason: `Superseded by library ${v.pack.market} v${v.version}.` } })
      const codes = await tx.regUpdate.findMany({ where: { projectId: p.id }, select: { code: true } })
      const code = nextCode('UPD', codes)
      await tx.regUpdate.create({
        data: {
          projectId: p.id, code, market: v.pack.market, kind: 'Library', libraryVersionId: v.id,
          title: `Requirement library ${v.pack.market} v${v.version} approved`,
          summary: `${d.added.length} new, ${d.changed.length} changed, ${d.removed.length} removed requirement(s) for this project (${p.facilityType}). Approval basis: ${reason.trim()}`,
          reqs: [...d.changed.map((c) => c.req.code), ...d.removed.map((r) => r.code)],
        },
      })
      const seq = ((await tx.notice.aggregate({ where: { projectId: p.id }, _max: { seq: true } }))._max.seq ?? 0) + 1
      await tx.notice.create({ data: { projectId: p.id, seq, category: 'Source', text: `${code}: requirement library ${v.pack.market} v${v.version} approved — assess and apply it under Regulatory changes.`, forRole: 'Owner / QA' } })
      await tx.auditEvent.create({ data: { projectId: p.id, role: 'Administrator', userId: user.id, userName: user.name, text: `${code} raised: library ${v.pack.market} v${v.version} (${d.added.length} new, ${d.changed.length} changed, ${d.removed.length} removed)` } })
      notified.push(p.code)
    }
    return { market: v.pack.market, version: v.version, notified }
  })
  await log(user, 'library.approved', `${result.market} v${result.version} approved: ${reason.trim()} · projects notified: ${result.notified.join(', ') || 'none'}`)
  return result
}
