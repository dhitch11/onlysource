/**
 * THE EVALUATED TOTAL, AND THE DISTINCTION THAT THE TYPE NAMES EXIST TO PROTECT.
 *
 * DLA's automated program evaluates qualified quotations on the basis of price alone, and
 * before it compares them it ADDS evaluation factors to the total: $200 for an offer of
 * unused former Government surplus material, and $600 for each ESA coordination where the
 * item requires it.
 *
 * THOSE ADDERS ARE NOT PART OF OUR QUOTE AND THEY ARE NOT A COST WE PAY.
 * They are applied by the buyer, to our total, to form the number the buyer compares against
 * competitors. Folding them into the price we send overprices every single offer by $200 and
 * loses awards on exactly the low-value lines where the adder already dominates. That is why
 * `QuotedTotal` and `EvaluatedTotal` are separate types with the distinction written into the
 * type names themselves: a call site that reaches for the wrong one has to type a name that
 * says what it is doing. `EvaluatedTotal` also restates the recommended quote unchanged beside
 * the evaluated figure, so the two are visibly different numbers rather than one number that
 * silently drifted.
 *
 * THE OTHER DIRECTION IS EQUALLY FATAL. A pricing run that omits an adder that DOES apply
 * overstates our competitiveness on a price-alone evaluation and loses the award for a
 * different reason. So when an applicable adder cannot be resolved from the dated config at
 * the evaluation instant, this module abstains. It never silently applies zero.
 */

import {
  centsToUsd,
  resolveThreshold,
  usdToCents,
  type PricingConfig,
  type SourceCitation,
} from './config'

/** What we send to the buyer. Carries no evaluation adder, ever. */
export type QuotedTotal = {
  readonly kind: 'QUOTED_TOTAL_WHAT_WE_SEND'
  readonly unitPriceUsd: number
  readonly quantity: number
  readonly totalCents: number
  readonly totalUsd: number
}

/**
 * Builds the number we actually send, in integer cents, so the quote and every derived
 * comparison agree to the cent.
 */
export function quotedTotal(unitPriceUsd: number, quantity: number): QuotedTotal {
  const totalCents = usdToCents(unitPriceUsd) * quantity
  return {
    kind: 'QUOTED_TOTAL_WHAT_WE_SEND',
    unitPriceUsd,
    quantity,
    totalCents,
    totalUsd: centsToUsd(totalCents),
  }
}

/**
 * DELIBERATELY OPEN, and this is a correctness property rather than a style choice.
 *
 * This was a closed union of the two factors we could price. Part I para 3(b) lists THREE
 * instances, and the third, Buy American / Balance of Payments, states no dollar amount in the
 * solicitation text: it points at DFARS 225.502(c). Against a closed union that factor could not
 * be CONSTRUCTED at all, so it was not abstained on, it was simply ABSENT, and an absent factor
 * reads on every screen as "does not apply".
 *
 * That is the difference that matters. An unresolvable KNOWN factor made this module abstain
 * loudly. An unrepresentable factor made it return a confident total that was quietly too low,
 * which overstates our competitiveness on a price-alone evaluation and loses the award while
 * every number on screen looks right.
 */
export type AdderCode = string

/** The codes we can name today. The set is open: a new dated factor needs no type change. */
export const KNOWN_ADDER_CODES = {
  UNUSED_FORMER_GOVERNMENT_SURPLUS: 'UNUSED_FORMER_GOVERNMENT_SURPLUS',
  ESA_COORDINATION: 'ESA_COORDINATION',
  BUY_AMERICAN_BALANCE_OF_PAYMENTS: 'BUY_AMERICAN_BALANCE_OF_PAYMENTS',
} as const

export type EvaluationAdder = {
  readonly code: AdderCode
  readonly unitAmountUsd: number
  /** ESA coordination is charged per ESA. The surplus factor is charged once. */
  readonly appliedCount: number
  readonly subtotalCents: number
  readonly subtotalUsd: number
  readonly citation: SourceCitation
  readonly laterAmendmentsUnverified: boolean
}

/**
 * A factor that APPLIES to this offer and that we cannot put a number on.
 *
 * Carried BY NAME, never as a count, because a count is not checkable by the person reading the
 * screen. "One factor is unpriced" tells an operator nothing they can act on. "Buy American /
 * Balance of Payments applies and carries no amount in the solicitation text" tells them what to
 * go and find.
 */
export type UnpricedFactor = {
  readonly code: AdderCode
  readonly applicable: true
  readonly reason: 'NO_AMOUNT_IN_PRIMARY_TEXT' | 'NO_DATED_ENTRY_AT_INSTANT'
  readonly detail: string
  readonly citation: SourceCitation
}

export type AdderApplicability = {
  /** Is the material offered unused former Government surplus? */
  readonly isUnusedFormerGovernmentSurplus: boolean
  /** How many ESAs must coordinate. Zero when the item requires no ESA coordination. */
  readonly esaCoordinationCount: number
  /**
   * Part I para 3(b)(3). The solicitation names this factor and states no amount for it, so a
   * true here can never produce a priced adder. It produces a floor. Optional because a caller
   * that does not yet know is different from a caller asserting it does not apply, and the
   * unknown case is recorded as a gap by the caller rather than silently read as false here.
   */
  readonly buyAmericanOrBalanceOfPayments?: boolean
}

/* ------------------------------------------------------------------------------------- *
 * SURPLUS DRAG
 * ------------------------------------------------------------------------------------- */

export type SurplusDrag = {
  readonly computed: true
  readonly adderUsd: number
  readonly lineTotalUsd: number
  /** adder / (unit price x quantity). The first-class sortable number. */
  readonly dragRatio: number
  readonly dragPercent: number
}

export type SurplusDragAbstention = {
  readonly computed: false
  readonly reason: 'LINE_TOTAL_NOT_POSITIVE'
  readonly detail: string
}

export type SurplusDragOutcome = SurplusDrag | SurplusDragAbstention

/**
 * Exists because the adder is flat on the total, not per unit and not a percentage, which
 * makes it regressive: it punishes exactly the small-quantity buys that are most numerous.
 * Ranking partly by how little the drag matters is a real, quantifiable edge that is
 * invisible to anyone who has not read the Master Solicitation, so the ratio is a sortable
 * column rather than a footnote.
 *
 * DELIBERATELY NOT BUCKETED. The corpus supplies two worked endpoints (fatal at 67%, noise at
 * 0.04%) and no cut point between them. Inventing a band boundary would be an estimate
 * dressed as a measurement, so callers get the honest continuous number and the two cited
 * reference cases below.
 */
export function surplusDrag(
  adderUsd: number,
  unitPriceUsd: number,
  quantity: number,
): SurplusDragOutcome {
  const adderCents = usdToCents(adderUsd)
  const lineTotalCents = usdToCents(unitPriceUsd) * quantity
  if (!(lineTotalCents > 0)) {
    return {
      computed: false,
      reason: 'LINE_TOTAL_NOT_POSITIVE',
      detail:
        `A line total of ${lineTotalCents} cents cannot carry a drag ratio. Returning a ` +
        'sentinel here would sort into the ranking as though it were a measured value.',
    }
  }
  const dragRatio = adderCents / lineTotalCents
  return {
    computed: true,
    adderUsd,
    lineTotalUsd: centsToUsd(lineTotalCents),
    dragRatio,
    dragPercent: dragRatio * 100,
  }
}

/**
 * The two worked cases the research file states, kept beside the function so the regressivity
 * is legible without a reader having to run it.
 */
export const CORPUS_DRAG_REFERENCE_CASES = {
  fatal: {
    unitPriceUsd: 300,
    quantity: 1,
    adderUsd: 200,
    statedPercentInSource: 67,
    statedVerbatim: 'On a 1-unit, $300 buy, $200 is a 67% penalty and usually fatal.',
  },
  noise: {
    unitPriceUsd: 2800,
    quantity: 190,
    adderUsd: 200,
    statedPercentInSource: 0.04,
    statedVerbatim:
      "On the corpus's own example (190 units quoted at ~$2,800 each), $200 against a " +
      '~$532,000 total is 0.04% and is noise.',
  },
  citation: {
    // PROVENANCE CORRECTED. This read "DLA Master Solicitation Rev 104 evaluation formula" at
    // grade PRIMARY_TEXT while pointing at a research digest. Two violations of the estate's own
    // citation rule in one object: it named a revision nobody here had read, and it graded a
    // digest's worked arithmetic as primary text. The arithmetic in both cases is correct
    // (200/300 is 66.7% against the stated 67%, and 200/532,000 is 0.038% against the stated
    // 0.04%). Only the provenance was overstated, and an overstated provenance is the failure
    // this engine is built to refuse. These are worked cases computed BY the research digest,
    // not quoted from the solicitation, so the grade is DERIVED and the authority is the digest.
    authority: 'Research digest worked cases on the surplus evaluation factor, computed not quoted',
    quote: null,
    sourceFile: '/Users/user/project-x/03-findings/research/dla-procurement-mechanics.md',
    sourceLines: '384-386',
    grade: 'DERIVED',
  } as SourceCitation,
} as const

/**
 * Part I para 3(b)(3), read directly from the Master Solicitation PDF on disk rather than
 * inherited from a digest. It names Revision 81 because that is the revision whose text was
 * actually read, which is the estate's citation rule. It carries NO dollar amount because the
 * solicitation states none: it points at DFARS 225.502(c).
 */
export const BUY_AMERICAN_FACTOR_CITATION: SourceCitation = {
  authority:
    'DLA Master Solicitation for Automated Simplified Acquisitions, Revision 81 (Aug 23 2021), ' +
    'Part I, para 3(b)(3)',
  quote:
    'When the solicitation is subject to the Buy American statute or the Balance of Payments ' +
    'Program (see DFARS 225.502(c).',
  sourceFile: '/Users/user/Downloads/MasterSolicitation4ASAcqRev-81_August-23-2021(1).pdf',
  sourceLines: 'Part I, para 3(b)(3)',
  grade: 'PRIMARY_TEXT',
}

/* ------------------------------------------------------------------------------------- *
 * THE EVALUATED TOTAL
 * ------------------------------------------------------------------------------------- */

export type EvaluatedTotal = {
  readonly kind: 'EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND'
  readonly quotedTotalUsd: number
  /**
   * Restated deliberately and identical to `quotedTotalUsd`. The adders never move it. A
   * reader comparing the two fields sees at a glance that the evaluated figure is the buyer's
   * comparison basis and the recommended quote is untouched.
   */
  readonly recommendedQuoteTotalUsd: number
  readonly addersAreIncludedInRecommendedQuote: false
  readonly adders: readonly EvaluationAdder[]
  readonly adderTotalUsd: number
  readonly evaluatedTotalUsd: number
  readonly surplusDrag: SurplusDragOutcome | null
  readonly anyAdderLaterAmendmentsUnverified: boolean
}

/**
 * THE FLOOR. One or more factors apply to this offer and cannot be priced.
 *
 * The figure is named `atLeastUsd` and there is deliberately NO `evaluatedTotalUsd` on this arm.
 * A call site that reaches for the total on a floor FAILS TO COMPILE. That is the whole point of
 * the shape: a boolean flag beside a single number would let a caller that forgot to check read a
 * floor as a total, and the failure would be silent and permanent. A distinct field name makes
 * the mistake impossible rather than merely discouraged.
 *
 * `directionOfError` and the sentence exist because "approximately" is useless to an operator.
 * Knowing the true figure is HIGHER tells them the offer is less competitive than it looks, which
 * is the decision they are actually making.
 */
export type EvaluatedFloor = {
  readonly kind: 'EVALUATED_FLOOR_AT_LEAST'
  readonly atLeastUsd: number
  readonly quotedTotalUsd: number
  readonly recommendedQuoteTotalUsd: number
  readonly addersAreIncludedInRecommendedQuote: false
  /** The factors we could price. The floor is the quote plus these. */
  readonly adders: readonly EvaluationAdder[]
  /** By name, never a count. */
  readonly unpricedFactors: readonly UnpricedFactor[]
  readonly directionOfError: 'ACTUAL_IS_HIGHER_THAN_THIS'
  readonly sentence: string
  readonly anyAdderLaterAmendmentsUnverified: boolean
}

export type EvaluatedTotalAbstention = {
  readonly kind: 'EVALUATED_TOTAL_ABSTENTION'
  readonly reason: 'APPLICABLE_ADDER_NOT_RESOLVABLE_AT_INSTANT' | 'ESA_COUNT_INVALID'
  readonly detail: string
}

export type EvaluatedTotalOutcome = EvaluatedTotal | EvaluatedFloor | EvaluatedTotalAbstention

/**
 * The one legal way to read a figure off an outcome, for callers that rank, score or sum.
 *
 * Returns the comparison figure AND whether it is a floor, as one value that cannot be
 * destructured apart by accident. A consumer that ranks pursuits on the number alone will rank a
 * floor too favourably, because a floor is by construction lower than the truth: T5 named this
 * and they are right that it does not stop at the documents screen. Anything that scores, ranks
 * or aggregates an evaluated price has to carry `isFloor` alongside the number and say so on the
 * surface that shows it.
 */
export function comparisonFigure(
  outcome: EvaluatedTotalOutcome,
): { usd: number; isFloor: boolean; unpricedFactorCodes: readonly AdderCode[] } | null {
  if (outcome.kind === 'EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND') {
    return { usd: outcome.evaluatedTotalUsd, isFloor: false, unpricedFactorCodes: [] }
  }
  if (outcome.kind === 'EVALUATED_FLOOR_AT_LEAST') {
    return {
      usd: outcome.atLeastUsd,
      isFloor: true,
      unpricedFactorCodes: outcome.unpricedFactors.map((f) => f.code),
    }
  }
  return null
}

/**
 * Computes the buyer's price-alone comparison basis, which is the only number that decides a
 * competitive award and is not the number we send.
 */
export function evaluatedTotal(
  quoted: QuotedTotal,
  applicability: AdderApplicability,
  config: PricingConfig,
  atInstantMs: number,
): EvaluatedTotalOutcome {
  const esaCount = applicability.esaCoordinationCount
  if (!Number.isInteger(esaCount) || esaCount < 0) {
    return {
      kind: 'EVALUATED_TOTAL_ABSTENTION',
      reason: 'ESA_COUNT_INVALID',
      detail: `The ESA coordination count must be a non-negative integer; received ${esaCount}.`,
    }
  }

  const adders: EvaluationAdder[] = []

  if (applicability.isUnusedFormerGovernmentSurplus) {
    const r = resolveThreshold(config.surplusEvaluationAdder, atInstantMs)
    if (!r.resolved) {
      return {
        kind: 'EVALUATED_TOTAL_ABSTENTION',
        reason: 'APPLICABLE_ADDER_NOT_RESOLVABLE_AT_INSTANT',
        detail:
          'The surplus evaluation factor applies to this offer but no dated entry covers the ' +
          `evaluation instant. ${r.detail} Omitting an applicable adder would overstate our ` +
          'competitiveness on a price-alone evaluation, so this abstains rather than using zero.',
      }
    }
    adders.push({
      code: 'UNUSED_FORMER_GOVERNMENT_SURPLUS',
      unitAmountUsd: centsToUsd(r.value),
      appliedCount: 1,
      subtotalCents: r.value,
      subtotalUsd: centsToUsd(r.value),
      citation: r.entry.citation,
      laterAmendmentsUnverified: r.laterAmendmentsUnverified,
    })
  }

  if (esaCount > 0) {
    const r = resolveThreshold(config.esaCoordinationAdder, atInstantMs)
    if (!r.resolved) {
      return {
        kind: 'EVALUATED_TOTAL_ABSTENTION',
        reason: 'APPLICABLE_ADDER_NOT_RESOLVABLE_AT_INSTANT',
        detail:
          `ESA coordination applies ${esaCount} time(s) but no dated entry covers the ` +
          `evaluation instant. ${r.detail} This abstains rather than using zero.`,
      }
    }
    const subtotalCents = r.value * esaCount
    adders.push({
      code: 'ESA_COORDINATION',
      unitAmountUsd: centsToUsd(r.value),
      appliedCount: esaCount,
      subtotalCents,
      subtotalUsd: centsToUsd(subtotalCents),
      citation: r.entry.citation,
      laterAmendmentsUnverified: r.laterAmendmentsUnverified,
    })
  }

  // FACTOR (3). It applies or it does not; it can never be priced from the solicitation, which
  // states no amount for it. So it never produces an adder, only a floor.
  const unpricedFactors: UnpricedFactor[] = []
  if (applicability.buyAmericanOrBalanceOfPayments === true) {
    unpricedFactors.push({
      code: KNOWN_ADDER_CODES.BUY_AMERICAN_BALANCE_OF_PAYMENTS,
      applicable: true,
      reason: 'NO_AMOUNT_IN_PRIMARY_TEXT',
      detail:
        'Part I para 3(b) lists this as the third instance in which price evaluation factors are ' +
        'added to the total quotation price, and states no amount for it: it points at DFARS ' +
        '225.502(c). No amount is invented here, so the evaluated price can only be reported as a ' +
        'floor until the DFARS figure is read from primary text and dated into the config.',
      citation: BUY_AMERICAN_FACTOR_CITATION,
    })
  }

  const adderTotalCents = adders.reduce((sum, a) => sum + a.subtotalCents, 0)

  if (unpricedFactors.length > 0) {
    const atLeastCents = quoted.totalCents + adderTotalCents
    const names = unpricedFactors.map((f) => f.code).join(', ')
    return {
      kind: 'EVALUATED_FLOOR_AT_LEAST',
      atLeastUsd: centsToUsd(atLeastCents),
      quotedTotalUsd: quoted.totalUsd,
      recommendedQuoteTotalUsd: quoted.totalUsd,
      addersAreIncludedInRecommendedQuote: false,
      adders,
      unpricedFactors,
      directionOfError: 'ACTUAL_IS_HIGHER_THAN_THIS',
      sentence:
        `At least ${centsToUsd(atLeastCents).toFixed(2)} US dollars. The true evaluated price is ` +
        `HIGHER than this: ${names} applies to this offer and carries no amount in the ` +
        'solicitation text, so it is not included. Treat this offer as less competitive than the ' +
        'figure suggests, never more.',
      anyAdderLaterAmendmentsUnverified: adders.some((a) => a.laterAmendmentsUnverified),
    }
  }

  return {
    kind: 'EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND',
    quotedTotalUsd: quoted.totalUsd,
    recommendedQuoteTotalUsd: quoted.totalUsd,
    addersAreIncludedInRecommendedQuote: false,
    adders,
    adderTotalUsd: centsToUsd(adderTotalCents),
    evaluatedTotalUsd: centsToUsd(quoted.totalCents + adderTotalCents),
    surplusDrag:
      adderTotalCents > 0
        ? surplusDrag(centsToUsd(adderTotalCents), quoted.unitPriceUsd, quoted.quantity)
        : null,
    anyAdderLaterAmendmentsUnverified: adders.some((a) => a.laterAmendmentsUnverified),
  }
}
