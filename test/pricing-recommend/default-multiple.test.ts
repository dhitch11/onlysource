/**
 * WHAT THE PRODUCT DEFAULT IS, AND WHY IT IS NOT WHAT THE OPTIMISER SAID.
 *
 * This file exists because twenty assertions across seven files went red when the default moved
 * from 3 to 1, and NONE of them were about the default. They were about quantity normalisation,
 * band monotonicity, the peer floor and surplus exclusion, and they had each baked the multiple of
 * the day into their expected arithmetic. Those files now pin a multiple explicitly. THIS file is
 * the only place that asserts what the default IS, so a future ruling changes one file rather than
 * twenty numbers scattered through the suite.
 *
 * THE RULING, 2026-08-19: the default multiple is 1. The operator's 3x is retained as a first
 * class preset, it computes exactly what his sentence says when it is chosen, and it carries its
 * measured record wherever it is offered.
 *
 * POSITIVE CONTROLS, run by hand and recorded here. Each one was performed, the named test was
 * watched going red, and the engine was restored:
 *   1. `RECOMMENDATION_CONFIG.awardMultiple = OPERATOR_AWARD_MULTIPLE` -> "the default is one" RED.
 *   2. `rungLabelFor` returning `RUNG_LABELS[rung]` unconditionally -> "the label states the
 *      multiple actually in force" RED at both 1x and 3x. This is the control that matters most:
 *      that function was ANNOUNCED IN A COMMENT before it existed, and every label was being read
 *      from the static map while the comment said otherwise.
 *   3. `describeAwardMultiple` returning the old hardcoded 3x sentence -> "the description is true
 *      of the multiple in force" RED.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AWARD_MULTIPLE,
  OPERATOR_AWARD_MULTIPLE,
  RECOMMENDATION_CONFIG,
  describeAwardMultiple,
  recommendPrice,
  rungLabelFor,
} from '@/lib/intelligence/pricing/recommend'
import { AT_OPERATOR_MULTIPLE, PRICING_INSTANT_MS, fullLadderInput } from './_fixtures'

describe('the product default multiple', () => {
  it('is one, and one is the number the engine actually uses', () => {
    expect(DEFAULT_AWARD_MULTIPLE).toBe(1)
    expect(RECOMMENDATION_CONFIG.awardMultiple).toBe(1)
  })

  it('carries the last award price across unchanged rather than multiplying it', () => {
    const rec = recommendPrice({ ...fullLadderInput({ approvedSourceCages: [] }), config: RECOMMENDATION_CONFIG })
    expect(rec.resolved).toBe(true)
    if (!rec.resolved) return
    expect(rec.rung).toBe('R2_LAST_AWARD_MULTIPLE')
    // 1450.00 is the most recent clean award. At 1x the basis IS that price, not a multiple of it.
    expect(rec.basisUnitPriceUsd).toBe(1450)
  })

  it("still computes the operator's own rule exactly when his preset is chosen", () => {
    const rec = recommendPrice({ ...fullLadderInput({ approvedSourceCages: [] }), config: AT_OPERATOR_MULTIPLE })
    expect(rec.resolved).toBe(true)
    if (!rec.resolved) return
    expect(rec.basisUnitPriceUsd).toBe(1450 * OPERATOR_AWARD_MULTIPLE)
    expect(rec.arithmetic).toBe('1450.00 x 3 = 4350.00')
  })
})

describe('every label that names a number is computed from that number', () => {
  it('states the multiple actually in force, at 1x and at 3x', () => {
    const atOne = rungLabelFor('R2_LAST_AWARD_MULTIPLE', RECOMMENDATION_CONFIG)
    const atThree = rungLabelFor('R2_LAST_AWARD_MULTIPLE', AT_OPERATOR_MULTIPLE)
    expect(atOne).not.toBe(atThree)
    expect(atOne).toContain('carried across unchanged')
    // At 1x nothing is multiplied, so the label must not claim a multiplication of any size.
    expect(atOne).not.toMatch(/times/)
    expect(atThree).toContain('three times the last award price')
  })

  it('does not claim a multiplication on the rungs that are not multiplying', () => {
    for (const rung of ['R1_MANUFACTURER_ANCHOR', 'R5_FSC_PEER_BAND'] as const) {
      expect(rungLabelFor(rung, RECOMMENDATION_CONFIG)).toBe(
        rungLabelFor(rung, AT_OPERATOR_MULTIPLE),
      )
    }
  })

  it('describes the multiple in force, and the description differs between them', () => {
    const one = describeAwardMultiple(RECOMMENDATION_CONFIG)
    const three = describeAwardMultiple(AT_OPERATOR_MULTIPLE)
    expect(one).not.toBe(three)
    // The 1x sentence must NOT claim to be an optimum: it is a central estimate and the step to a
    // bid needs a cost this product does not hold.
    expect(one).toMatch(/estimator|estimate/)
    expect(one).toContain('does not hold')
    // The 3x sentence must carry its measured record wherever it is offered.
    expect(three).toContain('0.00%')
    expect(three).toContain('1.45')
  })

  it('honours an explicitly stated source instead of inventing one over the top of it', () => {
    const stated = describeAwardMultiple({
      ...RECOMMENDATION_CONFIG,
      awardMultipleSource: 'Because the buyer told me so on the phone.',
    })
    expect(stated).toBe('Because the buyer told me so on the phone.')
  })
})

describe('the optimiser result is retained as a measurement and never as a default', () => {
  it('does not ship the margin peak as the multiple', async () => {
    const mod = await import('@/lib/intelligence/pricing/recommend')
    // 0.98 is the margin-EV peak under an ASSUMED cost of 0.80x the previous award price, and this
    // product holds no cost of goods. It is kept as a measurement and must never be the default.
    expect(mod.MEASURED_AWARD_MULTIPLE).toBe(0.98)
    expect(RECOMMENDATION_CONFIG.awardMultiple).not.toBe(mod.MEASURED_AWARD_MULTIPLE)
  })

  it('never defaults below one, because winning below cost is a loss and cost is unknown here', () => {
    expect(RECOMMENDATION_CONFIG.awardMultiple).toBeGreaterThanOrEqual(1)
  })
})

/** Unused import guard: PRICING_INSTANT_MS is re-exported by the fixture module and used above. */
void PRICING_INSTANT_MS
