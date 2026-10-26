import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Activity, Check, ClipboardCheck, Copy, DatabaseBackup, KeyRound, Mail, ServerCog, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react'
import { api, errorText } from '../api'
import { useStore } from '../store'
import type { Role } from '../types'
import { Badge, Empty, PageHead, fmtDate } from '../components/ui'
const AdminMail = lazy(() => import('./AdminMail'))
const AdminAccessReview = lazy(() => import('./AdminAccessReview'))
const AdminValidation = lazy(() => import('./AdminValidation'))
const AdminBackups = lazy(() => import('./AdminBackups'))
const AdminMonitoring = lazy(() => import('./AdminMonitoring'))

interface AdminMembership { project: string; projectName: string; role: Role; scope: string | null }
interface AdminUser {
  id: string; email: string; name: string; company: string | null; isAdmin: boolean; active: boolean; mustChangePassword: boolean
  lastLoginAt: string | null; createdAt: string; memberships: AdminMembership[]
}
interface SecEvent { id: string; at: string; type: string; email: string | null; actor: string | null; ip: string | null; detail: string }
const ROLES: Role[] = ['Consultant', 'Contractor', 'Owner / QA']
const NONE = 'No access'

function Secret({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* clipboard blocked */ } }
  return (
    <div className="notice info" style={{ marginTop: 12 }}>
      <b>{label}</b>
      <div className="secret" style={{ margin: '8px 0' }}><span style={{ flex: 1 }}>{value}</span><button type="button" className="btn sm" onClick={copy}>{done ? <Check size={12} /> : <Copy size={12} />} {done ? 'Copied' : 'Copy'}</button></div>
      <span className="small">Shown only once. Share it securely; the user must set their own password at first sign-in.</span>
    </div>
  )
}

/** One project row of the access editor: role + optional company scope, saved explicitly. */
interface ProjectMeta { code: string; name: string; companies: string[] }

function AccessRow({ user, project, onSaved }: { user: AdminUser; project: ProjectMeta; onSaved: (u: AdminUser) => void }) {
  const toast = useStore((s) => s.toast)
  const m = user.memberships.find((x) => x.project === project.code)
  const [role, setRole] = useState<string>(m?.role ?? NONE)
  const [scope, setScope] = useState<string>(m?.scope ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setRole(m?.role ?? NONE); setScope(m?.scope ?? '') }, [m?.role, m?.scope])
  const dirty = role !== (m?.role ?? NONE) || (role === 'Contractor' ? scope : '') !== (m?.scope ?? '')
  const save = async () => {
    setBusy(true)
    try {
      const path = `/admin/users/${user.id}/memberships/${encodeURIComponent(project.code)}`
      const r = role === NONE
        ? await api<{ user: AdminUser }>('DELETE', path)
        : await api<{ user: AdminUser }>('PUT', path, { role, scope: role === 'Contractor' && scope ? scope : null })
      onSaved(r.user)
      toast(role === NONE ? `Access to ${project.code} removed` : `${project.code}: ${role}${role === 'Contractor' && scope ? ` limited to ${scope}` : ''}`)
    } catch (e) {
      toast(errorText(e), 'warn')
    } finally {
      setBusy(false)
    }
  }
  return (
    <tr>
      <td style={{ minWidth: 120 }}><b>{project.code}</b><small>{project.name}</small></td>
      <td style={{ minWidth: 140 }}><select className="input" value={role} onChange={(e) => setRole(e.target.value)} aria-label={`Role on ${project.code}`}><option>{NONE}</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
      <td style={{ minWidth: 150 }}>
        <select className="input" value={role === 'Contractor' ? scope : ''} disabled={role !== 'Contractor'} onChange={(e) => setScope(e.target.value)} aria-label={`Record scope on ${project.code}`}>
          <option value="">Whole project</option>
          {project.companies.map((c) => <option key={c} value={c}>Only {c}</option>)}
        </select>
      </td>
      <td style={{ textAlign: 'right' }}><button type="button" className="btn sm pri" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></td>
    </tr>
  )
}

function UserPanel({ user, me, projects, onChange, secret }: { user: AdminUser; me: string; projects: ProjectMeta[]; onChange: (u: AdminUser, secret?: string) => void; secret?: string }) {
  const toast = useStore((s) => s.toast)
  const [name, setName] = useState(user.name)
  const [company, setCompany] = useState(user.company ?? '')
  const [isAdmin, setIsAdmin] = useState(user.isAdmin)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setName(user.name); setCompany(user.company ?? ''); setIsAdmin(user.isAdmin) }, [user])
  const self = user.id === me
  const dirty = name !== user.name || company !== (user.company ?? '') || isAdmin !== user.isAdmin

  const call = async (fn: () => Promise<{ user: AdminUser; tempPassword?: string }>, ok: string) => {
    setBusy(true)
    try { const r = await fn(); onChange(r.user, r.tempPassword); toast(ok) } catch (e) { toast(errorText(e), 'warn') } finally { setBusy(false) }
  }
  const patch = (body: object, ok: string) => call(() => api('PATCH', `/admin/users/${user.id}`, body), ok)

  return (
    <section className="card">
      <div className="row sb" style={{ alignItems: 'flex-start' }}>
        <div><h2 style={{ margin: 0 }}>{user.name}</h2><div className="muted small">{user.email}</div></div>
        <div className="chips">
          {user.isAdmin && <Badge tone="violet">Administrator</Badge>}
          {!user.active && <Badge tone="red">Disabled</Badge>}
          {user.mustChangePassword && <Badge tone="amber">Must set password</Badge>}
        </div>
      </div>
      {secret && <Secret value={secret} label={`Temporary password for ${user.email}`} />}

      <h3>Profile</h3>
      <div className="grid g2">
        <div><label className="lab" style={{ marginTop: 0 }}>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="lab" style={{ marginTop: 0 }}>Company</label><input className="input" list="admin-companies" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" /></div>
      </div>
      <label className="row" style={{ marginTop: 10 }}><input type="checkbox" checked={isAdmin} disabled={self} onChange={(e) => setIsAdmin(e.target.checked)} /><span className="small">Administrator (manages users and access){self ? ' — you cannot remove your own rights' : ''}</span></label>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <button type="button" className="btn pri" disabled={!dirty || busy} onClick={() => patch({ name, company: company || null, isAdmin }, 'Profile saved')}>Save profile</button>
      </div>

      <h3>Sign-in</h3>
      <div className="muted small" style={{ marginBottom: 8 }}>Last sign-in: {user.lastLoginAt ? fmtDate(user.lastLoginAt) : 'never'} · created {fmtDate(user.createdAt)}</div>
      <div className="row wrap">
        <button type="button" className="btn" disabled={busy} onClick={() => { if (confirm(`Reset the password of ${user.email}? Their current sessions are signed out.`)) void call(() => api('POST', `/admin/users/${user.id}/reset-password`, {}), 'Temporary password issued') }}><KeyRound size={13} /> Reset password</button>
        {user.active
          ? <button type="button" className="btn danger" disabled={busy || self} onClick={() => { if (confirm(`Disable ${user.email}? They are signed out immediately.`)) void patch({ active: false }, 'Account disabled') }}>Disable account</button>
          : <button type="button" className="btn" disabled={busy} onClick={() => patch({ active: true }, 'Account enabled')}>Enable account</button>}
      </div>

      <h3>Project access</h3>
      <p className="muted small" style={{ marginTop: 0 }}>The role decides what the user may do. A Contractor can be limited to one company: they then see only that company's documents, files, comments and NCRs.</p>
      <div className="tablewrap"><table>
        <thead><tr><th>Project</th><th>Role</th><th>Records</th><th /></tr></thead>
        <tbody>{projects.map((p) => <AccessRow key={p.code} user={user} project={p} onSaved={(u) => onChange(u)} />)}</tbody>
      </table></div>
    </section>
  )
}

function NewUser({ onCreated, onCancel }: { onCreated: (u: AdminUser, secret: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: '', email: '', company: '', isAdmin: false })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      const r = await api<{ user: AdminUser; tempPassword: string }>('POST', '/admin/users', { ...f, company: f.company || null })
      onCreated(r.user, r.tempPassword)
    } catch (er) { setError(errorText(er)) } finally { setBusy(false) }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2 style={{ margin: 0 }}><UserPlus size={15} style={{ verticalAlign: -2 }} /> New user</h2>
      <label className="lab">Full name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} />
      <label className="lab">Email</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
      <label className="lab">Company</label><input className="input" list="admin-companies" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Optional" />
      <label className="row" style={{ marginTop: 10 }}><input type="checkbox" checked={f.isAdmin} onChange={(e) => setF({ ...f, isAdmin: e.target.checked })} /><span className="small">Administrator</span></label>
      <p className="muted small">A temporary password is generated. Project access is granted in the next step.</p>
      {error && <div className="notice err" role="alert">{error}</div>}
      <div className="row" style={{ marginTop: 10 }}><button className="btn pri" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button><button className="btn" type="button" onClick={onCancel}>Cancel</button></div>
    </form>
  )
}

function SecurityLog() {
  const [rows, setRows] = useState<SecEvent[] | null>(null)
  const [type, setType] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setRows((await api<{ events: SecEvent[] }>('GET', '/admin/security-events?limit=300')).events); setError(null) } catch (e) { setError(errorText(e)) }
  }, [])
  useEffect(() => { void load() }, [load])
  const types = useMemo(() => [...new Set((rows ?? []).map((r) => r.type))].sort(), [rows])
  const shown = (rows ?? []).filter((r) => type === 'all' || r.type === type)
  const tone = (t: string) => (t === 'login.success' ? 'green' : t.startsWith('login.') ? 'red' : t.startsWith('password') ? 'amber' : 'blue')
  return (
    <>
      <div className="filters">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Event type"><option value="all">All events</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
        <button className="btn" type="button" onClick={load}><RefreshCw size={13} /> Refresh</button>
        <span className="muted small">{shown.length} events · newest first · append-only</span>
      </div>
      {error && <div className="notice err">{error}</div>}
      <div className="tablewrap"><table>
        <thead><tr><th>Time</th><th>Event</th><th>Account</th><th>By</th><th>Detail</th><th>IP</th></tr></thead>
        <tbody>
          {shown.map((e) => <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.at)}</td><td><Badge tone={tone(e.type)} dot={false}>{e.type}</Badge></td><td>{e.email ?? '—'}</td><td>{e.actor ?? '—'}</td><td>{e.detail || '—'}</td><td className="muted">{e.ip ?? '—'}</td></tr>)}
          {rows && !shown.length && <tr><td colSpan={6}><Empty title="No events" /></td></tr>}
        </tbody>
      </table></div>
    </>
  )
}

export default function Admin() {
  const { session, toast } = useStore()
  const [tab, setTab] = useState<'users' | 'review' | 'log' | 'mail' | 'system' | 'backups' | 'monitoring'>('users')
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [meta, setMeta] = useState<{ projects: ProjectMeta[]; companies: string[] }>({ projects: [], companies: [] })
  const [sel, setSel] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    try {
      const [u, m] = await Promise.all([api<{ users: AdminUser[] }>('GET', '/admin/users'), api<{ projects: ProjectMeta[]; companies: string[] }>('GET', '/admin/projects')])
      setUsers(u.users); setMeta(m)
    } catch (e) { toast(errorText(e), 'warn') }
  }, [toast])
  useEffect(() => { if (session?.isAdmin) void load() }, [load, session?.isAdmin])

  if (!session?.isAdmin) return <Empty title="Administrator access required" />
  const upsert = (u: AdminUser, temp?: string) => {
    setUsers((list) => (list ?? []).some((x) => x.id === u.id) ? (list ?? []).map((x) => (x.id === u.id ? u : x)) : [...(list ?? []), u])
    if (temp) setSecret({ id: u.id, value: temp })
  }
  const list = (users ?? []).filter((u) => `${u.name} ${u.email} ${u.company ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const selected = users?.find((u) => u.id === sel) ?? null

  return (
    <>
      <PageHead
        title="Users & access"
        sub="Accounts, project roles and vendor scopes, the periodic access review, e-mail delivery and the daily reminders, installation check, validation packs, backups and monitoring. Every change is recorded in the security log; membership changes also appear in the project's audit trail."
        actions={<>
          <div className="seg"><button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>Users</button><button className={tab === 'review' ? 'on' : ''} onClick={() => setTab('review')}><ClipboardCheck size={13} /> Access review</button><button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}><ShieldCheck size={13} /> Security log</button><button className={tab === 'mail' ? 'on' : ''} onClick={() => setTab('mail')}><Mail size={13} /> E-mail &amp; reminders</button><button className={tab === 'system' ? 'on' : ''} onClick={() => setTab('system')}><ServerCog size={13} /> System &amp; validation</button><button className={tab === 'backups' ? 'on' : ''} onClick={() => setTab('backups')}><DatabaseBackup size={13} /> Backups</button><button className={tab === 'monitoring' ? 'on' : ''} onClick={() => setTab('monitoring')}><Activity size={13} /> Monitoring</button></div>
          {tab === 'users' && <button className="btn pri" onClick={() => { setCreating(true); setSel(null) }}><UserPlus size={14} /> New user</button>}
        </>}
      />
      {tab === 'monitoring' ? <Suspense fallback={<Empty title="Loading…" />}><AdminMonitoring /></Suspense> : tab === 'backups' ? <Suspense fallback={<Empty title="Loading…" />}><AdminBackups /></Suspense> : tab === 'system' ? <Suspense fallback={<Empty title="Loading…" />}><AdminValidation /></Suspense> : tab === 'review' ? <Suspense fallback={<Empty title="Loading…" />}><AdminAccessReview /></Suspense> : tab === 'mail' ? <Suspense fallback={<Empty title="Loading…" />}><AdminMail /></Suspense> : tab === 'log' ? <SecurityLog /> : (
        <div className="admin-grid">
          <section className="card flush">
            <div style={{ padding: 12 }}><input className="input" placeholder="Search name, email or company…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" /></div>
            <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}><table>
              <thead><tr><th>User</th><th>Projects</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className={u.id === sel ? 'sel' : ''}>
                    <td><button className="link" onClick={() => { setSel(u.id); setCreating(false) }}>{u.name}</button><small>{u.email}{u.company ? ` · ${u.company}` : ''}</small></td>
                    <td><div className="chips">{u.memberships.map((m) => <Badge key={m.project} tone={m.scope ? 'amber' : 'blue'} dot={false}>{m.project} · {m.role}{m.scope ? ` (${m.scope})` : ''}</Badge>)}{!u.memberships.length && <span className="muted small">No access</span>}</div></td>
                    <td><div className="chips">{u.isAdmin && <Badge tone="violet" dot={false}>Admin</Badge>}{u.active ? <Badge tone="green" dot={false}>Active</Badge> : <Badge tone="red" dot={false}>Disabled</Badge>}</div></td>
                  </tr>
                ))}
                {users && !list.length && <tr><td colSpan={3}><Empty title="No users match" /></td></tr>}
                {!users && <tr><td colSpan={3}><Empty title="Loading users…" /></td></tr>}
              </tbody>
            </table></div>
          </section>
          <div>
            <datalist id="admin-companies">{meta.companies.map((c) => <option key={c} value={c} />)}</datalist>
            {creating
              ? <NewUser onCancel={() => setCreating(false)} onCreated={(u, temp) => { upsert(u, temp); setCreating(false); setSel(u.id); toast(`${u.email} created`) }} />
              : selected
                ? <UserPanel user={selected} me={session.id} projects={meta.projects} secret={secret?.id === selected.id ? secret.value : undefined} onChange={upsert} />
                : <section className="card"><Empty title="Select a user">Pick a user to manage their profile, sign-in and project access, or create a new user.</Empty></section>}
          </div>
        </div>
      )}
    </>
  )
}
