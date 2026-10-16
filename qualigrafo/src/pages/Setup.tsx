import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { markets } from '../data/seed'
import { useStore } from '../store'
import type { Facility, MarketKey, Scope } from '../types'
import { Badge, MarketChip, PageHead, fmtDate } from '../components/ui'

const FAC: Facility[] = ['API', 'Non-sterile formulation', 'Sterile products', 'Biologics', 'Warehouse']
const SCOPE: Scope[] = ['New plant', 'Expansion', 'Renovation', 'Equipment installation']

export default function Setup() {
  const { profile, markets: sel, baseline, baselines, reqs, role, saveProfile, toast } = useStore()
  const [facility, setFacility] = useState(profile.facility)
  const [scope, setScope] = useState(profile.scope)
  const [phase, setPhase] = useState(profile.phase)
  const [std, setStd] = useState(profile.ownerStandards)
  const [mk, setMk] = useState<MarketKey[]>(sel)
  const [reason, setReason] = useState('')
  const admin = role === 'Owner / QA'
  const material = facility !== profile.facility || scope !== profile.scope

  const submit = () => {
    const err = saveProfile({ facility, scope, phase, ownerStandards: std, markets: mk, reason })
    if (err) toast(err, 'warn')
    else { toast('New baseline created; the previous baseline is preserved'); setReason('') }
  }

  return (
    <>
      <PageHead title="Project setup & baseline" sub="Plant location and target markets are captured independently. Every scope change creates a new requirement baseline; earlier baselines and approvals are preserved." actions={<Badge tone="blue">Current baseline B{baseline}</Badge>} />
      <div className="grid g21">
        <section className="card">
          <h2>Project profile</h2>
          <div className="grid g2">
            <div>
              <label className="lab" style={{ marginTop: 0 }}>Plant location</label>
              <input className="input" value={`${profile.site} (${markets[profile.plantCountry].name})`} disabled />
              <label className="lab">Facility type</label>
              <select className="input" value={facility} disabled={!admin} onChange={(e) => setFacility(e.target.value as Facility)}>{FAC.map((x) => <option key={x}>{x}</option>)}</select>
              <label className="lab">Project scope</label>
              <select className="input" value={scope} disabled={!admin} onChange={(e) => setScope(e.target.value as Scope)}>{SCOPE.map((x) => <option key={x}>{x}</option>)}</select>
              <label className="lab">Project phase</label>
              <input className="input" value={phase} disabled={!admin} onChange={(e) => setPhase(e.target.value)} />
            </div>
            <div>
              <label className="lab" style={{ marginTop: 0 }}>Target markets (where product will be supplied)</label>
              {(Object.keys(markets) as MarketKey[]).map((k) => (
                <label key={k} className="row" style={{ padding: '4px 0', fontWeight: 500 }}>
                  <input type="checkbox" checked={mk.includes(k)} disabled={!admin || k === profile.plantCountry} onChange={(e) => setMk(e.target.checked ? [...mk, k] : mk.filter((x) => x !== k))} />
                  <MarketChip m={k} /> {markets[k].name} <span className="muted small">{reqs.filter((r) => r.market === k).length ? `${reqs.filter((r) => r.market === k).length} mapped topics` : 'no topics mapped'}</span>
                </label>
              ))}
              <p className="muted small" style={{ marginTop: 6 }}>The plant country always stays in scope. A market with no mapped topics shows explicit “no coverage”, never 100%.</p>
            </div>
          </div>
          <label className="lab">Applicable owner standards and approved procedures</label>
          <textarea className="input" style={{ minHeight: 56 }} value={std} disabled={!admin} onChange={(e) => setStd(e.target.value)} />
          <label className="lab">Change rationale (required)</label>
          <textarea className="input" style={{ minHeight: 56 }} value={reason} disabled={!admin} onChange={(e) => setReason(e.target.value)} placeholder="Why is the project scope being configured or changed?" />
          {material && <div className="notice" style={{ marginTop: 10 }}>Changing facility type or project scope resets all applicability decisions to “Assessment pending”. Historical baselines keep their original decisions.</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn pri" disabled={!admin} onClick={submit}>Save as new baseline B{baseline + 1}</button>
            {!admin && <span className="muted small">Owner / QA role required</span>}
          </div>
        </section>

        <section className="card flush" style={{ alignSelf: 'start' }}>
          <h2>Baseline history</h2>
          <div className="tablewrap" style={{ border: 0 }}>
            <table><tbody>
              {[...baselines].reverse().map((b) => <tr key={b.v}><td><Badge tone={b.v === baseline ? 'teal' : ''}>B{b.v}</Badge></td><td>{b.reason}<small>{b.by} · {fmtDate(b.at)}</small></td></tr>)}
            </tbody></table>
          </div>
        </section>
      </div>

      <section className="card flush mt">
        <h2>Regulatory source inventory <span className="muted small" style={{ fontWeight: 400 }}>controlled sources, not validated checklists</span></h2>
        <div className="tablewrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>Market</th><th>Authority</th><th>Reference base</th><th>Pack status</th><th></th></tr></thead>
            <tbody>
              {(Object.keys(markets) as MarketKey[]).map((k) => (
                <tr key={k}>
                  <td><MarketChip m={k} /> {markets[k].name}</td>
                  <td>{markets[k].authority}</td>
                  <td>{markets[k].base}</td>
                  <td><Badge tone="amber">Draft topic mapping · not verified</Badge><small>Version / effective date pending expert verification</small></td>
                  <td><a href={markets[k].url} target="_blank" rel="noopener noreferrer">Official source <ExternalLink size={11} /></a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
