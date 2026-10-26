import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { ChevronUp, Lock, LogOut, Mail, UserRound, Activity as ActivityIcon, Archive, Send, Bell as BellIcon, BellRing, Boxes, Briefcase, CalendarRange, ChevronRight, CircleHelp, ClipboardCheck, ClipboardList, FilePlus2, FileText, FileUp, GitBranch, History, Inbox, LayoutDashboard, ListChecks, Menu, MessageSquare, Network, PackageCheck, PenLine, Radar, ScanSearch, Search, Settings2, TriangleAlert, Users, Flame, ShieldAlert, Store, Swords, UserCog, Building2, BookOpen } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { coverage, useProjectList, useStore, VENDOR_PAGES } from './store'
import { Loading, Login } from './components/Login'
import { IdleWarning, LockScreen, useIdleSession } from './components/Session'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ForcedPasswordChange, NotificationDialog, PasswordDialog } from './components/Account'
// Rarely used screens load on demand to keep the main bundle small.
const Admin = lazy(() => import('./pages/Admin'))
const NewProject = lazy(() => import('./pages/NewProject'))
const Profile = lazy(() => import('./pages/Profile'))
import { Toast } from './components/Toast'
import { DocDrawer, ReqDrawer } from './components/Drawers'
import { Palette } from './components/Palette'
import { fmtDate, go, home, openProjectRoute, useRoute, useUI } from './components/ui'
import type { HomeKey, PageKey } from './components/ui'
import Portfolio, { MyWork, Watch, useAll } from './pages/Portfolio'
import Overview from './pages/Overview'
import Setup from './pages/Setup'
const Registers = lazy(() => import('./pages/Registers'))
const Library = lazy(() => import('./pages/Library'))
const Transmittals = lazy(() => import('./pages/Transmittals'))
import Requirements from './pages/Requirements'
import { EvidenceMap, Inspector } from './pages/Evidence'
import { Documents, Reviews } from './pages/Documents'
import Comments from './pages/Comments'
import { Changes, Findings, Inspections, Rfis } from './pages/Site'
import { Actions, Handover, Packages, Updates } from './pages/Delivery'
import { Activity, Sources } from './pages/Workflow'
import { Audit, Schedule, Team, Templates } from './pages/Project2'
import { Ncrs, Risks } from './pages/Quality'
import { Rehearsal, Vendor } from './pages/Vendor'

const LABEL: Record<PageKey, string> = {
  overview: 'Overview', setup: 'Setup & baseline', registers: 'Companies & systems', schedule: 'Schedule', requirements: 'Requirements', evidence: 'Evidence map', inspector: 'Inspector view',
  updates: 'Regulatory changes', actions: 'Corrective actions', documents: 'Document register', sources: 'Source files', reviews: 'Reviews & approvals',
  activity: 'Updates & automation', comments: 'Technical comments', rfis: 'RFIs', inspections: 'Inspections', findings: 'Consistency findings', changes: 'Change impact',
  handover: 'Handover readiness', packages: 'Audit packages', transmittals: 'Transmittals', audit: 'Audit trail', templates: 'Templates & vendors', team: 'Team & responsibilities',
  risks: 'Risk register', ncrs: 'Non-conformances', vendor: 'Vendor portal view', rehearsal: 'Audit rehearsal',
}
const ICON: Record<PageKey, ReactNode> = {
  overview: <LayoutDashboard size={15} />, setup: <Settings2 size={15} />, registers: <Building2 size={15} />, schedule: <CalendarRange size={15} />, requirements: <ListChecks size={15} />, evidence: <Network size={15} />,
  inspector: <ScanSearch size={15} />, updates: <BellRing size={15} />, actions: <ClipboardCheck size={15} />, documents: <FileText size={15} />, sources: <FileUp size={15} />,
  reviews: <PenLine size={15} />, activity: <ActivityIcon size={15} />, comments: <MessageSquare size={15} />, rfis: <CircleHelp size={15} />, inspections: <ClipboardList size={15} />,
  findings: <TriangleAlert size={15} />, changes: <GitBranch size={15} />, handover: <PackageCheck size={15} />, packages: <Archive size={15} />, transmittals: <Send size={15} />, audit: <History size={15} />,
  templates: <FilePlus2 size={15} />, team: <Users size={15} />,
  risks: <Flame size={15} />, ncrs: <ShieldAlert size={15} />, vendor: <Store size={15} />, rehearsal: <Swords size={15} />,
}
const GROUPS: { title: string; keys: PageKey[] }[] = [
  { title: 'Project', keys: ['overview', 'setup', 'registers', 'schedule', 'team'] },
  { title: 'Compliance & evidence', keys: ['requirements', 'evidence', 'inspector', 'rehearsal', 'updates', 'actions'] },
  { title: 'Documents', keys: ['documents', 'sources', 'vendor', 'reviews', 'transmittals', 'activity', 'comments', 'templates'] },
  { title: 'Site & change', keys: ['rfis', 'inspections', 'ncrs', 'findings', 'risks', 'changes'] },
  { title: 'Handover', keys: ['handover', 'packages', 'audit'] },
]
const PAGES: Record<PageKey, ComponentType> = {
  overview: Overview, setup: Setup, registers: Registers, schedule: Schedule, team: Team, requirements: Requirements, evidence: EvidenceMap, inspector: Inspector, updates: Updates, actions: Actions,
  documents: Documents, sources: Sources, reviews: Reviews, activity: Activity, comments: Comments, templates: Templates, rfis: Rfis, inspections: Inspections, findings: Findings,
  changes: Changes, handover: Handover, packages: Packages, transmittals: Transmittals, audit: Audit,
  risks: Risks, ncrs: Ncrs, vendor: Vendor, rehearsal: Rehearsal,
}
const HOME_LABEL: Record<HomeKey, string> = { portfolio: 'Portfolio', work: 'My work', watch: 'Regulatory watch', admin: 'Users & access', new: 'New project', library: 'Requirement library', profile: 'My profile' }

function Notifications() {
  const { events, role, markAllRead } = useStore()
  const [open, setOpen] = useState(false)
  const mine = events.filter((e) => !e.forRole || e.forRole === role)
  const unread = mine.filter((e) => !e.read).length
  return (
    <div style={{ position: 'relative' }}>
      <button className="iconbtn" aria-label={`Notifications, ${unread} unread`} onClick={() => setOpen(!open)}><BellIcon size={16} />{unread > 0 && <span className="dotc">{unread}</span>}</button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div className="pop" role="dialog" aria-label="Notifications">
            <div className="row sb" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}><b>Updates for {role}</b><button className="link small" onClick={markAllRead}>Mark all read</button></div>
            {mine.slice(0, 6).map((e) => <div key={e.id} className="pitem" style={e.read ? undefined : { background: 'rgba(37, 99, 235, 0.06)' }}><div className="small">{e.text}</div><div className="muted small">{e.category} · {fmtDate(e.at)}</div></div>)}
            {!mine.length && <div className="empty">No updates</div>}
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--line)' }}><button className="link small" onClick={() => { setOpen(false); go('activity') }}>Open updates &amp; automation →</button></div>
          </div>
        </>
      )}
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const { drawer, menu, setMenu, setPalette } = useUI()
  const { role, current, openProject, profile: loadedProfile, docs, reqs, markets, updates, rfis, revitMode, events, ncrs, risks, session, status, loadError, restore, refresh, loadAll, logout, scope, projectLoading, summaries } = useStore()
  // While the opened project loads, the sidebar and breadcrumb show its portfolio summary.
  const profile = projectLoading ? summaries.find((p) => p.profile.id === current)?.profile ?? loadedProfile : loadedProfile
  const [pwOpen, setPwOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(true)
  // Stable callback: the dialog's Escape listener must not be re-registered on every App render.
  const closePw = useCallback(() => setPwOpen(false), [])
  const [mailOpen, setMailOpen] = useState(false)
  const closeMail = useCallback(() => setMailOpen(false), [])
  const all = useAll()
  const projectList = useProjectList()
  const idle = useIdleSession()

  useEffect(() => { void restore() }, [restore])
  // Other people change the same project; pull a fresh copy whenever the tab regains focus.
  useEffect(() => {
    const f = () => { if (useStore.getState().current) void refresh(); else void loadAll() }
    window.addEventListener('focus', f)
    return () => window.removeEventListener('focus', f)
  }, [refresh, loadAll])

  useEffect(() => { if (status === 'ready' && route.project !== current) openProject(route.project) }, [route.project, current, openProject, status])
  // Back on a workspace page: fetch fresh portfolio summaries (work done inside a project changes the figures).
  const atHome = route.project === null
  useEffect(() => { if (atHome && status === 'ready') void loadAll() }, [atHome, route.home]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUI.getState().close()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); useUI.getState().setPalette(!useUI.getState().palette) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [route.page, route.project, route.home])
  // Associate every form label (label.lab) with the control that follows it, so labels are clickable and announced by screen readers.
  useEffect(() => {
    let n = 0
    const link = () => document.querySelectorAll<HTMLLabelElement>('label.lab').forEach((l) => {
      if (l.control) return
      const nx = l.nextElementSibling
      const c = nx && (nx.matches('input,select,textarea') ? nx : nx.querySelector('input,select,textarea'))
      if (c) { if (!c.id) c.id = `fld-${++n}-${Math.random().toString(36).slice(2, 6)}`; l.htmlFor = c.id }
    })
    let raf = 0
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(link) })
    mo.observe(document.body, { childList: true, subtree: true })
    link()
    return () => mo.disconnect()
  }, [])

  if (!session) return status === 'loading' ? <Loading text="Loading…" /> : <><Login /><Toast /></>
  if (session.mustChangePassword) return <><ForcedPasswordChange /><Toast /></>
  if (status !== 'ready') return <Loading text="Loading projects…" />

  const inProject = route.project !== null && current === route.project
  const c = coverage(reqs.filter((r) => markets.includes(r.market)), docs)
  const badge: Partial<Record<PageKey, { n: number; hot?: boolean }>> = {
    requirements: { n: c.gaps.length + c.pending.length },
    reviews: { n: docs.filter((d) => d.status === 'Under review').length, hot: true },
    updates: { n: updates.filter((u) => u.status === 'Awaiting assessment').length, hot: true },
    activity: { n: events.filter((e) => !e.read && (!e.forRole || e.forRole === role)).length },
    rfis: { n: rfis.filter((r) => r.status === 'Awaiting response').length, hot: true },
    ncrs: { n: ncrs.filter((n) => n.status !== 'Closed').length, hot: ncrs.some((n) => n.severity === 'Critical' && n.status !== 'Closed') },
    risks: { n: risks.filter((r) => r.status !== 'Closed' && r.likelihood * r.impact >= 15).length, hot: true },
  }
  // Vendor-scoped accounts only get the pages whose data the server returns to them.
  const allowed = (k: PageKey) => !scope || (VENDOR_PAGES as readonly string[]).includes(k)
  const page: PageKey = allowed(route.page) ? route.page : 'vendor'
  const Page = PAGES[page]
  const workN = all.reduce((n, a) => n + a.work.length, 0)
  const regN = all.reduce((n, a) => n + a.s.updates.filter((u) => u.status === 'Awaiting assessment').length, 0)
  const nav = (on: boolean, onClick: () => void, icon: ReactNode, label: string, n?: number, hot?: boolean) => (
    <button key={label} className={on ? 'on' : ''} onClick={onClick}>{icon}<span>{label}</span>{!!n && n > 0 && <span className={`cnt ${hot ? 'hot' : ''}`}>{n}</span>}</button>
  )

  return (
    <div className="shell">
      <aside className={`side ${menu ? 'open' : ''}`}>
        <div className="brand" onClick={() => home()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && home()}>
          <div className="logo"><Boxes size={16} /></div>
          <div><b>Qualigrafo</b><small>Pharma engineering evidence</small></div>
        </div>
        {inProject ? (
          <>
            <div className="projbox">
              <small>Project · {profile.id}</small>
              <select aria-label="Switch project" value={profile.id} onChange={(e) => openProjectRoute(e.target.value, route.page)}>{projectList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <span>{profile.facility} · {profile.scope}</span>
            </div>
            <nav className="nav">
              {GROUPS.filter((g) => g.keys.some(allowed)).map((g) => (
                <div key={g.title}>
                  <h6>{g.title}</h6>
                  {g.keys.filter(allowed).map((k) => nav(page === k, () => go(k), ICON[k], LABEL[k], badge[k]?.n, badge[k]?.hot))}
                </div>
              ))}
            </nav>
          </>
        ) : (
          <nav className="nav">
            <h6>Workspace</h6>
            {nav(route.home === 'portfolio', () => home('portfolio'), <Briefcase size={15} />, 'Portfolio')}
            {nav(route.home === 'work', () => home('work'), <Inbox size={15} />, 'My work', workN)}
            {nav(route.home === 'watch', () => home('watch'), <Radar size={15} />, 'Regulatory watch', regN, true)}
            {nav(route.home === 'library', () => home('library'), <BookOpen size={15} />, 'Requirement library')}
            {session.isAdmin && nav(route.home === 'admin', () => home('admin'), <UserCog size={15} />, 'Users & access')}
            <h6>Projects</h6>
            {all.map(({ meta, st }) => (
              <button key={meta.id} onClick={() => openProjectRoute(meta.id)}>
                <span className={`hd ${st.attention ? 'bad' : 'ok'}`} title={st.attention ? 'Needs attention' : 'No flags'} />
                <span style={{ minWidth: 0 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.name}</span><small className="sub">{meta.id} · {meta.phase}</small></span>
              </button>
            ))}
          </nav>
        )}
        <div className="sidefoot">
          <div className="acct">
            <div className="acct-head">
              <button className="row me" onClick={() => home('profile')} aria-label="My profile"><span className="avatar">{session.name[0]}</span><span className="acct-who"><b>{session.name}</b><span>{role}{session.company ? ` · ${session.company}` : ''}</span></span></button>
              <button className={`acct-toggle${acctOpen ? ' open' : ''}`} aria-label={acctOpen ? 'Hide account actions' : 'Show account actions'} aria-expanded={acctOpen} onClick={() => setAcctOpen((v) => !v)}><ChevronUp size={16} /></button>
            </div>
            {acctOpen && (
              <div className="acct-grid">
                <button onClick={() => home('profile')}><span className="acct-ico"><UserRound size={16} /></span>My profile</button>
                <button onClick={() => setMailOpen(true)}><span className="acct-ico"><Mail size={16} /></span>E-mail notifications</button>
                <button onClick={() => setPwOpen(true)}><span className="acct-ico"><Lock size={16} /></span>Change password</button>
                <button onClick={() => { logout(); window.location.hash = '#/' }}><span className="acct-ico"><LogOut size={16} /></span>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <button className="btn menu-btn" onClick={() => setMenu(!menu)} aria-label="Menu"><Menu size={15} /></button>
          <div className="crumb">
            <button onClick={() => home()}>Portfolio</button>
            {inProject ? <><ChevronRight size={13} /><button className="hide-sm" onClick={() => go('overview')}>{profile.name}</button><ChevronRight size={13} className="hide-sm" /><b>{LABEL[page]}</b></> : route.home !== 'portfolio' && <><ChevronRight size={13} /><b>{HOME_LABEL[route.home]}</b></>}
          </div>
          <button className="searchbtn" onClick={() => setPalette(true)} aria-label="Search"><Search size={14} /><span>Search</span><kbd>Ctrl K</kbd></button>
          {inProject && scope && <span className="badge amber" title="Your access is limited to this company's records">Vendor · {scope}</span>}
          {inProject && <Notifications />}
          {inProject && !scope && <span className="badge" title="Project input mode">{revitMode ? 'Revit connector' : 'Standalone'}</span>}
          {inProject && <span className="badge" title="Your role on this project">{role}</span>}
        </header>
        {loadError && <div className="notice err" style={{ margin: '12px 24px 0' }}>{loadError}</div>}
        {inProject && profile.status === 'Archived' && <div className="notice" style={{ margin: '12px 24px 0' }}><b>Archived · read-only.</b> {profile.archivedReason}{role === 'Owner / QA' && <> <button className="link small" onClick={() => go('setup')}>Restore under Setup →</button></>}</div>}
        <main className="page"><ErrorBoundary resetKey={`${route.project}/${page}/${route.home}`}><Suspense fallback={<div className="empty"><b>Loading…</b></div>}>{inProject ? (projectLoading ? <div className="empty"><b>Loading project…</b></div> : <Page />) : route.home === 'work' ? <MyWork /> : route.home === 'watch' ? <Watch /> : route.home === 'admin' && session.isAdmin ? <Admin /> : route.home === 'new' && session.canCreateProjects ? <NewProject /> : route.home === 'library' ? <Library /> : route.home === 'profile' ? <Profile /> : <Portfolio />}</Suspense></ErrorBoundary></main>
      </div>

      {inProject && drawer?.kind === 'doc' && <DocDrawer key={drawer.id} id={drawer.id} />}
      {inProject && drawer?.kind === 'req' && <ReqDrawer key={drawer.id} id={drawer.id} />}
      <Palette labels={scope ? (Object.fromEntries(Object.entries(LABEL).filter(([k]) => allowed(k as PageKey))) as Record<PageKey, string>) : LABEL} inProject={inProject} />
      {pwOpen && <PasswordDialog onClose={closePw} />}
      {mailOpen && <NotificationDialog onClose={closeMail} />}
      <Toast />
      <LockScreen />
      {idle.warn && <IdleWarning onStay={idle.stay} />}
    </div>
  )
}
