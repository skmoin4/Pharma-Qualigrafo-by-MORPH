import { useEffect, useState } from 'react'
import { ArrowRight, ExternalLink, Plus } from 'lucide-react'
import { markets } from '../data/reference'
import { api, errorText } from '../api'
import { TODAY, useStore } from '../store'
import { Badge, Empty, MarketChip, PageHead, Stat, fmtDate, openProjectRoute } from '../components/ui'
import type { PageKey } from '../components/ui'
import type { MarketKey, Profile, WorkItem } from '../types'

/** One row of `GET /admin/projects`: every project on the installation, with the reader's own role if they have one. */
interface AdminProject {
  code: string; name: string; client: string; status: string; phase: string; facility: string
  projectCountry: string; createdAt: string; companies: string[]; members: number; myRole: string | null
}

/**
 * Every project the user belongs to (archived ones only on request), from the server's portfolio summaries: figures and
 * work are computed on the server with the user's role in *that* project (P1 — no full project payloads here).
 */
export function useAll(includeArchived = false) {
  const summaries = useStore((s) => s.summaries)
  return summaries
    .filter((s) => includeArchived || s.profile.status !== 'Archived')
    .map((s) => ({ meta: s.profile, s, st: s.stats, work: s.work }))
}

function WorkRow({ w, name }: { w: WorkItem; name: string }) {
  return (
    <tr>
      <td style={{ width: 130 }}><Badge tone={w.overdue ? 'red' : 'blue'} dot={false}>{w.kind}</Badge></td>
      <td><button className="link" onClick={() => openProjectRoute(w.project, w.page as PageKey)}>{w.title}</button><small>{name} · {w.detail}</small></td>
      <td className="muted" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{w.due ? <span style={w.overdue ? { color: 'var(--red)', fontWeight: 600 } : undefined}>{w.overdue ? 'Overdue · ' : 'Due '}{w.due}</span> : ''}</td>
    </tr>
  )
}

/** The classification fields the portfolio can be filtered by, in the order they are shown. */
const FILTERS = [
  ['industryGroup', 'Industry'],
  ['facilityType', 'Facility'],
  ['serviceType', 'Service'],
  ['projectStage', 'Stage'],
  ['projectCountry', 'Country'],
] as const
type FilterKey = (typeof FILTERS)[number][0]
/** The custom facility name is what the user typed, so it is what a facility filter has to match on. */
const filterValue = (p: Profile, k: FilterKey) => (k === 'facilityType' ? p.customFacilityType || p.facilityType : p[k])

export default function Portfolio() {
  const everything = useAll(true)
  const all = everything.filter((a) => a.meta.status !== 'Archived')
  const archived = everything.filter((a) => a.meta.status === 'Archived')
  const [showArchived, setShowArchived] = useState(false)
  /**
   * Portfolio filters (Phase 5 / step 1). One installation now holds projects from four industries, so the list is
   * filterable by every classification field. A filter only offers values that actually occur in the portfolio, and
   * "All" is the default, so the list never hides a project the user did not ask to hide.
   */
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ industryGroup: '', facilityType: '', serviceType: '', projectStage: '', projectCountry: '' })
  const pool = showArchived ? archived : all
  const optionsOf = (k: FilterKey) => [...new Set(pool.map((a) => filterValue(a.meta, k)).filter(Boolean))].sort()
  const rows = pool.filter((a) => FILTERS.every(([k]) => !filters[k] || filterValue(a.meta, k) === filters[k]))
  const filtered = FILTERS.some(([k]) => filters[k])
  const role = useStore((s) => s.role)
  const session = useStore((s) => s.session)
  const canCreate = !!session?.canCreateProjects
  const work = all.flatMap((a) => a.work.map((w) => ({ w, name: a.meta.name })))
  const overdue = all.reduce((n, a) => n + a.st.overdue, 0)
  const regs = all.flatMap((a) => a.s.updates.filter((u) => u.status === 'Awaiting assessment').map((u) => ({ u, a })))
  const open = all.reduce((n, a) => n + a.st.gaps, 0)
  const deadlines = all.flatMap((a) => a.s.deadlines.map((d) => ({ d, a }))).sort((x, y) => x.d.due.localeCompare(y.d.due)).slice(0, 7)
  const recent = all.flatMap((a) => a.s.recent.map((e) => ({ ...e, name: a.meta.name }))).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 7)

  return (
    <>
      <PageHead
        title="Portfolio"
        sub={`Engineering evidence across ${all.length} active project${all.length === 1 ? '' : 's'} · as of ${TODAY}`}
        actions={<>
          {archived.length > 0 && <div className="seg"><button className={!showArchived ? 'on' : ''} onClick={() => setShowArchived(false)}>Active ({all.length})</button><button className={showArchived ? 'on' : ''} onClick={() => setShowArchived(true)}>Archived ({archived.length})</button></div>}
          {canCreate && <button className="btn pri" onClick={() => { window.location.hash = '#/new-project' }}><Plus size={14} /> New project</button>}
        </>}
      />
      {!everything.length && (
        <section className="card" style={{ marginBottom: 14 }}>
          <Empty title="No projects yet">
            {canCreate
              ? <>Create the first project: profile, markets, registers and team in five steps.<br /><button className="btn pri" style={{ marginTop: 10 }} onClick={() => { window.location.hash = '#/new-project' }}><Plus size={14} /> New project</button></>
              : 'You are not on any project team yet. Ask your Owner / QA or administrator to add you.'}
          </Empty>
        </section>
      )}

      <div className="grid g4">
        <Stat label="Active projects" value={all.length} sub={`${all.filter((a) => a.st.attention).length} need attention`} />
        <Stat label={`Waiting for ${role}`} value={work.length} sub="Across all projects" warn={work.length > 8} />
        <Stat label="Overdue records" value={overdue} sub="Documents past their due date" warn={overdue > 0} />
        <Stat label="Open evidence gaps" value={open} sub={`${regs.length} regulatory update(s) awaiting assessment`} warn={open > 0} />
      </div>

      <section className="card flush mt">
        <h2>Projects <span className="muted small" style={{ fontWeight: 400 }}>click a project to open its workspace</span></h2>
        <div className="row wrap filterbar" style={{ padding: '0 18px 12px', gap: 8 }}>
          {FILTERS.map(([k, label]) => {
            const opts = optionsOf(k)
            return (
              <label key={k} className="row small" style={{ gap: 5 }}>
                <span className="muted">{label}</span>
                <select className="input compact" aria-label={label} value={filters[k]} disabled={!opts.length} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}>
                  <option value="">All</option>
                  {opts.map((o) => <option key={o} value={o}>{k === 'projectCountry' ? (markets[o as MarketKey]?.name ?? o) : o}</option>)}
                </select>
              </label>
            )
          })}
          {filtered && <button className="link small" onClick={() => setFilters({ industryGroup: '', facilityType: '', serviceType: '', projectStage: '', projectCountry: '' })}>Clear filters</button>}
          {filtered && <span className="muted small">{rows.length} of {pool.length} shown</span>}
        </div>
        <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
          <table>
            <thead><tr><th>Project</th><th>Stage</th><th style={{ width: 200 }}>Evidence accepted</th><th>Handover gates</th><th>Next due</th><th>Attention</th><th /></tr></thead>
            <tbody>
              {!rows.length && filtered && <tr><td colSpan={7}><Empty title="No project matches these filters">Clear a filter to widen the list; {pool.length} project{pool.length === 1 ? '' : 's'} {pool.length === 1 ? 'is' : 'are'} hidden.</Empty></td></tr>}
              {rows.map(({ meta, s, st }) => {
                const pct = st.required ? (100 * st.accepted) / st.required : 0
                return (
                  <tr key={meta.id} className="clickrow" onClick={() => openProjectRoute(meta.id)}>
                    <td>
                      <b style={{ color: 'var(--teal-d)', fontSize: 14 }}>{meta.name}</b>{meta.status === 'Archived' && <> <Badge dot={false}>Archived</Badge></>}
                      <small>{meta.id} · {meta.client} · {meta.site}</small>
                      <div className="row wrap" style={{ gap: 5, marginTop: 5 }}><Badge tone="blue" dot={false}>{meta.customFacilityType || meta.facilityType}</Badge><Badge dot={false}>{meta.serviceType}</Badge><Badge dot={false}>{meta.scope}</Badge>{s.markets.map((m) => <span key={m} title={markets[m].name}><MarketChip m={m} /></span>)}</div>
                    </td>
                    <td>{meta.projectStage}<small>Baseline B{s.baseline}</small></td>
                    <td><div className="row sb small"><b>{st.accepted}</b><span className="muted">of {st.required} required</span></div><div className="bar" style={{ marginTop: 5 }}><i style={{ width: `${pct}%` }} /></div></td>
                    <td><div className="pips" title="Document-gate conditions">{st.gates.map((g) => <i key={g.key} className={g.n === 0 ? 'ok' : 'open'} title={`${g.label}: ${g.n === 0 ? 'clear' : g.n + ' open'}`} />)}</div><small>{st.gates.filter((g) => g.n === 0).length} of {st.gates.length} clear</small></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{st.upcoming ?? <span className="muted">—</span>}{st.upcoming && st.upcoming < TODAY && <small style={{ color: 'var(--red)' }}>Overdue</small>}</td>
                    <td>{st.flags.length ? <div className="row wrap" style={{ gap: 4 }}>{st.flags.slice(0, 3).map((f) => <Badge key={f} tone={/overdue|critical|stale/.test(f) ? 'red' : 'amber'} dot={false}>{f}</Badge>)}</div> : <Badge tone="green">No flags</Badge>}</td>
                    <td style={{ textAlign: 'right' }}><ArrowRight size={16} color="#6c808c" /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid g21 mt">
        <section className="card flush">
          <h2>Needs your attention · {role} <span className="muted small" style={{ fontWeight: 400 }}>{work.length} item(s)</span></h2>
          <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
            <table><tbody>
              {work.sort((a, b) => Number(b.w.overdue) - Number(a.w.overdue)).slice(0, 8).map((x, i) => <WorkRow key={i} w={x.w} name={x.name} />)}
              {!work.length && <tr><td><Empty title="Nothing waiting for this role" /></td></tr>}
            </tbody></table>
          </div>
          {work.length > 8 && <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line-2)' }}><a className="link" href="#/work">View all {work.length} in My work →</a></div>}
        </section>
        <div className="grid" style={{ alignSelf: 'start' }}>
          <section className="card flush">
            <h2>Regulatory inbox <a className="link small" href="#/watch">Open</a></h2>
            <div style={{ padding: '0 16px 12px' }} className="list">
              {regs.map(({ u, a }) => <div key={a.meta.id + u.id}><div className="row"><MarketChip m={u.market as MarketKey} /><b className="small">{u.title}</b></div><div className="muted small" style={{ marginTop: 3 }}>{a.meta.name} · {u.reqs.length} requirement(s) potentially affected</div></div>)}
              {!regs.length && <p className="muted small">No updates awaiting assessment.</p>}
            </div>
          </section>
          <section className="card flush">
            <h2>Upcoming deadlines</h2>
            <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}><table><tbody>
              {deadlines.map(({ d, a }) => <tr key={a.meta.id + d.id}><td><button className="link" onClick={() => openProjectRoute(a.meta.id, 'documents')}>{d.title}</button><small>{a.meta.name} · {d.owner}</small></td><td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: d.due < TODAY ? 'var(--red)' : undefined, fontWeight: d.due < TODAY ? 600 : 400 }}>{d.due}</td></tr>)}
            </tbody></table></div>
          </section>
        </div>
      </div>

      <section className="card flush mt">
        <h2>Recent activity across projects</h2>
        <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}><table><tbody>
          {recent.map((e, i) => <tr key={i}><td>{e.text}<small>{e.name}</small></td><td className="muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{e.role} · {fmtDate(e.at)}</td></tr>)}
          {!recent.length && <tr><td><Empty title="No activity yet" /></td></tr>}
        </tbody></table></div>
      </section>

      {session?.isAdmin && <AllProjects mine={new Set(everything.map((a) => a.meta.id))} showArchived={showArchived} />}
    </>
  )
}

/**
 * Administrator view: every project on the installation, including the ones the administrator is not a member of.
 * The portfolio above stays membership-driven, because role is what every permission in a project is built on —
 * so a project without a membership is listed but not opened; the administrator gives themselves a role first,
 * under Users & access, and that grant is audited like any other membership change.
 */
function AllProjects({ mine, showArchived }: { mine: Set<string>; showArchived: boolean }) {
  const [all, setAll] = useState<AdminProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api<{ projects: AdminProject[] }>('GET', '/admin/projects').then((r) => setAll(r.projects)).catch((e) => setError(errorText(e)))
  }, [])
  // Only the projects that are missing from the portfolio above. Together the two tables are the whole
  // installation, and no project is listed twice on the same page.
  // The Active / Archived switch above governs this list too, so a project cannot sit under "Active" in one table
  // and under "Archived" in another.
  const rows = all?.filter((p) => !mine.has(p.code) && (p.status === 'Archived') === showArchived) ?? null
  const hiddenArchived = (all ?? []).filter((p) => !mine.has(p.code) && p.status === 'Archived').length
  return (
    <section className="card flush mt">
      <h2>Other projects on this installation <span className="muted small" style={{ fontWeight: 400 }}>administrator view{rows ? ` · ${rows.length} ${showArchived ? 'archived ' : ''}project${rows.length === 1 ? '' : 's'} you are not a member of${!showArchived && hiddenArchived ? ` · ${hiddenArchived} more archived (see the Archived tab)` : ''}` : ''}</span></h2>
      {error && <div className="notice err small" style={{ margin: '0 16px 12px' }}>{error}</div>}
      <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}><table>
        <thead><tr><th>Project</th><th>Facility</th><th>Team</th><th>Your access</th></tr></thead>
        <tbody>
          {(rows ?? []).map((p) => (
            <tr key={p.code}>
              <td>
                <span>{p.name}</span>
                <small>{p.code} · {p.client} · {p.phase}{p.status !== 'Active' ? ` · ${p.status}` : ''}</small>
              </td>
              <td className="small">{p.facility}<small><MarketChip m={p.projectCountry as MarketKey} /> {markets[p.projectCountry as MarketKey]?.name ?? p.projectCountry}</small></td>
              <td className="small">{p.members} {p.members === 1 ? 'person' : 'people'}</td>
              <td><span className="row" style={{ gap: 6 }}><Badge tone="amber">No membership</Badge><button className="link small" onClick={() => { window.location.hash = '#/admin' }}>Give yourself a role →</button></span></td>
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={4}><Empty title={showArchived ? 'No archived projects outside your portfolio' : 'Nothing hidden from you'}>You are a member of every project on this installation.</Empty></td></tr>}
          {!all && !error && <tr><td colSpan={4} className="muted small">Loading…</td></tr>}
        </tbody>
      </table></div>
    </section>
  )
}

export function MyWork() {
  const all = useAll()
  const role = useStore((s) => s.role)
  const [proj, setProj] = useState('all')
  const [kind, setKind] = useState('all')
  const items = all.flatMap((a) => a.work.map((w) => ({ w, name: a.meta.name }))).filter((x) => (proj === 'all' || x.w.project === proj) && (kind === 'all' || x.w.kind === kind))
  const kinds = [...new Set(all.flatMap((a) => a.work.map((w) => w.kind)))]
  return (
    <>
      <PageHead title="My work" sub={`Everything currently waiting for the ${role} role across all projects, derived from the state of each record. Switch the role in the top bar to see another role's queue.`} />
      <div className="filters">
        <select className="input" value={proj} onChange={(e) => setProj(e.target.value)} aria-label="Project"><option value="all">All projects</option>{all.map(({ meta: m }) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type"><option value="all">All types</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select>
        <span className="muted small">{items.length} item(s) · overdue first</span>
      </div>
      <div className="tablewrap"><table><tbody>
        {items.sort((a, b) => Number(b.w.overdue) - Number(a.w.overdue)).map((x, i) => <WorkRow key={i} w={x.w} name={x.name} />)}
        {!items.length && <tr><td><Empty title="You are clear" >Nothing is waiting for this role with the current filters.</Empty></td></tr>}
      </tbody></table></div>
    </>
  )
}

export function Watch() {
  const all = useAll()
  const items = all.flatMap((a) => a.s.updates.map((u) => ({ u, a })))
  return (
    <>
      <PageHead title="Regulatory watch" sub="Source inventory and change inbox across projects. No live monitoring is connected: an update is only ever a prompt for a qualified reviewer, never an automatic change to a project baseline." />
      <div className="notice" style={{ marginBottom: 14 }}>Production flow: official update detected → qualified reviewer assesses → approved rule-pack version → affected projects flagged → actions assigned → evidence re-reviewed.</div>
      <div className="grid g21">
        <section className="card flush">
          <h2>Change inbox</h2>
          <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}><table><tbody>
            {items.map(({ u, a }) => <tr key={a.meta.id + u.id}><td><MarketChip m={u.market as MarketKey} /> <b>{u.title}</b><small>{a.meta.name} · {u.reqs.join(', ')}</small></td><td><Badge tone={u.status === 'Awaiting assessment' ? 'amber' : 'green'}>{u.status}</Badge></td><td style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => openProjectRoute(a.meta.id, 'updates')}>Open</button></td></tr>)}
            {!items.length && <tr><td><Empty title="Inbox is empty" /></td></tr>}
          </tbody></table></div>
        </section>
        <section className="card flush" style={{ alignSelf: 'start' }}>
          <h2>Source inventory</h2>
          <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}><table><tbody>
            {(Object.keys(markets) as MarketKey[]).map((k) => { const inScope = all.filter((a) => a.s.markets.includes(k)).length; return <tr key={k}><td><MarketChip m={k} /> <b>{markets[k].name}</b><small>{markets[k].authority} · in scope for {inScope} project(s)</small></td><td style={{ textAlign: 'right' }}><a href={markets[k].url} target="_blank" rel="noopener noreferrer" className="link small">Source <ExternalLink size={11} /></a><small>Last reviewed: none recorded</small></td></tr> })}
          </tbody></table></div>
        </section>
      </div>
    </>
  )
}
