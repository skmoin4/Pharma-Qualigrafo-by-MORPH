# Qualigrafo — working notes for every session

Pharma engineering evidence software (documents, requirements, evidence, sign-off, handover) being turned from a demo
into production software for pharma engineering teams. **Read this first, then `PRODUCTION_PLAN.md` §5 (progress) and
`server/BACKEND_NOTES.md` (API, design, run instructions).**

## Where the work stands (resume here)

- ⚠️ **Pending test:** Docker deployment + GitHub Actions have never run (no Docker here, branch not pushed). The user
  chose to keep this pending. When the branch is pushed, check the CI jobs `checks`, `oq`, `deploy` first and fix
  Linux / Docker issues before anything else.

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
- **Next: Phase 3 / step 6 — P4 object storage** (S3 / Azure Blob, same content-addressed keys, virus scan on upload).
  Then P5 (SSO / MFA, httpOnly-cookie sessions).

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
  `section('OQ-API-nn')`, a new browser suite gets an OQ-UI case. The API suite fails if the catalogue is inconsistent.
  After Phase 2: Phase 3 (platform: P1–P7) and Phase 4 (real Revit add-in) — see `PRODUCTION_PLAN.md` §2–3.
- Every step is delivered the same way: backend + UI + API tests + a browser suite + screenshots checked + both docs
  updated (`PRODUCTION_PLAN.md` §5 entry with "Next:", `BACKEND_NOTES.md` progress row + API table) + offer a commit.

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
cd server && npm run fixtures:load && npm test            # currently 598 checks, all passing

# Browser suites: each suite needs freshly loaded fixtures; use separate ports so nothing clashes
cd qualigrafo && npm run build
PORT=4100 npx tsx src/index.ts                             # from server/, background
API_URL=http://localhost:4100 npx vite preview --port 8082 --strictPort   # from qualigrafo/, background
for s in e2e e2e2 e2e3 e2e4 e2e5 e2e6 e2e7 e2e8 e2e9 e2e10 e2e11 e2e12 e2e13 e2e14 e2e16 e2e17; do   # e2e15 needs: fixtures:load -- --projects 100 (cd ../server && npm run fixtures:load >/dev/null); BASE=http://localhost:8082/ node scripts/$s.mjs; done
```

- Current browser totals: 197 + 62 + 20 + 23 + 19 + 33 + 26 + 20 + 22 + 19 + 29 + 23 + 16 + 16 + 18 (e2e15, 100 load-test projects) + 23 (e2e16) + 21 (e2e17) = 587 checks, all passing.
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
