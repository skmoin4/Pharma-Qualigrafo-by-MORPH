import { useCallback, useEffect, useState } from 'react'
import { Download, FileCheck2, Play, ServerCog } from 'lucide-react'
import { api, downloadAs, errorText } from '../api'
import { useStore } from '../store'
import { Badge, Empty, fmtDate } from '../components/ui'

interface IqCheck { id: string; title: string; expected: string; actual: string; status: 'Pass' | 'Fail' | 'Warning' | 'Info' }
interface Iq { executedAt: string; executedBy: string; overall: 'Pass' | 'Fail'; version: string; fingerprint: string; checks: IqCheck[] }
interface Pack { name: string; size: number; at: string; sha256: string }
interface Overview { version: string; fingerprint: string; iq: Iq | null; packs: Pack[]; catalogue: { urs: number; oqCases: number } }
const tone = (s: string) => (s === 'Pass' ? 'green' : s === 'Fail' ? 'red' : s === 'Warning' ? 'amber' : '')

/** Administration → System & validation: installation check (IQ) with PDF record, and the supplier validation packs. */
export default function AdminValidation() {
  const toast = useStore((s) => s.toast)
  const [data, setData] = useState<Overview | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { setData(await api<Overview>('GET', '/admin/validation')) } catch (e) { toast(errorText(e), 'warn') }
  }, [toast])
  useEffect(() => { void load() }, [load])
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } catch (e) { toast(errorText(e), 'warn') } finally { setBusy(false) } }
  if (!data) return <Empty title="Loading…" />
  const iq = data.iq
  const n = (s: string) => iq?.checks.filter((c) => c.status === s).length ?? 0

  return (
    <div className="grid">
      <div className="grid g2">
        <section className="card">
          <h2 style={{ margin: 0, justifyContent: 'flex-start', gap: 6 }}><ServerCog size={15} /> Installed software</h2>
          <div className="kv">
            <div><small>Version</small>Qualigrafo {data.version}</div>
            <div><small>Validation catalogue</small>{data.catalogue.urs} requirements · {data.catalogue.oqCases} OQ test cases</div>
            <div style={{ gridColumn: '1 / -1' }}><small>Code fingerprint (SHA-256)</small><span style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5, wordBreak: 'break-all' }}>{data.fingerprint}</span></div>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>The fingerprint must equal the one in the validation pack of this release; a different value means the installed code is not the qualified code.</p>
        </section>
        <section className="card">
          <h2 style={{ margin: 0, justifyContent: 'flex-start', gap: 6 }}><FileCheck2 size={15} /> Installation check (IQ)</h2>
          <p className="muted small">Checks runtime, database, migrations, dependencies, configuration, file storage, administrator access and e-mail of this installation. Run it after installing or updating, keep the signed PDF with your validation records.</p>
          {iq && <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}><Badge tone={tone(iq.overall)} dot={false}>Overall {iq.overall}</Badge><Badge tone="green" dot={false}>{n('Pass')} pass</Badge>{n('Warning') > 0 && <Badge tone="amber" dot={false}>{n('Warning')} warning</Badge>}{n('Fail') > 0 && <Badge tone="red" dot={false}>{n('Fail')} fail</Badge>}<span className="muted small">{fmtDate(iq.executedAt)} · {iq.executedBy}</span></div>}
          <div className="row wrap">
            <button className="btn pri" type="button" disabled={busy} onClick={() => act(async () => { const r = await api<{ iq: Iq }>('POST', '/admin/validation/iq', {}); setData({ ...data, iq: r.iq }); toast(`Installation check: ${r.iq.overall}`) })}><Play size={13} /> {busy ? 'Checking…' : 'Run installation check'}</button>
            <button className="btn" type="button" disabled={busy || !iq} onClick={() => act(() => downloadAs('/admin/validation/iq.pdf', 'Qualigrafo_IQ.pdf'))}><Download size={13} /> IQ record (PDF)</button>
          </div>
        </section>
      </div>

      {iq && (
        <section className="card flush">
          <h2>Installation check results</h2>
          <div className="tablewrap" style={{ border: 0 }}><table>
            <thead><tr><th>Check</th><th>Expected</th><th>Found</th><th>Result</th></tr></thead>
            <tbody>{iq.checks.map((c) => <tr key={c.id}><td style={{ minWidth: 150 }}><b>{c.title}</b><small>{c.id}</small></td><td>{c.expected}</td><td style={{ wordBreak: 'break-word' }}>{c.actual}</td><td><Badge tone={tone(c.status)} dot={false}>{c.status}</Badge></td></tr>)}</tbody>
          </table></div>
        </section>
      )}

      <section className="card flush">
        <h2>Validation packs</h2>
        <p className="muted small" style={{ padding: '0 16px' }}>Supplier evidence for computerised-system validation: user requirements, risk assessment, IQ and OQ results (every automated test check), traceability matrix and approval page. Produced for each release with <code>npm run validation:oq</code> and <code>npm run validation:pack</code> on a test environment; it supports, and does not replace, your own validation.</p>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Pack</th><th>Created</th><th>SHA-256</th><th /></tr></thead>
          <tbody>
            {data.packs.map((p) => <tr key={p.name}><td><b>{p.name}</b><small>{Math.round(p.size / 1024)} KB</small></td><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.at)}</td><td style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, wordBreak: 'break-all' }}>{p.sha256}</td><td style={{ textAlign: 'right' }}><button className="btn sm" type="button" disabled={busy} onClick={() => act(() => downloadAs(`/admin/validation/packs/${encodeURIComponent(p.name)}`, p.name))}><Download size={12} /> PDF</button></td></tr>)}
            {!data.packs.length && <tr><td colSpan={4}><Empty title="No validation pack on this installation">Your supplier provides the pack for each release; it can also be generated on a test environment.</Empty></td></tr>}
          </tbody>
        </table></div>
      </section>
    </div>
  )
}
