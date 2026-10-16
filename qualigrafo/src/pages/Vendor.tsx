import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { markets } from '../data/seed'
import { TODAY, evidenceState, isOverdue, useStore } from '../store'
import type { EvidenceState, MarketKey } from '../types'
import { Applic, Badge, DocBadge, Empty, MarketChip, PageHead, R, Stat, go, useUI } from '../components/ui'

/* ------------------------------------------------------------ vendor portal */
export function Vendor() {
  const { docs, ncrs, actions, rfis, role, submitDoc, toast, setRole } = useStore()
  const open = useUI((s) => s.open)
  const companies = [...new Set(docs.map((d) => d.owner))].sort()
  const [co, setCo] = useState(companies[0])
  const [note, setNote] = useState<Record<string, string>>({})
  const mine = docs.filter((d) => d.owner === co)
  const systems = new Set(mine.map((d) => d.system))
  const myNcrs = ncrs.filter((n) => systems.has(n.system) && n.status !== 'Closed')
  const myActions = actions.filter((a) => a.owner.includes(co) && a.status !== 'Closed')
  const myRfis = rfis.filter((r) => systems.has(r.system) && r.status !== 'Closed')
  const todo = mine.filter((d) => ['Missing', 'Draft', 'Changes requested'].includes(d.status))
  return (
    <>
      <PageHead title="Vendor portal view" sub="What a contractor or vendor sees: only its own deliverables and the items waiting on it. In this prototype it is a filter; production enforces the scope on the server." actions={<select className="input" style={{ width: 200 }} value={co} onChange={(e) => setCo(e.target.value)} aria-label="Company">{companies.map((c) => <option key={c}>{c}</option>)}</select>} />
      {role !== 'Contractor' && <div className="notice info" style={{ marginBottom: 14 }}>You are previewing as {role}. Submissions are made by the contractor role. <button className="link" onClick={() => setRole('Contractor')}>Switch to Contractor</button></div>}
      <div className="grid g4">
        <Stat label="To submit" value={todo.length} sub="Missing, draft or returned" warn={todo.some(isOverdue)} />
        <Stat label="Under review" value={mine.filter((d) => d.status === 'Under review').length} sub="With consultant or Owner / QA" />
        <Stat label="Accepted" value={mine.filter((d) => d.status === 'Accepted').length} sub={`of ${mine.length} deliverables`} />
        <Stat label="Items waiting on you" value={myNcrs.length + myActions.length + myRfis.length} sub={`${myNcrs.length} NCR · ${myActions.length} action · ${myRfis.length} RFI`} warn={myNcrs.length > 0} />
      </div>
      <section className="card flush mt">
        <h2>{co}: deliverables</h2>
        <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}><table>
          <thead><tr><th>Deliverable</th><th>System</th><th>Rev</th><th>Due</th><th>Status</th><th style={{ width: '30%' }}>Action</th></tr></thead>
          <tbody>
            {mine.map((d) => {
              const can = ['Missing', 'Draft', 'Changes requested'].includes(d.status)
              return (
                <tr key={d.id}>
                  <td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button><small>{d.id}</small></td>
                  <td>{d.system}</td><td><span className="rev">{R(d.rev)}</span></td>
                  <td>{d.due} {isOverdue(d) && <Badge tone="red">Overdue</Badge>}</td>
                  <td><DocBadge s={d.status} />{d.status === 'Changes requested' && <small>{d.history[d.history.length - 1]?.note ?? 'See review comments'}</small>}</td>
                  <td>{can ? <div className="row"><input className="input" placeholder="Submission note" value={note[d.id] ?? ''} onChange={(e) => setNote({ ...note, [d.id]: e.target.value })} /><button className="btn sm pri" onClick={() => { const er = submitDoc(d.id, note[d.id] ?? ''); toast(er ?? `${d.id} submitted: routed to Consultant`, er ? 'warn' : 'ok') }}>Submit</button></div> : d.status === 'Under review' ? <span className="muted small">Awaiting {d.signStage === 0 ? 'Consultant' : 'Owner / QA'}</span> : <span className="muted small">Accepted</span>}</td>
                </tr>
              )
            })}
            {!mine.length && <tr><td colSpan={6}><Empty title="No deliverables assigned" /></td></tr>}
          </tbody>
        </table></div>
      </section>
      <div className="grid g3 mt">
        <section className="card flush"><h2>Open NCRs</h2><div style={{ padding: '0 16px 12px' }} className="list">{myNcrs.map((n) => <div key={n.id}><button className="link" onClick={() => go('ncrs')}>{n.id} · {n.title}</button><div className="muted small">{n.severity} · {n.status} · due {n.due}</div></div>)}{!myNcrs.length && <p className="muted small">None.</p>}</div></section>
        <section className="card flush"><h2>Corrective actions</h2><div style={{ padding: '0 16px 12px' }} className="list">{myActions.map((a) => <div key={a.id}><button className="link" onClick={() => go('actions')}>{a.title}</button><div className="muted small">{a.id} · {a.status} · due {a.due}</div></div>)}{!myActions.length && <p className="muted small">None.</p>}</div></section>
        <section className="card flush"><h2>RFIs on your systems</h2><div style={{ padding: '0 16px 12px' }} className="list">{myRfis.map((r) => <div key={r.id}><button className="link" onClick={() => go('rfis')}>{r.id} · {r.title}</button><div className="muted small">{r.status} · due {r.due}</div></div>)}{!myRfis.length && <p className="muted small">None.</p>}</div></section>
      </div>
    </>
  )
}

/* --------------------------------------------------------- audit rehearsal */
type Answer = 'Can answer now' | 'Needs review first' | 'Cannot answer yet' | 'Prepare rationale' | 'Excluded'
function answerOf(s: EvidenceState): Answer {
  if (s === 'Evidence accepted') return 'Can answer now'
  if (s === 'Under assessment' || s === 'Revision changed' || s === 'Correction required') return 'Needs review first'
  if (s === 'Evidence missing') return 'Cannot answer yet'
  if (s === 'Assessment pending') return 'Prepare rationale'
  return 'Excluded'
}
const ansTone: Record<Answer, string> = { 'Can answer now': 'green', 'Needs review first': 'amber', 'Cannot answer yet': 'red', 'Prepare rationale': 'violet', Excluded: '' }

export function Rehearsal() {
  const { reqs, docs, markets: sel, ncrs } = useStore()
  const open = useUI((s) => s.open)
  const [mk, setMk] = useState<MarketKey>(sel[0])
  const [only, setOnly] = useState<'all' | Answer>('all')
  const rows = useMemo(() => reqs.filter((r) => r.market === mk).map((r) => ({ r, st: evidenceState(r, docs) })).map((x) => ({ ...x, a: answerOf(x.st) })).sort((a, b) => Number(b.r.critical) - Number(a.r.critical)), [reqs, docs, mk])
  const count = (a: Answer) => rows.filter((x) => x.a === a).length
  const shown = rows.filter((x) => only === 'all' || x.a === only)
  const askable = rows.filter((x) => x.a !== 'Excluded' && x.a !== 'Prepare rationale').length
  const openNcr = ncrs.filter((n) => n.status !== 'Closed').length
  const csv = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const body = [['Question', 'Market', 'System', 'Critical', 'Answer today', 'Evidence state'], ...rows.map((x) => [`Show me the evidence for: ${x.r.title}`, mk, x.r.system, x.r.critical ? 'yes' : 'no', x.a, x.st])].map((r) => r.map(cell).join(',')).join('\r\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = `Qualigrafo_Audit_Rehearsal_${mk}.csv`; a.click()
  }
  return (
    <>
      <PageHead title="Audit rehearsal" sub="Walk through the questions an inspector would ask for one market and see, honestly, what you could answer today. A rehearsal aid, not a verdict." actions={<><button className="btn" onClick={csv}><Download size={14} /> Export sheet</button><button className="btn" onClick={() => window.print()}><Printer size={14} /> Print</button></>} />
      <div className="filters">
        <div className="seg">{sel.map((m) => <button key={m} className={mk === m ? 'on' : ''} onClick={() => setMk(m)}>{markets[m].name}</button>)}</div>
        <span className="muted small">{markets[mk].authority} · {rows.length} requirement(s) mapped</span>
      </div>
      {!rows.length ? <div className="card"><Empty title="No requirements mapped for this market">An inspector&apos;s question list cannot be prepared. Map reviewed requirements first; empty is never shown as 100%.</Empty></div> : (
        <>
          <div className="grid g4">
            <Stat label="Can answer now" value={count('Can answer now')} sub={`of ${askable} askable question(s)`} />
            <Stat label="Needs review first" value={count('Needs review first')} sub="Evidence linked, not yet fully accepted or stale" warn={count('Needs review first') > 0} />
            <Stat label="Cannot answer yet" value={count('Cannot answer yet')} sub="No evidence linked" warn={count('Cannot answer yet') > 0} />
            <Stat label="Prepare rationale" value={count('Prepare rationale')} sub={`Applicability undecided · ${openNcr} NCR(s) open`} />
          </div>
          <div className="filters mt"><div className="seg">{(['all', 'Cannot answer yet', 'Needs review first', 'Can answer now', 'Prepare rationale'] as const).map((a) => <button key={a} className={only === a ? 'on' : ''} onClick={() => setOnly(a)}>{a === 'all' ? 'All questions' : a}</button>)}</div></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Inspector asks</th><th>System</th><th>Applicability</th><th>Answer today</th><th>Why</th></tr></thead>
            <tbody>
              {shown.map(({ r, st, a }) => (
                <tr key={r.id}>
                  <td><button className="link" onClick={() => open('req', r.id)}>“Show me the evidence for: {r.title}”</button><small>{r.id}{r.critical ? ' · Critical' : ''}</small></td>
                  <td>{r.system}<small><MarketChip m={r.market} /></small></td>
                  <td><Applic a={r.applicability} /></td>
                  <td><Badge tone={ansTone[a]}>{a}</Badge></td>
                  <td className="small">{st === 'Evidence accepted' ? 'Linked revisions are current and accepted.' : st === 'Evidence missing' ? 'Nothing is linked, so the question gets no document.' : st === 'Revision changed' ? 'A linked document was revised after assessment.' : st === 'Correction required' ? 'A reviewer rejected the evidence.' : st === 'Under assessment' ? 'Evidence is linked but acceptance or sign-off is pending.' : st === 'Assessment pending' ? 'Decide applicability first, with a recorded rationale.' : 'Excluded with a recorded rationale.'}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={5}><Empty title="No questions in this view" /></td></tr>}
            </tbody>
          </table></div>
        </>
      )}
      <p className="muted small" style={{ marginTop: 10 }}>Demo date {TODAY}. This view derives from record state only. It does not predict an inspection outcome or certify compliance.</p>
    </>
  )
}
