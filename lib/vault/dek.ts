import 'server-only'
import { randomBytes } from 'node:crypto'
import { dekAad } from './aad'
import { KEY_BYTES, open, seal, type SealedEnvelope } from './envelope'
import { VaultMalformedEnvelopeError } from './errors'
import type { RootKeyProvider } from './root-key'

/**
 * The per-holding data key: the middle layer of the envelope scheme.
 *
 * ONE ENVIRONMENT ROOT KEY, ONE DATA KEY PER HOLDING (`org_dek`), charter 4.4. The rejected
 * alternative is recorded there with its reason: one KMS key per holding buys isolation the
 * per-holding DEK already provides, at a per-key monthly cost. BYOK is deferred, not precluded,
 * and this shape is why: introducing a per-org customer-managed root later re-wraps the DEKs
 * without re-encrypting a single credential.
 *
 * THE PLAINTEXT DEK IS NEVER AT REST. It exists as a local variable for the duration of one
 * seal or one open, and the caller is expected to let it go out of scope immediately. What is
 * stored is the wrapped form.
 */

/** Envelope format version, so a future rotation can change the shape without ambiguity. */
const FORMAT_V1 = 0x01
const IV_BYTES = 12
const TAG_BYTES = 16
const HEADER = 1 + IV_BYTES + TAG_BYTES

/** A fresh 256-bit data key. */
export function generateDek(): Buffer {
  return randomBytes(KEY_BYTES)
}

/**
 * Wrap a data key under the environment root, bound to its holding.
 *
 * Returns the single opaque value stored in `org_dek.wrapped_dek`. Packed rather than split
 * across columns because, unlike a connection secret, nothing ever needs to query a DEK's parts.
 */
export function wrapDek(dek: Buffer, provider: RootKeyProvider, holdingId: string): Buffer {
  if (dek.length !== KEY_BYTES) {
    throw new VaultMalformedEnvelopeError(
      `a data key must be ${KEY_BYTES} bytes, received ${dek.length}`,
    )
  }
  const sealed = seal(dek, provider.rootKey(), dekAad(holdingId))
  return pack(sealed)
}

/**
 * Unwrap a data key.
 *
 * Throws `VaultDecryptionError` if the wrapped key belongs to a different holding, if the root
 * key is not the one that wrapped it, or if the bytes were tampered with. That refusal is the
 * feature: a DEK row copied between holdings must fail loudly rather than yield a working key.
 */
export function unwrapDek(
  wrapped: Buffer,
  provider: RootKeyProvider,
  holdingId: string,
): Buffer {
  return open(unpack(wrapped), provider.rootKey(), dekAad(holdingId), `org_dek:${holdingId}`)
}

function pack(e: SealedEnvelope): Buffer {
  return Buffer.concat([Buffer.from([FORMAT_V1]), e.iv, e.tag, e.ct])
}

function unpack(buf: Buffer): SealedEnvelope {
  if (buf.length <= HEADER) {
    throw new VaultMalformedEnvelopeError(
      `a wrapped data key must be longer than ${HEADER} bytes, received ${buf.length}`,
    )
  }
  const version = buf[0]
  if (version !== FORMAT_V1) {
    // Named explicitly so a future format bump produces a clear failure rather than a
    // decryption error that sends someone hunting for a key problem that does not exist.
    throw new VaultMalformedEnvelopeError(
      `unknown wrapped-key format version ${version}; this build understands ${FORMAT_V1}`,
    )
  }
  return {
    iv: buf.subarray(1, 1 + IV_BYTES),
    tag: buf.subarray(1 + IV_BYTES, HEADER),
    ct: buf.subarray(HEADER),
  }
}
