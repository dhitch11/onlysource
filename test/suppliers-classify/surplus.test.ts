/**
 * THE SURPLUS ROLLUP AND THE BANDS, PURE. The real-data population figures are pinned
 * separately in `test/intelligence/surplus-rollup.test.ts`; this file pins the RULES, on
 * fixtures small enough that the expected answer is obvious by inspection.
 *
 * What is worth testing here is not arithmetic. It is the two ways this feature can lie:
 *
 *   1. FOLDING A BLANK INTO A NO. The Surplus column is positive-only — 42,698 award rows and
 *      not one "No" — so a reader that returns a boolean manufactures 42,387 negative findings
 *      out of silence. Every test below that touches an absence asserts the THIRD state, and
 *      several assert that the absence is NOT the false one, which is the assertion that would
 *      still pass if someone replaced the third state with `false`.
 *
 *   2. TREATING PRESENCE AS STRENGTH. 1 flagged award in 4,126 and 6 in 6 are the same fact
 *      under `> 0` and completely different facts to an operator. The banding tests pin that
 *      separation, and pin that the cut points are applied where the module says they are.
 */
import { describe, expect, it } from 'vitest'
import {
  readSurplus,
  rollUpSurplus,
  summariseSurplusCensus,
  bandSurplus,
  SURPLUS_BAND_CUTS,
  type SurplusAward,
} from '@/lib/intelligence/awards/surplus'

const A = (surplus: string | null, awardDateIso: string | null = null, cage: string | null = 'AAA11'): SurplusAward => ({
  surplus,
  awardDateIso,
  cage,
})

describe('rollUpSurplus — counts, with the denominator attached', () => {
  it('counts flagged, explicit-no and unread awards separately and they sum to the total', () => {
    const r = rollUpSurplus([A('Yes'), A('Yes'), A('No'), A(''), A(null), A('   ')])
    expect(r.flaggedAwards).toBe(2)
    expect(r.explicitNoAwards).toBe(1)
    expect(r.unreadAwards).toBe(3)
    expect(r.totalAwards).toBe(6)
    expect(r.flaggedAwards + r.explicitNoAwards + r.unreadAwards).toBe(r.totalAwards)
    expect(r.readAwards).toBe(3)
    expect(r.readFraction).toBeCloseTo(0.5, 10)
  })

  it('a blank cell is UNREAD, never a no — the rollup can be asked and answers the third state', () => {
    const r = rollUpSurplus([A(null, '2020-01-01'), A('', '2021-01-01'), A('maybe', '2022-01-01')])
    expect(r.unreadAwards).toBe(3)
    // The assertion that catches a boolean rewrite: the blanks must NOT have become explicit noes.
    expect(r.explicitNoAwards).toBe(0)
    expect(r.readAwards).toBe(0)
    expect(r.readFraction).toBe(0)
    expect(r.latestAwardState).toBe('surplus_unread')
  })

  it('NO AWARDS is not a read fraction of zero — it is null, because nothing was looked at', () => {
    const r = rollUpSurplus([])
    expect(r.totalAwards).toBe(0)
    expect(r.readFraction).toBeNull()
    expect(r.readFraction).not.toBe(0)
    expect(r.latestAwardState).toBeNull()
    expect(r.flaggedCages).toEqual([])
  })

  it('the MOST RECENT award drives latestAwardState, not the first and not the majority', () => {
    const older = rollUpSurplus([A('Yes', '2016-01-01'), A(null, '2025-01-01')])
    expect(older.flaggedAwards).toBe(1)
    expect(older.latestAwardState).toBe('surplus_unread')

    const newer = rollUpSurplus([A(null, '2016-01-01'), A(null, '2020-01-01'), A('Yes', '2025-01-01')])
    expect(newer.flaggedAwards).toBe(1)
    expect(newer.latestAwardState).toBe('surplus_yes')
  })

  it('TIE RULE: one flagged award among several sharing the newest date makes the date flagged', () => {
    const anyFlagged = rollUpSurplus([A(null, '2025-01-01'), A('Yes', '2025-01-01'), A(null, '2025-01-01')])
    expect(anyFlagged.latestAwardState).toBe('surplus_yes')
    // And an explicit no on the same date does not outrank it.
    const withNo = rollUpSurplus([A('No', '2025-01-01'), A('Yes', '2025-01-01')])
    expect(withNo.latestAwardState).toBe('surplus_yes')
    // With no yes anywhere on the date, an explicit no does outrank a blank.
    const noWins = rollUpSurplus([A(null, '2025-01-01'), A('No', '2025-01-01')])
    expect(noWins.latestAwardState).toBe('surplus_no')
  })

  it('awards with no date cannot be ordered, so latestAwardState is null rather than a guess', () => {
    const r = rollUpSurplus([A('Yes', null), A(null, null)])
    expect(r.flaggedAwards).toBe(1)
    expect(r.latestAwardState).toBeNull()
  })

  it('flaggedCages names WHO delivered, deduplicated, normalised and sorted — never the unflagged', () => {
    const r = rollUpSurplus([
      A('Yes', '2020-01-01', 'zz999'),
      A('Yes', '2021-01-01', 'ZZ999'),
      A('Yes', '2022-01-01', ' aa111 '),
      A(null, '2023-01-01', 'BB222'),
      A('Yes', '2024-01-01', null),
    ])
    expect(r.flaggedCages).toEqual(['AA111', 'ZZ999'])
    expect(r.flaggedCages).not.toContain('BB222')
    expect(r.flaggedAwards).toBe(4)
  })
})

describe('summariseSurplusCensus — the sample size that travels with the badge', () => {
  it('sums the rollups and counts flagged, mixed and latest-flagged stock numbers', () => {
    const allFlagged = rollUpSurplus([A('Yes', '2020-01-01', 'C1'), A('Yes', '2021-01-01', 'C1')])
    const mixed = rollUpSurplus([A('Yes', '2020-01-01', 'C2'), A(null, '2021-01-01', 'C3')])
    const none = rollUpSurplus([A(null, '2020-01-01', 'C4')])
    const noAwards = rollUpSurplus([])

    const c = summariseSurplusCensus([allFlagged, mixed, none, noAwards], {
      distinctAwardeeCages: 4,
      observedValues: ['Yes'],
    })
    expect(c.totalRows).toBe(5)
    expect(c.flaggedRows).toBe(3)
    expect(c.explicitNoRows).toBe(0)
    expect(c.readFraction).toBeCloseTo(3 / 5, 10)
    expect(c.nsnsWithAwards).toBe(3)
    expect(c.nsnsFlagged).toBe(2)
    // MIXED is the one that proves the flag belongs to a delivery: flagged, but not every award.
    expect(c.nsnsMixed).toBe(1)
    // The all-flagged rollup's latest is flagged; the mixed one's latest (2021) is blank.
    expect(c.nsnsLatestFlagged).toBe(1)
    expect(c.distinctAwardeeCages).toBe(4)
    expect(c.flaggedAwardeeCages).toBe(2)
    expect(c.observedValues).toEqual(['Yes'])
    expect(c.observedValuesTruncated).toBe(false)
  })

  it('an empty population reports a NULL read fraction, not a zero', () => {
    const c = summariseSurplusCensus([], { distinctAwardeeCages: 0, observedValues: [] })
    expect(c.totalRows).toBe(0)
    expect(c.readFraction).toBeNull()
    expect(c.readFraction).not.toBe(0)
  })

  it('observedValues is deduplicated, sorted and capped, and says when it capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => `v${String(i).padStart(2, '0')}`)
    const c = summariseSurplusCensus([], { distinctAwardeeCages: 0, observedValues: [...many, ...many] })
    expect(c.observedValues.length).toBe(25)
    expect(c.observedValues[0]).toBe('v00')
    expect(c.observedValuesTruncated).toBe(true)
  })
})

describe('bandSurplus — a PRODUCT CHOICE, applied where the module says it is', () => {
  it('no flagged award is its own band and is not a claim that the firm avoids surplus', () => {
    expect(bandSurplus(0, 100)).toBe('no_flagged_award')
    expect(bandSurplus(0, 0)).toBe('no_flagged_award')
  })

  it('ONE flagged award is single_award at ANY ratio — n=1 is an anecdote even at 1 of 1', () => {
    expect(bandSurplus(1, 1)).toBe('single_award')
    expect(bandSurplus(1, 13)).toBe('single_award') // RAYTHEON, 7.69%
    expect(bandSurplus(1, 4126)).toBe('single_award') // ATLANTIC DIVING SUPPLY, 0.02%
    // The point of the rule: 1/1 is 100% and still must NOT reach the strongest band.
    expect(bandSurplus(1, 1)).not.toBe('predominant')
  })

  it('the cut points are exactly where SURPLUS_BAND_CUTS says, on both sides of each line', () => {
    // occasionalBelow = 0.10: 9/100 is occasional, 10/100 is frequent.
    expect(SURPLUS_BAND_CUTS.occasionalBelow).toBe(0.1)
    expect(bandSurplus(9, 100)).toBe('occasional')
    expect(bandSurplus(10, 100)).toBe('frequent')
    // frequentBelow = 0.50: 49/100 is frequent, 50/100 is predominant.
    expect(SURPLUS_BAND_CUTS.frequentBelow).toBe(0.5)
    expect(bandSurplus(49, 100)).toBe('frequent')
    expect(bandSurplus(50, 100)).toBe('predominant')
  })

  it('separates the two companies the presence rule could not tell apart', () => {
    // The defect, in one assertion: `> 0` says these are the same company.
    expect(bandSurplus(5, 5933)).toBe('occasional') // SIKORSKY
    expect(bandSurplus(6, 6)).toBe('predominant') // P & R TRADING
    expect(bandSurplus(5, 5933)).not.toBe(bandSurplus(6, 6))
  })

  it('a flagged count with no denominator cannot be a ratio, so it falls to the weakest claim', () => {
    expect(bandSurplus(3, 0)).toBe('single_award')
    expect(bandSurplus(3, 0)).not.toBe('predominant')
  })
})

describe('readSurplus is still the one reader, re-exported from the classifier', () => {
  it('the classifier entry point and the awards entry point are the SAME function', async () => {
    const viaClassifier = await import('@/lib/intelligence/suppliers/classify')
    // Identity, not equivalence: two copies that agree today drift tomorrow.
    expect(viaClassifier.readSurplus).toBe(readSurplus)
    expect(viaClassifier.bandSurplus).toBe(bandSurplus)
  })
})
