import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { CompanySelect, DisciplineSelect, SystemSelect } from '../components/Pickers'
import { TODAY, activeDocs, plusDays, useRegisters, useStore } from '../store'
import { api, downloadAs, errorText } from '../api'
import { Plus } from 'lucide-react'
import type { Member, Role } from '../types'
import { Badge, DocBadge, Empty, PageHead, R, fmtDate, useUI } from '../components/ui'

/* ------------------------------------------------------------------ schedule */
const DAY = 86400000
const t = (s: string) => new Date(s + 'T00:00:00Z').getTime()

export function Schedule() {
  const { allDisciplines } = useRegisters()
  const { docs, rfis, actions } = useStore()
  const open = useUI((s) => s.open)
  const [disc, setDisc] = useState('all')
  // Window covers today and every due date shown, padded by a week on each side.
  const dues = [...docs.map((d) => d.due), ...rfis.map((r) => r.due), TODAY].map(t)
  const start = Math.min(...dues) - 7 * DAY, end = Math.max(...dues) + 7 * DAY, span = end - start
  const pos = (d: string) => Math.max(0, Math.min(100, ((t(d) - start) / span) * 100))
  const weeks = Array.from({ length: Math.max(1, Math.floor(span / (7 * DAY)) + 1) }, (_, i) => start + i * 7 * DAY)
  const rows = activeDocs(docs).filter((d) => disc === 'all' || d.discipline === disc).sort((a, b) => a.due.localeCompare(b.due))
  const overdue = rows.filter((d) => d.status !== 'Accepted' && d.due < TODAY).length
  const next7 = rows.filter((d) => d.status !== 'Accepted' && d.due >= TODAY && t(d.due) - t(TODAY) <= 7 * DAY).length
  return (
    <>
      <PageHead title="Schedule" sub="Document due dates against today's date. Accepted records drop off the critical list; overdue and due-soon items are called out." />
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <select className="input" style={{ width: 220 }} value={disc} onChange={(e) => setDisc(e.target.value)} aria-label="Discipline"><option value="all">All disciplines</option>{allDisciplines.map((d) => <option key={d}>{d}</option>)}</select>
        <Badge tone={overdue ? 'red' : 'green'}>{overdue} overdue</Badge><Badge tone={next7 ? 'amber' : ''}>{next7} due within 7 days</Badge>
        <span className="muted small">Today {TODAY} · RFIs ({rfis.filter((r) => r.status !== 'Closed').length} open) and actions ({actions.filter((a) => a.status !== 'Closed').length} open) shown as diamonds</span>
      </div>
      <section className="card flush">
        <div className="gantt">
          <div className="gh"><div>Record</div><div className="axis">{weeks.map((w) => <span key={w} style={{ left: `${((w - start) / span) * 100}%` }}>{new Date(w).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}</span>)}</div></div>
          {rows.map((d) => {
            const late = d.status !== 'Accepted' && d.due < TODAY
            return (
              <div className="gr" key={d.id}>
                <div><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button><small className="muted" style={{ display: 'block' }}>{d.id} · {d.owner} · {R(d.rev)}</small></div>
                <div className="lane">
                  <i className="today" style={{ left: `${pos(TODAY)}%` }} />
                  <span className={`mark ${d.status === 'Accepted' ? 'done' : late ? 'late' : 'due'}`} style={{ left: `${pos(d.due)}%` }} title={`${d.title} · due ${d.due} · ${d.status}`}><DocBadge s={d.status} /></span>
                </div>
              </div>
            )
          })}
          {rfis.filter((r) => r.status !== 'Closed' && (disc === 'all' || r.discipline === disc)).map((r) => (
            <div className="gr" key={r.id}><div><b className="small">{r.title}</b><small className="muted" style={{ display: 'block' }}>{r.id} · RFI · {r.status}</small></div><div className="lane"><i className="today" style={{ left: `${pos(TODAY)}%` }} /><span className="diamond" style={{ left: `${pos(r.due)}%`, background: r.due < TODAY && r.status !== 'Answered' ? 'var(--red)' : 'var(--navy-2)' }} title={`Due ${r.due}`} /></div></div>
          ))}
          {!rows.length && <Empty title="No records in this discipline" />}
        </div>
      </section>
    </>
  )
}

/* ---------------------------------------------------------------- audit trail */
interface AuditRow { seq: string; at: string; role: string; user: string | null; text: string; requestId: string | null }

export function Audit() {
  const { current, audit, toast } = useStore()
  const [rows, setRows] = useState<AuditRow[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [who, setWho] = useState('all')
  const base = `/projects/${encodeURIComponent(current ?? '')}/audit`

  // Reload the newest page whenever this session records a new event (audit.length / newest entry change).
  const newest = audit[0]?.at
  useEffect(() => {
    if (!current) return
    let live = true
    api<{ events: AuditRow[]; next: string | null }>('GET', `${base}?limit=200`)
      .then((r) => { if (live) { setRows(r.events); setNext(r.next) } })
      .catch((e) => toast(errorText(e), 'warn'))
    return () => { live = false }
  }, [base, current, newest, toast])

  const older = async () => {
    if (!next) return
    setBusy(true)
    try {
      const r = await api<{ events: AuditRow[]; next: string | null }>('GET', `${base}?limit=200&before=${next}`)
      setRows((x) => [...x, ...r.events]); setNext(r.next)
    } catch (e) { toast(errorText(e), 'warn') } finally { setBusy(false) }
  }
  const exportCsv = async () => {
    try { await downloadAs(`${base}?format=csv`, `${current}_Audit_Trail.csv`) } catch (e) { toast(errorText(e), 'warn') }
  }
  const shown = rows.filter((a) => (who === 'all' || a.role === who) && `${a.text} ${a.user ?? ''}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <PageHead title="Audit trail" sub="Every decision, sign-off, revision, import and access change in this project, newest first." actions={<button className="btn" onClick={exportCsv}><Download size={14} /> Export full CSV</button>} />
      <div className="notice info" style={{ marginBottom: 12 }}>Stored on the server, append-only. Each entry records the signed-in user, their project role and the request ID. The CSV export always contains the complete trail.</div>
      <div className="filters">
        <input className="input grow" placeholder="Search events or people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit trail" />
        <select className="input" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Role"><option value="all">All roles</option>{['Consultant', 'Contractor', 'Owner / QA', 'Administrator'].map((r) => <option key={r}>{r}</option>)}</select>
        <span className="muted small">{shown.length} of {rows.length} loaded{next ? ' · older events available' : ''}</span>
      </div>
      <div className="tablewrap"><table><thead><tr><th>Time</th><th>Role</th><th>User</th><th>Event</th></tr></thead><tbody>
        {shown.map((a) => <tr key={a.seq} title={a.requestId ? `Request ${a.requestId}` : undefined}><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.at)}</td><td><Badge dot={false}>{a.role}</Badge></td><td>{a.user ?? <span className="muted">—</span>}</td><td>{a.text}</td></tr>)}
        {!shown.length && <tr><td colSpan={4}><Empty title={rows.length ? 'No matching events' : 'Loading…'} /></td></tr>}
      </tbody></table></div>
      {next && <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="btn" disabled={busy} onClick={older}>{busy ? 'Loading…' : 'Load older events'}</button></div>}
    </>
  )
}

/* ------------------------------------------------------- templates & vendors */
export function Templates() {
  const { docs, generateDeliverables, role, toast } = useStore()
  const open = useUI((s) => s.open)
  const [f, setF] = useState({ tag: '', vendor: '', discipline: '', due: plusDays(21) })
  const [vendor, setVendor] = useState('all')
  const vendors = [...new Set(activeDocs(docs).map((d) => d.owner))]
  const list = activeDocs(docs).filter((d) => vendor === 'all' || d.owner === vendor)
  return (
    <>
      <PageHead title="Templates & vendors" sub="Generate a draft deliverable set for a new piece of equipment, and see each vendor's open scope. Nothing here fabricates executed evidence." />
      <div className="grid g2">
        <section className="card">
          <h2>Equipment documentation starter</h2>
          <div className="grid g2">
            <div><label className="lab" style={{ marginTop: 0 }}>Equipment / system tag</label><SystemSelect value={f.tag} onChange={(v) => setF({ ...f, tag: v })} label="Equipment / system tag" /></div>
            <div><label className="lab" style={{ marginTop: 0 }}>Assigned vendor</label><CompanySelect value={f.vendor} onChange={(v) => setF({ ...f, vendor: v })} label="Assigned vendor" /></div>
            <div><label className="lab">Discipline</label><DisciplineSelect value={f.discipline} onChange={(v) => setF({ ...f, discipline: v })} /></div>
            <div><label className="lab">Due date</label><input className="input" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div>
          </div>
          <p className="muted small" style={{ margin: '10px 0' }}>Creates three Draft records: vendor datasheet, approved-drawing submission and O&amp;M manual. They are not treated as required evidence until a reviewer links them to a requirement. No test result, certificate or signature is generated.</p>
          <button className="btn pri" disabled={role === 'Contractor'} onClick={async () => { const er = await generateDeliverables(f); toast(er ?? 'Three draft deliverables created', er ? 'warn' : 'ok'); if (!er) setF({ ...f, tag: '', vendor: '' }) }}>Generate 3 draft deliverables</button>
          {role === 'Contractor' && <span className="muted small" style={{ marginLeft: 10 }}>Consultant or Owner / QA role required</span>}
        </section>
        <section className="card flush">
          <h2>Vendor scope</h2>
          <div style={{ padding: '0 16px 10px' }}><select className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor"><option value="all">All companies</option>{vendors.map((v) => <option key={v}>{v}</option>)}</select><p className="muted small" style={{ marginTop: 6 }}>Convenience filter only. Production isolates each vendor to its own assigned scope on the server.</p></div>
          <div className="tablewrap" style={{ border: 0, borderRadius: 0, maxHeight: 320 }}><table><tbody>
            {list.map((d) => <tr key={d.id}><td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button><small>{d.id} · {d.owner}</small></td><td style={{ textAlign: 'right' }}><DocBadge s={d.status} /></td></tr>)}
          </tbody></table></div>
        </section>
      </div>
    </>
  )
}

/* ----------------------------------------------------------------- project team */
const TEAM_ROLES: Role[] = ['Owner / QA', 'Consultant', 'Contractor']

function MemberRow({ m, can, companies }: { m: Member; can: boolean; companies: string[] }) {
  const { setMember, removeMember, toast, session } = useStore()
  const [role, setRole] = useState<Role>(m.role)
  const [scope, setScope] = useState(m.scope ?? '')
  const dirty = role !== m.role || (role === 'Contractor' ? scope : '') !== (m.scope ?? '')
  const save = async () => { const er = await setMember(m.userId, role, role === 'Contractor' && scope ? scope : null); toast(er ?? `${m.name}: ${role}${role === 'Contractor' && scope ? ` (only ${scope})` : ''}`, er ? 'warn' : 'ok') }
  const remove = async () => {
    if (!confirm(`Remove ${m.name} from the project? They lose access immediately; their past actions stay in the audit trail.`)) return
    const er = await removeMember(m.userId)
    toast(er ?? `${m.name} removed from the team`, er ? 'warn' : 'ok')
  }
  return (
    <tr>
      <td><b>{m.name}</b>{m.userId === session?.id && <span className="muted small"> (you)</span>}<small>{m.email}{m.company ? ` · ${m.company}` : ''}</small>{!m.active && <Badge tone="red" dot={false}>Account disabled</Badge>}</td>
      <td>{can ? <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={`Role of ${m.name}`}>{TEAM_ROLES.map((r) => <option key={r}>{r}</option>)}</select> : m.role}</td>
      <td>{can
        ? <select className="input" value={role === 'Contractor' ? scope : ''} disabled={role !== 'Contractor'} onChange={(e) => setScope(e.target.value)} aria-label={`Record access of ${m.name}`}><option value="">Whole project</option>{companies.map((c) => <option key={c} value={c}>Only {c}</option>)}</select>
        : m.scope ? `Only ${m.scope}` : 'Whole project'}</td>
      <td style={{ textAlign: 'right' }}>{can && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm pri" disabled={!dirty} onClick={save}>Save</button><button className="btn sm" onClick={remove}>Remove</button></div>}</td>
    </tr>
  )
}

function ProjectTeam() {
  const { members, role, profile, setMember, toast } = useStore()
  const { companies } = useRegisters()
  const can = role === 'Owner / QA' && profile.status === 'Active'
  const [dir, setDir] = useState<{ id: string; name: string; email: string; company: string | null }[] | null>(null)
  const [f, setF] = useState<{ userId: string; role: Role; scope: string }>({ userId: '', role: 'Contractor', scope: '' })
  const openAdd = async () => {
    try { setDir((await api<{ users: NonNullable<typeof dir> }>('GET', '/directory/users')).users) } catch (e) { toast(errorText(e), 'warn') }
  }
  const add = async () => {
    const er = await setMember(f.userId, f.role, f.role === 'Contractor' && f.scope ? f.scope : null)
    toast(er ?? 'Team member added', er ? 'warn' : 'ok')
    if (!er) setF({ userId: '', role: 'Contractor', scope: '' })
  }
  const candidates = (dir ?? []).filter((u) => !members.some((m) => m.userId === u.id))
  const names = companies.map((c) => c.name)
  return (
    <section className="card flush" style={{ marginBottom: 14 }}>
      <h2>Project team <span className="muted small" style={{ fontWeight: 400 }}>{members.length} member{members.length === 1 ? '' : 's'} · one role per person</span>{can && dir === null && <button className="btn sm" onClick={openAdd}><Plus size={12} /> Add person</button>}</h2>
      {can && dir !== null && (
        <div className="row wrap" style={{ padding: '0 16px 12px' }}>
          <select className="input" style={{ maxWidth: 340 }} value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} aria-label="Person to add"><option value="">Choose a person…</option>{candidates.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}{u.company ? ` · ${u.company}` : ''}</option>)}</select>
          <select className="input" style={{ maxWidth: 160 }} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role, scope: '' })} aria-label="Role for new member">{TEAM_ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <select className="input" style={{ maxWidth: 200 }} value={f.scope} disabled={f.role !== 'Contractor'} onChange={(e) => setF({ ...f, scope: e.target.value })} aria-label="Record access for new member"><option value="">Whole project</option>{names.map((c) => <option key={c} value={c}>Only {c}</option>)}</select>
          <button className="btn pri" disabled={!f.userId} onClick={add}>Add to team</button>
          <button className="btn" onClick={() => setDir(null)}>Close</button>
          <span className="muted small">Not listed? An administrator creates the account under Users &amp; access.</span>
        </div>
      )}
      <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}><table>
        <thead><tr><th>Person</th><th>Role</th><th>Record access</th><th /></tr></thead>
        <tbody>{members.map((m) => <MemberRow key={`${m.userId}:${m.role}:${m.scope}`} m={m} can={can} companies={names} />)}</tbody>
      </table></div>
    </section>
  )
}

/* ----------------------------------------------------------------- team / RACI */
export function Team() {
  const { allDisciplines } = useRegisters()
  const { docs, reqs, markets: sel } = useStore()
  return (
    <>
      <PageHead title="Team & responsibilities" sub="The project team and who prepares, reviews and approves each discipline. Owner / QA manages the team; every change is audited." />
      <ProjectTeam />
      <div className="tablewrap"><table>
        <thead><tr><th>Discipline</th><th>Prepares (responsible companies)</th><th>Reviews</th><th>Approves</th><th>Records</th><th>Accepted</th><th>Overdue</th><th>Requirements</th></tr></thead>
        <tbody>
          {allDisciplines.map((d) => {
            const ds = activeDocs(docs).filter((x) => x.discipline === d)
            const rs = reqs.filter((r) => r.discipline === d && sel.includes(r.market))
            const co = [...new Set(ds.map((x) => x.owner))]
            const over = ds.filter((x) => x.status !== 'Accepted' && x.due < TODAY).length
            return (
              <tr key={d}>
                <td><b>{d}</b></td>
                <td>{co.length ? co.map((c) => <Badge key={c} tone="blue" dot={false}>{c}</Badge>) : <span className="muted">Unassigned</span>}</td>
                <td>Consultant</td><td>Owner / QA</td>
                <td>{ds.length}</td><td>{ds.filter((x) => x.status === 'Accepted').length}</td>
                <td>{over ? <Badge tone="red">{over}</Badge> : <span className="muted">0</span>}</td>
                <td>{rs.length}</td>
              </tr>
            )
          })}
        </tbody>
      </table></div>
      <p className="muted small" style={{ marginTop: 10 }}>Review and approval follow the project roles assigned in Users &amp; access. A person can hold only one role per project, which keeps preparation, review and approval separate.</p>
    </>
  )
}
