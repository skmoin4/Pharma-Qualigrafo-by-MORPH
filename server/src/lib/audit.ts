// Audit-trail text helpers (ALCOA+: every change states what the value was and what it became).

const show = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : Array.isArray(v) ? v.join(', ') || '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v === '' || v == null ? '—' : String(v)

/** `field "old" -> "new"` for every pair whose values differ. */
export function changeList(pairs: [string, unknown, unknown][]) {
  return pairs.filter(([, a, b]) => show(a) !== show(b)).map(([label, a, b]) => `${label} "${show(a)}" -> "${show(b)}"`)
}

/** True when the named pair changed. */
export const changed = (pairs: [string, unknown, unknown][], label: string) => pairs.some(([l, a, b]) => l === label && show(a) !== show(b))
