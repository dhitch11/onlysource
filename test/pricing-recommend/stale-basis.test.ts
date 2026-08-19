/**
 * TRAP 3: AN OLD AWARD USED AS A CURRENT BASIS WIDENS THE BAND BY ITS AGE, VISIBLY.
 *
 * A 2019 award read as a 2026 basis with no inflation series is the hole the missing series leaves.
 * The rate is not chosen: it is DERIVED from the only measured statement this corpus makes about
 * how uncertain a year of price drift is, which is that the two inflation factors on file, stated
 * by the same expert for the same 2017 base year, disagree. 1.40 against 1.3223 over nine years is
 *
 *     (1.40 / 1.3223) ^ (1/9) - 1  =  0.6365% a year
 *
 * THE ARITHMETIC IN THIS TEST WAS DONE BY HAND FIRST. A 2019-06-01 award priced at 2026-01-29 is
 * 2,434 days old, which is 6.664 years. 6.664 x 0.6365% is 4.2412%. The rule gives 1000.00 x 3 =
 * 3000.00, and the band is 3000 / 1.042412 = 2877.93 low and 3000 x 1.042412 = 3127.24 high. The
 * low FLOORS to the cent and the high CEILINGS, because a rounding must never make a band look
 * tighter than the evidence behind it.
 *
 * POSITIVE CONTROL, run by hand and recorded here: forcing `ageYearsForWidening` to 0 on rung 2
 * turns every assertion in the first test red, because the recommendation collapses to a bare
 * point of 3000.00 with no age anywhere in the output.
 */

import { describe, expect, it } from 'vitest'
import { INDEX_CONFIG_1650 } from '@/lib/engine/pricing'
import { driftHalfWidthPerYear, recommendPrice } from '@/lib/intelligence/pricing/recommend'
import { PRICING_INSTANT_MS, cleanAward, AT_OPERATOR_MULTIPLE } from './_fixtures'

function rowWithBasisDated(awardDateIso: string) {
  return recommendPrice({
    nsn: '1650-01-059-8221',
    approvedSourceCages: [],
    awards: [
      cleanAward({ awardDateIso, unitPriceUsd: 1000, quantity: 6, awardeeCage: 'DLR01' }),
    ],
    requirementQuantity: 6,
    atInstantMs: PRICING_INSTANT_MS,
    config: AT_OPERATOR_MULTIPLE,
  })
}

describe('an old basis award widens the band by its age', () => {
  it('derives the drift rate from the two factors on file rather than choosing one', () => {
    // 0.6365% a year, from 1.40 and 1.3223 over the nine years between the 2017 base year and the
    // 2026 date the expert stated them. Hand computed before the code ran.
    expect(driftHalfWidthPerYear(INDEX_CONFIG_1650)).toBeCloseTo(0.0063646, 7)
  })

  it('widens a 2019 basis to a band, and prints the age that caused it', () => {
    const rec = rowWithBasisDated('2019-06-01')
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.rung).toBe('R2_LAST_AWARD_MULTIPLE')
    expect(rec.recommended.kind).toBe('BAND')
    if (rec.recommended.kind !== 'BAND') throw new Error('unreachable')

    // The rule's own product is still the true product, unrounded and unmoved.
    expect(rec.basisUnitPriceUsd).toBe(3000)
    expect(rec.arithmetic).toBe('1000.00 x 3 = 3000.00')

    // The band, hand computed above.
    expect(rec.recommended.lowUnitPriceUsd).toBe(2877.93)
    expect(rec.recommended.highUnitPriceUsd).toBe(3127.24)
    expect(rec.widthRatio).toBeCloseTo(0.08663, 5)

    const caveat = rec.caveats.find(
      (c) => c.code === 'BASIS_IS_OLD_AND_THE_BAND_WAS_WIDENED_BY_ITS_AGE',
    )
    expect(caveat).toBeDefined()
    expect(caveat?.measured?.unit).toBe('YEARS')
    expect(caveat?.measured?.value).toBeCloseTo(6.664, 3)
    // THE AGE IS IN THE OUTPUT, not only in a field a render might skip.
    expect(caveat?.sentence).toContain('2019-06-01, 6.7 years old')
    expect(caveat?.sentence).toContain('0.64% a year')
    expect(caveat?.sentence).toContain('6.7 x 0.64% = 4.24% each side')
  })

  it('widens MORE for an older award, monotonically in the age', () => {
    const widths = ['2025-06-01', '2022-06-01', '2019-06-01', '2016-06-01'].map((iso) => {
      const rec = rowWithBasisDated(iso)
      if (rec.resolved !== true) throw new Error('expected a recommendation')
      return rec.widthRatio
    })
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i] as number).toBeGreaterThan(widths[i - 1] as number)
    }
  })

  it('a basis dated at the pricing instant is not widened at all, and stays a point', () => {
    const rec = rowWithBasisDated('2026-01-29')
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.recommended.kind).toBe('POINT')
    if (rec.recommended.kind !== 'POINT') throw new Error('unreachable')
    expect(rec.recommended.unitPriceUsd).toBe(3000)
    expect(rec.widthRatio).toBe(0)
    expect(
      rec.caveats.find((c) => c.code === 'BASIS_IS_OLD_AND_THE_BAND_WAS_WIDENED_BY_ITS_AGE'),
    ).toBeUndefined()
  })

  it('the widening is outward on both endpoints, so the true product stays inside the band', () => {
    const rec = rowWithBasisDated('2019-06-01')
    if (rec.resolved !== true || rec.recommended.kind !== 'BAND') throw new Error('unreachable')
    expect(rec.recommended.lowUnitPriceUsd).toBeLessThan(3000)
    expect(rec.recommended.highUnitPriceUsd).toBeGreaterThan(3000)
  })
})
