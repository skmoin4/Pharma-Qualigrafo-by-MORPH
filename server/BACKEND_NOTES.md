# Qualigrafo Backend — Working Notes

Living document. Updated at every step so anyone (or any future session) can pick up where we left off.

---

## 1. Goal

Build a real backend for the Qualigrafo frontend (`qualigrafo/`), which today keeps all data in the browser
(`localStorage`) and enforces every rule inside `qualigrafo/src/store.ts`.

The backend must:

- enforce **exactly the same workflow rules** as `store.ts` (same checks, same error messages where possible),
- return data in **exactly the `ProjectData` shape** the frontend store already uses, so wiring the frontend is mostly
  swapping store actions for API calls,
- add what the prototype itself says production needs: real login, per-project roles, a server-side append-only
  audit trail with user identity + request IDs, and per-user notification read state.

## 2. Tech stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 24 + TypeScript | Same language as the frontend; types are shared |
| HTTP | Express 5 | Async errors handled natively |
| Database | PostgreSQL 18 (local install, port 5432) | Strongly relational data, transactions, advisory locks |
| ORM | Prisma 7.10.1 (`@prisma/adapter-pg`) | Type-safe queries + migrations. Prisma 8 is still RC, so pinned to 7 |
| Validation | Zod 4 | Every request body is validated before it reaches a rule |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` | Stateless bearer tokens |
| Security | `helmet`, `cors` (allow-list), 1 MB JSON limit | Basics |
| Dev | `tsx watch` | Runs TS directly, no build step |

## 3. Folder layout

```
server/
  prisma/
    schema.prisma      DB schema (all tables)
    migrations/        SQL migrations
  fixtures/
    load.ts            Test fixtures loader (wipes DB; guarded)
    data.ts            Fictional sample projects used only by the automated tests
  prisma.config.ts     Prisma 7 config (schema path, migrations, DATABASE_URL)
  src/
    index.ts           Starts the HTTP server
    app.ts             Express app: middleware + routes
    config.ts          Env validation (fails fast on bad config)
    db.ts              Prisma client
    domain/
      types.ts         Shared types (copy of frontend types + ProjectData)
      enums.ts         Allowed values for roles, statuses, markets... (Zod)
      rules.ts         Derived logic: evidenceState, coverage, handoverGates, stats
      reference.ts     Markets + disciplines (product reference data)
      starterLibrary.ts  Unverified starter template (topic level, no clauses)
    middleware/
      auth.ts          JWT verification, loads user on every request
      errors.ts        Request ID, 404, central error handler
    services/
      ctx.ts           Transaction + per-project lock + audit/notify helpers
      loadProject.ts   DB -> ProjectData (frontend shape)
      documents.ts     submit, sign, return, new revision, source import, vendor package
      docRegister.ts   Document register: create, edit details (old -> new audit), void / supersede, reinstate, MDR import
      edits.ts         Edit RFIs, risks, NCRs, corrective actions (reason + old -> new audit); raise findings manually
      reports.ts       PDF reports (PDFKit): handover dossier, audit evidence package, transmittal
      transmittals.ts  Document transmittals: issue (frozen items), acknowledge receipt
      requirements.ts  profile/baseline, applicability, source ref, evidence, actions, reg. updates, snapshots
      site.ts          RFIs, inspections, findings, change impact, anchored comments
      quality.ts       risks, NCRs
      workflow.ts      Automation rules, reminders, mark-all-read
      registers.ts     Companies, systems / equipment, disciplines + lookups used by other services
      projects.ts      Create project, edit details, archive / restore, canCreateProjects
      team.ts          Project team (memberships) + shared Owner / QA and scope guards
      revit.ts         Revit integration (user side): mode, tokens, element links, navigation requests
      library.ts       Requirement library: packs, versions, items, CSV import, four-eyes approval, fan-out
      libraryProjects.ts  Library -> project: instantiate a market, diff a version, apply a library update
    routes/
      auth.ts          /api/auth/*
      projects.ts      /api/projects/* (reads + every workflow action)
      connector.ts     /api/connector/v1/* (Revit add-in, connector-token auth)
      library.ts       /api/library/* (requirement library)
    generated/prisma/  Generated Prisma client (git-ignored)
  scripts/
    api.test.ts        End-to-end API test (ported from qualigrafo/scripts/workflow.test.ts)
    create-admin.ts    Creates an administrator on a new installation
```

## 4. Key design decisions

1. **Role is per project, from the database.** `Membership(userId, projectId, role)`. The frontend's
   "Preview as" switcher is a prototype feature; on the server the role always comes from the logged-in user's membership.
   The client can never claim a role.
2. **Signer identity comes from the account.** The sign-off endpoint ignores any client-supplied name and records
   `user.name` + `userId`.
3. **Human codes vs internal IDs.** Every record has an internal `id` (uuid/cuid) and a `code` (`DOC-001`, `REQ-014`,
   `NCR-004`...) unique per project. The API exposes `code` as `id`, matching the frontend.
4. **Every action is one transaction + a per-project advisory lock** (`pg_advisory_xact_lock`). This removes races
   in read-check-write rules (sign stages, code numbering, duplicate checksum checks). Writes to different projects
   still run in parallel.
5. **Audit trail is append-only** (`AuditEvent`, bigint sequence). Each row stores role, userId, userName and the
   request ID. The project payload carries the latest 300 entries (as the prototype did); the full history is at
   `GET /api/projects/:code/audit` (paged JSON or CSV).
6. **Notifications: read state is per user** (`NoticeRead`), not one global flag.
7. **Statuses are strings validated by Zod**, not native DB enums, so the schema could move to MySQL later.
8. **Every action returns the full fresh project** (`{ role, project }`). Derived numbers (coverage, gates, badges)
   stay consistent without the client re-implementing side effects (events, issued packages, audit).
9. **Error contract.** `400` invalid body (Zod), `401` not signed in, `403` role not allowed, `404` unknown record,
   `409` concurrent conflict, `422` workflow rule broken. Body is always `{ "error": "<message>" }`, so the frontend
   can keep showing it in a toast exactly as today.

## 5. Rules tightened compared to the prototype

The prototype relied on the UI hiding buttons. The server enforces those states explicitly:

| Action | Extra server rule |
|---|---|
| Submit document | Only from `Missing`, `Draft`, `Changes requested` |
| Return document | Only when `Under review` |
| New revision | Only Contractor, only from `Accepted` |
| Source import | Checksum required |
| Issue manifest | Lists only the signatures of the revision being issued (prototype listed all revisions) |
| Answer / close RFI | Answer only `Awaiting response`; close only `Answered` |
| Inspection | Submit only `Requested`/`Correction required`; decide only `Submitted` |
| Finding | Disposition only when `Open` |
| Change impact | Reviewer only, only during `Impact review`, item must be linked |
| Decide change | Not twice |
| Link change records | Linked documents / requirements must exist |
| Corrective action | `Open -> Ready for verification -> Closed` only |
| NCR | Respond only when `Open`; reopen not allowed if already `Open` |
| Comment reply | Not on a closed comment; new comments anchor to the doc's current revision |
| Evidence self-acceptance | Blocked by role **and** by user ID |
| Automation rules | Contractor cannot change them |
| Seed PRJ-031 | No pre-issued manifest for DOC-003 (it is `Missing` there) |

Role-related messages that said "Switch to role X" were reworded (there is no role switching with real login).

## 6. API

Base URL `http://localhost:4000/api`. All `/projects` and `/admin` routes need `Authorization: Bearer <token>`.
All project responses also carry `scope` (vendor company or `null`).

**Public**

| Method | Path | Body |
|---|---|---|
| GET | `/health` | |
| GET | `/reference/markets` | |
| GET | `/reference/config` | working date (`today`) + upload policy (types, max size) |
| POST | `/auth/login` | `{ email, password }` -> `{ token, user }` (429 after repeated failures) |
| GET | `/auth/me` | -> `{ user, memberships[] }` (works while a password change is pending) |
| POST | `/auth/password` | `{ current, next }` -> new `{ token, user }`; other sessions revoked |

**Reads**

| Method | Path | Returns |
|---|---|---|
| GET | `/projects` | `{ projects: [{ role, project, stats }] }` for portfolio / my work |
| GET | `/projects/:code` | `{ role, project }` |
| GET | `/projects/:code/audit?limit=&before=&format=json\|csv` | full audit trail |

**Actions** — prefix `/projects/:code`, all return `{ role, project }`

| Area | Method + path | Body |
|---|---|---|
| Setup | PUT `/profile` | `{ facility, scope, phase, ownerStandards, markets[], reason }` |
| | PUT `/settings/revit` | `{ on }` |
| | PUT `/settings/automation` | `{ key: routing\|reminders\|autoIssue, value }` |
| | POST `/reminders/simulate` | |
| | POST `/notices/read-all` | |
| Documents | POST `/docs/:id/submit` | `{ note }` |
| | POST `/docs/:id/sign` | `{ reason, intent }` |
| | POST `/docs/:id/return` | `{ reason }` |
| | POST `/docs/:id/revisions` | |
| | POST `/docs/:id/files` | **multipart**: `file` (+ optional `label`) — upload a source file |
| | POST `/docs/:id/imports` | `{ mode: "Revit", label, checksum }` — Revit snapshot only |
| | GET `/files/:fileId` | download (members of the project only) |
| | POST `/deliverables` | `{ tag, vendor, discipline, due }` |
| Requirements | POST `/reqs/:id/applicability` | `{ applicability, rationale }` |
| | PUT `/reqs/:id/source-ref` | `{ clause, version, effective, attest }` |
| | POST `/reqs/:id/evidence` | `{ doc, note }` |
| | POST `/reqs/:id/evidence/:evidenceId/assess` | `{ accept, reason }` |
| | POST `/actions` | `{ req, title, owner, due, priority }` |
| | POST `/actions/:id/progress` | `{ to }` |
| | POST `/updates/:id/assess` | `{ applicable, reason }` |
| | POST `/snapshots` | |
| Comments | POST `/pins` | `{ text, doc, room, x, y }` |
| | POST `/pins/:id/replies` | `{ text, close }` |
| | POST `/pins/:id/revit-navigation` | `{ requestId }` |
| Site | POST `/rfis` | `{ title, discipline, system, due }` |
| | POST `/rfis/:id/answer` | `{ response }` |
| | POST `/rfis/:id/close` | |
| | POST `/inspections` | `{ title, system }` |
| | POST `/inspections/:id/submit` | `{ evidence }` |
| | POST `/inspections/:id/decide` | `{ accept, reason }` |
| | POST `/findings/:id/dispose` | `{ status, reason }` |
| | POST `/changes` | `{ title, system, docs[], reqs[] }` |
| | POST `/changes/:id/impact` | `{ item, impact }` |
| | POST `/changes/:id/decide` | `{ authorize, reason }` |
| Quality | POST `/risks` | `{ title, detail, system, likelihood, impact, owner, mitigation, due }` |
| | POST `/risks/:id/status` | `{ status, note }` |
| | POST `/ncrs` | `{ title, description, system, severity, doc?, due }` |
| | POST `/ncrs/:id/respond` | `{ rootCause, containment, correctiveAction }` |
| | POST `/ncrs/:id/close` | `{ reason }` |
| | POST `/ncrs/:id/reopen` | `{ reason }` |

**Administration** — prefix `/admin`, administrators only

| Method + path | Body / result |
|---|---|
| GET `/users` | users with memberships, flags, last sign-in |
| GET `/projects` | projects + known companies (for scopes) |
| POST `/users` | `{ email, name, company?, isAdmin? }` -> `{ user, tempPassword }` |
| PATCH `/users/:id` | `{ name?, company?, isAdmin?, active? }` |
| POST `/users/:id/reset-password` | -> `{ user, tempPassword }`; sessions revoked |
| PUT `/users/:id/memberships/:projectCode` | `{ role, scope? }` (scope only for Contractor) |
| DELETE `/users/:id/memberships/:projectCode` | |
| GET `/security-events?limit=` | security log, newest first |

**Requirement library** (`/api/library`, every signed-in user reads; editors = administrators and Owner / QA users)

| Method | Path | Body / notes |
|---|---|---|
| GET | `/library` | `{ packs }`: all 5 markets with version summaries |
| GET | `/library/versions/:id` | version with items (`change`: New / Added / Changed: fields / Unchanged), `removed`, `comparedWith` |
| POST | `/library/starter` | loads the unverified starter as Draft v1 for markets without a pack (422 if none left) |
| POST | `/library/packs/:market/drafts` | new draft copied from the approved version (one draft per pack) |
| PUT | `/library/versions/:id` | `{ note }` (draft only) |
| DELETE | `/library/versions/:id` | discard a draft |
| POST | `/library/versions/:id/items` | item `{ key, title, discipline, topic?, facilities?, critical?, clause?, sourceVersion?, effective?, guidance? }` |
| POST | `/library/versions/:id/import` | `{ rows: item[], mode: 'append' \| 'replace' }`, all-or-nothing, row-numbered errors |
| PUT | `/library/items/:id` | partial item (key cannot change) |
| DELETE | `/library/items/:id` | |
| POST | `/library/versions/:id/approve` | `{ reason }`; four-eyes (403 for creator / last editor); -> `{ market, version, notified }` |

Phase 2 / step 3 (PDF reports, transmittals) — every PDF response carries `X-Content-SHA256` and is logged in the audit trail:

| Method | Path | Notes |
|---|---|---|
| GET | `/projects/:id/reports/handover.pdf` | handover dossier (not for vendor accounts) |
| GET | `/projects/:id/snapshots/:aud/report.pdf` | audit evidence package of a frozen snapshot (not for vendor accounts) |
| POST | `/projects/:id/transmittals` | `{ to, purpose, note, docs[] }` (Consultant / Owner / QA) -> TRN-nnn with frozen items |
| POST | `/projects/:id/transmittals/:trn/acknowledge` | `{ note }` (receiving contractor / vendor of that company) |
| GET | `/projects/:id/transmittals/:trn/report.pdf` | transmittal PDF (vendors: only their own) |

Phase 2 / step 1 (e-signatures, inactivity):

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/refresh` | new token with the same session start; 401 when idle-expired or past `JWT_EXPIRES_IN` |
| POST | `/projects/:id/docs/:doc/sign` | body now `{ reason, intent, password }`; signature gets meaning, e-mail, checksum, sigHash |
| GET | `/projects/:id/docs/:doc/signatures/verify` | `{ signatures: [{ rev, name, role, meaning, at, checksum, status: Valid / Altered / Not an electronic signature … }] }` |
| POST | `/library/versions/:id/approve` | body now `{ reason, password }` |
| GET | `/reference/config` | adds `idleMinutes` |

Env: `IDLE_TIMEOUT_MIN` (default 15) = token lifetime / inactivity limit; `JWT_EXPIRES_IN` (default 12h) = absolute
session length.

Project routes added in step 6 (every edit body also carries `reason`; "Nothing changed." -> 422):

| Method | Path | Body / notes |
|---|---|---|
| PUT | `/projects/:id/rfis/:rfi` | `{ title, discipline, system, due, reason }`; requester or reviewer; question locked once answered |
| PUT | `/projects/:id/risks/:risk` | `{ title, detail, system, likelihood, impact, owner, mitigation, due, reason }` (reviewers) |
| PUT | `/projects/:id/ncrs/:ncr` | `{ title, description, system, severity, doc, due, reason }` (reviewers; Critical downgrade Owner / QA only) |
| PUT | `/projects/:id/actions/:gap` | `{ title, owner, due, priority, reason }` (reviewers) |
| POST | `/projects/:id/findings` | `{ title, doc, severity, source, rule }` (reviewers); findings carry `raisedBy` / `raisedAt` when manual |

Project routes added in step 5 (document register):

| Method | Path | Body / notes |
|---|---|---|
| POST | `/projects/:id/docs` | `{ title, number, discipline, system, owner, due, critical }` -> Missing R00 (Consultant / Owner / QA) |
| PUT | `/projects/:id/docs/:doc/details` | same fields + `reason`; audit old -> new; title / number / discipline locked while under review |
| POST | `/projects/:id/docs/:doc/void` | `{ reason, supersededBy? }` (Owner / QA); withdraws evidence links, links the replacement |
| POST | `/projects/:id/docs/:doc/reinstate` | `{ reason }` (Owner / QA) |
| POST | `/projects/:id/docs/import/preview` | `{ rows, source }` -> `{ preview: { created, updated, unchanged, errors } }`, changes nothing |
| POST | `/projects/:id/docs/import` | `{ rows, source }`, all-or-nothing (422 lists the first row errors) |
| POST | `/projects/:id/reqs/:req/evidence/:evidenceId/withdraw` | `{ reason }` |

Rows: `{ number, title?, discipline?, system?, company?, due?, critical? }`, matched on `number`. Documents carry
`number` and, when Void / Superseded, `voided: { reason, at, by, supersededBy? }`; evidence decisions add `Withdrawn`
(ignored by the evidence state). Document statuses add `Void` and `Superseded`.

Project routes added in step 4: `POST /projects/:id/reqs` (project-specific requirement), `PUT /projects/:id/reqs/:req/details`
`{ system, owner, due }`. Requirements carry `libraryKey` / `libraryVersion`; regulatory updates carry `kind`
(`Regulatory` | `Library`); applying a `Library` update applies the library version to the project.

Note: evidence links now carry an `id`; the frontend's `assessEvidence(reqId, idx, ...)` must send `evidence[idx].id`.

## 7. Running it

**New customer installation (production)**

```bash
cd server
cp .env.example .env          # DATABASE_URL, JWT_SECRET (48+ random chars), APP_TIMEZONE, CORS_ORIGIN
npm install
npm run db:deploy             # apply migrations (no data is created)
npm run create-admin -- --email head.qa@customer.com --name "Full Name" --company "Customer Ltd"
npm run start                 # http://localhost:4000
```

`create-admin` prints a one-time temporary password; the administrator must choose their own at first sign-in.
Everything else (users, projects) is created in the application.

**Development and automated tests**

```bash
npm run db:migrate            # create / update tables
npm run fixtures:load         # WIPES the database, loads 3 fictional test projects + test users
npm run dev                   # http://localhost:4000 (watch mode)
npm test                      # API suite; run right after fixtures:load
```

`fixtures:load` refuses to run with `NODE_ENV=production`, without `--confirm-wipe` (the npm script passes it), or when
the database holds any account outside `@qualigrafo.test` (protects a real database). Test accounts (password
`Demo@12345`, override with `SEED_PASSWORD`):

| Role | Email |
|---|---|
| Consultant | consultant@qualigrafo.test |
| Contractor | contractor@qualigrafo.test |
| Owner / QA (administrator) | qa@qualigrafo.test |
| Contractor limited to AirCo (vendor) | vendor@qualigrafo.test |

**Dates:** "today" (due / overdue) is the real date in `APP_TIMEZONE` (default UTC, e.g. `Asia/Riyadh`). `CLOCK_DATE=YYYY-MM-DD`
pins it for automated tests only.

## 8. Progress log

| Step | What | Status |
|---|---|---|
| 1 | Frontend analysed (types, store rules, seed, pages, tests) | Done |
| 2 | Stack chosen, `server/` scaffolded, dependencies installed | Done |
| 3 | Prisma schema (26 tables) | Done |
| 4 | Domain rules + DB -> ProjectData loader | Done |
| 5 | All 38 workflow action endpoints ported with role + state rules | Done |
| 6 | Auth (login, JWT, `/me`), error contract, request IDs | Done |
| 7 | Seed (3 projects, same as prototype) + 3 demo users | Done |
| 8 | Typecheck clean | Done |
| 9 | Connect to local Postgres, migration `init` applied, seed loaded | Done (2026-10-19) |
| 10 | End-to-end API test: 85 checks, all passing; live server verified (login + project fetch) | Done (2026-10-19) |
| 11 | Frontend wired to the API (see section 9). Browser E2E: 187 + 48 checks, all passing | Done (2026-10-19) |
| 12 | Real file upload + storage, server-side SHA-256, download; submit requires a source (section 10). API 100 checks, browser 191 + 49, all passing | Done (2026-10-19) |
| 13 | Security hardening: sign-in lockout, security log, token revocation, password policy + change, forced change after reset, vendor isolation, user administration (section 11). API 138 checks, browser 191 + 49 + 20, all passing | Done (2026-10-19) |
| 14 | Full-application audit (section 12): 9 issues fixed. API 141 checks, browser 191 + 49 + 20, all passing; mobile layout checked | Done (2026-10-20) |
| 15 | **Production Phase 1 / step 1** — demo removed, production install path, real date (see PRODUCTION_PLAN.md). API 145 checks, browser 190 + 48 + 20, all passing | Done (2026-10-20) |
| 16 | **Production Phase 1 / step 2** — company, system / equipment and discipline registers + enforcement (PRODUCTION_PLAN.md §5). API 176 checks, browser 196 + 54 + 20, all passing | Done (2026-10-20) |
| 17 | **Production Phase 1 / step 3** — create-project wizard, project team management, details edit, archive / restore (PRODUCTION_PLAN.md §5). API 211 checks, browser 196 + 54 + 20 + 20, all passing | Done (2026-10-20) |
| 18 | **Step 3b** — drawing-anchored comments on real drawings, Revit connector backend + add-in API, JSON export restored (§13). API 250 checks, browser 196 + 54 + 20 + 20 + 19, all passing | Done (2026-10-20) |
| 19 | **Production Phase 1 / step 4** — requirement library (versioned packs, CSV import, four-eyes approval, library updates to projects), project-specific requirements, requirement details (PRODUCTION_PLAN.md §5). API 293 checks, browser 196 + 54 + 20 + 20 + 19 + 33 | Done (2026-10-21) |
| 20 | **Production Phase 1 / step 5** — document register: create, edit with old -> new audit, void / supersede / reinstate with evidence hand-over, evidence withdrawal, MDR import from .xlsx / CSV with preview (PRODUCTION_PLAN.md §5). API 331 checks, browser 196 + 54 + 20 + 20 + 19 + 33 + 26 | Done (2026-10-21) |
| 21 | **Production Phase 1 / step 6** — edit RFIs, risks, NCRs, corrective actions with reason + old -> new audit; manual findings. Phase 1 complete (PRODUCTION_PLAN.md §5). API 357 checks, browser 196 + 54 + 20 + 20 + 19 + 33 + 26 + 20 | Done (2026-10-21) |
| 22 | **Phase 2 / step 1** — electronic signatures (password at each signing, meaning, checksum binding, signature hash + verification) and inactivity timeout (short tokens, refresh, lock screen). API 379 checks, browser 197 + 54 + 20 + 20 + 19 + 33 + 26 + 20 + 22 | Done (2026-10-21) |
| 23 | **Phase 2 / step 2** — old -> new values and decision reasons in every audit / security-log entry (shared `lib/audit.ts`). API 390 checks, browser suites unchanged | Done (2026-10-21) |
| 24 | **Phase 2 / step 3** — server-generated PDF reports (handover dossier, audit package, transmittal) with SHA-256 logging; document transmittals with frozen items and receipt acknowledgement. API 412 checks, browser 197 + 54 + 20 + 20 + 19 + 33 + 26 + 20 + 22 + 16 | Done (2026-10-21) |

## 9. Frontend integration (step 11)

What changed in `qualigrafo/`:

| File | Change |
|---|---|
| `src/api.ts` (new) | `fetch` wrapper: base `/api`, bearer token in `localStorage` (`qualigrafo-token`), server error -> message, 401 -> sign out |
| `src/store.ts` | No longer holds business rules or `localStorage` data. Every action calls the API and resolves to `string \| null` (error or success), as before but async. The response's `project` replaces the open project's state. All projects are loaded once after login (`GET /projects`) for Portfolio / My work. Derived helpers (`evidenceState`, `coverage`, `handoverGates`) unchanged |
| `src/components/Login.tsx` (new) | Sign-in screen + one-click demo accounts |
| `src/App.tsx` | Login gate, session restore on reload, "Sign out" (replaces "Reset prototype data"), project list from the server, refresh of the open project on window focus |
| Header role select | Now "Demo account": switches by signing in as the demo user of that role (the walkthrough uses it). Hidden when `VITE_DEMO_ACCOUNTS=false` — then the header shows the real role |
| Sign-off drawer | Signer name is read-only (the logged-in user) |
| Pages | Handlers `await` the actions; one shared `useAct` per page accepts a promise |
| `vite.config.ts` | Dev and preview servers proxy `/api` -> `http://localhost:4000` |
| `scripts/workflow.test.ts` | Removed — those rules now live on the server and are covered by `server/scripts/api.test.ts` |
| `scripts/e2e*.mjs` | Log in first, wait for API responses, ignore Chrome's console lines for expected 4xx rule rejections |

### Run everything locally

```bash
# terminal 1 — API
cd server && npm run dev                 # http://localhost:4000

# terminal 2 — frontend
cd qualigrafo && npm run dev             # http://localhost:5173  (proxies /api)
```

Open http://localhost:5173 and click a demo account.

### Browser E2E (needs Chrome)

```bash
cd server && npm run fixtures:load && npm run dev
cd qualigrafo && npm run build && npx vite preview --port 8081
node scripts/e2e.mjs                     # reseed the DB before the next one
node scripts/e2e2.mjs
```

## 10. File upload & storage (step 12)

**Rules**

| Rule | Detail |
|---|---|
| Who uploads | Only the Contractor (the responsible party). Same for Revit snapshots |
| Submission | A revision can be submitted only when it has its own source: `sourceRev === rev` and a checksum. Error: "Attach the source file for DOC-xxx Rnn before submitting." |
| Where the file goes | Missing / Draft (never submitted): attaches to the **current** revision, replacing an earlier draft file. Under review / Changes requested / Accepted: creates a **new draft revision**; submitted content is never overwritten. Under review also cancels the pending approval route |
| Checksum | SHA-256 computed by the **server** over the received bytes. The client-side hash in the UI is only a preview. The JSON import endpoint no longer accepts client-declared checksums for files |
| Duplicates | Identical bytes cannot be imported twice for the same document (`ImportBatch(documentId, checksum)` unique) |
| Types | `.pdf .dwg .dxf .ifc .rvt .doc .docx .xls .xlsx .csv .txt .png .jpg .jpeg .zip`. Stored MIME type comes from the extension table, never from the client |
| Size | `MAX_UPLOAD_MB` (default 50). Empty files rejected. Over the limit -> 413 |
| Download | `GET /projects/:code/files/:id`, member-only, `Content-Disposition: attachment`, `X-Checksum-SHA256` header, `nosniff`, no caching |
| Isolation | A file id is only reachable through its own project (404 elsewhere) |

**Storage layout** (`STORAGE_DIR`, default `server/storage`, git-ignored)

```
storage/tmp/<uuid>                 upload in progress (deleted afterwards)
storage/objects/<aa>/<sha256>      file bytes, content-addressed (same bytes stored once)
```

Flow: membership check -> multer writes to `tmp` (type + size limits) -> server hashes -> move to `objects`
-> DB transaction (`StoredFile` upsert, document update, `ImportBatch`, history, notification, audit).
If the transaction fails, the object is deleted unless another record already references the same bytes.
`npm run fixtures:load` also clears `storage/objects`.

**Schema additions:** `StoredFile` (project, sha256, size, mimeType, originalName, uploader), `Document.fileId` +
`Document.sourceRev`, `ImportBatch.fileId`. Migration `file_storage`.

**UI**
- Document drawer has a **Source file** section: the current file (name, size, uploader, date, SHA-256 with copy,
  Download), a Revit snapshot card when applicable, "Earlier files", and for the Contractor a drag-and-drop uploader.
  Before uploading, the uploader states what will happen (attach to R00 / new draft R02 / route cancelled), blocks
  identical content, validates type and size, and shows upload progress.
- "Submit Rnn for review" is disabled until the revision has a source, with a hint.
- Sources page uses the same uploader; import history has Download links.
- Document register has a **Source** column (File / Revit / —).
- Vendor portal shows "Attach file for Rnn" for deliverables without a file.

**For production:** move `objects/` to S3 / Azure Blob (same content-addressed keys), add virus scanning before
moving out of `tmp`, and record downloads in an access log.

## 11. Security hardening (step 13)

**Sign-in**
- Lockout: 5 failed attempts for the same (IP, email) or 20 from one IP within 15 minutes -> `429` with the wait time.
  Successful sign-in clears the account counter. Unknown emails take as long as wrong passwords (no account probing).
- Limiter state is in memory: correct for one API process; use Redis when running several instances.
- Whole-API ceiling: 600 requests / minute / IP (`429` + `Retry-After`).
- `trust proxy = loopback`, so the client IP is right behind the Vite proxy or a local nginx.

**Sessions**
- Each JWT carries the user's `tokenVersion`. Changing or resetting a password, or disabling the account, increments it,
  so every existing token stops working immediately (not only at expiry).
- A disabled account cannot sign in; its open sessions get `401`.

**Passwords**
- Policy (server + live checklist in the UI): at least 10 characters, a letter and a number, must not contain the email name,
  must differ from the current one.
- Admin-created users and admin resets get a one-time temporary password (`Abcde-2345-Fghj`) and must set their own at first
  sign-in; until then every API call except `/auth/me` and `/auth/password` returns `403`.

**Vendor isolation** (`Membership.companyScope`, Contractor only)
- The payload contains only the company's documents and what hangs off them: comments, NCRs, imports, issued manifests,
  notifications on those documents, the user's own RFIs and own audit entries. Requirements, risks, changes, inspections,
  findings, actions, snapshots are empty.
- Any other company's record is answered with `404` (existence is not revealed). Files are downloadable only if linked to
  the company's documents. The project audit export is `403`.
- Allowed actions: submit, upload / Revit import, new revision, comments, raise / close own RFIs, respond to NCRs on own
  documents, mark notifications read. Everything else: `403 This action is not available to vendor accounts.`
- UI: navigation shows only Vendor view, Document register, Sources, Updates, Comments, RFIs, NCRs; other pages fall back to
  the vendor view; header badge "Vendor · Company".

**Administration** (`User.isAdmin`; the Owner / QA demo account is admin)
- Users & access page (sidebar, admins only): search, create user (temporary password shown once with copy), edit name /
  company / admin flag, reset password, disable / enable, per-project role + record scope.
- Guards: an admin cannot disable or demote themselves; at least one active admin must remain.
- Security log tab: sign-in success / failure / lockout, password changes and resets, user and membership changes, with
  actor and IP. Membership changes are also written to the affected project's audit trail.

**UI**
- "Change password" in the sidebar opens a dialog; forced-change screen after a temporary password.
- Login screen has a fourth demo button: Vendor (AirCo).
- Sign out clears the session, toasts and returns to the portfolio route.

**Bug found while testing:** the password dialog did not close on Escape. The App's own Escape handler re-rendered App
inside the same key event, which re-registered the dialog's listener mid-dispatch. Fixed by giving the dialog a stable
`onClose` callback; covered by `scripts/e2e3.mjs`.

**Tests:** `server/scripts/api.test.ts` (+38 checks) and `qualigrafo/scripts/e2e3.mjs` (20 browser checks). Restart the API
before re-running e2e3: the lockout it triggers stays in memory for 15 minutes.

## 12. Full-application audit (step 14)

Checked: typecheck + lint (both projects), API suite, all three browser suites, a page-by-page review of which UI controls
call which endpoint, server rule review, mobile layout (390 px) of the screens added in steps 11–13.

| # | Found | Fix |
|---|---|---|
| 1 | Audit trail page showed and exported only the latest 300 entries kept in the project payload | Page now reads `GET /audit` (200 per page, "Load older events"), shows the user column, CSV export downloads the complete server trail |
| 2 | "Today" was hard-coded in the UI; with `DEMO_DATE=off` UI and server would disagree on overdue items | `GET /reference/config` returns `today` + upload policy; the UI uses it after sign-in |
| 3 | Admin could downgrade, remove or disable the last Owner / QA of a project, leaving stage-2 sign-off, change authorisation and baselines impossible | Server guard on membership change, removal and deactivation; +3 API checks |
| 4 | Automation-rule checkboxes were enabled for the Contractor and a rejected change was silently dropped | Disabled for Contractor with a note; errors and success are toasted |
| 5 | Standalone / Revit toggle ignored server errors and was shown to vendor accounts (not allowed) | Errors toasted; toggle hidden for vendor accounts |
| 6 | "Raise NCR" shown to vendor accounts (server: 403) | Hidden for vendor accounts |
| 7 | Walkthrough and Ctrl+K search led vendor accounts to pages they cannot use | Walkthrough hidden; search lists only allowed pages |
| 8 | Sign-in limiter and API rate-limit maps never shrank (slow memory growth on a long-running server) | Expired entries swept every 5 minutes |
| 9 | Users & access page overflowed by 140 px at phone width | Grid column `minmax(0, 1fr)`; tables scroll inside their card |

Verified unchanged and correct: every workflow action goes through the API (no local-only mutations remain; only static
reference data — markets, disciplines — is bundled), exports of comments / snapshots / rehearsal use complete loaded data,
file names and paths are sanitised, uploads are type/size limited, downloads are member-only attachments.

## 13. Revit connector API (for the add-in developer)

**Setup in the app:** Setup → Integrations → switch to *Revit connector* (Consultant / Owner / QA), then Owner / QA
creates a **connector token** (shown once; only its SHA-256 is stored; revocable). The add-in is configured with the API
address `https://<server>/api/connector/v1` and the token. Every call sends `Authorization: Connector <token>`.
A token belongs to one project. Writes are refused (409) while the integration is switched off and (422) when the
project is archived.

| Method + path | Body | Result |
|---|---|---|
| GET `/project` | | `{ code, name, status, revitEnabled, models: [{ guid, name, lastSnapshotAt }] }` |
| POST `/snapshots` | `{ model: { guid, name }, version, elementCount?, changes: [{ elementId, kind, detail }] }` — `kind` one of Added, Modified, Deleted, Parameter changed, Sheet revised; max 10 000 changes | `201 { snapshotId }`; `409` if that version was already published. Audited as "Revit connector: <token name>"; Contractors get a notification. |
| GET `/navigation` | | `{ requests: [{ id, comment, text, modelGuid, elementId, revision, requestedBy, createdAt, expiresAt }] }` — pending requests are handed out once (marked Delivered) |
| POST `/navigation/:id/result` | `{ outcome, detail? }` — outcome one of Focused, Wrong model, Stale version, Element missing, Link unloaded | `{ ok: true }`; `409` if already answered or expired (5 minutes) |

Recommended add-in loop: publish a snapshot after each model publish; poll `GET /navigation` every few seconds while Revit
is open; select and show the element, then post the outcome. Success is shown to users only after the add-in reports it.

**User side (app):** `PUT /projects/:code/settings/revit {on}`, `POST /projects/:code/connector-tokens {name}` →
`{ token, project }`, `DELETE /projects/:code/connector-tokens/:id`, `PUT /pins/:id/element {model, element}`,
`POST /pins/:id/navigate`, `POST /docs/:id/imports {snapshotId}` (Contractor; label `<model> · <version>`, checksum
`revit:<guid>:<version>`).

**Drawing comments:** `POST /pins {text, doc, room, place?: {page, x, y}}` and `PUT /pins/:id/anchor {page, x, y}`
(author or reviewer; moves / remaps onto the current revision). Positions are 1-based page + normalised x / y (0..1).
Only revisions whose current source is a PDF, PNG or JPEG can carry positioned comments.

## 14. Open items / later

- **Electronic signatures:** done in Phase 2 / step 1 (re-authentication, meaning, checksum binding, signature hash,
  verification). Still open for a customer's validation: a written e-signature policy and user certification letters
  (11.100(c)) are procedural, outside the software.
- **Production auth:** move the token to an httpOnly cookie (with CSRF protection) or add short-lived access + refresh
  tokens; add MFA for administrators; shared (Redis) store for the sign-in limiter.
