/**
 * THE ARITHMETIC. An additive integer point sum, three dispositions, and a hash that makes the
 * whole thing reproducible.
 *
 * WHY THREE DISPOSITIONS AND NOT TWO. The empty states in this domain are real and frequent, and
 * an honest "we cannot see enough on this row, here is exactly what is missing" is worth more to
 * the principal than a confident number he cannot audit. `insufficient_data` is a shippable
 * answer, not a defect to engineer away, and it fires on two distinct grounds that are kept
 * distinct in the emitted reason: too little core evidence to hold a view at all, and enough
 * unobserved upside that a low score cannot honestly be called a skip.
 *
 * WHY THE HASH. Acceptance gate R3.5 requires that the same inputs and the same card version
 * reproduce a byte identical score, rank and computation record. Without an input vector hash on
 * the row, determinism is an assertion nobody can check later. With it, any historical score can
 * be replayed and the replay can be proved to have used the same inputs.
 *
 * NO WALL CLOCK. `as_of` arrives as an explicit argument. This module never reads the time.
 */

import { createHash } from 'node:crypto'
import {
  type FeatureValue,
  type Scorecard,
  type ScorecardBand,
  type BandDirection,
  bandFor,
  featureByKey,
  maxPointsFor,
} from './card'

/** Observed features. A key that is absent or `null` is unobserved, never a zero. */
export type FeatureObservations = Readonly<Record<string, FeatureValue | null | undefined>>

export type Disposition = 'flag' | 'skip' | 'insufficient_data'

/** Why the abstention fired, so the interface can say which kind of blindness this is. */
export type AbstentionGround = 'thin_core_coverage' | 'unobserved_could_cross' | null

export type Contribution = {
  readonly feature: string
  readonly label: string
  readonly observed: boolean
  readonly value: FeatureValue | null
  readonly band_id: string | null
  readonly points: number
  readonly direction: BandDirection
  readonly sentence_template: string | null
  readonly expert_span_ref: string | null
  readonly is_core: boolean
  readonly max_points: number
}

export type DataGap = {
  readonly field: string
  readonly why: string
  readonly what_would_resolve_it: string
}

export type ScoreResult = {
  readonly scorecard_version: string
  readonly as_of: string
  readonly input_vector_sha256: string
  readonly score: number
  readonly raw_points: number
  readonly threshold: number
  readonly disposition: Disposition
  readonly abstention_ground: AbstentionGround
  readonly disposition_sentence: string
  readonly observed_core_count: number
  readonly unobserved_upside: number
  readonly contributions: readonly Contribution[]
  readonly data_gaps: readonly DataGap[]
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`scorecard: a non finite number cannot be hashed deterministically, received ${String(value)}`)
  }
  // Negative zero and zero are the same measurement and must not produce two different hashes.
  return value === 0 ? 0 : value
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return JSON.stringify(normalizeNumber(value))
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  throw new Error(`scorecard: value of type ${typeof value} cannot be canonicalised`)
}

/**
 * The exact bytes the hash is taken over. Exported because a determinism failure is only
 * debuggable if you can diff the two serialisations that produced two different hashes.
 *
 * Every feature the card declares appears, with an explicit null when unobserved, so omitting a
 * key and passing null for it are the same input and hash identically. Keys are sorted, so the
 * order a caller happened to build the object in cannot change the hash.
 */
export function canonicalInputVector(
  card: Scorecard,
  observations: FeatureObservations,
  asOf: string,
): string {
  const features: Record<string, FeatureValue | null> = {}
  for (const feature of card.features) {
    const raw = observations[feature.key]
    features[feature.key] = raw === undefined || raw === null ? null : raw
  }
  return canonicalJson({ scorecard_version: card.version, as_of: asOf, features })
}

/** The R3.5 fingerprint of an evaluation input. */
export function inputVectorSha256(
  card: Scorecard,
  observations: FeatureObservations,
  asOf: string,
): string {
  return createHash('sha256').update(canonicalInputVector(card, observations, asOf), 'utf8').digest('hex')
}

function clampToScale(card: Scorecard, points: number): number {
  if (points < card.scale.min) return card.scale.min
  if (points > card.scale.max) return card.scale.max
  return points
}

/**
 * The disposition rule, separated from scoring so the counterfactual can ask what a changed
 * score would have been disposed as, through exactly the same logic rather than a second copy.
 */
export function disposeScore(
  card: Scorecard,
  input: { readonly score: number; readonly observedCoreCount: number; readonly unobservedUpside: number },
): { readonly disposition: Disposition; readonly ground: AbstentionGround } {
  if (input.observedCoreCount < card.coverage.min_core_features_observed) {
    return { disposition: 'insufficient_data', ground: 'thin_core_coverage' }
  }
  if (input.score >= card.threshold.flag_at_or_above) {
    return { disposition: 'flag', ground: null }
  }
  if (
    card.coverage.abstain_when_unobserved_could_cross &&
    input.score + input.unobservedUpside >= card.threshold.flag_at_or_above
  ) {
    return { disposition: 'insufficient_data', ground: 'unobserved_could_cross' }
  }
  return { disposition: 'skip', ground: null }
}

function dispositionSentence(
  card: Scorecard,
  disposition: Disposition,
  ground: AbstentionGround,
  observedCoreCount: number,
): string {
  if (disposition === 'flag') {
    return 'This row scores at or above the review threshold and is flagged for a person to work.'
  }
  if (disposition === 'skip') {
    return 'This row scores below the review threshold and nothing unobserved could carry it over, so it is a skip.'
  }
  if (ground === 'thin_core_coverage') {
    return `Only ${observedCoreCount} of the core features on this card were observed, which is below the floor this card requires to hold a view, so the row is not disposed and the missing fields are listed.`
  }
  return 'This row scores below the review threshold, but the features that were never observed could carry it over on their own, so calling it a skip would assert more than the evidence supports.'
}

/**
 * Score a row against a card.
 *
 * Deterministic in every part: no wall clock, no randomness, no lookup outside the card and the
 * observations handed in. Two calls with the same arguments produce the same object.
 */
export function scoreOpportunity(
  card: Scorecard,
  observations: FeatureObservations,
  asOf: string,
): ScoreResult {
  const coreSet = new Set(card.coverage.core_features)
  const contributions: Contribution[] = []
  const dataGaps: DataGap[] = []
  let rawPoints = 0
  let observedCoreCount = 0
  let unobservedUpside = 0

  for (const feature of card.features) {
    const raw = observations[feature.key]
    const isCore = coreSet.has(feature.key)
    if (raw === undefined || raw === null) {
      const upside = maxPointsFor(feature)
      unobservedUpside += upside
      contributions.push({
        feature: feature.key,
        label: feature.label,
        observed: false,
        value: null,
        band_id: null,
        points: 0,
        direction: 'neutral',
        sentence_template: null,
        expert_span_ref: feature.expert_span_ref,
        is_core: isCore,
        max_points: upside,
      })
      dataGaps.push({
        field: feature.key,
        why: isCore
          ? 'Unobserved, and this is a core feature the card requires to hold a view.'
          : 'Unobserved.',
        what_would_resolve_it: feature.resolves_with,
      })
      continue
    }

    const band: ScorecardBand = bandFor(feature, raw)
    rawPoints += band.points
    if (isCore) observedCoreCount += 1
    contributions.push({
      feature: feature.key,
      label: feature.label,
      observed: true,
      value: raw,
      band_id: band.id,
      points: band.points,
      direction: band.direction,
      sentence_template: band.sentence,
      expert_span_ref: feature.expert_span_ref,
      is_core: isCore,
      max_points: maxPointsFor(feature),
    })
  }

  const score = clampToScale(card, rawPoints)
  const disposed = disposeScore(card, { score, observedCoreCount, unobservedUpside })

  return {
    scorecard_version: card.version,
    as_of: asOf,
    input_vector_sha256: inputVectorSha256(card, observations, asOf),
    score,
    raw_points: rawPoints,
    threshold: card.threshold.flag_at_or_above,
    disposition: disposed.disposition,
    abstention_ground: disposed.ground,
    disposition_sentence: dispositionSentence(card, disposed.disposition, disposed.ground, observedCoreCount),
    observed_core_count: observedCoreCount,
    unobserved_upside: unobservedUpside,
    contributions,
    data_gaps: dataGaps,
  }
}

/** The observed contribution for one feature, for callers that need a single row explained. */
export function contributionFor(result: ScoreResult, featureKey: string): Contribution {
  const found = result.contributions.find((c) => c.feature === featureKey)
  if (!found) throw new Error(`scorecard: no contribution recorded for ${featureKey}`)
  return found
}

/** Re-exported for callers that hold a card and need a feature definition beside a contribution. */
export { featureByKey }
