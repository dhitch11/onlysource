/**
 * THE MONOPOLY MAP, and its manufacturer-side twin, the inversion.
 *
 * The shape in one sentence: every stock number whose approved manufacturing source has gone
 * inactive or deregistered, while demand for it continues.
 *
 * ---------------------------------------------------------------------------------------
 * THE RULE THAT MATTERS MORE THAN THE REST OF THE FILE
 * ---------------------------------------------------------------------------------------
 * An unresolved company status is NOT a dead one. `unknown` is a first-class rendered state
 * with its own weight, it is never silently counted as active or inactive, and any row whose
 * monopoly claim DEPENDS on an unknown is excluded from the headline count and banded
 * separately.
 *
 * The reason is not tidiness. An unknown counted as dead manufactures a monopoly that does
 * not exist, and the operator buys stock against it. That is real money lost to a default
 * value. So `headlineCount` and `total` are deliberately different numbers here, and the
 * interface is expected to show both.
 *
 * ---------------------------------------------------------------------------------------
 * TWO VIEWPORTS, ONE QUERY ENGINE
 * ---------------------------------------------------------------------------------------
 * The item view starts from a stock number and asks "is its source dead". The inversion
 * starts from a source and asks "which of its stock numbers still have live demand". Both
 * read the same approved-source mapping and the same status-with-date, so they share the
 * engine below rather than drifting into two implementations of one idea.
 */

import { readDealerEligibility, iscIndicatesDeadItem, type DealerEligibility } from './codebook'
import { parseSolicitation, type Cage, type Niin } from './niin'

/* ------------------------------------------------------------------------------------ */
/* STATUS. Six states, and the sixth is load-bearing.                                     */
/* ------------------------------------------------------------------------------------ */

export const SOURCE_STATUSES = [
  'active',
  'inactive',
  'merged',
  'acquired',
  'dissolved',
  'unknown',
] as const

export type SourceStatus = (typeof SOURCE_STATUSES)[number]

/** The statuses that support a claim that the source can no longer supply the item. */
const DEAD_STATUSES: readonly SourceStatus[] = ['inactive', 'dissolved']

/**
 * `merged` and `acquired` are deliberately NOT dead. A merged company's capability usually
 * survives inside the acquirer, and treating a merger as a death is the second most common
 * false positive on this surface after supersession.
 */
export function statusSupportsDeathClaim(status: SourceStatus): boolean {
  return DEAD_STATUSES.includes(status)
}

/**
 * How strong the inactivity determination is. "No award activity in five years" is not death
 * and must never render at the same weight as a dated deregistration.
 */
export type InactivityGrade = 'recorded_status' | 'registration_lapsed' | 'inferred_from_silence'

export type SourceStatusReading = {
  cage: Cage
  status: SourceStatus
  /** The date the STATUS was observed, not the date we ran. A claim about a night. */
  observedAt: string
  grade: InactivityGrade
  /** The literal evidence, for the panel. */
  evidence: Array<Record<string, string | null>>
}

/* ------------------------------------------------------------------------------------ */
/* DEMAND                                                                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * Which basis produced the demand signal. The map must never go dark because a credential is
 * missing; it says which basis it used, on every row.
 */
export const DEMAND_BASES = [
  /** The agency's own forward buy plan. Strongest, needs the credentialed application. */
  'vendor_forecast',
  /** Repeat solicitations observed in the free daily feed. Free, ships today. */
  'solicitation_recurrence',
  /** Free catalog death-and-demand signals: standardization and advice codes. */
  'catalog_signal',
  /** Nothing observable. Not zero demand. Absence of a signal. */
  'none_observed',
] as const

export type DemandBasis = (typeof DEMAND_BASES)[number]

export type DemandReading = {
  basis: DemandBasis
  source: string
  observedAt: string | null
  /** Quantity where the basis carries one. Never invented for a basis that has none. */
  quantity: number | null
  /**
   * TRUE only where the basis is explicitly non-binding by the publisher's own statement.
   * The forecast is. A blank forecast means "this channel does not forecast", not "no demand".
   */
  nonBinding: boolean
}

/* ------------------------------------------------------------------------------------ */
/* AVAILABILITY. An enrichment, never a precondition.                                     */
/* ------------------------------------------------------------------------------------ */

/**
 * Present availability from a commercial locator. Behind an adapter because the credential
 * may be absent, and when it is the answer is `unknown`, never zero and never a number.
 *
 * A corner is never fabricated off a missing availability read. That is Law 1 on this surface.
 */
export type AvailabilityReading =
  | { known: true; unitsAvailable: number; holders: number; observedAt: string; source: string }
  | { known: false; reason: 'credential_absent' | 'not_queried' | 'no_coverage' }

/* ------------------------------------------------------------------------------------ */
/* THE ROW                                                                                */
/* ------------------------------------------------------------------------------------ */

export type ApprovedSourceRow = {
  NIIN: Niin
  CAGE_CODE: Cage
  PART_NUMBER: string | null
  COMPANY_NAME: string | null
  observedAt: string
}

export type MonopolyInput = {
  niin: Niin
  /** Every company recorded as an approved source for this item. */
  approvedSources: ApprovedSourceRow[]
  /** Status per company code. A company absent from this map reads as `unknown`, not active. */
  statuses: Map<Cage, SourceStatusReading>
  demand: DemandReading
  availability: AvailabilityReading
  amc: string | null
  amsc: string | null
  /** Item standardization code, a free death signal when it marks the item unprocurable. */
  isc?: string | null
  /** An open solicitation number, where one exists, for the ninth-character read. */
  solicitationNumber?: string | null
  /** Companies still winning awards for this item. Disconfirming evidence, never hidden. */
  liveAwardees?: Array<{ cage: Cage; lastAwardAt: string }>
  /** Pairs the Multiplier adjudicated. An equivalence can destroy a monopoly. */
  adjudicatedEquivalents?: Niin[]
}

export type MonopolyRow = {
  niin: Niin
  approvedSourceCount: number
  /** True only when exactly one company is an approved source AND that one is dead. */
  isOnlyApprovedSource: boolean
  soleSourceCage: Cage | null
  sourceStatus: SourceStatus
  statusObservedAt: string | null
  inactivityGrade: InactivityGrade | null
  /** TRUE when any source this claim depends on could not be resolved. Excluded from headline. */
  unknownStatus: boolean
  demandBasis: DemandBasis
  demandObservedAt: string | null
  availabilityKnown: boolean
  eligibility: DealerEligibility
  /** T or U means an alternate offer cannot win the instant buy. */
  automatedSolicitation: boolean | null
  /** A live awardee contradicts the thesis. Surfaced, never suppressed. */
  liveAwardeeCount: number
  /** An adjudicated equivalent can fill the requirement without the source returning. */
  substitutionRisk: boolean
  /** Whether this row may be counted in the headline monopoly count. */
  countsTowardHeadline: boolean
  /** Named, never empty by omission. */
  gaps: string[]
  reasons: string[]
}

/**
 * Evaluate one item.
 *
 * Note what this deliberately does NOT return: a score. The two inputs of monopoly strength,
 * how dead the source is and how live the demand is, are reported separately and never
 * collapsed into one opaque number. The principal ranks them; the tool assembles them.
 */
export function evaluateMonopoly(input: MonopolyInput): MonopolyRow {
  const gaps: string[] = []
  const reasons: string[] = []

  const sources = dedupeByCage(input.approvedSources)
  const approvedSourceCount = sources.length

  if (approvedSourceCount === 0) {
    gaps.push('no approved source recorded for this item in the loaded data')
  }

  // Resolve every source. An unresolvable one is `unknown`, and that is recorded, not defaulted.
  const readings = sources.map((s) => {
    const found = input.statuses.get(s.CAGE_CODE)
    if (found) return found
    gaps.push(`company ${s.CAGE_CODE} status could not be resolved`)
    return {
      cage: s.CAGE_CODE,
      status: 'unknown' as SourceStatus,
      observedAt: s.observedAt,
      grade: 'inferred_from_silence' as InactivityGrade,
      evidence: [],
    }
  })

  const dead = readings.filter((r) => statusSupportsDeathClaim(r.status))
  const alive = readings.filter((r) => r.status === 'active')
  const unresolved = readings.filter((r) => r.status === 'unknown')

  // The claim depends on an unknown when an unresolved source could flip the answer: either
  // it is the only source, or it sits alongside dead ones and might itself still be alive.
  const unknownStatus = unresolved.length > 0 && alive.length === 0

  const isOnlyApprovedSource = approvedSourceCount === 1 && dead.length === 1
  const soleSource = isOnlyApprovedSource ? (dead[0] as SourceStatusReading) : null

  if (alive.length > 0) {
    reasons.push(
      `${alive.length} approved source${alive.length === 1 ? '' : 's'} still active, so this is not a corner`,
    )
  }
  if (unknownStatus) {
    reasons.push(
      'at least one approved source could not be resolved, so no death claim is made and this row is excluded from the headline count',
    )
  }

  const liveAwardeeCount = input.liveAwardees?.length ?? 0
  if (liveAwardeeCount > 0) {
    reasons.push(
      `${liveAwardeeCount} company is still winning awards for this item, which contradicts the monopoly thesis`,
    )
  }

  const substitutionRisk = (input.adjudicatedEquivalents?.length ?? 0) > 0
  if (substitutionRisk) {
    reasons.push(
      'an adjudicated equivalent exists, so the requirement can be filled without the source returning',
    )
  }

  if (input.demand.basis === 'none_observed') {
    gaps.push('no forward demand signal observed on any basis')
  }
  if (!input.availability.known) {
    gaps.push(`present availability unknown (${input.availability.reason})`)
  }
  if (input.isc && iscIndicatesDeadItem(input.isc)) {
    reasons.push(`item standardization code ${input.isc} marks this item no longer procurable`)
  }

  const eligibility = readDealerEligibility(input.amc, input.amsc)
  if (eligibility.unknown) gaps.push('acquisition codes incomplete, dealer eligibility not determined')

  const solicitation = input.solicitationNumber ? parseSolicitation(input.solicitationNumber) : null

  // The headline count is the strict reading: exactly one approved source, that source dead,
  // nothing unresolved, no live awardee, and an observed demand signal of some basis.
  const countsTowardHeadline =
    isOnlyApprovedSource &&
    !unknownStatus &&
    liveAwardeeCount === 0 &&
    input.demand.basis !== 'none_observed'

  return {
    niin: input.niin,
    approvedSourceCount,
    isOnlyApprovedSource,
    soleSourceCage: soleSource?.cage ?? null,
    sourceStatus: soleSource?.status ?? (unresolved.length > 0 ? 'unknown' : (readings[0]?.status ?? 'unknown')),
    statusObservedAt: soleSource?.observedAt ?? readings[0]?.observedAt ?? null,
    inactivityGrade: soleSource?.grade ?? null,
    unknownStatus,
    demandBasis: input.demand.basis,
    demandObservedAt: input.demand.observedAt,
    availabilityKnown: input.availability.known,
    eligibility,
    automatedSolicitation: solicitation?.automated ?? null,
    liveAwardeeCount,
    substitutionRisk,
    countsTowardHeadline,
    gaps,
    reasons,
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE HEADLINE COUNT                                                                     */
/* ------------------------------------------------------------------------------------ */

export type MapSummary = {
  /** Rows that pass the strict reading. This is the number the principal is shown. */
  headlineCount: number
  /** Rows whose claim depends on a source we could not resolve. Banded, never hidden. */
  unknownDependentCount: number
  /** Rows contradicted by a company still winning awards. */
  liveAwardeeCount: number
  total: number
}

export function summarizeMap(rows: MonopolyRow[]): MapSummary {
  return {
    headlineCount: rows.filter((r) => r.countsTowardHeadline).length,
    unknownDependentCount: rows.filter((r) => r.unknownStatus).length,
    liveAwardeeCount: rows.filter((r) => r.liveAwardeeCount > 0).length,
    total: rows.length,
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE INVERSION. Manufacturer to stock number. The pre-emptive move.                     */
/* ------------------------------------------------------------------------------------ */

/**
 * Whether this company is the only approved source for an item.
 *
 * ★ THREE-VALUED, AND IT USED TO BE A BOOLEAN. The boolean was computed as
 * `(approvedSourceCountByNiin.get(niin) ?? 0) === 1`, so a NIIN ABSENT from that map became
 * `0`, and `0 === 1` is `false`. "We hold no approved-source count for this item" rendered
 * identically to "we counted, and several companies are approved". `soleSource` is the corner
 * claim, the assertion this product exists to make, and it was silently denying the claim on
 * exactly the items it knew nothing about.
 *
 * The pattern to copy was already three lines below it in the same loop: a missing demand
 * reading is pushed to `gaps` and labelled `none_observed` rather than being scored as zero
 * demand. The same function treated one missing input as a reportable gap and the other as a
 * measured negative. `cornerscore.ts:319` does it correctly too, establishing an evidence
 * state before letting a `?? 0` run at all.
 *
 * So: not a flag, a state. An unmeasured item ABSTAINS instead of denying.
 */
export type SoleSourceState =
  /** Counted, and this company is the only approved source. */
  | 'sole'
  /** Counted, and it is not. */
  | 'competed'
  /** No approved-source count is loaded for this item. Not a denial. */
  | 'not_measured'

export type InversionRow = {
  niin: Niin
  partNumber: string | null
  demandBasis: DemandBasis
  demandObservedAt: string | null
  /** Whether this company is the ONLY approved source. Three-valued: see SoleSourceState. */
  soleSource: SoleSourceState
}

export type InversionResult = {
  cage: Cage
  companyName: string | null
  status: SourceStatus
  statusObservedAt: string
  /** Every item this company is an approved source for. */
  items: InversionRow[]
  /** The subset with observable forward demand. These are the corner-able positions. */
  itemsWithForwardDemand: InversionRow[]
  /**
   * TRUE when the company's own status is unresolved. The inversion still LISTS the items,
   * because the mapping is a fact, but it makes no corner claim about any of them.
   */
  abstainedOnStatus: boolean
  gaps: string[]
}

/**
 * Invert the approved-source mapping: pick a company, see every item it is the approved
 * source for, its registration status with its date, and which of those items have forward
 * demand.
 *
 * This is the question the expert asked in passing that nobody could answer at scale, and it
 * surfaces corner-able positions BEFORE any solicitation posts, which is the whole point.
 *
 * The unknown rule carries through unchanged. An inversion run off an unresolved company
 * status would fabricate a whole shelf of corners at once rather than one at a time, so it
 * abstains on the corner claim while still showing the mapping.
 */
export function invertManufacturer(input: {
  cage: Cage
  companyName?: string | null
  status: SourceStatusReading | null
  approvedSourceRows: ApprovedSourceRow[]
  demandByNiin: Map<Niin, DemandReading>
  approvedSourceCountByNiin: Map<Niin, number>
}): InversionResult {
  const gaps: string[] = []
  const status = input.status
  if (!status) gaps.push(`company ${input.cage} status could not be resolved`)

  const mine = input.approvedSourceRows.filter((r) => r.CAGE_CODE === input.cage)
  const seen = new Set<Niin>()
  const items: InversionRow[] = []

  for (const row of mine) {
    if (seen.has(row.NIIN)) continue
    seen.add(row.NIIN)
    const demand = input.demandByNiin.get(row.NIIN)
    if (!demand) gaps.push(`no demand reading loaded for ${row.NIIN}`)

    /*
     * THE COUNT IS READ ONCE AND ITS ABSENCE IS A STATE, NOT A ZERO. `?? 0` here would make an
     * item we know nothing about indistinguishable from one we measured and found competed,
     * on the field that carries the corner claim.
     */
    const approvedSourceCount = input.approvedSourceCountByNiin.get(row.NIIN)
    if (approvedSourceCount === undefined) {
      gaps.push(`no approved-source count loaded for ${row.NIIN}, so its corner claim abstains`)
    }

    items.push({
      niin: row.NIIN,
      partNumber: row.PART_NUMBER,
      demandBasis: demand?.basis ?? 'none_observed',
      demandObservedAt: demand?.observedAt ?? null,
      soleSource:
        approvedSourceCount === undefined ? 'not_measured' : approvedSourceCount === 1 ? 'sole' : 'competed',
    })
  }

  return {
    cage: input.cage,
    companyName: input.companyName ?? null,
    status: status?.status ?? 'unknown',
    statusObservedAt: status?.observedAt ?? '',
    items,
    itemsWithForwardDemand: items.filter((i) => i.demandBasis !== 'none_observed'),
    abstainedOnStatus: status == null || status.status === 'unknown',
    gaps,
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE CROSS. The customer's own headline surface, at his stated scale.                   */
/* ------------------------------------------------------------------------------------ */

export type CrossInput = {
  niin: Niin
  /** Leg 1: the item carries forecasted demand. */
  demand: DemandReading
  /** Leg 2: the most recent award went to a surplus supplier rather than a manufacturer. */
  lastAwardWasSurplus: boolean | null
  /** Leg 3: present availability. Abstains to unknown when the credential is absent. */
  availability: AvailabilityReading
  /** How many distinct surplus dealers have historically competed on this item. */
  historicalSurplusCompetitors?: number
}

export type CrossRow = {
  niin: Niin
  /** All three legs satisfied and none abstained. */
  qualifies: boolean
  /** A leg that could not be read. Named, so the row says why it did not qualify. */
  abstainedLegs: string[]
  thinAvailability: boolean | null
  historicalSurplusCompetitors: number | null
  demandBasis: DemandBasis
}

/**
 * The forecasted-demand x last-award-was-surplus x present-availability cross.
 *
 * The corner thesis proven by a completed trade: many surplus dealers historically competing
 * on one stock number, plus thin present availability, equals a corner-able position. The
 * expert executed exactly this, buying out the remaining availability from one competing
 * dealer and becoming the only source.
 *
 * Every leg that cannot be read is NAMED rather than assumed false, because "did not qualify"
 * and "could not be evaluated" are different answers and the operator needs to know which.
 */
export function evaluateCross(input: CrossInput, options: { thinAvailabilityAtOrBelow?: number } = {}): CrossRow {
  const thinThreshold = options.thinAvailabilityAtOrBelow ?? 10
  const abstained: string[] = []

  if (input.demand.basis === 'none_observed') abstained.push('no forward demand signal observed')
  if (input.lastAwardWasSurplus == null) abstained.push('last award supplier type not resolved')
  if (!input.availability.known) {
    abstained.push(`present availability unknown (${input.availability.reason})`)
  }

  const thin = input.availability.known ? input.availability.unitsAvailable <= thinThreshold : null

  return {
    niin: input.niin,
    qualifies:
      abstained.length === 0 && input.lastAwardWasSurplus === true && thin === true,
    abstainedLegs: abstained,
    thinAvailability: thin,
    historicalSurplusCompetitors: input.historicalSurplusCompetitors ?? null,
    demandBasis: input.demand.basis,
  }
}

function dedupeByCage(rows: ApprovedSourceRow[]): ApprovedSourceRow[] {
  const seen = new Set<Cage>()
  const out: ApprovedSourceRow[] = []
  for (const r of rows) {
    if (seen.has(r.CAGE_CODE)) continue
    seen.add(r.CAGE_CODE)
    out.push(r)
  }
  return out
}
