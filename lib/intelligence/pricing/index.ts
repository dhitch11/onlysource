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
