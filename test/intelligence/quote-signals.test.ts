import { describe, expect, it } from 'vitest'
import { readQuoteSignals, tallyQuoteSignals } from '@/lib/intelligence/scoring/quote-signals'
import type { AwardRecord, FeedWindow, NsnAwardSummary } from '@/lib/intelligence/awards/nsn-now'

/**
 * THE QUOTE CHECKLIST, AND THE TWO SIGNALS THAT MUST STAY WITHHELD.
 *
 * The load-bearing test in this file is the one that asserts a signal is NOT shown. The export's
 * `Offers` column is contaminated on 25.0% of rows and `LTC Expiration` on 35.2%, both measured
 * across all 59,990 procurement rows, and both were rendering plausible-looking figures ("9114
 * bidders on the last award") before anybody counted. A future edit that "fixes" the abstention by
 * reading the value again would reintroduce a number that is wrong one time in four, in front of
 * somebody deciding what to bid. So the abstention is pinned here, with the reason.
 *
 * Every abstention is paired with a POSITIVE CONTROL: a signal that DOES read, from the same
 * fixture, so a module that returned UNAVAILABLE for everything would fail this suite rather than
 * pass it.
 */

const WINDOW: FeedWindow = { firstAwardIso: '2016-01-04', lastAwardIso: '2026-02-01', years: 10 }

const award = (over: Partial<AwardRecord> & { contractNo: string }): AwardRecord => ({
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
  ...over,
})

const summary = (over: Partial<NsnAwardSummary> = {}): NsnAwardSummary => ({
  nsn: '5325015619853',
  awards: [award({ contractNo: 'C1', awardDateIso: '2018-01-01' })],
  latest: award({ contractNo: 'C1', awardDateIso: '2018-01-01' }),
  distinctAwardees: 1,
  firstUnitPrice: 10,
  lastUnitPrice: 20,
  holders: [],
  amc: null,
  amsc: null,
  latestOffers: null,
  minOffers: null,
  latestDeliveryDays: null,
  longestDemandGapYears: null,
  yearsSinceLastAward: null,
  approvedSources: [],
  ltcExpirationIso: null,
  ...over,
})

const find = (s: NsnAwardSummary, id: string) => readQuoteSignals(s, WINDOW).find((x) => x.id === id)!

describe('the contaminated columns stay withheld, whatever the row says', () => {
  it('never reports a bid count, even when the export carries one', () => {
    const sig = find(summary({ latestOffers: 2 }), 'competition')
    expect(sig.leg.state).toBe('UNAVAILABLE')
    expect(sig.leg.value).toBeNull()
    expect(sig.reading).toContain('Withheld')
    // The refusal states the measured rate, so a reader can judge it rather than trust us.
    expect(sig.leg.because).toContain('25.0%')
  })

  it('never reports a bid count when the export carries an absurd one either', () => {
    const sig = find(summary({ latestOffers: 9114 }), 'competition')
    expect(sig.leg.state).toBe('UNAVAILABLE')
    expect(sig.direction).toBe('neutral')
  })

  it('never reports a long term contract expiry, even when a date is present', () => {
    const sig = find(summary({ ltcExpirationIso: '2031-01-04' }), 'ltc_expiry')
    expect(sig.leg.state).toBe('UNAVAILABLE')
    expect(sig.reading).toContain('Withheld')
    expect(sig.leg.because).toContain('35.2%')
  })

  it('POSITIVE CONTROL: a clean column DOES read, so the module is not abstaining on everything', () => {
    const sig = find(summary({ latestDeliveryDays: 21 }), 'urgency')
    expect(sig.leg.state).toBe('MEASURED')
    expect(sig.leg.value).toBe(21)
    expect(sig.direction).toBe('favourable')
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
