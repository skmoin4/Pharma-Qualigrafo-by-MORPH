import { useMemo, useState } from 'react'
import { Download, Plus } from 'lucide-react'
import { markets } from '../data/reference'
import { evidenceState, plusDays, useStore } from '../store'
import type { MarketKey } from '../types'
import { Applic, Badge, Empty, MarketChip, PageHead, R, StateBadge, useUI } from '../components/ui'
import type { Applicability } from '../types'
import { DisciplineSelect, SystemSelect } from '../components/Pickers'

function AddRequirement({ onClose }: { onClose: () => void }) {
  const { markets: sel, addRequirement, toast } = useStore()
  const [f, setF] = useState({ title: '', market: sel[0], discipline: '', system: '', topic: '', critical: false, owner: 'Consultant', due: plusDays(30) })
  const set = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v })
  const save = async () => { const er = await addRequirement(f); if (er) toast(er, 'warn'); else { toast('Project-specific requirement added'); onClose() } }
  return (
    <section className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Add a project-specific requirement</h2>
      <p className="muted small" style={{ marginTop: 0 }}>For owner standards, URS items or commitments that are not in the approved library. It is recorded as Required. Market requirements come from the Requirement library.</p>
      <label className="lab">Requirement</label><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} aria-label="New requirement title" />
      <div className="grid g4">
        <div><label className="lab">Market</label><select className="input" value={f.market} onChange={(e) => set('market', e.target.value)} aria-label="New requirement market">{sel.map((m) => <option key={m} value={m}>{markets[m].name}</option>)}</select></div>
        <div><label className="lab">Discipline</label><DisciplineSelect value={f.discipline} onChange={(v) => set('discipline', v)} /></div>
        <div><label className="lab">System (optional)</label><SystemSelect value={f.system} onChange={(v) => set('system', v)} /></div>
        <div><label className="lab">Owner · due</label><div className="row"><input className="input" value={f.owner} onChange={(e) => set('owner', e.target.value)} aria-label="New requirement owner" /><input className="input" type="date" value={f.due} onChange={(e) => set('due', e.target.value)} aria-label="New requirement due" /></div></div>
      </div>
      <label className="lab">Source / basis (e.g. URS section, owner standard)</label><input className="input" value={f.topic} onChange={(e) => set('topic', e.target.value)} aria-label="New requirement basis" />
      <label className="row" style={{ marginTop: 8 }}><input type="checkbox" checked={f.critical} onChange={(e) => set('critical', e.target.checked)} /><span className="small">Critical requirement</span></label>
      <div className="row" style={{ marginTop: 10 }}><button className="btn pri" onClick={save}>Add requirement</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </section>
  )
}

export default function Requirements() {
  const { reqs, docs, markets: sel, pins, role, decideApplicabilityBulk, toast } = useStore()
  // Deciding applicability one by one is right for a few items; a freshly applied market pack brings dozens.
  const [picked, setPicked] = useState<string[]>([])
  const [bulk, setBulk] = useState<{ a: Applicability; rationale: string }>({ a: 'Required', rationale: '' })
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const open = useUI((s) => s.open)
  const [tab, setTab] = useState<'register' | 'reuse'>('register')
  const [q, setQ] = useState('')
  const [mk, setMk] = useState<'all' | MarketKey>('all')
  const [ap, setAp] = useState('all')
  const [st, setSt] = useState('all')

  const rows = useMemo(
    () => reqs.filter((r) => sel.includes(r.market) && (mk === 'all' || r.market === mk) && (ap === 'all' || r.applicability === ap) && (st === 'all' || evidenceState(r, docs) === st) && `${r.id} ${r.title} ${r.system} ${r.discipline}`.toLowerCase().includes(q.toLowerCase())),
    [reqs, docs, sel, mk, ap, st, q],
  )
  const csv = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const body = [['ID', 'Requirement', 'Market', 'Discipline', 'System', 'Applicability', 'Evidence state', 'Source topic', 'Clause', 'Source version', 'Effective date', 'Attested'], ...rows.map((r) => [r.id, r.title, r.market, r.discipline, r.system, r.applicability, evidenceState(r, docs), r.topic, r.clause, r.sourceVersion, r.effective, r.sourceAttested ? 'yes' : 'no'])].map((x) => x.map(cell).join(',')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
    a.download = 'Qualigrafo_Requirements.csv'
    a.click()
  }
  const scoped = reqs.filter((r) => sel.includes(r.market))
  const reqd = scoped.filter((r) => r.applicability === 'Required')
  const count = (s: string) => reqd.filter((r) => evidenceState(r, docs) === s).length
  const evDocs = new Set(reqd.flatMap((r) => r.evidence.filter((e) => e.decision !== 'Withdrawn').map((e) => e.doc)))
  const openCmts = pins.filter((p) => p.status === 'Open' && evDocs.has(p.doc)).length
  const gaps: { label: string; n: number; tone: string; st?: string; ap?: string }[] = [
    { label: 'Missing evidence', n: count('Evidence missing'), tone: 'red', st: 'Evidence missing' },
    { label: 'Outdated revision', n: count('Revision changed'), tone: 'red', st: 'Revision changed' },
    { label: 'Correction required', n: count('Correction required'), tone: 'red', st: 'Correction required' },
    { label: 'Under assessment', n: count('Under assessment'), tone: 'amber', st: 'Under assessment' },
    { label: 'Applicability pending', n: scoped.filter((r) => r.applicability === 'Assessment pending').length, tone: 'violet', ap: 'Assessment pending' },
    { label: 'Open comments on evidence', n: openCmts, tone: 'amber' },
  ]
  // Only reviewers decide applicability, so only they get the selection column.
  const reviewer = role !== 'Contractor'
  const allPicked = !!rows.length && rows.every((r) => picked.includes(r.id))
  const reuse = docs.map((d) => ({ d, links: reqs.filter((r) => sel.includes(r.market) && r.evidence.some((e) => e.doc === d.id && e.decision !== 'Withdrawn')) })).filter((x) => x.links.length).sort((a, b) => b.links.length - a.links.length)

  return (
    <>
      <PageHead title="Requirements & evidence" sub="Clause-wise requirements per market. Applicability, evidence status and document approval are tracked as three separate things." actions={<>{role !== 'Contractor' && tab === 'register' && <button className="btn" onClick={() => setAdding(!adding)}><Plus size={14} /> Add requirement</button>}<button className="btn" onClick={csv}><Download size={14} /> Export register</button></>} />
      <div className="tabs">
        <button className={tab === 'register' ? 'on' : ''} onClick={() => setTab('register')}>Requirement register</button>
        <button className={tab === 'reuse' ? 'on' : ''} onClick={() => setTab('reuse')}>Cross-market evidence reuse</button>
      </div>

      {tab === 'register' ? (
        <>
          {adding && <AddRequirement onClose={() => setAdding(false)} />}
          <div className="row wrap" style={{ marginBottom: 12 }} aria-label="Gap breakdown">{gaps.map((g) => g.st || g.ap ? <button key={g.label} className="btn sm" onClick={() => { if (g.st) setSt(st === g.st ? 'all' : g.st); if (g.ap) setAp(ap === g.ap ? 'all' : g.ap) }} style={st === g.st || ap === g.ap ? { borderColor: 'var(--teal)', background: 'var(--brand-bg)' } : undefined}><span className={`badge ${g.tone}`} style={{ padding: '0 6px' }}>{g.n}</span> {g.label}</button> : <span key={g.label} className="small muted" style={{ padding: '0 6px' }}><span className={`badge ${g.tone}`} style={{ padding: '0 6px' }}>{g.n}</span> {g.label}</span>)}<span className="muted small">Click a gap type to filter.</span></div>
          <div className="filters">
            <input className="input grow" placeholder="Search requirement, system or discipline…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requirements" />
            <select className="input" value={mk} onChange={(e) => setMk(e.target.value as 'all' | MarketKey)} aria-label="Market"><option value="all">All markets</option>{sel.map((m) => <option key={m} value={m}>{markets[m].name}</option>)}</select>
            <select className="input" value={ap} onChange={(e) => setAp(e.target.value)} aria-label="Applicability"><option value="all">Any applicability</option>{['Required', 'Not applicable', 'Assessment pending'].map((x) => <option key={x}>{x}</option>)}</select>
            <select className="input" value={st} onChange={(e) => setSt(e.target.value)} aria-label="Evidence state"><option value="all">Any evidence state</option>{['Evidence missing', 'Under assessment', 'Evidence accepted', 'Revision changed', 'Correction required'].map((x) => <option key={x}>{x}</option>)}</select>
            <span className="muted small">{rows.length} of {reqs.filter((r) => sel.includes(r.market)).length}</span>
          </div>
          {reviewer && !!picked.length && (
            <section className="card bulkbar" aria-label="Batch decision">
              <div className="row wrap" style={{ gap: 10 }}>
                <b>{picked.length} selected</b>
                <select className="input" style={{ width: 'auto' }} value={bulk.a} onChange={(e) => setBulk({ ...bulk, a: e.target.value as Applicability })} aria-label="Applicability for the selected requirements">
                  {(['Required', 'Not applicable', 'Assessment pending'] as Applicability[]).map((x) => <option key={x}>{x}</option>)}
                </select>
                <input className="input grow" style={{ minWidth: 260 }} placeholder="Reviewer rationale for this decision" value={bulk.rationale} onChange={(e) => setBulk({ ...bulk, rationale: e.target.value })} aria-label="Rationale for the selected requirements" />
                <button
                  className="btn pri" type="button" disabled={busy || !bulk.rationale.trim()}
                  onClick={async () => {
                    setBusy(true)
                    const er = await decideApplicabilityBulk(picked, bulk.a, bulk.rationale)
                    setBusy(false)
                    if (er) return toast(er, 'warn')
                    toast(`${picked.length} requirement(s) set to ${bulk.a}`)
                    setPicked([])
                    setBulk({ ...bulk, rationale: '' })
                  }}
                >{busy ? 'Recording…' : `Record decision for ${picked.length}`}</button>
                <button className="btn" type="button" onClick={() => setPicked([])}>Clear</button>
              </div>
              <p className="muted small" style={{ margin: '8px 0 0' }}>The rationale is written to every selected requirement and each one keeps its own audit entry.</p>
            </section>
          )}
          <div className="tablewrap">
            <table>
              <thead><tr>{reviewer && <th style={{ width: 34 }}><input type="checkbox" aria-label="Select all shown requirements" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.id) : [])} /></th>}<th>Requirement</th><th>Mkt</th><th>System / discipline</th><th>Source reference</th><th>Applicability</th><th>Evidence status</th><th>Linked</th><th>Owner · due</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={picked.includes(r.id) ? 'sel' : undefined}>
                    {reviewer && <td><input type="checkbox" aria-label={`Select ${r.id}`} checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} /></td>}
                    <td><button className="link" onClick={() => open('req', r.id)}>{r.title}</button><small>{r.id}{r.critical ? ' · Critical' : ''} · {r.libraryKey ? `Library v${r.libraryVersion} · ${r.libraryKey}` : 'Project-specific'}</small></td>
                    <td><MarketChip m={r.market} /></td>
                    <td>{r.system || <span className="muted">System not assigned</span>}<small>{r.discipline}</small></td>
                    <td>{r.clause ? <>{r.clause}<small>{r.sourceVersion} · eff. {r.effective}{r.sourceAttested ? ' · attested' : ' · draft'}</small></> : <Badge tone="amber" dot={false}>Clause pending</Badge>}</td>
                    <td><Applic a={r.applicability} /></td>
                    <td><StateBadge s={evidenceState(r, docs)} /></td>
                    <td>{r.evidence.some((e) => e.decision !== 'Withdrawn') ? r.evidence.filter((e) => e.decision !== 'Withdrawn').map((e) => `${e.doc} ${R(e.rev)}`).join(', ') : <span className="muted">—</span>}</td>
                    <td>{r.owner}<small>{r.due}</small></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={reviewer ? 9 : 8}><Empty title="No requirements match">Change the filters, or add reviewed requirements if a newly selected market has none mapped.</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="notice info" style={{ marginBottom: 12 }}>One document can support several markets, but every link keeps its own assessment. Reuse never implies that two regulations are legally equivalent.</div>
          <div className="tablewrap">
            <table className="matrix">
              <thead><tr><th>Document / evidence</th>{sel.map((m) => <th key={m}>{markets[m].short}</th>)}<th style={{ textAlign: 'left' }}>Reuse</th></tr></thead>
              <tbody>
                {reuse.map(({ d, links }) => (
                  <tr key={d.id}>
                    <td><button className="link" onClick={() => open('doc', d.id)}>{d.title}</button> <span className="rev">{R(d.rev)}</span><small>{d.id}</small></td>
                    {sel.map((m) => {
                      const l = links.filter((r) => r.market === m)
                      if (!l.length) return <td key={m}><span className="dot no">–</span></td>
                      const ok = l.every((r) => r.evidence.find((e) => e.doc === d.id && e.decision !== 'Withdrawn')?.decision === 'Accepted')
                      return <td key={m}><span className={`dot ${ok ? 'ok' : 'wait'}`} title={ok ? 'Accepted for this market' : 'Assessment pending'}>{l.length}</span></td>
                    })}
                    <td style={{ textAlign: 'left' }}>{new Set(links.map((r) => r.market)).size > 1 ? <Badge tone="teal">Shared by {new Set(links.map((r) => r.market)).size} markets</Badge> : <Badge dot={false}>Single market</Badge>}</td>
                  </tr>
                ))}
                {!reuse.length && <tr><td colSpan={sel.length + 2}><Empty title="No evidence linked yet" /></td></tr>}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>Green: accepted for that market · Amber: linked, assessment pending · Figure: requirements supported.</p>
        </>
      )}
    </>
  )
}
