import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { VaultDecryptionError, VaultMalformedEnvelopeError } from './errors'

/**
 * AES-256-GCM sealing. The innermost primitive of the vault, and deliberately the dumbest
 * module in it: it knows about bytes, a key and an AAD, and nothing about holdings,
 * connections, storage or policy. Everything with a decision in it lives a layer up.
 *
 * ZERO NEW DEPENDENCIES. `node:crypto` covers AES-256-GCM, HMAC-SHA256 and SHA-256, and the
 * charter forbids naming a library in the claims file that is not already in this project's
 * lockfile. Verified lockfile at build time: next, react, react-dom, zod, @sentry/nextjs,
 * typescript, vitest and three @types packages. Nothing else, so nothing else is used.
 *
 * WHY GCM RATHER THAN CBC-PLUS-HMAC: the authentication tag is the whole mechanism that makes
 * the AAD binding work (see `aad.ts`). An unauthenticated mode would let a copied ciphertext
 * decrypt to plausible bytes, which is the exact silent-success failure this design exists to
 * convert into a loud one.
 */

/** 96 bits, the GCM-recommended IV size. Not configurable; a 64-bit IV is a nonce-reuse trap. */
const IV_BYTES = 12
/** 128 bits, the full GCM tag. Truncated tags weaken the authentication this design leans on. */
const TAG_BYTES = 16
/** AES-256. */
export const KEY_BYTES = 32

export type SealedEnvelope = {
  /** The ciphertext. Meaningless without key, iv, tag AND the reconstructed AAD. */
  ct: Buffer
  /** Freshly random per seal. NEVER reused with the same key: GCM nonce reuse is catastrophic. */
  iv: Buffer
  /** The GCM authentication tag, over ciphertext AND aad. */
  tag: Buffer
}

/**
 * Seal plaintext under `key`, binding `aad` into the authentication tag.
 *
 * The IV is generated here rather than accepted from the caller, on purpose. Every real-world
 * GCM disaster is nonce reuse, and the reliable way to prevent a caller from reusing one is to
 * not let them supply it.
 */
export function seal(plaintext: Buffer, key: Buffer, aad: Buffer): SealedEnvelope {
  assertKey(key)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad)
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { ct, iv, tag: cipher.getAuthTag() }
}

/**
 * Open a sealed envelope, or throw.
 *
 * There is no "open and return null on failure" variant, and there will not be one. A caller
 * handed `null` writes `if (!secret) { /* fall back * / }`, and a fallback path in a credential
 * unwrap is how an integration ends up silently running unauthenticated. Failure here is
 * exceptional and must stay exceptional.
 *
 * `connectionId` is carried only so the thrown error can name the row without the caller
 * having to reconstruct it. It is never used as key material.
 */
export function open(
  envelope: SealedEnvelope,
  key: Buffer,
  aad: Buffer,
  connectionId: string,
): Buffer {
  assertKey(key)
  assertEnvelope(envelope)
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.iv)
  decipher.setAAD(aad)
  decipher.setAuthTag(envelope.tag)
  try {
    return Buffer.concat([decipher.update(envelope.ct), decipher.final()])
  } catch {
    // The underlying error is swallowed deliberately. Node's GCM failure message is generic,
    // but re-throwing a caught crypto error risks carrying a cause chain into a log line, and
    // the vault's rule is that nothing from this module is loggable except a typed code.
    throw new VaultDecryptionError(connectionId)
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new VaultMalformedEnvelopeError(
      `key must be ${KEY_BYTES} bytes for AES-256, received ${key.length}`,
    )
  }
}

function assertEnvelope(e: SealedEnvelope): void {
  if (e.iv.length !== IV_BYTES) {
    throw new VaultMalformedEnvelopeError(`iv must be ${IV_BYTES} bytes, received ${e.iv.length}`)
  }
  if (e.tag.length !== TAG_BYTES) {
    throw new VaultMalformedEnvelopeError(
      `tag must be ${TAG_BYTES} bytes, received ${e.tag.length}`,
    )
  }
  if (e.ct.length === 0) {
    // An empty ciphertext authenticates fine under GCM and returns empty plaintext. Refusing it
    // here stops "the credential is an empty string" from looking like a successful unwrap.
    throw new VaultMalformedEnvelopeError('ciphertext is empty')
  }
}
