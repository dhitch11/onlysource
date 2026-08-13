/**
 * THE STRUCTURAL ELIGIBILITY GATE. It runs before any score exists, and it never deletes a row.
 *
 * WHY IT NEVER DELETES A ROW. A filter that silently drops rows teaches an operator to distrust the
 * whole board, because the one time it is wrong there is nothing on screen to argue with. So every
 * verdict here, including 'ineligible', comes back attached to the row with named reasons and a
 * citation per reason. The surface greys the row. It does not remove it.
 *
 * THREE INVERSIONS LIVE IN THIS FILE. Each one is the opposite of what an operator would guess, and
 * each one, encoded backwards, would point this customer at the exact places their product cannot
 * win or hide the exact places it wins best.
 *
 * INVERSION 1, THE AIDC INVERSION, and it is the highest-severity trap in the domain.
 * On the ordinary automated lane (T), quoting unused former Government surplus is explicitly NOT a
 * disqualifier: it sits in the Part I para 3(a)(1) list of things that do not make a quote
 * ineligible, which is this customer's whole charter. On a U-type AIDC solicitation the same act is
 * listed in Part II para 1 as an exception that DOES take the quote out of automated award. Same
 * material, same offer, opposite outcome, decided by one character. Reading Part I and applying it to
 * a U row sends the customer at 3.5 percent of daily volume where their core product is structurally
 * disadvantaged, and 75 percent of that slice is set aside on top.
 *
 * INVERSION 2, THE AMSC TRAP. A restricted AMSC reads as "closed" and is not a gate emission here at
 * all. See `amsc.ts`, whose type system makes the mistake uncompilable. It is a competition signal.
 *
 * INVERSION 3, THE SET-ASIDE CASCADE. A small business that is not SDVOSB and not HUBZone still is
 * not out of an SDVOSB or HUBZone set-aside, because DLAD 19.590 cascades to a small business
 * set-aside when no eligible offer arrives. Emitting 'ineligible' there would delete real work. The
 * cascade text names SDVOSB and HUBZone and nothing else, so for WOSB, EDWOSB and 8(a) this module
 * answers 'unknown' rather than extending a rule the primary text does not extend.
 *
 * NO REVISION NUMBER IS PRINTED ANYWHERE. The Master Solicitation is cited by paragraph only. The
 * corpus carries two revisions of the same document and the conductor has not ruled between them, so
 * a rendered revision number would be an assertion nothing on disk can back.
 *
 * PURE LIBRARY, NO CLOCK. Nothing here reads wall time, touches a database or imports a framework.
 * Eligibility is a function of stored fields, which is what makes a verdict re-derivable in year four.
 */

import {
  amcAmscCombinationValid,
  amscCompetitionSignal,
  cite,
  type Citation,
  type AmscSignal,
} from './amsc'

const MECHANICS = '/Users/user/project-x/03-findings/research/dla-procurement-mechanics.md'
const SPINE = '/Users/user/project-x/03-findings/research/surplus-material-traceability-compliance.md'
const NSN_DOC = '/Users/user/project-x/03-findings/research/nsn-cataloging-and-interchangeability.md'

/**
 * Bump when the rules change. A stored verdict carries the version that produced it, so a later
 * disagreement between two verdicts is attributable to a rule change rather than to a ghost.
 */
export const ELIGIBILITY_GATE_VERSION = 1

// ---------------------------------------------------------------------------------------------
// The citations. Every one is a sentence somebody can open a file and read.
// ---------------------------------------------------------------------------------------------

export const GATE_CITATIONS = {
  alternate_offer: cite({
    id: 'ms_part_i_3g_alternate_offer',
    authority: 'DLA Master Solicitation',
    identifier: 'Part I para 3(g)',
    quote:
      'Alternate offers will not be considered for automated award. Alternate offers may be ' +
      'submitted for evaluation for future procurements.',
    source: `${MECHANICS}:486`,
    verification: 'verified_primary',
  }),
  alternate_offer_manual: cite({
    id: 'ao_guide_manual_solicitation',
    authority: 'DLA SAR and Alternate Offer Guide, November 2022',
    identifier: 'Alternate Offer submission, automated versus manual solicitation',
    quote:
      "If submitting an Alternate Offer against a 'Manual Solicitation' procurement (a solicitation " +
      "with letters OTHER THAN 'T' or 'U' in the 9th position of the solicitation number) " +
      'Contracting Officers may consider submitted Alternate Offers.',
    source: `${NSN_DOC}:599-601`,
    verification: 'verified_primary',
  }),
  aidc_exceptions: cite({
    id: 'ms_part_ii_1_aidc_exceptions',
    authority: 'DLA Master Solicitation',
    identifier: 'Part II para 1',
    quote:
      '(a) Quoting a used, reconditioned, remanufactured item, or unused former Government surplus ' +
      'property. (b) Quoting less than the minimum of 90 days validity period.',
    source: `${MECHANICS}:452-457`,
    verification: 'verified_primary',
  }),
  aidc_batch_corroboration: cite({
    id: 'dibbs_batch_field_067_validation',
    authority: 'DIBBS batch quote file specification',
    identifier: 'field 067 Material Requirements, validation rule',
    quote:
      "If Solicitation Type Indicator (2) equals 'I' and Material Requirements (67) is equal to '4', " +
      "then Bid Type Code (24) must equal bid with exception 'BW' or alternate bid 'AB'.",
    source: `${MECHANICS}:459-462`,
    verification: 'verified_primary',
  }),
  surplus_is_not_a_part_i_disqualifier: cite({
    id: 'ms_part_i_3a1_surplus_allowed',
    authority: 'DLA Master Solicitation',
    identifier: 'Part I para 3(a)(1), item 3',
    quote: 'Quoting a used, reconditioned, remanufactured item, or unused former Government surplus property.',
    source: `${MECHANICS}:315-322`,
    verification: 'verified_primary',
  }),
  remarks: cite({
    id: 'ms_part_i_3a2_remarks',
    authority: 'DLA Master Solicitation',
    identifier: 'Part I para 3(a)(2), item 9',
    quote: 'Quoting Remarks.',
    source: `${MECHANICS}:336`,
    verification: 'verified_primary',
  }),
  first_article: cite({
    id: 'fat_plt_not_automated',
    authority: 'DLA Master Solicitation, automated evaluation and award',
    // The digest on disk quotes this sentence under section 5.1 without pinning a sub-paragraph.
    // Recorded as null rather than guessed, because a fabricated pin is worse than an absent one.
    identifier: null,
    quote:
      'are not candidates for automated evaluation or award. All quotations received for ' +
      'solicitations with FAT/PLT requirements shall be manually evaluated and manually awarded.',
    source: `${MECHANICS}:298-300`,
    verification: 'verified_primary',
  }),
  set_aside_cascade: cite({
    id: 'dlad_19_590_cascade',
    authority: 'DLAD',
    identifier: "19.590, Cascading/set-aside procurement notes for DLA's automated simplified procurement system",
    quote:
      'If the nonmanufacturer rule is waived (see FAR 19.505(c)(4)) and eligible offers are not ' +
      'received for a service-disabled veteran-owned small business (SDVOSB) set-aside or a HUBZone ' +
      'set-aside, the automated system will cascade to a small business set-aside.',
    source: `${MECHANICS}:714-716`,
    verification: 'verified_primary',
  }),
  set_aside_field: cite({
    id: 'dibbs_set_aside_indicator_field',
    authority: 'DIBBS index file and batch quote file specification',
    identifier: 'Small Business Set Aside Indicator, batch field 003',
    quote: null,
    source: `${MECHANICS}:646-652`,
    // ESTIMATED because @T2-INGESTION posted the parsed set-aside indicator as not yet confirmed
    // against real solicitation PDFs. The code letter is read, never inferred, and the caveat rides
    // with it into `data_gaps` so no surface can present it as settled.
    verification: 'estimated',
  }),
  instrument_type_field: cite({
    id: 'dibbs_solicitation_type_indicator',
    authority: 'DIBBS batch quote file specification',
    identifier: 'field 002 Solicitation Type Indicator',
    quote: 'F = Fast Auto Evaluation, I = AIDC, P = Auto Evaluation',
    source: `${MECHANICS}:1025`,
    verification: 'verified_primary',
  }),
  instrument_ninth_position: cite({
    id: 'piid_ninth_position',
    authority: 'DLA SAR and Alternate Offer Guide, November 2022, and DLAD 5.202(a)(13)',
    identifier: 'ninth position of the solicitation number',
    quote:
      "Alternate Offers submitted under an Automated Solicitation (with 'T' or 'U' in the 9th " +
      'position of the solicitation number) will NOT be considered for instant procurement.',
    source: `${NSN_DOC}:594-597`,
    verification: 'verified_primary',
  }),
  csi_esa: cite({
    id: 'm05_csi_esa_factor',
    authority: 'DLAD procurement note M05',
    identifier: 'M05(2)',
    quote:
      'All offers for CSI require evaluation by the ESA(s). An evaluation factor of $600 shall be ' +
      'applied for coordination with each ESA.',
    source: `${SPINE}:882-883`,
    verification: 'verified_primary',
  }),
  csi_esa_may_restrict: cite({
    id: 'dlad_11_302b_esa_gate',
    authority: 'DLAD',
    identifier: '11.302(b)',
    quote:
      'Acceptable material includes unused former Government surplus property unless restricted by ' +
      'the ESA.',
    source: `${SPINE}:73-74`,
    verification: 'verified_primary',
  }),
  ltc_excluded_from_automated: cite({
    id: 'dlad_13_003e1_exclusions',
    authority: 'DLAD',
    identifier: '13.003(e)(1)',
    quote:
      'All items are candidates for automated solicitation, except that acquisitions for services, ' +
      'for non-NSN items, and for requirements bought using delivery orders against ' +
      'indefinite-delivery contracts are excluded.',
    source: `${MECHANICS}:292-295`,
    verification: 'verified_primary',
  }),
} as const

// ---------------------------------------------------------------------------------------------
// Inputs. Every field is read from the feed. Nothing on this shape is ever inferred from another.
// ---------------------------------------------------------------------------------------------

/** DIBBS batch field 002. The feed's own characters, not a derived label. */
export type SolicitationTypeIndicator = 'F' | 'I' | 'P'

/** DIBBS batch field 024. */
export type BidTypeCode = 'BI' | 'BW' | 'AB' | 'DQ'

/** DIBBS batch field 067, Material Requirements, per FAR 52.211-5. */
export type MaterialRequirementCode = '0' | '1' | '2' | '3' | '4'

/** The single-character set-aside indicator as the index file carries it. */
export type SetAsideCode = 'N' | 'Y' | 'L' | 'R' | 'H' | 'E' | 'A'

/** What the offeror can actually represent about itself. Absent means unknown, never means false. */
export type OfferorSetAsideStatus =
  | 'small_business'
  | 'wosb'
  | 'sdvosb'
  | 'hubzone'
  | 'edwosb'
  | 'eight_a'

/** The lane the solicitation actually runs in. Derived only from the feed's own type characters. */
export type InstrumentType = 'automated_rfq' | 'aidc' | 'manual_rfq'

export type EligibilityInputs = {
  readonly solicitation_id: string
  /** Batch field 002, if the feed carried it. */
  readonly solicitation_type_indicator?: SolicitationTypeIndicator | null
  /**
   * The ninth position of the solicitation number, supplied by the ingestion lane as its own field.
   * This module does not slice a string to find it: parsing here would be an inference, and the one
   * thing the domain trap punishes is inferring the instrument type.
   */
  readonly solicitation_number_type_char?: string | null
  readonly bid_type_code?: BidTypeCode | null
  readonly offer_material_requirement_code?: MaterialRequirementCode | null
  /** Batch field 027. Only checked when present, because the quoter sets it at composition time. */
  readonly days_quote_valid?: number | null
  /** Batch field 119 or 121. Any content at all is disqualifying on an automated instrument. */
  readonly quote_remarks?: string | null
  readonly first_article_testing_required?: boolean | null
  readonly production_lot_testing_required?: boolean | null
  readonly set_aside_indicator?: SetAsideCode | null
  readonly offeror_set_aside_statuses?: readonly OfferorSetAsideStatus[] | null
  readonly critical_safety_item?: boolean | null
  /** Whether the NSN is covered by an active long term contract or indefinite-delivery vehicle. */
  readonly long_term_contract_coverage?: boolean | null
  readonly amsc?: string | null
  readonly amc?: number | null
}

// ---------------------------------------------------------------------------------------------
// Outputs.
// ---------------------------------------------------------------------------------------------

export type EligibilityVerdict = 'eligible' | 'ineligible' | 'unknown'

/**
 * What a reason does to the verdict.
 * 'disqualifying' forces 'ineligible'. 'blocking_unknown' forces 'unknown' when nothing disqualifies.
 * 'qualifying' and 'signal' never move the verdict, they explain it and they feed scoring.
 */
export type ReasonDisposition = 'disqualifying' | 'blocking_unknown' | 'qualifying' | 'signal'

/** Where a row belongs once the gate has spoken. */
export type AwardRouting =
  | 'automated_award_candidate'
  | 'future_evaluation'
  | 'excluded'
  | 'manual_evaluation'
  | 'undetermined'

export type EligibilityReasonCode =
  | 'instrument_type_missing'
  | 'instrument_type_conflict'
  | 'instrument_type_resolved'
  | 'aidc_surplus_disqualified'
  | 'aidc_validity_period_below_minimum'
  | 'surplus_permitted_on_automated_lane'
  | 'alternate_offer_not_automated'
  | 'alternate_offer_considerable_on_manual_solicitation'
  | 'first_article_or_production_lot_testing'
  | 'quote_remarks_present'
  | 'set_aside_unrestricted'
  | 'set_aside_status_matches'
  | 'set_aside_cascade_candidate'
  | 'set_aside_offeror_not_small_business'
  | 'set_aside_offeror_status_unknown'
  | 'set_aside_cascade_not_established_in_primary_text'
  | 'set_aside_indicator_absent'
  | 'critical_safety_item'
  | 'critical_safety_item_esa_may_restrict_surplus'
  | 'long_term_contract_coverage'
  | 'amsc_restricted_competition_signal'
  | 'amsc_open_competition_signal'
  | 'amsc_unclassified_in_primary_source'
  | 'amsc_code_not_in_table_71'
  | 'amsc_amc_combination_invalid'
  | 'amsc_absent'

export type EligibilityReason = {
  readonly code: EligibilityReasonCode
  readonly disposition: ReasonDisposition
  /** Operator vocabulary. Names the deciding field. Never a bare code, never a euphemism. */
  readonly operator_text: string
  /** The field that decided it, so a counterfactual can name what to change. */
  readonly deciding_field: string
  readonly citation: Citation
  /** Set only by disqualifying reasons, to say where the row goes instead of the automated lane. */
  readonly routes_to?: AwardRouting
}

/**
 * A reason derived from an AMSC. Its disposition is the literal 'signal', which is the AMSC trap
 * enforced by the compiler: an AMSC reason cannot be constructed as 'disqualifying' at all.
 */
export type AmscDerivedReason = EligibilityReason & { readonly disposition: 'signal' }

export type EligibilityResult = {
  readonly solicitation_id: string
  readonly verdict: EligibilityVerdict
  readonly instrument: InstrumentType | null
  readonly routing: AwardRouting
  /** Every reason, in emission order. An ineligible row carries its reasons on its face. */
  readonly reasons: readonly EligibilityReason[]
  /** The competition read, always present, never a gate emission. */
  readonly amsc_signal: AmscSignal
  /** Fields that were absent, or whose upstream confirmation is still pending. */
  readonly data_gaps: readonly string[]
  readonly gate_version: number
}

// ---------------------------------------------------------------------------------------------
// Instrument type. Derived from the feed's own indicator characters, never from anything else.
// ---------------------------------------------------------------------------------------------

/**
 * Map batch field 002 to a lane. F and P are the automated evaluation lanes, I is AIDC.
 * Exported because the mapping is a fact worth testing on its own, separately from the gate.
 */
export function instrumentFromTypeIndicator(
  indicator: SolicitationTypeIndicator | null | undefined,
): InstrumentType | null {
  if (indicator === 'I') return 'aidc'
  if (indicator === 'F' || indicator === 'P') return 'automated_rfq'
  return null
}

/**
 * Map the ninth position of the solicitation number to a lane.
 *
 * The rule is quoted, not invented: T and U are the automated solicitations, and the Alternate Offer
 * Guide defines a manual solicitation as one carrying "letters OTHER THAN 'T' or 'U'" there. That is
 * why every other letter maps to 'manual_rfq' rather than to null: the primary text covers the
 * complement explicitly, so this is a transcription rather than a guess.
 */
export function instrumentFromNinthPositionChar(
  ch: string | null | undefined,
): InstrumentType | null {
  if (typeof ch !== 'string') return null
  const c = ch.trim().toUpperCase()
  if (c.length !== 1) return null
  if (c === 'U') return 'aidc'
  if (c === 'T') return 'automated_rfq'
  return 'manual_rfq'
}

/** True for the two lanes where automated award is on the table at all. */
function isAutomatedLane(instrument: InstrumentType): boolean {
  return instrument === 'automated_rfq' || instrument === 'aidc'
}

/** The four material codes the AIDC exception paragraph names. Code 0 is new material and is not one. */
const AIDC_EXCEPTED_MATERIAL_CODES: readonly MaterialRequirementCode[] = ['1', '2', '3', '4']

/** Batch field 027. AIDC quotes below this many days validity fall out of automated award. */
export const AIDC_MINIMUM_DAYS_QUOTE_VALID = 90

/** Which offeror status each restrictive set-aside letter demands. */
const SET_ASIDE_REQUIRED_STATUS: Readonly<Record<SetAsideCode, OfferorSetAsideStatus | null>> = {
  N: null,
  Y: 'small_business',
  L: 'wosb',
  R: 'sdvosb',
  H: 'hubzone',
  E: 'edwosb',
  A: 'eight_a',
}

/**
 * The set-aside letters DLAD 19.590 says cascade down to a small business set-aside.
 * The quoted text names SDVOSB and HUBZone and no others, so this list is exactly those two.
 */
const SET_ASIDE_CASCADES_TO_SMALL_BUSINESS: readonly SetAsideCode[] = ['R', 'H']

/**
 * Routing precedence, written out so the choice is inspectable rather than buried in if-order.
 *
 * 'future_evaluation' outranks 'excluded' deliberately: the alternate offer channel is a source
 * qualification channel for FUTURE procurements, and the primary text says so in the same breath as
 * the bar. Being excluded from this instant buy does not close that channel.
 */
const ROUTING_PRECEDENCE: readonly AwardRouting[] = [
  'future_evaluation',
  'excluded',
  'manual_evaluation',
]

// ---------------------------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------------------------

/**
 * Decide whether a solicitation and offer pair can win an automated award, and say why in words.
 *
 * The verdict algebra, stated once: any disqualifying reason makes it 'ineligible', because a known
 * bar outranks an unknown. Otherwise any blocking_unknown makes it 'unknown', because a missing field
 * is not permission. Otherwise 'eligible'. Nothing is dropped at any step.
 */
export function evaluateEligibility(input: EligibilityInputs): EligibilityResult {
  const reasons: EligibilityReason[] = []
  const gaps: string[] = []

  const instrument = resolveInstrument(input, reasons, gaps)

  if (instrument !== null) {
    evaluateOfferAgainstInstrument(input, instrument, reasons, gaps)
  } else {
    // Every offer side rule below depends on which lane we are in. Guessing the lane is the exact
    // mistake the AIDC inversion punishes, so the rules are skipped and recorded as gaps instead.
    gaps.push('bid_type_code, offer_material_requirement_code and quote_remarks were not evaluated because instrument type is undetermined')
  }

  // Instrument independent. First article testing removes the SOLICITATION from the automated lane,
  // whichever lane that is, so it is checked even when the instrument type is missing.
  evaluateTesting(input, reasons)
  evaluateSetAside(input, reasons, gaps)
  evaluateSuppressionSignals(input, reasons, gaps)

  const amsc_signal = amscCompetitionSignal(input.amsc)
  for (const r of amscReasons(input, amsc_signal)) reasons.push(r)
  if (input.amsc === null || input.amsc === undefined) gaps.push('amsc')

  const verdict = verdictFrom(reasons)
  return {
    solicitation_id: input.solicitation_id,
    verdict,
    instrument,
    routing: routingFrom(reasons, verdict),
    reasons,
    amsc_signal,
    data_gaps: gaps,
    gate_version: ELIGIBILITY_GATE_VERSION,
  }
}

/** Any disqualifier beats any unknown, because a known bar is more information, not less. */
function verdictFrom(reasons: readonly EligibilityReason[]): EligibilityVerdict {
  if (reasons.some((r) => r.disposition === 'disqualifying')) return 'ineligible'
  if (reasons.some((r) => r.disposition === 'blocking_unknown')) return 'unknown'
  return 'eligible'
}

function routingFrom(reasons: readonly EligibilityReason[], verdict: EligibilityVerdict): AwardRouting {
  for (const candidate of ROUTING_PRECEDENCE) {
    if (reasons.some((r) => r.disposition === 'disqualifying' && r.routes_to === candidate)) {
      return candidate
    }
  }
  if (verdict === 'eligible') return 'automated_award_candidate'
  if (verdict === 'ineligible') return 'manual_evaluation'
  return 'undetermined'
}

/**
 * Resolve the lane from whichever of the two feed fields is present, and refuse to resolve it when
 * they disagree. A disagreement is a real ingestion defect and it is the one case where answering
 * confidently would be worse than answering 'unknown'.
 */
function resolveInstrument(
  input: EligibilityInputs,
  reasons: EligibilityReason[],
  gaps: string[],
): InstrumentType | null {
  const fromIndicator = instrumentFromTypeIndicator(input.solicitation_type_indicator)
  const fromChar = instrumentFromNinthPositionChar(input.solicitation_number_type_char)

  if (fromIndicator !== null && fromChar !== null && fromIndicator !== fromChar) {
    reasons.push({
      code: 'instrument_type_conflict',
      disposition: 'blocking_unknown',
      operator_text:
        `Solicitation type indicator resolves to ${fromIndicator} but the ninth position of the ` +
        `solicitation number resolves to ${fromChar}. The lane decides whether surplus is welcome ` +
        'or disqualified, so it is left undetermined rather than picked.',
      deciding_field: 'solicitation_type_indicator, solicitation_number_type_char',
      citation: GATE_CITATIONS.instrument_type_field,
    })
    gaps.push('solicitation_type_indicator conflicts with solicitation_number_type_char')
    return null
  }

  const resolved = fromIndicator ?? fromChar
  if (resolved === null) {
    reasons.push({
      code: 'instrument_type_missing',
      disposition: 'blocking_unknown',
      operator_text:
        'Neither the solicitation type indicator nor the ninth position of the solicitation number ' +
        'was supplied, so the lane is undetermined. On the automated lane unused former Government ' +
        'surplus is welcome. On the AIDC lane the same offer is out of automated award. The lane is ' +
        'never inferred from anything else.',
      deciding_field: 'solicitation_type_indicator',
      citation: GATE_CITATIONS.instrument_type_field,
    })
    gaps.push('solicitation_type_indicator')
    gaps.push('solicitation_number_type_char')
    return null
  }

  reasons.push({
    code: 'instrument_type_resolved',
    disposition: 'signal',
    operator_text: `Solicitation runs in the ${resolved} lane, read from the feed's own type field.`,
    deciding_field: fromIndicator !== null ? 'solicitation_type_indicator' : 'solicitation_number_type_char',
    citation:
      fromIndicator !== null ? GATE_CITATIONS.instrument_type_field : GATE_CITATIONS.instrument_ninth_position,
  })
  return resolved
}

/** The offer side rules, all of which are meaningless until the lane is known. */
function evaluateOfferAgainstInstrument(
  input: EligibilityInputs,
  instrument: InstrumentType,
  reasons: EligibilityReason[],
  gaps: string[],
): void {
  const material = input.offer_material_requirement_code ?? null
  const isExceptedMaterial = material !== null && AIDC_EXCEPTED_MATERIAL_CODES.includes(material)

  // THE AIDC INVERSION.
  if (instrument === 'aidc' && isExceptedMaterial) {
    reasons.push({
      code: 'aidc_surplus_disqualified',
      disposition: 'disqualifying',
      operator_text:
        'This is an AIDC solicitation, and on AIDC a used, reconditioned, remanufactured or unused ' +
        'former Government surplus offer is an exception that takes the quote out of automated ' +
        'award. This is the reverse of the ordinary automated lane, where the same offer is ' +
        'expressly permitted.',
      deciding_field: 'offer_material_requirement_code',
      citation: GATE_CITATIONS.aidc_exceptions,
      routes_to: 'manual_evaluation',
    })
  } else if (instrument === 'automated_rfq' && isExceptedMaterial) {
    reasons.push({
      code: 'surplus_permitted_on_automated_lane',
      disposition: 'qualifying',
      operator_text:
        'Quoting unused former Government surplus is on the list of things that do NOT make a quote ' +
        'ineligible on this lane. It is the customer charter, and it is lane specific.',
      deciding_field: 'offer_material_requirement_code',
      citation: GATE_CITATIONS.surplus_is_not_a_part_i_disqualifier,
    })
  }

  if (material === null) gaps.push('offer_material_requirement_code')

  // The second AIDC exception, from the same quoted paragraph. Checked only when the field is
  // present, because the quoter sets validity at composition time and absence is not a defect.
  if (
    instrument === 'aidc' &&
    typeof input.days_quote_valid === 'number' &&
    input.days_quote_valid < AIDC_MINIMUM_DAYS_QUOTE_VALID
  ) {
    reasons.push({
      code: 'aidc_validity_period_below_minimum',
      disposition: 'disqualifying',
      operator_text:
        `Quote validity of ${input.days_quote_valid} days is below the ${AIDC_MINIMUM_DAYS_QUOTE_VALID} ` +
        'day minimum this AIDC solicitation requires, which is a listed exception to automated award.',
      deciding_field: 'days_quote_valid',
      citation: GATE_CITATIONS.aidc_exceptions,
      routes_to: 'manual_evaluation',
    })
  }

  // The alternate offer bar. It binds on the automated lanes only, and the primary text says so by
  // defining a manual solicitation as the complement of T and U.
  if (input.bid_type_code === 'AB') {
    if (isAutomatedLane(instrument)) {
      reasons.push({
        code: 'alternate_offer_not_automated',
        disposition: 'disqualifying',
        operator_text:
          'This is an alternate offer on an automated solicitation. It cannot win the instant award ' +
          'at any price. It routes to evaluation for future procurements instead, which is a real ' +
          'channel and worth filing, not a rejection.',
        deciding_field: 'bid_type_code',
        citation: GATE_CITATIONS.alternate_offer,
        routes_to: 'future_evaluation',
      })
    } else {
      reasons.push({
        code: 'alternate_offer_considerable_on_manual_solicitation',
        disposition: 'signal',
        operator_text:
          'This is an alternate offer on a manual solicitation, where contracting officers may ' +
          'consider it. The automated award bar does not reach this lane.',
        deciding_field: 'bid_type_code',
        citation: GATE_CITATIONS.alternate_offer_manual,
      })
    }
  } else if (input.bid_type_code === null || input.bid_type_code === undefined) {
    gaps.push('bid_type_code')
  }

  // Remarks radioactivity. Any free text at all, not merely long or unusual text.
  const remarks = typeof input.quote_remarks === 'string' ? input.quote_remarks.trim() : ''
  if (remarks.length > 0) {
    if (isAutomatedLane(instrument)) {
      reasons.push({
        code: 'quote_remarks_present',
        disposition: 'disqualifying',
        operator_text:
          'The quote carries free text remarks. Quoting remarks is a listed exception that makes a ' +
          'quote ineligible for automated award, so a helpful explanatory note converts an ' +
          'automatic win into a manual review.',
        deciding_field: 'quote_remarks',
        citation: GATE_CITATIONS.remarks,
        routes_to: 'manual_evaluation',
      })
    } else {
      reasons.push({
        code: 'quote_remarks_present',
        disposition: 'signal',
        operator_text:
          'The quote carries free text remarks. This solicitation is not on the automated lane, so ' +
          'the automated award bar on remarks does not apply here.',
        deciding_field: 'quote_remarks',
        citation: GATE_CITATIONS.remarks,
      })
    }
  }
}

/** First article and production lot testing take the solicitation out of the automated lane entirely. */
function evaluateTesting(input: EligibilityInputs, reasons: EligibilityReason[]): void {
  const fat = input.first_article_testing_required === true
  const plt = input.production_lot_testing_required === true
  if (!fat && !plt) return
  const which = fat && plt ? 'first article and production lot testing' : fat ? 'first article testing' : 'production lot testing'
  reasons.push({
    code: 'first_article_or_production_lot_testing',
    disposition: 'disqualifying',
    operator_text:
      `This solicitation carries ${which}, which removes it from automated evaluation and award ` +
      'entirely. Every quotation on it is evaluated and awarded manually, so no price wins it ' +
      'automatically.',
    deciding_field: fat ? 'first_article_testing_required' : 'production_lot_testing_required',
    citation: GATE_CITATIONS.first_article,
    routes_to: 'manual_evaluation',
  })
}

/**
 * Set-aside, read from the feed's own single character and never inferred from anything else.
 * Carries INVERSION 3: a small business is a cascade candidate on SDVOSB and HUBZone set-asides.
 */
function evaluateSetAside(
  input: EligibilityInputs,
  reasons: EligibilityReason[],
  gaps: string[],
): void {
  const code = input.set_aside_indicator ?? null
  if (code === null) {
    reasons.push({
      code: 'set_aside_indicator_absent',
      disposition: 'blocking_unknown',
      operator_text:
        'The set-aside indicator was not supplied. Set-aside status is read from the feed field and ' +
        'is never inferred from the buyer, the dollar value or the item, so eligibility cannot be ' +
        'settled without it.',
      deciding_field: 'set_aside_indicator',
      citation: GATE_CITATIONS.set_aside_field,
    })
    gaps.push('set_aside_indicator')
    return
  }

  // The parsed indicator is still pending confirmation against real solicitation PDFs upstream, so
  // it is reported as a gap even when it is present and even when it does not change the verdict.
  gaps.push('set_aside_indicator is parsed but not yet confirmed against primary solicitation documents')

  if (code === 'N') {
    reasons.push({
      code: 'set_aside_unrestricted',
      disposition: 'qualifying',
      operator_text: 'The solicitation is unrestricted, so no small business status is required to compete.',
      deciding_field: 'set_aside_indicator',
      citation: GATE_CITATIONS.set_aside_field,
    })
    return
  }

  const required = SET_ASIDE_REQUIRED_STATUS[code]
  if (required === null) return

  const statuses = input.offeror_set_aside_statuses ?? null
  if (statuses === null) {
    reasons.push({
      code: 'set_aside_offeror_status_unknown',
      disposition: 'blocking_unknown',
      operator_text:
        `This is a ${code} set-aside and the offeror's own small business representations were not ` +
        'supplied. An unrecorded representation is not the same as not holding one, so the answer is ' +
        'unknown rather than out.',
      deciding_field: 'offeror_set_aside_statuses',
      citation: GATE_CITATIONS.set_aside_field,
    })
    gaps.push('offeror_set_aside_statuses')
    return
  }

  if (statuses.includes(required)) {
    reasons.push({
      code: 'set_aside_status_matches',
      disposition: 'qualifying',
      operator_text: `The offeror holds the ${required} status this ${code} set-aside requires.`,
      deciding_field: 'offeror_set_aside_statuses',
      citation: GATE_CITATIONS.set_aside_field,
    })
    return
  }

  const isSmallBusiness = statuses.includes('small_business')
  if (!isSmallBusiness) {
    reasons.push({
      code: 'set_aside_offeror_not_small_business',
      disposition: 'disqualifying',
      operator_text:
        `This is a ${code} set-aside and the offeror represents as other than small. Every set-aside ` +
        'in this scheme is restricted to small business concerns, including after a cascade, so ' +
        'there is no path to award on this solicitation.',
      deciding_field: 'offeror_set_aside_statuses',
      citation: GATE_CITATIONS.set_aside_cascade,
      routes_to: 'excluded',
    })
    return
  }

  if (SET_ASIDE_CASCADES_TO_SMALL_BUSINESS.includes(code)) {
    reasons.push({
      code: 'set_aside_cascade_candidate',
      disposition: 'signal',
      operator_text:
        `This is a ${code} set-aside and the offeror is a small business without that specific ` +
        'status. It is not out: when no eligible offer is received the automated system cascades to ' +
        'a small business set-aside. It is a lower priority candidate, not an excluded one.',
      deciding_field: 'offeror_set_aside_statuses',
      citation: GATE_CITATIONS.set_aside_cascade,
    })
    return
  }

  reasons.push({
    code: 'set_aside_cascade_not_established_in_primary_text',
    disposition: 'blocking_unknown',
    operator_text:
      `This is a ${code} set-aside and the offeror is a small business without that specific status. ` +
      'The cascade rule on disk names SDVOSB and HUBZone only, so whether this set-aside cascades to ' +
      'a small business set-aside is not established. It is left unknown rather than extended.',
    deciding_field: 'set_aside_indicator',
    citation: GATE_CITATIONS.set_aside_cascade,
  })
}

/** Critical safety item and long term contract coverage. Suppression signals, never gate emissions. */
function evaluateSuppressionSignals(
  input: EligibilityInputs,
  reasons: EligibilityReason[],
  gaps: string[],
): void {
  if (input.critical_safety_item === true) {
    reasons.push({
      code: 'critical_safety_item',
      disposition: 'signal',
      operator_text:
        'This NSN is a critical safety item. Every offer on it goes to the engineering support ' +
        'activity, a $600 per ESA evaluation factor applies, and the ESA can restrict surplus ' +
        'outright. It stays on the board, priced with the factor and flagged, not hidden.',
      deciding_field: 'critical_safety_item',
      citation: GATE_CITATIONS.csi_esa,
    })
    reasons.push({
      // A DISTINCT CODE, not a second 'critical_safety_item'. These are two different facts with
      // two different citations: the first states the cost that always applies (the $600 per ESA
      // factor), this one states a risk that may not materialise (the ESA restricting surplus).
      // Sharing one code let a consumer that de-duplicates reasons by code silently drop whichever
      // arrived second, and the one that would have been dropped is the restriction warning.
      code: 'critical_safety_item_esa_may_restrict_surplus',
      disposition: 'signal',
      operator_text:
        'Unused former Government surplus is acceptable material unless the engineering support ' +
        'activity restricts it, so critical safety item status raises the odds of a restriction ' +
        'without establishing one.',
      deciding_field: 'critical_safety_item',
      citation: GATE_CITATIONS.csi_esa_may_restrict,
    })
  } else if (input.critical_safety_item === null || input.critical_safety_item === undefined) {
    gaps.push('critical_safety_item')
  }

  if (input.long_term_contract_coverage === true) {
    reasons.push({
      code: 'long_term_contract_coverage',
      disposition: 'signal',
      operator_text:
        'This NSN is covered by a long term or indefinite-delivery contract. Requirements bought ' +
        'using delivery orders against those contracts are excluded from automated solicitation, so ' +
        'spot volume is suppressed while the coverage lasts. Its expiry is a re-entry event.',
      deciding_field: 'long_term_contract_coverage',
      citation: GATE_CITATIONS.ltc_excluded_from_automated,
    })
  } else if (input.long_term_contract_coverage === null || input.long_term_contract_coverage === undefined) {
    gaps.push('long_term_contract_coverage')
  }
}

/**
 * AMSC reasons. THE TRAP, ENFORCED BY THE RETURN TYPE.
 *
 * Every reason this function can produce is typed `AmscDerivedReason`, whose disposition is the
 * literal 'signal'. A future edit that tries to emit 'disqualifying' from an AMSC does not compile.
 * That is deliberate: an AMSC derived 'ineligible' would suppress exactly the monopoly shaped rows
 * this product exists to surface, and a comment asking people not to do it is not a control.
 */
export function amscReasons(
  input: EligibilityInputs,
  signal: AmscSignal,
): readonly AmscDerivedReason[] {
  const out: AmscDerivedReason[] = []

  if (input.amsc === null || input.amsc === undefined) {
    out.push({
      code: 'amsc_absent',
      disposition: 'signal',
      operator_text:
        'No AMSC was supplied, so the competition read is unavailable. This does not affect ' +
        'eligibility: AMSC never gates a surplus offer.',
      deciding_field: 'amsc',
      citation: signal.table_citation,
    })
    return out
  }

  if (!signal.recognized) {
    out.push({
      code: 'amsc_code_not_in_table_71',
      disposition: 'signal',
      operator_text:
        `The AMSC supplied is not one of the twenty codes in Table 71, so no competition read can be ` +
        'made from it. The catalogue row should be re-pulled. Eligibility is unaffected.',
      deciding_field: 'amsc',
      citation: signal.table_citation,
    })
    return out
  }

  if (signal.restricted) {
    out.push({
      code: 'amsc_restricted_competition_signal',
      disposition: 'signal',
      operator_text:
        `AMSC ${signal.code} restricts who may MANUFACTURE this part. It does not bar supplying new ` +
        'surplus of the originally approved article, which is what this offer is. Read it as a ' +
        "monopoly signal in this offer's favor: few approved sources, and the buyer has no " +
        'competitive alternative. Traceability, not source approval, is the gate here.',
      deciding_field: 'amsc',
      citation: signal.warning_citation,
    })
  } else if (signal.posture === 'open_to_surplus_dealer') {
    out.push({
      code: 'amsc_open_competition_signal',
      disposition: 'signal',
      operator_text:
        `AMSC ${signal.code} indicates the item is open to competitive acquisition, so expect more ` +
        'bidders and thinner margin than a restricted code implies.',
      deciding_field: 'amsc',
      citation: signal.posture_citation,
    })
  } else {
    out.push({
      code: 'amsc_unclassified_in_primary_source',
      disposition: 'signal',
      operator_text:
        `AMSC ${signal.code} is in Table 71 but the competition grouping on disk does not classify ` +
        'it as open, attackable or closed. No posture is asserted for it.',
      deciding_field: 'amsc',
      citation: signal.posture_citation,
    })
  }

  if (amcAmscCombinationValid(input.amc, input.amsc) === 'invalid') {
    out.push({
      code: 'amsc_amc_combination_invalid',
      disposition: 'signal',
      operator_text:
        `AMC ${String(input.amc)} with AMSC ${signal.code} is not a combination the validation grid ` +
        'permits, so the catalogue row is suspect. Flagged as a data defect, not as a bid decision.',
      deciding_field: 'amc, amsc',
      citation: signal.table_citation,
    })
  }

  return out
}

/** Pull just the reasons that moved the verdict to ineligible, for a row's face and for a memo. */
export function disqualifyingReasons(result: EligibilityResult): readonly EligibilityReason[] {
  return result.reasons.filter((r) => r.disposition === 'disqualifying')
}

/** Pull the reasons that left the verdict unknown, which is what a worklist is built from. */
export function blockingUnknownReasons(result: EligibilityResult): readonly EligibilityReason[] {
  return result.reasons.filter((r) => r.disposition === 'blocking_unknown')
}
