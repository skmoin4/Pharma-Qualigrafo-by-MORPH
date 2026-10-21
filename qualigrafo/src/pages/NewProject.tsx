import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Plus, Trash2 } from 'lucide-react'
import { api, errorText } from '../api'
import { disciplines as STANDARD_DISCIPLINES, markets } from '../data/reference'
import { useStore } from '../store'
import type { NewProject as Spec } from '../store'
import type { Facility, MarketKey, Role, Scope } from '../types'
import { Badge, MarketChip, PageHead, home, openProjectRoute } from '../components/ui'
import { approvedOf, useLibraryPacks } from '../library'

const FAC: Facility[] = ['API', 'Non-sterile formulation', 'Sterile products', 'Biologics', 'Warehouse']
const SCOPES: Scope[] = ['New plant', 'Expansion', 'Renovation', 'Equipment installation']
const KINDS = ['Engineering consultant', 'Main contractor', 'Subcontractor', 'Vendor / supplier', 'Other']
const ROLES: Role[] = ['Owner / QA', 'Consultant', 'Contractor']
const STEPS = ['Basics', 'Scope & markets', 'Registers', 'Team', 'Review'] as const

interface DirUser { id: string; name: string; email: string; company: string | null }

export default function NewProject() {
  const { session, createProject, toast } = useStore()
  const [step, setStep] = useState(0)
  const [users, setUsers] = useState<DirUser[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extra, setExtra] = useState('')
  const { packs } = useLibraryPacks()
  const [f, setF] = useState<Spec>({
    code: '', name: '', client: '', site: '', plantCountry: 'SA', markets: [], facility: 'Non-sterile formulation', scope: 'New plant', phase: 'Design', ownerStandards: '',
    disciplines: [...STANDARD_DISCIPLINES], companies: [],
    members: session ? [{ userId: session.id, role: 'Owner / QA', scope: null }] : [],
  })
  useEffect(() => {
    api<{ users: DirUser[] }>('GET', '/directory/users').then((r) => setUsers(r.users)).catch((e) => setError(errorText(e)))
  }, [])

  const companyNames = useMemo(() => [f.client.trim(), ...f.companies.map((c) => c.name.trim())].filter(Boolean), [f.client, f.companies])
  /** Problems that block the current step; shown under the step and disable "Next". */
  const problems = useMemo(() => {
    const p: string[] = []
    if (step === 0) {
      if (f.name.trim().length < 3) p.push('Project name (at least 3 characters)')
      if (f.client.trim().length < 2) p.push('Client')
      if (f.site.trim().length < 2) p.push('Site / location')
      if (f.code && !/^[A-Za-z0-9][A-Za-z0-9-]{2,19}$/.test(f.code.trim())) p.push('Project code: 3–20 letters, digits or dashes')
    }
    if (step === 2) {
      if (!f.disciplines.length) p.push('At least one discipline')
      if (f.companies.some((c) => c.name.trim().length < 2)) p.push('Every company needs a name')
      if (new Set(companyNames).size !== companyNames.length) p.push('Company names must be unique')
    }
    if (step === 3) {
      if (!f.members.some((m) => m.role === 'Owner / QA')) p.push('At least one Owner / QA')
      if (f.members.some((m) => !m.userId)) p.push('Choose a person on every team row')
      if (new Set(f.members.map((m) => m.userId)).size !== f.members.length) p.push('Each person once (one role per project)')
    }
    return p
  }, [step, f, companyNames])

  const toggleMarket = (k: MarketKey, on: boolean) => setF({ ...f, markets: on ? [...f.markets, k] : f.markets.filter((x) => x !== k) })
  const toggleDiscipline = (d: string, on: boolean) => setF({ ...f, disciplines: on ? [...f.disciplines, d] : f.disciplines.filter((x) => x !== d) })
  const allDisciplines = [...STANDARD_DISCIPLINES, ...f.disciplines.filter((d) => !STANDARD_DISCIPLINES.includes(d))]
  const setMember = (i: number, patch: Partial<Spec['members'][number]>) => setF({ ...f, members: f.members.map((m, j) => (j === i ? { ...m, ...patch, ...(patch.role && patch.role !== 'Contractor' ? { scope: null } : {}) } : m)) })

  const submit = async () => {
    setBusy(true); setError(null)
    const r = await createProject({ ...f, code: f.code?.trim() || undefined, markets: f.markets.filter((m) => m !== f.plantCountry) })
    setBusy(false)
    if (r.error) return setError(r.error)
    toast(`Project ${r.code} created`)
    openProjectRoute(r.code!, 'registers')
  }

  return (
    <>
      <PageHead title="New project" sub="Set up a project in five steps. Everything except the project code can be changed later; facility, scope and markets changes create a new requirement baseline." actions={<button className="btn" onClick={() => home()}>Cancel</button>} />
      <div className="steps" style={{ marginBottom: 16 }}>
        {STEPS.map((s, i) => <span key={s} className={`step ${i < step ? 'on' : i === step ? 'cur' : ''}`}>{i < step ? '✓ ' : `${i + 1}. `}{s}</span>)}
      </div>

      <section className="card wizard">
        {step === 0 && (
          <>
            <h2>Basics</h2>
            <div className="grid g2">
              <div><label className="lab" style={{ marginTop: 0 }}>Project name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Riyadh Oral Solids Line 3" /></div>
              <div><label className="lab" style={{ marginTop: 0 }}>Project code (optional)</label><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="Generated automatically, e.g. PRJ-004" /></div>
              <div><label className="lab">Client (plant owner)</label><input className="input" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} placeholder="Company that owns the plant" /></div>
              <div><label className="lab">Site / location</label><input className="input" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} placeholder="City, country" /></div>
              <div><label className="lab">Plant country</label><select className="input" value={f.plantCountry} onChange={(e) => setF({ ...f, plantCountry: e.target.value as MarketKey })}>{(Object.keys(markets) as MarketKey[]).map((k) => <option key={k} value={k}>{markets[k].name}</option>)}</select></div>
            </div>
            <p className="muted small">The plant country decides the local authority and is always in regulatory scope. The project code cannot be changed later.</p>
          </>
        )}

        {step === 1 && (
          <>
            <h2>Scope &amp; markets</h2>
            <div className="grid g2">
              <div>
                <label className="lab" style={{ marginTop: 0 }}>Facility type</label><select className="input" value={f.facility} onChange={(e) => setF({ ...f, facility: e.target.value as Facility })}>{FAC.map((x) => <option key={x}>{x}</option>)}</select>
                <label className="lab">Project scope</label><select className="input" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as Scope })}>{SCOPES.map((x) => <option key={x}>{x}</option>)}</select>
                <label className="lab">Project phase</label><input className="input" value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })} placeholder="e.g. Design, Construction, Commissioning & qualification" />
              </div>
              <div>
                <label className="lab" style={{ marginTop: 0 }}>Target markets (where the product will be supplied)</label>
                {(Object.keys(markets) as MarketKey[]).map((k) => (
                  <label key={k} className="row" style={{ padding: '4px 0', fontWeight: 500 }}>
                    <input type="checkbox" checked={k === f.plantCountry || f.markets.includes(k)} disabled={k === f.plantCountry} onChange={(e) => toggleMarket(k, e.target.checked)} />
                    <MarketChip m={k} /> {markets[k].name} <span className="muted small">{markets[k].authority}{k === f.plantCountry ? ' · plant country' : ''}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="lab">Applicable owner standards and procedures (optional)</label>
            <textarea className="input" style={{ minHeight: 56 }} value={f.ownerStandards} onChange={(e) => setF({ ...f, ownerStandards: e.target.value })} placeholder="e.g. QMS-014 Engineering documentation procedure (rev 4)" />
          </>
        )}

        {step === 2 && (
          <>
            <h2>Registers</h2>
            <div className="grid g2">
              <div>
                <label className="lab" style={{ marginTop: 0 }}>Disciplines</label>
                {allDisciplines.map((d) => <label key={d} className="row" style={{ padding: '3px 0' }}><input type="checkbox" checked={f.disciplines.includes(d)} onChange={(e) => toggleDiscipline(d, e.target.checked)} /><span>{d}</span></label>)}
                <div className="row" style={{ marginTop: 6 }}><input className="input" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Add another discipline" aria-label="Additional discipline" /><button type="button" className="btn" disabled={extra.trim().length < 2} onClick={() => { setF({ ...f, disciplines: [...new Set([...f.disciplines, extra.trim()])] }); setExtra('') }}><Plus size={13} /> Add</button></div>
              </div>
              <div>
                <label className="lab" style={{ marginTop: 0 }}>Companies on the project</label>
                <div className="filecard" style={{ marginTop: 0 }}><div className="fc-main"><b>{f.client || 'Client'}</b><div className="muted small">Owner · from Basics</div></div></div>
                {f.companies.map((c, i) => (
                  <div key={i} className="row" style={{ marginTop: 6 }}>
                    <input className="input" value={c.name} onChange={(e) => setF({ ...f, companies: f.companies.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Company name" aria-label={`Company ${i + 1} name`} />
                    <select className="input" style={{ maxWidth: 190 }} value={c.kind} onChange={(e) => setF({ ...f, companies: f.companies.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)) })} aria-label={`Company ${i + 1} type`}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
                    <button type="button" className="iconbtn" onClick={() => setF({ ...f, companies: f.companies.filter((_, j) => j !== i) })} aria-label={`Remove company ${i + 1}`}><Trash2 size={13} /></button>
                  </div>
                ))}
                <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setF({ ...f, companies: [...f.companies, { name: '', kind: 'Main contractor' }] })}><Plus size={13} /> Add company</button>
                <p className="muted small">More companies and the system / equipment list can be added after creation under Companies &amp; systems.</p>
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Team</h2>
            <p className="muted small" style={{ marginTop: 0 }}>Owner / QA approves at stage 2 and manages the project; the Consultant reviews; Contractors prepare and submit. A contractor can be limited to one company's records (vendor access). People not listed here must first be created by an administrator.</p>
            <div className="tablewrap"><table>
              <thead><tr><th>Person</th><th>Role</th><th>Record access</th><th /></tr></thead>
              <tbody>{f.members.map((m, i) => (
                <tr key={i}>
                  <td><select className="input" value={m.userId} onChange={(e) => setMember(i, { userId: e.target.value })} aria-label={`Team member ${i + 1}`}><option value="">Choose a person…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}{u.company ? ` · ${u.company}` : ''}</option>)}</select></td>
                  <td><select className="input" value={m.role} onChange={(e) => setMember(i, { role: e.target.value as Role })} aria-label={`Role of team member ${i + 1}`}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
                  <td><select className="input" value={m.scope ?? ''} disabled={m.role !== 'Contractor'} onChange={(e) => setMember(i, { scope: e.target.value || null })} aria-label={`Record access of team member ${i + 1}`}><option value="">Whole project</option>{companyNames.map((c) => <option key={c} value={c}>Only {c}</option>)}</select></td>
                  <td style={{ width: 40 }}><button type="button" className="iconbtn" disabled={f.members.length === 1} onClick={() => setF({ ...f, members: f.members.filter((_, j) => j !== i) })} aria-label={`Remove team member ${i + 1}`}><Trash2 size={13} /></button></td>
                </tr>
              ))}</tbody>
            </table></div>
            <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setF({ ...f, members: [...f.members, { userId: '', role: 'Contractor', scope: null }] })}><Plus size={13} /> Add person</button>
          </>
        )}

        {step === 4 && (
          <>
            <h2>Review</h2>
            <div className="kv">
              <div><small>Project</small>{f.name} {f.code ? <Badge dot={false}>{f.code.toUpperCase()}</Badge> : <span className="muted small">(code generated)</span>}</div>
              <div><small>Client · site</small>{f.client} · {f.site}</div>
              <div><small>Facility · scope · phase</small>{f.facility} · {f.scope} · {f.phase || 'Design'}</div>
              <div><small>Markets</small><span className="row" style={{ gap: 4 }}>{[f.plantCountry, ...f.markets.filter((m) => m !== f.plantCountry)].map((m) => <MarketChip key={m} m={m} />)}</span></div>
              <div><small>Disciplines</small>{f.disciplines.join(', ')}</div>
              <div><small>Companies</small>{companyNames.join(', ')}</div>
              <div style={{ gridColumn: '1 / -1' }}><small>Team</small>{f.members.map((m) => { const u = users.find((x) => x.id === m.userId); return `${u?.name ?? '?'} (${m.role}${m.scope ? `, only ${m.scope}` : ''})` }).join(' · ')}</div>
            </div>
            <h3>Requirements from the library</h3>
            <div className="tablewrap"><table><tbody>{[f.plantCountry, ...f.markets.filter((m) => m !== f.plantCountry)].map((m) => { const a = approvedOf(packs?.find((p) => p.market === m)); return <tr key={m}><td><MarketChip m={m} /> {markets[m].name}</td><td>{!packs ? <span className="muted small">Loading…</span> : a ? <><Badge tone="green" dot={false}>v{a.version} approved</Badge> <span className="small">{a.items} item(s); those for {f.facility} are added{a.starter ? ' · unverified starter content' : ''}</span></> : <><Badge tone="amber" dot={false}>No approved pack</Badge> <span className="small muted">No requirements for this market until a library version is approved</span></>}</td></tr> })}</tbody></table></div>
            <div className="notice info small">The project starts at requirement baseline B1. Library requirements arrive as Assessment pending for the Consultant / Owner / QA to decide applicability. Next: add the system / equipment list, assign systems to requirements, then documents.</div>
            {error && <div className="notice err" role="alert" style={{ marginTop: 10 }}>{error}</div>}
          </>
        )}

        {problems.length > 0 && <div className="notice small" style={{ marginTop: 12 }}>Still needed: {problems.join(' · ')}</div>}
        {error && step < 4 && <div className="notice err small" style={{ marginTop: 12 }}>{error}</div>}
        <div className="row sb" style={{ marginTop: 16 }}>
          <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={13} /> Back</button>
          {step < STEPS.length - 1
            ? <button type="button" className="btn pri" disabled={problems.length > 0} onClick={() => setStep(step + 1)}>Next <ArrowRight size={13} /></button>
            : <button type="button" className="btn pri" disabled={busy} onClick={submit}><Check size={13} /> {busy ? 'Creating…' : 'Create project'}</button>}
        </div>
      </section>
    </>
  )
}
