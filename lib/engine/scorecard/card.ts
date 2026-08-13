/**
 * THE SCORECARD AS DATA, NOT AS CODE.
 *
 * The weights live in `versions/v0.json`, a reviewed artifact carrying an author, a date, a
 * rationale and a diff. This file loads that artifact and validates it. It contains no point
 * value, no threshold and no feature name of its own, deliberately: the moment a weight is
 * readable only by reading TypeScript, the principal can no longer check the card himself, and
 * checking it himself is the entire reason the model is an integer point scorecard rather than a
 * gradient boosted one.
 *
 * The second reason is historical. A score is meaningless without the version that produced it,
 * so a card is an immutable, addressable object that a stored score can point back at years
 * later. Editing a shipped card in place would silently rewrite history, which is why loading is
 * strict: a card that fails any structural check throws rather than scoring at reduced fidelity.
 *
 * WEIGHTS ARE A PRIOR, NOT A MEASUREMENT. The card carries that statement as a field so every
 * interface can state it, and `loadScorecard` refuses a card that does not.
 */

import { z } from 'zod'
import rawV0 from './versions/v0.json'

/** A value a feature can take. Absence is `null` and is never confused with `false` or zero. */
export type FeatureValue = number | boolean | string

/** Band direction, checked against the sign of the points by the R3.7 gate in `reasons.ts`. */
export type BandDirection = 'raises' | 'lowers' | 'neutral'

const conditionSchema = z.union([
  z.object({ op: z.literal('gte'), value: z.number() }),
  z.object({ op: z.literal('lte'), value: z.number() }),
  z.object({ op: z.literal('gt'), value: z.number() }),
  z.object({ op: z.literal('lt'), value: z.number() }),
  z.object({ op: z.literal('eq'), value: z.union([z.number(), z.boolean(), z.string()]) }),
  z.object({ op: z.literal('in'), values: z.array(z.union([z.number(), z.boolean(), z.string()])).min(1) }),
  z.object({ op: z.literal('always') }),
])

const bandSchema = z.object({
  id: z.string().min(1),
  when: conditionSchema,
  points: z.number().int(),
  direction: z.enum(['raises', 'lowers', 'neutral']),
  representative_value: z.union([z.number(), z.boolean(), z.string()]),
  sentence: z.string().min(1),
})

const featureSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value_type: z.enum(['integer', 'number', 'boolean', 'enum']),
  value_domain: z.array(z.union([z.number(), z.boolean(), z.string()])).optional(),
  signal_class: z.string().min(1),
  never_price_input: z.boolean(),
  labels: z.array(z.string()),
  resolves_with: z.string().min(1),
  provenance: z.object({
    grade: z.enum(['VERIFIED', 'REPORTED', 'ESTIMATED', 'UNVERIFIED']),
    source: z.string().min(1),
    quote: z.string().min(1),
  }),
  expert_span_ref: z.string().min(1).nullable(),
  bands: z.array(bandSchema).min(1),
})

const cardSchema = z.object({
  schema_version: z.literal(1),
  version: z.string().min(1),
  name: z.string().min(1),
  author: z.string().min(1),
  reviewed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  previous_version: z.string().min(1).nullable(),
  diff_from_previous: z.string().min(1).nullable(),
  rationale: z.string().min(1),
  epistemic_status: z.object({
    weights_are: z.literal('PRIOR'),
    grade: z.enum(['VERIFIED', 'REPORTED', 'ESTIMATED', 'UNVERIFIED']),
    statement: z.string().min(1),
    refit_precondition: z.string().min(1),
    calibration_note: z.string().min(1),
  }),
  scale: z.object({
    min: z.number().int(),
    max: z.number().int(),
    integer: z.literal(true),
    direction: z.string().min(1),
  }),
  max_positive_points: z.number().int().positive(),
  threshold: z.object({
    flag_at_or_above: z.number().int(),
    rationale: z.string().min(1),
  }),
  coverage: z.object({
    min_core_features_observed: z.number().int().nonnegative(),
    core_features: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1),
    abstain_when_unobserved_could_cross: z.boolean(),
    abstain_when_unobserved_could_cross_rationale: z.string().min(1),
  }),
  counterfactual: z.object({
    tie_break: z.array(z.enum(['fewest_features_changed', 'most_actionable'])).min(1),
    tie_break_statement: z.string().min(1),
    realistic_combination_max_features: z.number().int().positive(),
    realistic_combination_rationale: z.string().min(1),
    changes_only_observed_features: z.literal(true),
    changes_only_observed_features_rationale: z.string().min(1),
    actionability_rank: z.array(z.string().min(1)).min(1),
    actionability_rank_rationale: z.string().min(1),
  }),
  reasons: z.object({
    max_principal_reasons: z.number().int().positive(),
    never_pad: z.literal(true),
    order: z.string().min(1),
    order_rationale: z.string().min(1),
    direction_lexicon: z.object({
      raises: z.array(z.string().min(1)).min(1),
      lowers: z.array(z.string().min(1)).min(1),
    }),
    direction_lexicon_rationale: z.string().min(1),
    sentence_placeholders: z.array(z.string().min(1)).min(1),
    sentence_numeral_rule: z.string().min(1),
  }),
  excluded_by_design: z.array(z.object({ feature: z.string().min(1), why: z.string().min(1) })),
  cues_present_not_cited: z.array(
    z.object({
      cue: z.string().min(1),
      expert_span_ref: z.string().min(1),
      why: z.string().min(1),
    }),
  ),
  expert_spans: z.object({
    note: z.string().min(1),
    spans: z.record(
      z.string(),
      z.object({ source: z.string().min(1), quote: z.string().min(1) }),
    ),
  }),
  features: z.array(featureSchema).min(1),
})

export type BandCondition = z.infer<typeof conditionSchema>
export type ScorecardBand = z.infer<typeof bandSchema>
export type ScorecardFeature = z.infer<typeof featureSchema>
export type Scorecard = z.infer<typeof cardSchema>
export type ExpertSpan = { readonly source: string; readonly quote: string }

/** Thrown for any structural defect in a card. A bad card never scores at reduced fidelity. */
export class ScorecardCardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScorecardCardError'
  }
}

/** Digits outside a placeholder in a band sentence, which the numeral firewall would flag. */
const BARE_DIGIT = /\d/

function sentenceWithoutPlaceholders(sentence: string, placeholders: readonly string[]): string {
  let stripped = sentence
  for (const placeholder of placeholders) {
    stripped = stripped.split(placeholder).join('')
  }
  return stripped
}

/**
 * Every structural invariant a card must satisfy, checked in one place so a reviewer editing
 * `v0.json` finds out at load time rather than in a rendered sentence a customer reads.
 */
function assertCardIntegrity(card: Scorecard): void {
  const fail = (message: string): never => {
    throw new ScorecardCardError(`scorecard ${card.version}: ${message}`)
  }

  const keys = card.features.map((f) => f.key)
  const unique = new Set(keys)
  if (unique.size !== keys.length) fail('feature keys are not unique')

  if (card.threshold.flag_at_or_above < card.scale.min || card.threshold.flag_at_or_above > card.scale.max) {
    fail('threshold falls outside the declared scale')
  }

  let maxPositive = 0
  for (const feature of card.features) {
    const last = feature.bands[feature.bands.length - 1]
    if (!last || last.when.op !== 'always') {
      fail(`feature ${feature.key} does not end in an always band, so a value could match nothing`)
    }
    const bandIds = new Set(feature.bands.map((b) => b.id))
    if (bandIds.size !== feature.bands.length) fail(`feature ${feature.key} has duplicate band ids`)

    if (feature.value_type === 'enum' && (!feature.value_domain || feature.value_domain.length === 0)) {
      fail(`enum feature ${feature.key} declares no value_domain, so an unknown token would score as zero`)
    }

    let best = 0
    for (const band of feature.bands) {
      if (band.points > 0 && band.direction !== 'raises') {
        fail(`band ${feature.key}.${band.id} carries positive points with direction ${band.direction}`)
      }
      if (band.points < 0 && band.direction !== 'lowers') {
        fail(`band ${feature.key}.${band.id} carries negative points with direction ${band.direction}`)
      }
      if (band.points === 0 && band.direction !== 'neutral') {
        fail(`band ${feature.key}.${band.id} carries zero points with direction ${band.direction}`)
      }
      const stripped = sentenceWithoutPlaceholders(band.sentence, card.reasons.sentence_placeholders)
      if (BARE_DIGIT.test(stripped)) {
        fail(
          `band ${feature.key}.${band.id} sentence carries a bare digit, which cannot be traced back to a payload field`,
        )
      }
      if (band.points > best) best = band.points
    }
    maxPositive += best

    if (feature.expert_span_ref !== null && !(feature.expert_span_ref in card.expert_spans.spans)) {
      fail(`feature ${feature.key} points at expert span ${feature.expert_span_ref}, which the card does not carry`)
    }
  }

  if (maxPositive !== card.max_positive_points) {
    fail(
      `declared max_positive_points ${card.max_positive_points} does not equal the summed best band of every feature, ${maxPositive}`,
    )
  }

  for (const core of card.coverage.core_features) {
    if (!unique.has(core)) fail(`core feature ${core} is not a feature on this card`)
  }
  if (card.coverage.min_core_features_observed > card.coverage.core_features.length) {
    fail('min_core_features_observed exceeds the number of core features, so nothing could ever be disposed')
  }

  const ranked = new Set(card.counterfactual.actionability_rank)
  if (ranked.size !== card.counterfactual.actionability_rank.length) {
    fail('actionability_rank repeats a feature')
  }
  for (const key of keys) {
    if (!ranked.has(key)) fail(`actionability_rank omits feature ${key}, so a tie break would be undefined`)
  }
  for (const key of ranked) {
    if (!unique.has(key)) fail(`actionability_rank names ${key}, which is not a feature on this card`)
  }

  for (const cue of card.cues_present_not_cited) {
    if (!(cue.expert_span_ref in card.expert_spans.spans)) {
      fail(`cue ${cue.cue} points at expert span ${cue.expert_span_ref}, which the card does not carry`)
    }
  }
}

/**
 * Parse and validate a card from unknown data. Exported so a test, a review tool or a future
 * migration can load a candidate card without importing it as a module.
 */
export function loadScorecard(raw: unknown): Scorecard {
  const parsed = cardSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ScorecardCardError(`card failed schema validation: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  }
  assertCardIntegrity(parsed.data)
  return parsed.data
}

/** The shipped v0 card, validated at module load so a broken artifact fails loudly and early. */
export const SCORECARD_V0: Scorecard = loadScorecard(rawV0)

/** Look up a feature definition, throwing rather than returning undefined into scoring code. */
export function featureByKey(card: Scorecard, key: string): ScorecardFeature {
  const found = card.features.find((f) => f.key === key)
  if (!found) throw new ScorecardCardError(`scorecard ${card.version}: no feature named ${key}`)
  return found
}

/** Position of a feature in the card's declared order. The deterministic tie break for reasons. */
export function featureOrder(card: Scorecard, key: string): number {
  const index = card.features.findIndex((f) => f.key === key)
  if (index < 0) throw new ScorecardCardError(`scorecard ${card.version}: no feature named ${key}`)
  return index
}

/** Position in the reviewed actionability list. Lower is more actionable. */
export function actionabilityRank(card: Scorecard, key: string): number {
  const index = card.counterfactual.actionability_rank.indexOf(key)
  if (index < 0) throw new ScorecardCardError(`scorecard ${card.version}: ${key} is not ranked for actionability`)
  return index
}

/** The verbatim span where the expert articulated a criterion, or null when none is recorded. */
export function expertSpan(card: Scorecard, ref: string | null): ExpertSpan | null {
  if (ref === null) return null
  const span = card.expert_spans.spans[ref]
  if (!span) throw new ScorecardCardError(`scorecard ${card.version}: no expert span named ${ref}`)
  return span
}

function conditionMatches(condition: BandCondition, value: FeatureValue): boolean {
  switch (condition.op) {
    case 'always':
      return true
    case 'eq':
      return value === condition.value
    case 'in':
      return condition.values.includes(value)
    case 'gte':
      return typeof value === 'number' && value >= condition.value
    case 'lte':
      return typeof value === 'number' && value <= condition.value
    case 'gt':
      return typeof value === 'number' && value > condition.value
    case 'lt':
      return typeof value === 'number' && value < condition.value
  }
}

/**
 * Validate an observed value against what the card says the feature can hold.
 *
 * A token the card does not know is an ERROR, never a zero. Silently falling through to the
 * always band would turn a data defect into a confident low score, which is the failure this
 * whole product exists to avoid.
 */
export function assertValueInDomain(feature: ScorecardFeature, value: FeatureValue): void {
  if (feature.value_type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new ScorecardCardError(`feature ${feature.key} expects a boolean, received ${typeof value}`)
    }
    return
  }
  if (feature.value_type === 'enum') {
    const domain = feature.value_domain ?? []
    if (!domain.includes(value)) {
      throw new ScorecardCardError(
        `feature ${feature.key} received ${String(value)}, which is not in its declared domain`,
      )
    }
    return
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ScorecardCardError(`feature ${feature.key} expects a finite number, received ${String(value)}`)
  }
  if (feature.value_type === 'integer' && !Number.isInteger(value)) {
    throw new ScorecardCardError(`feature ${feature.key} expects an integer, received ${String(value)}`)
  }
}

/** The first band an observed value matches. Bands are ordered, so first match wins. */
export function bandFor(feature: ScorecardFeature, value: FeatureValue): ScorecardBand {
  assertValueInDomain(feature, value)
  for (const band of feature.bands) {
    if (conditionMatches(band.when, value)) return band
  }
  // assertCardIntegrity guarantees a trailing always band, so this is unreachable on a loaded card.
  throw new ScorecardCardError(`feature ${feature.key} has no band matching ${String(value)}`)
}

/** The most points a feature can contribute. Used for the abstention arithmetic. */
export function maxPointsFor(feature: ScorecardFeature): number {
  return feature.bands.reduce((best, band) => (band.points > best ? band.points : best), 0)
}

/** The fewest points a feature can contribute, which may be negative. */
export function minPointsFor(feature: ScorecardFeature): number {
  return feature.bands.reduce(
    (worst, band) => (band.points < worst ? band.points : worst),
    feature.bands[0]?.points ?? 0,
  )
}
