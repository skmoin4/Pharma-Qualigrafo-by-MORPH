import { Fragment, useCallback, useEffect, useState } from 'react'
import { Mail, Play, RefreshCw, RotateCcw, Send } from 'lucide-react'
import { api, errorText } from '../api'
import { useStore } from '../store'
import { Badge, Empty, fmtDate } from '../components/ui'

interface Delivery { configured: boolean; host: string | null; port: number; secure: boolean; from: string | null; appUrl: string }
interface Settings { enabled: boolean; time: string; dueSoonDays: number }
interface Run { id: string; runDate: string; trigger: string; status: string; projects: number; items: number; emails: number; startedBy: string | null; startedAt: string; finishedAt: string | null; error: string | null }
interface Email { id: string; at: string; kind: string; to: string; toName: string; project: string | null; subject: string; body: string; status: string; attempts: number; nextAttemptAt: string; error: string | null; sentAt: string | null }
interface Overview { delivery: Delivery; settings: Settings; runs: Run[]; counts: Record<string, number> }

const STATUSES = ['Queued', 'Sending', 'Sent', 'Failed', 'Not sent'] as const
const tone = (s: string) => (s === 'Sent' || s === 'Done' ? 'green' : s === 'Failed' ? 'red' : s === 'Not sent' ? 'amber' : 'blue')

/** Administration → E-mail & reminders: delivery status, daily reminder schedule, run history and the outbox. */
export default function AdminMail() {
  const toast = useStore((s) => s.toast)
  const [data, setData] = useState<Overview | null>(null)
  const [form, setForm] = useState<Settings | null>(null)
  const [emails, setEmails] = useState<Email[] | null>(null)
  const [status, setStatus] = useState<string>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [o, e] = await Promise.all([
        api<Overview>('GET', '/admin/notifications'),
        api<{ emails: Email[] }>('GET', `/admin/emails?limit=200${status !== 'all' ? `&status=${encodeURIComponent(status)}` : ''}`),
      ])
      setData(o); setForm((f) => f ?? o.settings); setEmails(e.emails)
    } catch (er) { toast(errorText(er), 'warn') }
  }, [status, toast])
  useEffect(() => { void load() }, [load])

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    try { toast(await fn()); await load() } catch (er) { toast(errorText(er), 'warn') } finally { setBusy(null) }
  }
  if (!data || !form) return <Empty title="Loading…" />
  const d = data.delivery
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings)

  return (
    <div className="grid">
      <div className="grid g2">
        <section className="card">
          <div className="row sb"><h2 style={{ margin: 0 }}><Mail size={15} style={{ verticalAlign: -2 }} /> E-mail delivery</h2>{d.configured ? <Badge tone="green">Configured</Badge> : <Badge tone="amber">Not configured</Badge>}</div>
          {d.configured ? (
            <div className="kv">
              <div><small>SMTP server</small>{d.host}:{d.port} · {d.secure ? 'TLS' : 'STARTTLS when offered'}</div>
              <div><small>Sender</small>{d.from}</div>
              <div style={{ gridColumn: '1 / -1' }}><small>Links in e-mails point to</small>{d.appUrl}</div>
            </div>
          ) : (
            <div className="notice" style={{ marginTop: 10 }}>E-mails are recorded in the outbox as <b>Not sent</b>. Set <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>, <code>MAIL_FROM</code> and <code>APP_URL</code> in the server environment and restart the API.</div>
          )}
          <div className="chips" style={{ marginTop: 10 }}>{STATUSES.filter((s) => data.counts[s]).map((s) => <Badge key={s} tone={tone(s)} dot={false}>{s}: {data.counts[s]}</Badge>)}</div>
          <button className="btn" type="button" style={{ marginTop: 12 }} disabled={busy !== null} onClick={() => run('test', async () => { await api('POST', '/admin/notifications/test', {}); return 'Test e-mail queued to your address' })}><Send size={13} /> Send test e-mail to me</button>
          <p className="muted small" style={{ marginBottom: 0 }}>Security alerts go to the account holder whatever their preference. Failed deliveries are retried after 1, 5, 15 and 60 minutes, then marked Failed.</p>
        </section>

        <section className="card">
          <h2 style={{ margin: 0 }}>Daily reminders</h2>
          <p className="muted small">Once a day every member gets one e-mail (and an in-app reminder) with the sign-offs waiting for them and the documents, RFIs, NCRs and corrective actions that are overdue or due soon. Projects with the Reminders rule off and archived projects are skipped. A reminder never approves or closes anything.</p>
          <label className="row"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /><span>Send daily reminders</span></label>
          <div className="grid g2" style={{ marginTop: 6 }}>
            <div><label className="lab">Time (site time zone)</label><input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} required /></div>
            <div><label className="lab">"Due soon" window (days)</label><input className="input" type="number" min={0} max={14} value={form.dueSoonDays} onChange={(e) => setForm({ ...form, dueSoonDays: Number(e.target.value) })} /></div>
          </div>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <button className="btn pri" type="button" disabled={!dirty || busy !== null} onClick={() => run('save', async () => { const r = await api<{ settings: Settings }>('PUT', '/admin/notifications/settings', form); setForm(r.settings); return 'Reminder schedule saved' })}>Save schedule</button>
            <button className="btn" type="button" disabled={busy !== null} onClick={() => { if (confirm('Run the reminders now? Everyone with waiting or overdue items gets an e-mail and an in-app reminder.')) void run('run', async () => { const r = await api<{ run: Run }>('POST', '/admin/notifications/run', {}); return `Reminders run: ${r.run.items} item(s), ${r.run.emails} e-mail(s)` }) }}><Play size={13} /> {busy === 'run' ? 'Running…' : 'Run reminders now'}</button>
          </div>
        </section>
      </div>

      <section className="card flush">
        <h2>Reminder runs</h2>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Projects</th><th>Items</th><th>E-mails</th></tr></thead>
          <tbody>
            {data.runs.map((r) => <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.startedAt)}</td><td>{r.trigger === 'Scheduled' ? `Scheduled (${r.runDate})` : `Manual · ${r.startedBy ?? ''}`}</td><td><Badge tone={tone(r.status)} dot={false}>{r.status}</Badge>{r.error && <small>{r.error}</small>}</td><td>{r.projects}</td><td>{r.items}</td><td>{r.emails}</td></tr>)}
            {!data.runs.length && <tr><td colSpan={6}><Empty title="No runs yet" /></td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="card flush">
        <h2>Outbox</h2>
        <div className="filters" style={{ padding: '10px 16px 0' }}>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="E-mail status"><option value="all">All e-mails</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          <button className="btn" type="button" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button>
          <span className="muted small">{emails?.length ?? 0} e-mails · newest first · kept as delivery record</span>
        </div>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Queued</th><th>To</th><th>Subject</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(emails ?? []).map((m) => (
              <Fragment key={m.id}>
                <tr className={open === m.id ? 'sel' : ''}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(m.at)}</td>
                  <td>{m.toName}<small>{m.to}</small></td>
                  <td><button className="link" style={{ textAlign: 'left' }} onClick={() => setOpen(open === m.id ? null : m.id)}>{m.subject}</button><small>{m.kind}{m.project ? ` · ${m.project}` : ''}</small></td>
                  <td><Badge tone={tone(m.status)} dot={false}>{m.status}</Badge><small>{m.status === 'Sent' && m.sentAt ? fmtDate(m.sentAt) : m.attempts ? `${m.attempts} attempt(s)` : ''}{m.error ? ` · ${m.error}` : ''}</small></td>
                  <td style={{ textAlign: 'right' }}>{(m.status === 'Failed' || m.status === 'Not sent') && d.configured && <button className="btn sm" type="button" disabled={busy !== null} onClick={() => run(m.id, async () => { await api('POST', `/admin/emails/${m.id}/retry`, {}); return 'E-mail queued again' })}><RotateCcw size={12} /> Retry</button>}</td>
                </tr>
                {open === m.id && <tr><td colSpan={5}><pre className="mailbody">{m.body}</pre></td></tr>}
              </Fragment>
            ))}
            {emails && !emails.length && <tr><td colSpan={5}><Empty title="No e-mails" /></td></tr>}
          </tbody>
        </table></div>
      </section>
    </div>
  )
}
