/**
 * GATE T3.4.10. The backtest harness, its split, its metrics, and the two pinned fixtures.
 *
 * THE INSTRUMENT IS BUILT TO BE ABLE TO FAIL. Every expectation below is a literal computed by
 * hand and written out, never a value re-derived by calling the code under test. Where a check
 * could plausibly pass against a broken implementation, a NEGATIVE CONTROL sits beside it and
 * proves the check fires:
 *
 *   - the item-grouped split is checked against a deliberately naive time-only splitter written
 *     in this file, which MUST leak, or `itemLeaks` is not measuring anything
 *   - the embargo is checked at embargo_ms=60 and again at embargo_ms=0, so a no-op embargo
 *     cannot pass
 *   - the anchor gate is pointed at two deliberately broken anchors, one that rounds to cents
 *     and one that collapses the two inflation indices into one, and both must fail
 *   - the decision gate is pointed at a scorer that disposes the wrong way and at one that
 *     disposes correctly while dropping a reason the expert himself elevated, and both must be
 *     rejected
 *
 * THE ARITHMETIC WORTH READING TWICE. The expert's printed approximations are NOT reproduced by
 * a single rounding convention:
 *
 *   1537.85 * 1.3223 = 2033.499055 exactly. He printed about 2034. Nearest-dollar gives 2033.
 *   1537.85 * 1.40   = 2152.99     exactly. He printed about 2150. Nearest-dollar gives 2153.
 *
 * Only rounding UP reproduces the first and only rounding to the nearest ten reproduces the
 * second. This file asserts the true products to the cent, asserts which named rule reproduces
 * each printed figure, and asserts that NO rule reproduces both. Describing either figure as
 * "rounds to" would be asserting an arithmetic relationship that does not hold.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DECISION_FIXTURE,
  MIN_RESOLVED_FOR_CALIBRATION,
  PRICING_FIXTURE,
  applyRoundingRule,
  brierScore,
  calibrationGate,
  decisionFixtureSchema,
  equalWidthBoundaries,
  evaluatePricingFixture,
  expectedValueAtK,
  itemLeaks,
  precisionAtK,
  pricingFixtureSchema,
  rankByScore,
  recallOfTopMarginDecile,
  rocAuc,
  roundingRulesReproducing,
  runBacktest,
  runDecisionFixture,
  splitWalkForward,
} from '@/lib/engine/backtest'
import type {
  BacktestRow,
  DecisionCue,
  DecisionScorer,
  DualInflationAnchor,
  RowScorer,
  ScoredRow,
  WalkForwardSplit,
} from '@/lib/engine/backtest'
import { fixedClock } from '@/lib/time/clock'

// =====================================================================================================
// SHARED HAND-BUILT ROWS
//
// Event times are small round integers on purpose, so every window boundary, every purge and
// every embargo band below can be checked on paper without a calculator.
//
//   id  item  event  resolved  label  value
//   r1  A       0       50       1     1000
//   r2  B     100      150       0        0
//   r3  C     200      999       1     5000   <- label resolves late, so it purges into later folds
//   r4  D     250      260       0      100   <- sits in the embargo band before boundary 300
//   r5  A     350      360       1     2000   <- same item as r1, which is the leak this module exists to stop
//   r6  E     400      410       0       50
//   r7  B     650      660       1     3000   <- same item as r2
//   r8  F     700      710       0       10
// =====================================================================================================

const ROWS: readonly BacktestRow[] = [
  { row_id: 'r1', item_key: 'A', event_at_ms: 0, label_resolved_at_ms: 50, label: 1, realised_value_usd: 1000 },
  { row_id: 'r2', item_key: 'B', event_at_ms: 100, label_resolved_at_ms: 150, label: 0, realised_value_usd: 0 },
  { row_id: 'r3', item_key: 'C', event_at_ms: 200, label_resolved_at_ms: 999, label: 1, realised_value_usd: 5000 },
  { row_id: 'r4', item_key: 'D', event_at_ms: 250, label_resolved_at_ms: 260, label: 0, realised_value_usd: 100 },
  { row_id: 'r5', item_key: 'A', event_at_ms: 350, label_resolved_at_ms: 360, label: 1, realised_value_usd: 2000 },
  { row_id: 'r6', item_key: 'E', event_at_ms: 400, label_resolved_at_ms: 410, label: 0, realised_value_usd: 50 },
  { row_id: 'r7', item_key: 'B', event_at_ms: 650, label_resolved_at_ms: 660, label: 1, realised_value_usd: 3000 },
  { row_id: 'r8', item_key: 'F', event_at_ms: 700, label_resolved_at_ms: 710, label: 0, realised_value_usd: 10 },
]

const BOUNDARIES = [0, 300, 600] as const

// =====================================================================================================
describe('T3.4.10a the split is grouped by ITEM as well as by time', () => {
  const split = splitWalkForward(ROWS, {
    folds: 3,
    embargo_ms: 60,
    train_mode: 'expanding',
    boundaries_ms: BOUNDARIES,
  })

  it('cuts three folds at the boundaries it was given', () => {
    expect(split.folds.map((f) => [f.test_start_ms, f.test_end_ms])).toEqual([
      [0, 300],
      [300, 600],
      [600, 701],
    ])
  })

  it('tests every row exactly once across the walk, so no row is quietly skipped', () => {
    const tested = split.folds.flatMap((f) => [...f.test_row_ids])
    expect(tested.slice().sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'])
    expect(new Set(tested).size).toBe(8)
  })

  it('fold 0 has an empty training set, which is the honest state of an expanding walk', () => {
    const f0 = split.folds[0]!
    expect(f0.test_row_ids).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(f0.train_row_ids).toEqual([])
    expect(f0.counts.not_yet_available).toBe(4)
  })

  it('fold 1 drops r1 for SAME ITEM, r3 for label overlap and r4 for embargo, leaving only r2', () => {
    const f1 = split.folds[1]!
    expect(f1.test_row_ids).toEqual(['r5', 'r6'])
    // r1 is item A and r5 is item A. A time-only split would hand r1 to training. This one does not.
    expect(f1.train_row_ids).toEqual(['r2'])
    expect(f1.counts).toEqual({
      test: 2,
      train: 1,
      purged_same_item: 1,
      purged_label_overlap: 1,
      embargoed_before: 1,
      embargoed_after: 0,
      not_yet_available: 2,
    })
    const reasonById = new Map(f1.excluded.map((e) => [e.row_id, e.primary_reason]))
    expect(reasonById.get('r1')).toBe('purged_same_item')
    expect(reasonById.get('r3')).toBe('purged_label_overlap')
    expect(reasonById.get('r4')).toBe('embargoed_before')
  })

  it('fold 2 drops r2 for SAME ITEM and r3 for label overlap, training on the other four', () => {
    const f2 = split.folds[2]!
    expect(f2.test_row_ids).toEqual(['r7', 'r8'])
    expect(f2.train_row_ids).toEqual(['r1', 'r4', 'r5', 'r6'])
    expect(f2.counts.purged_same_item).toBe(1)
    expect(f2.counts.purged_label_overlap).toBe(1)
  })

  it('records EVERY reason a row was dropped, not only the headline one', () => {
    const f0 = split.folds[0]!
    const r5 = f0.excluded.find((e) => e.row_id === 'r5')!
    // r5 is in the future, is the same item as a test row, and sits in the trailing embargo band.
    expect(r5.reasons).toEqual(['not_yet_available', 'purged_same_item', 'embargoed_after'])
    expect(r5.primary_reason).toBe('not_yet_available')
  })

  it('leaks nothing: no item appears on both sides of any fold', () => {
    expect(itemLeaks(split, ROWS)).toEqual([])
  })

  // ---------------------------------------------------------------------------------------------
  // NEGATIVE CONTROL. This is the point of the module. A splitter that respects time and ignores
  // item identity looks correct and leaks, and `itemLeaks` has to say so or it measures nothing.
  // ---------------------------------------------------------------------------------------------
  it('PROVES IT CAN FAIL: a naive time-only splitter leaks item A into fold 1 and item B into fold 2', () => {
    const naive: WalkForwardSplit = {
      train_mode: 'expanding',
      embargo_ms: 0,
      folds: BOUNDARIES.map((start, i) => {
        const end = i + 1 < BOUNDARIES.length ? BOUNDARIES[i + 1]! : 701
        const test = ROWS.filter((r) => r.event_at_ms >= start && r.event_at_ms < end)
        const train = ROWS.filter((r) => r.event_at_ms < start)
        return {
          fold_index: i,
          test_start_ms: start,
          test_end_ms: end,
          test_row_ids: test.map((r) => r.row_id),
          train_row_ids: train.map((r) => r.row_id),
          excluded: [],
          counts: {
            test: test.length,
            train: train.length,
            purged_same_item: 0,
            purged_label_overlap: 0,
            embargoed_before: 0,
            embargoed_after: 0,
            not_yet_available: 0,
          },
        }
      }),
    }
    expect(itemLeaks(naive, ROWS)).toEqual([
      { fold_index: 1, item_key: 'A', train_row_ids: ['r1'], test_row_ids: ['r5'] },
      { fold_index: 2, item_key: 'B', train_row_ids: ['r2'], test_row_ids: ['r7'] },
    ])
  })
})

// =====================================================================================================
describe('T3.4.10b the embargo is a real band, not a field nobody reads', () => {
  const options = { folds: 3, boundaries_ms: BOUNDARIES, train_mode: 'all_outside_test' as const }

  it('fires all four exclusion reasons in one fold under purged K-fold at embargo 60', () => {
    const split = splitWalkForward(ROWS, { ...options, embargo_ms: 60 })
    const f1 = split.folds[1]!
    expect(f1.train_row_ids).toEqual(['r2', 'r8'])
    expect(f1.counts).toEqual({
      test: 2,
      train: 2,
      purged_same_item: 1,
      purged_label_overlap: 1,
      embargoed_before: 1,
      embargoed_after: 1,
      not_yet_available: 0,
    })
    const reasonById = new Map(f1.excluded.map((e) => [e.row_id, e.primary_reason]))
    // r4 at 250 sits inside [240, 300). r7 at 650 sits inside [600, 660).
    expect(reasonById.get('r4')).toBe('embargoed_before')
    expect(reasonById.get('r7')).toBe('embargoed_after')
  })

  // NEGATIVE CONTROL: turn the embargo off and the two banded rows must reappear in training.
  it('PROVES IT CAN FAIL: at embargo 0 the two banded rows return to the training set', () => {
    const split = splitWalkForward(ROWS, { ...options, embargo_ms: 0 })
    const f1 = split.folds[1]!
    expect(f1.train_row_ids).toEqual(['r2', 'r4', 'r7', 'r8'])
    expect(f1.counts.embargoed_before).toBe(0)
    expect(f1.counts.embargoed_after).toBe(0)
  })

  it('reads differently under the two train modes, so the mode is not decorative', () => {
    const kfold = splitWalkForward(ROWS, { ...options, embargo_ms: 60 })
    const expanding = splitWalkForward(ROWS, {
      folds: 3,
      boundaries_ms: BOUNDARIES,
      embargo_ms: 60,
      train_mode: 'expanding',
    })
    expect(kfold.folds[1]!.train_row_ids).toEqual(['r2', 'r8'])
    expect(expanding.folds[1]!.train_row_ids).toEqual(['r2'])
  })

  it('refuses a fold count below one and a negative embargo', () => {
    expect(() => splitWalkForward(ROWS, { folds: 0, embargo_ms: 0 })).toThrow(/folds/)
    expect(() => splitWalkForward(ROWS, { folds: 2, embargo_ms: -1 })).toThrow(/embargo_ms/)
  })
})

// =====================================================================================================
describe('T3.4.10c equal-width boundaries', () => {
  // Rows span 0 to 700, so the half-open span is 701.
  // 3 folds: 0, floor(701/3)=233, floor(1402/3)=467.
  it('computes three starts by hand', () => {
    expect(equalWidthBoundaries(ROWS, 3)).toEqual([0, 233, 467])
  })
  it('computes two starts by hand', () => {
    expect(equalWidthBoundaries(ROWS, 2)).toEqual([0, 350])
  })
  it('returns an honest empty list for no rows', () => {
    expect(equalWidthBoundaries([], 4)).toEqual([])
  })
})

// =====================================================================================================
// METRICS. A second hand-built set, chosen so that precision at k looks healthy while the single
// row carrying most of the realised margin sits outside the worked queue. That is the failure the
// business would actually feel, and the reason recall of the top margin decile is carried at all.
//
//   id  score  prob  label  value
//   m1     90  0.9      1    1000
//   m2     80  0.8      1     200
//   m3     70  0.7      0       0
//   m4     60  0.1      1    5000   <- the outlier, at rank 4
//   m5     50  0.4      0       0
//   m6     40  0.2      0       0
//   m7     30  0.1      1     100
//   m8     20  0.05     0       0
// =====================================================================================================

const M: readonly ScoredRow[] = [
  { row: { row_id: 'm1', item_key: 'i1', event_at_ms: 1, label_resolved_at_ms: 2, label: 1, realised_value_usd: 1000 }, score: 90, probability: 0.9 },
  { row: { row_id: 'm2', item_key: 'i2', event_at_ms: 1, label_resolved_at_ms: 2, label: 1, realised_value_usd: 200 }, score: 80, probability: 0.8 },
  { row: { row_id: 'm3', item_key: 'i3', event_at_ms: 1, label_resolved_at_ms: 2, label: 0, realised_value_usd: 0 }, score: 70, probability: 0.7 },
  { row: { row_id: 'm4', item_key: 'i4', event_at_ms: 1, label_resolved_at_ms: 2, label: 1, realised_value_usd: 5000 }, score: 60, probability: 0.1 },
  { row: { row_id: 'm5', item_key: 'i5', event_at_ms: 1, label_resolved_at_ms: 2, label: 0, realised_value_usd: 0 }, score: 50, probability: 0.4 },
  { row: { row_id: 'm6', item_key: 'i6', event_at_ms: 1, label_resolved_at_ms: 2, label: 0, realised_value_usd: 0 }, score: 40, probability: 0.2 },
  { row: { row_id: 'm7', item_key: 'i7', event_at_ms: 1, label_resolved_at_ms: 2, label: 1, realised_value_usd: 100 }, score: 30, probability: 0.1 },
  { row: { row_id: 'm8', item_key: 'i8', event_at_ms: 1, label_resolved_at_ms: 2, label: 0, realised_value_usd: 0 }, score: 20, probability: 0.05 },
]

describe('T3.4.10d expected value at k is the primary metric', () => {
  it('at k=3 sums 1000 + 200 + 0 and reports a mean of 400', () => {
    const ev = expectedValueAtK(M, 3)
    expect(ev.metric).toBe('expected_value_at_k')
    expect(ev.total_value_usd).toBe(1200)
    expect(ev.mean_value_per_row_usd).toBe(400)
    expect(ev.k_effective).toBe(3)
    expect(ev.n_ranked).toBe(8)
    expect(ev.n_unresolved_excluded).toBe(0)
    expect(ev.k_exceeded_available).toBe(false)
  })

  it('at k=4 the outlier enters and the total jumps to 6200 with a mean of 1550', () => {
    const ev = expectedValueAtK(M, 4)
    expect(ev.total_value_usd).toBe(6200)
    expect(ev.mean_value_per_row_usd).toBe(1550)
  })

  it('EXCLUDES an unresolved row and counts it, rather than scoring it as a zero-value row', () => {
    const withUnresolved: ScoredRow[] = [
      ...M,
      { row: { row_id: 'm9', item_key: 'i9', event_at_ms: 1, label_resolved_at_ms: 2, label: null, realised_value_usd: null }, score: 100, probability: null },
    ]
    const ev = expectedValueAtK(withUnresolved, 3)
    // m9 outranks everything on score. If it were treated as a zero it would drag the top three
    // down to 1000 + 200 + 0 across four rows. It is excluded instead, and said so.
    expect(ev.n_unresolved_excluded).toBe(1)
    expect(ev.total_value_usd).toBe(1200)
    expect(ev.n_ranked).toBe(8)
  })

  it('caps k at what exists and says it did', () => {
    const ev = expectedValueAtK(M.slice(0, 2), 5)
    expect(ev.k).toBe(5)
    expect(ev.k_effective).toBe(2)
    expect(ev.k_exceeded_available).toBe(true)
    expect(ev.total_value_usd).toBe(1200)
    expect(ev.mean_value_per_row_usd).toBe(600)
  })

  it('refuses a k below one', () => {
    expect(() => expectedValueAtK(M, 0)).toThrow(/k must be an integer/)
  })
})

describe('T3.4.10e precision at k and recall of the top margin decile disagree, which is the point', () => {
  it('precision at k=3 is 2 of 3 and looks healthy', () => {
    const p = precisionAtK(M, 3)
    expect(p.positives_in_top_k).toBe(2)
    expect(p.k_effective).toBe(3)
    expect(p.n_labeled).toBe(8)
    expect(p.precision).toBeCloseTo(0.6666666666666666, 12)
  })

  it('recall of the top margin decile at k=3 is ZERO, because the 5000 row is at rank 4', () => {
    const r = recallOfTopMarginDecile(M, 3)
    expect(r.n_resolved).toBe(8)
    // ceil(8 / 10) = 1
    expect(r.decile_size).toBe(1)
    expect(r.decile_row_ids).toEqual(['m4'])
    expect(r.captured).toBe(0)
    expect(r.recall).toBe(0)
  })

  it('at k=4 the outlier is surfaced and recall goes to 1', () => {
    const r = recallOfTopMarginDecile(M, 4)
    expect(r.captured).toBe(1)
    expect(r.recall).toBe(1)
  })

  it('breaks margin ties by row id, so the decile membership is reproducible', () => {
    // Twenty rows all at value 0 except two, so the decile is exactly two rows.
    const flat: ScoredRow[] = Array.from({ length: 20 }, (_, i) => ({
      row: {
        row_id: `f${String(i).padStart(2, '0')}`,
        item_key: `k${i}`,
        event_at_ms: 1,
        label_resolved_at_ms: 2,
        label: 0 as const,
        realised_value_usd: 0,
      },
      score: 1,
      probability: null,
    }))
    const r = recallOfTopMarginDecile(flat, 5)
    expect(r.decile_size).toBe(2)
    expect(r.decile_row_ids).toEqual(['f00', 'f01'])
  })
})

describe('T3.4.10f Brier and AUC', () => {
  it('Brier over the metric set is 2.3625 / 8', () => {
    const b = brierScore(M)
    expect(b.n).toBe(8)
    expect(b.brier).toBeCloseTo(0.2953125, 12)
  })

  it('returns an explicit null Brier with n=0 when no row carries a probability', () => {
    const noProb = M.map((s) => ({ ...s, probability: null }))
    const b = brierScore(noProb)
    expect(b.n).toBe(0)
    expect(b.brier).toBe(null)
  })

  it('AUC over the metric set is 0.75, and the class ratio rides in the same object', () => {
    // Ascending score: m8 m7 m6 m5 m4 m3 m2 m1, ranks 1..8.
    // Positive ranks: m7=2, m4=5, m2=7, m1=8, sum 22.
    // (22 - 4*5/2) / (4*4) = 12 / 16 = 0.75
    const a = rocAuc(M)
    expect(a.auc).toBe(0.75)
    expect(a.positives).toBe(4)
    expect(a.negatives).toBe(4)
    expect(a.n).toBe(8)
    expect(a.class_ratio).toBe(0.5)
    expect(a.baseline_note).toContain('prevalence')
  })

  it('averages ranks across a tie, so a tied pair scores exactly 0.5 and not 1 or 0', () => {
    const tied: ScoredRow[] = [
      { row: { row_id: 't1', item_key: 'x', event_at_ms: 1, label_resolved_at_ms: 2, label: 1, realised_value_usd: 0 }, score: 10, probability: null },
      { row: { row_id: 't2', item_key: 'y', event_at_ms: 1, label_resolved_at_ms: 2, label: 0, realised_value_usd: 0 }, score: 10, probability: null },
    ]
    // Tied block ranks average to 1.5. (1.5 - 1*2/2) / (1*1) = 0.5
    expect(rocAuc(tied).auc).toBe(0.5)
  })

  it('still carries the class ratio when the AUC itself is null', () => {
    const allPositive = M.filter((s) => s.row.label === 1)
    const a = rocAuc(allPositive)
    expect(a.auc).toBe(null)
    expect(a.positives).toBe(4)
    expect(a.negatives).toBe(0)
    expect(a.class_ratio).toBe(1)
  })
})

describe('T3.4.10g the small-n calibration gate returns a null, not a number', () => {
  it('holds the line at fifty resolved outcomes', () => {
    expect(MIN_RESOLVED_FOR_CALIBRATION).toBe(50)
  })
  it('refuses to publish below fifty and states n and the method on its face', () => {
    const g = calibrationGate(49)
    expect(g.available).toBe(false)
    expect(g.probability).toBe(null)
    expect(g.n_resolved).toBe(49)
    expect(g.minimum_required).toBe(50)
    expect(g.method).toBe('sigmoid_fit_on_held_out_temporal_slice')
    expect(g.reason).toContain('49')
    expect(g.reason).toContain('50')
  })
  it('opens at fifty and STILL returns null, because a gate is not a fitter', () => {
    const g = calibrationGate(50)
    expect(g.available).toBe(true)
    expect(g.probability).toBe(null)
  })
})

describe('T3.4.10h ranking is deterministic', () => {
  it('breaks a score tie by row id ascending, so replay is byte identical', () => {
    const tie: ScoredRow[] = [
      { row: { row_id: 'zz', item_key: 'x', event_at_ms: 1, label_resolved_at_ms: 2, label: 1, realised_value_usd: 1 }, score: 5, probability: null },
      { row: { row_id: 'aa', item_key: 'y', event_at_ms: 1, label_resolved_at_ms: 2, label: 1, realised_value_usd: 1 }, score: 5, probability: null },
      { row: { row_id: 'mm', item_key: 'z', event_at_ms: 1, label_resolved_at_ms: 2, label: 1, realised_value_usd: 1 }, score: 9, probability: null },
    ]
    expect(rankByScore(tie).map((s) => s.row.row_id)).toEqual(['mm', 'aa', 'zz'])
    // Reversing the input must not change the output. Without a stated tie-break it would.
    expect(rankByScore([...tie].reverse()).map((s) => s.row.row_id)).toEqual(['mm', 'aa', 'zz'])
  })
})

// =====================================================================================================
describe('T3.4.10i the full run', () => {
  const SCORES: Record<string, number> = { r1: 90, r2: 80, r3: 70, r4: 60, r5: 50, r6: 40, r7: 30, r8: 20 }
  const PROBS: Record<string, number> = { r1: 0.9, r2: 0.8, r3: 0.7, r4: 0.1, r5: 0.4, r6: 0.2, r7: 0.1, r8: 0.05 }

  const scorer: RowScorer = {
    scorecard_version: 'v0-test-reference',
    score: (row) => ({ score: SCORES[row.row_id] ?? 0, probability: PROBS[row.row_id] ?? null }),
  }

  const report = runBacktest(ROWS, scorer, {
    k: 3,
    split: { folds: 3, embargo_ms: 60, train_mode: 'expanding', boundaries_ms: [...BOUNDARIES] },
    configurations_tried: 7,
    clock: fixedClock(1_700_000_000_000),
  })

  it('stamps the injected clock and never reads wall time', () => {
    expect(report.run_at_ms).toBe(1_700_000_000_000)
    expect(report.scorecard_version).toBe('v0-test-reference')
  })

  it('pre-registers expected value at k as the primary metric', () => {
    expect(report.pre_registered_primary_metric).toBe('expected_value_at_k')
    expect(report.k).toBe(3)
  })

  it('REPORTS THE CONFIGURATION COUNT so the result can be discounted for selection', () => {
    expect(report.configuration_count).toBe(7)
    expect(report.best_of_many).toBe(true)
    expect(report.selection_note).toContain('discount')
    expect(report.honesty_notes.some((n) => n.includes('7 scorecard configuration'))).toBe(true)
  })

  it('per fold: 4 tested on nothing, 2 tested on 1 trained row, 2 tested on 4', () => {
    expect(report.per_fold.map((f) => [f.n_test, f.n_train])).toEqual([
      [4, 0],
      [2, 1],
      [2, 4],
    ])
  })

  it('per fold expected value at k, computed by hand', () => {
    // fold 0 top three by score: r1 1000, r2 0, r3 5000. Total 6000, mean 2000.
    expect(report.per_fold[0]!.expected_value_at_k.total_value_usd).toBe(6000)
    expect(report.per_fold[0]!.expected_value_at_k.mean_value_per_row_usd).toBe(2000)
    // fold 1 has only two rows: r5 2000 and r6 50. Total 2050, mean 1025, k exceeded.
    expect(report.per_fold[1]!.expected_value_at_k.total_value_usd).toBe(2050)
    expect(report.per_fold[1]!.expected_value_at_k.mean_value_per_row_usd).toBe(1025)
    expect(report.per_fold[1]!.expected_value_at_k.k_exceeded_available).toBe(true)
    // fold 2: r7 3000 and r8 10. Total 3010, mean 1505.
    expect(report.per_fold[2]!.expected_value_at_k.total_value_usd).toBe(3010)
    expect(report.per_fold[2]!.expected_value_at_k.mean_value_per_row_usd).toBe(1505)
  })

  it('pooled metrics, every figure computed by hand', () => {
    const p = report.pooled
    expect(p.n_scored).toBe(8)
    expect(p.n_resolved).toBe(8)
    // Top three pooled by score: r1 1000, r2 0, r3 5000.
    expect(p.expected_value_at_k.total_value_usd).toBe(6000)
    expect(p.expected_value_at_k.mean_value_per_row_usd).toBe(2000)
    // r1 and r3 are wins, r2 is not.
    expect(p.precision_at_k.positives_in_top_k).toBe(2)
    expect(p.precision_at_k.precision).toBeCloseTo(0.6666666666666666, 12)
    // Margins descending: r3 5000, r7 3000, r5 2000, r1 1000, r4 100, r6 50, r8 10, r2 0.
    expect(p.recall_of_top_margin_decile.decile_size).toBe(1)
    expect(p.recall_of_top_margin_decile.decile_row_ids).toEqual(['r3'])
    expect(p.recall_of_top_margin_decile.recall).toBe(1)
    // Brier: 0.01 + 0.64 + 0.09 + 0.01 + 0.36 + 0.04 + 0.81 + 0.0025 = 1.9625, over 8.
    expect(p.brier.n).toBe(8)
    expect(p.brier.brier).toBeCloseTo(0.2453125, 12)
    // Ascending score r8..r1, ranks 1..8. Positive ranks r7=2, r5=4, r3=6, r1=8, sum 20.
    // (20 - 10) / 16 = 0.625
    expect(p.auc.auc).toBe(0.625)
    expect(p.auc.class_ratio).toBe(0.5)
  })

  it('publishes NO calibrated probability at n=8 and says why', () => {
    expect(report.pooled.calibration.available).toBe(false)
    expect(report.pooled.calibration.probability).toBe(null)
    expect(report.pooled.calibration.n_resolved).toBe(8)
    expect(report.honesty_notes.some((n) => n.includes('below the minimum of 50'))).toBe(true)
    expect(report.honesty_notes.some((n) => n.includes('short evaluation history'))).toBe(true)
  })

  it('states the class ratio in the same sentence as the AUC, every time', () => {
    const aucNote = report.honesty_notes.find((n) => n.startsWith('AUC'))
    expect(aucNote).toBeDefined()
    expect(aucNote).toContain('0.625')
    expect(aucNote).toContain('class ratio of 0.5')
  })

  it('is valid because the split did not leak', () => {
    expect(report.split.item_leaks).toEqual([])
    expect(report.valid).toBe(true)
    expect(report.invalid_reasons).toEqual([])
  })

  // NEGATIVE CONTROLS on the run's own guards.
  it('PROVES IT CAN FAIL: a run claiming zero configurations tried is refused', () => {
    expect(() =>
      runBacktest(ROWS, scorer, {
        k: 3,
        split: { folds: 3, embargo_ms: 60 },
        configurations_tried: 0,
        clock: fixedClock(1),
      }),
    ).toThrow(/configurations_tried/)
  })

  it('PROVES IT CAN FAIL: a run with a k below one is refused', () => {
    expect(() =>
      runBacktest(ROWS, scorer, {
        k: 0,
        split: { folds: 3, embargo_ms: 60 },
        configurations_tried: 1,
        clock: fixedClock(1),
      }),
    ).toThrow(/k must be an integer/)
  })

  it('reports no selection to discount when exactly one configuration was tried', () => {
    const single = runBacktest(ROWS, scorer, {
      k: 3,
      split: { folds: 3, embargo_ms: 60, boundaries_ms: [...BOUNDARIES] },
      configurations_tried: 1,
      clock: fixedClock(1),
    })
    expect(single.best_of_many).toBe(false)
    expect(single.selection_note).toContain('no selection to discount')
  })
})

// =====================================================================================================
// FIXTURE 1: THE PRICING-ARITHMETIC FIXTURE. NSN 1650-01-059-8221.
// =====================================================================================================

describe('T3.4.10j fixture 1 encodes only what the source states', () => {
  it('carries the 2017 OEM award exactly as printed', () => {
    expect(PRICING_FIXTURE.nsn).toBe('1650-01-059-8221')
    expect(PRICING_FIXTURE.fixture_kind).toBe('pricing_arithmetic')
    expect(PRICING_FIXTURE.oem_award.year).toBe(2017)
    expect(PRICING_FIXTURE.oem_award.quantity_units).toBe(17)
    expect(PRICING_FIXTURE.oem_award.unit_price_usd).toBe(1537.85)
    expect(PRICING_FIXTURE.oem_award.quote).toBe(
      'The most recent OEM procurement was in 2017 for 17 units at $1,537.85 each.',
    )
  })

  it('carries the thirteen prior surplus awards and the demand read with no forecast', () => {
    expect(PRICING_FIXTURE.prior_awards.count).toBe(13)
    expect(PRICING_FIXTURE.prior_awards.all_surplus).toBe(true)
    expect(PRICING_FIXTURE.demand_without_forecast.forecast_exists).toBe(false)
    expect(PRICING_FIXTURE.demand_without_forecast.awards).toBe(13)
    expect(PRICING_FIXTURE.demand_without_forecast.units).toBe(80)
  })

  it('carries ILS as two named holders of 2 and 8, and stores no derived total', () => {
    const holders = PRICING_FIXTURE.ils_availability.holders
    expect(holders.map((h) => [h.name, h.units])).toEqual([
      ['Quality Aviation', 2],
      ['OLY Aero', 8],
    ])
    expect(holders[0]!.units + holders[1]!.units).toBe(10)
  })

  it('carries the purchase order at 8 units and $1,021.50', () => {
    expect(PRICING_FIXTURE.supplier_purchase_order.supplier).toBe('OLY')
    expect(PRICING_FIXTURE.supplier_purchase_order.quantity_units).toBe(8)
    expect(PRICING_FIXTURE.supplier_purchase_order.unit_price_usd).toBe(1021.5)
    expect(8 * 1021.5).toBe(8172)
  })

  it('records the missing public list price as an honest empty state, not a substitute', () => {
    expect(PRICING_FIXTURE.public_list_price.exists).toBe(false)
    expect(PRICING_FIXTURE.public_list_price.quote).toBe('no public list price exists')
  })

  it('PROVES THE SCHEMA BINDS: an unknown key is rejected, so the fixture cannot drift silently', () => {
    expect(() => pricingFixtureSchema.parse({ ...PRICING_FIXTURE, surprise_field: 1 })).toThrow()
  })
})

describe('T3.4.10k the dual inflation anchor, to the cent', () => {
  // The anchor implementation is INJECTED. This harness carries no second copy of it.
  const referenceAnchor: DualInflationAnchor = (i) => i.unit_price_usd * i.factor
  const result = evaluatePricingFixture(PRICING_FIXTURE, referenceAnchor)
  const cpi = result.anchors.find((a) => a.anchor_id === 'cpi')!
  const dod = result.anchors.find((a) => a.anchor_id === 'dod_procurement')!

  it('stores both factors, labelled, never blended', () => {
    expect(result.anchors.map((a) => a.anchor_id)).toEqual(['cpi', 'dod_procurement'])
    expect(cpi.factor).toBe(1.3223)
    expect(dod.factor).toBe(1.4)
    expect(result.preferred_anchor_id).toBe('dod_procurement')
  })

  it('1537.85 * 1.3223 is 2033.499055 exactly', () => {
    expect(cpi.expected_exact_usd).toBe(2033.499055)
    expect(cpi.computed_usd).toBe(2033.499055)
    expect(cpi.exact_match).toBe(true)
  })

  it('1537.85 * 1.40 is 2152.99 exactly', () => {
    expect(dod.expected_exact_usd).toBe(2152.99)
    expect(dod.computed_usd).toBe(2152.99)
    expect(dod.exact_match).toBe(true)
  })

  it('reproduces his printed 2034 only by rounding UP, never by nearest dollar', () => {
    expect(cpi.expert_stated_approximation_usd).toBe(2034)
    expect(applyRoundingRule(2033.499055, 'nearest_dollar')).toBe(2033)
    expect(applyRoundingRule(2033.499055, 'ceil_dollar')).toBe(2034)
    expect(roundingRulesReproducing(2033.499055, 2034)).toEqual(['ceil_dollar'])
    expect(cpi.absolute_difference_from_stated_usd).toBeCloseTo(0.500945, 9)
    expect(cpi.stated_within_tolerance).toBe(true)
  })

  it('reproduces his printed 2150 only by rounding to the nearest ten, never by nearest dollar', () => {
    expect(dod.expert_stated_approximation_usd).toBe(2150)
    expect(applyRoundingRule(2152.99, 'nearest_dollar')).toBe(2153)
    expect(applyRoundingRule(2152.99, 'nearest_ten')).toBe(2150)
    expect(roundingRulesReproducing(2152.99, 2150)).toEqual(['nearest_ten'])
    expect(dod.absolute_difference_from_stated_usd).toBeCloseTo(2.99, 9)
    expect(dod.stated_within_tolerance).toBe(true)
  })

  it('NO single named rounding rule reproduces both printed figures, and the report says so', () => {
    expect(result.single_rounding_rule_reproduces_both).toBe(false)
    expect(result.findings.some((f) => f.includes('no single named rounding rule'))).toBe(true)
  })

  it('reports the arithmetic as reproduced', () => {
    expect(result.arithmetic_ok).toBe(true)
  })

  // ---------------------------------------------------------------------------------------------
  // NEGATIVE CONTROLS. Two ways an anchor gets built wrong, both of which must fail this gate.
  // ---------------------------------------------------------------------------------------------
  it('PROVES IT CAN FAIL: an anchor that rounds to cents loses the CPI product', () => {
    const roundsToCents: DualInflationAnchor = (i) =>
      Math.round(i.unit_price_usd * i.factor * 100) / 100
    const broken = evaluatePricingFixture(PRICING_FIXTURE, roundsToCents)
    const brokenCpi = broken.anchors.find((a) => a.anchor_id === 'cpi')!
    expect(brokenCpi.computed_usd).toBe(2033.5)
    expect(brokenCpi.exact_match).toBe(false)
    expect(broken.arithmetic_ok).toBe(false)
  })

  it('PROVES IT CAN FAIL: an anchor that collapses the two indices into one loses the DoD product', () => {
    // The exact defect the dual-index rule exists to prevent: one factor applied to everything.
    const singleIndex: DualInflationAnchor = (i) => i.unit_price_usd * 1.3223
    const broken = evaluatePricingFixture(PRICING_FIXTURE, singleIndex)
    const brokenDod = broken.anchors.find((a) => a.anchor_id === 'dod_procurement')!
    expect(brokenDod.computed_usd).toBe(2033.499055)
    expect(brokenDod.exact_match).toBe(false)
    expect(broken.arithmetic_ok).toBe(false)
  })
})

describe('T3.4.10l the $3,565 quote is an OBSERVATION, never an engine output', () => {
  const result = evaluatePricingFixture(PRICING_FIXTURE, (i) => i.unit_price_usd * i.factor)

  it('is recorded with its own honesty note and flagged as not an engine output', () => {
    expect(PRICING_FIXTURE.observed_quote.amount_usd).toBe(3565)
    expect(PRICING_FIXTURE.observed_quote.is_engine_output).toBe(false)
    expect(result.observed_quote.is_engine_output).toBe(false)
    expect(result.observed_quote.note).toContain('RECORDED OBSERVATION')
  })

  it('is NOT any anchor output: neither 2033.499055 nor 2152.99 is anywhere near it', () => {
    expect(result.observed_quote.matches_any_anchor_factor).toBe(false)
    expect(result.observed_quote.ratio_to_oem_unit_price).toBeCloseTo(2.3181714731605814, 12)
    expect(result.observed_quote.ratio_to_oem_unit_price).not.toBe(1.3223)
    expect(result.observed_quote.ratio_to_oem_unit_price).not.toBe(1.4)
    for (const a of result.anchors) expect(a.expected_exact_usd).not.toBe(3565)
  })

  it('divides by his stated multiplier of three into a DIFFERENT input, the previous award price', () => {
    expect(PRICING_FIXTURE.observed_quote.multiplier_of_previous_award_unit_price).toBe(3)
    // 3565 / 3 = 1188.3333..., which is NOT the 2017 OEM unit price of 1537.85.
    expect(3565 / 3).toBeCloseTo(1188.3333333333333, 10)
    expect(3565 / 3).not.toBe(PRICING_FIXTURE.oem_award.unit_price_usd)
    expect(PRICING_FIXTURE.observed_quote.honesty_note).toContain(
      'NOT an output of the dual-inflation anchor',
    )
  })
})

describe('T3.4.10m surplus clears at about half the inflation adjusted value', () => {
  const result = evaluatePricingFixture(PRICING_FIXTURE, (i) => i.unit_price_usd * i.factor)

  it('states his approximate 50% as approximate', () => {
    expect(PRICING_FIXTURE.surplus_clearing.share_of_inflation_adjusted_oem_value).toBe(0.5)
    expect(PRICING_FIXTURE.surplus_clearing.is_approximate).toBe(true)
    expect(PRICING_FIXTURE.surplus_clearing.quote).toBe(
      'about 50% of Moog inflation adjusted value',
    )
  })

  it('the $1,021.50 acquisition is 0.5023 of the CPI anchor and 0.4745 of the DoD anchor', () => {
    const cpi = result.acquisition_vs_anchor.find((a) => a.anchor_id === 'cpi')!
    const dod = result.acquisition_vs_anchor.find((a) => a.anchor_id === 'dod_procurement')!
    expect(cpi.share_of_anchor).toBeCloseTo(0.5023361075523096, 12)
    expect(dod.share_of_anchor).toBeCloseTo(0.4744564535831565, 12)
    // Both sit inside his approximate characterisation. Which one he meant is NOT recorded, so
    // neither is asserted to be the one, and both are reported.
    expect(cpi.within_stated_tolerance).toBe(true)
    expect(dod.within_stated_tolerance).toBe(true)
  })
})

// =====================================================================================================
// FIXTURE 2: THE DECISION FIXTURE. NSN 4730-00-536-2210. No arithmetic to reproduce.
// =====================================================================================================

describe('T3.4.10n fixture 2 is transcribed from the docx itself', () => {
  it('names the docx as the source and the handoff only as a cross check', () => {
    const p = DECISION_FIXTURE.provenance
    expect(p.source_kind).toBe('docx_primary')
    expect(p.read_directly).toBe(true)
    expect(p.source_path).toBe('/Users/user/Downloads/Notes on 4730-00-536-2210 1-8-26.docx')
    expect(p.cross_check_section).toBe('4.4a')
    expect(p.cross_check_agrees).toBe(true)
    expect(p.cross_check_note).toContain('NOT used as a substitute source')
  })

  it('declares that it carries no arithmetic, so it can never stand in for the pricing fixture', () => {
    expect(DECISION_FIXTURE.fixture_kind).toBe('decision')
    expect(DECISION_FIXTURE.provenance.carries_no_arithmetic).toBe(true)
    expect(PRICING_FIXTURE.fixture_kind).toBe('pricing_arithmetic')
    expect(DECISION_FIXTURE.fixture_kind).not.toBe(PRICING_FIXTURE.fixture_kind)
  })

  it('carries sixteen cues: fourteen considerations and two from the bottom line', () => {
    expect(DECISION_FIXTURE.cues.length).toBe(16)
    const spans = DECISION_FIXTURE.cues.map((c) => c.source_span)
    expect(spans.filter((s) => s === 'considerations').length).toBe(14)
    expect(spans.filter((s) => s === 'bottom_line').length).toBe(2)
  })

  it('transcribes his findings verbatim', () => {
    const byId = new Map(DECISION_FIXTURE.cues.map((c) => [c.cue_id, c]))
    expect(byId.get('thin_competition')!.finding).toBe(
      'Only one other company bid on the last solicitation',
    )
    expect(byId.get('demand_gap_maintenance_ahead')!.finding).toBe(
      'The last order was in 2017 and before that it was 2004',
    )
    expect(byId.get('zero_depot_stock')!.finding).toBe('0 stock since 2009')
    expect(byId.get('non_stocked_distributor_dependent')!.finding).toBe('Listed as non stocked')
    expect(byId.get('platform_longevity')!.finding).toBe('They go on good planes F16 and F14')
    expect(byId.get('affiliate_holding')!.finding).toBe('Western air has five pieces')
    expect(byId.get('scarcity_gradient_corner')!.finding).toBe(
      'Very few available on NSN now, lots on EFF',
    )
    expect(byId.get('recorded_value_point')!.finding).toBe('4730-00-536-2210 is $169')
  })

  it('transcribes his bottom line verbatim, including the conditional', () => {
    expect(DECISION_FIXTURE.expert_bottom_line_quote).toBe(
      'Bottom line if you can buy The parts from adept fasteners at a great price you can sell them to DLA added substantial margin because of the past purchase price.',
    )
    expect(DECISION_FIXTURE.expert_disposition).toBe('quote')
    expect(DECISION_FIXTURE.disposition_is_conditional).toBe(true)
    expect(DECISION_FIXTURE.disposition_condition_quote).toBe(
      'if you can buy The parts from adept fasteners at a great price',
    )
  })

  it('elevates ONLY the two features his own bottom-line sentence names', () => {
    expect(DECISION_FIXTURE.expert_elevated_feature_ids).toEqual([
      'supplier_acquisition_price',
      'past_purchase_price_anchor',
    ])
    expect(DECISION_FIXTURE.ordering_is_not_a_ranking).toBe(true)
    expect(DECISION_FIXTURE.ordering_note).toContain('no importance from position')
  })

  it('records a principle exactly where he wrote one and null everywhere he did not', () => {
    for (const cue of DECISION_FIXTURE.cues) {
      expect(cue.principle === null).toBe(cue.read_basis === 'listed_as_indicator')
    }
    const reads = DECISION_FIXTURE.cues.map((c) => c.expert_read)
    expect(reads.filter((r) => r === 'buy_signal').length).toBe(12)
    expect(reads.filter((r) => r === 'buy_signal_with_recorded_tension').length).toBe(1)
    expect(reads.filter((r) => r === 'context').length).toBe(3)
    const bases = DECISION_FIXTURE.cues.map((c) => c.read_basis)
    expect(bases.filter((b) => b === 'listed_as_indicator').length).toBe(4)
    expect(bases.filter((b) => b === 'stated_principle').length).toBe(12)
  })

  it('keeps management price pinned to its aggregator provenance', () => {
    const mp = DECISION_FIXTURE.cues.find((c) => c.cue_id === 'management_price')!
    expect(mp.expert_read).toBe('context')
    expect(mp.provenance_constraint).toContain('NEVER relabelled')
    expect(mp.principle).toContain("It's not the Bible")
  })

  it('attaches no arithmetic to the $169 he wrote down', () => {
    const vp = DECISION_FIXTURE.cues.find((c) => c.cue_id === 'recorded_value_point')!
    expect(vp.no_arithmetic_attached).toBe(true)
    expect(vp.feature_id_source).toBe('assigned_by_this_fixture')
  })

  it('PROVES THE SCHEMA BINDS: an unknown key is rejected', () => {
    expect(() => decisionFixtureSchema.parse({ ...DECISION_FIXTURE, surprise_field: 1 })).toThrow()
  })
})

// =====================================================================================================
describe('T3.4.10o the decision fixture is the acceptance test for SIGNAL CHOICE', () => {
  const REPRESENTED = [
    'price_trend',
    'competition_intensity',
    'award_frequency_demand_cadence',
    'lead_time_urgency',
    'government_on_hand',
    'stocked_non_stocked_flag',
    'corner_ability',
    'management_price',
    'supplier_acquisition_price',
    'past_purchase_price_anchor',
  ] as const

  const decide = (cues: readonly DecisionCue[], represented: readonly string[]) => {
    const set = new Set(represented)
    const buys = cues.filter(
      (c) => set.has(c.feature_id) && c.expert_read.startsWith('buy_signal'),
    ).length
    return buys >= 3 ? 'quote' : 'no_quote'
  }

  const v0: DecisionScorer = {
    scorecard_version: 'v0-test-reference',
    represented_feature_ids: REPRESENTED,
    decide: (cues) => ({
      disposition: decide(cues, REPRESENTED),
      principal_reasons: [
        { feature_id: 'past_purchase_price_anchor', points: 30, sentence: 'the past purchase price is the anchor the market is not reading' },
        { feature_id: 'supplier_acquisition_price', points: 25, sentence: 'the margin depends on the acquisition price from the named supplier' },
        { feature_id: 'competition_intensity', points: 20, sentence: 'only one other company bid on the last solicitation' },
      ],
    }),
  }

  const result = runDecisionFixture(DECISION_FIXTURE, v0)

  it('DISPOSES THE NSN THE WAY HE DID', () => {
    expect(result.expert_disposition).toBe('quote')
    expect(result.engine_disposition).toBe('quote')
    expect(result.disposition_matches).toBe(true)
  })

  it('SURFACES BOTH REASONS HE HIMSELF ELEVATED', () => {
    expect(result.elevated_reasons_surfaced).toEqual([
      'supplier_acquisition_price',
      'past_purchase_price_anchor',
    ])
    expect(result.elevated_reasons_missing).toEqual([])
    expect(result.top_reasons_surfaced).toBe(true)
  })

  it('is accepted, and orders its principal reasons by points', () => {
    expect(result.accepted).toBe(true)
    expect(result.principal_reasons_ordered_by_points).toBe(true)
  })

  it('LOGS EVERY SIGNAL THE CARD CANNOT REPRESENT AS A GAP TO CLOSE, in fixture order', () => {
    expect(result.cues_present_not_cited.map((g) => g.cue_id)).toEqual([
      'platform_longevity',
      'distressed_incumbent_shelf',
      'approved_manufacturer_local',
      'affiliate_holding',
      'last_supplier_trajectory',
      'recorded_value_point',
    ])
    expect(result.coverage).toEqual({ cues_total: 16, cues_represented: 10, cues_not_cited: 6 })
    // Nothing is dropped. Every cue is either represented or on the gap list.
    expect(result.cues_represented.length + result.cues_present_not_cited.length).toBe(16)
  })

  it('carries his own words on each gap, so the gap list is workable without the source', () => {
    const gap = result.cues_present_not_cited.find((g) => g.cue_id === 'affiliate_holding')!
    expect(gap.status).toBe('cues_present_not_cited')
    expect(gap.feature_id).toBe('sourcing_confidence_affiliate_holding')
    expect(gap.expert_finding).toBe('Western air has five pieces')
    expect(gap.expert_principle).toContain('priority as far as accessing the parts')
    expect(gap.expert_read).toBe('buy_signal')
  })

  // ---------------------------------------------------------------------------------------------
  // NEGATIVE CONTROLS. Three ways to be wrong, each of which must be rejected.
  // ---------------------------------------------------------------------------------------------
  it('PROVES IT CAN FAIL: a scorer that disposes the other way is rejected', () => {
    const wrong: DecisionScorer = {
      ...v0,
      decide: () => ({
        disposition: 'no_quote',
        principal_reasons: [
          { feature_id: 'past_purchase_price_anchor', points: 30, sentence: 'x' },
          { feature_id: 'supplier_acquisition_price', points: 25, sentence: 'y' },
        ],
      }),
    }
    const r = runDecisionFixture(DECISION_FIXTURE, wrong)
    expect(r.disposition_matches).toBe(false)
    expect(r.accepted).toBe(false)
  })

  it('PROVES IT CAN FAIL: the right disposition with a dropped elevated reason is still rejected', () => {
    const thin: DecisionScorer = {
      ...v0,
      decide: () => ({
        disposition: 'quote',
        principal_reasons: [
          { feature_id: 'supplier_acquisition_price', points: 25, sentence: 'y' },
          { feature_id: 'competition_intensity', points: 20, sentence: 'z' },
        ],
      }),
    }
    const r = runDecisionFixture(DECISION_FIXTURE, thin)
    expect(r.disposition_matches).toBe(true)
    expect(r.elevated_reasons_missing).toEqual(['past_purchase_price_anchor'])
    expect(r.top_reasons_surfaced).toBe(false)
    expect(r.accepted).toBe(false)
  })

  it('PROVES THE GAP LIST IS COMPUTED: a card representing everything reports zero gaps', () => {
    const full: DecisionScorer = {
      ...v0,
      represented_feature_ids: DECISION_FIXTURE.cues.map((c) => c.feature_id),
    }
    const r = runDecisionFixture(DECISION_FIXTURE, full)
    expect(r.cues_present_not_cited).toEqual([])
    expect(r.coverage).toEqual({ cues_total: 16, cues_represented: 16, cues_not_cited: 0 })
  })

  it('PROVES THE ORDER CHECK FIRES: ascending points are reported as unordered', () => {
    const unordered: DecisionScorer = {
      ...v0,
      decide: () => ({
        disposition: 'quote',
        principal_reasons: [
          { feature_id: 'supplier_acquisition_price', points: 5, sentence: 'y' },
          { feature_id: 'past_purchase_price_anchor', points: 30, sentence: 'x' },
        ],
      }),
    }
    expect(runDecisionFixture(DECISION_FIXTURE, unordered).principal_reasons_ordered_by_points).toBe(
      false,
    )
  })
})

// =====================================================================================================
describe('T3.4.10p the module stays a pure library', () => {
  const files = [
    'lib/engine/backtest/harness.ts',
    'lib/engine/backtest/index.ts',
    'lib/engine/backtest/fixtures/nsn-1650-01-059-8221.json',
    'lib/engine/backtest/fixtures/nsn-4730-00-536-2210.json',
  ]
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')

  const ALLOWED_SPECIFIERS = new Set([
    'zod',
    '../../time/clock',
    './harness',
    './fixtures/nsn-1650-01-059-8221.json',
    './fixtures/nsn-4730-00-536-2210.json',
  ])

  it('imports nothing outside zod, lib/time and its own files', () => {
    for (const rel of files.filter((f) => f.endsWith('.ts'))) {
      const src = read(rel)
      const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!)
      expect(specifiers.length).toBeGreaterThan(0)
      for (const spec of specifiers) {
        expect(ALLOWED_SPECIFIERS.has(spec), `${rel} imports ${spec}`).toBe(true)
      }
    }
  })

  it('never reads wall time', () => {
    for (const rel of files.filter((f) => f.endsWith('.ts'))) {
      const src = read(rel)
      expect(/\bDate\.now\s*\(/.test(src), `${rel} calls Date.now()`).toBe(false)
      expect(/new\s+Date\s*\(\s*\)/.test(src), `${rel} calls new Date()`).toBe(false)
    }
  })

  it('contains no em dash, in code, comment, string or fixture', () => {
    for (const rel of files) {
      // Matched by code point so this file does not have to contain the character it forbids.
      expect(read(rel).includes(String.fromCharCode(8212)), `${rel} contains an em dash`).toBe(false)
    }
  })

  // NEGATIVE CONTROL: the three scans above must be capable of firing.
  it('PROVES THE SCANS FIRE: they reject a deliberately bad sample', () => {
    const bad = `import x from 'react'\nconst t = Date.now()\nconst u = new Date()\n// ${String.fromCharCode(8212)}`
    const specifiers = [...bad.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!)
    expect(specifiers).toEqual(['react'])
    expect(ALLOWED_SPECIFIERS.has(specifiers[0]!)).toBe(false)
    expect(/\bDate\.now\s*\(/.test(bad)).toBe(true)
    expect(/new\s+Date\s*\(\s*\)/.test(bad)).toBe(true)
    expect(bad.includes(String.fromCharCode(8212))).toBe(true)
  })
})
