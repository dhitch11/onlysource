import { describe, expect, it } from 'vitest'
import { classifyInstrument, offersDescribeThisAward } from '@/lib/intelligence/awards/parent-child'
import { readQuoteSignals, tallyQuoteSignals } from '@/lib/intelligence/scoring/quote-signals'
import type { AwardRecord, FeedWindow, NsnAwardSummary } from '@/lib/intelligence/awards/nsn-now'
import { rollUpSurplus } from '@/lib/intelligence/awards/surplus'

/**
 * THE QUOTE CHECKLIST, COMPUTED, AND THE ONE SENTINEL THAT MUST STAY DISCARDED.
 *
 * Every abstention here is paired with a POSITIVE CONTROL: a signal that DOES read, from the same
 * fixture, so a module that returned UNAVAILABLE for everything would fail this suite rather than
 * pass it. That pairing is the whole reason the suite is worth running.
 *
 * A NOTE ON HOW THIS FILE GOT ITS SHAPE, because the mistake is more instructive than the fix.
 * Rendering these signals produced "9114 bidders on the last award". I counted, found 25% of the
 * `Offers` column and 35% of `LTC Expiration` unusable, and withheld both signals. Then I checked
 * the raw sheet XML with a hand-written regex to confirm the export was at fault, and it agreed.
 *
 * Both the parser and my check had the same defect, because I wrote the check the same way the
 * parser was written: a greedy attribute group that swallows the slash of a self-closing cell, so
 * an empty cell steals a later cell's value. An independent check that reproduces the bug it is
 * checking for is not an independent check. Fixing `seed/xlsx.ts` took LTC Expiration to 100% valid
 * dates and left exactly one real artifact, the 29 sentinel, which is what this file now pins.
 */

const WINDOW: FeedWindow = { firstAwardIso: '2016-01-04', lastAwardIso: '2026-02-01', years: 10 }

/*
 * ★ THE FIXTURE DERIVES `instrument` AND `offersDescribeThisAward` RATHER THAN DECLARING THEM.
 *
 * Both are computed fields (see `lib/intelligence/awards/parent-child.ts`). A fixture that
 * hardcodes a derived value can assert a state the real parser would never produce, so a test
 * passing `deliveryOrder: 'F001'` gets a genuinely classified record and cannot accidentally
 * describe a delivery order whose offers still count as its own.
 */
const award = (over: Partial<AwardRecord> & { contractNo: string }): AwardRecord => {
  const base = {
    nsn: '5325015619853',
    awardDateIso: null,
    quantity: null,
    unitPrice: null,
    company: 'ACME',
    cage: '58794',
    finalPrice: null,
    effectiveUnitPrice: null,
    amc: null,
    amsc: null,
    offers: null,
    deliveryDays: null,
    setAside: null,
    firstArticle: null,
    ltcExpirationIso: null,
    surplus: null,
    solicitation: null,
    closeDateIso: null,
  deliveryOrder: null,
    instrument: 'unreadable' as const,
    offersDescribeThisAward: false,
    ...over,
  }
  const rec: AwardRecord = { ...base, instrument: classifyInstrument(base) }
  return { ...rec, offersDescribeThisAward: offersDescribeThisAward(rec) }
}

const summary = (over: Partial<NsnAwardSummary> = {}): NsnAwardSummary => {
  const base: NsnAwardSummary = {
    nsn: '5325015619853',
    awards: [award({ contractNo: 'C1', awardDateIso: '2018-01-01' })],
    latest: award({ contractNo: 'C1', awardDateIso: '2018-01-01' }),
    distinctAwardees: 1,
    firstUnitPrice: 10,
    lastUnitPrice: 20,
    priceScaleSuspect: null,
    holders: [],
    amc: null,
    amsc: null,
    latestOffers: null,
    // Derived in the real builder from the award instruments; the fixture states the honest
    // default and any test that needs the other value sets it explicitly.
    latestOffersDescribeThatAward: false,
    deliveryOrderOnly: false,
    earliestOrderIso: null,
    minOffers: null,
    latestDeliveryDays: null,
    longestDemandGapYears: null,
    yearsSinceLastAward: null,
    approvedSources: [],
    ltcExpirationIso: null,
    surplus: rollUpSurplus([]),
    ...over,
  }
  // Derived from whatever awards the fixture ended up with, so a caller that overrides `awards`
  // cannot leave a surplus rollup describing a different set of rows behind.
  return { ...base, surplus: over.surplus ?? rollUpSurplus(base.awards) }
}

const find = (s: NsnAwardSummary, id: string) => readQuoteSignals(s, WINDOW).find((x) => x.id === id)!

describe('the sentinel is discarded, and the clean columns are read', () => {
  /*
   * These signals were WITHHELD earlier on 2026-08-16 on a contamination measurement that was
   * measuring our own parser, not the export. The self-closing-cell defect in seed/xlsx.ts made
   * empty cells steal a later cell's value. With it fixed, LTC Expiration is 100% valid dates and
   * Offers is numeric throughout with a single sentinel value.
   *
   * What is pinned here is the SENTINEL. 29 occurs 11,273 times while 28 occurs 3 times and 30
   * occurs once, so it is not a count, and the scorecard was scoring it as "contested" on 18.8%
   * of all rows. It is discarded at parse time; this asserts the signal layer agrees.
   */
  it('reads a real bid count', () => {
    const sig = find(summary({ latestOffers: 2, latestOffersDescribeThatAward: true }), 'competition')
    expect(sig.leg.state).toBe('MEASURED')
    expect(sig.leg.value).toBe(2)
    expect(sig.direction).toBe('favourable')
  })

  it('a single bidder is the strongest competition reading available', () => {
    const sig = find(summary({ latestOffers: 1, latestOffersDescribeThatAward: true }), 'competition')
    expect(sig.leg.evidenceWeight).toBeGreaterThan(0.8)
    expect(sig.reading).toContain('One bidder')
  })

  it('a contested award reads as against, so the direction is not just "we found a number"', () => {
    expect(find(summary({ latestOffers: 12, latestOffersDescribeThatAward: true }), 'competition').direction).toBe('unfavourable')
  })

  it('abstains when the parser discarded the value, rather than inventing a zero', () => {
    const sig = find(summary({ latestOffers: null }), 'competition')
    expect(sig.leg.state).toBe('UNAVAILABLE')
    expect(sig.leg.value).toBeNull()
    expect(sig.direction).toBe('neutral')
  })

  it('names the sentinel discard in its limitation, so a missing 29 is explained not mysterious', () => {
    expect(find(summary({ latestOffers: 3, latestOffersDescribeThatAward: true }), 'competition').limitation).toContain('sentinel')
  })

  /* ------------------------------------------------------------------------------------ */
  /* H10 / DEFECT 1. These four tests above now pass `latestOffersDescribeThatAward: true`   */
  /* explicitly, and that is the fix, not an accommodation of it. A bid count is only a fact */
  /* about the award it sits on when that award was competed in its own right. The three     */
  /* tests below are the branches that used to be one branch.                                */
  /* ------------------------------------------------------------------------------------ */

  it('★ a delivery-order-only history renders the STRONGER truth, not a bid count', () => {
    const sig = find(
      summary({ latestOffers: 3, latestOffersDescribeThatAward: false, deliveryOrderOnly: true, earliestOrderIso: '2016-04-11' }),
      'competition',
    )
    expect(sig.leg.state).toBe('MEASURED')
    expect(sig.reading).toContain('Delivery orders only since the parent IDIQ award')
    expect(sig.reading).toContain('No competition has occurred on this item')
    // The measured lower bound is offered as a bound, and the parent's date is not invented.
    expect(sig.reading).toContain('2016-04-11')
    expect(sig.limitation).toContain('they do not date it')
    // ★ AND THE NUMBER IS GONE. The whole defect was a count reaching a sentence it did not
    // describe, so the sentence must not contain it.
    expect(sig.reading).not.toContain('3 bidders')
    expect(sig.reading).not.toContain('bidders')
    // Favourable, and correctly so: no competition since the parent is a stronger corner
    // signal than light competition, which is what made this defect so easy to miss.
    expect(sig.direction).toBe('favourable')
  })

  it('★ omits the bound rather than estimating it when no order date is on record', () => {
    const sig = find(
      summary({ latestOffers: 3, latestOffersDescribeThatAward: false, deliveryOrderOnly: true, earliestOrderIso: null }),
      'competition',
    )
    expect(sig.reading).toContain('No competition has occurred on this item')
    expect(sig.reading).not.toContain('earliest order')
    expect(sig.reading).not.toContain('null')
  })

  it('★ an inherited count ABSTAINS and says why, rather than falling silent', () => {
    /*
     * A mixed history whose LATEST award is a call against a vehicle. The count is visible in
     * the export, so a reader who can see it is told what it is instead of wondering where it
     * went. UNAVAILABLE, never a zero: a zero is a score and this is a refusal to score.
     */
    const sig = find(
      summary({
        latestOffers: 4,
        latestOffersDescribeThatAward: false,
        deliveryOrderOnly: false,
        latest: award({ contractNo: 'SPE7MX15D0070', deliveryOrder: 'F001', offers: 4, solicitation: 'S1' }),
      }),
      'competition',
    )
    expect(sig.leg.state).toBe('UNAVAILABLE')
    expect(sig.direction).toBe('neutral')
    expect(sig.reading).toContain('belongs to the parent contract')
    expect(sig.reading).not.toContain('bidders')
  })

  it('reads a long term contract expiry', () => {
    const sig = find(summary({ ltcExpirationIso: '2031-01-04' }), 'ltc_expiry')
    expect(sig.leg.state).toBe('MEASURED')
    expect(sig.direction).toBe('favourable')
    expect(sig.reading).toContain('2031-01-04')
  })

  it('POSITIVE CONTROL: a column with nothing in it still abstains, so nothing is always-on', () => {
    expect(find(summary({ ltcExpirationIso: null }), 'ltc_expiry').leg.state).toBe('UNAVAILABLE')
  })
})

describe('acquisition codes decide who may supply, and say which kind of good news it is', () => {
  it('a competitive method reads as an open buy', () => {
    const sig = find(summary({ amc: '1', amsc: 'G' }), 'dealer_eligibility')
    expect(sig.leg.state).toBe('MEASURED')
    expect(sig.direction).toBe('favourable')
    expect(sig.reading).toContain('Open buy')
  })

  it('a restrictive method with a closed suffix reads as the corner, not as a rejection', () => {
    const sig = find(summary({ amc: '4', amsc: 'D' }), 'dealer_eligibility')
    expect(sig.leg.state).toBe('MEASURED')
    expect(sig.direction).toBe('favourable')
    // The words and the verdict have to agree. An earlier version said "directs acquisition to
    // the manufacturer" on a row labelled favourable, which read as a contradiction.
    expect(sig.reading).toContain('Closed to new manufacture')
    expect(sig.reading).not.toContain('Open buy')
  })

  it('absent codes abstain rather than defaulting either way', () => {
    const sig = find(summary({ amc: null, amsc: null }), 'dealer_eligibility')
    expect(sig.leg.state).toBe('UNAVAILABLE')
    expect(sig.direction).toBe('neutral')
  })
})

describe('a dormancy reading always carries the window it was measured in', () => {
  it('states the feed span alongside the gap', () => {
    const sig = find(summary({ longestDemandGapYears: 6.2 }), 'demand_gap')
    expect(sig.leg.state).toBe('MEASURED')
    expect(sig.direction).toBe('favourable')
    expect(sig.limitation).toContain('2016')
    expect(sig.limitation).toContain('2026')
  })

  it('a short gap is measured but not favourable, so the direction is not just "we found a number"', () => {
    const sig = find(summary({ longestDemandGapYears: 1.5 }), 'demand_gap')
    expect(sig.leg.state).toBe('MEASURED')
    expect(sig.direction).toBe('neutral')
  })

  it('abstains when there are not two dated awards to measure between', () => {
    expect(find(summary({ longestDemandGapYears: null }), 'demand_gap').leg.state).toBe('UNAVAILABLE')
  })
})

describe('the approved-source count is the first half of the corner thesis', () => {
  it('one approved source is favourable and says what it means', () => {
    const s = summary({
      approvedSources: [
        { nsn: 'x', company: 'A', cage: '1', partNumber: 'p', amc: '4', amsc: 'D', prints: null, rncc: null, rnvc: null, assignDateIso: null, munitions: null },
      ],
    })
    const sig = find(s, 'approved_sources')
    expect(sig.direction).toBe('favourable')
    expect(sig.reading).toContain('One approved source')
    // and it must not overclaim that anything is physically available
    expect(sig.limitation).toContain('not a statement')
  })

  it('no approved source row abstains rather than reporting zero sources', () => {
    const sig = find(summary({ approvedSources: [] }), 'approved_sources')
    expect(sig.leg.state).toBe('UNAVAILABLE')
    expect(sig.reading).not.toContain('0 approved')
  })
})

describe('the tally counts, and deliberately does not score', () => {
  it('counts direction and evidence state separately', () => {
    const s = summary({ amc: '1', amsc: 'G', latestDeliveryDays: 15, longestDemandGapYears: 6 })
    const t = tallyQuoteSignals(readQuoteSignals(s, WINDOW))
    expect(t.total).toBe(9)
    expect(t.favourable).toBeGreaterThan(0)
    expect(t.measuredCount + t.unavailableCount).toBeLessThanOrEqual(t.total)
  })

  it('a summary with nothing readable yields zero favourable and does not crash', () => {
    const t = tallyQuoteSignals(readQuoteSignals(summary({ awards: [], latest: null }), WINDOW))
    expect(t.favourable).toBe(0)
    expect(t.unavailableCount).toBe(9)
  })

  it('every signal carries a plain-language reading, never an empty slot', () => {
    for (const sig of readQuoteSignals(summary({ amc: '1', amsc: 'G' }), WINDOW)) {
      expect(sig.reading.length, `${sig.id} has no reading`).toBeGreaterThan(10)
      expect(sig.leg.because.length, `${sig.id} has no because`).toBeGreaterThan(5)
    }
  })
})
