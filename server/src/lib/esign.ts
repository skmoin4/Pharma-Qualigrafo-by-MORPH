// Electronic signatures (21 CFR Part 11, EU GMP Annex 11): meaning per sign-off stage and a tamper-evident hash
// binding signer, meaning, time and the exact revision content (file / Revit snapshot checksum) together.
import { createHash } from 'node:crypto'

/** What each signature stage means; shown to the signer before signing and on every record of the signature. */
export const SIGNATURE_MEANING = ['Reviewed — technically acceptable', 'Approved for use'] as const

export interface SignatureFields {
  doc: string
  rev: number
  checksum: string
  userId: string
  email: string
  name: string
  role: string
  meaning: string
  reason: string
  at: Date
}

/** SHA-256 over the canonical signature fields. Any later change to a stored field breaks the match. */
export function signatureHash(s: SignatureFields) {
  return createHash('sha256').update(JSON.stringify([s.doc, s.rev, s.checksum, s.userId, s.email, s.name, s.role, s.meaning, s.reason, s.at.toISOString()])).digest('hex')
}
