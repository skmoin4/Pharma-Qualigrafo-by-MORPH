import { Fragment, useState } from 'react'
import { EditRecord } from '../components/EditRecord'
import type { GapAction } from '../types'
import { CheckCircle2, CircleAlert, Download } from 'lucide-react'
import { handoverGates, useStore } from '../store'
import { Badge, Empty, MarketChip, PageHead, fmtDate, go, home, useUI } from '../components/ui'
import type { PageKey } from '../components/ui'

function useAct() {
  const toast = useStore((s) => s.toast)
  return async (err: string | null | Promise<string | null>, ok: string) => { const e = await err; if (e) toast(e, 'warn'); else if (ok) toast(ok); return e }
}

export function Actions() {
  const { actions, role, progressAction, editAction } = useStore()
  const [edit, setEdit] = useState<string | null>(null)
  const open = useUI((s) => s.open)
  const act = useAct()
  const cols = ['Open', 'Ready for verification', 'Closed'] as const
  return (
    <>
      <PageHead title="Corrective actions" sub="The responsible party prepares and submits; an independent reviewer verifies and closes. Closing an action never auto-accepts the underlying evidence." />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Action</th><th>Requirement</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {cols.flatMap((c) => actions.filter((a) => a.status === c)).map((a) => (<Fragment key={a.id}>
              <tr>
                <td><b>{a.title}</b><small>{a.id}</small></td>
                <td><button className="link" onClick={() => open('req', a.req)}>{a.req}</button></td>
                <td>{a.owner}</td><td>{a.due}</td>
                <td><Badge tone={a.priority === 'High' ? 'red' : 'amber'}>{a.priority}</Badge></td>
                <td><Badge tone={a.status === 'Closed' ? 'green' : a.status === 'Open' ? 'amber' : 'blue'}>{a.status}</Badge></td>
                <td>
                  {a.status === 'Open' && <button className="btn sm pri" onClick={() => act(progressAction(a.id, 'Ready for verification'), 'Submitted for verification')}>Submit for verification</button>}
                  {a.status === 'Ready for verification' && <button className="btn sm pri" disabled={role === 'Contractor'} onClick={() => act(progressAction(a.id, 'Closed'), 'Verified and closed')}>Verify &amp; close</button>}
                  {role !== 'Contractor' && a.status !== 'Closed' && <> <button className="btn sm ghost" onClick={() => setEdit(edit === a.id ? null : a.id)} aria-label={`Edit ${a.id}`}>Edit</button></>}
                </td>
              </tr>
              {edit === a.id && <tr><td colSpan={7}><EditRecord name={a.id} onClose={() => setEdit(null)} initial={{ title: a.title, owner: a.owner, due: a.due, priority: a.priority }}
                fields={[{ key: 'title', label: 'Action', type: 'textarea', wide: true }, { key: 'owner', label: 'Owner' }, { key: 'due', label: 'Due', type: 'date' }, { key: 'priority', label: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'] }]}
                onSave={(v, reason) => editAction(a.id, { title: String(v.title), owner: String(v.owner), due: String(v.due), priority: v.priority as GapAction['priority'], reason })} /></td></tr>}
            </Fragment>))}
            {!actions.length && <tr><td colSpan={7}><Empty title="No corrective actions">Assign one from a requirement&apos;s detail panel when evidence is missing.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function Handover() {
  const s = useStore()
  const gates = handoverGates(s)
  const open = gates.filter((g) => g.n > 0)
  return (
    <>
      <PageHead title="Handover readiness" sub="Each condition is reported separately with its own count. There is deliberately no blended score." actions={<>{s.role !== 'Contractor' && <button className="btn pri" onClick={() => s.downloadReport('/reports/handover.pdf', 'Handover_Dossier.pdf')}><Download size={14} /> Handover dossier (PDF)</button>}<button className="btn" onClick={() => go('packages')}>Evidence packages</button></>} />
      <div className={`notice ${open.length ? '' : 'info'}`} style={{ marginBottom: 14 }}>{open.length ? <><b>Document gate: {open.length} of {gates.length} conditions open.</b> Handover cannot be recommended from these records until they are cleared.</> : <><b>All configured document conditions are clear.</b> Owner release remains a separate, signed decision outside this platform.</>}</div>
      <section className="card flush">
        <h2>Document-gate conditions</h2>
        <div style={{ padding: '0 16px' }}>
          {gates.map((g) => (
            <div className="gate" key={g.key}>
              {g.n === 0 ? <CheckCircle2 size={17} className="ico-ok" /> : <CircleAlert size={17} className="ico-bad" />}
              <div><b>{g.label}</b><div className="muted small">{g.note}</div></div>
              <div style={{ textAlign: 'right' }}>{g.n === 0 ? <Badge tone="green">Clear</Badge> : <Badge tone="amber">{g.n} open</Badge>}<div className="muted small">{g.of - g.n} of {g.of} satisfied</div></div>
              <button className="btn sm" onClick={() => go(g.page as PageKey)}>Open</button>
            </div>
          ))}
        </div>
      </section>
      <div className="grid g2 mt">
        <div className="notice info">Covers engineering documentation evidence only: premises, equipment, utilities, drawings, installation, commissioning and qualification records. It does not cover manufacturing operations, laboratory, batch release or establishment licensing.</div>
        <div className="notice"><b>Regulatory certification: not issued.</b> This platform records evidence status. It does not issue SFDA, MHRA, FDA or EU approval, nor a compliance certificate.</div>
      </div>
    </>
  )
}

export function Packages() {
  const { snapshots, createSnapshot, baseline, markets, toast, downloadReport } = useStore()
  const exportHtml = (id: string) => {
    const sn = snapshots.find((x) => x.id === id)!
    const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
    const html = `<!doctype html><meta charset="utf-8"><title>${sn.id} evidence package</title><style>body{font:13px Arial;margin:36px;color:#15262f}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd;padding:6px 8px;text-align:left}h1{font-size:20px}</style><h1>Qualigrafo — evidence package ${sn.id}</h1><p><b>Not a compliance certificate and not an approval by any authority.</b> Baseline B${sn.baseline} · Markets ${sn.markets.join(', ')} · ${sn.at} · frozen by ${sn.by}</p><p>${sn.accepted} of ${sn.required} required topics have accepted evidence. ${sn.blockers.length} unresolved item(s). Original evidence files are not included.</p><table><tr><th>ID</th><th>Requirement</th><th>Market</th><th>Applicability</th><th>Evidence state</th><th>Linked revisions</th></tr>${sn.rows.map((r) => `<tr><td>${r.id}</td><td>${esc(r.title)}</td><td>${r.market}</td><td>${r.applicability}</td><td>${r.state}</td><td>${esc(r.links)}</td></tr>`).join('')}</table>`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    a.download = `Qualigrafo_${sn.id}_B${sn.baseline}.html`
    a.click()
  }
  const exportJson = (id: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(snapshots.find((x) => x.id === id), null, 2)], { type: 'application/json' }))
    a.download = `Qualigrafo_${id}.json`
    a.click()
  }
  return (
    <>
      <PageHead title="Audit evidence packages" sub="Freeze the current baseline and evidence state. A package always lists every gap; it can never present an incomplete state as certified." actions={<button className="btn pri" onClick={async () => { const er = await createSnapshot(); toast(er ?? `${useStore.getState().snapshots[0]?.id} frozen with all outstanding items disclosed`, er ? 'warn' : 'ok') }}>Freeze package at B{baseline}</button>} />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Package</th><th>Baseline · markets</th><th>Frozen</th><th>Evidence accepted</th><th>Outstanding</th><th>Export</th></tr></thead>
          <tbody>
            {snapshots.map((x) => (
              <tr key={x.id}>
                <td><b>{x.id}</b><small>{x.by}</small></td>
                <td>B{x.baseline} · {x.markets.map((m) => <span key={m}><MarketChip m={m} /> </span>)}</td>
                <td>{fmtDate(x.at)}</td>
                <td>{x.accepted} / {x.required}</td>
                <td>{x.blockers.length ? <Badge tone="amber">{x.blockers.length} item(s)</Badge> : <Badge tone="green">None</Badge>}</td>
                <td><div className="row"><button className="btn sm pri" onClick={() => downloadReport(`/snapshots/${x.id}/report.pdf`, `${x.id}_B${x.baseline}.pdf`)}><Download size={12} /> PDF</button><button className="btn sm" onClick={() => exportHtml(x.id)}>Printable</button><button className="btn sm" onClick={() => exportJson(x.id)}>JSON</button></div></td>
              </tr>
            ))}
            {!snapshots.length && <tr><td colSpan={6}><Empty title="No packages yet">Freeze a package to capture baseline B{baseline} for {markets.join(', ')}. Later changes never alter a frozen package.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function Updates() {
  const { updates, assessUpdate, role, baseline, baselines } = useStore()
  const act = useAct()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  return (
    <>
      <PageHead title="Regulatory change review" sub="A new publication never silently replaces the live checklist. A qualified reviewer decides applicability; an applicable change creates a new baseline and reopens only the affected evidence." actions={<Badge tone="blue">Current baseline B{baseline}</Badge>} />
      <div className="notice info" style={{ marginBottom: 14 }}>Owner / QA assesses each regulatory update. Applying it creates a new requirement baseline and reopens only the evidence of the affected requirements; judging it not applicable is recorded with the rationale.</div>
      <div className="steps" style={{ marginBottom: 14 }}>{['Update detected', 'Qualified review', 'Approved rule pack', 'Projects flagged', 'Actions assigned', 'Evidence re-reviewed'].map((x, i) => <span key={x} className={`step ${i < 2 ? 'on' : ''}`}>{x}</span>)}</div>
      {updates.map((u) => (
        <section className="card" key={u.id} style={{ marginBottom: 12 }}>
          <div className="row sb"><h2 style={{ margin: 0 }}><MarketChip m={u.market} /> {u.title} {u.kind === 'Library' && <Badge tone="violet" dot={false}>Library update</Badge>}</h2><Badge tone={u.status === 'Awaiting assessment' ? 'amber' : u.status === 'Not applicable' ? '' : 'green'}>{u.status}</Badge></div>
          <p className="muted" style={{ margin: '8px 0' }}>{u.summary}</p>
          <p className="small">{u.kind === 'Library' ? <>Changed or removed requirements: {u.reqs.length ? u.reqs.join(', ') : 'none (additions only)'}. Applying adds the new items as Assessment pending, reopens changed ones and marks removed ones Not applicable. <button className="link small" onClick={() => home('library')}>Open library</button></> : <>Potentially affected requirements: {u.reqs.join(', ')}</>}</p>
          {u.status === 'Awaiting assessment' ? (
            <>
              <textarea className="input" style={{ marginTop: 8 }} placeholder="Qualified-reviewer rationale…" value={reasons[u.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [u.id]: e.target.value })} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn pri" disabled={role !== 'Owner / QA'} onClick={() => act(assessUpdate(u.id, true, reasons[u.id] ?? ''), u.kind === 'Library' ? 'Library version applied; new baseline created' : 'New baseline created; affected evidence reopened')}>{u.kind === 'Library' ? 'Apply to project: new baseline' : 'Applicable: create new baseline'}</button>
                <button className="btn" disabled={role !== 'Owner / QA'} onClick={() => act(assessUpdate(u.id, false, reasons[u.id] ?? ''), 'Recorded as not applicable')}>Not applicable</button>
                {role !== 'Owner / QA' && <span className="muted small">Owner / QA role required</span>}
              </div>
            </>
          ) : <p className="small" style={{ marginTop: 8 }}><b>Decision:</b> {u.reason}</p>}
        </section>
      ))}
      {!updates.length && <div className="card"><Empty title="No pending updates">No regulatory or library updates await assessment for this project.</Empty></div>}
      <section className="card flush mt">
        <h2>Baseline history</h2>
        <div className="tablewrap" style={{ border: 0 }}><table><tbody>{[...baselines].reverse().map((b) => <tr key={b.v}><td><Badge tone={b.v === baseline ? 'teal' : ''}>B{b.v}</Badge></td><td>{b.reason}</td><td className="muted">{b.by} · {fmtDate(b.at)}</td></tr>)}</tbody></table></div>
      </section>
    </>
  )
}
