import 'server-only'

/**
 * The Additional Authenticated Data bound into every credential's GCM tag.
 *
 * THE FORMAT IS FIXED BY THE CHARTER AND IS NOT A STYLE CHOICE:
 *
 *     holding:<uuid>|conn:<uuid>
 *
 * (T7-PLATFORM-OPS.md 4.4. Note this is `holding:`, NOT `tenant:`. The 2026-08-13 rebuild
 * moved the data-key grain from per-tenant to per-holding, and an earlier draft of this lane's
 * claim recorded the `tenant:` form. Anything still carrying `tenant:` is stale.)
 *
 * WHY BIND IT AT ALL. Without AAD, a ciphertext lifted out of one connection row and pasted
 * into another still decrypts perfectly, because the bytes are valid under the same key. The
 * theft is invisible: no error, no log line, a working credential in the wrong place. Binding
 * the holding and connection ids into the authentication tag converts that silent success into
 * a loud refusal, which is the entire point. The test that proves it lives in
 * `test/t7-vault/aad-binding.test.ts` and it asserts the copy FAILS, with a positive control
 * asserting the un-copied ciphertext still opens, so the instrument has a failure mode.
 *
 * The AAD is not secret. It is authenticated, not encrypted, and it is reconstructed at open
 * time from the row's own ids rather than read back from storage. That direction matters: if we
 * stored the AAD and trusted it, an attacker who could edit the row could edit the AAD to match
 * their copied ciphertext and the binding would prove nothing.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Build the AAD for a credential.
 *
 * Ids are validated rather than interpolated blindly. A `holding_id` carrying a `|` would let a
 * caller forge a different pair's AAD by string confusion, which is the same delimiter attack the
 * webhook signer has to defend against, and it costs nothing to close here.
 */
export function secretAad(holdingId: string, connectionId: string): Buffer {
  assertUuid(holdingId, 'holdingId')
  assertUuid(connectionId, 'connectionId')
  return Buffer.from(`holding:${holdingId}|conn:${connectionId}`, 'utf8')
}

/**
 * Build the AAD for a wrapped data key.
 *
 * Kept in this module so there is exactly one place AAD strings are constructed. The DEK wrap
 * binds only the holding, because a data key belongs to a holding and to no single connection.
 * The `|dek` suffix means a wrapped DEK and a sealed credential can never be confused for one
 * another even if both were somehow encrypted under the same key: the domains are separated in
 * the authenticated material rather than by convention.
 */
export function dekAad(holdingId: string): Buffer {
  assertUuid(holdingId, 'holdingId')
  return Buffer.from(`holding:${holdingId}|dek`, 'utf8')
}

function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    // The value is an identifier, not a secret, but it is still not echoed in full: a caller
    // passing the wrong variable could pass anything, including a credential.
    throw new TypeError(
      `${field} must be a UUID. Received a ${typeof value} of length ${String(value).length}.`,
    )
  }
}
