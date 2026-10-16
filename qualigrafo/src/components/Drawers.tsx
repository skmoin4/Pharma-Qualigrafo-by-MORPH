import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { markets } from '../data/seed'
import { evidenceState, useStore } from '../store'
import type { Applicability } from '../types'
import { Applic, Badge, DocBadge, Drawer, MarketChip, R, StateBadge, fmtDate, go, useUI } from './ui'

function useAct() {
  const toast = useStore((s) => s.toast)
  return (err: string | null, ok: string) => (err ? toast(err, 'warn') : toast(ok))
}

export function DocDrawer({ id }: { id: string }) {
  const { docs, role, submitDoc, signDoc, returnDoc, newRevision, reqs } = useStore()
  const open = useUI((s) => s.open)
  const act = useAct()
  const [note, setNote] = useState('')
  const [name, setName] = useState(`Demo ${role}`)
  const [intent, setIntent] = useState(false)
  const doc = docs.find((d) => d.id === id)!
  const expected = doc.signStage === 0 ? 'Consultant' : 'Owner / QA'
  const linked = reqs.filter((r) => r.evidence.some((e) => e.doc === id))
  const at = doc.status === 'Accepted' ? 4 : doc.status === 'Under review' ? 1 + doc.signStage : doc.status === 'Draft' || doc.status === 'Missing' ? 0 : 1

  return (
    <Drawer kicker={`${doc.id} · Controlled document`} title={doc.title} right={<DocBadge s={doc.status} />}>
      <div className="kv">
        <div><small>Revision</small><span className="rev">{R(doc.rev)}</span></div>
        <div><small>Discipline</small>{doc.discipline}</div>
        <div><small>System / asset</small>{doc.system}</div>
        <div><small>Responsible party</small>{doc.owner}</div>
        <div><small>Due</small>{doc.due}</div>
        <div><small>Criticality</small>{doc.critical ? 'Critical record' : 'Standard'}</div>
      </div>
      <div className="notice info small">Prototype record: no source file is attached. In production a submission requires an uploaded file, checksum and mandatory metadata.</div>

      <h3>Review workflow</h3>
      <div className="steps">
        {['Draft', 'Submitted', 'Consultant sign-off', 'Owner / QA sign-off', 'Accepted'].map((s, i) => <span key={s} className={`step ${i < at ? 'on' : i === at ? 'cur' : ''}`}>{s}</span>)}
      </div>

      <label className="lab">Note / decision reason (required for every action)</label>
      <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Record the submission note or decision reason…" />
      {doc.status === 'Under review' && (<><label className="lab">Signer display name (prototype — production derives identity from authentication)</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /><label className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={intent} onChange={(e) => setIntent(e.target.checked)} style={{ marginTop: 3 }} /><span className="small">I have reviewed <b>{doc.id} {R(doc.rev)}</b> and explicitly confirm this decision. (Prototype confirmation. Production uses verified identity and a signing challenge bound to the revision checksum.)</span></label></>)}
      <div className="row wrap" style={{ marginTop: 12 }}>
        {role === 'Contractor' && ['Missing', 'Draft', 'Changes requested'].includes(doc.status) && <button className="btn pri" onClick={() => act(submitDoc(id, note), 'Submitted for review')}>Submit for review</button>}
        {role === 'Contractor' && doc.status === 'Accepted' && <button className="btn" onClick={() => { newRevision(id); act(null, 'New revision started. Linked evidence now needs reassessment.') }}>Start new revision</button>}
        {doc.status === 'Under review' && (
          <>
            <button className="btn pri" disabled={role !== expected} onClick={() => { const er = signDoc(id, name, note, intent); act(er, expected === 'Consultant' ? 'Consultant sign-off recorded. Automatically routed to Owner / QA.' : 'Final sign-off recorded. Revision accepted.'); if (!er) setIntent(false) }}>Record sign-off as {expected}</button>
            <button className="btn" disabled={role === 'Contractor'} onClick={() => act(returnDoc(id, note), 'Returned for changes')}>Return for changes</button>
          </>
        )}
      </div>
      {doc.status === 'Under review' && role !== expected && <p className="muted small" style={{ marginTop: 6 }}>Awaiting {expected}. Use the role preview in the top bar to act as that role.</p>}
      {role !== 'Contractor' && ['Missing', 'Draft'].includes(doc.status) && <p className="muted small" style={{ marginTop: 6 }}>Submission is performed by the responsible contractor / vendor.</p>}

      {doc.signatures.length > 0 && (
        <>
          <h3>Sign-off record (prototype, not a valid electronic signature)</h3>
          <div className="tablewrap"><table><tbody>{doc.signatures.map((s, i) => <tr key={i}><td><b>{s.name}</b><small>{s.role}</small></td><td>{s.reason}</td><td>{fmtDate(s.at)}<small>bound to {R(s.rev)}</small></td></tr>)}</tbody></table></div>
        </>
      )}

      <h3>Requirements this revision supports</h3>
      <div className="list">
        {linked.map((r) => <div key={r.id} className="row sb"><button className="link" onClick={() => open('req', r.id)}><MarketChip m={r.market} /> {r.title}</button><StateBadge s={evidenceState(r, docs)} /></div>)}
        {!linked.length && <p className="muted">Not linked to any requirement.</p>}
      </div>

      <h3>Revision history</h3>
      <div className="tablewrap"><table><tbody>{[...doc.history].reverse().map((h, i) => <tr key={i}><td><span className="rev">{R(h.rev)}</span></td><td>{h.status}{h.note && <small>{h.note}</small>}</td><td>{h.by}<small>{fmtDate(h.at)}</small></td></tr>)}</tbody></table></div>
      <p style={{ marginTop: 10 }}><button className="link small" onClick={() => go('comments')}>View technical comments →</button></p>
    </Drawer>
  )
}

export function ReqDrawer({ id }: { id: string }) {
  const { reqs, docs, role, decideApplicability, linkEvidence, assessEvidence, addAction } = useStore()
  const open = useUI((s) => s.open)
  const act = useAct()
  const r = reqs.find((x) => x.id === id)!
  const [app, setApp] = useState<Applicability>(r.applicability)
  const [why, setWhy] = useState(r.rationale)
  const [docId, setDocId] = useState(docs.find((d) => d.status !== 'Missing')!.id)
  const [note, setNote] = useState('')
  const [assess, setAssess] = useState<number | null>(null)
  const [areason, setAreason] = useState('')
  const [gap, setGap] = useState('')
  const [clause, setClause] = useState(r.clause)
  const [ver, setVer] = useState(r.sourceVersion)
  const [eff, setEff] = useState(r.effective)
  const [attest, setAttest] = useState(r.sourceAttested)
  const { setSourceRef } = useStore()
  const m = markets[r.market]
  const reviewer = role !== 'Contractor'

  return (
    <Drawer kicker={`${r.id} · Requirement · ${m.name}`} title={r.title} right={<StateBadge s={evidenceState(r, docs)} />}>
      <div className="kv">
        <div><small>Authority</small>{m.authority}</div>
        <div><small>System / discipline</small>{r.system} · {r.discipline}</div>
        <div><small>Applicability</small><Applic a={r.applicability} /></div>
        <div><small>Owner / due</small>{r.owner} · {r.due}</div>
        <div style={{ gridColumn: '1 / -1' }}><small>Source reference</small>{r.topic}<br /><span className="muted">{m.base}</span> · <a href={m.url} target="_blank" rel="noopener noreferrer">Official source <ExternalLink size={11} /></a></div>
      </div>
      <div className="notice small">Illustrative mapping. Exact clause, version and effective date are <b>not verified</b>. A qualified regulatory reviewer must confirm them before this requirement is relied on.</div>

      <h3>Clause, source version and effective date</h3>
      <div className="grid g3">
        <div><label className="lab" style={{ marginTop: 0 }}>Clause / section</label><input className="input" disabled={!reviewer} value={clause} onChange={(e) => setClause(e.target.value)} placeholder="Enter from the official text" /></div>
        <div><label className="lab" style={{ marginTop: 0 }}>Source version</label><input className="input" disabled={!reviewer} value={ver} onChange={(e) => setVer(e.target.value)} placeholder="Edition / amendment" /></div>
        <div><label className="lab" style={{ marginTop: 0 }}>Effective date</label><input className="input" type="date" disabled={!reviewer} value={eff} onChange={(e) => setEff(e.target.value)} /></div>
      </div>
      <label className="row" style={{ marginTop: 8, alignItems: 'flex-start' }}><input type="checkbox" disabled={!reviewer} checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ marginTop: 3 }} /><span className="small">I checked these against the official source. (Reviewer attestation only: this does not release a validated rule pack.)</span></label>
      <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={!reviewer} onClick={() => act(setSourceRef(id, clause, ver, eff, attest), 'Source reference saved')}>Save source reference</button>{r.sourceAttested ? <Badge tone="blue">Reviewer-attested, not expert-verified</Badge> : <Badge tone="amber">Clause verification pending</Badge>}</div>

      <h3>Applicability decision</h3>
      <div className="row">
        <select className="input" style={{ maxWidth: 220 }} value={app} disabled={!reviewer} onChange={(e) => setApp(e.target.value as Applicability)}>{['Assessment pending', 'Required', 'Not applicable'].map((x) => <option key={x}>{x}</option>)}</select>
        <button className="btn pri" disabled={!reviewer} onClick={() => act(decideApplicability(id, app, why), 'Applicability decision recorded')}>Record decision</button>
      </div>
      <label className="lab">Reviewer rationale</label>
      <textarea className="input" value={why} disabled={!reviewer} onChange={(e) => setWhy(e.target.value)} />
      {!reviewer && <p className="muted small" style={{ marginTop: 4 }}>A contractor cannot decide applicability of its own deliverables.</p>}

      <h3>Linked evidence (exact revisions)</h3>
      <div className="tablewrap">
        <table>
          <tbody>
            {r.evidence.map((e, i) => {
              const d = docs.find((x) => x.id === e.doc)!
              return (
                <tr key={i}>
                  <td style={{ width: '58%' }}>
                    <button className="link" onClick={() => open('doc', e.doc)}>{d.title}</button> <span className="rev">{R(e.rev)}</span>
                    <small>{e.note}</small>
                    {d.rev !== e.rev && <div style={{ marginTop: 4 }}><Badge tone="red">Document is now {R(d.rev)} — reassess</Badge></div>}
                    {e.reason && <small>Assessment ({e.reviewedBy}): {e.reason}</small>}
                    {assess === i && (
                      <div style={{ marginTop: 8 }}>
                        <textarea className="input" placeholder="Assessment rationale…" value={areason} onChange={(x) => setAreason(x.target.value)} />
                        <div className="row" style={{ marginTop: 6 }}>
                          <button className="btn pri sm" onClick={() => { const er = assessEvidence(id, i, true, areason); act(er, 'Evidence accepted'); if (!er) setAssess(null) }}>Accept as fit</button>
                          <button className="btn sm" onClick={() => { const er = assessEvidence(id, i, false, areason); act(er, 'Evidence rejected'); if (!er) setAssess(null) }}>Reject</button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td><Badge tone={e.decision === 'Accepted' ? 'green' : e.decision === 'Rejected' ? 'red' : 'amber'}>{e.decision}</Badge></td>
                  <td>{reviewer && assess !== i && <button className="btn sm" onClick={() => setAssess(i)}>Assess</button>}</td>
                </tr>
              )
            })}
            {!r.evidence.length && <tr><td className="muted">No evidence linked. This requirement cannot currently be evidenced.</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>Link a document revision</h3>
      <select className="input" value={docId} onChange={(e) => setDocId(e.target.value)}>{docs.map((d) => <option key={d.id} value={d.id}>{d.id} · {d.title} · {R(d.rev)} [{d.status}]</option>)}</select>
      <textarea className="input" style={{ marginTop: 6 }} placeholder="Which part of this requirement does the record support? (page / section)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn" style={{ marginTop: 6 }} onClick={() => act(linkEvidence(id, docId, note), 'Evidence linked to current revision')}>Link current revision</button>

      <h3>Corrective action</h3>
      <textarea className="input" placeholder="Describe the gap and the evidence that will close it…" value={gap} onChange={(e) => setGap(e.target.value)} />
      <button className="btn" style={{ marginTop: 6 }} onClick={() => { if (!gap.trim()) return act('Describe the action first.', ''); addAction({ req: id, title: gap, owner: 'Contractor', due: '2026-10-30', priority: 'High' }); setGap(''); act(null, 'Corrective action assigned') }}>Assign action</button>
    </Drawer>
  )
}
