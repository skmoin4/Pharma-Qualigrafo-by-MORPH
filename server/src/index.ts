import { app } from './app.ts'
import { config } from './config.ts'
import { prisma } from './db.ts'
import { deliveryConfigured, startMailer } from './services/mail.ts'
import { startScheduler } from './services/reminders.ts'
import { startBackupScheduler } from './services/backups.ts'
import { captureError, startWatchdog } from './services/monitoring.ts'
import { log, logTarget } from './lib/logger.ts'

const server = app.listen(config.PORT, () => {
  const t = logTarget()
  log.info('server.started', { port: config.PORT, version: process.env.npm_package_version, env: config.NODE_ENV, node: process.versions.node, logFormat: t.format, logFile: t.file, timezone: config.APP_TIMEZONE })
  log.info('mail.configured', deliveryConfigured() ? { host: config.SMTP_HOST, port: config.SMTP_PORT } : { configured: false, note: 'SMTP_HOST empty: e-mails are recorded as "Not sent"' })
})
// Background jobs: outbox delivery and the daily reminder run (both safe with several API instances).
startMailer()
startScheduler()
startBackupScheduler()
// Monitoring watchdog: API heartbeat, outage detection, stale-job and disk alerts (P6).
startWatchdog()

// Nothing may end up only in the console: an unexpected error of the process is grouped and alerted like any other.
process.on('unhandledRejection', (reason) => { void captureError({ kind: 'Process', place: 'unhandledRejection', error: reason }) })
process.on('uncaughtException', (error) => { void captureError({ kind: 'Process', place: 'uncaughtException', error }) })

const shutdown = async () => {
  log.info('server.stopping')
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
