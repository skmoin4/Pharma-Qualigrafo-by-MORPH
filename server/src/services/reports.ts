// PDF reports: handover dossier, audit evidence package, document transmittal.
// Generated on the server from the stored records; every page carries project, report id, who generated it and when.
// Each generation is written to the audit trail with the SHA-256 of the PDF, so a copy can be checked later.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { evidenceState, handoverGates, isActiveDoc, isOverdue } from '../domain/rules.ts'
import { markets as MARKETS } from '../domain/reference.ts'
import type { MarketKey, ProjectData } from '../domain/types.ts'
import type { TransmittalItem } from './transmittals.ts'
import type { ReviewDetail } from './accessReview.ts'
import type { IqResult } from './iq.ts'
import { traceability } from '../validation/catalogue.ts'
import type { OqResults } from '../validation/catalogue.ts'

const fontDir = path.join(path.dirname(createRequire(import.meta.url).resolve('dejavu-fonts-ttf/package.json')), 'ttf')
const FONT = path.join(fontDir, 'DejaVuSans.ttf')
const BOLD = path.join(fontDir, 'DejaVuSans-Bold.ttf')

const NAVY = '#15262f', MUTED = '#5b6b75', LINE = '#c9d3da', TEAL = '#0b7a75', RED = '#a93a33', FILL = '#f2f6f8'
const R = (n: number) => `R${String(n).padStart(2, '0')}`
const stamp = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
const day = (iso: string) => iso.slice(0, 10)

interface Meta { title: string; reportId: string; project: string; by: string }
interface Col { head: string; width: number; key?: string }

/** Thin layout layer over PDFKit: headings, key/value blocks, paged tables with repeated headers, page footers. */
class Report {
  doc: PDFKit.PDFDocument
  private chunks: Buffer[] = []
  private done: Promise<Buffer>
  readonly left = 48
  readonly width: number
  constructor(private meta: Meta) {
    this.doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 56, left: 48, right: 48 }, bufferPages: true, info: { Title: meta.title, Author: 'Qualigrafo', Subject: `${meta.project} · ${meta.reportId}`, Creator: 'Qualigrafo' } })
    this.width = this.doc.page.width - 96
    this.doc.registerFont('Body', FONT)
    this.doc.registerFont('Bold', BOLD)
    this.doc.font('Body').fontSize(9).fillColor(NAVY)
    this.doc.on('data', (b: Buffer) => this.chunks.push(b))
    this.done = new Promise((resolve) => this.doc.on('end', () => resolve(Buffer.concat(this.chunks))))
  }
  private room(h: number) { if (this.doc.y + h > this.doc.page.height - this.doc.page.margins.bottom) this.doc.addPage() }
  cover(title: string, subtitle: string, rows: [string, string][]) {
    const d = this.doc
    d.font('Bold').fontSize(9).fillColor(TEAL).text('QUALIGRAFO · PHARMA ENGINEERING EVIDENCE', this.left, 48)
    d.moveDown(0.8).font('Bold').fontSize(20).fillColor(NAVY).text(title)
    d.font('Body').fontSize(10.5).fillColor(MUTED).text(subtitle).moveDown(0.8)
    this.kv(rows)
  }
  h2(t: string) { this.room(40); this.doc.moveDown(0.9).font('Bold').fontSize(12).fillColor(NAVY).text(t, this.left).moveDown(0.3); this.doc.font('Body').fontSize(9) }
  p(t: string, o: { muted?: boolean; size?: number } = {}) { this.doc.font('Body').fontSize(o.size ?? 9).fillColor(o.muted ? MUTED : NAVY).text(t, this.left, undefined, { width: this.width }).moveDown(0.3).fillColor(NAVY) }
  notice(t: string, tone: 'info' | 'warn' = 'info') {
    const d = this.doc
    d.font('Body').fontSize(8.5)
    const h = d.heightOfString(t, { width: this.width - 16 }) + 12
    this.room(h + 6)
    const y = d.y
    d.save().rect(this.left, y, this.width, h).fill(tone === 'warn' ? '#fbf3e4' : FILL).restore()
    d.rect(this.left, y, 3, h).fill(tone === 'warn' ? '#c08a1e' : TEAL)
    d.fillColor(NAVY).text(t, this.left + 10, y + 6, { width: this.width - 16 })
    d.y = y + h + 6
    d.x = this.left
  }
  kv(rows: [string, string][]) {
    const d = this.doc
    const kw = 130
    for (const [k, v] of rows) {
      d.font('Body').fontSize(9)
      const h = Math.max(d.heightOfString(v || '—', { width: this.width - kw }), d.heightOfString(k, { width: kw - 8 }), 11) + 3
      this.room(h)
      const y = d.y
      d.fillColor(MUTED).text(k, this.left, y, { width: kw - 8 })
      d.fillColor(NAVY).text(v || '—', this.left + kw, y, { width: this.width - kw })
      d.y = y + h
    }
    d.x = this.left
  }
  table(cols: Col[], rows: (string | { text: string; color?: string; small?: string })[][], o: { empty?: string } = {}) {
    const d = this.doc
    const total = cols.reduce((a, c) => a + c.width, 0)
    const ws = cols.map((c) => (c.width / total) * this.width)
    const pad = 4
    const header = () => {
      d.font('Bold').fontSize(7.5)
      const h = Math.max(...cols.map((c, i) => d.heightOfString(c.head.toUpperCase(), { width: ws[i] - pad * 2 }))) + pad * 2
      this.room(h + 14)
      const y = d.y
      d.save().rect(this.left, y, this.width, h).fill(FILL).restore()
      let x = this.left
      cols.forEach((c, i) => { d.fillColor(MUTED).text(c.head.toUpperCase(), x + pad, y + pad, { width: ws[i] - pad * 2 }); x += ws[i] })
      d.y = y + h
    }
    header()
    if (!rows.length) { this.p(o.empty ?? 'None.', { muted: true }); return }
    for (const r of rows) {
      const cells = r.map((c) => (typeof c === 'string' ? { text: c } : c))
      const hOf = (c: { text: string; small?: string }, w: number) => {
        d.font('Body').fontSize(8.5)
        let h = d.heightOfString(c.text || '—', { width: w })
        if (c.small) { d.fontSize(7); h += d.heightOfString(c.small, { width: w }) + 1 }
        return h
      }
      const h = Math.max(...cells.map((c, i) => hOf(c, ws[i] - pad * 2))) + pad * 2
      if (d.y + h > d.page.height - d.page.margins.bottom) { d.addPage(); header() }
      const y = d.y
      let x = this.left
      cells.forEach((c, i) => {
        d.font('Body').fontSize(8.5).fillColor(c.color ?? NAVY).text(c.text || '—', x + pad, y + pad, { width: ws[i] - pad * 2 })
        if (c.small) d.fontSize(7).fillColor(MUTED).text(c.small, x + pad, d.y + 1, { width: ws[i] - pad * 2 })
        x += ws[i]
      })
      d.moveTo(this.left, y + h).lineTo(this.left + this.width, y + h).lineWidth(0.5).strokeColor(LINE).stroke()
      d.y = y + h
      d.fillColor(NAVY)
    }
    d.x = this.left
    d.moveDown(0.4)
  }
  async finish(): Promise<{ pdf: Buffer; sha256: string }> {
    const d = this.doc
    const at = stamp(new Date())
    const range = d.bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
      d.switchToPage(range.start + i)
      const bottom = d.page.margins.bottom
      d.page.margins.bottom = 0
      d.moveTo(this.left, d.page.height - 40).lineTo(this.left + this.width, d.page.height - 40).lineWidth(0.5).strokeColor(LINE).stroke()
      d.font('Body').fontSize(7).fillColor(MUTED)
        .text(`${this.meta.project} · ${this.meta.title.includes(this.meta.reportId) ? this.meta.title : `${this.meta.title} ${this.meta.reportId}`} · generated ${at} by ${this.meta.by}`, this.left, d.page.height - 34, { width: this.width - 70, height: 9, ellipsis: true, lineBreak: false })
        .text(`Page ${i + 1} of ${range.count}`, this.left + this.width - 70, d.page.height - 34, { width: 70, align: 'right', lineBreak: false })
      d.page.margins.bottom = bottom
    }
    d.end()
    const pdf = await this.done
    return { pdf, sha256: createHash('sha256').update(pdf).digest('hex') }
  }
}

const marketName = (m: string) => MARKETS[m as MarketKey]?.name ?? m
const projectRows = (p: ProjectData): [string, string][] => [
  ['Project', `${p.profile.name} (${p.profile.id})`],
  ['Client · site', `${p.profile.client} · ${p.profile.site}`],
  ['Facility · scope · phase', `${p.profile.facility} · ${p.profile.scope} · ${p.profile.phase}`],
  ['Target markets', p.markets.map(marketName).join(', ')],
  ['Requirement baseline', `B${p.baseline}`],
]
const DISCLAIMER = 'This report states the evidence status recorded in Qualigrafo for engineering documentation (premises, equipment, utilities, drawings, installation, commissioning and qualification records). It is not a regulatory approval or compliance certificate and does not cover manufacturing operations, laboratory or batch release.'

/* ---------------------------------------------------------------- handover dossier */

export async function handoverPdf(p: ProjectData, by: string, reportId: string) {
  const r = new Report({ title: 'Handover dossier', reportId, project: p.profile.id, by })
  const gates = handoverGates(p)
  const open = gates.filter((g) => g.n > 0)
  r.cover('Handover dossier', `${p.profile.name} — document-gate status, critical records and open items`, [...projectRows(p), ['Report', reportId], ['Generated by', by]])
  r.notice(open.length ? `Document gate: ${open.length} of ${gates.length} conditions open. Handover cannot be recommended from these records until they are cleared.` : `Document gate: all ${gates.length} conditions clear on the recorded evidence.`, open.length ? 'warn' : 'info')
  r.notice(DISCLAIMER)

  r.h2('1. Document-gate conditions')
  r.table([{ head: 'Condition', width: 5 }, { head: 'Satisfied', width: 1.6 }, { head: 'Open', width: 1 }, { head: 'State', width: 1.2 }],
    gates.map((g) => [g.label, `${g.of - g.n} of ${g.of}`, String(g.n), g.n ? { text: 'Open', color: RED } : { text: 'Clear', color: TEAL }]))

  r.h2('2. Requirement coverage per market')
  const scoped = p.reqs.filter((q) => p.markets.includes(q.market))
  r.table([{ head: 'Market', width: 3 }, { head: 'Required', width: 1 }, { head: 'Evidence accepted', width: 1.4 }, { head: 'Gaps', width: 1 }, { head: 'Applicability pending', width: 1.5 }],
    p.markets.map((m) => {
      const rs = scoped.filter((q) => q.market === m)
      const req = rs.filter((q) => q.applicability === 'Required')
      const acc = req.filter((q) => evidenceState(q, p.docs) === 'Evidence accepted')
      return [marketName(m), String(req.length), String(acc.length), String(req.length - acc.length), String(rs.filter((q) => q.applicability === 'Assessment pending').length)]
    }), { empty: 'No target markets.' })

  r.h2('3. Critical documents')
  const crit = p.docs.filter((d) => d.critical && isActiveDoc(d))
  r.table([{ head: 'Document', width: 4 }, { head: 'Rev', width: 0.7 }, { head: 'Status', width: 1.4 }, { head: 'Signatures of this revision', width: 4 }],
    crit.map((d) => {
      const sigs = d.signatures.filter((s) => s.rev === d.rev)
      return [{ text: d.title, small: `${d.number ? `${d.number} · ` : ''}${d.id} · ${d.owner}` }, R(d.rev), d.status === 'Accepted' ? { text: d.status, color: TEAL } : { text: d.status, color: RED },
        sigs.length ? { text: sigs.map((s) => `${s.name} (${s.role})`).join('; '), small: sigs.map((s) => `${s.meaning || 'sign-off'} · ${day(s.at)}${s.sigHash ? ' · e-signature' : ''}`).join('; ') } : { text: 'No sign-off', color: MUTED }]
    }), { empty: 'No critical documents in the register.' })

  r.h2('4. Open items')
  const items: string[][] = [
    ...crit.filter((d) => d.status !== 'Accepted').map((d) => ['Critical document', d.id, d.title, d.status]),
    ...p.pins.filter((x) => x.status === 'Open').map((x) => ['Technical comment', x.id, x.text, `${x.doc} ${R(x.rev)}`]),
    ...p.rfis.filter((x) => x.status !== 'Closed').map((x) => ['RFI', x.id, x.title, x.status]),
    ...p.inspections.filter((x) => x.status !== 'Accepted').map((x) => ['Inspection', x.id, x.title, x.status]),
    ...p.findings.filter((x) => x.status === 'Open').map((x) => ['Finding', x.id, x.title, x.severity]),
    ...p.actions.filter((x) => x.status !== 'Closed').map((x) => ['Corrective action', x.id, x.title, x.status]),
    ...p.ncrs.filter((x) => x.status !== 'Closed').map((x) => ['Non-conformance', x.id, x.title, `${x.severity} · ${x.status}`]),
    ...p.changes.filter((x) => x.status === 'Impact review' || x.status === 'Proposed').map((x) => ['Change', x.id, x.title, x.status]),
  ]
  r.table([{ head: 'Type', width: 1.6 }, { head: 'Ref', width: 1 }, { head: 'Title', width: 5 }, { head: 'State', width: 1.6 }], items, { empty: 'No open items.' })
  const overdue = p.docs.filter(isOverdue)
  if (overdue.length) r.p(`${overdue.length} document(s) overdue: ${overdue.map((d) => d.id).join(', ')}.`, { muted: true })

  r.h2('5. Controlled issues')
  r.table([{ head: 'Issue', width: 1 }, { head: 'Document', width: 4 }, { head: 'Rev', width: 0.7 }, { head: 'Signers', width: 4 }],
    p.issued.map((i) => [i.id, { text: i.title, small: i.doc }, R(i.rev), i.signers.map((s) => `${s.name} (${s.role}${s.meaning ? `, ${s.meaning}` : ''}) ${day(s.at)}`).join('; ')]), { empty: 'No controlled issues yet.' })
  return r.finish()
}

/* ---------------------------------------------------------------- audit evidence package (frozen snapshot) */

interface SnapshotRow { id: string; title: string; market: string; applicability: string; state: string; links: string }
export async function auditPackagePdf(p: ProjectData, s: { code: string; at: Date; byRole: string; baseline: number; markets: string[]; required: number; accepted: number; blockers: string[]; rows: SnapshotRow[] }, by: string, reportId: string) {
  const r = new Report({ title: `Audit evidence package ${s.code}`, reportId, project: p.profile.id, by })
  r.cover(`Audit evidence package ${s.code}`, `Frozen ${stamp(s.at)} by ${s.byRole}. Later changes in the project never alter this package.`, [
    ['Project', `${p.profile.name} (${p.profile.id})`], ['Client · site', `${p.profile.client} · ${p.profile.site}`],
    ['Requirement baseline', `B${s.baseline}`], ['Markets', s.markets.map(marketName).join(', ')],
    ['Evidence accepted', `${s.accepted} of ${s.required} required requirement(s)`], ['Outstanding', s.blockers.length ? `${s.blockers.length} requirement(s) not cleared — listed below` : 'None'],
    ['Report', reportId], ['Generated by', by],
  ])
  if (s.blockers.length) r.notice(`This package is incomplete: ${s.blockers.length} requirement(s) are not cleared (evidence not accepted, or applicability still to be decided). An incomplete state is never presented as certified.`, 'warn')
  r.notice(DISCLAIMER)
  r.h2('Outstanding items')
  const byState = new Map<string, string[]>()
  for (const b of s.blockers) { const [id, ...st] = b.split(': '); const k = st.join(': ') || 'Open'; byState.set(k, [...(byState.get(k) ?? []), id]) }
  r.table([{ head: 'Evidence state', width: 1.6 }, { head: 'No.', width: 0.6 }, { head: 'Requirements', width: 6 }], [...byState].map(([k, ids]) => [k, String(ids.length), ids.join(', ')]), { empty: 'None: every required requirement has accepted evidence.' })
  r.h2('Requirements and evidence')
  r.table([{ head: 'Requirement', width: 4.2 }, { head: 'Mkt', width: 0.6 }, { head: 'Applicability', width: 1.9 }, { head: 'Evidence state', width: 1.6 }, { head: 'Linked revisions', width: 2.6 }],
    s.rows.map((x) => [{ text: x.title, small: x.id }, x.market, x.applicability, x.state === 'Evidence accepted' ? { text: x.state, color: TEAL } : x.state === 'Not applicable' ? x.state : { text: x.state, color: RED }, x.links.replace(/; /g, '\n')]))
  return r.finish()
}

/* ---------------------------------------------------------------- document transmittal */

export async function transmittalPdf(p: ProjectData, t: { code: string; toCompany: string; purpose: string; note: string; createdByName: string; createdByRole: string; createdAt: Date; ackByName: string | null; ackAt: Date | null; ackNote: string | null; items: TransmittalItem[] }, by: string, reportId: string) {
  const r = new Report({ title: `Transmittal ${t.code}`, reportId, project: p.profile.id, by })
  r.cover(`Document transmittal ${t.code}`, `${t.purpose} · ${t.items.length} document(s)`, [
    ['Project', `${p.profile.name} (${p.profile.id}) · client ${p.profile.client}`], ['From', `${t.createdByName} (${t.createdByRole})`], ['To', t.toCompany],
    ['Purpose', t.purpose], ['Issued', stamp(t.createdAt)], ['Remarks', t.note || '—'],
  ])
  r.h2('Documents')
  r.table([{ head: '#', width: 0.4 }, { head: 'Document', width: 4.6 }, { head: 'Rev', width: 0.7 }, { head: 'Status', width: 1.4 }, { head: 'Approval of this revision', width: 3.2 }],
    t.items.map((i, n) => [String(n + 1),
      { text: i.title, small: `${i.number ? `${i.number} · ` : ''}${i.doc}${i.fileName ? ` · ${i.fileName}` : ''}${i.checksum ? `\nSHA-256 ${i.checksum}` : '\nNo source file on this revision'}` },
      R(i.rev), i.status,
      i.signatures.length ? { text: i.signatures.map((s) => `${s.name} (${s.role})`).join('; '), small: i.signatures.map((s) => `${s.meaning || 'sign-off'} · ${day(s.at)}`).join('; ') } : { text: 'Not signed', color: MUTED }]))
  r.h2('Receipt')
  if (t.ackAt) r.kv([['Acknowledged by', `${t.ackByName} (${t.toCompany})`], ['Date', stamp(t.ackAt)], ['Remarks', t.ackNote || '—']])
  else {
    r.p('Please confirm receipt in Qualigrafo (Reviews & approvals → Transmittals) or sign and return this page.', { muted: true })
    r.doc.moveDown(1.5)
    r.kv([['Received by (name)', '______________________________'], ['Signature', '______________________________'], ['Date', '______________________________']])
  }
  r.p('The SHA-256 value identifies the exact file of each revision: a copy whose checksum differs is not the transmitted document.', { muted: true, size: 7.5 })
  return r.finish()
}

/* ---------------------------------------------------------------- user-access review */

export async function accessReviewPdf(r: ReviewDetail, by: string, reportId: string) {
  const rep = new Report({ title: `Access review ${r.code}`, reportId, project: 'Installation', by })
  const n = (d: string) => r.items.filter((i) => i.decision === d).length
  rep.cover(`User-access review ${r.code}`, `${r.total} active account(s) · ${r.status}`, [
    ['Started', `${stamp(new Date(r.startedAt))} by ${r.startedBy}`], ['Target date', r.dueDate],
    ['Status', r.status === 'Completed' ? `Completed ${stamp(new Date(r.completedAt!))}` : r.status === 'Cancelled' ? `Cancelled: ${r.cancelReason ?? ''}` : 'Open — decisions in progress'],
    ['Outcome', `${n('Keep')} kept · ${n('Keep with changes')} kept with changes · ${n('Disable account')} disabled · ${r.total - r.decided} undecided`],
    ['Accounts flagged', `${r.flagged} of ${r.total}`],
  ])
  if (r.status !== 'Completed') rep.notice(`This review is ${r.status.toLowerCase()}; it is not a completed, signed review.`, 'warn')
  rep.h2('Accounts and decisions')
  rep.table([{ head: 'Account', width: 3 }, { head: 'Access at review start', width: 3.6 }, { head: 'Findings', width: 2.2 }, { head: 'Decision', width: 2.6 }],
    r.items.map((i) => [
      { text: i.name, small: `${i.email}${i.company ? ` · ${i.company}` : ''}\nLast sign-in: ${i.lastLoginAt ? day(i.lastLoginAt) : 'never'}` },
      { text: [i.isAdmin ? 'Administrator' : '', ...i.memberships.map((m) => `${m.project}: ${m.role}${m.scope ? ` (only ${m.scope})` : ''}${m.archived ? ' [archived]' : ''}`)].filter(Boolean).join('\n') || 'No access' },
      i.flags.length ? { text: i.flags.join('\n'), color: RED } : { text: 'None', color: MUTED },
      i.decision ? { text: i.decision, color: i.decision === 'Disable account' ? RED : NAVY, small: `${i.note ? `${i.note}\n` : ''}${i.decidedBy} · ${day(i.decidedAt!)}${i.selfReview ? ' · SELF-REVIEW' : ''}` } : { text: 'Undecided', color: MUTED },
    ]))
  if (r.items.some((i) => i.selfReview)) rep.p('SELF-REVIEW: the reviewer decided on their own account. Consider an independent check by another administrator.', { muted: true, size: 7.5 })
  rep.h2('Electronic signature')
  if (r.status === 'Completed') {
    rep.kv([['Signed by', `${r.completedBy}`], ['Date and time', stamp(new Date(r.completedAt!))], ['Meaning', r.meaning ?? ''], ['Conclusion', r.conclusion ?? ''], ['Signature hash', `${r.sigHash} (${r.signature})`]])
    rep.p('The signature hash covers the review code, every account decision and note, the signer, the meaning, the conclusion and the time; Qualigrafo recomputes it to detect changes made outside the application.', { muted: true, size: 7.5 })
  } else rep.p('Not signed.', { muted: true })
  rep.p(`Scope: active accounts of this Qualigrafo installation and their project roles at the start of the review. Accounts disabled before the review are not listed. Flag "No sign-in for 90+ days" uses the last successful sign-in.`, { muted: true, size: 7.5 })
  return rep.finish()
}

/* ---------------------------------------------------------------- installation qualification + validation pack */

const IQ_COLOR: Record<string, string> = { Pass: TEAL, Fail: RED, Warning: '#a76a00', Info: MUTED }

function iqSection(rep: Report, iq: IqResult) {
  rep.kv([['Executed', `${stamp(new Date(iq.executedAt))} by ${iq.executedBy}`], ['Application version', iq.version], ['Code fingerprint', iq.fingerprint], ['Overall result', iq.overall === 'Pass' ? `Pass (${iq.checks.filter((c) => c.status === 'Warning').length} warning(s) to review)` : 'FAIL — correct the failed checks and execute again']])
  rep.table([{ head: 'Check', width: 2.6 }, { head: 'Expected', width: 3.4 }, { head: 'Found', width: 4 }, { head: 'Result', width: 1.2 }],
    iq.checks.map((c) => [{ text: c.title, small: c.id }, c.expected, c.actual, { text: c.status, color: IQ_COLOR[c.status] }]))
  rep.p('Pass = as specified. Fail = must be corrected before productive use. Warning = deviation from the recommended configuration; justify or correct. Info = recorded value.', { muted: true, size: 7.5 })
}

const SIGN_BLOCK: [string, string][] = [['Name', '______________________________'], ['Signature', '______________________________'], ['Date', '______________________________']]

export async function iqPdf(iq: IqResult, by: string, reportId: string, installation: string) {
  const rep = new Report({ title: 'Installation qualification record', reportId, project: 'Installation', by })
  rep.cover('Installation qualification (IQ) record', `Qualigrafo ${iq.version} · result ${iq.overall}`, [['Report', reportId], ['Installation', installation]])
  rep.h2('Checks')
  iqSection(rep, iq)
  rep.h2('Executed by')
  rep.kv(SIGN_BLOCK)
  rep.h2('Reviewed by (customer QA)')
  rep.kv(SIGN_BLOCK)
  return rep.finish()
}

export async function validationPackPdf(o: { oq: OqResults; iq: IqResult; by: string; reportId: string }) {
  const { oq, iq } = o
  const trace = traceability(oq)
  const rep = new Report({ title: `Validation pack ${iq.version}`, reportId: o.reportId, project: 'Qualigrafo', by: o.by })
  const failed = oq.cases.flatMap((c) => c.checks.filter((k) => !k.pass).map((k) => ({ c, k })))
  rep.cover('Validation pack', `Qualigrafo ${iq.version} · supplier test evidence for computerised-system validation`, [
    ['Document', o.reportId], ['Software version', iq.version], ['Code fingerprint', iq.fingerprint],
    ['OQ executed', `${stamp(new Date(oq.executedAt))} by ${oq.executedBy} · ${Math.max(1, Math.round(oq.durationSec / 60))} min`],
    ['OQ result', `${oq.totals.passed} of ${oq.totals.checks} checks passed in ${oq.totals.cases} test cases${oq.totals.failed ? ` · ${oq.totals.failed} FAILED` : ''}`],
    ['IQ result (test environment)', iq.overall],
    ['Requirements', `${trace.length} user requirements · ${trace.filter((t) => t.verdict === 'Pass').length} verified by passing tests · ${trace.filter((t) => t.verdict === 'Procedural').length} procedural`],
  ])
  if (oq.environment['Code fingerprint'] !== iq.fingerprint) rep.notice(`DRAFT — not valid as release evidence: the code changed after the OQ run (OQ fingerprint ${oq.environment['Code fingerprint']}, installed ${iq.fingerprint}). Run the OQ again before issuing this pack.`, 'warn')
  rep.notice('Purpose and limits: this pack is the supplier documentation (requirements, risk assessment, installation and operational test results, traceability) that supports the customer validation of Qualigrafo as a GxP computerised system (GAMP 5 risk-based approach). It does not replace that validation: the customer approves the URS for their intended use, decides the GAMP category (proposed: Category 4, configured product), executes IQ on their installation (Administration → System & validation), may repeat OQ in their validation environment, and performs PQ / user acceptance under their own procedures. Regulatory references show which clause a requirement relates to; they are not a statement of compliance.')

  rep.h2('1. System description')
  rep.p('Qualigrafo manages engineering evidence for pharmaceutical facility projects: document register with two-stage electronic sign-off, requirement library and project requirements, evidence links, site records (RFIs, inspections, NCRs, risks, change impact), reports and handover. Server: Node.js + Express + PostgreSQL; browser client: React. Users and roles are managed in the application (one installation per customer). Electronic records: audit trail, security log, signatures, files with SHA-256.')
  rep.kv(Object.entries(oq.environment))

  rep.h2('2. User requirements (URS)')
  rep.table([{ head: 'ID', width: 0.9 }, { head: 'Requirement', width: 6.2 }, { head: 'GxP', width: 0.9 }, { head: 'Relates to', width: 2.2 }],
    trace.map((u) => [u.id, { text: u.title, small: `${u.area} · ${u.text}` }, u.gxp, u.ref]))

  rep.h2('3. Risk assessment')
  rep.p('Method (GAMP 5): severity of harm to product quality, patient safety or data integrity × probability of the failure gives the risk class (1 = highest); risk class × detectability gives the priority. High-priority functions are tested in depth (positive and negative cases).', { muted: true })
  rep.table([{ head: 'ID', width: 0.9 }, { head: 'Function', width: 2.6 }, { head: 'S / P / D', width: 1.6 }, { head: 'Class', width: 0.9 }, { head: 'Priority', width: 1.3 }, { head: 'Controls', width: 4.1 }],
    trace.map((u) => [u.id, u.title, `${u.severity} / ${u.probability} / ${u.detectability}`, String(u.riskClass), { text: u.priority, color: u.priority === 'High' ? RED : NAVY }, u.controls]))

  rep.h2('4. Installation qualification (test environment)')
  iqSection(rep, iq)

  rep.h2('5. Operational qualification — summary')
  rep.table([{ head: 'Test case', width: 1.2 }, { head: 'Title', width: 5.6 }, { head: 'Checks', width: 1.1 }, { head: 'Result', width: 1 }, { head: 'Requirements', width: 2 }],
    oq.cases.map((c) => [c.id, { text: c.title, small: c.suite === 'api' ? 'API test suite' : `Browser suite ${c.suite}` }, `${c.passed}/${c.checks.length}`, { text: c.failed ? 'Fail' : c.checks.length ? 'Pass' : 'No checks', color: c.failed || !c.checks.length ? RED : TEAL }, trace.filter((u) => u.tests.includes(c.id)).map((u) => u.id).join(', ')]))

  rep.h2('6. Traceability matrix')
  rep.table([{ head: 'Requirement', width: 3.3 }, { head: 'Priority', width: 1.3 }, { head: 'Test cases', width: 3.9 }, { head: 'Checks', width: 1.2 }, { head: 'Verdict', width: 1.3 }],
    trace.map((u) => [{ text: u.id, small: u.title }, u.priority, u.tests.join(', ') || (u.procedural ?? '—'), String(u.checks), { text: u.verdict, color: u.verdict === 'Pass' ? TEAL : u.verdict === 'Procedural' ? MUTED : RED }]))

  rep.h2('7. Deviations')
  if (failed.length) rep.table([{ head: 'Test case', width: 1.2 }, { head: 'Failed check', width: 8 }], failed.map(({ c, k }) => [c.id, k.text]))
  else rep.p('None: every executed check passed.')
  const proc = trace.filter((u) => u.verdict === 'Procedural')
  if (proc.length) rep.p(`Not verified by software tests (procedural controls): ${proc.map((u) => `${u.id} ${u.title} — ${u.procedural}`).join(' ')}`, { muted: true })

  rep.h2('8. Approval')
  rep.p('Prepared by (supplier)', { muted: true }); rep.kv(SIGN_BLOCK)
  rep.p('Reviewed and approved by (customer QA)', { muted: true }); rep.kv(SIGN_BLOCK)

  rep.h2('Annex — every OQ check')
  for (const c of oq.cases) {
    rep.p(`${c.id} · ${c.title} (${c.passed}/${c.checks.length})`, { size: 8.5 })
    rep.table([{ head: '#', width: 0.5 }, { head: 'Check (expected behaviour verified)', width: 8.5 }, { head: 'Result', width: 1 }],
      c.checks.map((k, i) => [String(i + 1), k.text, { text: k.pass ? 'Pass' : 'FAIL', color: k.pass ? TEAL : RED }]))
  }
  return rep.finish()
}
