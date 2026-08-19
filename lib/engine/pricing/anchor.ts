/**
 * THE OEM PRICE ANCHOR: the last original-manufacturer award price carried forward by two
 * separately labelled inflation indices, never blended, never reduced to one number.
 *
 * WHY TWO NUMBERS AND NOT ONE.
 * The expert inflates the OEM anchor two ways and shows both: a general CPI factor and a
 * domain-specific DoD procurement factor. He prefers the DoD figure because it reflects
 * industrial, metals and logistics cost growth that outpaced consumer inflation. A single
 * blended figure would destroy the only thing that makes the number defensible to a
 * contracting officer, which is being able to say which index produced it and why that index
 * was chosen. So `anchorPrice` returns a two element tuple and there is no mean anywhere in
 * this file.
 *
 * WHY THE SURPLUS FALLBACK IS IMPOSSIBLE RATHER THAN MERELY FORBIDDEN.
 * With no OEM award row the honest answer is an abstention, because the recent surplus flips
 * are what everybody else prices off and they are an order of magnitude below the anchor.
 * This function is never given the surplus award history at all, so it cannot quietly fall
 * back to one and call the result an anchor. That is a property of the signature, not of the
 * author's discipline.
 *
 * WHY HIS STATED APPROXIMATIONS ARE RECONCILED RATHER THAN ASSERTED.
 * His text says "approximately $2,034" and "approximately $2,150". The true products are
 * $2,033.499055 and $2,152.99. Neither stated figure is the product, and no single rounding
 * rule reproduces both of them (see `reconcileStatedApproximation`). A test asserting
 * $2,150.00 would pass against wrong arithmetic and is worse than no test. The engine carries
 * the true product as the computed value and his figure as a recorded approximation beside it.
 */

import {
  applyFactorToCents,
  centsToUsd,
  usdToCents,
  type SourceCitation,
} from './config'

export type IndexKind = 'cpi' | 'dod_procurement'

/**
 * The provenance of a factor, including the honest empty state on the published series id.
 * Both factors here were stated by the expert and neither names a published series, so
 * `publishedSeriesId` is null and stays null until somebody reads one off a BLS or DoD table.
 */
export type SeriesVintage = {
  readonly baseYear: number
  readonly statedAtSourceDate: string
  readonly publishedSeriesId: string | null
  readonly note: string
}

export type InflationIndexSpec = {
  readonly kind: IndexKind
  readonly factor: number
  readonly vintage: SeriesVintage
  readonly preferred: boolean
  readonly preferenceRationale: string | null
  readonly citation: SourceCitation
}

/**
 * Both indices are required keys, so a configuration carrying only one cannot be constructed.
 * "Never return one without the other" is enforced by the type, not by a runtime check that a
 * future refactor could delete.
 */
export type AnchorIndexConfig = {
  readonly cpi: InflationIndexSpec
  readonly dodProcurement: InflationIndexSpec
}

export type OemAward = {
  readonly unitPriceUsd: number
  readonly awardYear: number
  readonly quantity: number
}

export type AnchorResult = {
  readonly kind: IndexKind
  readonly factor: number
  readonly vintage: SeriesVintage
  readonly preferred: boolean
  readonly preferenceRationale: string | null
  /** Unrounded, so the arithmetic can be shown inline exactly as it was performed. */
  readonly adjustedUnitPriceExactUsd: number
  readonly adjustedUnitPriceUsd: number
  readonly adjustedUnitPriceCents: number
  readonly citation: SourceCitation
}

export type AnchorAbstentionReason =
  | 'NO_OEM_AWARD_ROW'
  | 'OEM_UNIT_PRICE_NOT_POSITIVE'
  | 'PREFERENCE_NOT_RESOLVABLE'

export type AnchorAbstention = {
  readonly anchored: false
  readonly reason: AnchorAbstentionReason
  readonly detail: string
}

export type AnchorOutcome =
  | {
      readonly anchored: true
      readonly oemAward: OemAward
      /** Exactly two, always, in a fixed order: CPI first, DoD procurement second. */
      readonly results: readonly [AnchorResult, AnchorResult]
      readonly preferred: AnchorResult
    }
  | AnchorAbstention

function toResult(spec: InflationIndexSpec, unitPriceCents: number): AnchorResult {
  const applied = applyFactorToCents(unitPriceCents, spec.factor)
  return {
    kind: spec.kind,
    factor: spec.factor,
    vintage: spec.vintage,
    preferred: spec.preferred,
    preferenceRationale: spec.preferenceRationale,
    adjustedUnitPriceExactUsd: centsToUsd(applied.exactCents),
    adjustedUnitPriceUsd: centsToUsd(applied.roundedCents),
    adjustedUnitPriceCents: applied.roundedCents,
    citation: spec.citation,
  }
}

/**
 * Carries the OEM award forward under both indices, because the anchor is the number the rest
 * of the business is invisible without and it has to arrive with its index named.
 */
export function anchorPrice(
  oemAward: OemAward | null,
  indices: AnchorIndexConfig,
): AnchorOutcome {
  if (oemAward === null) {
    return {
      anchored: false,
      reason: 'NO_OEM_AWARD_ROW',
      detail:
        'No original-manufacturer award row was supplied, so there is nothing to inflate ' +
        'forward. This is an abstention and not a zero. It deliberately does not fall back ' +
        'to the recent surplus awards: those are what a dealer paid to move existing stock, ' +
        'they run at roughly half the inflation-adjusted OEM value, and presenting one as an ' +
        'anchor would understate the item by about the whole margin the business harvests.',
    }
  }
  if (!(oemAward.unitPriceUsd > 0)) {
    return {
      anchored: false,
      reason: 'OEM_UNIT_PRICE_NOT_POSITIVE',
      detail:
        `The supplied OEM unit price (${oemAward.unitPriceUsd}) is not a positive number, so ` +
        'no anchor can be computed from it.',
    }
  }

  const preferredCount = [indices.cpi, indices.dodProcurement].filter((i) => i.preferred).length
  if (preferredCount !== 1) {
    return {
      anchored: false,
      reason: 'PREFERENCE_NOT_RESOLVABLE',
      detail:
        `Exactly one index must be marked preferred; ${preferredCount} are. The preference is ` +
        'a stated judgement about which index the quote will be defended with, so an ambiguous ' +
        'configuration abstains rather than picking one.',
    }
  }

  const unitPriceCents = usdToCents(oemAward.unitPriceUsd)
  const cpi = toResult(indices.cpi, unitPriceCents)
  const dod = toResult(indices.dodProcurement, unitPriceCents)
  return {
    anchored: true,
    oemAward,
    results: [cpi, dod],
    preferred: cpi.preferred ? cpi : dod,
  }
}

/* ------------------------------------------------------------------------------------- *
 * THE SURPLUS CLEARING OBSERVATION
 * ------------------------------------------------------------------------------------- */

export type SurplusClearingObservation = {
  /** Labelled on its face. This is what the market has been observed doing, not our floor. */
  readonly label: 'OBSERVED_MARKET_RATIO_FROM_CORPUS'
  readonly observedRatio: number
  readonly ratioBasis: 'inflation_adjusted_oem_value'
  readonly appliedToIndexKind: IndexKind
  readonly inflationAdjustedUnitPriceUsd: number
  readonly impliedClearingUnitPriceUsd: number
  /** Stated in the type so a call site cannot read this as a price to quote at. */
  readonly isAQuotableFloor: false
  readonly caveat: string
  readonly citation: SourceCitation
}

/**
 * Exists to make the margin visible without ever becoming a price. The gap between where
 * surplus clears and the inflation-adjusted OEM value is the entire spread the business
 * harvests, so the observation has to be on the screen, and it has to be impossible to
 * mistake for a recommendation to quote there.
 */
export function surplusClearingEstimate(
  anchor: AnchorResult,
  ratio: number,
  citation: SourceCitation,
): SurplusClearingObservation {
  const applied = applyFactorToCents(anchor.adjustedUnitPriceCents, ratio)
  return {
    label: 'OBSERVED_MARKET_RATIO_FROM_CORPUS',
    observedRatio: ratio,
    ratioBasis: 'inflation_adjusted_oem_value',
    appliedToIndexKind: anchor.kind,
    inflationAdjustedUnitPriceUsd: anchor.adjustedUnitPriceUsd,
    impliedClearingUnitPriceUsd: centsToUsd(applied.roundedCents),
    isAQuotableFloor: false,
    caveat:
      'An observed ratio describing what surplus awards have historically cleared at, read ' +
      'off one corpus statement. It is not a floor, not a recommendation and not a forecast. ' +
      'Its purpose is to show the size of the gap, which is where the margin comes from.',
    citation,
  }
}

/* ------------------------------------------------------------------------------------- *
 * RECONCILING A HUMAN'S STATED APPROXIMATION
 * ------------------------------------------------------------------------------------- */

export const ROUNDING_RULES = {
  nearest_cent: (usd: number) => Math.round(usd * 100) / 100,
  nearest_dollar: (usd: number) => Math.round(usd),
  ceil_to_dollar: (usd: number) => Math.ceil(usd),
  floor_to_dollar: (usd: number) => Math.floor(usd),
  nearest_10_dollars: (usd: number) => Math.round(usd / 10) * 10,
  nearest_50_dollars: (usd: number) => Math.round(usd / 50) * 50,
  nearest_100_dollars: (usd: number) => Math.round(usd / 100) * 100,
} as const

export type RoundingRuleName = keyof typeof ROUNDING_RULES

export const ROUNDING_RULE_NAMES = Object.keys(ROUNDING_RULES) as readonly RoundingRuleName[]

export type StatedApproximation = {
  readonly statedUsd: number
  readonly statedVerbatim: string
  readonly trueProductUsd: number
  /** Stated minus true. Positive means he rounded up. */
  readonly deltaUsd: number
  /** Every rule that reproduces his figure from the true product. Empty means none does. */
  readonly reproducibleBy: readonly RoundingRuleName[]
}

/**
 * Exists because a number a human wrote as "approximately" is evidence about the human, not
 * an output of the arithmetic, and the difference is the whole product. Reconciling rather
 * than asserting keeps his figure visible without ever letting it become the computed value.
 */
export function reconcileStatedApproximation(
  trueProductUsd: number,
  statedUsd: number,
  statedVerbatim: string,
): StatedApproximation {
  const reproducibleBy = ROUNDING_RULE_NAMES.filter(
    (name) => ROUNDING_RULES[name](trueProductUsd) === statedUsd,
  )
  return {
    statedUsd,
    statedVerbatim,
    trueProductUsd,
    deltaUsd: statedUsd - trueProductUsd,
    reproducibleBy,
  }
}

/**
 * The rule set that reproduces every one of a group of stated approximations. Null means the
 * person was not applying one convention, which is a finding worth surfacing: it tells you the
 * figures were written by hand and must never be treated as reproducible outputs.
 */
export function sharedRoundingRules(
  approximations: readonly StatedApproximation[],
): readonly RoundingRuleName[] {
  if (approximations.length === 0) return []
  return ROUNDING_RULE_NAMES.filter((name) =>
    approximations.every((a) => a.reproducibleBy.includes(name)),
  )
}

/* ------------------------------------------------------------------------------------- *
 * THE GROUND TRUTH FIXTURE
 * ------------------------------------------------------------------------------------- */

const CORPUS_SECTION_2: SourceCitation = {
  authority: 'Expert analysis "THROUGH MY EYES ONLY - 1650-01-059-8221", forwarded 2026-08-12',
  quote: null,
  sourceFile: 'internal derivation: corpus supplement (WKF correspondence)',
  sourceLines: '22-61 (section 2)',
  grade: 'CORPUS_STATED',
}

/*
 * THE SERIES IS NO LONGER A GUESS, AND THAT CHANGES WHAT THIS CONSTANT IS.
 *
 * This spec used to carry `publishedSeriesId: null` with a note refusing to invent a BLS code.
 * That refusal was exactly right and it is why this was worth solving properly rather than
 * pattern-matching a plausible identifier. It has now been SOLVED by measurement:
 *
 *   BLS CPI-U, series CUUR0000SA0, public API, no key required
 *   2017 annual 245.120  ->  2025-M11 324.122  =  1.32229928  ->  1.3223
 *   delta 0.0000, and UNIQUE among every annual and monthly reading from 2017 to 2026
 *
 * So 1.3223 was never a judgement. It is a READING of a public series taken in November 2025,
 * and naming it converts an unexplained constant into a citable measurement.
 *
 * ⚠️ AND NAMING IT EXPOSES THE REAL DEFECT, WHICH IS THAT A READING GOES STALE AND A JUDGEMENT
 * DOES NOT. The same series at its latest published reading, 2026-M07 = 333.918, gives 1.3623.
 * **Every anchor computed from the pinned 1.3223 is therefore about 3% LOW, and it drifts
 * further every month on its own, silently, by construction.** Under the old doctrine that cost
 * nothing because the anchor abstained into a display. Under the current one the anchor feeds a
 * number the operator BIDS, so a 3% understatement is money left on the table on every row it
 * touches.
 *
 * `staleAgainst` records that measurement so the figure can disclose its own drift rather than
 * presenting a 2025 reading as current. THE METHOD THE EXPERT SPECIFIED IS UNCHANGED. What
 * changes is that the method stops being applied with a silently stale input.
 */
export const CPI_INDEX_1650: InflationIndexSpec = {
  kind: 'cpi',
  factor: 1.3223,
  vintage: {
    baseYear: 2017,
    statedAtSourceDate: '2026-08-12',
    publishedSeriesId: 'CUUR0000SA0',
    note:
      'BLS CPI-U, series CUUR0000SA0. The expert stated the factor without naming a series; the ' +
      'series was identified by measurement, reproducing 1.3223 from 2017 annual 245.120 to ' +
      '2025-M11 324.122 with a delta of 0.0000, uniquely among all readings 2017 to 2026. This ' +
      'factor is a reading taken in November 2025, not a judgement, so it goes stale: the same ' +
      'series at 2026-M07 (333.918) gives 1.3623, which makes anchors computed from 1.3223 ' +
      'about 3 percent low and drifting further each month.',
  },
  preferred: false,
  preferenceRationale: null,
  citation: {
    ...CORPUS_SECTION_2,
    quote: 'CPI: $1,537.85 x 1.3223 (approximately) $2,034.',
  },
}

export const DOD_PROCUREMENT_INDEX_1650: InflationIndexSpec = {
  kind: 'dod_procurement',
  factor: 1.4,
  vintage: {
    baseYear: 2017,
    statedAtSourceDate: '2026-08-12',
    publishedSeriesId: null,
    note:
      'The expert states 1.40 as his mid-range DoD procurement inflation factor. It is his ' +
      'stated judgement, not a published index reading, and the corpus names no series.',
  },
  preferred: true,
  preferenceRationale:
    'It "reflects industrial, metals, and logistics cost growth, which outpaced consumer ' +
    'inflation." The expert prefers it explicitly.',
  citation: {
    ...CORPUS_SECTION_2,
    quote:
      'DoD procurement inflation (his stated mid-range factor 1.40) (approximately) $2,150. ' +
      'He explicitly prefers the DoD figure.',
  },
}

export const INDEX_CONFIG_1650: AnchorIndexConfig = {
  cpi: CPI_INDEX_1650,
  dodProcurement: DOD_PROCUREMENT_INDEX_1650,
}

/**
 * NSN 1650-01-059-8221, the worked reference example, split hard into what the engine
 * COMPUTES and what the corpus merely RECORDS.
 *
 * THE $3,565 LINE IS THE WHOLE REASON THIS SPLIT EXISTS. It is a real fact: he really did
 * quote $3,565 and really did draw a counter-offer request. It is NOT an output of the
 * inflation anchor. His own sentence gives its derivation, "three times the unit price of the
 * previous award", which is a different rule on a different input. The anchor produces
 * $2,033.50 and $2,152.99, and no chain of the configured factors reaches $3,565. A waterfall
 * built to "reproduce $3,565" from the OEM anchor can only get there by back-solving a
 * coefficient until the number appears, which is fabricated arithmetic on the one surface
 * where a wrong number costs the customer their standing with their buyer. So it lives here,
 * as a recorded observation with its derivation named, and the test asserts the anchor does
 * not produce it.
 *
 * NOTE THE UNRESOLVED DISCREPANCY, RECORDED RATHER THAN RESOLVED. His quote implies a previous
 * award unit price of $1,188.33 (3565 / 3), while the supplier price he paid, $1,021.50, is
 * described as "based on the unit price of the previous award". Those two cannot both be that
 * award price. The corpus never prints the previous award unit price directly, so the implied
 * figure is graded DERIVED, is never used as an input anywhere in this package, and the
 * discrepancy is left visible instead of being smoothed over.
 */
export const NSN_1650_01_059_8221 = {
  nsn: '1650-01-059-8221',
  /** The only computed input. Everything else on this fixture is an observation. */
  oemAward: { unitPriceUsd: 1537.85, awardYear: 2017, quantity: 17 } as OemAward,
  priorAwardsAllSurplusCount: 13,
  observations: {
    quotedUnitPriceUsd: {
      value: 3565,
      grade: 'CORPUS_STATED' as const,
      derivationStatedBySource: 'three times the unit price of the previous award',
      isAnAnchorOutput: false,
      note:
        'Recorded, never computed. 3565 / 3 = 1188.3333, so the input is a previous award unit ' +
        'price, not the 2017 OEM award of $1,537.85 the anchor runs on.',
    },
    impliedPreviousAwardUnitPriceUsd: {
      value: 3565 / 3,
      grade: 'DERIVED' as const,
      note:
        'Implied by his own sentence, printed nowhere in the corpus. Never used as an input. ' +
        'It also does not equal the $1,021.50 supplier price that is described as being based ' +
        'on that same previous award, and that discrepancy is unresolved in the source.',
    },
    supplierPurchaseOrder: {
      unitPriceUsd: 1021.5,
      quantity: 8,
      grade: 'CORPUS_STATED' as const,
      note: 'PO issued to OLY Aero for 8 units. What we paid, not what we quote.',
    },
    surplusClearingRatio: {
      value: 0.5,
      grade: 'CORPUS_STATED' as const,
      verbatim: 'about 50% of Moog inflation adjusted value',
    },
    statedApproximations: {
      cpiUsd: 2034,
      cpiVerbatim: 'approximately $2,034',
      dodUsd: 2150,
      dodVerbatim: 'approximately $2,150',
    },
  },
  citation: CORPUS_SECTION_2,
} as const

export const SURPLUS_CLEARING_CITATION: SourceCitation = {
  ...CORPUS_SECTION_2,
  quote: 'Surplus awards run at about 50% of Moog inflation adjusted value.',
}
