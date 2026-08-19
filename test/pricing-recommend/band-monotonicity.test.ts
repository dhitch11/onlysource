/**
 * THE BAND WIDENS MONOTONICALLY AS YOU DESCEND THE LADDER, ASSERTED NUMERICALLY.
 *
 * Confidence here is the RUNG, never an invented 0 to 100 score nobody can audit. The width of the
 * band is the visible face of that: a weaker basis may not report a tighter band than a stronger
 * one, because a reader trusts the shape long after they have forgotten the label.
 *
 * REAL DATA DOES NOT RESPECT THAT ON ITS OWN, which is the point of the second test below. Three
 * peers can happen to sit within a percent of each other while the two inflation factors on file
 * disagree by six. So the engine ENFORCES the property: each rung's width is floored at the width
 * of the rung above it, ON THIS SAME ROW. The floor is never an invented constant, it is another
 * rung's computed width, and the weaker rung discloses that it was widened and by which rung.
 *
 * POSITIVE CONTROL, run by hand and recorded here: deleting the floor cascade in `widenBasis`
 * (passing `null` for `floorFrom` in `recommendPrice`) turns the second test red, because the tight
 * peer group then reports a band a fifth as wide as the award history above it.
 */

import { describe, expect, it } from 'vitest'
import { recommendPrice, type ResolvedRungOutcome } from '@/lib/intelligence/pricing/recommend'
import { REFERENCE_FSC, fullLadderInput, peer, peerLookupFor, AT_OPERATOR_MULTIPLE } from './_fixtures'

function resolvedRungs(input: Parameters<typeof recommendPrice>[0]): ResolvedRungOutcome[] {
  const rec = recommendPrice(input)
  return rec.ladder.filter((r): r is ResolvedRungOutcome => r.resolved === true)
}

describe('the band widens monotonically down the ladder', () => {
  it('every rung on the full row resolves, so the property is tested on all five', () => {
    const rungs = resolvedRungs(fullLadderInput())
    expect(rungs.map((r) => r.rung)).toEqual([
      'R1_MANUFACTURER_ANCHOR',
      'R2_LAST_AWARD_MULTIPLE',
      'R3_RECENT_AWARD_BAND',
      'R4_AWARD_TREND',
      'R5_FSC_PEER_BAND',
    ])
  })

  it('width never decreases from one rung to the next, and it does increase', () => {
    const rungs = resolvedRungs(fullLadderInput())
    const widths = rungs.map((r) => r.widthRatio)
    for (let i = 1; i < widths.length; i += 1) {
      const previous = widths[i - 1] as number
      const current = widths[i] as number
      expect(
        current,
        `${rungs[i]?.rung} reports a width of ${current}, tighter than ${rungs[i - 1]?.rung} at ` +
          `${previous}. A weaker basis may not be more precise than a stronger one.`,
      ).toBeGreaterThanOrEqual(previous)
    }
    // Not a vacuous pass on a row of zeros: the ladder really does spread out.
    const first = widths[0] as number
    const last = widths[widths.length - 1] as number
    expect(last).toBeGreaterThan(first * 5)
  })

  it('a TIGHT peer group is widened to the stronger rung above it, and says so', () => {
    /*
     * The adversarial shape, and the reason the floor exists. These three peers sit within 2% of
     * each other, so their own computed band is far tighter than the award history two rungs up.
     * Rendered as computed it would read as the most precise figure on the row while resting on
     * three prices paid for three DIFFERENT stock numbers.
     */
    const rungs = resolvedRungs(
      fullLadderInput({
        peerLookup: peerLookupFor(REFERENCE_FSC, [
          peer({ nsn: '1650-01-000-0001', unitPriceUsd: 500 }),
          peer({ nsn: '1650-01-000-0002', unitPriceUsd: 505 }),
          peer({ nsn: '1650-01-000-0003', unitPriceUsd: 510 }),
        ]),
      }),
    )
    const trend = rungs.find((r) => r.rung === 'R4_AWARD_TREND')
    const peers = rungs.find((r) => r.rung === 'R5_FSC_PEER_BAND')
    if (trend === undefined || peers === undefined) throw new Error('both rungs must resolve')

    // Its OWN spread is tiny. That is the number a naive implementation would have published.
    expect(peers.widthRatioBeforeFloor).toBeLessThan(0.03)
    // What it actually reports is at least the width of the stronger rung above it.
    expect(peers.widthRatio).toBeGreaterThanOrEqual(trend.widthRatio)
    expect(peers.widenedToMatch).toBe('R4_AWARD_TREND')
    const caveat = peers.caveats.find((c) => c.code === 'WIDENED_TO_THE_WIDTH_OF_A_STRONGER_RUNG')
    expect(caveat?.sentence).toContain('R4_AWARD_TREND')
  })

  it('a point is only a point when nothing widened it, and it reports a width of zero', () => {
    // One award, dated at the pricing instant, no approved sources, no peers: nothing to age and
    // nothing above it to floor against.
    const rec = recommendPrice({
      nsn: '1650-01-059-8221',
      approvedSourceCages: [],
      awards: [
        {
          awardDateIso: '2026-01-29',
          effectiveUnitPriceUsd: 500,
          statedUnitPriceUsd: 500,
          extendedPriceUsd: 1000,
          quantity: 2,
          awardeeCage: 'DLR01',
          awardeeCompany: 'DLR01 (FIXTURE)',
          surplusAsWorded: null,
          contractNo: 'FIXTURE-1',
        },
      ],
      requirementQuantity: 2,
      atInstantMs: Date.UTC(2026, 0, 29),
    })
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.recommended.kind).toBe('POINT')
    expect(rec.widthRatio).toBe(0)
  })
})
