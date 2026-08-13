/**
 * T2 INGESTION. The solicitation-number canary, held to real bytes.
 *
 * THIS TEST EXISTS BECAUSE A REGEX SHIPPED THAT MATCHED NOTHING.
 *
 * The connector layer's canary was `/SPE[0-9A-Z]{2}-?[0-9]{2}-?[A-Z]?-?[0-9]{4}/`, which
 * implies 14 characters. Real solicitation numbers are 13. It scored **0 of 2,721** against
 * the archived feed day, and because the canary is the final check in the content ladder and
 * its miss returns a failed assertion, it would have made every real feed day read as corrupt
 * and failed CLOSED on every ingest.
 *
 * Reading that regex does not catch it. Running it against 439,490 bytes of real government
 * data catches it immediately. So the canary now has one owner, one definition, and this
 * test, which holds it to the actual file rather than to anybody's reading of the format.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { SOLICITATION_CANARY, SOLICITATION_CANARY_LOOSE } from '../../lib/ingest/parse/dibbs'

const ARCHIVE = process.env.INGEST_ARCHIVE_ROOT ?? '/Users/user/onlysource-data/archive'

function archived(fragment: string): string {
  const manifestPath = join(ARCHIVE, 'MANIFEST.jsonl')
  if (!existsSync(manifestPath)) {
    throw new Error(
      `The raw landing archive is not present at ${ARCHIVE}. This test holds the canary to real ` +
        `government bytes and must not be made to pass by skipping it.`,
    )
  }
  const rows = readFileSync(manifestPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { storage_key: string })
  const row = rows.find((r) => r.storage_key.includes(fragment))
  if (!row) throw new Error(`no archived object matching "${fragment}"`)
  return readFileSync(join(ARCHIVE, row.storage_key), 'utf8')
}

const feed = archived('in260811.txt')
const solicitations = [
  ...new Set(
    feed
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
      .map((l) => l.slice(0, 13)),
  ),
]

describe('the canary matches REAL data. The positive control.', () => {
  it('matches every distinct solicitation number in the archived feed day', () => {
    expect(solicitations).toHaveLength(2721)
    const missed = solicitations.filter((s) => !SOLICITATION_CANARY.test(s))
    // Named, not just counted, so a future failure says WHICH numbers broke it.
    expect(missed).toEqual([])
  })

  it('matches the whole file, which is what the content ladder actually tests', () => {
    expect(SOLICITATION_CANARY.test(feed)).toBe(true)
  })

  it('the separator-tolerant variant scores identically', () => {
    expect(solicitations.filter((s) => SOLICITATION_CANARY_LOOSE.test(s))).toHaveLength(2721)
  })
})

describe('the canary rejects everything that is NOT data. The negative controls.', () => {
  it('does NOT match the captured consent banner, which is the whole point', () => {
    const banner = archived('consent-banner-at-in260811-url.html')
    expect(SOLICITATION_CANARY.test(banner)).toBe(false)
    expect(SOLICITATION_CANARY_LOOSE.test(banner)).toBe(false)
  })

  it('does not match markup, prose, or a plausible near-miss', () => {
    for (const text of [
      '<html><body>DoD consent</body></html>',
      'SPECIAL2026REPORT',
      'SPE',
      '',
      'SPE1C126Q034', // one character short of a real number
    ]) {
      expect(SOLICITATION_CANARY.test(text)).toBe(false)
    }
  })
})

describe('the regex that shipped in the connector, kept as a regression witness', () => {
  it('scored ZERO against real data, which is why the canary has one owner now', () => {
    const shipped = /SPE[0-9A-Z]{2}-?[0-9]{2}-?[A-Z]?-?[0-9]{4}/
    expect(solicitations.filter((s) => shipped.test(s))).toHaveLength(0)
    expect(shipped.test(feed)).toBe(false)
  })
})

describe('position 8 is the automated-award indicator, measured not assumed', () => {
  it('carries only Q, T and U, and T plus U dominate', () => {
    const ninth = new Map<string, number>()
    for (const s of solicitations) {
      const c = s.charAt(8)
      ninth.set(c, (ninth.get(c) ?? 0) + 1)
    }
    expect([...ninth.keys()].sort()).toEqual(['Q', 'T', 'U'])
    // T and U mark the path where an alternate offer cannot win the instant buy. This
    // independently confirms the ninth-character reading in lib/intelligence/niin.ts
    // against real bytes; it had been an assumption.
    expect((ninth.get('T') ?? 0) + (ninth.get('U') ?? 0)).toBe(2566)
  })
})

describe('the canary is a PRESENCE check and must never be used to EXTRACT', () => {
  /**
   * T7's audit harvested SPE-prefixed tokens with an unanchored scan and found 2,736 where the
   * file holds 2,721 solicitations, and asked whether the 15 extras are a class we are failing
   * to capture. Measured answer: they are not. Every one begins inside the nomenclature field
   * and runs into the code block.
   */
  const rows = feed.split(/\r?\n/).filter((l) => l.length > 0)
  const positional = new Set(rows.map((l) => l.slice(0, 13)))
  const unanchored = [...new Set(feed.match(/SPE[0-9A-Z]{10}/g) ?? [])]
  const extras = unanchored.filter((t) => !positional.has(t))

  it('an unanchored scan over a fixed-width file over-counts, by exactly 15 here', () => {
    expect(positional.size).toBe(2721)
    expect(unanchored.length).toBe(2736)
    expect(extras).toHaveLength(15)
  })

  it('EVERY extra spans the nomenclature to code-block boundary, so none is a real number', () => {
    for (const token of extras) {
      const row = rows.find((l) => l.includes(token))
      expect(row).toBeDefined()
      const at = (row as string).indexOf(token)
      // Nomenclature is [108:129]; the code block starts at 129. A boundary artifact begins
      // inside the nomenclature and crosses into the code block.
      expect(at).toBeGreaterThanOrEqual(108)
      expect(at).toBeLessThan(129)
      expect(at + token.length).toBeGreaterThan(129)
    }
  })

  it('positional extraction, which is what the parser uses, never produces them', () => {
    for (const token of extras) {
      expect(positional.has(token)).toBe(false)
    }
  })
})
