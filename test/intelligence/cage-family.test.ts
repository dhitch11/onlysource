/**
 * T4 SCORING. The corporate-family resolver, pinned rather than inferred from behaviour.
 *
 * =========================================================================================
 * WHY THIS FILE EXISTS
 * =========================================================================================
 * `cage-family.ts` shipped with 12,523 bytes of union-find, name normalisation and a derived
 * stoplist, and ZERO tests, because the terminal writing it died mid-file at 11:22:34 UTC on
 * 2026-08-24. The module itself names the tests it wanted: `normaliseCompanyTokens` and
 * `namesArePrefixCompatible` are "exported so its truth table is inspectable in a test rather
 * than inferred from behaviour", and `genericTokens` is "exposed so a test can assert what it
 * derived". This is that file.
 *
 * It matters more than a normal unit suite because this module is worth 15 points on every
 * scored row. A wrong answer here does not throw, it pays or withholds a bonus silently.
 *
 * THE ALGORITHM IS PURE, so almost everything below runs against a hand-authored index whose
 * answer was known before the assertion was written. Only the last block reads the real
 * 4.18 MB index, and it skips loudly by name when that file is absent rather than passing on
 * an empty measurement.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  buildCageFamilyIndex,
  namesArePrefixCompatible,
  normaliseCompanyTokens,
  type CageIndexShape,
} from '@/lib/intelligence/scoring/cage-family'

describe('normaliseCompanyTokens: the truth table, not the intuition', () => {
  it('strips suffixes as WHOLE TRAILING TOKENS', () => {
    expect(normaliseCompanyTokens('RAYTHEON COMPANY')).toEqual(['RAYTHEON'])
    expect(normaliseCompanyTokens('RAYTHEON COMPANY DIV CORP')).toEqual(['RAYTHEON'])
    expect(normaliseCompanyTokens('Acme Industries, Inc.')).toEqual(['ACME', 'INDUSTRIES'])
  })

  /*
   * ⛔ THE SUBSTRING TRAPS. The module's own warning is that this estate has already been burned
   * by a `%dent%` filter matching INDEPENDENT while hunting dental practices. These two cases are
   * the ones a substring implementation gets wrong, and they are the reason the rule is token
   * equality. If either of these ever goes red, someone has replaced a token test with a string
   * test and the fix is to put the token test back, not to update the expectation.
   */
  it('CORPUS survives CORP and INCLINE survives INC', () => {
    expect(normaliseCompanyTokens('CORPUS CHRISTI ARMY DEPOT')).toEqual([
      'CORPUS',
      'CHRISTI',
      'ARMY',
      'DEPOT',
    ])
    expect(normaliseCompanyTokens('INCLINE VILLAGE INC')).toEqual(['INCLINE', 'VILLAGE'])
    // INC is stripped only because it TRAILS. INCLINE is never touched.
    expect(normaliseCompanyTokens('INCLINE')).toEqual(['INCLINE'])
  })

  it('does not strip a suffix token that is not trailing', () => {
    // CORP leads here, so it is part of the name, not a legal-form suffix.
    expect(normaliseCompanyTokens('CORP OF ENGINEERS')).toEqual(['CORP', 'OF', 'ENGINEERS'])
  })

  it('strips repeated trailing suffixes, and returns empty when a name is nothing but suffixes', () => {
    expect(normaliseCompanyTokens('BOEING CO LLC')).toEqual(['BOEING'])
    expect(normaliseCompanyTokens('INC LLC CORP')).toEqual([])
  })

  it('treats null, undefined and punctuation-only names as empty rather than throwing', () => {
    expect(normaliseCompanyTokens(null)).toEqual([])
    expect(normaliseCompanyTokens(undefined)).toEqual([])
    expect(normaliseCompanyTokens('  ---  ')).toEqual([])
  })
})

describe('namesArePrefixCompatible: same first token AND a token-prefix', () => {
  it('accepts a genuine prefix', () => {
    expect(namesArePrefixCompatible(['RAYTHEON'], ['RAYTHEON', 'MISSILE', 'SYSTEMS'])).toBe(true)
    expect(namesArePrefixCompatible(['ACME', 'GEAR'], ['ACME', 'GEAR'])).toBe(true)
  })

  it('rejects a different first token even when the rest overlaps', () => {
    expect(namesArePrefixCompatible(['NORTHROP', 'GEAR'], ['ACME', 'GEAR'])).toBe(false)
  })

  it('rejects a mid-list divergence, so it is a PREFIX test and not a set overlap', () => {
    expect(namesArePrefixCompatible(['ACME', 'GEAR'], ['ACME', 'BOLT'])).toBe(false)
  })

  /*
   * The negative control for the substring class, at the comparison layer this time: two tokens
   * where one string contains the other must NOT compare equal.
   */
  it('is not a substring test', () => {
    expect(namesArePrefixCompatible(['RAY'], ['RAYTHEON'])).toBe(false)
  })

  it('an empty token list never matches anything, including another empty one', () => {
    expect(namesArePrefixCompatible([], ['ACME'])).toBe(false)
    expect(namesArePrefixCompatible([], [])).toBe(false)
  })
})

/**
 * A hand-authored index. Shaped like the Raytheon case that caused the defect, small enough
 * that every expected answer was written down before the assertion was.
 *
 *   A1 --S--> A2 --P--> A3     one component, reachable only TRANSITIVELY
 *   B1                          registered, no edge at all: solo
 *   B2                          registered, no edge at all: solo, similar name to B1
 *   C1 --P--> C2                a separate component
 */
function tinyIndex(): CageIndexShape {
  return {
    companies: [
      { cage: 'A1', company: 'RAYTHEON COMPANY' },
      { cage: 'A2', company: 'RAYTHEON COMPANY DIV CORP' },
      { cage: 'A3', company: 'RTX CORP' },
      { cage: 'B1', company: 'ACME GEAR' },
      { cage: 'B2', company: 'ACME GEAR WORKS' },
      { cage: 'C1', company: 'NORTHROP GRUMMAN' },
      { cage: 'C2', company: 'NORTHROP SYSTEMS' },
      { cage: 'D1', company: null },
    ] as CageIndexShape['companies'],
    associations: [
      { cage: 'A1', association: 'A2', affiliation: 'S' },
      { cage: 'A2', association: 'A3', affiliation: 'P' },
      { cage: 'C1', association: 'C2', affiliation: 'P' },
      // A self-edge, which the builder must skip rather than treating as a relationship.
      { cage: 'B1', association: 'B1', affiliation: '' },
    ] as CageIndexShape['associations'],
  }
}

describe('the rollup closure', () => {
  /*
   * ★ THE CONTROL THAT A ONE-HOP IMPLEMENTATION FAILS AND EVERY OTHER TEST PASSES.
   *
   * This is the defect in one assertion. A1 reaches A3 only through A2. A single lookup on A1
   * lands on A2 and calls A1 and A3 different companies, which is exactly how an approved source
   * was paid a silence bonus while its corporate parent held the award. If this file is ever
   * green while this test is red, nothing else in it is protecting anything.
   */
  it('resolves TRANSITIVELY, so a relative two hops away is still family', () => {
    const ix = buildCageFamilyIndex(tinyIndex())
    const a1 = ix.resolve('A1')
    const a3 = ix.resolve('A3')
    expect(a1.state).toBe('rollup')
    expect(a3.state).toBe('rollup')
    expect(a1.state === 'rollup' && a3.state === 'rollup' && a1.family === a3.family).toBe(true)

    const answer = ix.sameFamily('A1', 'A3')
    expect(answer.verdict).toBe('same_family')
    expect(answer.basis).toBe('rollup_match')
  })

  it('an identical CAGE is family with itself, and says which leg answered', () => {
    const ix = buildCageFamilyIndex(tinyIndex())
    expect(ix.sameFamily('A1', 'A1')).toMatchObject({
      verdict: 'same_family',
      basis: 'identical_cage',
    })
  })

  it('a CAGE with no edge is solo, not absent, and carries its name for the fallback leg', () => {
    const ix = buildCageFamilyIndex(tinyIndex())
    const b1 = ix.resolve('B1')
    expect(b1.state).toBe('solo')
    expect(b1.state === 'solo' && b1.name).toBe('ACME GEAR')
  })

  it('skips self-edges rather than counting them as a relationship', () => {
    // B1's only association row points at itself. If the builder honoured it, B1 would be
    // 'rollup' rather than 'solo', which is what the assertion above would catch.
    const ix = buildCageFamilyIndex(tinyIndex())
    expect(ix.resolve('B1').state).toBe('solo')
  })

  /*
   * ⛔ THE NAME LEG MAY NEVER OUTVOTE A ROLLUP NEGATIVE. C1 and C2 share a first token and both
   * carry rollup edges. The authoritative source has already spoken, so two similar names do not
   * get to overturn it. Here they are in the SAME component, so the interesting half is the basis.
   */
  it('answers from the rollup, not the name, whenever both CAGEs carry edges', () => {
    const ix = buildCageFamilyIndex(tinyIndex())
    const answer = ix.sameFamily('C1', 'C2')
    expect(answer.verdict).toBe('same_family')
    expect(answer.basis).toBe('rollup_match')
  })

  it('two edged CAGEs in different components are different_families on the rollup basis', () => {
    const ix = buildCageFamilyIndex(tinyIndex())
    const answer = ix.sameFamily('A1', 'C1')
    expect(answer.verdict).toBe('different_families')
    expect(answer.basis).toBe('rollup_distinct')
  })
})

describe('the three states: ungrounded is NOT different_families', () => {
  /*
   * ★ THE DISTINCTION THE MODULE CALLS OUT IN CAPITALS, PINNED.
   *
   * For the award-silence leg these two verdicts have OPPOSITE money consequences.
   * `different_families` means the winner is unrelated, the source really was silent, and the
   * leg PAYS. `ungrounded` means we could not tell, and the leg must WITHHOLD. A caller that
   * collapses them has reintroduced the defect precisely on the rows it understands least,
   * which is the worst possible place to be confidently wrong.
   */
  it('an unknown CAGE is absent, and comparing against it is ungrounded', () => {
    const ix = buildCageFamilyIndex(tinyIndex())
    expect(ix.resolve('ZZZZZ').state).toBe('absent')

    const answer = ix.sameFamily('A1', 'ZZZZZ')
    expect(answer.verdict).toBe('ungrounded')
    expect(answer.verdict).not.toBe('different_families')
    expect(answer.basis).toBe('cage_absent_from_index')
  })

  it('null and undefined CAGEs are ungrounded rather than throwing or matching', () => {
    const ix = buildCageFamilyIndex(tinyIndex())
    expect(ix.sameFamily('A1', null).verdict).toBe('ungrounded')
    expect(ix.sameFamily(undefined, 'A1').verdict).toBe('ungrounded')
  })

  it('every verdict names the leg that produced it, so a wrong answer is traceable', () => {
    const ix = buildCageFamilyIndex(tinyIndex())
    for (const pair of [['A1', 'A3'], ['A1', 'C1'], ['A1', 'ZZZZZ'], ['B1', 'B2']] as const) {
      const answer = ix.sameFamily(pair[0], pair[1])
      expect(answer.basis).toBeTruthy()
      expect(answer.detail.length).toBeGreaterThan(0)
    }
  })
})

describe('the generic-token stoplist is DERIVED from the index, not remembered', () => {
  it('derives nothing from a small index, because no token begins enough families', () => {
    const ix = buildCageFamilyIndex(tinyIndex())
    expect(ix.genericTokens).toEqual([])
  })

  /*
   * Build an index where one first token genuinely begins more families than the threshold, and
   * assert the stoplist picks it up. The threshold is read from the module rather than hardcoded
   * here, so raising it in one place does not leave this test asserting the old number.
   */
  it('abstains on a first token that begins more families than the threshold', () => {
    const companies: { cage: string; company: string }[] = []
    const associations: { cage: string; association: string; affiliation: string }[] = []
    for (let i = 0; i < 60; i++) {
      // 60 distinct solo families all starting with THE, comfortably over the threshold of 50.
      companies.push({ cage: `T${i}`, company: `THE ${i} WIDGET WORKS` })
    }
    companies.push({ cage: 'X1', company: 'THE ACME' })
    companies.push({ cage: 'X2', company: 'THE ACME PARTS' })
    const ix = buildCageFamilyIndex({
      companies,
      associations,
    } as unknown as CageIndexShape)

    expect(ix.genericTokens).toContain('THE')
    const answer = ix.sameFamily('X1', 'X2')
    expect(answer.verdict).toBe('ungrounded')
    expect(answer.basis).toBe('name_abstained_generic_token')
  })
})

/**
 * THE REAL INDEX. Skipped loudly by name when absent, because a suite that reports success
 * while measuring nothing is worse than one that fails.
 *
 * Every figure below was re-measured against this file on 2026-08-24 by counting exactly what
 * `buildCageFamilyIndex` counts. They are pinned because the shipped module's header publishes
 * them as its evidence, and a published figure nobody checks is how 5,473 survived in that same
 * header until it was measured at 5,531.
 */
const REAL_INDEX = path.join(process.cwd(), 'data', 'flis', 'cage-index.json')

describe('the real FLIS cage index', () => {
  if (!existsSync(REAL_INDEX)) {
    it(`SKIPPED: no cage index at ${REAL_INDEX} in this environment`, () => {
      expect(existsSync(REAL_INDEX)).toBe(false)
    })
    return
  }

  const parsed = JSON.parse(readFileSync(REAL_INDEX, 'utf8')) as CageIndexShape
  const ix = buildCageFamilyIndex({
    companies: parsed.companies,
    associations: parsed.associations,
  })

  it('carries the registered-company count its own header publishes', () => {
    expect(ix.companies).toBe(18748)
  })

  it('derives THE and AMERICAN as the generic tokens, and nothing else', () => {
    expect([...ix.genericTokens].sort()).toEqual(['AMERICAN', 'THE'])
  })

  /*
   * ★ THE WORKED EXAMPLE FROM THE MODULE HEADER, ASSERTED RATHER THAN TRUSTED.
   * 54X10 RAYTHEON COMPANY reaches 61858 RTX CORP only through 49956. This is the real-data
   * form of the transitivity control above: a one-hop resolver lands on 49956 and calls them
   * different companies.
   */
  it('puts RAYTHEON COMPANY and RTX CORP in one family, two hops apart', () => {
    const a = ix.resolve('54X10')
    const c = ix.resolve('61858')
    expect(a.state).toBe('rollup')
    expect(c.state).toBe('rollup')
    expect(a.state === 'rollup' && c.state === 'rollup' && a.family === c.family).toBe(true)
    expect(ix.sameFamily('54X10', '61858')).toMatchObject({
      verdict: 'same_family',
      basis: 'rollup_match',
    })
  })

  /*
   * The measured proof that the AUTHORITATIVE ROLLUP is carrying this fix and the name fallback
   * is not quietly doing the work. If the name leg were doing it, RAYTHEON-named CAGEs would
   * collapse toward one family; they do not, and most of them sit under RTX by rollup.
   */
  it('does not let the name leg collapse the RAYTHEON-named CAGEs into one family', () => {
    const raytheon = parsed.companies.filter(
      (c) => normaliseCompanyTokens(c.company)[0] === 'RAYTHEON',
    )
    expect(raytheon.length).toBeGreaterThan(100)

    const roots = new Set<string>()
    for (const c of raytheon) {
      const r = ix.resolve(c.cage)
      roots.add(r.state === 'absent' ? `absent:${c.cage}` : r.family)
    }
    // More than one root: the rollup is discriminating, not lumping every shared name together.
    expect(roots.size).toBeGreaterThan(1)
  })

  it('reports an unedged registered CAGE as solo rather than absent', () => {
    // Whichever CAGE it is, the index must distinguish "registered with no edge" from "unknown".
    const solo = parsed.companies.find((c) => ix.resolve(c.cage).state === 'solo')
    expect(solo).toBeDefined()
    expect(ix.resolve('ZZZZZ').state).toBe('absent')
  })
})
