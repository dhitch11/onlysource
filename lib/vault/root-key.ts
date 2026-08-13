import 'server-only'
import { statSync, readFileSync } from 'node:fs'
import { KEY_BYTES } from './envelope'
import { VaultNotConfiguredError } from './errors'

/**
 * Root-key custody.
 *
 * The charter (4.12) settles this: the environment root key is held on the box, as EITHER a
 * cloud KMS unwrap call OR a server-held root in an OS keyring or a file with strict
 * permissions and no world-read. The plaintext data key is never at rest either way.
 *
 * THIS IS WHY THE FILE PROVIDER IS A REAL ANSWER AND NOT A STOPGAP. An earlier draft of this
 * lane recorded "no KMS" as a hard blocker on the assumption that a cloud KMS was the only
 * sanctioned custody. The hosting decision made the box itself the trust boundary, which
 * downgrades that blocker to a choice. The provider seam stays because the choice is real and
 * reversible, not because the file path is temporary.
 *
 * WHAT THIS MODULE REFUSES TO DO: generate a root key when none is configured. A key minted at
 * process start decrypts nothing after a restart, so every stored credential becomes
 * permanently unreadable while every test passes. That failure surfaces as data loss weeks
 * later rather than as a missing plug today, so an absent root key is a loud refusal here.
 */

export type RootKeyKind = 'file' | 'env' | 'kms'

export type RootKeyStatus = {
  kind: RootKeyKind | 'none'
  configured: boolean
  /** Plain words for the health surface. Never the key, never the path's contents. */
  detail: string
  /** The id recorded on every `org_dek` row so a re-wrap can find its predecessor. */
  keyId: string | null
}

export interface RootKeyProvider {
  /** Recorded on `org_dek.kms_key_id`. Identifies WHICH root wrapped a given DEK. */
  readonly keyId: string
  readonly kind: RootKeyKind
  /** The 32-byte root. Held in memory only for the duration of a wrap or unwrap. */
  rootKey(): Buffer
  status(): RootKeyStatus
}

/**
 * A root key held in a file on the box.
 *
 * The permission check is a real control, not decoration: "strict permissions and no
 * world-read" is only true if something verifies it, and a root key readable by every account
 * on the box is equivalent to no vault at all. Mode is checked on every construction rather
 * than once at boot, because a deploy script can loosen a mode after startup.
 */
export function fileRootKeyProvider(path: string, keyId: string): RootKeyProvider {
  const read = (): Buffer => {
    let mode: number
    try {
      mode = statSync(path).mode
    } catch {
      throw new VaultNotConfiguredError(
        `the root key file named by VAULT_ROOT_KEY_FILE is not readable at its configured path`,
      )
    }
    // Refuse any group or other permission bit. 0o077 covers group rwx and other rwx.
    if ((mode & 0o077) !== 0) {
      throw new VaultNotConfiguredError(
        `the root key file is group- or world-accessible (mode ${(mode & 0o777).toString(8)}). ` +
          `Set it to 0600 and owned by the service account before the vault will operate.`,
      )
    }
    return decodeKey(readFileSync(path, 'utf8').trim(), 'VAULT_ROOT_KEY_FILE')
  }
  // Read once to fail fast at construction, then re-read per use so a rotated file is picked up
  // and a loosened mode is caught.
  read()
  return {
    keyId,
    kind: 'file',
    rootKey: read,
    status: () => ({
      kind: 'file',
      configured: true,
      keyId,
      detail: 'Root key held on the box in a mode-0600 file. Permissions re-checked on every use.',
    }),
  }
}

/**
 * A root key supplied by environment variable.
 *
 * Correct for tests and for a development box. On the production box a file with an enforced
 * mode is preferred, because an environment variable is visible to anything that can read the
 * process environment and lands in more places than people expect (a crash dumper, a process
 * lister, a systemd `show` invocation).
 */
export function envRootKeyProvider(material: string, keyId: string): RootKeyProvider {
  const key = decodeKey(material, 'VAULT_ROOT_KEY')
  return {
    keyId,
    kind: 'env',
    rootKey: () => key,
    status: () => ({
      kind: 'env',
      configured: true,
      keyId,
      detail:
        'Root key supplied by environment variable. Acceptable for development and tests; ' +
        'prefer a mode-0600 file on the production box.',
    }),
  }
}

/**
 * Accepts base64 or hex, and insists on exactly 32 bytes.
 *
 * A short key is the failure worth naming precisely: a 16-byte value passed here would be a
 * silent downgrade to a weaker cipher in a permissive implementation. The length is checked,
 * and the value itself never appears in the error.
 */
function decodeKey(material: string, sourceName: string): Buffer {
  // Decoded directly rather than through an array. The earlier shape indexed a one-element
  // array, which under `noUncheckedIndexedAccess` typed the root key as `Buffer | undefined`
  // and made the length check below reachable with `undefined`. In a crypto path that is not a
  // lint annoyance to silence: the compiler was correctly describing a value that could be
  // absent at the exact point we decide whether the key is strong enough.
  const key = /^[0-9a-f]+$/i.test(material)
    ? Buffer.from(material, 'hex')
    : Buffer.from(material, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new VaultNotConfiguredError(
      `${sourceName} must decode to exactly ${KEY_BYTES} bytes (hex or base64); ` +
        `it decoded to ${key.length}`,
    )
  }
  return key
}

/** The honest "no plug" state, for the health surface and for every caller that must refuse. */
export const NOT_CONFIGURED: RootKeyStatus = {
  kind: 'none',
  configured: false,
  keyId: null,
  detail:
    'No vault root key is configured, so no credential can be sealed or opened. ' +
    'Set VAULT_ROOT_KEY_FILE (preferred on the box) or VAULT_ROOT_KEY.',
}
