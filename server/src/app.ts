import path from 'node:path'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { config, trustProxy } from './config.ts'
import { prisma } from './db.ts'
import { currentUser, requireAdmin, requireAuth } from './middleware/auth.ts'
import { canCreateProjects } from './services/projects.ts'
import { forbidden } from './lib/http.ts'
import { errorHandler, notFoundRoute, requestId } from './middleware/errors.ts'
import { requestLog } from './middleware/logging.ts'
import { metricsText } from './services/monitoring.ts'
import { auth } from './routes/auth.ts'
import { projects } from './routes/projects.ts'
import { admin } from './routes/admin.ts'
import { connector } from './routes/connector.ts'
import { library } from './routes/library.ts'
import { apiRateLimit } from './lib/security.ts'
import { markets } from './domain/reference.ts'
import { ASSET_HANDOVER, DEFAULT_BIM_REQUIREMENT, INDUSTRY_GROUP_INFO, LOD_LEVELS, PROJECT_SCOPES, PROJECT_STAGES, SERVICE_TYPES, isIndustryGroup, isServiceType } from './domain/industries.ts'
import { disciplinesFor, templateFor, templateSummary } from './domain/templates.ts'
import { today } from './domain/rules.ts'
import { FILE_TYPES, MAX_UPLOAD_BYTES } from './services/storage.ts'
import { APP_VERSION } from './services/iq.ts'

export const app = express()

app.disable('x-powered-by')
// Behind a reverse proxy (Vite dev server, Caddy / nginx) use the forwarded client address; TRUST_PROXY says which
// proxies are trusted (default loopback; uniquelocal for the Docker deployment).
app.set('trust proxy', trustProxy)
app.use(helmet())
app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()), exposedHeaders: ['X-Request-Id'] }))
app.use(express.json({ limit: '1mb' }))
app.use(requestId)
app.use(requestLog)
app.use('/api', apiRateLimit(config.NODE_ENV === 'test' ? 100_000 : 600))

/** Readiness: the API and its database answer (used by the container health check and monitoring). */
app.get('/api/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`
  res.json({ ok: true, db: 'up', version: APP_VERSION, time: new Date().toISOString() })
})
/** Liveness: the process answers, without touching the database. */
app.get('/api/health/live', (_req, res) => res.json({ ok: true }))
/**
 * Figures for an external uptime / monitoring tool (Prometheus text format), protected by METRICS_TOKEN:
 * `Authorization: Bearer <token>` or `?token=`. Without the setting the endpoint does not exist.
 */
app.get('/api/metrics', async (req, res) => {
  if (!config.METRICS_TOKEN) return res.status(404).json({ error: 'Metrics are switched off (METRICS_TOKEN is not set).' })
  const given = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '') || String(req.query.token ?? '')
  if (given !== config.METRICS_TOKEN) return res.status(401).json({ error: 'Invalid metrics token.' })
  res.type('text/plain; version=0.0.4').send(await metricsText())
})
app.get('/api/reference/markets', (_req, res) => res.json({ markets }))
/**
 * Project classification reference data (Phase 5 / step 1): the four industry groups with their facility lists, the
 * service types, stages, scopes and BIM options. The server owns these lists because it validates every project
 * against them, so the client reads them from here instead of keeping a second copy that could drift.
 */
/**
 * The project template for one classification (Phase 5 / step 2): the disciplines the project starts with, the
 * deliverables that would be registered, and the specialised controls the industry expects. The wizard reads it
 * live so that what it promises is exactly what creation will do — both come from `templateFor`.
 */
app.get('/api/reference/template', (req, res) => {
  const q = (k: string) => String(req.query[k] ?? '')
  const industryGroup = q('industryGroup')
  const serviceType = q('serviceType')
  if (!isIndustryGroup(industryGroup) || !isServiceType(serviceType)) {
    res.status(400).json({ error: 'industryGroup and serviceType are required and must be known values.' })
    return
  }
  const facilityType = q('facilityType')
  const chosen = q('disciplines').split(',').map((d) => d.trim()).filter(Boolean)
  const disciplines = chosen.length ? chosen : disciplinesFor(industryGroup, facilityType)
  const t = templateFor(industryGroup, facilityType, serviceType, disciplines)
  res.json({ label: t.label, disciplines: t.disciplines, addOns: t.addOns, summary: templateSummary(t), deliverables: t.deliverables })
})
app.get('/api/reference/industries', (_req, res) => res.json({
  groups: INDUSTRY_GROUP_INFO, serviceTypes: SERVICE_TYPES, stages: PROJECT_STAGES, scopes: PROJECT_SCOPES,
  lodLevels: LOD_LEVELS, assetHandover: ASSET_HANDOVER, defaultBim: DEFAULT_BIM_REQUIREMENT,
}))
/** Values the UI must share with the server: the working date for due/overdue logic and the upload policy. */
app.get('/api/reference/config', (_req, res) => res.json({ today: today(), idleMinutes: config.IDLE_TIMEOUT_MIN, upload: { maxBytes: MAX_UPLOAD_BYTES, extensions: Object.keys(FILE_TYPES) } }))

app.use('/api/auth', auth)
app.use('/api/projects', requireAuth, projects)
app.use('/api/admin', requireAuth, requireAdmin, admin)
app.use('/api/connector', connector)
app.use('/api/library', requireAuth, library)

/** People who can be put on a project team; for administrators and Owner / QA users. */
app.get('/api/directory/users', requireAuth, async (req, res) => {
  const user = currentUser(req)
  if (!(await canCreateProjects(user))) throw forbidden('Only administrators and Owner / QA users can browse the user directory.')
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, company: true }, orderBy: { name: 'asc' } })
  res.json({ users })
})

/** Combined deploy (no separate Caddy / Vite host): serve the built frontend and fall back to index.html for client-side routes. */
if (config.STATIC_DIR) {
  const staticDir = path.resolve(config.STATIC_DIR)
  app.use(express.static(staticDir))
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')))
}

app.use(notFoundRoute)
app.use(errorHandler)
