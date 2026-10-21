import { app } from './app.ts'
import { config } from './config.ts'
import { prisma } from './db.ts'

const server = app.listen(config.PORT, () => {
  console.log(`Qualigrafo API listening on http://localhost:${config.PORT}`)
})

const shutdown = async () => {
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
