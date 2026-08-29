/**
 * QUOTED TOTAL AND EVALUATED TOTAL ARE DIFFERENT TYPES, AND THE COMPILER ENFORCES IT.
 *
 * BD-18. The $200 (unused former Government surplus) and $600 (CSI surplus evaluation by each
 * ESA) figures are DLA's EVALUATION factors, added by the buyer to our total to form the number
 * it compares against competitors. They are not part of the quote we send and they are not a cost
 * we pay. An operator who folds them into the price quotes $600 too high and loses exactly the
 * low-value lines where the factor already dominates the total.
 *
 * WHY A TYPE NAME WAS NOT ENOUGH, which is the point of this file.
 * The engine separates `QuotedTotal` from `EvaluatedTotal` by name, and that is real protection
 * against reaching for the wrong object. It is NO protection against the arithmetic: both expose
 * plain `number` fields, so `quoted.totalUsd + evaluated.evaluatedTotalUsd` compiles, runs, and
 * produces a confident wrong dollar figure. A branded number would not have helped either;
 * TypeScript adds two branded numbers happily and hands back a plain `number`.
 *
 * So the view hands out OBJECTS. Summing them is a type error, and the `@ts-expect-error` below
 * is a POSITIVE CONTROL that fires at `npm run typecheck`: if anyone ever flattens these back to
 * numbers, the suppression becomes unused and the type check FAILS with TS2578. It is checked in
 * this file rather than in a comment because a comment cannot fail a build.
 */

import { describe, expect, it } from 'vitest'
import { buildQuoteView } from '@/lib/intelligence/pricing'
import { DECLARED_OFFER, referenceInput } from './_fixtures'

const view = buildQuoteView(referenceInput({ ...DECLARED_OFFER }))
const evaluated = view.figures[2]

describe('the evaluated figure separates what we send from what the buyer compares', () => {
  it('resolves to a total once the operator declares the two things only they know', () => {
    expect(evaluated.resolved).toBe(true)
    if (evaluated.resolved !== true) return
    expect(evaluated.kind).toBe('TOTAL')
  })

  it('quotes 2152.99 x 8 = 17223.92 and never adds the buyer factors to it', () => {
    if (evaluated.resolved !== true || evaluated.kind !== 'TOTAL') throw new Error('expected a total')
    // Hand-computed: 215299 cents x 8 = 1,722,392 cents.
    expect(evaluated.quotedTotal.usd).toBe(17223.92)
    expect(evaluated.quotedTotal.kind).toBe('QUOTED_TOTAL_WHAT_WE_SEND')
  })

  it('evaluates at 17223.92 + 200 + 600 = 18023.92, a different number with a different kind', () => {
    if (evaluated.resolved !== true || evaluated.kind !== 'TOTAL') throw new Error('expected a total')
    expect(evaluated.evaluatedTotal.usd).toBe(18023.92)
    expect(evaluated.evaluatedTotal.kind).toBe(
      'EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND',
    )
    expect(evaluated.adderTotalUsd).toBe(800)
    // The gap between the two figures is exactly the adders and nothing else.
    expect(evaluated.evaluatedTotal.usd - evaluated.quotedTotal.usd).toBeCloseTo(800, 10)
    expect(evaluated.quotedTotal.kind).not.toBe(evaluated.evaluatedTotal.kind)
  })

  it('names each factor with the primary text it came from', () => {
    if (evaluated.resolved !== true || evaluated.kind !== 'TOTAL') throw new Error('expected a total')
    const codes = evaluated.adders.map((a) => a.code)
    expect(codes).toEqual(['UNUSED_FORMER_GOVERNMENT_SURPLUS', 'ESA_COORDINATION'])
    const surplus = evaluated.adders[0]
    expect(surplus?.unitAmountUsd).toBe(200)
    expect(surplus?.citation.grade).toBe('PRIMARY_TEXT')
    expect(surplus?.citation.quote).toContain('$200 for offers of surplus')
    const esa = evaluated.adders[1]
    expect(esa?.unitAmountUsd).toBe(600)
    expect(esa?.appliedCount).toBe(1)
    expect(esa?.citation.quote).toContain('$600 for CSI evaluations of surplus by each ESA')
  })

  it('renders the arithmetic so the two totals can be checked apart on a napkin', () => {
    if (evaluated.resolved !== true || evaluated.kind !== 'TOTAL') throw new Error('expected a total')
    expect(evaluated.arithmetic).toBe(
      '2152.99 x 8 = 17223.92 quoted; + 200.00 x 1 (UNUSED_FORMER_GOVERNMENT_SURPLUS) ' +
        '+ 600.00 x 1 (ESA_COORDINATION) = 18023.92 evaluated',
    )
  })

  it('states in words that the factors are the buyer arithmetic and not our cost', () => {
    if (evaluated.resolved !== true) throw new Error('expected a resolved figure')
    expect(evaluated.limitation).toContain('added BY THE BUYER')
    expect(evaluated.limitation).toContain('not a cost we pay')
  })
})

describe('the two totals cannot be summed, and the compiler is the thing that says so', () => {
  it('is a type error to add them, proven by an expect-error that must stay used', () => {
    if (evaluated.resolved !== true || evaluated.kind !== 'TOTAL') throw new Error('expected a total')
    const quoted = evaluated.quotedTotal
    const compared = evaluated.evaluatedTotal
    // POSITIVE CONTROL, enforced by `npm run typecheck` rather than by this assertion. If either
    // type is ever flattened back to a plain number this suppression stops suppressing anything
    // and tsc fails with TS2578 "Unused '@ts-expect-error' directive".
    // @ts-expect-error summing what we send with what the buyer compares is meaningless money
    const nonsense: unknown = quoted + compared
    expect(nonsense).toBeDefined()
  })

  it('does not even coerce to a plausible number at runtime', () => {
    if (evaluated.resolved !== true || evaluated.kind !== 'TOTAL') throw new Error('expected a total')
    // A wrapper object coerces to NaN rather than to a dollar figure, so a mistake that gets past
    // the compiler through an `any` still cannot produce a wrong price that looks right.
    expect(Number.isNaN(Number(evaluated.quotedTotal))).toBe(true)
    expect(Number.isNaN(Number(evaluated.evaluatedTotal))).toBe(true)
  })
})

describe('an unpriceable factor produces a floor whose field name is not the total field name', () => {
  const floorView = buildQuoteView(
    referenceInput({ ...DECLARED_OFFER, buyAmericanOrBalanceOfPayments: true }),
  )
  const figure = floorView.figures[2]

  it('reports a floor, not a total, and says which direction the truth lies in', () => {
    expect(figure.resolved).toBe(true)
    if (figure.resolved !== true || figure.kind !== 'FLOOR') throw new Error('expected a floor')
    expect(figure.evaluatedFloor.kind).toBe('EVALUATED_FLOOR_THE_TRUE_FIGURE_IS_HIGHER')
    expect(figure.evaluatedFloor.atLeastUsd).toBe(18023.92)
    expect(figure.directionOfError).toBe('ACTUAL_IS_HIGHER_THAN_THIS')
    expect(figure.unpricedFactorCodes).toEqual(['BUY_AMERICAN_BALANCE_OF_PAYMENTS'])
  })

  it('carries no evaluatedTotal field at all on the floor arm', () => {
    if (figure.resolved !== true || figure.kind !== 'FLOOR') throw new Error('expected a floor')
    // A flag beside one number would let a caller that forgot to check read a floor as a total.
    // A different field name makes that mistake impossible rather than merely discouraged.
    expect(Object.prototype.hasOwnProperty.call(figure, 'evaluatedTotal')).toBe(false)
  })

  it('still reports the quoted total unchanged, because a floor is about the buyer arithmetic', () => {
    if (figure.resolved !== true || figure.kind !== 'FLOOR') throw new Error('expected a floor')
    expect(figure.quotedTotal.usd).toBe(17223.92)
  })
})
