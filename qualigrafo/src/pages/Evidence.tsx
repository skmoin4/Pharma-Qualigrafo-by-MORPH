import { useMemo, useState } from 'react'
import { AlertOctagon, CheckCircle2, Printer } from 'lucide-react'
import { markets } from '../data/reference'
import { evidenceState, useStore } from '../store'
import { Applic, Badge, Empty, MarketChip, PageHead, R, StateBadge, fmtDate, useUI } from '../components/ui'

const STROKE = { ok: '#1c7a4f', wait: '#cf9322', bad: '#cf5a4f' }

export function EvidenceMap() {
  const { reqs, docs, markets: sel } = useStore()
  const open = useUI((s) => s.open)
  const systems = useMemo(() => [...new Set(reqs.map((r) => r.system))], [reqs])
  const [sys, setSys] = useState(systems.includes('PW-001') ? 'PW-001' : systems[0])
  const [hover, setHover] = useState<string | null>(null)
  const rs = reqs.filter((r) => r.system === sys && sel.includes(r.market) && r.applicability !== 'Not applicable')
  const ds = [...new Set(rs.flatMap((r) => r.evidence.filter((e) => e.decision !== 'Withdrawn').map((e) => e.doc)))]
  const H = Math.max(rs.length, ds.length, 1) * 66 + 36
  const ry = (i: number, n: number) => 30 + (i + 0.5) * ((H - 36) / Math.max(n, 1))
  const edges = rs.flatMap((r, i) => r.evidence.filter((e) => e.decision !== 'Withdrawn').map((e) => {
    const d = docs.find((x) => x.id === e.doc)!
    const kind = d.rev !== e.rev || e.decision === 'Rejected' ? 'bad' : e.decision === 'Accepted' && d.status === 'Accepted' ? 'ok' : 'wait'
    return { r: r.id, d: e.doc, y1: ry(i, rs.length), y2: ry(ds.indexOf(e.doc), ds.length), kind }
  }))
  const lit = (rid: string, did: string) => !hover || hover === rid || hover === did

  return (
    <>
      <PageHead title="Evidence map" sub="Which exact document revision supports which requirement. A revised document turns its links red until they are reassessed." />
      <div className="filters">
        <div className="seg">{systems.map((s) => <button key={s} className={s === sys ? 'on' : ''} onClick={() => setSys(s)}>{s}</button>)}</div>
        <span className="row small muted" style={{ marginLeft: 'auto', gap: 14 }}>
          <span><b style={{ color: STROKE.ok }}>━</b> accepted</span><span><b style={{ color: STROKE.wait }}>━</b> pending</span><span><b style={{ color: STROKE.bad }}>━</b> stale or rejected</span>
        </span>
      </div>
      <div className="card flush" style={{ overflow: 'auto' }}>
        {!rs.length ? <Empty title="No applicable requirements for this system in the selected markets" /> : (
          <svg viewBox={`0 0 1000 ${H}`} style={{ width: '100%', minWidth: 760, display: 'block' }} role="img" aria-label="Requirement to evidence graph">
            <text x="30" y="20" fontSize="10.5" fontWeight="700" fill="#6c808c" letterSpacing="1">REQUIREMENTS</text>
            <text x="640" y="20" fontSize="10.5" fontWeight="700" fill="#6c808c" letterSpacing="1">DOCUMENT REVISIONS</text>
            {edges.map((e, i) => <path key={i} d={`M 380 ${e.y1} C 500 ${e.y1}, 520 ${e.y2}, 640 ${e.y2}`} fill="none" stroke={STROKE[e.kind as keyof typeof STROKE]} strokeWidth={lit(e.r, e.d) ? 2.5 : 1} opacity={lit(e.r, e.d) ? 1 : 0.2} />)}
            {rs.map((r, i) => {
              const y = ry(i, rs.length)
              const s = evidenceState(r, docs)
              const col = s === 'Evidence accepted' ? STROKE.ok : s === 'Assessment pending' ? '#5d45a3' : s === 'Under assessment' ? STROKE.wait : STROKE.bad
              return (
                <g key={r.id} onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)} onClick={() => open('req', r.id)} style={{ cursor: 'pointer', opacity: lit(r.id, '') || edges.some((e) => e.r === r.id && e.d === hover) ? 1 : 0.4 }}>
                  <rect x="30" y={y - 25} width="350" height="50" rx="5" fill="#fff" stroke="#c5d2d9" />
                  <rect x="30" y={y - 25} width="5" height="50" fill={col} />
                  <text x="48" y={y - 4} fontSize="12.5" fontWeight="650" fill="#15262f">{r.title.length > 42 ? r.title.slice(0, 41) + '…' : r.title}</text>
                  <text x="48" y={y + 14} fontSize="11" fill="#6c808c">{r.id} · {r.market} · {s}</text>
                </g>
              )
            })}
            {ds.map((id, j) => {
              const d = docs.find((x) => x.id === id)!
              const y = ry(j, ds.length)
              const linked = edges.some((e) => e.d === id && hover === e.r)
              return (
                <g key={id} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} onClick={() => open('doc', id)} style={{ cursor: 'pointer', opacity: !hover || hover === id || linked ? 1 : 0.4 }}>
                  <rect x="640" y={y - 25} width="330" height="50" rx="5" fill="#f6fafa" stroke="#9ec9ca" />
                  <text x="656" y={y - 4} fontSize="12.5" fontWeight="650" fill="#15262f">{d.title.length > 38 ? d.title.slice(0, 37) + '…' : d.title}</text>
                  <text x="656" y={y + 14} fontSize="11" fill="#6c808c">{d.id} · {R(d.rev)} · {d.status}</text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </>
  )
}

export function Inspector() {
  const { reqs, docs, markets: sel } = useStore()
  const open = useUI((s) => s.open)
  const list = reqs.filter((r) => sel.includes(r.market) && r.applicability !== 'Assessment pending')
  const [id, setId] = useState(list.find((r) => r.id === 'REQ-008')?.id ?? list[0]?.id)
  const r = list.find((x) => x.id === id) ?? list[0]
  if (!r) return <><PageHead title="Inspector view" sub="Evidence trail for a single requirement." /><Empty title="No assessed requirements yet" /></>
  const state = evidenceState(r, docs)
  const m = markets[r.market]

  return (
    <>
      <PageHead title="Inspector view" sub="“Show me the evidence for this requirement.” One traceable answer: source, applicability, exact revisions, sign-offs — and what is still missing." actions={<button className="btn" onClick={() => window.print()}><Printer size={14} /> Print trail</button>} />
      <div className="filters"><select className="input grow" value={r.id} onChange={(e) => setId(e.target.value)} aria-label="Requirement">{list.map((x) => <option key={x.id} value={x.id}>{x.market} · {x.id} · {x.title} ({x.system})</option>)}</select></div>
      <div className="grid g21">
        <section className="card">
          <div className="trail">
            <div className="node"><div className="nbox">
              <div className="row sb"><b>Requirement</b><StateBadge s={state} /></div>
              <div style={{ fontSize: 15, fontWeight: 650, margin: '6px 0 3px' }}>{r.title}</div>
              <div className="muted small"><MarketChip m={r.market} /> {r.id} · {r.system} · {r.discipline}</div>
            </div></div>
            <div className="node"><div className="nbox">
              <b>Source and applicability</b>
              <p className="small" style={{ margin: '5px 0' }}>{m.authority} — {m.base}</p>
              <p className="small muted">{r.topic}</p>
              <p className="small" style={{ marginTop: 6 }}><Applic a={r.applicability} /> {r.rationale}</p>
            </div></div>
            {r.evidence.filter((e) => e.decision !== 'Withdrawn').map((e, i) => {
              const d = docs.find((x) => x.id === e.doc)!
              const stale = d.rev !== e.rev
              const tone = stale || e.decision === 'Rejected' ? 'bad' : e.decision === 'Accepted' && d.status === 'Accepted' ? '' : 'warn'
              return (
                <div className={`node ${tone}`} key={i}><div className="nbox">
                  <div className="row sb"><span><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button> <span className="rev">{R(e.rev)}</span></span><Badge tone={e.decision === 'Accepted' ? 'green' : e.decision === 'Rejected' ? 'red' : 'amber'}>{e.decision}</Badge></div>
                  <p className="small muted" style={{ margin: '5px 0' }}>{e.note}</p>
                  {stale && <Badge tone="red">Document is now {R(d.rev)} — this link is stale</Badge>}
                  {e.reason && <p className="small">Assessed by {e.reviewedBy}: {e.reason}</p>}
                  <div className="small" style={{ marginTop: 6 }}>{d.signatures.length ? d.signatures.map((s, k) => <div key={k} className="muted">Sign-off: {s.role} · {s.name} · {fmtDate(s.at)} ({R(s.rev)})</div>) : <span className="muted">No sign-off recorded on this revision.</span>}</div>
                </div></div>
              )
            })}
            {!r.evidence.filter((e) => e.decision !== 'Withdrawn').length && <div className="node bad"><div className="nbox"><b><AlertOctagon size={14} color="#a93a33" style={{ verticalAlign: -2 }} /> No evidence linked</b><p className="small muted" style={{ marginTop: 4 }}>An inspector asking this today would receive no document. Assign a corrective action.</p></div></div>}
          </div>
        </section>
        <section className="card" style={{ alignSelf: 'start' }}>
          <h2>Evidence position</h2>
          <div className="row" style={{ marginBottom: 8 }}>{state === 'Evidence accepted' ? <CheckCircle2 size={18} color="#1c7a4f" /> : <AlertOctagon size={18} color="#a93a33" />}<b style={{ fontSize: 15 }}>{state}</b></div>
          <p className="muted" style={{ lineHeight: 1.6 }}>
            {state === 'Evidence accepted' && 'Every linked revision is current, signed off and assessed as fit for this requirement.'}
            {state === 'Evidence missing' && 'No document is linked. The question cannot currently be answered.'}
            {state === 'Under assessment' && 'Evidence is linked, but acceptance or document sign-off is still pending.'}
            {state === 'Revision changed' && 'A linked document was revised after assessment. Earlier acceptance applies only to the older revision.'}
            {state === 'Correction required' && 'A reviewer rejected the evidence. A corrective action should be open.'}
            {state === 'Not applicable' && 'Excluded by an applicability decision with recorded rationale.'}
          </p>
          <div className="notice mt">Evidence position only. This is not a regulatory finding, approval or certificate.</div>
        </section>
      </div>
    </>
  )
}
