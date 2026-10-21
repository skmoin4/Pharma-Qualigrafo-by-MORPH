// Pickers bound to the project registers (Companies & systems page). New records may only reference active entries.
import { go } from './ui'
import { useRegisters } from '../store'

interface P { value: string; onChange: (v: string) => void; label?: string; style?: React.CSSProperties }

const Empty = ({ what }: { what: string }) => (
  <span className="muted small">No active {what}. <button type="button" className="link small" onClick={() => go('registers')}>Add in Companies &amp; systems</button></span>
)

export function SystemSelect({ value, onChange, label = 'System', style }: P) {
  const { systems } = useRegisters()
  if (!systems.length) return <Empty what="systems" />
  return (
    <select className="input" style={style} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Choose a system…</option>
      {systems.map((s) => <option key={s.tag} value={s.tag}>{s.tag} · {s.name}</option>)}
    </select>
  )
}

export function CompanySelect({ value, onChange, label = 'Company', style }: P) {
  const { companies } = useRegisters()
  if (!companies.length) return <Empty what="companies" />
  return (
    <select className="input" style={style} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Choose a company…</option>
      {companies.map((c) => <option key={c.id} value={c.name}>{c.name} · {c.kind}</option>)}
    </select>
  )
}

export function DisciplineSelect({ value, onChange, label = 'Discipline', style }: P) {
  const { disciplines } = useRegisters()
  if (!disciplines.length) return <Empty what="disciplines" />
  return (
    <select className="input" style={style} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Choose a discipline…</option>
      {disciplines.map((d) => <option key={d}>{d}</option>)}
    </select>
  )
}
