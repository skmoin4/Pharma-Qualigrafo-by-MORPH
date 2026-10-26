import { useState } from 'react'
import { EditRecord } from '../components/EditRecord'
import { activeDocs, plusDays, useStore } from '../store'
import { SystemSelect } from '../components/Pickers'
import type { NcrSeverity, Rating, Risk } from '../types'
import { Badge, Empty, PageHead, Stat, fmtDate, useUI } from '../components/ui'

function useAct() {
  const toast = useStore((s) => s.toast)
  return async (err: string | null | Promise<string | null>, ok: string) => { const e = await err; if (e) toast(e, 'warn'); else if (ok) toast(ok); return e }
}

/** Rating convention: likelihood x impact (1-25). */
export const band = (n: number) => (n >= 15 ? 'High' : n >= 8 ? 'Medium' : 'Low')
const bandTone = (n: number) => (n >= 15 ? 'red' : n >= 8 ? 'amber' : 'green')

/* ------------------------------------------------------------------- risks */
export function Risks() {
  const { risks, addRisk, updateRisk, role, editRisk } = useStore()
  const [editing, setEditing] = useState(false)
  const act = useAct()
  const [form, setForm] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [f, setF] = useState({ title: '', detail: '', system: '', likelihood: 3 as Rating, impact: 3 as Rating, owner: '', mitigation: '', due: plusDays(14) })
  const live = risks.filter((r) => r.status !== 'Closed')
  const cell = (l: number, i: number) => live.filter((r) => r.likelihood === l && r.impact === i)
  const selected = risks.find((r) => r.id === sel)
  const high = live.filter((r) => r.likelihood * r.impact >= 15).length

  return (
    <>
      <PageHead title="Risk register" sub="Delivery and compliance risks, rated by likelihood × impact, each with an owner and a mitigation. Ratings are reviewer judgement, not a calculated score." actions={<button className="btn pri" onClick={() => setForm(!form)}>Raise risk</button>} />
      <div className="grid g4">
        <Stat label="Open risks" value={live.length} sub={`${risks.length} recorded in total`} />
        <Stat label="High rating (15+)" value={high} sub="Need an owner and a dated mitigation" warn={high > 0} />
        <Stat label="Mitigating" value={risks.filter((r) => r.status === 'Mitigating').length} sub="Mitigation under way" />
        <Stat label="Closed / accepted" value={risks.filter((r) => r.status === 'Closed' || r.status === 'Accepted').length} sub="With a recorded decision" />
      </div>

      {form && (
        <section className="card mt">
          <h2>New risk</h2>
          <div className="grid g2">
            <div><label className="lab" style={{ marginTop: 0 }}>Title</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div><label className="lab" style={{ marginTop: 0 }}>Related system</label><SystemSelect value={f.system} onChange={(v) => setF({ ...f, system: v })} /></div>
          </div>
          <label className="lab">What could happen, and why</label>
          <textarea className="input" style={{ minHeight: 56 }} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} />
          <div className="grid g4">
            <div><label className="lab">Likelihood (1–5)</label><select className="input" value={f.likelihood} onChange={(e) => setF({ ...f, likelihood: Number(e.target.value) as Rating })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></div>
            <div><label className="lab">Impact (1–5)</label><select className="input" value={f.impact} onChange={(e) => setF({ ...f, impact: Number(e.target.value) as Rating })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></div>
            <div><label className="lab">Owner</label><input className="input" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></div>
            <div><label className="lab">Mitigation due</label><input className="input" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div>
          </div>
          <label className="lab">Mitigation</label>
          <textarea className="input" style={{ minHeight: 56 }} value={f.mitigation} onChange={(e) => setF({ ...f, mitigation: e.target.value })} />
          <div className="row" style={{ marginTop: 10 }}><button className="btn pri" onClick={async () => { const er = await act(addRisk(f), `Risk raised · rating ${f.likelihood * f.impact} (${band(f.likelihood * f.impact)})`); if (!er) { setForm(false); setF({ ...f, title: '', detail: '', mitigation: '' }) } }}>Add to register</button><span className="muted small">Rating {f.likelihood * f.impact} · {band(f.likelihood * f.impact)}</span></div>
        </section>
      )}

      <div className="grid g21 mt">
        <section className="card flush">
          <h2>Register</h2>
          <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}><table>
            <thead><tr><th>Risk</th><th>Rating</th><th>Owner · due</th><th>Status</th></tr></thead>
            <tbody>
              {[...risks].sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact).map((r) => (
                <tr key={r.id} className="clickrow" onClick={() => { setSel(r.id); setNote(''); setEditing(false) }} style={r.id === sel ? { background: 'rgba(37, 99, 235, 0.08)' } : undefined}>
                  <td><b>{r.title}</b><small>{r.id} · {r.system}</small></td>
                  <td><Badge tone={bandTone(r.likelihood * r.impact)}>{band(r.likelihood * r.impact)} · {r.likelihood * r.impact}</Badge><small>L{r.likelihood} × I{r.impact}</small></td>
                  <td>{r.owner}<small>{r.due}</small></td>
                  <td><Badge tone={r.status === 'Closed' ? 'green' : r.status === 'Mitigating' ? 'blue' : r.status === 'Accepted' ? 'violet' : 'amber'}>{r.status}</Badge></td>
                </tr>
              ))}
              {!risks.length && <tr><td colSpan={4}><Empty title="No risks recorded" /></td></tr>}
            </tbody>
          </table></div>
        </section>

        <div className="grid" style={{ alignSelf: 'start' }}>
          <section className="card">
            <h2>Heat map <span className="muted small" style={{ fontWeight: 400 }}>open risks</span></h2>
            <div className="heat" role="img" aria-label="Risk heat map, likelihood against impact">
              {[5, 4, 3, 2, 1].map((l) => (
                <div className="hrow" key={l}>
                  <span className="hl">L{l}</span>
                  {[1, 2, 3, 4, 5].map((i) => { const c = cell(l, i); return <div key={i} className={`hc ${bandTone(l * i)}`} title={c.map((r) => `${r.id} ${r.title}`).join('\n') || `L${l} × I${i}`}>{c.map((r) => <button key={r.id} className="hdot" onClick={() => { setSel(r.id); setNote('') }}>{r.id.slice(-1)}</button>)}</div> })}
                </div>
              ))}
              <div className="hrow"><span className="hl" />{[1, 2, 3, 4, 5].map((i) => <span className="hx" key={i}>I{i}</span>)}</div>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>Bands: High 15+, Medium 8–14, Low below 8 (project convention, adjustable in production).</p>
          </section>

          {selected && <RiskDetail r={selected} note={note} setNote={setNote} role={role} onUpdate={(s) => act(updateRisk(selected.id, s, note), `${selected.id} → ${s}`)} />}
          {selected && role !== 'Contractor' && selected.status !== 'Closed' && (editing
            ? <EditRecord name={selected.id} onClose={() => setEditing(false)} initial={{ title: selected.title, detail: selected.detail, system: selected.system, likelihood: selected.likelihood, impact: selected.impact, owner: selected.owner, mitigation: selected.mitigation, due: selected.due }}
                fields={[{ key: 'title', label: 'Title', wide: true }, { key: 'detail', label: 'What could happen', type: 'textarea', wide: true }, { key: 'likelihood', label: 'Likelihood', type: 'select', options: [1, 2, 3, 4, 5] }, { key: 'impact', label: 'Impact', type: 'select', options: [1, 2, 3, 4, 5] }, { key: 'owner', label: 'Owner' }, { key: 'due', label: 'Mitigation due', type: 'date' }, { key: 'system', label: 'System', type: 'system' }, { key: 'mitigation', label: 'Mitigation', type: 'textarea', wide: true }]}
                onSave={(v, reason) => editRisk(selected.id, { title: String(v.title), detail: String(v.detail), system: String(v.system), likelihood: Number(v.likelihood) as Rating, impact: Number(v.impact) as Rating, owner: String(v.owner), mitigation: String(v.mitigation), due: String(v.due), reason })} />
            : <div><button className="btn sm" onClick={() => setEditing(true)}>Edit {selected.id}</button></div>)}
        </div>
      </div>
    </>
  )
}

function RiskDetail({ r, note, setNote, role, onUpdate }: { r: Risk; note: string; setNote: (s: string) => void; role: string; onUpdate: (s: Risk['status']) => void }) {
  return (
    <section className="card">
      <h2>{r.id} <Badge tone={bandTone(r.likelihood * r.impact)}>{band(r.likelihood * r.impact)}</Badge></h2>
      <p><b>{r.title}</b></p>
      <p className="muted" style={{ margin: '6px 0' }}>{r.detail}</p>
      <div className="kv"><div><small>Mitigation</small>{r.mitigation}</div><div><small>Owner · due</small>{r.owner} · {r.due}</div></div>
      {r.decision && <p className="small"><b>Last decision:</b> {r.decision}</p>}
      <label className="lab">Note (required for every status change)</label>
      <textarea className="input" style={{ minHeight: 56 }} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn sm" disabled={r.status === 'Mitigating'} onClick={() => onUpdate('Mitigating')}>Mark mitigating</button>
        <button className="btn sm" disabled={role === 'Contractor'} onClick={() => onUpdate('Accepted')}>Accept risk</button>
        <button className="btn sm pri" disabled={role === 'Contractor'} onClick={() => onUpdate('Closed')}>Close</button>
      </div>
      {role === 'Contractor' && <p className="muted small" style={{ marginTop: 6 }}>Closing or accepting a risk requires a reviewer.</p>}
    </section>
  )
}

/* -------------------------------------------------------------------- NCRs */
export function Ncrs() {
  const { ncrs, raiseNcr, respondNcr, closeNcr, reopenNcr, role, docs, scope, editNcr } = useStore()
  const [edit, setEdit] = useState<string | null>(null)
  const open = useUI((s) => s.open)
  const act = useAct()
  const [form, setForm] = useState(false)
  const [f, setF] = useState({ title: '', description: '', system: '', severity: 'Major' as NcrSeverity, doc: '', due: plusDays(7) })
  const [txt, setTxt] = useState<Record<string, { a: string; b: string; c: string; d: string }>>({})
  const T = (id: string) => txt[id] ?? { a: '', b: '', c: '', d: '' }
  const set = (id: string, k: 'a' | 'b' | 'c' | 'd', v: string) => setTxt({ ...txt, [id]: { ...T(id), [k]: v } })
  const sev = (s: string) => (s === 'Critical' ? 'red' : s === 'Major' ? 'amber' : 'blue')
  const count = (s: NcrSeverity) => ncrs.filter((n) => n.severity === s && n.status !== 'Closed').length

  return (
    <>
      <PageHead title="Non-conformances (NCR)" sub="Site and documentation deviations from the approved design or specification. The contractor responds with root cause, containment and corrective action; an independent reviewer verifies before closure." actions={scope ? undefined : <button className="btn pri" onClick={() => setForm(!form)}>Raise NCR</button>} />
      <div className="grid g4">
        <Stat label="Critical open" value={count('Critical')} sub="Only Owner / QA can close" warn={count('Critical') > 0} />
        <Stat label="Major open" value={count('Major')} sub="Reviewer verification required" warn={count('Major') > 0} />
        <Stat label="Minor open" value={count('Minor')} sub="Tracked to closure" />
        <Stat label="Closed" value={ncrs.filter((n) => n.status === 'Closed').length} sub={`of ${ncrs.length} raised`} />
      </div>
      {form && (
        <section className="card mt">
          <h2>Raise NCR</h2>
          <div className="grid g3">
            <div><label className="lab" style={{ marginTop: 0 }}>Title</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div><label className="lab" style={{ marginTop: 0 }}>System</label><SystemSelect value={f.system} onChange={(v) => setF({ ...f, system: v })} /></div>
            <div><label className="lab" style={{ marginTop: 0 }}>Severity</label><select className="input" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as NcrSeverity })}>{['Critical', 'Major', 'Minor'].map((s) => <option key={s}>{s}</option>)}</select></div>
          </div>
          <label className="lab">What was found (reference the drawing revision and location)</label>
          <textarea className="input" style={{ minHeight: 56 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <div className="grid g2"><div><label className="lab">Related document (optional)</label><select className="input" value={f.doc} onChange={(e) => setF({ ...f, doc: e.target.value })}><option value="">None</option>{activeDocs(docs).map((d) => <option key={d.id} value={d.id}>{d.id} · {d.title}</option>)}</select></div><div><label className="lab">Response due</label><input className="input" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div></div>
          <button className="btn pri" style={{ marginTop: 10 }} onClick={async () => { const er = await act(raiseNcr({ ...f, doc: f.doc || undefined }), 'NCR raised and routed to the contractor'); if (!er) { setForm(false); setF({ ...f, title: '', description: '' }) } }}>Raise NCR</button>
        </section>
      )}

      {[...ncrs].sort((a, b) => Number(a.status === 'Closed') - Number(b.status === 'Closed')).map((n) => (
        <section className="card mt" key={n.id}>
          <div className="row sb wrap"><h2 style={{ margin: 0 }}>{n.id} · {n.title}</h2><div className="row"><Badge tone={sev(n.severity)}>{n.severity}</Badge><Badge tone={n.status === 'Closed' ? 'green' : n.status === 'Open' ? 'red' : 'amber'}>{n.status}</Badge></div></div>
          {role !== 'Contractor' && n.status !== 'Closed' && edit !== n.id && <button className="link small" onClick={() => setEdit(n.id)}>Edit {n.id}</button>}
          {edit === n.id && <EditRecord name={n.id} onClose={() => setEdit(null)} initial={{ title: n.title, description: n.description, system: n.system, severity: n.severity, doc: n.doc ?? '', due: n.due }}
            fields={[{ key: 'title', label: 'Title', wide: true }, { key: 'description', label: 'Description', type: 'textarea', wide: true }, { key: 'severity', label: 'Severity', type: 'select', options: ['Critical', 'Major', 'Minor'], disabled: n.severity === 'Critical' && role !== 'Owner / QA', hint: n.severity === 'Critical' && role !== 'Owner / QA' ? 'Only Owner / QA can downgrade a Critical NCR.' : undefined }, { key: 'due', label: 'Response due', type: 'date' }, { key: 'system', label: 'System', type: 'system' }, { key: 'doc', label: 'Related document', type: 'select', options: ['', ...activeDocs(docs).map((d) => d.id)] }]}
            onSave={(v, reason) => editNcr(n.id, { title: String(v.title), description: String(v.description), system: String(v.system), severity: v.severity as NcrSeverity, doc: String(v.doc), due: String(v.due), reason })} />}
          <p className="muted" style={{ margin: '8px 0' }}>{n.description}</p>
          <div className="kv"><div><small>System</small>{n.system}{n.doc && <> · <button className="link" onClick={() => open('doc', n.doc!)}>{n.doc}</button></>}</div><div><small>Raised · response due</small>{n.raisedBy} · {fmtDate(n.raisedAt)} · due {n.due}{n.status !== 'Closed' && n.due < '2026-10-16' && <> <Badge tone="red">Overdue</Badge></>}</div></div>
          {n.rootCause && <div className="kv"><div><small>Root cause</small>{n.rootCause}</div><div><small>Containment</small>{n.containment}</div><div style={{ gridColumn: '1 / -1' }}><small>Corrective action</small>{n.correctiveAction}</div></div>}
          {n.closeReason && <p className="small"><b>Verification ({n.closedBy}):</b> {n.closeReason}</p>}

          {n.status === 'Open' && (role === 'Contractor' ? (
            <>
              <div className="grid g3">
                <div><label className="lab">Root cause</label><textarea className="input" style={{ minHeight: 56 }} value={T(n.id).a} onChange={(e) => set(n.id, 'a', e.target.value)} /></div>
                <div><label className="lab">Containment</label><textarea className="input" style={{ minHeight: 56 }} value={T(n.id).b} onChange={(e) => set(n.id, 'b', e.target.value)} /></div>
                <div><label className="lab">Corrective action</label><textarea className="input" style={{ minHeight: 56 }} value={T(n.id).c} onChange={(e) => set(n.id, 'c', e.target.value)} /></div>
              </div>
              <button className="btn pri" style={{ marginTop: 10 }} onClick={() => act(respondNcr(n.id, T(n.id).a, T(n.id).b, T(n.id).c), 'Response submitted for verification')}>Submit response</button>
            </>
          ) : <p className="muted small">Waiting for the contractor&apos;s response.</p>)}

          {n.status === 'Response submitted' && (role !== 'Contractor' ? (
            <>
              <label className="lab">Verification note (how was the corrective action verified?)</label>
              <textarea className="input" style={{ minHeight: 56 }} value={T(n.id).d} onChange={(e) => set(n.id, 'd', e.target.value)} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn pri" onClick={() => act(closeNcr(n.id, T(n.id).d), `${n.id} verified and closed`)}>Verify &amp; close</button>
                <button className="btn" onClick={() => act(reopenNcr(n.id, T(n.id).d), 'Returned to the contractor')}>Return to contractor</button>
                {n.severity === 'Critical' && role !== 'Owner / QA' && <span className="muted small">Critical: Owner / QA closes</span>}
              </div>
            </>
          ) : <p className="muted small">Waiting for independent verification.</p>)}
        </section>
      ))}
      {!ncrs.length && <div className="card mt"><Empty title="No non-conformances raised">Raise an NCR when work or documentation deviates from the approved design.</Empty></div>}
    </>
  )
}
