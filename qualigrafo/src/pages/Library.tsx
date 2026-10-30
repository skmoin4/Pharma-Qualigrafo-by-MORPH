import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, FilePlus2, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { api, errorText } from '../api'
import { approvedOf, draftOf, useLibraryPacks } from '../library'
import type { LibItem, LibPack, LibVersion } from '../library'
import { useStore } from '../store'
import { markets } from '../data/reference'
import { Badge, Empty, MarketChip, PageHead, fmtDate } from '../components/ui'
import { parseCsv } from './Registers'
import { CUSTOM_FACILITY, useIndustries } from '../industries'

type ItemForm = { key: string; title: string; topic: string; discipline: string; facilities: string[]; industries: string[]; critical: boolean; clause: string; sourceVersion: string; effective: string; guidance: string }
const EMPTY: ItemForm = { key: '', title: '', topic: '', discipline: '', facilities: [], industries: [], critical: false, clause: '', sourceVersion: '', effective: '', guidance: '' }
const tone = (s: string) => (s === 'Approved' ? 'green' : s === 'Draft' ? 'amber' : '')
const changeTone = (c: string) => (c === 'Added' || c === 'New' ? 'blue' : c.startsWith('Changed') ? 'amber' : '')

function ItemEditor({ initial, keyLocked, onSave, onCancel }: { initial: ItemForm; keyLocked?: boolean; onSave: (f: ItemForm) => Promise<string | null>; onCancel: () => void }) {
  const [f, setF] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { ref: industries } = useIndustries()
  const save = async () => { setBusy(true); const er = await onSave(f); setBusy(false); setError(er) }
  // Offering 112 facility types at once is unusable: the ticked industry groups narrow the list, and with none
  // ticked the item applies everywhere, so every group's facility types are offered.
  const groups = (industries?.groups ?? []).filter((g) => !f.industries.length || f.industries.includes(g.key))
  const facilityChoices = [...new Set(groups.flatMap((g) => g.facilities))].filter((x) => x !== CUSTOM_FACILITY)
  const set = (k: keyof ItemForm, v: unknown) => setF({ ...f, [k]: v })
  return (
    <div className="card" style={{ margin: '8px 0', background: 'rgba(255, 255, 255, 0.55)' }}>
      <div className="grid g4">
        <div><label className="lab" style={{ marginTop: 0 }}>Key</label><input className="input" value={f.key} disabled={keyLocked} onChange={(e) => set('key', e.target.value)} placeholder="e.g. PREMISES-01" aria-label="Item key" /></div>
        <div style={{ gridColumn: 'span 2' }}><label className="lab" style={{ marginTop: 0 }}>Title</label><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} aria-label="Item title" /></div>
        <div><label className="lab" style={{ marginTop: 0 }}>Discipline</label><input className="input" value={f.discipline} onChange={(e) => set('discipline', e.target.value)} placeholder="e.g. HVAC" aria-label="Item discipline" /></div>
        <div><label className="lab">Clause / section</label><input className="input" value={f.clause} onChange={(e) => set('clause', e.target.value)} aria-label="Item clause" /></div>
        <div><label className="lab">Source version</label><input className="input" value={f.sourceVersion} onChange={(e) => set('sourceVersion', e.target.value)} placeholder="Edition / amendment" aria-label="Item source version" /></div>
        <div><label className="lab">Effective date</label><input className="input" type="date" value={f.effective} onChange={(e) => set('effective', e.target.value)} aria-label="Item effective date" /></div>
        <div><label className="lab">Critical</label><label className="row" style={{ height: 30 }}><input type="checkbox" checked={f.critical} onChange={(e) => set('critical', e.target.checked)} /><span className="small">Critical requirement</span></label></div>
      </div>
      <label className="lab">Topic / scope note</label><input className="input" value={f.topic} onChange={(e) => set('topic', e.target.value)} aria-label="Item topic" />
      <label className="lab">Applies to industry groups (none ticked = all)</label>
      <div className="row wrap">{(industries?.groups ?? []).map((g) => <label key={g.key} className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.industries.includes(g.key)} onChange={(e) => set('industries', e.target.checked ? [...f.industries, g.key] : f.industries.filter((y) => y !== g.key))} /><span className="small">{g.key}</span></label>)}</div>
      <label className="lab">Applies to facility types (none ticked = all)</label>
      <p className="muted small" style={{ margin: '0 0 4px' }}>Only the facility types of the ticked industry groups are offered; with none ticked, every group's are.</p>
      <div className="row wrap">{facilityChoices.map((x) => <label key={x} className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.facilities.includes(x)} onChange={(e) => set('facilities', e.target.checked ? [...f.facilities, x] : f.facilities.filter((y) => y !== x))} /><span className="small">{x}</span></label>)}</div>
      <label className="lab">Guidance for reviewers (optional)</label><textarea className="input" style={{ minHeight: 48 }} value={f.guidance} onChange={(e) => set('guidance', e.target.value)} aria-label="Item guidance" />
      {error && <div className="notice err small" style={{ marginTop: 8 }}>{error}</div>}
      <div className="row" style={{ marginTop: 10 }}><button className="btn pri" disabled={busy} onClick={save}>Save item</button><button className="btn" onClick={onCancel}>Cancel</button></div>
    </div>
  )
}

const CSV_HEAD: Record<string, keyof ItemForm> = { key: 'key', title: 'title', topic: 'topic', discipline: 'discipline', facilities: 'facilities', 'facility types': 'facilities', industries: 'industries', 'industry groups': 'industries', critical: 'critical', clause: 'clause', section: 'clause', 'source version': 'sourceVersion', edition: 'sourceVersion', effective: 'effective', 'effective date': 'effective', guidance: 'guidance' }
function csvItems(text: string): { rows: ItemForm[]; error: string | null } {
  const t = parseCsv(text)
  if (t.length < 2) return { rows: [], error: 'Needs a header row and at least one item.' }
  const cols = t[0].map((h) => CSV_HEAD[h.toLowerCase()])
  if (!['key', 'title', 'discipline'].every((c) => cols.includes(c as keyof ItemForm))) return { rows: [], error: 'Header must contain Key, Title and Discipline (optional: Topic, Facilities, Critical, Clause, Source version, Effective, Guidance).' }
  return {
    error: null,
    rows: t.slice(1).map((r) => {
      const o: ItemForm = { ...EMPTY, facilities: [] }
      cols.forEach((k, i) => {
        const v = (r[i] ?? '').trim()
        if (!k) return
        if (k === 'critical') o.critical = /^(y|yes|true|1|x)$/i.test(v)
        else if (k === 'facilities') o.facilities = v ? v.split(/[|;]/).map((s) => s.trim()).filter(Boolean) : []
        else (o as unknown as Record<string, string>)[k] = v
      })
      return o
    }),
  }
}

function ImportPanel({ versionId, onDone }: { versionId: string; onDone: (v: LibVersion) => void }) {
  const toast = useStore((s) => s.toast)
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const parsed = useMemo(() => (text.trim() ? csvItems(text) : null), [text])
  const template = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['Key,Title,Topic,Discipline,Facilities,Critical,Clause,Source version,Effective,Guidance\r\nPREMISES-01,Premises layout and material / personnel flow,,Civil & Cleanroom,,yes,Chapter 3,2024 edition,2024-06-01,\r\nSTERILE-01,Grade A air supply,,HVAC,Sterile products|Biologics,yes,,,,\r\n'], { type: 'text/csv' }))
    a.download = 'requirement_library_template.csv'
    a.click()
  }
  const run = async () => {
    if (!parsed || parsed.error) return
    if (mode === 'replace' && !confirm('Replace every item in this draft with the file?')) return
    try {
      const r = await api<{ version: LibVersion }>('POST', `/library/versions/${versionId}/import`, { rows: parsed.rows, mode })
      toast(`${parsed.rows.length} item(s) ${mode === 'replace' ? 'loaded' : 'appended'}`); setText(''); onDone(r.version)
    } catch (e) { toast(errorText(e), 'warn') }
  }
  return (
    <div className="card" style={{ margin: '8px 0', background: 'rgba(255, 255, 255, 0.55)' }}>
      <div className="row sb"><b>Import items from CSV</b><button className="btn sm ghost" onClick={template}><Download size={12} /> CSV template</button></div>
      <p className="muted small">Columns: Key, Title, Topic, Discipline, Facilities (separate with |), Critical (yes/no), Clause, Source version, Effective (YYYY-MM-DD), Guidance. All-or-nothing: an invalid row stops the import and is reported.</p>
      <div className="row wrap">
        <button className="btn" onClick={() => input.current?.click()}><Upload size={13} /> Choose CSV file</button>
        <input ref={input} type="file" accept=".csv,text/csv" hidden aria-label="Library CSV" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = '' }} />
        <div className="seg"><button className={mode === 'append' ? 'on' : ''} onClick={() => setMode('append')}>Append</button><button className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>Replace all</button></div>
      </div>
      <textarea className="input" style={{ marginTop: 8, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste CSV here" aria-label="Library CSV content" />
      {parsed?.error && <div className="notice err small" style={{ marginTop: 8 }}>{parsed.error}</div>}
      {parsed && !parsed.error && <div className="row" style={{ marginTop: 8 }}><button className="btn pri" onClick={run}>{mode === 'replace' ? 'Replace with' : 'Append'} {parsed.rows.length} item(s)</button><span className="muted small">{parsed.rows.slice(0, 3).map((r) => r.key).join(', ')}{parsed.rows.length > 3 ? '…' : ''}</span></div>}
    </div>
  )
}

function VersionView({ id, editor, onChanged }: { id: string; editor: boolean; onChanged: () => void }) {
  const { session, toast } = useStore()
  const [v, setV] = useState<LibVersion | null>(null)
  const [edit, setEdit] = useState<string | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [note, setNote] = useState('')
  const [q, setQ] = useState('')
  const load = useCallback(async () => { try { const r = (await api<{ version: LibVersion }>('GET', `/library/versions/${id}`)).version; setV(r); setNote(r.note) } catch (e) { toast(errorText(e), 'warn') } }, [id, toast])
  useEffect(() => { void load() }, [load])
  if (!v) return <section className="card"><Empty title="Loading…" /></section>
  const draft = v.status === 'Draft'
  const canEdit = editor && draft
  const mine = !!session && (v.createdByUserId === session.id || v.updatedByUserId === session.id)
  const call = async (p: Promise<unknown>, ok: string) => { try { await p; toast(ok); await load(); onChanged(); return null } catch (e) { return errorText(e) } }
  const saveItem = (f: ItemForm, item?: LibItem) => call(item ? api('PUT', `/library/items/${item.id}`, { ...f, key: undefined }) : api('POST', `/library/versions/${v.id}/items`, f), item ? `${item.key} saved` : `${f.key.toUpperCase()} added`).then((er) => { if (!er) setEdit(null); return er })
  const shown = v.items.filter((i) => `${i.key} ${i.title} ${i.discipline} ${i.clause}`.toLowerCase().includes(q.toLowerCase()))
  const approve = async () => {
    try {
      const r = await api<{ notified: string[] }>('POST', `/library/versions/${v.id}/approve`, { reason, password })
      toast(`${v.market} v${v.version} approved${r.notified.length ? ` · update sent to ${r.notified.join(', ')}` : ''}`); setReason(''); setPassword(''); await load(); onChanged()
    } catch (e) { setPassword(''); toast(errorText(e), 'warn') }
  }
  return (
    <section className="card">
      <div className="row sb" style={{ alignItems: 'flex-start' }}>
        <div><h2 style={{ margin: 0 }}><MarketChip m={v.market} /> {v.packName} · v{v.version}</h2>
          <div className="muted small">Prepared by {v.createdByName}{v.approvedByName ? ` · approved by ${v.approvedByName} ${v.approvedAt ? fmtDate(v.approvedAt) : ''}` : ''}{v.comparedWith ? ` · compared with v${v.comparedWith}` : ''}</div></div>
        <div className="chips">{v.starter && <Badge tone="violet" dot={false}>Unverified starter template</Badge>}<Badge tone={tone(v.status)}>{v.status}</Badge></div>
      </div>
      {v.starter && draft && <div className="notice small" style={{ marginTop: 10 }}>Topic-level starter content. Check every item against the official text, add clause, source version and effective date, remove what does not apply, then have another editor approve it.</div>}
      {v.approvalReason && <p className="small" style={{ margin: '10px 0 0' }}><b>Approval basis:</b> {v.approvalReason}</p>}
      {canEdit ? (
        <div className="row" style={{ marginTop: 10 }}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Version note (what changed, why)" aria-label="Version note" /><button className="btn sm" style={{ whiteSpace: 'nowrap' }} disabled={note === v.note} onClick={() => call(api('PUT', `/library/versions/${v.id}`, { note }), 'Note saved')}>Save note</button></div>
      ) : v.note && <p className="muted small" style={{ margin: '8px 0 0' }}>{v.note}</p>}

      <div className="filters" style={{ marginTop: 12 }}>
        <input className="input grow" placeholder="Search key, title, discipline, clause…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
        <span className="muted small">{shown.length} of {v.items.length} items</span>
        {canEdit && <><button className="btn sm" onClick={() => { setImporting(!importing); setEdit(null) }}><Upload size={12} /> Import CSV</button><button className="btn sm pri" onClick={() => { setEdit('new'); setImporting(false) }}><Plus size={12} /> Add item</button></>}
      </div>
      {importing && <ImportPanel versionId={v.id} onDone={(nv) => { setV(nv); setImporting(false); onChanged() }} />}
      {edit === 'new' && <ItemEditor initial={EMPTY} onSave={(f) => saveItem(f)} onCancel={() => setEdit(null)} />}
      <div className="tablewrap"><table>
        <thead><tr><th>Key</th><th>Requirement</th><th>Discipline</th><th>Applies to</th><th>Source</th>{v.comparedWith !== null || draft ? <th>Change</th> : null}<th /></tr></thead>
        <tbody>
          {shown.map((i) => edit === i.id ? (
            <tr key={i.id}><td colSpan={7}><ItemEditor initial={{ key: i.key, title: i.title, topic: i.topic, discipline: i.discipline, facilities: i.facilities, industries: i.industries ?? [], critical: i.critical, clause: i.clause, sourceVersion: i.sourceVersion, effective: i.effective, guidance: i.guidance }} keyLocked onSave={(f) => saveItem(f, i)} onCancel={() => setEdit(null)} /></td></tr>
          ) : (
            <tr key={i.id}>
              <td style={{ whiteSpace: 'nowrap' }}><b>{i.key}</b>{i.critical && <small style={{ color: 'var(--red)' }}>Critical</small>}</td>
              <td>{i.title}{i.topic && <small>{i.topic}</small>}</td>
              <td>{i.discipline}</td>
              <td className="small">
                {(i.industries ?? []).length ? (i.industries ?? []).join(', ') : <span className="muted">All industries</span>}
                <small>{i.facilities.length ? i.facilities.join(', ') : 'All facility types'}</small>
              </td>
              <td>{i.clause || i.sourceVersion || i.effective ? <>{i.clause || '—'}<small>{[i.sourceVersion, i.effective].filter(Boolean).join(' · ')}</small></> : <span className="muted small">Clause not recorded</span>}</td>
              {v.comparedWith !== null || draft ? <td><Badge tone={changeTone(i.change)} dot={false}>{i.change}</Badge></td> : null}
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{canEdit && <><button className="iconbtn" onClick={() => { setEdit(i.id); setImporting(false) }} aria-label={`Edit ${i.key}`}><Pencil size={13} /></button> <button className="iconbtn" onClick={() => { if (confirm(`Remove ${i.key} from this draft?`)) void call(api('DELETE', `/library/items/${i.id}`), `${i.key} removed`) }} aria-label={`Remove ${i.key}`}><Trash2 size={13} /></button></>}</td>
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={7}><Empty title={v.items.length ? 'No items match' : 'No items yet'}>{canEdit && !v.items.length ? 'Add items one by one or import a CSV.' : ''}</Empty></td></tr>}
        </tbody>
      </table></div>
      {v.removed.length > 0 && <p className="small" style={{ marginTop: 8 }}><b>Removed compared with v{v.comparedWith}:</b> {v.removed.map((r) => `${r.key} (${r.title})`).join(', ')}</p>}

      {editor && draft && (
        <div className="card" style={{ marginTop: 14, background: 'rgba(255, 255, 255, 0.55)' }}>
          <h2 style={{ marginTop: 0 }}>Approve v{v.version}</h2>
          {mine
            ? <div className="notice small">You prepared or last edited this draft. Under the four-eyes rule another library editor must approve it. If nobody else can yet, ask an administrator to create a second administrator or Owner / QA account under <b>Users &amp; access</b>.</div>
            : <p className="muted small" style={{ marginTop: 0 }}>Approving freezes this version, supersedes the current one, and sends a "Library update" to every active project targeting {v.market}. Projects change only when their Owner / QA applies it.</p>}
          <textarea className="input" value={reason} disabled={mine} onChange={(e) => setReason(e.target.value)} placeholder="Basis of approval: what was verified, against which official text and edition" aria-label="Approval basis" />
          {!mine && <><label className="lab">Password (electronic signature)</label><input className="input" type="password" autoComplete="current-password" style={{ maxWidth: 320 }} value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Approval password" /></>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn pri" disabled={mine || !reason.trim() || !password} onClick={approve}><Check size={13} /> Approve v{v.version}</button>
            <button className="btn danger" onClick={async () => { if (!confirm(`Discard draft v${v.version}? Its changes are lost.`)) return; try { await api('DELETE', `/library/versions/${v.id}`); toast('Draft discarded'); onChanged() } catch (e) { toast(errorText(e), 'warn') } }}>Discard draft</button>
          </div>
        </div>
      )}
    </section>
  )
}

export default function Library() {
  const { session, toast } = useStore()
  const editor = !!session?.canCreateProjects
  const { packs, error, reload } = useLibraryPacks()
  const { ref: industries } = useIndustries()
  /**
   * Nothing is ticked to begin with, as with the industry group in the project wizard. Loading all four by default
   * would hand a pharma installation sixty-odd hospital, solar and building topics to review and approve, which is
   * work they never asked for; and choosing one for them would be the old pharma bias in a new place.
   */
  const [starterGroups, setStarterGroups] = useState<string[]>([])
  const [market, setMarket] = useState<string | null>(null)
  const [vid, setVid] = useState<string | null>(null)
  const pack: LibPack | undefined = packs?.find((p) => p.market === market) ?? packs?.find((p) => p.versions.length) ?? packs?.[0]
  const version = pack?.versions.find((v) => v.id === vid) ?? draftOf(pack) ?? approvedOf(pack) ?? pack?.versions[0]
  const empty = !!packs && packs.every((p) => !p.versions.length)
  /** Nothing approved anywhere: every project created in this state gets no requirements at all. */
  const nothingApproved = !!packs && packs.every((p) => !approvedOf(p))

  const starter = async () => {
    try { const r = await api<{ created: string[] }>('POST', '/library/starter', { industries: starterGroups }); toast(`Starter drafts created: ${r.created.join(', ')}`); await reload() } catch (e) { toast(errorText(e), 'warn') }
  }
  const newDraft = async (m: string) => {
    try { const r = await api<{ version: LibVersion }>('POST', `/library/packs/${m}/drafts`); toast(`Draft v${r.version.version} created`); await reload(); setVid(r.version.id) } catch (e) { toast(errorText(e), 'warn') }
  }

  return (
    <>
      <PageHead title="Requirement library" sub="The organisation's approved requirement packs per market. Projects take their requirements from the approved version; every new version is reviewed by a second editor and offered to projects as an update." />
      {error && <div className="notice err">{error}</div>}
      {nothingApproved && (
        <div className="notice err small" style={{ marginBottom: 12 }} role="alert">
          <b>No version is approved yet, so no project can receive a single requirement.</b> A project created now
          starts empty and stays empty until a version is approved here. Approval is a two-person step: under the
          four-eyes rule the editor who prepares or last edits a version <b>cannot</b> approve it. So a second
          administrator or Owner / QA account has to exist <b>and be able to sign in</b> — an invited account still
          holding its temporary password does not count. Check that under <b>Users &amp; access</b>.
        </div>
      )}
      {empty && (
        <section className="card" style={{ marginBottom: 14 }}>
          <Empty title="No requirement library yet">
            Projects get their requirements from approved library packs. Start from the unverified starter template (topic-level, no clauses) and verify it, or import your own packs as CSV.
            {editor && (
              <>
                <div className="row wrap" style={{ justifyContent: 'center', gap: 10, marginTop: 12 }}>
                  {(industries?.groups ?? []).map((g) => (
                    <label key={g.key} className="row" style={{ gap: 4 }}>
                      <input type="checkbox" checked={starterGroups.includes(g.key)} onChange={(e) => setStarterGroups(e.target.checked ? [...starterGroups, g.key] : starterGroups.filter((x) => x !== g.key))} />
                      <span className="small">{g.key}</span>
                    </label>
                  ))}
                </div>
                <p className="muted small" style={{ marginTop: 6 }}>Choose the industries this installation works in — a requirement is only ever offered to a project of its own industry group. More can be added later.</p>
                <button className="btn pri" style={{ marginTop: 6 }} disabled={!starterGroups.length} onClick={starter}><FilePlus2 size={14} /> Load unverified starter template</button>
              </>
            )}
          </Empty>
        </section>
      )}
      {packs && (
        <div className="lib-grid">
          <section className="card flush">
            <h2>Packs</h2>
            {packs.map((p) => {
              const a = approvedOf(p), d = draftOf(p)
              return (
                <button key={p.market} className={`cmt ${pack?.market === p.market ? 'sel' : ''}`} style={{ margin: '0 12px 8px', width: 'calc(100% - 24px)' }} onClick={() => { setMarket(p.market); setVid(null) }}>
                  <div className="row sb"><b><MarketChip m={p.market} /> {markets[p.market].name}</b></div>
                  <div className="chips" style={{ marginTop: 4 }}>
                    {a ? <Badge tone="green" dot={false}>v{a.version} approved · {a.items}</Badge> : <Badge dot={false}>No approved version</Badge>}
                    {d && <Badge tone="amber" dot={false}>Draft v{d.version}</Badge>}
                  </div>
                </button>
              )
            })}
          </section>
          <div>
            {pack && (
              <div className="row wrap" style={{ marginBottom: 10 }}>
                {pack.versions.map((v) => <button key={v.id} className={`btn sm ${version?.id === v.id ? 'pri' : ''}`} onClick={() => setVid(v.id)}>v{v.version} · {v.status}</button>)}
                {editor && !draftOf(pack) && <button className="btn sm" onClick={() => newDraft(pack.market)}><Plus size={12} /> New draft{approvedOf(pack) ? ` from v${approvedOf(pack)!.version}` : ''}</button>}
              </div>
            )}
            {version ? <VersionView key={version.id} id={version.id} editor={editor} onChanged={() => void reload()} /> : pack && <section className="card"><Empty title={`No ${markets[pack.market].name} pack yet`}>{editor ? 'Create a draft and add items or import a CSV.' : 'A library editor has not created this pack yet.'}</Empty></section>}
          </div>
        </div>
      )}
    </>
  )
}
