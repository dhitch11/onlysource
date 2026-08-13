import { describe, expect, it } from 'vitest'
import { secretAad } from '@/lib/vault/aad'
import { open, seal } from '@/lib/vault/envelope'
import { VaultDecryptionError } from '@/lib/vault/errors'

/**
 * THE TEST THIS LANE EXISTS FOR.
 *
 * The charter's requirement: `secret_aad = 'holding:<uuid>|conn:<uuid>'` is bound into the GCM
 * tag "so a ciphertext copied between rows fails to decrypt loudly instead of succeeding
 * silently."
 *
 * That sentence describes a NEGATIVE property, and a negative property is only proven by an
 * instrument that could have observed the positive. So every refusal assertion below is paired
 * with a positive control proving the same bytes, key and code path DO work when the identity
 * matches. Without the control, a test asserting "decryption throws" would pass just as green if
 * `seal` were broken, if the key were wrong, or if `open` threw unconditionally.
 */

const KEY = Buffer.alloc(32, 7)
const HOLDING_A = '11111111-1111-4111-8111-111111111111'
const HOLDING_B = '22222222-2222-4222-8222-222222222222'
const CONN_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONN_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SECRET = Buffer.from('a-government-portal-password', 'utf8')

describe('AAD binding: a copied ciphertext must fail loudly', () => {
  it('opens under the identity it was sealed with (POSITIVE CONTROL)', () => {
    const sealed = seal(SECRET, KEY, secretAad(HOLDING_A, CONN_1))
    const opened = open(sealed, KEY, secretAad(HOLDING_A, CONN_1), CONN_1)
    // If this fails, every refusal below is meaningless: the instrument has no working path.
    expect(opened.toString('utf8')).toBe(SECRET.toString('utf8'))
  })

  it('REFUSES a ciphertext moved to a different holding', () => {
    const sealed = seal(SECRET, KEY, secretAad(HOLDING_A, CONN_1))
    // The exact attack: the row's bytes are lifted into another holding's row, same key.
    expect(() => open(sealed, KEY, secretAad(HOLDING_B, CONN_1), CONN_1)).toThrow(
      VaultDecryptionError,
    )
  })

  it('REFUSES a ciphertext moved to a different connection in the same holding', () => {
    const sealed = seal(SECRET, KEY, secretAad(HOLDING_A, CONN_1))
    expect(() => open(sealed, KEY, secretAad(HOLDING_A, CONN_2), CONN_2)).toThrow(
      VaultDecryptionError,
    )
  })

  it('REFUSES when the ciphertext is tampered with', () => {
    const sealed = seal(SECRET, KEY, secretAad(HOLDING_A, CONN_1))
    const tampered = { ...sealed, ct: Buffer.from(sealed.ct) }
    // readUInt8/writeUInt8 rather than `[0] ^= 0xff`: under `noUncheckedIndexedAccess` the
    // index read is `number | undefined`, and the honest repair is an accessor that throws on
    // an out-of-range offset rather than a `?? 0` that would quietly flip a byte of an empty
    // buffer and turn this test into a no-op that still passes.
    tampered.ct.writeUInt8(tampered.ct.readUInt8(0) ^ 0xff, 0)
    expect(() => open(tampered, KEY, secretAad(HOLDING_A, CONN_1), CONN_1)).toThrow(
      VaultDecryptionError,
    )
  })

  it('REFUSES when the authentication tag is tampered with', () => {
    const sealed = seal(SECRET, KEY, secretAad(HOLDING_A, CONN_1))
    const tampered = { ...sealed, tag: Buffer.from(sealed.tag) }
    tampered.tag.writeUInt8(tampered.tag.readUInt8(0) ^ 0xff, 0)
    expect(() => open(tampered, KEY, secretAad(HOLDING_A, CONN_1), CONN_1)).toThrow(
      VaultDecryptionError,
    )
  })

  it('REFUSES under a different root key', () => {
    const sealed = seal(SECRET, KEY, secretAad(HOLDING_A, CONN_1))
    expect(() => open(sealed, Buffer.alloc(32, 9), secretAad(HOLDING_A, CONN_1), CONN_1)).toThrow(
      VaultDecryptionError,
    )
  })

  it('never reuses an IV across seals of identical plaintext', () => {
    // Nonce reuse under GCM leaks plaintext relationships and can break authentication
    // outright. The IV is generated inside `seal` precisely so a caller cannot reuse one.
    const a = seal(SECRET, KEY, secretAad(HOLDING_A, CONN_1))
    const b = seal(SECRET, KEY, secretAad(HOLDING_A, CONN_1))
    expect(a.iv.equals(b.iv)).toBe(false)
    expect(a.ct.equals(b.ct)).toBe(false)
  })
})

describe('AAD construction', () => {
  it('uses the holding form the 2026-08-13 rebuild specifies, not the stale tenant form', () => {
    expect(secretAad(HOLDING_A, CONN_1).toString('utf8')).toBe(
      `holding:${HOLDING_A}|conn:${CONN_1}`,
    )
  })

  it('rejects a non-UUID so a delimiter cannot be smuggled into the authenticated material', () => {
    // A holding id carrying `|` would let a caller forge another pair's AAD by string
    // confusion. Same class as the webhook signer's delimiter attack.
    expect(() => secretAad(`x|conn:${CONN_2}`, CONN_1)).toThrow(TypeError)
    expect(() => secretAad(HOLDING_A, 'not-a-uuid')).toThrow(TypeError)
  })
})
