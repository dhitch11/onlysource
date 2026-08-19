/**
 * RUNG 2, THE OPERATOR'S OWN RULE, ASSERTED ON HIS OWN RECORDED NUMBERS.
 *
 * He wrote: "I quoted $3,565, three times the unit price of the previous award." That sentence is
 * a RULE WITH ONE INPUT, and it was recorded as an anecdote for months only because the old
 * doctrine gave a recommendation nowhere to live. It reaches 1,132 of 5,366 served rows against
 * the inflation anchor's 49.
 *
 * ⛔ BD-17 IS THE POINT OF THIS FILE. 1188.33 x 3 is 3564.99 EXACTLY. His "$3,565" is HIS ROUNDING
 * of that product, and a test asserting 3565.00 as the computed value would pass against wrong
 * arithmetic, which is worse than no test. So the product is asserted at 3564.99, and his figure
 * is reconciled against it separately, exactly as `reconcileStatedApproximation` does for the two
 * anchor lines.
 *
 * 1188.33 itself is IMPLIED by his sentence (3565 / 3) and printed nowhere in the corpus. It is
 * used here as a fixture INPUT to prove the rule's arithmetic. No production path reads it.
 */

import { describe, expect, it } from 'vitest'
import {
  RECOMMENDATION_CONFIG,
  recommendPrice,
  type RecommendationConfig,
} from '@/lib/intelligence/pricing/recommend'
import { PRICING_INSTANT_MS, cleanAward } from './_fixtures'

/** The previous award unit price implied by his own sentence. Fixture input, never corpus output. */
const IMPLIED_PREVIOUS_AWARD_UNIT_PRICE = 1188.33
const HIS_WRITTEN_FIGURE = 3565
const THE_TRUE_PRODUCT = 3564.99

/**
 * One award, dated at the pricing instant so the age widening is zero, and no approved-source list
 * so the anchor cannot fire and cannot floor this rung's width. That leaves his rule alone on the
 * row, which is the shape the assertion is about.
 */
function hisRow(config?: RecommendationConfig) {
  return recommendPrice({
    nsn: '1650-01-059-8221',
    awards: [
      cleanAward({
        awardDateIso: '2026-01-29',
        unitPriceUsd: IMPLIED_PREVIOUS_AWARD_UNIT_PRICE,
        quantity: 3,
        awardeeCage: 'DLR01',
      }),
    ],
    approvedSourceCages: [],
    requirementQuantity: 3,
    atInstantMs: PRICING_INSTANT_MS,
    ...(config ? { config } : {}),
  })
}

describe("rung 2: three times the last award price, the operator's own rule", () => {
  it('lands on rung 2 and names the rule in his language', () => {
    const rec = hisRow()
    expect(rec.resolved).toBe(true)
    if (rec.resolved !== true) throw new Error('unreachable')
    expect(rec.rung).toBe('R2_LAST_AWARD_MULTIPLE')
    expect(rec.rungLabel).toBe('three times the last award price, the rule you gave us')
  })

  it('computes the TRUE product, 1188.33 x 3 = 3564.99, and not his rounding of it', () => {
    const rec = hisRow()
    if (rec.resolved !== true) throw new Error('unreachable')
    expect(rec.recommended.kind).toBe('POINT')
    if (rec.recommended.kind !== 'POINT') throw new Error('unreachable')

    expect(rec.recommended.unitPriceUsd).toBe(THE_TRUE_PRODUCT)
    expect(rec.basisUnitPriceUsd).toBe(THE_TRUE_PRODUCT)
    // Stated as its own assertion so the failure message names the doctrine, not just a number.
    expect(rec.recommended.unitPriceUsd).not.toBe(HIS_WRITTEN_FIGURE)
    expect(rec.arithmetic).toBe('1188.33 x 3 = 3564.99')
  })

  it('reconciles his written $3,565 against the product rather than asserting it', () => {
    // His figure is the product rounded to the nearest dollar. That is a fact ABOUT HIM, and it is
    // checked here, in a separate assertion, at a separate name.
    expect(Math.round(THE_TRUE_PRODUCT)).toBe(HIS_WRITTEN_FIGURE)
    expect(HIS_WRITTEN_FIGURE - THE_TRUE_PRODUCT).toBeCloseTo(0.01, 10)
  })

  it('shows the previous award and its date beside the figure, with the multiplier visible', () => {
    const rec = hisRow()
    if (rec.resolved !== true) throw new Error('unreachable')
    const priceInput = rec.inputs.find((i) => i.label === 'Last award unit price')
    expect(priceInput?.valueUsd).toBe(IMPLIED_PREVIOUS_AWARD_UNIT_PRICE)
    expect(priceInput?.dateIso).toBe('2026-01-29')
    expect(priceInput?.evidenceState).toBe('MEASURED')

    const multiplier = rec.inputs.find((i) => i.label === 'Multiplier')
    expect(multiplier?.renderedValue).toBe('3x')
    // It is HIS judgement, not a measured series, and it is graded that way wherever it appears.
    expect(multiplier?.evidenceState).toBe('PRIOR')
    expect(multiplier?.source).toContain('three times the unit price of the previous')
  })

  it('is ADJUSTABLE: changing the multiplier moves the figure deterministically', () => {
    const rec = hisRow({ ...RECOMMENDATION_CONFIG, awardMultiple: 2 })
    if (rec.resolved !== true) throw new Error('unreachable')
    if (rec.recommended.kind !== 'POINT') throw new Error('unreachable')
    // 1188.33 x 2 = 2376.66 exactly. Asserted as the true product, same rule as above.
    expect(rec.recommended.unitPriceUsd).toBe(2376.66)
    expect(rec.arithmetic).toBe('1188.33 x 2 = 2376.66')
  })

  it('never empties wouldSharpenWith, and names rung 1 as the way up', () => {
    const rec = hisRow()
    if (rec.resolved !== true) throw new Error('unreachable')
    expect(rec.wouldSharpenWith.length).toBeGreaterThan(0)
    expect(rec.wouldSharpenWith.join(' ')).toContain('rung 1')
  })
})
