import { describe, it, expect } from 'vitest'
import { buildBacktestView } from '@/lib/intelligence/backtest-view'
import { MIN_RESOLVED_FOR_CALIBRATION, type BacktestRow, type RowScorer, type RunOptions } from '@/lib/engine/backtest/harness'

describe('buildBacktestView — honest availability, abstention as the dominant state', () => {
  it('on live-shaped data (0 resolved outcomes) returns not_yet with the unlock path', () => {
    const view = buildBacktestView({ scoreableCandidates: 18, resolvedOutcomes: 0, feedDay: '2026-08-14' })
    expect(view.state).toBe('not_yet')
    if (view.state !== 'not_yet') throw new Error('unreachable')
    expect(view.resolvedNeeded).toBe(MIN_RESOLVED_FOR_CALIBRATION)
    expect(view.scoreableCandidates).toBe(18)
    expect(view.headline).toMatch(/18 candidates/)
    expect(view.why).toMatch(/third-party/)
    expect(view.unlock.length).toBeGreaterThanOrEqual(3)
  })

  it('with candidates but no outcomes, the headline says scoreable-but-unproven, not broken', () => {
    const view = buildBacktestView({ scoreableCandidates: 115, resolvedOutcomes: 0, feedDay: '2026-08-11' })
    if (view.state !== 'not_yet') throw new Error('expected not_yet')
    expect(view.headline).toMatch(/cannot yet be proven on money/)
  })

  it('with zero candidates and zero outcomes, says nothing to backtest yet', () => {
    const view = buildBacktestView({ scoreableCandidates: 0, resolvedOutcomes: 0, feedDay: '2026-08-14' })
    if (view.state !== 'not_yet') throw new Error('expected not_yet')
    expect(view.headline).toMatch(/nothing to backtest/)
  })

  it('stays not_yet when resolved outcomes exist but no runnable ledger is supplied', () => {
    // enough resolved, but the caller passed no cases/scorer — cannot fabricate a run
    const view = buildBacktestView({ scoreableCandidates: 50, resolvedOutcomes: 60, feedDay: '2026-08-14' })
    expect(view.state).toBe('not_yet')
  })

  it('runs the real harness only when resolved outcomes clear the gate AND a ledger is supplied', () => {
    // Construct a tiny synthetic ledger just to prove the wire reaches runBacktest. The rows are
    // labelled and valued; this is a test fixture, never live data.
    const cases: BacktestRow[] = Array.from({ length: 60 }, (_, i) => ({
      row_id: `r${i}`,
      item_key: `nsn-${i % 20}`,
      event_at_ms: 1_700_000_000_000 + i * 86_400_000,
      label_resolved_at_ms: 1_700_000_000_000 + i * 86_400_000 + 14 * 86_400_000,
      label: (i % 2) as 0 | 1,
      realised_value_usd: i % 2 === 1 ? 1000 + i : 0,
    }))
    const scorer: RowScorer = {
      scorecard_version: 'test-v0',
      score: (row) => ({ score: Number(row.label ?? 0), probability: row.label ?? 0 }),
    }
    const options: RunOptions = {
      k: 5,
      split: { folds: 3, embargo_ms: 0, train_mode: 'expanding' },
      configurations_tried: 1,
      clock: { now: () => 1_800_000_000_000 },
    }
    const view = buildBacktestView(
      { scoreableCandidates: 20, resolvedOutcomes: 60, feedDay: '2026-08-14' },
      { cases, scorer, options },
    )
    expect(view.state).toBe('ready')
    if (view.state !== 'ready') throw new Error('unreachable')
    expect(view.report.pre_registered_primary_metric).toBe('expected_value_at_k')
    expect(view.report.k).toBe(5)
  })
})
