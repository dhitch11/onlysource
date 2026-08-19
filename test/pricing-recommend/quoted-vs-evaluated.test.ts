/**
 * ⛔ BD-18. THE RECOMMENDATION IS A QUOTED NUMBER.
 *
 * The $200 (unused former Government surplus) and $600 (ESA coordination) figures are DLA'S
 * EVALUATION FACTORS. The government adds them to OUR total when it compares us against
 * competitors. They are NOT part of the quote we send and NOT a cost we pay.
 *
 * THE FAILURE THIS FILE EXISTS TO STOP IS SPECIFIC AND EXPENSIVE: the operator reads a figure off
 * this product, types it into DIBBS, and it is up to $800 too high because an evaluation factor
 * was folded in. They lose an award they had won, and every number on the screen looked right.
 *
 * THREE INDEPENDENT CONTROLS, because a comment is not a control:
 *   1. A TYPE-LEVEL one. `quotedTotal` and the evaluated figure are OBJECTS, not numbers, so
 *      `a + b` does not compile. The `@ts-expect-error` below is the assertion, and it is checked
 *      by `tsc --noEmit` rather than by the runner: if the two ever became summable, TypeScript
 *      would report the directive as unused and the typecheck would fail.
 *   2. A VALUE one. The quoted total is asserted to equal unit price times quantity exactly, and
 *      asserted NOT to equal that plus the adders.
 *   3. A RUNTIME one. `assertRecommendationCarriesNoEvaluationFactor` RECOMPUTES the quoted total
 *      from the recommended unit price and the quantity, and refuses any drift. It recomputes on
 *      purpose: the first version of that guard derived its forbidden value as `quotedTotal +
 *      adders`, which cannot catch this defect at all, because once the quoted total has already
 *      become the evaluated one, quoted + adders is a different number again and the check passes
 *      on the corrupted payload. The last two tests prove it fires now.
 */

import { describe, expect, it } from 'vitest'
import {
  assertRecommendationCarriesNoEvaluationFactor,
  recommendPrice,
  type PriceRecommendation,
} from '@/lib/intelligence/pricing/recommend'
import { DECLARED_OFFER, PRICING_INSTANT_MS, cleanAward } from './_fixtures'

/** One fresh award, so the rung is a POINT and the totals are single numbers a person can check. */
function pointRow(declared: boolean) {
  return recommendPrice({
    nsn: '1650-01-059-8221',
    approvedSourceCages: [],
    awards: [
      cleanAward({
        awardDateIso: '2026-01-29',
        unitPriceUsd: 500,
        quantity: 4,
        awardeeCage: 'DLR01',
      }),
    ],
    requirementQuantity: 4,
    atInstantMs: PRICING_INSTANT_MS,
    ...(declared ? { declarations: DECLARED_OFFER } : {}),
  })
}

describe('the recommendation is a quoted number and the adders are the buyer’s arithmetic', () => {
  it('the quoted total is unit price times quantity, and nothing else', () => {
    const rec = pointRow(true)
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    if (rec.recommended.kind !== 'POINT') throw new Error('expected a point')
    // 500.00 x 3 = 1500.00 a unit, on a requirement of 4 units, is 6000.00 quoted.
    expect(rec.recommended.unitPriceUsd).toBe(1500)
    expect(rec.quotedTotal).toEqual({ kind: 'QUOTED_TOTAL_WHAT_WE_SEND', usd: 6000 })
  })

  it('the evaluation factors are carried SEPARATELY and add to 800', () => {
    const rec = pointRow(true)
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    const ctx = rec.evaluatedPriceContext
    expect(ctx.available).toBe(true)
    if (ctx.available !== true) throw new Error('unreachable')
    expect(ctx.adderTotalUsd).toBe(800)
    expect(ctx.adders.map((a) => a.code).sort()).toEqual([
      'ESA_COORDINATION',
      'UNUSED_FORMER_GOVERNMENT_SURPLUS',
    ])
    // Every adder carries the primary text it came from. None is a constant typed here.
    for (const adder of ctx.adders) expect(adder.citation.grade).toBe('PRIMARY_TEXT')

    // The buyer's comparison figure is 6800.00. OURS is still 6000.00.
    expect(ctx.evaluatedAtRecommendation).toEqual({
      kind: 'EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND',
      usd: 6800,
    })
    expect(rec.quotedTotal).toEqual({ kind: 'QUOTED_TOTAL_WHAT_WE_SEND', usd: 6000 })
  })

  it('THE TYPE-LEVEL CONTROL: the two figures cannot be added', () => {
    const rec = pointRow(true)
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    const ctx = rec.evaluatedPriceContext
    if (ctx.available !== true) throw new Error('unreachable')
    const quoted = rec.quotedTotal
    if (quoted === null || quoted.kind !== 'QUOTED_TOTAL_WHAT_WE_SEND') {
      throw new Error('expected a scalar quoted total')
    }
    const evaluated = ctx.evaluatedAtRecommendation
    if (evaluated.kind !== 'EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND') {
      throw new Error('expected a scalar evaluated total')
    }
    /*
     * If this ever compiles, the typecheck fails on an unused directive, which is the alarm. The
     * runtime value is deliberately unused: the assertion here IS the compile error.
     */
    // @ts-expect-error BD-18: a quoted total and an evaluated total are different types of money.
    const illegal = quoted + evaluated
    void illegal
  })

  it('the unit price itself never carries a per unit share of the adders', () => {
    const rec = pointRow(true)
    if (rec.resolved !== true || rec.recommended.kind !== 'POINT') throw new Error('unreachable')
    // 800 over 4 units would be 200.00 a unit. The two shapes the failure takes:
    expect(rec.recommended.unitPriceUsd).not.toBe(1700)
    expect(rec.recommended.unitPriceUsd).not.toBe(2300)
  })

  it('the runtime guard passes on a correct recommendation', () => {
    expect(() => assertRecommendationCarriesNoEvaluationFactor(pointRow(true))).not.toThrow()
  })

  it('THE RUNTIME GUARD FIRES on a recommendation whose quote carries the adders', () => {
    const rec = pointRow(true)
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    // The exact defect: the quoted total silently becomes the evaluated one. This is the shape a
    // future edit would produce by reaching for the wrong field, and it looks entirely normal.
    const doctored = {
      ...rec,
      quotedTotal: { kind: 'QUOTED_TOTAL_WHAT_WE_SEND' as const, usd: 6800 },
    } as PriceRecommendation
    expect(() => assertRecommendationCarriesNoEvaluationFactor(doctored)).toThrow(
      /6800.*plus the 800 of evaluation factors/s,
    )
  })

  it('THE RUNTIME GUARD FIRES on any drift between the unit price and the quoted total', () => {
    const rec = pointRow(true)
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    // Not the adders, just a total that no longer follows from the figure above it. The guard is a
    // consistency check first and a BD-18 check second, so it catches this too.
    const doctored = {
      ...rec,
      quotedTotal: { kind: 'QUOTED_TOTAL_WHAT_WE_SEND' as const, usd: 6001 },
    } as PriceRecommendation
    expect(() => assertRecommendationCarriesNoEvaluationFactor(doctored)).toThrow(
      /drifted apart/s,
    )
  })

  it('with the declarations missing, the evaluated context abstains BY NAME and prices nothing', () => {
    const rec = pointRow(false)
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    const ctx = rec.evaluatedPriceContext
    expect(ctx.available).toBe(false)
    if (ctx.available !== false) throw new Error('unreachable')
    expect(ctx.reason).toBe('SURPLUS_OFFER_STATUS_UNDECLARED')
    expect(ctx.missingInput).toContain('$200 evaluation factor')
    // The QUOTE is unaffected: what we send never depended on the buyer's arithmetic.
    expect(rec.quotedTotal).toEqual({ kind: 'QUOTED_TOTAL_WHAT_WE_SEND', usd: 6000 })
    expect(() => assertRecommendationCarriesNoEvaluationFactor(rec)).not.toThrow()
  })

  it('a BAND recommendation quotes a RANGE, and the evaluated range is a different type', () => {
    const rec = recommendPrice({
      nsn: '1650-01-059-8221',
      approvedSourceCages: [],
      awards: [
        cleanAward({ awardDateIso: '2024-01-15', unitPriceUsd: 400, quantity: 4, awardeeCage: 'DLR01' }),
        cleanAward({ awardDateIso: '2025-06-02', unitPriceUsd: 600, quantity: 4, awardeeCage: 'DLR02' }),
      ],
      requirementQuantity: 4,
      atInstantMs: PRICING_INSTANT_MS,
      declarations: DECLARED_OFFER,
    })
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.recommended.kind).toBe('BAND')
    expect(rec.quotedTotal?.kind).toBe('QUOTED_TOTAL_RANGE_WHAT_WE_SEND')
    const ctx = rec.evaluatedPriceContext
    if (ctx.available !== true) throw new Error('unreachable')
    expect(ctx.evaluatedAtRecommendation.kind).toBe(
      'EVALUATED_TOTAL_RANGE_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND',
    )
    const quoted = rec.quotedTotal
    if (quoted?.kind !== 'QUOTED_TOTAL_RANGE_WHAT_WE_SEND') throw new Error('unreachable')
    const evaluated = ctx.evaluatedAtRecommendation
    if (evaluated.kind !== 'EVALUATED_TOTAL_RANGE_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND') {
      throw new Error('unreachable')
    }
    // The buyer's figure is exactly ours plus 800 at each endpoint, and the two never merge.
    expect(evaluated.lowUsd - quoted.lowUsd).toBeCloseTo(800, 6)
    expect(evaluated.highUsd - quoted.highUsd).toBeCloseTo(800, 6)
    expect(() => assertRecommendationCarriesNoEvaluationFactor(rec)).not.toThrow()
  })

  it('the sentence an operator reads says which kind of number this is', () => {
    const rec = pointRow(true)
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.sentence).toContain('This is a QUOTED unit price')
    const ctx = rec.evaluatedPriceContext
    if (ctx.available !== true) throw new Error('unreachable')
    expect(ctx.note).toContain('not part of the price we send')
  })
})
