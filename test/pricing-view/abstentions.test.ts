/**
 * ABSTENTION IS THE COMMON CASE, AND IT MUST NEVER DEGRADE INTO A NUMBER.
 *
 * The anchor's required input is the ORIGINAL manufacturer award. Measured over the live NSN-Now
 * feed on 2026-08-18: of 2,514 stock numbers carrying award history, 818 have any award to a
 * company on their approved-source list, and 49 have that award in 2017, the base year the only
 * two inflation factors on file are stated for. So the ordinary live row cannot anchor, and what
 * it gets instead has to be a NAMED abstention carrying the missing input.
 *
 * THE FAILURE THIS FILE EXISTS TO PREVENT is not an ugly empty state. It is the tempting fix:
 * falling back to the most recent surplus flip when the manufacturer award is missing. Those
 * flips run at roughly half the inflation-adjusted manufacturer value, so a fallback would
 * understate the item by about the whole margin the business harvests, and it would do it while
 * every figure on the screen looked confident. The flips are also contaminated by exactly the
 * overcharging this product exists to detect, which makes them the worst possible anchor.
 *
 * So the tests below check two things on every abstention: that it names what is missing, and
 * that the abstained arm carries NO NUMBER OF ANY KIND for a page to accidentally render.
 */

import { describe, expect, it } from 'vitest'
import { buildQuoteView, identifyOemAward } from '@/lib/intelligence/pricing'
import { PRICING_INSTANT_MS, noManufacturerAwardInput, referenceInput } from './_fixtures'

/** No numeric field anywhere on the arm, however deep. A page cannot render what is not there. */
function everyNumberIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value)
  else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) everyNumberIn(child, out)
  }
  return out
}

describe('a row with no identifiable manufacturer award abstains and never guesses', () => {
  const input = noManufacturerAwardInput()
  const view = buildQuoteView(input)
  const anchor = view.figures[0]

  it('names the missing input rather than reporting insufficient data', () => {
    expect(anchor.resolved).toBe(false)
    if (anchor.resolved !== false) return
    expect(anchor.reason).toBe('NO_MANUFACTURER_AWARD_IDENTIFIED')
    expect(anchor.missingInput).toContain('approved-source list')
    expect(view.oemAward.identified).toBe(false)
    if (!view.oemAward.identified) {
      expect(view.oemAward.reason).toBe('NO_AWARD_TO_AN_APPROVED_SOURCE')
    }
  })

  it('carries no number at all on the abstained arm', () => {
    expect(everyNumberIn(anchor)).toEqual([])
  })

  it('does not fall back to a resale price, which is the whole point', () => {
    /*
     * 640 and 1990 are the two resale prices in the fixture. They BELONG on the resale band,
     * which is figure two, and that is the only place they may appear. The check is scoped to
     * everything else: the anchor, the basis, the evaluated price and the tripwire. A version of
     * this test that swept the whole view would have failed on the band's own honest reporting,
     * which is why the scope is stated rather than assumed.
     */
    const elsewhere = everyNumberIn({
      anchor: view.figures[0],
      evaluated: view.figures[2],
      tripwire: view.figures[3],
      basis: view.basis,
      oemAward: view.oemAward,
    })
    for (const contaminated of [640, 1990, 640 * 1.3223, 640 * 1.4, 1990 * 1.3223, 1990 * 1.4]) {
      expect(elsewhere).not.toContain(contaminated)
    }
    expect(view.basis.kind).toBe('NONE')
  })

  it('collapses the two dependent figures too, rather than pricing off nothing', () => {
    const evaluated = view.figures[2]
    const tripwire = view.figures[3]
    expect(evaluated.resolved).toBe(false)
    expect(tripwire.resolved).toBe(false)
    if (evaluated.resolved === false) expect(evaluated.reason).toBe('NO_BASIS_UNIT_PRICE')
    if (tripwire.resolved === false) expect(tripwire.reason).toBe('NO_BASIS_UNIT_PRICE')
  })

  it('still reports the resale band, labelled as contaminated and not a recommendation', () => {
    const band = view.figures[1]
    expect(band.resolved).toBe(true)
    if (band.resolved !== true) return
    expect(band.lowUnitPriceUsd).toBe(640)
    expect(band.highUnitPriceUsd).toBe(1990)
    expect(band.limitation).toContain('CONTAMINATED BY CONSTRUCTION')
    expect(band.limitation).toContain('never a recommendation')
    // Every observation says WHY it was counted as secondary, so the classification is auditable.
    expect(band.observations.map((o) => o.whyCountedAsSecondary)).toEqual([
      'AWARDEE_NOT_ON_THE_APPROVED_SOURCE_LIST',
      'AWARDEE_NOT_ON_THE_APPROVED_SOURCE_LIST',
    ])
  })

  it('lists the abstentions as named gaps', () => {
    expect(view.gaps.join(' | ')).toContain('manufacturer award not identified')
    expect(view.gaps.some((g) => g.startsWith('ANCHOR abstained'))).toBe(true)
  })
})

describe('the award year must match the factor vintage, or there is no anchor', () => {
  // The same manufacturer award, moved to 2023. Nothing else changes.
  const view = buildQuoteView(
    referenceInput({
      awards: referenceInput().awards.map((a) =>
        a.contractNo === 'FIXTURE-OEM-1' ? { ...a, awardDateIso: '2023-04-11' } : a,
      ),
    }),
  )
  const anchor = view.figures[0]

  it('identifies the award but refuses to inflate it with a factor for another year', () => {
    expect(view.oemAward.identified).toBe(true)
    expect(anchor.resolved).toBe(false)
    if (anchor.resolved !== false) return
    expect(anchor.reason).toBe('NO_INFLATION_FACTOR_FOR_THE_AWARD_YEAR')
    expect(anchor.missingInput).toContain('base year of 2023')
    expect(anchor.missingInput).toContain('published series')
    expect(anchor.sentence).toContain('2017')
  })

  it('carries no number on that arm either, so nothing can be rendered from it', () => {
    expect(everyNumberIn(anchor)).toEqual([])
  })
})

describe('an undeclared evaluation-factor applicability abstains rather than assuming no', () => {
  it('will not read silence about our own material as "the $200 factor does not apply"', () => {
    const view = buildQuoteView(referenceInput())
    const evaluated = view.figures[2]
    expect(evaluated.resolved).toBe(false)
    if (evaluated.resolved !== false) return
    expect(evaluated.reason).toBe('SURPLUS_OFFER_STATUS_UNDECLARED')
    expect(evaluated.missingInput).toContain('unused former Government surplus')
    expect(everyNumberIn(evaluated)).toEqual([])
  })

  it('treats a declared "no" as a real answer and computes with it', () => {
    const view = buildQuoteView(
      referenceInput({
        offeringUnusedFormerGovernmentSurplus: false,
        esaCoordinationCount: 0,
      }),
    )
    const evaluated = view.figures[2]
    expect(evaluated.resolved).toBe(true)
    if (evaluated.resolved !== true || evaluated.kind !== 'TOTAL') throw new Error('expected a total')
    // No factor applies, so the evaluated total equals the quoted total. Declared zero and
    // unknown produce visibly different outcomes, which is the whole distinction.
    expect(evaluated.quotedTotal.usd).toBe(17223.92)
    expect(evaluated.evaluatedTotal.usd).toBe(17223.92)
    expect(evaluated.adders).toEqual([])
  })

  it('abstains separately on the ESA count, because zero and unknown are different facts', () => {
    const view = buildQuoteView(
      referenceInput({ offeringUnusedFormerGovernmentSurplus: true }),
    )
    const evaluated = view.figures[2]
    expect(evaluated.resolved).toBe(false)
    if (evaluated.resolved !== false) return
    expect(evaluated.reason).toBe('ESA_COORDINATION_COUNT_UNDECLARED')
  })
})

describe('a blank surplus column is never read as "this material was new"', () => {
  it('classifies by the approved-source list, not by the absence of a surplus flag', () => {
    // Every award in this fixture has surplusAsWorded null, which is the ordinary case: the live
    // export states surplus on 311 of 42,698 rows. The manufacturer award is still identified,
    // and it is identified by MEMBERSHIP of the approved-source list.
    const input = referenceInput({
      awards: referenceInput().awards.map((a) => ({ ...a, surplusAsWorded: null })),
    })
    const oem = identifyOemAward(input)
    expect(oem.identified).toBe(true)
    if (!oem.identified) return
    expect(oem.unitPriceUsd).toBe(1537.85)
    expect(oem.limitation).toContain('blank surplus column was treated as unread')
  })

  it('does not promote a dealer award just because its surplus column is empty', () => {
    const input = referenceInput({
      approvedSourceCages: [],
      awards: referenceInput().awards.map((a) => ({ ...a, surplusAsWorded: null })),
    })
    const oem = identifyOemAward(input)
    expect(oem.identified).toBe(false)
    if (oem.identified) return
    expect(oem.reason).toBe('NO_APPROVED_SOURCE_LIST')
  })

  it('refuses to call every awardee a dealer when the approved-source list is empty', () => {
    const view = buildQuoteView(
      referenceInput({
        approvedSourceCages: [],
        awards: referenceInput().awards.map((a) => ({ ...a, surplusAsWorded: null })),
      }),
    )
    const band = view.figures[1]
    expect(band.resolved).toBe(false)
    if (band.resolved !== false) return
    expect(band.reason).toBe('CANNOT_CLASSIFY_SECONDARY_WITHOUT_AN_APPROVED_SOURCE_LIST')
    expect(band.sentence).toContain('An empty approved-source list is a silence')
    expect(everyNumberIn(band)).toEqual([])
  })
})

describe('the tripwire abstains when the prior price is outside the regulation window', () => {
  it('names the window and the date of the most recent award it found', () => {
    // The pricing instant moves forward two years; nothing else changes, so every award falls
    // out of the trailing twelve months.
    const view = buildQuoteView(
      referenceInput({
        atInstantMs: Date.UTC(2028, 0, 29),
        offeringUnusedFormerGovernmentSurplus: true,
        esaCoordinationCount: 0,
      }),
    )
    const tripwire = view.figures[3]
    expect(tripwire.resolved).toBe(false)
    if (tripwire.resolved !== false) return
    expect(tripwire.reason).toBe('PRIOR_PRICE_OUTSIDE_TRAILING_12_MONTHS')
    expect(tripwire.missingInput).toContain('2028-01-29')
    expect(tripwire.missingInput).toContain('2025-06-02')
    expect(tripwire.sentence).toContain('fabricated all-clear')
    expect(everyNumberIn(tripwire)).toEqual([])
  })

  it('is the same instant-driven behaviour, not a wall-clock read', () => {
    const view = buildQuoteView(
      referenceInput({ offeringUnusedFormerGovernmentSurplus: true, esaCoordinationCount: 0 }),
    )
    expect(view.atInstantMs).toBe(PRICING_INSTANT_MS)
    expect(view.figures[3].resolved).toBe(true)
  })
})
