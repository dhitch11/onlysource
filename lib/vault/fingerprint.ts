import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Duplicate detection without ever comparing plaintext.
 *
 * The problem this solves: an operator pastes the same DIBBS password into two connection rows,
 * or re-pastes a credential that was already rotated away. Answering "is this the same secret we
 * already hold" requires comparing secrets, and the naive way to do that is to decrypt both,
 * which turns a convenience feature into a second decryption path.
 *
 * Instead: HMAC-SHA256 under a SERVER-HELD PEPPER. Equal secrets produce equal fingerprints, so
 * duplicates are detectable, and the fingerprint is useless to anyone who steals the database
 * without also stealing the pepper.
 *
 * WHY A PEPPER AND NOT A PLAIN HASH. A bare `sha256(secret)` is offline-guessable: government
 * portal passwords live in a small, very guessable space, and an attacker with the table can
 * confirm a guess without ever touching our systems. The pepper removes that oracle. It is held
 * with the root key, not in the database, so a database-only compromise cannot use it.
 *
 * WHY NOT A SLOW KDF HERE. This is not password verification and there is no login to protect.
 * The pepper already defeats offline guessing, and the fingerprint is computed on every save and
 * every duplicate check, so a deliberately slow function would buy nothing and cost throughput.
 * (Contrast the API-key path, where single SHA-256 is correct for the opposite reason: a 256-bit
 * random secret has no dictionary to guess from at all.)
 */

/**
 * The stable fingerprint of a secret. Hex, safe to store, safe to index, safe to log.
 *
 * Note "safe to log" applies to THIS value only, and only because it is an HMAC under a pepper.
 * It is not on the logger's allow-list and does not need to be; nothing in this lane logs it
 * routinely.
 */
export function secretFingerprint(secret: string | Buffer, pepper: Buffer): string {
  return createHmac('sha256', pepper).update(secret).digest('hex')
}

/**
 * Constant-time fingerprint comparison.
 *
 * A duplicate check is not a secret-verification path, so the timing risk here is mild. It is
 * still constant time, because the alternative is a `===` that someone later copies into a path
 * where timing does matter, and the cost of doing it correctly once is nothing.
 */
export function fingerprintsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ba.length !== bb.length || ba.length === 0) return false
  return timingSafeEqual(ba, bb)
}

/**
 * The last four characters, for the "which key is this" affordance in the interface.
 *
 * REFUSES TO EXPOSE ANYTHING FROM A SHORT SECRET. Four characters of a 40-character API key is a
 * useful, harmless identifier. Four characters of an eight-character portal password is a
 * meaningful fraction of the secret shown on a screen that a support person might screenshot.
 * The threshold is deliberate and the honest answer below it is "no hint available", not a
 * quietly-truncated one.
 */
export function secretLast4(secret: string): string | null {
  const MIN_LENGTH_TO_HINT = 12
  if (secret.length < MIN_LENGTH_TO_HINT) return null
  return secret.slice(-4)
}
