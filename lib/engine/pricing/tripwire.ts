/**
 * THE PRICE-INCREASE TRIPWIRE: the implied increase over the most recent prior price in the
 * trailing twelve months, and which regulatory band that lands in.
 *
 * WHAT CROSSING A BAND ACTUALLY DOES, WHICH IS NOT WHAT PEOPLE ASSUME.
 * It does NOT make the award illegal and it does NOT cap the price. It forces an email
 * notification to the Head of the Contracting Activity and retention of that message in the
 * contract file. The practical consequence is that a clean automated award becomes an action
 * carrying senior-level notification, which means human attention, delay and paperwork.
 *
 * That is why the return type is not a boolean. A boolean called `tripwireCrossed` reads as
 * "blocked" to every person who sees it, and a 400x quote that is entirely lawful would then
 * be suppressed by our own UI. `TripwireConsequence` carries the award pathway, the required
 * action, and two fields that are permanently false (`capsPrice`, `makesAwardIllegal`) so that
 * the thing everybody gets wrong is stated where a reader cannot miss it.
 *
 * WHY THE BAND IS RESOLVED AT AN EXPLICIT INSTANT.
 * Which band applies depends on whether the procurement is valued under the micro-purchase
 * threshold, and that threshold moves over time. Historical analysis has to compare against
 * the threshold in force on the award date, so the instant is a required input and there is no
 * default. When no dated entry covers that instant the function abstains, because a band
 * assigned from the wrong era's threshold is a misclassification that never announces itself.
 */

import {
  resolveThreshold,
  usdToCents,
  type PricingConfig,
  type ResolvedThreshold,
  type SourceCitation,
} from './config'

export type TripwireBandKind = 'UNDER_MPT_51_PERCENT' | 'AT_OR_ABOVE_MPT_25_PERCENT'

export type TripwireConsequence = {
  readonly awardPathway: 'AUTOMATED' | 'REQUIRES_SENIOR_NOTIFICATION'
  /** Permanently false. Crossing the band does not cap the price. */
  readonly capsPrice: false
  /** Permanently false. Crossing the band does not make the award illegal. */
  readonly makesAwardIllegal: false
  readonly requiredAction: string | null
  readonly operationalMeaning: string
}

export type TripwireInput = {
  readonly proposedUnitPriceUsd: number
  readonly mostRecentPriorUnitPriceUsd: number
  readonly mostRecentPriorPriceInstantMs: number
  /**
   * The award or solicitation instant. Both the threshold and the band resolve against this,
   * never against wall time, so a historical row is judged by its own era's rules.
   */
  readonly atInstantMs: number
  /** Total value of the procurement. This is what decides which band applies. */
  readonly procurementValueUsd: number
}

export type TripwireAssessment = {
  readonly assessed: true
  readonly impliedIncreaseRatio: number
  readonly impliedIncreasePercent: number
  /** Proposed divided by prior. A 5x quote reads better as a multiple than as 400%. */
  readonly impliedMultipleOfPrior: number
  readonly band: TripwireBandKind
  readonly bandThresholdRatio: number
  readonly crossed: boolean
  readonly consequence: TripwireConsequence
  readonly microPurchaseThresholdUsd: number
  readonly thresholdResolution: ResolvedThreshold<number>
  readonly bandCitation: SourceCitation
  readonly laterAmendmentsUnverified: boolean
}

export type TripwireAbstentionReason =
  | 'PRIOR_PRICE_OUTSIDE_TRAILING_12_MONTHS'
  | 'PRIOR_PRICE_NOT_POSITIVE'
  | 'MICRO_PURCHASE_THRESHOLD_NOT_RESOLVABLE_AT_INSTANT'
  | 'BAND_NOT_RESOLVABLE_AT_INSTANT'

export type TripwireAbstention = {
  readonly assessed: false
  readonly reason: TripwireAbstentionReason
  readonly detail: string
}

export type TripwireOutcome = TripwireAssessment | TripwireAbstention

/**
 * The same civil date one year earlier, in UTC. Exists so the trailing-twelve-month window is
 * a calendar year rather than a fixed 365 day count, which drifts by a day across every leap
 * year. February 29 rolls to March 1 of the prior year, deterministically, which is stated
 * here rather than left for somebody to rediscover.
 */
export function twelveMonthsBeforeUtc(instantMs: number): number {
  const d = new Date(instantMs)
  return Date.UTC(
    d.getUTCFullYear() - 1,
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  )
}

/**
 * Computes the number that predicts whether an award is automatic or manual, how long it
 * takes, and how much documentation the contracting officer demands. It belongs on the quote
 * surface at the moment a price is typed.
 */
export function tripwireBand(input: TripwireInput, config: PricingConfig): TripwireOutcome {
  if (!(input.mostRecentPriorUnitPriceUsd > 0)) {
    return {
      assessed: false,
      reason: 'PRIOR_PRICE_NOT_POSITIVE',
      detail:
        `A prior price of ${input.mostRecentPriorUnitPriceUsd} gives no comparison basis. The ` +
        'regulation measures an increase over a prior price, and there is nothing to increase from.',
    }
  }

  const windowStartMs = twelveMonthsBeforeUtc(input.atInstantMs)
  if (
    input.mostRecentPriorPriceInstantMs < windowStartMs ||
    input.mostRecentPriorPriceInstantMs > input.atInstantMs
  ) {
    return {
      assessed: false,
      reason: 'PRIOR_PRICE_OUTSIDE_TRAILING_12_MONTHS',
      detail:
        `The supplied prior price is dated ${new Date(input.mostRecentPriorPriceInstantMs).toISOString()}, ` +
        `outside the trailing twelve months ending ${new Date(input.atInstantMs).toISOString()}. ` +
        'DLAD 17.7505 measures the increase over the most recent 12-month period, so with no ' +
        'price inside that window there is no band to land in. This is an honest empty state ' +
        'and not a pass: many of the largest opportunities in this corpus have no prior price ' +
        'in the window at all, and reporting them as uncrossed would be a fabricated all-clear.',
    }
  }

  const mpt = resolveThreshold(config.microPurchaseThreshold, input.atInstantMs)
  if (!mpt.resolved) {
    return {
      assessed: false,
      reason: 'MICRO_PURCHASE_THRESHOLD_NOT_RESOLVABLE_AT_INSTANT',
      detail:
        'Which band applies depends on the micro-purchase threshold in force on the award ' +
        `date, and none is dated for that instant. ${mpt.detail} Applying a later era's ` +
        'threshold here would silently misclassify the row.',
    }
  }

  const procurementValueCents = usdToCents(input.procurementValueUsd)
  const underMpt = procurementValueCents < mpt.value
  const bandSeries = underMpt ? config.tripwireUnderMpt : config.tripwireAtOrAboveMpt
  const bandResolution = resolveThreshold(bandSeries, input.atInstantMs)
  if (!bandResolution.resolved) {
    return {
      assessed: false,
      reason: 'BAND_NOT_RESOLVABLE_AT_INSTANT',
      detail:
        `No dated entry for ${bandSeries.key} covers the award instant. ` +
        `${bandResolution.detail}`,
    }
  }

  const priorCents = usdToCents(input.mostRecentPriorUnitPriceUsd)
  const proposedCents = usdToCents(input.proposedUnitPriceUsd)
  const impliedIncreaseRatio = (proposedCents - priorCents) / priorCents

  /*
   * "25% or more" is verbatim in the regulation. The 51 percent figure is stated as the
   * threshold percentage increase for procurements under the micro-purchase threshold without
   * repeating the "or more", so the inclusive comparison is applied to it by parallel
   * construction. That reading is recorded here rather than left implicit in an operator.
   */
  const crossed = impliedIncreaseRatio >= bandResolution.value

  return {
    assessed: true,
    impliedIncreaseRatio,
    impliedIncreasePercent: impliedIncreaseRatio * 100,
    impliedMultipleOfPrior: proposedCents / priorCents,
    band: underMpt ? 'UNDER_MPT_51_PERCENT' : 'AT_OR_ABOVE_MPT_25_PERCENT',
    bandThresholdRatio: bandResolution.value,
    crossed,
    consequence: crossed
      ? {
          awardPathway: 'REQUIRES_SENIOR_NOTIFICATION',
          capsPrice: false,
          makesAwardIllegal: false,
          requiredAction:
            'The contracting officer shall notify the HCA by email and retain the message in ' +
            'the contract file. Receipt may be delegated no lower than the CCO, and never to ' +
            "anyone in the contracting officer's chain of command below the CCO.",
          operationalMeaning:
            'Lawful and not capped, but no longer automatic. Expect senior attention, delay, ' +
            'and a documentation request. Price the delay into the decision, not the quote.',
        }
      : {
          awardPathway: 'AUTOMATED',
          capsPrice: false,
          makesAwardIllegal: false,
          requiredAction: null,
          operationalMeaning:
            'Below the band. Nothing in DLAD 17.7505 is triggered and the automated pathway ' +
            'stays available. Other evaluation machinery still applies.',
        },
    microPurchaseThresholdUsd: mpt.value / 100,
    thresholdResolution: mpt,
    bandCitation: bandResolution.entry.citation,
    laterAmendmentsUnverified:
      mpt.laterAmendmentsUnverified || bandResolution.laterAmendmentsUnverified,
  }
}
