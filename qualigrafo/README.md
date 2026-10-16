# Qualigrafo — pharma engineering evidence platform (frontend prototype)

React + TypeScript (Vite). `npm install`, `npm run dev`, `npm run build`.

## What this is
A project-based prototype: Projects -> project workspace (setup/baseline, requirements per market,
evidence map, documents, reviews, comments, RFIs, inspections, findings, change impact,
handover gates, audit packages, regulatory change review).

## What is NOT real
- No backend, auth, file storage or Revit connection. State is zustand + localStorage (`qualigrafo-v2`).
- Role switch is a preview, not authentication. Sign-offs are not valid electronic signatures.
- Requirement topics are illustrative and not clause-verified. Regulatory updates are fictional.
- Revit navigation is a simulated request/response.

## Hand-off to backend (Node + NestJS + PostgreSQL)
All business rules live in `src/store.ts` (one function per action; derived state in
`evidenceState`, `coverage`, `handoverGates`). Each action maps to a service method / REST endpoint;
screens call the store only. Seed data: `src/data/seed.ts`.

Backend work required: authentication + scoped permissions, immutable revisions + file objects
(checksums), review/sign-off with verified identity, append-only audit, baseline versioning,
Revit add-in + navigation queue, regulatory source pipeline with expert-reviewed rule packs.

## Tests
- `npm run test:rules` - business rules in `src/store.ts` (routing, sign-off intent, stale evidence, source import, NCR and risk rules, ...).
- `npm run test:e2e` - drives the real UI in Chrome against a running preview server (`npx vite preview --port 8081`):
  every page for all 3 projects at desktop and mobile width (no console errors, no horizontal overflow), plus
  approval, source-import, RFI, inspection, finding, change, gap-action, regulatory-update, setup and reset flows.
  Needs Chrome at the path set in `scripts/e2e*.mjs`.

## Modules (all prototype, browser-local)
Portfolio / My work / Regulatory watch; per project: Overview (incl. ball-in-court), Setup & baseline, Schedule, Team,
Requirements, Evidence map, Inspector view, Audit rehearsal, Regulatory changes, Corrective actions, Document register,
Sources (Revit / file), Vendor portal view, Reviews & approvals, Updates & automation, Technical comments,
Templates & vendors, RFIs, Inspections, Non-conformances (NCR), Consistency findings, Risk register, Change impact,
Handover readiness, Audit packages, Audit trail. Ctrl+K searches everything.

Backend API areas implied by the store: NCR (raise / respond / verify-close / reopen), risk (raise / status),
vendor-scoped queries (server-enforced), audit-rehearsal (read model over requirements + evidence state).
