/**
 * T3 ENGINE. The feature vocabulary and the shapes an as-of read produces.
 *
 * This file holds NO domain facts. It holds no publication start date, no feature list and no
 * threshold. That is deliberate and it is the law-1 position: the engine owns the LOGIC of an
 * as-of read, and every fact about which features exist and when a publisher started carrying
 * one arrives through the injected `FeatureSource`, from a lane that can cite it. A date
 * hardcoded here would be a fabricated fact wearing an engine's clothes.
 *
 * WHY THE SHAPES ARE THIS SHAPE
 *
 * 1. Every feature value carries value, source document id, a span or field reference inside
 *    that source, `extractedAt` and `asOf` (`HANDOFFS/T3-ENGINE.md:332`). A number with no
 *    document behind it cannot be defended to a buyer, so the type refuses to hold one.
 *
 * 2. Unavailability is a CLOSED, NAMED vocabulary, never a null and never a zero. Absence is
 *    informative rather than missing at random (`HANDOFFS/T3-ENGINE.md:334`): losing-bid data
 *    has a start date on the tool that publishes it, so its absence on an older item tells you
 *    about the calendar and not about the item.
 *
 * 3. An unavailable value has NO `value` key at all. Not null, not zero, not an empty string.
 *    A nullable value field is an invitation to `?? 0`, and that single character is how an
 *    imputed number ships.
 *
 * All instants are epoch milliseconds, UTC. Field names are the camelCase of the score payload
 * contract posted to T4, T5, T6 and T8 in the claims file, so one rename never means two.
 */

/** The two things this product scores. Closed, because a third would need its own as-of story. */
export const ENTITY_KINDS = ['nsn', 'solicitation'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

export type FeatureEntity = {
  readonly kind: EntityKind
  readonly id: string
}

/** Everything the engine is allowed to know about who is asking. No request, no session, no db. */
export type FeatureContext = {
  readonly orgId: string
}

/**
 * The provenance grade travels WITH the value, because the label on a fact is part of the fact
 * and an ESTIMATED field laundered into a VERIFIED one is the failure the charter names by name.
 */
export const PROVENANCE_GRADES = ['VERIFIED', 'REPORTED', 'ESTIMATED', 'UNVERIFIED'] as const
export type ProvenanceGrade = (typeof PROVENANCE_GRADES)[number]

/**
 * Where inside the source document the value was read. A span for extracted text, a field
 * reference for a fixed-width or delimited record. One of the two is mandatory: "it came from
 * this document somewhere" is not a citation a person can check.
 */
export type SourceLocator =
  | { readonly kind: 'span'; readonly start: number; readonly end: number }
  | { readonly kind: 'field'; readonly field: string }

/** Features are scalars. A composite feature is two features, so each half keeps its own citation. */
export type FeatureScalar = string | number | boolean

/**
 * The availability vocabulary, CLOSED.
 *
 * `not_yet_published` and `absent` are the pair the charter demands be distinguishable: the
 * first is a fact about the calendar, the second is a fact about the item, and collapsing them
 * teaches a model that old items lack a property they merely predate.
 *
 * `unknown_publication_window` exists because the honest third answer is "we have not
 * established when this publisher started, so we cannot tell those two apart." Resolving that
 * case to `absent` would be an imputation, which is exactly what this module refuses to do.
 *
 * THERE IS DELIBERATELY NO STATE FOR "a value exists but was extracted after the as-of
 * instant." At the as-of instant that observation did not exist, so it must read identically to
 * having none: the knowledge that a value ARRIVES LATER is itself post-decision information,
 * and a state that reveals it would be a leak with a polite name. The exclusion is recorded in
 * `FeatureSet.withheldByAsOf` for audit, where scoring code has no reason to look.
 */
export const FEATURE_AVAILABILITY = [
  'available',
  'not_yet_published',
  'absent',
  'unknown_publication_window',
] as const
export type FeatureAvailability = (typeof FEATURE_AVAILABILITY)[number]

/**
 * MANUFACTURER VERSUS DEALER, with `unknown` as the DEFAULT a row holds until evidence says
 * otherwise. T4 asked for the explicit third value and this is it.
 *
 * It is never imputed from small-business status, and that is a correctness rule rather than a
 * nicety. A large manufacturer reaches set-aside dollars through an "approved small-business
 * source" that can be a pass-through shell holding no shelf, adding 20 to 30 percent
 * (`HANDOFFS/T3-ENGINE.md:264`). Reading such a row as physical availability is a fabricated
 * readiness finding, so the engine would rather say `unknown` than say something useful.
 */
export const SOURCE_CLASSES = ['manufacturer', 'dealer', 'unknown'] as const
export type SourceClass = (typeof SOURCE_CLASSES)[number]

/** One string for the classification feature, so four lanes cannot spell it four ways. */
export const SOURCE_CLASS_FEATURE = 'supplier_source_class'

/** What a row holds until evidence says otherwise. Exported so nobody re-picks a default. */
export const SOURCE_CLASS_DEFAULT: SourceClass = 'unknown'

/**
 * When the publisher of a feature became capable of carrying it. Supplied by the source, never
 * assumed here, and required on every definition so that omitting it is impossible rather than
 * merely discouraged.
 */
export type PublicationWindow =
  | { readonly kind: 'always'; readonly note: string }
  | { readonly kind: 'from'; readonly startMs: number; readonly note: string }
  | { readonly kind: 'unknown'; readonly note: string }

/**
 * A registered feature. A feature that is not registered cannot enter a feature set, which is
 * how an unreviewed column stops being one import away from a live score.
 */
export type FeatureDefinition = {
  readonly name: string
  readonly publication: PublicationWindow
  /** Present only for enum features. A value outside the set is refused, never coerced. */
  readonly allowedValues?: readonly FeatureScalar[]
  /** The task a human could do to turn a genuine absence into a value. Becomes the data gap. */
  readonly whatWouldResolveAbsence: string
}

/**
 * One raw observation as the source hands it over. `extractedAt` is when OUR pipeline read this
 * value out of that document, which is the only timestamp the firewall can honestly filter on.
 */
export type FeatureObservation = {
  readonly feature: string
  readonly entityKind: EntityKind
  readonly entityId: string
  readonly orgId: string
  readonly value: FeatureScalar
  readonly sourceDocumentId: string
  readonly locator: SourceLocator
  readonly extractedAt: number
  readonly grade: ProvenanceGrade
}

/**
 * THE PORT. An interface, so the engine imports no database client, and deliberately NOT given
 * the as-of instant.
 *
 * A port that knew `at` could filter on it, and then the firewall would have two homes: one
 * here and one in every adapter anyone ever writes. It would also hide its own mistakes, since
 * an adapter that filtered with the wrong comparison would look identical to a correct one from
 * inside the engine. So the port returns everything it holds for the entity and the engine does
 * the excluding, once, where a test can watch it.
 */
export type FeatureSource = {
  definitions(entity: FeatureEntity, ctx: FeatureContext): Promise<readonly FeatureDefinition[]>
  observations(entity: FeatureEntity, ctx: FeatureContext): Promise<readonly FeatureObservation[]>
}

/** A value we hold, with the citation that lets a person check it. */
export type AvailableFeatureValue = {
  readonly feature: string
  readonly availability: 'available'
  readonly value: FeatureScalar
  readonly sourceDocumentId: string
  readonly locator: SourceLocator
  readonly extractedAt: number
  readonly asOf: number
  readonly grade: ProvenanceGrade
}

/** A value we do not hold, saying WHICH KIND of not holding it this is. Carries no `value` key. */
export type UnavailableFeatureValue = {
  readonly feature: string
  readonly availability: Exclude<FeatureAvailability, 'available'>
  readonly asOf: number
  readonly why: string
}

export type FeatureValue = AvailableFeatureValue | UnavailableFeatureValue

/** The payload-contract data gap: what is missing and what would resolve it, never a zero. */
export type DataGap = {
  readonly field: string
  readonly why: string
  readonly whatWouldResolveIt: string
}

/**
 * The audit record of one firewall exclusion. It carries NO value, on purpose: an audit trail
 * that quoted the withheld number would be a leak with a paper trail.
 */
export type WithheldObservation = {
  readonly feature: string
  readonly sourceDocumentId: string
  readonly extractedAt: number
}

/** Why an observation was rejected outright. Closed, so an operator can alarm on each one. */
export const REFUSAL_REASONS = [
  'malformed_observation',
  'unregistered_feature',
  'entity_mismatch',
  'org_mismatch',
  'value_not_in_allowed_set',
] as const
export type RefusalReason = (typeof REFUSAL_REASONS)[number]

/** Also carries no value, for the same reason as `WithheldObservation`. */
export type RefusedObservation = {
  readonly feature: string
  readonly reason: RefusalReason
}

/**
 * The only legal container of feature values. Everything downstream (scorecard, reasons,
 * counterfactual, backtest) reads this and never the source.
 */
export type FeatureSet = {
  readonly entity: FeatureEntity
  readonly orgId: string
  /** The decision instant this set answers for. Every value in it was knowable at this instant. */
  readonly asOf: number
  readonly values: readonly FeatureValue[]
  readonly dataGaps: readonly DataGap[]
  readonly withheldByAsOf: readonly WithheldObservation[]
  readonly refused: readonly RefusedObservation[]
}

/** What the canary found. `checked` is on the face so a vacuous green is visible as a zero. */
export type LeakageReport = {
  readonly clean: boolean
  readonly asOf: number
  readonly checked: number
  readonly violations: readonly LeakageViolation[]
}

export type LeakageViolation =
  | {
      readonly kind: 'value_extracted_after_as_of'
      readonly feature: string
      readonly sourceDocumentId: string
      readonly extractedAt: number
      readonly latenessMs: number
      readonly sentence: string
    }
  | {
      readonly kind: 'set_as_of_mismatch'
      readonly setAsOf: number
      readonly requestedAsOf: number
      readonly sentence: string
    }
