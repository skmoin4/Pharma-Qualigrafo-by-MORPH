import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.ts'
import { config } from './config.ts'

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) })

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
