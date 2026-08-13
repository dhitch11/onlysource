import { describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { generateDek, unwrapDek, wrapDek } from '@/lib/vault/dek'
import { envRootKeyProvider, fileRootKeyProvider } from '@/lib/vault/root-key'
import { VaultDecryptionError, VaultNotConfiguredError } from '@/lib/vault/errors'
import { fingerprintsEqual, secretFingerprint } from '@/lib/vault/fingerprint'

const HOLDING_A = '11111111-1111-4111-8111-111111111111'
const HOLDING_B = '22222222-2222-4222-8222-222222222222'
const ROOT = randomBytes(32).toString('base64')

function provider() {
  return envRootKeyProvider(ROOT, 'test-root-v1')
}

describe('per-holding data keys', () => {
  it('round trips a data key (POSITIVE CONTROL)', () => {
    const p = provider()
    const dek = generateDek()
    expect(unwrapDek(wrapDek(dek, p, HOLDING_A), p, HOLDING_A).equals(dek)).toBe(true)
  })

  it('REFUSES a wrapped key presented under a different holding', () => {
    // The `org_dek` row for holding A, copied into holding B's row. The AAD binding is what
    // makes this loud instead of silent.
    const p = provider()
    const wrapped = wrapDek(generateDek(), p, HOLDING_A)
    expect(() => unwrapDek(wrapped, p, HOLDING_B)).toThrow(VaultDecryptionError)
  })

  it('REFUSES a wrapped key under a different root', () => {
    const wrapped = wrapDek(generateDek(), provider(), HOLDING_A)
    const otherRoot = envRootKeyProvider(randomBytes(32).toString('base64'), 'other-root')
    expect(() => unwrapDek(wrapped, otherRoot, HOLDING_A)).toThrow(VaultDecryptionError)
  })

  it('produces a different wrapping every time, so the stored column is never a constant', () => {
    const p = provider()
    const dek = generateDek()
    expect(wrapDek(dek, p, HOLDING_A).equals(wrapDek(dek, p, HOLDING_A))).toBe(false)
  })

  it('names an unknown format version instead of failing as a decryption error', () => {
    const p = provider()
    const wrapped = Buffer.from(wrapDek(generateDek(), p, HOLDING_A))
    wrapped[0] = 0x99
    // A format bump must not send someone hunting for a key problem that does not exist.
    expect(() => unwrapDek(wrapped, p, HOLDING_A)).toThrow(/unknown wrapped-key format version/)
  })
})

describe('root key custody', () => {
  it('accepts a mode-0600 file (POSITIVE CONTROL)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vault-key-'))
    const path = join(dir, 'root.key')
    writeFileSync(path, ROOT, { mode: 0o600 })
    chmodSync(path, 0o600)
    const p = fileRootKeyProvider(path, 'file-root-v1')
    expect(p.rootKey()).toHaveLength(32)
    expect(p.status().configured).toBe(true)
  })

  it('REFUSES a group- or world-readable root key file', () => {
    // "Strict permissions and no world-read" is only true if something checks it. A root key
    // readable by every account on the box is equivalent to no vault at all.
    const dir = mkdtempSync(join(tmpdir(), 'vault-key-'))
    const path = join(dir, 'root.key')
    writeFileSync(path, ROOT)
    chmodSync(path, 0o644)
    expect(() => fileRootKeyProvider(path, 'file-root-v1')).toThrow(VaultNotConfiguredError)
  })

  it('REFUSES a key that is not 32 bytes rather than silently weakening the cipher', () => {
    expect(() => envRootKeyProvider(randomBytes(16).toString('base64'), 'short')).toThrow(
      VaultNotConfiguredError,
    )
  })

  it('REFUSES a missing file instead of generating a key', () => {
    // A key minted at process start decrypts nothing after a restart: every stored credential
    // becomes permanently unreadable while every test still passes.
    expect(() => fileRootKeyProvider('/nonexistent/root.key', 'x')).toThrow(
      VaultNotConfiguredError,
    )
  })
})

describe('secret fingerprints', () => {
  const pepper = Buffer.from('server-held-pepper', 'utf8')

  it('matches for identical secrets, so a duplicate paste is detectable', () => {
    expect(
      fingerprintsEqual(
        secretFingerprint('same-credential', pepper),
        secretFingerprint('same-credential', pepper),
      ),
    ).toBe(true)
  })

  it('differs for different secrets', () => {
    expect(
      fingerprintsEqual(secretFingerprint('a', pepper), secretFingerprint('b', pepper)),
    ).toBe(false)
  })

  it('differs under a different pepper, which is what defeats offline guessing', () => {
    // Government portal passwords live in a small, guessable space. A bare sha256 would let an
    // attacker holding the table confirm a guess offline; the pepper removes that oracle.
    expect(
      fingerprintsEqual(
        secretFingerprint('same', pepper),
        secretFingerprint('same', Buffer.from('different-pepper', 'utf8')),
      ),
    ).toBe(false)
  })

  it('does not treat an empty or malformed fingerprint as equal', () => {
    expect(fingerprintsEqual('', '')).toBe(false)
  })
})
