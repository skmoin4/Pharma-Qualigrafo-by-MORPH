// Validation pack (Phase 2 / C7): URS, risk assessment, IQ (executed now on this environment), OQ results from
// `npm run validation:oq`, traceability matrix, deviations and approval blocks, as one PDF in VALIDATION_DIR.
//   npm run validation:pack -- --by "Name, role"
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../src/config.ts'
import { prisma } from '../src/db.ts'
import { runIq } from '../src/services/iq.ts'
import { validationPackPdf } from '../src/services/reports.ts'
import type { OqResults } from '../src/validation/catalogue.ts'

const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def }
const by = arg('by', os.userInfo().username)
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', config.VALIDATION_DIR)
const file = path.join(dir, 'oq-results.json')
if (!fs.existsSync(file)) throw new Error(`No OQ results at ${file}. Run npm run validation:oq first.`)
const oq = JSON.parse(fs.readFileSync(file, 'utf8')) as OqResults
const iq = await runIq(by)
if (oq.environment['Code fingerprint'] !== iq.fingerprint && !process.argv.includes('--force')) {
  throw new Error('The code changed since the OQ run (fingerprints differ). Run npm run validation:oq again (or pass --force for a draft).')
}
const reportId = `VP-${iq.version}-${new Date().toISOString().slice(0, 10)}`
const pdf = await validationPackPdf({ oq, iq, by, reportId })
const out = path.join(dir, `Qualigrafo_Validation_Pack_${iq.version}_${new Date().toISOString().slice(0, 10)}.pdf`)
fs.writeFileSync(out, pdf.pdf)
await prisma.$disconnect()
console.log(`Validation pack ${reportId}: ${out}\nSHA-256 ${pdf.sha256}\nOQ ${oq.totals.passed}/${oq.totals.checks} · IQ ${iq.overall}`)
