import { useEffect, useState } from 'react'
import { Download, Plus, Send } from 'lucide-react'
import { useStore } from '../store'
import { Badge, PageHead, R, fmtDate } from '../components/ui'

const OUTCOMES = ['Focused', 'Wrong model', 'Stale version', 'Element missing', 'Link unloaded'] as const
type Outcome = (typeof OUTCOMES)[number]

export default function Comments() {
  const { pins, docs, revitMode, setRevit, replyPin, addPin, role, toast, log } = useStore()
  const [sel, setSel] = useState(pins[0]?.id ?? '')
  const [zoom, setZoom] = useState(false)
  const [reply, setReply] = useState('')
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<'idle' | 'sent' | Outcome>('idle')
  const [outcome, setOutcome] = useState<Outcome>('Focused')
  const [adding, setAdding] = useState(false)
  const c = pins.find((p) => p.id === sel) ?? pins[0]
  useEffect(() => { setPhase('idle'); setZoom(false) }, [sel, revitMode])

  if (!c) return <><PageHead title="Technical comments" sub="Comments anchored to a drawing revision." /><div className="empty"><b>No comments in this project</b>Add the first anchored comment.<br /><button className="btn pri" style={{ marginTop: 10 }} onClick={() => { const d = docs.find((x) => x.status !== 'Missing')!; const id = addPin({ text: 'New comment', doc: d.id, rev: d.rev, room: d.system, x: 0.5, y: 0.5 }); setSel(id) }}>Add comment</button></div></>

  const doc = docs.find((d) => d.id === c.doc)!
  const stale = doc.rev !== c.rev
  const vb = zoom ? `${Math.max(0, Math.min(400, c.x * 800 - 200))} ${Math.max(0, Math.min(230, c.y * 460 - 115))} 400 230` : '0 0 800 460'

  const send = () => {
    const req = { schemaVersion: '1.0', requestId: `NAV-${Date.now()}`, prototype: true, issueId: c.id, modelSourceId: c.model, elementUniqueIds: [c.element], drawing: { documentId: c.doc, revision: c.rev, page: 1, normalizedPoint: { x: c.x, y: c.y } }, action: 'select-and-show', expiresAt: new Date(Date.now() + 300000).toISOString() }
    setPhase('sent')
    log(`Revit navigation request ${req.requestId} prepared for ${c.id} (simulation)`)
    setTimeout(() => setPhase(outcome), 1200)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(req, null, 2)], { type: 'application/json' }))
    a.download = `${c.id}_Revit_Focus_PROTOTYPE.json`
    a.click()
  }
  const onCanvas = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!adding) return
    const rect = e.currentTarget.getBoundingClientRect()
    const id = addPin({ text: draft || 'New comment', doc: doc.id, rev: doc.rev, room: doc.system, x: +((e.clientX - rect.left) / rect.width).toFixed(2), y: +((e.clientY - rect.top) / rect.height).toFixed(2) })
    setSel(id); setAdding(false); setDraft(''); toast('Comment anchored at the selected point')
  }
  const post = (close: boolean) => { const er = replyPin(c.id, reply, close); if (er) toast(er, 'warn'); else setReply('') }

  return (
    <>
      <PageHead title="Technical comments" sub="Comments are anchored to an exact drawing revision. Select one to focus it — with or without Revit. Responses and closure follow the same rules in both modes." actions={<div className="seg"><button className={!revitMode ? 'on' : ''} onClick={() => setRevit(false)}>Standalone</button><button className={revitMode ? 'on' : ''} onClick={() => setRevit(true)}>Revit connector</button></div>} />
      <div className="grid cmtgrid">
        <section className="card">
          <h2>Register <button className={`btn sm ${adding ? 'pri' : ''}`} onClick={() => { setAdding(!adding); if (!adding) toast('Write the comment, then click the drawing to place it') }}><Plus size={12} /> Anchor</button></h2>
          {adding && <textarea className="input" style={{ marginBottom: 8 }} placeholder="Comment text, then click the drawing…" value={draft} onChange={(e) => setDraft(e.target.value)} />}
          {pins.map((p, i) => (
            <button key={p.id} className={`cmt ${p.id === c.id ? 'sel' : ''}`} onClick={() => setSel(p.id)}>
              <div className="row sb"><b>{i + 1} · {p.id}</b><Badge tone={p.status === 'Open' ? 'amber' : 'green'}>{p.status}</Badge></div>
              <p className="small" style={{ margin: '4px 0' }}>{p.text}</p>
              <span className="muted small">{p.doc} {R(p.rev)} · {p.room} · {p.replies.length} repl{p.replies.length === 1 ? 'y' : 'ies'}</span>
            </button>
          ))}
        </section>

        <section className="card">
          <div className="row sb" style={{ marginBottom: 8 }}>
            <div><b>{c.id}</b> <span className="muted">· {doc.title} · source {R(c.rev)}</span></div>
            <div className="row"><button className="btn sm" onClick={() => setZoom(true)}>Zoom to comment</button><button className="btn sm" onClick={() => setZoom(false)}>Full sheet</button></div>
          </div>
          <div className="canvaswrap">
            <svg viewBox={vb} onClick={onCanvas} style={{ width: '100%', display: 'block', cursor: adding ? 'crosshair' : 'default' }} role="img" aria-label="Illustrative floor plan with comment pins">
              <defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#e5edf0" /></pattern></defs>
              <rect width="800" height="460" fill="url(#g)" />
              <g stroke="#5b7684" strokeWidth="5" fill="#fff"><rect x="65" y="65" width="670" height="330" /><path d="M320 65V245H735M490 65V245M65 285H320M320 245V395" fill="none" /></g>
              <g fill="#47616d" fontSize="15" fontFamily="sans-serif"><text x="125" y="135">CR-101</text><text x="355" y="135">CR-102</text><text x="550" y="135">CR-103</text><text x="430" y="330">Service corridor</text><text x="100" y="345">Equipment area</text></g>
              <g stroke="#0b7a80" strokeWidth="3" fill="none"><path d="M140 215H650M400 215V160M590 215V160" /><rect x="375" y="145" width="50" height="25" /><rect x="565" y="145" width="50" height="25" /></g>
              <text x="75" y="388" fontSize="11" fill="#8aa0ac" fontFamily="sans-serif">Illustrative schematic — not a project drawing</text>
              {pins.map((p, i) => {
                const on = p.id === c.id
                return (
                  <g key={p.id} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setSel(p.id) }}>
                    {on && <circle cx={p.x * 800} cy={p.y * 460} r="24" fill="none" stroke="#d9822b" strokeWidth="2.5" strokeDasharray="4 3" />}
                    <circle cx={p.x * 800} cy={p.y * 460} r="13" fill={p.status === 'Closed' ? '#1c7a4f' : on ? '#d9822b' : '#0b7a80'} stroke="#fff" strokeWidth="2.5" />
                    <text x={p.x * 800} y={p.y * 460 + 4.5} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700" fontFamily="sans-serif">{i + 1}</text>
                  </g>
                )
              })}
            </svg>
          </div>
          {stale && <div className="notice" style={{ marginTop: 10 }}>The drawing is now {R(doc.rev)}. This comment stays anchored to {R(c.rev)}; remap it explicitly before navigating the current model.</div>}

          {revitMode && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 5, padding: 12, marginTop: 10, background: '#fafcfd' }}>
              <div className="row sb"><b>Revit navigation request</b><Badge tone="amber">Connector not installed · simulation only</Badge></div>
              <div className="kv"><div><small>Model source</small>{c.model ?? 'Not mapped'}</div><div><small>Element UniqueId (synthetic)</small><span style={{ wordBreak: 'break-all' }}>{c.element ?? 'No mapping — drawing focus only'}</span></div></div>
              <div className="row wrap">
                <span className="small muted">Simulated add-in reply</span>
                <select className="input" style={{ width: 'auto' }} value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select>
                <button className="btn pri" disabled={!c.element || stale || phase === 'sent'} onClick={send}><Send size={13} /> Open in Revit</button>
              </div>
              {phase !== 'idle' && <p style={{ marginTop: 10 }}>{phase === 'sent' ? <Badge tone="blue">Request sent — waiting for add-in acknowledgement…</Badge> : phase === 'Focused' ? <Badge tone="green">Focused: element selected and shown in Revit (simulated)</Badge> : <Badge tone="red">{phase}: {phase === 'Wrong model' ? 'open the correct model' : phase === 'Stale version' ? 'sync the latest published version' : phase === 'Element missing' ? 'remap the deleted element' : 'load the linked model'}</Badge>}</p>}
              <p className="muted small" style={{ marginTop: 8 }}>Success is shown only after the add-in acknowledges navigation, never because a request was sent. Requires: Revit add-in, backend queue, authenticated connector.</p>
            </div>
          )}

          <h3 style={{ fontSize: 11, margin: '18px 0 6px', textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--muted)' }}>Discussion</h3>
          <p><b className="small">{c.by}</b> <span className="muted small">· original comment</span></p>
          <p style={{ margin: '3px 0 8px' }}>{c.text}</p>
          <div className="list">{c.replies.map((r, i) => <div key={i}><b className="small">{r.by}</b> <span className="muted small">· {fmtDate(r.at)}</span><p>{r.text}</p></div>)}</div>
          <textarea className="input" style={{ marginTop: 8 }} placeholder="Response or closure rationale…" value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => post(false)}>Add response</button>
            <button className="btn pri" disabled={role === 'Contractor' || c.status === 'Closed'} onClick={() => post(true)}>Reviewer closes comment</button>
            <button className="btn ghost" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(pins, null, 2)], { type: 'application/json' })); a.download = 'Qualigrafo_Comments.json'; a.click() }}><Download size={13} /> Export</button>
          </div>
        </section>
      </div>
    </>
  )
}
