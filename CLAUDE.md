# Qualigrafo — working notes for every session

Engineering evidence software (documents, requirements, evidence, sign-off, handover) turned from a demo into
production software — built pharma-first and, since the client's feedback of 2026-10-29, being widened into a
**multi-industry engineering + BIM + document-control platform** (pharma, hospital / healthcare, energy & high-tech,
common buildings). **Read this first, then `PRODUCTION_PLAN.md` §6 (Phase 5 plan) and §5 (progress so far) and
`server/BACKEND_NOTES.md` (API, design, run instructions).**

## Where the work stands (resume here)

- **CI: the first `oq` / `deploy` failures are found and fixed (run 40835673708 → fix pushed 2026-10-30).**
  One bug caused eight of the nine failing checks: `toolsInfo()` in `server/src/services/backups.ts` read the pg_dump
  version as *the text after the last `)`*, which is empty on Debian / Ubuntu builds — they print
  `pg_dump (PostgreSQL) 18.6 (Debian 18.6-1.pgdg12+2)`, so the major version parsed as 0 and every Linux installation
  was told its backup tools were older than the database. Windows prints `pg_dump (PostgreSQL) 18.0`, which is why it
  never showed up locally. That one failure cascaded: `e2e14` lost 2 checks and then aborted (12 more), `e2e13`'s
  "only IQ-13 may fail" assertion broke, and in the Docker job the backup verify, the installation check and the
  restart stage all failed. The ninth check was a genuine environment mismatch: `e2e16` asserted
  `format text, console only`, but a productive stack sets `LOG_FORMAT=json` and `LOG_DIR` — it now accepts either
  destination. **`gh` is installed and authenticated on this machine** (`/c/Program Files/GitHub CLI/gh.exe`, not on
  the Git Bash PATH — call it by full path), so read CI yourself with `gh run view <id> --log-failed` instead of
  asking. Step-level conclusions are also public without auth:
  `curl -s https://api.github.com/repos/skmoin4/Pharma-Qualigrafo-by-MORPH/actions/runs/<id>/jobs`.
  **Note the blind spot this exposed:** a suite that throws stops early, so CI reported 1226 checks against 1238
  locally — the "never fewer checks" gate does not catch a suite that aborts. Compare per-case counts, not the total.

- Branch: **`production-backend`**, kept in sync with `main` (user asked to push everything to `main` on
  2026-10-26; fast-forwarded, both branches now point at the same history). Commit only when the user asks; end
  commit messages with the Co-Authored-By line the session gives.
- Done: Phase 1 (B1–B9) and **Phase 2 complete** (e-signatures + inactivity timeout, old → new audit everywhere, PDF
  reports + transmittals, e-mail outbox + daily reminders, periodic user-access review, validation pack with IQ / OQ /
  traceability). Details per step: `PRODUCTION_PLAN.md` §5, `server/BACKEND_NOTES.md` §8 progress table.
- Phase 3 steps 1–2 done: **CI** (`.github/workflows/ci.yml`: checks, OQ + validation pack, Docker deploy test) and
  **Docker deployment** (`deploy/`: compose, Caddy HTTPS, install guide). Neither has run on GitHub yet (branch not
  pushed; no Docker on this machine) — check the first run and fix Linux / Docker issues there.
- Phase 3 / step 3 done: **backups** with automatic test restore (`server/src/services/backups.ts`, Backups page,
  `npm run backup:restore`). Needs PostgreSQL 18 client tools (`PG_BIN_DIR`; on Windows found automatically).
- Phase 3 / step 4 done: **portfolio at scale** — `GET /projects` returns summaries (`server/src/services/portfolio.ts`,
  `domain/work.ts`); the client loads a project only when it is opened. Load test: `npm run fixtures:load -- --projects 100`
  then `npm run perf:portfolio`.
- Phase 3 / step 5 done: **monitoring** (`server/src/services/monitoring.ts`, `src/lib/logger.ts`, Monitoring page) —
  structured request / error log with the request id that the audit entries carry, grouped error tracking with
  acknowledge / resolve, job heartbeats + watchdog (outage, stale job, error burst, low disk) with throttled alert
  e-mails, `GET /api/metrics` (`METRICS_TOKEN`), IQ-19…22. Settings: `LOG_LEVEL`, `LOG_FORMAT`, `LOG_DIR`,
  `LOG_KEEP_DAYS`, `METRICS_TOKEN`. See `BACKEND_NOTES.md` §14.
- **Interface (2026-10-25, customer request):** brand colour is **dark blue** and the UI is **glass**. Everything lives
  in `qualigrafo/src/index.css`: tokens in `:root` (`--brand*`, `--navy`, `--glass*`, `--sh-*`; `--teal*` are aliases
  kept for older rules) and the appended layers "v6 … v9". Do not reintroduce teal/green except for status colours.
  Write `-webkit-backdrop-filter` **before** `backdrop-filter` (esbuild keeps only the last of the pair) and keep
  `build.cssTarget: 'chrome111'` in `vite.config.ts`, otherwise the frost renders flat. Look at the result with
  `node scripts/shots.mjs` (preview server running) -> `qualigrafo/design-out/` (`OUT=design-out-xx` for a comparison
  run; `design-out*/` is git-ignored).
- **Visual polish pass (2026-10-26, layer "v9", appearance only):** the aurora behind the glass was roughly halved,
  card edges became a real hairline (`rgba(18,42,84,0.11)`) instead of white-on-white, surfaces went more opaque
  (0.92 -> 0.82) so 12-13px text stays readable, elevation and the primary-button glow were cut back, `.card.flush > h2`
  got `18px 18px 12px` so a flush card and a padded card line up on their title, badges/tags share a 6px radius and
  filled badges gained a matching hairline. Sign-in: split is `1.12fr 0.88fr` **inside `@media (min-width: 981px)`**,
  form 424px with 40px inputs and a 44px button, and the three `.auth-layer` panes are one cascade on the right
  (each needs `left: auto; bottom: auto`, the base rules set `left`/`bottom`). The v9 layer sits **after** the v7
  `@media (max-width: 980px)` block, so any unguarded `.auth` / `.auth-panel` rule there silently breaks the mobile
  stack — guard desktop-only auth rules with `min-width: 981px`.
- **Premium pass (2026-10-26, layers "v10" + "v11" at the end of `index.css`):** richer brand gradient
  (`--grad-brand`, navy -> blue-violet), warmer neutrals, stronger status colours, heavy stat cards (top accent bar +
  glow) vs quiet tables/cards, tiled sidebar / tab icons, gradient avatars with a status dot, bolder badges, gradient
  primary button with press state. **No orange / second accent colour** (the user tried it and chose blue only; the
  schedule "today" line is brand violet). Sign-in is a card on a soft backdrop; Users & access has a KPI strip. The
  file was de-duplicated once (dead declarations that a later identical-selector rule always overrides were removed,
  84 KB -> 68 KB) — keep new rules in the newest layer instead of re-declaring old ones. Review every page with
  `node scripts/shots-all.mjs` (-> `design-all/`, git-ignored with `design-out*/`; add `design-all*/` to .gitignore
  if missing); compare runs with PIL — pages with timestamps / lazy loading differ between identical runs.
- Auth screens (sign-in, forced password change) share `AuthShell` in `qualigrafo/src/components/Login.tsx`; the lock
  screen (`components/Session.tsx`) uses the same language. Keep the test hooks: labels `Email` / `Password` /
  `Temporary password` / `New password` / `Confirm new password` / `Unlock password`, heading `Sign in`, buttons
  `Sign in` / `Unlock` / `Change password`.
- **Client feedback (2026-10-29) — this is now the main track.** The client tested the product and sent six HTML
  specifications + a LinkedIn carousel: `clientnew/` (their files, unedited). Qualigrafo becomes **multi-industry**:
  four industry groups (Energy & High-Tech / Hospital / Pharma / Common) + facility sub-type + a mandatory
  **service type (Design only / BIM only / Design + BIM)**, from which registers, workflows and deliverables are
  generated. Their own rules: upgrade the existing app (no rebuild), **one wizard only** (new fields inside the
  existing step 2, no separate industry page), **one project table** (industry = templates, not separate apps).
  Plan, gap analysis, decisions, step order and the testing gate: **`PRODUCTION_PLAN.md` §6 (Phase 5)**.
  Phase 5 runs **before** the remaining Phase 3 steps; Phase 4 (Revit add-in) merges into Phase 5 step 7.
- **Phase 5 / steps 0 and 1 are done. Next: Phase 5 / step 2 — the template engine** (`PRODUCTION_PLAN.md` §6.5
  step 2): registers, requirements, workflows and deliverables generated from industry + facility + service +
  discipline + stage + country, plus the per-industry applicability filter on library packs and starter packs for the
  three non-pharma groups (unverified starter content, §6.4.3).
- **Step 1 (2026-10-30) changed the project data model — read this before touching a project field.** `Project.facility`
  → **`facilityType`**, `phase` → **`projectStage`**, `plantCountry` → **`projectCountry`** (renames, one migration
  `project_classification`), plus new `industryGroup`, `secondaryFacilityType`, `customFacilityType`, `serviceType`
  and `bimRequirement` (JSON, only set when the service type includes BIM). The lists live **only** in
  `server/src/domain/industries.ts` and are served by `GET /reference/industries` — do not copy them into the client;
  it reads them with `useIndustries()` (`qualigrafo/src/industries.ts`). One validator, `checkClassification()` in
  `server/src/services/projects.ts`, is used by creation and by the profile edit. Migration backfill (industry group
  Pharma, service type from `revitMode`) is proven on old-shape rows by **`npm run migration:check`** — run it after
  any further migration that touches `Project`. Test hooks kept: the wizard label is **`Facility type (project
  sub-type)`** so `getByLabel('Facility type')` still matches, and the secondary field is deliberately called
  **`Secondary sub-type`** so it does not match that same locator.
- Still open from step 0: the
  client's QA has to approve the India library version (two people, four-eyes — the drafts are prepared and the Admin
  account is their author), the in-product warning that files are not durable on the trial instance needs a setting,
  and the trial instance still has no SMTP.
- **What step 0 found, for context (do not re-investigate).** The client used the **Admin** account. **The wizard works** — steps 1 → 5 all advance, Next was never
  disabled, Back kept India, no console errors, no failed requests — and their project `FBG` ("dfv") was created
  through it on 2026-10-26. **Their three P0 claims are not reproducible.** The audit trail shows the real failure:
  the project was created **empty** (`Requirements: no approved library pack for IN`; 0 reqs, 0 docs, 0 systems) and
  they stopped there. Why it was empty is a chain they could not break: no library version is approved for any market
  (`GET /library` → `versions: []` ×5); `approveVersion()` enforces **four-eyes** (author / last editor cannot
  approve); and only **one** account can act, because `skmoeen1436@gmail.com` and `tiengineers01@gmail.com` both still
  have `mustChangePassword: true` and SHOAIB is not even an editor (`isAdmin: false`, Owner / QA nowhere). One editor →
  four-eyes impossible → no approved library → every project empty. **`UAT_REPORT.md` §3.3 predicted this and its §4
  hand-over checklist (two usable Owner / QA accounts, SMTP, approve the starter library) was not applied before the
  client got the URL — this is a hand-over failure, not a code defect.** Code defects found alongside: a reload loses
  the whole wizard draft (component state only, `plantCountry` defaults to `'SA'`); "New project" is in the Portfolio
  header, not the sidebar, and `#/new` falls back to Portfolio **silently** (only `#/new-project` works); an empty
  project is created with no message; stuck invited accounts are invisible to an admin; an admin does not see projects
  they are not a member of (`BENIN001`). **All of those are fixed** — what step 0 shipped, and what it deliberately
  left for the client's QA, is listed in `PRODUCTION_PLAN.md` §6.7.
  Full evidence: `PRODUCTION_PLAN.md` §6.5 step 0.
- **Live trial instance (client-facing):** `https://qualigrafo.onrender.com` — Render free plan, branch `main`, Neon
  database, API + built frontend in one service (`STATIC_DIR`), `IDLE_TIMEOUT_MIN: 15` (`render.yaml`). Free instances
  spin down when idle, so the first request after a pause is slow. State on 2026-10-29: **3 users** (Admin =
  `smoin4425@gmail.com`; QA Lead = `skmoeen1436@gmail.com` and SHOAIB = `tiengineers01@gmail.com` — both were stuck
  on `mustChangePassword` and were reset on 2026-10-29, so a second library editor can sign in), **2 projects**
  (`FBG` "dfv" — still empty; `BENIN001` "BENIN" — QA Lead's, now listed for Admin under "Other projects on this
  installation"), **unverified starter drafts prepared but nothing approved yet**, no SMTP. The sidebar still reads "Pharma engineering evidence" and has to change
  with Phase 5. Never load fixtures or wipe anything here — it is the client's data.

- **User's own free hosting (2026-10-26, separate from the Docker customer-install path):** database is
  **Neon** (serverless Postgres) — `neon.ts` / `.neon/` / `.env.local` at the repo root (git-ignored; `.env.local`
  holds `DATABASE_URL` pooled + `DATABASE_URL_UNPOOLED` direct). Project `sparkling-silence-49802925`, branch
  `production`. Two real admin accounts exist on it (smoin4425@gmail.com, skmoeen1436@gmail.com — four-eyes rule).
  Added `STATIC_DIR` (`server/src/config.ts` + `app.ts`): when set, Express serves the built frontend
  (`qualigrafo/dist`) and falls back to `index.html` for client routes, so the API + UI can run as **one**
  service (frontend already calls relative `/api`, no CORS needed same-origin) — this is on top of, not instead
  of, the Docker/Caddy two-container deployment in `deploy/`. `render.yaml` at the repo root is a Render Blueprint
  for this combined single-service deploy (free tier); needs the branch pushed to GitHub and the Neon secrets
  filled in on Render's dashboard before first deploy.
- New requirement or test? Add it to `server/src/validation/catalogue.ts` (URS + risk + OQ case); API blocks start with
  `section('OQ-API-nn')`, a new browser suite gets an OQ-UI case. The API suite fails if the catalogue is inconsistent,
  and `OQ_CASES` is what the OQ runner iterates — a suite that is not registered there simply never runs.
- **A suite that throws stops early, and the OQ total then only looks smaller.** CI once reported 1226 checks against
  1238 locally because `e2e14` aborted after 4 of 16. Compare the **per-case** counts in `oq-results.json`, not the
  total. Also: never rebuild `qualigrafo/dist` while a suite or the OQ is running — the preview server serves that
  folder and the asset names change.
  After Phase 2: Phase 3 (platform: P1–P7) and Phase 5 (multi-industry; absorbs Phase 4's Revit add-in) — see
  `PRODUCTION_PLAN.md` §2–3 and §6.
- Every step is delivered the same way: backend + UI + API tests + a browser suite + screenshots checked + both docs
  updated (`PRODUCTION_PLAN.md` §6.7 entry with "Next:" for Phase 5 steps, §5 for older phases; `BACKEND_NOTES.md`
  progress row + API table) + offer a commit. Phase 5 also has a fixed testing gate — **`PRODUCTION_PLAN.md` §6.6**:
  full OQ stays green (never fewer checks), the client's own test case stays in the suite, migrations are rename-only
  and verified against old-shape fixtures, and every pharma suite must still pass **unedited** after a feature is
  generalised.

- **Readiness rehearsal (2026-10-25):** the whole customer journey was run on an empty database (install →
  `create-admin` → users → project wizard → library approval → requirements → document → upload → two-stage
  e-signature → evidence → RFI / NCR / transmittal → reports → access review → backup → monitoring). Result and the
  gap list: `UAT_REPORT.md`; the scripted walk is `qualigrafo/scripts/uat/stage1..11.mjs`. Installation check on that
  clean install: Pass (17 pass, 2 warning, 0 fail). The five first-day gaps are fixed (set-up checklist, batch
  applicability decision `POST /reqs/applicability`, four-eyes hint in `create-admin` / library / install guide,
  disabled actions instead of toast errors, acknowledge in the transmittal row).

- **My profile** (`qualigrafo/src/pages/Profile.tsx`, `#/profile`): account facts, roles per project, password,
  sign out of all devices, e-mail preference, own activity. Name, company and roles stay administrator-maintained.
- **Test databases:** the development database `qualigrafo` now holds the user's own accounts — never wipe it.
  Run suites against a scratch database instead: `DATABASE_URL=postgresql://postgres:root@localhost:5432/qualigrafo_test?schema=public`
  (create it once, `npx prisma migrate deploy`), then `npm run fixtures:load`, `npm test`, `npm run validation:oq`.

## User rules (important)

- The user writes Hinglish (Hindi + English, Roman script); reply the same way, short and clear.
- **Never remove a feature that existed in the demo**; make simulated features real. Only the walkthrough, the
  "Preview as" role switcher and "Reset prototype data" stay removed. Ask before deleting any UI control or endpoint.
- Never present requirement content as verified regulation (customer-approved library; starter template = unverified).
- Single-tenant (one installation per customer). Admins and Owner / QA create projects.
- Do not kill processes you did not start (the user may run their own dev server on port 4000).
- Browser suites find Chrome via `CHROME_PATH` or the platform default (`qualigrafo/scripts/e2e-lib.mjs`).

## Layout

- `deploy/` — Docker installation: `docker-compose.yml`, `web.Dockerfile`, `caddy/` (Caddyfile + TLS modes),
  `.env.example`, `README.md` (customer install guide), `ci-test.sh` (CI deployment test). `server/Dockerfile`.

- `server/` — Node + Express 5 + TypeScript + Prisma 7 (PostgreSQL). `src/routes/*` (HTTP), `src/services/*`
  (business rules, one transaction per action via `inProject` + per-project advisory lock), `src/domain/*` (types,
  rules, reference data), `src/lib/*` (security, audit text, e-signature hash), `prisma/schema.prisma` + migrations,
  `fixtures/` (test data loader), `scripts/api.test.ts` (API suite).
- `qualigrafo/` — React 19 + Vite + Zustand frontend. `src/store.ts` (all API actions, derived rules), `src/pages/*`,
  `src/components/*`, `scripts/e2e*.mjs` (Playwright browser suites, shared helpers in `scripts/e2e-lib.mjs`).
- Every project action is `act(method, path, zodSchema, fn)` in `server/src/routes/projects.ts` and returns the fresh
  project payload; the store's `post`/`put` apply it. Errors: 400 validation, 401, 403 role, 404, 409, 422 rule.
- Audit text for changes: `changeList()` from `server/src/lib/audit.ts` → `field "old" -> "new"` plus reason.

## Running and testing (Windows, Git Bash)

```bash
# API suite (in-process, needs a fresh DB each run)
cd server && npm run fixtures:load && npm test            # currently 634 checks, all passing

# Browser suites: each suite needs freshly loaded fixtures; use separate ports so nothing clashes
cd qualigrafo && npm run build
PORT=4100 npx tsx src/index.ts                             # from server/, background
API_URL=http://localhost:4100 npx vite preview --port 8082 --strictPort   # from qualigrafo/, background
for s in e2e e2e2 e2e3 e2e4 e2e5 e2e6 e2e7 e2e8 e2e9 e2e10 e2e11 e2e12 e2e13 e2e14 e2e16 e2e17 e2e18 e2e19; do   # e2e15 needs: fixtures:load -- --projects 100 (cd ../server && npm run fixtures:load >/dev/null); BASE=http://localhost:8082/ node scripts/$s.mjs; done
```

- Current browser totals: 197 + 62 + 20 + 23 + 19 + 33 + 26 + 20 + 22 + 19 + 29 + 23 + 16 + 16 + 18 (e2e15, 100 load-test projects) + 23 (e2e16) + 21 (e2e17) + 46 (e2e18) + 38 (e2e19) = 671 checks, all passing. Full OQ: 1305 of 1305 in 54 test cases.
- **Each suite needs its own freshly loaded fixtures, and nothing else may touch the test database while a suite or
  the API suite runs** — a second API server on the same database writes monitoring rows and job heartbeats and makes
  the OQ-API-33 figures fail at random. Stop your debug servers before running `npm test` or `validation:oq`.
- Whole OQ in one command (API + all browser suites, own servers on 4100 / 8082, ~8 min): `cd server && npm run validation:oq -- --by "Name"`,
  then `npm run validation:pack -- --by "Name"` -> `server/validation/out/` (git-ignored).
- E-mail: without `SMTP_HOST` mail is recorded as "Not sent"; the API test runs its own fake SMTP server. Fixtures
  switch the scheduled daily reminder run off (Admin → E-mail & reminders turns it on).
- Fixture accounts: consultant@ / contractor@ / qa@ (admin) / vendor@ `qualigrafo.test`, password `Demo@12345`.
- The sign-in limiter is in memory: after many failed logins (e2e3, e2e9) restart the API before re-running.
- TaskStop may leave the node process alive on Windows: after stopping, check ports 4100 / 8082 and stop only the
  processes whose command line is `src/index.ts` / `vite … preview --port 8082`.
- Inline Python edits via heredoc sometimes break on quotes in Git Bash; write the script to the scratchpad and run it.
- PDFs can be checked visually with PyMuPDF (`import pymupdf`), screenshots go to `qualigrafo/e2e-out/`.
