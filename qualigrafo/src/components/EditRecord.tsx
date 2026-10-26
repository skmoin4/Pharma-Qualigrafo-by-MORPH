// Inline editor for an existing record: shows the fields, asks for the reason of the change, saves only when something
// changed. The server writes every changed field as old -> new to the audit trail.
import { useState } from 'react'
import { useStore } from '../store'
import { DisciplineSelect, SystemSelect } from './Pickers'

export interface EditField {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'date' | 'select' | 'system' | 'discipline'
  options?: (string | number)[]
  /** Spans the full width of the form. */
  wide?: boolean
  disabled?: boolean
  hint?: string
}
type Values = Record<string, string | number>

export function EditRecord({ name, fields, initial, onSave, onClose }: { name: string; fields: EditField[]; initial: Values; onSave: (v: Values, reason: string) => Promise<string | null>; onClose: () => void }) {
  const toast = useStore((s) => s.toast)
  const [v, setV] = useState<Values>(initial)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const changed = fields.some((f) => String(v[f.key] ?? '') !== String(initial[f.key] ?? ''))
  const set = (k: string, x: string | number) => setV({ ...v, [k]: x })
  const save = async () => {
    setBusy(true)
    const er = await onSave(v, reason)
    setBusy(false)
    if (er) toast(er, 'warn')
    else { toast(`${name} updated`); onClose() }
  }
  const input = (f: EditField) => {
    const label = `${name} ${f.label.toLowerCase()}`
    const val = String(v[f.key] ?? '')
    switch (f.type) {
      case 'textarea': return <textarea className="input" style={{ minHeight: 56 }} value={val} disabled={f.disabled} onChange={(e) => set(f.key, e.target.value)} aria-label={label} />
      case 'date': return <input className="input" type="date" value={val} disabled={f.disabled} onChange={(e) => set(f.key, e.target.value)} aria-label={label} />
      case 'select': return <select className="input" value={val} disabled={f.disabled} onChange={(e) => set(f.key, typeof initial[f.key] === 'number' ? Number(e.target.value) : e.target.value)} aria-label={label}>{f.options!.map((o) => <option key={o} value={o}>{o === '' ? '— none —' : o}</option>)}</select>
      case 'system': return <SystemSelect value={val} onChange={(x) => set(f.key, x)} label={label} />
      case 'discipline': return <DisciplineSelect value={val} onChange={(x) => set(f.key, x)} label={label} />
      default: return <input className="input" value={val} disabled={f.disabled} onChange={(e) => set(f.key, e.target.value)} aria-label={label} />
    }
  }
  return (
    <div className="card" style={{ margin: '8px 0', background: 'rgba(255, 255, 255, 0.55)' }}>
      <div className="grid g2">
        {fields.map((f) => (
          <div key={f.key} style={f.wide ? { gridColumn: '1 / -1' } : undefined}>
            <label className="lab" style={{ marginTop: 0 }}>{f.label}</label>
            {input(f)}
            {f.hint && <small className="muted">{f.hint}</small>}
          </div>
        ))}
      </div>
      <label className="lab">Reason for the change (audit trail)</label>
      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this changing?" aria-label={`${name} change reason`} />
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn pri sm" style={{ whiteSpace: 'nowrap' }} disabled={!changed || busy} onClick={save}>Save changes</button>
        <button className="btn sm" onClick={onClose}>Cancel</button>
        {!changed && <span className="muted small">Change a field to save.</span>}
      </div>
    </div>
  )
}
