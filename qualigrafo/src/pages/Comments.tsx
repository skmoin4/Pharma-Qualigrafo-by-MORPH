import { useEffect, useMemo, useState } from 'react'
import { Box, Download, FileText, Link2, MapPin, Plus, Send } from 'lucide-react'
import { hasCurrentSource, isActiveDoc, useStore } from '../store'
import type { Place } from '../store'
import type { Doc, FileMeta, ImportBatch, Pin } from '../types'
import { DrawingViewer, isDrawing } from '../components/Drawing'
import type { Marker } from '../components/Drawing'
import { Badge, Empty, PageHead, R, fmtDate } from '../components/ui'

/** The drawing file of a given revision: the current source, or the file imported for that revision earlier. */
export function drawingFor(doc: Doc | undefined, rev: number, imports: ImportBatch[]): FileMeta | null {
  if (!doc) return null
  if (doc.sourceRev === rev && hasCurrentSource(doc) && isDrawing(doc.file)) return doc.file
  const imp = imports.find((i) => i.doc === doc.id && i.toRev === rev && isDrawing(i.file))
  return imp?.file ?? null
}

const NAV_TONE: Record<string, string> = { Pending: 'amber', Delivered: 'blue', Focused: 'green', Expired: '' }

function download(name: string, body: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type }))
  a.download = name
  a.click()
}

/** Revit link + "Open in Revit" for one comment (only when the project's Revit integration is on). */
function RevitPanel({ c, stale }: { c: Pin; stale: boolean }) {
  const { connector, linkElement, navigate, toast, refresh, profile, scope } = useStore()
  const [model, setModel] = useState(c.model ?? '')
  const [element, setElement] = useState(c.element ?? '')
  useEffect(() => { setModel(c.model ?? ''); setElement(c.element ?? '') }, [c.id, c.model, c.element])
  const waiting = c.nav && (c.nav.status === 'Pending' || c.nav.status === 'Delivered')
  // While the add-in has not answered, refresh the project every few seconds to show the outcome.
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [waiting, refresh])
  if (scope) return null
  const dirty = model !== (c.model ?? '') || element !== (c.element ?? '')
  const save = async (m: string | null, e: string | null) => { const er = await linkElement(c.id, m, e); toast(er ?? (m ? 'Revit element linked' : 'Revit link removed'), er ? 'warn' : 'ok') }
  const send = async () => { const er = await navigate(c.id); toast(er ?? 'Sent to Revit. Waiting for the add-in…', er ? 'warn' : 'ok') }
  const requestJson = () => download(`${c.id}_Revit_navigation.json`, JSON.stringify({
    schemaVersion: '1.0', project: profile.id, comment: c.id, text: c.text, modelGuid: c.model, elementUniqueId: c.element,
    drawing: { document: c.doc, revision: c.rev, page: c.page, normalizedPoint: c.anchored ? { x: c.x, y: c.y } : null }, action: 'select-and-show',
  }, null, 2), 'application/json')
  return (
    <div className="revit-panel">
      <div className="row sb"><b><Box size={14} style={{ verticalAlign: -2 }} /> Revit</b>{c.nav && <Badge tone={NAV_TONE[c.nav.status] ?? 'red'}>{c.nav.status}{c.nav.detail ? ` · ${c.nav.detail}` : ''}</Badge>}</div>
      {connector.models.length === 0
        ? <p className="muted small" style={{ margin: '6px 0 0' }}>No Revit model has been published to this project yet. Install the add-in with a connector token (Setup → Integrations) and publish the model.</p>
        : (
          <div className="grid g2" style={{ marginTop: 8 }}>
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Revit model"><option value="">No model linked</option>{connector.models.map((m) => <option key={m.guid} value={m.guid}>{m.name}</option>)}</select>
            <input className="input" value={element} onChange={(e) => setElement(e.target.value)} placeholder="Element UniqueId" aria-label="Revit element" />
          </div>
        )}
      <div className="row wrap" style={{ marginTop: 8 }}>
        {connector.models.length > 0 && <button type="button" className="btn sm" disabled={!dirty} onClick={() => save(model || null, element.trim() || null)}><Link2 size={12} /> Save link</button>}
        {c.model && <button type="button" className="btn sm" onClick={() => save(null, null)}>Remove link</button>}
        <button type="button" className="btn sm pri" disabled={!c.model || !c.element || stale || !!waiting} onClick={send}><Send size={12} /> Open in Revit</button>
        <button type="button" className="btn sm ghost" disabled={!c.model} onClick={requestJson}><Download size={12} /> Request JSON</button>
      </div>
      {stale && c.model && <p className="muted small" style={{ margin: '6px 0 0' }}>The comment refers to an earlier revision; remap it before opening the current model.</p>}
      {c.nav && <p className="muted small" style={{ margin: '6px 0 0' }}>{c.nav.by} · {fmtDate(c.nav.at)}. Success is shown only after the add-in confirms it, never because a request was sent.</p>}
    </div>
  )
}

/** Technical comments raised against an exact document revision, optionally pinned on its drawing. */
export default function Comments() {
  const { pins, docs, imports, replyPin, addPin, anchorPin, role, toast, revitMode } = useStore()
  const [sel, setSel] = useState<string | null>(null)
  const [filter, setFilter] = useState<'Open' | 'Closed' | 'all'>('Open')
  const [reply, setReply] = useState('')
  const [adding, setAdding] = useState(false)
  const [moving, setMoving] = useState(false)
  const commentable = docs.filter((d) => d.status !== 'Missing' && isActiveDoc(d))
  const [f, setF] = useState<{ doc: string; room: string; text: string; onDrawing: boolean; place: Place | null }>({ doc: commentable[0]?.id ?? '', room: '', text: '', onDrawing: true, place: null })

  const list = pins.filter((p) => filter === 'all' || p.status === filter)
  const c = pins.find((p) => p.id === sel) ?? list[0] ?? null
  const doc = c ? docs.find((d) => d.id === c.doc) : undefined
  const stale = !!c && !!doc && doc.rev !== c.rev
  const pinDrawing = c ? drawingFor(doc, c.rev, imports) : null
  const currentDrawing = doc ? drawingFor(doc, doc.rev, imports) : null
  const formDoc = docs.find((d) => d.id === f.doc)
  const formDrawing = formDoc ? drawingFor(formDoc, formDoc.rev, imports) : null
  useEffect(() => { setMoving(false) }, [c?.id])

  /** Pins of one document revision as viewer markers. */
  const markersFor = useMemo(() => (docId: string, rev: number, selected?: string) =>
    pins.filter((p) => p.anchored && p.doc === docId && p.rev === rev).map((p): Marker => ({ id: p.id, n: Number(p.id.split('-')[1]), page: p.page, x: p.x, y: p.y, tone: p.id === selected ? 'sel' : p.status === 'Closed' ? 'closed' : 'open' })), [pins])

  const create = async () => {
    if (!formDoc) return toast('Choose the document the comment refers to.', 'warn')
    if (f.onDrawing && formDrawing && !f.place) return toast('Click the drawing to place the comment, or untick "Place on the drawing".', 'warn')
    const r = await addPin({ text: f.text, doc: formDoc.id, room: f.room.trim() || formDoc.system, place: f.onDrawing && formDrawing && f.place ? f.place : undefined })
    if (r.error) return toast(r.error, 'warn')
    toast(`${r.id} raised on ${formDoc.id} ${R(formDoc.rev)}`)
    setAdding(false); setF({ ...f, room: '', text: '', place: null }); setFilter('Open'); if (r.id) setSel(r.id)
  }
  const post = async (close: boolean) => {
    if (!c) return
    const er = await replyPin(c.id, reply, close)
    if (er) toast(er, 'warn')
    else { setReply(''); toast(close ? `${c.id} closed` : 'Response added') }
  }
  const place = async (p: Place) => {
    if (!c) return
    const er = await anchorPin(c.id, p)
    toast(er ?? (stale ? `${c.id} remapped to ${R(doc!.rev)}` : `${c.id} placed on the drawing`), er ? 'warn' : 'ok')
    if (!er) setMoving(false)
  }
  const exportCsv = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const rows = [['Comment', 'Document', 'Revision', 'Location', 'Page', 'X', 'Y', 'Revit model', 'Revit element', 'Raised by', 'Status', 'Comment text', 'Replies'],
      ...pins.map((p) => [p.id, p.doc, R(p.rev), p.room, p.anchored ? String(p.page) : '', p.anchored ? String(p.x) : '', p.anchored ? String(p.y) : '', p.model ?? '', p.element ?? '', p.by, p.status, p.text, p.replies.map((r) => `${r.by} (${r.at.slice(0, 10)}): ${r.text}`).join(' | ')])]
    download('Technical_Comments.csv', rows.map((r) => r.map(cell).join(',')).join('\r\n'), 'text/csv')
  }
  const exportJson = () => download('Technical_Comments.json', JSON.stringify(pins, null, 2), 'application/json')

  return (
    <>
      <PageHead
        title="Technical comments"
        sub="Review comments raised against an exact document revision, pinned on its drawing and optionally linked to a Revit element. The contractor responds; a reviewer closes each comment with a rationale."
        actions={<>
          <button className="btn" onClick={exportCsv} disabled={!pins.length}><Download size={13} /> CSV</button>
          <button className="btn" onClick={exportJson} disabled={!pins.length}><Download size={13} /> JSON</button>
          <button className="btn pri" onClick={() => setAdding(!adding)}><Plus size={13} /> New comment</button>
        </>}
      />
      {adding && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>New comment</h2>
          <div className="grid g2">
            <div><label className="lab" style={{ marginTop: 0 }}>Document (current revision)</label>
              <select className="input" value={f.doc} onChange={(e) => setF({ ...f, doc: e.target.value, place: null })}>{commentable.map((d) => <option key={d.id} value={d.id}>{d.id} · {d.title} · {R(d.rev)}</option>)}</select></div>
            <div><label className="lab" style={{ marginTop: 0 }}>Location / sheet / area</label>
              <input className="input" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} placeholder="e.g. Sheet 2, grid C-4, room CR-101" /></div>
          </div>
          <label className="lab">Comment</label>
          <textarea className="input" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="What needs to change, and why?" />
          {formDrawing ? (
            <>
              <label className="row" style={{ marginTop: 10 }}><input type="checkbox" checked={f.onDrawing} onChange={(e) => setF({ ...f, onDrawing: e.target.checked, place: null })} /><span className="small">Place on the drawing{f.place ? ` · page ${f.place.page} selected` : ''}</span></label>
              {f.onDrawing && formDoc && (
                <div style={{ marginTop: 8 }}>
                  <DrawingViewer file={formDrawing} placing onPick={(p) => setF({ ...f, place: p })}
                    markers={[...markersFor(formDoc.id, formDoc.rev), ...(f.place ? [{ id: 'new', n: 0, ...f.place, tone: 'draft' as const }] : [])]} />
                </div>
              )}
            </>
          ) : formDoc && <p className="muted small">{formDoc.id} {R(formDoc.rev)} has no PDF or image drawing uploaded, so the comment is raised without a position.</p>}
          <div className="row" style={{ marginTop: 10 }}><button className="btn pri" onClick={create}>Raise comment</button><button className="btn" onClick={() => setAdding(false)}>Cancel</button></div>
        </section>
      )}
      <div className="grid cmtgrid">
        <section className="card">
          <div className="seg" style={{ marginBottom: 10 }}>
            {(['Open', 'Closed', 'all'] as const).map((k) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => { setFilter(k); setSel(null) }}>{k === 'all' ? 'All' : k} ({k === 'all' ? pins.length : pins.filter((p) => p.status === k).length})</button>)}
          </div>
          {list.map((p) => (
            <button key={p.id} className={`cmt ${c && p.id === c.id ? 'sel' : ''}`} onClick={() => setSel(p.id)}>
              <div className="row sb"><b>{p.id}</b><span className="row" style={{ gap: 4 }}>{p.anchored && <MapPin size={12} aria-label="On drawing" />}{p.model && <Box size={12} aria-label="Linked to Revit" />}<Badge tone={p.status === 'Open' ? 'amber' : 'green'}>{p.status}</Badge></span></div>
              <p className="small" style={{ margin: '4px 0' }}>{p.text}</p>
              <span className="muted small">{p.doc} {R(p.rev)} · {p.room} · {p.replies.length} repl{p.replies.length === 1 ? 'y' : 'ies'}</span>
            </button>
          ))}
          {!list.length && <Empty title={pins.length ? 'Nothing in this filter' : 'No comments yet'}>{pins.length ? '' : 'Raise the first comment with “New comment”.'}</Empty>}
        </section>

        <section className="card">
          {!c || !doc ? <Empty title="Select a comment" /> : (
            <>
              <div className="row sb" style={{ alignItems: 'flex-start' }}>
                <div><h2 style={{ margin: 0 }}>{c.id}</h2><div className="muted small">{doc.id} · {doc.title} · raised on {R(c.rev)} · {c.room}{c.anchored ? ` · page ${c.page}` : ''}</div></div>
                <Badge tone={c.status === 'Open' ? 'amber' : 'green'}>{c.status}</Badge>
              </div>

              {moving && currentDrawing ? (
                <div style={{ marginTop: 10 }}>
                  <div className="notice info small" style={{ marginBottom: 8 }}>{stale ? `Remap ${c.id} onto ${R(doc.rev)}: click where it now applies.` : `Click where ${c.id} applies on ${doc.id} ${R(doc.rev)}.`}</div>
                  <DrawingViewer file={currentDrawing} placing onPick={place} markers={markersFor(doc.id, doc.rev)} />
                  <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => setMoving(false)}>Cancel</button>
                </div>
              ) : c.anchored && pinDrawing ? (
                <div style={{ marginTop: 10 }}>
                  <DrawingViewer file={pinDrawing} markers={markersFor(doc.id, c.rev, c.id)} onSelect={(id) => setSel(id)} focus={{ id: c.id, n: Number(c.id.split('-')[1]), page: c.page, x: c.x, y: c.y, tone: 'sel' }} />
                </div>
              ) : (
                <div className="filecard">
                  <FileText size={18} className="fc-icon" />
                  <div className="fc-main"><div className="fc-name">{c.anchored ? 'Drawing file not available' : 'Not placed on a drawing'}</div><div className="muted small">{currentDrawing ? `${doc.id} ${R(doc.rev)} has a drawing; the comment can be placed on it.` : `${doc.id} ${R(doc.rev)} has no PDF or image drawing uploaded.`}</div></div>
                </div>
              )}
              {stale && <div className="notice" style={{ marginTop: 10 }}>The document is now {R(doc.rev)}. This comment refers to {R(c.rev)}; confirm whether it still applies{currentDrawing ? ' and remap it' : ''} before closing.</div>}
              {c.status === 'Open' && currentDrawing && !moving && (role !== 'Contractor' || c.by === role) && (
                <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setMoving(true)}><MapPin size={12} /> {stale ? `Remap to ${R(doc.rev)}` : c.anchored ? 'Move on drawing' : 'Place on drawing'}</button>
              )}

              {revitMode && <RevitPanel c={c} stale={stale} />}

              <h3 style={{ fontSize: 11, margin: '18px 0 6px', textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--muted)' }}>Discussion</h3>
              <p><b className="small">{c.by}</b> <span className="muted small">· original comment</span></p>
              <p style={{ margin: '3px 0 8px' }}>{c.text}</p>
              <div className="list">{c.replies.map((r, i) => <div key={i}><b className="small">{r.by}</b> <span className="muted small">· {fmtDate(r.at)}</span><p>{r.text}</p></div>)}</div>
              {c.status === 'Open' ? (
                <>
                  <textarea className="input" style={{ marginTop: 8 }} placeholder="Response or closure rationale…" value={reply} onChange={(e) => setReply(e.target.value)} />
                  <div className="row wrap" style={{ marginTop: 8 }}>
                    <button className="btn" onClick={() => post(false)}>Add response</button>
                    <button className="btn pri" disabled={role === 'Contractor'} onClick={() => post(true)}>Close comment</button>
                    {role === 'Contractor' && <span className="muted small">A reviewer closes comments.</span>}
                  </div>
                </>
              ) : <p className="muted small" style={{ marginTop: 8 }}>Closed. The discussion is kept as a record.</p>}
            </>
          )}
        </section>
      </div>
    </>
  )
}
