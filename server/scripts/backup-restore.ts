// Disaster recovery (Phase 3 / P3): restores a backup set into the database of DATABASE_URL and the files into
// STORAGE_DIR, then applies pending migrations (a set from an older release is brought up to this release).
//   npm run backup:restore -- --name qualigrafo-20261022-020000 --confirm-wipe
//   npm run backup:restore -- --dir /mnt/nas/qualigrafo-20261022-020000 --confirm-wipe
// Stop the API first (docker compose stop api), run this with the same settings, then start the API again.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../src/config.ts'
import { prisma } from '../src/db.ts'
import { securityLog } from '../src/lib/security.ts'
import { backupDir, restoreBackup } from '../src/services/backups.ts'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined }
const dir = arg('dir') ?? (arg('name') ? path.join(backupDir(), arg('name')!) : undefined)
if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) {
  console.error('Usage: npm run backup:restore -- --name <set in BACKUP_DIR> | --dir <path to set> --confirm-wipe')
  console.error(`Sets in ${backupDir()}: ${fs.existsSync(backupDir()) ? fs.readdirSync(backupDir()).join(', ') || 'none' : 'none'}`)
  process.exit(1)
}
if (!process.argv.includes('--confirm-wipe')) {
  console.error('This REPLACES the database content and adds the backup\'s files. Re-run with --confirm-wipe.')
  process.exit(1)
}

console.log(`Restoring ${dir} into ${new URL(config.DATABASE_URL).pathname.slice(1)} @ ${new URL(config.DATABASE_URL).host} …`)
const r = await restoreBackup({ dir, databaseUrl: config.DATABASE_URL, storageDir: config.STORAGE_DIR })
console.log(`Backup of ${r.manifest.createdAt} (release ${r.manifest.appVersion}) restored and checked: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')}; ${r.filesCopied} file(s) copied.`)
const m = spawnSync('npx prisma migrate deploy', { stdio: 'inherit', shell: true })
if (m.status !== 0) { console.error('Applying migrations failed — see above.'); process.exit(1) }
await securityLog('backup.restored', { detail: `${r.manifest.name} (created ${r.manifest.createdAt}, release ${r.manifest.appVersion}) restored from ${dir}` })
await prisma.$disconnect()
console.log('Done. Start the API and run the installation check (Users & access → System & validation).')
