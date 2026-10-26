import { useState } from 'react'
import { activeDocs, sourcePlan, useStore } from '../store'
import { Box } from 'lucide-react'
import { SourceUploader, fmtBytes } from '../components/Files'
import type { EventCategory } from '../types'
import { Badge, Empty, PageHead, R, fmtDate, useUI } from '../components/ui'

const CAT_TONE: Record<EventCategory, string> = { Routing: 'blue', Signature: 'green', Reminder: 'amber', Revision: 'violet', Issue: 'teal', Source: 'blue', 'Issue status': '' }

export function Activity() {
  const { events, automation, setAutomation, sendReminders, markAllRead, role, toast } = useStore()
  const reviewer = role !== 'Contractor'
  const toggle = async (k: keyof typeof automation, v: boolean) => { const er = await setAutomation(k, v); toast(er ?? `Rule ${v ? 'enabled' : 'disabled'}`, er ? 'warn' : 'ok') }
  const open = useUI((s) => s.open)
  const [cat, setCat] = useState<'all' | EventCategory | 'mine'>('all')
  const rows = events.filter((e) => (cat === 'all' ? true : cat === 'mine' ? e.forRole === role : e.category === cat))
  const rules: { k: keyof typeof automation; t: string; d: string }[] = [
    { k: 'routing', t: 'Route automatically', d: 'On submission and after each sign-off the next assigned role receives a signature request.' },
    { k: 'reminders', t: 'Reminders', d: 'Daily reminders (in-app and e-mail) for waiting sign-offs and overdue or soon-due documents, RFIs, NCRs and actions; signers can also be reminded now. A missed deadline never approves a document.' },
    { k: 'autoIssue', t: 'Controlled issue after final sign-off', d: 'A metadata issue manifest is generated once every stage has signed the same revision.' },
  ]
  return (
    <>
      <PageHead title="Updates & automation" sub="One feed for signature requests, reminders, revision changes and issue status. Routing and issuing are automatic; every decision still needs an authorised person." actions={<button className="btn" onClick={() => void markAllRead()}>Mark all read</button>} />
      <div className="grid g21">
        <section className="card flush">
          <h2>Update feed <span className="muted small" style={{ fontWeight: 400 }}>in-app notifications</span></h2>
          <div style={{ padding: '10px 16px 0' }} className="filters">
            <div className="seg">{(['all', 'mine', 'Routing', 'Signature', 'Reminder', 'Revision', 'Source', 'Issue', 'Issue status'] as const).map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c === 'mine' ? `For ${role}` : c === 'all' ? 'All' : c}</button>)}</div>
          </div>
          <div className="tablewrap" style={{ border: 0 }}>
            <table>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} style={e.read ? undefined : { background: 'rgba(37, 99, 235, 0.06)' }}>
                    <td style={{ width: 110 }}><Badge tone={CAT_TONE[e.category]}>{e.category}</Badge></td>
                    <td>{e.text}<small>{e.doc && <button className="link" style={{ fontSize: 11.5 }} onClick={() => open('doc', e.doc!)}>Open {e.doc}</button>}{e.doc && e.forRole ? ' · ' : ''}{e.forRole && `To: ${e.forRole}`}</small></td>
                    <td className="muted" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{fmtDate(e.at)}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td><Empty title="No updates" /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid" style={{ alignSelf: 'start' }}>
          <section className="card">
            <h2>Workflow rules</h2>
            {rules.map((r) => (
              <label key={r.k} className="row" style={{ alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line-2)' }}>
                <input type="checkbox" checked={automation[r.k]} disabled={!reviewer} onChange={(e) => void toggle(r.k, e.target.checked)} style={{ marginTop: 3 }} />
                <span><b>{r.t}</b><span className="muted small" style={{ display: 'block' }}>{r.d}</span></span>
              </label>
            ))}
            {!reviewer && <p className="muted small" style={{ marginTop: 8 }}>Only Consultant or Owner / QA can change workflow rules.</p>}
            <button className="btn" style={{ marginTop: 10 }} disabled={!reviewer} onClick={async () => { const er = await sendReminders(); toast(er ?? 'Reminders sent to the waiting signers', er ? 'warn' : 'ok') }}>Send reminders now</button>
            <p className="muted small" style={{ marginTop: 8 }}>Rules affect future events only; routes already in progress keep their state.</p>
          </section>
          <section className="card">
            <h2>Approval route</h2>
            <div className="steps" style={{ marginBottom: 8 }}>{['Submit', 'Consultant', 'Owner / QA', 'Controlled issue'].map((x) => <span key={x} className="step on">{x}</span>)}</div>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Each signer confirms the exact revision.</li>
              <li>Fresh revision means fresh approval; earlier signatures never carry forward.</li>
              <li>A changed source cancels the pending route.</li>
              <li>Returned or rejected revisions cannot be issued.</li>
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- sources */
/** Model snapshots published by the Revit add-in; the contractor imports one into a document as its source. */
function RevitSnapshots() {
  const { connector, docs, role, importRevit, toast, revitMode } = useStore()
  const [snapId, setSnapId] = useState(connector.models[0]?.snapshots[0]?.id ?? '')
  const [docId, setDocId] = useState(activeDocs(docs)[0]?.id ?? '')
  const all = connector.models.flatMap((m) => m.snapshots.map((s) => ({ m, s })))
  const cur = all.find((x) => x.s.id === snapId) ?? all[0]
  const doc = docs.find((d) => d.id === docId) ?? activeDocs(docs)[0]
  const plan = doc ? sourcePlan(doc) : null
  const run = async () => {
    if (!cur || !doc) return
    const er = await importRevit(doc.id, cur.s.id)
    toast(er ?? (plan!.inPlace ? `${cur.m.name} ${cur.s.version} attached to ${doc.id} ${R(plan!.toRev)}` : `${doc.id} ${R(plan!.toRev)} created from ${cur.m.name} ${cur.s.version}. Fresh approval required.`), er ? 'warn' : 'ok')
  }
  if (!all.length) return (
    <section className="card">
      <h2><span><Box size={14} style={{ verticalAlign: -2 }} /> Revit model snapshots</span> <Badge tone={revitMode ? 'green' : ''}>{revitMode ? 'Integration on' : 'Integration off'}</Badge></h2>
      <Empty title="No model published yet">The Revit add-in publishes model snapshots with a connector token (Setup → Integrations). They appear here, ready to import into documents.</Empty>
    </section>
  )
  return (
    <section className="card">
      <h2><span><Box size={14} style={{ verticalAlign: -2 }} /> Revit model snapshots</span> <Badge tone={revitMode ? 'green' : ''}>{revitMode ? 'Integration on' : 'Integration off'}</Badge></h2>
      <label className="lab" style={{ marginTop: 0 }}>Published snapshot</label>
      <select className="input" value={cur?.s.id} onChange={(e) => setSnapId(e.target.value)} aria-label="Model snapshot">{all.map(({ m, s }) => <option key={s.id} value={s.id}>{m.name} · {s.version} · {fmtDate(s.publishedAt)} · {s.publishedBy}</option>)}</select>
      {cur && (
        <div className="tablewrap" style={{ marginTop: 10, maxHeight: 240 }}><table>
          <thead><tr><th>Element (UniqueId)</th><th>Change</th><th>Detail</th></tr></thead>
          <tbody>{cur.s.changes.map((ch, i) => <tr key={i}><td>{ch.elementId}</td><td><Badge tone="blue" dot={false}>{ch.kind}</Badge></td><td>{ch.detail || <span className="muted">—</span>}</td></tr>)}
            {!cur.s.changes.length && <tr><td colSpan={3} className="muted">No element changes listed ({cur.s.elementCount} element(s) in the snapshot).</td></tr>}</tbody>
        </table></div>
      )}
      {role === 'Contractor' ? (
        <>
          <label className="lab">Import into document</label>
          <select className="input" value={doc?.id} onChange={(e) => setDocId(e.target.value)} aria-label="Document for the snapshot">{activeDocs(docs).map((d) => <option key={d.id} value={d.id}>{d.id} · {d.title} · {R(d.rev)} [{d.status}]</option>)}</select>
          {doc && plan && <div className={`notice ${plan.cancelsRoute ? '' : 'info'} small`} style={{ marginTop: 8 }}>{plan.inPlace ? <>Attaches to draft <b>{doc.id} {R(plan.toRev)}</b>.</> : <>Creates a new draft <b>{R(plan.toRev)}</b>; {R(doc.rev)} ({doc.status}) is kept.{plan.cancelsRoute && <> Its <b>pending approval route will be cancelled</b>.</>}</>}</div>}
          <button type="button" className="btn pri" style={{ marginTop: 10 }} onClick={run}>{plan?.inPlace ? `Attach to ${R(plan.toRev)}` : `Import as draft ${plan ? R(plan.toRev) : ''}`}</button>
        </>
      ) : <p className="muted small" style={{ marginTop: 10 }}>The responsible contractor imports snapshots into documents.</p>}
    </section>
  )
}

export function Sources() {
  const { docs, imports, downloadFile, toast, role, revitMode, connector } = useStore()
  const open = useUI((s) => s.open)
  const [docId, setDocId] = useState(activeDocs(docs)[0]?.id ?? '')
  const [tab, setTab] = useState<'files' | 'revit'>(revitMode ? 'revit' : 'files')
  const doc = docs.find((d) => d.id === docId) ?? activeDocs(docs)[0]
  const download = async (id: string, name: string) => { const er = await downloadFile(id, name); if (er) toast(er, 'warn') }
  const showRevit = revitMode || connector.models.length > 0

  return (
    <>
      <PageHead title="Source files" sub="Two ways in, one controlled register: upload a file, or import a model snapshot published by the Revit add-in. Either completes a draft or starts a new draft revision; an approved or submitted revision is never overwritten."
        actions={showRevit ? <div className="seg"><button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>File upload</button><button className={tab === 'revit' ? 'on' : ''} onClick={() => setTab('revit')}>Revit snapshots</button></div> : undefined} />
      <div className="grid g21">
        {tab === 'revit' && showRevit ? <RevitSnapshots /> : <section className="card">
          <h2>Upload a source file <Badge tone="green">Stored on the server · SHA-256 verified</Badge></h2>
          {!doc ? <Empty title="No documents in this project" /> : (
            <>
              <label className="lab" style={{ marginTop: 0 }}>Target document</label>
              <select className="input" value={doc.id} onChange={(e) => setDocId(e.target.value)} aria-label="Target document">{activeDocs(docs).map((d) => <option key={d.id} value={d.id}>{d.id} · {d.title} · {R(d.rev)} [{d.status}]</option>)}</select>
              <div style={{ marginTop: 12 }}>
                {role === 'Contractor' ? <SourceUploader key={doc.id} doc={doc} /> : <div className="notice info small">Source files are uploaded by the responsible contractor ({doc.owner}).</div>}
              </div>
              <p className="muted small" style={{ marginTop: 12 }}>The server computes the SHA-256 of the received bytes; identical content is rejected for the same document. File names never merge records on their own.</p>
            </>
          )}
        </section>}

        <section className="card flush" style={{ alignSelf: 'start' }}>
          <h2>Import history</h2>
          <div className="tablewrap" style={{ border: 0 }}>
            <table>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td><b>{i.id}</b> {i.mode === 'Revit' && <Badge tone="blue" dot={false}>Revit</Badge>}<small>{i.label}{i.file ? ` · ${fmtBytes(i.file.size)}` : ''}</small></td>
                    <td style={{ whiteSpace: 'nowrap' }}><button className="link" onClick={() => open('doc', i.doc)}>{i.doc}</button><small>{i.fromRev === i.toRev ? `attached to ${R(i.toRev)}` : `${R(i.fromRev)} → ${R(i.toRev)}`}{i.cancelledRoute ? ' · route cancelled' : ''}</small></td>
                    <td className="muted" style={{ textAlign: 'right' }}>{fmtDate(i.at)}{i.file && <div><button className="link small" onClick={() => download(i.file!.id, i.file!.name)}>Download</button></div>}</td>
                  </tr>
                ))}
                {!imports.length && <tr><td><Empty title="No files uploaded yet">Uploaded sources appear here.</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  )
}
