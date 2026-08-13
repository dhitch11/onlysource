/**
 * THE DATED CONFIGURATION, plus the integer money primitives every other file in this
 * package computes with.
 *
 * WHY EVERY THRESHOLD IS DATED AND NONE IS A CONSTANT AT A CALL SITE.
 * This engine reasons over decades of price history. A 2011 award sat under a $3,000
 * micro-purchase threshold, a 2019 award under $10,000. A rule that asks "was this a
 * micro-purchase" must answer against the threshold in force on the AWARD date, not
 * today's. Hardcoding today's figure into historical analysis does not fail loudly, it
 * silently misclassifies a large slice of the corpus, and every Fast Auto and set-aside
 * band that keys off the threshold rots with it. So every figure here is an entry in a
 * dated series, resolved at an explicit instant by `resolveThreshold`.
 *
 * WHY THE SERIES ABSTAINS INSTEAD OF EXTRAPOLATING BACKWARD.
 * `inForceFromMs` means: the earliest instant at which the primary text we have actually
 * read establishes this value was in force. The value may well have been in force earlier.
 * The series does not guess, so a query before the first dated entry returns an explicit
 * abstention rather than a number nobody can cite. An honest "we cannot date this" is a
 * shippable answer; a confidently wrong band on a 2011 award is not.
 *
 * WHY $15,000 AND $20,000 ARE ABSENT, STATED PLAINLY SO NOBODY RE-ADDS THEM.
 *   $20,000: repeated across the SMI/SBAIC advocacy documents with NO primary-text backing
 *     anywhere in this corpus (05-intelligence/10-policy-and-market-corpus.md:50). Never quote it.
 *   $15,000: 03-findings/research/dla-procurement-mechanics.md:172-195 reports FAR 2.101 at
 *     $15,000, raised from $10,000 effective 2025-10-01, and that file itself marks the
 *     effective date REPORTED, not verified, because the Federal Register document was not
 *     retrievable. The domain expert independently reports the same move in his 10-30 notes.
 *     Two reports of a move are corroboration that this value SHIFTS, which is the argument
 *     for the dated series, and they are not license to hardcode the new figure: the cited
 *     primary text this package carries is 85 FR 40064 at $10,000. When the Federal Register
 *     text is read directly, the fix is a new dated ENTRY here with its own citation, not an
 *     edit to a number at a call site.
 *   The mechanical consequence is deliberate: `laterAmendmentsUnverified` goes true for any
 *   instant after `primaryTextReadThroughMs`, so a caller pricing something today is told the
 *   config may be behind the FAR rather than being handed a stale number in silence.
 */

/** How strong the evidence behind a single figure is. Never inferred, always declared. */
export type EvidenceGrade =
  /** Quoted from the regulation, the Federal Register, or the solicitation itself. */
  | 'PRIMARY_TEXT'
  /** A commentator reported it and the primary text has not been read. */
  | 'SECONDARY_REPORTED'
  /** The domain expert stated it in the corpus. His judgement, not a published series. */
  | 'CORPUS_STATED'
  /** Arithmetic on a corpus figure. Printed nowhere. Never presentable as a source figure. */
  | 'DERIVED'

export type SourceCitation = {
  readonly authority: string
  readonly quote: string | null
  readonly sourceFile: string
  readonly sourceLines: string
  readonly grade: EvidenceGrade
}

export type DatedEntry<T> = {
  readonly value: T
  /** Earliest instant the primary text we read proves this was in force. Not a guess. */
  readonly inForceFromMs: number
  /** Exclusive. Null means: no superseding entry has been read from primary text. */
  readonly inForceUntilMs: number | null
  readonly citation: SourceCitation
}

export type DatedSeries<T> = {
  readonly key: string
  readonly unit: 'usd_cents' | 'ratio'
  readonly entries: readonly DatedEntry<T>[]
  /** The instant through which this series' primary text has actually been read. */
  readonly primaryTextReadThroughMs: number
  readonly readThroughNote: string
}

export type ResolvedThreshold<T> = {
  readonly resolved: true
  readonly key: string
  readonly value: T
  readonly entry: DatedEntry<T>
  readonly atInstantMs: number
  /** True when the caller asked about an instant past the end of our primary-text read. */
  readonly laterAmendmentsUnverified: boolean
  readonly stalenessNote: string | null
}

export type ThresholdAbstention = {
  readonly resolved: false
  readonly key: string
  readonly atInstantMs: number
  readonly reason: 'NO_ENTRY_IN_FORCE_AT_INSTANT'
  readonly detail: string
}

export type ThresholdResolution<T> = ResolvedThreshold<T> | ThresholdAbstention

/**
 * Selects the value in force at a given instant, because historical analysis must evaluate
 * against the threshold of its own era. Abstains rather than extrapolating past either end
 * of the dated evidence.
 */
export function resolveThreshold<T>(
  config: DatedSeries<T>,
  atInstantMs: number,
): ThresholdResolution<T> {
  const found = config.entries.find(
    (e) =>
      atInstantMs >= e.inForceFromMs &&
      (e.inForceUntilMs === null || atInstantMs < e.inForceUntilMs),
  )
  if (!found) {
    return {
      resolved: false,
      key: config.key,
      atInstantMs,
      reason: 'NO_ENTRY_IN_FORCE_AT_INSTANT',
      detail:
        `No dated entry for ${config.key} covers ${new Date(atInstantMs).toISOString()}. ` +
        'The series carries only instants the primary text on file can date, and it does ' +
        'not extrapolate a value backward into an era it cannot cite.',
    }
  }
  const past = atInstantMs > config.primaryTextReadThroughMs
  return {
    resolved: true,
    key: config.key,
    value: found.value,
    entry: found,
    atInstantMs,
    laterAmendmentsUnverified: past,
    stalenessNote: past
      ? `Primary text for ${config.key} has been read through ` +
        `${new Date(config.primaryTextReadThroughMs).toISOString()}. The requested instant is ` +
        'later, so an amendment after that date would not be reflected here. Re-verify the ' +
        'controlling text before quoting this figure externally.'
      : null,
  }
}

/* ------------------------------------------------------------------------------------- *
 * MONEY PRIMITIVES
 *
 * All money math runs in integer cents with factors scaled to integers, because the binary
 * representation error is not theoretical here: 0.5 x 2152.99 evaluates to 1076.4949999999
 * in IEEE 754, which rounds to $1,076.49 and is a cent short of the true $1,076.50. A cent
 * of drift on a surface whose whole purpose is defending a price to a contracting officer
 * is a defect, so the arithmetic never leaves integer space until the last division.
 * ------------------------------------------------------------------------------------- */

/** Factors are carried to six decimal places. The corpus factors carry four. */
export const FACTOR_SCALE = 1_000_000

/** Dollars in, integer cents out, so a float never reaches the arithmetic. */
export function usdToCents(usd: number): number {
  return Math.round(usd * 100)
}

export function centsToUsd(cents: number): number {
  return cents / 100
}

/** Half away from zero, the convention a human checking the arithmetic by hand expects. */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

export type FactorApplication = {
  /** Unrounded product in cents. Kept so the exact figure can be shown beside the rounded one. */
  readonly exactCents: number
  readonly roundedCents: number
  /** The factor actually used after scaling, so a caller can see what was applied. */
  readonly factorApplied: number
}

/**
 * Multiplies integer cents by a decimal factor without leaving integer space, which is what
 * keeps the anchor arithmetic reproducible to the cent by hand.
 */
export function applyFactorToCents(cents: number, factor: number): FactorApplication {
  const scaled = Math.round(factor * FACTOR_SCALE)
  const exactCents = (cents * scaled) / FACTOR_SCALE
  return { exactCents, roundedCents: roundHalfUp(exactCents), factorApplied: scaled / FACTOR_SCALE }
}

/* ------------------------------------------------------------------------------------- *
 * THE DATED SERIES THEMSELVES
 * ------------------------------------------------------------------------------------- */

const FAR_2_101_AS_AMENDED: SourceCitation = {
  authority: 'FAR 2.101 as amended by 85 FR 40064 (FAC 2020-07, FAR Case 2018-004)',
  quote:
    "In the definition 'Micro-purchase threshold' removing from the introductory text " +
    "'$3,500' and adding '$10,000' in its place... In the definition 'Simplified acquisition " +
    "threshold' removing from the introductory text '$150,000' and adding '$250,000' in its place.",
  sourceFile: '/Users/user/project-x/05-intelligence/10-policy-and-market-corpus.md',
  sourceLines: '45-48',
  grade: 'PRIMARY_TEXT',
}

const MASTER_SOLICITATION_3B_SURPLUS: SourceCitation = {
  authority:
    'DLA Master Solicitation Rev 104, Part I para 3(b)(1); corroborated by DLAD 11.390(b)(1) ' +
    'and procurement note M05 (SEP 2016), current in DLAD Rev 5, January 12 2026',
  quote: '$200 for offers of surplus for unused former Government surplus material.',
  sourceFile: '/Users/user/project-x/03-findings/research/dla-procurement-mechanics.md',
  sourceLines: '357 (corroboration at 363-370)',
  grade: 'PRIMARY_TEXT',
}

const MASTER_SOLICITATION_3B_ESA: SourceCitation = {
  authority:
    'DLA Master Solicitation Rev 104, Part I para 3(b)(2); corroborated by procurement note ' +
    'M05 (SEP 2016), current in DLAD Rev 5, January 12 2026',
  quote:
    '$600 for CSI evaluations of surplus by each ESA. The evaluation factor may be applied ' +
    'if the contracting office cannot determine acceptability of quotations for other than ' +
    'CSI items and requires ESA coordination.',
  sourceFile: '/Users/user/project-x/03-findings/research/dla-procurement-mechanics.md',
  sourceLines: '358 (corroboration at 363-370)',
  grade: 'PRIMARY_TEXT',
}

const DLAD_17_7505: SourceCitation = {
  authority: 'DLAD 17.7505 "Limitations on price increases", current in DLAD Rev 5 (January 2026)',
  quote:
    'an increase of 25% or more over the most recent 12-month period. (2) The threshold ' +
    'percentage increase for procurements valued under the micro-purchase threshold is 51 percent.',
  sourceFile: '/Users/user/project-x/03-findings/research/dla-procurement-mechanics.md',
  sourceLines: '569-570',
  grade: 'PRIMARY_TEXT',
}

/**
 * 2020-08-31, the effective date carried on the 85 FR 40064 amendment. Everything before it
 * abstains: this package has read no primary text for the $3,500 era or the $3,000 era, and
 * inventing their effective dates to widen coverage is the exact fabrication it exists to stop.
 */
const MPT_10K_EFFECTIVE_MS = Date.UTC(2020, 7, 31)

/**
 * THE 2025 INFLATION ADJUSTMENT. 2025-10-01, when MPT moved $10,000 -> $15,000 and SAT moved
 * $250,000 -> $350,000.
 *
 * THE TWO HALVES OF THIS FACT CARRY DIFFERENT GRADES AND MUST NOT BE COLLAPSED. The research file
 * grades them separately and explicitly at dla-procurement-mechanics.md:1087: "VERIFIED (FAR 2.101)
 * / REPORTED (effective date)."
 *   THE VALUE is VERIFIED. dla-procurement-mechanics.md:172-186 block-quotes the FAR 2.101
 *   definition from FAC 2026-01 (effective 2026-03-13) reading "$15,000", and the SAT definition
 *   reading "$350,000". That is the regulation's own text, not a commentator's summary.
 *   THE START DATE is REPORTED. The Federal Register document was not retrievable (the site
 *   302-redirected to an interstitial). It is attributed to FAR Case 2024-001, published
 *   2025-08-27, issued through FAC 2025-06, and reported by four named firms.
 *
 * SO: any instant on or after 2026-03-13 rests on VERIFIED regulation text alone and needs the
 * reported date not at all. Instants between 2025-10-01 and 2026-03-13 rest on the REPORTED
 * boundary, and a caller that cares about that window should read the entry's citation.
 *
 * WHY THE PREVIOUS SHAPE WAS WRONG, recorded because it is the more instructive half. This series
 * carried ONE entry, $10,000, with inForceUntilMs null, so it extrapolated a 2020 figure forward
 * forever and resolved $10,000 as in force today. The module header promises the series "does not
 * guess" and abstains rather than extrapolating past the dated evidence, but it only abstained
 * BACKWARD. Forward it guessed silently, and a soft laterAmendmentsUnverified flag on a wrong
 * number is not an abstention. The prior note dismissed both sources for the move as non-primary,
 * which took the weaker of the two grades and applied it to both halves. That is the same
 * blanket-hedge error the award clock already had to correct in the other direction.
 */
const THRESHOLD_2025_ADJUSTMENT_MS = Date.UTC(2025, 9, 1)

/**
 * The FAR text as it reads TODAY. Graded PRIMARY_TEXT for the VALUES, which are block-quoted from
 * the regulation. The authority string carries the effective date's weaker REPORTED grade on its
 * face so a reader cannot take one for the other.
 */
const FAR_2_101_CURRENT: SourceCitation = {
  authority:
    'FAR 2.101 (FAC 2026-01, effective 03/13/2026), quoted definitions. VALUE VERIFIED from the ' +
    'regulation text. EFFECTIVE DATE 2025-10-01 is REPORTED only: attributed to FAR Case 2024-001 ' +
    '"Inflation Adjustment of Acquisition-Related Thresholds", published 2025-08-27, issued through ' +
    'FAC 2025-06, Federal Register text NOT retrievable, reported by Pillsbury, Redstone GCI, ' +
    'Centre Law and SmallGovCon. Instants on or after 2026-03-13 do not depend on that date.',
  quote:
    'Micro-purchase threshold means "$15,000, except it means (1) For acquisitions of construction ' +
    'subject to 40 U.S.C. chapter 31, subchapter IV, $2,000..." Simplified acquisition threshold ' +
    'means "$350,000, except for (1) Acquisitions ... to support a contingency operation..."',
  sourceFile: '/Users/user/project-x/03-findings/research/dla-procurement-mechanics.md',
  sourceLines: '172-186 (grading at 1087)',
  grade: 'PRIMARY_TEXT',
}

/**
 * Procurement note M05 is dated SEP 2016 on its face. The note gives month precision only,
 * so the first of that month is the earliest instant it can be dated to.
 */
const M05_EFFECTIVE_MS = Date.UTC(2016, 8, 1)

/**
 * DLAD Rev 5, January 12 2026, the revision whose text was read. 17.7505 was near certainly
 * in force well before this, and no read source dates its start, so the series says only what
 * it can prove: in force on this date. A pre-2026 procurement resolves to an abstention and
 * the caller is told why, rather than being handed a band nobody can cite for its era.
 */
const DLAD_REV5_MS = Date.UTC(2026, 0, 12)

export const MICRO_PURCHASE_THRESHOLD: DatedSeries<number> = {
  key: 'micro_purchase_threshold',
  unit: 'usd_cents',
  entries: [
    {
      value: 1_000_000,
      inForceFromMs: MPT_10K_EFFECTIVE_MS,
      inForceUntilMs: THRESHOLD_2025_ADJUSTMENT_MS,
      citation: FAR_2_101_AS_AMENDED,
    },
    {
      value: 1_500_000,
      inForceFromMs: THRESHOLD_2025_ADJUSTMENT_MS,
      inForceUntilMs: null,
      citation: FAR_2_101_CURRENT,
    },
  ],
  primaryTextReadThroughMs: THRESHOLD_2025_ADJUSTMENT_MS,
  readThroughNote:
    'Two dated entries, because the threshold moved and this series must be period-correct: ' +
    'historical analysis has to evaluate a procurement against the threshold in force on ITS ' +
    'award date, not against today. $10,000 from 85 FR 40064 (2020-08-31), $15,000 from the ' +
    'reported 2025-10-01 adjustment. The $15,000 VALUE is block-quoted FAR 2.101 text from ' +
    'FAC 2026-01 and is VERIFIED; only the 2025-10-01 boundary is REPORTED, and instants on or ' +
    'after FAC 2026-01 (2026-03-13) do not rest on that boundary at all.',
}

export const SIMPLIFIED_ACQUISITION_THRESHOLD: DatedSeries<number> = {
  key: 'simplified_acquisition_threshold',
  unit: 'usd_cents',
  entries: [
    {
      value: 25_000_000,
      inForceFromMs: MPT_10K_EFFECTIVE_MS,
      inForceUntilMs: THRESHOLD_2025_ADJUSTMENT_MS,
      citation: FAR_2_101_AS_AMENDED,
    },
    {
      value: 35_000_000,
      inForceFromMs: THRESHOLD_2025_ADJUSTMENT_MS,
      inForceUntilMs: null,
      citation: FAR_2_101_CURRENT,
    },
  ],
  primaryTextReadThroughMs: THRESHOLD_2025_ADJUSTMENT_MS,
  readThroughNote:
    'Same amendment and the same split grading as the MPT series: $250,000 from 85 FR 40064, ' +
    '$350,000 from the reported 2025-10-01 adjustment, with the VALUE block-quoted from FAR 2.101 ' +
    'as it reads in FAC 2026-01 and only the boundary date REPORTED.',
}

export const SURPLUS_EVALUATION_ADDER: DatedSeries<number> = {
  key: 'surplus_evaluation_adder',
  unit: 'usd_cents',
  entries: [
    {
      value: 20_000,
      inForceFromMs: M05_EFFECTIVE_MS,
      inForceUntilMs: null,
      citation: MASTER_SOLICITATION_3B_SURPLUS,
    },
  ],
  primaryTextReadThroughMs: DLAD_REV5_MS,
  readThroughNote: 'M05 confirmed still current in DLAD Rev 5, January 12 2026.',
}

export const ESA_COORDINATION_ADDER: DatedSeries<number> = {
  key: 'esa_coordination_adder',
  unit: 'usd_cents',
  entries: [
    {
      value: 60_000,
      inForceFromMs: M05_EFFECTIVE_MS,
      inForceUntilMs: null,
      citation: MASTER_SOLICITATION_3B_ESA,
    },
  ],
  primaryTextReadThroughMs: DLAD_REV5_MS,
  readThroughNote: 'M05 confirmed still current in DLAD Rev 5, January 12 2026. Applied per ESA.',
}

export const TRIPWIRE_AT_OR_ABOVE_MPT: DatedSeries<number> = {
  key: 'tripwire_band_at_or_above_mpt',
  unit: 'ratio',
  entries: [
    { value: 0.25, inForceFromMs: DLAD_REV5_MS, inForceUntilMs: null, citation: DLAD_17_7505 },
  ],
  primaryTextReadThroughMs: DLAD_REV5_MS,
  readThroughNote: 'DLAD Rev 5, January 12 2026 is the revision read. No earlier revision was read.',
}

export const TRIPWIRE_UNDER_MPT: DatedSeries<number> = {
  key: 'tripwire_band_under_mpt',
  unit: 'ratio',
  entries: [
    { value: 0.51, inForceFromMs: DLAD_REV5_MS, inForceUntilMs: null, citation: DLAD_17_7505 },
  ],
  primaryTextReadThroughMs: DLAD_REV5_MS,
  readThroughNote: 'DLAD Rev 5, January 12 2026 is the revision read. No earlier revision was read.',
}

/**
 * The whole dated configuration as one object, so a call site takes the config it was given
 * rather than reaching for a module-level constant and quietly pinning itself to one era.
 */
export type PricingConfig = {
  readonly microPurchaseThreshold: DatedSeries<number>
  readonly simplifiedAcquisitionThreshold: DatedSeries<number>
  readonly surplusEvaluationAdder: DatedSeries<number>
  readonly esaCoordinationAdder: DatedSeries<number>
  readonly tripwireAtOrAboveMpt: DatedSeries<number>
  readonly tripwireUnderMpt: DatedSeries<number>
}

export const PRICING_CONFIG: PricingConfig = {
  microPurchaseThreshold: MICRO_PURCHASE_THRESHOLD,
  simplifiedAcquisitionThreshold: SIMPLIFIED_ACQUISITION_THRESHOLD,
  surplusEvaluationAdder: SURPLUS_EVALUATION_ADDER,
  esaCoordinationAdder: ESA_COORDINATION_ADDER,
  tripwireAtOrAboveMpt: TRIPWIRE_AT_OR_ABOVE_MPT,
  tripwireUnderMpt: TRIPWIRE_UNDER_MPT,
}
