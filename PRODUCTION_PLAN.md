# Qualigrafo — From Demo to Production Software

Analysis date: 2026-10-20. Starting point: backend + frontend integration, file storage and security hardening are done
(see `server/BACKEND_NOTES.md`, steps 1–14). This document lists what still separates the app from software that pharma
engineering teams can run real projects on, and the order in which to build it.

---

## 1. Where we stand

> **Resume here (updated 2026-10-29).** Branch `production-backend`. **Phase 1 and Phase 2 are complete.** Phase 3
> steps 1–5 are done: P7 CI, P2 Docker deployment (CI is red — see below), P3 backups with a tested restore, P1
> portfolio at scale, P6 monitoring. Each finished step is described in section 5; what is still owed from the earlier
> phases is listed in **section 7**.
>
> **The client tested the product and sent a new specification on 2026-10-29 (`clientnew/`): Qualigrafo becomes a
> multi-industry engineering + BIM + document-control platform with pharma as one of four industry groups.** That work
> is **Phase 5**, planned in section 6, and it runs **before** the remaining Phase 3 steps (P4 object storage, P5 SSO /
> MFA). Phase 4 (Revit add-in) merges into Phase 5 step 7.
>
> **Phase 5 / step 0 is done (2026-10-29)** — the server advisories are fixed, the client's two stuck accounts are
> usable again, and the product no longer fails silently on first contact (§6.7). Tests: **1238 of 1238 in 52 cases**
> (610 API + 628 browser).
>
> **CI run 40835673708** (`f46ff46`, 2026-10-29) was the first where `checks` passed, so `oq` and `deploy` ran for the
> first time ever and both failed. **Read and fixed on 2026-10-30:** eight of the nine failing checks came from one
> bug — the pg_dump version was parsed from the text after the last `)`, which is empty on Debian / Ubuntu builds, so
> every Linux installation was told its backup tools were too old. The ninth was `e2e16` asserting a development log
> destination against a productive stack. Both fixed; the Linux proof is the next CI run (§7 items 1 and 3).
>
> **Next: Phase 5 step 1** — project classification and the unified wizard (§6.5 step 1), in progress since
> 2026-10-30. Session guide: `CLAUDE.md`.

| Phase | Status |
|---|---|
| Backend + integration (BACKEND_NOTES steps 1–14) | Done |
| **Phase 1** — a customer can run a real project (B1–B9) | **Done** (steps 1–6, section 5) |
| **Phase 2** — GxP supplier-audit readiness (C1–C7) | **Done**: C1 e-signatures, C3 inactivity timeout, C2 old → new audit, C4 PDF reports + transmittals, C5 e-mail + scheduled reminders, C6 periodic access review, C7 validation pack (IQ / OQ / traceability) |
| **Phase 3** — platform and operations (P1–P7) | Steps 1–5 done: P7 CI, P2 Docker deployment (GitHub / Docker runs pending), P3 backups + tested restore, P1 scale, P6 monitoring. P4 object storage + virus scan and P5 SSO / MFA now follow Phase 5 |
| Phase 4 — integrations (real Revit add-in) | Connector API done (BACKEND_NOTES §13); add-in itself not started — **merged into Phase 5 step 7** |
| **Phase 5** — multi-industry platform (client feedback 2026-10-29) | **Planned, section 6. Next: step 0.** Eleven steps from the wizard fix to the management dashboard |

Tests at this point: API 598 checks; browser suites e2e … e2e17 with 587 checks; all passing. Full OQ run (`npm run validation:oq`): 1185 of 1185 checks passed in 51 test cases (598 API + 587 browser).

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

- Real Revit add-in (publish sheets / elements; navigate to element). **Still open** — this is the only thing left of
  Phase 4, and it moves into Phase 5 step 7 beside the BIM registers. The whole server side is already built and
  documented for an add-in developer: `BACKEND_NOTES.md` §13 (connector tokens, `POST /snapshots`, `GET /navigation`,
  `POST /navigation/:id/result`), so what is missing is the Revit-side client itself.
- ~~Comments anchored on the uploaded PDF drawing (pdf.js viewer) instead of the sample floor plan.~~ — **done**:
  `qualigrafo/src/components/Drawing.tsx` renders the real uploaded PDF with `pdfjs-dist` and places markers on it;
  the API is `POST /pins {place:{page,x,y}}` + `PUT /pins/:id/anchor` (BACKEND_NOTES §13, "Drawing comments").

## 3. Roadmap

| Phase | Goal | Content | Rough size |
|---|---|---|---|
| **1** | A customer can run a real project | B1–B9, demo switch | largest; 6–8 working steps |
| **2** | Passes a GxP supplier audit | C1–C7 | 4–5 steps |
| **3** | Runs reliably for many projects / customers | P1–P7 | 4–5 steps |
| ~~**4**~~ | ~~Integrations~~ | ~~Revit, PDF markup~~ | merged into Phase 5 step 7 |
| **5** | One platform for pharma, hospital, energy / high-tech and common building projects | client specification of 2026-10-29: classification, templates, revision control, task engine, approvals, BIM, construction, commissioning, handover | largest since Phase 1; 11 steps, section 6 |

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
4. ~~Scheduled reminders + e-mail notifications (C5)~~ — **done 2026-10-22**
5. ~~Periodic user-access review report (C6)~~ — **done 2026-10-22**
6. ~~Validation pack for the software (C7)~~ — **done 2026-10-22**

Phase 3 order (user started Phase 3 with this order on 2026-10-22):
1. ~~P7 CI (API + browser suites + OQ on every change)~~ — **done 2026-10-22** (first GitHub run at the first push)
2. ~~P2 deployment (Docker, HTTPS proxy, health checks)~~ — **done 2026-10-22** (Docker parts verified in CI at the first push)
3. ~~P3 backups + tested restore (closes URS-34)~~ — **done 2026-10-22**
4. ~~P1 scale (portfolio summary endpoint)~~ — **done 2026-10-22**
5. ~~P6 monitoring (structured logs, error tracking, uptime / job alerts)~~ — **done 2026-10-25**
6. P4 object storage + virus scan — **after Phase 5** (decision §6.4.8)
7. P5 SSO / MFA — after Phase 5

Phase 5 order (client specification of 2026-10-29; full detail in section 6):
0. **Reproduce and fix the client's wizard report** ← next
1. Project classification + unified wizard (client P0)
2. Template engine: registers / requirements per industry + service (client P0)
3. Document control: working version vs formal revision (client P0)
4. Task engine (client P0)
5. Approval engine generalised (client P0)
6. RFI, issues, decision log, change control (client P1)
7. BIM registers + the real Revit add-in (client P1, absorbs Phase 4)
8. Construction and QA/QC: submittals, ITP / MIR / WIR, punch (client P1)
9. Commissioning and handover gate (client P2)
10. Archive / FM + management dashboard (client P2)

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

### Phase 2 / step 4 — e-mail notifications and scheduled reminders (C5) (done 2026-10-22)

Decisions (user, 2026-10-22): delivery over **SMTP** (customer's own server / Office 365 / any relay); e-mails for
**sign-offs waiting, overdue / due-soon items, new work assigned, and security alerts**; daily run at **08:00** site
time, changeable by an administrator.

| Area | How it works |
|---|---|
| Outbox | Every e-mail is a row in `EmailMessage`, written **in the same transaction** as the action that caused it (a rolled-back action never sends mail). A background mailer delivers due messages every 15 s (and ~1 s after new mail); rows are claimed with `FOR UPDATE SKIP LOCKED`, so several API instances are safe. Failures are retried after 1, 5, 15 and 60 minutes, then marked **Failed**; an administrator can **Retry**. Without `SMTP_HOST` messages are recorded as **Not sent** (never silently dropped). Rows are kept as delivery evidence. Plain-text mail only. |
| Work e-mails ("Immediate") | Every in-app notice addressed to a role (document registered / reassigned / returned, signature request routed, NCR raised or changed, action reassigned, transmittal issued …) is e-mailed to that role's members — never to the person acting; vendor accounts only for their own company's documents (transmittals: the receiving company). Link straight to the page (`APP_URL`). |
| Daily reminders | Once a day (default 08:00, `APP_TIMEZONE`) for every active project with the Reminders rule on: sign-offs waiting per stage (Consultant / Owner / QA); documents (Missing / Draft / Changes requested), RFIs awaiting response, open NCRs and open corrective actions that are **overdue or due within N days** (default 3). One in-app reminder per role, one audit entry per project (`role System`), and **one e-mail per person across all projects**, grouped by project and by Waiting for sign-off / Overdue / Due by. Vendor accounts see only their company's items. The scheduled run is unique per date (`ReminderRun.slot`), so restarts and several instances never send twice; a missed 08:00 (server down) runs at the next start the same day. Every e-mail and notice states that a reminder approves nothing. |
| Personal preference | Sidebar → **E-mail notifications**: *Immediate* (default), *Daily digest* (one e-mail a day: reminders + the notices addressed to you since the previous digest) or *Off*. Change logged old -> new in the security log. |
| Security alerts | Always sent to the account holder: account created (never the temporary password), password changed, password reset by an administrator, account disabled / enabled, administrator rights granted / removed, sign-in locked and electronic signing locked after wrong passwords (once per lockout). |
| Administration | Users & access → **E-mail & reminders**: delivery status (host, port, TLS, sender, link address — never the password), outbox counts, **Send test e-mail to me**; schedule (on/off, time, due-soon days) with old -> new in the security log; **Run reminders now** (`reminders.run` in the security log); run history; outbox with status filter, message text and Retry. |
| Project button | Updates & automation → **Send reminders now** stays: in-app notice per document as before, plus **one e-mail per waiting signer** listing their documents. |

Library: `nodemailer` **10.1.7**, pinned exactly (zero dependencies, SLSA provenance, registry signature verified).
Every older release carries published advisories (address parser, SMTP DoS), fixed only in 10.1.4+, so the newest
patched line was taken instead of an older release.

Env (`server/.env.example`): `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`true` = port 465 TLS), `SMTP_USER`,
`SMTP_PASS`, `MAIL_FROM` (required with `SMTP_HOST`), `APP_URL` (links; default first `CORS_ORIGIN`). The test
fixtures switch the scheduled run **off** so it never changes fixture data while a browser suite runs.

Not included (later): HTML e-mail templates, per-project mute, reminders for requirements / risks / inspections,
in-app history of a user's own e-mails, Microsoft Graph delivery.

Tests: API **464** checks (+52: security alerts and no temporary passwords in mail, preference rules, immediate
e-mail targeting incl. vendor scope and "not to the actor", Not sent without SMTP, delivery to an in-test SMTP server,
retry / back-off / Failed / administrator retry, schedule validation and logging, once-per-day scheduled run, in-app
reminders, audit entry, one e-mail per person, vendor-only items, digest content, Off, manual run, skipped projects,
"Send reminders now" e-mail); browser 197 + 54 + 20 + 20 + 19 + 33 + 26 + 20 + 22 + 16 + **29 (new `e2e11.mjs`:
preference dialog, admin schedule, run now, outbox Not sent / filter / message text, security log, in-app reminder,
audit trail, mobile)**.

Next: **Phase 2 / step 5 — periodic user-access review report (C6).**

### Phase 2 / step 5 — periodic user-access review (C6) (done 2026-10-22)

GxP control (EU GMP Annex 11 §12, 21 CFR 11.10(d)): access is reviewed at a fixed interval and the review is
documented and signed. Page: Users & access → **Access review** (administrators).

| Area | How it works |
|---|---|
| Schedule | Interval 30–365 days (default **90**), changed by an administrator (old -> new in the security log). Next due = last completed review + interval; a fresh installation is due at once. While a review is due, or an open one is past its target date (start + 14 days), the page shows a banner and the **daily reminder run e-mails every administrator** (C5). |
| Start | Snapshot of every **active** account (AR-001, AR-002 …): name, e-mail, company, administrator right, last sign-in, every project role and vendor scope (archived projects marked). **Findings** flagged per account: Administrator, Never signed in, No sign-in for 90+ days, Temporary password not changed, No project access, Only archived projects, New since the previous review. One open review at a time. |
| Decide | Per account: **Keep**; **Keep with changes** (note required: what was changed under Users); **Disable account** (reason required; applied at once with the same guards as Users — not yourself, one active administrator and the last Owner / QA of a project must remain; the user is signed out and e-mailed; cannot be reversed inside the review). Decisions can be changed while the review is open; each one is in the security log (old decision kept). Deciding on your own account is allowed but recorded as **self-review** (UI warning, report note). Filters: All / Undecided / Flagged. |
| Complete | Only when every account has a decision. Conclusion + **password** (same re-authentication and lockout as other e-signatures) with the meaning "Access review completed — remaining user access confirmed appropriate". Stores signer, e-mail, time and a SHA-256 **signature hash over the review code, every decision and note, signer, meaning, conclusion and time**; the detail view recomputes it (*Valid* / *Altered*). A completed review never changes. Cancel needs a reason. |
| Report | **PDF** per review (open, completed or cancelled): outcome counts, every account with access at review start, findings, decision, note, decider, self-review marks, signature block with hash. Generation is logged (`report.generated`, SHA-256) and the response carries `X-Content-SHA256`. |
| Security log | `access.review.started / decided / completed / cancelled`, `user.deactivated` (with the review code), `esign.signed`, `settings.updated`, `report.generated`. |

Tests: API **501** checks (+37: schedule and interval, snapshot and findings, one open review, decision rules, disable
through the review incl. sign-in refused and e-mail, self-review, completion rules, wrong password, valid / altered
signature, frozen after completion, PDF + hash log, due again after the interval, administrator reminder e-mail,
cancel); browser 197 + 54 + 20 + 20 + 19 + 33 + 26 + 20 + 22 + 16 + 29 + **23 (new `e2e12.mjs`: due banner,
interval, start, flags, own-account rules, decisions, disable, signature with wrong / right password, PDF, history,
security log, disabled vendor cannot sign in, mobile)**. The PDF was rendered and checked.

Next: **Phase 2 / step 6 — validation pack (C7)**: URS, risk assessment and IQ/OQ evidence generated from the API and
browser suites.

### Phase 2 / step 6 — validation pack (C7) (done 2026-10-22)

Customers must validate Qualigrafo as a GxP computerised system (GAMP 5). The supplier evidence is now generated from
the code and the automated tests, so it is repeatable for every release.

| Part | How it works |
|---|---|
| Catalogue | `server/src/validation/catalogue.ts` — single source: **34 user requirements** (URS-01 … URS-34: area, text, GxP impact, related Part 11 / Annex 11 clause — "relates to", never a compliance claim), **risk assessment** per requirement (severity / probability / detectability → GAMP 5 risk class and priority, controls), and **43 OQ test cases** (OQ-API-01 … 30 = sections of the API suite, OQ-UI-01 … 13 = browser suites). Consistency is tested: every requirement has tests or a stated procedural control, every test case verifies a requirement. URS-34 (backup / restore) is procedural until Phase 3 / P3. |
| OQ markers | The API suite prints `SECTION OQ-API-nn` before each block; every check after it belongs to that test case (none before the first). Titles come from the catalogue, unknown ids fail. |
| IQ | `server/src/services/iq.ts` — 16 checks with expected / found / Pass-Fail-Warning-Info: version, **code fingerprint** (SHA-256 over server code, schema, migrations, lock file), Node ≥ 22, PostgreSQL ≥ 16, **all migrations applied**, runtime packages exactly as locked, session secret strength, session limits, time zone / no pinned clock, NODE_ENV, storage write-read-hash-delete, active administrator, no test accounts, SMTP, PDF font, upload limit. Failures that only matter in production are warnings elsewhere. |
| In the app | Users & access → **System & validation** (administrators): version, fingerprint, catalogue size; **Run installation check** (result kept, `iq.executed` in the security log) with a results table and **IQ record (PDF)** with signature blocks; list of **validation packs** found in `VALIDATION_DIR` with SHA-256 and download (logged). |
| OQ run | `npm run validation:oq -- --by "Name"` (server/, test database only — refuses production): loads fixtures, runs the API suite, builds the client, starts API + preview on free ports (4100 / 8082, configurable), runs all 13 browser suites with fresh fixtures, stops the servers, records environment (version, fingerprint, git revision, OS, Node, PostgreSQL, Chrome) and **every check** per test case in `validation/out/oq-results.json`. Exit code 1 when a check fails. ~8 minutes. |
| Pack | `npm run validation:pack -- --by "Name"`: runs IQ on the same environment, refuses when the code fingerprint differs from the OQ run (`--force` for a draft), writes `Qualigrafo_Validation_Pack_<version>_<date>.pdf`: purpose and limits (supports, does not replace, the customer validation; GAMP category proposed 4), system description and test environment, URS, risk assessment with method, IQ, OQ summary per test case, **traceability matrix** (requirement → priority → test cases → checks → verdict), deviations (failed checks, procedural controls), approval page (supplier / customer QA), annex with every check. `validation/out/` is git-ignored. |

First pack: 1012 of 1012 checks passed in 43 test cases (518 API + 494 browser), IQ Pass (test environment warnings: test accounts, no SMTP, NODE_ENV, UTC zone / secret
length where applicable).

Tests: API **518** checks (+17: catalogue consistency, risk method, traceability without results, every API test
case has its section, IQ admin-only, migrations / database / storage / administrator / dependencies pass, warnings,
stable fingerprint, latest result, IQ PDF + hash, security log, pack path tricks refused); browser 197 + 54 + 20 + 20 +
19 + 33 + 26 + 20 + 22 + 16 + 29 + 23 + **15 (new `e2e13.mjs`: version / fingerprint, installation check, IQ PDF,
validation pack download or empty state, kept after reload, security log, mobile)**.

**Phase 2 is complete.** Next: **Phase 3 — platform and operations (P1–P7)**.

### Phase 3 / step 1 — continuous integration (P7) (done 2026-10-22)

`.github/workflows/ci.yml` (GitHub Actions; the repository's remote is GitHub) runs on every push to `main` /
`production-backend`, on every pull request and on demand. A newer run on the same branch cancels the older one.

| Job | Steps |
|---|---|
| **Typecheck, lint, build, audit** (Ubuntu 24.04, Node 24, ~5 min) | `npm ci` with the exact lock files (server, web); Prisma client; server typecheck; web lint (oxlint) and typecheck + build; `npm audit --omit=dev --audit-level=high` for both — a high / critical advisory in a runtime dependency fails the build. |
| **OQ and validation pack** (after the first job; PostgreSQL 18 service container) | Migrations applied with `prisma migrate deploy` (the same path as a customer installation), then `npm run validation:oq` = API suite + all 13 browser suites with fresh fixtures (Chrome on the runner), then `npm run validation:pack`. The **job summary** shows every OQ test case and lists failed checks (`scripts/oq-summary.ts`). Artifacts: **validation** (oq-results.json + validation pack PDF, 30 days) and, on failure, **e2e-screenshots** (7 days). |

Made portable for CI: the browser suites take Chrome from `CHROME_PATH` or the platform default
(`qualigrafo/scripts/e2e-lib.mjs` exports `CHROME`; Windows / macOS / Linux paths), also used by the OQ runner. CI uses
only throw-away test values (container database, test-only JWT secret); no repository secrets are needed.

Verified locally: no tabs in the workflow, both audits 0 vulnerabilities, lint exit 0, summary script output, every
suite parses, full OQ with the portable Chrome path 1012 of 1012 checks passed (43 test cases). **Not yet verified: the GitHub run itself** — it starts
at the first push of the branch (pushing is the user's decision); Linux font rendering may need small fixes in layout
checks then.

Recommended on GitHub after the first green run: branch protection on `main` requiring both jobs; Dependabot for npm
and GitHub Actions; pin actions to commit SHAs.

Next: **Phase 3 / step 2 — P2 deployment** (Docker images, HTTPS reverse proxy, environment config, health checks).

### Phase 3 / step 2 — Docker deployment with HTTPS (P2) (done 2026-10-22)

Decisions (user, 2026-10-22): Docker is verified **in CI** (no Docker on the development machine); HTTPS supports
**all three** certificate modes.

| Part | How it works |
|---|---|
| Stack (`deploy/docker-compose.yml`) | **db** PostgreSQL 18 (internal network only, health check) · **api** (`server/Dockerfile`: Node 24 slim, tini as PID 1, unprivileged user, applies migrations at start via `docker-entrypoint.sh`, health check on `/api/health`, data volume `/data` for files + validation packs) · **web** (`deploy/web.Dockerfile`: client built in a Node stage, served by Caddy 2.10, the only container with ports 80/443). Named volumes for database, files and certificates. All settings from `deploy/.env` (`.env.example` documents each). |
| HTTPS (`deploy/caddy/Caddyfile`) | `TLS_MODE=auto` (Let's Encrypt), `custom` (IT certificate in `deploy/certs/`), `internal` (Caddy CA). HTTP redirects to HTTPS. Headers: HSTS, **Content-Security-Policy without inline scripts or eval**, X-Frame-Options DENY, nosniff, no-referrer, Permissions-Policy, COOP, no Server banner. Hashed assets cached immutable, index.html revalidated, SPA fallback, request size limit, JSON access log. |
| Client address | New setting `TRUST_PROXY` (default `loopback`; `uniquelocal` in Docker). Before, the API trusted only a proxy on the same host: behind a separate proxy container every user would have shared the proxy's address — the sign-in lockout (20 failures per address) would have locked everybody out at once. Caddy replaces any client-sent X-Forwarded-For, so the address cannot be forged (tested). |
| Health | `/api/health` (API + database, now with the version) for readiness; new `/api/health/live` (no database) for liveness. |
| Install guide | `deploy/README.md` for the customer's IT: requirements, install, certificate modes, first administrator, installation check (IQ) and fingerprint, update procedure, operations, **interim backup / restore commands** (until P3), security notes, troubleshooting. |
| CI (`deploy` job, `deploy/ci-test.sh`) | Builds both images and starts the stack with `TLS_MODE=internal` and random secrets, trusts Caddy's root CA, then: 1. all 13 browser suites against the production stack (fixtures loaded inside the api container); 2. `down -v` → fresh installation → `deploy-smoke.mjs`; 3. restart → `deploy-smoke.mjs --after-restart`. Logs and screenshots uploaded on failure. |
| Smoke test (`qualigrafo/scripts/deploy-smoke.mjs`, 30 checks) | HTTP→HTTPS, headers + CSP, caching, SPA fallback, health / version, 404 / 401, create-admin → temporary password → forced change, forged X-Forwarded-For not believed, **IQ Pass in production mode** (no test data, strong secret, storage volume), web client sign-in and administration pages **without CSP violations**; after restart: data and fingerprint kept. |

Bugs found and fixed while building it: the CI `checks` job (written in step 1) would have failed — `prisma generate`
needs a `DATABASE_URL` to load `prisma.config.ts` (dummy URL set; same in the image build); the api image would have
started without `tsx` / `prisma` because `npm ci` skips dev dependencies under `NODE_ENV=production`
(`--include=dev`); shell scripts forced to LF (`.gitattributes`).

Verified locally without Docker, using a stand-in for Caddy (HTTPS with a self-signed certificate, the same headers and
CSP read from the Caddyfile, `/api` proxy with forwarded address) and the API in `NODE_ENV=production`: all 13 browser
suites pass over HTTPS under the CSP (e2e13 made environment-aware: with test fixtures in production mode IQ-13
correctly fails), the smoke test passes on a fresh database (IQ Pass, only SMTP warning) and after a restart.
**Not yet verified: the Dockerfiles, compose file and real Caddy** — they run in the CI `deploy` job at the first push.
Browser suites accept test certificates only with `E2E_IGNORE_HTTPS_ERRORS=1`.

Tests: API **520** checks (+2: health version + liveness, TRUST_PROXY parsing); browser suites unchanged in number.

Next: **Phase 3 / step 3 — P3 scheduled backups and a tested restore** (closes URS-34).

### Phase 3 / step 3 — backups with a tested restore (P3) (done 2026-10-22)

Closes URS-34 (Annex 11 §7.2), which was a procedural control until now.

| Part | How it works |
|---|---|
| Backup set | Folder `qualigrafo-YYYYMMDD-HHMMSS-mmm` in `BACKUP_DIR`: `database.dump` (`pg_dump` custom format), `files/<aa>/<sha256>` (every stored file; unchanged files are **hard links** to the previous set, so daily sets cost only the new files), `manifest.json` (release, code fingerprint, migration history, record counts of 9 key tables, dump SHA-256, file count / bytes) + `manifest.sha256`. |
| Consistency | Counts and dump come from **one database snapshot** (`pg_export_snapshot` + `pg_dump --snapshot`); files are copied after the dump (objects are written before records refer to them and never change). |
| Test restore | After each backup (setting) and on demand: checks the manifest checksum, the dump checksum and the SHA-256 of every file, restores into a **temporary database**, compares record counts and migration history with the manifest, resolves every file the database refers to, drops the database. Result *Verified* / *Failed* with the detail. |
| Schedule, retention, alerts | Daily at a set time (default 02:00 site time; once per date, also with several instances), keep newest N sets (default 14, 3–90; the newest verified set is never removed). Administrators are e-mailed when a backup or a test restore fails. Interrupted runs are marked failed at start. |
| Restore | `npm run backup:restore -- --name <set> --confirm-wipe` (or `--dir`): verifies the set, restores the database (`--clean`), adds the files, compares counts with the manifest, applies the migrations of the installed release, logs `backup.restored`. Docker: `docker compose run --rm api npm run backup:restore …` (install guide section 5). |
| Administration | Users & access → **Backups**: tools and server version, last verified backup, backup folder, **Back up now** (runs in the background; the page refreshes while it runs), schedule, history with size, files, manifest checksum, test-restore result and **Test restore** per set. Security log: `backup.created`, `backup.verified`, `backup.restored`, `settings.updated`. |
| Installation check | IQ-17 backup tools usable for the database server version (Fail otherwise); IQ-18 a verified backup younger than 48 hours (Warning otherwise). |
| Deployment | api image: PostgreSQL 18 client from the PostgreSQL apt repository (Debian's is older than the server), `BACKUP_DIR=/backups`, `PG_BIN_DIR`; compose: `BACKUP_VOLUME` (named volume or a host / NAS folder); CI: PostgreSQL 18 client on the runner; smoke test runs a backup + test restore inside the container and expects IQ-17 / IQ-18 Pass. **These Docker / CI parts are pending verification like the rest of P2.** |

Settings / env: `BACKUP_DIR` (default `backups`), `PG_BIN_DIR` (default: PATH; on Windows the newest
`C:/Program Files/PostgreSQL/<n>/bin`). Fixtures switch the scheduled backup off. `pg` is now a direct dependency
(same 8.23.1 Prisma already used — no new package).

Verified locally with PostgreSQL 18.6: backup + test restore of the test database, restore CLI into an empty and into a
filled scratch database (refuses without `--confirm-wipe`), tamper detection (file and manifest), retention, schedule.

Tests: API **541** checks (+21, OQ-API-31); browser + **16 (new `e2e14.mjs`: tools, schedule, back up now with test
restore, details, manual test restore, security log, IQ-18, mobile)**; OQ 1052 of 1052 checks passed in 45 test cases (541 API + 511 browser).

Next: **Phase 3 / step 4 — P1 scale** (portfolio summary endpoint, per-project loading).

### Phase 3 / step 4 — portfolio at scale (P1) (done 2026-10-22)

Before, the portfolio loaded **every project in full** (about 25 queries and the complete payload — audit trail,
notifications, comments, snapshots, signatures — per project) and the browser derived the figures itself.

| Part | How it works |
|---|---|
| Summaries | `GET /api/projects` now returns one **summary** per project: profile, markets, baseline, figures (coverage, gates, overdue, critical gaps / NCRs, stale evidence, flags, next due), the **work items for the user's role**, regulatory updates, the 7 nearest deadlines and the 4 latest audit entries. `GET /api/projects/:code` (full) is unchanged and loaded only when a project is opened. |
| Batch reading | Whole-project memberships are read with **one query per table for all projects** (`projectId IN …`), selecting only the needed columns; the latest audit entries with one window query. Vendor-scoped memberships (few) still go through `loadProject`, so the access rules stay in one place. |
| One set of rules | `workFor` moved from the browser to `server/src/domain/work.ts`; figures use the server's existing `stats` / `handoverGates`. The browser's copies were removed (only the open project's "ball in court" stays client-side). The API test proves, for every role incl. the vendor, that each summary is **identical** to the one computed from the full project. |
| Client | The store keeps summaries; opening a project loads it ("Loading project…", sidebar shows the summary meanwhile); returning to a workspace page re-fetches the summaries. |
| Bug found | `today()` built a new `Intl.DateTimeFormat` on every call (once per document per figure): now one formatter per time zone — faster everywhere. |
| Load-test tools | `npm run fixtures:load -- --projects 100` adds 100 projects with the history of a project in use (300 audit entries, 150 notifications each); `npm run perf:portfolio` times the portfolio and one project. |

Measured with 103 projects (local PostgreSQL 18, API in-process, median of 5):

| | Before | After |
|---|---|---|
| Portfolio `GET /api/projects` | 1010 ms, **11.9 MB** | **102 ms, 447 kB** |
| Open one project `GET /api/projects/PRJ-026` | 11 ms, 36 kB | 16 ms, 36 kB (unchanged) |
| Browser: sign-in to complete portfolio (103 rows) | — | 1.8 s (e2e15) |

URS-35 "Portfolio at scale" added to the validation catalogue (OQ-API-32, OQ-UI-15); the OQ runner and the Docker CI
test load the 100 load-test projects for e2e15.

Tests: API **549** checks (+8, OQ-API-32: summary = full computation for Consultant, Contractor, Owner / QA and vendor;
no full data in summaries; vendor sees only its company); browser + **18 (new `e2e15.mjs`)**; OQ 1078 of 1078 checks passed in 47 test cases (549 API + 529 browser).

Next: **Phase 3 / step 5 — P6 monitoring** (done, see below).

### Phase 3 / step 5 — monitoring (P6) (done 2026-10-25)

Before, the server printed one-line request logs to the console and errors ended up only there: nobody could tell
afterwards what had failed, whether the background jobs were still running, or whether the application had been down.

| Part | How it works |
|---|---|
| Structured log | One event per line — JSON for a log collector (`LOG_FORMAT=json`, the default in production) or readable text while developing. Each request logs method, path, status, duration, size, user and client address, never bodies, tokens or passwords. The line carries the **request id** that the answer returns in `X-Request-Id` and that the audit entries of that request already store: an inspector's question "which call wrote this record" now has an answer. `LOG_DIR` keeps daily files and deletes them after `LOG_KEEP_DAYS`; administrators read the tail of today's file on the page. |
| Error tracking | Every 500 answer, failed background job and unhandled process error is grouped by fingerprint (kind + place + the message with numbers and ids masked), counted, and kept with its last request id and user. An administrator acknowledges or resolves a group **with a note**; a resolved group that happens again is reopened and alerted — a fix that did not hold is not silently lost. |
| Health and job watchdog | Each background job (e-mail delivery, reminders, backups) writes a heartbeat; a watchdog writes the API's own heartbeat every minute. A gap of more than 5 minutes is recorded as an **interruption** (the application was not running or could not reach its database) and reported. Stale or failing jobs, a burst of errors per hour and low free space raise alerts as well. |
| Alerts | E-mail to every active administrator plus a security-log entry (`monitor.alert`), at most once per hour per subject so a failing installation cannot flood the outbox. Switchable per kind; "Send test alert" proves the path works. |
| Metrics for an uptime tool | `GET /api/metrics` (Prometheus text, `METRICS_TOKEN` required, 404 without it): up, uptime, build, database latency, requests by status class, p50 / p95, open errors, memory, free space, job age and failures, backup age. |
| Monitoring page | Administration → Monitoring: health (version, runtime, database round trip, memory, free space, requests and response times, log destination, metrics state), background jobs, error groups with acknowledge / resolve / reopen, interruptions, alert settings and the server-log tail. |
| Installation check | IQ-19 logging destination, IQ-20 alert configuration, IQ-21 background jobs, IQ-22 free space. |

URS-36 "Monitoring and alerting" added to the validation catalogue (OQ-API-33, OQ-UI-16). New settings
`LOG_LEVEL`, `LOG_FORMAT`, `LOG_DIR`, `LOG_KEEP_DAYS`, `METRICS_TOKEN` (server `.env.example`, `deploy/.env.example`
and the compose stack, which writes daily files into the api volume). Migration `monitoring`
(`ErrorEvent`, `JobHeartbeat`, `Outage`); `morgan` removed — the request log is now our own.

Tests: API **578** checks (+29, OQ-API-33: request log with its request id, JSON lines without credentials, daily
rotation with retention, request figures, error grouping and reopening, a 500 recorded with route / request id / user,
alert settings and their security-log entry, stale-job and outage alerts with the once-per-hour throttle, metrics
endpoint with and without its token, IQ-19…22); browser + **23 (new `e2e16.mjs`)**; OQ 1130 of 1130 checks passed in
49 test cases (578 API + 552 browser).

### My profile — the personal account page (done 2026-10-25)

Until now a person could only change their password and their e-mail preference, through two small links in the
sidebar; nobody could see **their own roles**, and an inspector's question "what does this account have access to"
had no answer in the application. A profile page closes that, without moving account data out of the administrator's
hands.

| Section | What it shows / does |
|---|---|
| Account | Name, e-mail, company, administrator rights, account created, last sign-in, when the password was last changed — read-only, with a line saying the administrator maintains them (a GxP account record stays controlled). |
| My access | Every project with the role held there and the record access (whole project, or limited to one company for a vendor account). |
| Security | Inactivity lock and maximum session length, the password form inline, and **Sign out of all devices** — bumps the token version so every token of the account is refused, logged as `sessions.revoked` and e-mailed to the account holder. |
| E-mail notifications | The same preference as the dialog (Immediate / Daily digest / Off), now editable on the page; security alerts stay always-on. |
| My recent activity | The account's own security events and the audit entries it wrote, newest first — nobody else's. |

API: `GET /api/auth/me` now also returns `account` (created, last sign-in, password changed, idle minutes, session
hours); new `GET /api/auth/activity?limit=` and `POST /api/auth/sign-out-everywhere`. The sidebar footer became a
button to the page (`#/profile`), the quick links stay.

URS-37 "Personal account page" added to the validation catalogue (OQ-API-34, OQ-UI-17). Also fixed while testing:
a verification whose process was killed left its temporary database behind and made the next test restore fail —
`verifyBackup` now drops leftovers first; the API suite can reset the per-address request ceiling (`resetApiRate`).

Tests: API **598** checks (+14, OQ-API-34: own account and roles, vendor scope, activity limited to the account,
401 without a session, sign out of all devices refusing every token, security log and e-mail); browser **+21**
(new `e2e17.mjs`) = **587**; OQ **1185 of 1185** checks passed in 51 test cases.

Next: **Phase 3 / step 6 — P4 object storage** (S3 / Azure Blob with the same content-addressed keys, virus scan on
upload), then P5 (SSO / MFA, httpOnly-cookie sessions).

### Readiness rehearsal and the first-day fixes (done 2026-10-25)

The whole customer journey was run on an **empty database** (install → `create-admin` → users → project wizard →
library approval → requirements → document → upload → two-stage e-signature → evidence → RFI / NCR / transmittal →
reports → access review → backup → monitoring). It worked end to end — installation check **Pass** (17 pass,
2 warning, 0 fail) — and produced a gap list (`UAT_REPORT.md`). The five items a tester hits first were fixed:

| Gap found in the rehearsal | Fix |
|---|---|
| A new project has no systems, so the first RFI failed only **after** submitting ("System (none) is not in the system register") | The RFI form keeps *Submit* disabled and says what is missing; the project overview now carries a **set-up checklist** (systems · requirements · applicability · documents) that disappears when the four steps are done. |
| Applicability had to be decided one requirement at a time (17 here, 50–150 on a real project) | Select requirements in the register and record **one decision with one rationale** for all of them: `POST /projects/:id/reqs/applicability`. The rationale is written to every requirement and each keeps its own audit entry ("one of N decided together"), so the trail stays per record. |
| The four-eyes rule means a one-account installation can never approve the library — nothing said so | `create-admin` now tells the installer to create a second account, the library draft says who may approve, and `deploy/README.md` lists it as an installation step. |
| "Apply to project", "Submit RFI" and "Issue transmittal" stayed enabled without their reason / system / purpose and failed with a toast | All three disable the action and explain the missing input in place, like the rest of the product. |
| The transmittal receipt could only be acknowledged after expanding the row | The recipient now sees **Acknowledge** in the list row. |

Tests: API **584** checks (+6, batch applicability: rationale required, unknown id rejects the whole batch, both
requirements carry the decision and its rationale, one audit entry each, a contractor refused); browser **566**
(+8 e2e2 RFI and batch decision, +3 e2e4 set-up checklist, +3 e2e10 transmittal purpose and receipt);
OQ **1150 of 1150** checks passed in 49 test cases.

### Interface redesign — deep blue glass (done 2026-10-25, customer request)

The customer asked for the brand colour to change from teal/green to **dark blue** and for the current
**transparent glass** look. Done as a design-system change only: no component structure, text, control or endpoint was
touched, so all 1130 OQ checks pass unchanged.

| Part | What changed |
|---|---|
| Colour | One brand colour (`--brand` #2563eb with `--brand-d` / `--brand-dd` / `--brand-l`), deep navy shell (#0a1b3c), cool neutrals. The old `--teal*` names stay as aliases so components keep working. Status colours (green / amber / red / violet) stay distinct, as GxP records are read by their state. |
| Glass | Frosted surfaces (`backdrop-filter`) on cards, tables, stat tiles, the top bar, drawer, command palette, modals, popovers and toasts, over a fixed blue "aurora" background; hairline white edges and soft blue-tinted elevation. Overlays are nearly opaque (0.95) so dense text stays readable. |
| Polish | 9–14 px radii, gradient primary button with a hover lift, pill badges, sticky translucent table headers, blue row hover, focus ring (3 px, 2 px offset), custom scrollbars, gradient page titles, `accent-color` for checkboxes. |
| Robustness | Fallback to solid surfaces via `@supports not (backdrop-filter)`, opaque sidebar on mobile, `prefers-reduced-motion` switches transitions off, print styles drop blur and shadows. |
| Build fix | `vite.config.ts` now sets `build.cssTarget: 'chrome111'` and the stylesheet writes `-webkit-backdrop-filter` **before** the standard property: esbuild keeps only the last of such a pair, and it was dropping the standard one — the frosted surfaces rendered flat in Chrome. |
| Tool | `qualigrafo/scripts/shots.mjs` (`node scripts/shots.mjs` against a preview server) captures the main screens, the overlays and a mobile view into `qualigrafo/design-out/` for reviewing the look. |

Checked: all 15 browser suites plus the API suite (**1130 of 1130**), screenshots of portfolio, overview, requirements,
documents drawer, monitoring, command palette, sign-in and mobile, light / dense tables, no horizontal scroll at 390 px.

**Second pass (same day): authentication screens and screen-level polish.** The theme was in place but the screens
before the workspace still looked like a plain form on a gradient, so they were rebuilt and the shared components
tightened. No component logic, route, request or test selector changed.

| Part | What changed |
|---|---|
| Sign-in | Split composition: left a deep-navy panel with the product name, what Qualigrafo does and three true capabilities (register · signed decisions · audit readiness) over three frosted panes; right the form on white, which is where the eye lands. Labels are now properly bound to their inputs (`htmlFor`/`id`), the password field has a show / hide control, the primary action is full width, and a closing line states that sign-ins and signatures are recorded. |
| Forced password change | Same frame as sign-in (`AuthShell`), with the live password rules under the field. |
| Lock screen | Centred card on the navy mesh with the signed-in identity shown as an avatar chip, show / hide password and the same type scale. The test hooks (`Unlock password`, heading, `.lockscreen`) are unchanged. |
| Mobile auth | Its own composition: the brand panel collapses to a compact bar, the decorative panes are dropped, the form is the first thing on screen and fills the viewport. |
| Shell | Sidebar rhythm (group labels, 34 px items, focus ring on dark), 54 px top bar, breadcrumb weight, quieter counters. |
| Screens | Uppercase micro-labels on figures and key/value blocks, tabular figures, calmer table padding, 21 px pill badges, compact empty states, cards that take their own height instead of stretching (no more half-empty panels), dates kept on one line. |
| Motion | Short, purposeful entrances (scrim fade, drawer slide, palette / modal pop, toast rise, page fade) — all switched off under `prefers-reduced-motion`. |
| Accessibility | Visible 2 px focus ring on every control including the dark sidebar, real label bindings, `aria-pressed` on the password toggle, touch-sized controls. |

Verified again after this pass: **1130 of 1130** OQ checks, production build and lint clean, screenshots of sign-in
(desktop + mobile), forced password change, lock screen (mobile), portfolio, overview, requirements, document drawer,
monitoring, users and the command palette in `qualigrafo/design-out/`.

Next: **Phase 3 / step 6 — P4 object storage** (S3 / Azure Blob with the same content-addressed keys, virus scan on
upload), then P5 (SSO / MFA, httpOnly-cookie sessions).

**Third pass (2026-10-26): visual polish, appearance only.** The redesign was kept; this pass only removed what was
too loud and tightened what was loose. One appended layer, `v9` in `qualigrafo/src/index.css`. No component, route,
request, label or test selector changed.

| Part | What changed |
|---|---|
| Canvas | The blue aurora behind the glass is roughly half its former strength (0.22/0.18/0.16/0.12 -> 0.09/0.07/0.06) and the page gradient is paler, so screens read as a white workspace with a blue cast rather than a blue page. |
| Card edges | Cards, tables and figures had a white border on a near-white page, so they read as floating blurs; they now carry a real hairline (`rgba(18,42,84,0.11)`) with the white inset highlight kept for the glass feel. |
| Elevation | Card shadow cut from `0 18px 40px -28px / 0.55` to `0 10px 24px -22px / 0.34`, and the primary button's blue glow roughly halved. |
| Readability | Surfaces went from 0.78/0.62 to 0.92/0.82 opaque, so the glass stays selective and 12-13 px text keeps its contrast on every panel. |
| Card headings | `.card.flush > h2` is `18px 18px 12px`, so a flush (table) card and a padded card standing side by side now line up on their title — previously 5 px apart on Overview. |
| Marks | Badges and tags share a 6 px radius, and filled badges gained a hairline in their own hue so they carry the same weight as the outlined ones next to them. |
| Tables | Row hover is brand-neutral (`rgba(37,99,235,0.035)` instead of a teal-ish white), header and cell rules are blue-grey hairlines. |
| Sign-in | Split is `1.12fr 0.88fr`, the form 424 px with 40 px inputs and a 44 px action, so the white column hugs the form (gutters 279 px -> ~125 px) and the field/button proportions match; content is optically centred. The three frosted panes are now one deliberate cascade down the right of the brand panel instead of three stray rectangles, one of which sat behind the copy. |

Checked on this pass: production build clean, **all 16 browser suites pass** and the API suite passes **598 of 598**;
screenshots re-captured to `qualigrafo/design-out-v9/` and compared against `design-out/`. A first attempt put the
`.auth` and `.auth-panel` rules after v7's `@media (max-width: 980px)` block and silently broke the mobile stack
(the split stayed two-column at 414 px); both are now guarded with `@media (min-width: 981px)` and mobile sign-in was
re-checked.

Next: **Phase 3 / step 6 — P4 object storage** (S3 / Azure Blob with the same content-addressed keys, virus scan on
upload), then P5 (SSO / MFA, httpOnly-cookie sessions).

---

## 6. Phase 5 — multi-industry platform (client feedback, 2026-10-29)

The client tested the system and sent six HTML specifications plus a LinkedIn carousel (`clientnew/`). They are kept
verbatim there; this section is the plan derived from them.

### 6.1 What the client sent

| File | What it is |
|---|---|
| `Qualigrafo_Demo_Project_Issue_Report.html` | Their test of the project wizard with "Demo Project"; three P0 claims (see §6.5 step 0) |
| `Qualigrafo_Final_Project_Classification.html` | New project classification: four industry groups + Design / BIM / Design+BIM |
| `Qualigrafo_Comprehensive_Industry_Facility_UI.html` | Mock-up of the industry-group / facility step |
| `Qualigrafo_Unified_Project_Creation_UI.html` | Mock-up of the whole project-creation wizard (six steps) |
| `Qualigrafo_Developer_Upgrade_Spec_Existing_App.html` | **The actual specification**: screen-by-screen mapping, data model, priority order |
| `Qualigrafo_End_to_End_Lifecycle_UI_Blueprint.html` | Full lifecycle blueprint: setup → mobilization → planning → design/BIM → review → construction → commissioning → handover → archive |
| `Qualigrafo_LinkedIn_Carousel.pdf` | The public positioning the client is already publishing |

### 6.2 What it means

Qualigrafo stops being a pharma-only product and becomes a **multi-industry engineering + BIM + document-control
platform**, with pharma as one of four industry groups. The carousel already says so publicly: "Engineering • BIM •
Documents • Evidence", "from project information to project intelligence".

Three instructions in the specification are explicit and constrain everything below:

1. *"Upgrade the existing Pharma application. Do not rebuild the product from scratch."* Login, sidebar, Portfolio,
   My work, Regulatory watch, Requirement library, Users & access and the pharma data model all stay.
2. *"Keep one wizard only. Do not keep the old Pharma wizard separately."* The new fields go **inside the existing
   step 2**, not on a new industry page.
3. *"Do not create separate project tables for Pharma/Hospital/Solar."* One project object gains common fields;
   industry behaviour comes from **templates**, not from separate applications.

This matches the house rule in `CLAUDE.md`: never remove a feature, make simulated things real. Nothing in the pharma
product is dropped — it becomes the pharma template of a general engine.

### 6.3 Gap analysis — what exists, what is new

Most of the lifecycle blueprint is already built; the client could not see it because the wizard stopped them at
project creation. Mapping their modules onto what is in the repository today:

| Client module | Today | Work needed |
|---|---|---|
| Project classification (industry, facility, service type, stage, BIM level) | `Project` has `facility`, `scope`, `phase`, `plantCountry`, `markets` — all pharma-shaped | **New**: `industryGroup`, `facilityType`, `secondaryFacilityType`, `customFacilityType`, `serviceType`, `projectStage`, `bimRequirement` |
| Dynamic registers per project | Registers exist (`Company`, `System`, `Discipline`, documents, requirements) but the content is pharma-only | **New**: template engine keyed on industry + facility + service + discipline + stage + country |
| Industry requirement packs | `LibraryPack` / `LibraryVersion` / `LibraryItem` with draft → approved and four-eyes | **Extend**: packs for hospital, solar/renewable, semiconductor, common buildings; applicability filter per industry |
| Master document register | `Document` + `DocHistory` + `DocSignature` + `StoredFile` (SHA-256) + `IssuedPackage` | **Extend**: see revision control below |
| Version vs formal revision | `Document.rev` is an integer plus `sourceRev`; history is an event log | **New**: `DocRevision` records (previous-revision link, reason for issue, suitability, prepared / checked / approved, superseded retained, compare, revision tree) |
| Configurable status / suitability | `DocStatus` is a fixed union in `server/src/domain/types.ts` | **New**: per-project configurable status set, with the current set as the default |
| Task engine | "My work" is **derived** from record state — nothing is assignable | **New**: `Task` records with owner, dates, priority, dependency, evidence, escalation, history — merged into the existing derived queues, which stay |
| Review / approval / e-signature | Two-stage sign-off with re-authentication and signature audit (C1) | **Extend**: review packages, sequential *or* parallel reviewers, mandatory QA/QC step, return-for-revision, per-project approval matrix |
| Transmittals + distribution | `Transmittal` with purpose, revision list, acknowledgement, PDF | **Extend**: distribution matrix — who receives which document type / status automatically |
| RFI / issue / clash / decision | `Rfi`, `Finding`, `Pin` + `PinReply` (comments with location), `Inspection`, `Ncr` | **Extend** RFIs with impact and ageing; **new** decision log; clash issues arrive with BIM |
| Change control | `Change` + `ChangeItem` | **Extend**: impact assessment across scope, cost, schedule, design, BIM, compliance, handover |
| BIM registers | Connector API, `RevitModel`, `ModelSnapshot`, `NavigationRequest` (BACKEND_NOTES §13) | **New**: model register, BEP / MIDP / TIDP, LOD / LOI, clash matrix, model QA, COBie / asset export |
| Construction / PMC | `Inspection`, `Ncr`, `Finding` | **New**: submittals, material approval, ITP / MIR / WIR, site instruction, punch list |
| Commissioning | — | **New**: commissioning register, readiness gates |
| Handover gate | `handoverGates()` in `server/src/domain/rules.ts` — ten gates — plus the handover dossier PDF | **Extend**: industry-aware gates, formal waiver by an authorised user, mandatory-record completeness |
| Archive / FM | Project archive (read-only, nothing deleted), `Snapshot` | **Extend**: asset handover to FM, post-handover defects |
| Audit trail, security, backup | `AuditEvent` with old → new values, security log, signatures, backups with a tested restore, monitoring | **Already done** — the part the client asked for and where we are ahead |

### 6.4 Decisions taken (2026-10-29)

Judgment calls made while writing this plan. Each is reversible; listed so the client can object.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Product identity | Keep the name **Qualigrafo**; drop "pharma" from the positioning and from generic UI copy. Pharma wording survives inside pharma templates | The client's own carousel already positions it this way |
| 2 | Does the validation pack (IQ / OQ / catalogue, C7) still apply? | **Yes, unchanged.** It validates *our software*, not the customer's project industry | A hospital customer still wants a validated tool; dropping it would lose the Phase 2 audit position |
| 3 | Where do industry requirement packs come from? | Reuse `LibraryPack` with an industry + facility applicability filter, shipped as **unverified starter templates** the customer's own lead approves | Keeps decision §4.3: we never present content as verified regulation |
| 4 | Existing projects after the migration | Backfill `industryGroup = 'Pharma'`, `facilityType` = current `facility`, `projectStage` = current `phase`, and `serviceType` from `revitMode` (`true` → Design + BIM, else Design only) | No project loses data and none lands in an empty state |
| 5 | Is `plantCountry` renamed? | Yes → **`projectCountry`** in UI and API, column renamed in one migration. The regulatory-authority logic stays but becomes industry-aware (pharma markets only for pharma) | The client asked for it, and "plant" is meaningless for a hospital |
| 6 | Wizard shape | Stay at **five steps** (Basics, Scope & classification, Registers, Team, Review) rather than the client's six — their steps 2 and 3 both live in our step 2 | Instruction 2 of §6.2 says one wizard; step count was never the complaint |
| 7 | The old `Facility` union | Becomes `facilityType: string` driven by reference data, with the five pharma values kept as the pharma group's list | A fixed union cannot hold four industries plus "Other / custom" |
| 8 | Order against the rest of the roadmap | Phase 5 runs **before** Phase 3 steps 6–7 (P4 object storage, P5 SSO / MFA) | The client is blocked today; storage and SSO block nobody |
| 9 | Relationship to Phase 4 (Revit add-in) | Phase 4 merges into Phase 5 step 7 (BIM registers) | The client's BIM asks and the add-in are the same body of work |

| 10 | Does an administrator see every project on a single-tenant installation? | **Yes — they see that it exists, but membership still governs access.** `GET /admin/projects` lists every project with the role the reader holds (or `null`); the Portfolio shows the ones outside their own portfolio under "Other projects on this installation", and opening one is still refused until they give themselves a role, which is audited like any membership change | Administrators are expected to see the whole installation, but every permission inside a project is built on `role`. A read-only administrator role would touch every permission check — that is Phase-5-sized work, not a step-0 fix. Listing without access gives the visibility without inventing a new permission level |
| 11 | When does P4 (object storage) happen, given that the hosted trial already loses files? | **Not now, and not after all of Phase 5: right after Phase 5 step 3** (document control with formal revisions). Step 0 only makes the limitation visible — the product says that storage is not durable, and the client is told in writing. | Full P4 (S3 / Azure, migration, virus scan, backup rework) is a step of its own, and doing it first would delay what the client actually asked for. But step 3 is where controlled revisions start being uploaded, and from that moment durable storage is not optional. Before step 3 it is premature; after step 3 it is late. **If the client wants to put real drawings on the trial instance, P4 moves to the front** — that is the trigger to re-order |

Open question for the client (does not block step 0 or 1): whether the configurable status / suitability codes should
ship with **ISO 19650** suitability codes (S0–S7, A1–An, B1–Bn) as the default set, or whether every customer defines
their own from scratch. The plan assumes ISO 19650 as the default plus free editing.

### 6.5 Step order

Every step is delivered the way `CLAUDE.md` requires: backend + UI + API tests + a browser suite + screenshots checked
+ both docs updated + a commit offered. Catalogue entries (`server/src/validation/catalogue.ts`: URS + risk + OQ case)
are part of each step, not an afterthought.

**Step 0 — reproduce and fix the client's wizard report.** The client tested the **Render free-tier deployment**
(`render.yaml`: `plan: free`, `branch: main`, Neon database, `IDLE_TIMEOUT_MIN: 15`, API + built frontend in one
service via `STATIC_DIR`), not a local build.

What the code says. Their three P0 claims (Next jumps back, country resets, step 2 loses state) do not match
`qualigrafo/src/pages/NewProject.tsx`: the whole draft is one `useState` object, nothing writes to it on a step change,
and Next only ever does `setStep(step + 1)`. The deployment is **not** stale either — `origin/main` already contains
the current head, so they ran today's wizard code. The idle lock is also not the cause on its own: `lock()` only clears
the token and leaves `session` set, so `LockScreen` renders as an overlay and the wizard stays mounted underneath.

**Reproduced on the live deployment (2026-10-29), signed in with the client's own admin account.** The wizard
works. Steps 1 → 2 → 3 → 4 → 5 all advance, **Next was never disabled**, Back from the Review step to Basics kept
India selected, and the browser reported **no console errors and no failed requests**. The database also already holds
a project created through this very wizard (`dfv`, plant country IN, Non-sterile formulation, New plant, Design,
baseline B1) — so project creation reaches the end. **Their three P0 claims are not reproducible as written.**

**The audit trail on the live instance says what actually happened.** The client used the **Admin** account
(confirmed by the user). Project `FBG` ("dfv") was created successfully on **2026-10-26 18:57:47** — three days before
their report — and its four audit entries are the whole story:

```
18:57:47  Project FBG created: dfv (fvv, nagpur); markets IN; Non-sterile formulation · New plant
18:57:47  Team: Admin <smoin4425@gmail.com> added as Owner / QA
18:57:47  Requirements: no approved library pack for IN
18:59:07  Team: SHOAIB <tiengineers01@gmail.com> added as Consultant
```

Then nothing: 0 requirements, 0 documents, 0 systems. **The wizard was never the problem — the project it produced was
empty, so there was nothing to do next.** And the reason it was empty is a chain the client could not break on their
own:

- The requirement library has **five packs and not one approved version** (`GET /library`: `versions: []` for SA, IN,
  EU, US, UK). Without an approved version for IN, a new project gets no requirements at all.
- Approving a version needs **two different people** — `approveVersion()` in `server/src/services/library.ts` refuses
  the author or last editor of the draft.
- Only **one** account can act: `skmoeen1436@gmail.com` (QA Lead, admin) and `tiengineers01@gmail.com` (SHOAIB, MORPH)
  both still have `mustChangePassword: true`, and SHOAIB is not even an editor (`isAdmin: false`, Owner / QA on no
  project; the library needs an administrator or an Owner / QA).

So: one usable editor → the four-eyes rule can never be satisfied → no approved library version → every project is
created empty → "the software does not work". **`UAT_REPORT.md` predicted exactly this** in gap §3.3, and its §4
hand-over checklist says to create two usable Owner / QA accounts (item 2), configure SMTP (item 3) and approve the
starter library per market (item 6). None of the three was done before the client got the URL. The failure is a
**hand-over failure, not a code defect** — and the client's specification asking for an auto-generated workspace is
them describing the hole they fell into.

Three code-level defects also came out of the session:

| # | Defect | Evidence |
|---|---|---|
| 1 | **A reload loses the whole draft.** The draft lives only in component state and `plantCountry` defaults to `'SA'`, so a reload puts the wizard back on step 1 with **Saudi Arabia** selected | Reloaded mid-wizard: state went from `IN` on step 2 back to `SA` on step 1. This is the one mechanism that produces all three of their symptoms at once — and on free Render a reload is easy to hit, because the instance spins down when idle and `ErrorBoundary`'s only offer is a **Reload** button |
| 2 | **"New project" is hard to find.** The button sits in the Portfolio page header, not in the sidebar — and the client's own mock-ups put "＋ Create Project" in the sidebar. Worse, `#/new` is not a route: it falls back to Portfolio **silently**, with no message | Sidebar buttons are Portfolio, My work, Regulatory watch, Requirement library, Users & access and the project list — no create action. `#/new` rendered Portfolio; only `#/new-project` opens the wizard |
| 3 | **An empty project is created in silence.** The audit records "no approved library pack for IN", but the user is never told that the project they just created has nothing in it and what to do about it | Project `FBG`: 0 requirements, and the Owner / QA saw no blocking message |
| 4 | **Two of three accounts are stuck before first use.** Both `skmoeen1436@gmail.com` and `tiengineers01@gmail.com` still have `mustChangePassword: true`; nothing in the product tells an administrator that an invited user never got in | `GET /api/admin/users` |
| 5 | **An administrator cannot see every project.** Project `BENIN001` ("BENIN", QA Lead as Owner / QA) does not appear for the Admin account, because the portfolio is membership-based. On a single-tenant installation an administrator probably should see all projects — to confirm with the user | `GET /api/projects` as Admin returns only `FBG` |

So this step delivers, in order:

**A — unblock the client's installation today** (operational, no release needed):

1. Reset the temporary passwords of `skmoeen1436@gmail.com` and `tiengineers01@gmail.com` and get both signed in, so a
   second library editor really exists. SHOAIB also needs Owner / QA somewhere, or admin rights, to be an editor.
2. With two people, verify and approve a starter library version for **IN** (and any other market the client wants),
   then apply it to project `FBG` so the client finally sees requirements. Or load their own content instead.
3. Configure SMTP and send the test alert; raise `IDLE_TIMEOUT_MIN` on the trial instance (15 is a GxP production
   value, not a demo value); re-run the installation check and keep the IQ PDF.
4. Tell the client plainly what was wrong — the installation was handed over half-configured — and what changed.

**B — make the product refuse to repeat it** (the code part of this step):

5. **A project may not be created empty in silence.** The creation result, the project overview and the set-up
   checklist must all say "0 requirements, because no library version is approved for IN", with the next action linked.
   The audit already records it; the UI has to surface it.
6. **Users & access must show who never signed in** — an "invited, never signed in" state with a resend / reset
   action, so an administrator notices a stuck account before a tester does.
7. **The Library page must state the four-eyes blocker as a blocker**, not a hint: when only one editor can act,
   approval is impossible, and the page should say so and offer to invite a second editor.
8. **Make project creation reachable**: a create action in the sidebar as the client's mock-ups show, and unknown home
   routes (`#/new` among them) resolve or say why they did not, instead of falling back to Portfolio in silence.
9. **Persist the wizard draft** — the draft *and* the step, kept per browser tab and dropped when the project is
   created or the wizard is cancelled, so a reload or a remount resumes instead of restarting at Saudi Arabia.
   (Built with `sessionStorage`, not with the step in the URL: a half-finished draft is not worth sharing by link,
   and per-tab storage keeps two parallel drafts from overwriting each other.)
10. Field-level inline validation on the field itself, plus an explicit reason next to a disabled Next instead of only
    the "Still needed: …" notice; show the country ↔ market dependency rather than applying it silently.
11. Cold-start handling: a "waking the server up" state with a retry on a failed first request, instead of an error
    whose only way out is a reload.
12. The client's configuration (Demo Project / Demo Client / India / Non-sterile formulation / New plant / Design /
    India – CDSCO) becomes a permanent browser suite — and a second suite asserts that a project created with no
    approved library version **tells the user so**.
13. **An administrator sees the whole installation** (decision §6.4.10): `GET /admin/projects` carries every
    project with the role the reader holds, and the Portfolio lists the ones outside their own portfolio under
    "Other projects on this installation", with the audited way to give themselves a role. Access itself still needs
    a membership, and the API suite proves that listing a project is not access to it.
14. **Say that files are not durable on the trial instance** (decision §6.4.11): where uploads happen, and in the
    hand-over note, state that a Render free instance has no persistent disk, so uploaded files and local backups do
    not survive a restart. The database is on Neon and does survive.

**Step 1 — project classification + unified wizard (client P0).** The data-model fields from §6.3, the migration with
the backfill of decision 4, the `projectCountry` rename, reference data for the four industry groups and their facility
lists (every group ends with "Other / custom facility"), optional secondary facility, mandatory service type, project
stage, a BIM requirement block shown only when the service type includes BIM, and a review screen showing the full
classification. Portfolio gains filters for industry, facility, service type, stage and country.

**Step 2 — template engine (client P0).** Registers, requirements, workflows and deliverables generated from industry +
facility + service + discipline + stage + country instead of from pharma defaults. Service-type behaviour: Design-only
hides BIM fields, BIM-only hides the design-calculation registers unless enabled, Design + BIM links both. Industry
starter packs for hospital, solar / renewable, semiconductor and common buildings beside the pharma library.

**Step 3 — document control: version vs formal revision (client P0).** `DocRevision` records with previous-revision
link, reason for issue, suitability, prepared / checked / approved / issued, superseded retained and searchable,
revision compare, revision tree, and an automatic revision register. An approved revision is never overwritten.
Per-project configurable status / suitability codes.

**Step 4 — task engine (client P0).** Assignable `Task` records with owner and collaborators, planned / due / actual
dates and ageing, priority, status flow, dependency on a task, document, RFI or approval, evidence attachments, a
reminder before due and escalation after overdue (reusing the C5 reminder service), and a full change history. My work
becomes tasks **plus** the existing derived role queues.

**Step 5 — approval engine generalised (client P0 tail).** The pharma two-stage sign-off becomes a reusable engine:
review packages bundling documents and models, sequential or parallel reviewers, mandatory QA/QC, client and authority
approval, return-for-revision, approval meaning, e-signature where the project requires it, and the transmittal
distribution matrix.

**Step 6 — RFI, issues, decision log, change control (client P1).** Extend the existing records with location and
discipline, the linked drawing or model, priority and ageing, impact and closure evidence; add the decision log; extend
change control with the seven impact areas of §6.3.

**Step 7 — BIM registers and the Revit add-in (client P1, absorbs Phase 4).** Model register, BEP / MIDP / TIDP, model
breakdown, LOD / LOI, coordinates, clash matrix, clash issues with viewpoints, model QA/QC, COBie and asset data — fed
by the real add-in on top of the existing connector API.

**Step 8 — construction and QA/QC (client P1).** Submittals (material, datasheet, shop drawing, method statement,
vendor document, sample), material approval, ITP / MIR / WIR with checklists and site photos, site instruction, punch
and snag lists, closure evidence; NCR and corrective action lifted onto the same engine.

**Step 9 — commissioning and handover (client P2).** Commissioning register (system, pre-commissioning checklist, test
procedure, witness, result, deficiency, retest, acceptance), readiness gates, the handover package completeness matrix,
"Handover complete" only when every mandatory record is approved **or formally waived by an authorised user**, and the
final dossier extending the existing handover PDF.

**Step 10 — archive / FM and the management dashboard (client P2).** Freeze the accepted project record, controlled
archive of superseded information, asset handover to FM, post-handover defects, and the KPI dashboard the client
sketched: overdue tasks, documents in review, open RFIs, handover readiness %, review ageing, revision health, open
clashes, NCR ageing, submittal status, commissioning progress, upcoming milestones.

Afterwards: Phase 3 step 6 (P4 object storage + virus scan) and step 7 (P5 SSO / MFA), then the client's own last item,
the AI / knowledge engine, which depends on the data model above being stable.

### 6.6 Testing — the "smooth software" gate

The client's complaint was that the product broke on first contact. Every step therefore has to pass all of the
following before it counts as done, not only its own new tests.

| Gate | What it means |
|---|---|
| Regression | The full OQ (`cd server && npm run validation:oq -- --by "Name"`) stays green. Today: 1185 checks (598 API + 587 browser) in 51 cases. A step may add checks; it may never reduce the count |
| New step tests | API blocks under a new `section('OQ-API-nn')` plus a new browser suite with an OQ-UI case, both registered in `server/src/validation/catalogue.ts` with their URS and risk |
| The client's own test case | The "Demo Project" configuration from their issue report runs as a permanent browser suite (step 0), so their failing scenario can never regress |
| Migration | Every migration is applied to a copy of the development database **and** to fixtures holding old-shape projects; the backfill of decision 4 is asserted, and `npm run backup:restore` is re-run after the schema changes |
| Scale | After the wizard, portfolio-filter and task-engine steps: `npm run fixtures:load -- --projects 100` then `npm run perf:portfolio` |
| Per-industry rehearsal | The UAT walk (`qualigrafo/scripts/uat/stage1..11.mjs`) is repeated once per industry group — pharma, hospital, solar, common — not only pharma; the result is appended to `UAT_REPORT.md` |
| Visual | `node scripts/shots-all.mjs` reviewed for every page a step touches, so the glass / dark-blue interface stays consistent (interface notes in `CLAUDE.md`) |
| CI | The same gates run in `.github/workflows/ci.yml` jobs `checks`, `oq` and `deploy`. **These have still never run on GitHub** — the pending verification in §1 now blocks Phase 5 too and should be cleared at the first push |

Two extra rules for this phase, because it touches shipped records:

- **No destructive migration.** Renames and new columns only; no column holding customer data is dropped without the
  data moving first. `plantCountry → projectCountry` is a rename, not a drop-and-add.
- **Industry regression.** Every step that generalises a pharma feature must leave a pharma project behaving exactly as
  before. The existing pharma browser suites are the proof and must not be edited to accommodate new behaviour.

### 6.7 Progress

#### Phase 5 / step 0 — first contact (done 2026-10-29)

Investigated on the client's own deployment, then fixed. Evidence and the three defects: §6.5 step 0.

| Part | What was done |
|---|---|
| Server advisories (§7 items 1–2) | `npm audit fix` in `server/`: body-parser 2.3.0 → **2.4.0**, multer 2.4.0 → **2.5.0**, fast-uri 3.1.8 → **3.1.9**. `package.json` unchanged — lock only, so no major bump. Server audit is now **0 vulnerabilities** (was 2 high + 1 moderate); the frontend was already clean. `npm audit fix` rewrites the lock without installing, and `npm install` then reports "up to date", so **`npm ci` is needed** to make `node_modules` match — IQ-06 (installed versions == lock) is what catches the mismatch |
| Draft survives a reload | `qualigrafo/src/pages/NewProject.tsx`: the draft **and** the step are kept per browser tab (`sessionStorage`), restored with a "Draft restored" notice and an explicit way to start over, and dropped when the project is created or the wizard is cancelled |
| A blocked step names its reason | Validation is a map of field → message: each message sits on its own field, and the first one is printed next to the disabled **Next**. The older "Still needed: …" line stays |
| Project creation is reachable | A **Start a project** action in the sidebar for anyone who may create projects. Deliberately not "New project" (the Portfolio action) nor "Create project" (the wizard's own submit button): three controls lead into creation and two of them must not answer to the same name |
| Unknown addresses say so | `components/ui.tsx`: one table of home addresses, `#/new` accepted as the alias people guess, and anything unmatched reported as "That address does not exist" instead of showing the Portfolio in silence |
| An empty project explains itself | `pages/Overview.tsx`: when a market in scope has no approved library version **and** the project holds no requirements, the set-up card says it cannot get any yet, names the market, explains the four-eyes rule and links to the library |
| The blocker is stated at its source | `pages/Library.tsx`: when nothing is approved anywhere, the page says no project can receive a requirement, that approval needs a second editor, and that an invited account still holding a temporary password does not count. `pages/Admin.tsx`: active accounts that never signed in are listed for an administrator |
| An administrator sees the whole installation | `GET /admin/projects` carries client, status, phase, facility, country, team size and the role the reader holds (or `null`). The Portfolio gains **"Other projects on this installation"** — the projects outside the reader's own portfolio, governed by the same Active / Archived switch, with the audited way to give themselves a role. Listing is not access: opening a project without a membership is still refused (decision §6.4.10) |
| Trial storage is not durable | Written into `render.yaml`: no persistent disk, so `STORAGE_DIR` uploads and `BACKUP_DIR` sets are lost on every deploy, restart and wake-from-spin-down; the Neon database survives. P4 scheduled after Phase 5 step 3 (decision §6.4.11) |
| The client's installation | Temporary passwords reset for `skmoeen1436@gmail.com` and `tiengineers01@gmail.com`, so a second library editor can sign in at all, and the unverified starter drafts prepared (SA 17, EU 7, IN 9, US 3) with the Admin account as their author — which leaves them approvable by the other editor |

Tests: **API 610 checks** (was 598: 11 for administrator project visibility, which also proves that listing a project
is not access to it), new browser suite **`e2e18.mjs` with 41 checks** (the client's exact configuration walked to a
created project, reload-resume, named validation, unknown address, the empty-project and library messages, the
administrator view, and a cancelled draft that is not offered again). Catalogue: **OQ-UI-18** and **URS-38**
("First contact cannot fail silently"). Full OQ: **1238 of 1238 checks passed in 52 test cases** (610 API + 628
browser). Every pharma suite passes **unedited**; two of them needed a product change rather than a test change —
the sidebar label collision, and the administrator list that first showed projects twice on one page.

**Not done in this step, carried forward:**

- **The two-person library approval itself.** Preparing the drafts is one thing; approving them through both accounts
  would hollow out the four-eyes control and put a false statement in the audit trail. The client's QA has to approve
  the India version, with the basis recorded. Until then project `FBG` stays empty by design.
- **The in-product warning that files are not durable** (step 0 deliverable 14). It needs a setting, because the
  application cannot detect by itself that it is running on an ephemeral filesystem. Only `render.yaml` carries the
  warning so far.
- SMTP on the trial instance, and raising `IDLE_TIMEOUT_MIN` there (Part A items 3).

**Next: Phase 5 / step 1 — project classification + the unified wizard (§6.5 step 1).** Before it, push the branch so
CI runs with the dependency fix: `checks` should go green for the first time, and the `oq` and `deploy` jobs will then
run for the first time ever (§7 items 1–3).

---

## 7. Pending from earlier phases (verified 2026-10-29)

Checked against GitHub, the live instance and `UAT_REPORT.md` on 2026-10-29, so Phase 5 does not start on top of
unfinished work. **Items 1 and 2 come before Phase 5 step 1.**

| # | Item | What was found | What to do |
|---|---|---|---|
| 1 | **P7 CI — the first `oq` / `deploy` run failed; cause found and fixed (2026-10-30)** | Seven runs up to 2026-10-26 all stopped in `checks` at `npm audit`, which left `oq` and `deploy` **skipped**. After the dependency fix, run **40835673708** (commit `f46ff46`) is the first where `checks` passed, so both jobs ran for the first time ever — and both failed. Read with `gh run view 40835673708 --log-failed`: `oq` reached **1220 of 1226** checks (API 610/610; `e2e13` 15/16, `e2e14` 2/4) and `deploy` failed 4 checks in the fresh-installation stage and 1 after the restart. **Eight of the nine failing checks had a single cause**: `toolsInfo()` (`server/src/services/backups.ts`) took the pg_dump version from the text after the **last** `)`, which is empty on Debian / Ubuntu builds — they print `pg_dump (PostgreSQL) 18.6 (Debian 18.6-1.pgdg12+2)` — so the major version parsed as **0** and every Linux installation was told its backup tools were older than its database. Windows prints `pg_dump (PostgreSQL) 18.0`, which is why 1238 / 1238 passed locally. The cascade: `e2e14` failed "backup tools shown" and "tools usable for this database", then threw a `TimeoutError` that cost its remaining 12 checks; `e2e13`'s "only IQ-13 may fail" assertion broke on the extra failure; in Docker the backup test restore, the installation check (IQ-17 / IQ-18) and the restart stage all failed. The ninth was an environment mismatch, not a bug: `e2e16` asserted `format text, console only`, but a productive stack sets `LOG_FORMAT=json` and `LOG_DIR=/data/logs` | **Done.** The version is now read as the first number in the tool's output (verified against the Debian, Ubuntu and Windows strings), and `e2e16` accepts either log destination. Windows regression: API suite all passed, `e2e14` 16 / 16. The Linux proof is the next CI run. **Also learnt:** CI counted 1226 checks where local counts 1238, because an aborting suite simply stops — the §6.6 "never fewer checks" gate must compare **per-case** counts, not the total, or a crashed suite reads as a smaller run |
| 2 | ~~**Two high-severity vulnerabilities in the shipped server runtime**~~ — **fixed 2026-10-29** | body-parser → 2.4.0, multer → 2.5.0, fast-uri → 3.1.9 (lock only, no `package.json` change). Server audit: **0 vulnerabilities**. Full OQ re-run green afterwards. Note for next time: `npm audit fix` updates the lock without installing and `npm install` then claims to be up to date — **`npm ci`** is what makes `node_modules` match, and IQ-06 is what catches it | Done. Push so the `checks` job can pass for the first time |
| 3 | **P2 Docker deployment** | Ran for the first time in run 40835673708 and failed at "Build images, test the stack". The images build and the stack starts (HTTPS, CSP, security headers, `create-admin`, forced password change and the real client address all passed); the five failures were all downstream of the pg_dump version bug in item 1 — the test restore reported `tools.ok === false`, which failed the backup check, then IQ-17 / IQ-18 and the installation check, and left no "Overall Pass" for the restart stage to find | Fixed with item 1. Re-verify on the next CI run; no Docker on the development machine, so this stays CI-only |
| 4 | **P4 object storage + virus scan** | Not started — and on the hosted trial this is **already losing data**: `STORAGE_DIR` defaults to the local folder `storage` and `BACKUP_DIR` to `backups` (`server/src/config.ts`), while `render.yaml` attaches no persistent disk. A Render free instance has an ephemeral filesystem, so every uploaded file and every backup written there disappears on redeploy, restart or wake-from-spin-down. The database is on Neon and survives; the files do not | **Decided (§6.4.11): P4 runs right after Phase 5 step 3**, where controlled revisions start being uploaded. Step 0 makes the limitation visible in the product and in writing to the client. If the client wants real drawings on the trial instance before then, P4 moves to the front |
| 4b | **P5 SSO / MFA, httpOnly-cookie sessions** | Not started. Re-ordered to run **after** Phase 5 (decision §6.4.8). Note that the session token lives in `localStorage` today (`qualigrafo/src/api.ts`), which is what the cookie part of P5 replaces | Keep in the backlog |
| 5 | **Phase 4 — real Revit add-in** | The only part of Phase 4 still open. The server side is complete and documented for an add-in developer (BACKEND_NOTES §13); the Revit-side client does not exist. The other Phase 4 item, PDF-anchored drawing comments, **is already built** (`Drawing.tsx` with `pdfjs-dist`) — §2.5 was stale and is now corrected | Merged into Phase 5 step 7, so the add-in lands together with the BIM registers it feeds |
| 6 | **UAT §3.6 — e-mail not configured** | The live instance has no SMTP, so reminders and alerts are recorded as "Not sent" | Configure SMTP on the trial instance and send the test alert |
| 7 | **UAT §4 hand-over checklist was not applied to the trial instance** | `UAT_REPORT.md` §4 lists what to do before handing a client a test installation. Items **2** (create two usable Owner / QA accounts), **3** (configure SMTP) and **6** (verify and approve the starter library per market) were not done — which is exactly why the client's experience failed (see §6.5 step 0) | Run the checklist against the live instance, and make the parts of it that the software can check itself part of the set-up checklist in the product |

