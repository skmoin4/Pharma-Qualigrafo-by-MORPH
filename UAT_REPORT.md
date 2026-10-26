# Qualigrafo — readiness rehearsal on a clean installation

**Date:** 2026-10-25 · **Release:** 0.1.0 · **Code fingerprint:** `21c93969efc0937f7f041ace4a95d67cb85ddf3e58518d699b7288dce39c7aa6`

Not the automated suites: this is the **customer journey**, run by hand (scripted browser) on an **empty database**,
the way the first customer will do it. Separate installation: database `qualigrafo_uat`, own storage and backup
folders, API on 4200, web on 8084.

## 1. What was rehearsed, and what happened

| # | Step of a real installation | Result |
|---|---|---|
| 1 | Empty database → `prisma migrate deploy` → `npm run create-admin` | Works. One-time password printed on the console only. |
| 2 | First sign-in with the one-time password | Forced password change before anything else. |
| 3 | Empty portfolio | Clear empty state: "No projects yet — create the first project in five steps". |
| 4 | Administrator creates 4 accounts (consultant, second Owner / QA, contractor, vendor) | Works; each gets a one-time password shown once, then forced to set their own. |
| 5 | Project wizard (basics → scope & markets → registers → team → review) | Works; project `PRJ-001` created with 4 companies, 8 disciplines, 5 people; opens on **Companies & systems**. |
| 6 | Requirement library on a fresh install | Unverified **starter drafts** are prepared per market (SA, IN, EU, US — 17 topics each), each labelled "Unverified starter template" with the warning that every item must be verified. Nothing is approved. |
| 7 | Four-eyes approval | The preparer's Approve button is disabled with the rule explained. The second editor approves with a **written basis + password** (electronic signature). |
| 8 | Library version offered to the project | Appears under *Updates & automation* as "Library update · 17 new"; the Owner / QA applies it **with a rationale** → new baseline **B2**, 17 requirements in the project. |
| 9 | Register two deliverables | Works (Missing R00, responsible company, due date, critical flag). |
| 10 | Contractor uploads the source file | Works; submit is **blocked until a file exists**; server-side SHA-256 shown (`f24a8ec0…`). |
| 11 | Two-stage electronic signature | Consultant signs (password + explicit confirmation; refused without them), auto-routes to Owner / QA, who signs → revision **Accepted**, signatures recorded with meaning and checksum. |
| 12 | Applicability decision + evidence | Reviewer records "Required" with rationale; links the exact accepted revision; an **independent** reviewer accepts it ("Accept as fit") → requirement **Evidence accepted**. |
| 13 | Figures and gates | Overview immediately shows `1/1` accepted, 16 applicability pending, document gate 3 of 10 open. |
| 14 | Site records | RFI raised by the contractor and answered by the consultant; NCR raised with severity, system and due date. |
| 15 | Transmittal | Issued to BuildCo with purpose and remarks; freezes revision, checksum and approvals; the recipient acknowledges receipt from the transmittal. |
| 16 | Reports | Handover dossier PDF, audit evidence package **AUD-001** frozen at B2 (lists all 16 outstanding items) + its PDF, audit trail CSV export. |
| 17 | Vendor account | `sara.noor@airco.example` sees only the AirCo view; the other company's document is not visible. |
| 18 | Administration | Access review started → decision per account → **signed and completed**; backup run with an **automatic test restore (Verified)**; monitoring shows 4 background jobs Running, 0 open errors; e-mail outbox records 19 messages as "Not sent" (no SMTP configured). |
| 19 | Installation check (IQ) | **Overall Pass — 17 pass, 2 warning, 0 fail.** Warnings: `NODE_ENV=development` and SMTP not configured (both expected on a test machine). |

Final state of the rehearsal project: 17 requirements, 2 documents (1 accepted), 3 RFIs, 1 NCR, 1 transmittal,
1 audit package, **31 audit entries**, security log with sign-ins, 4 e-signatures, library approval, access review,
backup and IQ runs. No browser errors in any step.

Screenshots and the generated PDFs / CSV: `qualigrafo/uat-out/`.

## 2. Verdict

**The product is ready for the client to test.** Every step of the real process works on an installation that starts
empty — no fixture data, no shortcuts. The gaps below are usability and documentation items, not defects that block a
pilot; two of them (§3.1, §3.3) will otherwise cost the client time on their first day.

## 3. Gaps found, in the order they should be fixed

> **Status 2026-10-25: §3.1 – §3.5 are fixed** (see `PRODUCTION_PLAN.md` §5, "Readiness rehearsal and the first-day
> fixes"); OQ re-run after the fixes: 1150 of 1150 checks. §3.6 – §3.8 are configuration and roadmap items for the
> customer installation.

### 3.1 A new project cannot raise RFIs or NCRs until a system is registered — and the message comes too late — FIXED
The system / equipment register starts empty. The RFI form shows "No active systems", the **Submit button stays
enabled**, and pressing it answers *"System (none) is not in the system register."*
**Fix (small):** disable Submit with an inline hint, and add systems to the project wizard (or a "finish set-up"
checklist on the overview: systems · applicability decisions · first documents).

### 3.2 Every requirement needs its own applicability decision — no bulk action — FIXED
17 decisions on this tiny project; a real project with several markets will have 50–150. Each needs a reviewer
rationale, which is right for the record, but there is no way to decide several at once.
**Fix (medium):** multi-select in the requirement register + "Mark selected as Required / Not applicable" with one
shared rationale, still written per requirement in the audit trail.

### 3.3 The first installation needs **two** library editors — nothing says so — FIXED
The four-eyes rule means a single administrator can never approve the starter library, so the first project would get
no requirements. We only got through because a second Owner / QA account existed.
**Fix (documentation + one line of UI):** say it in `deploy/README.md` and in the `create-admin` output, and show a
hint on the Library page when only one editor exists.

### 3.4 Actions that need a reason leave the button enabled and report the problem as a toast — FIXED
"Apply to project" (rationale), "Submit RFI" (system), "Issue transmittal" (purpose). Other forms in the product
already disable the action until it is valid — these three should behave the same way.
**Fix (small):** disable + inline field errors.

### 3.5 The transmittal acknowledgement is one click deeper than expected — FIXED
The recipient sees "Awaiting receipt" in the list, but *Acknowledge receipt* only appears after expanding the row.
**Fix (small):** put the action in the receipt column of the list as well.

### 3.6 E-mail is not configured, so nothing is actually delivered
19 notifications were correctly recorded as "Not sent" (nothing is lost), but the client will not see reminders,
signature requests or security alerts until `SMTP_HOST` is set.
**Before the client test:** configure SMTP, or tell them it is intentionally off.

### 3.7 Planned platform work, not started (known roadmap, Phase 3 / 4)
- **P4** object storage (S3 / Azure Blob) + virus scan on upload — files are on the server disk today.
- **P5** SSO (Azure AD / Okta), MFA for administrators, httpOnly-cookie sessions.
- **Phase 4** real Revit add-in (the connector API exists, the add-in does not).

### 3.8 The Docker deployment and the CI pipeline have still never run
`deploy/` (compose + Caddy HTTPS) and `.github/workflows/ci.yml` are written but unverified, because this machine has
no Docker and the branch is not pushed. **Before the client installs on their own server**, run the compose stack once
and fix whatever Linux / Docker differences appear.

## 4. Checklist before handing the client a test installation

1. Fix §3.1 and §3.4 (half a day) — they are what a tester hits first.
2. Create **two** Owner / QA accounts during installation (§3.3) and write it into the install guide.
3. Configure SMTP (§3.6), send the test e-mail from *Users & access → Monitoring → Send test alert*.
4. Set `NODE_ENV=production` and a real `APP_TIMEZONE`; re-run the installation check — it must be **Pass** with no
   warnings other than ones you accept, and keep the IQ PDF.
5. Run one backup with its test restore and copy the set off the server (§18 above proves the mechanism works).
6. Load the customer's own requirement content, or verify and approve the starter template per market (§3.3).
7. Run the Docker stack once (§3.8) if the client installs on their own server.

## 5. How to repeat this rehearsal

```bash
# fresh database + first administrator
psql -U postgres -c "CREATE DATABASE qualigrafo_uat;"
cd server
DATABASE_URL="postgresql://…/qualigrafo_uat?schema=public" npx prisma migrate deploy
DATABASE_URL="…" npm run create-admin -- --email head.qa@customer.com --name "Full Name" --company "Customer"
DATABASE_URL="…" PORT=4200 STORAGE_DIR=uat-storage BACKUP_DIR=uat-backups CORS_ORIGIN=http://localhost:8084 npm run start
# web client against that API
cd ../qualigrafo && npm run build && API_URL=http://localhost:4200 npx vite preview --port 8084 --strictPort
```

The same walk is scripted in `qualigrafo/scripts/uat/stage1.mjs … stage11.mjs` (run in order from `qualigrafo/`,
with the UAT API on 4200 and the web client on 8084; stage 1 takes the admin's one-time password in `ADMIN_TEMP`).
They write their screenshots and notes to `qualigrafo/uat-out/`. Or walk the 19 steps of section 1 by hand. The automated suites (`npm run validation:oq`, 1130 checks) cover
the same rules on fixture data; this rehearsal is what proves the **empty-installation** path.
