import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { create } from 'zustand'
import { X } from 'lucide-react'
import type { DocStatus, EvidenceState, MarketKey } from '../types'
import { useStore } from '../store'

export type PageKey =
  | 'overview' | 'setup' | 'registers' | 'requirements' | 'evidence' | 'inspector' | 'documents' | 'reviews' | 'comments'
  | 'rfis' | 'inspections' | 'findings' | 'changes' | 'actions' | 'handover' | 'packages' | 'updates' | 'activity' | 'sources' | 'schedule' | 'audit' | 'templates' | 'team' | 'risks' | 'ncrs' | 'vendor' | 'rehearsal' | 'transmittals'

export type HomeKey = 'portfolio' | 'work' | 'watch' | 'admin' | 'new' | 'library' | 'profile'

export const PAGE_KEYS: PageKey[] = ['overview', 'setup', 'registers', 'requirements', 'evidence', 'inspector', 'documents', 'reviews', 'comments', 'rfis', 'inspections', 'findings', 'changes', 'actions', 'handover', 'packages', 'updates', 'activity', 'sources', 'schedule', 'audit', 'templates', 'team', 'risks', 'ncrs', 'vendor', 'rehearsal', 'transmittals']

/* ---------- hash router (no dependency) ---------- */
/** Every address that opens a home page. `new` keeps the short alias because people guess it. */
const HOME_ROUTES: Record<string, HomeKey> = {
  '': 'portfolio', '#': 'portfolio', '#/': 'portfolio',
  '#/work': 'work', '#/watch': 'watch', '#/admin': 'admin', '#/library': 'library',
  '#/new-project': 'new', '#/new': 'new', '#/profile': 'profile',
}
/** `unknown` carries an address that matched nothing, so the shell can say so instead of showing Portfolio in silence. */
export function parseHash(): { project: string | null; page: PageKey; home: HomeKey; unknown: string | null } {
  const h = window.location.hash
  const m = h.match(/^#\/p\/([^/]+)\/?([^/]*)/)
  if (!m) {
    const home = HOME_ROUTES[h]
    return { project: null, page: 'overview', home: home ?? 'portfolio', unknown: home ? null : h || null }
  }
  const page = (PAGE_KEYS as string[]).includes(m[2]) ? (m[2] as PageKey) : 'overview'
  return { project: decodeURIComponent(m[1]), page, home: 'portfolio', unknown: null }
}
export function useRoute() {
  const [r, setR] = useState(parseHash)
  useEffect(() => {
    const f = () => setR(parseHash())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return r
}

interface UI {
  drawer: { kind: 'doc' | 'req'; id: string } | null
  menu: boolean
  palette: boolean
  setPalette: (v: boolean) => void
  open: (kind: 'doc' | 'req', id: string) => void
  close: () => void
  setMenu: (v: boolean) => void
}
export const useUI = create<UI>((set) => ({
  drawer: null,
  menu: false,
  palette: false,
  setPalette: (palette) => set({ palette }),
  open: (kind, id) => set({ drawer: { kind, id } }),
  close: () => set({ drawer: null }),
  setMenu: (menu) => set({ menu }),
}))

export function go(page: PageKey) {
  const id = useStore.getState().current
  useUI.setState({ drawer: null, menu: false })
  window.location.hash = id ? `#/p/${id}/${page}` : '#/'
}
export const home = (k: HomeKey = 'portfolio') => { useUI.setState({ drawer: null, menu: false }); window.location.hash = k === 'portfolio' ? '#/' : k === 'new' ? '#/new-project' : `#/${k}` }
export const openProjectRoute = (id: string, page: PageKey = 'overview') => { window.location.hash = `#/p/${id}/${page}` }

export const fmtDate = (s: string) => new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
export const R = (n: number) => `R${String(n).padStart(2, '0')}`

/* ---------- marks ---------- */
export function Badge({ tone, children, dot = true }: { tone?: string; children: ReactNode; dot?: boolean }) {
  return <span className={`badge ${tone ?? ''}`}>{dot && <i />}{children}</span>
}
export const docTone = (s: DocStatus) => (s === 'Accepted' ? 'green' : s === 'Missing' || s === 'Changes requested' ? 'red' : s === 'Under review' ? 'amber' : s === 'Void' || s === 'Superseded' ? '' : 'blue')
export const DocBadge = ({ s }: { s: DocStatus }) => <Badge tone={docTone(s)}>{s}</Badge>

export const stateTone = (s: EvidenceState) =>
  s === 'Evidence accepted' ? 'green' : s === 'Evidence missing' || s === 'Revision changed' || s === 'Correction required' ? 'red' : s === 'Not applicable' ? '' : s === 'Assessment pending' ? 'violet' : 'amber'
export const StateBadge = ({ s }: { s: EvidenceState }) => <Badge tone={stateTone(s)}>{s}</Badge>

export const Applic = ({ a }: { a: string }) => <span className={`tag ${a === 'Required' ? 'req' : a === 'Not applicable' ? 'na' : 'pend'}`}>{a}</span>
export const MarketChip = ({ m }: { m: MarketKey }) => <span className={`mk mk-${m}`}>{m}</span>

export function PageHead({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  return (
    <div className="phead">
      <div><h1>{title}</h1><p>{sub}</p></div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, warn }: { label: string; value: ReactNode; sub: string; warn?: boolean }) {
  return <div className={`stat ${warn ? 'warn' : ''}`}><div className="l">{label}</div><div className="v">{value}</div><div className="s">{sub}</div></div>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>
}

export function Drawer({ kicker, title, right, children }: { kicker: string; title: string; right?: ReactNode; children: ReactNode }) {
  const close = useUI((s) => s.close)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const f = window.setTimeout(() => document.querySelector<HTMLElement>('.drawer .dhead button')?.focus(), 60)
    return () => { window.clearTimeout(f); prev?.focus?.() }
  }, [])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dhead">
          <div><span className="muted small">{kicker}</span><h2>{title}</h2></div>
          <div className="row">{right}<button className="btn sm" onClick={close} aria-label="Close"><X size={14} /></button></div>
        </div>
        <div className="dbody">{children}</div>
      </aside>
    </div>
  )
}
