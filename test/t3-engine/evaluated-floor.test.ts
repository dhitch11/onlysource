/**
 * THE FLOOR ARM. Part I para 3(b) lists THREE price evaluation factors, and the third, Buy
 * American / Balance of Payments, states no dollar amount in the solicitation text.
 *
 * WHY THIS ARM EXISTS, stated as the failure it prevents. When the adder code set was a closed
 * union of the two factors we can price, the third factor could not be CONSTRUCTED. So it was not
 * abstained on and it was not flagged: it was ABSENT, and an absent factor reads on every screen
 * as "does not apply". The module returned a confident total that was quietly too low, which
 * overstates our competitiveness on a price-alone evaluation and loses the award while every
 * number on screen looks right.
 *
 * THE INSTRUMENT IS BUILT TO FAIL. Every expected figure below is hand-computed and written out
 * as a literal. The negative control at the end proves the floor arm is not simply always
 * returned, which is the assertion that would otherwise pass against an implementation that had
 * given up and floored everything.
 */

import { describe, expect, it } from 'vitest'
import {
  KNOWN_ADDER_CODES,
  comparisonFigure,
  evaluatedTotal,
  quotedTotal,
  type EvaluatedTotalOutcome,
} from '@/lib/engine/pricing'
import { PRICING_CONFIG } from '@/lib/engine/pricing/config'

// An instant inside the dated window every factor in the config is in force for.
const AT = Date.UTC(2026, 7, 13, 15, 0, 0)

// 10 units at $817.20 = $8,172.00 exactly. Written out so the arithmetic below is checkable
// without running anything.
const QUOTED = quotedTotal(817.2, 10)
const QUOTED_TOTAL_USD = 8172

describe('the floor arm, when a factor applies and carries no amount in primary text', () => {
  const outcome = evaluatedTotal(
    QUOTED,
    {
      isUnusedFormerGovernmentSurplus: true,
      esaCoordinationCount: 0,
      buyAmericanOrBalanceOfPayments: true,
    },
    PRICING_CONFIG,
    AT,
  )

  it('returns the floor arm, not a total', () => {
    expect(outcome.kind).toBe('EVALUATED_FLOOR_AT_LEAST')
  })

  it('the floor is the quote plus only the factors that could be priced', () => {
    // $8,172.00 quote + $200.00 surplus factor = $8,372.00. The Buy American factor adds nothing
    // because no amount for it exists to add, which is exactly why this is a floor.
    if (outcome.kind !== 'EVALUATED_FLOOR_AT_LEAST') throw new Error('wrong arm')
    expect(outcome.atLeastUsd).toBe(8372)
    expect(outcome.quotedTotalUsd).toBe(QUOTED_TOTAL_USD)
  })

  it('carries NO evaluatedTotalUsd, which is what makes the mistake impossible', () => {
    // The compile-time guarantee is the real one: a call site reaching for `.evaluatedTotalUsd`
    // on this arm does not build. This runtime assertion exists so the property is also visible
    // to a reader who is not running the type checker.
    expect(Object.prototype.hasOwnProperty.call(outcome, 'evaluatedTotalUsd')).toBe(false)
  })

  it('names the unpriced factor, rather than counting it', () => {
    if (outcome.kind !== 'EVALUATED_FLOOR_AT_LEAST') throw new Error('wrong arm')
    expect(outcome.unpricedFactors).toHaveLength(1)
    expect(outcome.unpricedFactors[0]?.code).toBe(
      KNOWN_ADDER_CODES.BUY_AMERICAN_BALANCE_OF_PAYMENTS,
    )
    expect(outcome.unpricedFactors[0]?.reason).toBe('NO_AMOUNT_IN_PRIMARY_TEXT')
  })

  it('cites the paragraph, quoting the text, and names the revision actually read', () => {
    if (outcome.kind !== 'EVALUATED_FLOOR_AT_LEAST') throw new Error('wrong arm')
    const c = outcome.unpricedFactors[0]?.citation
    expect(c?.grade).toBe('PRIMARY_TEXT')
    expect(c?.authority).toContain('para 3(b)(3)')
    expect(c?.authority).toContain('Revision 81')
    expect(c?.quote).toContain('Buy American statute or the Balance of Payments')
    // The revision named must be the one whose bytes are on disk, not one inherited from a digest.
    expect(c?.sourceFile).toContain('Rev-81')
  })

  it('states the DIRECTION the number is wrong in, because "approximately" is useless', () => {
    if (outcome.kind !== 'EVALUATED_FLOOR_AT_LEAST') throw new Error('wrong arm')
    expect(outcome.directionOfError).toBe('ACTUAL_IS_HIGHER_THAN_THIS')
    expect(outcome.sentence).toContain('At least')
    expect(outcome.sentence).toContain('HIGHER')
    // An operator must be told which way to lean, and it is always the pessimistic way.
    expect(outcome.sentence).toContain('less competitive')
  })

  it('still keeps the adders out of the recommended quote', () => {
    if (outcome.kind !== 'EVALUATED_FLOOR_AT_LEAST') throw new Error('wrong arm')
    expect(outcome.recommendedQuoteTotalUsd).toBe(QUOTED_TOTAL_USD)
    expect(outcome.addersAreIncludedInRecommendedQuote).toBe(false)
  })
})

describe('comparisonFigure, the one legal way a ranker reads the number', () => {
  it('reports isFloor true so a pursuit cannot be ranked on an understated price', () => {
    const floor = evaluatedTotal(
      QUOTED,
      {
        isUnusedFormerGovernmentSurplus: true,
        esaCoordinationCount: 0,
        buyAmericanOrBalanceOfPayments: true,
      },
      PRICING_CONFIG,
      AT,
    )
    const f = comparisonFigure(floor)
    expect(f).not.toBeNull()
    expect(f?.usd).toBe(8372)
    expect(f?.isFloor).toBe(true)
    expect(f?.unpricedFactorCodes).toEqual([KNOWN_ADDER_CODES.BUY_AMERICAN_BALANCE_OF_PAYMENTS])
  })

  it('returns null on an abstention, so an abstention can never be ranked as a number', () => {
    const abstained = evaluatedTotal(
      QUOTED,
      { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: -1 },
      PRICING_CONFIG,
      AT,
    )
    expect(abstained.kind).toBe('EVALUATED_TOTAL_ABSTENTION')
    expect(comparisonFigure(abstained)).toBeNull()
  })
})

describe('NEGATIVE CONTROL: the floor is not simply always returned', () => {
  const plain: EvaluatedTotalOutcome = evaluatedTotal(
    QUOTED,
    { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: 0 },
    PRICING_CONFIG,
    AT,
  )

  it('without the third factor it is a real total, with the figure on the total field', () => {
    expect(plain.kind).toBe('EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND')
    if (plain.kind !== 'EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND') return
    // Same inputs as the floor case above, minus factor (3). $8,172 + $200 = $8,372.
    expect(plain.evaluatedTotalUsd).toBe(8372)
  })

  it('and comparisonFigure reports it as NOT a floor', () => {
    const f = comparisonFigure(plain)
    expect(f?.usd).toBe(8372)
    expect(f?.isFloor).toBe(false)
    expect(f?.unpricedFactorCodes).toEqual([])
  })

  it('an explicit false is treated as "does not apply", never as unknown', () => {
    const explicitlyFalse = evaluatedTotal(
      QUOTED,
      {
        isUnusedFormerGovernmentSurplus: true,
        esaCoordinationCount: 0,
        buyAmericanOrBalanceOfPayments: false,
      },
      PRICING_CONFIG,
      AT,
    )
    expect(explicitlyFalse.kind).toBe('EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND')
  })

  it('THE PAIR: one flag flips total to floor, and the priced part is identical', () => {
    // If this pair ever both returned the same arm, every other assertion in this file would be
    // passing against an implementation that ignores the flag entirely.
    const withFactor = evaluatedTotal(
      QUOTED,
      {
        isUnusedFormerGovernmentSurplus: true,
        esaCoordinationCount: 0,
        buyAmericanOrBalanceOfPayments: true,
      },
      PRICING_CONFIG,
      AT,
    )
    expect(plain.kind).not.toBe(withFactor.kind)
    expect(comparisonFigure(plain)?.usd).toBe(comparisonFigure(withFactor)?.usd)
    expect(comparisonFigure(plain)?.isFloor).toBe(false)
    expect(comparisonFigure(withFactor)?.isFloor).toBe(true)
  })
})
