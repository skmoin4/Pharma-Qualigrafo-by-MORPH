import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { markets } from '../data/reference'
import { useStore } from '../store'
import type { BimRequirement, IndustryGroup, MarketKey, Scope, ServiceType } from '../types'
import { CUSTOM_FACILITY, facilitiesOf, includesBim, useIndustries } from '../industries'
import { Badge, MarketChip, PageHead, fmtDate, home } from '../components/ui'
import { approvedOf, draftOf, useLibraryPacks } from '../library'

const SCOPE: Scope[] = ['New plant', 'Expansion', 'Renovation', 'Equipment installation']

/** Descriptive details (name, client, site) — no new baseline needed. */
function Details() {
  const { profile, role, updateDetails, toast } = useStore()
  const [f, setF] = useState({ name: profile.name, client: profile.client, site: profile.site })
  const can = role === 'Owner / QA' && profile.status === 'Active'
  const dirty = f.name !== profile.name || f.client !== profile.client || f.site !== profile.site
  const save = async () => { const er = await updateDetails(f); toast(er ?? 'Project details saved', er ? 'warn' : 'ok') }
  return (
    <section className="card" style={{ marginBottom: 14 }}>
      <h2>Project details <span className="muted small" style={{ fontWeight: 400 }}>{profile.id} · code cannot change</span></h2>
      <div className="grid g3">
        <div><label className="lab" style={{ marginTop: 0 }}>Project name</label><input className="input" value={f.name} disabled={!can} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Project name" /></div>
        <div><label className="lab" style={{ marginTop: 0 }}>Client</label><input className="input" value={f.client} disabled={!can} onChange={(e) => setF({ ...f, client: e.target.value })} aria-label="Client" /></div>
        <div><label className="lab" style={{ marginTop: 0 }}>Site / location</label><input className="input" value={f.site} disabled={!can} onChange={(e) => setF({ ...f, site: e.target.value })} aria-label="Site" /></div>
      </div>
      {can && <div className="row" style={{ marginTop: 10 }}><button className="btn pri" disabled={!dirty} onClick={save}>Save details</button><span className="muted small">Recorded in the audit trail. The client company in Companies &amp; systems is not renamed automatically.</span></div>}
    </section>
  )
}

/** Archive makes the project read-only (nothing is deleted); restore re-opens it. Owner / QA only. */
function Lifecycle() {
  const { profile, role, archiveProject, restoreProject, toast } = useStore()
  const [reason, setReason] = useState('')
  if (role !== 'Owner / QA') return null
  const archived = profile.status === 'Archived'
  const run = async () => {
    if (!archived && !confirm(`Archive ${profile.name}? It becomes read-only for everyone until restored.`)) return
    const er = await (archived ? restoreProject(reason) : archiveProject(reason))
    toast(er ?? (archived ? 'Project restored' : 'Project archived (read-only)'), er ? 'warn' : 'ok')
    if (!er) setReason('')
  }
  return (
    <section className={`card mt ${archived ? '' : 'danger-zone'}`}>
      <h2>{archived ? 'Restore project' : 'Archive project'}</h2>
      <p className="muted small" style={{ marginTop: 0 }}>{archived
        ? `Archived ${profile.archivedAt ? fmtDate(profile.archivedAt) : ''}: ${profile.archivedReason ?? ''}. Restoring makes the project editable again.`
        : 'Use when the project is handed over, cancelled or closed. Every record, file and the audit trail stay available read-only; nothing is deleted.'}</p>
      <div className="row"><input className="input" style={{ maxWidth: 480 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={archived ? 'Why is it restored?' : 'Why is it archived? (e.g. handed over to operations)'} aria-label={archived ? 'Restore reason' : 'Archive reason'} />
        <button className={`btn ${archived ? 'pri' : 'danger'}`} onClick={run}>{archived ? 'Restore project' : 'Archive project'}</button></div>
    </section>
  )
}

/** Revit add-in connection: input mode, connector tokens (Owner / QA), published models. */
function Integrations() {
  const { revitMode, setRevit, connector, role, createToken, revokeToken, toast, profile } = useStore()
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const reviewer = role !== 'Contractor' && profile.status === 'Active'
  const apiUrl = `${window.location.origin}/api/connector/v1`
  const mode = async (on: boolean) => { if (on === revitMode) return; const er = await setRevit(on); toast(er ?? (on ? 'Revit connector switched on' : 'Standalone mode (Revit connector off)'), er ? 'warn' : 'ok') }
  const make = async () => {
    const r = await createToken(name)
    if (r.error) return toast(r.error, 'warn')
    setSecret(r.token!); setName(''); setCopied(false)
  }
  const copy = async () => { try { await navigator.clipboard.writeText(secret!); setCopied(true) } catch { /* clipboard blocked */ } }
  return (
    <section className="card mt">
      <h2>Integrations <div className="seg"><button className={!revitMode ? 'on' : ''} disabled={!reviewer} onClick={() => mode(false)}>Standalone</button><button className={revitMode ? 'on' : ''} disabled={!reviewer} onClick={() => mode(true)}>Revit connector</button></div></h2>
      <p className="muted small" style={{ marginTop: 0 }}>With the Revit connector on, the Qualigrafo add-in publishes model snapshots to this project and opens commented elements in Revit. Files can always be uploaded as well.{!reviewer && ' Consultant or Owner / QA switches the mode.'}</p>
      <div className="kv">
        <div><small>Add-in API address</small><span style={{ wordBreak: 'break-all' }}>{apiUrl}</span></div>
        <div><small>Published models</small>{connector.models.length ? connector.models.map((m) => `${m.name} (${m.snapshots[0]?.version ?? 'no snapshot'})`).join(', ') : 'None yet'}</div>
      </div>
      {role === 'Owner / QA' && (
        <>
          <h3 style={{ fontSize: 11, margin: '14px 0 6px', textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--muted)' }}>Connector tokens</h3>
          <div className="row"><input className="input" style={{ maxWidth: 320 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. CAD workstation 1" aria-label="Token name" /><button className="btn pri" disabled={profile.status !== 'Active'} onClick={make}>Create token</button></div>
          {secret && (
            <div className="notice info" style={{ marginTop: 10 }}>
              <b>Connector token — shown only once</b>
              <div className="secret" style={{ margin: '8px 0' }}><span style={{ flex: 1, wordBreak: 'break-all', fontSize: 13 }}>{secret}</span><button type="button" className="btn sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
              <span className="small">Enter it in the Revit add-in with the API address above. Store it like a password; revoke it if it is lost.</span>
              <div><button type="button" className="link small" onClick={() => setSecret(null)}>I have stored it</button></div>
            </div>
          )}
          <div className="tablewrap" style={{ marginTop: 10 }}><table>
            <thead><tr><th>Name</th><th>Token</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead>
            <tbody>
              {connector.tokens.map((t) => (
                <tr key={t.id} style={t.revokedAt ? { opacity: 0.6 } : undefined}>
                  <td><b>{t.name}</b></td><td><code>{t.prefix}…</code></td><td>{fmtDate(t.createdAt)}</td><td>{t.lastUsedAt ? fmtDate(t.lastUsedAt) : <span className="muted">never</span>}</td>
                  <td>{t.revokedAt ? <Badge dot={false}>Revoked</Badge> : <Badge tone="green" dot={false}>Active</Badge>}</td>
                  <td style={{ textAlign: 'right' }}>{!t.revokedAt && <button className="btn sm" onClick={async () => { if (!confirm(`Revoke "${t.name}"? The add-in using it stops working immediately.`)) return; const er = await revokeToken(t.id); toast(er ?? 'Token revoked', er ? 'warn' : 'ok') }}>Revoke</button>}</td>
                </tr>
              ))}
              {!connector.tokens.length && <tr><td colSpan={6} className="muted">No connector tokens.</td></tr>}
            </tbody>
          </table></div>
        </>
      )}
    </section>
  )
}

export default function Setup() {
  const { packs } = useLibraryPacks()
  const { profile, markets: sel, baseline, baselines, reqs, role, saveProfile, toast } = useStore()
  const { ref: industries } = useIndustries()
  const [group, setGroup] = useState<IndustryGroup>(profile.industryGroup)
  const [facility, setFacility] = useState(profile.facilityType)
  const [secondary, setSecondary] = useState(profile.secondaryFacilityType ?? '')
  const [custom, setCustom] = useState(profile.customFacilityType ?? '')
  const [service, setService] = useState<ServiceType>(profile.serviceType)
  const [bim, setBim] = useState<BimRequirement>(profile.bimRequirement ?? { lod: 'LOD 300', coordination: true, assetHandover: 'None' })
  const [scope, setScope] = useState(profile.scope)
  const [stage, setStage] = useState(profile.projectStage)
  const [std, setStd] = useState(profile.ownerStandards)
  const [mk, setMk] = useState<MarketKey[]>(sel)
  const [reason, setReason] = useState('')
  const admin = role === 'Owner / QA' && profile.status === 'Active'
  const material = facility !== profile.facilityType || scope !== profile.scope || group !== profile.industryGroup

  const submit = async () => {
    const err = await saveProfile({
      industryGroup: group, facilityType: facility, secondaryFacilityType: secondary || undefined,
      customFacilityType: facility === CUSTOM_FACILITY ? custom : undefined, serviceType: service,
      bimRequirement: includesBim(service) ? bim : undefined, scope, projectStage: stage, ownerStandards: std, markets: mk, reason,
    })
    if (err) toast(err, 'warn')
    else { toast('New baseline created; the previous baseline is preserved'); setReason('') }
  }

  return (
    <>
      <PageHead title="Project setup & baseline" sub="Project location and target markets are captured independently. Every scope change creates a new requirement baseline; earlier baselines and approvals are preserved." actions={<Badge tone="blue">Current baseline B{baseline}</Badge>} />
      <Details />
      <div className="grid g21">
        <section className="card">
          <h2>Project profile</h2>
          <div className="grid g2">
            <div>
              <label className="lab" style={{ marginTop: 0 }}>Project location</label>
              <input className="input" value={`${profile.site} (${markets[profile.projectCountry].name})`} disabled />
              <label className="lab">Industry group</label>
              <select className="input" value={group} disabled={!admin} onChange={(e) => { setGroup(e.target.value as IndustryGroup); setFacility(''); setSecondary('') }}>{(industries?.groups ?? [{ key: group }]).map((g) => <option key={g.key}>{g.key}</option>)}</select>
              <label className="lab">Facility type (project sub-type)</label>
              <select className="input" value={facility} disabled={!admin} onChange={(e) => setFacility(e.target.value)}>
                <option value="">Choose…</option>
                {facilitiesOf(industries, group).map((x) => <option key={x}>{x}</option>)}
              </select>
              {facility === CUSTOM_FACILITY && (<><label className="lab">Name of the custom facility</label><input className="input" value={custom} disabled={!admin} onChange={(e) => setCustom(e.target.value)} /></>)}
              <label className="lab">Secondary sub-type (optional)</label>
              <select className="input" value={secondary} disabled={!admin} onChange={(e) => setSecondary(e.target.value)}>
                <option value="">None</option>
                {facilitiesOf(industries, group).filter((x) => x !== CUSTOM_FACILITY && x !== facility).map((x) => <option key={x}>{x}</option>)}
              </select>
              <label className="lab">Service type</label>
              <select className="input" value={service} disabled={!admin} onChange={(e) => setService(e.target.value as ServiceType)}>{(industries?.serviceTypes ?? [service]).map((x) => <option key={x}>{x}</option>)}</select>
              <label className="lab">Project scope</label>
              <select className="input" value={scope} disabled={!admin} onChange={(e) => setScope(e.target.value as Scope)}>{(industries?.scopes ?? SCOPE).map((x) => <option key={x}>{x}</option>)}</select>
              <label className="lab">Project stage</label>
              <select className="input" value={stage} disabled={!admin} onChange={(e) => setStage(e.target.value)}>
                {[...(industries?.stages ?? []), ...(industries && industries.stages.includes(stage) ? [] : [stage])].filter(Boolean).map((x) => <option key={x}>{x}</option>)}
              </select>
              {includesBim(service) && industries && (
                <div className="subcard" style={{ marginTop: 10 }}>
                  <label className="lab" style={{ marginTop: 0 }}>BIM level of development</label>
                  <select className="input" value={bim.lod} disabled={!admin} onChange={(e) => setBim({ ...bim, lod: e.target.value })}>{industries.lodLevels.map((x) => <option key={x}>{x}</option>)}</select>
                  <label className="lab">Coordination / clash detection</label>
                  <select className="input" value={bim.coordination ? 'Yes' : 'No'} disabled={!admin} onChange={(e) => setBim({ ...bim, coordination: e.target.value === 'Yes' })}><option>Yes</option><option>No</option></select>
                  <label className="lab">Asset / handover deliverable</label>
                  <select className="input" value={bim.assetHandover} disabled={!admin} onChange={(e) => setBim({ ...bim, assetHandover: e.target.value })}>{industries.assetHandover.map((x) => <option key={x}>{x}</option>)}</select>
                </div>
              )}
            </div>
            <div>
              <label className="lab" style={{ marginTop: 0 }}>Target markets (where product will be supplied)</label>
              {(Object.keys(markets) as MarketKey[]).map((k) => (
                <label key={k} className="row" style={{ padding: '4px 0', fontWeight: 500 }}>
                  <input type="checkbox" checked={mk.includes(k)} disabled={!admin || k === profile.projectCountry} onChange={(e) => setMk(e.target.checked ? [...mk, k] : mk.filter((x) => x !== k))} />
                  <MarketChip m={k} /> {markets[k].name} <span className="muted small">{(() => { const n = reqs.filter((r) => r.market === k).length, a = approvedOf(packs?.find((p) => p.market === k)); return n ? `${n} requirements` : a ? `library v${a.version} adds requirements` : 'no approved library pack' })()}</span>
                </label>
              ))}
              <p className="muted small" style={{ marginTop: 6 }}>The project country always stays in scope. Adding a market brings in the approved library items for this facility type; a market without an approved pack shows explicit “no coverage”, never 100%.</p>
            </div>
          </div>
          <label className="lab">Applicable owner standards and approved procedures</label>
          <textarea className="input" style={{ minHeight: 56 }} value={std} disabled={!admin} onChange={(e) => setStd(e.target.value)} />
          <label className="lab">Change rationale (required)</label>
          <textarea className="input" style={{ minHeight: 56 }} value={reason} disabled={!admin} onChange={(e) => setReason(e.target.value)} placeholder="Why is the project scope being configured or changed?" />
          {material && <div className="notice" style={{ marginTop: 10 }}>Changing the industry group, facility type or project scope resets all applicability decisions to “Assessment pending”. Historical baselines keep their original decisions.</div>}
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
        <h2>Regulatory source inventory <span className="muted small" style={{ fontWeight: 400 }}>requirement library status per market · <button className="link small" onClick={() => home('library')}>open library</button></span></h2>
        <div className="tablewrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>Market</th><th>Authority</th><th>Reference base</th><th>Pack status</th><th></th></tr></thead>
            <tbody>
              {(Object.keys(markets) as MarketKey[]).map((k) => { const pk = packs?.find((p) => p.market === k), a = approvedOf(pk), d = draftOf(pk); return (
                <tr key={k}>
                  <td><MarketChip m={k} /> {markets[k].name}</td>
                  <td>{markets[k].authority}</td>
                  <td>{markets[k].base}</td>
                  <td>{!packs ? <span className="muted small">Loading…</span> : a ? <><Badge tone="green">Library v{a.version} approved · {a.items} items</Badge><small>{a.approvedByName}{a.approvedAt ? ` · ${fmtDate(a.approvedAt)}` : ''}{a.starter ? ' · from unverified starter' : ''}{d ? ` · draft v${d.version} in progress` : ''}</small></> : <><Badge tone="amber">{d ? `Draft v${d.version} · not approved` : 'No library pack'}</Badge><small>Projects get no requirements for this market until a version is approved</small></>}</td>
                  <td><a href={markets[k].url} target="_blank" rel="noopener noreferrer">Official source <ExternalLink size={11} /></a></td>
                </tr>
              ) })}
            </tbody>
          </table>
        </div>
      </section>
      <Integrations />
      <Lifecycle />
    </>
  )
}
