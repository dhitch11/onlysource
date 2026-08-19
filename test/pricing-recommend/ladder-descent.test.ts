/**
 * THE LADDER DESCENDS, ONE RUNG PER PIECE OF EVIDENCE REMOVED, AND ENDS IN A NAMED ABSTENTION.
 *
 * Each step below strips exactly one thing from the SAME row and asserts which rung catches it.
 * That is the whole product in one file: what makes a recommendation defensible is not that a
 * number appeared, it is that the number's basis is named and that removing the basis visibly
 * changes the answer instead of silently changing what the answer means.
 *
 * THE STEP THAT MATTERS MOST IS STEP 3. When the most recent award contradicts itself about the
 * unit price, rung 2 REFUSES rather than walking back to the last award that can be read. Walking
 * back would answer a different question under the same label ("three times the previous award"),
 * and it would answer it in whichever direction the older row happens to point. The pooled rungs
 * below carry the row instead, which is what makes them a real fallback rather than decoration.
 */

import { describe, expect, it } from 'vitest'
import { recommendPrice } from '@/lib/intelligence/pricing/recommend'
import {
  APPROVED_SOURCE_CAGE,
  OEM_AWARD_QUANTITY,
  OEM_UNIT_PRICE_USD,
  PRICING_INSTANT_MS,
  REFERENCE_FSC,
  cleanAward,
  contradictingAward,
  fullLadderInput,
  peer,
  peerLookupFor,
} from './_fixtures'

const PEERS = [
  peer({ nsn: '1650-01-000-0001', unitPriceUsd: 100 }),
  peer({ nsn: '1650-01-000-0002', unitPriceUsd: 200 }),
  peer({ nsn: '1650-01-000-0003', unitPriceUsd: 400 }),
  peer({ nsn: '1650-01-000-0004', unitPriceUsd: 800 }),
]

describe('the basis ladder descends as evidence is removed', () => {
  it('step 1: with a manufacturer award in the factors base year, the row lands on rung 1', () => {
    const rec = recommendPrice(fullLadderInput())
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.rung).toBe('R1_MANUFACTURER_ANCHOR')
    // The two index lines ARE the band. Neither is blended and neither is dropped.
    if (rec.recommended.kind !== 'BAND') throw new Error('the anchor rung is always a band')
    expect(rec.recommended.lowUnitPriceUsd).toBe(2033.5)
    expect(rec.recommended.highUnitPriceUsd).toBe(2152.99)
    // BD-17: the DoD line is the TRUE product 1537.85 x 1.40 = 2152.99, never the stated "$2,150".
    expect(rec.recommended.highUnitPriceUsd).not.toBe(2150)
    expect(rec.arithmetic).toContain('1537.85 (CPI) x 1.3223 = 2033.50')
    expect(rec.arithmetic).toContain('1537.85 (DoD procurement) x 1.4 = 2152.99')
  })

  it('step 2: strip the approved-source list and it falls to rung 2, the operator’s own rule', () => {
    const rec = recommendPrice(fullLadderInput({ approvedSourceCages: [] }))
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.rung).toBe('R2_LAST_AWARD_MULTIPLE')
    // 1450.00 is the most recent award. 1450 x 3 = 4350.00 exactly, then widened by its age.
    expect(rec.basisUnitPriceUsd).toBe(4350)
    expect(rec.arithmetic).toBe('1450.00 x 3 = 4350.00')
    const anchorRung = rec.ladder.find((r) => r.rung === 'R1_MANUFACTURER_ANCHOR')
    expect(anchorRung?.resolved).toBe(false)
    if (anchorRung?.resolved === false) {
      expect(anchorRung.reason).toBe('NO_MANUFACTURER_AWARD_IDENTIFIED')
      expect(anchorRung.missingInput).toContain('approved-source list')
    }
  })

  it('step 3: break the most recent award and it falls to rung 3 rather than substituting an older one', () => {
    const base = fullLadderInput({ approvedSourceCages: [] })
    const withBrokenLatest = recommendPrice({
      ...base,
      awards: [
        ...base.awards.slice(0, 3),
        // The live shape from NSN 5905-01-413-6345: the column states 94.26 and the extended total
        // divides to 3.77, and both were shipping graded MEASURED.
        contradictingAward({
          awardDateIso: '2025-06-02',
          statedUnitPriceUsd: 94.26,
          derivedUnitPriceUsd: 3.77,
          extendedPriceUsd: 94.26,
          quantity: 25,
          awardeeCage: 'DLR02',
        }),
      ],
    })
    if (withBrokenLatest.resolved !== true) throw new Error('expected a recommendation')
    expect(withBrokenLatest.rung).toBe('R3_RECENT_AWARD_BAND')

    const rung2 = withBrokenLatest.ladder.find((r) => r.rung === 'R2_LAST_AWARD_MULTIPLE')
    expect(rung2?.resolved).toBe(false)
    if (rung2?.resolved === false) {
      expect(rung2.reason).toBe('LAST_AWARD_CONTRADICTS_ITSELF_ON_PRICE')
      expect(rung2.sentence).toContain('An earlier award is not substituted')
    }

    // THE SUBSTITUTION THE RULE REFUSES: 1450 was the last readable award before the break, and
    // 900 is the one an "use the last readable award" implementation would have reached for.
    // Neither may appear as this row's basis.
    expect(withBrokenLatest.basisUnitPriceUsd).toBeNull()
    if (withBrokenLatest.recommended.kind !== 'BAND') throw new Error('rung 3 is a band')
    // The pool is 812.00 and 900.00 a unit, both in the 36 month window, x 3 = 2436.00 to 2700.00,
    // then widened outward by the age of the oldest contributing award.
    expect(withBrokenLatest.recommended.lowUnitPriceUsd).toBeLessThan(2436)
    expect(withBrokenLatest.recommended.highUnitPriceUsd).toBeGreaterThan(2700)
    expect(withBrokenLatest.arithmetic).toContain('ran 812.00 to 900.00 a unit')
    // The fabricated 3.77 a unit never reaches a published figure.
    expect(JSON.stringify(withBrokenLatest.recommended)).not.toContain('3.77')
  })

  it('step 4: move every award out of the recency window and it falls to rung 4, the trend', () => {
    const rec = recommendPrice({
      nsn: '1650-01-059-8221',
      approvedSourceCages: [],
      awards: [
        cleanAward({ awardDateIso: '2017-04-11', unitPriceUsd: 1537.85, quantity: 17, awardeeCage: 'DLR01' }),
        cleanAward({ awardDateIso: '2018-05-02', unitPriceUsd: 1200, quantity: 4, awardeeCage: 'DLR02' }),
        cleanAward({ awardDateIso: '2019-06-01', unitPriceUsd: 1000, quantity: 6, awardeeCage: 'DLR03' }),
        contradictingAward({
          awardDateIso: '2020-07-07',
          statedUnitPriceUsd: 94.26,
          derivedUnitPriceUsd: 3.77,
          extendedPriceUsd: 94.26,
          quantity: 25,
          awardeeCage: 'DLR04',
        }),
      ],
      requirementQuantity: 8,
      atInstantMs: PRICING_INSTANT_MS,
      peerLookup: peerLookupFor(REFERENCE_FSC, PEERS),
    })
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.rung).toBe('R4_AWARD_TREND')
    const rung3 = rec.ladder.find((r) => r.rung === 'R3_RECENT_AWARD_BAND')
    if (rung3?.resolved === false) expect(rung3.reason).toBe('TOO_FEW_RECENT_AWARDS')
    expect(rec.arithmetic).toContain('least squares trend')
    // An extrapolation never leaves the observed range on its own: the band spans the observed
    // prices union the projection, so a fitted line can widen the band and can never become a
    // confident figure outside everything that has ever been paid.
    expect(rec.arithmetic).toContain('the band spans 1000.00 to 1537.85')
  })

  it('step 5: remove the award history entirely and it falls to rung 5, the peer band', () => {
    const rec = recommendPrice({
      nsn: '1650-01-059-8221',
      approvedSourceCages: [],
      awards: [],
      requirementQuantity: 8,
      atInstantMs: PRICING_INSTANT_MS,
      peerLookup: peerLookupFor(REFERENCE_FSC, PEERS),
    })
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.rung).toBe('R5_FSC_PEER_BAND')
    expect(rec.recommended.kind).toBe('BAND')
    // The peer count is in the sentence, because 4 peers and 40 peers are different claims
    // wearing the same shape.
    expect(rec.sentence).toContain('from 4 priced peers in this supply class')
    expect(rec.sentence).toContain('the weakest basis we hold')
  })

  it('step 6: below the peer floor there is no rung left, and the row abstains BY NAME', () => {
    const rec = recommendPrice({
      nsn: '1650-01-059-8221',
      approvedSourceCages: [],
      awards: [],
      requirementQuantity: 8,
      atInstantMs: PRICING_INSTANT_MS,
      peerLookup: peerLookupFor(REFERENCE_FSC, PEERS.slice(0, 2)),
    })
    expect(rec.resolved).toBe(false)
    if (rec.resolved !== false) throw new Error('unreachable')
    expect(rec.reason).toBe('PEER_GROUP_BELOW_THE_FLOOR')
    expect(rec.missingInput).toContain('3 priced peers in supply class 1650')
    expect(rec.sentence).toContain('abstention and not a zero')
    // No numeric field of any kind on the abstained arm, so a surface cannot read a price off it.
    expect(Object.keys(rec)).not.toContain('recommended')
    expect(Object.keys(rec)).not.toContain('quotedTotal')
  })

  it('every rung the row cannot reach still says what it needs', () => {
    const rec = recommendPrice(fullLadderInput({ approvedSourceCages: [], awards: [] }))
    for (const rung of rec.ladder) {
      if (rung.resolved === false) {
        expect(rung.missingInput.length).toBeGreaterThan(10)
        expect(rung.sentence.length).toBeGreaterThan(30)
      }
    }
  })

  it('the supply class is derived from the stock number, and the lookup is asked for it', () => {
    const asked: string[] = []
    recommendPrice(
      fullLadderInput({
        peerLookup: (fsc) => {
          asked.push(fsc)
          return PEERS
        },
      }),
    )
    expect(asked).toEqual([REFERENCE_FSC])
  })

  it('the manufacturer rung refuses an award whose year the factors cannot cover', () => {
    // Same approved source, same clean row, one year later than the factors' base year. Both
    // factors are stated for 2017 and name no published series, so there is nothing to re-base.
    const rec = recommendPrice(
      fullLadderInput({
        awards: [
          cleanAward({
            awardDateIso: '2018-04-11',
            unitPriceUsd: OEM_UNIT_PRICE_USD,
            quantity: OEM_AWARD_QUANTITY,
            awardeeCage: APPROVED_SOURCE_CAGE,
          }),
        ],
      }),
    )
    const rung1 = rec.ladder.find((r) => r.rung === 'R1_MANUFACTURER_ANCHOR')
    expect(rung1?.resolved).toBe(false)
    if (rung1?.resolved === false) {
      expect(rung1.reason).toBe('NO_INFLATION_FACTOR_FOR_THE_AWARD_YEAR')
      expect(rung1.missingInput).toContain('base year of 2018')
    }
  })
})
