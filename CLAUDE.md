# Qualigrafo — working notes for every session

Pharma engineering evidence software (documents, requirements, evidence, sign-off, handover) being turned from a demo
into production software for pharma engineering teams. **Read this first, then `PRODUCTION_PLAN.md` §5 (progress) and
`server/BACKEND_NOTES.md` (API, design, run instructions).**

## Where the work stands (resume here)

- Branch: **`production-backend`** (not pushed). `main` holds only the original demo. Commit only when the user asks;
  end commit messages with the Co-Authored-By line the session gives.
- Done: Phase 1 (B1–B9) and Phase 2 steps 1–3 (e-signatures + inactivity timeout, old → new audit everywhere, PDF
  reports + transmittals). Details per step: `PRODUCTION_PLAN.md` §5, `server/BACKEND_NOTES.md` §8 progress table.
- **Next: Phase 2 / step 4 — C5 scheduled reminders + e-mail notifications.** Then step 5 — C6 periodic user-access
  review report; step 6 — C7 validation pack (URS, risk assessment, IQ/OQ evidence from the test suites).
  After Phase 2: Phase 3 (platform: P1–P7) and Phase 4 (real Revit add-in) — see `PRODUCTION_PLAN.md` §2–3.
- Every step is delivered the same way: backend + UI + API tests + a browser suite + screenshots checked + both docs
  updated (`PRODUCTION_PLAN.md` §5 entry with "Next:", `BACKEND_NOTES.md` progress row + API table) + offer a commit.

## User rules (important)

- The user writes Hinglish (Hindi + English, Roman script); reply the same way, short and clear.
- **Never remove a feature that existed in the demo**; make simulated features real. Only the walkthrough, the
  "Preview as" role switcher and "Reset prototype data" stay removed. Ask before deleting any UI control or endpoint.
- Never present requirement content as verified regulation (customer-approved library; starter template = unverified).
- Single-tenant (one installation per customer). Admins and Owner / QA create projects.
- Do not kill processes you did not start (the user may run their own dev server on port 4000).

## Layout

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
cd server && npm run fixtures:load && npm test            # currently 412 checks, all passing

# Browser suites: each suite needs freshly loaded fixtures; use separate ports so nothing clashes
cd qualigrafo && npm run build
PORT=4100 npx tsx src/index.ts                             # from server/, background
API_URL=http://localhost:4100 npx vite preview --port 8082 --strictPort   # from qualigrafo/, background
for s in e2e e2e2 e2e3 e2e4 e2e5 e2e6 e2e7 e2e8 e2e9 e2e10; do (cd ../server && npm run fixtures:load >/dev/null); BASE=http://localhost:8082/ node scripts/$s.mjs; done
```

- Current browser totals: 197 + 54 + 20 + 20 + 19 + 33 + 26 + 20 + 22 + 16 = 427 checks, all passing.
- Fixture accounts: consultant@ / contractor@ / qa@ (admin) / vendor@ `qualigrafo.test`, password `Demo@12345`.
- The sign-in limiter is in memory: after many failed logins (e2e3, e2e9) restart the API before re-running.
- TaskStop may leave the node process alive on Windows: after stopping, check ports 4100 / 8082 and stop only the
  processes whose command line is `src/index.ts` / `vite … preview --port 8082`.
- Inline Python edits via heredoc sometimes break on quotes in Git Bash; write the script to the scratchpad and run it.
- PDFs can be checked visually with PyMuPDF (`import pymupdf`), screenshots go to `qualigrafo/e2e-out/`.
