/**
 * THE ANCHOR, AS THE QUOTE SCREEN WILL SEE IT.
 *
 * The engine's own suite already proves `anchorPrice` multiplies correctly. This file proves
 * something different and, until now, untested: that the arithmetic survives the trip through
 * the adapter a page consumes, still labelled, still two numbers, still refusing to reach the one
 * figure the doctrine says it must not reach.
 *
 * EVERY EXPECTATION BELOW WAS WORKED OUT BY HAND BEFORE THE CODE RAN:
 *
 *   1537.85 x 1.3223
 *     = 153785 x 1322300 / 10^6
 *     = 203,349,905,500 / 10^6 cents
 *     = 203,349.9055 cents
 *     = 2033.499055 dollars   ->  $2,033.50 to the cent
 *
 *   1537.85 x 1.40
 *     = 153785 x 14 / 10
 *     = 215,299 cents EXACTLY
 *     = 2152.99 dollars       ->  no rounding involved at all
 *
 * WHAT THIS FILE WILL NOT DO, and the reason is BD-17:
 *   It never asserts 2150.00 or 2034.00 as a computed value. Those are the expert's ROUNDINGS of
 *   the true products and his source text says "approximately". An assertion of 2150.00 passes
 *   against arithmetic that is wrong by $2.99 and fails against arithmetic that is right, which
 *   makes it worse than no test. The true product is asserted, and the rounding is asserted
 *   SEPARATELY, as a property of his sentence rather than of our arithmetic.
 */

import { describe, expect, it } from 'vitest'
import { buildQuoteView, type AnchorFigure } from '@/lib/intelligence/pricing'
import {
  OEM_AWARD_DATE_ISO,
  OEM_UNIT_PRICE_USD,
  PRICING_INSTANT_MS,
  referenceInput,
} from './_fixtures'

function anchorOf(view: ReturnType<typeof buildQuoteView>): Extract<AnchorFigure, { resolved: true }> {
  const figure = view.figures[0]
  if (figure.resolved !== true) {
    throw new Error(`expected a resolved anchor, got abstention ${figure.reason}`)
  }
  return figure
}

describe('the anchor figure carries the true products, not the expert rounding', () => {
  const view = buildQuoteView(referenceInput())
  const anchor = anchorOf(view)
  const [cpi, dod] = anchor.lines

  it('applies the CPI factor to the manufacturer award exactly', () => {
    expect(cpi.indexKind).toBe('cpi')
    expect(cpi.factor).toBe(1.3223)
    expect(cpi.exactUnitPriceUsd).toBe(2033.499055)
    expect(cpi.unitPriceUsd).toBe(2033.5)
  })

  it('applies the DoD procurement factor to the manufacturer award exactly', () => {
    expect(dod.indexKind).toBe('dod_procurement')
    expect(dod.factor).toBe(1.4)
    expect(dod.exactUnitPriceUsd).toBe(2152.99)
    expect(dod.unitPriceUsd).toBe(2152.99)
  })

  it('renders each line with arithmetic a person can retype into a calculator', () => {
    expect(cpi.arithmetic).toBe('1537.85 x 1.3223 = 2033.499055 (rounds to 2033.50)')
    expect(dod.arithmetic).toBe('1537.85 x 1.40 = 2152.99')
  })

  it('consumed the manufacturer award and says which one, dated, with its awardee', () => {
    expect(view.oemAward.identified).toBe(true)
    if (view.oemAward.identified) {
      expect(view.oemAward.unitPriceUsd).toBe(OEM_UNIT_PRICE_USD)
      expect(view.oemAward.awardDateIso).toBe(OEM_AWARD_DATE_ISO)
      expect(view.oemAward.awardYear).toBe(2017)
      expect(view.oemAward.method).toBe('EARLIEST_AWARD_TO_AN_APPROVED_SOURCE_WITHIN_THE_FEED_WINDOW')
      // The claim is bounded by the feed, and the limitation has to say so out loud rather than
      // letting "earliest observed" read as "the original".
      expect(view.oemAward.limitation).toContain('earliest OBSERVED manufacturer')
    }
  })

  it('never reports one anchor number, and grades the estimate below its measured input', () => {
    expect(anchor.lines).toHaveLength(2)
    expect(cpi.indexKind).not.toBe(dod.indexKind)
    // A measured award price times a stated judgement is an estimate however precise it looks.
    expect(anchor.evidenceState).toBe('ESTIMATED')
    expect(cpi.factorEvidenceState).toBe('PRIOR')
    expect(dod.factorEvidenceState).toBe('PRIOR')
    expect(Object.prototype.hasOwnProperty.call(anchor, 'unitPriceUsd')).toBe(false)
  })

  it('prefers the DoD line and carries the stated reason for preferring it', () => {
    expect(anchor.preferredIndexKind).toBe('dod_procurement')
    expect(dod.preferred).toBe(true)
    expect(cpi.preferred).toBe(false)
    expect(dod.preferenceRationale).toContain('industrial, metals, and logistics cost growth')
  })
})

describe('the expert rounding is reconciled, never asserted as the computed value', () => {
  const anchor = anchorOf(buildQuoteView(referenceInput()))
  const [cpi, dod] = anchor.lines

  it('records his $2,034 beside the true 2033.499055 and states the gap', () => {
    expect(cpi.statedApproximation).not.toBeNull()
    expect(cpi.statedApproximation?.statedUsd).toBe(2034)
    expect(cpi.statedApproximation?.statedVerbatim).toBe('approximately $2,034')
    // 2034 - 2033.499055 = 0.500945. He rounded UP, past what nearest-dollar would give.
    expect(cpi.statedApproximation?.deltaUsd).toBeCloseTo(0.500945, 9)
    expect(cpi.unitPriceUsd).not.toBe(2034)
  })

  it('records his $2,150 beside the true 2152.99 and states the gap', () => {
    expect(dod.statedApproximation?.statedUsd).toBe(2150)
    expect(dod.statedApproximation?.statedVerbatim).toBe('approximately $2,150')
    // 2150 - 2152.99 = -2.99. He rounded DOWN, and by nearly three dollars.
    expect(dod.statedApproximation?.deltaUsd).toBeCloseTo(-2.99, 9)
    expect(dod.unitPriceUsd).not.toBe(2150)
  })

  it('proves the two figures come from no single rounding convention', () => {
    // Worked by hand from 2033.499055: ceil gives 2034, nearest-dollar gives 2033, nearest-ten
    // gives 2030. Only ceiling reaches his figure.
    expect(cpi.statedApproximation?.reproducibleByRoundingRules).toEqual(['ceil_to_dollar'])
    // Worked by hand from 2152.99: nearest-ten gives 2150, nearest-fifty gives 2150,
    // nearest-dollar gives 2153, ceiling gives 2153.
    expect(dod.statedApproximation?.reproducibleByRoundingRules).toEqual([
      'nearest_10_dollars',
      'nearest_50_dollars',
    ])
    const shared = (cpi.statedApproximation?.reproducibleByRoundingRules ?? []).filter((r) =>
      (dod.statedApproximation?.reproducibleByRoundingRules ?? []).includes(r),
    )
    // No convention produces both, which is the finding: they were written by hand and must
    // never be treated as reproducible outputs of the engine.
    expect(shared).toEqual([])
  })

  it('does not attach his worked example to a different stock number', () => {
    const other = anchorOf(
      buildQuoteView(referenceInput({ nsn: '1650-01-999-9999' })),
    )
    for (const line of other.lines) expect(line.statedApproximation).toBeNull()
  })
})

describe('the four figures never collapse into one', () => {
  const view = buildQuoteView(referenceInput())

  it('exposes exactly four figures in a fixed order', () => {
    expect(view.figures).toHaveLength(4)
    expect(view.figures.map((f) => f.figureId)).toEqual([
      'ANCHOR',
      'RECENT_FLIP_BAND',
      'EVALUATED_PRICE',
      'TRIPWIRE_BAND',
    ])
  })

  it('carries no blended headline number anywhere on the payload', () => {
    for (const key of Object.keys(view)) {
      expect(key).not.toMatch(/headline|recommendedQuote|blended/i)
    }
    // 2093.2445275 is the mean of 2033.499055 and 2152.99. If any average had leaked in, it
    // would carry exactly this value.
    const blend = 2093.2445275
    const found: number[] = []
    const walk = (v: unknown): void => {
      if (typeof v === 'number') found.push(v)
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(view)
    expect(found).not.toContain(blend)
    expect(found).not.toContain(2093.24)
  })

  it('states in words that no single recommended quote is published', () => {
    expect(view.doctrineNotice).toContain('no single blended')
    expect(view.basis.note).toContain('publishes no single recommended quote')
  })

  it('prices at the instant it was given and never at the wall clock', () => {
    expect(view.atInstantMs).toBe(PRICING_INSTANT_MS)
  })
})
