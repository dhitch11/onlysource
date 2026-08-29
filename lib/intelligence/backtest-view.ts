/**
 * THE BACKTEST, AS AN HONEST STATE — not a fabricated surface.
 *
 * ==========================================================================================
 * WHY THIS FILE EXISTS AND WHY IT MOSTLY SAYS "NOT YET".
 * ==========================================================================================
 * `lib/engine/backtest/harness.ts` is 1,193 lines of unusually rigorous, tested work: a purged,
 * embargoed, item-grouped walk-forward split with an independent leak detector, expected-value-
 * at-k as the pre-registered primary metric, and a calibration gate that refuses to publish a
 * probability below 50 resolved outcomes. It answers "would this scoring strategy have made
 * money," honestly. It reaches no page.
 *
 * The reason it reaches no page is not an oversight to paper over — it is a fact about the data,
 * and the honest thing is to state it. A backtest needs, per row, a RESOLVED OUTCOME of the
 * scorecard's OWN prediction: `BacktestRow.label` (won = 1 / lost = 0) and `realised_value_usd`.
 * ONLYSOURCE has quoted nothing, so there are zero such labels. The DLA award history the product
 * holds is third-party outcomes — who won past DLA awards — not a record of what THIS scorecard
 * predicted at the time and what then happened. Those are different things, and treating award
 * history as a backtest label would be scoring the model against answers it never committed to.
 *
 * So this module does not run a backtest on data that cannot support one. It reports, from
 * measured counts, whether a backtest can run, and when it cannot, exactly what data would unlock
 * it. If a resolved-outcome ledger ever exists (50+ resolved), the same function runs the real
 * harness and returns its report. The abstention is the designed dominant state, not an error
 * page — styling the "not yet" as an exception would teach an operator to expect a number that
 * is not honestly available.
 *
 * DECOUPLED BY DESIGN. This file imports only the harness (stable, and injected-scorer by
 * contract) and takes its counts as inputs. It does not import the candidate-map or portfolio
 * builders, which are under active change in another lane, so a signature change there cannot
 * break this. The page that renders this passes the counts it already has.
 */

import {
  runBacktest,
  MIN_RESOLVED_FOR_CALIBRATION,
  type BacktestReport,
  type BacktestRow,
  type RowScorer,
  type RunOptions,
} from '@/lib/engine/backtest/harness'

/** What the view needs to decide whether a backtest can honestly run. All measured upstream. */
export type BacktestInputs = {
  /** Candidate positions the scorer could score today (e.g. the corner-map candidate count). */
  scoreableCandidates: number
  /**
   * Rows carrying a RESOLVED outcome of a past prediction: a recorded win/loss AND realised value.
   * This is the number that gates everything. On live ONLYSOURCE data today it is 0.
   */
  resolvedOutcomes: number
  /** The feed day the counts were measured on, for provenance on the rendered state. */
  feedDay: string
}

export type BacktestAvailability =
  | {
      readonly state: 'ready'
      readonly feedDay: string
      readonly resolvedOutcomes: number
      /** Present only when ready: the real harness report. */
      readonly report: BacktestReport
    }
  | {
      readonly state: 'not_yet'
      readonly feedDay: string
      readonly scoreableCandidates: number
      readonly resolvedOutcomes: number
      readonly resolvedNeeded: number
      /** One plain sentence an operator reads first. */
      readonly headline: string
      /** The precise reason, and the exact data that would unlock it. */
      readonly why: string
      readonly unlock: readonly string[]
    }

/**
 * The honest headline for the not-yet state. Deliberately not alarming and not apologetic: the
 * engine is ready, the evidence is not, and that is a normal state for a product that has not yet
 * transacted.
 */
function notYetHeadline(scoreable: number): string {
  return scoreable > 0
    ? `The strategy can be scored on ${scoreable.toLocaleString()} candidates today, but it cannot yet be proven on money — no quote has resolved into a recorded win or loss.`
    : 'No candidates are scoreable on this feed day, and no outcome has resolved, so there is nothing to backtest yet.'
}

const WHY =
  'A backtest measures a strategy against outcomes it committed to in advance: for each position, ' +
  'what the scorer predicted as-of a date, and what actually happened when the award resolved. ' +
  'ONLYSOURCE has not quoted anything, so no prediction has a recorded result. The DLA award ' +
  'history the product holds is who won past awards — a third-party fact, not a record of this ' +
  "scorecard's own predictions — so using it as a label would score the model against answers it " +
  'never gave. The calibration gate also refuses to publish a probability below ' +
  `${MIN_RESOLVED_FOR_CALIBRATION} resolved outcomes, on purpose.`

const UNLOCK: readonly string[] = [
  'Record each pursuit as a prediction: the candidate, its CornerScore, and the date it was scored.',
  'When the award resolves, record the outcome — won or lost — and the realised dollar value.',
  `Accumulate at least ${MIN_RESOLVED_FOR_CALIBRATION} resolved outcomes; the harness then runs a purged, item-grouped walk-forward backtest and reports expected-value-at-k, precision, and a calibrated probability.`,
  'Until then this page states the strategy is scoreable but unproven, which is the true state.',
]

/**
 * Decide whether a backtest can run and return the honest view. When enough outcomes exist, run
 * the real harness with the injected scorer and cases; otherwise return the not-yet state.
 *
 * `runnable` (cases + scorer + options) is optional and only consulted when the resolved count
 * clears the gate, so a caller with no ledger never needs to construct it.
 */
export function buildBacktestView(
  inputs: BacktestInputs,
  runnable?: { cases: readonly BacktestRow[]; scorer: RowScorer; options: RunOptions },
): BacktestAvailability {
  const canRun = inputs.resolvedOutcomes >= MIN_RESOLVED_FOR_CALIBRATION && runnable != null

  if (canRun) {
    return {
      state: 'ready',
      feedDay: inputs.feedDay,
      resolvedOutcomes: inputs.resolvedOutcomes,
      report: runBacktest(runnable.cases, runnable.scorer, runnable.options),
    }
  }

  return {
    state: 'not_yet',
    feedDay: inputs.feedDay,
    scoreableCandidates: inputs.scoreableCandidates,
    resolvedOutcomes: inputs.resolvedOutcomes,
    resolvedNeeded: MIN_RESOLVED_FOR_CALIBRATION,
    headline: notYetHeadline(inputs.scoreableCandidates),
    why: WHY,
    unlock: UNLOCK,
  }
}
