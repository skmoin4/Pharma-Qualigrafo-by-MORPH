import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Pencil, Plus, Upload } from 'lucide-react'
import { useStore } from '../store'
import type { SystemInput } from '../store'
import type { Company, DisciplineRec, SystemRec } from '../types'
import { DisciplineSelect } from '../components/Pickers'
import { Badge, Empty, PageHead } from '../components/ui'

const KINDS = ['Owner', 'Engineering consultant', 'Main contractor', 'Subcontractor', 'Vendor / supplier', 'Other']

function useAct() {
  const toast = useStore((s) => s.toast)
  return async (p: Promise<string | null>, ok: string) => { const e = await p; toast(e ?? ok, e ? 'warn' : 'ok'); return e }
}

/* ----------------------------------------------------------------- CSV */

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, comma or semicolon separators. */
export function parseCsv(text: string): string[][] {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean))
}

const HEAD: Record<string, keyof SystemInput> = { tag: 'tag', 'system tag': 'tag', 'equipment tag': 'tag', name: 'name', description: 'name', discipline: 'discipline', area: 'area', location: 'area', 'gmp critical': 'gmpCritical', gmp: 'gmpCritical' }

function toSystems(rows: string[][]): { items: SystemInput[]; error: string | null } {
  if (rows.length < 2) return { items: [], error: 'The file needs a header row and at least one system.' }
  const cols = rows[0].map((h) => HEAD[h.toLowerCase()])
  if (!cols.includes('tag') || !cols.includes('name')) return { items: [], error: 'Header must contain "Tag" and "Description" columns (Discipline, Area, GMP critical are optional).' }
  const items = rows.slice(1).map((r) => {
    const o: SystemInput = { tag: '', name: '' }
    cols.forEach((k, i) => {
      const v = r[i] ?? ''
      if (k === 'gmpCritical') o.gmpCritical = /^(y|yes|true|1|x)$/i.test(v)
      else if (k) (o as unknown as Record<string, string | null>)[k] = v || (k === 'tag' || k === 'name' ? '' : null)
    })
    return o
  })
  return { items, error: null }
}

function SystemImport({ onDone }: { onDone: () => void }) {
  const importSystems = useStore((s) => s.importSystems)
  const act = useAct()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const parsed = useMemo(() => (text.trim() ? toSystems(parseCsv(text)) : null), [text])
  const template = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['Tag,Description,Discipline,Area,GMP critical\r\nTK-301,Buffer tank 301,Process Equipment,Utility block,yes\r\n'], { type: 'text/csv' }))
    a.download = 'system_register_template.csv'
    a.click()
  }
  const run = async () => {
    if (!parsed || parsed.error) return
    const er = await act(importSystems(parsed.items), `${parsed.items.length} system(s) imported`)
    if (!er) { setText(''); onDone() }
  }
  return (
    <section className="card" style={{ marginBottom: 14 }}>
      <h2>Import equipment list <button type="button" className="btn sm ghost" onClick={template}><Download size={12} /> CSV template</button></h2>
      <p className="muted small" style={{ marginTop: 0 }}>Columns: Tag, Description, Discipline, Area, GMP critical (yes / no). Export your equipment list from Excel as CSV, then choose the file or paste it below. The import is all-or-nothing: if one row is invalid, nothing is added and the row is reported.</p>
      <div className="row wrap">
        <button type="button" className="btn" onClick={() => input.current?.click()}><Upload size={13} /> Choose CSV file</button>
        <input ref={input} type="file" accept=".csv,text/csv" hidden aria-label="Equipment list CSV" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = '' }} />
      </div>
      <textarea className="input" style={{ marginTop: 8, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }} placeholder={'Tag,Description,Discipline,Area,GMP critical\nTK-301,Buffer tank 301,Process Equipment,Utility block,yes'} value={text} onChange={(e) => setText(e.target.value)} aria-label="CSV content" />
      {parsed?.error && <div className="notice err small" style={{ marginTop: 8 }}>{parsed.error}</div>}
      {parsed && !parsed.error && (
        <>
          <div className="tablewrap" style={{ marginTop: 8, maxHeight: 220 }}><table>
            <thead><tr><th>#</th><th>Tag</th><th>Description</th><th>Discipline</th><th>Area</th><th>GMP</th></tr></thead>
            <tbody>{parsed.items.slice(0, 50).map((r, i) => <tr key={i}><td className="muted">{i + 1}</td><td><b>{r.tag.toUpperCase()}</b></td><td>{r.name}</td><td>{r.discipline ?? '—'}</td><td>{r.area ?? '—'}</td><td>{r.gmpCritical ? 'Yes' : 'No'}</td></tr>)}</tbody>
          </table></div>
          {parsed.items.length > 50 && <p className="muted small">Showing the first 50 of {parsed.items.length} rows.</p>}
          <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn pri" onClick={run}>Import {parsed.items.length} system(s)</button><button type="button" className="btn" onClick={() => setText('')}>Clear</button></div>
        </>
      )}
    </section>
  )
}

/* ----------------------------------------------------------------- companies */

function CompanyRow({ c, docs, can }: { c: Company; docs: number; can: boolean }) {
  const updateCompany = useStore((s) => s.updateCompany)
  const act = useAct()
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ name: c.name, kind: c.kind, contactName: c.contactName ?? '', contactEmail: c.contactEmail ?? '' })
  const save = async () => {
    const renamed = f.name.trim() !== c.name
    if (renamed && docs && !confirm(`Rename ${c.name} to ${f.name.trim()}? ${docs} document(s) and any vendor access limited to this company follow the new name.`)) return
    const er = await act(updateCompany(c.id, { ...f, contactName: f.contactName || null, contactEmail: f.contactEmail || null }), 'Company updated')
    if (!er) setEdit(false)
  }
  if (edit) return (
    <tr className="sel">
      <td><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Company name" /></td>
      <td><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Company type">{KINDS.map((k) => <option key={k}>{k}</option>)}</select></td>
      <td><input className="input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} placeholder="Contact name" aria-label="Contact name" /><input className="input" style={{ marginTop: 4 }} value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} placeholder="Contact email" aria-label="Contact email" /></td>
      <td colSpan={2} style={{ textAlign: 'right' }}><div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm pri" onClick={save}>Save</button><button className="btn sm" onClick={() => setEdit(false)}>Cancel</button></div></td>
    </tr>
  )
  return (
    <tr style={c.active ? undefined : { opacity: 0.6 }}>
      <td><b>{c.name}</b>{(c.contactName || c.contactEmail) && <small>{[c.contactName, c.contactEmail].filter(Boolean).join(' · ')}</small>}</td>
      <td>{c.kind}</td>
      <td>{docs ? `${docs} document${docs > 1 ? 's' : ''}` : <span className="muted">—</span>}</td>
      <td>{c.active ? <Badge tone="green" dot={false}>Active</Badge> : <Badge dot={false}>Inactive</Badge>}</td>
      <td style={{ textAlign: 'right' }}>{can && <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm" onClick={() => setEdit(true)} aria-label={`Edit ${c.name}`}><Pencil size={12} /> Edit</button>
        <button className="btn sm" onClick={() => act(updateCompany(c.id, { active: !c.active }), c.active ? `${c.name} deactivated` : `${c.name} reactivated`)}>{c.active ? 'Deactivate' : 'Reactivate'}</button>
      </div>}</td>
    </tr>
  )
}

function Companies() {
  const { companies, docs, role, addCompany } = useStore()
  const act = useAct()
  const can = role === 'Owner / QA'
  const [f, setF] = useState({ name: '', kind: 'Vendor / supplier', contactName: '', contactEmail: '' })
  const add = async () => { const er = await act(addCompany(f), `${f.name.trim()} added`); if (!er) setF({ ...f, name: '', contactName: '', contactEmail: '' }) }
  return (
    <>
      {can ? (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Add company</h2>
          <div className="grid g4">
            <input className="input" placeholder="Company name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="New company name" />
            <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="New company type">{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <input className="input" placeholder="Contact name (optional)" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} aria-label="New company contact" />
            <input className="input" placeholder="Contact email (optional)" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} aria-label="New company email" />
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn pri" onClick={add}><Plus size={13} /> Add company</button><span className="muted small">Vendor accounts can be limited to one company from Users &amp; access.</span></div>
        </section>
      ) : <div className="notice info small" style={{ marginBottom: 14 }}>The company register is maintained by Owner / QA because it controls vendor access.</div>}
      <div className="tablewrap"><table>
        <thead><tr><th>Company</th><th>Type</th><th>Responsible for</th><th>Status</th><th /></tr></thead>
        <tbody>
          {companies.map((c) => <CompanyRow key={c.id} c={c} can={can} docs={docs.filter((d) => d.owner === c.name).length} />)}
          {!companies.length && <tr><td colSpan={5}><Empty title="No companies yet" /></td></tr>}
        </tbody>
      </table></div>
    </>
  )
}

/* ----------------------------------------------------------------- systems */

function SystemRow({ s, uses, can }: { s: SystemRec; uses: number; can: boolean }) {
  const updateSystem = useStore((x) => x.updateSystem)
  const act = useAct()
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ name: s.name, discipline: s.discipline ?? '', area: s.area ?? '', gmpCritical: s.gmpCritical })
  const save = async () => { const er = await act(updateSystem(s.tag, { ...f, discipline: f.discipline || null, area: f.area || null }), `${s.tag} updated`); if (!er) setEdit(false) }
  if (edit) return (
    <tr className="sel">
      <td><b>{s.tag}</b><small>tag cannot change</small></td>
      <td><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="System description" /></td>
      <td><DisciplineSelect value={f.discipline} onChange={(v) => setF({ ...f, discipline: v })} /></td>
      <td><input className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} aria-label="System area" /></td>
      <td><label className="row"><input type="checkbox" checked={f.gmpCritical} onChange={(e) => setF({ ...f, gmpCritical: e.target.checked })} /><span className="small">GMP critical</span></label></td>
      <td colSpan={2} style={{ textAlign: 'right' }}><div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm pri" onClick={save}>Save</button><button className="btn sm" onClick={() => setEdit(false)}>Cancel</button></div></td>
    </tr>
  )
  return (
    <tr style={s.active ? undefined : { opacity: 0.6 }}>
      <td><b>{s.tag}</b></td>
      <td>{s.name}</td>
      <td>{s.discipline ?? <span className="muted">—</span>}</td>
      <td>{s.area ?? <span className="muted">—</span>}</td>
      <td>{s.gmpCritical ? <Badge tone="violet" dot={false}>GMP critical</Badge> : <span className="muted small">—</span>}</td>
      <td>{uses ? `${uses} record${uses > 1 ? 's' : ''}` : <span className="muted">—</span>}{!s.active && <small>Inactive</small>}</td>
      <td style={{ textAlign: 'right' }}>{can && <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm" onClick={() => setEdit(true)} aria-label={`Edit ${s.tag}`}><Pencil size={12} /> Edit</button>
        <button className="btn sm" onClick={() => act(updateSystem(s.tag, { active: !s.active }), s.active ? `${s.tag} deactivated` : `${s.tag} reactivated`)}>{s.active ? 'Deactivate' : 'Reactivate'}</button>
      </div>}</td>
    </tr>
  )
}

function Systems() {
  const { systems, docs, reqs, rfis, ncrs, risks, inspections, role, addSystem } = useStore()
  const act = useAct()
  const can = role !== 'Contractor'
  const [importing, setImporting] = useState(false)
  const [q, setQ] = useState('')
  const [f, setF] = useState({ tag: '', name: '', discipline: '', area: '', gmpCritical: false })
  const add = async () => { const er = await act(addSystem({ ...f, discipline: f.discipline || null, area: f.area || null }), `${f.tag.trim().toUpperCase()} added`); if (!er) setF({ ...f, tag: '', name: '', area: '' }) }
  const uses = (tag: string) => [docs, reqs, rfis, ncrs, risks, inspections].reduce((n, list) => n + list.filter((x: { system: string }) => x.system === tag).length, 0)
  const shown = systems.filter((s) => `${s.tag} ${s.name} ${s.discipline ?? ''} ${s.area ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      {can ? (
        <>
          <section className="card" style={{ marginBottom: 14 }}>
            <h2>Add system or equipment <button className="btn sm" onClick={() => setImporting(!importing)}><Upload size={12} /> {importing ? 'Close import' : 'Import CSV'}</button></h2>
            <div className="grid g4">
              <input className="input" placeholder="Tag, e.g. TK-301" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} aria-label="New system tag" />
              <input className="input" placeholder="Description" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="New system description" />
              <DisciplineSelect value={f.discipline} onChange={(v) => setF({ ...f, discipline: v })} />
              <input className="input" placeholder="Area / building (optional)" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} aria-label="New system area" />
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="row"><input type="checkbox" checked={f.gmpCritical} onChange={(e) => setF({ ...f, gmpCritical: e.target.checked })} /><span className="small">GMP critical (direct product impact)</span></label>
              <button className="btn pri" onClick={add}><Plus size={13} /> Add system</button>
            </div>
          </section>
          {importing && <SystemImport onDone={() => setImporting(false)} />}
        </>
      ) : <div className="notice info small" style={{ marginBottom: 14 }}>The system register is maintained by the Consultant and Owner / QA.</div>}
      <div className="filters"><input className="input grow" placeholder="Search tag, description, discipline or area…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search systems" /><span className="muted small">{shown.length} of {systems.length}</span></div>
      <div className="tablewrap"><table>
        <thead><tr><th>Tag</th><th>Description</th><th>Discipline</th><th>Area</th><th>GMP</th><th>Used by</th><th /></tr></thead>
        <tbody>
          {shown.map((s) => <SystemRow key={s.id} s={s} can={can} uses={uses(s.tag)} />)}
          {!shown.length && <tr><td colSpan={7}><Empty title={systems.length ? 'No systems match' : 'No systems yet'}>{systems.length ? '' : 'Add systems one by one or import your equipment list.'}</Empty></td></tr>}
        </tbody>
      </table></div>
    </>
  )
}

/* ----------------------------------------------------------------- disciplines */

function DisciplineRow({ d, first, last, uses, can }: { d: DisciplineRec; first: boolean; last: boolean; uses: number; can: boolean }) {
  const updateDiscipline = useStore((s) => s.updateDiscipline)
  const act = useAct()
  const [name, setName] = useState<string | null>(null)
  const save = async () => {
    if (name === null) return
    if (uses && !confirm(`Rename "${d.name}" to "${name.trim()}" on ${uses} record(s)?`)) return
    const er = await act(updateDiscipline(d.id, { name }), 'Discipline renamed')
    if (!er) setName(null)
  }
  return (
    <tr style={d.active ? undefined : { opacity: 0.6 }}>
      <td style={{ width: 70 }}>{can && <div className="row" style={{ gap: 2 }}>
        <button className="iconbtn" disabled={first} onClick={() => act(updateDiscipline(d.id, { move: 'up' }), 'Order saved')} aria-label={`Move ${d.name} up`}><ArrowUp size={13} /></button>
        <button className="iconbtn" disabled={last} onClick={() => act(updateDiscipline(d.id, { move: 'down' }), 'Order saved')} aria-label={`Move ${d.name} down`}><ArrowDown size={13} /></button>
      </div>}</td>
      <td>{name === null ? <b>{d.name}</b> : <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Discipline name" />}</td>
      <td>{uses ? `${uses} record${uses > 1 ? 's' : ''}` : <span className="muted">—</span>}</td>
      <td>{d.active ? <Badge tone="green" dot={false}>Active</Badge> : <Badge dot={false}>Inactive</Badge>}</td>
      <td style={{ textAlign: 'right' }}>{can && (name === null
        ? <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => setName(d.name)}><Pencil size={12} /> Rename</button><button className="btn sm" onClick={() => act(updateDiscipline(d.id, { active: !d.active }), d.active ? `${d.name} deactivated` : `${d.name} reactivated`)}>{d.active ? 'Deactivate' : 'Reactivate'}</button></div>
        : <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm pri" onClick={save}>Save</button><button className="btn sm" onClick={() => setName(null)}>Cancel</button></div>)}</td>
    </tr>
  )
}

function Disciplines() {
  const { disciplines, docs, reqs, rfis, systems, role, addDiscipline } = useStore()
  const act = useAct()
  const can = role !== 'Contractor'
  const [name, setName] = useState('')
  const uses = (n: string) => [docs, reqs, rfis].reduce((k, list) => k + list.filter((x: { discipline: string }) => x.discipline === n).length, 0) + systems.filter((s) => s.discipline === n).length
  return (
    <>
      {can && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Add discipline</h2>
          <div className="row"><input className="input" style={{ maxWidth: 320 }} placeholder="e.g. Automation & Control" value={name} onChange={(e) => setName(e.target.value)} aria-label="New discipline" /><button className="btn pri" onClick={async () => { const er = await act(addDiscipline(name), `${name.trim()} added`); if (!er) setName('') }}><Plus size={13} /> Add</button></div>
          <p className="muted small" style={{ marginBottom: 0 }}>The order here is used in every overview and picker. Deactivated disciplines stay on existing records but cannot be chosen for new ones.</p>
        </section>
      )}
      <div className="tablewrap"><table>
        <thead><tr><th>Order</th><th>Discipline</th><th>Used by</th><th>Status</th><th /></tr></thead>
        <tbody>{disciplines.map((d, i) => <DisciplineRow key={d.id} d={d} can={can} first={i === 0} last={i === disciplines.length - 1} uses={uses(d.name)} />)}</tbody>
      </table></div>
    </>
  )
}

export default function Registers() {
  const companies = useStore((s) => s.companies)
  const systems = useStore((s) => s.systems)
  const disciplines = useStore((s) => s.disciplines)
  const [tab, setTab] = useState<'companies' | 'systems' | 'disciplines'>('companies')
  return (
    <>
      <PageHead
        title="Companies & systems"
        sub="Project registers used by every record: the parties responsible for deliverables, the system and equipment list, and the discipline structure."
        actions={<div className="seg">
          <button className={tab === 'companies' ? 'on' : ''} onClick={() => setTab('companies')}>Companies ({companies.length})</button>
          <button className={tab === 'systems' ? 'on' : ''} onClick={() => setTab('systems')}>Systems &amp; equipment ({systems.length})</button>
          <button className={tab === 'disciplines' ? 'on' : ''} onClick={() => setTab('disciplines')}>Disciplines ({disciplines.length})</button>
        </div>}
      />
      {tab === 'companies' ? <Companies /> : tab === 'systems' ? <Systems /> : <Disciplines />}
    </>
  )
}
