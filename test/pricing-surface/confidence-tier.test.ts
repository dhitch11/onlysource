/**
 * THE CONFIDENCE TIER ON THE PRICING BOARD, WHICH HAS NOW BEEN WRONG THREE TIMES.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS FIELD KEEPS BREAKING, AND WHAT FINALLY FIXED IT
 * ---------------------------------------------------------------------------------------
 * It sits beside the money on every row of /pricing, so whatever it says is read as the product's
 * own opinion of the figure next to it. Its three shipped versions:
 *
 *   1. Derived from the rung's INDEX. R2 sits second on the ladder, so it printed "strong basis"
 *      beside a 3x figure our own corpus says clears under one time in two hundred. THE LADDER IS
 *      ORDERED BY PROVENANCE, NOT BY OUTCOME, and reading an outcome out of a position is how a
 *      0.5% figure came to wear an endorsement.
 *   2. Hardcoded on R2 to "your stated rule, not a measured basis". True while the default WAS his
 *      3x. The moment the default became a measured one it said the opposite of the truth, calling
 *      the best-supported number in the product a hunch.
 *   3. Branched on `multiple === 1`. Same shape as the first two: a claim about quality pinned to a
 *      literal, which goes false the next time the literal moves. It would have called 0.95x and
 *      0.98x unmeasured, and those are the two most measured numbers this product holds.
 *
 * The fix is not a better string. It is to compute the claim from WHERE THE MULTIPLE STANDS
 * relative to what was measured, using the engine's own classifier, so no literal in this file has
 * to be maintained in step with a ruling. Every assertion below is written to survive the default
 * moving anywhere inside the measured band, because it has already moved twice in one night.
 *
 * ---------------------------------------------------------------------------------------
 * POSITIVE CONTROLS, PERFORMED AND RECORDED
 * ---------------------------------------------------------------------------------------
 * Each was made in `app/(app)/pricing/wire.ts`, the named test was watched going RED, and the file
 * was restored.
 *
 *   1. R2 returning `'your stated rule, not a measured basis'` unconditionally (shipped version 2)
 *        -> "a measured multiple is never called unmeasured" RED.
 *   2. R2 restored to `multiple === 1 ? ... : \`your own ${multiple}x, not a measured basis\``
 *      (shipped version 3)
 *        -> "a measured multiple is never called unmeasured" RED, on 0.95x and 0.98x.
 *   3. The R3/R4/R5 clause deleted, so only R2 mentions the multiple
 *        -> "every rung that multiplies says so when the multiple is not measured" RED.
 *   4. `RUNGS_THAT_APPLY_THE_AWARD_MULTIPLE` extended to include R1
 *        -> "rung 1 never carries a claim about the multiple" RED.
 *
 * Each break was applied, the named test run alone, `wire.ts` restored from a byte snapshot, and
 * the test re-run green. `.probe/positive-controls.py` performs all of them and asserts the restore
 * is byte-identical.
 */

import { describe, expect, it } from 'vitest'
import { confidenceTier } from '@/app/(app)/pricing/wire'
import {
  DEFAULT_AWARD_MULTIPLE,
  MEASURED_AWARD_MULTIPLE,
  MEASURED_AWARD_MULTIPLE_BAND,
  OPERATOR_AWARD_MULTIPLE,
  RECOMMENDATION_RUNGS,
  RUNGS_THAT_APPLY_THE_AWARD_MULTIPLE,
} from '@/lib/intelligence/pricing/recommend'

const UNMEASURED = 'not a measured basis'
const OUTSIDE = 'outside the measured band'

describe('the tier tells the truth about the multiple the figure was computed at', () => {
  it('a measured multiple is never called unmeasured', () => {
    for (const multiple of [
      MEASURED_AWARD_MULTIPLE,
      MEASURED_AWARD_MULTIPLE_BAND.lowMultiple,
      MEASURED_AWARD_MULTIPLE_BAND.highMultiple,
      DEFAULT_AWARD_MULTIPLE,
    ]) {
      const tier = confidenceTier('R2_LAST_AWARD_MULTIPLE', multiple)
      expect(tier).not.toContain(UNMEASURED)
      expect(tier).not.toContain(OUTSIDE)
      expect(tier).toContain('measured')
    }
  })

  it("keeps the operator's own words for his own rule, named by identity and not by index", () => {
    expect(confidenceTier('R2_LAST_AWARD_MULTIPLE', OPERATOR_AWARD_MULTIPLE)).toBe(
      'your stated rule, not a measured basis',
    )
  })

  it('a multiple nobody measured is not dressed up as one that was', () => {
    // Above the advisory ceiling, and below the band. Neither is measured, and neither is his.
    for (const multiple of [1.35, 0.5]) {
      const tier = confidenceTier('R2_LAST_AWARD_MULTIPLE', multiple)
      expect(tier).toContain(OUTSIDE)
      expect(tier).not.toBe(confidenceTier('R2_LAST_AWARD_MULTIPLE', MEASURED_AWARD_MULTIPLE))
    }
  })

  it('every rung that multiplies says so when the multiple is not measured', () => {
    for (const rung of RUNGS_THAT_APPLY_THE_AWARD_MULTIPLE) {
      if (rung === 'R2_LAST_AWARD_MULTIPLE') continue
      // R3, R4 and R5 apply the same multiple to their bands. Saying it only on R2 would leave
      // three rungs carrying an untested number under a tier that reads as an endorsement.
      expect(confidenceTier(rung, OPERATOR_AWARD_MULTIPLE)).toContain(OUTSIDE)
      expect(confidenceTier(rung, MEASURED_AWARD_MULTIPLE)).not.toContain(OUTSIDE)
    }
  })

  it('rung 1 never carries a claim about the multiple, because it never multiplies', () => {
    expect(RUNGS_THAT_APPLY_THE_AWARD_MULTIPLE).not.toContain('R1_MANUFACTURER_ANCHOR')
    // Identical at every multiple, including one nobody measured.
    const tiers = [OPERATOR_AWARD_MULTIPLE, MEASURED_AWARD_MULTIPLE, 1.35, 0.5].map((m) =>
      confidenceTier('R1_MANUFACTURER_ANCHOR', m),
    )
    expect(new Set(tiers).size).toBe(1)
    expect(tiers[0]).toBe('strongest basis we hold')
  })

  it('still names the strongest and the weakest by position, so a sixth rung cannot go unnamed', () => {
    const first = RECOMMENDATION_RUNGS[0]
    const last = RECOMMENDATION_RUNGS[RECOMMENDATION_RUNGS.length - 1]
    if (!first || !last) throw new Error('the ladder is empty')
    expect(confidenceTier(first, DEFAULT_AWARD_MULTIPLE)).toBe('strongest basis we hold')
    expect(confidenceTier(last, DEFAULT_AWARD_MULTIPLE)).toBe('weakest basis we hold')
    for (const rung of RECOMMENDATION_RUNGS) {
      expect(confidenceTier(rung, DEFAULT_AWARD_MULTIPLE).trim()).not.toBe('')
    }
  })
})
