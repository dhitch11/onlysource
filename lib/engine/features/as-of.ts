/**
 * T3 ENGINE 4.1. THE AS-OF FIREWALL. The single legal path to any feature value, in training,
 * in serving and in backtest (`HANDOFFS/T3-ENGINE.md:276`).
 *
 * ---------------------------------------------------------------------------------------
 * WHY ONE FUNCTION AND NOT A CONVENIENT SECOND ONE
 * ---------------------------------------------------------------------------------------
 * Two paths is how leakage ships invisibly (`HANDOFFS/T3-ENGINE-KICKOFF-PACK.md:172`). A
 * backtest that looks excellent because a post-award artifact leaked is worse than no
 * backtest: it produces confident wrong priorities and nobody finds out for months. So the
 * module is arranged to make a second path awkward to write rather than merely discouraged:
 *
 *   a. `index.ts` exports `featuresAsOf` and readers over its OUTPUT. It exports no function
 *      that returns raw observations, and the port crosses the boundary as a TYPE only, which
 *      is erased at runtime and cannot be called.
 *   b. The port is never told the as-of instant, so no adapter can pre-filter and no adapter
 *      can quietly disagree with this file about the comparison.
 *   c. Every observation reaches the same three lines below. There is no bypass, no "raw"
 *      flag and no options object with an escape hatch in it.
 *
 * ---------------------------------------------------------------------------------------
 * THE COMPARISON, AND ITS BOUNDARY
 * ---------------------------------------------------------------------------------------
 * An observation is visible when `extractedAt <= at`. Equality is visible: a value extracted
 * at the exact instant of the decision WAS on the desk at the moment of the decision. A
 * non-finite `extractedAt` is not visible under either comparison, and that is a trap worth
 * naming: `NaN > at` is `false`, so a firewall written as `if (extractedAt > at) exclude`
 * ADMITS a NaN. This file refuses the observation structurally before it can reach the
 * comparison at all.
 */

import { z } from 'zod'
import {
  ENTITY_KINDS,
  PROVENANCE_GRADES,
  SOURCE_CLASS_DEFAULT,
  SOURCE_CLASS_FEATURE,
  type AvailableFeatureValue,
  type DataGap,
  type FeatureContext,
  type FeatureDefinition,
  type FeatureEntity,
  type FeatureObservation,
  type FeatureSet,
  type FeatureSource,
  type FeatureValue,
  type LeakageReport,
  type LeakageViolation,
  type RefusedObservation,
  type SourceClass,
  type SourceLocator,
  type UnavailableFeatureValue,
  type WithheldObservation,
} from './types'

/**
 * The structural contract on one observation. The source is an injected boundary, so its
 * output is checked rather than trusted: zod strips unknown keys, so nothing the engine did
 * not ask for can travel into a feature set, and it rejects NaN and Infinity for numbers,
 * which is what closes the comparison trap described at the top of this file.
 */
const OBSERVATION_SCHEMA = z.object({
  feature: z.string().min(1),
  entityKind: z.enum(ENTITY_KINDS),
  entityId: z.string().min(1),
  orgId: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  sourceDocumentId: z.string().min(1),
  locator: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('span'),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    }),
    z.object({ kind: z.literal('field'), field: z.string().min(1) }),
  ]),
  extractedAt: z.number(),
  grade: z.enum(PROVENANCE_GRADES),
})

/** ISO rendering of an instant for operator-facing sentences. `new Date(number)` is deterministic. */
function isoOf(instantMs: number): string {
  return new Date(instantMs).toISOString()
}

/** Lexicographic, not locale aware. `localeCompare` would make byte-identical output a lie. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function locatorKey(locator: SourceLocator): string {
  return locator.kind === 'span'
    ? `span:${locator.start}:${locator.end}`
    : `field:${locator.field}`
}

/**
 * THE CHOKEPOINT PREDICATE. Kept as a named function with one job so that the property under
 * test is a thing that exists rather than an inline expression somebody edits by accident.
 * Not exported from `index.ts`: a future database push-down must call THIS, not restate it.
 */
function isVisibleAsOf(extractedAt: number, at: number): boolean {
  return Number.isFinite(extractedAt) && extractedAt <= at
}

/**
 * Which of two admitted observations wins for a feature. Newest first, then a stable tiebreak,
 * because R3.5 requires the same inputs to reproduce a byte-identical record and "whichever the
 * source listed first" is not a rule, it is a coin toss that happens to be quiet.
 */
function winsOver(a: FeatureObservation, b: FeatureObservation): boolean {
  if (a.extractedAt !== b.extractedAt) return a.extractedAt > b.extractedAt
  if (a.sourceDocumentId !== b.sourceDocumentId) return a.sourceDocumentId < b.sourceDocumentId
  return locatorKey(a.locator) < locatorKey(b.locator)
}

/**
 * How to read an absence, given only what was knowable at the as-of instant.
 *
 * This function never sees the withheld observations, and that is the point: if it did, it
 * could produce a state that distinguishes "nothing was there" from "something arrived later",
 * and that distinction is post-decision knowledge. See the note on `FEATURE_AVAILABILITY`.
 */
function resolveAbsence(
  def: FeatureDefinition,
  at: number,
): { availability: UnavailableFeatureValue['availability']; why: string; whatWouldResolveIt: string } {
  const pub = def.publication
  if (pub.kind === 'from' && at < pub.startMs) {
    return {
      availability: 'not_yet_published',
      why:
        `The publisher started carrying this value at ${isoOf(pub.startMs)}, which is after the ` +
        `as-of instant ${isoOf(at)}. Its absence here is a fact about the calendar, not about this item. ` +
        pub.note,
      whatWouldResolveIt:
        'Nothing about this item resolves it. Only an as-of instant at or after ' +
        `${isoOf(pub.startMs)} can carry this feature. Do not read this absence as a property of the item ` +
        'and do not impute a value for it.',
    }
  }
  if (pub.kind === 'unknown') {
    return {
      availability: 'unknown_publication_window',
      why:
        'No observation was recorded at or before the as-of instant, and the date this publisher started ' +
        'carrying the value is not established, so the absence cannot be attributed to the calendar or to ' +
        `the item. ${pub.note}`,
      whatWouldResolveIt:
        'Establish and record the date the publisher started carrying this value, from primary text, then ' +
        're-run this feature set. Until then the absence is unattributable and must not be scored.',
    }
  }
  return {
    availability: 'absent',
    why:
      `The publisher could have carried this value at the as-of instant ${isoOf(at)} and no observation ` +
      `was recorded. ${pub.note}`,
    whatWouldResolveIt: def.whatWouldResolveAbsence,
  }
}

/**
 * THE ONE LEGAL PATH TO A FEATURE VALUE. Every value it returns answers "what was true on the
 * date we decided", never "what is true now".
 *
 * `at` is an explicit epoch-ms instant rather than a clock read, so training, serving and
 * backtest are literally the same call with a different argument, and so this file has no
 * wall-clock dependency to make a historical replay unreproducible.
 *
 * Throws only on a caller error (a non-finite `at`, a registry with the same feature twice).
 * Bad DATA never throws: it becomes a refusal, a withholding or a data gap, because a scoring
 * run that dies on one malformed row is a worse instrument than one that reports honestly on
 * the rows it could read.
 */
export async function featuresAsOf(
  entity: FeatureEntity,
  at: number,
  ctx: FeatureContext,
  source: FeatureSource,
): Promise<FeatureSet> {
  if (!Number.isFinite(at)) {
    throw new RangeError('featuresAsOf: `at` must be a finite epoch-ms instant')
  }

  const definitions = await source.definitions(entity, ctx)
  const observations = await source.observations(entity, ctx)

  const byName = new Map<string, FeatureDefinition>()
  for (const def of definitions) {
    if (byName.has(def.name)) {
      throw new Error(`featuresAsOf: feature "${def.name}" is registered twice`)
    }
    byName.set(def.name, def)
  }

  const withheld: WithheldObservation[] = []
  const refused: RefusedObservation[] = []
  const admitted = new Map<string, FeatureObservation>()

  for (const raw of observations) {
    const parsed = OBSERVATION_SCHEMA.safeParse(raw)
    if (!parsed.success) {
      // The refusal record names the feature and the reason and never the value. A refused row
      // may be a post-as-of row, and an audit line that quoted its value would leak it.
      const name =
        raw && typeof raw === 'object' && typeof (raw as { feature?: unknown }).feature === 'string'
          ? (raw as { feature: string }).feature
          : '(unreadable observation)'
      refused.push({ feature: name, reason: 'malformed_observation' })
      continue
    }
    const obs: FeatureObservation = parsed.data

    // ---- THE FIREWALL. First gate, before anything else can look at this row. ----
    if (!isVisibleAsOf(obs.extractedAt, at)) {
      withheld.push({
        feature: obs.feature,
        sourceDocumentId: obs.sourceDocumentId,
        extractedAt: obs.extractedAt,
      })
      continue
    }

    const def = byName.get(obs.feature)
    if (!def) {
      refused.push({ feature: obs.feature, reason: 'unregistered_feature' })
      continue
    }
    if (obs.entityKind !== entity.kind || obs.entityId !== entity.id) {
      refused.push({ feature: obs.feature, reason: 'entity_mismatch' })
      continue
    }
    if (obs.orgId !== ctx.orgId) {
      refused.push({ feature: obs.feature, reason: 'org_mismatch' })
      continue
    }
    if (def.allowedValues && !def.allowedValues.includes(obs.value)) {
      refused.push({ feature: obs.feature, reason: 'value_not_in_allowed_set' })
      continue
    }

    const incumbent = admitted.get(obs.feature)
    if (!incumbent || winsOver(obs, incumbent)) admitted.set(obs.feature, obs)
  }

  const values: FeatureValue[] = []
  const dataGaps: DataGap[] = []

  // Definition order, not source order, so the output is byte-identical across two runs that
  // received the same rows in a different sequence.
  const names = [...byName.keys()].sort(compareStrings)
  for (const name of names) {
    const def = byName.get(name)
    if (!def) continue
    const winner = admitted.get(name)
    if (winner) {
      const value: AvailableFeatureValue = {
        feature: name,
        availability: 'available',
        value: winner.value,
        sourceDocumentId: winner.sourceDocumentId,
        locator: winner.locator,
        extractedAt: winner.extractedAt,
        asOf: at,
        grade: winner.grade,
      }
      values.push(value)
      continue
    }
    const absence = resolveAbsence(def, at)
    values.push({ feature: name, availability: absence.availability, asOf: at, why: absence.why })
    dataGaps.push({ field: name, why: absence.why, whatWouldResolveIt: absence.whatWouldResolveIt })
  }

  withheld.sort(
    (a, b) =>
      compareStrings(a.feature, b.feature) ||
      a.extractedAt - b.extractedAt ||
      compareStrings(a.sourceDocumentId, b.sourceDocumentId),
  )
  refused.sort(
    (a, b) => compareStrings(a.feature, b.feature) || compareStrings(a.reason, b.reason),
  )

  return {
    entity: { kind: entity.kind, id: entity.id },
    orgId: ctx.orgId,
    asOf: at,
    values,
    dataGaps,
    withheldByAsOf: withheld,
    refused,
  }
}

/**
 * THE LEAKAGE CANARY (acceptance gate R3.6). Fails loudly when a feature set contains anything
 * that could not have been known at the instant it claims to answer for.
 *
 * It exists because `featuresAsOf` being correct today is not the property that matters. The
 * property that matters is that a set built by ANY other means, a hand-assembled fixture, a
 * cached row from a different day, a well-meaning second path somebody adds next quarter, gets
 * caught before it teaches a model the future. So the canary validates the ARTIFACT and not the
 * function, and it reports `checked` on its face: a green result over zero inspected values is
 * a probe that never landed, not a clean bill of health.
 */
export function detectLeakage(featureSet: FeatureSet, at: number): LeakageReport {
  const violations: LeakageViolation[] = []

  if (featureSet.asOf !== at) {
    violations.push({
      kind: 'set_as_of_mismatch',
      setAsOf: featureSet.asOf,
      requestedAsOf: at,
      sentence:
        `This feature set answers for ${isoOf(featureSet.asOf)} and it is being validated against ` +
        `${isoOf(at)}. A set built for a different instant answers a different question, so it cannot ` +
        'be cleared for this one.',
    })
  }

  let checked = 0
  for (const value of featureSet.values) {
    if (value.availability !== 'available') continue
    checked += 1
    if (isVisibleAsOf(value.extractedAt, at)) continue
    violations.push({
      kind: 'value_extracted_after_as_of',
      feature: value.feature,
      sourceDocumentId: value.sourceDocumentId,
      extractedAt: value.extractedAt,
      latenessMs: Number.isFinite(value.extractedAt) ? value.extractedAt - at : Number.NaN,
      sentence:
        `Feature "${value.feature}" carries a value extracted at ${isoOf(value.extractedAt)}, after the ` +
        `as-of instant ${isoOf(at)}. It was not knowable at the moment of decision and must not score.`,
    })
  }

  return { clean: violations.length === 0, asOf: at, checked, violations }
}

/** Reads one feature out of an already-firewalled set. Returns undefined for an unregistered name. */
export function featureValue(featureSet: FeatureSet, feature: string): FeatureValue | undefined {
  return featureSet.values.find((v) => v.feature === feature)
}

/**
 * The manufacturer versus dealer classification, read with `unknown` as the default a row holds
 * until evidence says otherwise.
 *
 * Every path that is not an explicit, in-window, allowed observation returns `unknown`. That
 * includes an absent feature, a withheld one and a value the registry refused. It is NEVER
 * imputed from small-business status: an "approved small-business source" can be a
 * manufacturer's pass-through shell holding no shelf and adding 20 to 30 percent
 * (`HANDOFFS/T3-ENGINE.md:264`), so reading that row as physical availability would be a
 * fabricated readiness finding. T4 consumes this field and asked for the explicit `unknown`.
 */
export function sourceClassOf(featureSet: FeatureSet): SourceClass {
  const value = featureValue(featureSet, SOURCE_CLASS_FEATURE)
  if (!value || value.availability !== 'available') return SOURCE_CLASS_DEFAULT
  const raw = value.value
  if (raw === 'manufacturer' || raw === 'dealer') return raw
  return SOURCE_CLASS_DEFAULT
}
