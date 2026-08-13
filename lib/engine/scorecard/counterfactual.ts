/**
 * THE COUNTERFACTUAL. Deterministic, never a model call, never a free lookup.
 *
 * The expert will not ask "why did you flag this". He will ask "what would have made you not flag
 * it", and that question is answerable exactly on an additive integer scorecard with a threshold
 * while being unanswerable on a black box. It is a small search, not a free one: closing a points
 * gap with a subset of features is a subset sum, so the rule that picks between equally good
 * answers has to be stated and versioned rather than left to whatever order the loop happened to
 * run in.
 *
 * THE TIE BREAK, taken from the card and not from this file: fewest features changed first, then
 * the most actionable feature from the card's ranked actionability list. A single feature flip
 * names the SMALLEST band change that still crosses the threshold, because "if there had been one
 * more bidder" is a usable sentence and "if there had been twenty" is not.
 *
 * THE THREE HONEST ENDINGS. When one feature closes the gap, the sentence names it. When none
 * does, the sentence names the smallest combination that does and says plainly that it is a
 * combination. When no realistic combination flips the disposition, the sentence says THAT, which
 * is itself the answer rather than a failure to produce one.
 *
 * Only OBSERVED features can be changed. An unobserved field is a measurement gap, not a value
 * that could have been different, and it belongs in `data_gaps`.
 */

import {
  type FeatureValue,
  type Scorecard,
  actionabilityRank,
  featureByKey,
  featureOrder,
} from './card'
import { type Disposition, type ScoreResult, disposeScore } from './score'

export type CounterfactualDirection = 'to_not_flag' | 'to_flag' | 'to_resolve_abstention'

export type CounterfactualChange = {
  readonly field: string
  readonly current_value: FeatureValue | null
  readonly flip_value: FeatureValue
  readonly points_delta: number
  /**
   * The verdict this single change produces on its own. Null on a member of a combination,
   * because no member of a combination produces a verdict by itself, and reporting the set's
   * verdict against each member would read as though any one of them were sufficient.
   */
  readonly resulting_verdict: Disposition | null
}

export type Counterfactual = {
  readonly sentence: string
  readonly changes: readonly CounterfactualChange[]
  readonly combination: boolean
  readonly flippable: boolean
  readonly direction: CounterfactualDirection
  readonly gap_points: number
  readonly resulting_score: number | null
  readonly resulting_verdict: Disposition | null
  readonly threshold: number
  readonly changeable_feature_count: number
  readonly minimum_features_required: number | null
  readonly missing_fields: readonly string[]
}

type Candidate = {
  readonly feature: string
  readonly label: string
  readonly currentValue: FeatureValue
  readonly currentPoints: number
  /** Every reachable band change in the needed direction, by magnitude ascending. */
  readonly options: readonly { readonly flipValue: FeatureValue; readonly delta: number }[]
  readonly maxMagnitude: number
  readonly actionability: number
  readonly order: number
}

function buildCandidates(card: Scorecard, result: ScoreResult, needGain: boolean): Candidate[] {
  const candidates: Candidate[] = []
  for (const contribution of result.contributions) {
    if (!contribution.observed || contribution.value === null) continue
    const feature = featureByKey(card, contribution.feature)
    const options: { flipValue: FeatureValue; delta: number }[] = []
    for (const band of feature.bands) {
      if (band.id === contribution.band_id) continue
      const delta = band.points - contribution.points
      if (needGain ? delta > 0 : delta < 0) {
        options.push({ flipValue: band.representative_value, delta })
      }
    }
    if (options.length === 0) continue
    options.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))
    const maxMagnitude = options.reduce((best, o) => Math.max(best, Math.abs(o.delta)), 0)
    candidates.push({
      feature: contribution.feature,
      label: contribution.label,
      currentValue: contribution.value,
      currentPoints: contribution.points,
      options,
      maxMagnitude,
      actionability: actionabilityRank(card, contribution.feature),
      order: featureOrder(card, contribution.feature),
    })
  }
  // Deterministic base order: most actionable first, then the card's own feature order.
  candidates.sort((a, b) => a.actionability - b.actionability || a.order - b.order)
  return candidates
}

function verdictAfter(card: Scorecard, result: ScoreResult, newScore: number): Disposition {
  return disposeScore(card, {
    score: newScore,
    observedCoreCount: result.observed_core_count,
    unobservedUpside: result.unobserved_upside,
  }).disposition
}

/** Combinations of exactly `size`, generated in the order `items` is already sorted in. */
function* combinationsOf<T>(items: readonly T[], size: number): Generator<readonly T[]> {
  if (size === 0) {
    yield []
    return
  }
  for (let i = 0; i <= items.length - size; i += 1) {
    const head = items[i]
    if (head === undefined) continue
    for (const tail of combinationsOf(items.slice(i + 1), size - 1)) {
      yield [head, ...tail]
    }
  }
}

function fieldList(labels: readonly string[]): string {
  if (labels.length === 0) return 'nothing'
  if (labels.length === 1) return labels[0] ?? 'nothing'
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1] ?? ''}`
}

function abstentionCounterfactual(card: Scorecard, result: ScoreResult): Counterfactual {
  const missing = result.data_gaps.map((gap) => gap.field)
  const coreMissing = result.contributions
    .filter((c) => !c.observed && c.is_core)
    .map((c) => c.label)
  const named = coreMissing.length > 0 ? coreMissing : result.contributions.filter((c) => !c.observed).map((c) => c.label)
  const shown = named.slice(0, card.reasons.max_principal_reasons)
  const sentence =
    result.abstention_ground === 'thin_core_coverage'
      ? `This row is not disposed because too few core features were observed. Observing ${fieldList(shown)} would let the card hold a view, and until then no value change would be an honest counterfactual.`
      : `This row scores below the threshold, but the unobserved features could carry it over on their own. Observing ${fieldList(shown)} would settle it, and until then no value change would be an honest counterfactual.`
  return {
    sentence,
    changes: [],
    combination: false,
    flippable: false,
    direction: 'to_resolve_abstention',
    gap_points: Math.max(0, card.threshold.flag_at_or_above - result.score),
    resulting_score: null,
    resulting_verdict: null,
    threshold: card.threshold.flag_at_or_above,
    changeable_feature_count: result.contributions.filter((c) => c.observed).length,
    minimum_features_required: null,
    missing_fields: missing,
  }
}

/**
 * Build the counterfactual for a scored row.
 *
 * The gap is exact integer arithmetic against the threshold, which is why this can be checked by
 * hand: to stop flagging, the score must fall to one point below the threshold; to start
 * flagging, it must reach the threshold.
 */
export function buildCounterfactual(card: Scorecard, result: ScoreResult): Counterfactual {
  if (result.disposition === 'insufficient_data') return abstentionCounterfactual(card, result)

  const threshold = card.threshold.flag_at_or_above
  const needGain = result.disposition !== 'flag'
  const gap = needGain ? threshold - result.score : result.score - threshold + 1
  const direction: CounterfactualDirection = needGain ? 'to_flag' : 'to_not_flag'
  const candidates = buildCandidates(card, result, needGain)
  const changeableCount = candidates.length

  const base = {
    direction,
    gap_points: gap,
    threshold,
    changeable_feature_count: changeableCount,
    missing_fields: result.data_gaps.map((g) => g.field),
  }

  // Single feature first: fewest features changed is the first tie break on the card.
  for (const candidate of candidates) {
    if (candidate.maxMagnitude < gap) continue
    const option = candidate.options.find((o) => Math.abs(o.delta) >= gap)
    if (!option) continue
    const newScore = result.score + option.delta
    const verdict = verdictAfter(card, result, newScore)
    const moved = needGain ? 'risen' : 'fallen'
    const side = needGain ? 'to or above' : 'below'
    return {
      ...base,
      sentence: `Had ${candidate.label} been ${String(option.flipValue)}, the score would have ${moved} by ${Math.abs(option.delta)} points to ${newScore}, ${side} the threshold of ${threshold}, and this row would have been disposed ${verdict}.`,
      changes: [
        {
          field: candidate.feature,
          current_value: candidate.currentValue,
          flip_value: option.flipValue,
          points_delta: option.delta,
          resulting_verdict: verdict,
        },
      ],
      combination: false,
      flippable: verdict !== result.disposition,
      resulting_score: newScore,
      resulting_verdict: verdict,
      minimum_features_required: 1,
    }
  }

  // No single feature closes it. Find the minimum number of features that does, which is the
  // prefix of the largest available changes: taking the k largest is optimal for cardinality.
  const byMagnitude = candidates.slice().sort((a, b) => b.maxMagnitude - a.maxMagnitude)
  let running = 0
  let minimumRequired: number | null = null
  for (let i = 0; i < byMagnitude.length; i += 1) {
    running += byMagnitude[i]?.maxMagnitude ?? 0
    if (running >= gap) {
      minimumRequired = i + 1
      break
    }
  }

  if (minimumRequired === null) {
    return {
      ...base,
      sentence: `No combination of the ${changeableCount} observed features on this card closes the ${gap} point gap to the threshold of ${threshold}, so nothing this card can see would change this disposition.`,
      changes: [],
      combination: false,
      flippable: false,
      resulting_score: null,
      resulting_verdict: null,
      minimum_features_required: null,
    }
  }

  if (minimumRequired > card.counterfactual.realistic_combination_max_features) {
    return {
      ...base,
      sentence: `Closing the ${gap} point gap to the threshold of ${threshold} would take at least ${minimumRequired} features changing at once, which is more than this card treats as a realistic counterfactual, so the honest answer is that nothing realistic flips this row.`,
      changes: [],
      combination: false,
      flippable: false,
      resulting_score: null,
      resulting_verdict: null,
      minimum_features_required: minimumRequired,
    }
  }

  // Among sets of that size, take the first feasible one in actionability order, which is the
  // card's second tie break applied member by member.
  for (const set of combinationsOf(candidates, minimumRequired)) {
    const total = set.reduce((sum, c) => sum + (needGain ? c.maxMagnitude : -c.maxMagnitude), 0)
    if (Math.abs(total) < gap) continue
    const newScore = result.score + total
    const verdict = verdictAfter(card, result, newScore)
    const changes: CounterfactualChange[] = set.map((candidate) => {
      const option = candidate.options[candidate.options.length - 1]
      return {
        field: candidate.feature,
        current_value: candidate.currentValue,
        flip_value: option?.flipValue ?? candidate.currentValue,
        points_delta: option?.delta ?? 0,
        resulting_verdict: null,
      }
    })
    const moved = needGain ? 'risen' : 'fallen'
    return {
      ...base,
      sentence: `No single feature closes the ${gap} point gap to the threshold of ${threshold}. The smallest combination that does is ${fieldList(set.map((c) => c.label))}, which together would have ${moved} the score by ${Math.abs(total)} points to ${newScore}, and this row would have been disposed ${verdict}. That is a combination, not a single change.`,
      changes,
      combination: true,
      flippable: verdict !== result.disposition,
      resulting_score: newScore,
      resulting_verdict: verdict,
      minimum_features_required: minimumRequired,
    }
  }

  // Unreachable while the prefix arithmetic above is correct, and kept because an honest
  // impossible branch is better than a wrong sentence if it ever stops being unreachable.
  return {
    ...base,
    sentence: `No combination of the ${changeableCount} observed features on this card closes the ${gap} point gap to the threshold of ${threshold}, so nothing this card can see would change this disposition.`,
    changes: [],
    combination: false,
    flippable: false,
    resulting_score: null,
    resulting_verdict: null,
    minimum_features_required: minimumRequired,
  }
}
