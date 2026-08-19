/**
 * TRAP 1: NEVER COMPARE A UNIT PRICE ACROSS ORDER QUANTITIES WITHOUT NORMALISING.
 *
 * Quantity is known on 100% of served rows, so there is no excuse for this one. Two failures are
 * possible and they point in opposite directions, so both are constructed here with answers known
 * before the code ran:
 *
 *   AN EXTENDED TOTAL IN A UNIT SLOT. A 100 unit award whose Final Price is 8,000 is 80.00 a unit.
 *   Reading 8,000 as the unit price would multiply the recommendation by a hundred.
 *
 *   A DIVISION THAT FABRICATES A UNIT PRICE. The live shape from NSN 5905-01-413-6345: the Unit
 *   Price column states 94.26 while the Final Price of 94.26 over a quantity of 25 divides to
 *   3.77, a figure 25 times too low, and it was shipping graded MEASURED. Which column is right is
 *   not decidable from the row, so the row is REFUSED rather than resolved.
 *
 * And when a comparable's order size is an order of magnitude away from this requirement's, the
 * crossing is NAMED with both quantities. It is deliberately not quantified: nothing in this
 * corpus measures what an order size does to a price, and a made up elasticity would be exactly
 * the estimate dressed as a measurement this product refuses.
 *
 * POSITIVE CONTROL, run by hand and recorded here: deleting the extended-total check in
 * `readUnitPrice` turns the third test red, because the contradicting row is then accepted at 3.77
 * a unit and the recommendation collapses from 600.00 to 11.31.
 */

import { describe, expect, it } from 'vitest'
import { recommendPrice } from '@/lib/intelligence/pricing/recommend'
import { PRICING_INSTANT_MS, contradictingAward } from './_fixtures'

/** 100 units at 80.00, stated and extended both correct. The answer is 80.00 a unit. */
const HUNDRED_UNIT_AWARD = {
  awardDateIso: '2024-06-01',
  effectiveUnitPriceUsd: 80,
  statedUnitPriceUsd: 80,
  extendedPriceUsd: 8000,
  quantity: 100,
  awardeeCage: 'DLR01',
  awardeeCompany: 'DLR01 (FIXTURE)',
  surplusAsWorded: null,
  contractNo: 'FIXTURE-QTY-100',
} as const

/** 2 units at 200.00. The answer is 200.00 a unit, and it is the most recent award. */
const TWO_UNIT_AWARD = {
  awardDateIso: '2026-01-29',
  effectiveUnitPriceUsd: 200,
  statedUnitPriceUsd: 200,
  extendedPriceUsd: 400,
  quantity: 2,
  awardeeCage: 'DLR02',
  awardeeCompany: 'DLR02 (FIXTURE)',
  surplusAsWorded: null,
  contractNo: 'FIXTURE-QTY-2',
} as const

describe('quantity normalisation', () => {
  it('multiplies the PER UNIT price, never the extended total', () => {
    const rec = recommendPrice({
      nsn: '5310-00-111-2222',
      approvedSourceCages: [],
      awards: [HUNDRED_UNIT_AWARD, TWO_UNIT_AWARD],
      requirementQuantity: 2,
      atInstantMs: PRICING_INSTANT_MS,
    })
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.rung).toBe('R2_LAST_AWARD_MULTIPLE')
    // 200.00 a unit x 3 = 600.00. Known by construction before the code ran.
    expect(rec.basisUnitPriceUsd).toBe(600)
    // The two figures a normalisation failure would have produced.
    expect(rec.basisUnitPriceUsd).not.toBe(1200) // the 400.00 extended total x 3
    expect(rec.basisUnitPriceUsd).not.toBe(24000) // the 8,000.00 extended total x 3
  })

  it('bands the per unit prices, so a 100 unit award and a 2 unit award are comparable', () => {
    const rec = recommendPrice({
      nsn: '5310-00-111-2222',
      approvedSourceCages: [],
      awards: [
        HUNDRED_UNIT_AWARD,
        // The most recent award contradicts itself, so rung 2 refuses and the pooled rung takes
        // the row. That is the shape where a normalisation error would show up in a BAND.
        contradictingAward({
          awardDateIso: '2026-01-29',
          statedUnitPriceUsd: 94.26,
          derivedUnitPriceUsd: 3.77,
          extendedPriceUsd: 94.26,
          quantity: 25,
          awardeeCage: 'DLR03',
        }),
        { ...TWO_UNIT_AWARD, awardDateIso: '2025-02-01', contractNo: 'FIXTURE-QTY-2B' },
      ],
      requirementQuantity: 2,
      atInstantMs: PRICING_INSTANT_MS,
    })
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.rung).toBe('R3_RECENT_AWARD_BAND')
    // 80.00 and 200.00 a unit, x 3 = 240.00 to 600.00 before the age widening.
    expect(rec.arithmetic).toContain('ran 80.00 to 200.00 a unit')
    expect(rec.arithmetic).toContain('x 3 = 240.00 to 600.00')
  })

  it('REFUSES a row whose extended total contradicts its own unit price', () => {
    const rec = recommendPrice({
      nsn: '5905-01-413-6345',
      approvedSourceCages: [],
      awards: [
        contradictingAward({
          awardDateIso: '2026-01-29',
          statedUnitPriceUsd: 94.26,
          derivedUnitPriceUsd: 3.77,
          extendedPriceUsd: 94.26,
          quantity: 25,
          awardeeCage: 'DLR03',
        }),
      ],
      requirementQuantity: 2,
      atInstantMs: PRICING_INSTANT_MS,
    })
    // Nothing else on the row, so the whole recommendation abstains rather than publishing 11.31.
    expect(rec.resolved).toBe(false)
    if (rec.resolved !== false) throw new Error('unreachable')
    expect(rec.reason).toBe('AWARD_HISTORY_UNREADABLE_AND_NO_PRICED_PEERS')
    const rung2 = rec.ladder.find((r) => r.rung === 'R2_LAST_AWARD_MULTIPLE')
    if (rung2?.resolved !== false) throw new Error('rung 2 must refuse')
    expect(rung2.reason).toBe('LAST_AWARD_CONTRADICTS_ITSELF_ON_PRICE')
    expect(rung2.sentence).toContain('94.26')
    expect(rung2.sentence).toContain('3.77')
  })

  it('REFUSES a per unit figure the row’s own extended total does not reproduce', () => {
    /*
     * THE THIRD CHECK, AND IT IS A DIFFERENT SHAPE FROM THE ONE ABOVE. There the Unit Price column
     * and the derived figure disagreed with EACH OTHER. Here they agree with each other at 200.00
     * and both disagree with the row's own extended total, which over a quantity of 2 is 4,000.00 a
     * unit. That is a per-unit figure nothing on the row supports, arriving from whatever built the
     * dossier rather than from the export's own division, and two agreeing columns are exactly what
     * makes it look trustworthy.
     */
    const rec = recommendPrice({
      nsn: '5310-00-111-2222',
      approvedSourceCages: [],
      awards: [
        {
          awardDateIso: '2026-01-29',
          effectiveUnitPriceUsd: 200,
          statedUnitPriceUsd: 200,
          extendedPriceUsd: 8000,
          quantity: 2,
          awardeeCage: 'DLR04',
          awardeeCompany: 'DLR04 (FIXTURE)',
          surplusAsWorded: null,
          contractNo: 'FIXTURE-EXTENDED-DISAGREES',
        },
      ],
      requirementQuantity: 2,
      atInstantMs: PRICING_INSTANT_MS,
    })
    expect(rec.resolved).toBe(false)
    if (rec.resolved !== false) throw new Error('unreachable')
    const rung2 = rec.ladder.find((r) => r.rung === 'R2_LAST_AWARD_MULTIPLE')
    if (rung2?.resolved !== false) throw new Error('rung 2 must refuse')
    expect(rung2.reason).toBe('LAST_AWARD_CONTRADICTS_ITSELF_ON_PRICE')
    expect(rung2.sentence).toContain('8000.00 over a quantity of 2')
    expect(rung2.sentence).toContain('4000.00 a unit')
  })

  it('NAMES a quantity break with both quantities, and does not invent a price effect', () => {
    const rec = recommendPrice({
      nsn: '5310-00-111-2222',
      approvedSourceCages: [],
      awards: [{ ...HUNDRED_UNIT_AWARD, awardDateIso: '2026-01-29' }],
      requirementQuantity: 2,
      atInstantMs: PRICING_INSTANT_MS,
    })
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    const caveat = rec.caveats.find((c) => c.code === 'QUANTITY_BREAK_CROSSED')
    expect(caveat).toBeDefined()
    // 100 units against a requirement of 2 is 50x. Known by construction.
    expect(caveat?.measured).toEqual({ label: 'widest quantity break', value: 50, unit: 'RATIO' })
    expect(caveat?.sentence).toContain('quantity of 100')
    expect(caveat?.sentence).toContain("requirement's 2")
    expect(caveat?.sentence).toContain('named rather than quantified')
    // The figure itself is untouched by the break: 80.00 x 3 = 240.00.
    expect(rec.basisUnitPriceUsd).toBe(240)
  })

  it('says nothing about a quantity break when the order sizes are comparable', () => {
    const rec = recommendPrice({
      nsn: '5310-00-111-2222',
      approvedSourceCages: [],
      awards: [{ ...TWO_UNIT_AWARD }],
      requirementQuantity: 4,
      atInstantMs: PRICING_INSTANT_MS,
    })
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.caveats.find((c) => c.code === 'QUANTITY_BREAK_CROSSED')).toBeUndefined()
  })
})
