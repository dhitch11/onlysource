/**
 * SHELF VALUATION. The tests defend one property above all others: a floor can never be
 * read as a total.
 *
 * That property exists because a third evaluation factor was verified in primary text with
 * NO stated dollar amount, which makes the factor set open. Any figure computed while an
 * applicable factor cannot be priced is a lower bound, and rendering a lower bound as a total
 * understates what the buyer compares us against. On a price-alone evaluation that loses the
 * award while every number on the screen looks right.
 */

import { describe, expect, it } from 'vitest'
import {
  valuePosition,
  summarizePortfolio,
  fillableAtFloor,
  type PricingPort,
  type ShelfPosition,
  type UnpricedFactor,
} from '@/lib/intelligence/shelf'

const BUY_AMERICAN: UnpricedFactor = {
  name: 'Buy American statute or Balance of Payments Program factor',
  reason: 'the governing clause states no dollar amount for this factor',
  citation: 'Master Solicitation Part I 3(b)(3), referencing DFARS 225.502(c)',
}

const position = (over: Partial<ShelfPosition> = {}): ShelfPosition => ({
  positionId: 'P1',
  niin: '010598221',
  holderKind: 'org_own',
  holderCage: null,
  quantity: 8,
  costBasisUsd: 8172,
  fillableNiins: [],
  evidenceClassFloor: 'strong_lead',
  ...over,
})

const anchored = {
  kind: 'anchored' as const,
  anchorUsd: 2153,
  method: 'original manufacturer award price adjusted forward',
  comparisonSet: 'prior awards for this stock number',
  horizonMonths: 24,
  asOf: '2026-08-13',
}

const port = (over: Partial<PricingPort> = {}): PricingPort => ({
  anchorFor: () => anchored,
  evaluatedFor: () => ({
    kind: 'total',
    evaluatedTotalUsd: 17_424,
    quotedTotalUsd: 17_224,
    appliedFactors: [{ name: 'unused former Government surplus', amountUsd: 200 }],
  }),
  ...over,
})

describe('a floor is never a total', () => {
  it('marks the valuation as a floor when an applicable factor cannot be priced', () => {
    const v = valuePosition(
      position(),
      port({
        evaluatedFor: () => ({
          kind: 'floor',
          atLeastUsd: 17_424,
          quotedTotalUsd: 17_224,
          appliedFactors: [{ name: 'unused former Government surplus', amountUsd: 200 }],
          unpricedFactors: [BUY_AMERICAN],
        }),
      }),
    )
    expect(v.valueState).toBe('floor')
    expect(v.unpricedFactors).toHaveLength(1)
  })

  it('names the unpriced factor in the gaps rather than hedging', () => {
    const v = valuePosition(
      position(),
      port({
        evaluatedFor: () => ({
          kind: 'floor',
          atLeastUsd: 1,
          quotedTotalUsd: 1,
          appliedFactors: [],
          unpricedFactors: [BUY_AMERICAN],
        }),
      }),
    )
    expect(v.gaps.join(' ')).toContain('Buy American')
    expect(v.gaps.join(' ')).toContain('no resolvable amount')
  })

  it('says AT LEAST in the rendered sentence, and says which direction it is wrong in', () => {
    const v = valuePosition(
      position(),
      port({
        evaluatedFor: () => ({
          kind: 'floor',
          atLeastUsd: 1,
          quotedTotalUsd: 1,
          appliedFactors: [],
          unpricedFactors: [BUY_AMERICAN],
        }),
      }),
    )
    expect(v.statement).toContain('At least')
    expect(v.statement).toContain('higher')
  })

  it('does NOT mark a clean valuation as a floor, so the flag is not always on', () => {
    const v = valuePosition(position(), port())
    expect(v.valueState).toBe('modelled')
    expect(v.unpricedFactors).toHaveLength(0)
    expect(v.statement).toContain('not a measurement')
  })
})

describe('the anchor is T3s, and its absence abstains rather than guessing', () => {
  it('shows the cost basis and abstains on value when the anchor is missing', () => {
    const v = valuePosition(
      position(),
      port({ anchorFor: () => ({ kind: 'abstained', reason: 'no prior award for this item' }) }),
    )
    expect(v.modelledValueUsd).toBeNull()
    expect(v.valueState).toBe('insufficient')
    expect(v.costBasisUsd).toBe(8172)
    expect(v.statement).toContain('cost basis only')
    expect(v.gaps.join(' ')).toContain('no prior award')
  })

  it('says so plainly when neither an anchor nor a cost basis exists', () => {
    const v = valuePosition(
      position({ costBasisUsd: null }),
      port({ anchorFor: () => ({ kind: 'abstained', reason: 'unavailable' }) }),
    )
    expect(v.statement).toContain('No value can be shown')
  })

  it('carries the four things a modelled figure must show or not render', () => {
    const v = valuePosition(position(), port())
    expect(v.basis?.method).toBeTruthy()
    expect(v.basis?.comparisonSet).toBeTruthy()
    expect(v.basis?.horizonMonths).toBe(24)
    expect(v.basis?.asOf).toBe('2026-08-13')
  })
})

describe('holdings', () => {
  it('flags an unrecorded holder rather than counting the stock as ours', () => {
    const v = valuePosition(position({ holderKind: 'unknown' }), port())
    expect(v.gaps.join(' ')).toContain('not on record')
  })

  it('filters what a position can fill by the operators chosen risk appetite', () => {
    const p = position({
      evidenceClassFloor: 'near_conclusive',
      fillableNiins: [
        { niin: 'A', evidenceClass: 'conclusive' },
        { niin: 'B', evidenceClass: 'near_conclusive' },
        { niin: 'C', evidenceClass: 'strong_lead' },
        { niin: 'D', evidenceClass: 'weak_lead' },
      ],
    })
    // The floor is a control on the screen, not a constant, so raising it must drop rows.
    expect(fillableAtFloor(p)).toEqual(['A', 'B'])
    expect(fillableAtFloor({ ...p, evidenceClassFloor: 'weak_lead' })).toHaveLength(4)
  })
})

describe('the portfolio total inherits the floor', () => {
  const clean = valuePosition(position(), port())
  const floored = valuePosition(
    position({ positionId: 'P2' }),
    port({
      evaluatedFor: () => ({
        kind: 'floor',
        atLeastUsd: 1,
        quotedTotalUsd: 1,
        appliedFactors: [],
        unpricedFactors: [BUY_AMERICAN],
      }),
    }),
  )
  const unvalued = valuePosition(
    position({ positionId: 'P3' }),
    port({ anchorFor: () => ({ kind: 'abstained', reason: 'none' }) }),
  )

  it('makes the whole portfolio a floor when any single position is one', () => {
    expect(summarizePortfolio([clean, floored]).totalIsFloor).toBe(true)
    expect(summarizePortfolio([clean]).totalIsFloor).toBe(false)
  })

  it('counts unvalued positions separately instead of summing them as zero', () => {
    const s = summarizePortfolio([clean, floored, unvalued])
    expect(s.positions).toBe(3)
    expect(s.valued).toBe(2)
    expect(s.unvalued).toBe(1)
    // The defect this defends: an unknown quietly summed as zero understates the portfolio
    // and looks like a complete total, which is the same failure as a measured zero over an
    // unwritten column, one level up.
    expect(s.modelledTotalUsd).toBe(clean.modelledValueUsd! + floored.modelledValueUsd!)
  })
})
