/**
 * THE GOVERNMENT CODEBOOKS. These decide whether the matcher works or produces confident
 * nonsense, so they live in one file with their provenance attached.
 *
 * ---------------------------------------------------------------------------------------
 * PROVENANCE, AND WHY EVERY CONSUMER MUST CHECK IT
 * ---------------------------------------------------------------------------------------
 * These tables are transcribed from DoD 4100.39-M Volume 10, October 1996 (DTIC ADA315905),
 * which is a primary DoD source and the authoritative table volume, and it is thirty years
 * old. The CURRENT volume ships inside the free catalog download as
 * `FLIS_VOLUMES/FLIS_VOLUME_10.docx`. It has not been extracted or diffed yet.
 *
 * So `CODEBOOK_PROVENANCE.currentVolumeVerified` is FALSE, and it stays false until somebody
 * reads the shipped volume and records the citation. Cross-era corroboration is good for the
 * acquisition codes (AMSC B/C/D/G in the November 2022 source-approval guide match the 1996
 * definitions exactly) and that is still not the standard for a table we gate bids on.
 *
 * The single value most likely to have moved is the dollar threshold on AMSC L.
 */

export const CODEBOOK_PROVENANCE = {
  source: 'DoD 4100.39-M Volume 10, October 1996, DTIC ADA315905, tables 6, 7, 52, 70, 71, 91',
  currentVolumeVerified: false,
  currentVolumeLocation: 'FLIS_VOLUMES/FLIS_VOLUME_10.docx, inside the free catalog zip',
  mustDiffBeforeGatingBids: true,
  knownSuspectValues: ['the dollar screening threshold quoted on AMSC L'],
} as const

/* ------------------------------------------------------------------------------------ */
/* REFERENCE NUMBER CODES. The identity join lives or dies on these two.                  */
/* ------------------------------------------------------------------------------------ */

/**
 * RNVC, reference number variation code. Says whether a reference number identifies an
 * item of production at all.
 *
 * THE MEASUREMENT THAT MAKES THIS THE MOST IMPORTANT CONSTANT IN THE LANE: joined on part
 * number alone the free reference file yields 190,216 keys sitting under more than one stock
 * number. Restricted to RNVC 2 that collapses to 6,447. A thirty-fold collapse. Skipping the
 * filter manufactures roughly 184,000 false equivalences and never emits a single error.
 */
export const RNVC = {
  /** Does not identify an item of production without additional information. Proves nothing. */
  NOT_ITEM_IDENTIFYING: '1',
  /** IS an item-identifying number for an item of production. The only identity-grade code. */
  ITEM_IDENTIFYING: '2',
  /** A vendor reference on a source control item, reparable through component exchange. */
  SOURCE_CONTROL_VENDOR: '3',
  /** Superseded, cancelled, obsolete, discontinued, or information only. */
  SUPERSEDED_OR_INFO_ONLY: '9',
} as const

export type RnvcCode = (typeof RNVC)[keyof typeof RNVC]

/** The identity join accepts exactly one variation code. Not a range, not a set. */
export function isItemIdentifying(rnvc: string | null | undefined): boolean {
  return rnvc === RNVC.ITEM_IDENTIFYING
}

/**
 * RNCC, reference number category code. Says what KIND of relationship the reference is.
 *
 * Three of these are traps that must be excluded before asserting identity, and they are the
 * reason a naive part-number join lights up like a Christmas tree:
 *  - `C` advisory: the manual explicitly permits the SAME reference number to be recorded
 *    against more than one stock number.
 *  - `D` drawing number: "will not be used in item-of-supply determinations", verbatim.
 *  - `7` vendor item drawing: "administrative control numbers and shall not be used as part
 *    identification numbers", verbatim.
 */
export const RNCC = {
  SOURCE_CONTROL: '1',
  DEFINITIVE_GOVERNMENT_SPEC: '2',
  /** The primary number identifying an item of production, assigned by the design controller. */
  DESIGN_CONTROL: '3',
  NON_DEFINITIVE_GOVERNMENT_SPEC: '4',
  SECONDARY: '5',
  INFORMATIVE: '6',
  VENDOR_ITEM_DRAWING: '7',
  US_NATO_REPRODUCED: '8',
  PACKAGING_DESIGN: 'A',
  PACKAGING_NON_DESIGN: 'B',
  /** Advisory. No direct relationship to the stock number. Recordable against many items. */
  ADVISORY: 'C',
  /** Drawing number. Excluded from item-of-supply determination by rule. */
  DRAWING_NUMBER: 'D',
} as const

export type RnccCode = (typeof RNCC)[keyof typeof RNCC]

/**
 * The category codes an identity claim may rest on. `RNCC 3 + RNVC 2` is the strongest
 * identity assertion the catalog makes: the design control number, assigned by the
 * organization controlling the design, identifying the item of production by itself.
 */
export const IDENTITY_GRADE_RNCC: readonly string[] = [
  RNCC.SOURCE_CONTROL,
  RNCC.DEFINITIVE_GOVERNMENT_SPEC,
  RNCC.DESIGN_CONTROL,
]

/** Category codes that must never contribute to an identity claim. */
export const IDENTITY_EXCLUDED_RNCC: readonly string[] = [
  RNCC.ADVISORY,
  RNCC.DRAWING_NUMBER,
  RNCC.VENDOR_ITEM_DRAWING,
]

export function isIdentityGradeReference(
  rncc: string | null | undefined,
  rnvc: string | null | undefined,
): boolean {
  if (!isItemIdentifying(rnvc)) return false
  if (rncc == null) return false
  if (IDENTITY_EXCLUDED_RNCC.includes(rncc)) return false
  return IDENTITY_GRADE_RNCC.includes(rncc)
}

/* ------------------------------------------------------------------------------------ */
/* THE INTERCHANGEABILITY GRAPH. Directed and typed, or it authorizes substitutions the    */
/* government did not.                                                                     */
/* ------------------------------------------------------------------------------------ */

/**
 * How an edge may be traversed.
 *  - `symmetric`: both directions carry the same meaning.
 *  - `forward`: this item points at the other. The reverse is NOT implied.
 *  - `paired`: one half of a required two-code pair pointing opposite ways.
 */
export type EdgeDirection = 'symmetric' | 'forward' | 'paired'

export type PhraseCode = {
  code: string
  phrase: string
  direction: EdgeDirection
  /** True when the edge asserts the two items can fill each other's requirement. */
  interchangeability: boolean
  note?: string
}

/**
 * Phrase codes, the edge types of the government's own interchangeability graph.
 * Only the codes this lane traverses or must recognise are enumerated.
 */
export const PHRASE_CODES: Readonly<Record<string, PhraseCode>> = {
  A: {
    code: 'A',
    phrase: 'Consolidated with',
    direction: 'forward',
    interchangeability: true,
    note: 'Identical or completely interchangeable, issued under the other stock number.',
  },
  C: {
    code: 'C',
    phrase: 'Cancelled, replaced by',
    direction: 'forward',
    interchangeability: true,
    note: 'The stock number was assigned to more than one item of supply in error.',
  },
  E: {
    code: 'E',
    phrase: 'Replaced by',
    direction: 'paired',
    interchangeability: true,
    note: 'Required pair with G, pointing the opposite direction.',
  },
  F: {
    code: 'F',
    phrase: 'When exhausted use',
    direction: 'forward',
    interchangeability: true,
    note: 'ONE WAY by definition. Reversing this authorizes a substitution nobody approved.',
  },
  G: {
    code: 'G',
    phrase: 'Replaces',
    direction: 'paired',
    interchangeability: true,
    note: 'Required pair with E, pointing the opposite direction.',
  },
  H: {
    code: 'H',
    phrase: 'Suitable substitute',
    direction: 'forward',
    interchangeability: true,
    note: 'The OTHER item substitutes for this one. The reverse is not implied.',
  },
  J: {
    code: 'J',
    phrase: 'Interchangeable with',
    direction: 'symmetric',
    interchangeability: true,
    note: 'Completely interchangeable one for the other, no preference implied.',
  },
  L: {
    code: 'L',
    phrase: 'Superseded by',
    direction: 'forward',
    interchangeability: true,
  },
  U: {
    code: 'U',
    phrase: 'Associated with master stock number in an interchangeability family',
    direction: 'symmetric',
    interchangeability: true,
  },
  V: {
    code: 'V',
    phrase: 'Discontinued without replacement',
    direction: 'forward',
    interchangeability: false,
    note: 'A death signal for the monopoly map, not an interchangeability edge.',
  },
  Y: {
    code: 'Y',
    phrase: 'Equivalent to',
    direction: 'symmetric',
    interchangeability: true,
    note: 'Physical and performance characteristics identical, differing only in unit of issue.',
  },
  Z: {
    code: 'Z',
    phrase: 'Discontinued, use',
    direction: 'forward',
    interchangeability: true,
  },
  '3': {
    code: '3',
    phrase: 'Reversal of stock-as relationship',
    direction: 'forward',
    interchangeability: true,
  },
}

/** The codes generator 1 traverses. Recorded by the government, therefore conclusive. */
export const INTERCHANGEABILITY_PHRASE_CODES: readonly string[] = Object.values(PHRASE_CODES)
  .filter((p) => p.interchangeability)
  .map((p) => p.code)

/** Phrase codes that are death-and-demand signals rather than equivalence edges. */
export const DISCONTINUED_PHRASE_CODES: readonly string[] = ['V']

export function phraseIsSymmetric(code: string): boolean {
  return PHRASE_CODES[code]?.direction === 'symmetric'
}

/* ------------------------------------------------------------------------------------ */
/* ACQUISITION CODES. The bid-eligibility gate, and the distinction that decides whether   */
/* the map suppresses the best leads in the business.                                      */
/* ------------------------------------------------------------------------------------ */

/** Acquisition method code. Codes 1 and 2 carry, verbatim, "Potential sources shall include
 *  dealers/distributors", which is the legal footing for a surplus dealer to bid. */
export const AMC = {
  NOT_ESTABLISHED: '0',
  COMPETITIVE: '1',
  COMPETITIVE_FIRST_TIME: '2',
  DIRECT_FROM_MANUFACTURER: '3',
  DIRECT_FROM_MANUFACTURER_FIRST_TIME: '4',
  PRIME_CONTRACTOR_ONLY: '5',
} as const

export const AMC_OPEN_TO_DEALERS: readonly string[] = [AMC.COMPETITIVE, AMC.COMPETITIVE_FIRST_TIME]

/**
 * How a suffix code constrains a NEW MANUFACTURING SOURCE.
 *
 * READ THIS BEFORE USING IT. A restricted suffix bars a new source from MANUFACTURING the
 * item. It does not, by itself, bar supplying new surplus of the originally approved article,
 * which is the entire business. Conflating the two suppresses the best leads we have. The
 * gate on surplus is traceability, and that is T5's, not a code in this table.
 */
export type ManufacturingAccess =
  | 'open'
  | 'source_approval_possible'
  | 'closed_to_new_manufacturing'
  | 'not_established'

export type AmscCode = {
  code: string
  meaning: string
  manufacturing: ManufacturingAccess
  /** True where the source-approval path is explicitly available for this suffix. */
  sourceApprovalEligible: boolean
}

export const AMSC: Readonly<Record<string, AmscCode>> = {
  '0': {
    code: '0',
    meaning: 'Not established.',
    manufacturing: 'not_established',
    sourceApprovalEligible: false,
  },
  A: {
    code: 'A',
    meaning: 'Government rights to the data in its possession are questionable, under review.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  B: {
    code: 'B',
    meaning: 'Restricted to sources on source control or altered item drawings.',
    manufacturing: 'source_approval_possible',
    sourceApprovalEligible: true,
  },
  C: {
    code: 'C',
    meaning: 'Requires engineering source approval by the design control activity.',
    manufacturing: 'source_approval_possible',
    sourceApprovalEligible: true,
  },
  D: {
    code: 'D',
    meaning: 'Data to produce this item from additional sources is not physically available.',
    manufacturing: 'source_approval_possible',
    sourceApprovalEligible: true,
  },
  G: {
    code: 'G',
    meaning: 'Government has unlimited rights to the technical data and the package is complete.',
    manufacturing: 'open',
    sourceApprovalEligible: false,
  },
  H: {
    code: 'H',
    meaning: 'Insufficient or illegible data, immediate buy only, under review.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  K: {
    code: 'K',
    meaning: 'Must be produced from controlled castings or forgings, approved sources.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  L: {
    code: 'L',
    meaning: 'Annual buy value below the screening threshold, screened for known sources.',
    manufacturing: 'open',
    sourceApprovalEligible: false,
  },
  M: {
    code: 'M',
    meaning: 'Master or coordinated tooling required and unavailable.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  N: {
    code: 'N',
    meaning: 'Requires special test or inspection facilities for ultra precision quality.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  P: {
    code: 'P',
    meaning: 'Rights to the data are not owned by the Government and cannot be purchased.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  Q: {
    code: 'Q',
    meaning: 'The Government lacks adequate data, rights, or both.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  R: {
    code: 'R',
    meaning: 'Data or rights not owned, and purchasing them was judged uneconomical.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  S: {
    code: 'S',
    meaning: 'Restricted because security classification prevents public disclosure.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  T: {
    code: 'T',
    meaning: 'Acquisition controlled by qualified products list procedures.',
    manufacturing: 'source_approval_possible',
    sourceApprovalEligible: false,
  },
  U: {
    code: 'U',
    meaning: 'Breakout cost exceeds projected savings over the life span.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  V: {
    code: 'V',
    meaning: 'Designated a high reliability part under a formal reliability program.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  Y: {
    code: 'Y',
    meaning: 'The design of this part is unstable.',
    manufacturing: 'closed_to_new_manufacturing',
    sourceApprovalEligible: false,
  },
  Z: {
    code: 'Z',
    meaning: 'A commercial, non developmental, off the shelf item.',
    manufacturing: 'open',
    sourceApprovalEligible: false,
  },
}

export type DealerEligibility = {
  /** Can a dealer supply NEW SURPLUS of the originally approved article. */
  surplusSupplyOpen: boolean
  /** Can a NEW SOURCE manufacture it. A different question with a different answer. */
  manufacturing: ManufacturingAccess
  sourceApprovalEligible: boolean
  /** Named so the interface can state the basis rather than show a verdict. */
  basis: string
  /** True when a code was missing or unrecognised, so the caller abstains instead of guessing. */
  unknown: boolean
}

/**
 * The eligibility read, keeping the two questions separate on purpose.
 *
 * An unrecognised or absent code returns `unknown: true`. It never defaults to open (which
 * would send an operator at a closed item) and never defaults to closed (which would
 * suppress a real lead). Both defaults are wrong, so neither is taken.
 */
export function readDealerEligibility(
  amc: string | null | undefined,
  amsc: string | null | undefined,
): DealerEligibility {
  const suffix = amsc ? AMSC[amsc.toUpperCase()] : undefined

  /*
   * ★ AMC "0" IS A RECOGNISED CODE THAT MEANS NOTHING WAS DETERMINED, AND IT USED TO PASS THIS
   * GATE. `Object.values(AMC).includes('0')` is true, because `AMC.NOT_ESTABLISHED = '0'` is a
   * real government code — so `readDealerEligibility('0', 'G')` returned `unknown: false`,
   * `manufacturing: 'open'`, and the sentence "method 0 directs acquisition to the manufacturer
   * or prime". It directs nothing. That is AMC 3/4/5. The basis described a determination that
   * had never been made, on 246 rows today and 1,060,757 at full catalogue scale.
   *
   * The comment above this function already states the intent exactly, and the intent was right:
   * an absent code abstains, an invalid code abstains, both defaults are wrong so neither is
   * taken. "0" slipped through because the test was RECOGNITION and what it needed was
   * DETERMINATION. A stated absence is recognised precisely because the publisher took the
   * trouble to state it.
   *
   * So the two absences are now separated in the OUTPUT as well as the logic, because they are
   * different facts an operator can act on differently: "the government recorded that no
   * acquisition method was established" is a finding about the item, while "we hold no code" is
   * a finding about our data.
   */
  const methodRecognised = amc != null && amc !== '' && Object.values(AMC).includes(amc as never)
  const methodNotEstablished = amc === AMC.NOT_ESTABLISHED
  const methodDetermined = methodRecognised && !methodNotEstablished

  if (!suffix || !methodDetermined) {
    return {
      surplusSupplyOpen: false,
      manufacturing: 'not_established',
      sourceApprovalEligible: false,
      basis: methodNotEstablished
        ? `the government records acquisition method 0, NOT ESTABLISHED, for this item ` +
          `(suffix ${amsc ?? 'absent'}), so no acquisition method has been determined and ` +
          'eligibility cannot be read from it'
        : `acquisition codes incomplete (method ${amc ?? 'absent'}, suffix ${amsc ?? 'absent'}), ` +
          'eligibility not determined',
      unknown: true,
    }
  }

  const competitive = AMC_OPEN_TO_DEALERS.includes(amc as string)
  return {
    // Surplus supply of the approved article is not barred by a restricted suffix. The gate
    // there is traceability, which this lane does not own and must not pretend to answer.
    surplusSupplyOpen: competitive || suffix.manufacturing !== 'open',
    manufacturing: suffix.manufacturing,
    sourceApprovalEligible: suffix.sourceApprovalEligible,
    basis: competitive
      ? `method ${amc} is competitive and includes dealers and distributors among potential sources; suffix ${suffix.code}: ${suffix.meaning}`
      : `method ${amc} directs acquisition to the manufacturer or prime; suffix ${suffix.code}: ${suffix.meaning}`,
    unknown: false,
  }
}

/* ------------------------------------------------------------------------------------ */
/* ITEM STANDARDIZATION CODES. Death signals, free, in the catalog.                       */
/* ------------------------------------------------------------------------------------ */

/**
 * Of the populated rows in the official standardization table, the overwhelming majority
 * carry ISC 3 or E, and both mean the item is no longer authorized for procurement. That is
 * the government publishing, for free, which stock numbers are dead and what replaced them.
 */
export const ISC = {
  AUTHORIZED_REPLACEMENT: '1',
  AUTHORIZED_FOR_PROCUREMENT: '2',
  /** Not authorized for procurement, following a formal item reduction study. */
  NOT_AUTHORIZED_STUDY: '3',
  /** No longer authorized for procurement, replaced by a superseding specification. */
  NOT_AUTHORIZED_SUPERSEDED: 'E',
} as const

export const ISC_NO_LONGER_PROCURABLE: readonly string[] = [
  ISC.NOT_AUTHORIZED_STUDY,
  ISC.NOT_AUTHORIZED_SUPERSEDED,
]

export function iscIndicatesDeadItem(isc: string | null | undefined): boolean {
  return isc != null && ISC_NO_LONGER_PROCURABLE.includes(isc.toUpperCase())
}
