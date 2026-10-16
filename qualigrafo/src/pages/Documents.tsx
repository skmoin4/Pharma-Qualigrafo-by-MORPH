import { useState } from 'react'
import { disciplines } from '../data/seed'
import { isOverdue, useStore } from '../store'
import { Badge, DocBadge, Empty, PageHead, R, fmtDate, useUI } from '../components/ui'

export function Documents() {
  const docs = useStore((s) => s.docs)
  const open = useUI((s) => s.open)
  const [q, setQ] = useState('')
  const [dsc, setDsc] = useState('all')
  const [st, setSt] = useState('all')
  const rows = docs.filter((d) => (dsc === 'all' || d.discipline === dsc) && (st === 'all' || d.status === st) && `${d.id} ${d.title} ${d.system} ${d.owner}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHead title="Document register" sub="Controlled engineering records across eight disciplines, each with an owner, revision, system link and review state." />
      <div className="filters">
        <input className="input grow" placeholder="Search by title, system or company…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
        <select className="input" value={dsc} onChange={(e) => setDsc(e.target.value)} aria-label="Discipline"><option value="all">All disciplines</option>{disciplines.map((x) => <option key={x}>{x}</option>)}</select>
        <select className="input" value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status"><option value="all">All statuses</option>{['Missing', 'Draft', 'Under review', 'Changes requested', 'Accepted'].map((x) => <option key={x}>{x}</option>)}</select>
        <span className="muted small">{rows.length} of {docs.length}</span>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Document</th><th>Discipline</th><th>System</th><th>Rev</th><th>Responsible</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button><small>{d.id}{d.critical ? ' · Critical' : ''}</small></td>
                <td>{d.discipline}</td><td>{d.system}</td><td><span className="rev">{R(d.rev)}</span></td><td>{d.owner}</td>
                <td>{d.due} {isOverdue(d) && <Badge tone="red">Overdue</Badge>}</td>
                <td><DocBadge s={d.status} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7}><Empty title="No documents match" /></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function Reviews() {
  const { docs, role, issued } = useStore()
  const open = useUI((s) => s.open)
  const exportManifest = (id: string) => {
    const i = issued.find((x) => x.id === id)!
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ prototype: true, warning: 'Metadata manifest only. No cryptographic signature, identity verification or signed file.', ...i }, null, 2)], { type: 'application/json' }))
    a.download = `Qualigrafo_${i.id}_${i.doc}_R${i.rev}_PROTOTYPE.json`
    a.click()
  }
  const queue = docs.filter((d) => d.status === 'Under review')
  const returned = docs.filter((d) => d.status === 'Changes requested')
  const done = docs.filter((d) => d.signatures.length && d.status === 'Accepted')
  return (
    <>
      <PageHead title="Reviews & approvals" sub="Two-stage review: Consultant, then Owner / QA. Each sign-off is bound to one revision. A deadline never approves a document." />
      <div className="notice" style={{ marginBottom: 14 }}>Prototype sign-offs record a name, reason and confirmation only. They are <b>not</b> valid electronic signatures. Production derives identity from verified authentication and binds each signature to the revision checksum.</div>
      <div className="grid g2">
        <section className="card flush">
          <h2>Awaiting sign-off</h2>
          <div className="tablewrap" style={{ border: 0 }}><table><tbody>
            {queue.map((d) => {
              const exp = d.signStage === 0 ? 'Consultant' : 'Owner / QA'
              return <tr key={d.id}><td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button> <span className="rev">{R(d.rev)}</span><small>{d.id} · {d.owner}</small></td><td style={{ textAlign: 'right' }}><Badge tone={exp === role ? 'teal' : 'amber'}>{exp === role ? 'Your turn' : `Waiting: ${exp}`}</Badge><small>Stage {d.signStage + 1} of 2</small></td><td style={{ minWidth: 300 }}><div className="steps nw">{['Submitted', 'Consultant', 'Owner / QA', 'Issue'].map((x, k) => <span key={x} className={`step ${k < 1 + d.signStage ? 'on' : k === 1 + d.signStage ? 'cur' : ''}`}>{x}{k < 1 + d.signStage ? ' ✓' : ''}</span>)}</div></td></tr>
            })}
            {!queue.length && <tr><td><Empty title="Nothing awaiting sign-off">As Contractor, submit a draft from the document register.</Empty></td></tr>}
          </tbody></table></div>
        </section>
        <div className="grid">
          <section className="card flush">
            <h2>Returned for changes</h2>
            <div className="tablewrap" style={{ border: 0 }}><table><tbody>{returned.map((d) => <tr key={d.id}><td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button><small>{d.id}{d.history[d.history.length - 1]?.note ? ` · ${d.history[d.history.length - 1].note}` : ' · awaiting resubmission by contractor'}</small></td><td style={{ textAlign: 'right' }}><DocBadge s={d.status} /></td></tr>)}{!returned.length && <tr><td className="muted">None.</td></tr>}</tbody></table></div>
          </section>
          <section className="card flush">
            <h2>Accepted revisions</h2>
            <div className="tablewrap" style={{ border: 0 }}><table><tbody>{done.map((d) => <tr key={d.id}><td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button> <span className="rev">{R(d.rev)}</span></td><td style={{ textAlign: 'right' }}><Badge tone="green">{d.signatures.length} sign-offs</Badge></td></tr>)}</tbody></table></div>
          </section>
        </div>
      </div>
      <section className="card flush mt">
        <h2>Controlled issue <span className="muted small" style={{ fontWeight: 400 }}>generated automatically after the final sign-off · metadata only</span></h2>
        <div className="tablewrap" style={{ border: 0 }}><table><tbody>
          {issued.map((i) => <tr key={i.id}><td><b>{i.id}</b><small>{i.doc}</small></td><td><button className="link" onClick={() => open('doc', i.doc)}>{i.title}</button> <span className="rev">{R(i.rev)}</span></td><td>{i.signers.map((x) => x.role).join(' → ')}<small>{fmtDate(i.at)}</small></td><td style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => exportManifest(i.id)}>Manifest JSON</button></td></tr>)}
          {!issued.length && <tr><td><Empty title="Nothing issued yet">A manifest appears once both stages sign the same revision.</Empty></td></tr>}
        </tbody></table></div>
      </section>
    </>
  )
}
