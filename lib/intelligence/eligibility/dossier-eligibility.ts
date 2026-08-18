/**
 * DOSSIER ELIGIBILITY: whether the operator may bid, on the screen the operator commits from.
 *
 * -----------------------------------------------------------------------------------------
 * THE MEASURED DEFECT THIS EXISTS TO CLOSE
 * -----------------------------------------------------------------------------------------
 * Bid eligibility reached exactly two surfaces, `/monopoly` and `/competitor`, which are the
 * screens a trader TRIAGES from. It was absent from `/corner/[nsn]`, the screen a trader
 * decides one part from, and absent from the pursuit package, the deal memo you would hand a
 * partner. So the flagship deliverable could recommend pursuing a part whose acquisition codes
 * say a new manufacturing source cannot be approved, and never mention it. The highest-stakes
 * moment had the least eligibility in view. This module is the join that fixes that.
 *
 * It is a JOIN, NOT A SECOND INTERPRETER. Every code meaning comes from
 * `lib/engine/eligibility/amsc.ts`, which transcribes DoD 4100.39-M Volume 10 Table 71 with a
 * source line per row. Every lane consequence comes from `lib/engine/eligibility/gate.ts`,
 * which encodes the AIDC inversion against the Master Solicitation's own paragraphs. Nothing
 * here re-derives a rule those files already own, because two readings of one rule is how a
 * screen and a memo end up disagreeing in front of a customer.
 *
 * -----------------------------------------------------------------------------------------
 * THE ONE RULE THAT OUTRANKS EVERYTHING ELSE HERE: A BLANK IS NOT A ZERO
 * -----------------------------------------------------------------------------------------
 * AMSC is populated on 8,574,735 of the 18,208,227 rows of V_MOE_RULE, and that 47% invites
 * exactly the wrong conclusion. The fill is BIMODAL BY PICA: the activities that publish AMSC
 * publish it on essentially every row (GX 6,056,962 of 6,056,971; DH 1,432,299 of 1,432,299)
 * and the rest publish it on none (ZW, ZH, ZU, YB, ZC, YA, ZR, YD all at 0.00%). So a blank
 * AMSC is not a missing value, it is a DIFFERENT PUBLISHER, and reading it as "not restricted"
 * would invent permission to bid. This module resolves the publisher first and ABSTAINS where
 * that publisher does not publish, with the abstention in the type (`determined: false`), in
 * the evidence state (ABSENT or UNREAD, never MEASURED) and in a sentence a person reads.
 *
 * -----------------------------------------------------------------------------------------
 * VERIFIED AND ESTIMATED ARE DIFFERENT TYPES HERE, ON PURPOSE
 * -----------------------------------------------------------------------------------------
 * Table 71 and its explanations are VERIFIED verbatim. The grouping of codes into open,
 * attackable and closed is labelled ESTIMATED in the digest that states it, and it classifies
 * only ten of the twenty codes. Those two confidences must never render alike, so they are not
 * merely labelled differently, they are `Verified<T>` and `Estimated<T>`, which are not mutually
 * assignable. A render that wants to treat the posture as government text has to say so in code
 * that does not compile.
 *
 * -----------------------------------------------------------------------------------------
 * WHY THE FULL GATE IS NOT RUN HERE, AND WHAT IS
 * -----------------------------------------------------------------------------------------
 * `gate.ts` answers "can THIS QUOTE win an automated award". Most of its inputs are OFFER
 * fields (bid type code, material requirement code, days quote valid, quote remarks) plus the
 * offeror's own set-aside representations. At dossier time no quote exists. Supplying those
 * fields would be inventing the operator's offer, and leaving them absent makes the gate answer
 * 'unknown' on every row by construction, which is a verdict carrying no information that a
 * surface would nonetheless render as a badge. So the gate's verdict is not used.
 *
 * What IS used is the part of the gate that is a function of MEASURED feed fields alone: the
 * lane, read from the ninth position of the solicitation number, and the surplus consequence
 * that follows from it. That consequence is obtained by asking the gate a NAMED CONDITIONAL,
 * "if the operator quoted unused former Government surplus here, what happens", and reading the
 * reason code it emits. The conditional is stated in the output rather than assumed, and the
 * gate stays the only place the AIDC inversion is encoded.
 */
import {
  AMC_DEALER_NOTE,
  AMC_TABLE_CITATION,
  AMSC_NOT_A_CLOSED_DOOR,
  AMSC_POSTURE_CITATION,
  AMSC_TABLE_CITATION,
  GATE_CITATIONS,
  amcEntry,
  evaluateEligibility,
  instrumentFromNinthPositionChar,
  type AmscPosture,
  type Citation,
  type InstrumentType,
  type MaterialRequirementCode,
} from '../../engine/eligibility'
import {
  loadAmscIndex,
  resolveBidEligibility,
  type AmscIndex,
  type AmscIndexUnavailable,
  type EligibilityState,
} from './bid-eligibility'
import { packageCitation, type EligibilityCitation } from './citation'

/**
 * How much of an answer a fact is. The house contract, narrowed to the four states this
 * question can actually be in.
 *
 *   MEASURED   read out of a government file, or out of a verbatim transcription of one.
 *   ESTIMATED  derived by us. The posture grouping, and nothing else in this module.
 *   ABSENT     the publisher does not publish this field. NOT "unrestricted", NOT zero.
 *   UNREAD     the government file exists and we have not read this row out of it.
 */
export type EvidenceState = 'MEASURED' | 'ESTIMATED' | 'ABSENT' | 'UNREAD'

/** A fact read verbatim from primary text. Not assignable to `Estimated<T>`, which is the point. */
export type Verified<T> = {
  readonly evidence: 'MEASURED'
  readonly value: T
  readonly citation: EligibilityCitation
}

/** A reading of ours. Never renders at the confidence of the government's own words. */
export type Estimated<T> = {
  readonly evidence: 'ESTIMATED'
  readonly value: T
  readonly citation: EligibilityCitation
}

/*
 * The citation shape, the pin rewrite and the render-time label all live in `./citation`, which
 * is pure and therefore importable by the client-side renderer. Re-exported here so a consumer
 * of the verdict reads one module. Read that file before changing what a citation carries: every
 * field it drops was measured leaking into the memo prompt.
 */
export type { EligibilityCitation } from './citation'

/**
 * A government code and the government's own words for it.
 *
 * THE CODE TRAVELS AS AN OPAQUE TOKEN, AND THE HYPHEN IS LOAD-BEARING.
 * `AMC-3`, not `3`. The pursuit package is the grounding object for the memo and every bare digit
 * in it becomes a figure the memo may state as a quantity. MEASURED: with the AMC carried as the
 * number 3, the fabricated sentence "There are 3 approved sources on this part." passed the guard
 * on a row with one approved source. `AMSC-0` is the same trap wearing a zero, which is worse,
 * because a blessed 0 licenses "no approved sources". Written this way the digit abuts a letter,
 * which is exactly what `lib/ai/grounding.ts` reads as an identifier fragment on both sides: the
 * guard cannot spend it, and a memo quoting the token back is not falsely stripped.
 *
 * `family` is here so a consumer filtering by table does not have to parse the token, and the
 * government's code is the text after the hyphen.
 */
export type AcquisitionCode = {
  readonly family: 'AMC' | 'AMSC'
  /** The code as this package writes it: `AMC-3`, `AMSC-G`. Never a bare digit. */
  readonly token: string
  /** Verbatim from the Explanation column of the transcribed suffix code table. */
  readonly meaning: string
}

/**
 * The posture, plus the phrase a person reads instead of the machine token.
 *
 * The label lives next to the code, in this module, because a surface that invents its own wording
 * for `restricted_attackable` is a second vocabulary, and two vocabularies for one grouping drift
 * apart the first time somebody edits one of them.
 */
export type PostureReading = {
  readonly code: AmscPosture
  readonly label: string
}

const POSTURE_LABEL: Readonly<Record<AmscPosture, string>> = {
  open_to_surplus_dealer: 'open to competitive acquisition',
  restricted_attackable: 'restricted, with a source approval path',
  restricted_closed_to_new_manufacturing_source: 'restricted, closed to a new manufacturing source',
  unclassified_in_primary_source: 'not classified by the grouping on disk',
}

/**
 * The rule that keeps a restricted code from suppressing the best rows in the business.
 *
 * Deliberately NOT a `Verified<string>`: the sentence is OUR restatement in the operator's
 * vocabulary, and labelling our own wording MEASURED is the exact confusion the two wrappers exist
 * to prevent.
 *
 * THE PRIMARY TEXT IT RESTATES DOES NOT TRAVEL WITH IT, and that is the whole point of the shape.
 * The digest warning this restates names a real prospective customer by first name, and copying it
 * onto the package put that name into the memo prompt, whose system message tells the model its
 * only source of fact is the package and forbids naming a person who is not in it. The citation
 * therefore carries the key and the pin and no quote at all (see `./citation`), and a reader who
 * wants the original opens the pin.
 */
export type SurplusSupplyNote = {
  readonly sentence: string
  readonly citation: EligibilityCitation
}

/** Whether the activity that manages this item publishes acquisition codes at all. */
export type PublisherPublishes = 'yes' | 'no' | 'unknown'

export type EligibilityPublisher = {
  /** The primary inventory control activity, as the MOE Rule file carries it. */
  readonly pica: string | null
  readonly publishesAmsc: PublisherPublishes
  /** The sentence a surface renders. Never a euphemism, never a blank. */
  readonly sentence: string
}

/**
 * What happens to a surplus offer on this solicitation's lane. THE AIDC INVERSION, and it is
 * the highest-severity trap in the domain: the same material, the same offer, opposite outcomes,
 * decided by one character in the ninth position of the solicitation number.
 */
export type SurplusOfferConsequence =
  | 'expressly_permitted_on_this_lane'
  | 'falls_out_of_automated_award_on_this_lane'
  | 'automated_award_rules_do_not_reach_this_lane'
  /** The gate returned no surplus reason for a lane that should produce one. An engine defect. */
  | 'not_determined'

export type SolicitationLane = {
  readonly solicitationNumber: string
  /** The character the lane was read from. Displayed, so a disputed lane is one glance to check. */
  readonly ninthPositionChar: string
  readonly instrument: InstrumentType
  readonly surplusOffer: {
    /** The conditional this answers, stated. No quote exists at dossier time. */
    readonly hypothesis: string
    readonly consequence: SurplusOfferConsequence
    readonly sentence: string
    readonly citation: EligibilityCitation | null
  }
}

export type EligibilityCautionCode =
  | 'source_approval_required_to_manufacture'
  | 'closed_to_new_manufacturing_sources'
  | 'posture_unclassified_in_primary_source'
  | 'surplus_falls_out_of_automated_award_on_this_lane'
  | 'acquisition_code_combination_invalid'
  | 'acquisition_posture_not_determined'

export type EligibilityCaution = {
  readonly code: EligibilityCautionCode
  /** Operator vocabulary, one paragraph, naming the deciding field and what it does not mean. */
  readonly sentence: string
  readonly evidence: EvidenceState
  readonly citation: EligibilityCitation | null
}

/** Where the package's plan stands once eligibility has spoken. Never suppresses the row. */
export type PursuitStance = 'no_recorded_bar' | 'proceed_with_stated_caution' | 'not_determined'

export type DossierEligibility = {
  readonly kind: 'dossier_eligibility'
  readonly nsn: string
  /** The nine digit item number the lookup used, or '' when the stock number is malformed. */
  readonly niin: string
  readonly state: EligibilityState
  /**
   * True only where the managing activity publishes, this row carries a code, AND the transcribed
   * table lists that code. An unlisted character is unread, never determined.
   */
  readonly determined: boolean
  readonly evidence: EvidenceState
  /** One sentence, always present, that says what is and is not established. */
  readonly headline: string
  readonly publisher: EligibilityPublisher
  readonly amc: Verified<AcquisitionCode> | null
  readonly amsc: Verified<AcquisitionCode> | null
  /**
   * THE FEED CARRIED A SUFFIX CODE THE TRANSCRIBED TABLE DOES NOT LIST, in token form
   * (`AMSC-E`). Null on every other path.
   *
   * It is a field rather than a silence because the alternative was measured and it was the
   * expensive one: an unlisted code produced `amsc: null, posture: null` on a row the publisher
   * had published, the caution chain had no branch for it, and the verdict came back stance
   * `no_recorded_bar` with the sentence "Nothing in the acquisition codes recorded for this item
   * bars pursuing it" and the code itself nowhere on the object. That is the blank-is-not-a-zero
   * rule with an unlisted value instead of a blank, and it fails in the direction that costs
   * hours. The engine already models the state (`AmscSignal.recognized: false`) and names E, F,
   * I, J, O, W and X as codes absent from the transcription, so the domain says the input occurs.
   */
  readonly amscCodeNotInTable: string | null
  /** OUR grouping, never the government's. Null whenever we abstain. */
  readonly posture: Estimated<PostureReading> | null
  /** The table says which AMC each suffix code may pair with. 'invalid' means the row is suspect. */
  readonly combination: 'valid' | 'invalid' | 'unknown'
  /** Verbatim, and only where the AMC it is attached to is the AMC on this row. */
  readonly dealerNote: Verified<string> | null
  /** Always present. The sentence that stops a restricted code from reading as a closed door. */
  readonly surplusSupplyNote: SurplusSupplyNote
  readonly lane: SolicitationLane | null
  readonly cautions: readonly EligibilityCaution[]
  /** What this does not establish, in sentences the package appends to its own gap list. */
  readonly gaps: readonly string[]
  readonly pursuit: { readonly stance: PursuitStance; readonly sentence: string }
}

/**
 * The value a package carries when nobody resolved eligibility for it.
 *
 * It exists because `buildPursuitPackage` is imported by a client component and therefore cannot
 * read the acquisition-code index itself, so the caller supplies the verdict. A caller that does
 * not gets THIS, whose discriminant forces every render to handle it and whose sentence says the
 * lookup did not run. What it must never do is read as "no restriction found".
 */
export type EligibilityNotResolved = {
  readonly kind: 'eligibility_not_resolved'
  readonly sentence: string
}

/** What the pursuit package's eligibility field can hold. Discriminated, so neither can be missed. */
export type PackageEligibility = DossierEligibility | EligibilityNotResolved

export const ELIGIBILITY_NOT_RESOLVED: EligibilityNotResolved = {
  kind: 'eligibility_not_resolved',
  sentence:
    'Bid eligibility was not resolved for this package: the acquisition codes were not looked up. ' +
    'Nothing here says whether an approved source is required, and this is not a finding that the ' +
    'item is unrestricted.',
}

/* ------------------------------------------------------------------------------------ */

/**
 * The engine citation, reduced to what may ride on the grounding object. See `./citation`, which
 * carries the measurement of what each dropped field was doing to the memo.
 */
function pinned(c: Citation): EligibilityCitation {
  return packageCitation(c)
}

/** Write a government code as the token this package carries. `AMC-3`, `AMSC-G`. */
function token(family: 'AMC' | 'AMSC', code: string | number): string {
  return `${family}-${code}`
}

function verified<T>(value: T, citation: Citation): Verified<T> {
  return { evidence: 'MEASURED', value, citation: pinned(citation) }
}

function estimated<T>(value: T, citation: Citation): Estimated<T> {
  return { evidence: 'ESTIMATED', value, citation: pinned(citation) }
}

/**
 * The whole point of `AMSC_NOT_A_CLOSED_DOOR`, as a sentence rather than only as a citation.
 * A restricted code restricts MANUFACTURING. Supplying new surplus of the originally approved
 * article is gated by traceability, and encoding it the other way deletes the best leads in the
 * business. The tail is separate so a caution can carry it without restating the first clause,
 * which it has usually just said in its own words.
 */
const SURPLUS_NOT_BARRED_TAIL =
  'It does not by itself bar supplying new surplus of the originally approved article, where ' +
  'traceability rather than source approval is the gate.'

const SURPLUS_SUPPLY_SENTENCE = `A restricted acquisition code restricts who may MANUFACTURE this item. ${SURPLUS_NOT_BARRED_TAIL}`

export type DossierEligibilityInput = {
  /** A 13 digit NSN or a 9 digit NIIN, exactly as the row carries it. */
  readonly stockNumber: string
  /** The live solicitation number this feed day, or null when the row carries none. */
  readonly solicitationNumber?: string | null
}

/**
 * Resolve eligibility for one dossier.
 *
 * The index is a parameter with a default so a test can hand it a synthetic catalogue and so the
 * assembler can resolve many rows against one load. Everything below is a pure function of the
 * index and the two input fields.
 */
export function resolveDossierEligibility(
  facts: DossierEligibilityInput,
  index: AmscIndex | AmscIndexUnavailable = loadAmscIndex(),
): DossierEligibility {
  const base = resolveBidEligibility(facts.stockNumber, index)
  const publisher = readPublisher(base.pica, index)
  const lane = resolveLane(facts.solicitationNumber ?? null)

  const amsc = base.amscEntry
    ? verified<AcquisitionCode>(
        {
          family: 'AMSC',
          token: token('AMSC', base.amscEntry.code),
          meaning: base.amscEntry.explanation,
        },
        AMSC_TABLE_CITATION,
      )
    : null

  /*
   * THE UNLISTED CODE. The publisher published, the row carries a character, and the transcribed
   * table does not list it, so there is no meaning and no posture to assert. It is carried in
   * token form for the same reason every other code is (see `AcquisitionCode`), and it drives the
   * whole verdict to an abstention below rather than being dropped on the floor.
   */
  const amscCodeNotInTable = (() => {
    if (base.state !== 'determined' || base.amscEntry !== null) return null
    const raw = (base.amsc ?? '').trim().toUpperCase()
    // `resolveBidEligibility` abstains on an empty cell, so `raw` is non-empty here. The fallback
    // is written anyway: this branch decides whether a row clears, and it must never depend on a
    // caller having got an invariant right.
    return raw === '' ? 'AMSC-(no readable code on this row)' : token('AMSC', raw)
  })()
  const determined = base.state === 'determined' && amscCodeNotInTable === null

  /*
   * The AMC is read even while we abstain on the AMSC. They are two separate fields of the same
   * catalogue row: a row can carry AMC 1 (dealers are potential sources) with no AMSC at all, and
   * dropping the AMC because its neighbour is blank would discard a measured fact. `resolveBidEligibility`
   * returns the raw AMC string on the abstention path but no table entry for it, so the entry is
   * looked up here from the same transcription the determined path uses.
   */
  const amcEntryForRow = base.amcEntry ?? (/^\d$/.test(base.amc ?? '') ? amcEntry(Number(base.amc)) : null)
  const amc = amcEntryForRow
    ? verified<AcquisitionCode>(
        {
          family: 'AMC',
          token: token('AMC', amcEntryForRow.code),
          meaning: amcEntryForRow.explanation,
        },
        // The AMC half of the table, pinned to the AMC rows. Citing it to the suffix-code rows,
        // which is what this did, sends a reader to a range that does not carry the sentence.
        AMC_TABLE_CITATION,
      )
    : null

  const posture = base.posture
    ? estimated<PostureReading>({ code: base.posture, label: POSTURE_LABEL[base.posture] }, AMSC_POSTURE_CITATION)
    : null

  /*
   * The dealer note is attached in Table 71 to AMC 1 and AMC 2 and to nothing else, so it rides
   * only on those two codes. Rendering it under AMC 3, 4 or 5 would attach a real quote to a row
   * it does not describe, which is the quietest way to fabricate a permission.
   */
  const dealerNote =
    amcEntryForRow && (amcEntryForRow.code === 1 || amcEntryForRow.code === 2) && AMC_DEALER_NOTE.quote
      ? verified(AMC_DEALER_NOTE.quote, AMC_DEALER_NOTE)
      : null

  const cautions = buildCautions({
    state: base.state,
    posture: base.posture,
    combination: base.combination,
    amscRead: amsc?.value ?? null,
    amscCodeNotInTable,
    amcToken: amc?.value.token ?? null,
    lane,
  })
  const gaps = buildGaps(base.state, base.reason, cautions, lane, facts.solicitationNumber ?? null)

  return {
    kind: 'dossier_eligibility',
    nsn: facts.stockNumber,
    niin: base.niin,
    state: base.state,
    determined,
    evidence: evidenceFor(base.state, amscCodeNotInTable),
    headline: headlineFor({
      state: base.state,
      reason: base.reason,
      publisher,
      amcToken: amc?.value.token ?? null,
      amscToken: amsc?.value.token ?? null,
      amscCodeNotInTable,
    }),
    publisher,
    amc,
    amsc,
    amscCodeNotInTable,
    posture,
    combination: base.combination,
    dealerNote,
    surplusSupplyNote: { sentence: SURPLUS_SUPPLY_SENTENCE, citation: pinned(AMSC_NOT_A_CLOSED_DOOR) },
    lane,
    cautions,
    gaps,
    pursuit: pursuitFor(determined, cautions),
  }
}

/**
 * Which publisher manages the item, and whether that publisher publishes acquisition codes.
 *
 * Presence in the derived index's publisher map IS the test, exactly as `bid-eligibility` uses it,
 * so the two can never disagree about who publishes. An index with an empty publisher map answers
 * 'unknown' rather than 'no', because "we measured nobody" and "we measured this one and it does
 * not publish" are different statements and only one of them is about the item.
 */
function readPublisher(pica: string | null, index: AmscIndex | AmscIndexUnavailable): EligibilityPublisher {
  if (!index.ok || index.publishers.size === 0) {
    return {
      pica,
      publishesAmsc: 'unknown',
      sentence:
        'Which activities publish acquisition codes has not been measured in this environment, so ' +
        'no statement is made about this item.',
    }
  }
  if (!pica) {
    return {
      pica: null,
      publishesAmsc: 'unknown',
      sentence: 'The managing activity for this item is not on record, so its publishing is not known.',
    }
  }
  const publishes = index.publishers.has(pica)
  return {
    pica,
    publishesAmsc: publishes ? 'yes' : 'no',
    sentence: publishes
      ? `The activity that manages this item (${pica}) publishes acquisition codes.`
      : `The activity that manages this item (${pica}) does not publish acquisition codes at all, so a ` +
        'blank here is that publisher being silent, not the item being unrestricted.',
  }
}

/**
 * The ninth position of the solicitation number, normalised the way `lib/intelligence/corner.ts`
 * already normalises it when it computes `automatedSolicitation`. The same normalisation
 * deliberately: two reads of one character on one screen is how a lane disagreement reaches an
 * operator. `gate.ts` refuses to slice this itself, on the grounds that a parse inside a pure
 * engine is an inference; the slice belongs here, where the feed's own string is in hand.
 */
function ninthPositionOf(solicitation: string): string | null {
  const normalized = solicitation.replace(/[-\s]/g, '').toUpperCase()
  if (normalized.length < 9) return null
  return normalized.charAt(8)
}

/**
 * The conditional the gate is asked. Material requirement code 4 is Unused Former Government
 * Surplus in the DIBBS batch specification, which is this customer's core product.
 */
const HYPOTHETICAL_SURPLUS_OFFER: MaterialRequirementCode = '4'

const SURPLUS_HYPOTHESIS =
  'This states what would happen if the operator quoted unused former Government surplus property on ' +
  'this solicitation. No quote exists yet and nothing here reads an actual offer.'

function resolveLane(solicitationNumber: string | null): SolicitationLane | null {
  const solicitation = (solicitationNumber ?? '').trim()
  if (solicitation === '') return null
  const ch = ninthPositionOf(solicitation)
  if (ch === null) return null
  const instrument = instrumentFromNinthPositionChar(ch)
  if (instrument === null) return null

  /*
   * ONLY the two fields the question depends on are supplied. The gate's own verdict is not read:
   * with no offer and no set-aside indicator it is 'unknown' by construction on every row, and a
   * badge that always says the same thing is worse than no badge. What is read is the reason code,
   * which is emitted by the one branch that encodes the AIDC inversion.
   */
  const probe = evaluateEligibility({
    solicitation_id: solicitation,
    solicitation_number_type_char: ch,
    offer_material_requirement_code: HYPOTHETICAL_SURPLUS_OFFER,
  })
  const disqualified = probe.reasons.find((r) => r.code === 'aidc_surplus_disqualified')
  const permitted = probe.reasons.find((r) => r.code === 'surplus_permitted_on_automated_lane')

  const surplusOffer = ((): SolicitationLane['surplusOffer'] => {
    if (instrument === 'aidc') {
      if (!disqualified) return undetermined(instrument)
      return {
        hypothesis: SURPLUS_HYPOTHESIS,
        consequence: 'falls_out_of_automated_award_on_this_lane',
        sentence:
          `Solicitation ${solicitation} runs in the AIDC lane, which the letter ${ch} in the ninth ` +
          'position of its number declares. Quoting a used, reconditioned, remanufactured item or ' +
          'unused former Government surplus property there is a listed exception that takes the quote ' +
          'out of automated award. This is the reverse of the ordinary automated lane, where the same ' +
          'offer is expressly permitted. Expect a manual evaluation, not an automatic win.',
        citation: pinned(disqualified.citation),
      }
    }
    if (instrument === 'automated_rfq') {
      if (!permitted) return undetermined(instrument)
      return {
        hypothesis: SURPLUS_HYPOTHESIS,
        consequence: 'expressly_permitted_on_this_lane',
        sentence:
          `Solicitation ${solicitation} runs in the automated lane, which the letter ${ch} in the ninth ` +
          'position of its number declares. Quoting a used, reconditioned, remanufactured item or ' +
          'unused former Government surplus property is on the list of things that do NOT make a quote ' +
          'ineligible on this lane.',
        citation: pinned(permitted.citation),
      }
    }
    return {
      hypothesis: SURPLUS_HYPOTHESIS,
      consequence: 'automated_award_rules_do_not_reach_this_lane',
      sentence:
        `Solicitation ${solicitation} is a manual solicitation: the ninth position of its number is ` +
        `${ch}, a letter other than T or U. The automated award rules, including the surplus ` +
        'exception, do not reach this lane, and a contracting officer evaluates the quote.',
      citation: pinned(GATE_CITATIONS.alternate_offer_manual),
    }
  })()

  return { solicitationNumber: solicitation, ninthPositionChar: ch, instrument, surplusOffer }
}

/**
 * The lane resolved but the gate emitted no surplus reason for it. That is an engine defect rather
 * than a fact about this part, so it answers 'not determined' and says so. Defaulting to the
 * permissive branch here is precisely the failure this module exists to prevent.
 */
function undetermined(instrument: InstrumentType): SolicitationLane['surplusOffer'] {
  return {
    hypothesis: SURPLUS_HYPOTHESIS,
    consequence: 'not_determined',
    sentence:
      `The lane reads as ${instrument}, and the eligibility gate returned no surplus consequence for ` +
      'it. The consequence of quoting surplus on this solicitation is therefore not stated here.',
    citation: null,
  }
}

function evidenceFor(state: EligibilityState, amscCodeNotInTable: string | null): EvidenceState {
  /*
   * UNREAD OUTRANKS MEASURED HERE. A character the transcribed table does not list is a code we
   * have NOT read: the file was published, we hold it, and we cannot say what it means. Reporting
   * that at MEASURED, which is what the state alone would have said, is the register of having
   * measured something we did not.
   */
  if (amscCodeNotInTable !== null) return 'UNREAD'
  if (state === 'determined') return 'MEASURED'
  // The publisher answers nothing for this row: the field is not published, or the row carries none.
  if (state === 'abstained_pica_does_not_publish') return 'ABSENT'
  // The government file exists and this row of it has not been read into the extract on disk.
  return 'UNREAD'
}

function headlineFor(args: {
  state: EligibilityState
  reason: string
  publisher: EligibilityPublisher
  amcToken: string | null
  amscToken: string | null
  amscCodeNotInTable: string | null
}): string {
  const { state, reason, publisher, amcToken, amscToken, amscCodeNotInTable } = args
  /*
   * THE UNLISTED CODE IS NAMED IN THE HEADLINE, and the headline says not determined.
   * Printing "This item carries AMC-3." and stopping, which is what the code-shaped path did,
   * drops the one character the operator would have to settle before spending an hour.
   */
  if (amscCodeNotInTable !== null) {
    return (
      `Bid eligibility is not determined for this item: ${publisher.sentence} This item carries ` +
      `${amcToken === null ? 'no acquisition method code' : amcToken} and the suffix code ` +
      `${amscCodeNotInTable}, which the transcribed suffix code table does not list, so no meaning ` +
      'and no posture are asserted for it. The code is unread, which is not a finding of no restriction.'
    )
  }
  if (state === 'determined') {
    const codes = [amcToken, amscToken].filter((s): s is string => s !== null).join(', ')
    return `${publisher.sentence} This item carries ${codes || 'no acquisition code on this row'}.`
  }
  if (state === 'abstained_pica_does_not_publish') {
    return `Bid eligibility is not determined for this item: ${reason}. A blank acquisition code is a publisher's silence, never a permission.`
  }
  if (state === 'index_absent') {
    return `Bid eligibility is not determined for this item: ${reason}. Nothing here says the item is unrestricted.`
  }
  return `Bid eligibility is not determined for this item: ${reason}. The government file that would answer has not been read for this stock number, which is not the same as an answer of no restriction.`
}

/*
 * WHY THE CAUTIONS QUOTE THE CODE'S OWN WORDS INSTEAD OF PARAPHRASING ITS MECHANISM.
 *
 * The posture groups three codes together (B, C and D) and they do not mean the same thing: C is
 * "requires engineering source approval by the design control activity", D is "the data needed to
 * produce this item from additional sources is not physically available", B is a source control
 * drawing. A caution that printed C's mechanism under D would be a confident sentence about a
 * code it does not describe, which is the class of error a customer catches first. So the caution
 * states OUR grouping as ours, and then quotes the government's own explanation verbatim.
 */
function buildCautions(args: {
  state: EligibilityState
  posture: AmscPosture | null
  combination: 'valid' | 'invalid' | 'unknown'
  amscRead: AcquisitionCode | null
  amscCodeNotInTable: string | null
  amcToken: string | null
  lane: SolicitationLane | null
}): readonly EligibilityCaution[] {
  const { state, posture, combination, amscRead, amscCodeNotInTable, amcToken, lane } = args
  const amsc = amscRead?.token ?? null
  const words = amscRead ? `The government's own words for this code are: "${amscRead.meaning}"` : ''
  const out: EligibilityCaution[] = []

  if (state !== 'determined') {
    out.push({
      code: 'acquisition_posture_not_determined',
      sentence:
        'The acquisition codes for this stock number are not determined, so this package does not ' +
        'establish whether a new source needs engineering source approval. Settle that before hours ' +
        'go in, and do not read the absence as permission.',
      evidence: evidenceFor(state, null),
      citation: null,
    })
  } else if (posture === null) {
    /*
     * DETERMINED BY THE PUBLISHER, UNREADABLE BY US. On the determined path a posture is null if
     * and only if the suffix code is one the transcribed table does not carry, so this branch is
     * the unlisted code and the condition is written as `posture === null` rather than as the
     * code check so that any future way of losing the posture lands here too, loudly. An else-if
     * chain with no branch for this state emitted no caution at all, and no caution meant stance
     * `no_recorded_bar` on a row nobody had read.
     */
    out.push({
      code: 'acquisition_posture_not_determined',
      sentence:
        `This row carries the acquisition method suffix code ${amscCodeNotInTable ?? '(not recorded)'}, ` +
        'which the transcribed suffix code table does not list, so no meaning and no posture are ' +
        'asserted for it. Treat the code as unread and settle it before hours go in. It is not a ' +
        'finding that the item is unrestricted.',
      evidence: 'UNREAD',
      citation: pinned(AMSC_TABLE_CITATION),
    })
  } else if (posture === 'restricted_attackable') {
    out.push({
      code: 'source_approval_required_to_manufacture',
      sentence:
        `${amsc} is grouped by OUR reading, not the government's, as restricted with a source ` +
        `approval path: a new manufacturing source would have to be qualified rather than simply ` +
        `compete. ${words} ${SURPLUS_NOT_BARRED_TAIL}`,
      evidence: 'ESTIMATED',
      citation: pinned(AMSC_POSTURE_CITATION),
    })
  } else if (posture === 'restricted_closed_to_new_manufacturing_source') {
    out.push({
      code: 'closed_to_new_manufacturing_sources',
      sentence:
        `${amsc} is grouped by OUR reading, not the government's, as restricted and closed to a new ` +
        `manufacturing source, so pursuing this as something to manufacture is out. ${words} ` +
        `${SURPLUS_NOT_BARRED_TAIL} That is the corner here: few approved sources, and a buyer with no ` +
        'competitive alternative.',
      evidence: 'ESTIMATED',
      citation: pinned(AMSC_POSTURE_CITATION),
    })
  } else if (posture === 'unclassified_in_primary_source') {
    out.push({
      code: 'posture_unclassified_in_primary_source',
      sentence:
        `${amsc} is in the transcribed suffix code table and the grouping on disk does not classify ` +
        `it as open, attackable or closed, so no posture is asserted for it. ${words} Nothing is ` +
        'inferred beyond them.',
      evidence: 'ABSENT',
      citation: pinned(AMSC_POSTURE_CITATION),
    })
  }

  if (combination === 'invalid') {
    out.push({
      code: 'acquisition_code_combination_invalid',
      sentence:
        `${amcToken ?? 'The acquisition method code'} with ${amsc ?? 'the suffix code on this row'} is ` +
        'not a pairing the transcribed table permits, so this catalogue row is suspect and should be ' +
        're-pulled. It is flagged as a data defect, never as a bid decision.',
      evidence: 'MEASURED',
      citation: pinned(AMSC_TABLE_CITATION),
    })
  }

  if (lane && lane.surplusOffer.consequence === 'falls_out_of_automated_award_on_this_lane') {
    out.push({
      code: 'surplus_falls_out_of_automated_award_on_this_lane',
      sentence: lane.surplusOffer.sentence,
      evidence: 'MEASURED',
      citation: lane.surplusOffer.citation,
    })
  }

  return out
}

/** The sentences the pursuit package appends to its own gap list. Derived from the cautions, never
 *  written twice, so the panel and the memo cannot carry two different wordings of one finding. */
function buildGaps(
  state: EligibilityState,
  reason: string,
  cautions: readonly EligibilityCaution[],
  lane: SolicitationLane | null,
  solicitationNumber: string | null,
): readonly string[] {
  const out: string[] = cautions.map((c) => `Bid eligibility: ${c.sentence}`)
  if (state !== 'determined') {
    out.push(`Bid eligibility: ${reason}.`)
  }
  if (lane === null && (solicitationNumber ?? '').trim() !== '') {
    out.push(
      'Bid eligibility: the solicitation number on this row is too short to carry a ninth position, so ' +
        'the award lane and the consequence of quoting surplus on it are not determined.',
    )
  }
  if (lane === null && (solicitationNumber ?? '').trim() === '') {
    out.push(
      'Bid eligibility: no live solicitation is on this row, so the award lane and the consequence of ' +
        'quoting surplus on it are not determined for any instant buy.',
    )
  }
  if (lane && lane.surplusOffer.consequence === 'not_determined') {
    out.push(`Bid eligibility: ${lane.surplusOffer.sentence}`)
  }
  return out
}

/**
 * `determined` rather than the raw state, because a row whose suffix code the transcribed table
 * does not list is NOT determined however cheerful the state field is. Clearing such a row was
 * measured: stance `no_recorded_bar`, the sentence below, and the code itself nowhere on the
 * object.
 */
function pursuitFor(
  determined: boolean,
  cautions: readonly EligibilityCaution[],
): { stance: PursuitStance; sentence: string } {
  if (!determined) {
    return {
      stance: 'not_determined',
      sentence:
        'Eligibility is not determined for this stock number, so this package neither clears it nor ' +
        'bars it. The row stays on the board, and the acquisition codes are settled before a quote goes ' +
        'in, not after.',
    }
  }
  if (cautions.length > 0) {
    return {
      stance: 'proceed_with_stated_caution',
      sentence:
        'The acquisition codes carry the cautions listed with this package, and they are stated rather ' +
        'than used to hide the row. A restricted code is a competition signal, not a closed door.',
    }
  }
  return {
    stance: 'no_recorded_bar',
    sentence:
      'Nothing in the acquisition codes recorded for this item bars pursuing it. This is a reading of ' +
      "the government's own acquisition codes, not legal advice and not a clearance.",
  }
}
