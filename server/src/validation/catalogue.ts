// Validation catalogue (Phase 2 / C7): user requirements (URS), their risk assessment (GAMP 5 method) and the OQ
// test cases that verify them. Single source of truth for the API suite's section markers, the OQ runner, the
// traceability matrix and the validation pack. Regulatory references say which clause a requirement relates to;
// they are not a statement of compliance — the customer validates the system for their intended use.

export type Level = 'High' | 'Medium' | 'Low'
/** `fixtures`: extra arguments for `npm run fixtures:load` before the suite (e.g. load-test projects). */
export interface OqCase { id: string; title: string; suite: string; fixtures?: string }
export interface Urs {
  id: string
  area: string
  title: string
  text: string
  /** Direct = supports a GxP decision or record; Indirect = supports such functions. */
  gxp: 'Direct' | 'Indirect'
  ref: string
  severity: Level
  probability: Level
  detectability: Level
  controls: string
  tests: string[]
  /** Set when the requirement is met by a procedure or a later release, not by a test of this version. */
  procedural?: string
}

/* ------------------------------------------------------------ OQ test cases */

export const OQ_CASES: OqCase[] = [
  { id: 'OQ-API-01', title: 'Health check and authentication', suite: 'api' },
  { id: 'OQ-API-02', title: 'Document submission and two-stage sign-off', suite: 'api' },
  { id: 'OQ-API-03', title: 'File upload, server-side SHA-256 and storage', suite: 'api' },
  { id: 'OQ-API-04', title: 'A new revision requires fresh approval', suite: 'api' },
  { id: 'OQ-API-05', title: 'Evidence becomes stale after a revision', suite: 'api' },
  { id: 'OQ-API-06', title: 'Source import cancels the pending route; duplicates rejected', suite: 'api' },
  { id: 'OQ-API-07', title: 'Return for changes', suite: 'api' },
  { id: 'OQ-API-08', title: 'Source reference attestation', suite: 'api' },
  { id: 'OQ-API-09', title: 'Evidence linking and independent acceptance', suite: 'api' },
  { id: 'OQ-API-10', title: 'Non-conformance (NCR) rules', suite: 'api' },
  { id: 'OQ-API-11', title: 'Risk register rules', suite: 'api' },
  { id: 'OQ-API-12', title: 'RFIs, inspections, change impact, regulatory updates, audit snapshots', suite: 'api' },
  { id: 'OQ-API-13', title: 'Reminders sent by reviewers; working date', suite: 'api' },
  { id: 'OQ-API-14', title: 'Notification read state per user', suite: 'api' },
  { id: 'OQ-API-15', title: 'Server-side attributed audit trail and export', suite: 'api' },
  { id: 'OQ-API-16', title: 'Sign-in lockout and security log', suite: 'api' },
  { id: 'OQ-API-17', title: 'Vendor account isolation', suite: 'api' },
  { id: 'OQ-API-18', title: 'User administration, temporary passwords, session revocation', suite: 'api' },
  { id: 'OQ-API-19', title: 'Company, system and discipline registers', suite: 'api' },
  { id: 'OQ-API-20', title: 'Project lifecycle and team', suite: 'api' },
  { id: 'OQ-API-21', title: 'Drawing-anchored comments and Revit connector', suite: 'api' },
  { id: 'OQ-API-22', title: 'Requirement library: versions, four-eyes approval, project updates', suite: 'api' },
  { id: 'OQ-API-23', title: 'Document register: create, edit, void / supersede, register import', suite: 'api' },
  { id: 'OQ-API-24', title: 'Record edits with reason; manual findings', suite: 'api' },
  { id: 'OQ-API-25', title: 'Electronic signatures and session timeout', suite: 'api' },
  { id: 'OQ-API-26', title: 'Audit trail with old -> new values', suite: 'api' },
  { id: 'OQ-API-27', title: 'PDF reports and document transmittals', suite: 'api' },
  { id: 'OQ-API-28', title: 'E-mail notifications, scheduled reminders, security alerts', suite: 'api' },
  { id: 'OQ-API-29', title: 'Periodic user-access review', suite: 'api' },
  { id: 'OQ-API-30', title: 'Installation check (IQ) and validation catalogue', suite: 'api' },
  { id: 'OQ-API-31', title: 'Backups, tamper detection, test restore, retention and disaster-recovery restore', suite: 'api' },
  { id: 'OQ-API-32', title: 'Portfolio summaries equal the full project computation for every role', suite: 'api' },
  { id: 'OQ-API-33', title: 'Monitoring: structured logs, error tracking, job health, alerts and metrics', suite: 'api' },
  { id: 'OQ-API-34', title: 'Personal account page: own data, roles, sessions and activity', suite: 'api' },
  { id: 'OQ-UI-01', title: 'Every page on desktop and mobile; approval workflow; persistence and project isolation', suite: 'e2e' },
  { id: 'OQ-UI-02', title: 'Feature flows: RFI, inspection, findings, change impact, actions, updates, registers, NCR, risk, vendor portal, audit rehearsal', suite: 'e2e2' },
  { id: 'OQ-UI-03', title: 'Security: lockout, user administration, forced password change, vendor access', suite: 'e2e3' },
  { id: 'OQ-UI-04', title: 'Project lifecycle: wizard, team, details, archive and restore', suite: 'e2e4' },
  { id: 'OQ-UI-05', title: 'Drawing-anchored comments and Revit connector round trip', suite: 'e2e5' },
  { id: 'OQ-UI-06', title: 'Requirement library and four-eyes approval', suite: 'e2e6' },
  { id: 'OQ-UI-07', title: 'Document register and Master Document Register import', suite: 'e2e7' },
  { id: 'OQ-UI-08', title: 'Record edits with reason and old -> new audit', suite: 'e2e8' },
  { id: 'OQ-UI-09', title: 'Electronic signature and inactivity lock', suite: 'e2e9' },
  { id: 'OQ-UI-10', title: 'PDF reports and transmittals', suite: 'e2e10' },
  { id: 'OQ-UI-11', title: 'E-mail notifications and reminders', suite: 'e2e11' },
  { id: 'OQ-UI-12', title: 'Periodic user-access review', suite: 'e2e12' },
  { id: 'OQ-UI-13', title: 'Installation check and validation pack', suite: 'e2e13' },
  { id: 'OQ-UI-14', title: 'Backups administration: schedule, back up now, test restore', suite: 'e2e14' },
  { id: 'OQ-UI-15', title: 'Portfolio at scale: 100+ projects from summaries, project loaded on opening', suite: 'e2e15', fixtures: '--projects 100' },
  { id: 'OQ-UI-16', title: 'Monitoring administration: health, background jobs, error handling, alert settings', suite: 'e2e16' },
  { id: 'OQ-UI-17', title: 'My profile: account facts, own roles, password, sessions, notifications, activity', suite: 'e2e17' },
]
export const oqCase = (id: string) => OQ_CASES.find((c) => c.id === id)

/* ------------------------------------------------------------ user requirements + risk */

const r = (id: string, area: string, title: string, text: string, gxp: Urs['gxp'], ref: string, [severity, probability, detectability]: [Level, Level, Level], controls: string, tests: string[], procedural?: string): Urs =>
  ({ id, area, title, text, gxp, ref, severity, probability, detectability, controls, tests, procedural })

export const URS: Urs[] = [
  r('URS-01', 'Access control', 'Personal accounts and passwords', 'Each user signs in with a personal account (e-mail + password). Passwords follow a policy, temporary passwords must be changed at first sign-in, and accounts can be disabled without deleting history.', 'Direct', '21 CFR 11.10(d), 11.300; EU GMP Annex 11 §12', ['High', 'Medium', 'Medium'], 'Server-side password policy and hashing (bcrypt); forced change after admin reset; token revocation on password change / disable.', ['OQ-API-01', 'OQ-API-18', 'OQ-UI-03']),
  r('URS-02', 'Access control', 'Role-based permissions per project', 'Every action is allowed or refused by the server according to the user\'s role on that project (Consultant, Contractor, Owner / QA); the client can never claim a role.', 'Direct', '21 CFR 11.10(d), (g); Annex 11 §12', ['High', 'Medium', 'Medium'], 'Role read from the membership on every request; HTTP 403 on every refused action; tests per role.', ['OQ-API-02', 'OQ-API-18', 'OQ-API-20', 'OQ-UI-01', 'OQ-UI-04']),
  r('URS-03', 'Access control', 'Vendor accounts limited to their company', 'A contractor account can be limited to one company and then sees and changes only that company\'s documents and related records.', 'Direct', '21 CFR 11.10(d); Annex 11 §12', ['High', 'Low', 'Medium'], 'Scope filter in the payload builder and in every lookup (other records answer 404).', ['OQ-API-17', 'OQ-UI-03']),
  r('URS-04', 'Access control', 'Lockout after failed sign-ins', 'Repeated failed sign-ins or signature passwords lock the account temporarily; failures and lockouts are logged and the account holder is alerted.', 'Indirect', 'Annex 11 §12', ['Medium', 'Medium', 'High'], 'In-process limiter (5 per account / 20 per address in 15 min), security log, e-mail alert.', ['OQ-API-16', 'OQ-API-25', 'OQ-API-28', 'OQ-UI-03']),
  r('URS-05', 'Access control', 'Inactivity timeout', 'An idle session locks after a configured time and needs the password to continue; every session has an absolute maximum length.', 'Indirect', 'Annex 11 §12', ['Medium', 'Medium', 'High'], 'Short-lived tokens refreshed only by activity; lock screen; absolute session start in the token.', ['OQ-API-25', 'OQ-UI-09']),
  r('URS-06', 'Access control', 'Security log of access administration', 'User and access administration, sign-ins, signatures and settings changes are recorded in an append-only security log with actor, time and old -> new values.', 'Direct', '21 CFR 11.10(e); Annex 11 §12', ['Medium', 'Low', 'Medium'], 'Single logging helper used by every route; tests read the log back.', ['OQ-API-16', 'OQ-API-18', 'OQ-API-26']),
  r('URS-07', 'Access control', 'Periodic access review', 'Administrators review every active account and its roles at a set interval, record a decision per account, and sign the review; the report is kept.', 'Direct', 'Annex 11 §12; 21 CFR 11.10(d)', ['Medium', 'Medium', 'Medium'], 'Due reminders, snapshot with findings, e-signed completion with hash, PDF report.', ['OQ-API-29', 'OQ-UI-12']),
  r('URS-08', 'Audit trail', 'Computer-generated audit trail', 'Every creation, change and decision is recorded by the server with date/time, user and role; entries cannot be changed or deleted through the application.', 'Direct', '21 CFR 11.10(e); Annex 11 §9', ['High', 'Low', 'Medium'], 'Audit row written in the same transaction as the change; no update / delete endpoint for audit rows.', ['OQ-API-15', 'OQ-API-26', 'OQ-UI-02', 'OQ-UI-08']),
  r('URS-09', 'Audit trail', 'Old and new values with reason', 'Changes to records state the previous and the new value of every changed field and the reason given.', 'Direct', '21 CFR 11.10(e); Annex 11 §9', ['High', 'Medium', 'Medium'], 'Shared change-list helper; edits refused without a reason or without a change.', ['OQ-API-23', 'OQ-API-24', 'OQ-API-26', 'OQ-UI-08']),
  r('URS-10', 'Audit trail', 'Audit trail review and export', 'The complete audit trail of a project can be read in the application and exported (CSV) for review.', 'Direct', '21 CFR 11.10(b), (e); Annex 11 §9', ['Medium', 'Low', 'High'], 'Paged audit endpoint and CSV export of the full server trail.', ['OQ-API-15', 'OQ-UI-02']),
  r('URS-11', 'Electronic signatures', 'Signature with re-authentication and meaning', 'Each electronic signature requires the password again and records printed name, date and time and the meaning of the signature.', 'Direct', '21 CFR 11.50, 11.200; Annex 11 §14', ['High', 'Medium', 'Medium'], 'Password check before every signature; meaning per stage shown before signing and stored.', ['OQ-API-22', 'OQ-API-25', 'OQ-API-29', 'OQ-UI-06', 'OQ-UI-09', 'OQ-UI-12']),
  r('URS-12', 'Electronic signatures', 'Signature linked to the signed content', 'A signature is bound to the exact content signed (file checksum) and to its fields, so later changes are detected.', 'Direct', '21 CFR 11.70', ['High', 'Low', 'Medium'], 'SHA-256 signature hash recomputed on verification (Valid / Altered).', ['OQ-API-25', 'OQ-API-29', 'OQ-UI-09']),
  r('URS-13', 'Electronic signatures', 'Independent approval', 'Documents need two sign-off stages by different roles; nobody accepts evidence they submitted; library versions need a second person (four eyes).', 'Direct', 'Annex 11 §14; GMP independence of review', ['High', 'Medium', 'Medium'], 'Server checks role, stage and user id; four-eyes rule on library approval.', ['OQ-API-02', 'OQ-API-09', 'OQ-API-22', 'OQ-UI-01', 'OQ-UI-06']),
  r('URS-14', 'Documents', 'Document register', 'Documents are registered, edited with a reason, voided or superseded (never deleted) and can be imported from a Master Document Register.', 'Direct', 'Annex 11 §4.8 (data migration), §9', ['Medium', 'Medium', 'Medium'], 'Preview + all-or-nothing import with row errors; void keeps history.', ['OQ-API-23', 'OQ-UI-07']),
  r('URS-15', 'Documents', 'File integrity', 'Uploaded files are stored with a server-computed SHA-256; submitted content is never overwritten; identical content cannot be imported twice.', 'Direct', 'Annex 11 §7.1; 21 CFR 11.10(c)', ['High', 'Low', 'Medium'], 'Content-addressed storage; checksum on download; new revision instead of overwrite.', ['OQ-API-03', 'OQ-API-06']),
  r('URS-16', 'Documents', 'Revision control', 'A new revision needs fresh approval; signatures stay with the revision they were given for; returned documents cancel the route.', 'Direct', 'Annex 11 §10 (change and configuration management)', ['High', 'Medium', 'Medium'], 'Sign stage reset on revision; signatures stored per revision.', ['OQ-API-04', 'OQ-API-07', 'OQ-UI-01']),
  r('URS-17', 'Documents', 'Controlled issue and transmittals', 'Issued documents and transmittals record the exact revision, file checksum and approvals at the time of issue; receipt is acknowledged.', 'Direct', 'Annex 11 §8 (printouts)', ['Medium', 'Low', 'Medium'], 'Items frozen at issue; acknowledgement by the receiving company only.', ['OQ-API-27', 'OQ-UI-10']),
  r('URS-18', 'Requirements', 'Customer-approved requirement library', 'Requirement content is maintained in a versioned library approved by the customer; unverified starter content is labelled as such and never presented as verified regulation.', 'Direct', 'GAMP 5 (user responsibility for content)', ['High', 'Low', 'Medium'], 'Draft -> Approved -> Superseded with four-eyes approval; "Unverified starter template" label.', ['OQ-API-22', 'OQ-UI-06']),
  r('URS-19', 'Requirements', 'Project requirements and applicability', 'Projects take requirements from approved library versions; applicability decisions and source attestations are recorded with rationale.', 'Direct', 'Annex 11 §9', ['Medium', 'Medium', 'Medium'], 'Rationale required; attestation by reviewers only.', ['OQ-API-08', 'OQ-API-22', 'OQ-UI-02']),
  r('URS-20', 'Requirements', 'Evidence status', 'Requirements are linked to documents as evidence; only accepted current revisions count; evidence on a superseded revision is flagged as stale.', 'Direct', 'Data integrity (ALCOA+)', ['High', 'Medium', 'Medium'], 'Evidence state derived on the server from document revision and decision.', ['OQ-API-05', 'OQ-API-09', 'OQ-UI-01']),
  r('URS-21', 'Requirements', 'Controlled updates', 'Library and regulatory updates change a project only after an assessed decision by Owner / QA.', 'Direct', 'Annex 11 §10', ['Medium', 'Medium', 'Medium'], 'Updates queued per project; nothing changes without a decision.', ['OQ-API-12', 'OQ-API-22', 'OQ-UI-02']),
  r('URS-22', 'Projects', 'Project lifecycle', 'Authorised users create, edit and archive projects; archived projects are read-only; nothing is deleted.', 'Indirect', 'Annex 11 §17 (archiving)', ['Medium', 'Low', 'High'], 'Archive flag checked in every write transaction.', ['OQ-API-20', 'OQ-UI-04']),
  r('URS-23', 'Projects', 'Registers', 'Companies, systems / equipment and disciplines are maintained in registers and only registered, active entries can be used in records.', 'Indirect', 'Data integrity (consistency)', ['Medium', 'Medium', 'High'], 'Server validation of every reference; renames carried over.', ['OQ-API-19', 'OQ-UI-02']),
  r('URS-24', 'Site and change', 'RFIs, inspections, findings and change impact', 'Site records follow role and state rules (e.g. only reviewers answer RFIs or authorise changes, a change cannot be authorised while items are unassessed).', 'Direct', 'Annex 11 §10', ['Medium', 'Medium', 'Medium'], 'State machines enforced on the server.', ['OQ-API-12', 'OQ-API-24', 'OQ-UI-02']),
  r('URS-25', 'Quality', 'Non-conformances and risks', 'NCRs and risks follow severity and closure rules; only Owner / QA closes or downgrades critical NCRs.', 'Direct', 'GMP quality risk management (ICH Q9)', ['High', 'Medium', 'Medium'], 'Role checks on close / downgrade; reason required.', ['OQ-API-10', 'OQ-API-11', 'OQ-API-24', 'OQ-UI-02', 'OQ-UI-08']),
  r('URS-26', 'Reports', 'Accurate reports', 'Reports (handover dossier, audit package, transmittal, access review) are generated from the stored records; every generation is logged with the file\'s SHA-256.', 'Direct', '21 CFR 11.10(b); Annex 11 §8', ['Medium', 'Low', 'Medium'], 'Server-side PDF generation; hash header and log entry.', ['OQ-API-27', 'OQ-API-29', 'OQ-UI-10', 'OQ-UI-12']),
  r('URS-27', 'Reports', 'Frozen audit packages', 'An audit evidence package, once frozen, is not changed by later work.', 'Direct', 'Annex 11 §8', ['Medium', 'Low', 'Medium'], 'Snapshot stored at freeze time; report built from the snapshot.', ['OQ-API-12', 'OQ-API-27']),
  r('URS-28', 'Notifications', 'In-app notifications', 'Users see notifications addressed to their role; read state is personal.', 'Indirect', '—', ['Low', 'Medium', 'High'], 'Per-user read table.', ['OQ-API-14', 'OQ-UI-02']),
  r('URS-29', 'Notifications', 'Reminders and e-mail', 'Waiting sign-offs and overdue items are reminded daily (in-app and e-mail); a reminder never approves anything; every e-mail and its delivery result is recorded.', 'Indirect', '—', ['Low', 'Medium', 'Medium'], 'Transactional outbox, retries, once-per-day run, delivery log.', ['OQ-API-13', 'OQ-API-28', 'OQ-UI-11']),
  r('URS-30', 'Notifications', 'Security alerts', 'Account holders are e-mailed about security-relevant events on their account; temporary passwords are never e-mailed.', 'Indirect', 'Annex 11 §12', ['Medium', 'Low', 'Medium'], 'Alerts sent regardless of preference; tests check content.', ['OQ-API-28']),
  r('URS-31', 'Integrations', 'Revit connector and drawing comments', 'The Revit add-in uses project-scoped, revocable tokens; comments can be anchored on the uploaded drawing of a revision.', 'Indirect', 'Annex 11 §5 (data exchange)', ['Medium', 'Low', 'Medium'], 'Token hashes only; integration switch; duplicate-version check.', ['OQ-API-21', 'OQ-UI-05']),
  r('URS-32', 'Platform', 'Verifiable installation', 'An installation can be checked for software version, code fingerprint, dependencies, database migrations, configuration, storage and administrator access (IQ).', 'Indirect', 'GAMP 5 (installation verification)', ['Medium', 'Medium', 'High'], 'Installation check in the application and as PDF record.', ['OQ-API-30', 'OQ-UI-13']),
  r('URS-33', 'Platform', 'Date and time', 'Time stamps are stored in UTC; due / overdue logic uses the working date of the site time zone.', 'Direct', '21 CFR 11.10(e); Annex 11 §9', ['Medium', 'Low', 'Medium'], 'Server clock only; APP_TIMEZONE validated at start.', ['OQ-API-13', 'OQ-API-15']),
  r('URS-35', 'Platform', 'Portfolio at scale', 'The portfolio, My work and Regulatory watch stay fast with many projects: the server sends one summary per project, with the same figures, work items and flags as the full project computation.', 'Indirect', '—', ['Medium', 'Medium', 'High'], 'Batch queries for all projects; summaries computed by the same rules as the project pages; equality tested per role; load-test tool (npm run perf:portfolio).', ['OQ-API-32', 'OQ-UI-15']),
  r('URS-36', 'Platform', 'Monitoring and alerting', 'Operation of the installation is observable: every request and every unexpected error is logged with a traceable request id, errors are grouped and tracked until an administrator resolves them, and administrators are alerted by e-mail when a background job stops, when the application was not running, when errors come in a burst or when disk space runs low.', 'Indirect', 'EU GMP Annex 11 §7.1, §10; GAMP 5 (operational monitoring)', ['Medium', 'Medium', 'Medium'], 'Structured log (JSON lines, daily files with retention) carrying the request id that is also stored on the audit entries; error groups with acknowledge / resolve and a note; heartbeat per background job plus an API heartbeat whose gaps are recorded as outages; throttled alert e-mails with a security-log entry; token-protected /api/metrics for an external uptime tool; IQ-19 to IQ-22.', ['OQ-API-33', 'OQ-UI-16']),
  r('URS-37', 'Access control', 'Personal account page', 'Every user can see their own account (name, company, administrator rights, when it was created, last sign-in, when the password was last changed), the role and record access they hold on each project, and what they did lately; they can change their own password and e-mail preference and end all their sessions. Account data itself is maintained by an administrator.', 'Indirect', '21 CFR 11.10(d); EU GMP Annex 11 §12', ['Medium', 'Low', 'Medium'], 'Read-only account facts from the server; roles taken from the memberships; own security events and audit entries only; "sign out of all devices" bumps the token version and is logged and e-mailed; name, company and roles stay with the administrator.', ['OQ-API-34', 'OQ-UI-17']),
  r('URS-34', 'Platform', 'Backup and restore', 'Data and files are backed up on a schedule; every backup is checked by a test restore; a backup can be restored after a loss; failures are reported.', 'Direct', 'Annex 11 §7.2', ['High', 'Low', 'Medium'], 'Daily database dump + files from one snapshot with SHA-256 manifest; automatic test restore into a temporary database; retention; e-mail on failure; restore CLI. Off-site copies of BACKUP_DIR remain a customer IT procedure.', ['OQ-API-31', 'OQ-UI-14']),
]

/* ------------------------------------------------------------ GAMP 5 risk method */

const IDX: Record<Level, number> = { High: 0, Medium: 1, Low: 2 }
/** Risk class from severity (rows) x probability (columns): 1 = highest. */
const CLASS = [[1, 1, 2], [1, 2, 3], [2, 3, 3]]
/** Priority from risk class (rows) x detectability (columns High, Medium, Low). */
const PRIORITY: Level[][] = [['Medium', 'High', 'High'], ['Low', 'Medium', 'High'], ['Low', 'Low', 'Medium']]
export const riskClass = (s: Level, p: Level) => CLASS[IDX[s]][IDX[p]]
export const riskPriority = (s: Level, p: Level, d: Level): Level => PRIORITY[riskClass(s, p) - 1][IDX[d]]

/* ------------------------------------------------------------ OQ results + traceability */

export interface OqCheck { text: string; pass: boolean }
export interface OqCaseResult { id: string; title: string; suite: string; checks: OqCheck[]; passed: number; failed: number }
export interface OqResults {
  executedAt: string; executedBy: string; durationSec: number
  environment: Record<string, string>
  cases: OqCaseResult[]
  totals: { cases: number; checks: number; passed: number; failed: number }
}

/** Requirement -> risk -> test cases -> verdict. */
export function traceability(oq: OqResults | null) {
  return URS.map((u) => {
    const results = u.tests.map((t) => oq?.cases.find((c) => c.id === t))
    const verdict = u.procedural && !u.tests.length ? 'Procedural' : !oq ? 'Not executed' : results.some((c) => !c) ? 'Not executed' : results.some((c) => c!.failed) ? 'Fail' : 'Pass'
    return { ...u, riskClass: riskClass(u.severity, u.probability), priority: riskPriority(u.severity, u.probability, u.detectability), verdict, checks: results.reduce((n, c) => n + (c?.checks.length ?? 0), 0) }
  })
}

/** Consistency rules of the catalogue (used by the API suite). */
export function catalogueProblems() {
  const ids = new Set(OQ_CASES.map((c) => c.id))
  const problems: string[] = []
  for (const u of URS) {
    for (const t of u.tests) if (!ids.has(t)) problems.push(`${u.id} references unknown test ${t}`)
    if (!u.tests.length && !u.procedural) problems.push(`${u.id} has no test and no procedural control`)
  }
  for (const c of OQ_CASES) if (!URS.some((u) => u.tests.includes(c.id))) problems.push(`${c.id} verifies no requirement`)
  if (new Set(URS.map((u) => u.id)).size !== URS.length) problems.push('duplicate URS id')
  return problems
}
