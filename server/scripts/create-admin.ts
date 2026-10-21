// Creates the first administrator of a new installation (or another admin later).
//   npm run create-admin -- --email qa.head@company.com --name "Jane Doe" [--company "Company Ltd"]
// Prints a one-time temporary password; the user must choose their own at first sign-in.
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { z } from 'zod'
import { PrismaClient } from '../src/generated/prisma/client.ts'
import { tempPassword } from '../src/lib/security.ts'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

const parsed = z.object({
  email: z.email('Pass a valid --email'),
  name: z.string().trim().min(2, 'Pass --name "Full Name"').max(120),
  company: z.string().trim().max(120).optional(),
}).safeParse({ email: arg('email'), name: arg('name'), company: arg('company') })

if (!parsed.success) {
  console.error(parsed.error.issues.map((i) => i.message).join('\n'))
  console.error('\nUsage: npm run create-admin -- --email you@company.com --name "Full Name" [--company "Company"]')
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

try {
  const email = parsed.data.email.toLowerCase()
  if (await prisma.user.findUnique({ where: { email } })) {
    console.error(`A user with email ${email} already exists. Use Users & access to reset their password.`)
    process.exit(1)
  }
  const temp = tempPassword()
  const u = await prisma.user.create({
    data: { email, name: parsed.data.name, company: parsed.data.company || null, isAdmin: true, mustChangePassword: true, passwordHash: await bcrypt.hash(temp, 10) },
  })
  await prisma.securityEvent.create({ data: { type: 'user.created', email, userId: u.id, actorName: 'create-admin (server console)', detail: 'administrator' } })
  console.log(`\nAdministrator created: ${u.name} <${email}>`)
  console.log(`Temporary password:   ${temp}`)
  console.log('\nSign in and choose a new password. This temporary password is not shown again.')
} finally {
  await prisma.$disconnect()
}
