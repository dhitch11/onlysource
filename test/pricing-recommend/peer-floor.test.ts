/**
 * THE PEER RUNG: A BAND, ALWAYS, AND NEVER FROM FEWER THAN THREE PRICED PEERS.
 *
 * Two owner-level rules meet here.
 *
 * FIRST, a row whose only basis is the peer group shows a BAND and never a point estimate. A point
 * with a small-print caveat is how a weak basis becomes a confident number: the caveat is read
 * once and the number is read every time. A band is self-describing, its width IS the uncertainty,
 * and the peer COUNT goes in the sentence because 14 peers and 3 peers are different claims
 * wearing the same shape.
 *
 * SECOND, no band from fewer than three priced peers. A band computed from one or two observations
 * is a point estimate in disguise and it looks MORE rigorous than the point estimate it is hiding,
 * which is what makes it dangerous. Below the floor the row abstains with a named reason and says
 * what it would need.
 *
 * POSITIVE CONTROL, run by hand and recorded here: lowering `peerFloorCount` to 2 turns the first
 * test red, and forcing `alwaysBand: false` on the peer rung turns the identical-peers test red.
 */

import { describe, expect, it } from 'vitest'
import { PEER_FLOOR_COUNT, recommendPrice } from '@/lib/intelligence/pricing/recommend'
import { PRICING_INSTANT_MS, REFERENCE_FSC, peer, peerLookupFor } from './_fixtures'

function peerOnlyRow(peers: Parameters<typeof peerLookupFor>[1]) {
  return recommendPrice({
    nsn: '1650-01-059-8221',
    approvedSourceCages: [],
    awards: [],
    requirementQuantity: 4,
    atInstantMs: PRICING_INSTANT_MS,
    peerLookup: peerLookupFor(REFERENCE_FSC, peers),
  })
}

describe('the peer rung floor', () => {
  it('the floor is three, stated as a constant a surface can render', () => {
    expect(PEER_FLOOR_COUNT).toBe(3)
  })

  it('TWO priced peers abstains, names the reason, and says what it needs', () => {
    const rec = peerOnlyRow([
      peer({ nsn: '1650-01-000-0001', unitPriceUsd: 100 }),
      peer({ nsn: '1650-01-000-0002', unitPriceUsd: 900 }),
    ])
    expect(rec.resolved).toBe(false)
    if (rec.resolved !== false) throw new Error('unreachable')
    expect(rec.reason).toBe('PEER_GROUP_BELOW_THE_FLOOR')
    expect(rec.missingInput).toContain('3 priced peers')

    const rung5 = rec.ladder.find((r) => r.rung === 'R5_FSC_PEER_BAND')
    if (rung5?.resolved !== false) throw new Error('the peer rung must be unresolved')
    expect(rung5.reason).toBe('PEER_GROUP_BELOW_THE_FLOOR')
    expect(rung5.sentence).toContain('point estimate in disguise')
  })

  it('THREE priced peers produces a band, with the count in the sentence', () => {
    const rec = peerOnlyRow([
      peer({ nsn: '1650-01-000-0001', unitPriceUsd: 100 }),
      peer({ nsn: '1650-01-000-0002', unitPriceUsd: 500 }),
      peer({ nsn: '1650-01-000-0003', unitPriceUsd: 900 }),
    ])
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.rung).toBe('R5_FSC_PEER_BAND')
    expect(rec.recommended.kind).toBe('BAND')
    expect(rec.sentence).toContain('from 3 priced peers in this supply class')
    /*
     * The middle half, by linear interpolation between order statistics: with 100, 500 and 900 the
     * 25th percentile is 300 and the 75th is 700. At the 3x rule that is 900.00 to 2100.00 before
     * the age widening, which only widens it further outward.
     */
    if (rec.recommended.kind !== 'BAND') throw new Error('unreachable')
    expect(rec.arithmetic).toContain('middle half 300.00 to 700.00')
    expect(rec.recommended.lowUnitPriceUsd).toBeLessThanOrEqual(900)
    expect(rec.recommended.highUnitPriceUsd).toBeGreaterThanOrEqual(2100)
  })

  it('THREE IDENTICAL peers is still a band, never a point, because the rule is structural', () => {
    /*
     * THE PEERS ARE DATED AT THE PRICING INSTANT ON PURPOSE. With any age at all the drift widening
     * would turn this into a band anyway, and the test would pass while proving nothing about the
     * structural rule. Zero age strips that away: the ONLY thing standing between three identical
     * peer prices and a point estimate off the weakest basis we hold is `alwaysBand`.
     */
    const rec = peerOnlyRow([
      peer({ nsn: '1650-01-000-0001', unitPriceUsd: 400, awardDateIso: '2026-01-29' }),
      peer({ nsn: '1650-01-000-0002', unitPriceUsd: 400, awardDateIso: '2026-01-29' }),
      peer({ nsn: '1650-01-000-0003', unitPriceUsd: 400, awardDateIso: '2026-01-29' }),
    ])
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    // Three peers agreeing exactly is a real fact and it does NOT license a point estimate off the
    // weakest basis we hold. The TYPE is what protects the render, so it stays a band.
    expect(rec.recommended.kind).toBe('BAND')
    if (rec.recommended.kind !== 'BAND') throw new Error('unreachable')
    // Degenerate on purpose: the band is 1200.00 to 1200.00, width zero, and it is STILL a band.
    expect(rec.recommended.lowUnitPriceUsd).toBe(1200)
    expect(rec.recommended.highUnitPriceUsd).toBe(1200)
    expect(rec.widthRatio).toBe(0)
  })

  it('names the peer basis as the weakest we hold, with the count measured on the caveat', () => {
    const rec = peerOnlyRow([
      peer({ nsn: '1650-01-000-0001', unitPriceUsd: 100 }),
      peer({ nsn: '1650-01-000-0002', unitPriceUsd: 500 }),
      peer({ nsn: '1650-01-000-0003', unitPriceUsd: 900 }),
      peer({ nsn: '1650-01-000-0004', unitPriceUsd: 1300 }),
    ])
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    const caveat = rec.caveats.find((c) => c.code === 'PEER_BASIS_IS_A_DIFFERENT_ITEM')
    expect(caveat?.measured).toEqual({ label: 'priced peers', value: 4, unit: 'COUNT' })
    expect(caveat?.sentence).toContain('DIFFERENT stock number')
    expect(rec.wouldSharpenWith.length).toBeGreaterThan(0)
    expect(rec.wouldSharpenWith.join(' ')).toContain('THIS stock number')
  })

  it('with no peer lookup wired at all, the rung says so and does not blame the item', () => {
    const rec = recommendPrice({
      nsn: '1650-01-059-8221',
      approvedSourceCages: [],
      awards: [],
      requirementQuantity: 4,
      atInstantMs: PRICING_INSTANT_MS,
    })
    const rung5 = rec.ladder.find((r) => r.rung === 'R5_FSC_PEER_BAND')
    if (rung5?.resolved !== false) throw new Error('the peer rung must be unresolved')
    expect(rung5.reason).toBe('NO_PEER_LOOKUP_SUPPLIED')
    expect(rung5.sentence).toContain('wiring gap and not a finding about the item')
  })
})
