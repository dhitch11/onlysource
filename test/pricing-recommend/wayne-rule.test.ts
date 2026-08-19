/**
 * RUNG 2, THE OPERATOR'S OWN RULE, ASSERTED ON HIS OWN RECORDED NUMBERS.
 *
 * He wrote: "I quoted $3,565, three times the unit price of the previous award." That sentence is
 * a RULE WITH ONE INPUT, and it was recorded as an anecdote for months only because the old
 * doctrine gave a recommendation nowhere to live.
 *
 * ★ WHAT CHANGED ON 2026-08-19, AND WHY THIS FILE DID NOT GET DELETED. His rule stopped being the
 * product default, because it was measured across the whole award history and it does not
 * generalise: at 3x a quote came in at or below the price the item actually cleared at 1.50% of the
 * time, and that is an UPPER bound on winning. Two things are true at once, and this file holds
 * both. THE RULE IS STILL HIS AND IT STILL WORKS EXACTLY AS HE STATED IT when he chooses it, which
 * is what most of this file asserts. It is also no longer inherited by rows that never asked for
 * it, and it now travels with its measured record wherever it is offered, which is what the two
 * assertions near the end add. Deleting his rule from the suite would have been the wrong repair:
 * a customer's own rule that a product refuses to compute is a control that does not work.
 *
 * ⛔ BD-17 IS THE POINT OF THIS FILE. 1188.33 x 3 is 3564.99 EXACTLY. His "$3,565" is HIS ROUNDING
 * of that product, and a test asserting 3565.00 as the computed value would pass against wrong
 * arithmetic, which is worse than no test. So the product is asserted at 3564.99, and his figure
 * is reconciled against it separately, exactly as `reconcileStatedApproximation` does for the two
 * anchor lines.
 *
 * 1188.33 itself is IMPLIED by his sentence (3565 / 3) and printed nowhere in the corpus. It is
 * used here as a fixture INPUT to prove the rule's arithmetic. No production path reads it.
 *
 * POSITIVE CONTROLS ON THE TWO NEW ASSERTIONS, performed and recorded:
 *   1. `DEFAULT_AWARD_MULTIPLE = OPERATOR_AWARD_MULTIPLE`
 *        -> "IS NO LONGER THE DEFAULT, and is chosen rather than inherited" RED.
 *   2. his preset's `record` replaced with the bare label, keeping its value
 *        -> "IS STILL OFFERED, and it carries its measured record wherever it is offered" RED.
 * Both were restored from a byte snapshot and re-run green; see `.probe/positive-controls.py`.
 */

import { describe, expect, it } from 'vitest'
import {
  AWARD_MULTIPLE_PRESETS,
  DEFAULT_AWARD_MULTIPLE,
  OPERATOR_AWARD_MULTIPLE,
  RECOMMENDATION_CONFIG,
  presetForMultiple,
  recommendPrice,
  type RecommendationConfig,
} from '@/lib/intelligence/pricing/recommend'
import { PRICING_INSTANT_MS, cleanAward, AT_OPERATOR_MULTIPLE } from './_fixtures'

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
    config: AT_OPERATOR_MULTIPLE,
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

  it('IS NO LONGER THE DEFAULT, and is chosen rather than inherited', () => {
    /*
     * ★ THE POINT OF THIS ASSERTION. His rule won him a buy and it is real, and it was measured
     * against the whole award history and it does not generalise. Both facts are true at once, so
     * the rule stays and stops being the number the product puts on a row by itself.
     *
     * This does NOT assert what the default IS. That belongs in one file, `default-multiple.test.ts`,
     * so a future ruling moves one number rather than twenty scattered through the suite. What it
     * asserts is the property that must hold whichever point inside the measured band is ruled for:
     * the 3x is not it, and every row in this file had to ASK for it.
     */
    expect(DEFAULT_AWARD_MULTIPLE).not.toBe(OPERATOR_AWARD_MULTIPLE)
    expect(RECOMMENDATION_CONFIG.awardMultiple).not.toBe(OPERATOR_AWARD_MULTIPLE)

    // And the engine really does use the default when nobody asks for his rule.
    const unasked = recommendPrice({
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
    })
    if (unasked.resolved !== true) throw new Error('unreachable')
    if (unasked.recommended.kind !== 'POINT') throw new Error('unreachable')
    expect(unasked.recommended.unitPriceUsd).not.toBe(THE_TRUE_PRODUCT)
    expect(unasked.awardMultiple).toBe(DEFAULT_AWARD_MULTIPLE)
  })

  it('IS STILL OFFERED, and it carries its measured record wherever it is offered', () => {
    /*
     * A preset without its record is exactly how the 3x became a headline in the first place: a
     * number in a control, with the one thing anybody would want to know about it living in a
     * comment. So the record is a FIELD on the preset and there is no way to render the value
     * while dropping the sentence.
     */
    const preset = presetForMultiple(OPERATOR_AWARD_MULTIPLE)
    expect(preset).not.toBeNull()
    expect(preset?.id).toBe('OPERATOR_STATED_RULE')
    expect(AWARD_MULTIPLE_PRESETS).toContain(preset)

    // His own sentence, kept in his own words.
    expect(preset?.record).toContain('I quoted $3,565')
    // Its measured outcome, stated as an upper bound and never as a win rate.
    expect(preset?.record).toContain('upper bound')
    expect(preset?.record).toContain('1.50%')
    // And the mitigation anyone would reach for next, measured and refuted before it could ship.
    expect(preset?.record).toContain('sole-source')
    expect(preset?.record).toContain('0.00%')

    // It is graded as what it is: a stated judgement, not a measured series.
    expect(preset?.provenance).toBe('PRIOR')
  })

  it('never empties wouldSharpenWith, and names rung 1 as the way up', () => {
    const rec = hisRow()
    if (rec.resolved !== true) throw new Error('unreachable')
    expect(rec.wouldSharpenWith.length).toBeGreaterThan(0)
    expect(rec.wouldSharpenWith.join(' ')).toContain('rung 1')
  })
})
