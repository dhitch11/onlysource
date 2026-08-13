/**
 * The pricing package's public surface.
 *
 * Exists as a single door so the lanes that consume pricing (the intelligence surfaces, the
 * board, the quote screen) import from one path and cannot reach past it into an internal.
 * Everything here is a pure function over injected configuration: no I/O, no database, no
 * clock read, no framework. Time enters as an explicit instant argument on every call that
 * needs one, because a threshold read against wall time cannot be evaluated for a 2017 award.
 */

export {
  FACTOR_SCALE,
  ESA_COORDINATION_ADDER,
  MICRO_PURCHASE_THRESHOLD,
  PRICING_CONFIG,
  SIMPLIFIED_ACQUISITION_THRESHOLD,
  SURPLUS_EVALUATION_ADDER,
  TRIPWIRE_AT_OR_ABOVE_MPT,
  TRIPWIRE_UNDER_MPT,
  applyFactorToCents,
  centsToUsd,
  resolveThreshold,
  roundHalfUp,
  usdToCents,
  type DatedEntry,
  type DatedSeries,
  type EvidenceGrade,
  type FactorApplication,
  type PricingConfig,
  type ResolvedThreshold,
  type SourceCitation,
  type ThresholdAbstention,
  type ThresholdResolution,
} from './config'

export {
  CPI_INDEX_1650,
  DOD_PROCUREMENT_INDEX_1650,
  INDEX_CONFIG_1650,
  NSN_1650_01_059_8221,
  ROUNDING_RULES,
  ROUNDING_RULE_NAMES,
  SURPLUS_CLEARING_CITATION,
  anchorPrice,
  reconcileStatedApproximation,
  sharedRoundingRules,
  surplusClearingEstimate,
  type AnchorAbstention,
  type AnchorAbstentionReason,
  type AnchorIndexConfig,
  type AnchorOutcome,
  type AnchorResult,
  type IndexKind,
  type InflationIndexSpec,
  type OemAward,
  type RoundingRuleName,
  type SeriesVintage,
  type StatedApproximation,
  type SurplusClearingObservation,
} from './anchor'

export {
  CORPUS_DRAG_REFERENCE_CASES,
  evaluatedTotal,
  quotedTotal,
  surplusDrag,
  type AdderApplicability,
  type AdderCode,
  type EvaluatedTotal,
  type EvaluatedTotalAbstention,
  type EvaluatedTotalOutcome,
  type EvaluationAdder,
  type QuotedTotal,
  type SurplusDrag,
  type SurplusDragAbstention,
  type SurplusDragOutcome,
} from './evaluated'

export {
  tripwireBand,
  twelveMonthsBeforeUtc,
  type TripwireAbstention,
  type TripwireAbstentionReason,
  type TripwireAssessment,
  type TripwireBandKind,
  type TripwireConsequence,
  type TripwireInput,
  type TripwireOutcome,
} from './tripwire'
