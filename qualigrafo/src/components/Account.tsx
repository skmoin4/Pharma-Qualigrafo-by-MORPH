import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Circle, KeyRound, Mail, ShieldCheck, X } from 'lucide-react'
import { useStore } from '../store'
import { AuthShell, PasswordField } from './Login'
import type { EmailPref } from '../types'

/** Mirrors the server policy in server/src/lib/security.ts so the user sees problems before submitting. */
function checks(pw: string, email: string) {
  const local = email.split('@')[0].toLowerCase()
  return [
    { ok: pw.length >= 10, text: 'At least 10 characters' },
    { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), text: 'Contains a letter and a number' },
    { ok: !!pw && !pw.toLowerCase().includes(local), text: 'Does not contain your email name' },
  ]
}

export function PasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { changePassword, session, toast } = useStore()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rules = checks(next, session?.email ?? '')
  // ids must stay unique: the same form is used on the forced screen and in the dialog
  const idp = forced ? 'pw-forced' : 'pw-dialog'
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
      <PasswordField id={`${idp}-current`} label={forced ? 'Temporary password' : 'Current password'} value={current} onChange={setCurrent} autoFocus />
      <PasswordField id={`${idp}-next`} label="New password" value={next} onChange={setNext} autoComplete="new-password" />
      <ul className="pwrules">{rules.map((r) => <li key={r.text} className={r.ok ? 'ok' : ''}>{r.ok ? <Check size={12} /> : <Circle size={12} />}{r.text}</li>)}</ul>
      <PasswordField id={`${idp}-confirm`} label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      {confirm && next !== confirm && <div className="muted small" style={{ marginTop: 4, color: 'var(--red)' }}>Passwords do not match.</div>}
      {error && <div className="notice err" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      <button className="btn pri lg" type="submit" disabled={busy || !valid}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  )
}

/** Full-screen step after signing in with a temporary password. */
export function ForcedPasswordChange() {
  const { session, logout } = useStore()
  return (
    <AuthShell>
      <div className="card login">
        <h2>Set a new password</h2>
        <p className="muted small auth-sub">You signed in with a temporary password. Choose your own password to continue as <b>{session?.email}</b>.</p>
        <PasswordForm forced />
        <button className="link small" type="button" style={{ marginTop: 14 }} onClick={logout}>Sign out</button>
      </div>
    </AuthShell>
  )
}

const PREFS: { v: EmailPref; t: string; d: string }[] = [
  { v: 'Immediate', t: 'Immediate', d: 'An e-mail for each item addressed to your role (assignments, signature requests, returns, NCRs, transmittals), plus the daily reminder.' },
  { v: 'Daily digest', t: 'Daily digest', d: 'One e-mail a day with your reminders and the notifications addressed to you since the previous digest.' },
  { v: 'Off', t: 'Off', d: 'No e-mail about project work. You still see everything in the app.' },
]

function PrefList({ pref, setPref }: { pref: EmailPref; setPref: (p: EmailPref) => void }) {
  return (
    <>
      {PREFS.map((p) => (
        <label key={p.v} className="row" style={{ alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line-2)' }}>
          <input type="radio" name="emailPref" value={p.v} checked={pref === p.v} onChange={() => setPref(p.v)} style={{ marginTop: 3 }} />
          <span><b>{p.t}</b><span className="muted small" style={{ display: 'block' }}>{p.d}</span></span>
        </label>
      ))}
      <div className="notice info" style={{ marginTop: 12 }}><ShieldCheck size={13} style={{ verticalAlign: -2 }} /> Security alerts (password changed or reset, account locked, administrator rights) are always e-mailed.</div>
    </>
  )
}

/** The same preference, inline on the profile page. */
export function EmailPrefForm() {
  const { session, setEmailPref, toast } = useStore()
  const [pref, setPref] = useState<EmailPref>(session?.emailPref ?? 'Immediate')
  const [busy, setBusy] = useState(false)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const er = await setEmailPref(pref)
    setBusy(false)
    toast(er ?? 'E-mail preference saved', er ? 'warn' : 'ok')
  }
  return (
    <form onSubmit={save}>
      <p className="muted small" style={{ margin: '0 0 6px' }}>E-mails go to <b>{session?.email}</b>.</p>
      <PrefList pref={pref} setPref={setPref} />
      <button className="btn pri" type="submit" disabled={busy || pref === session?.emailPref} style={{ marginTop: 12 }}>{busy ? 'Saving…' : 'Save preference'}</button>
    </form>
  )
}

/** Own e-mail notification preference, opened from the sidebar. */
export function NotificationDialog({ onClose }: { onClose: () => void }) {
  const { session, setEmailPref, toast } = useStore()
  const [pref, setPref] = useState<EmailPref>(session?.emailPref ?? 'Immediate')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    box.current?.querySelector('input')?.focus()
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const er = await setEmailPref(pref)
    setBusy(false)
    toast(er ?? `E-mail notifications: ${pref}`, er ? 'warn' : 'ok')
    if (!er) onClose()
  }
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card modal" role="dialog" aria-modal="true" aria-label="E-mail notifications" ref={box} onSubmit={save}>
        <div className="row sb"><h2 style={{ margin: 0 }}><Mail size={15} style={{ verticalAlign: -2 }} /> E-mail notifications</h2><button className="iconbtn" type="button" onClick={onClose} aria-label="Close"><X size={14} /></button></div>
        <p className="muted small" style={{ margin: '6px 0 10px' }}>E-mails go to <b>{session?.email}</b>.</p>
        <PrefList pref={pref} setPref={setPref} />
        <button className="btn pri" type="submit" disabled={busy || pref === session?.emailPref} style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
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
