import { useMemo } from 'react'
import { create } from 'zustand'
import { api, downloadAs, errorText, fetchBlob, setUnauthorizedHandler, tokenStore, uploadForm } from './api'
import type { Applicability, AuditEvent, BaselineRec, Change, Doc, EvidenceState, Finding, GapAction, Inspection, MarketKey, Pin, Profile, RegUpdate, Requirement, Rfi, Role, Scope, IndustryGroup, ServiceType, BimRequirement, Snapshot, ToastMsg, Notice, Automation, ImportBatch, IssuedPackage, Transmittal, Risk, Ncr, NcrSeverity, Rating, SessionUser, EmailPref, AccountFacts, MyMembership, ActivityItem, ProjectSummary, Company, SystemRec, DisciplineRec, Member, ConnectorState } from './types'

/** Working date (YYYY-MM-DD) for due / overdue logic. Starts as the browser's date; replaced by the server's (site time zone) after sign-in. */
export let TODAY = new Date().toLocaleDateString('en-CA')

/** Date N days after TODAY, for form defaults. */
export function plusDays(n: number) {
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Everything that belongs to one project workspace (the API returns exactly this shape). */
export interface ProjectData {
  profile: Profile
  markets: MarketKey[]
  docs: Doc[]
  reqs: Requirement[]
  pins: Pin[]
  updates: RegUpdate[]
  actions: GapAction[]
  rfis: Rfi[]
  inspections: Inspection[]
  findings: Finding[]
  changes: Change[]
  snapshots: Snapshot[]
  baselines: BaselineRec[]
  audit: AuditEvent[]
  baseline: number
  revitMode: boolean
  events: Notice[]
  automation: Automation
  imports: ImportBatch[]
  issued: IssuedPackage[]
  transmittals: Transmittal[]
  risks: Risk[]
  ncrs: Ncr[]
  companies: Company[]
  systems: SystemRec[]
  disciplines: DisciplineRec[]
  members: Member[]
  connector: ConnectorState
}

export const blankProject = (): ProjectData => ({
  profile: { id: '', name: '', client: '', site: '', industryGroup: 'Pharma', facilityType: 'API', serviceType: 'Design only', scope: 'New plant', projectStage: '', projectCountry: 'SA', ownerStandards: '', status: 'Active' },
  markets: [], docs: [], reqs: [], pins: [], updates: [], actions: [], rfis: [], inspections: [], findings: [], changes: [], snapshots: [], baselines: [], audit: [],
  baseline: 1, revitMode: false, events: [], automation: { routing: true, reminders: true, autoIssue: true }, imports: [], issued: [], transmittals: [], risks: [], ncrs: [], companies: [], systems: [], disciplines: [], members: [], connector: { tokens: [], models: [] },
})

/** Every action resolves to an error message, or null on success (same contract the pages already use). */
type Result = Promise<string | null>
interface ProjectResponse { role: Role; scope: string | null; project: ProjectData }

/** Pages a vendor-scoped account can open (the server returns nothing for the rest). */
export const VENDOR_PAGES = ['vendor', 'documents', 'sources', 'activity', 'comments', 'rfis', 'ncrs', 'transmittals'] as const
export interface UploadPolicy { maxBytes: number; extensions: string[] }

interface State extends ProjectData {
  session: SessionUser | null
  /** Account facts and project roles of the signed-in person (profile page). */
  account: AccountFacts | null
  myRoles: MyMembership[]
  status: 'idle' | 'loading' | 'ready'
  loadError: string | null
  /** Portfolio: one server-computed summary per project the user belongs to (P1: no full payloads for the list). */
  summaries: ProjectSummary[]
  /** The open project's full data is being fetched. */
  projectLoading: boolean
  role: Role
  /** Vendor company the user is limited to in the open project; null = whole project. */
  scope: string | null
  current: string | null
  toasts: ToastMsg[]
  uploadPolicy: UploadPolicy | null
  /** Session locked after inactivity ('idle') or because the server ended it ('expired'); the user re-enters the password. */
  locked: null | 'idle' | 'expired'
  idleMinutes: number
  lock: (why: 'idle' | 'expired') => void
  unlock: (password: string) => Promise<string | null>
  restore: () => Promise<void>
  login: (email: string, password: string) => Result
  logout: () => void
  changePassword: (current: string, next: string) => Result
  setEmailPref: (pref: EmailPref) => Result
  loadAll: () => Promise<void>
  refresh: () => Promise<void>
  openProject: (id: string | null) => void
  toast: (text: string, tone?: 'ok' | 'warn') => void
  dismissToast: (id: number) => void
  saveProfile: (p: Classification & { scope: Scope; ownerStandards: string; markets: MarketKey[]; reason: string }) => Result
  submitDoc: (id: string, note: string) => Result
  createTransmittal: (t: { to: string; purpose: string; note: string; docs: string[] }) => Result
  acknowledgeTransmittal: (id: string, note: string) => Result
  /** Downloads a server-generated PDF report of the open project (path below /projects/:code). */
  downloadReport: (path: string, name: string) => Promise<void>
  editRfi: (id: string, b: { title: string; discipline: string; system: string; due: string; reason: string }) => Result
  editRisk: (id: string, b: { title: string; detail: string; system: string; likelihood: Rating; impact: Rating; owner: string; mitigation: string; due: string; reason: string }) => Result
  editNcr: (id: string, b: { title: string; description: string; system: string; severity: NcrSeverity; doc: string; due: string; reason: string }) => Result
  editAction: (id: string, b: { title: string; owner: string; due: string; priority: GapAction['priority']; reason: string }) => Result
  raiseFinding: (f: { title: string; doc: string; severity: Finding['severity']; source: string; rule: string }) => Result
  registerDoc: (f: DocFields) => Result
  updateDocDetails: (id: string, f: DocFields & { reason: string }) => Result
  voidDoc: (id: string, reason: string, supersededBy?: string) => Result
  reinstateDoc: (id: string, reason: string) => Result
  previewRegister: (rows: RegisterRow[], source: string) => Promise<{ preview?: ImportPreview; error?: string }>
  importRegister: (rows: RegisterRow[], source: string) => Result
  withdrawEvidence: (reqId: string, idx: number, reason: string) => Result
  signDoc: (id: string, reason: string, intent: boolean, password: string) => Result
  setAutomation: (k: keyof Automation, v: boolean) => Result
  sendReminders: () => Result
  markAllRead: () => Result
  addRisk: (r: { title: string; detail: string; system: string; likelihood: Rating; impact: Rating; owner: string; mitigation: string; due: string }) => Result
  updateRisk: (id: string, status: Risk['status'], note: string) => Result
  raiseNcr: (n: { title: string; description: string; system: string; severity: NcrSeverity; doc?: string; due: string }) => Result
  respondNcr: (id: string, rootCause: string, containment: string, correctiveAction: string) => Result
  closeNcr: (id: string, reason: string) => Result
  reopenNcr: (id: string, reason: string) => Result
  generateDeliverables: (g: { tag: string; vendor: string; discipline: string; due: string }) => Result
  uploadSource: (docId: string, file: File, label?: string, onProgress?: (pct: number) => void) => Result
  downloadFile: (fileId: string, name: string) => Result
  setSourceRef: (id: string, clause: string, version: string, effective: string, attest: boolean) => Result
  returnDoc: (id: string, reason: string) => Result
  newRevision: (id: string) => Result
  addRequirement: (r: { title: string; market: MarketKey; discipline: string; system: string; topic: string; critical: boolean; owner: string; due: string }) => Result
  updateRequirement: (id: string, b: { system: string; owner: string; due: string }) => Result
  decideApplicability: (id: string, a: Applicability, rationale: string) => Result
  /** The same decision for several requirements (first set-up of a market pack); audited per requirement. */
  decideApplicabilityBulk: (ids: string[], a: Applicability, rationale: string) => Result
  /** Re-reads the signed-in account (profile page). */
  loadProfile: () => Promise<void>
  /** My own security events and audit entries, newest first. */
  myActivity: (limit?: number) => Promise<ActivityItem[]>
  /** Ends every session of this account, including this one. */
  signOutEverywhere: () => Result
  linkEvidence: (reqId: string, docId: string, note: string) => Result
  assessEvidence: (reqId: string, idx: number, accept: boolean, reason: string) => Result
  addPin: (p: { text: string; doc: string; room: string; place?: Place }) => Promise<{ id?: string; error?: string }>
  anchorPin: (id: string, place: Place) => Result
  linkElement: (id: string, model: string | null, element: string | null) => Result
  navigate: (id: string) => Result
  setRevit: (on: boolean) => Result
  createToken: (name: string) => Promise<{ token?: string; error?: string }>
  revokeToken: (id: string) => Result
  importRevit: (docId: string, snapshotId: string) => Result
  fileBlob: (fileId: string) => Promise<Blob>
  replyPin: (id: string, text: string, close: boolean) => Result
  assessUpdate: (id: string, applicable: boolean, reason: string) => Result
  addAction: (a: Omit<GapAction, 'id' | 'status' | 'submittedBy'>) => Result
  progressAction: (id: string, to: GapAction['status']) => Result
  raiseRfi: (r: { title: string; discipline: string; system: string; due: string }) => Result
  answerRfi: (id: string, response: string) => Result
  closeRfi: (id: string) => Result
  requestInspection: (i: { title: string; system: string }) => Result
  submitInspection: (id: string, evidence: string) => Result
  decideInspection: (id: string, accept: boolean, reason: string) => Result
  disposeFinding: (id: string, status: 'Resolved' | 'Accepted exception', reason: string) => Result
  addChange: (c: { title: string; system: string; docs: string[]; reqs: string[] }) => Result
  assessChangeItem: (id: string, item: string, v: 'Impacted' | 'Not impacted') => Result
  decideChange: (id: string, authorize: boolean, reason: string) => Result
  createSnapshot: () => Result
  addCompany: (b: { name: string; kind: string; contactName?: string; contactEmail?: string }) => Result
  updateCompany: (id: string, b: { name?: string; kind?: string; contactName?: string | null; contactEmail?: string | null; active?: boolean }) => Result
  addSystem: (b: SystemInput) => Result
  importSystems: (rows: SystemInput[]) => Result
  updateSystem: (tag: string, b: Partial<Omit<SystemInput, 'tag'>> & { active?: boolean }) => Result
  addDiscipline: (name: string) => Result
  updateDiscipline: (id: string, b: { name?: string; active?: boolean; move?: 'up' | 'down' }) => Result
  createProject: (b: NewProject) => Promise<{ code?: string; error?: string }>
  updateDetails: (b: { name: string; client: string; site: string }) => Result
  archiveProject: (reason: string) => Result
  restoreProject: (reason: string) => Result
  setMember: (userId: string, role: Role, scope: string | null) => Result
  removeMember: (userId: string) => Result
}
/** The classification fields the wizard collects and the set-up page edits (Phase 5 / step 1). */
export interface Classification {
  industryGroup: IndustryGroup
  facilityType: string
  secondaryFacilityType?: string
  customFacilityType?: string
  serviceType: ServiceType
  projectStage: string
  bimRequirement?: BimRequirement
}
export interface NewProject extends Classification {
  code?: string; name: string; client: string; site: string; projectCountry: MarketKey; markets: MarketKey[]
  scope: Scope; ownerStandards: string; disciplines: string[]
  companies: { name: string; kind: string }[]; members: { userId: string; role: Role; scope?: string | null }[]
}
/** A position on a drawing: 1-based page, normalised x / y (0..1). */
export interface Place { page: number; x: number; y: number }
export interface SystemInput { tag: string; name: string; discipline?: string | null; area?: string | null; gmpCritical?: boolean }

let tid = 0
const enc = encodeURIComponent

/** Register fields of a document (create / edit). */
export interface DocFields { title: string; number: string; discipline: string; system: string; owner: string; due: string; critical: boolean }
/** One row of a Master Document Register import, matched on the document number. */
export interface RegisterRow { number: string; title?: string; discipline?: string; system?: string; company?: string; due?: string; critical?: boolean }
export interface ImportPreview {
  created: { row: number; number: string; title: string }[]
  updated: { row: number; code: string; number: string; changes: string[] }[]
  unchanged: number
  errors: { row: number; error: string }[]
}

export const useStore = create<State>()((set, get) => {
  /** A fresh payload of the open project becomes the top-level state the pages read (ignored if another project is open by now). */
  const apply = (code: string, r: ProjectResponse) => {
    set((s) => (s.current === code ? { ...r.project, role: r.role, scope: r.scope, projectLoading: false } : {}))
  }
  const run = async (method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Result => {
    const code = get().current
    if (!code) return 'Open a project first.'
    try {
      apply(code, await api<ProjectResponse>(method, `/projects/${enc(code)}${path}`, body))
      return null
    } catch (e) {
      return errorText(e)
    }
  }
  const post = (path: string, body?: unknown) => run('POST', path, body)
  const put = (path: string, body: unknown) => run('PUT', path, body)
  const del = (path: string) => run('DELETE', path)
  const signIn = async (email: string, password: string) => {
    const r = await api<{ token: string; user: SessionUser }>('POST', '/auth/login', { email, password })
    tokenStore.set(r.token)
    set({ session: r.user })
    if (!r.user.mustChangePassword) await get().loadAll()
  }

  return {
    ...blankProject(),
    session: null,
    account: null,
    myRoles: [],
    status: 'idle',
    loadError: null,
    summaries: [],
    projectLoading: false,
    role: 'Consultant',
    scope: null,
    current: null,
    toasts: [],
    uploadPolicy: null,
    locked: null,
    idleMinutes: 15,
    lock: (why) => {
      if (!get().session || get().locked) return
      tokenStore.set(null)
      set({ locked: why })
    },
    unlock: async (password) => {
      const s = get().session
      if (!s) return 'Not signed in.'
      try {
        const r = await api<{ token: string; user: SessionUser }>('POST', '/auth/login', { email: s.email, password })
        tokenStore.set(r.token)
        set({ locked: null, session: r.user })
        void get().loadAll()
        return null
      } catch (e) {
        return errorText(e)
      }
    },

    restore: async () => {
      if (!tokenStore.get()) return
      set({ status: 'loading' })
      try {
        const me = await api<{ user: SessionUser; memberships: MyMembership[]; account: AccountFacts }>('GET', '/auth/me')
        set({ session: me.user, account: me.account, myRoles: me.memberships, status: me.user.mustChangePassword ? 'idle' : 'loading' })
        if (!me.user.mustChangePassword) await get().loadAll()
      } catch {
        get().logout()
      }
    },
    login: async (email, password) => {
      try {
        await signIn(email, password)
        return get().loadError
      } catch (e) {
        return errorText(e)
      }
    },
    logout: () => {
      tokenStore.set(null)
      set({ ...blankProject(), session: null, account: null, myRoles: [], status: 'idle', loadError: null, summaries: [], projectLoading: false, current: null, role: 'Consultant', scope: null, toasts: [], locked: null })
    },
    setEmailPref: async (emailPref) => {
      try {
        const r = await api<{ user: SessionUser }>('PUT', '/auth/preferences', { emailPref })
        set({ session: r.user })
        return null
      } catch (e) {
        return errorText(e)
      }
    },
    changePassword: async (current, next) => {
      try {
        const r = await api<{ token: string; user: SessionUser }>('POST', '/auth/password', { current, next })
        tokenStore.set(r.token)
        set({ session: r.user })
        if (get().status !== 'ready') await get().loadAll()
        return null
      } catch (e) {
        return errorText(e)
      }
    },
    loadAll: async () => {
      // Background reload once data is on screen, so pages keep their local state.
      set((s) => ({ status: s.status === 'ready' ? 'ready' : 'loading', loadError: null }))
      try {
        const [r, cfg] = await Promise.all([
          api<{ projects: ProjectSummary[] }>('GET', '/projects'),
          api<{ today: string; idleMinutes?: number; upload: UploadPolicy }>('GET', '/reference/config'),
        ])
        TODAY = cfg.today
        const cur = get().current
        const open = cur ? r.projects.find((p) => p.profile.id === cur) : undefined
        set({
          summaries: r.projects, status: 'ready', uploadPolicy: cfg.upload, idleMinutes: cfg.idleMinutes ?? 15,
          // A project that disappeared (membership removed) is closed; the open one keeps its full data.
          ...(cur && !open ? { ...blankProject(), current: null } : {}),
          role: open?.role ?? (cur ? get().role : r.projects[0]?.role ?? get().role),
          scope: open ? open.scope : cur ? get().scope : r.projects[0]?.scope ?? null,
        })
        // As before P1, a full reload also refreshes the open project (e.g. after unlocking the session).
        if (open) await get().refresh()
      } catch (e) {
        set({ status: 'ready', loadError: errorText(e) })
      }
    },
    refresh: async () => {
      const code = get().current
      if (!code) return
      try {
        apply(code, await api<ProjectResponse>('GET', `/projects/${enc(code)}`))
      } catch (e) {
        // Keep showing the last good copy; a project that never loaded reports why.
        if (get().current === code && get().projectLoading) set({ projectLoading: false, loadError: errorText(e) })
      }
    },
    openProject: (id) => {
      if (id === null) return set({ current: null })
      const sm = get().summaries.find((p) => p.profile.id === id)
      if (!sm) return
      // The full project is loaded on demand; pages wait for it (projectLoading) instead of showing another project's data.
      set({ ...blankProject(), current: id, role: sm.role, scope: sm.scope, projectLoading: true, loadError: null })
      void get().refresh()
    },
    toast: (text, tone = 'ok') => {
      const id = ++tid
      set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
      setTimeout(() => get().dismissToast(id), 3800)
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    saveProfile: (p) => put('/profile', p),
    setAutomation: (key, value) => put('/settings/automation', { key, value }),
    sendReminders: () => post('/reminders/send'),
    markAllRead: () => post('/notices/read-all'),

    submitDoc: (id, note) => post(`/docs/${enc(id)}/submit`, { note }),
    createTransmittal: (t) => post('/transmittals', t),
    acknowledgeTransmittal: (id, note) => post(`/transmittals/${enc(id)}/acknowledge`, { note }),
    downloadReport: async (path, name) => {
      const code = get().current
      if (!code) return
      try { await downloadAs(`/projects/${enc(code)}${path}`, `${code}_${name}`); void get().refresh() } catch (e) { get().toast(errorText(e), 'warn') }
    },
    editRfi: (id, b) => put(`/rfis/${enc(id)}`, b),
    editRisk: (id, b) => put(`/risks/${enc(id)}`, b),
    editNcr: (id, b) => put(`/ncrs/${enc(id)}`, b),
    editAction: (id, b) => put(`/actions/${enc(id)}`, b),
    raiseFinding: (f) => post('/findings', f),
    registerDoc: (f) => post('/docs', f),
    updateDocDetails: (id, f) => put(`/docs/${enc(id)}/details`, f),
    voidDoc: (id, reason, supersededBy) => post(`/docs/${enc(id)}/void`, supersededBy ? { reason, supersededBy } : { reason }),
    reinstateDoc: (id, reason) => post(`/docs/${enc(id)}/reinstate`, { reason }),
    previewRegister: async (rows, source) => {
      const code = get().current
      if (!code) return { error: 'Open a project first.' }
      try { return { preview: (await api<{ preview: ImportPreview }>('POST', `/projects/${enc(code)}/docs/import/preview`, { rows, source })).preview } } catch (e) { return { error: errorText(e) } }
    },
    importRegister: (rows, source) => post('/docs/import', { rows, source }),
    withdrawEvidence: (reqId, idx, reason) => {
      const ev = get().reqs.find((r) => r.id === reqId)?.evidence[idx]
      if (!ev?.id) return Promise.resolve('Evidence link not found. Refresh and try again.')
      return post(`/reqs/${enc(reqId)}/evidence/${enc(ev.id)}/withdraw`, { reason })
    },
    signDoc: (id, reason, intent, password) => post(`/docs/${enc(id)}/sign`, { reason, intent, password }),
    returnDoc: (id, reason) => post(`/docs/${enc(id)}/return`, { reason }),
    newRevision: (id) => post(`/docs/${enc(id)}/revisions`),
    uploadSource: async (id, file, label, onProgress) => {
      const code = get().current
      if (!code) return 'Open a project first.'
      const form = new FormData()
      form.append('file', file, file.name)
      if (label?.trim()) form.append('label', label.trim())
      try {
        apply(code, await uploadForm<ProjectResponse>(`/projects/${enc(code)}/docs/${enc(id)}/files`, form, onProgress))
        return null
      } catch (e) {
        return errorText(e)
      }
    },
    downloadFile: async (fileId, name) => {
      const code = get().current
      if (!code) return 'Open a project first.'
      try {
        await downloadAs(`/projects/${enc(code)}/files/${enc(fileId)}`, name)
        return null
      } catch (e) {
        return errorText(e)
      }
    },
    generateDeliverables: (g) => post('/deliverables', g),

    addRequirement: (r) => post('/reqs', r),
    updateRequirement: (id, b) => put(`/reqs/${enc(id)}/details`, b),
    decideApplicability: (id, applicability, rationale) => post(`/reqs/${enc(id)}/applicability`, { applicability, rationale }),
    decideApplicabilityBulk: (ids, applicability, rationale) => post('/reqs/applicability', { ids, applicability, rationale }),
    loadProfile: async () => {
      const me = await api<{ user: SessionUser; memberships: MyMembership[]; account: AccountFacts }>('GET', '/auth/me')
      set({ session: me.user, account: me.account, myRoles: me.memberships })
    },
    myActivity: async (limit = 25) => (await api<{ items: ActivityItem[] }>('GET', `/auth/activity?limit=${limit}`)).items,
    signOutEverywhere: async () => {
      try { await api('POST', '/auth/sign-out-everywhere'); return null } catch (e) { return errorText(e) }
    },
    setSourceRef: (id, clause, version, effective, attest) => put(`/reqs/${enc(id)}/source-ref`, { clause, version, effective, attest }),
    linkEvidence: (reqId, doc, note) => post(`/reqs/${enc(reqId)}/evidence`, { doc, note }),
    assessEvidence: (reqId, idx, accept, reason) => {
      const ev = get().reqs.find((r) => r.id === reqId)?.evidence[idx]
      if (!ev?.id) return Promise.resolve('Evidence link not found. Refresh and try again.')
      return post(`/reqs/${enc(reqId)}/evidence/${enc(ev.id)}/assess`, { accept, reason })
    },
    addAction: (a) => post('/actions', a),
    progressAction: (id, to) => post(`/actions/${enc(id)}/progress`, { to }),
    assessUpdate: (id, applicable, reason) => post(`/updates/${enc(id)}/assess`, { applicable, reason }),
    createSnapshot: () => post('/snapshots'),

    addPin: async (p) => {
      const before = new Set(get().pins.map((x) => x.id))
      const error = await post('/pins', p)
      if (error) return { error }
      return { id: get().pins.find((x) => !before.has(x.id))?.id }
    },
    replyPin: (id, text, close) => post(`/pins/${enc(id)}/replies`, { text, close }),
    anchorPin: (id, place) => put(`/pins/${enc(id)}/anchor`, place),
    linkElement: (id, model, element) => put(`/pins/${enc(id)}/element`, { model, element }),
    navigate: (id) => post(`/pins/${enc(id)}/navigate`),
    setRevit: (on) => put('/settings/revit', { on }),
    createToken: async (name) => {
      const code = get().current
      if (!code) return { error: 'Open a project first.' }
      try {
        const r = await api<ProjectResponse & { token: string }>('POST', `/projects/${enc(code)}/connector-tokens`, { name })
        apply(code, r)
        return { token: r.token }
      } catch (e) {
        return { error: errorText(e) }
      }
    },
    revokeToken: (id) => del(`/connector-tokens/${enc(id)}`),
    importRevit: (id, snapshotId) => post(`/docs/${enc(id)}/imports`, { snapshotId }),
    fileBlob: (fileId) => fetchBlob(`/projects/${enc(get().current ?? '')}/files/${enc(fileId)}`),

    raiseRfi: (r) => post('/rfis', r),
    answerRfi: (id, response) => post(`/rfis/${enc(id)}/answer`, { response }),
    closeRfi: (id) => post(`/rfis/${enc(id)}/close`),
    requestInspection: (i) => post('/inspections', i),
    submitInspection: (id, evidence) => post(`/inspections/${enc(id)}/submit`, { evidence }),
    decideInspection: (id, accept, reason) => post(`/inspections/${enc(id)}/decide`, { accept, reason }),
    disposeFinding: (id, status, reason) => post(`/findings/${enc(id)}/dispose`, { status, reason }),
    addChange: (c) => post('/changes', c),
    assessChangeItem: (id, item, impact) => post(`/changes/${enc(id)}/impact`, { item, impact }),
    decideChange: (id, authorize, reason) => post(`/changes/${enc(id)}/decide`, { authorize, reason }),

    addRisk: (r) => post('/risks', r),
    updateRisk: (id, status, note) => post(`/risks/${enc(id)}/status`, { status, note }),
    raiseNcr: (n) => post('/ncrs', n),
    respondNcr: (id, rootCause, containment, correctiveAction) => post(`/ncrs/${enc(id)}/respond`, { rootCause, containment, correctiveAction }),
    closeNcr: (id, reason) => post(`/ncrs/${enc(id)}/close`, { reason }),
    reopenNcr: (id, reason) => post(`/ncrs/${enc(id)}/reopen`, { reason }),

    addCompany: (b) => post('/companies', b),
    updateCompany: (id, b) => put(`/companies/${enc(id)}`, b),
    addSystem: (b) => post('/systems', b),
    importSystems: (rows) => post('/systems/import', { rows }),
    updateSystem: (tag, b) => put(`/systems/${enc(tag)}`, b),
    addDiscipline: (name) => post('/disciplines', { name }),
    updateDiscipline: (id, b) => put(`/disciplines/${enc(id)}`, b),

    createProject: async (b) => {
      try {
        const r = await api<{ code: string }>('POST', '/projects', b)
        await get().loadAll()
        return { code: r.code }
      } catch (e) {
        return { error: errorText(e) }
      }
    },
    updateDetails: (b) => put('/details', b),
    archiveProject: (reason) => post('/archive', { reason }),
    restoreProject: (reason) => post('/restore', { reason }),
    setMember: (userId, role, scope) => put(`/members/${enc(userId)}`, { role, scope }),
    removeMember: (userId) => del(`/members/${enc(userId)}`),
  }
})

// A signed-in user whose token is refused (expired, revoked) gets the lock screen and keeps the page; otherwise sign out.
setUnauthorizedHandler(() => { const s = useStore.getState(); if (s.session && s.status === 'ready') s.lock('expired'); else s.logout() })

/* ---------- derived logic ---------- */
export function evidenceState(r: Requirement, docs: Doc[]): EvidenceState {
  if (r.applicability === 'Not applicable') return 'Not applicable'
  if (r.applicability === 'Assessment pending') return 'Assessment pending'
  // Withdrawn links (wrong document, voided or superseded document) are history only.
  const ev = r.evidence.filter((e) => e.decision !== 'Withdrawn')
  if (!ev.length) return 'Evidence missing'
  const byId = (id: string) => docs.find((d) => d.id === id)
  if (ev.some((e) => byId(e.doc)?.rev !== e.rev)) return 'Revision changed'
  if (ev.some((e) => e.decision === 'Rejected')) return 'Correction required'
  if (ev.every((e) => e.decision === 'Accepted' && byId(e.doc)?.status === 'Accepted')) return 'Evidence accepted'
  return 'Under assessment'
}

export function coverage(reqs: Requirement[], docs: Doc[]) {
  const required = reqs.filter((r) => r.applicability === 'Required')
  const accepted = required.filter((r) => evidenceState(r, docs) === 'Evidence accepted')
  const pending = reqs.filter((r) => r.applicability === 'Assessment pending')
  const gaps = required.filter((r) => evidenceState(r, docs) !== 'Evidence accepted')
  return { required, accepted, pending, gaps, pct: required.length ? Math.round((accepted.length / required.length) * 100) : null }
}

/** Void and superseded documents are register history: never overdue, not linkable, not counted. */
export const isActiveDoc = (d: Doc) => d.status !== 'Void' && d.status !== 'Superseded'
export const activeDocs = (docs: Doc[]) => docs.filter(isActiveDoc)
export const isOverdue = (d: Doc) => d.due < TODAY && d.status !== 'Accepted' && isActiveDoc(d)

/** The current revision has its own source (file or Revit snapshot); required before submission. */
export const hasCurrentSource = (d: Doc) => d.sourceRev === d.rev && !!d.checksum

/** What a new source does to a document (mirrors the server rule in server/src/services/documents.ts). */
export function sourcePlan(d: Doc) {
  const inPlace = d.status === 'Missing' || d.status === 'Draft'
  return { inPlace, toRev: inPlace ? d.rev : d.rev + 1, cancelsRoute: d.status === 'Under review' }
}

/** Handover document gate: every condition listed separately, never one blended score. */
export function handoverGates(p: ProjectData) {
  const scoped = p.reqs.filter((r) => p.markets.includes(r.market))
  const cov = coverage(scoped, p.docs)
  const gates = [
    { key: 'pending', label: 'Applicability decisions made', n: cov.pending.length, of: scoped.length, note: 'Requirements still “Assessment pending”', page: 'requirements' },
    { key: 'evidence', label: 'Required evidence accepted', n: cov.gaps.length, of: cov.required.length, note: 'Required topics without accepted, current evidence', page: 'requirements' },
    { key: 'docs', label: 'Critical documents accepted', n: activeDocs(p.docs).filter((d) => d.critical && d.status !== 'Accepted').length, of: activeDocs(p.docs).filter((d) => d.critical).length, note: 'Critical records not yet accepted', page: 'documents' },
    { key: 'comments', label: 'Technical comments closed', n: p.pins.filter((x) => x.status === 'Open').length, of: p.pins.length, note: 'Open anchored comments', page: 'comments' },
    { key: 'rfis', label: 'RFIs closed', n: p.rfis.filter((x) => x.status !== 'Closed').length, of: p.rfis.length, note: 'RFIs awaiting response or closure', page: 'rfis' },
    { key: 'insp', label: 'Inspections accepted', n: p.inspections.filter((x) => x.status !== 'Accepted').length, of: p.inspections.length, note: 'Inspections not yet accepted', page: 'inspections' },
    { key: 'find', label: 'Consistency findings dispositioned', n: p.findings.filter((x) => x.status === 'Open').length, of: p.findings.length, note: 'Open findings', page: 'findings' },
    { key: 'gaps', label: 'Corrective actions closed', n: p.actions.filter((x) => x.status !== 'Closed').length, of: p.actions.length, note: 'Actions not independently verified', page: 'actions' },
    { key: 'ncr', label: 'Non-conformances closed', n: p.ncrs.filter((x) => x.status !== 'Closed').length, of: p.ncrs.length, note: 'NCRs not yet verified and closed', page: 'ncrs' },
    { key: 'chg', label: 'Changes resolved', n: p.changes.filter((x) => x.status === 'Impact review' || x.status === 'Proposed').length, of: p.changes.length, note: 'Changes without an authorisation decision', page: 'changes' },
  ]
  return gates
}

/** Projects the signed-in user is a member of, in server order. */
export function useProjectList(): Profile[] {
  const summaries = useStore((s) => s.summaries)
  return useMemo(() => summaries.map((p) => p.profile), [summaries])
}

/** Active register entries of the open project, for pickers on new records. */
export function useRegisters() {
  const companies = useStore((s) => s.companies)
  const systems = useStore((s) => s.systems)
  const disciplines = useStore((s) => s.disciplines)
  return {
    companies: companies.filter((c) => c.active),
    systems: systems.filter((x) => x.active),
    disciplines: disciplines.filter((d) => d.active).map((d) => d.name),
    /** Every discipline name, including inactive ones, for filters over existing records. */
    allDisciplines: disciplines.map((d) => d.name),
  }
}
