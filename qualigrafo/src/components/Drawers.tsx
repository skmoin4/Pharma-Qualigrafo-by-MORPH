import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { markets } from '../data/reference'
import { evidenceState, hasCurrentSource, isActiveDoc, plusDays, useStore } from '../store'
import { SourceSection } from './Files'
import { api, errorText } from '../api'
import type { Doc } from '../types'

/** Meaning of each sign-off stage (same text the server records with the signature). */
const SIGNATURE_MEANING = ['Reviewed — technically acceptable', 'Approved for use']
import { CompanySelect, DisciplineSelect, SystemSelect } from './Pickers'
import type { Applicability } from '../types'
import { Applic, Badge, DocBadge, Drawer, MarketChip, R, StateBadge, fmtDate, go, useUI } from './ui'


/**
 * The formal revision register of one document (Phase 5 / step 3). A **version** is a working iteration — it
 * appears under version history; a **revision** is what was formally offered and issued, and it is never
 * overwritten: a superseded revision keeps its own row, its own content checksum and the reason it was issued.
 */
function RevisionRegister({ doc }: { doc: Doc }) {
  const [compare, setCompare] = useState<number[]>([])
  const revs = [...doc.revisions].sort((a, b) => b.rev - a.rev)
  const current = revs.find((r) => r.state === 'Issued')
  const picked = compare.length === 2 ? revs.filter((r) => compare.includes(r.rev)).sort((a, b) => a.rev - b.rev) : []
  const toggle = (rev: number) => setCompare(compare.includes(rev) ? compare.filter((x) => x !== rev) : [...compare, rev].slice(-2))
  const tone = (s: string) => (s === 'Issued' ? 'green' : s === 'Superseded' ? '' : s === 'Returned' ? 'amber' : 'blue')

  if (!revs.length) {
    return (
      <>
        <h3>Revisions</h3>
        <p className="muted small">No formal revision yet. A revision opens when this document is submitted for review — until then its file is a working version.</p>
      </>
    )
  }
  return (
    <>
      <h3>Revisions <span className="muted small" style={{ fontWeight: 400 }}>{current ? `current: ${R(current.rev)}${current.suitability ? ` · ${current.suitability}` : ''}` : 'none issued yet'}</span></h3>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Rev</th><th>Issued for</th><th>Prepared · checked · approved</th><th>Compare</th></tr></thead>
          <tbody>
            {revs.map((r) => (
              <tr key={r.rev} className={r.state === 'Superseded' ? 'muted' : undefined}>
                <td><span className="rev">{R(r.rev)}</span><small><Badge tone={tone(r.state)} dot={false}>{r.state}</Badge></small></td>
                <td>{r.suitability ? <><b>{r.suitability}</b> · </> : null}{r.reasonForIssue || <span className="muted">—</span>}{r.changeSummary && <small>{r.changeSummary}</small>}</td>
                <td className="small">
                  {r.preparedBy || '—'}<small>{r.checkedBy ? `checked ${r.checkedBy}` : 'not checked yet'}{r.approvedBy ? ` · approved ${r.approvedBy}${r.approvedAt ? ` (${fmtDate(r.approvedAt)})` : ''}` : ''}</small>
                </td>
                <td><input type="checkbox" aria-label={`Compare R${r.rev}`} checked={compare.includes(r.rev)} onChange={() => toggle(r.rev)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {picked.length === 2 && (
        <div className="subcard" style={{ marginTop: 8 }}>
          <b className="small">{R(picked[0].rev)} → {R(picked[1].rev)}</b>
          <div className="tablewrap" style={{ marginTop: 6 }}><table><tbody>
            {([['Suitability', 'suitability'], ['Issued for', 'reasonForIssue'], ['Change summary', 'changeSummary'], ['Prepared by', 'preparedBy'], ['Checked by', 'checkedBy'], ['Approved by', 'approvedBy'], ['Content checksum', 'checksum']] as const).map(([label, key]) => {
              const a = (picked[0][key] ?? '') as string, b = (picked[1][key] ?? '') as string
              const short = (v: string) => (key === 'checksum' ? v.slice(0, 12) : v) || '—'
              return <tr key={key}><td className="small muted" style={{ width: 150 }}>{label}</td><td className="small">{a === b ? <span className="muted">unchanged · {short(a)}</span> : <>{short(a)} <b>→</b> {short(b)}</>}</td></tr>
            })}
          </tbody></table></div>
        </div>
      )}
      {compare.length === 1 && <p className="muted small" style={{ marginTop: 6 }}>Tick a second revision to compare.</p>}
    </>
  )
}

function useAct() {
  const toast = useStore((s) => s.toast)
  return async (err: string | null | Promise<string | null>, ok: string) => { const e = await err; if (e) toast(e, 'warn'); else if (ok) toast(ok); return e }
}

export function DocDrawer({ id }: { id: string }) {
  const { docs, role, submitDoc, signDoc, returnDoc, newRevision, reqs, current, suitabilityCodes } = useStore()
  const [suitability, setSuitability] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const open = useUI((s) => s.open)
  const act = useAct()
  const session = useStore((s) => s.session)
  const signer = session ? `${session.name} · ${session.email}` : role
  const [password, setPassword] = useState('')
  const [verified, setVerified] = useState<string[] | null>(null)
  const [note, setNote] = useState('')
  const [intent, setIntent] = useState(false)
  const doc = docs.find((d) => d.id === id)!
  const expected = doc.signStage === 0 ? 'Consultant' : 'Owner / QA'
  const linked = reqs.filter((r) => r.evidence.some((e) => e.doc === id && e.decision !== 'Withdrawn'))
  const sourced = hasCurrentSource(doc)
  const at = doc.status === 'Accepted' ? 4 : doc.status === 'Under review' ? 1 + doc.signStage : doc.status === 'Draft' || doc.status === 'Missing' ? 0 : 1

  return (
    <Drawer kicker={`${doc.id} · Controlled document`} title={doc.title} right={<DocBadge s={doc.status} />}>
      {doc.voided && <div className="notice small" style={{ marginBottom: 10 }}><b>{doc.status === 'Void' ? 'Void' : `Superseded by ${doc.voided.supersededBy}`}</b> · {doc.voided.by} · {fmtDate(doc.voided.at)}<br />{doc.voided.reason}{doc.voided.supersededBy && <> · <button className="link small" onClick={() => open('doc', doc.voided!.supersededBy!)}>Open {doc.voided.supersededBy}</button></>}</div>}
      <div className="kv">
        <div><small>Document number</small>{doc.number || <span className="muted">Not assigned</span>}</div>
        <div><small>Revision</small><span className="rev">{R(doc.rev)}</span></div>
        <div><small>Discipline</small>{doc.discipline}</div>
        <div><small>System / asset</small>{doc.system || <span className="muted">—</span>}</div>
        <div><small>Responsible party</small>{doc.owner}</div>
        <div><small>Due</small>{doc.due}</div>
        <div style={{ gridColumn: '1 / -1' }}><small>Criticality</small>{doc.critical ? 'Critical record' : 'Standard'}</div>
      </div>

      <h3>Source file</h3>
      <SourceSection doc={doc} />

      <DocRegister key={`${doc.id}-${doc.status}`} id={id} />

      {isActiveDoc(doc) && <>
      <h3>Review workflow</h3>
      <div className="steps">
        {['Draft', 'Submitted', 'Consultant sign-off', 'Owner / QA sign-off', 'Accepted'].map((s, i) => <span key={s} className={`step ${i < at ? 'on' : i === at ? 'cur' : ''}`}>{s}</span>)}
      </div>

      <label className="lab">Note / decision reason (required for every action)</label>
      <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Record the submission note or decision reason…" />
      {role === 'Contractor' && ['Missing', 'Draft', 'Changes requested'].includes(doc.status) && (
        <div className="grid g2" style={{ marginTop: 8 }}>
          <div>
            <label className="lab" style={{ marginTop: 0 }}>Issued for (suitability)</label>
            <select className="input" value={suitability} onChange={(e) => setSuitability(e.target.value)} aria-label="Suitability">
              <option value="">Not stated</option>
              {suitabilityCodes.map((x) => <option key={x.code} value={x.code}>{x.code} — {x.label}</option>)}
            </select>
          </div>
          <div>
            <label className="lab" style={{ marginTop: 0 }}>What changed (optional)</label>
            <input className="input" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} placeholder="e.g. Pump schedule corrected after RFI-004" aria-label="Change summary" />
          </div>
        </div>
      )}
      {doc.status === 'Under review' && role === expected && (<>
        <div className="notice info small" style={{ marginTop: 10 }}>Electronic signature. Meaning: <b>{SIGNATURE_MEANING[doc.signStage]}</b>. It is bound to {doc.id} {R(doc.rev)}{doc.file ? <> (SHA-256 <code>{doc.file.sha256.slice(0, 12)}…</code>)</> : ''} and recorded with your name, e-mail and the time.</div>
        <div className="grid g2"><div><label className="lab">Signing as</label><input className="input" value={signer} disabled /></div><div><label className="lab">Password (re-enter to sign)</label><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Signature password" /></div></div>
        <label className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={intent} onChange={(e) => setIntent(e.target.checked)} style={{ marginTop: 3 }} /><span className="small">I have reviewed <b>{doc.id} {R(doc.rev)}</b> and sign it as <b>{SIGNATURE_MEANING[doc.signStage]}</b>.</span></label>
      </>)}
      <div className="row wrap" style={{ marginTop: 12 }}>
        {role === 'Contractor' && ['Missing', 'Draft', 'Changes requested'].includes(doc.status) && <button className="btn pri" disabled={!sourced} title={sourced ? undefined : `Attach the source file for ${R(doc.rev)} first`} onClick={() => act(submitDoc(id, note, { suitability, changeSummary }), 'Submitted for review')}>Submit {R(doc.rev)} for review</button>}
        {role === 'Contractor' && doc.status === 'Accepted' && <button className="btn" onClick={() => act(newRevision(id), 'New revision started. Linked evidence now needs reassessment.')}>Start new revision</button>}
        {doc.status === 'Under review' && (
          <>
            <button className="btn pri" disabled={role !== expected} onClick={async () => { const er = await act(signDoc(id, note, intent, password), expected === 'Consultant' ? 'Consultant sign-off recorded. Automatically routed to Owner / QA.' : 'Final sign-off recorded. Revision accepted.'); setPassword(''); if (!er) setIntent(false) }}>Sign as {expected}</button>
            <button className="btn" disabled={role === 'Contractor'} onClick={() => act(returnDoc(id, note), 'Returned for changes')}>Return for changes</button>
          </>
        )}
      </div>
      {role === 'Contractor' && ['Missing', 'Draft', 'Changes requested'].includes(doc.status) && !sourced && <p className="muted small" style={{ marginTop: 6 }}>Attach the source file for {R(doc.rev)} above{doc.status === 'Changes requested' ? ' (it becomes a new draft revision)' : ''}, then submit.</p>}
      {doc.status === 'Under review' && role !== expected && <p className="muted small" style={{ marginTop: 6 }}>Awaiting {expected}.</p>}
      {role !== 'Contractor' && ['Missing', 'Draft'].includes(doc.status) && <p className="muted small" style={{ marginTop: 6 }}>Submission is performed by the responsible contractor / vendor.</p>}
      </>}

      {doc.signatures.length > 0 && (
        <>
          <h3>Sign-off record</h3>
          <div className="tablewrap"><table><tbody>{doc.signatures.map((s, i) => <tr key={i}>
            <td><b>{s.name}</b><small>{s.role}{s.email ? ` · ${s.email}` : ''}</small></td>
            <td>{s.meaning && <b>{s.meaning}</b>}<small>{s.reason}</small></td>
            <td>{fmtDate(s.at)}<small>bound to {R(s.rev)}{s.checksum ? ` · ${s.checksum.slice(0, 10)}…` : ''}</small>{verified?.[i] && <small><Badge tone={verified[i] === 'Valid' ? 'green' : verified[i] === 'Altered' ? 'red' : ''} dot={false}>{verified[i] === 'Valid' ? 'Signature verified' : verified[i]}</Badge></small>}</td>
          </tr>)}</tbody></table></div>
          <button className="btn sm" style={{ marginTop: 6 }} onClick={async () => { try { const r = await api<{ signatures: { status: string }[] }>('GET', `/projects/${encodeURIComponent(current!)}/docs/${encodeURIComponent(id)}/signatures/verify`); setVerified(r.signatures.map((x) => x.status)) } catch (e) { useStore.getState().toast(errorText(e), 'warn') } }}>Verify signatures</button>
        </>
      )}

      <h3>Requirements this revision supports</h3>
      <div className="list">
        {linked.map((r) => <div key={r.id} className="row sb"><button className="link" onClick={() => open('req', r.id)}><MarketChip m={r.market} /> {r.title}</button><StateBadge s={evidenceState(r, docs)} /></div>)}
        {!linked.length && <p className="muted">Not linked to any requirement.</p>}
      </div>

      <RevisionRegister doc={doc} />

      <h3>Version history</h3>
      <p className="muted small" style={{ margin: '0 0 6px' }}>Every working step, including the ones that never became a formal revision.</p>
      <div className="tablewrap"><table><tbody>{[...doc.history].reverse().map((h, i) => <tr key={i}><td><span className="rev">{R(h.rev)}</span></td><td>{h.status}{h.note && <small>{h.note}</small>}</td><td>{h.by}<small>{fmtDate(h.at)}</small></td></tr>)}</tbody></table></div>
      <p style={{ marginTop: 10 }}><button className="link small" onClick={() => go('comments')}>View technical comments →</button></p>
    </Drawer>
  )
}

/** Register details (Consultant / Owner / QA) and void / supersede / reinstate (Owner / QA) of one document. */
function DocRegister({ id }: { id: string }) {
  const { docs, role, updateDocDetails, voidDoc, reinstateDoc } = useStore()
  const act = useAct()
  const doc = docs.find((d) => d.id === id)!
  const init = { title: doc.title, number: doc.number, discipline: doc.discipline, system: doc.system, owner: doc.owner, due: doc.due, critical: doc.critical }
  const [f, setF] = useState(init)
  const [why, setWhy] = useState('')
  const [mode, setMode] = useState<'edit' | 'void' | null>(null)
  const [by, setBy] = useState('')
  const set = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v })
  const inactive = !isActiveDoc(doc)
  const changed = (Object.keys(init) as (keyof typeof init)[]).some((k) => f[k] !== init[k])
  if (role === 'Contractor') return null
  if (inactive) {
    return role === 'Owner / QA' ? (
      <>
        <h3>Reinstate</h3>
        <textarea className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why is the document reinstated? (e.g. voided by mistake)" aria-label="Reinstate reason" />
        <button className="btn" style={{ marginTop: 6 }} onClick={async () => { const er = await act(reinstateDoc(id, why), 'Document reinstated'); if (!er) setWhy('') }}>Reinstate {doc.id}</button>
        <p className="muted small" style={{ marginTop: 4 }}>Evidence links withdrawn when it was voided stay withdrawn; link the document again where it applies.</p>
      </>
    ) : null
  }
  const candidates = docs.filter((d) => d.id !== id && isActiveDoc(d))
  return (
    <>
      <h3>Register</h3>
      <div className="row wrap">
        <button className={`btn sm ${mode === 'edit' ? 'pri' : ''}`} onClick={() => { setMode(mode === 'edit' ? null : 'edit'); setF(init); setWhy('') }}>Edit details</button>
        {role === 'Owner / QA' && <button className={`btn sm ${mode === 'void' ? 'danger' : ''}`} onClick={() => { setMode(mode === 'void' ? null : 'void'); setWhy('') }}>Void / supersede</button>}
      </div>
      {mode === 'edit' && (
        <div style={{ marginTop: 8 }}>
          {doc.status === 'Under review' && <div className="notice small">{R(doc.rev)} is under review: title, number and discipline cannot change until the review is finished or the document is returned.</div>}
          <div className="grid g2">
            <div style={{ gridColumn: '1 / -1' }}><label className="lab">Title</label><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} aria-label="Edit title" /></div>
            <div><label className="lab">Document number</label><input className="input" value={f.number} onChange={(e) => set('number', e.target.value)} aria-label="Edit document number" /></div>
            <div><label className="lab">Due</label><input className="input" type="date" value={f.due} onChange={(e) => set('due', e.target.value)} aria-label="Edit due" /></div>
            <div><label className="lab">Discipline</label><DisciplineSelect value={f.discipline} onChange={(v) => set('discipline', v)} label="Edit discipline" /></div>
            <div><label className="lab">System</label><SystemSelect value={f.system} onChange={(v) => set('system', v)} label="Edit system" /></div>
            <div><label className="lab">Responsible company</label><CompanySelect value={f.owner} onChange={(v) => set('owner', v)} label="Edit responsible company" /></div>
            <div><label className="lab">Criticality</label><label className="row" style={{ height: 30 }}><input type="checkbox" checked={f.critical} onChange={(e) => set('critical', e.target.checked)} /><span className="small">Critical record</span></label></div>
          </div>
          <label className="lab">Reason for the change (audit trail)</label>
          <input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Due date moved per vendor schedule rev 3" aria-label="Change reason" />
          <button className="btn pri" style={{ marginTop: 8 }} disabled={!changed} onClick={async () => { const er = await act(updateDocDetails(id, { ...f, reason: why }), 'Register details saved'); if (!er) { setMode(null); setWhy('') } }}>Save details</button>
        </div>
      )}
      {mode === 'void' && (
        <div style={{ marginTop: 8 }}>
          <p className="muted small" style={{ margin: 0 }}>A void or superseded document stays in the register as read-only history. Its evidence links are withdrawn; when superseded, the replacement is linked to the same requirements for fresh assessment.</p>
          <label className="lab">Superseded by (optional)</label>
          <select className="input" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Superseded by"><option value="">— not replaced (void) —</option>{candidates.map((d) => <option key={d.id} value={d.id}>{d.id}{d.number ? ` · ${d.number}` : ''} · {d.title}</option>)}</select>
          <label className="lab">Reason</label>
          <textarea className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={by ? 'Why does the new document replace this one?' : 'Why is this document no longer required?'} aria-label="Void reason" />
          <button className="btn danger" style={{ marginTop: 8 }} disabled={doc.status === 'Under review'} onClick={async () => { const er = await act(voidDoc(id, why, by || undefined), by ? `${doc.id} superseded by ${by}` : `${doc.id} voided`); if (!er) { setMode(null); setWhy(''); setBy('') } }}>{by ? `Supersede by ${by}` : `Void ${doc.id}`}</button>
          {doc.status === 'Under review' && <span className="muted small"> Return the document first: its approval route is open.</span>}
        </div>
      )}
    </>
  )
}

export function ReqDrawer({ id }: { id: string }) {
  const { reqs, docs, role, decideApplicability, linkEvidence, assessEvidence, addAction, withdrawEvidence } = useStore()
  const open = useUI((s) => s.open)
  const act = useAct()
  const r = reqs.find((x) => x.id === id)!
  const [app, setApp] = useState<Applicability>(r.applicability)
  const [why, setWhy] = useState(r.rationale)
  const linkable = docs.filter((d) => d.status !== 'Missing' && isActiveDoc(d))
  const [docId, setDocId] = useState(linkable[0]?.id ?? '')
  const [withdraw, setWithdraw] = useState<number | null>(null)
  const [wreason, setWreason] = useState('')
  const [note, setNote] = useState('')
  const [assess, setAssess] = useState<number | null>(null)
  const [areason, setAreason] = useState('')
  const [gap, setGap] = useState('')
  const [clause, setClause] = useState(r.clause)
  const [ver, setVer] = useState(r.sourceVersion)
  const [eff, setEff] = useState(r.effective)
  const [attest, setAttest] = useState(r.sourceAttested)
  const { setSourceRef, updateRequirement } = useStore()
  const [sys, setSys] = useState(r.system)
  const [owner, setOwner] = useState(r.owner)
  const [due, setDue] = useState(r.due)
  const m = markets[r.market]
  const reviewer = role !== 'Contractor'

  return (
    <Drawer kicker={`${r.id} · Requirement · ${m.name}`} title={r.title} right={<StateBadge s={evidenceState(r, docs)} />}>
      <div className="kv">
        <div><small>Authority</small>{m.authority}</div>
        <div><small>System / discipline</small>{r.system || 'System not assigned'} · {r.discipline}</div>
        <div><small>Applicability</small><Applic a={r.applicability} /></div>
        <div><small>Owner / due</small>{r.owner} · {r.due}</div>
        <div><small>Origin</small>{r.libraryKey ? `Requirement library ${r.market} v${r.libraryVersion} · ${r.libraryKey}` : 'Project-specific requirement'}</div>
        <div style={{ gridColumn: '1 / -1' }}><small>Source reference</small>{r.topic}<br /><span className="muted">{m.base}</span> · <a href={m.url} target="_blank" rel="noopener noreferrer">Official source <ExternalLink size={11} /></a></div>
      </div>
      {!r.clause && <div className="notice small">Clause, source version and effective date are <b>not recorded</b>. A qualified regulatory reviewer must confirm them against the official text before this requirement is relied on.</div>}

      {reviewer && <>
        <h3>System, owner and due date</h3>
        <div className="grid g3">
          <div><label className="lab" style={{ marginTop: 0 }}>System</label><SystemSelect value={sys} onChange={setSys} /></div>
          <div><label className="lab" style={{ marginTop: 0 }}>Owner</label><input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Requirement owner" /></div>
          <div><label className="lab" style={{ marginTop: 0 }}>Due</label><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Requirement due" /></div>
        </div>
        <button className="btn" style={{ marginTop: 8 }} disabled={sys === r.system && owner === r.owner && due === r.due} onClick={() => act(updateRequirement(id, { system: sys, owner, due }), 'Requirement details saved')}>Save details</button>
      </>}

      <h3>Clause, source version and effective date</h3>
      <div className="grid g3">
        <div><label className="lab" style={{ marginTop: 0 }}>Clause / section</label><input className="input" disabled={!reviewer} value={clause} onChange={(e) => setClause(e.target.value)} placeholder="Enter from the official text" /></div>
        <div><label className="lab" style={{ marginTop: 0 }}>Source version</label><input className="input" disabled={!reviewer} value={ver} onChange={(e) => setVer(e.target.value)} placeholder="Edition / amendment" /></div>
        <div><label className="lab" style={{ marginTop: 0 }}>Effective date</label><input className="input" type="date" disabled={!reviewer} value={eff} aria-label="Source effective date" onChange={(e) => setEff(e.target.value)} /></div>
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
              if (e.decision === 'Withdrawn') return (
                <tr key={i} style={{ opacity: 0.65 }}>
                  <td style={{ width: '58%' }}><button className="link" style={{ textDecoration: 'line-through' }} onClick={() => open('doc', e.doc)}>{d.title}</button> <span className="rev">{R(e.rev)}</span><small>{e.note}</small>{e.reason && <small>Withdrawn ({e.reviewedBy}): {e.reason}</small>}</td>
                  <td><Badge dot={false}>Withdrawn</Badge></td><td />
                </tr>
              )
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
                          <button className="btn pri sm" onClick={async () => { const er = await act(assessEvidence(id, i, true, areason), 'Evidence accepted'); if (!er) setAssess(null) }}>Accept as fit</button>
                          <button className="btn sm" onClick={async () => { const er = await act(assessEvidence(id, i, false, areason), 'Evidence rejected'); if (!er) setAssess(null) }}>Reject</button>
                        </div>
                      </div>
                    )}
                    {withdraw === i && (
                      <div style={{ marginTop: 8 }}>
                        <input className="input" placeholder="Why is this link withdrawn?" value={wreason} onChange={(x) => setWreason(x.target.value)} aria-label="Withdraw reason" />
                        <div className="row" style={{ marginTop: 6 }}>
                          <button className="btn sm danger" onClick={async () => { const er = await act(withdrawEvidence(id, i, wreason), 'Evidence link withdrawn'); if (!er) { setWithdraw(null); setWreason('') } }}>Withdraw link</button>
                          <button className="btn sm" onClick={() => setWithdraw(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td><Badge tone={e.decision === 'Accepted' ? 'green' : e.decision === 'Rejected' ? 'red' : 'amber'}>{e.decision}</Badge></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{reviewer && assess !== i && withdraw !== i && <><button className="btn sm" onClick={() => setAssess(i)}>Assess</button> <button className="btn sm ghost" onClick={() => { setWithdraw(i); setAssess(null) }} aria-label={`Withdraw ${e.doc} link`}>Withdraw</button></>}</td>
                </tr>
              )
            })}
            {!r.evidence.some((e) => e.decision !== 'Withdrawn') && <tr><td className="muted" colSpan={3}>No evidence linked. This requirement cannot currently be evidenced.</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>Link a document revision</h3>
      <select className="input" value={docId} onChange={(e) => setDocId(e.target.value)} aria-label="Document to link">{linkable.map((d) => <option key={d.id} value={d.id}>{d.id} · {d.title} · {R(d.rev)} [{d.status}]</option>)}</select>
      <textarea className="input" style={{ marginTop: 6 }} placeholder="Which part of this requirement does the record support? (page / section)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn" style={{ marginTop: 6 }} disabled={!docId} onClick={() => act(linkEvidence(id, docId, note), 'Evidence linked to current revision')}>Link current revision</button>

      <h3>Corrective action</h3>
      <textarea className="input" placeholder="Describe the gap and the evidence that will close it…" value={gap} onChange={(e) => setGap(e.target.value)} />
      <button className="btn" style={{ marginTop: 6 }} onClick={async () => { const er = await act(addAction({ req: id, title: gap, owner: 'Contractor', due: plusDays(14), priority: 'High' }), 'Corrective action assigned'); if (!er) setGap('') }}>Assign action</button>
    </Drawer>
  )
}
