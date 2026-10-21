import { markets } from '../data/reference'
import { coverage, evidenceState, handoverGates, isOverdue, TODAY, useRegisters, useStore } from '../store'
import { ballInCourt } from '../work'
import type { Holder } from '../work'
import { Applic, Badge, DocBadge, MarketChip, PageHead, Stat, StateBadge, fmtDate, go, useUI } from '../components/ui'

export default function Overview() {
  const { allDisciplines } = useRegisters()
  const s = useStore()
  const { docs, reqs, markets: sel, audit, role, baseline, profile } = s
  const open = useUI((u) => u.open)
  const scoped = reqs.filter((r) => sel.includes(r.market))
  const c = coverage(scoped, docs)
  const overdue = docs.filter(isOverdue)
  const queue = docs.filter((d) => (role === 'Contractor' ? ['Missing', 'Draft', 'Changes requested'].includes(d.status) : d.status === 'Under review' && (d.signStage === 0 ? 'Consultant' : 'Owner / QA') === role))
  const gates = handoverGates(s)
  const balls = ballInCourt(s)
  const holders: Holder[] = ['Contractor', 'Consultant', 'Owner / QA']

  return (
    <>
      <PageHead title={profile.name} sub={`${profile.client} · ${profile.site} · ${profile.facility} · ${profile.scope} · ${profile.phase}`} actions={<><Badge tone="blue">Baseline B{baseline}</Badge><button className="btn" onClick={() => go('handover')}>Handover readiness</button><button className="btn pri" onClick={() => go('inspector')}>Inspector Mode</button></>} />

      <div className="grid g4">
        <Stat label="Evidence accepted" value={c.pct === null ? 'N/A' : `${c.accepted.length}/${c.required.length}`} sub="Required topics with accepted, current evidence" />
        <Stat label="Applicability pending" value={c.pending.length} sub="Reviewer decision outstanding" />
        <Stat label="Open evidence gaps" value={c.gaps.length} sub="Required topics not yet evidenced" warn={c.gaps.length > 0} />
        <Stat label="Overdue records" value={overdue.length} sub={`As of ${TODAY}`} warn={overdue.length > 0} />
      </div>

      <div className="grid g21 mt">
        <section className="card flush">
          <h2>Evidence by market and discipline <span className="muted small" style={{ fontWeight: 400 }}>accepted / required</span></h2>
          <div className="tablewrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Discipline</th>{sel.map((m) => <th key={m}>{markets[m].short}</th>)}</tr></thead>
              <tbody>
                {allDisciplines.map((d) => (
                  <tr key={d}>
                    <td>{d}</td>
                    {sel.map((m) => {
                      const a = reqs.filter((r) => r.market === m && r.discipline === d && r.applicability === 'Required')
                      const b = a.filter((r) => evidenceState(r, docs) === 'Evidence accepted')
                      return <td key={m}>{a.length ? <span className="row" style={{ gap: 8 }}><span style={{ width: 52 }} className="bar"><i style={{ width: `${(100 * b.length) / a.length}%` }} /></span><span className="small">{b.length}/{a.length}</span></span> : <span className="muted">—</span>}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <h2>Handover gates <button className="link small" onClick={() => go('handover')}>Open</button></h2>
          {gates.map((g) => (
            <div key={g.key} className="row sb" style={{ padding: '5px 0' }}><span className="small">{g.label}</span>{g.n === 0 ? <Badge tone="green">Clear</Badge> : <Badge tone="amber">{g.n} open</Badge>}</div>
          ))}
          <p className="muted small" style={{ marginTop: 8 }}>Document gates only. Not a certification or release decision.</p>
        </section>
      </div>

      <div className="grid g2 mt">
        <section className="card flush">
          <h2>Awaiting action: {role}</h2>
          <div className="tablewrap" style={{ border: 0 }}>
            <table><tbody>
              {queue.slice(0, 6).map((d) => <tr key={d.id}><td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button><small>{d.id} · {d.owner} · due {d.due}</small></td><td style={{ textAlign: 'right' }}><DocBadge s={d.status} /></td></tr>)}
              {!queue.length && <tr><td className="muted">Nothing is waiting for this role.</td></tr>}
            </tbody></table>
          </div>
        </section>
        <section className="card flush">
          <h2>Critical evidence gaps</h2>
          <div className="tablewrap" style={{ border: 0 }}>
            <table><tbody>
              {c.gaps.filter((r) => r.critical).slice(0, 6).map((r) => <tr key={r.id}><td><button className="link" onClick={() => open('req', r.id)}>{r.title}</button><small><MarketChip m={r.market} /> {r.id} · {r.system}</small></td><td style={{ textAlign: 'right' }}><Applic a={r.applicability} /> <StateBadge s={evidenceState(r, docs)} /></td></tr>)}
              {!c.gaps.some((r) => r.critical) && <tr><td className="muted">No critical gaps.</td></tr>}
            </tbody></table>
          </div>
        </section>
      </div>

      <section className="card flush mt">
        <h2>Ball in court <span className="muted small" style={{ fontWeight: 400 }}>who is holding up each open item right now</span></h2>
        <div className="grid g3" style={{ padding: 16 }}>
          {holders.map((h) => {
            const mine = balls.filter((b) => b.holder === h)
            const late = mine.filter((b) => b.due && b.due < TODAY).length
            return (
              <div key={h}>
                <div className="row sb"><b>{h}</b><span className="row" style={{ gap: 6 }}><Badge tone={mine.length ? 'blue' : 'green'}>{mine.length} open</Badge>{late > 0 && <Badge tone="red">{late} overdue</Badge>}</span></div>
                <div className="bar" style={{ margin: '8px 0' }}><i style={{ width: `${balls.length ? (100 * mine.length) / balls.length : 0}%` }} /></div>
                <div className="list small">
                  {[...mine].sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9')).slice(0, 4).map((b) => <div key={b.ref}><button className="link" onClick={() => go(b.page)}>{b.title}</button><div className="muted">{b.kind} · {b.ref}{b.due ? ` · due ${b.due}` : ''}</div></div>)}
                  {!mine.length && <span className="muted">Nothing waiting.</span>}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card flush mt">
        <h2>Recent activity <button className="link small" onClick={() => go('packages')}>Audit packages</button></h2>
        <div className="tablewrap" style={{ border: 0 }}><table><tbody>{audit.slice(0, 6).map((a, i) => <tr key={i}><td>{a.text}</td><td className="muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{a.role} · {fmtDate(a.at)}</td></tr>)}</tbody></table></div>
      </section>
    </>
  )
}
