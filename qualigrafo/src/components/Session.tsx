// Inactivity timeout (EU GMP Annex 11 §12): after the configured idle time the session locks and the token is
// dropped; the same user continues by entering the password. While the user is active the short-lived token is
// refreshed in the background. Activity in any tab of the same browser counts.
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { api, tokenStore } from '../api'
import { useStore } from '../store'

const ACTIVITY_KEY = 'qualigrafo-activity'
const WARN_MS = 60_000

const readActivity = () => { try { return Number(localStorage.getItem(ACTIVITY_KEY)) || 0 } catch { return 0 } }
const writeActivity = (t: number) => { try { localStorage.setItem(ACTIVITY_KEY, String(t)) } catch { /* storage blocked */ } }
/** Expiry (ms) of the current token, read from its payload; 0 when unknown. */
function tokenExpiry() {
  const t = tokenStore.get()
  if (!t) return 0
  try { return (JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }).exp! * 1000 } catch { return 0 }
}

export function useIdleSession() {
  const { session, locked, idleMinutes, lock } = useStore()
  const [warn, setWarn] = useState(false)
  const last = useRef(Date.now())
  const refreshing = useRef(false)

  useEffect(() => {
    if (!session || locked) return
    const now = Date.now()
    last.current = Math.max(readActivity(), now)
    writeActivity(last.current)
    let lastWrite = 0
    const mark = () => {
      const t = Date.now()
      last.current = t
      setWarn(false)
      if (t - lastWrite > 5_000) { lastWrite = t; writeActivity(t) }
    }
    const events = ['mousedown', 'keydown', 'touchstart', 'wheel', 'mousemove'] as const
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }))
    const tick = window.setInterval(async () => {
      const t = Date.now()
      const lastActive = Math.max(last.current, readActivity())
      const idleMs = idleMinutes * 60_000
      if (t - lastActive >= idleMs) { setWarn(false); lock('idle'); return }
      setWarn(t - lastActive >= idleMs - WARN_MS)
      // active recently and the token runs out within half an idle period -> refresh it
      const exp = tokenExpiry()
      if (!refreshing.current && exp && exp - t < idleMs / 2 && t - lastActive < idleMs / 2) {
        refreshing.current = true
        try { tokenStore.set((await api<{ token: string }>('POST', '/auth/refresh')).token) } catch { /* 401 is handled by the API client */ } finally { refreshing.current = false }
      }
    }, 5_000)
    return () => { events.forEach((e) => window.removeEventListener(e, mark)); window.clearInterval(tick) }
  }, [session, locked, idleMinutes, lock])

  return { warn, stay: () => { last.current = Date.now(); writeActivity(last.current); setWarn(false) } }
}

export function IdleWarning({ onStay }: { onStay: () => void }) {
  return (
    <div className="notice" role="alert" style={{ position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 90, boxShadow: '0 6px 24px rgba(0,0,0,.18)', maxWidth: 'calc(100vw - 32px)' }}>
      <div className="row wrap"><span>For security, your session will lock in about a minute because of inactivity.</span><button className="btn sm pri" onClick={onStay}>Stay signed in</button></div>
    </div>
  )
}

export function LockScreen() {
  const { session, locked, idleMinutes, unlock, logout } = useStore()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    setBusy(true); setError(null)
    const er = await unlock(password)
    setBusy(false)
    if (er) setError(er); else setPassword('')
  }
  if (!session || !locked) return null
  return (
    <div className="lockscreen" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <form className="card login" onSubmit={submit}>
        <div className="row" style={{ gap: 10, marginBottom: 12 }}><div className="logo"><Lock size={16} /></div><h2 id="lock-title" style={{ margin: 0 }}>Session locked</h2></div>
        <p className="muted small" style={{ marginTop: 0 }}>{locked === 'idle' ? `Locked after ${idleMinutes} minutes without activity.` : 'Your session has ended (expired or signed out elsewhere).'} Enter your password to continue where you left off.</p>
        <label className="lab">Signed in as</label>
        <input className="input" value={`${session.name} · ${session.email}`} disabled />
        <label className="lab">Password</label>
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required aria-label="Unlock password" />
        {error && <div className="notice err" role="alert" style={{ marginTop: 12 }}>{error}</div>}
        <button className="btn pri" type="submit" disabled={busy} style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}>{busy ? 'Unlocking…' : 'Unlock'}</button>
        <p className="small" style={{ margin: '12px 0 0' }}>Not {session.name.split(' ')[0]}? <button type="button" className="link small" onClick={logout}>Sign out</button></p>
      </form>
    </div>
  )
}
