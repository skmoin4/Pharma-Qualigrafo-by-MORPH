// Project lifecycle: create (wizard), edit details, archive / restore.
import { prisma } from '../db.ts'
import { disciplines as STANDARD_DISCIPLINES } from '../domain/reference.ts'
import type { Facility, MarketKey, Role, Scope } from '../domain/types.ts'
import { forbidden, rule } from '../lib/http.ts'
import { securityLog } from '../lib/security.ts'
import type { AuthUser } from '../middleware/auth.ts'
import type { Ctx } from './ctx.ts'
import { instantiateMarket } from './libraryProjects.ts'

/** Administrators, and anyone who is Owner / QA on at least one project, may create projects. */
export async function canCreateProjects(user: { id: string; isAdmin: boolean }) {
  if (user.isAdmin) return true
  return (await prisma.membership.count({ where: { userId: user.id, role: 'Owner / QA' } })) > 0
}

export interface CreateProject {
  code?: string
  name: string
  client: string
  site: string
  plantCountry: MarketKey
  markets: MarketKey[]
  facility: Facility
  scope: Scope
  phase: string
  ownerStandards: string
  disciplines: string[]
  companies: { name: string; kind: string }[]
  members: { userId: string; role: Role; scope?: string | null }[]
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ')

export async function createProject(user: AuthUser, b: CreateProject, requestId: string): Promise<string> {
  if (!(await canCreateProjects(user))) throw forbidden('Only administrators and Owner / QA users can create projects.')
  const name = clean(b.name)
  const client = clean(b.client)
  const site = clean(b.site)
  if (name.length < 3) throw rule('Project name is required (at least 3 characters).')
  if (client.length < 2) throw rule('Client is required.')
  if (site.length < 2) throw rule('Site / location is required.')

  const disciplines = [...new Set(b.disciplines.map(clean).filter(Boolean))]
  if (!disciplines.length) throw rule('Choose at least one discipline.')

  const companies = new Map<string, string>([[client, 'Owner']])
  for (const c of b.companies) {
    const n = clean(c.name)
    if (n.length < 2) throw rule('Every company needs a name.')
    if (!companies.has(n)) companies.set(n, c.kind)
  }

  if (!b.members.some((m) => m.role === 'Owner / QA')) throw rule('Assign at least one Owner / QA: they approve stage 2 and manage the project.')
  const seen = new Set<string>()
  for (const m of b.members) {
    if (seen.has(m.userId)) throw rule('A person can hold only one role per project.')
    seen.add(m.userId)
    const scope = m.scope?.trim() || null
    if (scope && m.role !== 'Contractor') throw rule('Only Contractor members can be limited to one company.')
    if (scope && !companies.has(scope)) throw rule(`${scope} is not one of the project companies.`)
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...seen] } } })
  for (const m of b.members) {
    const u = users.find((x) => x.id === m.userId)
    if (!u) throw rule('A selected team member no longer exists.')
    if (!u.active) throw rule(`${u.name} is disabled and cannot join the project.`)
  }

  const markets = [...new Set([b.plantCountry, ...b.markets])]
  const code = await prisma.$transaction(async (tx) => {
    // Serialise project creation so generated codes cannot collide.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('qualigrafo:project-codes'))::text AS locked`
    let code = b.code?.trim().toUpperCase()
    if (code) {
      if (!/^[A-Z0-9][A-Z0-9-]{2,19}$/.test(code)) throw rule('Project code: 3–20 letters, digits or dashes, e.g. NP-2026-07.')
      if (await tx.project.findUnique({ where: { code } })) throw rule(`Project code ${code} is already used.`)
    } else {
      const codes = await tx.project.findMany({ where: { code: { startsWith: 'PRJ-' } }, select: { code: true } })
      const max = codes.reduce((m, p) => Math.max(m, Number(p.code.slice(4)) || 0), 0)
      code = `PRJ-${String(max + 1).padStart(3, '0')}`
    }
    const p = await tx.project.create({
      data: { code, name, client, site, plantCountry: b.plantCountry, markets, facility: b.facility, scope: b.scope, phase: clean(b.phase) || 'Design', ownerStandards: b.ownerStandards.trim(), baseline: 1, createdByUserId: user.id },
    })
    await tx.baseline.create({ data: { projectId: p.id, v: 1, byRole: 'Owner / QA', byUserId: user.id, reason: 'Project created' } })
    await tx.discipline.createMany({ data: disciplines.map((n, i) => ({ projectId: p.id, name: n, position: i + 1 })) })
    await tx.company.createMany({ data: [...companies].map(([n, kind]) => ({ projectId: p.id, name: n, kind })) })
    await tx.membership.createMany({ data: b.members.map((m) => ({ userId: m.userId, projectId: p.id, role: m.role, companyScope: m.scope?.trim() || null })) })
    const audit = (text: string) => ({ projectId: p.id, role: user.isAdmin ? 'Administrator' : 'Owner / QA', userId: user.id, userName: user.name, text, requestId })
    // Approved library requirements for every target market (filtered by facility type), all "Assessment pending".
    const libraryLines: string[] = []
    for (const m of markets) {
      const r = await instantiateMarket(tx, { id: p.id, facility: b.facility }, m)
      libraryLines.push(r.version ? `${r.codes.length} requirement(s) from library ${m} v${r.version.version}${r.disciplines.length ? ` (disciplines added: ${r.disciplines.join(', ')})` : ''}` : `no approved library pack for ${m}`)
    }
    await tx.auditEvent.createMany({
      data: [
        audit(`Project ${code} created: ${name} (${client}, ${site}); markets ${markets.join(', ')}; ${b.facility} · ${b.scope}`),
        ...b.members.map((m) => { const u = users.find((x) => x.id === m.userId)!; return audit(`Team: ${u.name} <${u.email}> added as ${m.role}${m.scope ? ` limited to ${m.scope}` : ''}`) }),
        audit(`Requirements: ${libraryLines.join('; ')}`),
      ],
    })
    return code
  })
  for (const m of b.members) {
    const u = users.find((x) => x.id === m.userId)!
    await securityLog('membership.set', { email: u.email, userId: u.id, actorId: user.id, actorName: user.name, detail: `${code}: ${m.role}${m.scope ? ` (${m.scope})` : ''} (project created)` })
  }
  return code
}

export const DEFAULT_DISCIPLINES = STANDARD_DISCIPLINES

const ownerQa = (c: Ctx) => {
  if (c.role !== 'Owner / QA') throw forbidden('Only Owner / QA can change project details.')
}

/** Name, client and site are descriptive; plant country, markets, facility and scope change through a new baseline (Setup). */
export async function updateDetails(c: Ctx, b: { name: string; client: string; site: string }) {
  ownerQa(c)
  const name = clean(b.name), client = clean(b.client), site = clean(b.site)
  if (name.length < 3 || client.length < 2 || site.length < 2) throw rule('Name, client and site are required.')
  const changes = [name !== c.project.name && `name "${c.project.name}" -> "${name}"`, client !== c.project.client && `client "${c.project.client}" -> "${client}"`, site !== c.project.site && `site "${c.project.site}" -> "${site}"`].filter(Boolean)
  if (!changes.length) throw rule('Nothing changed.')
  await c.tx.project.update({ where: { id: c.project.id }, data: { name, client, site } })
  await c.log(`Project details changed: ${changes.join('; ')}`)
}

export async function archiveProject(c: Ctx, reason: string) {
  ownerQa(c)
  if (c.project.status === 'Archived') throw rule('The project is already archived.')
  if (!reason.trim()) throw rule('Record why the project is archived (e.g. handed over, cancelled).')
  await c.tx.project.update({ where: { id: c.project.id }, data: { status: 'Archived', archivedAt: new Date(), archivedReason: reason.trim() } })
  await c.log(`Project archived (read-only): ${reason.trim()}`)
}

export async function restoreProject(c: Ctx, reason: string) {
  ownerQa(c)
  if (c.project.status !== 'Archived') throw rule('The project is not archived.')
  if (!reason.trim()) throw rule('Record why the project is restored.')
  await c.tx.project.update({ where: { id: c.project.id }, data: { status: 'Active', archivedAt: null, archivedReason: null } })
  await c.log(`Project restored to active: ${reason.trim()}`)
}
