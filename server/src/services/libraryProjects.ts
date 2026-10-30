// How the requirement library reaches projects: instantiate a market's approved items into a project,
// and compute / apply the difference when a newer library version is approved.
import type { Tx } from '../db.ts'
import { today } from '../domain/rules.ts'
import { nextCode } from './ctx.ts'

type LibItem = { key: string; title: string; topic: string; discipline: string; facilities: unknown; critical: boolean; clause: string; sourceVersion: string; effective: string }

/** Approved version of a market's pack with its items, or null. */
export async function approvedVersion(tx: Tx, market: string) {
  return tx.libraryVersion.findFirst({ where: { status: 'Approved', pack: { market } }, include: { items: { orderBy: { position: 'asc' } }, pack: true } })
}

/** Items that apply to the facility type (an empty list applies to every facility). */
export const forFacility = <T extends { facilities: unknown }>(items: T[], facility: string) =>
  items.filter((i) => { const f = (i.facilities as string[]) ?? []; return !f.length || f.includes(facility) })

const dueIn = (days: number) => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d }

/** Make sure every discipline used by the items exists in the project register (appended at the end). */
async function ensureDisciplines(tx: Tx, projectId: string, names: string[]) {
  const have = await tx.discipline.findMany({ where: { projectId } })
  let pos = have.reduce((m, d) => Math.max(m, d.position), 0)
  const added: string[] = []
  for (const n of [...new Set(names)]) {
    if (have.some((d) => d.name === n)) continue
    await tx.discipline.create({ data: { projectId, name: n, position: ++pos } })
    added.push(n)
  }
  return added
}

async function createRequirements(tx: Tx, projectId: string, market: string, versionId: string, items: LibItem[]) {
  const codes = await tx.requirement.findMany({ where: { projectId }, select: { code: true } })
  const made: string[] = []
  for (const i of items) {
    const code = nextCode('REQ', [...codes, ...made.map((c) => ({ code: c }))])
    made.push(code)
    await tx.requirement.create({
      data: {
        projectId, code, title: i.title, market, topic: i.topic, discipline: i.discipline, system: '', applicability: 'Assessment pending', rationale: '',
        owner: 'Consultant', due: dueIn(30), critical: i.critical, clause: i.clause, sourceVersion: i.sourceVersion, effective: i.effective,
        libraryKey: i.key, libraryVersionId: versionId,
      },
    })
  }
  return made
}

/** Add the approved library items of one market to a project. Returns the new requirement codes and any disciplines created. */
export async function instantiateMarket(tx: Tx, project: { id: string; facilityType: string }, market: string) {
  const v = await approvedVersion(tx, market)
  if (!v) return { version: null, codes: [] as string[], disciplines: [] as string[] }
  const items = forFacility(v.items, project.facilityType)
  const disciplines = await ensureDisciplines(tx, project.id, items.map((i) => i.discipline))
  const codes = await createRequirements(tx, project.id, market, v.id, items)
  return { version: v, codes, disciplines }
}

const CHANGE_FIELDS = ['title', 'topic', 'discipline', 'critical', 'clause', 'sourceVersion', 'effective'] as const

/** Difference between a project's library requirements for a market and a library version (facility-filtered). */
export async function diffForProject(tx: Tx, project: { id: string; facilityType: string }, market: string, versionId: string) {
  const v = await tx.libraryVersion.findUniqueOrThrow({ where: { id: versionId }, include: { items: { orderBy: { position: 'asc' } } } })
  const items = forFacility(v.items, project.facilityType)
  const reqs = await tx.requirement.findMany({ where: { projectId: project.id, market, libraryKey: { not: null } } })
  const byKey = new Map(reqs.map((r) => [r.libraryKey!, r]))
  const added = items.filter((i) => !byKey.has(i.key))
  const changed = items.filter((i) => { const r = byKey.get(i.key); return r && CHANGE_FIELDS.some((f) => r[f] !== i[f]) })
  const keys = new Set(items.map((i) => i.key))
  const removed = reqs.filter((r) => !keys.has(r.libraryKey!) && r.applicability !== 'Not applicable')
  const unchanged = items.filter((i) => byKey.has(i.key) && !changed.includes(i))
  return { version: v, items, added, changed: changed.map((i) => ({ item: i, req: byKey.get(i.key)! })), removed, unchanged: unchanged.map((i) => byKey.get(i.key)!) }
}

/** Apply a library version to a project (called when Owner / QA judges the library update applicable). */
export async function applyLibraryVersion(tx: Tx, project: { id: string; facilityType: string }, market: string, versionId: string) {
  const d = await diffForProject(tx, project, market, versionId)
  const disciplines = await ensureDisciplines(tx, project.id, [...d.added, ...d.changed.map((c) => c.item)].map((i) => i.discipline))
  const addedCodes = await createRequirements(tx, project.id, market, versionId, d.added)
  for (const { item, req } of d.changed) {
    await tx.requirement.update({
      where: { id: req.id },
      data: {
        title: item.title, topic: item.topic, discipline: item.discipline, critical: item.critical, clause: item.clause, sourceVersion: item.sourceVersion, effective: item.effective,
        libraryVersionId: versionId, applicability: 'Assessment pending', rationale: `Changed in library ${market} v${d.version.version}; reassess applicability and evidence.`,
      },
    })
    await tx.evidenceLink.updateMany({ where: { requirementId: req.id, decision: { not: 'Withdrawn' } }, data: { decision: 'Pending' } })
  }
  for (const r of d.removed) {
    await tx.requirement.update({ where: { id: r.id }, data: { applicability: 'Not applicable', rationale: `Removed from library ${market} v${d.version.version}.`, libraryVersionId: versionId } })
  }
  if (d.unchanged.length) await tx.requirement.updateMany({ where: { id: { in: d.unchanged.map((r) => r.id) } }, data: { libraryVersionId: versionId } })
  return { added: addedCodes, changed: d.changed.map((c) => c.req.code), removed: d.removed.map((r) => r.code), disciplines }
}
