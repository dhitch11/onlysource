/**
 * THE EVIDENCE CONTRACT. Written before any screen exists, because if the screens go first
 * the evidence gets retrofitted as a tooltip and this lane has failed quietly.
 *
 * Every one of the five intelligence surfaces emits the SAME envelope: the monopoly map,
 * the interchangeability multiplier, the capability match, the blueprint asset list, and
 * the shelf. One shared spine, one shared envelope, one shared as-of function.
 *
 * ---------------------------------------------------------------------------------------
 * THE TWO LAWS THIS FILE IS THE COMPLIANCE FOR
 * ---------------------------------------------------------------------------------------
 * Law 1, nothing fabricated and nothing silently defaulted. Every field here traces to a
 * catalog record or to a named honest state. A claim with no supporting rows cannot be
 * constructed at all: `sealClaim` throws, and `abstain` is the only way out. That is
 * deliberate. An abstention is a shippable answer and a guess is not.
 *
 * Law 8, trust is a two-way instrument. Every envelope carries an overturn action that
 * writes a label, and every figure that moved since it was last seen carries WHY it moved.
 * The principal never sees a changed monopoly count or a revalued position without a cause.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE
 * ---------------------------------------------------------------------------------------
 * No probability, no blended score, no confidence percentage. The evidence class is an
 * ordered vocabulary a human ranks at a glance, not a number that invites trust it has not
 * earned. If you find yourself adding a `confidence: number` field, stop: the charter's
 * failure list names that as the tell of a system that is guessing.
 */

/* ------------------------------------------------------------------------------------ */
/* THE CLOSED VOCABULARIES. Three lanes render or act on these. Changing one is a         */
/* claims-file post, never a local edit.                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * Evidence class, ordered strongest to weakest. Rendered with distinct visual weight by T8.
 * Never let two surfaces use different words for the same strength.
 */
export const EVIDENCE_CLASSES = [
  'conclusive',
  'near_conclusive',
  'strong_lead',
  'weak_lead',
  'context_only',
] as const

export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number]

/** 0 is strongest. Used for the shelf's adjustable evidence floor and for sort order. */
export function evidenceRank(cls: EvidenceClass): number {
  return EVIDENCE_CLASSES.indexOf(cls)
}

/** True when `cls` is at least as strong as `floor`. The shelf's floor control uses this. */
export function atOrAboveClass(cls: EvidenceClass, floor: EvidenceClass): boolean {
  return evidenceRank(cls) <= evidenceRank(floor)
}

/**
 * Verdict vocabulary, closed. T3 renders these on the board, T5 acts on them, T8 designs
 * them. `INSUFFICIENT_DATA` is a real, common, non-embarrassing outcome and its rate is
 * instrumented per surface. A vocabulary with no abstention in it is a system guessing.
 */
export const VERDICTS = [
  'IDENTICAL',
  'CONFIRM_WITH_EXCEPTIONS',
  'INSUFFICIENT_DATA',
  'CONFLICT',
] as const

export type Verdict = (typeof VERDICTS)[number]

/**
 * The five equivalence candidate generators. CLOSED SET, enforced by test.
 *
 * Characteristic adjudication is Stage 2 of the Multiplier, a judgment OVER a candidate.
 * It is not a generator and it must never appear in this list or in the generator column.
 */
export const EQUIVALENCE_GENERATORS = [
  'recorded_interchangeability',
  'same_source_identity',
  'cross_company_collision',
  'weak_reference_overlap',
  'name_class_adjacency',
] as const

export type EquivalenceGenerator = (typeof EQUIVALENCE_GENERATORS)[number]

/**
 * The other surfaces are not produced by the equivalence generators, and pretending a
 * monopoly row came from `same_source_identity` would be a lie in the generator column.
 * So each surface carries its own closed set of NAMED RULES. The rule name is what appears
 * in the interface. It is never "the model" and never blank.
 *
 * Posted to the claims file as an extension, not a change: the equivalence set is still
 * exactly the charter's five and `test/intelligence/evidence.test.ts` fails if it is not.
 */
export const MONOPOLY_RULES = [
  'dead_source_live_demand',
  'sole_source_thin_availability',
  'surplus_corner_cross',
] as const

export const CAPABILITY_RULES = [
  'approved_source_item_level',
  'award_history_class_level',
  'reverse_competitor_source',
] as const

export const BLUEPRINT_RULES = [
  'engineering_data_indicator',
  'governing_specification_reference',
  'item_identification_guide',
] as const

export const SHELF_RULES = ['held_position_fill_set', 'affiliate_held_position'] as const

export const RULE_NAMES = [
  ...EQUIVALENCE_GENERATORS,
  ...MONOPOLY_RULES,
  ...CAPABILITY_RULES,
  ...BLUEPRINT_RULES,
  ...SHELF_RULES,
] as const

export type RuleName = (typeof RULE_NAMES)[number]

export const SURFACES = [
  'monopoly',
  'equivalence',
  'capability',
  'reverse',
  'blueprint',
  'shelf',
] as const

export type Surface = (typeof SURFACES)[number]

/**
 * Provenance, R1's one axis with exactly three glyph states. Never a fourth.
 * `measured` came off a catalog record. `modeled` came out of arithmetic over records with
 * a stated method. `insufficient` is the honest empty state.
 */
export const PROVENANCE_STATES = ['measured', 'modeled', 'insufficient'] as const
export type Provenance = (typeof PROVENANCE_STATES)[number]

/**
 * Confirmation is an ORTHOGONAL overlay to provenance, not a fourth glyph. Anything a voice
 * transcript produced starts UNCONFIRMED and stays there until a human accepts it.
 * Transcripts are attacker text.
 */
export const CONFIRMATION_STATES = ['CONFIRMED', 'UNCONFIRMED'] as const
export type ConfirmationState = (typeof CONFIRMATION_STATES)[number]

/** Why a figure moved since it was last seen. Law 8 requires this on the row and the alert. */
export const DELTA_CAUSES = ['data_arrived', 'model_changed', 'rule_changed'] as const
export type DeltaCause = (typeof DELTA_CAUSES)[number]

/* ------------------------------------------------------------------------------------ */
/* THE ENVELOPE                                                                           */
/* ------------------------------------------------------------------------------------ */

/**
 * A literal catalog record, with its codes, that a human can read. Not a summary of one.
 * Rendered monospace, copyable, never silently truncated (S-MM.3, J7.10).
 *
 * `table` and `fields` use the government's own column names on purpose. The principal
 * checks our claim against forty years of knowing what those columns mean, and a friendly
 * relabelling costs him that check.
 */
export type SupportingRow = {
  /** Government table the row came from, for example `V_FLIS_PART`. */
  table: string
  /** The row's own key, for example `{ NIIN: '015277013', CAGE_CODE: '04939' }`. */
  key: Record<string, string>
  /** The literal field values, government column names, nulls preserved as null. */
  fields: Record<string, string | null>
  /** When this row was observed in the source. S-MM.22 wants this per entry. */
  observedAt: string
}

/** Something the analysis needed and did not have. Named, never empty by omission. */
export type Gap = {
  /** What was missing, in the operator's vocabulary. */
  what: string
  /** Why it is missing: not loaded, not in the public extract, absent for this item. */
  why: string
  /**
   * TRUE when the gap is a public-extract exclusion rather than a real absence.
   * "Not in the public extract" and "does not exist" must render as different states.
   */
  restrictedNotAbsent: boolean
}

/**
 * The single fact that, if different, flips the verdict. This is the field the principal
 * actually uses, because the question an expert asks is not "why did you say this" but
 * "what would have made you not say it."
 *
 * Shape agreed with T3 so the principal sees one artifact and one grammar, not two.
 */
export type Counterfactual = {
  field: string
  currentValue: string
  flipValue: string
  resultingVerdict: string
}

/** A figure that changed since the principal last saw it, and why it changed. */
export type MovedFigure = {
  name: string
  previous: string
  current: string
  cause: DeltaCause
}

/** An external signal and the date it was observed. Every one of them, per S-MM.22. */
export type SignalObservation = {
  signal: string
  source: string
  observedAt: string
}

/**
 * One click, writes a record, and that record is a label. This is the only mechanism by
 * which the system keeps improving after the expert who seeded it stops answering email.
 */
export type OverturnAction = {
  /** What the overturn asserts, for example 'not a real monopoly'. */
  label: string
  /** The claim this overturn attaches to, so the label can be joined back to the row. */
  claimKey: string
  /** Reopened when the facts change. A no today is not a no forever (J6.37). */
  reevaluateOnChange: string[]
}

export type EvidenceEnvelope = {
  /** What is being asserted, in one sentence, in the operator's vocabulary. */
  claim: string
  surface: Surface
  /** The named rule that produced this. Never "the model", never blank. */
  generator: RuleName
  evidenceClass: EvidenceClass
  verdict: Verdict
  provenance: Provenance
  confirmationState: ConfirmationState
  supportingRows: SupportingRow[]
  gaps: Gap[]
  counterfactual: Counterfactual | null
  /** The as-of instant of the whole claim, ISO 8601. */
  asOf: string
  /** The observation date of every external signal inside the claim. */
  signals: SignalObservation[]
  movedFigures: MovedFigure[]
  overturn: OverturnAction
}

/* ------------------------------------------------------------------------------------ */
/* CONSTRUCTION, WHICH IS WHERE LAW 1 IS ENFORCED                                         */
/* ------------------------------------------------------------------------------------ */

export class EvidenceContractViolation extends Error {
  constructor(message: string) {
    super(`evidence contract: ${message}`)
    this.name = 'EvidenceContractViolation'
  }
}

export type SealClaimInput = Omit<EvidenceEnvelope, 'verdict' | 'provenance'> & {
  verdict: Exclude<Verdict, 'INSUFFICIENT_DATA'>
  provenance: Exclude<Provenance, 'insufficient'>
}

/**
 * The ONLY way to produce a non-abstaining envelope, and it refuses several times.
 *
 * Each refusal is a defect this lane is known to be one careless commit away from:
 *  - a claim with no supporting rows is a guess wearing an envelope
 *  - a verdict of INSUFFICIENT_DATA is not sealed, it is abstained, so the abstention
 *    instrument sees it
 *  - a conclusive class with no government-recorded row is the "rediscovered the
 *    government's own table and called it intelligence" failure inverted: asserting
 *    government authority we do not have
 *  - a moved figure with no cause is Law 8 broken
 */
export function sealClaim(input: SealClaimInput): EvidenceEnvelope {
  if (input.supportingRows.length === 0) {
    throw new EvidenceContractViolation(
      `claim "${input.claim}" has zero supporting rows. Use abstain() instead of asserting.`,
    )
  }
  if (input.claim.trim() === '') {
    throw new EvidenceContractViolation('claim sentence is empty')
  }
  for (const figure of input.movedFigures) {
    if (!DELTA_CAUSES.includes(figure.cause)) {
      throw new EvidenceContractViolation(
        `moved figure "${figure.name}" carries no valid delta cause`,
      )
    }
  }
  for (const row of input.supportingRows) {
    if (!row.observedAt) {
      throw new EvidenceContractViolation(
        `supporting row from ${row.table} carries no observation date`,
      )
    }
  }
  if (input.evidenceClass === 'conclusive' && !hasGovernmentRecordedRow(input.supportingRows)) {
    throw new EvidenceContractViolation(
      'conclusive is reserved for claims the government itself recorded. ' +
        'No V_FLIS_PHRASE, V_FLIS_STANDARDIZATION or V_FLIS_CANCELLED_NIIN row is present.',
    )
  }
  return { ...input, verdict: input.verdict, provenance: input.provenance }
}

/** The three tables that carry the government's own recorded relationships. */
const GOVERNMENT_RECORDED_TABLES = new Set([
  'V_FLIS_PHRASE',
  'V_FLIS_STANDARDIZATION',
  'V_FLIS_CANCELLED_NIIN',
])

function hasGovernmentRecordedRow(rows: SupportingRow[]): boolean {
  return rows.some((r) => GOVERNMENT_RECORDED_TABLES.has(r.table))
}

export type AbstainInput = {
  claim: string
  surface: Surface
  generator: RuleName
  /** Why the system will not answer. This is the text the operator reads. */
  reason: string
  reasonCode: AbstentionReasonCode
  gaps: Gap[]
  asOf: string
  signals?: SignalObservation[]
  /** Rows we DID have. An abstention with evidence still shows its evidence. */
  supportingRows?: SupportingRow[]
  overturn: OverturnAction
}

/**
 * The honest empty state, as a first-class constructible result rather than a fallback.
 * Abstaining is cheap and respected here on purpose. If it is expensive to express,
 * engineers stop doing it and start guessing.
 */
export function abstain(input: AbstainInput): EvidenceEnvelope {
  if (input.gaps.length === 0) {
    throw new EvidenceContractViolation(
      `abstention "${input.claim}" names no gap. An abstention with no named gap is a shrug.`,
    )
  }
  return {
    claim: input.claim,
    surface: input.surface,
    generator: input.generator,
    evidenceClass: 'context_only',
    verdict: 'INSUFFICIENT_DATA',
    provenance: 'insufficient',
    confirmationState: 'CONFIRMED',
    supportingRows: input.supportingRows ?? [],
    gaps: input.gaps,
    counterfactual: null,
    asOf: input.asOf,
    signals: input.signals ?? [],
    movedFigures: [],
    overturn: input.overturn,
  }
}

/* ------------------------------------------------------------------------------------ */
/* ABSTENTION REASON CODES. The instrument groups on these, so they are a closed set too. */
/* ------------------------------------------------------------------------------------ */

export const ABSTENTION_REASON_CODES = [
  /** No characteristics rows on one or both sides. */
  'no_shared_characteristics',
  /** Shared characteristics exist but fewer than the floor the surface requires. */
  'below_shared_attribute_floor',
  /** The company status could not be resolved, so death cannot be asserted (S-MM.5). */
  'source_status_unknown',
  /** No demand basis of any kind was observable. */
  'no_demand_basis',
  /** T3's price anchor was absent, so the position abstains on value. */
  'price_anchor_missing',
  /** The availability credential is absent, so the corner leg reads unknown. */
  'availability_unknown',
  /** No shop cleared the evidence bar for this item. */
  'no_capability_above_bar',
  /** The item is absent from the public extract, which is not absence from the world. */
  'not_in_public_extract',
  /** A voice-extracted fact that no human has accepted yet. */
  'unconfirmed_call_evidence',
] as const

export type AbstentionReasonCode = (typeof ABSTENTION_REASON_CODES)[number]

/* ------------------------------------------------------------------------------------ */
/* THE FIVE-QUESTION AFFORDANCE. Content lives with this lane, the component is T8's.     */
/* ------------------------------------------------------------------------------------ */

/**
 * On this lane there are five questions rather than three, because these surfaces make
 * claims that cost money. `whereFrom` and `whatWouldChange` are the two the principal
 * actually uses, and R9.4 lints for the fifth field on every score.
 */
export type SurfaceAffordance = {
  whatIsThis: string
  howDoIUseIt: string
  whyDoesItMatter: string
  whereDidThisComeFrom: string
  whatWouldChangeThisAnswer: string
  /** R9.4's fifth field. Stating the limit is how the tool earns the rest. */
  whatThisDoesNotDo: string
}

export type ColumnAffordance = {
  column: string
  /** One sentence, operator vocabulary, not the catalog's. */
  meaning: string
  /** The government column this is computed from, so the claim is checkable. */
  sourceColumn: string | null
}
