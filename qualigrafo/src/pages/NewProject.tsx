import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Plus, Trash2 } from 'lucide-react'
import { api, errorText } from '../api'
import { markets } from '../data/reference'
import { useStore } from '../store'
import type { NewProject as Spec } from '../store'
import type { BimRequirement, IndustryGroup, MarketKey, Role, Scope, ServiceType } from '../types'
import { Badge, MarketChip, PageHead, home, openProjectRoute } from '../components/ui'
import { approvedOf, useLibraryPacks } from '../library'
import { CUSTOM_FACILITY, authorityFor, classificationText, facilitiesOf, includesBim, useIndustries, useTemplate } from '../industries'

/** One line per service type, from the client's own specification. */
const SERVICE_HINT: Record<string, string> = {
  'Design only': 'Engineering design, calculations, drawings, schedules, GFC / IFC, approvals.',
  'BIM only': 'Modelling, coordination, clash detection, LOD, shop drawings, COBie / as-built.',
  'Design + BIM': 'Full engineering design and BIM execution in one connected workflow.',
}
const KINDS = ['Engineering consultant', 'Main contractor', 'Subcontractor', 'Vendor / supplier', 'Other']
const ROLES: Role[] = ['Owner / QA', 'Consultant', 'Contractor']
const STEPS = ['Basics', 'Scope & classification', 'Registers', 'Team', 'Review'] as const

interface DirUser { id: string; name: string; email: string; company: string | null }

/**
 * The wizard's own draft. The industry group and the service type start **empty**: the client's specification makes
 * the service type mandatory ("enquiries may be Design only, BIM only, or both"), and a pre-selected industry would
 * decide the whole template set for the person. Both are validated before Next lets the step pass.
 */
type Draft = Omit<Spec, 'industryGroup' | 'serviceType'> & { industryGroup: IndustryGroup | ''; serviceType: ServiceType | '' }

/**
 * The draft survives a reload of the same tab. Without this, a reload (or anything that remounts the page, such as
 * a server that was asleep and an error the user answered with "Reload") silently restarted the wizard on step 1
 * with the default country selected — which is what a tester reads as "my entries were lost".
 */
const DRAFT_KEY = 'qualigrafo.newProject.draft'
const readDraft = (): { step: number; f: Draft } | null => {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as { step?: number; f?: Draft }
    return d.f ? { step: Math.min(Math.max(d.step ?? 0, 0), STEPS.length - 1), f: d.f } : null
  } catch { return null /* storage blocked or unreadable draft */ }
}
const clearDraft = () => { try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* storage blocked */ } }

export default function NewProject() {
  const { session, createProject, toast } = useStore()
  const saved = useMemo(() => readDraft(), [])
  const [step, setStep] = useState(saved?.step ?? 0)
  const [users, setUsers] = useState<DirUser[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extra, setExtra] = useState('')
  const [resumed, setResumed] = useState(!!saved)
  const { packs } = useLibraryPacks()
  const { ref: industries, error: refError } = useIndustries()
  /**
   * The industry template decides which disciplines the project starts with and which deliverables it is given.
   * The chosen disciplines mirror the template until the user edits them: after that their choice stands, because
   * a list someone has curated must not be silently replaced when they go back and change a classification field.
   */
  // "Touched" means the user edited the list, not merely that a draft came back: a draft saved before the
  // template had loaded holds no disciplines, and treating that as a choice would leave the step unable to pass.
  const [disciplinesTouched, setDisciplinesTouched] = useState(!!saved?.f.disciplines.length)
  const [f, setF] = useState<Draft>(saved?.f ?? {
    code: '', name: '', client: '', site: '', projectCountry: 'SA', markets: [],
    industryGroup: '', facilityType: '', serviceType: '', scope: 'New plant', projectStage: 'Concept', ownerStandards: '',
    disciplines: [], companies: [], generateDeliverables: true,
    members: session ? [{ userId: session.id, role: 'Owner / QA', scope: null }] : [],
  })
  const { template } = useTemplate(f, f.disciplines)
  useEffect(() => {
    api<{ users: DirUser[] }>('GET', '/directory/users').then((r) => setUsers(r.users)).catch((e) => setError(errorText(e)))
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step, f })) } catch { /* storage blocked: the wizard still works, a reload just starts over */ }
  }, [step, f])
  const templateDisciplines = template?.disciplines.join(',')
  useEffect(() => {
    if (disciplinesTouched || !templateDisciplines) return
    setF((cur) => ({ ...cur, disciplines: templateDisciplines.split(',') }))
  }, [templateDisciplines, disciplinesTouched])

  // The BIM block is only shown, and only sent, when the service type includes BIM.
  const bim: BimRequirement = f.bimRequirement ?? industries?.defaultBim ?? { lod: 'LOD 300', coordination: true, assetHandover: 'None' }
  const setBim = (patch: Partial<BimRequirement>) => setF({ ...f, bimRequirement: { ...bim, ...patch } })

  const companyNames = useMemo(() => [f.client.trim(), ...f.companies.map((c) => c.name.trim())].filter(Boolean), [f.client, f.companies])
  /**
   * Problems that block the current step, keyed by the field they belong to so each one can be shown on its own
   * field instead of only as a list at the bottom. "Next" stays disabled while any of them is present, and names
   * the first one, so a disabled button is never silent.
   */
  const issues = useMemo(() => {
    const p: Record<string, string> = {}
    if (step === 0) {
      if (f.name.trim().length < 3) p.name = 'Project name needs at least 3 characters.'
      if (f.client.trim().length < 2) p.client = 'Name the client that owns the plant.'
      if (f.site.trim().length < 2) p.site = 'Give the site or location.'
      if (f.code && !/^[A-Za-z0-9][A-Za-z0-9-]{2,19}$/.test(f.code.trim())) p.code = 'Project code: 3–20 letters, digits or dashes.'
    }
    if (step === 1) {
      if (!f.industryGroup) p.industryGroup = 'Choose the industry group of this project.'
      else if (!f.facilityType) p.facilityType = 'Choose the facility type.'
      else if (f.facilityType === CUSTOM_FACILITY && (f.customFacilityType ?? '').trim().length < 3) p.customFacilityType = 'Name the custom facility type (at least 3 characters).'
      if (!f.serviceType) p.serviceType = 'Choose the service type: Design only, BIM only, or Design + BIM.'
    }
    if (step === 2) {
      if (!f.disciplines.length) p.disciplines = 'Choose at least one discipline.'
      if (f.companies.some((c) => c.name.trim().length < 2)) p.companies = 'Every company needs a name.'
      else if (new Set(companyNames).size !== companyNames.length) p.companies = 'Company names must be unique.'
    }
    if (step === 3) {
      if (!f.members.some((m) => m.role === 'Owner / QA')) p.members = 'The team needs at least one Owner / QA.'
      else if (f.members.some((m) => !m.userId)) p.members = 'Choose a person on every team row.'
      else if (new Set(f.members.map((m) => m.userId)).size !== f.members.length) p.members = 'Each person can hold only one role on a project.'
    }
    return p
  }, [step, f, companyNames])
  const problems = useMemo(() => Object.values(issues), [issues])
  /** The message that belongs under one field. */
  const fieldError = (k: string) => (issues[k] ? <p className="small" style={{ color: 'var(--red)', margin: '4px 0 0' }} role="alert">{issues[k]}</p> : null)

  const toggleMarket = (k: MarketKey, on: boolean) => setF({ ...f, markets: on ? [...f.markets, k] : f.markets.filter((x) => x !== k) })
  const toggleDiscipline = (d: string, on: boolean) => { setDisciplinesTouched(true); setF({ ...f, disciplines: on ? [...f.disciplines, d] : f.disciplines.filter((x) => x !== d) }) }
  const offered = template?.disciplines ?? []
  const allDisciplines = [...offered, ...f.disciplines.filter((d) => !offered.includes(d))]
  const setMember = (i: number, patch: Partial<Draft['members'][number]>) => setF({ ...f, members: f.members.map((m, j) => (j === i ? { ...m, ...patch, ...(patch.role && patch.role !== 'Contractor' ? { scope: null } : {}) } : m)) })

  const submit = async () => {
    setBusy(true); setError(null)
    const r = await createProject({ ...(f as Spec), code: f.code?.trim() || undefined, markets: f.markets.filter((m) => m !== f.projectCountry) })
    setBusy(false)
    if (r.error) return setError(r.error)
    clearDraft()
    toast(`Project ${r.code} created`)
    openProjectRoute(r.code!, 'registers')
  }
  const cancel = () => { clearDraft(); home() }

  return (
    <>
      <PageHead title="New project" sub="Set up a project in five steps, for any industry. Everything except the project code can be changed later; industry group, facility type, scope and market changes create a new requirement baseline." actions={<button className="btn" onClick={cancel}>Cancel</button>} />
      {resumed && (
        <div className="notice info small" style={{ marginBottom: 12 }}>
          <b>Draft restored.</b> Your entries from before are still here, on the step you left.
          <button className="link small" style={{ marginLeft: 8 }} onClick={() => { clearDraft(); setResumed(false); window.location.reload() }}>Start a new project instead</button>
        </div>
      )}
      <div className="steps" style={{ marginBottom: 16 }}>
        {STEPS.map((s, i) => <span key={s} className={`step ${i < step ? 'on' : i === step ? 'cur' : ''}`}>{i < step ? '✓ ' : `${i + 1}. `}{s}</span>)}
      </div>

      <section className="card wizard">
        {step === 0 && (
          <>
            <h2>Basics</h2>
            <div className="grid g2">
              <div><label className="lab" style={{ marginTop: 0 }}>Project name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Riyadh Oral Solids Line 3" />{fieldError('name')}</div>
              <div><label className="lab" style={{ marginTop: 0 }}>Project code (optional)</label><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="Generated automatically, e.g. PRJ-004" />{fieldError('code')}</div>
              <div><label className="lab">Client (plant owner)</label><input className="input" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} placeholder="Company that owns the plant" />{fieldError('client')}</div>
              <div><label className="lab">Site / location</label><input className="input" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} placeholder="City, country" />{fieldError('site')}</div>
              <div><label className="lab">Project country</label><select className="input" value={f.projectCountry} onChange={(e) => setF({ ...f, projectCountry: e.target.value as MarketKey })}>{(Object.keys(markets) as MarketKey[]).map((k) => <option key={k} value={k}>{markets[k].name}</option>)}</select></div>
            </div>
            <p className="muted small">The project country decides the local authority and is always in regulatory scope — on the next step it is ticked as a target market and cannot be unticked. The project code cannot be changed later.</p>
          </>
        )}

        {step === 1 && (
          <>
            <h2>Scope &amp; classification</h2>
            <label className="lab" style={{ marginTop: 0 }}>Industry group</label>
            <p className="muted small" style={{ margin: '0 0 8px' }}>Decides which facility types, registers and requirement packs this project is offered.</p>
            <div className="pickers" role="group" aria-label="Industry group">
              {(industries?.groups ?? []).map((g) => (
                <button type="button" key={g.key} className={`picker ${f.industryGroup === g.key ? 'on' : ''}`} aria-pressed={f.industryGroup === g.key}
                  onClick={() => setF({ ...f, industryGroup: g.key, facilityType: '', secondaryFacilityType: '', customFacilityType: '' })}>
                  <b>{g.key}</b><span className="muted small">{g.summary}</span>
                </button>
              ))}
              {!industries && <span className="muted small">Loading industry groups…</span>}
            </div>
            {fieldError('industryGroup')}
            <div className="grid g2">
              <div>
                <label className="lab">Facility type (project sub-type)</label>
                <select className="input" value={f.facilityType} disabled={!f.industryGroup} onChange={(e) => setF({ ...f, facilityType: e.target.value })}>
                  <option value="">{f.industryGroup ? 'Choose…' : 'Choose an industry group first'}</option>
                  {facilitiesOf(industries, f.industryGroup).map((x) => <option key={x}>{x}</option>)}
                </select>
                {fieldError('facilityType')}
                {f.facilityType === CUSTOM_FACILITY && (
                  <>
                    <label className="lab">Name of the custom facility</label>
                    <input className="input" value={f.customFacilityType ?? ''} onChange={(e) => setF({ ...f, customFacilityType: e.target.value })} placeholder="e.g. Vaccine fill-finish and inspection block" />
                    {fieldError('customFacilityType')}
                  </>
                )}
                <label className="lab">Secondary sub-type (optional)</label>
                <select className="input" value={f.secondaryFacilityType ?? ''} disabled={!f.industryGroup} onChange={(e) => setF({ ...f, secondaryFacilityType: e.target.value })}>
                  <option value="">None</option>
                  {facilitiesOf(industries, f.industryGroup).filter((x) => x !== CUSTOM_FACILITY && x !== f.facilityType).map((x) => <option key={x}>{x}</option>)}
                </select>
                <label className="lab">Project scope</label><select className="input" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as Scope })}>{(industries?.scopes ?? [f.scope]).map((x) => <option key={x}>{x}</option>)}</select>
                <label className="lab">Project stage</label>
                <select className="input" value={f.projectStage} onChange={(e) => setF({ ...f, projectStage: e.target.value })}>
                  {[...(industries?.stages ?? []), ...(industries && industries.stages.includes(f.projectStage) ? [] : [f.projectStage])].filter(Boolean).map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div>
                <label className="lab" style={{ marginTop: 0 }}>Target markets (where the product will be supplied)</label>
                {(Object.keys(markets) as MarketKey[]).map((k) => (
                  <label key={k} className="row" style={{ padding: '4px 0', fontWeight: 500 }}>
                    <input type="checkbox" checked={k === f.projectCountry || f.markets.includes(k)} disabled={k === f.projectCountry} onChange={(e) => toggleMarket(k, e.target.checked)} />
                    <MarketChip m={k} /> {markets[k].name} <span className="muted small">{f.industryGroup ? authorityFor(f.industryGroup, markets[k].authority) : markets[k].authority}{k === f.projectCountry ? ' · project country' : ''}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="lab">Service type</label>
            <p className="muted small" style={{ margin: '0 0 8px' }}>An enquiry can be design, BIM, or both — this decides which registers and deliverables the project gets, so there is no default.</p>
            <div className="pickers" role="group" aria-label="Service type">
              {(industries?.serviceTypes ?? []).map((t) => (
                <button type="button" key={t} className={`picker ${f.serviceType === t ? 'on' : ''}`} aria-pressed={f.serviceType === t}
                  onClick={() => setF({ ...f, serviceType: t, bimRequirement: includesBim(t) ? (f.bimRequirement ?? industries?.defaultBim) : undefined })}>
                  <b>{t}</b><span className="muted small">{SERVICE_HINT[t]}</span>
                </button>
              ))}
            </div>
            {fieldError('serviceType')}

            {includesBim(f.serviceType) && industries && (
              <div className="subcard" style={{ marginTop: 12 }}>
                <h3 style={{ marginTop: 0 }}>BIM requirement</h3>
                <div className="grid g3">
                  <div>
                    <label className="lab" style={{ marginTop: 0 }}>Level of development</label>
                    <select className="input" value={bim.lod} onChange={(e) => setBim({ lod: e.target.value })}>{industries.lodLevels.map((x) => <option key={x}>{x}</option>)}</select>
                  </div>
                  <div>
                    <label className="lab" style={{ marginTop: 0 }}>Coordination / clash detection</label>
                    <select className="input" value={bim.coordination ? 'Yes' : 'No'} onChange={(e) => setBim({ coordination: e.target.value === 'Yes' })}><option>Yes</option><option>No</option></select>
                  </div>
                  <div>
                    <label className="lab" style={{ marginTop: 0 }}>Asset / handover deliverable</label>
                    <select className="input" value={bim.assetHandover} onChange={(e) => setBim({ assetHandover: e.target.value })}>{industries.assetHandover.map((x) => <option key={x}>{x}</option>)}</select>
                  </div>
                </div>
              </div>
            )}

            <label className="lab">Applicable owner standards and procedures (optional)</label>
            <textarea className="input" style={{ minHeight: 56 }} value={f.ownerStandards} onChange={(e) => setF({ ...f, ownerStandards: e.target.value })} placeholder="e.g. QMS-014 Engineering documentation procedure (rev 4)" />
          </>
        )}

        {step === 2 && (
          <>
            <h2>Standards &amp; registers</h2>
            <p className="muted small" style={{ margin: '0 0 10px' }}>
              {template
                ? <>Generated from the classification: <b>{template.label}</b>. Everything here can be changed now or after the project is created.</>
                : 'Choose the industry group and the service type on the previous step to see what this project will be given.'}
            </p>
            <div className="grid g2">
              <div>
                <label className="lab" style={{ marginTop: 0 }}>Disciplines</label>
                {allDisciplines.map((d) => <label key={d} className="row" style={{ padding: '3px 0' }}><input type="checkbox" checked={f.disciplines.includes(d)} onChange={(e) => toggleDiscipline(d, e.target.checked)} /><span>{d}</span></label>)}
                <div className="row" style={{ marginTop: 6 }}><input className="input" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Add another discipline" aria-label="Additional discipline" /><button type="button" className="btn" disabled={extra.trim().length < 2} onClick={() => { setF({ ...f, disciplines: [...new Set([...f.disciplines, extra.trim()])] }); setExtra('') }}><Plus size={13} /> Add</button></div>
                {fieldError('disciplines')}
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
                {fieldError('companies')}
                <p className="muted small">More companies and the system / equipment list can be added after creation under Companies &amp; systems.</p>
              </div>
            </div>

            {template && (
              <div className="subcard" style={{ marginTop: 14 }}>
                <h3 style={{ marginTop: 0 }}>Workspace to generate</h3>
                <label className="row" style={{ fontWeight: 500 }}>
                  <input type="checkbox" checked={f.generateDeliverables !== false} onChange={(e) => setF({ ...f, generateDeliverables: e.target.checked })} />
                  <span>Register the <b>{template.summary.total} deliverable(s)</b> of this template ({template.summary.critical} critical)</span>
                </label>
                <p className="muted small" style={{ margin: '4px 0 10px 24px' }}>
                  Each one is registered as <b>Missing</b> and assigned to {f.client || 'the client'}, so the register states what the project owes before anything is produced. Dates are a starting plan from the project stage — the register is where the real programme goes.
                  {' '}{includesBim(f.serviceType) ? 'BIM deliverables (models, clash records, BEP / MIDP) are included because the service covers BIM.' : 'No BIM deliverables: this is a design-only commission.'}
                  {' '}{f.serviceType === 'BIM only' ? 'Design calculations and specifications are left out.' : ''}
                </p>
                <div className="row wrap" style={{ gap: 5 }}>
                  {template.summary.byStage.map((x) => <Badge key={x.stage} dot={false}>{x.stage}: {x.n}</Badge>)}
                </div>
                <label className="lab">Specialised controls this industry expects</label>
                <div className="row wrap" style={{ gap: 5 }}>{template.addOns.map((a) => <Badge key={a} tone="blue" dot={false}>{a}</Badge>)}</div>
                <p className="muted small" style={{ marginTop: 8 }}>Requirements come from the approved requirement library for the project's markets, filtered to this industry and facility type — shown on the Review step.</p>
              </div>
            )}
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
            {fieldError('members')}
          </>
        )}

        {step === 4 && (
          <>
            <h2>Review</h2>
            <div className="kv">
              <div><small>Project</small>{f.name} {f.code ? <Badge dot={false}>{f.code.toUpperCase()}</Badge> : <span className="muted small">(code generated)</span>}</div>
              <div><small>Client · site</small>{f.client} · {f.site}</div>
              <div style={{ gridColumn: '1 / -1' }}><small>Classification</small>{classificationText(f)}</div>
              <div><small>Scope</small>{f.scope}</div>
              {includesBim(f.serviceType) && <div><small>BIM requirement</small>{bim.lod} · coordination {bim.coordination ? 'yes' : 'no'} · handover {bim.assetHandover}</div>}
              <div><small>Markets</small><span className="row" style={{ gap: 4 }}>{[f.projectCountry, ...f.markets.filter((m) => m !== f.projectCountry)].map((m) => <MarketChip key={m} m={m} />)}</span></div>
              <div><small>Disciplines</small>{f.disciplines.join(', ')}</div>
              <div><small>Deliverables</small>{f.generateDeliverables === false ? 'None — template switched off' : `${template?.summary.total ?? 0} registered as Missing`}</div>
              <div><small>Companies</small>{companyNames.join(', ')}</div>
              <div style={{ gridColumn: '1 / -1' }}><small>Team</small>{f.members.map((m) => { const u = users.find((x) => x.id === m.userId); return `${u?.name ?? '?'} (${m.role}${m.scope ? `, only ${m.scope}` : ''})` }).join(' · ')}</div>
            </div>
            <h3>Requirements from the library</h3>
            <div className="tablewrap"><table><tbody>{[f.projectCountry, ...f.markets.filter((m) => m !== f.projectCountry)].map((m) => { const a = approvedOf(packs?.find((p) => p.market === m)); return <tr key={m}><td><MarketChip m={m} /> {markets[m].name}</td><td>{!packs ? <span className="muted small">Loading…</span> : a ? <><Badge tone="green" dot={false}>v{a.version} approved</Badge> <span className="small">{a.items} item(s); those for {f.customFacilityType || f.facilityType} are added{a.starter ? ' · unverified starter content' : ''}</span></> : <><Badge tone="amber" dot={false}>No approved pack</Badge> <span className="small muted">No requirements for this market until a library version is approved</span></>}</td></tr> })}</tbody></table></div>
            <div className="notice info small">The project starts at requirement baseline B1. Library requirements arrive as Assessment pending for the Consultant / Owner / QA to decide applicability. Next: add the system / equipment list, assign systems to requirements, then documents.</div>
            {error && <div className="notice err" role="alert" style={{ marginTop: 10 }}>{error}</div>}
          </>
        )}

        {problems.length > 0 && <div className="notice small" style={{ marginTop: 12 }}>Still needed: {problems.join(' · ')}</div>}
        {refError && step === 1 && <div className="notice err small" style={{ marginTop: 12 }} role="alert">The industry groups could not be loaded: {refError}</div>}
        {error && step < 4 && <div className="notice err small" style={{ marginTop: 12 }}>{error}</div>}
        <div className="row sb" style={{ marginTop: 16 }}>
          <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={13} /> Back</button>
          {step < STEPS.length - 1
            ? <span className="row" style={{ gap: 10 }}>
                {problems.length > 0 && <span className="small" style={{ color: 'var(--red)' }}>{problems[0]}</span>}
                <button type="button" className="btn pri" disabled={problems.length > 0} title={problems[0] ?? undefined} onClick={() => setStep(step + 1)}>Next <ArrowRight size={13} /></button>
              </span>
            : <button type="button" className="btn pri" disabled={busy} onClick={submit}><Check size={13} /> {busy ? 'Creating…' : 'Create project'}</button>}
        </div>
      </section>
    </>
  )
}
