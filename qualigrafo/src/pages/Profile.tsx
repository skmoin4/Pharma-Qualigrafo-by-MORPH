// My profile: what this account is, where it has access, and the two things a person may change themselves
// (password and e-mail notifications). Name, company and project roles stay with the administrator — in a GxP
// installation the account record is controlled, and every change to it belongs in the security log.
import { useCallback, useEffect, useState } from 'react'
import { Clock, History, KeyRound, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { useStore } from '../store'
import { PasswordForm, EmailPrefForm } from '../components/Account'
import { Badge, Empty, PageHead, fmtDate } from '../components/ui'
import type { ActivityItem } from '../types'

const roleTone = (r: string) => (r === 'Owner / QA' ? 'blue' : r === 'Consultant' ? 'violet' : '')

export default function Profile() {
  const { session, account, myRoles, loadProfile, myActivity, signOutEverywhere, logout, toast } = useStore()
  const [items, setItems] = useState<ActivityItem[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      await loadProfile()
      setItems(await myActivity(25))
    } catch { /* the API client reports and the session handler takes over */ }
  }, [loadProfile, myActivity])
  useEffect(() => { void load() }, [load])

  if (!session) return <Empty title="Not signed in" />

  const revoke = async () => {
    if (!confirm('Sign out of every device, including this one? You will have to sign in again with your password.')) return
    setBusy(true)
    const er = await signOutEverywhere()
    setBusy(false)
    if (er) return toast(er, 'warn')
    toast('All sessions signed out')
    logout()
    window.location.hash = '#/'
  }

  return (
    <>
      <PageHead
        title="My profile"
        sub="Your account, where you have access and what you may change yourself. Name, company and project roles are maintained by an administrator; every change to an account is recorded in the security log."
      />

      <div className="grid g2">
        {/* ---------- 1. identity ---------- */}
        <section className="card">
          <h2 style={{ marginTop: 0, justifyContent: 'flex-start', gap: 6 }}><UserRound size={15} /> Account</h2>
          <div className="row" style={{ gap: 12, margin: '4px 0 12px' }}>
            <span className="avatar lg">{session.name[0]}</span>
            <div>
              <b style={{ fontSize: 15 }}>{session.name}</b>
              <div className="muted small">{session.email}{session.company ? ` · ${session.company}` : ''}</div>
            </div>
            {session.isAdmin && <Badge tone="violet" dot={false}>Administrator</Badge>}
          </div>
          <div className="kv">
            <div><small>Account created</small>{account ? fmtDate(account.createdAt) : '—'}</div>
            <div><small>Last sign-in</small>{account?.lastLoginAt ? fmtDate(account.lastLoginAt) : 'This session'}</div>
            <div><small>Password last changed</small>{account?.passwordChangedAt ? fmtDate(account.passwordChangedAt) : 'Never changed'}</div>
            <div><small>Projects</small>{myRoles.length} with a role</div>
          </div>
          <p className="muted small" style={{ margin: '10px 0 0' }}>Your name, company and administrator rights are maintained under <b>Users &amp; access</b>. Ask an administrator if something here is wrong.</p>
        </section>

        {/* ---------- 3. security ---------- */}
        <section className="card">
          <h2 style={{ marginTop: 0, justifyContent: 'flex-start', gap: 6 }}><ShieldCheck size={15} /> Security</h2>
          <div className="kv">
            <div><small>Inactivity lock</small>{account ? `${account.idleMinutes} minutes` : '—'}</div>
            <div><small>Maximum session</small>{account ? `${account.sessionMaxHours} hours` : '—'}</div>
          </div>
          <h3 style={{ margin: '16px 0 0', fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}><KeyRound size={12} style={{ verticalAlign: -2 }} /> Change password</h3>
          <PasswordForm onDone={() => void load()} />
          <h3 style={{ margin: '18px 0 6px', fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}><LogOut size={12} style={{ verticalAlign: -2 }} /> Other devices</h3>
          <p className="muted small" style={{ margin: 0 }}>Ends every session of your account, including this one. Use it if you left a session open somewhere or lost a device.</p>
          <button className="btn danger" type="button" style={{ marginTop: 8 }} disabled={busy} onClick={() => void revoke()}>{busy ? 'Signing out…' : 'Sign out of all devices'}</button>
        </section>
      </div>

      {/* ---------- 2. my access ---------- */}
      <section className="card flush mt">
        <h2>My access <span className="muted small" style={{ fontWeight: 400 }}>role per project, set by an administrator</span></h2>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th>Project</th><th>Role</th><th>Record access</th></tr></thead>
          <tbody>
            {myRoles.map((m) => (
              <tr key={m.project}>
                <td>{m.name}<small>{m.project}</small></td>
                <td><Badge tone={roleTone(m.role)} dot={false}>{m.role}</Badge></td>
                <td>{m.scope ? <>Limited to <b>{m.scope}</b><small>Other companies' records are not visible to you</small></> : <span className="muted">Whole project</span>}</td>
              </tr>
            ))}
            {!myRoles.length && <tr><td colSpan={3}><Empty title="No project access yet">An administrator adds you to a project under Users &amp; access.</Empty></td></tr>}
          </tbody>
        </table></div>
      </section>

      {/* ---------- 4. notifications ---------- */}
      <section className="card mt">
        <h2 style={{ marginTop: 0, justifyContent: 'flex-start', gap: 6 }}><Mail size={15} /> E-mail notifications</h2>
        <EmailPrefForm />
      </section>

      {/* ---------- 5. my recent activity ---------- */}
      <section className="card flush mt">
        <h2><span className="row" style={{ gap: 6 }}><History size={15} /> My recent activity</span> <span className="muted small" style={{ fontWeight: 400 }}>sign-ins, signatures and the records I changed</span></h2>
        <div className="tablewrap" style={{ border: 0 }}><table>
          <thead><tr><th style={{ width: 150 }}>When</th><th style={{ width: 92 }}>Where</th><th>What</th></tr></thead>
          <tbody>
            {(items ?? []).map((a, i) => (
              <tr key={`${a.at}-${i}`}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.at)}<small><Clock size={10} style={{ verticalAlign: -1 }} /> {a.ip ? `from ${a.ip}` : a.project ?? ''}</small></td>
                <td><Badge tone={a.kind === 'Account' ? '' : 'blue'} dot={false}>{a.kind === 'Account' ? 'Account' : a.project}</Badge></td>
                <td>{a.kind === 'Account' ? <>{a.what}{a.detail ? <small>{a.detail}</small> : null}</> : a.detail}</td>
              </tr>
            ))}
            {items && !items.length && <tr><td colSpan={3}><Empty title="Nothing recorded yet" /></td></tr>}
            {!items && <tr><td colSpan={3}><Empty title="Loading…" /></td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  )
}
