/**
 * MANUFACTURER RESOLUTION TESTS.
 *
 * The risk this module carries is asymmetric and the tests are shaped around that. Failing to
 * merge two codes costs a corner we do not see. WRONGLY merging two codes INVENTS a corner that
 * does not exist and an operator buys inventory against it. So most of what follows tests that
 * the resolver REFUSES to merge, and every merge condition is attacked on its own.
 */
import { describe, expect, it } from 'vitest'

import {
  groupByOperator,
  loadCageIndex,
  lookupCage,
  normalizeCompanyName,
  type CageIndex,
} from '@/lib/intelligence/manufacturers/cage'

function index(
  companies: Array<{ cage: string; company: string; cao: string }>,
  associations: Array<{ cage: string; association: string; affiliation?: string }> = [],
): CageIndex {
  const complexes = new Map<string, string[]>()
  for (const a of associations) {
    const m = complexes.get(a.association) ?? []
    m.push(a.cage)
    complexes.set(a.association, m)
  }
  return {
    ok: true,
    companies: new Map(
      companies.map((c) => [
        c.cage,
        { ...c, city: '', state: '', zip: '', country: '', status: 'A', type: 'F' },
      ]),
    ),
    associations: new Map(
      associations.map((a) => [a.cage, { cage: a.cage, association: a.association, affiliation: a.affiliation ?? 'S' }]),
    ),
    complexes,
    provenance: {
      parentCagePopulated: 0,
      referencedCages: companies.length,
      resolvedCages: companies.length,
      unresolvedCages: 0,
      feedDay: 'test',
      derivedFrom: [],
    },
  }
}

describe('normalizeCompanyName', () => {
  it('drops a DBA tail, which is one entity trading under two names', () => {
    expect(normalizeCompanyName('WKF (FRIEDMAN) ENTERPRISES, INC.')).toBe('WKF FRIEDMAN ENTERPRISES')
    expect(normalizeCompanyName('WKF (FRIEDMAN) ENTERPRISES, INC. DBA WKF FRIEDMAN ENTERPRISES, INC.')).toBe(
      'WKF FRIEDMAN ENTERPRISES',
    )
  })

  it('strips corporate suffixes that carry no distinguishing information', () => {
    expect(normalizeCompanyName('ACME CORP')).toBe('ACME')
    expect(normalizeCompanyName('ACME, INCORPORATED')).toBe('ACME')
    expect(normalizeCompanyName('ACME LLC')).toBe('ACME')
  })

  it('does NOT strip words that can distinguish two real firms', () => {
    // "ACME SYSTEMS" and "ACME" are routinely different companies. Adding SYSTEMS, GROUP or
    // HOLDINGS to the suffix list would fuse them and invent a monopoly.
    expect(normalizeCompanyName('ACME SYSTEMS INC')).toBe('ACME SYSTEMS')
    expect(normalizeCompanyName('ACME GROUP LLC')).toBe('ACME GROUP')
    expect(normalizeCompanyName('ACME HOLDINGS')).toBe('ACME HOLDINGS')
  })

  it('never reduces a name to nothing', () => {
    expect(normalizeCompanyName('INC')).toBe('INC')
    expect(normalizeCompanyName('CO')).toBe('CO')
  })
})

describe('groupByOperator merges only on evidence', () => {
  it('merges on the government record and says so', () => {
    const idx = index(
      [
        { cage: 'AAAAA', company: 'BIG AEROSPACE INC', cao: 'S0001A' },
        { cage: 'BBBBB', company: 'ENTIRELY DIFFERENT NAME LLC', cao: 'S9999Z' },
      ],
      [
        { cage: 'AAAAA', association: 'AAAAA', affiliation: 'P' },
        { cage: 'BBBBB', association: 'AAAAA', affiliation: 'S' },
      ],
    )
    const g = groupByOperator(['AAAAA', 'BBBBB'], idx)
    expect(g.operatorCount).toBe(1)
    expect(g.clusters[0]!.evidence).toBe('complex_confirmed')
    // Different names AND different CAOs: only the record could have merged these.
    expect(g.clusters[0]!.basis).toContain('corporate complex')
  })

  it('merges on name prefix PLUS shared CAO, and grades it suspected not confirmed', () => {
    const idx = index([
      { cage: 'AAAAA', company: 'WKF (FRIEDMAN) ENTERPRISES, INC.', cao: 'S0302A' },
      { cage: 'BBBBB', company: 'WKF (FRIEDMAN) ENTERPRISES, INC. DBA WKF FRIEDMAN ENTERPRISES, INC.', cao: 'S0302A' },
    ])
    const g = groupByOperator(['AAAAA', 'BBBBB'], idx)
    expect(g.operatorCount).toBe(1)
    expect(g.clusters[0]!.evidence).toBe('same_operator_suspected')
    expect(g.clusters[0]!.basis).toContain('not a government record')
  })

  it('REFUSES to merge on a shared CAO alone', () => {
    // A Contract Administration Office administers thousands of unrelated firms. Merging on it
    // would collapse an entire region into one "operator".
    const idx = index([
      { cage: 'AAAAA', company: 'NORTHERN VALVE COMPANY', cao: 'S0302A' },
      { cage: 'BBBBB', company: 'SOUTHERN BEARING WORKS', cao: 'S0302A' },
    ])
    const g = groupByOperator(['AAAAA', 'BBBBB'], idx)
    expect(g.operatorCount).toBe(2)
    expect(g.collapsed).toBe(false)
  })

  it('REFUSES to merge on a matching name alone', () => {
    const idx = index([
      { cage: 'AAAAA', company: 'PRECISION MACHINE INC', cao: 'S0001A' },
      { cage: 'BBBBB', company: 'PRECISION MACHINE INC', cao: 'S9999Z' },
    ])
    const g = groupByOperator(['AAAAA', 'BBBBB'], idx)
    expect(g.operatorCount).toBe(2)
  })

  it('REFUSES a prefix match that is only a shared first word', () => {
    // "PRECISION" is a prefix of "PRECISION AEROSPACE" as a STRING, but the comparison requires
    // a word boundary, so these stay apart even sharing a CAO.
    const idx = index([
      { cage: 'AAAAA', company: 'PRECISION AEROSPACE INC', cao: 'S0001A' },
      { cage: 'BBBBB', company: 'PRECISIONAIR LTD', cao: 'S0001A' },
    ])
    const g = groupByOperator(['AAAAA', 'BBBBB'], idx)
    expect(g.operatorCount).toBe(2)
  })

  it('leaves genuinely distinct codes alone', () => {
    const idx = index([
      { cage: 'AAAAA', company: 'ALPHA WORKS', cao: 'S0001A' },
      { cage: 'BBBBB', company: 'BETA WORKS', cao: 'S0002B' },
      { cage: 'CCCCC', company: 'GAMMA WORKS', cao: 'S0003C' },
    ])
    const g = groupByOperator(['AAAAA', 'BBBBB', 'CCCCC'], idx)
    expect(g.operatorCount).toBe(3)
    expect(g.clusters.every((c) => c.evidence === 'distinct')).toBe(true)
  })
})

describe('groupByOperator abstains rather than guessing', () => {
  it('names an unresolved code instead of dropping it, and counts it on its own', () => {
    const idx = index([{ cage: 'AAAAA', company: 'ALPHA WORKS', cao: 'S0001A' }])
    const g = groupByOperator(['AAAAA', 'ZZZZZ'], idx)
    expect(g.unresolved).toEqual(['ZZZZZ'])
    expect(g.operatorCount).toBe(2)
    expect(g.clusters.find((c) => c.cages.includes('ZZZZZ'))!.evidence).toBe('unresolved')
  })

  it('collapses NOTHING when the index is absent', () => {
    // The failure that matters: an absent index must not silently make everything one operator,
    // and must not silently make every row look competitive either. Counts pass through.
    const g = groupByOperator(['AAAAA', 'BBBBB'], { ok: false, reason: 'no index' })
    expect(g.indexAvailable).toBe(false)
    expect(g.cageCount).toBe(2)
    expect(g.operatorCount).toBe(2)
    expect(g.collapsed).toBe(false)
    expect(g.clusters.every((c) => c.evidence === 'unresolved')).toBe(true)
  })

  it('deduplicates and upper-cases the input without changing the operator count', () => {
    const idx = index([{ cage: 'AAAAA', company: 'ALPHA WORKS', cao: 'S0001A' }])
    const g = groupByOperator(['aaaaa', 'AAAAA', ' AAAAA '], idx)
    expect(g.cageCount).toBe(1)
    expect(g.operatorCount).toBe(1)
  })

  it('a heuristic never overrules a record', () => {
    // Two codes the record places APART, that the name+CAO heuristic would otherwise merge.
    const idx = index(
      [
        { cage: 'AAAAA', company: 'SAME NAME INC', cao: 'S0001A' },
        { cage: 'BBBBB', company: 'SAME NAME INC', cao: 'S0001A' },
      ],
      [
        { cage: 'AAAAA', association: 'AAAAA' },
        { cage: 'BBBBB', association: 'QQQQQ' },
      ],
    )
    const g = groupByOperator(['AAAAA', 'BBBBB'], idx)
    // Each sits in its own recorded association, so both are `confirmed` buckets of one and the
    // heuristic is not permitted to reach across them.
    expect(g.operatorCount).toBe(2)
  })
})

describe('the real derived index on disk', () => {
  const idx = loadCageIndex()

  it('loads, or states exactly why it did not', () => {
    if (!idx.ok) {
      expect(idx.reason.length).toBeGreaterThan(20)
      return
    }
    expect(idx.companies.size).toBeGreaterThan(1000)
    // MEASURED 2026-08-17: 0 of 119,076 H5 rows carry a PARENT_CAGE. Pinned so that the day the
    // government starts populating it, this test tells us instead of a feature quietly improving.
    expect(idx.provenance.parentCagePopulated).toBe(0)
  })

  it('resolves the WKF pair to one operator, which is the case this module exists for', () => {
    if (!idx.ok) return
    const a = lookupCage('3BQS1', idx)
    const b = lookupCage('6KB87', idx)
    if (!a || !b) return // the pair is only present when the feed references it
    expect(a.cao).toBe(b.cao)
    const g = groupByOperator(['3BQS1', '6KB87'], idx)
    expect(g.operatorCount).toBe(1)
    expect(g.clusters[0]!.evidence).toBe('same_operator_suspected')
  })
})
