// Content-addressed file storage on local disk: STORAGE_DIR/objects/<aa>/<sha256>.
// Uploads land in STORAGE_DIR/tmp first, are hashed on the server, then moved into place.
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, mkdirSync } from 'node:fs'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'
import { config } from '../config.ts'
import { prisma } from '../db.ts'
import { HttpError } from '../lib/http.ts'

const ROOT = path.resolve(config.STORAGE_DIR)
const TMP = path.join(ROOT, 'tmp')
const OBJECTS = path.join(ROOT, 'objects')
mkdirSync(TMP, { recursive: true })
mkdirSync(OBJECTS, { recursive: true })

/** Allowed engineering / document formats. The stored MIME type comes from this table, never from the client. */
export const FILE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.dwg': 'image/vnd.dwg',
  '.dxf': 'image/vnd.dxf',
  '.ifc': 'application/x-step',
  '.rvt': 'application/octet-stream',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.zip': 'application/zip',
}
export const MAX_UPLOAD_BYTES = config.MAX_UPLOAD_MB * 1024 * 1024

/** Busboy decodes header filenames as latin1; recover UTF-8 names and strip anything path-like. */
export function cleanName(raw: string) {
  const utf8 = Buffer.from(raw, 'latin1').toString('utf8')
  const name = utf8.includes('�') ? raw : utf8
  return path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'file'
}

export const upload = multer({
  storage: multer.diskStorage({ destination: TMP, filename: (_req, _f, cb) => cb(null, randomUUID()) }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, fieldSize: 4096 },
  fileFilter: (_req, f, cb) => {
    const ext = path.extname(cleanName(f.originalname)).toLowerCase()
    if (FILE_TYPES[ext]) return cb(null, true)
    cb(new HttpError(415, `File type ${ext || '(none)'} is not allowed. Allowed: ${Object.keys(FILE_TYPES).join(', ')}.`))
  },
}).single('file')

export const mimeFor = (name: string) => FILE_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream'

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (b) => h.update(b)).on('error', reject).on('end', () => resolve(h.digest('hex')))
  })
}

export const objectPath = (sha: string) => {
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('invalid sha256')
  return path.join(OBJECTS, sha.slice(0, 2), sha)
}

const exists = (p: string) => access(p).then(() => true, () => false)

/** Moves a hashed temp upload into object storage (no-op if identical bytes are already stored). */
export async function commitObject(tmpFile: string, sha: string) {
  const dest = objectPath(sha)
  if (await exists(dest)) return rm(tmpFile, { force: true })
  await mkdir(path.dirname(dest), { recursive: true })
  await rename(tmpFile, dest)
}

export const discardTemp = (tmpFile: string) => rm(tmpFile, { force: true })

/** Removes stored bytes that no database row references any more (after a rejected upload). */
export async function dropIfUnreferenced(sha: string) {
  if ((await prisma.storedFile.count({ where: { sha256: sha } })) === 0) await rm(objectPath(sha), { force: true })
}

export async function assertObject(sha: string) {
  const p = objectPath(sha)
  if (!(await exists(p))) throw new HttpError(410, 'The stored file is missing from storage. Contact an administrator.')
  return p
}
