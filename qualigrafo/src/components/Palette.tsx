import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, ListChecks, LayoutGrid, CornerDownLeft, Briefcase } from 'lucide-react'
import { useProjectList, useStore } from '../store'
import { go, home, openProjectRoute, useUI } from './ui'
import type { PageKey } from './ui'

interface Hit { id: string; group: string; label: string; sub: string; icon: 'page' | 'doc' | 'req' | 'project'; run: () => void }

export function Palette({ labels, inProject }: { labels: Record<PageKey, string>; inProject: boolean }) {
  const { palette, setPalette, open } = useUI()
  const { docs, reqs, markets } = useStore()
  const projectIndex = useProjectList()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (palette) { setQ(''); setI(0); setTimeout(() => ref.current?.focus(), 20) } }, [palette])

  const hits = useMemo<Hit[]>(() => {
    const all: Hit[] = []
    projectIndex.forEach((p) => all.push({ id: 'p' + p.id, group: 'Projects', label: p.name, sub: `${p.id} · ${p.client}`, icon: 'project', run: () => openProjectRoute(p.id) }))
    all.push({ id: 'h1', group: 'Workspace', label: 'Portfolio', sub: 'All projects', icon: 'page', run: () => home('portfolio') }, { id: 'h2', group: 'Workspace', label: 'My work', sub: 'Tasks waiting for your role', icon: 'page', run: () => home('work') }, { id: 'h3', group: 'Workspace', label: 'Regulatory watch', sub: 'Change inbox and sources', icon: 'page', run: () => home('watch') })
    if (inProject) {
      ;(Object.keys(labels) as PageKey[]).forEach((k) => all.push({ id: 'g' + k, group: 'Pages', label: labels[k], sub: 'Go to page', icon: 'page', run: () => go(k) }))
      docs.forEach((d) => all.push({ id: 'd' + d.id, group: 'Documents', label: d.title, sub: `${d.id} · ${d.system} · ${d.status}`, icon: 'doc', run: () => open('doc', d.id) }))
      reqs.filter((r) => markets.includes(r.market)).forEach((r) => all.push({ id: 'r' + r.id, group: 'Requirements', label: r.title, sub: `${r.id} · ${r.market} · ${r.system}`, icon: 'req', run: () => open('req', r.id) }))
    }
    const s = q.trim().toLowerCase()
    const m = s ? all.filter((h) => `${h.label} ${h.sub}`.toLowerCase().includes(s)) : all.filter((h) => h.group === 'Pages' || h.group === 'Projects' || h.group === 'Workspace')
    return m.slice(0, 12)
  }, [q, docs, reqs, markets, labels, inProject, open, projectIndex])

  if (!palette) return null
  const choose = (h?: Hit) => { if (!h) return; setPalette(false); h.run() }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(hits[i]) }
    else if (e.key === 'Escape') setPalette(false)
  }
  const Icon = ({ k }: { k: Hit['icon'] }) => (k === 'doc' ? <FileText size={15} /> : k === 'req' ? <ListChecks size={15} /> : k === 'project' ? <Briefcase size={15} /> : <LayoutGrid size={15} />)
  let last = ''
  return (
    <div className="scrim" style={{ justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' }} onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Search" onKeyDown={onKey}>
        <input ref={ref} autoFocus className="pin" value={q} onChange={(e) => { setQ(e.target.value); setI(0) }} placeholder={inProject ? 'Search pages, documents, requirements, projects…' : 'Search projects and pages…'} aria-label="Search" />
        <div className="pres">
          {hits.map((h, k) => {
            const head = h.group !== last ? <div className="pgroup">{h.group}</div> : null
            last = h.group
            return <div key={h.id}>{head}<button className={`phit ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => choose(h)}><Icon k={h.icon} /><span><b>{h.label}</b><small>{h.sub}</small></span>{k === i && <CornerDownLeft size={13} />}</button></div>
          })}
          {!hits.length && <div className="empty">No results</div>}
        </div>
        <div className="pfoot"><span>↑↓ navigate</span><span>Enter open</span><span>Esc close</span></div>
      </div>
    </div>
  )
}
