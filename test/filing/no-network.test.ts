import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * STRUCTURAL PROOF that the filing writer cannot transmit. The module produces a file a person
 * uploads to DIBBS; it must never open a connection to DLA or anywhere else. This is the exact
 * boundary of David's standing no-send ban applied to the one module whose whole subject is a
 * government submission file — so it is enforced by a test, not by a comment.
 *
 * The test reads every source file under lib/filing and asserts none of them imports or names a
 * network primitive. If a future edit adds one, this fails before it can ship.
 */

const NETWORK_TOKENS = [
  "'http'", '"http"', "'node:http'", '"node:http"',
  "'https'", '"https"', "'node:https'", '"node:https"',
  "'net'", '"net"', "'node:net'", '"node:net"',
  "'dgram'", '"dgram"', "'node:dgram'", '"node:dgram"',
  "'tls'", '"tls"', "'node:tls'", '"node:tls"',
  'fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon',
  'undici', 'axios', 'node-fetch',
]

function filingSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filingSourceFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('lib/filing is structurally incapable of sending', () => {
  const root = join(process.cwd(), 'lib', 'filing')
  const files = filingSourceFiles(root)

  it('finds the filing source files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file.replace(root, 'lib/filing')} imports no network primitive`, () => {
      const src = readFileSync(file, 'utf8')
      for (const token of NETWORK_TOKENS) {
        expect(src.includes(token), `${file} contains forbidden network token ${token}`).toBe(false)
      }
    })
  }
})
