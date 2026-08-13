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

export type AdderCode = 'UNUSED_FORMER_GOVERNMENT_SURPLUS' | 'ESA_COORDINATION'

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

export type AdderApplicability = {
  /** Is the material offered unused former Government surplus? */
  readonly isUnusedFormerGovernmentSurplus: boolean
  /** How many ESAs must coordinate. Zero when the item requires no ESA coordination. */
  readonly esaCoordinationCount: number
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
    authority: 'DLA Master Solicitation Rev 104 evaluation formula, worked cases',
    quote: null,
    sourceFile: '/Users/user/project-x/03-findings/research/dla-procurement-mechanics.md',
    sourceLines: '384-386',
    grade: 'PRIMARY_TEXT',
  } as SourceCitation,
} as const

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

export type EvaluatedTotalAbstention = {
  readonly kind: 'EVALUATED_TOTAL_ABSTENTION'
  readonly reason: 'APPLICABLE_ADDER_NOT_RESOLVABLE_AT_INSTANT' | 'ESA_COUNT_INVALID'
  readonly detail: string
}

export type EvaluatedTotalOutcome = EvaluatedTotal | EvaluatedTotalAbstention

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

  const adderTotalCents = adders.reduce((sum, a) => sum + a.subtotalCents, 0)
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
