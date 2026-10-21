import { Fragment, useMemo, useState } from 'react'
import { Check, Download, Send } from 'lucide-react'
import { activeDocs, useStore } from '../store'
import { CompanySelect } from '../components/Pickers'
import { Badge, DocBadge, Empty, PageHead, R, fmtDate } from '../components/ui'

const PURPOSES = ['For approval', 'For review / comment', 'For information', 'For construction', 'As built']

function NewTransmittal({ onClose }: { onClose: () => void }) {
  const { docs, createTransmittal, toast } = useStore()
  const [to, setTo] = useState('')
  const [purpose, setPurpose] = useState('')
  const [note, setNote] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const sendable = useMemo(() => activeDocs(docs).filter((d) => d.status !== 'Missing'), [docs])
  const shown = sendable.filter((d) => `${d.id} ${d.number} ${d.title} ${d.owner}`.toLowerCase().includes(q.toLowerCase()))
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id])
  const issue = async () => {
    setBusy(true)
    const er = await createTransmittal({ to, purpose, note, docs: sel })
    setBusy(false)
    if (er) toast(er, 'warn'); else { toast('Transmittal issued'); onClose() }
  }
  return (
    <section className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>New transmittal</h2>
      <div className="grid g3">
        <div><label className="lab" style={{ marginTop: 0 }}>To (company)</label><CompanySelect value={to} onChange={setTo} label="Transmittal recipient" /></div>
        <div><label className="lab" style={{ marginTop: 0 }}>Purpose</label><select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Transmittal purpose"><option value="">Choose…</option>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div><label className="lab" style={{ marginTop: 0 }}>Remarks</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Transmittal remarks" /></div>
      </div>
      <label className="lab">Documents ({sel.length} selected) — the current revision of each is transmitted</label>
      <input className="input" placeholder="Filter by number, title or company…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter documents" />
      <div className="tablewrap" style={{ marginTop: 6, maxHeight: 280, overflow: 'auto' }}><table>
        <tbody>
          {shown.map((d) => (
            <tr key={d.id} className="clickrow" onClick={() => toggle(d.id)}>
              <td style={{ width: 28 }}><input type="checkbox" checked={sel.includes(d.id)} onChange={() => toggle(d.id)} onClick={(e) => e.stopPropagation()} aria-label={`Include ${d.id}`} /></td>
              <td>{d.title}<small>{d.number ? `${d.number} · ` : ''}{d.id} · {d.owner}</small></td>
              <td><span className="rev">{R(d.rev)}</span></td>
              <td><DocBadge s={d.status} /></td>
            </tr>
          ))}
          {!shown.length && <tr><td><Empty title="No documents with a revision" /></td></tr>}
        </tbody>
      </table></div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn pri" disabled={busy || !sel.length} onClick={issue}><Send size={13} /> Issue transmittal</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </section>
  )
}

export default function Transmittals() {
  const { transmittals, role, scope, downloadReport, acknowledgeTransmittal, toast } = useStore()
  const [form, setForm] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [ack, setAck] = useState('')
  const reviewer = role !== 'Contractor'
  return (
    <>
      <PageHead title="Transmittals" sub="Controlled, numbered records of which document revisions were sent to which company and why. Each transmittal freezes the revision, file checksum and approvals at the moment of issue; the recipient confirms receipt."
        actions={reviewer ? <button className="btn pri" onClick={() => setForm(!form)}><Send size={14} /> New transmittal</button> : undefined} />
      {form && <NewTransmittal onClose={() => setForm(false)} />}
      <div className="tablewrap">
        <table>
          <thead><tr><th>Transmittal</th><th>To</th><th>Purpose</th><th>Documents</th><th>Issued</th><th>Receipt</th><th /></tr></thead>
          <tbody>
            {transmittals.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td><button className="link" onClick={() => setOpen(open === t.id ? null : t.id)}><b>{t.id}</b></button>{t.note && <small>{t.note}</small>}</td>
                  <td>{t.to}</td>
                  <td>{t.purpose}</td>
                  <td>{t.items.length}</td>
                  <td>{fmtDate(t.at)}<small>{t.by} · {t.byRole}</small></td>
                  <td>{t.ack ? <><Badge tone="green" dot={false}>Acknowledged</Badge><small>{t.ack.by} · {fmtDate(t.ack.at)}</small></> : <Badge tone="amber" dot={false}>Awaiting receipt</Badge>}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}><button className="btn sm" onClick={() => downloadReport(`/transmittals/${t.id}/report.pdf`, `${t.id}.pdf`)}><Download size={12} /> PDF</button></td>
                </tr>
                {open === t.id && (
                  <tr><td colSpan={7}>
                    <div className="tablewrap"><table><tbody>
                      {t.items.map((i) => <tr key={i.doc}><td>{i.title}<small>{i.number ? `${i.number} · ` : ''}{i.doc}{i.fileName ? ` · ${i.fileName}` : ''}</small></td><td><span className="rev">{R(i.rev)}</span></td><td>{i.status}</td><td><small>{i.checksum ? `SHA-256 ${i.checksum.slice(0, 16)}…` : 'No source file on this revision'}</small></td><td>{i.signatures.length ? i.signatures.map((s) => `${s.name} (${s.meaning || s.role})`).join('; ') : <span className="muted small">Not signed</span>}</td></tr>)}
                    </tbody></table></div>
                    {t.ack?.note && <p className="small" style={{ marginTop: 6 }}><b>Receipt remark:</b> {t.ack.note}</p>}
                    {!t.ack && role === 'Contractor' && (!scope || scope === t.to) && (
                      <div className="row" style={{ marginTop: 8 }}>
                        <input className="input" value={ack} onChange={(e) => setAck(e.target.value)} placeholder="Remark (optional), e.g. received complete" aria-label="Receipt remark" />
                        <button className="btn pri sm" onClick={async () => { const er = await acknowledgeTransmittal(t.id, ack); if (er) toast(er, 'warn'); else { toast(`${t.id} receipt acknowledged`); setAck('') } }}><Check size={12} /> Acknowledge receipt</button>
                      </div>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
            {!transmittals.length && <tr><td colSpan={7}><Empty title="No transmittals yet">{reviewer ? 'Issue one to send document revisions to a company for approval, information or construction.' : 'Transmittals addressed to your company appear here.'}</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
