import { useMemo, useRef, useState } from 'react'
import { Download, FilePlus2, Paperclip, Upload } from 'lucide-react'
import { activeDocs, hasCurrentSource, isOverdue, plusDays, useRegisters, useStore } from '../store'
import type { ImportPreview, RegisterRow } from '../store'
import { Badge, DocBadge, Empty, PageHead, R, fmtDate, useUI } from '../components/ui'
import { CompanySelect, DisciplineSelect, SystemSelect } from '../components/Pickers'
import { parseCsv } from './Registers'

function NewDocument({ onClose }: { onClose: () => void }) {
  const { registerDoc, toast } = useStore()
  const [f, setF] = useState({ title: '', number: '', discipline: '', system: '', owner: '', due: plusDays(30), critical: false })
  const set = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v })
  const [busy, setBusy] = useState(false)
  const save = async () => { setBusy(true); const er = await registerDoc(f); setBusy(false); if (er) toast(er, 'warn'); else { toast('Document registered'); onClose() } }
  return (
    <section className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Register a document</h2>
      <p className="muted small" style={{ marginTop: 0 }}>Adds an expected deliverable to the register as Missing R00. The responsible company provides the file and submits it for review.</p>
      <div className="grid g4">
        <div style={{ gridColumn: 'span 2' }}><label className="lab">Title</label><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} aria-label="Document title" /></div>
        <div><label className="lab">Document number (optional)</label><input className="input" value={f.number} onChange={(e) => set('number', e.target.value)} placeholder="e.g. NPL-HVAC-DS-0001" aria-label="Document number" /></div>
        <div><label className="lab">Due</label><input className="input" type="date" value={f.due} onChange={(e) => set('due', e.target.value)} aria-label="Document due" /></div>
        <div><label className="lab">Discipline</label><DisciplineSelect value={f.discipline} onChange={(v) => set('discipline', v)} label="Document discipline" /></div>
        <div><label className="lab">System (optional)</label><SystemSelect value={f.system} onChange={(v) => set('system', v)} label="Document system" /></div>
        <div><label className="lab">Responsible company</label><CompanySelect value={f.owner} onChange={(v) => set('owner', v)} label="Responsible company" /></div>
        <div><label className="lab">Criticality</label><label className="row" style={{ height: 30 }}><input type="checkbox" checked={f.critical} onChange={(e) => set('critical', e.target.checked)} /><span className="small">Critical record</span></label></div>
      </div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn pri" disabled={busy} onClick={save}>Register document</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </section>
  )
}

const HEAD: Record<string, keyof RegisterRow> = {
  'document number': 'number', 'doc number': 'number', 'doc no': 'number', 'doc no.': 'number', 'document no': 'number', 'document no.': 'number', number: 'number', 'client document number': 'number',
  title: 'title', 'document title': 'title', description: 'title',
  discipline: 'discipline', system: 'system', 'system / equipment': 'system', tag: 'system', 'equipment tag': 'system',
  company: 'company', 'responsible company': 'company', responsible: 'company', vendor: 'company', originator: 'company',
  due: 'due', 'due date': 'due', 'planned date': 'due', 'planned submission': 'due', critical: 'critical', criticality: 'critical',
}
async function readRegister(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) { const { readXlsx } = await import('../xlsx'); return readXlsx(file) }
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls workbooks are not supported. Save the register as Excel Workbook (.xlsx) or CSV.')
  return parseCsv(await file.text())
}
async function toRows(table: string[][]): Promise<{ rows: RegisterRow[]; error: string | null }> {
  if (table.length < 2) return { rows: [], error: 'The sheet needs a header row and at least one document.' }
  const cols = table[0].map((h) => HEAD[h.trim().toLowerCase()])
  if (!cols.includes('number')) return { rows: [], error: 'Header must contain a "Document number" column (also: Title, Discipline, System, Company, Due, Critical).' }
  const { excelDate } = await import('../xlsx')
  return {
    error: null,
    rows: table.slice(1).map((r) => {
      const o: RegisterRow = { number: '' }
      cols.forEach((k, i) => {
        const v = (r[i] ?? '').trim()
        if (!k || (!v && k !== 'number')) return
        if (k === 'critical') o.critical = /^(y|yes|true|1|x|critical)$/i.test(v)
        else if (k === 'due') o.due = excelDate(v)
        else o[k] = v
      })
      return o
    }),
  }
}

function ImportRegister({ onClose }: { onClose: () => void }) {
  const { previewRegister, importRegister, toast } = useStore()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState('')
  const [rows, setRows] = useState<RegisterRow[]>([])
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const template = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['Document number,Title,Discipline,System,Company,Due,Critical\r\nNPL-HVAC-DS-0001,AHU-01 vendor datasheet,HVAC,AHU-01,AirCo,2026-12-15,yes\r\n'], { type: 'text/csv' }))
    a.download = 'document_register_template.csv'
    a.click()
  }
  const load = async (f: File) => {
    setFile(f.name); setPreview(null); setError(null); setBusy(true)
    try {
      const t = await toRows(await readRegister(f))
      if (t.error) { setError(t.error); setRows([]); return }
      setRows(t.rows)
      const r = await previewRegister(t.rows, f.name)
      if (r.error) setError(r.error); else setPreview(r.preview!)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const run = async () => {
    setBusy(true); const er = await importRegister(rows, file); setBusy(false)
    if (er) setError(er); else { toast(`Register imported: ${preview!.created.length} new, ${preview!.updated.length} updated`); onClose() }
  }
  return (
    <section className="card" style={{ marginBottom: 12 }}>
      <div className="row sb"><h2 style={{ margin: 0 }}>Import Master Document Register</h2><button className="btn sm ghost" style={{ whiteSpace: 'nowrap' }} onClick={template}><Download size={12} /> CSV template</button></div>
      <p className="muted small">Excel (.xlsx, first sheet) or CSV. Rows are matched on the <b>document number</b>: new numbers are registered as Missing R00, known ones get their title, discipline, system, company, due date and criticality updated (blank cells keep the current value). You see a preview first; the import is all-or-nothing.</p>
      <div className="row wrap">
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}><Upload size={13} /> Choose register file</button>
        <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden aria-label="Register file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = '' }} />
        {file && <span className="small">{file}{busy ? ' · reading…' : ''}</span>}
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      {error && <div className="notice err small" style={{ marginTop: 10 }} role="alert">{error}</div>}
      {preview && (
        <div style={{ marginTop: 12 }}>
          <div className="chips"><Badge tone="blue" dot={false}>{preview.created.length} new</Badge><Badge tone="amber" dot={false}>{preview.updated.length} updated</Badge><Badge dot={false}>{preview.unchanged} unchanged</Badge>{preview.errors.length > 0 && <Badge tone="red" dot={false}>{preview.errors.length} error(s)</Badge>}</div>
          <div className="tablewrap" style={{ marginTop: 8, maxHeight: 320, overflow: 'auto' }}><table>
            <thead><tr><th>Row</th><th>Result</th><th>Detail</th></tr></thead>
            <tbody>
              {preview.errors.map((e, i) => <tr key={`e${i}`}><td>{e.row}</td><td><Badge tone="red" dot={false}>Error</Badge></td><td>{e.error}</td></tr>)}
              {preview.created.map((c) => <tr key={`c${c.row}`}><td>{c.row}</td><td><Badge tone="blue" dot={false}>New</Badge></td><td><b>{c.number}</b> · {c.title}</td></tr>)}
              {preview.updated.map((u) => <tr key={`u${u.row}`}><td>{u.row}</td><td><Badge tone="amber" dot={false}>Update {u.code}</Badge></td><td><b>{u.number}</b><small>{u.changes.join(' · ')}</small></td></tr>)}
            </tbody>
          </table></div>
          {preview.errors.length ? <p className="small" style={{ marginTop: 8 }}>Correct the rows above in the file and choose it again. Nothing has been changed.</p> : (
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn pri" disabled={busy || !(preview.created.length + preview.updated.length)} onClick={run}>Import {preview.created.length} new and {preview.updated.length} updated</button>
              {!(preview.created.length + preview.updated.length) && <span className="muted small">The register already matches this file.</span>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function Documents() {
  const { docs, role } = useStore()
  const { allDisciplines } = useRegisters()
  const open = useUI((s) => s.open)
  const [q, setQ] = useState('')
  const [dsc, setDsc] = useState('all')
  const [st, setSt] = useState('all')
  const [panel, setPanel] = useState<'new' | 'import' | null>(null)
  const inactive = docs.length - activeDocs(docs).length
  const showVoid = st === 'Void' || st === 'Superseded'
  const rows = useMemo(() => docs.filter((d) => (showVoid || (d.status !== 'Void' && d.status !== 'Superseded')) && (dsc === 'all' || d.discipline === dsc) && (st === 'all' || d.status === st) && `${d.id} ${d.number} ${d.title} ${d.system} ${d.owner}`.toLowerCase().includes(q.toLowerCase())), [docs, showVoid, dsc, st, q])
  const csv = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const body = [['Document number', 'Code', 'Title', 'Discipline', 'System', 'Company', 'Due', 'Critical', 'Revision', 'Status'], ...docs.map((d) => [d.number, d.id, d.title, d.discipline, d.system, d.owner, d.due, d.critical ? 'yes' : 'no', R(d.rev), d.status])].map((x) => x.map(cell).join(',')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
    a.download = 'Qualigrafo_Document_Register.csv'
    a.click()
  }
  const reviewer = role !== 'Contractor'
  return (
    <>
      <PageHead title="Document register" sub="Controlled engineering records by discipline, each with a responsible company, revision, system and review state."
        actions={<>{reviewer && <><button className="btn" onClick={() => setPanel(panel === 'new' ? null : 'new')}><FilePlus2 size={14} /> New document</button><button className="btn" onClick={() => setPanel(panel === 'import' ? null : 'import')}><Upload size={14} /> Import register</button></>}<button className="btn" onClick={csv}><Download size={14} /> Export register</button></>} />
      {panel === 'new' && <NewDocument onClose={() => setPanel(null)} />}
      {panel === 'import' && <ImportRegister onClose={() => setPanel(null)} />}
      <div className="filters">
        <input className="input grow" placeholder="Search by number, title, system or company…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
        <select className="input" value={dsc} onChange={(e) => setDsc(e.target.value)} aria-label="Discipline"><option value="all">All disciplines</option>{allDisciplines.map((x) => <option key={x}>{x}</option>)}</select>
        <select className="input" value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status"><option value="all">All active statuses</option>{['Missing', 'Draft', 'Under review', 'Changes requested', 'Accepted', 'Void', 'Superseded'].map((x) => <option key={x}>{x}</option>)}</select>
        <span className="muted small">{rows.length} of {docs.length - (showVoid ? 0 : inactive)}{!showVoid && inactive ? ` · ${inactive} void / superseded hidden` : ''}</span>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Document</th><th>Discipline</th><th>System</th><th>Rev</th><th>Source</th><th>Responsible</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} style={d.voided ? { opacity: 0.7 } : undefined}>
                <td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button><small>{d.number ? `${d.number} · ` : ''}{d.id}{d.critical ? ' · Critical' : ''}</small></td>
                <td>{d.discipline}</td><td>{d.system || <span className="muted">—</span>}</td><td><span className="rev">{R(d.rev)}</span></td><td>{hasCurrentSource(d) ? <span title={d.file ? `${d.file.name} · SHA-256 ${d.file.sha256}` : `Revit snapshot ${d.checksum}`}><Paperclip size={13} className="srcmark" /> {d.file ? 'File' : 'Revit'}</span> : <span className="muted">—</span>}</td><td>{d.owner}</td>
                <td>{d.due} {isOverdue(d) && <Badge tone="red">Overdue</Badge>}</td>
                <td><DocBadge s={d.status} />{d.voided?.supersededBy && <small>by {d.voided.supersededBy}</small>}{d.voided && <small>{fmtDate(d.voided.at)}</small>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8}><Empty title={docs.length ? 'No documents match' : 'No documents yet'}>{!docs.length && reviewer ? 'Register documents one by one or import the Master Document Register (Excel / CSV).' : ''}</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function Reviews() {
  const { docs, role, issued } = useStore()
  const open = useUI((s) => s.open)
  const exportManifest = (id: string) => {
    const i = issued.find((x) => x.id === id)!
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ kind: 'Controlled issue manifest', note: 'Metadata manifest: lists the signers of this revision. It is not a cryptographically signed file.', ...i }, null, 2)], { type: 'application/json' }))
    a.download = `${i.id}_${i.doc}_R${String(i.rev).padStart(2, '0')}_manifest.json`
    a.click()
  }
  const queue = docs.filter((d) => d.status === 'Under review')
  const returned = docs.filter((d) => d.status === 'Changes requested')
  const done = docs.filter((d) => d.signatures.length && d.status === 'Accepted')
  return (
    <>
      <PageHead title="Reviews & approvals" sub="Two-stage review: Consultant, then Owner / QA. Each sign-off is bound to one revision. A deadline never approves a document." />
      <div className="notice info" style={{ marginBottom: 14 }}>Each sign-off records the signed-in user, their project role, the reason and an explicit confirmation, bound to one revision. Re-authentication at signing (21 CFR Part 11 / EU Annex 11 electronic signature) is planned and not yet active.</div>
      <div className="grid g2">
        <section className="card flush">
          <h2>Awaiting sign-off</h2>
          <div className="tablewrap" style={{ border: 0 }}><table><tbody>
            {queue.map((d) => {
              const exp = d.signStage === 0 ? 'Consultant' : 'Owner / QA'
              return <tr key={d.id}><td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button> <span className="rev">{R(d.rev)}</span><small>{d.id} · {d.owner}</small></td><td style={{ textAlign: 'right' }}><Badge tone={exp === role ? 'teal' : 'amber'}>{exp === role ? 'Your turn' : `Waiting: ${exp}`}</Badge><small>Stage {d.signStage + 1} of 2</small></td><td style={{ minWidth: 300 }}><div className="steps nw">{['Submitted', 'Consultant', 'Owner / QA', 'Issue'].map((x, k) => <span key={x} className={`step ${k < 1 + d.signStage ? 'on' : k === 1 + d.signStage ? 'cur' : ''}`}>{x}{k < 1 + d.signStage ? ' ✓' : ''}</span>)}</div></td></tr>
            })}
            {!queue.length && <tr><td><Empty title="Nothing awaiting sign-off">As Contractor, submit a draft from the document register.</Empty></td></tr>}
          </tbody></table></div>
        </section>
        <div className="grid">
          <section className="card flush">
            <h2>Returned for changes</h2>
            <div className="tablewrap" style={{ border: 0 }}><table><tbody>{returned.map((d) => <tr key={d.id}><td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button><small>{d.id}{d.history[d.history.length - 1]?.note ? ` · ${d.history[d.history.length - 1].note}` : ' · awaiting resubmission by contractor'}</small></td><td style={{ textAlign: 'right' }}><DocBadge s={d.status} /></td></tr>)}{!returned.length && <tr><td className="muted">None.</td></tr>}</tbody></table></div>
          </section>
          <section className="card flush">
            <h2>Accepted revisions</h2>
            <div className="tablewrap" style={{ border: 0 }}><table><tbody>{done.map((d) => <tr key={d.id}><td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button> <span className="rev">{R(d.rev)}</span></td><td style={{ textAlign: 'right' }}><Badge tone="green">{d.signatures.length} sign-offs</Badge></td></tr>)}</tbody></table></div>
          </section>
        </div>
      </div>
      <section className="card flush mt">
        <h2>Controlled issue <span className="muted small" style={{ fontWeight: 400 }}>generated automatically after the final sign-off · metadata only</span></h2>
        <div className="tablewrap" style={{ border: 0 }}><table><tbody>
          {issued.map((i) => <tr key={i.id}><td><b>{i.id}</b><small>{i.doc}</small></td><td><button className="link" onClick={() => open('doc', i.doc)}>{i.title}</button> <span className="rev">{R(i.rev)}</span></td><td>{i.signers.map((x) => x.role).join(' → ')}<small>{fmtDate(i.at)}</small></td><td style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => exportManifest(i.id)}>Manifest JSON</button></td></tr>)}
          {!issued.length && <tr><td><Empty title="Nothing issued yet">A manifest appears once both stages sign the same revision.</Empty></td></tr>}
        </tbody></table></div>
      </section>
    </>
  )
}
