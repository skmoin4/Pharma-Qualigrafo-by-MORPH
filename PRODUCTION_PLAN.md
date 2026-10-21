# Qualigrafo — From Demo to Production Software

Analysis date: 2026-10-20. Starting point: backend + frontend integration, file storage and security hardening are done
(see `server/BACKEND_NOTES.md`, steps 1–14). This document lists what still separates the app from software that pharma
engineering teams can run real projects on, and the order in which to build it.

---

## 1. Where we stand

> **Resume here (updated 2026-10-21).** Branch `production-backend`. Phase 1 is complete; Phase 2 steps 1–3 are
> complete. **Next: Phase 2 / step 4 — C5 scheduled reminders + e-mail notifications** (then C6 access review, C7
> validation pack). Each finished step is described in section 5. Session guide: `CLAUDE.md` (repo root).

| Phase | Status |
|---|---|
| Backend + integration (BACKEND_NOTES steps 1–14) | Done |
| **Phase 1** — a customer can run a real project (B1–B9) | **Done** (steps 1–6, section 5) |
| **Phase 2** — GxP supplier-audit readiness (C1–C7) | Steps 1–3 done: C1 e-signatures, C3 inactivity timeout, C2 old → new audit, C4 PDF reports + transmittals. **Open: C5, C6, C7** |
| Phase 3 — platform and operations (P1–P7) | Not started |
| Phase 4 — integrations (real Revit add-in) | Connector API done (BACKEND_NOTES §13); add-in itself not started |

Tests at this point: API 412 checks; browser suites e2e … e2e10 with 427 checks; all passing.

*Original analysis (2026-10-20), kept for context:* the workflow engine, login / roles / vendor isolation and file
storage were solid, but every project, document, requirement and finding came from fictional sample data — a customer
could not set up a real project. Phase 1 closed that gap.

## 2. Gap analysis

### 2.1 Blockers — a real project cannot be set up (Phase 1)

| # | Area | Today | Needed |
|---|---|---|---|
| B1 | **Projects** | 3 seeded projects; name, client, site, plant country not editable; no archive | Create-project wizard (profile, plant country, markets, facility, scope, team), edit profile, close / archive |
| B2 | **Requirement library** | 36 fictional topics copied into every project; adding a market adds no requirements | Central, versioned library ("rule packs") per market × facility type, maintained by a regulatory expert; projects instantiate from it at creation and when a market is added; project-specific requirements (owner standards) |
| B3 | **Document register** | Documents only from seed or the 3-draft equipment template; metadata not editable; no cancel / supersede | Create document, edit metadata (title, discipline, system, responsible company, due, critical), void / supersede with reason, bulk import from Excel / CSV (Master Document Register) |
| B4 | **Companies (project parties)** | Free-text `owner` on each document; vendor scope relies on exact spelling | Company register per project (role: EPC, vendor, consultant, owner); dropdowns everywhere; vendor scope bound to a company record |
| B5 | **Systems / equipment** | Systems inferred from document tags; disciplines hard-coded (8) | System / equipment register per project; configurable discipline list |
| B6 | **Findings & regulatory updates** | Only seeded records; no way to create | Reviewer raises a finding manually; regulatory updates created at library level and flagged to affected projects |
| B7 | **Edit after create** | Risks, RFIs, NCRs, actions cannot be edited (only status changes) | Edit fields with audit of old → new values; reassign; change due date with reason |
| B8 | **Hard-coded dates** | Working date fixed at 2026-10-16; form defaults like `2026-10-30`; Schedule window fixed 5 Oct – 9 Nov | Real date in production; defaults = today + N days; schedule range from the data |
| B9 | **Production start-up** | Only the destructive demo seed creates users | `create-admin` command for a clean install; demo data only in a separate demo database |

### 2.2 Demo artefacts to remove or put behind a demo switch (Phase 1)

- "Fictional demo data" banner, the word "prototype"/"sample" in ~15 files, demo-account buttons on the login page,
  the "Demo account" role switcher, the walkthrough (it switches demo accounts).
- Simulated Revit connector and the drawn sample floor plan in Technical comments.
- Proposal: one setting `APP_MODE=production|demo`. Demo keeps today's behaviour for sales demos; production hides all of it.

### 2.3 Compliance-grade features pharma customers will ask for (Phase 2)

| # | Need | Why |
|---|---|---|
| C1 | E-signature with re-authentication (password at each sign-off), signature meaning, bound to the file checksum | 21 CFR Part 11 / EU GMP Annex 11 |
| C2 | Audit trail with old → new values for every field change | ALCOA+ data integrity; inspectors ask "what changed" |
| C3 | Inactivity timeout and re-login | Annex 11 §12 |
| C4 | PDF reports: handover dossier, audit package, document transmittal | Today exports are HTML / JSON / CSV |
| C5 | Real reminders (scheduled job) + e-mail notifications | Today "Simulate reminder cycle" only |
| C6 | Periodic user-access review report | Standard GxP control |
| C7 | Validation pack for the software itself (URS, risk assessment, IQ/OQ test evidence) | Customers must validate a GxP computerised system; our automated tests are the base |

### 2.4 Platform and operations (Phase 3)

| # | Need | Notes |
|---|---|---|
| P1 | Scale | Portfolio currently loads every project in full; needs a summary endpoint and per-project loading (fine for ~10 projects, not for 100+) |
| P2 | Deployment | Docker images, HTTPS reverse proxy, environment config, health checks |
| P3 | Backups | Scheduled Postgres dump + file-storage backup, tested restore |
| P4 | File storage | S3 / Azure Blob (same content-addressed keys), virus scan on upload |
| P5 | Enterprise login | SSO (Azure AD / Okta), MFA for admins, httpOnly-cookie sessions |
| P6 | Monitoring | Structured logs, error tracking, uptime alerts |
| P7 | CI | Run the API + browser suites on every change |

### 2.5 Integrations (Phase 4)

- Real Revit add-in (publish sheets / elements; navigate to element).
- Comments anchored on the uploaded PDF drawing (pdf.js viewer) instead of the sample floor plan.

## 3. Roadmap

| Phase | Goal | Content | Rough size |
|---|---|---|---|
| **1** | A customer can run a real project | B1–B9, demo switch | largest; 6–8 working steps |
| **2** | Passes a GxP supplier audit | C1–C7 | 4–5 steps |
| **3** | Runs reliably for many projects / customers | P1–P7 | 4–5 steps |
| **4** | Integrations | Revit, PDF markup | separate track |

Phase 1 order (each step = backend + UI + tests + notes, like steps 11–14):
1. ~~Remove demo + `create-admin` + real date + remove hard-coded dates (B8, B9, 2.2)~~ — **done 2026-10-20**, see section 5
2. ~~Company register + system register + discipline config (B4, B5)~~ — **done 2026-10-20**, see section 5
3. ~~Create / edit / archive project with wizard (B1)~~ — **done 2026-10-20**, see section 5
4. ~~Requirement library + instantiate into projects + project-specific requirements (B2)~~ — **done 2026-10-21**, see section 5
5. ~~Document create / edit / void / Excel import (B3)~~ — **done 2026-10-21**, see section 5
6. ~~Edit records with old → new audit, manual findings, library-level regulatory updates (B6, B7)~~ — **done 2026-10-21**, see section 5

Phase 2 order:
1. ~~E-signatures with re-authentication + inactivity timeout (C1, C3)~~ — **done 2026-10-21**
2. ~~Old → new values everywhere in the audit trail (C2)~~ — **done 2026-10-21**
3. ~~PDF reports: handover dossier, audit package, document transmittal (C4)~~ — **done 2026-10-21**
4. **Scheduled reminders + e-mail notifications (C5)** ← next
5. Periodic user-access review report (C6)
6. Validation pack for the software (C7)

## 4. Decisions (taken 2026-10-20)

| # | Question | Decision |
|---|---|---|
| 1 | Deployment model | **One installation per customer company** (single-tenant). No organisation layer needed. |
| 2 | Who creates projects | **Administrators and Owner / QA users.** |
| 3 | Regulatory content | The software **manages** a versioned requirement library (draft → approved, Excel import) and never presents content as verified. Each customer's QA / regulatory lead approves their own library. The current 36 topics ship only as an **"Unverified starter template"** (topic + official source link, no clause numbers). Later option: verified rule packs from a regulatory consultancy as a paid add-on. |
| 4 | Demo | **Removed entirely** from the product: no demo accounts, role switcher, walkthrough, "fictional data" banner or fixed demo date. The sample data survives only as fixtures for the automated tests. |

Consequences for Phase 1 step 1: the Revit connector simulation and the sample floor-plan drawing are demo artefacts
and are hidden until the real integrations (Phase 4).

## 5. Progress

### Phase 1 / step 1 — production foundation (done 2026-10-20)

| Area | Change |
|---|---|
| Installation | `npm run create-admin` creates the first administrator (temporary password, forced change). No data is created on a new database. |
| Test data | The fictional projects moved to `server/fixtures/` and load only with `npm run fixtures:load`, which refuses in production, without `--confirm-wipe`, or when real accounts exist. Prisma no longer auto-seeds. The frontend no longer bundles any sample project data. |
| Date | "Today" is the real date in the site's time zone (`APP_TIMEZONE`, e.g. `Asia/Riyadh`); `CLOCK_DATE` pins it for tests only. UI takes it from `GET /reference/config`. |
| Demo removed | Demo-account buttons, "Demo account" switcher (header now shows the user's project role), walkthrough, "Fictional demo data" banner, "prototype / sample / demo" wording across 15 files. |
| Simulations removed | Revit connector simulation (mode toggle, preview, navigation request) and the drawn sample floor plan. Endpoints `PUT /settings/revit` and `POST /pins/:id/revit-navigation` deleted. The Revit import endpoint stays as the integration point for the real add-in (Phase 4). |
| Technical comments | Rebuilt as a comment register: raise against a document's current revision with location / sheet, open the document file, discussion, reviewer closure, Open / Closed filter, CSV export. |
| Source files page | File upload + import history only. |
| Reminders | "Simulate reminder cycle" became **Send reminders now** (`POST /reminders/send`, reviewers only); notices read "Reminder: … waiting for your sign-off". E-mail delivery is Phase 2. |
| Hard-coded dates | Form defaults are today + 7 / 14 / 21 days; Schedule window is computed from the data; demo system tag `PW-001` no longer prefilled. |
| Honest wording kept | Sign-off notices state that re-authentication (Part 11 / Annex 11 e-signature) is planned and not yet active; requirement topics remain marked "not verified". |
| Login | "Forgot your password? Ask your administrator to reset it." |

Tests: API 145 checks; browser suites rewritten to sign in through the real login form with the fixture accounts
(`qualigrafo/scripts/e2e-lib.mjs`): 190 + 48 + 20 checks, all passing.

### Phase 1 / step 2 — project registers (done 2026-10-20)

New page **Companies & systems** (Project group) with three registers per project. Migration `project_registers`
back-fills existing projects (client as Owner, every responsible party, the 8 standard disciplines, every system tag
already in use) so nothing breaks.

| Register | Who maintains | Rules |
|---|---|---|
| Companies | Owner / QA (it controls vendor access) | Name unique per project, type (Owner, Engineering consultant, Main contractor, Subcontractor, Vendor / supplier, Other), contact. Rename carries over to every document and vendor scope. Cannot deactivate a company that vendor accounts are limited to. |
| Systems & equipment | Consultant, Owner / QA | Tag (upper-case, letters/digits/`-_./`, unique, never changes), description, discipline, area, GMP-critical flag; deactivate instead of delete. **CSV import** of an equipment list (Excel → CSV), preview, all-or-nothing with the failing row number, template download. |
| Disciplines | Consultant, Owner / QA | Add, rename (carries over to documents, requirements, RFIs, systems), reorder, deactivate. |

Enforcement: new RFIs, inspections, changes, risks, NCRs and generated deliverables must use an **active** registered
system (and discipline / vendor company where relevant); admin vendor scopes must be a registered company of that project.
All pickers show register entries only ("Choose a system…"), fixing a bug where Risk / NCR forms could submit an empty system.
Vendor accounts see only their own company and the systems of their own documents.

Tests: API 176 checks (+31), browser 196 + 54 + 20, all passing.

### Phase 1 / step 3 — project lifecycle + team (done 2026-10-20)

| Area | Change |
|---|---|
| Who creates | Administrators and anyone who is Owner / QA on at least one project (`canCreateProjects` on the session). On a fresh installation the administrator creates the first project. |
| Wizard (`#/new-project`, "New project" on Portfolio) | 5 steps: **Basics** (name, optional project code — otherwise `PRJ-nnn`, client, site, plant country) · **Scope & markets** (facility, scope, phase, target markets, owner standards) · **Registers** (disciplines, starting companies; client added as Owner) · **Team** (people from the user directory, role, vendor scope) · **Review**. Each step lists what is still missing; the server re-validates everything (≥1 Owner / QA, one role per person, scopes only for Contractors and only for project companies, unique code). Creation is one transaction, starts at baseline B1, and is audited. |
| Team (Team page) | The project's Owner / QA adds people, changes role / record access and removes members — no administrator needed. Same rules as Users & access (shared `services/team.ts`): the last Owner / QA cannot step down, scopes must be registered companies; every change goes to the audit trail and the security log. |
| Details (Setup) | Name, client, site editable by Owner / QA (audited); project code fixed; facility / scope / markets still change through a new baseline. |
| Archive / restore (Setup) | Archive needs a reason; the project becomes **read-only** (server refuses every change except restore and personal read markers), shows a banner, and moves to Portfolio → Archived. Nothing is deleted. Restore needs a reason. |
| Portfolio | "New project" button; empty state for a fresh installation or a user without projects; Active / Archived switch; archived projects excluded from totals and My work. |
| Bug fixed | Portfolio and My work derived every project's tasks from the role in the *currently open* project; they now use the user's role in each project. |

Tests: API 211 checks (+35); browser 196 + 54 + 20 + **20 (new `e2e4.mjs`: wizard, team, details, archive / restore)**, all passing.

### Phase 1 / step 3b — restored demo features as real features (done 2026-10-20)

User rule (2026-10-20): **nothing that existed in the demo may be removed**; simulated features become real. Only the
walkthrough, the "Preview as" role switcher and the "Reset prototype data" button stay removed (user decision).
A control-by-control comparison of the demo (git HEAD) with the app found these removed in step 1, now rebuilt for real:

| Demo feature | Now |
|---|---|
| Comments pinned on a (sample) floor plan, click to anchor, Zoom to comment, Full sheet | Comments pinned on the **real uploaded drawing** of the revision (PDF via pdf.js, PNG / JPEG), multi-page, zoom levels, Zoom to comment, Full sheet. Place when raising, place later, move, or **remap to the new revision**. Server checks the revision really has a drawing file. |
| Revit / Standalone input mode + header badge | Project setting (Consultant / Owner / QA), header badge "Revit connector / Standalone". |
| "Preview sample Revit update" + "Import as draft" | **Revit model snapshots** published by the add-in (model, version, changed elements) listed under Source files → Revit snapshots; the Contractor imports one into a document (attach to draft / new revision / cancels a pending route, duplicate-checked). |
| "Open in Revit" navigation request with outcomes | Comment linked to a published model + element UniqueId; **Open in Revit** queues a request; the add-in takes it and reports Focused / Wrong model / Stale version / Element missing / Link unloaded; unanswered requests expire after 5 minutes; the UI refreshes until the outcome arrives. The request JSON can still be downloaded. |
| Comments JSON export | Back, next to CSV. |

New: **connector tokens** (Owner / QA, shown once, SHA-256 stored, revocable) and the add-in API `/api/connector/v1`
(see BACKEND_NOTES.md §13). Also added an **error boundary** so one failing view can no longer blank the whole app
(found when pdf.js cleanup crashed the comments page in testing), and lazy loading of Admin / New project / Registers.

Tests: API 250 checks (+39); browser 196 + 54 + 20 + 20 + **19 (new `e2e5.mjs`: real PDF drawing, pin, zoom, Revit
token, snapshot publish → import, element link, Open in Revit round trip, JSON exports)**, all passing.

### Phase 1 / step 4 — requirement library (done 2026-10-21)

Decision (§4): the software does not ship "verified" regulatory content. Each installation keeps its own **requirement
library**, maintained and approved by the customer's QA; the old 36 sample topics exist only as an
**unverified starter template**.

| What | How it works |
|---|---|
| Library packs | One pack per market (SA, EU, IN, US, UK), versioned: **Draft → Approved → Superseded**. Readable by every user; maintained by library editors (administrators and Owner / QA users). Page: sidebar → **Requirement library** (`#/library`). |
| Items | Key (e.g. `PREMISES-01`, stable across versions), title, topic, discipline, facility types (none = all), critical, clause, source version, effective date, reviewer guidance. Add / edit / remove one by one, or **CSV import** (append or replace, all-or-nothing with row-numbered errors, downloadable template). |
| Starter template | "Load unverified starter template" creates Draft v1 packs (SA 17, EU 7, IN 9, US 3 topics, no clauses) only for markets without a pack; flagged "Unverified starter template" everywhere it is used. |
| New version | "New draft from vN" copies the approved version; one draft per pack; each item shows Added / Changed (which fields) / Unchanged against the approved version, plus a list of removed items. |
| Approval | **Four-eyes rule**: whoever created or last edited the draft cannot approve it. A written approval basis is required. The previous approved version becomes Superseded. |
| New projects | The wizard shows each market's approved pack; on create, the items for the project's facility type become requirements (Assessment pending, owner Consultant, due +30 days, no system yet) with their library origin. Adding a market in Project setup does the same. Markets without an approved pack get no requirements (shown in the wizard and Setup). |
| Updating projects | Approving a new version sends a **Library update** to every active project with that market whose requirements would change (Regulatory changes page + notice to Owner / QA). Older unassessed library updates are superseded. Owner / QA applies it (new baseline: new items added, changed items reopened as Assessment pending with their evidence reset to Pending, removed items set Not applicable) or records it as not applicable. Nothing changes in a project without that decision. |
| Project-specific requirements | Consultant / Owner / QA can **add a requirement** that is not in the library (owner standard, URS item); recorded as Required and marked "Project-specific". |
| Requirement details | The requirement drawer shows the origin ("Requirement library SA v2 · TOPIC-01" or "Project-specific") and lets reviewers assign the **system, owner and due date**. The register shows "System not assigned" for library items until then. |
| Setup | The regulatory source inventory shows the real pack status per market (approved version, items, approver, draft in progress). |

Security log: `library.draft`, `library.edit`, `library.import`, `library.approved`, `library.discarded`. Project audit
trail: requirements created from the library, library updates applied, requirement details changed.

Tests: API **293** checks (+43); browser 196 + 54 + 20 + 20 + 19 + **33 (new `e2e6.mjs`: starter, item edit, add,
CSV import + bad header, four-eyes block, second-editor approval, v2 with change flags, fan-out, superseded update,
apply to PRJ-026, library origin in the register, project-specific requirement, details editor, Setup inventory,
mobile)**. Each browser suite expects freshly loaded fixtures (`npm run fixtures:load` before each suite); the
sign-in limiter is in memory, so restart the API before running the whole chain again.

### Phase 1 / step 5 — document register (done 2026-10-21)

| What | How it works |
|---|---|
| Register a document | Document register → **New document** (Consultant / Owner / QA): title, optional client **document number**, discipline, system (optional), responsible company, due date, criticality. Created as **Missing R00**; the responsible company is notified. Numbers are unique per project (case-insensitive). |
| Edit register details | Document drawer → **Edit details**: every change needs a **reason**; the audit trail records each field as old → new plus the reason. While a revision is under review, title, number and discipline are locked (signers must see what they sign); due date, company, system and criticality can still change. Reassignment notifies the contractor. |
| Void / supersede | Owner / QA only, with a reason, not while an approval route is open. The document stays in the register as read-only history (hidden by default, status filter shows it); submit, new revision, uploads, Revit imports and new comments are refused. Its **evidence links are withdrawn** (kept, struck through, no longer counted); when **superseded**, the replacement is linked to the same requirements as Pending for fresh assessment. Void / superseded documents are never overdue and do not count in the critical-documents handover gate, schedule, vendor view or work lists. |
| Reinstate | Owner / QA, with a reason; returns to its previous status. Withdrawn links stay withdrawn (re-link where it applies). |
| Withdraw an evidence link | Requirement drawer → **Withdraw** (Consultant / Owner / QA, with a reason) for a wrong or replaced link; withdrawn links cannot be assessed. |
| Import the Master Document Register | **Import register**: Excel **.xlsx** (first sheet) or CSV, CSV template downloadable. Header names are recognised flexibly (Document No., Title, Discipline, System / Tag, Company / Vendor, Due Date, Critical); Excel date cells are converted. Rows are matched on the document number: new numbers are registered, known ones updated (blank cells keep the value). A **preview** lists new / updated (with the field changes) / unchanged rows and **every error with its spreadsheet row number**; the import runs only when there are no errors and is all-or-nothing. Void / superseded documents are not updated by an import. |
| Export | **Export register** (CSV) with number, code, title, discipline, system, company, due, criticality, revision and status. |

The .xlsx reader is our own small module on top of `fflate` 0.8.3 (zero-dependency unzip; 0.8.2 had a ZIP64 advisory),
reading only the workbook parts it needs, with a 10 MB file / 60 MB part limit. The larger spreadsheet libraries were
rejected: very recent releases with unfamiliar dependencies (supply-chain risk) or known advisories.

Tests: API **331** checks (+38); browser 196 + 54 + 20 + 20 + 19 + 33 + **26 (new `e2e7.mjs`: register, real .xlsx
import with a bad row then the corrected file, details edit with reason, supersede with evidence hand-over, withdraw,
reinstate, mobile)**. The Vite dev / preview proxy now follows `API_URL` (default `http://localhost:4000`), so the
browser suites can run against a separate API instance.

### Phase 1 / step 6 — edit records after creation, manual findings (done 2026-10-21)

Every record that could only change status can now be corrected, always with a **reason**; the audit trail stores
each changed field as **old -> new** plus the reason (e.g. `RSK-002 edited: likelihood "4" -> "1"; owner "Consultant"
-> "QA Lead"; rating 20 -> 5. Reason: …`). A save with nothing changed or without a reason is refused.

| Record | Who can edit | Rules |
|---|---|---|
| RFI (question, discipline, system, due) | The requester, or Consultant / Owner / QA | Once answered the **question is locked** (raise a new RFI for a different question); due date / system can still change. Closed RFIs are frozen. Vendor accounts only see and edit their own RFIs. |
| Risk (title, detail, system, likelihood, impact, owner, mitigation, due) | Consultant / Owner / QA | Not when Closed. Rating change logged as "rating 20 -> 5". |
| NCR (title, description, system, severity, related document, response due) | Consultant / Owner / QA | Not when Closed. **Only Owner / QA can downgrade a Critical NCR** (closing a Critical NCR is Owner / QA only, so a downgrade must not bypass that). The related document must be active. Severity or due changes notify the contractor. |
| Corrective action (title, owner, due, priority) | Consultant / Owner / QA | Not when Closed. Reassignment notifies the contractor. |
| **Finding (new)** | Consultant / Owner / QA raise it | Consistency findings page → **Raise finding**: what is inconsistent, severity, the record concerned (active documents only), compared values / observation (required) and basis. Shows who raised it and when; dispositioned like any finding. The page notice now says plainly that automated rule checks over files are not part of this version. |

The edit form is one shared component (`components/EditRecord.tsx`) used on the RFI, risk, NCR and corrective-action
pages. Library-level regulatory updates (also under B6) were delivered in step 4, so **Phase 1 (B1–B9) is complete**.

Tests: API **357** checks (+26); browser 196 + 54 + 20 + 20 + 19 + 33 + 26 + **20 (new `e2e8.mjs`: contractor edits
own RFI, reason enforced, answered question locked, risk re-rated, Critical NCR downgrade blocked for the Consultant,
NCR rescheduled, action reassigned, manual finding raised and resolved, old -> new lines in the audit trail, mobile)**.

Next: **Phase 2 — GxP supplier-audit readiness (C1–C7)**, starting with Part 11 / Annex 11 electronic signatures
(re-authentication bound to the revision checksum).

### Phase 2 / step 1 — electronic signatures (C1) and inactivity timeout (C3) (done 2026-10-21)

Phase 2 order: 1. e-signatures + inactivity timeout (C1, C3) · 2. remaining old -> new audit gaps (C2) · 3. PDF reports
(C4) · 4. scheduled reminders + e-mail (C5) · 5. user-access review (C6) · 6. validation pack (C7).

**Electronic signatures (21 CFR Part 11 / EU GMP Annex 11)**

| Control | Implementation |
|---|---|
| Re-authentication at each signing (11.200) | Every document sign-off and every requirement-library approval asks for the password again. A wrong password records nothing; failures are logged (`esign.failure`) and count towards the same 5-attempt / 15-minute lockout as sign-in (`esign.locked`). |
| Signature manifestation (11.50) | Each signature stores printed name, signer e-mail, role, date and time, and the **meaning**: stage 1 "Reviewed — technically acceptable", stage 2 "Approved for use". The signer sees the meaning and the file checksum before signing; the sign-off record, the issue manifest and the audit trail show them. |
| Signature / record linking (11.70) | The signature stores the SHA-256 of the signed revision's content (file or Revit snapshot) and a SHA-256 **signature hash** over document, revision, content checksum, signer, meaning, reason and time. **Verify signatures** (drawer, `GET …/docs/:id/signatures/verify`) recomputes it: *Valid*, *Altered* (a stored field was changed outside the application), or *Not an electronic signature* for sign-offs recorded before this step. A revision without a source file cannot be signed. |
| Accountability | Signatures come only from the authenticated, re-authenticated account (never from the request body); `esign.signed` is written to the security log. |

**Inactivity timeout (Annex 11 §12)**

- Server: session tokens now live only `IDLE_TIMEOUT_MIN` minutes (default 15). An active client refreshes them
  (`POST /auth/refresh`); an idle one cannot use its token any more. `JWT_EXPIRES_IN` (default 12h) is now the
  **absolute** session length, carried as the session start in the token: refreshing never extends past it.
- Browser: activity in any tab counts. One minute before the limit a warning offers **Stay signed in**; at the limit the
  screen locks and the token is dropped. The same user continues **on the same page** by entering the password, or signs
  out. A token refused by the server (expired, revoked) also shows the lock screen instead of losing the page.

Tests: API **379** checks (+22: password required, wrong password, meaning / e-mail / checksum / hash stored, issue
manifest, verification and tamper detection, legacy label, security log, lockout, library re-authentication, token
lifetime, refresh, expired and over-age sessions); browser 197 + 54 + 20 + 20 + 19 + 33 + 26 + 20 + **22 (new
`e2e9.mjs`: sign with password and meaning, verify, idle warning, lock, unlock in place, server-ended session, mobile)**.

Next: **Phase 2 / step 2 — close the remaining old -> new audit gaps (C2)** (registers, team, profile and other
updates that still log only "updated").

### Phase 2 / step 2 — old -> new values everywhere in the audit trail (C2) (done 2026-10-21)

A sweep of every audit and security-log entry. Everything that **changes** a value now states what it was and what it
became (`field "old" -> "new"`), and every decision carries its recorded reason. Creations log the new record;
transitions log the status change. One shared helper (`server/src/lib/audit.ts`) formats all of them.

| Area | Before | Now (example) |
|---|---|---|
| Company register | "Company updated: X" | `Company AirCo updated: kind "Vendor / supplier" -> "Subcontractor"; contact "—" -> "R. Sharma"` |
| System register | "System updated: TAG" | `System AHU-01 updated: description "…" -> "…"; GMP-critical "no" -> "yes"` |
| Applicability | "REQ-014 applicability: Required" | `REQ-014 applicability "Assessment pending" -> "Required". Rationale: …` |
| Source reference | "saved as draft" | `… saved as draft: clause "—" -> "4.2.1"; source version "—" -> "2024 edition"` |
| Project profile (baseline) | "Baseline B3 created: reason" | `Baseline B3 created: phase "Design" -> "Commissioning"; markets "SA" -> "SA, EU". Reason: …` |
| Risk / action / NCR / inspection / finding / change statuses | "RSK-002 -> Mitigating", "NCR-001 verified and closed" | `RSK-002 status "Open" -> "Mitigating". Note: …`, `… (status "Response submitted" -> "Closed"). Verification: …` |
| Evidence assessment, document return | no reason in the log | decision old -> new plus the rationale / reason |
| Change impact items | "assessed as Impacted" | `impact "Unassessed" -> "Impacted"` |
| Revit element link | new element only | `… linked to Revit element E-2 (was E-1)` |
| Automation rules | "enabled" | `… enabled ("off" -> "on")` |
| Library item edit, draft note | "TOPIC-01 edited", note not logged | `TOPIC-01 edited: clause "—" -> "Chapter 9.9"`, `note "…" -> "…"` (security log) |
| User administration | `name=…` (new value only) | `name "Demo Contractor" -> "Demo Contractor (BuildCo)"` (security log) |

Already old -> new from Phase 1: document register details, requirement details, RFI / risk / NCR / action edits,
company and discipline renames, team membership changes, project details.

Tests: API **390** checks (+11, one per area above); browser suites unchanged and passing (197 + 54 + 20 + 20 + 19 +
33 + 26 + 20 + 22).

Next: **Phase 2 / step 3 — PDF reports (C4)**: handover dossier, audit package and document transmittal.

### Phase 2 / step 3 — PDF reports and document transmittals (C4) (done 2026-10-21)

PDFs are generated **on the server** from the stored records (PDFKit 0.20.2, DejaVu Sans font embedded so symbols such
as →, ≥, ±, µ print correctly). Every page carries project, report id, who generated it and when, and page n of m.
Every generation is written to the **audit trail with the SHA-256 of the PDF** (also sent as `X-Content-SHA256`), so a
printed or e-mailed copy can be checked against the record later.

| Report | Where | Content |
|---|---|---|
| **Handover dossier** | Handover readiness → *Handover dossier (PDF)* (Consultant, Owner / QA) | Project profile and baseline; gate status statement; 1. document-gate conditions; 2. requirement coverage per market; 3. critical documents with the signatures of their current revision (name, role, meaning, date, e-signature); 4. every open item (critical documents, comments, RFIs, inspections, findings, actions, NCRs, changes) and overdue documents; 5. controlled issues. Scope disclaimer (not a certificate). |
| **Audit evidence package** | Audit packages → *PDF* per frozen package | Frozen time and role, baseline, markets, accepted / required; outstanding requirements grouped by state; every requirement with applicability, evidence state and linked revisions. Built from the frozen snapshot, so later changes never alter it. The earlier printable HTML and JSON exports stay. |
| **Document transmittal** (new record) | Documents → **Transmittals** | Consultant / Owner / QA issue a numbered transmittal (TRN-001…) to a company in the register with a controlled purpose (For approval, For review / comment, For information, For construction, As built), remarks and a selection of documents. Each item is **frozen at issue**: number, title, revision, status, file name, SHA-256 and the approvals of that revision. Missing, void and superseded documents cannot be transmitted. The receiving company (any contractor account, or the vendor account of that company) **acknowledges receipt** in the app, with a remark; vendors only see transmittals addressed to them. The PDF lists the documents with checksums and either the electronic acknowledgement or a signature block. |

Vendor accounts cannot pull the handover dossier or audit packages (403); they can download transmittals addressed to
their company.

Limitation: right-to-left scripts (e.g. Arabic) are not shaped correctly in the PDFs; project data is expected in
Latin script.

Tests: API **412** checks (+22: PDF type, hash header = file hash, audit entry with the hash, vendor restrictions,
package PDF, transmittal validation, frozen items, vendor visibility, acknowledgement rules); browser 197 + 54 + 20 + 20
+ 19 + 33 + 26 + 20 + 22 + **16 (new `e2e10.mjs`: dossier and package downloads are real PDFs, transmittal issue,
vendor receipt, transmittal PDF, audit entries, mobile)**. The generated PDFs were also rendered and reviewed page by
page.

Next: **Phase 2 / step 4 — scheduled reminders and e-mail notifications (C5).**

