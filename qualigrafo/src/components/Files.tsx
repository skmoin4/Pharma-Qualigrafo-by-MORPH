import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Box, Check, Copy, Download, FileText, Upload, X } from 'lucide-react'
import { hasCurrentSource, sourcePlan, useStore } from '../store'
import type { Doc, FileMeta } from '../types'
import { Badge, R, fmtDate } from './ui'

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`)
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')

function CopyHash({ sha }: { sha: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(sha); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <span className="hash" title={`SHA-256 ${sha}`}>
      SHA-256 {sha.slice(0, 12)}…
      <button type="button" className="iconlink" onClick={copy} aria-label="Copy SHA-256">{done ? <Check size={12} /> : <Copy size={12} />}</button>
    </span>
  )
}

export function FileCard({ file, tag, muted }: { file: FileMeta; tag?: string; muted?: boolean }) {
  const { downloadFile, toast } = useStore()
  const [busy, setBusy] = useState(false)
  const get = async () => {
    setBusy(true)
    const er = await downloadFile(file.id, file.name)
    setBusy(false)
    if (er) toast(er, 'warn')
  }
  return (
    <div className={`filecard ${muted ? 'muted-card' : ''}`}>
      <FileText size={18} className="fc-icon" />
      <div className="fc-main">
        <div className="fc-name">{file.name} {tag && <Badge tone={muted ? '' : 'teal'} dot={false}>{tag}</Badge>}</div>
        <div className="muted small">{fmtBytes(file.size)} · {file.by ?? 'Unknown'} · {fmtDate(file.at)}</div>
        <CopyHash sha={file.sha256} />
      </div>
      <button type="button" className="btn sm" onClick={get} disabled={busy} aria-label={`Download ${file.name}`}><Download size={13} /> {busy ? 'Downloading…' : 'Download'}</button>
    </div>
  )
}

/** Drag-and-drop uploader for one document. Validates type and size before sending; the server re-hashes the bytes. */
export function SourceUploader({ doc, compact }: { doc: Doc; compact?: boolean }) {
  const { uploadSource, toast, uploadPolicy, imports } = useStore()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [sha, setSha] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [over, setOver] = useState(false)
  const [pct, setPct] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const plan = sourcePlan(doc)
  const exts = uploadPolicy?.extensions ?? []
  const dup = sha ? imports.find((i) => i.doc === doc.id && i.checksum === sha) : undefined

  const reset = () => { setFile(null); setSha(null); setLabel(''); setPct(null); setError(null); if (input.current) input.current.value = '' }
  const choose = async (f: File | undefined) => {
    setError(null); setSha(null)
    if (!f) return
    const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf('.')).toLowerCase() : ''
    if (exts.length && !exts.includes(ext)) return setError(`${ext || 'This'} file type is not allowed. Allowed: ${exts.join(', ')}.`)
    if (f.size === 0) return setError('The file is empty.')
    if (uploadPolicy && f.size > uploadPolicy.maxBytes) return setError(`File is ${fmtBytes(f.size)}; the limit is ${fmtBytes(uploadPolicy.maxBytes)}.`)
    setFile(f)
    if (globalThis.crypto?.subtle && f.size <= 200 * 1024 * 1024) setSha(hex(await crypto.subtle.digest('SHA-256', await f.arrayBuffer())))
  }
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void choose(e.dataTransfer.files?.[0]) }
  const send = async () => {
    if (!file) return
    setPct(0); setError(null)
    const er = await uploadSource(doc.id, file, label, setPct)
    if (er) { setPct(null); setError(er); return }
    toast(plan.inPlace ? `File attached to ${doc.id} ${R(plan.toRev)}` : `${doc.id} ${R(plan.toRev)} created as a draft. Fresh approval required.`)
    reset()
  }

  return (
    <div className="uploader">
      {!file ? (
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          role="button" tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <Upload size={18} />
          <div><b>{!plan.inPlace ? `Drop a file for new draft ${R(plan.toRev)}` : hasCurrentSource(doc) ? 'Drop a replacement draft file' : 'Drop a file here'}</b> or <span className="link">choose a file</span></div>
          {!compact && <div className="muted small">{exts.join(' ')}{uploadPolicy ? ` · up to ${fmtBytes(uploadPolicy.maxBytes)}` : ''}</div>}
        </div>
      ) : (
        <div className="filecard selected">
          <FileText size={18} className="fc-icon" />
          <div className="fc-main">
            <div className="fc-name">{file.name}</div>
            <div className="muted small">{fmtBytes(file.size)} · {sha ? <>SHA-256 {sha.slice(0, 12)}… (checked again on the server)</> : 'computing checksum…'}</div>
          </div>
          <button type="button" className="iconbtn" onClick={reset} disabled={pct !== null} aria-label="Remove selected file"><X size={14} /></button>
        </div>
      )}
      <input ref={input} type="file" hidden accept={exts.join(',')} onChange={(e) => void choose(e.target.files?.[0])} aria-label={`Source file for ${doc.id}`} />

      {file && (
        <>
          <label className="lab">Label (optional)</label>
          <input className="input" value={label} maxLength={300} onChange={(e) => setLabel(e.target.value)} placeholder={file.name} />
          <div className={`notice ${plan.cancelsRoute ? '' : 'info'} small`} style={{ marginTop: 10 }}>
            {plan.inPlace
              ? <>Attaches to draft <b>{doc.id} {R(plan.toRev)}</b>{hasCurrentSource(doc) ? ', replacing its current draft file' : ''}. Submit it for review afterwards.</>
              : <>Creates a new draft <b>{R(plan.toRev)}</b>. {R(doc.rev)} ({doc.status}) is kept unchanged.{plan.cancelsRoute && <> Its <b>pending approval route will be cancelled</b>.</>}</>}
          </div>
          {dup && <div className="notice err small" style={{ marginTop: 8 }}>Identical content was already imported for {doc.id} ({dup.id}). Choose a different file.</div>}
          {pct !== null && <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress"><i style={{ width: `${pct}%` }} /><span>{pct < 100 ? `Uploading ${pct}%` : 'Verifying checksum…'}</span></div>}
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn pri" onClick={send} disabled={pct !== null || !!dup}><Upload size={14} /> {plan.inPlace ? `Upload to ${R(plan.toRev)}` : `Upload as draft ${R(plan.toRev)}`}</button>
            <button type="button" className="btn" onClick={reset} disabled={pct !== null}>Cancel</button>
          </div>
        </>
      )}
      {error && <div className="notice err small" role="alert" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}

/** Source section of the document drawer: the current revision's source, earlier files, and the uploader. */
export function SourceSection({ doc }: { doc: Doc }) {
  const { imports, role } = useStore()
  const current = hasCurrentSource(doc)
  const mine = imports.filter((i) => i.doc === doc.id)
  const lastRevit = current && doc.source === 'Revit' ? mine.find((i) => i.mode === 'Revit' && i.checksum === doc.checksum) : undefined
  const earlier = mine.filter((i) => i.file && i.file.id !== (current ? doc.file?.id : undefined))
  const seen = new Set<string>()

  return (
    <>
      {current && doc.file && <FileCard file={doc.file} tag={`Source of ${R(doc.rev)}`} />}
      {lastRevit && (
        <div className="filecard">
          <Box size={18} className="fc-icon" />
          <div className="fc-main"><div className="fc-name">{lastRevit.label} <Badge tone="teal" dot={false}>Revit snapshot · {R(doc.rev)}</Badge></div><div className="muted small">{lastRevit.checksum} · {fmtDate(lastRevit.at)}</div></div>
        </div>
      )}
      {!current && (
        <div className={`notice ${['Missing', 'Draft', 'Changes requested'].includes(doc.status) ? '' : 'info'} small`}>
          No source file for <b>{doc.id} {R(doc.rev)}</b>{doc.status === 'Accepted' || doc.status === 'Under review' ? ' (record created before file upload was available).' : '. It must be attached before the revision can be submitted.'}
        </div>
      )}
      {role === 'Contractor'
        ? <div style={{ marginTop: 10 }}><SourceUploader doc={doc} compact /></div>
        : <p className="muted small" style={{ marginTop: 6 }}>Source files are provided by the responsible contractor ({doc.owner}).</p>}
      {earlier.length > 0 && (
        <details className="earlier">
          <summary>Earlier files ({earlier.length})</summary>
          {earlier.filter((i) => (seen.has(i.file!.id) ? false : (seen.add(i.file!.id), true))).map((i) => <FileCard key={i.id} file={i.file!} tag={`${i.id} · ${R(i.toRev)}`} muted />)}
        </details>
      )}
    </>
  )
}
