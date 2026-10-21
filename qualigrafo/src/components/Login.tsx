import { useState } from 'react'
import type { FormEvent } from 'react'
import { Boxes } from 'lucide-react'
import { useStore } from '../store'

export function Login() {
  const login = useStore((s) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signIn = async () => {
    setBusy(true)
    setError(null)
    const err = await login(email, password)
    setBusy(false)
    if (err) setError(err)
  }
  const submit = (ev: FormEvent) => { ev.preventDefault(); void signIn() }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <div className="row" style={{ gap: 10, marginBottom: 14 }}>
          <div className="logo"><Boxes size={16} /></div>
          <div><b style={{ fontSize: 15 }}>Qualigrafo</b><div className="muted small">Pharma engineering evidence</div></div>
        </div>
        <h2 style={{ margin: '0 0 4px' }}>Sign in</h2>
        <label className="lab">Email</label>
        <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="lab">Password</label>
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="notice err" role="alert" style={{ marginTop: 12 }}>{error}</div>}
        <button className="btn pri" type="submit" disabled={busy} style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small" style={{ margin: '12px 0 0' }}>Forgot your password? Ask your Qualigrafo administrator to reset it.</p>
      </form>
    </div>
  )
}

export function Loading({ text }: { text: string }) {
  return <div className="login-wrap"><div className="card login"><div className="empty"><b>{text}</b></div></div></div>
}
