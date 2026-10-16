import { useEffect, useState } from 'react'
import { Activity as ActivityIcon, Archive, Bell as BellIcon, BellRing, Boxes, Briefcase, CalendarRange, ChevronRight, CircleHelp, ClipboardCheck, ClipboardList, FilePlus2, FileText, FileUp, GitBranch, History, Inbox, LayoutDashboard, ListChecks, Menu, MessageSquare, Network, PackageCheck, PenLine, Radar, ScanSearch, Search, Settings2, TriangleAlert, Users, X, Flame, ShieldAlert, Store, Swords } from 'lucide-react'
import type { ReactNode } from 'react'
import { coverage, useStore } from './store'
import { projectIndex } from './data/seed'
import type { Role } from './types'
import { Toast } from './components/Toast'
import { DocDrawer, ReqDrawer } from './components/Drawers'
import { Palette } from './components/Palette'
import { fmtDate, go, home, openProjectRoute, useRoute, useUI } from './components/ui'
import type { HomeKey, PageKey } from './components/ui'
import Portfolio, { MyWork, Watch, useAll } from './pages/Portfolio'
import Overview from './pages/Overview'
import Setup from './pages/Setup'
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
  overview: 'Overview', setup: 'Setup & baseline', schedule: 'Schedule', requirements: 'Requirements', evidence: 'Evidence map', inspector: 'Inspector view',
  updates: 'Regulatory changes', actions: 'Corrective actions', documents: 'Document register', sources: 'Sources (Revit / file)', reviews: 'Reviews & approvals',
  activity: 'Updates & automation', comments: 'Technical comments', rfis: 'RFIs', inspections: 'Inspections', findings: 'Consistency findings', changes: 'Change impact',
  handover: 'Handover readiness', packages: 'Audit packages', audit: 'Audit trail', templates: 'Templates & vendors', team: 'Team & responsibilities',
  risks: 'Risk register', ncrs: 'Non-conformances', vendor: 'Vendor portal view', rehearsal: 'Audit rehearsal',
}
const ICON: Record<PageKey, ReactNode> = {
  overview: <LayoutDashboard size={15} />, setup: <Settings2 size={15} />, schedule: <CalendarRange size={15} />, requirements: <ListChecks size={15} />, evidence: <Network size={15} />,
  inspector: <ScanSearch size={15} />, updates: <BellRing size={15} />, actions: <ClipboardCheck size={15} />, documents: <FileText size={15} />, sources: <FileUp size={15} />,
  reviews: <PenLine size={15} />, activity: <ActivityIcon size={15} />, comments: <MessageSquare size={15} />, rfis: <CircleHelp size={15} />, inspections: <ClipboardList size={15} />,
  findings: <TriangleAlert size={15} />, changes: <GitBranch size={15} />, handover: <PackageCheck size={15} />, packages: <Archive size={15} />, audit: <History size={15} />,
  templates: <FilePlus2 size={15} />, team: <Users size={15} />,
  risks: <Flame size={15} />, ncrs: <ShieldAlert size={15} />, vendor: <Store size={15} />, rehearsal: <Swords size={15} />,
}
const GROUPS: { title: string; keys: PageKey[] }[] = [
  { title: 'Project', keys: ['overview', 'setup', 'schedule', 'team'] },
  { title: 'Compliance & evidence', keys: ['requirements', 'evidence', 'inspector', 'rehearsal', 'updates', 'actions'] },
  { title: 'Documents', keys: ['documents', 'sources', 'vendor', 'reviews', 'activity', 'comments', 'templates'] },
  { title: 'Site & change', keys: ['rfis', 'inspections', 'ncrs', 'findings', 'risks', 'changes'] },
  { title: 'Handover', keys: ['handover', 'packages', 'audit'] },
]
const PAGES: Record<PageKey, () => ReactNode> = {
  overview: Overview, setup: Setup, schedule: Schedule, team: Team, requirements: Requirements, evidence: EvidenceMap, inspector: Inspector, updates: Updates, actions: Actions,
  documents: Documents, sources: Sources, reviews: Reviews, activity: Activity, comments: Comments, templates: Templates, rfis: Rfis, inspections: Inspections, findings: Findings,
  changes: Changes, handover: Handover, packages: Packages, audit: Audit,
  risks: Risks, ncrs: Ncrs, vendor: Vendor, rehearsal: Rehearsal,
}
const HOME_LABEL: Record<HomeKey, string> = { portfolio: 'Portfolio', work: 'My work', watch: 'Regulatory watch' }

const TOUR: { page: PageKey; role: Role; text: string }[] = [
  { page: 'overview', role: 'Owner / QA', text: 'Start at the project overview: evidence by market and discipline, plus handover gates. Nothing here is a compliance score.' },
  { page: 'requirements', role: 'Owner / QA', text: 'Open a requirement. Applicability, evidence status and document approval are separate. Check the “Cross-market evidence reuse” tab too.' },
  { page: 'documents', role: 'Contractor', text: 'As Contractor, open “Reactor vendor datasheet” (changes requested), add a note and submit it.' },
  { page: 'reviews', role: 'Consultant', text: 'Open a document under review, tick the confirmation and sign as Consultant: it is routed to Owner / QA automatically. Then switch role for stage 2 and a controlled issue manifest is generated.' },
  { page: 'sources', role: 'Contractor', text: 'Switch between Without Revit and Revit connector. Preview a source update and import it: a new draft revision is created and any pending approval route is cancelled.' },
  { page: 'activity', role: 'Consultant', text: 'Every routing step, reminder, revision change and issue is in one feed. Try “Simulate reminder cycle”.' },
  { page: 'evidence', role: 'Contractor', text: 'Open the Purified-water P&ID and start a new revision. Return here: every link to it is now stale until reassessed.' },
  { page: 'comments', role: 'Consultant', text: 'Select a comment to zoom to its anchor. Switch to “Revit connector” to see the navigation request and its failure outcomes (simulated).' },
  { page: 'inspector', role: 'Owner / QA', text: 'Pick “Material traceability for utility piping”. The trail shows what is proven and what is missing.' },
  { page: 'updates', role: 'Owner / QA', text: 'Assess the fictional update as applicable: a new baseline is created and only the affected evidence reopens.' },
  { page: 'ncrs', role: 'Contractor', text: 'Open the Critical NCR and submit a response with root cause, containment and corrective action. Then switch to Owner / QA to verify and close it: a Consultant cannot close a Critical NCR.' },
  { page: 'risks', role: 'Owner / QA', text: 'The heat map plots open risks by likelihood and impact. Select one, add a note and change its status.' },
  { page: 'rehearsal', role: 'Owner / QA', text: 'Audit rehearsal: for each market, see which inspector questions you could answer today and why the others cannot be answered yet.' },
  { page: 'vendor', role: 'Contractor', text: 'Vendor portal view: pick a company and see only its deliverables and the items waiting on it. Submit from here.' },
  { page: 'handover', role: 'Owner / QA', text: 'Every document-gate condition is reported separately. Then freeze an audit package under “Audit packages”.' },
]

function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  const setRole = useStore((s) => s.setRole)
  useEffect(() => { go(TOUR[i].page); setRole(TOUR[i].role) }, [i, setRole])
  return (
    <div className="tour" role="dialog" aria-label="Walkthrough">
      <div className="th"><span>Walkthrough · step {i + 1} of {TOUR.length}</span><button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, color: '#fff' }}><X size={14} /></button></div>
      <div className="tb">
        <b>{LABEL[TOUR[i].page]}</b>
        <p className="muted" style={{ margin: '6px 0' }}>{TOUR[i].text}</p>
        <p className="small muted">Role preview set to {TOUR[i].role}.</p>
        <div className="row sb" style={{ marginTop: 10 }}>
          <button className="btn sm" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
          {i < TOUR.length - 1 ? <button className="btn sm pri" onClick={() => setI(i + 1)}>Next</button> : <button className="btn sm pri" onClick={onClose}>Finish</button>}
        </div>
      </div>
    </div>
  )
}

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
            {mine.slice(0, 6).map((e) => <div key={e.id} className="pitem" style={e.read ? undefined : { background: '#f4fafa' }}><div className="small">{e.text}</div><div className="muted small">{e.category} · {fmtDate(e.at)}</div></div>)}
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
  const { role, setRole, current, openProject, profile, docs, reqs, markets, updates, rfis, revitMode, reset, events, ncrs, risks } = useStore()
  const [tour, setTour] = useState(false)
  const all = useAll()

  useEffect(() => { if (route.project !== current) openProject(route.project) }, [route.project, current, openProject])
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
  const Page = PAGES[route.page]
  const workN = all.reduce((n, a) => n + a.work.length, 0)
  const regN = all.reduce((n, a) => n + a.p.updates.filter((u) => u.status === 'Awaiting assessment').length, 0)
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
              <select aria-label="Switch project" value={profile.id} onChange={(e) => openProjectRoute(e.target.value, route.page)}>{projectIndex.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <span>{profile.facility} · {profile.scope}</span>
            </div>
            <nav className="nav">
              {GROUPS.map((g) => (
                <div key={g.title}>
                  <h6>{g.title}</h6>
                  {g.keys.map((k) => nav(route.page === k, () => go(k), ICON[k], LABEL[k], badge[k]?.n, badge[k]?.hot))}
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
          <div className="row" style={{ gap: 9 }}><span className="avatar">{role[0]}</span><div><b style={{ color: '#e6eef3', fontSize: 12.5 }}>{role}</b><div>Role preview</div></div></div>
          <button className="link small" style={{ color: '#8fb4c4', fontWeight: 400, marginTop: 8 }} onClick={() => { if (confirm('Reset all prototype data to its starting state?')) reset() }}>Reset prototype data</button>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <button className="btn menu-btn" onClick={() => setMenu(!menu)} aria-label="Menu"><Menu size={15} /></button>
          <div className="crumb">
            <button onClick={() => home()}>Portfolio</button>
            {inProject ? <><ChevronRight size={13} /><button className="hide-sm" onClick={() => go('overview')}>{profile.name}</button><ChevronRight size={13} className="hide-sm" /><b>{LABEL[route.page]}</b></> : route.home !== 'portfolio' && <><ChevronRight size={13} /><b>{HOME_LABEL[route.home]}</b></>}
          </div>
          <button className="searchbtn" onClick={() => setPalette(true)} aria-label="Search"><Search size={14} /><span>Search</span><kbd>Ctrl K</kbd></button>
          {inProject && <span className="badge" title="Project input mode">{revitMode ? 'Revit (simulated)' : 'Standalone'}</span>}
          {inProject && <Notifications />}
          <button className="btn sm ghost" onClick={() => setTour(!tour)}>Walkthrough</button>
          <label className="role"><span>Preview as</span>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Preview role"><option>Consultant</option><option>Contractor</option><option>Owner / QA</option></select>
          </label>
        </header>
        <div className="cert">Prototype · fictional data · role preview is not authentication. This platform records evidence status; it does not issue regulatory approval or valid electronic signatures.</div>
        <main className="page">{inProject ? <Page /> : route.home === 'work' ? <MyWork /> : route.home === 'watch' ? <Watch /> : <Portfolio />}</main>
      </div>

      {inProject && drawer?.kind === 'doc' && <DocDrawer key={drawer.id} id={drawer.id} />}
      {inProject && drawer?.kind === 'req' && <ReqDrawer key={drawer.id} id={drawer.id} />}
      <Palette labels={LABEL} inProject={inProject} />
      {tour && <Tour onClose={() => setTour(false)} />}
      <Toast />
    </div>
  )
}
