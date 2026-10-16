import { useState } from 'react'
import { disciplines } from '../data/seed'
import { useStore } from '../store'
import { Badge, Empty, PageHead, R, useUI } from '../components/ui'

function useAct() {
  const toast = useStore((s) => s.toast)
  return (err: string | null, ok: string) => (err ? toast(err, 'warn') : toast(ok))
}

export function Rfis() {
  const { rfis, raiseRfi, answerRfi, closeRfi, role, docs } = useStore()
  const act = useAct()
  const [form, setForm] = useState(false)
  const [f, setF] = useState({ title: '', discipline: disciplines[0], system: '', due: '2026-10-24' })
  const [ans, setAns] = useState<Record<string, string>>({})
  const tone = (s: string) => (s === 'Closed' ? 'green' : s === 'Answered' ? 'blue' : 'amber')
  void docs
  return (
    <>
      <PageHead title="RFIs" sub="Technical questions linked to a discipline and system. A response is not closure: the requester or a reviewer closes the loop." actions={<button className="btn pri" onClick={() => setForm(!form)}>Raise RFI</button>} />
      {form && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>New RFI</h2>
          <textarea className="input" placeholder="Question — include drawing / revision reference" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <div className="grid g3" style={{ marginTop: 8 }}>
            <select className="input" value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })}>{disciplines.map((d) => <option key={d}>{d}</option>)}</select>
            <input className="input" placeholder="System / asset, e.g. PW-001" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })} />
            <input className="input" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
          </div>
          <button className="btn pri" style={{ marginTop: 10 }} onClick={() => { const er = raiseRfi(f); act(er, 'RFI raised'); if (!er) { setForm(false); setF({ ...f, title: '', system: '' }) } }}>Submit RFI</button>
        </section>
      )}
      <div className="tablewrap">
        <table>
          <thead><tr><th>RFI</th><th>Discipline / system</th><th>Raised by</th><th>Due</th><th>Status</th><th style={{ width: '34%' }}>Response</th></tr></thead>
          <tbody>
            {rfis.map((r) => (
              <tr key={r.id}>
                <td><b>{r.title}</b><small>{r.id}</small></td>
                <td>{r.discipline}<small>{r.system}</small></td>
                <td>{r.raisedBy}</td><td>{r.due}</td>
                <td><Badge tone={tone(r.status)}>{r.status}</Badge></td>
                <td>
                  {r.response && <p style={{ marginBottom: 6 }}>{r.response}</p>}
                  {r.status === 'Awaiting response' && role !== 'Contractor' && (<><textarea className="input" style={{ minHeight: 52 }} placeholder="Response…" value={ans[r.id] ?? ''} onChange={(e) => setAns({ ...ans, [r.id]: e.target.value })} /><button className="btn sm pri" style={{ marginTop: 6 }} onClick={() => act(answerRfi(r.id, ans[r.id] ?? ''), 'Response recorded')}>Record response</button></>)}
                  {r.status === 'Awaiting response' && role === 'Contractor' && <span className="muted">Awaiting consultant response</span>}
                  {r.status === 'Answered' && <button className="btn sm" onClick={() => act(closeRfi(r.id), 'RFI closed')}>Acknowledge &amp; close</button>}
                </td>
              </tr>
            ))}
            {!rfis.length && <tr><td colSpan={6}><Empty title="No RFIs raised">Raise a question when a drawing or specification needs clarification.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function Inspections() {
  const { inspections, requestInspection, submitInspection, decideInspection, role } = useStore()
  const act = useAct()
  const [form, setForm] = useState(false)
  const [f, setF] = useState({ title: '', system: '' })
  const [txt, setTxt] = useState<Record<string, string>>({})
  const tone = (s: string) => (s === 'Accepted' ? 'green' : s === 'Correction required' ? 'red' : s === 'Submitted' ? 'amber' : 'blue')
  return (
    <>
      <PageHead title="Inspections" sub="Installation inspections with the drawing revision, checklist and site evidence referenced. Sample references are never treated as executed evidence." actions={<button className="btn pri" onClick={() => setForm(!form)}>Request inspection</button>} />
      {form && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Request inspection</h2>
          <div className="grid g2"><input className="input" placeholder="Inspection title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /><input className="input" placeholder="System / asset" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })} /></div>
          <button className="btn pri" style={{ marginTop: 10 }} onClick={() => { const er = requestInspection(f); act(er, 'Inspection requested'); if (!er) { setForm(false); setF({ title: '', system: '' }) } }}>Submit request</button>
        </section>
      )}
      <div className="tablewrap">
        <table>
          <thead><tr><th>Inspection</th><th>System</th><th>Drawing revision</th><th>Evidence reference</th><th>Status</th><th style={{ width: '28%' }}>Action</th></tr></thead>
          <tbody>
            {inspections.map((i) => (
              <tr key={i.id}>
                <td><b>{i.title}</b><small>{i.id}</small></td><td>{i.system}</td><td>{i.drawingRev}</td><td>{i.evidence}{i.decision && <small>Decision: {i.decision}</small>}</td>
                <td><Badge tone={tone(i.status)}>{i.status}</Badge></td>
                <td>
                  {(i.status === 'Requested' || i.status === 'Correction required') && (role === 'Contractor' ? (<><textarea className="input" style={{ minHeight: 52 }} placeholder="Checklist and site evidence references…" value={txt[i.id] ?? ''} onChange={(e) => setTxt({ ...txt, [i.id]: e.target.value })} /><button className="btn sm pri" style={{ marginTop: 6 }} onClick={() => act(submitInspection(i.id, txt[i.id] ?? ''), 'Inspection evidence submitted')}>Submit evidence</button></>) : <span className="muted">Awaiting contractor evidence</span>)}
                  {i.status === 'Submitted' && (role !== 'Contractor' ? (<><textarea className="input" style={{ minHeight: 52 }} placeholder="Decision reason…" value={txt[i.id] ?? ''} onChange={(e) => setTxt({ ...txt, [i.id]: e.target.value })} /><div className="row" style={{ marginTop: 6 }}><button className="btn sm pri" onClick={() => act(decideInspection(i.id, true, txt[i.id] ?? ''), 'Inspection accepted')}>Accept</button><button className="btn sm" onClick={() => act(decideInspection(i.id, false, txt[i.id] ?? ''), 'Correction requested')}>Request correction</button></div></>) : <span className="muted">Awaiting reviewer decision</span>)}
                </td>
              </tr>
            ))}
            {!inspections.length && <tr><td colSpan={6}><Empty title="No inspections requested" /></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function Findings() {
  const { findings, disposeFinding, role } = useStore()
  const open = useUI((s) => s.open)
  const act = useAct()
  const [txt, setTxt] = useState<Record<string, string>>({})
  return (
    <>
      <PageHead title="Consistency findings" sub="Rule-based checks with the source values shown. A finding is a prompt for review — not a verdict. Every disposition needs a recorded rationale." />
      <div className="notice" style={{ marginBottom: 14 }}>These are seeded examples, not analysis of uploaded files. A production check stores the rule version, source revision, file checksum, compared values and conditions; an unreadable source is “unknown”, never a pass.</div>
      {findings.map((f) => (
        <section className="card" key={f.id} style={{ marginBottom: 12 }}>
          <div className="row sb"><h2 style={{ margin: 0 }}>{f.id} · {f.title}</h2><div className="row"><Badge tone={f.severity === 'High' ? 'red' : 'amber'}>{f.severity}</Badge><Badge tone={f.status === 'Open' ? 'red' : 'green'}>{f.status}</Badge></div></div>
          <div className="kv"><div><small>Source values</small>{f.source}</div><div><small>Rule</small>{f.rule}</div></div>
          <div className="row wrap"><button className="btn sm" onClick={() => open('doc', f.doc)}>Open linked record {f.doc}</button></div>
          {f.status === 'Open' ? (role !== 'Contractor' ? (<><textarea className="input" style={{ marginTop: 10 }} placeholder="Disposition rationale…" value={txt[f.id] ?? ''} onChange={(e) => setTxt({ ...txt, [f.id]: e.target.value })} /><div className="row" style={{ marginTop: 8 }}><button className="btn pri sm" onClick={() => act(disposeFinding(f.id, 'Resolved', txt[f.id] ?? ''), 'Finding resolved')}>Resolve</button><button className="btn sm" onClick={() => act(disposeFinding(f.id, 'Accepted exception', txt[f.id] ?? ''), 'Exception recorded')}>Accept as exception</button></div></>) : <p className="muted small" style={{ marginTop: 8 }}>A reviewer must disposition this finding.</p>) : <p className="small" style={{ marginTop: 10 }}><b>Disposition:</b> {f.disposition}</p>}
        </section>
      ))}
      {!findings.length && <div className="card"><Empty title="No findings">No consistency checks have flagged an issue for this project.</Empty></div>}
    </>
  )
}

export function Changes() {
  const { changes, docs, reqs, assessChangeItem, decideChange, addChange, role } = useStore()
  const open = useUI((s) => s.open)
  const act = useAct()
  const [form, setForm] = useState(false)
  const [f, setF] = useState({ title: '', system: 'PW-001' })
  const [txt, setTxt] = useState<Record<string, string>>({})
  const systems = [...new Set(docs.map((d) => d.system))]
  const propose = () => {
    const ds = docs.filter((d) => d.system === f.system).map((d) => d.id)
    const rs = reqs.filter((r) => r.system === f.system).map((r) => r.id)
    const er = addChange({ title: f.title, system: f.system, docs: ds, reqs: rs })
    act(er, 'Change proposed — linked records need impact assessment')
    if (!er) { setForm(false); setF({ ...f, title: '' }) }
  }
  return (
    <>
      <PageHead title="Change impact" sub="Trace a proposed change across documents and requirements. Links are explicit; nothing is inferred. Each affected record is assessed by a person before authorisation." actions={<button className="btn pri" onClick={() => setForm(!form)}>Propose change</button>} />
      {form && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Propose change</h2>
          <div className="grid g2"><input className="input" placeholder="Describe the change" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /><select className="input" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })}>{systems.map((s) => <option key={s}>{s}</option>)}</select></div>
          <p className="muted small" style={{ margin: '6px 0' }}>Records linked to the chosen system are listed for assessment automatically; add others through the register.</p>
          <button className="btn pri" onClick={propose}>Create change</button>
        </section>
      )}
      {changes.map((c) => (
        <section className="card" key={c.id} style={{ marginBottom: 12 }}>
          <div className="row sb"><h2 style={{ margin: 0 }}>{c.id} · {c.title}</h2><Badge tone={c.status === 'Authorized' ? 'green' : c.status === 'Rejected' ? 'red' : 'amber'}>{c.status}</Badge></div>
          <p className="muted small" style={{ margin: '4px 0 10px' }}>System {c.system}</p>
          <div className="steps" style={{ marginBottom: 12 }}>{['Proposed', 'Impact review', 'Authorisation', 'Execution', 'Verification'].map((s, i) => <span key={s} className={`step ${i === 0 || (i === 1 && c.status !== 'Proposed') || (i === 2 && ['Authorized', 'Rejected'].includes(c.status)) ? 'on' : i === 1 ? 'cur' : ''}`}>{s}</span>)}</div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Linked record</th><th>Type</th><th>Impact assessment</th></tr></thead>
              <tbody>
                {[...c.docs.map((id) => ({ id, kind: 'Document' })), ...c.reqs.map((id) => ({ id, kind: 'Requirement' }))].map((it) => {
                  const d = docs.find((x) => x.id === it.id); const r = reqs.find((x) => x.id === it.id)
                  const v = c.impact[it.id]
                  return (
                    <tr key={it.id}>
                      <td><button className="link" onClick={() => open(it.kind === 'Document' ? 'doc' : 'req', it.id)}>{d?.title ?? r?.title}</button><small>{it.id}{d ? ` · ${R(d.rev)}` : ''}</small></td>
                      <td>{it.kind}</td>
                      <td><div className="row">{c.status === 'Impact review' ? (<><button className={`btn sm ${v === 'Impacted' ? 'pri' : ''}`} disabled={role === 'Contractor'} onClick={() => assessChangeItem(c.id, it.id, 'Impacted')}>Impacted</button><button className={`btn sm ${v === 'Not impacted' ? 'pri' : ''}`} disabled={role === 'Contractor'} onClick={() => assessChangeItem(c.id, it.id, 'Not impacted')}>Not impacted</button></>) : null}<Badge tone={v === 'Unassessed' ? 'amber' : v === 'Impacted' ? 'red' : 'green'}>{v}</Badge></div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {c.status === 'Impact review' && (
            <>
              <textarea className="input" style={{ marginTop: 10 }} placeholder="Authorisation decision reason (Owner / QA)…" value={txt[c.id] ?? ''} onChange={(e) => setTxt({ ...txt, [c.id]: e.target.value })} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn pri" disabled={role !== 'Owner / QA'} onClick={() => act(decideChange(c.id, true, txt[c.id] ?? ''), 'Change authorised')}>Authorise change</button>
                <button className="btn" disabled={role !== 'Owner / QA'} onClick={() => act(decideChange(c.id, false, txt[c.id] ?? ''), 'Change rejected')}>Reject</button>
                {role !== 'Owner / QA' && <span className="muted small">Authorisation needs the Owner / QA role. No automatic re-test or regulatory decision is made.</span>}
              </div>
            </>
          )}
          {c.decision && <p className="small" style={{ marginTop: 10 }}><b>Decision:</b> {c.decision}</p>}
        </section>
      ))}
      {!changes.length && <div className="card"><Empty title="No changes proposed" /></div>}
    </>
  )
}
