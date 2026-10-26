import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ClipboardCheck, Download, PenLine, Play, X } from 'lucide-react'
import { api, downloadAs, errorText } from '../api'
import { useStore } from '../store'
import { Badge, Empty, fmtDate } from '../components/ui'

interface Schedule { intervalDays: number; lastCompleted: { code: string; at: string; by: string | null } | null; nextDue: string; due: boolean; open: { code: string; id: string; dueDate: string; overdue: boolean } | null }
interface Summary { id: string; code: string; status: string; startedBy: string; startedAt: string; dueDate: string; completedBy: string | null; completedAt: string | null; total: number; decided: number; flagged: number; disabled: number; changed: number }
interface Item {
  id: string; userId: string; email: string; name: string; company: string | null; isAdmin: boolean; lastLoginAt: string | null
  memberships: { project: string; name: string; role: string; scope: string | null; archived: boolean }[]
  flags: string[]; decision: string | null; note: string; decidedBy: string | null; decidedAt: string | null; selfReview: boolean
}
interface Detail extends Summary { conclusion: string | null; meaning: string | null; sigHash: string | null; signature: string | null; cancelReason: string | null; items: Item[] }
const DECISIONS = ['Keep', 'Keep with changes', 'Disable account'] as const
const tone = (s: string) => (s === 'Completed' ? 'green' : s === 'Cancelled' ? '' : 'amber')

/** One account of an open review: decision + note, saved explicitly. */
function Decide({ reviewId, item, me, open, onSaved }: { reviewId: string; item: Item; me: string; open: boolean; onSaved: (d: Detail) => void }) {
  const toast = useStore((s) => s.toast)
  const [decision, setDecision] = useState(item.decision ?? '')
  const [note, setNote] = useState(item.note)
  const [busy, setBusy] = useState(false)
  const locked = !open || item.decision === 'Disable account'
  const dirty = decision !== (item.decision ?? '') || note !== item.note
  const save = async () => {
    if (decision === 'Disable account' && !confirm(`Disable ${item.email} now? They are signed out at once.`)) return
    setBusy(true)
    try { const r = await api<{ review: Detail }>('PUT', `/admin/access-reviews/${reviewId}/items/${item.id}`, { decision, note }); onSaved(r.review); toast(`${item.name}: ${decision}`) } catch (e) { toast(errorText(e), 'warn') } finally { setBusy(false) }
  }
  if (locked) return item.decision
    ? <div><Badge tone={item.decision === 'Disable account' ? 'red' : item.decision === 'Keep' ? 'green' : 'amber'} dot={false}>{item.decision}</Badge>{item.note && <small>{item.note}</small>}<small>{item.decidedBy} · {fmtDate(item.decidedAt!)}{item.selfReview ? ' · self-review' : ''}</small></div>
    : <span className="muted small">Undecided</span>
  return (
    <div className="grid" style={{ gap: 6, minWidth: 200 }}>
      <select className="input" value={decision} onChange={(e) => setDecision(e.target.value)} aria-label={`Decision for ${item.email}`}>
        <option value="">Choose…</option>
        {DECISIONS.filter((d) => !(d === 'Disable account' && item.userId === me)).map((d) => <option key={d}>{d}</option>)}
      </select>
      {decision && decision !== 'Keep' && <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision === 'Disable account' ? 'Why is the account disabled?' : 'What was changed under Users?'} aria-label={`Note for ${item.email}`} />}
      {item.userId === me && <span className="small" style={{ color: 'var(--amber, #a76a00)' }}>Your own account: recorded as self-review.</span>}
      <button type="button" className="btn sm pri" disabled={!decision || !dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save decision'}</button>
      {item.decision && <small>{item.decision} · {item.decidedBy}</small>}
    </div>
  )
}

function Complete({ review, onDone }: { review: Detail; onDone: (d: Detail) => void }) {
  const toast = useStore((s) => s.toast)
  const [conclusion, setConclusion] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const left = review.total - review.decided
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null)
    try { const r = await api<{ review: Detail }>('POST', `/admin/access-reviews/${review.id}/complete`, { conclusion, password }); onDone(r.review); toast(`${review.code} completed and signed`) } catch (er) { setError(errorText(er)); setPassword('') } finally { setBusy(false) }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2 style={{ margin: 0, justifyContent: 'flex-start', gap: 6 }}><PenLine size={15} /> Complete and sign</h2>
      {left > 0 && <div className="notice" style={{ marginTop: 10 }}>{left} account(s) still need a decision.</div>}
      <label className="lab">Conclusion</label>
      <textarea className="input" rows={3} value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder="e.g. All remaining access is appropriate; one dormant vendor account disabled." />
      <div className="notice info" style={{ marginTop: 10 }}><b>Meaning of your signature:</b> {MEANING}</div>
      <label className="lab">Your password</label>
      <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password to sign" />
      {error && <div className="notice err" role="alert" style={{ marginTop: 10 }}>{error}</div>}
      <button className="btn pri" type="submit" disabled={busy || left > 0 || !conclusion.trim() || !password} style={{ marginTop: 12 }}>{busy ? 'Signing…' : 'Sign and complete review'}</button>
    </form>
  )
}
const MEANING = 'Access review completed — remaining user access confirmed appropriate'

/** Administration → Access review: schedule, history, and the open review with a decision per account. */
export default function AdminAccessReview() {
  const { session, toast } = useStore()
  const [data, setData] = useState<{ schedule: Schedule; reviews: Summary[] } | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [interval, setIntervalDays] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'undecided' | 'flagged'>('all')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (openId?: string) => {
    try {
      const o = await api<{ schedule: Schedule; reviews: Summary[] }>('GET', '/admin/access-reviews')
      setData(o); setIntervalDays((v) => v ?? o.schedule.intervalDays)
      const id = openId ?? o.schedule.open?.id
      if (id) setDetail((await api<{ review: Detail }>('GET', `/admin/access-reviews/${id}`)).review)
    } catch (e) { toast(errorText(e), 'warn') }
  }, [toast])
  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => (detail?.items ?? []).filter((i) => filter === 'all' || (filter === 'undecided' ? !i.decision : i.flags.length > 0)), [detail, filter])
  if (!data || interval === null) return <Empty title="Loading…" />
  const s = data.schedule
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } catch (e) { toast(errorText(e), 'warn') } finally { setBusy(false) } }
  const pdf = (r: Summary) => act(async () => { await downloadAs(`/admin/access-reviews/${r.id}/report.pdf`, `Qualigrafo_Access_Review_${r.code}.pdf`) })
  const updated = (d: Detail) => { setDetail(d); void load(d.id) }

  return (
    <div className="grid">
      {s.open?.overdue && <div className="notice err"><b>{s.open.code} is overdue</b> (target date {s.open.dueDate}). Decide the remaining accounts and sign the review.</div>}
      {s.due && <div className="notice"><b>A user-access review is due.</b> {s.lastCompleted ? `Last review ${s.lastCompleted.code} on ${s.lastCompleted.at.slice(0, 10)}; reviews are due every ${s.intervalDays} days.` : 'No review has been completed yet.'}</div>}
      <div className="grid g2">
        <section className="card">
          <h2 style={{ margin: 0, justifyContent: 'flex-start', gap: 6 }}><ClipboardCheck size={15} /> Periodic access review</h2>
          <p className="muted small">An administrator reviews every active account and its project roles, records a decision for each (keep, keep with changes, disable), and signs the review with their password. Required for GxP computerised systems (EU GMP Annex 11 §12, 21 CFR 11.10(d)).</p>
          <div className="kv">
            <div><small>Last completed</small>{s.lastCompleted ? `${s.lastCompleted.code} · ${fmtDate(s.lastCompleted.at)}` : 'Never'}</div>
            <div><small>Next due</small>{s.open ? `${s.open.code} open, target ${s.open.dueDate}` : s.nextDue}</div>
          </div>
          <button className="btn pri" type="button" disabled={busy || !!s.open} onClick={() => act(async () => { const r = await api<{ review: Detail }>('POST', '/admin/access-reviews', {}); setDetail(r.review); await load(r.review.id); toast(`${r.review.code} started: ${r.review.total} account(s) to review`) })}><Play size={13} /> Start access review</button>
          {s.open && <p className="muted small" style={{ marginBottom: 0 }}>Complete or cancel {s.open.code} before starting another.</p>}
        </section>
        <section className="card">
          <h2 style={{ margin: 0 }}>Review interval</h2>
          <label className="lab">Every (days)</label>
          <input className="input" type="number" min={30} max={365} value={interval} onChange={(e) => setIntervalDays(Number(e.target.value))} />
          <p className="muted small">Typical: 90 days (quarterly) or 180 days. Administrators get a daily e-mail while a review is due or overdue.</p>
          <button className="btn" type="button" disabled={busy || interval === s.intervalDays} onClick={() => act(async () => { await api('PUT', '/admin/access-reviews/settings', { intervalDays: interval }); await load(); toast('Review interval saved') })}>Save interval</button>
        </section>
      </div>

      {detail && (
        <section className="card flush">
          <div className="row sb wrap" style={{ padding: '14px 16px 0' }}>
            <h2 style={{ margin: 0, padding: 0 }}>{detail.code} <Badge tone={tone(detail.status)} dot={false}>{detail.status}</Badge></h2>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="muted small">{detail.decided} of {detail.total} decided · {detail.flagged} flagged · started {fmtDate(detail.startedAt)} by {detail.startedBy}</span>
              <button className="btn sm" type="button" onClick={() => pdf(detail)}><Download size={12} /> PDF</button>
              {detail.status === 'Open' && <button className="btn sm" type="button" disabled={busy} onClick={() => { const reason = prompt(`Why is ${detail.code} cancelled?`); if (reason !== null) void act(async () => { const r = await api<{ review: Detail }>('POST', `/admin/access-reviews/${detail.id}/cancel`, { reason }); updated(r.review); toast(`${detail.code} cancelled`) }) }}><X size={12} /> Cancel review</button>}
              <button className="btn sm" type="button" onClick={() => setDetail(null)} aria-label="Close review">Close</button>
            </div>
          </div>
          {detail.status === 'Open' && <div className="progress" style={{ margin: '10px 16px 0' }}><i style={{ width: `${detail.total ? (detail.decided / detail.total) * 100 : 0}%` }} /><span>{detail.decided} of {detail.total} decided</span></div>}
          {detail.status === 'Completed' && <div className="notice info" style={{ margin: '10px 16px 0' }}>Signed by <b>{detail.completedBy}</b> on {fmtDate(detail.completedAt!)} · {detail.meaning}. Conclusion: {detail.conclusion} · Signature <b>{detail.signature}</b></div>}
          {detail.status === 'Cancelled' && <div className="notice" style={{ margin: '10px 16px 0' }}>Cancelled: {detail.cancelReason}</div>}
          <div className="filters" style={{ padding: '10px 16px 0' }}>
            <div className="seg">{(['all', 'undecided', 'flagged'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'undecided' ? 'Undecided' : 'Flagged'}</button>)}</div>
          </div>
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Account</th><th>Access at review start</th><th>Findings</th><th>Decision</th></tr></thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id}>
                  <td style={{ minWidth: 170 }}><b>{i.name}</b><small>{i.email}{i.company ? ` · ${i.company}` : ''}</small><small>Last sign-in: {i.lastLoginAt ? fmtDate(i.lastLoginAt) : 'never'}</small></td>
                  <td style={{ minWidth: 180 }}><div className="chips">{i.isAdmin && <Badge tone="violet" dot={false}>Administrator</Badge>}{i.memberships.map((m) => <Badge key={m.project} tone={m.archived ? '' : m.scope ? 'amber' : 'blue'} dot={false}>{m.project} · {m.role}{m.scope ? ` (${m.scope})` : ''}{m.archived ? ' · archived' : ''}</Badge>)}{!i.isAdmin && !i.memberships.length && <span className="muted small">No access</span>}</div></td>
                  <td style={{ minWidth: 140 }}>{i.flags.length ? <div className="chips">{i.flags.map((f) => <Badge key={f} tone={f === 'Administrator' ? 'violet' : 'red'} dot={false}>{f}</Badge>)}</div> : <span className="muted small">None</span>}</td>
                  <td><Decide key={`${i.id}-${i.decidedAt}`} reviewId={detail.id} item={i} me={session?.id ?? ''} open={detail.status === 'Open'} onSaved={updated} /></td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={4}><Empty title="No accounts in this view" /></td></tr>}
            </tbody>
          </table></div>
        </section>
      )}
      {detail?.status === 'Open' && <Complete review={detail} onDone={updated} />}

      <section className="card flush">
        <h2>Review history</h2>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Review</th><th>Started</th><th>Status</th><th>Accounts</th><th>Outcome</th><th /></tr></thead>
          <tbody>
            {data.reviews.map((r) => (
              <tr key={r.id} className={detail?.id === r.id ? 'sel' : ''}>
                <td><button className="link" onClick={() => void load(r.id)}>{r.code}</button></td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.startedAt)}<small>{r.startedBy}</small></td>
                <td><Badge tone={tone(r.status)} dot={false}>{r.status}</Badge>{r.completedAt && <small>{fmtDate(r.completedAt)} · {r.completedBy}</small>}</td>
                <td>{r.decided}/{r.total}<small>{r.flagged} flagged</small></td>
                <td>{r.changed} changed · {r.disabled} disabled</td>
                <td style={{ textAlign: 'right' }}><button className="btn sm" type="button" onClick={() => pdf(r)}><Download size={12} /> PDF</button></td>
              </tr>
            ))}
            {!data.reviews.length && <tr><td colSpan={6}><Empty title="No access reviews yet" /></td></tr>}
          </tbody>
        </table></div>
      </section>
    </div>
  )
}
