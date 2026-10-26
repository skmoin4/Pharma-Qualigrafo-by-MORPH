// Portfolio load measurement (Phase 3 / P1). Run on a test database with many projects:
//   npm run fixtures:load -- --projects 100 && npm run perf:portfolio
// Signs in as the Consultant (member of every project) and times the portfolio and an opened project in-process.
import type { AddressInfo } from 'node:net'
import { app } from '../src/app.ts'
import { prisma } from '../src/db.ts'

const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
const PASSWORD = process.env.SEED_PASSWORD ?? 'Demo@12345'
const login = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'consultant@qualigrafo.test', password: PASSWORD }) })).json()) as { token: string }
const auth = { authorization: `Bearer ${login.token}` }

async function measure(label: string, path: string, runs = 5) {
  const times: number[] = []
  let bytes = 0
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    const r = await fetch(base + path, { headers: auth })
    const body = await r.text()
    times.push(performance.now() - t)
    bytes = Buffer.byteLength(body)
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${body.slice(0, 200)}`)
  }
  times.sort((a, b) => a - b)
  const row = { label, path, medianMs: Math.round(times[Math.floor(runs / 2)]), minMs: Math.round(times[0]), kB: Math.round(bytes / 1024) }
  console.log(`${label.padEnd(34)} median ${String(row.medianMs).padStart(6)} ms   min ${String(row.minMs).padStart(6)} ms   ${String(row.kB).padStart(7)} kB`)
  return row
}

const projects = await prisma.membership.count({ where: { user: { email: 'consultant@qualigrafo.test' } } })
console.log(`Consultant is a member of ${projects} project(s)\n`)
const results = [
  await measure('Portfolio  GET /projects', '/projects'),
  await measure('One project  GET /projects/PRJ-026', '/projects/PRJ-026'),
]
server.close()
await prisma.$disconnect()
if (process.env.PERF_OUT) (await import('node:fs')).writeFileSync(process.env.PERF_OUT, JSON.stringify({ projects, results }, null, 2))
