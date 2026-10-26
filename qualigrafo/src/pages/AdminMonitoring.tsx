import { useCallback, useEffect, useState } from 'react'
import { Activity, BellRing, RefreshCw, ScrollText, Send } from 'lucide-react'
import { api, errorText } from '../api'
import { useStore } from '../store'
import { Badge, Empty, fmtDate } from '../components/ui'

interface Settings { alerts: boolean; onNewError: boolean; errorBurst: number; staleJobMin: number; diskMinFreePct: number }
interface Health {
  version: string; node: string; env: string; pid: number; startedAt: string; uptimeSec: number
  memory: { rssMb: number; heapMb: number }
  db: { ok: boolean; latencyMs: number; problem: string }
  storage: { dir: string; total: number | null; free: number | null; freePct: number | null }
  requests: { since: string; total: number; byClass: Record<string, number>; p50ms: number; p95ms: number; slowest: { path: string; ms: number } | null }
  errors: { open: number; occurrences: number; last24h: number }
  log: { level: string; format: string; dir: string | null; file: string | null; keepDays: number; writable: boolean; problem: string }
  metrics: { enabled: boolean; path: string }
}
interface Job { name: string; title: string; status: string; ageMin: number | null; lastRunAt: string | null; lastOkAt: string | null; runs: number; failures: number; lastError: string | null; detail: string | null }
interface ErrorGroup {
  id: string; kind: string; place: string; message: string; stack: string | null; count: number; firstAt: string; lastAt: string
  lastRequestId: string | null; lastUser: string | null; status: string; note: string | null; handledBy: string | null; handledAt: string | null; fingerprint: string
}
interface Outage { id: string; from: string; to: string; minutes: number; detail: string }
interface Overview { settings: Settings; health: Health; jobs: Job[]; errors: ErrorGroup[]; outages: Outage[] }

const tone = (s: string) => (s === 'Running' || s === 'Resolved' ? 'green' : s === 'Stale' || s === 'Failing' || s === 'New' ? 'red' : s === 'Acknowledged' ? 'amber' : '')
const gb = (b: number | null) => (b === null ? '—' : b > 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / 1048576)} MB`)
const duration = (sec: number) => (sec < 3600 ? `${Math.round(sec / 60)} min` : sec < 86400 ? `${(sec / 3600).toFixed(1)} h` : `${Math.round(sec / 86400)} d`)
const ago = (min: number | null) => (min === null ? 'never' : min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`)

/** Administration → Monitoring (P6): installation health, background jobs, errors, outages, alerts and the server log. */
export default function AdminMonitoring() {
  const toast = useStore((s) => s.toast)
  const [data, setData] = useState<Overview | null>(null)
  const [form, setForm] = useState<Settings | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [log, setLog] = useState<string[] | null>(null)
  const load = useCallback(async () => {
    try { const o = await api<Overview>('GET', '/admin/monitoring'); setData(o); setForm((f) => f ?? o.settings) } catch (e) { toast(errorText(e), 'warn') }
  }, [toast])
  useEffect(() => { void load() }, [load])
  const act = async (fn: () => Promise<string>) => { try { toast(await fn()); await load() } catch (e) { toast(errorText(e), 'warn') } }
  const setStatus = (g: ErrorGroup, status: 'Acknowledged' | 'Resolved' | 'New') => act(async () => {
    await api('POST', `/admin/monitoring/errors/${g.id}`, { status, note: status === 'New' ? '' : note })
    setNote('')
    return status === 'New' ? 'Error reopened' : `Error ${status.toLowerCase()}`
  })
  if (!data || !form) return <Empty title="Loading…" />
  const h = data.health
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings)
  const badJobs = data.jobs.filter((j) => j.status === 'Stale' || j.status === 'Failing')
  const lowDisk = h.storage.freePct !== null && h.storage.freePct < form.diskMinFreePct

  return (
    <div className="grid">
      {!h.db.ok && <div className="notice err"><b>The database does not answer:</b> {h.db.problem}</div>}
      {!h.log.writable && <div className="notice err"><b>The log folder cannot be written:</b> {h.log.problem}</div>}
      {!!badJobs.length && <div className="notice err"><b>{badJobs.length === 1 ? 'A background job is not running:' : 'Background jobs are not running:'}</b> {badJobs.map((j) => `${j.title} (${j.status.toLowerCase()}, last run ${ago(j.ageMin)})`).join('; ')}</div>}
      {lowDisk && <div className="notice warn"><b>Little free space:</b> {h.storage.freePct} % left on the file storage.</div>}

      <div className="grid g2">
        <section className="card">
          <h2 style={{ margin: 0, justifyContent: 'flex-start', gap: 6 }}><Activity size={15} /> Installation health</h2>
          <p className="muted small">Every request and every unexpected error is written to the server log with a request id; the same id is stored on the audit entries of that request, so a record can be traced back to the call that wrote it.</p>
          <div className="kv">
            <div><small>Version</small>Qualigrafo {h.version} · Node {h.node} · {h.env}</div>
            <div><small>Running since</small>{fmtDate(h.startedAt)} ({duration(h.uptimeSec)})</div>
            <div><small>Database</small>{h.db.ok ? `answers in ${h.db.latencyMs} ms` : 'not reachable'}</div>
            <div><small>Memory</small>{h.memory.rssMb} MB ({h.memory.heapMb} MB heap)</div>
            <div><small>File storage</small>{h.storage.freePct === null ? gb(h.storage.free) : `${h.storage.freePct} % free of ${gb(h.storage.total)}`}</div>
            <div><small>Errors</small>{h.errors.open} open · {h.errors.last24h} in the last 24 h</div>
            <div><small>Requests since start</small>{h.requests.total} ({Object.entries(h.requests.byClass).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'})</div>
            <div><small>Response time</small>median {h.requests.p50ms} ms · 95th percentile {h.requests.p95ms} ms</div>
            <div style={{ gridColumn: '1 / -1' }}><small>Server log</small>level {h.log.level}, format {h.log.format}, {h.log.dir ? <span style={{ wordBreak: 'break-all' }}>{h.log.file} (kept {h.log.keepDays} days)</span> : 'console only (collected by the container runtime)'}</div>
            <div style={{ gridColumn: '1 / -1' }}><small>Metrics endpoint</small>{h.metrics.enabled ? `on: ${h.metrics.path} (needs the METRICS_TOKEN of this installation)` : 'off — set METRICS_TOKEN to let an uptime tool read the figures'}</div>
          </div>
          <button className="btn" type="button" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button>
        </section>

        <section className="card">
          <h2 style={{ margin: 0, justifyContent: 'flex-start', gap: 6 }}><BellRing size={15} /> Alerts</h2>
          <p className="muted small">Administrators are e-mailed when a background job stops running, when the application was not running, when a new error appears or when disk space runs low. The same subject is sent at most once per hour.</p>
          <label className="row"><input type="checkbox" checked={form.alerts} onChange={(e) => setForm({ ...form, alerts: e.target.checked })} /><span>Send alert e-mails</span></label>
          <label className="row" style={{ marginTop: 6 }}><input type="checkbox" checked={form.onNewError} onChange={(e) => setForm({ ...form, onNewError: e.target.checked })} /><span>Alert on a new error</span></label>
          <div className="grid g2" style={{ marginTop: 6 }}>
            <div><label className="lab">Errors per hour before an alert</label><input className="input" type="number" min={0} max={1000} value={form.errorBurst} onChange={(e) => setForm({ ...form, errorBurst: Number(e.target.value) })} /></div>
            <div><label className="lab">Job silent for (minutes)</label><input className="input" type="number" min={5} max={1440} value={form.staleJobMin} onChange={(e) => setForm({ ...form, staleJobMin: Number(e.target.value) })} /></div>
            <div><label className="lab">Free space warning (%)</label><input className="input" type="number" min={0} max={90} value={form.diskMinFreePct} onChange={(e) => setForm({ ...form, diskMinFreePct: Number(e.target.value) })} /></div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn" type="button" disabled={!dirty} onClick={() => act(async () => { const r = await api<{ settings: Settings }>('PUT', '/admin/monitoring/settings', form); setForm(r.settings); return 'Alert settings saved' })}>Save alert settings</button>
            <button className="btn" type="button" onClick={() => act(async () => { await api('POST', '/admin/monitoring/test-alert', {}); return 'Test alert sent to the administrators' })}><Send size={13} /> Send test alert</button>
          </div>
        </section>
      </div>

      <section className="card flush">
        <h2>Background jobs</h2>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Job</th><th>State</th><th>Last run</th><th>Runs</th><th>Detail</th></tr></thead>
          <tbody>
            {data.jobs.map((j) => (
              <tr key={j.name}>
                <td>{j.title}<small>{j.name}</small></td>
                <td><Badge tone={tone(j.status)} dot={false}>{j.status}</Badge></td>
                <td style={{ whiteSpace: 'nowrap' }}>{j.lastRunAt ? fmtDate(j.lastRunAt) : '—'}<small>{ago(j.ageMin)}</small></td>
                <td>{j.runs}{!!j.failures && <small>{j.failures} failed</small>}</td>
                <td>{j.lastError ? <span className="muted small">{j.lastError}</span> : <span className="muted small">{j.detail ?? '—'}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>

      <section className="card flush">
        <h2>Errors <span className="muted small">{h.errors.open} open of {data.errors.length} group(s)</span></h2>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Error</th><th>Where</th><th>Count</th><th>State</th><th /></tr></thead>
          <tbody>
            {data.errors.map((g) => (
              <tr key={g.id}>
                <td style={{ minWidth: 240 }}>
                  <button className="link" style={{ textAlign: 'left' }} onClick={() => { setOpen(open === g.id ? null : g.id); setNote('') }}>{g.message}</button>
                  <small>first {fmtDate(g.firstAt)} · last {fmtDate(g.lastAt)}</small>
                  {open === g.id && <>
                    {g.lastRequestId && <small>Request id {g.lastRequestId}{g.lastUser ? ` · ${g.lastUser}` : ''}</small>}
                    {g.note && <small>Note: {g.note}{g.handledBy ? ` — ${g.handledBy}, ${fmtDate(g.handledAt!)}` : ''}</small>}
                    {g.stack && <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{g.stack.slice(0, 1200)}</pre>}
                  </>}
                </td>
                <td>{g.place}<small>{g.kind}</small></td>
                <td>{g.count}</td>
                <td><Badge tone={tone(g.status)} dot={false}>{g.status}</Badge></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', minWidth: 230 }}>
                  {g.status === 'Resolved'
                    ? <button className="btn sm" type="button" onClick={() => void setStatus(g, 'New')}>Reopen</button>
                    : <>
                      {open === g.id && <input className="input" style={{ marginBottom: 6 }} placeholder="What was found or done" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Error note" />}
                      {open === g.id
                        ? <>
                          {g.status === 'New' && <button className="btn sm" type="button" disabled={!note.trim()} onClick={() => void setStatus(g, 'Acknowledged')}>Acknowledge</button>}{' '}
                          <button className="btn sm" type="button" disabled={!note.trim()} onClick={() => void setStatus(g, 'Resolved')}>Resolve</button>
                        </>
                        : <span className="muted small">open for details</span>}
                    </>}
                </td>
              </tr>
            ))}
            {!data.errors.length && <tr><td colSpan={5}><Empty title="No errors recorded" /></td></tr>}
          </tbody>
        </table></div>
      </section>

      {!!data.outages.length && (
        <section className="card flush">
          <h2>Interruptions</h2>
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>From</th><th>To</th><th>Length</th><th>Detail</th></tr></thead>
            <tbody>{data.outages.map((o) => <tr key={o.id}><td>{fmtDate(o.from)}</td><td>{fmtDate(o.to)}</td><td>{o.minutes} min</td><td className="muted small">{o.detail}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}

      <section className="card">
        <h2 style={{ margin: 0, justifyContent: 'flex-start', gap: 6 }}><ScrollText size={15} /> Server log</h2>
        {h.log.dir
          ? <>
            <button className="btn sm" type="button" onClick={() => act(async () => { const r = await api<{ lines: string[] }>('GET', '/admin/monitoring/log?lines=200'); setLog(r.lines); return `${r.lines.length} log line(s) read` })}>Show the last 200 lines</button>
            {log && <pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', marginTop: 8 }}>{log.join('\n') || 'The log file is empty.'}</pre>}
          </>
          : <p className="muted small">The log goes to the console of the API process only (in the Docker installation: <code>docker compose logs api</code>). Set <code>LOG_DIR</code> to keep daily log files that can be read here.</p>}
      </section>
    </div>
  )
}
