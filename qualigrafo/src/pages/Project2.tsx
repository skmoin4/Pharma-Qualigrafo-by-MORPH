import { useState } from 'react'
import { Download } from 'lucide-react'
import { disciplines } from '../data/seed'
import { TODAY, useStore } from '../store'
import { Badge, DocBadge, Empty, PageHead, R, fmtDate, useUI } from '../components/ui'

/* ------------------------------------------------------------------ schedule */
const DAY = 86400000
const t = (s: string) => new Date(s + 'T00:00:00Z').getTime()

export function Schedule() {
  const { docs, rfis, actions } = useStore()
  const open = useUI((s) => s.open)
  const [disc, setDisc] = useState('all')
  const start = t('2026-10-05'), end = t('2026-11-09'), span = end - start
  const pos = (d: string) => Math.max(0, Math.min(100, ((t(d) - start) / span) * 100))
  const weeks = Array.from({ length: 6 }, (_, i) => start + i * 7 * DAY)
  const rows = docs.filter((d) => disc === 'all' || d.discipline === disc).sort((a, b) => a.due.localeCompare(b.due))
  const overdue = rows.filter((d) => d.status !== 'Accepted' && d.due < TODAY).length
  const next7 = rows.filter((d) => d.status !== 'Accepted' && d.due >= TODAY && t(d.due) - t(TODAY) <= 7 * DAY).length
  return (
    <>
      <PageHead title="Schedule" sub="Document due dates against the demo date. Accepted records drop off the critical list; overdue and due-soon items are called out." />
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <select className="input" style={{ width: 220 }} value={disc} onChange={(e) => setDisc(e.target.value)} aria-label="Discipline"><option value="all">All disciplines</option>{disciplines.map((d) => <option key={d}>{d}</option>)}</select>
        <Badge tone={overdue ? 'red' : 'green'}>{overdue} overdue</Badge><Badge tone={next7 ? 'amber' : ''}>{next7} due within 7 days</Badge>
        <span className="muted small">Demo date {TODAY} · RFIs ({rfis.filter((r) => r.status !== 'Closed').length} open) and actions ({actions.filter((a) => a.status !== 'Closed').length} open) shown as diamonds</span>
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
export function Audit() {
  const audit = useStore((s) => s.audit)
  const [q, setQ] = useState('')
  const [who, setWho] = useState('all')
  const rows = audit.filter((a) => (who === 'all' || a.role === who) && a.text.toLowerCase().includes(q.toLowerCase()))
  const csv = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const body = [['Time (UTC)', 'Role', 'Event'], ...rows.map((a) => [a.at, a.role, a.text])].map((r) => r.map(cell).join(',')).join('\r\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = 'Qualigrafo_Audit_Trail.csv'; a.click()
  }
  return (
    <>
      <PageHead title="Audit trail" sub="Every decision, sign-off, revision and import in this project, newest first." actions={<button className="btn" onClick={csv}><Download size={14} /> Export CSV</button>} />
      <div className="notice" style={{ marginBottom: 12 }}>Prototype log kept in this browser. It is <b>not</b> tamper-evident and not a regulated audit record. Production requires an append-only server-side store with actor identity, before/after references and request IDs.</div>
      <div className="filters">
        <input className="input grow" placeholder="Search events…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit trail" />
        <select className="input" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Role"><option value="all">All roles</option>{['Consultant', 'Contractor', 'Owner / QA'].map((r) => <option key={r}>{r}</option>)}</select>
        <span className="muted small">{rows.length} of {audit.length}</span>
      </div>
      <div className="tablewrap"><table><thead><tr><th>Time</th><th>Role</th><th>Event</th></tr></thead><tbody>
        {rows.map((a, i) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.at)}</td><td><Badge dot={false}>{a.role}</Badge></td><td>{a.text}</td></tr>)}
        {!rows.length && <tr><td colSpan={3}><Empty title="No matching events" /></td></tr>}
      </tbody></table></div>
    </>
  )
}

/* ------------------------------------------------------- templates & vendors */
export function Templates() {
  const { docs, generateDeliverables, role, toast } = useStore()
  const open = useUI((s) => s.open)
  const [f, setF] = useState({ tag: '', vendor: '', discipline: disciplines[1], due: '2026-11-02' })
  const [vendor, setVendor] = useState('all')
  const vendors = [...new Set(docs.map((d) => d.owner))]
  const list = docs.filter((d) => vendor === 'all' || d.owner === vendor)
  return (
    <>
      <PageHead title="Templates & vendors" sub="Generate a draft deliverable set for a new piece of equipment, and see each vendor's open scope. Nothing here fabricates executed evidence." />
      <div className="grid g2">
        <section className="card">
          <h2>Equipment documentation starter</h2>
          <div className="grid g2">
            <div><label className="lab" style={{ marginTop: 0 }}>Equipment / system tag</label><input className="input" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="e.g. RE-202" /></div>
            <div><label className="lab" style={{ marginTop: 0 }}>Assigned vendor</label><input className="input" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="Company name" /></div>
            <div><label className="lab">Discipline</label><select className="input" value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })}>{disciplines.map((d) => <option key={d}>{d}</option>)}</select></div>
            <div><label className="lab">Due date</label><input className="input" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div>
          </div>
          <p className="muted small" style={{ margin: '10px 0' }}>Creates three Draft records: vendor datasheet, approved-drawing submission and O&amp;M manual. They are not treated as required evidence until a reviewer links them to a requirement. No test result, certificate or signature is generated.</p>
          <button className="btn pri" disabled={role === 'Contractor'} onClick={() => { const er = generateDeliverables(f); toast(er ?? 'Three draft deliverables created', er ? 'warn' : 'ok'); if (!er) setF({ ...f, tag: '' }) }}>Generate 3 draft deliverables</button>
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

/* ----------------------------------------------------------------- team / RACI */
export function Team() {
  const { docs, reqs, markets: sel } = useStore()
  return (
    <>
      <PageHead title="Team & responsibilities" sub="Who prepares, reviews and approves each discipline. Companies come from the document register; review and approval follow the configured two-stage route." />
      <div className="tablewrap"><table>
        <thead><tr><th>Discipline</th><th>Prepares (responsible companies)</th><th>Reviews</th><th>Approves</th><th>Records</th><th>Accepted</th><th>Overdue</th><th>Requirements</th></tr></thead>
        <tbody>
          {disciplines.map((d) => {
            const ds = docs.filter((x) => x.discipline === d)
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
      <p className="muted small" style={{ marginTop: 10 }}>Named users, permissions and delegation need the backend. Review and approval authorities are role-based in this prototype; production assigns specific people per discipline and enforces segregation of duties.</p>
    </>
  )
}
