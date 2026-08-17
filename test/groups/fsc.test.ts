/**
 * FSC ROLLUP TESTS.
 *
 * The point of interest is not that the code runs. It is that the EVIDENCE GRADE is earned.
 * A grader that returns `indicative` for everything would satisfy a test that only checks the
 * enriched class is not called significant, so every grade here is pinned from BOTH directions:
 * a class engineered to be genuinely enriched must come back `significant`, a class engineered
 * to sit exactly on the baseline must come back `indicative`, and the enriched shape must LOSE
 * its grade when the only thing that changes is the sample size.
 *
 * The binomial itself is checked against values computable by hand, not against a second
 * implementation written here, because a re-implementation by the same author reproduces the
 * same mistake and agrees with itself.
 */
import { describe, expect, it } from 'vitest'

import {
  binomialSurvival,
  buildFscRollup,
  loadFscCatalog,
  SAMPLE_FLOOR,
  type FscCatalog,
} from '@/lib/intelligence/groups/fsc'
import type { CornerRow } from '@/lib/intelligence/corner'

function row(nsn: string, opts: { sole?: boolean; silent?: number } = {}): CornerRow {
  return {
    niin: nsn.slice(4),
    nsn,
    nomenclature: 'TEST ITEM',
    quantity: 1,
    unitOfIssue: 'EA',
    solicitation: 'SPE1C126Q0000',
    returnDate: '2026-09-01',
    automatedSolicitation: null,
    approvedSources: [],
    approvedSourceCount: opts.sole ? 1 : 2,
    soleSource: opts.sole ?? false,
    signals: [],
    silentSourceCount: opts.silent ?? 0,
    availability: 'unknown_credential_absent',
    availabilityHolders: null,
    availabilityUnits: null,
    legsEstablished: 0,
    gaps: [],
  }
}

/** n rows in one class, `cand` of them candidate corners. */
function classOf(fsc: string, n: number, cand: number): CornerRow[] {
  return Array.from({ length: n }, (_, i) =>
    row(`${fsc}${String(i).padStart(9, '0')}`, i < cand ? { sole: true, silent: 1 } : {}),
  )
}

const emptyCatalog: FscCatalog = {
  ok: true,
  fsc: new Map(),
  fsg: new Map(),
  provenance: { fscFile: 'x', fsgFile: 'y', fscRows: 0, fsgRows: 0 },
}

describe('binomialSurvival', () => {
  it('matches values computable by hand', () => {
    // P(X >= 1 | n=1, p=0.5) = 0.5
    expect(binomialSurvival(1, 1, 0.5)).toBeCloseTo(0.5, 12)
    // P(X >= 2 | n=2, p=0.5) = 0.25
    expect(binomialSurvival(2, 2, 0.5)).toBeCloseTo(0.25, 12)
    // P(X >= 1 | n=10, p=0.1) = 1 - 0.9^10
    expect(binomialSurvival(1, 10, 0.1)).toBeCloseTo(1 - Math.pow(0.9, 10), 12)
    // P(X >= 3 | n=3, p=0.25) = 0.25^3
    expect(binomialSurvival(3, 3, 0.25)).toBeCloseTo(0.015625, 12)
  })

  it('is bounded and handles the degenerate ends', () => {
    expect(binomialSurvival(0, 50, 0.3)).toBe(1)
    expect(binomialSurvival(51, 50, 0.3)).toBe(0)
    expect(binomialSurvival(5, 1000, 0.5)).toBeLessThanOrEqual(1)
  })

  it('does not overflow at a sample size that breaks a naive factorial', () => {
    // A product-of-coefficients implementation returns NaN here. A NaN p value would silently
    // fail every comparison and grade every class `indicative` forever.
    const p = binomialSurvival(600, 2000, 0.25)
    expect(Number.isFinite(p)).toBe(true)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})

describe('buildFscRollup evidence grading', () => {
  // A map where the baseline is 5%: 950 ordinary rows plus classes below.
  const filler = classOf('9999', 200, 10)

  it('grades a genuinely enriched class `significant`', () => {
    const rows = [...filler, ...classOf('6505', 40, 14)]
    const out = buildFscRollup(rows, emptyCatalog)
    const enriched = out.groups.find((g) => g.fsc === '6505')!
    expect(enriched.candidates).toBe(14)
    expect(enriched.rows).toBe(40)
    expect(enriched.pValue).not.toBeNull()
    expect(enriched.pValue!).toBeLessThan(out.bonferroniAlpha)
    expect(enriched.evidence).toBe('significant')
  })

  it('grades a class sitting on the baseline `indicative`, NOT significant', () => {
    // POSITIVE CONTROL IN THE OTHER DIRECTION. Without this, a grader that returned
    // `significant` for every class with enough rows would pass the test above.
    const rows = [...filler, ...classOf('5330', 40, 2)]
    const out = buildFscRollup(rows, emptyCatalog)
    const flat = out.groups.find((g) => g.fsc === '5330')!
    expect(flat.candidateRate).toBeCloseTo(0.05, 6)
    expect(flat.evidence).toBe('indicative')
  })

  it('withdraws the grade when only the SAMPLE SIZE shrinks', () => {
    // Same rate, fewer rows. The rate alone must never earn `significant`.
    //
    // The lift here is deliberately MODEST (15% against a 5% baseline). An earlier version of
    // this test used a 7x lift and failed, correctly: 7 candidates in 21 rows against a 5%
    // baseline is significant on any honest reading, so it could not demonstrate the property.
    // A test has to sit near the threshold to prove the threshold is doing work.
    const wide = classOf('9999', 1000, 50) // a 5% baseline that the test class cannot move
    const big = buildFscRollup([...wide, ...classOf('6505', 100, 15)], emptyCatalog)
    const small = buildFscRollup([...wide, ...classOf('6505', 20, 3)], emptyCatalog)
    const a = big.groups.find((g) => g.fsc === '6505')!
    const b = small.groups.find((g) => g.fsc === '6505')!
    expect(a.candidateRate).toBeCloseTo(0.15, 6)
    expect(b.candidateRate).toBeCloseTo(0.15, 6)
    expect(a.evidence).toBe('significant')
    expect(b.evidence).toBe('indicative')
  })

  it('claims no rate at all below the sample floor', () => {
    const rows = [...filler, ...classOf('1005', SAMPLE_FLOOR - 1, SAMPLE_FLOOR - 1)]
    const out = buildFscRollup(rows, emptyCatalog)
    const tiny = out.groups.find((g) => g.fsc === '1005')!
    // Every row a candidate: a naive implementation would call this a 100% corner class.
    expect(tiny.candidates).toBe(SAMPLE_FLOOR - 1)
    expect(tiny.candidateRate).toBeNull()
    expect(tiny.lift).toBeNull()
    expect(tiny.pValue).toBeNull()
    expect(tiny.evidence).toBe('insufficient_sample')
  })

  it('tightens the threshold as more classes are tested', () => {
    const one = buildFscRollup([...classOf('1111', 40, 4)], emptyCatalog)
    const many = buildFscRollup(
      [...classOf('1111', 40, 4), ...classOf('2222', 40, 4), ...classOf('3333', 40, 4)],
      emptyCatalog,
    )
    expect(one.tested).toBe(1)
    expect(many.tested).toBe(3)
    expect(many.bonferroniAlpha).toBeLessThan(one.bonferroniAlpha)
  })

  it('orders significant classes ahead of merely indicative ones', () => {
    const rows = [...filler, ...classOf('6505', 40, 14), ...classOf('5330', 400, 20)]
    const out = buildFscRollup(rows, emptyCatalog)
    const sig = out.groups.findIndex((g) => g.evidence === 'significant')
    const ind = out.groups.findIndex((g) => g.evidence === 'indicative')
    expect(sig).toBeGreaterThanOrEqual(0)
    // A bigger class with more candidates must not outrank a graded one on raw size.
    expect(sig).toBeLessThan(ind)
  })
})

describe('buildFscRollup catalogue handling', () => {
  it('states a missing title rather than inventing one', () => {
    const out = buildFscRollup(classOf('7777', 30, 2), emptyCatalog)
    const g = out.groups.find((x) => x.fsc === '7777')!
    expect(g.title).toBeNull()
    expect(g.fsgTitle).toBeNull()
    expect(out.classesMissingFromCatalog).toBe(1)
  })

  it('reports an absent catalogue as a stated reason, and still counts the rows', () => {
    const out = buildFscRollup(classOf('5305', 30, 2), {
      ok: false,
      reason: 'the Federal Supply Class tables are not in this data directory',
    })
    expect(out.catalogAvailable).toBe(false)
    expect(out.catalogReason).toContain('not in this data directory')
    // The counts are real even when the titles are absent. An empty catalogue must not zero them.
    expect(out.totals.rows).toBe(30)
    expect(out.groups[0]!.rows).toBe(30)
    expect(out.classesMissingFromCatalog).toBe(0) // not counted as missing when the table is absent
  })

  it('derives the supply group from the first two digits of the class', () => {
    const out = buildFscRollup([...classOf('5305', 25, 1), ...classOf('5310', 25, 1)], emptyCatalog)
    expect(out.totals.classes).toBe(2)
    expect(out.totals.supplyGroups).toBe(1)
    expect(out.groups.every((g) => g.fsg === '53')).toBe(true)
  })
})

describe('the real H2 catalogue on disk', () => {
  const catalog = loadFscCatalog()

  it('loads, or states exactly why it did not', () => {
    if (!catalog.ok) {
      expect(catalog.reason.length).toBeGreaterThan(20)
      return
    }
    // Measured 2026-08-17 against the July 2026 PUB LOG extract.
    expect(catalog.fsc.size).toBe(676)
    expect(catalog.fsg.size).toBeGreaterThan(50)
  })

  it('carries the government scope prose, not just a title', () => {
    if (!catalog.ok) return
    const guns = catalog.fsc.get('1005')
    expect(guns?.title).toBe('GUNS, THROUGH 30MM')
    expect(guns?.inclusions).toContain('MACHINE GUNS')
    expect(guns?.exclusions).toContain('TURRETS')
  })
})
