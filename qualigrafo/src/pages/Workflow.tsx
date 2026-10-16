import { useState } from 'react'
import { FileUp, GitCompare } from 'lucide-react'
import { useStore } from '../store'
import type { EventCategory } from '../types'
import { Badge, Empty, PageHead, R, fmtDate, useUI } from '../components/ui'

const CAT_TONE: Record<EventCategory, string> = { Routing: 'blue', Signature: 'green', Reminder: 'amber', Revision: 'violet', Issue: 'teal', Source: 'blue', 'Issue status': '' }

export function Activity() {
  const { events, automation, setAutomation, simulateReminders, markAllRead, role, toast } = useStore()
  const open = useUI((s) => s.open)
  const [cat, setCat] = useState<'all' | EventCategory | 'mine'>('all')
  const rows = events.filter((e) => (cat === 'all' ? true : cat === 'mine' ? e.forRole === role : e.category === cat))
  const rules: { k: keyof typeof automation; t: string; d: string }[] = [
    { k: 'routing', t: 'Route automatically', d: 'On submission and after each sign-off the next assigned role receives a signature request.' },
    { k: 'reminders', t: 'Reminders', d: 'Waiting sign-offs generate reminder previews. A missed deadline never approves a document.' },
    { k: 'autoIssue', t: 'Controlled issue after final sign-off', d: 'A metadata issue manifest is generated once every stage has signed the same revision.' },
  ]
  return (
    <>
      <PageHead title="Updates & automation" sub="One feed for signature requests, reminders, revision changes and issue status. Routing and issuing are automatic; every decision still needs an authorised person." actions={<button className="btn" onClick={markAllRead}>Mark all read</button>} />
      <div className="grid g21">
        <section className="card flush">
          <h2>Update feed <span className="muted small" style={{ fontWeight: 400 }}>in-app simulation · no email or message is sent</span></h2>
          <div style={{ padding: '10px 16px 0' }} className="filters">
            <div className="seg">{(['all', 'mine', 'Routing', 'Signature', 'Reminder', 'Revision', 'Source', 'Issue', 'Issue status'] as const).map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c === 'mine' ? `For ${role}` : c === 'all' ? 'All' : c}</button>)}</div>
          </div>
          <div className="tablewrap" style={{ border: 0 }}>
            <table>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} style={e.read ? undefined : { background: '#f4fafa' }}>
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
                <input type="checkbox" checked={automation[r.k]} onChange={(e) => setAutomation(r.k, e.target.checked)} style={{ marginTop: 3 }} />
                <span><b>{r.t}</b><span className="muted small" style={{ display: 'block' }}>{r.d}</span></span>
              </label>
            ))}
            <button className="btn" style={{ marginTop: 10 }} onClick={() => { const er = simulateReminders(); toast(er ?? 'Reminder previews added to the feed', er ? 'warn' : 'ok') }}>Simulate reminder cycle</button>
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
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')

export function Sources() {
  const { revitMode, setRevit, docs, imports, importSource, toast, role } = useStore()
  const open = useUI((s) => s.open)
  const [docId, setDocId] = useState('DOC-005')
  const [file, setFile] = useState<{ name: string; size: number; sha: string } | null>(null)
  const [preview, setPreview] = useState(false)
  const doc = docs.find((d) => d.id === docId)!
  const rev = doc.rev + 1
  const pending = doc.status === 'Under review'

  // deterministic sample Revit snapshot; changes with every import so duplicates are detectable only if repeated
  const snapshot = { model: 'DEMO-MODEL-ELEC-A', version: `PUBLISH-${imports.filter((i) => i.mode === 'Revit').length + 1}`, changes: [{ el: 'DEMO-ELEMENT-MDB-01', kind: 'Parameter changed', detail: 'Feeder rating 400 A → 630 A' }, { el: 'DEMO-ELEMENT-CBL-114', kind: 'Element added', detail: 'New cable tray segment' }, { el: 'DEMO-ELEMENT-SHT-E05', kind: 'Sheet revised', detail: 'Single-line diagram re-issued' }] }

  const choose = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 20 * 1024 * 1024) return toast('Prototype limit: 20 MB', 'warn')
    if (!globalThis.crypto?.subtle) return toast('Checksum API unavailable in this browser.', 'warn')
    const sha = hex(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))
    setFile({ name: f.name, size: f.size, sha })
  }
  const doImport = (mode: 'Standalone' | 'Revit') => {
    const label = mode === 'Revit' ? `${snapshot.model} ${snapshot.version}` : file?.name ?? ''
    const sum = mode === 'Revit' ? `revit:${snapshot.model}:${snapshot.version}` : file?.sha ?? ''
    const er = importSource(docId, mode, label, sum)
    if (er) return toast(er, 'warn')
    toast(`${docId} R${rev} created as a draft. Fresh approval required.`)
    setPreview(false); setFile(null)
  }

  return (
    <>
      <PageHead title="Sources: Revit and standalone" sub="Two ways in, one controlled register. Either source creates a candidate draft revision that goes through the same review and sign-off — it never overwrites an approved record." actions={<div className="seg"><button className={!revitMode ? 'on' : ''} onClick={() => setRevit(false)}>Without Revit</button><button className={revitMode ? 'on' : ''} onClick={() => setRevit(true)}>Revit connector</button></div>} />
      <div className="grid g21">
        <section className="card">
          <h2>{revitMode ? 'Revit: preview a published snapshot' : 'Standalone: add a source file'} <Badge tone="amber">{revitMode ? 'Connector not installed · simulation' : 'Checksum computed in browser · file not uploaded'}</Badge></h2>
          <label className="lab" style={{ marginTop: 0 }}>Target document</label>
          <select className="input" value={docId} onChange={(e) => { setDocId(e.target.value); setPreview(false) }}>{docs.filter((d) => d.status !== 'Missing' || true).map((d) => <option key={d.id} value={d.id}>{d.id} · {d.title} · {R(d.rev)} [{d.status}]</option>)}</select>

          {revitMode ? (
            <>
              <div style={{ marginTop: 12 }} className="row"><button className="btn pri" onClick={() => setPreview(true)}><GitCompare size={14} /> Preview sample Revit update</button></div>
              {preview && (
                <div style={{ marginTop: 12 }}>
                  <div className="kv"><div><small>Model source</small>{snapshot.model}</div><div><small>Published version</small>{snapshot.version}</div><div><small>Current record</small>{doc.id} {R(doc.rev)} · {doc.status}</div><div><small>Proposed candidate</small>{R(rev)} · Draft</div></div>
                  <div className="tablewrap"><table><thead><tr><th>Element (UniqueId)</th><th>Change</th><th>Detail</th></tr></thead><tbody>{snapshot.changes.map((c) => <tr key={c.el}><td>{c.el}</td><td><Badge tone="blue">{c.kind}</Badge></td><td>{c.detail}</td></tr>)}</tbody></table></div>
                  {pending && <div className="notice" style={{ marginTop: 10 }}>This document is currently <b>under review</b>. Importing will cancel its pending approval route; earlier sign-offs remain on {R(doc.rev)}.</div>}
                  <div className="row" style={{ marginTop: 10 }}><button className="btn pri" onClick={() => doImport('Revit')}>Import as draft {R(rev)}</button><button className="btn" onClick={() => setPreview(false)}>Discard preview</button></div>
                </div>
              )}
              <p className="muted small" style={{ marginTop: 12 }}>Production: an add-in publishes selected sheets and elements keyed by source-model ID + element UniqueId + version. Change detection queues IDs only; the model is never edited from a background thread.</p>
            </>
          ) : (
            <>
              <label className="lab">Source file (PDF, Word, Excel, CSV, DWG, IFC)</label>
              <input className="input" type="file" accept=".pdf,.docx,.xlsx,.csv,.dwg,.ifc,.png,.jpg" style={{ height: 'auto', padding: 6 }} onChange={(e) => choose(e.target.files?.[0])} />
              {file && (
                <div style={{ marginTop: 12 }}>
                  <div className="kv"><div><small>File</small>{file.name}</div><div><small>Size</small>{file.size.toLocaleString()} bytes</div><div style={{ gridColumn: '1 / -1' }}><small>SHA-256</small><span style={{ wordBreak: 'break-all', fontSize: 11 }}>{file.sha}</span></div></div>
                  {pending && <div className="notice">This document is under review. Importing will cancel the pending route.</div>}
                  <div className="row" style={{ marginTop: 10 }}><button className="btn pri" onClick={() => doImport('Standalone')}><FileUp size={14} /> Create draft {R(rev)} from this file</button></div>
                </div>
              )}
              <p className="muted small" style={{ marginTop: 12 }}>Duplicate bytes are detected by checksum. Filenames or tags never merge records on their own. The file itself is not stored in this prototype.</p>
            </>
          )}
          {role === 'Owner / QA' && <p className="muted small" style={{ marginTop: 8 }}>Imports are normally performed by the responsible contractor or the connector; previewing as Owner / QA here.</p>}
        </section>

        <section className="card flush" style={{ alignSelf: 'start' }}>
          <h2>Import history</h2>
          <div className="tablewrap" style={{ border: 0 }}>
            <table>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td><b>{i.id}</b> <Badge tone="blue">{i.mode}</Badge><small>{i.label}</small></td>
                    <td><button className="link" onClick={() => open('doc', i.doc)}>{i.doc}</button><small>{R(i.fromRev)} → {R(i.toRev)}{i.cancelledRoute ? ' · route cancelled' : ''}</small></td>
                    <td className="muted" style={{ textAlign: 'right' }}>{fmtDate(i.at)}</td>
                  </tr>
                ))}
                {!imports.length && <tr><td><Empty title="No imports yet">Previewed or uploaded sources appear here.</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  )
}
