/**
 * The quote view's public door.
 *
 * One import path for a page, so a screen cannot reach past it into an internal and start
 * assembling its own figures. The pricing ENGINE stays behind `@/lib/engine/pricing`: this
 * package adapts it, it does not replace it, and nothing here computes a price.
 */

export {
  DEFAULT_FLIP_WINDOW_MONTHS,
  QUOTE_EVIDENCE_STATES,
  QUOTE_FIGURE_IDS,
  assertFourSeparateFigures,
  buildQuoteView,
  identifyOemAward,
  recordedObservationSeedsForNsn,
  weakestEvidenceState,
  type AnchorFigure,
  type AnchorFigureAbstentionReason,
  type AnchorLine,
  type DossierAward,
  type EvaluatedAdderLine,
  type EvaluatedFigureAbstentionReason,
  type EvaluatedFloorUsd,
  type EvaluatedPriceFigure,
  type EvaluatedTotalUsd,
  type FigureAbstention,
  type FigureInput,
  type FlipBandAbstentionReason,
  type FlipObservation,
  type OemAwardIdentification,
  type OemAwardIdentificationFailure,
  type PricingBasis,
  type QuoteEvidenceState,
  type QuoteFigureId,
  type QuoteView,
  type QuoteViewInput,
  type QuotedTotalUsd,
  type RecentFlipBandFigure,
  type RecordedQuoteObservation,
  type TripwireBandFigure,
  type TripwireFigureAbstentionReason,
} from './quote-view'

export {
  quoteViewInputFromAwardSummary,
  toDossierAward,
  type OperatorDeclarations,
  type SolicitationFacts,
} from './from-dossier'

/*
 * THE RECOMMENDATION ENGINE, added 2026-08-19 by @PRICE-ENGINE, additive.
 *
 * The header above says "nothing here computes a price", and that was true while BD-19 forbade a
 * single recommended number. The owner lifted that rule on 2026-08-18 and silence became the
 * product failure, so this module DOES compute one, deterministically, from evidence it names.
 * The four figures stay exactly as they are underneath it as the audit trail.
 *
 * `OperatorDeclarations` is deliberately NOT re-exported from here: `./from-dossier` already owns
 * that name and the two shapes are the same three fields. Import the recommendation engine's own
 * type from `./recommend` when you need it under a different name.
 */
export {
  OPERATOR_AWARD_MULTIPLE,
  PEER_FLOOR_COUNT,
  RECOMMENDATION_CONFIG,
  RECOMMENDATION_RUNGS,
  RUNG_LABELS,
  assertRecommendationCarriesNoEvaluationFactor,
  driftHalfWidthPerYear,
  fscOf,
  recommendPrice,
  type AwardeeClassifierPort,
  type ComparableSurplusRead,
  type EvaluatedAdderSummary,
  type EvaluatedPriceContext,
  type EvaluatedTotalRangeUsd,
  type PeerLookup,
  type PriceIncreaseContext,
  type PriceRecommendation,
  type PricedPeer,
  type QuotedTotalRangeUsd,
  type RecommendationAbstentionReason,
  type RecommendationCaveat,
  type RecommendationCaveatCode,
  type RecommendationConfig,
  type RecommendationInput,
  type RecommendationInputValue,
  type RecommendationRung,
  type RecommendedFigure,
  type ResolvedRungOutcome,
  type RungOutcome,
  type RungUnavailableReason,
  type SurplusStance,
} from './recommend'
