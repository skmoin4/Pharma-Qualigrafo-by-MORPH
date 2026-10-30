import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Boxes, Eye, EyeOff, FileCheck2, PenLine, ShieldCheck } from 'lucide-react'
import { useStore } from '../store'

/** What the product does — only what this installation actually provides (see PRODUCTION_PLAN.md). */
const POINTS = [
  { icon: <FileCheck2 size={15} />, title: 'One controlled register', text: 'Requirements, documents and the evidence that satisfies them, per market and discipline.' },
  { icon: <PenLine size={15} />, title: 'Signed decisions', text: 'Two-stage sign-off with the password re-entered, the meaning shown and the file checksum bound to the signature.' },
  { icon: <ShieldCheck size={15} />, title: 'Ready for an audit', text: 'Every change kept with its old and new value, and the handover dossier produced as a PDF record.' },
]

/**
 * Shared frame of the screens shown before the workspace opens (sign-in, forced password change).
 * Left: the product and what it does. Right: the form, on white, where the eye goes first.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <i className="auth-layer l1" aria-hidden="true" />
        <i className="auth-layer l2" aria-hidden="true" />
        <i className="auth-layer l3" aria-hidden="true" />
        <div className="auth-mark">
          <span className="logo"><Boxes size={17} /></span>
          <span><b>Qualigrafo</b><small>Engineering · BIM · evidence</small></span>
        </div>
        <div className="auth-copy">
          <h1>Engineering evidence an inspector can follow.</h1>
          <p>Qualigrafo keeps requirements, documents, evidence and sign-off in one place for a pharma engineering project — from the first drawing to the handover dossier.</p>
          <ul className="auth-points">
            {POINTS.map((p) => (
              <li key={p.title}><span className="auth-ico">{p.icon}</span><span><b>{p.title}</b>{p.text}</span></li>
            ))}
          </ul>
        </div>
        <p className="auth-foot">One installation per customer · access, audit trail and electronic signatures administered by your own quality unit.</p>
      </aside>
      <section className="auth-panel">
        <div className="auth-card">{children}</div>
      </section>
    </div>
  )
}

/** Password field with a show / hide control; the label stays the field's real label. */
export function PasswordField({ id, label, value, onChange, autoComplete = 'current-password', autoFocus }: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoComplete?: string; autoFocus?: boolean
}) {
  const [shown, setShown] = useState(false)
  return (
    <>
      <label className="lab" htmlFor={id}>{label}</label>
      <div className="field">
        <input
          id={id} className="input" type={shown ? 'text' : 'password'} autoComplete={autoComplete} autoFocus={autoFocus}
          value={value} onChange={(e) => onChange(e.target.value)} required
        />
        <button type="button" className="field-btn" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} onClick={() => setShown(!shown)}>
          {shown ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </>
  )
}

export function Login() {
  const login = useStore((s) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    setBusy(true)
    setError(null)
    const err = await login(email, password)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <AuthShell>
      <form className="card login" onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="muted small auth-sub">Use the account your Qualigrafo administrator created for you.</p>
        <label className="lab" htmlFor="login-email">Email</label>
        <input id="login-email" className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
        <PasswordField id="login-password" label="Password" value={password} onChange={setPassword} />
        {error && <div className="notice err" role="alert" style={{ marginTop: 12 }}>{error}</div>}
        <button className="btn pri lg" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small auth-hint">Forgot your password? Ask your Qualigrafo administrator to reset it. You will be asked to set your own password at the next sign-in.</p>
        <p className="auth-legal">Access is personal. Sign-ins, signatures and administration are recorded in the security log of this installation.</p>
      </form>
    </AuthShell>
  )
}

export function Loading({ text }: { text: string }) {
  return <div className="login-wrap"><div className="card login"><div className="empty"><b>{text}</b></div></div></div>
}
