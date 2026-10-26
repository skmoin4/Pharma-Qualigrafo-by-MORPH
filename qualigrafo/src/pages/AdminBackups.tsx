import { useCallback, useEffect, useState } from 'react'
import { DatabaseBackup, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import { api, errorText } from '../api'
import { useStore } from '../store'
import { Badge, Empty, fmtDate } from '../components/ui'

interface Settings { enabled: boolean; time: string; keep: number; verify: boolean }
interface Run {
  id: string; name: string; trigger: string; startedBy: string | null; startedAt: string; finishedAt: string | null; status: string
  sizeBytes: number | null; files: number; manifestSha: string | null; error: string | null; verifyStatus: string | null; verifiedAt: string | null; verifyDetail: string | null
}
interface Overview { settings: Settings; runs: Run[]; tools: { pgDump: string; server: string; ok: boolean; problem: string }; dir: string; busy: string | null }
const tone = (s: string | null) => (s === 'Done' || s === 'Verified' ? 'green' : s === 'Failed' ? 'red' : s === 'Running' ? 'blue' : '')
const size = (b: number | null) => (b === null ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/** Administration → Backups: schedule, back up now, test restore, history. Restore itself is a server command. */
export default function AdminBackups() {
  const toast = useStore((s) => s.toast)
  const [data, setData] = useState<Overview | null>(null)
  const [form, setForm] = useState<Settings | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { const o = await api<Overview>('GET', '/admin/backups'); setData(o); setForm((f) => f ?? o.settings) } catch (e) { toast(errorText(e), 'warn') }
  }, [toast])
  useEffect(() => { void load() }, [load])
  // While a backup or test restore runs in the background, refresh every 2 seconds.
  const running = !!data?.busy || !!data?.runs.some((r) => r.status === 'Running' || r.verifyStatus === 'Running')
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => { void load() }, 2000)
    return () => clearInterval(t)
  }, [running, load])
  const act = async (fn: () => Promise<string>) => { try { toast(await fn()); await load() } catch (e) { toast(errorText(e), 'warn') } }
  if (!data || !form) return <Empty title="Loading…" />
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings)
  const lastVerified = data.runs.find((r) => r.status === 'Done' && r.verifyStatus === 'Verified')
  const last = data.runs.find((r) => r.status === 'Done' || r.status === 'Failed')

  return (
    <div className="grid">
      {!data.tools.ok && <div className="notice err"><b>Backups cannot run:</b> {data.tools.problem}</div>}
      {last?.status === 'Failed' && <div className="notice err"><b>The latest backup failed</b> ({last.name}): {last.error}</div>}
      <div className="grid g2">
        <section className="card">
          <h2 style={{ margin: 0, justifyContent: 'flex-start', gap: 6 }}><DatabaseBackup size={15} /> Backups</h2>
          <p className="muted small">Each backup holds the database and every stored file with a SHA-256 manifest. A <b>test restore</b> loads it into a temporary database and checks records, migrations and every file. Copy the backup folder to off-site storage with your IT procedures; restoring after a loss is done on the server (<code>npm run backup:restore</code>, see the installation guide).</p>
          <div className="kv">
            <div><small>Last verified backup</small>{lastVerified ? `${fmtDate(lastVerified.startedAt)} · ${lastVerified.name}` : 'None yet'}</div>
            <div><small>Tools</small>{data.tools.ok ? `${data.tools.pgDump.replace('pg_dump (PostgreSQL)', 'PostgreSQL')} · server ${data.tools.server}` : 'Not available'}</div>
            <div style={{ gridColumn: '1 / -1' }}><small>Backup folder (on the server)</small><span style={{ wordBreak: 'break-all' }}>{data.dir}</span></div>
          </div>
          <button className="btn pri" type="button" disabled={running || !data.tools.ok} onClick={() => act(async () => { await api('POST', '/admin/backups', {}); return 'Backup started' })}><Play size={13} /> {running ? `${data.busy === 'verification' ? 'Test restore' : 'Backup'} running…` : 'Back up now'}</button>
        </section>
        <section className="card">
          <h2 style={{ margin: 0 }}>Schedule</h2>
          <label className="row" style={{ marginTop: 10 }}><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /><span>Daily backup</span></label>
          <div className="grid g2" style={{ marginTop: 6 }}>
            <div><label className="lab">Time (site time zone)</label><input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></div>
            <div><label className="lab">Keep (newest backups)</label><input className="input" type="number" min={3} max={90} value={form.keep} onChange={(e) => setForm({ ...form, keep: Number(e.target.value) })} /></div>
          </div>
          <label className="row" style={{ marginTop: 10 }}><input type="checkbox" checked={form.verify} onChange={(e) => setForm({ ...form, verify: e.target.checked })} /><span>Test restore after each backup</span></label>
          <p className="muted small">Older backups are deleted automatically; the newest verified backup is always kept. Administrators are e-mailed when a backup or test restore fails.</p>
          <button className="btn" type="button" disabled={!dirty} onClick={() => act(async () => { const r = await api<{ settings: Settings }>('PUT', '/admin/backups/settings', form); setForm(r.settings); return 'Backup schedule saved' })}>Save schedule</button>
        </section>
      </div>

      <section className="card flush">
        <h2>Backup history <button className="btn sm" type="button" onClick={() => void load()}><RefreshCw size={12} /> Refresh</button></h2>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Backup</th><th>Status</th><th>Size</th><th>Test restore</th><th /></tr></thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id}>
                <td style={{ minWidth: 190 }}><button className="link" style={{ textAlign: 'left' }} onClick={() => setOpen(open === r.id ? null : r.id)}>{r.name}</button><small>{fmtDate(r.startedAt)} · {r.trigger === 'Scheduled' ? 'Scheduled' : `Manual · ${r.startedBy ?? ''}`}</small>{open === r.id && r.manifestSha && <small style={{ wordBreak: 'break-all' }}>Manifest SHA-256 {r.manifestSha}</small>}</td>
                <td><Badge tone={tone(r.status)} dot={false}>{r.status}</Badge>{r.error && <small>{r.error}</small>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{size(r.sizeBytes)}<small>{r.files} file(s)</small></td>
                <td style={{ minWidth: 160 }}>{r.verifyStatus ? <Badge tone={tone(r.verifyStatus)} dot={false}>{r.verifyStatus}</Badge> : <span className="muted small">Not tested</span>}{r.verifiedAt && <small>{fmtDate(r.verifiedAt)}</small>}{open === r.id && r.verifyDetail && <small>{r.verifyDetail}</small>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{r.status === 'Done' && <button className="btn sm" type="button" disabled={running} onClick={() => act(async () => { await api('POST', `/admin/backups/${r.id}/verify`, {}); return `Test restore of ${r.name} started` })}><ShieldCheck size={12} /> Test restore</button>}</td>
              </tr>
            ))}
            {!data.runs.length && <tr><td colSpan={5}><Empty title="No backups yet" /></td></tr>}
          </tbody>
        </table></div>
      </section>
    </div>
  )
}
