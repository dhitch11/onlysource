import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>

/**
 * PASSWORD CREDENTIALS. Real per-person sign in, replacing the shared pre-release phrase.
 *
 * ==========================================================================================
 * WHAT THIS STORES, AND WHAT IT CAN NEVER STORE.
 * ==========================================================================================
 * A password NEVER exists anywhere in this system except in the request body of the sign-in
 * POST and in memory for the microseconds it takes to hash. What is persisted is a scrypt
 * derivation with a per-user random salt. There is no path from the stored value back to the
 * password, which is the whole point, and it means:
 *
 *   - the credential is not in the repository, and cannot be, because the repository is PUBLIC
 *   - the credential is not in a log, an error message, a commit, a deploy script or a memory doc
 *   - an operator who reads the state file learns nothing they can sign in with
 *
 * scrypt is used rather than bcrypt or argon2 because it ships inside Node. A dependency-free
 * credential path cannot be broken by a supply chain problem in a package this product does not
 * control, and this repository is public, so its dependency list is public too.
 *
 * ==========================================================================================
 * THE PARAMETERS, AND WHY THEY ARE STORED WITH THE HASH.
 * ==========================================================================================
 * N=2^15, r=8, p=1 is the OWASP-recommended scrypt work factor at the time of writing, and it
 * costs roughly 100ms per verification on this hardware, which is the point: it makes a stolen
 * state file expensive to attack and a single sign-in imperceptible.
 *
 * They are encoded INTO the stored string rather than read from a constant, so raising the work
 * factor later does not invalidate every existing credential. A hash carries the cost it was
 * created with, and `needsRehash` tells the caller when a credential is due to be upgraded on
 * next successful sign in. A system that cannot raise its work factor without a password reset
 * never raises it.
 *
 * Format:  scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>
 */

const N = 2 ** 15
const R = 8
const P = 1
const KEYLEN = 32
const SALT_BYTES = 16

/** Minimum length. Deliberately the NIST floor, not a character-class rule. */
export const MIN_PASSWORD_LENGTH = 8

export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'A password is required.'
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password.length > 512) return 'That password is too long.'
  return null
}

/** Derive a storable credential. The password is not returned and is not logged. */
export async function hashPassword(password: string): Promise<string> {
  const problem = passwordProblem(password)
  if (problem) throw new Error(problem)
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password, salt, KEYLEN)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`
}

type Parsed = { n: number; r: number; p: number; salt: Buffer; hash: Buffer }

function parse(stored: string): Parsed | null {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null
  // A hostile state file could otherwise ask for a work factor that hangs the process.
  if (n < 2 ** 12 || n > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return null
  try {
    return {
      n,
      r,
      p,
      salt: Buffer.from(parts[4] as string, 'base64'),
      hash: Buffer.from(parts[5] as string, 'base64'),
    }
  } catch {
    return null
  }
}

/**
 * Verify a submitted password against a stored credential.
 *
 * FAILS CLOSED on every malformed input: no stored credential, an unparseable one, an empty
 * submission. It never throws, because a thrown error in a sign-in path becomes a 500 that tells
 * an attacker the account exists.
 *
 * The comparison is constant time. The LENGTH check before it is safe here because both sides are
 * fixed-length derived keys, never raw user input.
 */
export async function verifyPassword(submitted: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || typeof submitted !== 'string' || submitted.length === 0) return false
  const parsed = parse(stored)
  if (!parsed) return false
  try {
    const derived = await scrypt(submitted, parsed.salt, parsed.hash.length)
    if (derived.length !== parsed.hash.length) return false
    return timingSafeEqual(derived, parsed.hash)
  } catch {
    return false
  }
}

/** True when a stored credential was made with a weaker work factor than we now use. */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return false
  const parsed = parse(stored)
  if (!parsed) return true
  return parsed.n < N || parsed.r < R || parsed.p < P
}

/** Does this string look like one of our credentials? Used to keep secrets out of the wrong field. */
export function isCredential(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('scrypt$') && parse(value) !== null
}
