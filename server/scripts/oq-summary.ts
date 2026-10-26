// Markdown summary of the latest OQ run (VALIDATION_DIR/oq-results.json), e.g. for the CI job summary:
//   npx tsx scripts/oq-summary.ts >> "$GITHUB_STEP_SUMMARY"
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OqResults } from '../src/validation/catalogue.ts'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.env.VALIDATION_DIR ?? 'validation/out')
const file = path.join(dir, 'oq-results.json')
if (!fs.existsSync(file)) {
  console.log('### OQ\n\nNo OQ results were produced (the run stopped before writing them). See the job log.')
  process.exit(0)
}
const oq = JSON.parse(fs.readFileSync(file, 'utf8')) as OqResults
const t = oq.totals
const out = [
  `### OQ ${t.failed ? '❌' : '✅'} ${t.passed} / ${t.checks} checks passed in ${t.cases} test cases (${Math.round(oq.durationSec / 60)} min)`,
  '',
  `Version ${oq.environment['Software version']} · fingerprint \`${oq.environment['Code fingerprint'].slice(0, 16)}…\` · ${oq.environment['Operating system']} · Node ${oq.environment['Node.js']} · PostgreSQL ${oq.environment.PostgreSQL} · ${oq.environment.Browser}`,
  '',
  '| Test case | Title | Checks | Result |',
  '|---|---|---|---|',
  ...oq.cases.map((c) => `| ${c.id} | ${c.title} | ${c.passed}/${c.checks.length} | ${c.failed ? '❌ Fail' : c.checks.length ? '✅ Pass' : '⚠️ No checks'} |`),
]
const failed = oq.cases.flatMap((c) => c.checks.filter((k) => !k.pass).map((k) => `- **${c.id}** ${k.text}`))
if (failed.length) out.push('', '#### Failed checks', '', ...failed)
console.log(out.join('\n'))
