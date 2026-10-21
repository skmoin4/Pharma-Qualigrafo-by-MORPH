// Drawing viewer: renders a document revision's PDF (pdf.js, loaded on demand) or PNG / JPEG and overlays comment pins.
// Positions are page + normalised x / y, so a pin stays put at any zoom level.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { errorText } from '../api'
import { useStore } from '../store'
import type { Place } from '../store'
import type { FileMeta } from '../types'

export interface Marker { id: string; n: number; page: number; x: number; y: number; tone: 'open' | 'closed' | 'sel' | 'draft' }

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> }
type PdfTask = { promise: Promise<unknown>; destroy: () => Promise<void> }
type PdfPage = { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvas: HTMLCanvasElement; viewport: unknown }) => { promise: Promise<void>; cancel: () => void } }

const ZOOMS = [1, 1.5, 2.5, 4]

export const isDrawing = (f?: FileMeta | null): f is FileMeta => !!f && ['application/pdf', 'image/png', 'image/jpeg'].includes(f.mimeType)

export function DrawingViewer({ file, markers, placing, onPick, onSelect, focus }: {
  file: FileMeta
  markers: Marker[]
  placing?: boolean
  onPick?: (p: Place) => void
  onSelect?: (id: string) => void
  /** Marker to show; its page is opened and "Zoom to comment" centres it. */
  focus?: Marker | null
}) {
  const fileBlob = useStore((s) => s.fileBlob)
  const box = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<string | null>(null)
  const [pdf, setPdf] = useState<PdfDoc | null>(null)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(focus?.page ?? 1)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // load the file
  useEffect(() => {
    let live = true
    let url: string | null = null
    let task: PdfTask | null = null
    setLoading(true); setError(null); setImg(null); setPdf(null)
    ;(async () => {
      try {
        const blob = await fileBlob(file.id)
        if (file.mimeType === 'application/pdf') {
          const pdfjs = await import('pdfjs-dist')
          const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
          pdfjs.GlobalWorkerOptions.workerSrc = worker
          task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }) as unknown as PdfTask
          const doc = (await task.promise) as PdfDoc
          if (!live) return
          setPdf(doc); setPages(doc.numPages)
        } else {
          url = URL.createObjectURL(blob)
          if (live) { setImg(url); setPages(1) }
        }
      } catch (e) {
        if (live) setError(`This drawing could not be displayed: ${errorText(e)}`)
      } finally {
        if (live) setLoading(false)
      }
    })()
    // pdf.js v6 releases a document through its loading task; never let cleanup throw during unmount.
    return () => { live = false; if (url) URL.revokeObjectURL(url); task?.destroy().catch(() => undefined) }
  }, [file.id, file.mimeType, fileBlob])

  // track the available width
  useLayoutEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  // follow the focused comment to its page
  useEffect(() => { if (focus) setPage(Math.min(focus.page, pages)) }, [focus, pages])

  // render the PDF page at the current width x zoom
  useEffect(() => {
    if (!pdf || !canvas.current || !width) return
    let task: { promise: Promise<void>; cancel: () => void } | null = null
    let live = true
    ;(async () => {
      const p = await pdf.getPage(Math.min(page, pdf.numPages))
      if (!live || !canvas.current) return
      const base = p.getViewport({ scale: 1 })
      const cssW = width * zoom
      const ratio = window.devicePixelRatio || 1
      const vp = p.getViewport({ scale: (cssW / base.width) * ratio })
      const c = canvas.current
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height)
      c.style.width = `${cssW}px`; c.style.height = `${vp.height / ratio}px`
      task = p.render({ canvas: c, viewport: vp })
      await task.promise.catch(() => undefined)
    })()
    return () => { live = false; task?.cancel() }
  }, [pdf, page, zoom, width])

  const centreOn = (m: Marker) => {
    requestAnimationFrame(() => {
      const b = box.current, s = sheet.current
      if (!b || !s) return
      b.scrollTo({ left: m.x * s.offsetWidth - b.clientWidth / 2, top: m.y * s.offsetHeight - b.clientHeight / 2, behavior: 'smooth' })
    })
  }
  const zoomToFocus = () => { if (!focus) return; setPage(focus.page); setZoom(2.5); setTimeout(() => centreOn(focus), 250) }

  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (!placing || !onPick || !sheet.current) return
    const r = sheet.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    onPick({ page, x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 })
  }

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="muted small" title={file.name}>{file.name}</span>
        <div className="row" style={{ gap: 4 }}>
          {pages > 1 && <>
            <button type="button" className="iconbtn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
            <span className="small" aria-live="polite">Page {page} of {pages}</span>
            <button type="button" className="iconbtn" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
          </>}
          <button type="button" className="iconbtn" disabled={zoom <= 1} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)] ?? 1)} aria-label="Zoom out"><ZoomOut size={14} /></button>
          <button type="button" className="iconbtn" disabled={zoom >= 4} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)] ?? 4)} aria-label="Zoom in"><ZoomIn size={14} /></button>
          <button type="button" className="btn sm" onClick={() => setZoom(1)}><Maximize2 size={12} /> Full sheet</button>
          {focus && <button type="button" className="btn sm" onClick={zoomToFocus}>Zoom to comment</button>}
        </div>
      </div>
      <div className={`viewer-box ${placing ? 'placing' : ''}`} ref={box}>
        {loading && <div className="empty"><b>Loading drawing…</b></div>}
        {error && <div className="notice err small" style={{ margin: 12 }}>{error}</div>}
        {!loading && !error && (
          <div className="sheet" ref={sheet} style={{ width: width ? width * zoom : '100%' }} onClick={click} role={placing ? 'button' : 'img'} aria-label={placing ? 'Click the drawing to place the comment' : `Drawing ${file.name} with comment pins`}>
            {img ? <img src={img} alt="" draggable={false} style={{ width: '100%', display: 'block' }} /> : <canvas ref={canvas} style={{ display: 'block' }} />}
            {markers.filter((m) => m.page === page).map((m) => (
              <button key={m.id} type="button" className={`pin pin-${m.tone}`} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
                onClick={(e) => { e.stopPropagation(); if (!placing) onSelect?.(m.id) }} aria-label={`Comment ${m.n}`} title={m.id}>{m.n}</button>
            ))}
          </div>
        )}
      </div>
      {placing && <p className="muted small" style={{ margin: '6px 0 0' }}>Click the drawing where the comment applies{pages > 1 ? ' (use the page arrows first)' : ''}.</p>}
    </div>
  )
}
