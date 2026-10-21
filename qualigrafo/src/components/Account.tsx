import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Boxes, Check, Circle, KeyRound, X } from 'lucide-react'
import { useStore } from '../store'

/** Mirrors the server policy in server/src/lib/security.ts so the user sees problems before submitting. */
function checks(pw: string, email: string) {
  const local = email.split('@')[0].toLowerCase()
  return [
    { ok: pw.length >= 10, text: 'At least 10 characters' },
    { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), text: 'Contains a letter and a number' },
    { ok: !!pw && !pw.toLowerCase().includes(local), text: 'Does not contain your email name' },
  ]
}

function PasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { changePassword, session, toast } = useStore()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rules = checks(next, session?.email ?? '')
  const valid = rules.every((r) => r.ok) && next === confirm && !!current

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return setError('The new passwords do not match.')
    setBusy(true); setError(null)
    const er = await changePassword(current, next)
    setBusy(false)
    if (er) return setError(er)
    toast('Password changed. Other sessions were signed out.')
    onDone?.()
  }

  return (
    <form onSubmit={submit}>
      <label className="lab">{forced ? 'Temporary password' : 'Current password'}</label>
      <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <label className="lab">New password</label>
      <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      <ul className="pwrules">{rules.map((r) => <li key={r.text} className={r.ok ? 'ok' : ''}>{r.ok ? <Check size={12} /> : <Circle size={12} />}{r.text}</li>)}</ul>
      <label className="lab">Confirm new password</label>
      <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      {confirm && next !== confirm && <div className="muted small" style={{ marginTop: 4, color: 'var(--red)' }}>Passwords do not match.</div>}
      {error && <div className="notice err" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      <button className="btn pri" type="submit" disabled={busy || !valid} style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  )
}

/** Full-screen step after signing in with a temporary password. */
export function ForcedPasswordChange() {
  const { session, logout } = useStore()
  return (
    <div className="login-wrap">
      <div className="card login">
        <div className="row" style={{ gap: 10, marginBottom: 14 }}>
          <div className="logo"><Boxes size={16} /></div>
          <div><b style={{ fontSize: 15 }}>Qualigrafo</b><div className="muted small">{session?.email}</div></div>
        </div>
        <h2 style={{ margin: '0 0 4px' }}>Set a new password</h2>
        <p className="muted small" style={{ margin: 0 }}>You signed in with a temporary password. Choose your own password to continue.</p>
        <PasswordForm forced />
        <button className="link small" type="button" style={{ marginTop: 12 }} onClick={logout}>Sign out</button>
      </div>
    </div>
  )
}

/** Dialog opened from the sidebar. */
export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    box.current?.querySelector('input')?.focus()
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Change password" ref={box}>
        <div className="row sb"><h2 style={{ margin: 0 }}><KeyRound size={15} style={{ verticalAlign: -2 }} /> Change password</h2><button className="iconbtn" type="button" onClick={onClose} aria-label="Close"><X size={14} /></button></div>
        <p className="muted small" style={{ margin: '6px 0 0' }}>All your other sessions are signed out after the change.</p>
        <PasswordForm onDone={onClose} />
      </div>
    </div>
  )
}
