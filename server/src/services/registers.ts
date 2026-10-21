// Project registers: companies (parties), systems / equipment, disciplines.
// Other records refer to them by name / tag, so every create path validates against these registers.
import { forbidden, notFound, rule } from '../lib/http.ts'
import type { Ctx } from './ctx.ts'

const reviewer = (c: Ctx) => {
  if (c.role === 'Contractor') throw forbidden('Only Consultant or Owner / QA can maintain the system and discipline registers.')
}
const ownerQa = (c: Ctx) => {
  if (c.role !== 'Owner / QA') throw forbidden('Only Owner / QA can maintain the company register (it controls vendor access).')
}
const clean = (s: string) => s.trim().replace(/\s+/g, ' ')

/* ---------------------------------------------------------------- lookups used by other services */

export async function requireSystem(c: Ctx, tag: string) {
  const s = await c.tx.system.findUnique({ where: { projectId_tag: { projectId: c.project.id, tag } } })
  if (!s) throw rule(`System ${tag || '(none)'} is not in the system register. Add it under Companies & systems first.`)
  if (!s.active) throw rule(`System ${tag} is inactive in the system register.`)
  return s
}
export async function requireDiscipline(c: Ctx, name: string) {
  const d = await c.tx.discipline.findUnique({ where: { projectId_name: { projectId: c.project.id, name } } })
  if (!d || !d.active) throw rule(`Discipline "${name}" is not an active discipline of this project.`)
  return d
}
export async function requireCompany(c: Ctx, name: string) {
  const co = await c.tx.company.findUnique({ where: { projectId_name: { projectId: c.project.id, name } } })
  if (!co || !co.active) throw rule(`Company "${name}" is not an active company in this project's register.`)
  return co
}

/* ---------------------------------------------------------------- companies */

export async function addCompany(c: Ctx, b: { name: string; kind: string; contactName?: string | null; contactEmail?: string | null }) {
  ownerQa(c)
  const name = clean(b.name)
  if (name.length < 2) throw rule('Company name is required.')
  if (await c.tx.company.findUnique({ where: { projectId_name: { projectId: c.project.id, name } } })) throw rule(`${name} is already in the register.`)
  await c.tx.company.create({ data: { projectId: c.project.id, name, kind: b.kind, contactName: b.contactName?.trim() || null, contactEmail: b.contactEmail?.trim() || null } })
  await c.log(`Company added: ${name} (${b.kind})`)
}

/** Renaming carries the new name onto every document and vendor scope that used the old one. */
export async function updateCompany(c: Ctx, id: string, b: { name?: string; kind?: string; contactName?: string | null; contactEmail?: string | null; active?: boolean }) {
  ownerQa(c)
  const co = await c.tx.company.findFirst({ where: { id, projectId: c.project.id } })
  if (!co) throw notFound('Company not found.')
  const name = b.name === undefined ? co.name : clean(b.name)
  if (name.length < 2) throw rule('Company name is required.')
  const renamed = name !== co.name
  if (renamed && (await c.tx.company.findUnique({ where: { projectId_name: { projectId: c.project.id, name } } }))) throw rule(`${name} is already in the register.`)
  if (b.active === false && co.active) {
    const scoped = await c.tx.membership.count({ where: { projectId: c.project.id, companyScope: co.name } })
    if (scoped) throw rule(`${co.name} has ${scoped} vendor account(s) limited to it. Change their access before deactivating the company.`)
  }
  await c.tx.company.update({
    where: { id: co.id },
    data: { name, kind: b.kind, contactName: b.contactName === undefined ? undefined : b.contactName?.trim() || null, contactEmail: b.contactEmail === undefined ? undefined : b.contactEmail?.trim() || null, active: b.active },
  })
  if (renamed) {
    const docs = await c.tx.document.updateMany({ where: { projectId: c.project.id, owner: co.name }, data: { owner: name } })
    await c.tx.membership.updateMany({ where: { projectId: c.project.id, companyScope: co.name }, data: { companyScope: name } })
    await c.log(`Company renamed: ${co.name} -> ${name} (${docs.count} document(s) updated)`)
  }
  if (b.active !== undefined && b.active !== co.active) await c.log(`Company ${name} ${b.active ? 'reactivated' : 'deactivated'}`)
  else if (!renamed) await c.log(`Company updated: ${name}`)
}

/* ---------------------------------------------------------------- systems / equipment */

type SystemInput = { tag: string; name: string; discipline?: string | null; area?: string | null; gmpCritical?: boolean }

async function insertSystem(c: Ctx, b: SystemInput) {
  const tag = b.tag.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(tag)) throw rule(`Tag "${b.tag}" is invalid: use letters, digits and - _ . / (max 40).`)
  const name = clean(b.name)
  if (!name) throw rule(`System ${tag}: a description is required.`)
  if (b.discipline) await requireDiscipline(c, b.discipline)
  if (await c.tx.system.findUnique({ where: { projectId_tag: { projectId: c.project.id, tag } } })) throw rule(`System ${tag} is already in the register.`)
  await c.tx.system.create({ data: { projectId: c.project.id, tag, name, discipline: b.discipline || null, area: b.area?.trim() || null, gmpCritical: !!b.gmpCritical } })
  return tag
}

export async function addSystem(c: Ctx, b: SystemInput) {
  reviewer(c)
  const tag = await insertSystem(c, b)
  await c.log(`System added: ${tag} ${clean(b.name)}`)
}

/** All-or-nothing import of an equipment list; the first bad row aborts with its row number. */
export async function importSystems(c: Ctx, rows: SystemInput[]) {
  reviewer(c)
  if (!rows.length) throw rule('The import contains no rows.')
  const seen = new Set<string>()
  for (const [i, r] of rows.entries()) {
    const tag = r.tag.trim().toUpperCase()
    if (seen.has(tag)) throw rule(`Row ${i + 1}: tag ${tag} appears twice in the file.`)
    seen.add(tag)
    try {
      await insertSystem(c, r)
    } catch (e) {
      throw rule(`Row ${i + 1}: ${(e as Error).message}`)
    }
  }
  await c.log(`System register import: ${rows.length} system(s) added`)
}

/** The tag is the identifier other records point to, so it cannot be changed; deactivate and add a new one instead. */
export async function updateSystem(c: Ctx, tag: string, b: { name?: string; discipline?: string | null; area?: string | null; gmpCritical?: boolean; active?: boolean }) {
  reviewer(c)
  const s = await c.tx.system.findUnique({ where: { projectId_tag: { projectId: c.project.id, tag } } })
  if (!s) throw notFound(`System ${tag} not found.`)
  if (b.name !== undefined && !clean(b.name)) throw rule('A description is required.')
  if (b.discipline) await requireDiscipline(c, b.discipline)
  await c.tx.system.update({
    where: { id: s.id },
    data: { name: b.name === undefined ? undefined : clean(b.name), discipline: b.discipline === undefined ? undefined : b.discipline || null, area: b.area === undefined ? undefined : b.area?.trim() || null, gmpCritical: b.gmpCritical, active: b.active },
  })
  await c.log(b.active !== undefined && b.active !== s.active ? `System ${tag} ${b.active ? 'reactivated' : 'deactivated'}` : `System updated: ${tag}`)
}

/* ---------------------------------------------------------------- disciplines */

export async function addDiscipline(c: Ctx, raw: string) {
  reviewer(c)
  const name = clean(raw)
  if (name.length < 2) throw rule('Discipline name is required.')
  if (await c.tx.discipline.findUnique({ where: { projectId_name: { projectId: c.project.id, name } } })) throw rule(`${name} already exists.`)
  const last = await c.tx.discipline.aggregate({ where: { projectId: c.project.id }, _max: { position: true } })
  await c.tx.discipline.create({ data: { projectId: c.project.id, name, position: (last._max.position ?? 0) + 1 } })
  await c.log(`Discipline added: ${name}`)
}

/** A discipline is a label, so renaming updates every record that carries it. */
export async function updateDiscipline(c: Ctx, id: string, b: { name?: string; active?: boolean; move?: 'up' | 'down' }) {
  reviewer(c)
  const d = await c.tx.discipline.findFirst({ where: { id, projectId: c.project.id } })
  if (!d) throw notFound('Discipline not found.')
  const name = b.name === undefined ? d.name : clean(b.name)
  if (name.length < 2) throw rule('Discipline name is required.')
  if (name !== d.name) {
    if (await c.tx.discipline.findUnique({ where: { projectId_name: { projectId: c.project.id, name } } })) throw rule(`${name} already exists.`)
    const where = { projectId: c.project.id, discipline: d.name }
    await c.tx.document.updateMany({ where, data: { discipline: name } })
    await c.tx.requirement.updateMany({ where, data: { discipline: name } })
    await c.tx.rfi.updateMany({ where, data: { discipline: name } })
    await c.tx.system.updateMany({ where, data: { discipline: name } })
    await c.log(`Discipline renamed: ${d.name} -> ${name}`)
  }
  if (b.move) {
    const all = await c.tx.discipline.findMany({ where: { projectId: c.project.id }, orderBy: [{ position: 'asc' }, { name: 'asc' }] })
    const i = all.findIndex((x) => x.id === d.id)
    const j = b.move === 'up' ? i - 1 : i + 1
    if (j >= 0 && j < all.length) {
      const order = [...all]
      ;[order[i], order[j]] = [order[j], order[i]]
      for (const [pos, x] of order.entries()) await c.tx.discipline.update({ where: { id: x.id }, data: { position: pos + 1 } })
    }
  }
  if (b.active !== undefined && b.active !== d.active) {
    await c.tx.discipline.update({ where: { id: d.id }, data: { active: b.active } })
    await c.log(`Discipline ${name} ${b.active ? 'reactivated' : 'deactivated'}`)
  }
  await c.tx.discipline.update({ where: { id: d.id }, data: { name } })
}
