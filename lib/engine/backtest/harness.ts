/**
 * THE BACKTEST HARNESS. Pure library, injected clock, no I/O of its own.
 *
 * This module exists because a backtest is the only thing standing between an interpretable
 * scorecard and a confident wrong answer. Everything here is built so that a flattering
 * number is HARD to produce:
 *
 *   1. THE SPLIT IS GROUPED BY ITEM AS WELL AS BY TIME. Two solicitations for the same stock
 *      number months apart share nearly all their features, so a time-only split leaks item
 *      identity and the model scores its own training rows. `splitWalkForward` purges every
 *      same-item row out of the training side, and `itemLeaks` is the independent invariant
 *      check that says so. A run with a non-empty leak list is marked invalid, not warned about.
 *
 *   2. LABEL WINDOWS ARE PURGED, AND THE PERIOD AROUND EACH FOLD IS EMBARGOED. A row whose
 *      outcome only resolves inside the test window knew something about that window. A
 *      solicitation materially changes the state of the world for the next one on the same
 *      item, so the band on either side of a fold is dropped as well.
 *
 *   3. THE PRIMARY METRIC IS EXPECTED VALUE AT K, at the k a human can actually work. The
 *      binding constraint on this business is human attention, not a classification threshold,
 *      so the headline number is the value of the rows a person actually opens.
 *
 *   4. ANY AREA-UNDER-CURVE FIGURE CARRIES ITS CLASS RATIO IN THE SAME OBJECT. The AUC baseline
 *      moves with prevalence, so an AUC reported without the ratio is not interpretable. The
 *      return type makes it impossible to read one without the other.
 *
 *   5. THE CONFIGURATION COUNT IS A REQUIRED INPUT. Best-of-many on a small sample is partly
 *      luck. A caller who tried nine scorecard variants and reports the best one has to say so,
 *      and `configurations_tried` below 1 throws rather than defaulting to a comfortable 1.
 *
 *   6. NO CALIBRATED PROBABILITY BELOW 50 RESOLVED OUTCOMES. The gate returns an explicit null
 *      with n and the method on its face, never a number that looks like knowledge.
 *
 * Two pinned fixtures ride on this module and they are DIFFERENT KINDS. NSN 1650-01-059-8221
 * gates the ARITHMETIC: an anchor implementation is correct only when it reproduces the
 * expert's dual-inflation products to the cent. NSN 4730-00-536-2210 gates the SIGNAL CHOICE:
 * a scorecard is correct when it disposes the item the way he did and surfaces the reasons he
 * himself elevated. Neither substitutes for the other, so they have separate evaluators and
 * separate result types.
 */

import { z } from 'zod'
import type { Clock } from '../../time/clock'

// =====================================================================================================
// ROWS AND SPLITS
// =====================================================================================================

/** One evaluable historical row. `item_key` is the grouping key, normally the stock number. */
export type BacktestRow = {
  readonly row_id: string
  readonly item_key: string
  /** When this row's features are as-of. The only time used for ordering and windowing. */
  readonly event_at_ms: number
  /** When the outcome became knowable. `[event_at_ms, label_resolved_at_ms]` is the label window. */
  readonly label_resolved_at_ms: number
  readonly label: 0 | 1 | null
  readonly realised_value_usd: number | null
}

export type ExclusionReason =
  | 'purged_same_item'
  | 'purged_label_overlap'
  | 'embargoed_before'
  | 'embargoed_after'
  | 'not_yet_available'

export type Exclusion = {
  readonly row_id: string
  /** The first reason in the fixed order below. Recorded so a fold has a single headline cause. */
  readonly primary_reason: ExclusionReason
  /** EVERY reason that applies. A row dropped for two reasons must not look like it had one. */
  readonly reasons: readonly ExclusionReason[]
}

/**
 * `expanding` is the honest default for this business: only the past is available when a
 * decision is made. `all_outside_test` is purged K-fold, offered because it is the mode in
 * which the trailing embargo band actually binds, and a control that can never fire is not a
 * control.
 */
export type TrainMode = 'expanding' | 'all_outside_test'

export type SplitOptions = {
  readonly folds: number
  readonly embargo_ms: number
  readonly train_mode?: TrainMode
  /** Explicit ascending test-window starts. Omit to get equal-width windows over the row span. */
  readonly boundaries_ms?: readonly number[]
}

export type Fold = {
  readonly fold_index: number
  readonly test_start_ms: number
  readonly test_end_ms: number
  readonly test_row_ids: readonly string[]
  readonly train_row_ids: readonly string[]
  readonly excluded: readonly Exclusion[]
  readonly counts: {
    readonly test: number
    readonly train: number
    readonly purged_same_item: number
    readonly purged_label_overlap: number
    readonly embargoed_before: number
    readonly embargoed_after: number
    readonly not_yet_available: number
  }
}

export type WalkForwardSplit = {
  readonly train_mode: TrainMode
  readonly embargo_ms: number
  readonly folds: readonly Fold[]
}

export type ItemLeak = {
  readonly fold_index: number
  readonly item_key: string
  readonly train_row_ids: readonly string[]
  readonly test_row_ids: readonly string[]
}

/** Reason precedence. Fixed and exported so a caller can explain a drop without guessing. */
export const EXCLUSION_PRECEDENCE: readonly ExclusionReason[] = [
  'not_yet_available',
  'purged_same_item',
  'purged_label_overlap',
  'embargoed_before',
  'embargoed_after',
]

/**
 * Equal-width test-window starts across the span of the rows.
 *
 * Exported because the boundaries are the one part of a split a reviewer will want to check by
 * hand, and a boundary computed inside a private function cannot be checked at all.
 */
export function equalWidthBoundaries(rows: readonly BacktestRow[], folds: number): number[] {
  if (rows.length === 0) return []
  let min = rows[0]!.event_at_ms
  let max = min
  for (const r of rows) {
    if (r.event_at_ms < min) min = r.event_at_ms
    if (r.event_at_ms > max) max = r.event_at_ms
  }
  // Half-open windows, so the span is extended by one millisecond to include the last row.
  const span = max + 1 - min
  const out: number[] = []
  for (let i = 0; i < folds; i += 1) out.push(min + Math.floor((i * span) / folds))
  return out
}

/**
 * PURGED, EMBARGOED, ITEM-GROUPED WALK-FORWARD SPLIT.
 *
 * The reason this is the centre of the module: a time-only split looks rigorous and still lets
 * the same stock number sit on both sides of the same fold, which is the single most effective
 * way to produce a backtest number nobody can reproduce in production.
 */
export function splitWalkForward(
  rows: readonly BacktestRow[],
  options: SplitOptions,
): WalkForwardSplit {
  if (!Number.isInteger(options.folds) || options.folds < 1) {
    throw new Error('backtest: folds must be an integer of at least 1')
  }
  if (!Number.isFinite(options.embargo_ms) || options.embargo_ms < 0) {
    throw new Error('backtest: embargo_ms must be a finite number of at least 0')
  }
  const trainMode: TrainMode = options.train_mode ?? 'expanding'
  const starts = options.boundaries_ms
    ? [...options.boundaries_ms]
    : equalWidthBoundaries(rows, options.folds)

  let spanEnd = 0
  for (const r of rows) if (r.event_at_ms + 1 > spanEnd) spanEnd = r.event_at_ms + 1

  const folds: Fold[] = []
  for (let i = 0; i < starts.length; i += 1) {
    const testStart = starts[i]!
    const testEnd = i + 1 < starts.length ? starts[i + 1]! : Math.max(spanEnd, testStart)

    const test = rows.filter((r) => r.event_at_ms >= testStart && r.event_at_ms < testEnd)
    const testItems = new Set(test.map((r) => r.item_key))
    const testIds = new Set(test.map((r) => r.row_id))

    const trainIds: string[] = []
    const excluded: Exclusion[] = []
    const counts = {
      test: test.length,
      train: 0,
      purged_same_item: 0,
      purged_label_overlap: 0,
      embargoed_before: 0,
      embargoed_after: 0,
      not_yet_available: 0,
    }

    for (const r of rows) {
      if (testIds.has(r.row_id)) continue
      const reasons: ExclusionReason[] = []

      if (trainMode === 'expanding' && r.event_at_ms >= testEnd) reasons.push('not_yet_available')
      if (testItems.has(r.item_key)) reasons.push('purged_same_item')
      // Label window [event, resolved] overlaps [testStart, testEnd) when it starts before the
      // window ends and resolves at or after the window begins.
      if (r.event_at_ms < testEnd && r.label_resolved_at_ms >= testStart) {
        reasons.push('purged_label_overlap')
      }
      if (r.event_at_ms < testStart && r.event_at_ms >= testStart - options.embargo_ms) {
        reasons.push('embargoed_before')
      }
      if (r.event_at_ms >= testEnd && r.event_at_ms < testEnd + options.embargo_ms) {
        reasons.push('embargoed_after')
      }

      if (reasons.length === 0) {
        trainIds.push(r.row_id)
        continue
      }
      const ordered = EXCLUSION_PRECEDENCE.filter((reason) => reasons.includes(reason))
      const primary = ordered[0]!
      excluded.push({ row_id: r.row_id, primary_reason: primary, reasons: ordered })
      counts[primary] += 1
    }

    counts.train = trainIds.length
    folds.push({
      fold_index: i,
      test_start_ms: testStart,
      test_end_ms: testEnd,
      test_row_ids: test.map((r) => r.row_id),
      train_row_ids: trainIds,
      excluded,
      counts,
    })
  }

  return { train_mode: trainMode, embargo_ms: options.embargo_ms, folds }
}

/**
 * The independent invariant: no item may appear on both sides of a fold.
 *
 * Written as a separate function rather than an assertion inside the splitter on purpose. A
 * splitter that checks its own work proves nothing, and this function is pointed at a
 * deliberately broken time-only splitter in the test to prove the instrument can fire.
 */
export function itemLeaks(
  split: WalkForwardSplit,
  rows: readonly BacktestRow[],
): ItemLeak[] {
  const byId = new Map(rows.map((r) => [r.row_id, r]))
  const out: ItemLeak[] = []
  for (const fold of split.folds) {
    const trainByItem = new Map<string, string[]>()
    for (const id of fold.train_row_ids) {
      const r = byId.get(id)
      if (!r) continue
      const bucket = trainByItem.get(r.item_key)
      if (bucket) bucket.push(id)
      else trainByItem.set(r.item_key, [id])
    }
    const testByItem = new Map<string, string[]>()
    for (const id of fold.test_row_ids) {
      const r = byId.get(id)
      if (!r) continue
      const bucket = testByItem.get(r.item_key)
      if (bucket) bucket.push(id)
      else testByItem.set(r.item_key, [id])
    }
    for (const [itemKey, testIds] of [...testByItem.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const trainIds = trainByItem.get(itemKey)
      if (trainIds && trainIds.length > 0) {
        out.push({
          fold_index: fold.fold_index,
          item_key: itemKey,
          train_row_ids: trainIds,
          test_row_ids: testIds,
        })
      }
    }
  }
  return out
}

// =====================================================================================================
// METRICS
// =====================================================================================================

export type ScoredRow = {
  readonly row: BacktestRow
  readonly score: number
  readonly probability: number | null
}

/**
 * Deterministic ranking. Score descending, then row_id ascending as the tie-break.
 *
 * The tie-break is not cosmetic: without a stated one, two runs on the same data produce
 * different top-k sets, every rank-churn report becomes noise, and byte-identical replay is
 * impossible.
 */
export function rankByScore(scored: readonly ScoredRow[]): ScoredRow[] {
  return [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.row.row_id < b.row.row_id ? -1 : a.row.row_id > b.row.row_id ? 1 : 0
  })
}

export type ExpectedValueAtK = {
  readonly metric: 'expected_value_at_k'
  readonly k: number
  readonly k_effective: number
  readonly n_ranked: number
  readonly n_unresolved_excluded: number
  readonly total_value_usd: number
  readonly mean_value_per_row_usd: number | null
  readonly k_exceeded_available: boolean
}

/**
 * THE PRIMARY METRIC. The value of the rows a human actually opens.
 *
 * Rows with no realised outcome are excluded and counted rather than scored as zero, because
 * treating an unresolved row as a zero-value row biases the headline number downward by an
 * amount that grows with how fresh the data is.
 */
export function expectedValueAtK(scored: readonly ScoredRow[], k: number): ExpectedValueAtK {
  if (!Number.isInteger(k) || k < 1) throw new Error('backtest: k must be an integer of at least 1')
  const resolved = scored.filter((s) => s.row.realised_value_usd !== null)
  const ranked = rankByScore(resolved)
  const kEffective = Math.min(k, ranked.length)
  let total = 0
  for (let i = 0; i < kEffective; i += 1) total += ranked[i]!.row.realised_value_usd!
  return {
    metric: 'expected_value_at_k',
    k,
    k_effective: kEffective,
    n_ranked: ranked.length,
    n_unresolved_excluded: scored.length - resolved.length,
    total_value_usd: total,
    mean_value_per_row_usd: kEffective === 0 ? null : total / kEffective,
    k_exceeded_available: k > ranked.length,
  }
}

export type PrecisionAtK = {
  readonly metric: 'precision_at_k'
  readonly k: number
  readonly k_effective: number
  readonly n_labeled: number
  readonly positives_in_top_k: number
  readonly precision: number | null
}

/** Secondary. How much of the worked queue was a hit, over labelled rows only. */
export function precisionAtK(scored: readonly ScoredRow[], k: number): PrecisionAtK {
  if (!Number.isInteger(k) || k < 1) throw new Error('backtest: k must be an integer of at least 1')
  const labeled = scored.filter((s) => s.row.label !== null)
  const ranked = rankByScore(labeled)
  const kEffective = Math.min(k, ranked.length)
  let positives = 0
  for (let i = 0; i < kEffective; i += 1) if (ranked[i]!.row.label === 1) positives += 1
  return {
    metric: 'precision_at_k',
    k,
    k_effective: kEffective,
    n_labeled: labeled.length,
    positives_in_top_k: positives,
    precision: kEffective === 0 ? null : positives / kEffective,
  }
}

export type TopDecileRecall = {
  readonly metric: 'recall_of_top_margin_decile'
  readonly k: number
  readonly k_effective: number
  readonly n_resolved: number
  readonly decile_size: number
  readonly captured: number
  readonly recall: number | null
  readonly decile_row_ids: readonly string[]
}

/**
 * Secondary. Did we surface the outlier.
 *
 * Precision at k can look healthy while the single row carrying most of the realised margin
 * sits at rank 400, which is the failure this business would feel and the one an average
 * metric hides.
 */
export function recallOfTopMarginDecile(scored: readonly ScoredRow[], k: number): TopDecileRecall {
  if (!Number.isInteger(k) || k < 1) throw new Error('backtest: k must be an integer of at least 1')
  const resolved = scored.filter((s) => s.row.realised_value_usd !== null)
  const byMargin = [...resolved].sort((a, b) => {
    const av = a.row.realised_value_usd!
    const bv = b.row.realised_value_usd!
    if (bv !== av) return bv - av
    return a.row.row_id < b.row.row_id ? -1 : a.row.row_id > b.row.row_id ? 1 : 0
  })
  const decileSize = resolved.length === 0 ? 0 : Math.ceil(resolved.length / 10)
  const decileIds = new Set(byMargin.slice(0, decileSize).map((s) => s.row.row_id))
  const ranked = rankByScore(resolved)
  const kEffective = Math.min(k, ranked.length)
  let captured = 0
  for (let i = 0; i < kEffective; i += 1) if (decileIds.has(ranked[i]!.row.row_id)) captured += 1
  return {
    metric: 'recall_of_top_margin_decile',
    k,
    k_effective: kEffective,
    n_resolved: resolved.length,
    decile_size: decileSize,
    captured,
    recall: decileSize === 0 ? null : captured / decileSize,
    decile_row_ids: byMargin.slice(0, decileSize).map((s) => s.row.row_id),
  }
}

export type BrierReport = {
  readonly metric: 'brier_score'
  readonly n: number
  readonly brier: number | null
}

/** Tertiary. Mean squared error of the stated probability, with its n on its face. */
export function brierScore(scored: readonly ScoredRow[]): BrierReport {
  const usable = scored.filter((s) => s.row.label !== null && s.probability !== null)
  if (usable.length === 0) return { metric: 'brier_score', n: 0, brier: null }
  let sum = 0
  for (const s of usable) {
    const diff = s.probability! - s.row.label!
    sum += diff * diff
  }
  return { metric: 'brier_score', n: usable.length, brier: sum / usable.length }
}

export type AucReport = {
  readonly metric: 'roc_auc'
  readonly auc: number | null
  readonly n: number
  readonly positives: number
  readonly negatives: number
  /** Positives over n. REQUIRED in the same object so an AUC can never be read without it. */
  readonly class_ratio: number | null
  readonly baseline_note: string
}

/**
 * Area under the ROC curve, computed by average ranks so ties do not silently inflate it.
 *
 * The return type carries the class ratio as a required field on purpose. An AUC quoted
 * without prevalence is uninterpretable, and the way that mistake happens in practice is that
 * the number is easy to reach and the ratio is one field away.
 */
export function rocAuc(scored: readonly ScoredRow[]): AucReport {
  const labeled = scored.filter((s) => s.row.label !== null)
  const positives = labeled.filter((s) => s.row.label === 1).length
  const negatives = labeled.length - positives
  const note =
    'AUC is uninterpretable without prevalence. The baseline moves with the class ratio carried in this object.'
  if (labeled.length === 0) {
    return {
      metric: 'roc_auc',
      auc: null,
      n: 0,
      positives,
      negatives,
      class_ratio: null,
      baseline_note: note,
    }
  }
  const classRatio = positives / labeled.length
  if (positives === 0 || negatives === 0) {
    return {
      metric: 'roc_auc',
      auc: null,
      n: labeled.length,
      positives,
      negatives,
      class_ratio: classRatio,
      baseline_note: note,
    }
  }
  const ordered = [...labeled].sort((a, b) => a.score - b.score)
  const ranks = new Array<number>(ordered.length)
  let i = 0
  while (i < ordered.length) {
    let j = i
    while (j + 1 < ordered.length && ordered[j + 1]!.score === ordered[i]!.score) j += 1
    // Average rank over the tied block, ranks being 1 based.
    const avg = (i + 1 + (j + 1)) / 2
    for (let t = i; t <= j; t += 1) ranks[t] = avg
    i = j + 1
  }
  let rankSumPositives = 0
  for (let t = 0; t < ordered.length; t += 1) {
    if (ordered[t]!.row.label === 1) rankSumPositives += ranks[t]!
  }
  const auc = (rankSumPositives - (positives * (positives + 1)) / 2) / (positives * negatives)
  return {
    metric: 'roc_auc',
    auc,
    n: labeled.length,
    positives,
    negatives,
    class_ratio: classRatio,
    baseline_note: note,
  }
}

/** Below this many resolved outcomes no calibrated probability is published, ever. */
export const MIN_RESOLVED_FOR_CALIBRATION = 50

/** The published fit. Named here so the report can state the method on its face. */
export const CALIBRATION_METHOD = 'sigmoid_fit_on_held_out_temporal_slice'

export type CalibrationGateReport = {
  readonly n_resolved: number
  readonly minimum_required: number
  readonly method: string
  readonly available: boolean
  /** Always null from the gate. The gate decides whether a fit may be published, it does not fit. */
  readonly probability: null
  readonly reason: string
}

/**
 * The small-n honesty gate.
 *
 * It returns an explicit null rather than a number because a probability printed off eleven
 * outcomes is not a weak measurement, it is a different kind of object, and rounding it to two
 * decimals is what makes it look like knowledge.
 */
export function calibrationGate(nResolved: number): CalibrationGateReport {
  const available = nResolved >= MIN_RESOLVED_FOR_CALIBRATION
  return {
    n_resolved: nResolved,
    minimum_required: MIN_RESOLVED_FOR_CALIBRATION,
    method: CALIBRATION_METHOD,
    available,
    probability: null,
    reason: available
      ? `gate open at n=${nResolved}, the fit itself is supplied by the calibration module and is not computed here`
      : `no calibrated probability published: n=${nResolved} resolved outcomes is below the minimum of ${MIN_RESOLVED_FOR_CALIBRATION}`,
  }
}

// =====================================================================================================
// THE RUN
// =====================================================================================================

export type RowScorer = {
  readonly scorecard_version: string
  score(row: BacktestRow): { readonly score: number; readonly probability: number | null }
}

export type RunOptions = {
  /** The number of rows a human can actually work in the period. The metric is defined at it. */
  readonly k: number
  readonly split: SplitOptions
  /** How many scorecard variants were tried before this one. Required, and 0 is not accepted. */
  readonly configurations_tried: number
  readonly clock: Clock
}

export type FoldMetrics = {
  readonly fold_index: number
  readonly test_start_ms: number
  readonly test_end_ms: number
  readonly n_test: number
  readonly n_train: number
  readonly expected_value_at_k: ExpectedValueAtK
  readonly precision_at_k: PrecisionAtK
}

export type BacktestReport = {
  readonly run_at_ms: number
  readonly scorecard_version: string
  readonly k: number
  readonly pre_registered_primary_metric: 'expected_value_at_k'
  readonly configuration_count: number
  readonly best_of_many: boolean
  readonly selection_note: string
  readonly split: {
    readonly train_mode: TrainMode
    readonly embargo_ms: number
    readonly item_leaks: readonly ItemLeak[]
  }
  readonly per_fold: readonly FoldMetrics[]
  readonly pooled: {
    readonly n_scored: number
    readonly n_resolved: number
    readonly expected_value_at_k: ExpectedValueAtK
    readonly precision_at_k: PrecisionAtK
    readonly recall_of_top_margin_decile: TopDecileRecall
    readonly brier: BrierReport
    readonly auc: AucReport
    readonly calibration: CalibrationGateReport
  }
  readonly valid: boolean
  readonly invalid_reasons: readonly string[]
  readonly honesty_notes: readonly string[]
}

/**
 * Run a scorer over a purged, embargoed, item-grouped walk-forward split and report the number
 * that survives, including when it embarrasses the model.
 *
 * The scorer is injected rather than imported so that this harness never depends on any one
 * scorecard version, and so a deliberately broken scorer can be pointed at it in a test.
 */
export function runBacktest(
  cases: readonly BacktestRow[],
  scorer: RowScorer,
  options: RunOptions,
): BacktestReport {
  if (!Number.isInteger(options.k) || options.k < 1) {
    throw new Error('backtest: k must be an integer of at least 1')
  }
  if (!Number.isInteger(options.configurations_tried) || options.configurations_tried < 1) {
    throw new Error(
      'backtest: configurations_tried must be an integer of at least 1, because a run that reports zero configurations tried is claiming the first thing anyone wrote was the one shipped',
    )
  }

  const split = splitWalkForward(cases, options.split)
  const leaks = itemLeaks(split, cases)
  const byId = new Map(cases.map((r) => [r.row_id, r]))

  const perFold: FoldMetrics[] = []
  const pooled: ScoredRow[] = []
  for (const fold of split.folds) {
    const scored: ScoredRow[] = []
    for (const id of fold.test_row_ids) {
      const row = byId.get(id)
      if (!row) continue
      const out = scorer.score(row)
      scored.push({ row, score: out.score, probability: out.probability })
      pooled.push({ row, score: out.score, probability: out.probability })
    }
    perFold.push({
      fold_index: fold.fold_index,
      test_start_ms: fold.test_start_ms,
      test_end_ms: fold.test_end_ms,
      n_test: fold.counts.test,
      n_train: fold.counts.train,
      expected_value_at_k: expectedValueAtK(scored, options.k),
      precision_at_k: precisionAtK(scored, options.k),
    })
  }

  const nResolved = pooled.filter((s) => s.row.realised_value_usd !== null).length
  const calibration = calibrationGate(nResolved)
  const auc = rocAuc(pooled)
  const bestOfMany = options.configurations_tried > 1

  const invalidReasons: string[] = []
  if (leaks.length > 0) {
    invalidReasons.push(
      `item leak: ${leaks.length} item-fold pair(s) appear on both sides of a split, so this run measures the model scoring its own training items`,
    )
  }

  const honesty: string[] = []
  honesty.push(
    `primary metric pre-registered as expected value at k with k=${options.k}, chosen as the number of rows a human can work, not as a classification threshold`,
  )
  honesty.push(
    `${options.configurations_tried} scorecard configuration(s) were tried. ${
      bestOfMany
        ? 'A best-of-many result on a small sample is partly luck and this number should be discounted for selection.'
        : 'A single configuration was tried, so there is no selection to discount.'
    }`,
  )
  honesty.push(calibration.reason)
  if (auc.auc !== null) {
    honesty.push(
      `AUC ${auc.auc} is reported against a class ratio of ${auc.class_ratio} over n=${auc.n}. The baseline moves with prevalence.`,
    )
  } else {
    honesty.push(
      `AUC not computed: positives=${auc.positives}, negatives=${auc.negatives}, n=${auc.n}.`,
    )
  }
  if (nResolved < MIN_RESOLVED_FOR_CALIBRATION) {
    honesty.push(
      `n=${nResolved} resolved outcomes. Every figure in this report rests on that n and should be read as a short evaluation history reported honestly, not as a converged estimate.`,
    )
  }

  return {
    run_at_ms: options.clock.now(),
    scorecard_version: scorer.scorecard_version,
    k: options.k,
    pre_registered_primary_metric: 'expected_value_at_k',
    configuration_count: options.configurations_tried,
    best_of_many: bestOfMany,
    selection_note: bestOfMany
      ? 'best of many configurations, discount for selection'
      : 'single configuration, no selection to discount',
    split: { train_mode: split.train_mode, embargo_ms: split.embargo_ms, item_leaks: leaks },
    per_fold: perFold,
    pooled: {
      n_scored: pooled.length,
      n_resolved: nResolved,
      expected_value_at_k: expectedValueAtK(pooled, options.k),
      precision_at_k: precisionAtK(pooled, options.k),
      recall_of_top_margin_decile: recallOfTopMarginDecile(pooled, options.k),
      brier: brierScore(pooled),
      auc,
      calibration,
    },
    valid: invalidReasons.length === 0,
    invalid_reasons: invalidReasons,
    honesty_notes: honesty,
  }
}

// =====================================================================================================
// FIXTURE 1: THE PRICING-ARITHMETIC FIXTURE (NSN 1650-01-059-8221)
// =====================================================================================================

const holderSchema = z.strictObject({ name: z.string(), units: z.number() })

const inflationAnchorSchema = z.strictObject({
  anchor_id: z.enum(['cpi', 'dod_procurement']),
  label: z.string(),
  factor: z.number(),
  product_exact_usd: z.number(),
  expert_stated_approximation_usd: z.number(),
  stated_approximation_tolerance_usd: z.number(),
  preferred_by_expert: z.boolean(),
  preference_reason_quote: z.string().optional(),
  rounding_note: z.string(),
})

export const pricingFixtureSchema = z.strictObject({
  fixture_id: z.literal('nsn-1650-01-059-8221'),
  fixture_kind: z.literal('pricing_arithmetic'),
  nsn: z.string(),
  provenance: z.strictObject({
    source_path: z.string(),
    source_section: z.string(),
    source_kind: z.string(),
    source_document_title: z.string(),
    read_directly: z.boolean(),
    encoded_on: z.string(),
    encoding_rule: z.string(),
    transcription_note: z.string(),
  }),
  oem_award: z.strictObject({
    year: z.number(),
    manufacturer: z.string(),
    quantity_units: z.number(),
    unit_price_usd: z.number(),
    quote: z.string(),
    why_this_is_the_anchor: z.string(),
  }),
  prior_awards: z.strictObject({
    count: z.number(),
    all_surplus: z.boolean(),
    quote: z.string(),
  }),
  oem_excluded_by_lot_size: z.strictObject({
    quote: z.string(),
    oem_award_quantity_units: z.number(),
  }),
  inflation_anchors: z.array(inflationAnchorSchema),
  dual_index_rule: z.string(),
  surplus_clearing: z.strictObject({
    share_of_inflation_adjusted_oem_value: z.number(),
    is_approximate: z.boolean(),
    quote: z.string(),
    note: z.string(),
  }),
  ils_availability: z.strictObject({
    quote: z.string(),
    holders: z.array(holderSchema),
    note: z.string(),
  }),
  demand_without_forecast: z.strictObject({
    forecast_exists: z.boolean(),
    awards: z.number(),
    units: z.number(),
    window_text: z.string(),
    quote: z.string(),
    rule: z.string(),
  }),
  observed_quote: z.strictObject({
    amount_usd: z.number(),
    expert_description: z.string(),
    quote: z.string(),
    multiplier_of_previous_award_unit_price: z.number(),
    is_engine_output: z.literal(false),
    honesty_note: z.string(),
  }),
  supplier_purchase_order: z.strictObject({
    supplier: z.string(),
    quantity_units: z.number(),
    unit_price_usd: z.number(),
    quote: z.string(),
    supplier_anchor_error_quote: z.string(),
    note: z.string(),
  }),
  public_list_price: z.strictObject({
    exists: z.literal(false),
    quote: z.string(),
    note: z.string(),
  }),
})

export type PricingFixture = z.infer<typeof pricingFixtureSchema>

export type RoundingRule =
  | 'nearest_dollar'
  | 'ceil_dollar'
  | 'floor_dollar'
  | 'nearest_ten'
  | 'nearest_hundred'

/** Fixed order, so the list a fixture reports is stable and hand-checkable. */
export const ROUNDING_RULES: readonly RoundingRule[] = [
  'nearest_dollar',
  'ceil_dollar',
  'floor_dollar',
  'nearest_ten',
  'nearest_hundred',
]

/** One named rounding rule applied to an exact figure. No rule here invents precision. */
export function applyRoundingRule(exact: number, rule: RoundingRule): number {
  switch (rule) {
    case 'nearest_dollar':
      return Math.round(exact)
    case 'ceil_dollar':
      return Math.ceil(exact)
    case 'floor_dollar':
      return Math.floor(exact)
    case 'nearest_ten':
      return Math.round(exact / 10) * 10
    case 'nearest_hundred':
      return Math.round(exact / 100) * 100
  }
}

/**
 * Which named rounding rules reproduce a printed approximation from an exact product.
 *
 * This exists because the expert's two printed figures are NOT reproduced by the same rule,
 * and the temptation when a hand-written approximation is a little off is to describe it as
 * "rounds to", which quietly asserts an arithmetic relationship that does not hold. This
 * function makes the real relationship a first-class value that a test can pin.
 */
export function roundingRulesReproducing(exact: number, stated: number): RoundingRule[] {
  return ROUNDING_RULES.filter((rule) => applyRoundingRule(exact, rule) === stated)
}

/** The anchor under test. Injected so this harness never carries a second implementation. */
export type DualInflationAnchor = (input: {
  readonly unit_price_usd: number
  readonly factor: number
}) => number

export type AnchorCheck = {
  readonly anchor_id: 'cpi' | 'dod_procurement'
  readonly label: string
  readonly factor: number
  readonly expected_exact_usd: number
  readonly computed_usd: number
  readonly exact_match: boolean
  readonly preferred_by_expert: boolean
  readonly expert_stated_approximation_usd: number
  readonly absolute_difference_from_stated_usd: number
  readonly stated_within_tolerance: boolean
  readonly tolerance_usd: number
  readonly rounding_rules_reproducing_stated: readonly RoundingRule[]
}

export type PricingFixtureResult = {
  readonly fixture_id: string
  readonly nsn: string
  readonly anchors: readonly AnchorCheck[]
  readonly preferred_anchor_id: 'cpi' | 'dod_procurement' | null
  readonly observed_quote: {
    readonly amount_usd: number
    readonly is_engine_output: false
    readonly ratio_to_oem_unit_price: number
    readonly matches_any_anchor_factor: boolean
    readonly note: string
  }
  readonly acquisition_vs_anchor: readonly {
    readonly anchor_id: 'cpi' | 'dod_procurement'
    readonly acquisition_unit_price_usd: number
    readonly share_of_anchor: number
    readonly expert_stated_share: number
    readonly within_stated_tolerance: boolean
  }[]
  readonly single_rounding_rule_reproduces_both: boolean
  readonly arithmetic_ok: boolean
  readonly findings: readonly string[]
}

/** Tolerance on the expert's approximate "about 50%" surplus clearing characterisation. */
export const SURPLUS_CLEARING_TOLERANCE = 0.03

/**
 * Gate an anchor implementation against the expert's own worked arithmetic.
 *
 * `arithmetic_ok` is true only when the injected anchor reproduces BOTH exact products to the
 * cent. Nothing about his printed approximations can make it true, because an approximation is
 * a rounding of a result, never evidence that the result is right.
 */
export function evaluatePricingFixture(
  fixture: PricingFixture,
  anchor: DualInflationAnchor,
): PricingFixtureResult {
  const unitPrice = fixture.oem_award.unit_price_usd
  const anchors: AnchorCheck[] = fixture.inflation_anchors.map((a) => {
    const computed = anchor({ unit_price_usd: unitPrice, factor: a.factor })
    const diff = Math.abs(a.expert_stated_approximation_usd - a.product_exact_usd)
    return {
      anchor_id: a.anchor_id,
      label: a.label,
      factor: a.factor,
      expected_exact_usd: a.product_exact_usd,
      computed_usd: computed,
      exact_match: computed === a.product_exact_usd,
      preferred_by_expert: a.preferred_by_expert,
      expert_stated_approximation_usd: a.expert_stated_approximation_usd,
      absolute_difference_from_stated_usd: diff,
      stated_within_tolerance: diff <= a.stated_approximation_tolerance_usd,
      tolerance_usd: a.stated_approximation_tolerance_usd,
      rounding_rules_reproducing_stated: roundingRulesReproducing(
        a.product_exact_usd,
        a.expert_stated_approximation_usd,
      ),
    }
  })

  const ruleSets = anchors.map((a) => new Set(a.rounding_rules_reproducing_stated))
  const shared = ROUNDING_RULES.filter((rule) => ruleSets.every((set) => set.has(rule)))
  const preferred = anchors.find((a) => a.preferred_by_expert)

  const quoteAmount = fixture.observed_quote.amount_usd
  const quoteRatio = quoteAmount / unitPrice
  const matchesAnyFactor = fixture.inflation_anchors.some((a) => a.factor === quoteRatio)

  const acquisition = fixture.supplier_purchase_order.unit_price_usd
  const statedShare = fixture.surplus_clearing.share_of_inflation_adjusted_oem_value
  const acquisitionVsAnchor = fixture.inflation_anchors.map((a) => {
    const share = acquisition / a.product_exact_usd
    return {
      anchor_id: a.anchor_id,
      acquisition_unit_price_usd: acquisition,
      share_of_anchor: share,
      expert_stated_share: statedShare,
      within_stated_tolerance: Math.abs(share - statedShare) <= SURPLUS_CLEARING_TOLERANCE,
    }
  })

  const findings: string[] = []
  for (const a of anchors) {
    findings.push(
      a.exact_match
        ? `${a.anchor_id}: anchor reproduces the exact product ${a.expected_exact_usd} to the cent`
        : `${a.anchor_id}: anchor returned ${a.computed_usd}, expected the exact product ${a.expected_exact_usd}`,
    )
    findings.push(
      `${a.anchor_id}: the expert printed about ${a.expert_stated_approximation_usd}, which is reproduced from the exact product by [${a.rounding_rules_reproducing_stated.join(', ')}] and by no other named rule`,
    )
  }
  findings.push(
    shared.length === 0
      ? 'no single named rounding rule reproduces both of the expert printed approximations, so neither figure may be described as the rounded output of one convention'
      : `both printed approximations are reproduced by [${shared.join(', ')}]`,
  )
  findings.push(
    `the observed quote of ${quoteAmount} is ${quoteRatio} times the OEM unit price, which is not any anchor factor. It is a recorded observation of what he quoted, never an engine output.`,
  )

  return {
    fixture_id: fixture.fixture_id,
    nsn: fixture.nsn,
    anchors,
    preferred_anchor_id: preferred ? preferred.anchor_id : null,
    observed_quote: {
      amount_usd: quoteAmount,
      is_engine_output: false,
      ratio_to_oem_unit_price: quoteRatio,
      matches_any_anchor_factor: matchesAnyFactor,
      note: fixture.observed_quote.honesty_note,
    },
    acquisition_vs_anchor: acquisitionVsAnchor,
    single_rounding_rule_reproduces_both: shared.length > 0,
    arithmetic_ok: anchors.every((a) => a.exact_match),
    findings,
  }
}

// =====================================================================================================
// FIXTURE 2: THE DECISION FIXTURE (NSN 4730-00-536-2210)
// =====================================================================================================

const decisionCueSchema = z.strictObject({
  cue_id: z.string(),
  feature_id: z.string(),
  feature_id_source: z.enum(['named_in_handoff_4_4a', 'assigned_by_this_fixture']),
  expert_read: z.enum(['buy_signal', 'buy_signal_with_recorded_tension', 'context']),
  read_basis: z.enum(['stated_principle', 'listed_as_indicator']),
  principle: z.string().nullable(),
  finding: z.string(),
  source_span: z.enum(['considerations', 'bottom_line']),
  verbatim_line: z.string(),
  tension_note: z.string().optional(),
  proxy_note: z.string().optional(),
  caution_note: z.string().optional(),
  provenance_constraint: z.string().optional(),
  no_arithmetic_attached: z.boolean().optional(),
  no_arithmetic_note: z.string().optional(),
})

export const decisionFixtureSchema = z.strictObject({
  fixture_id: z.literal('nsn-4730-00-536-2210'),
  fixture_kind: z.literal('decision'),
  nsn: z.string(),
  provenance: z.strictObject({
    source_path: z.string(),
    source_kind: z.enum(['docx_primary', 'handoff_quotation_of_docx']),
    read_directly: z.boolean(),
    extraction_method: z.string(),
    cross_check_path: z.string(),
    cross_check_section: z.string(),
    cross_check_agrees: z.boolean(),
    cross_check_note: z.string(),
    carries_no_arithmetic: z.literal(true),
    carries_no_arithmetic_note: z.string(),
    encoded_on: z.string(),
  }),
  expert_framing_quote: z.string(),
  expert_disposition: z.string(),
  disposition_is_conditional: z.boolean(),
  disposition_condition_quote: z.string(),
  expert_bottom_line_quote: z.string(),
  expert_elevated_feature_ids: z.array(z.string()),
  elevation_basis: z.string(),
  ordering_is_not_a_ranking: z.literal(true),
  ordering_note: z.string(),
  cues: z.array(decisionCueSchema),
})

export type DecisionFixture = z.infer<typeof decisionFixtureSchema>
export type DecisionCue = z.infer<typeof decisionCueSchema>

export type PrincipalReason = {
  readonly feature_id: string
  readonly points: number
  readonly sentence: string
}

/**
 * The scorecard under test, injected. `represented_feature_ids` is what makes the gap list
 * computable: a card that cannot yet represent a cue must say so rather than the harness
 * guessing.
 */
export type DecisionScorer = {
  readonly scorecard_version: string
  readonly represented_feature_ids: readonly string[]
  decide(cues: readonly DecisionCue[]): {
    readonly disposition: string
    readonly principal_reasons: readonly PrincipalReason[]
  }
}

/**
 * A signal the expert acted on that the current card cannot represent.
 *
 * This is a FIRST-CLASS OUTPUT, not a warning, because the list of things a working expert
 * uses and the model cannot see is the research programme of the product. Every field on it is
 * his own words, so the item can be worked without going back to the source.
 */
export type GapToClose = {
  readonly cue_id: string
  readonly feature_id: string
  readonly expert_read: DecisionCue['expert_read']
  readonly expert_finding: string
  readonly expert_principle: string | null
  readonly source_span: DecisionCue['source_span']
  readonly status: 'cues_present_not_cited'
}

export type DecisionFixtureResult = {
  readonly fixture_id: string
  readonly nsn: string
  readonly expert_disposition: string
  readonly engine_disposition: string
  readonly disposition_matches: boolean
  readonly expert_elevated_feature_ids: readonly string[]
  readonly elevated_reasons_surfaced: readonly string[]
  readonly elevated_reasons_missing: readonly string[]
  readonly top_reasons_surfaced: boolean
  readonly principal_reasons: readonly PrincipalReason[]
  readonly principal_reasons_ordered_by_points: boolean
  readonly cues_present_not_cited: readonly GapToClose[]
  readonly cues_represented: readonly string[]
  readonly coverage: {
    readonly cues_total: number
    readonly cues_represented: number
    readonly cues_not_cited: number
  }
  readonly accepted: boolean
  readonly notes: readonly string[]
}

/**
 * Gate a scorecard's SIGNAL CHOICE against the expert's own recorded walkthrough.
 *
 * Acceptance is exactly two things: it disposes the item the way he did, and every reason he
 * himself elevated appears in the principal reasons. Coverage of the remaining cues is
 * deliberately NOT part of acceptance, because gating on it would push a card to grow a
 * feature for every cue before any of them is understood. Those cues become the gap list
 * instead, which is a plan rather than a failure.
 */
export function runDecisionFixture(
  fixture: DecisionFixture,
  scorer: DecisionScorer,
): DecisionFixtureResult {
  const represented = new Set(scorer.represented_feature_ids)
  const outcome = scorer.decide(fixture.cues)

  const citedFeatures = new Set(outcome.principal_reasons.map((r) => r.feature_id))
  const surfaced = fixture.expert_elevated_feature_ids.filter((id) => citedFeatures.has(id))
  const missing = fixture.expert_elevated_feature_ids.filter((id) => !citedFeatures.has(id))

  const gaps: GapToClose[] = []
  const covered: string[] = []
  for (const cue of fixture.cues) {
    if (represented.has(cue.feature_id)) {
      covered.push(cue.cue_id)
      continue
    }
    gaps.push({
      cue_id: cue.cue_id,
      feature_id: cue.feature_id,
      expert_read: cue.expert_read,
      expert_finding: cue.finding,
      expert_principle: cue.principle,
      source_span: cue.source_span,
      status: 'cues_present_not_cited',
    })
  }

  let ordered = true
  for (let i = 1; i < outcome.principal_reasons.length; i += 1) {
    if (outcome.principal_reasons[i]!.points > outcome.principal_reasons[i - 1]!.points) {
      ordered = false
      break
    }
  }

  const dispositionMatches = outcome.disposition === fixture.expert_disposition
  const topReasonsSurfaced = missing.length === 0

  const notes: string[] = [
    `disposition compared against the expert's own recorded decision "${fixture.expert_disposition}", which he stated conditionally: ${fixture.disposition_condition_quote}`,
    fixture.ordering_note,
    `${gaps.length} of ${fixture.cues.length} cues are present in his walkthrough and not representable by scorecard ${scorer.scorecard_version}. They are logged as gaps to close, never dropped.`,
  ]

  return {
    fixture_id: fixture.fixture_id,
    nsn: fixture.nsn,
    expert_disposition: fixture.expert_disposition,
    engine_disposition: outcome.disposition,
    disposition_matches: dispositionMatches,
    expert_elevated_feature_ids: fixture.expert_elevated_feature_ids,
    elevated_reasons_surfaced: surfaced,
    elevated_reasons_missing: missing,
    top_reasons_surfaced: topReasonsSurfaced,
    principal_reasons: outcome.principal_reasons,
    principal_reasons_ordered_by_points: ordered,
    cues_present_not_cited: gaps,
    cues_represented: covered,
    coverage: {
      cues_total: fixture.cues.length,
      cues_represented: covered.length,
      cues_not_cited: gaps.length,
    },
    accepted: dispositionMatches && topReasonsSurfaced,
    notes,
  }
}
