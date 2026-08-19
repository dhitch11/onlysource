/**
 * "never" IS A CENSUS CLAIM. IT MUST NOT BE ANSWERED WITH A MEDIAN.
 *
 * `upperBoundOnWinning` is the MEDIAN across stock numbers of the share of that item's pairs
 * which cleared at a multiple. A median of exactly 0 means fewer than half the stock numbers ever
 * cleared there. It does not mean none did — and the interface was printing "never" on it, plus
 * "nothing above it was ever observed clearing at all" under a ceiling derived from the same test.
 *
 * Measured on the live award index: at 2x the median is 0 while 662 of 2,019 stock numbers were
 * observed clearing, and at 3x it is 0 while 363 were. The claim was false for every one of them,
 * on 4,646 of 4,800 corner dossiers.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildNsnAwardIndex, resetNsnAwardIndexCache } from '../../lib/intelligence/awards/nsn-now'
import { buildPerNsnClearing, clearingCurve } from '../../lib/intelligence/pricing/clearing-curve'

const haveExport = existsSync(join(process.cwd(), 'data', 'nsn-now', 'full_1.xlsx'))

describe.skipIf(!haveExport)('the clearing curve, on the real index', () => {
  let curve!: Extract<ReturnType<typeof clearingCurve>, { available: true }>

  beforeAll(() => {
    resetNsnAwardIndexCache()
    const ix = buildNsnAwardIndex()
    if (!ix.ok) throw new Error(`index did not load: ${ix.reason}`)
    const built = clearingCurve(buildPerNsnClearing(ix.byNsn), null) // market-wide
    if (!built.available) throw new Error('curve unavailable on the real index')
    curve = built
  }, 120_000)

  it('★ carries a CENSUS beside the median, with a denominator', () => {
    for (const p of curve.points) {
      expect(p.stockNumbersInPool).toBe(curve.stockNumberCount)
      expect(p.stockNumbersObservedClearing).toBeGreaterThanOrEqual(0)
      expect(p.stockNumbersObservedClearing).toBeLessThanOrEqual(p.stockNumbersInPool)
    }
  })

  it('★★ THE DEFECT: at least one multiple has a ZERO MEDIAN and a NON-ZERO CENSUS', () => {
    // This is the exact shape that produced "never" over hundreds of real stock numbers. If this
    // assertion ever fails the fixture changed; it must not be "fixed" by loosening it.
    const zeroMedianButCleared = curve.points.filter(
      (p) => p.upperBoundOnWinning === 0 && p.stockNumbersObservedClearing > 0,
    )
    expect(zeroMedianButCleared.length).toBeGreaterThan(0)
    // and the population involved is substantial, not a rounding artifact
    const worst = Math.max(...zeroMedianButCleared.map((p) => p.stockNumbersObservedClearing))
    expect(worst).toBeGreaterThan(100)
  })

  it('★ the ceiling is the highest multiple ANYTHING cleared at, not where the median dies', () => {
    if (curve.ceilingMultiple === null) return
    const above = curve.points.filter((p) => p.multiple > curve.ceilingMultiple!)
    // The rendered sentence says nothing above the ceiling was observed clearing. Hold it to that.
    for (const p of above) expect(p.stockNumbersObservedClearing).toBe(0)

    // And the ceiling itself must be a multiple something actually cleared at.
    const at = curve.points.find((p) => p.multiple === curve.ceilingMultiple)
    expect(at?.stockNumbersObservedClearing).toBeGreaterThan(0)
  })

  it('★★ a median-derived ceiling would have been LOWER, and would have lied about real rows', () => {
    // Reconstruct the old rule and show it disagrees, so the regression is documented rather than
    // merely fixed. If both agree the test is not exercising anything.
    const byMedian = curve.points.filter((p) => p.upperBoundOnWinning > 0)
    const oldCeiling = byMedian.length > 0 ? byMedian[byMedian.length - 1]!.multiple : null
    expect(oldCeiling).not.toBe(curve.ceilingMultiple)

    const wronglyExcluded = curve.points.filter(
      (p) => oldCeiling !== null && p.multiple > oldCeiling && p.stockNumbersObservedClearing > 0,
    )
    expect(wronglyExcluded.length).toBeGreaterThan(0)
  })
})
