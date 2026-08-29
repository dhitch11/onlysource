import { describe, it, expect } from 'vitest'
import { buildScorecardView } from '@/lib/intelligence/scorecard-view'
import type { ScorecardEvaluation } from '@/lib/engine/scorecard'
import type { Counterfactual } from '@/lib/engine/scorecard'

/** A minimal ScorecardEvaluation shaped for the presenter. Not a real score — a fixture. */
function evaluation(
  disposition: ScorecardEvaluation['disposition'],
  ground: ScorecardEvaluation['abstention_ground'] = null,
): ScorecardEvaluation {
  const cf: Counterfactual = {
    sentence: 'n/a',
    changes: [],
    combination: false,
    flippable: false,
    direction: 'to_resolve_abstention',
    gap_points: 0,
    resulting_score: null,
    resulting_verdict: null,
    threshold: 0,
    changeable_feature_count: 0,
    minimum_features_required: null,
    missing_fields: [],
  }
  return {
    scorecard_version: 'v0',
    as_of: '2026-08-14',
    input_vector_sha256: 'x',
    score: 0,
    disposition,
    abstention_ground: ground,
    disposition_sentence: 's',
    principal_reasons: [],
    counterfactual: cf,
    data_gaps: [],
    weights_are_a_prior: 'The weights are a prior, not a measurement.',
    detail: {} as ScorecardEvaluation['detail'],
  }
}

describe('buildScorecardView — abstention as the dominant designed state', () => {
  it('leads with abstention when it dominates (the live 181/186 shape)', () => {
    const evals = [
      ...Array.from({ length: 181 }, () => evaluation('insufficient_data', 'thin_core_coverage')),
      ...Array.from({ length: 3 }, () => evaluation('flag')),
      ...Array.from({ length: 2 }, () => evaluation('skip')),
    ]
    const view = buildScorecardView(evals, '2026-08-14')
    expect(view.dominant).toBe('insufficient_data')
    expect(view.counts).toEqual({ flag: 3, skip: 2, insufficient_data: 181 })
    expect(view.headline).toMatch(/181 of 186/)
    expect(view.headline).toMatch(/97%/) // 181/186 rounded
    expect(view.headline).toMatch(/cannot yet be scored/)
  })

  it('summarises abstention grounds by count, most common first, with a human label', () => {
    const evals = [
      ...Array.from({ length: 5 }, () => evaluation('insufficient_data', 'thin_core_coverage')),
      ...Array.from({ length: 2 }, () => evaluation('insufficient_data', 'unobserved_could_cross')),
    ]
    const view = buildScorecardView(evals, '2026-08-14')
    expect(view.abstentionGrounds[0]?.ground).toBe('thin_core_coverage')
    expect(view.abstentionGrounds[0]?.count).toBe(5)
    expect(view.abstentionGrounds[0]?.label).toMatch(/core legs/)
    expect(view.abstentionGrounds[1]?.count).toBe(2)
  })

  it('exposes only flag/skip rows in the scored list, preserving input order', () => {
    const evals = [evaluation('flag'), evaluation('insufficient_data', 'thin_core_coverage'), evaluation('skip')]
    const view = buildScorecardView(evals, '2026-08-14')
    expect(view.scored).toHaveLength(2)
    expect(view.scored.map((e) => e.disposition)).toEqual(['flag', 'skip'])
  })

  it('leads with flag when scoring dominates, not abstention', () => {
    const evals = [
      ...Array.from({ length: 10 }, () => evaluation('flag')),
      ...Array.from({ length: 2 }, () => evaluation('insufficient_data', 'thin_core_coverage')),
    ]
    const view = buildScorecardView(evals, '2026-08-14')
    expect(view.dominant).toBe('flag')
    expect(view.headline).toMatch(/10 of 12 candidates scored as worth pursuing/)
  })

  it('an empty book says so honestly, does not throw, carries no epistemic note', () => {
    const view = buildScorecardView([], '2026-08-14')
    expect(view.total).toBe(0)
    expect(view.headline).toMatch(/No candidates were evaluated/)
    expect(view.epistemicNote).toBeNull()
    expect(view.abstentionGrounds).toHaveLength(0)
  })

  it('carries the card epistemic statement verbatim from the evaluations', () => {
    const view = buildScorecardView([evaluation('flag')], '2026-08-14')
    expect(view.epistemicNote).toBe('The weights are a prior, not a measurement.')
  })
})
