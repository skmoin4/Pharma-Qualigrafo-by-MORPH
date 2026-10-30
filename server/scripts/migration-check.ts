// Proves the project-classification migration (Phase 5 / step 1) against projects in the *old* shape, which is the
// only place the backfill of decision §6.4.4 can be observed: once a project is created by the current code it
// already carries the new columns. Testing gate PRODUCTION_PLAN §6.6 ("Migration").
//
//   npm run migration:check                      (uses qualigrafo_mig; DROPS and recreates it)
//   MIG_DB=other_scratch_db npm run migration:check
//
// What it does: builds the database with every migration *except* the classification one, inserts two projects in
// the old shape (one with the Revit connector on, one without), applies the classification migration, and asserts
// that nothing was lost and that the industry group and service type were filled in.
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const MIGRATION = '20261030090000_project_classification'
const DB = process.env.MIG_DB ?? 'qualigrafo_mig'
const ADMIN_URL = process.env.DATABASE_URL
if (!ADMIN_URL) throw new Error('DATABASE_URL is required: it says which server to create the scratch database on.')
const url = new URL(ADMIN_URL)
const scratch = (() => { const u = new URL(ADMIN_URL); u.pathname = `/${DB}`; return u.toString() })()
const psql = (db: string, sql: string) => {
  const bin = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, 'psql') : 'psql'
  const admin = new URL(ADMIN_URL); admin.pathname = `/${db}`; admin.search = ''
  return execFileSync(bin, ['--no-psqlrc', '-tAq', '-d', admin.toString(), '-c', sql], { encoding: 'utf8' })
}
const deploy = () => execFileSync('npx', ['prisma', 'migrate', 'deploy'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: scratch }, shell: process.platform === 'win32' })

let fail = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }

const dir = path.join(import.meta.dirname, '..', 'prisma', 'migrations', MIGRATION)
const held = path.join(import.meta.dirname, '..', 'prisma', `.${MIGRATION}.held`)
if (!fs.existsSync(dir)) throw new Error(`Migration ${MIGRATION} is not in prisma/migrations.`)

console.log(`Scratch database ${DB} on ${url.host} (dropped and recreated)`)
psql('postgres', `DROP DATABASE IF EXISTS "${DB}"`)
psql('postgres', `CREATE DATABASE "${DB}"`)

// 1. the database as it was before this step
fs.renameSync(dir, held)
try {
  deploy()
} finally {
  fs.renameSync(held, dir)
}

// 2. two projects in the old shape: the columns this step renames, and the Revit setting the service type comes from
psql(DB, `INSERT INTO "Project" (id, code, name, client, site, facility, scope, phase, "plantCountry", "ownerStandards", markets, baseline, "revitMode", "autoRouting", "autoReminders", "autoIssue", status, "createdAt", "updatedAt") VALUES
  ('mig-bim', 'MIG-BIM', 'Legacy Revit Plant', 'Legacy Client', 'Hyderabad', 'Sterile products', 'Expansion', 'Commissioning & qualification', 'IN', 'LC-QMS-001', '["IN"]', 3, true, true, true, true, 'Active', now(), now()),
  ('mig-dsn', 'MIG-DSN', 'Legacy Design Plant', 'Legacy Client', 'Jubail', 'API', 'New plant', 'Design', 'SA', 'LC-QMS-002', '["SA"]', 1, false, true, true, true, 'Active', now(), now())`)

// 3. the migration under test
deploy()

const row = (code: string) => {
  const cols = ['industryGroup', 'facilityType', 'secondaryFacilityType', 'customFacilityType', 'serviceType', 'scope', 'projectStage', 'projectCountry', 'bimRequirement', 'ownerStandards', 'baseline']
  const out = psql(DB, `SELECT ${cols.map((c) => `coalesce("${c}"::text, '')`).join(" || '|' || ")} FROM "Project" WHERE code = '${code}'`).trim()
  return Object.fromEntries(out.split('|').map((v, i) => [cols[i], v])) as Record<string, string>
}

const bim = row('MIG-BIM')
const dsn = row('MIG-DSN')

ok(bim.facilityType === 'Sterile products' && dsn.facilityType === 'API', 'facility -> facilityType kept its value (rename, not drop and add)')
ok(bim.projectStage === 'Commissioning & qualification' && dsn.projectStage === 'Design', 'phase -> projectStage kept its value, including a stage that is not in the new list')
ok(bim.projectCountry === 'IN' && dsn.projectCountry === 'SA', 'plantCountry -> projectCountry kept its value')
ok(bim.industryGroup === 'Pharma' && dsn.industryGroup === 'Pharma', 'every existing project is backfilled as Pharma (decision §6.4.4)')
ok(bim.serviceType === 'Design + BIM', 'a project with the Revit connector on becomes Design + BIM')
ok(dsn.serviceType === 'Design only', 'a project without it becomes Design only')
ok(!bim.secondaryFacilityType && !bim.customFacilityType && !bim.bimRequirement, 'the new optional columns start empty rather than invented')
ok(bim.scope === 'Expansion' && bim.ownerStandards === 'LC-QMS-001' && bim.baseline === '3', 'no other project field was touched')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
