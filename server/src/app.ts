import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { config } from './config.ts'
import { prisma } from './db.ts'
import { currentUser, requireAdmin, requireAuth } from './middleware/auth.ts'
import { canCreateProjects } from './services/projects.ts'
import { forbidden } from './lib/http.ts'
import { errorHandler, notFoundRoute, requestId } from './middleware/errors.ts'
import { auth } from './routes/auth.ts'
import { projects } from './routes/projects.ts'
import { admin } from './routes/admin.ts'
import { connector } from './routes/connector.ts'
import { library } from './routes/library.ts'
import { apiRateLimit } from './lib/security.ts'
import { markets } from './domain/reference.ts'
import { today } from './domain/rules.ts'
import { FILE_TYPES, MAX_UPLOAD_BYTES } from './services/storage.ts'

export const app = express()

app.disable('x-powered-by')
// Behind a local reverse proxy (Vite dev server, nginx on the same host) use the forwarded client address.
app.set('trust proxy', 'loopback')
app.use(helmet())
app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()), exposedHeaders: ['X-Request-Id'] }))
app.use(express.json({ limit: '1mb' }))
app.use(requestId)
app.use('/api', apiRateLimit(config.NODE_ENV === 'test' ? 100_000 : 600))
if (config.NODE_ENV !== 'test') app.use(morgan('dev'))

app.get('/api/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`
  res.json({ ok: true, db: 'up', time: new Date().toISOString() })
})
app.get('/api/reference/markets', (_req, res) => res.json({ markets }))
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

app.use(notFoundRoute)
app.use(errorHandler)
