import 'server-only'

/**
 * Vault errors are their own types for one reason: the catch site must be able to tell
 * "this ciphertext does not belong here" from "the key is missing" without parsing a
 * message string.
 *
 * NONE of these carry a secret, a key, a plaintext, or a ciphertext in their message. An
 * exception message is the single most common way a credential reaches a log sink, because
 * `error_message` is on the logger's allow-list by design (see `lib/log.ts`) and a helpful
 * message written at 2 AM is how it gets there. The canary test greps for the literal secret
 * value across every sink precisely to catch a regression here.
 */

export class VaultNotConfiguredError extends Error {
  readonly code = 'vault_not_configured'
  constructor(detail: string) {
    super(`The vault is not configured: ${detail}`)
    this.name = 'VaultNotConfiguredError'
  }
}

/**
 * Thrown when AES-256-GCM authentication fails.
 *
 * This is the LOUD failure the AAD design exists to produce. A ciphertext copied from one
 * holding's row into another decrypts to garbage under a permissive design; under this one it
 * refuses, because the holding and connection ids are bound into the authentication tag.
 *
 * `reason` deliberately does not distinguish "wrong key" from "tampered ciphertext" from
 * "wrong AAD" to the caller as separate error types: GCM cannot tell them apart, and inventing
 * a distinction would be a fabricated diagnosis.
 */
export class VaultDecryptionError extends Error {
  readonly code = 'vault_decryption_failed'
  constructor(
    /** Non-secret context: which connection row we were opening. Never the ciphertext. */
    readonly connectionId: string,
  ) {
    super(
      'Vault decryption failed: the authentication tag did not verify. ' +
        'The key, the ciphertext, or the bound holding/connection identity does not match.',
    )
    this.name = 'VaultDecryptionError'
  }
}

/** The stored envelope is structurally wrong (bad IV length, bad tag length, empty ciphertext). */
export class VaultMalformedEnvelopeError extends Error {
  readonly code = 'vault_malformed_envelope'
  constructor(detail: string) {
    super(`Vault envelope is malformed: ${detail}`)
    this.name = 'VaultMalformedEnvelopeError'
  }
}
