/**
 * THE AMC AND AMSC TABLES, TRANSCRIBED FROM THE PRIMARY TEXT ON DISK, PLUS THE ONE WARNING
 * PRINTED BENEATH THEM THAT REVERSES THE OBVIOUS READING.
 *
 * WHY THIS MODULE EXISTS AND WHY IT IS A TRANSCRIPTION AND NOT A RECALL.
 * AMC and AMSC are one character each and they decide, in most people's heads, whether a part is
 * "open" or "closed". Recalling those twenty letters from memory is exactly the way an invented code
 * enters a scoring engine and never leaves. Every row below was read out of
 * `nsn-cataloging-and-interchangeability.md` at the line number recorded on the row, which is
 * DoD 4100.39-M Volume 10, Chapter 4, Table 71 as quoted there. Codes absent from that table
 * (E, F, I, J, O, W, X) are absent here. They do not exist for us.
 *
 * ★ THE HIGHEST-SEVERITY RULE IN THIS FILE, AND IT REVERSES THE OBVIOUS READING.
 * The warning printed directly beneath the table, at line 565 of that file, verbatim:
 *
 *   "Do not conclude 'closed' from AMSC alone. A restricted AMSC bars *manufacturing* by a new
 *    source. It does not by itself bar supplying **new surplus of the originally approved article**,
 *    which is Wayne's actual business. Traceability, not source approval, is the gate there ...
 *    This distinction must be encoded explicitly or the system will suppress Wayne's best leads."
 *
 * So a restricted AMSC is a COMPETITION AND MONOPOLY SIGNAL, never a gate emission. It is in fact
 * the shape of row this product exists to find: few approved manufacturing sources, a buyer with no
 * competitive alternative, and a dealer who already holds the approved article. Emitting
 * 'ineligible' from AMSC alone would delete precisely the inventory of leads that justifies the
 * product. `bars_surplus_supply_of_the_approved_article` below is typed as the literal `false` so
 * that no later edit can flip it without the type checker objecting.
 *
 * WHAT IS VERIFIED AND WHAT IS ESTIMATED, KEPT APART ON PURPOSE.
 * The tables and the "Valid AMCs" column are VERIFIED verbatim in the source. The grouping of codes
 * into open, attackable and closed is labelled ESTIMATED in the source itself (line 553 onward), and
 * it covers only ten of the twenty codes. The other ten get `unclassified_in_primary_source`, which
 * is the honest answer, not a guess dressed as one.
 */

const NSN_DOC = '/Users/user/project-x/03-findings/research/nsn-cataloging-and-interchangeability.md'

/** How much weight a downstream surface may put on a cited fact. Never inferred, always recorded. */
export type Verification = 'verified_primary' | 'reported' | 'estimated'

/**
 * A pin back to the primary text, carried by every reason this engine emits.
 *
 * It lives in this module rather than in the gate because this is the module that literally
 * transcribes primary text, and the gate re-exports it. An operator who disbelieves a verdict has to
 * be able to open a file at a line number and read the sentence, without asking anyone. A reason
 * without that pin is an opinion.
 *
 * NO REVISION NUMBER APPEARS IN ANY FIELD OF ANY CITATION IN THIS ENGINE. The Master Solicitation is
 * cited by paragraph only, for example 'Master Solicitation Part I para 3(g)'. The corpus is split
 * between two revisions of the same document and the conductor has not ruled, so printing either one
 * would assert something the corpus cannot produce. A test scans every citation for a revision token.
 */
export type Citation = {
  /** Stable key, so two surfaces citing the same rule cite it identically. */
  readonly id: string
  /** The issuing body, spelled the way a person reads it aloud. */
  readonly authority: string
  /**
   * The pin a contracting officer would look up, with no revision number.
   * Null when the primary digest on disk pins no paragraph, which is a real and reportable state.
   */
  readonly identifier: string | null
  /** The primary text, exactly as read. Null when nothing verbatim was captured. */
  readonly quote: string | null
  /** Where it was read, as `path:line`, so re-verification costs one command. */
  readonly source: string
  readonly verification: Verification
}

/** Construct a citation. A helper rather than object literals so the shape cannot drift per call site. */
export function cite(c: Citation): Citation {
  return c
}

export type AmcCode = 0 | 1 | 2 | 3 | 4 | 5

export type AmcEntry = {
  readonly code: AmcCode
  readonly explanation: string
  readonly source_line: number
}

/**
 * Acquisition Method Code, VERIFIED verbatim, DoD 4100.39-M Volume 10, Chapter 4, Table 71.
 * Six codes, transcribed from lines 510 to 515.
 */
export const AMC_TABLE: readonly AmcEntry[] = [
  { code: 0, explanation: 'Not established.', source_line: 510 },
  { code: 1, explanation: 'Suitable for competitive acquisition.', source_line: 511 },
  { code: 2, explanation: 'Suitable for competitive acquisition for the first time.', source_line: 512 },
  {
    code: 3,
    explanation:
      'Acquire directly from the actual manufacturer, whether or not the prime contractor is the ' +
      'actual manufacturer.',
    source_line: 513,
  },
  {
    code: 4,
    explanation:
      'Acquire, for the first time, directly from the actual manufacturer rather than the prime ' +
      'contractor who is not the actual manufacturer.',
    source_line: 514,
  },
  {
    code: 5,
    explanation:
      'Acquire only from the prime contractor although the engineering data identifies the CAGE and ' +
      'part number of a source other than the prime contractor.',
    source_line: 515,
  },
]

/**
 * The sentence that is the legal footing for a dealer who does not manufacture.
 * VERIFIED verbatim at line 517, attached in the source to AMC codes 1 and 2.
 */
export const AMC_DEALER_NOTE = cite({
  id: 'amc_dealers_included',
  authority: 'DoD 4100.39-M Volume 10, Chapter 4',
  identifier: 'Table 71, note to AMC 1 and 2',
  quote: 'Potential sources shall include dealers/distributors.',
  source: `${NSN_DOC}:517`,
  verification: 'verified_primary',
})

/**
 * The twenty AMSC codes that are actually in Table 71.
 * Deliberately not a wider alphabet: a letter absent from the table is absent from the domain.
 */
export type AmscCode =
  | '0'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'G'
  | 'H'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'Y'
  | 'Z'

export type AmscEntry = {
  readonly code: AmscCode
  /** Verbatim from the Explanation column. Markdown emphasis markers in the source are not text. */
  readonly explanation: string
  /** Verbatim from the Valid AMCs column. */
  readonly valid_amcs: readonly AmcCode[]
  readonly source_line: number
  /** Present only where the Valid AMCs cell was blank and the value came from prose instead. */
  readonly valid_amcs_note?: string
}

/**
 * Acquisition Method Suffix Code, VERIFIED verbatim, Table 71, transcribed from lines 527 to 546.
 * Twenty codes. The count is asserted in the test, because a silently dropped row is the failure
 * this transcription exists to prevent.
 */
export const AMSC_TABLE: readonly AmscEntry[] = [
  {
    code: '0',
    explanation: 'Not established.',
    // The Valid AMCs cell is blank in the table at line 527. The value below comes from the prose at
    // line 548, VERIFIED: "AMSC 0 is valid only with AMC 0". Recorded separately so the reader can
    // see that this one row did not come from the column the other nineteen came from.
    valid_amcs: [0],
    source_line: 527,
    valid_amcs_note: `Valid AMCs cell is blank in the table; restriction to AMC 0 read from prose at ${NSN_DOC}:548`,
  },
  {
    code: 'A',
    explanation:
      "The Government's rights to use data in its possession is questionable. Applicable only to " +
      'parts under immediate buy requirements while rights are under review.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 528,
  },
  {
    code: 'B',
    explanation:
      'Acquisition restricted to source(s) specified on "Source Control", "Altered Item" or ' +
      '"Selected Item" drawings/documents.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 529,
  },
  {
    code: 'C',
    explanation:
      'Requires engineering source approval by the design control activity to maintain the quality ' +
      "of the part. An alternate source must qualify per the design control activity's procedures.",
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 530,
  },
  {
    code: 'D',
    explanation: 'The data needed to produce this item from additional sources is not physically available.',
    valid_amcs: [3, 4, 5],
    source_line: 531,
  },
  {
    code: 'G',
    explanation:
      'The Government has unlimited rights to the technical data, and the data package is complete.',
    valid_amcs: [1, 2],
    source_line: 532,
  },
  {
    code: 'H',
    explanation:
      'Government does not physically have sufficient, accurate, or legible data to purchase from ' +
      'other than current source(s). Immediate buy requirements only, while under review.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 533,
  },
  {
    code: 'K',
    explanation:
      'Must be produced from class 1A castings and similar type forgings, from approved (controlled) ' +
      'sources.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 534,
  },
  {
    code: 'L',
    explanation:
      'Annual buy value falls below the $10,000 screening threshold but it has been screened for ' +
      'known source(s).',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 535,
  },
  {
    code: 'M',
    explanation:
      'Master or coordinated tooling required, not owned by the Government or cannot be made available.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 536,
  },
  {
    code: 'N',
    explanation: 'Requires special test and/or inspection facilities for ultra-precision quality.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 537,
  },
  {
    code: 'P',
    explanation:
      'The rights to use the data needed to purchase this part from additional sources are not owned ' +
      'by the Government and cannot be purchased.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 538,
  },
  {
    code: 'Q',
    explanation: 'The government does not have adequate data, lacks rights to data, or both.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 539,
  },
  {
    code: 'R',
    explanation:
      'The data or the rights are not owned by the Government and it has been determined that it is ' +
      'uneconomical to purchase them.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 540,
  },
  {
    code: 'S',
    explanation:
      'Restricted to limited source(s) because security classification of confidential or higher ' +
      'prevents public disclosure.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 541,
  },
  {
    code: 'T',
    explanation: 'Acquisition controlled by QPL procedures.',
    valid_amcs: [1, 2],
    source_line: 542,
  },
  {
    code: 'U',
    explanation:
      'Cost to break out and acquire competitively exceeds projected savings over the life span.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 543,
  },
  {
    code: 'V',
    explanation: 'Designated a high-reliability part under a formal reliability program.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 544,
  },
  {
    code: 'Y',
    explanation: 'The design of this part is unstable.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 545,
  },
  {
    code: 'Z',
    explanation: 'This part is a commercial/non-developmental/off-the-shelf-item.',
    valid_amcs: [1, 2, 3, 4, 5],
    source_line: 546,
  },
]

/**
 * The warning that governs every AMSC emission in this engine, quoted so it travels with the code
 * rather than living only in a comment a future edit can delete.
 */
export const AMSC_NOT_A_CLOSED_DOOR = cite({
  id: 'amsc_restricted_does_not_bar_surplus_supply',
  authority: 'ONLYSOURCE research digest, NSN cataloguing and interchangeability, section 7',
  identifier: 'Build implication beneath DoD 4100.39-M Volume 10 Chapter 4 Table 71',
  quote:
    'Do not conclude "closed" from AMSC alone. A restricted AMSC bars manufacturing by a new source. ' +
    'It does not by itself bar supplying new surplus of the originally approved article ... ' +
    'Traceability, not source approval, is the gate there ... This distinction must be encoded ' +
    "explicitly or the system will suppress Wayne's best leads.",
  source: `${NSN_DOC}:565`,
  verification: 'verified_primary',
})

/** The Table 71 transcription itself, cited whenever a code's explanation is rendered. */
export const AMSC_TABLE_CITATION = cite({
  id: 'amsc_table_71',
  authority: 'DoD 4100.39-M Volume 10, Chapter 4',
  identifier: 'Table 71, Acquisition Method Suffix Code',
  quote: null,
  source: `${NSN_DOC}:523-546`,
  verification: 'verified_primary',
})

/**
 * The competitive posture the source assigns to a code, or an honest admission that it assigns none.
 * The grouping is labelled ESTIMATED where it is stated, and that label rides with it here.
 */
export type AmscPosture =
  | 'open_to_surplus_dealer'
  | 'restricted_attackable'
  | 'restricted_closed_to_new_manufacturing_source'
  | 'unclassified_in_primary_source'

// ESTIMATED grouping, read at lines 557 to 559 (open), 561 (attackable) and 563 (closed).
// Ten of the twenty codes are grouped. The other ten are deliberately left unclassified.
const POSTURE_OPEN: readonly AmscCode[] = ['G', 'Z', 'L']
const POSTURE_ATTACKABLE: readonly AmscCode[] = ['B', 'C', 'D']
const POSTURE_CLOSED: readonly AmscCode[] = ['P', 'R', 'S', 'M']

export const AMSC_POSTURE_CITATION = cite({
  id: 'amsc_posture_grouping',
  authority: 'ONLYSOURCE research digest, NSN cataloguing and interchangeability, section 7',
  identifier: 'Build implication, open / restricted-but-attackable / restricted-closed grouping',
  quote: null,
  source: `${NSN_DOC}:553-564`,
  verification: 'estimated',
})

/** Look up a code in the transcribed table. Returns null for anything Table 71 does not contain. */
export function amscEntry(code: string | null | undefined): AmscEntry | null {
  if (typeof code !== 'string') return null
  const normalized = code.trim().toUpperCase()
  return AMSC_TABLE.find((e) => e.code === normalized) ?? null
}

/** Look up an AMC in the transcribed table. Returns null for anything Table 71 does not contain. */
export function amcEntry(code: number | null | undefined): AmcEntry | null {
  if (typeof code !== 'number' || !Number.isInteger(code)) return null
  return AMC_TABLE.find((e) => e.code === code) ?? null
}

/** The posture the source assigns, kept separate from the table so ESTIMATED never reads as VERIFIED. */
export function amscPosture(code: AmscCode): AmscPosture {
  if (POSTURE_OPEN.includes(code)) return 'open_to_surplus_dealer'
  if (POSTURE_ATTACKABLE.includes(code)) return 'restricted_attackable'
  if (POSTURE_CLOSED.includes(code)) return 'restricted_closed_to_new_manufacturing_source'
  return 'unclassified_in_primary_source'
}

/**
 * Whether an AMC and AMSC pair is one Table 70 permits.
 *
 * Worth having because an impossible pair means the catalogue row is wrong, and a wrong row scored
 * confidently is worse than a row scored 'unknown'. It answers 'unknown', not 'invalid', when either
 * code is absent from the tables, because absence of a code is not evidence of a bad combination.
 */
export function amcAmscCombinationValid(
  amc: number | null | undefined,
  amsc: string | null | undefined,
): 'valid' | 'invalid' | 'unknown' {
  const a = amcEntry(amc)
  const s = amscEntry(amsc)
  if (!a || !s) return 'unknown'
  return s.valid_amcs.includes(a.code) ? 'valid' : 'invalid'
}

/**
 * What an AMSC tells us about COMPETITION, which is the only thing it is allowed to tell us.
 *
 * `bars_surplus_supply_of_the_approved_article` is typed as the literal `false`, not as `boolean`.
 * That is the trap at the top of this file expressed in the type system: the day someone decides a
 * restricted AMSC should close a surplus row, the compiler stops them, and they have to come read
 * the warning quoted in `AMSC_NOT_A_CLOSED_DOOR` before they can proceed.
 */
export type AmscSignal = {
  readonly code: AmscCode | null
  /** False when the feed carried a character Table 71 does not list, which is a data defect. */
  readonly recognized: boolean
  readonly posture: AmscPosture | 'code_not_in_table_71'
  /** True for the seven codes the source groups as attackable or closed. */
  readonly restricted: boolean
  /**
   * True when the restriction implies few or no alternative approved manufacturing sources. This is
   * the signal the product is built to find, not a reason to hide the row.
   */
  readonly monopoly_shaped: boolean
  readonly bars_new_manufacturing_source: boolean
  /** ALWAYS false. See the file header and `AMSC_NOT_A_CLOSED_DOOR`. */
  readonly bars_surplus_supply_of_the_approved_article: false
  readonly explanation: string | null
  readonly table_citation: Citation
  readonly posture_citation: Citation
  readonly warning_citation: Citation
}

/** The one entry point the gate is allowed to use to read an AMSC, so the trap cannot be bypassed. */
export function amscCompetitionSignal(amsc: string | null | undefined): AmscSignal {
  const entry = amscEntry(amsc)
  if (!entry) {
    return {
      code: null,
      recognized: false,
      posture: 'code_not_in_table_71',
      restricted: false,
      monopoly_shaped: false,
      bars_new_manufacturing_source: false,
      bars_surplus_supply_of_the_approved_article: false,
      explanation: null,
      table_citation: AMSC_TABLE_CITATION,
      posture_citation: AMSC_POSTURE_CITATION,
      warning_citation: AMSC_NOT_A_CLOSED_DOOR,
    }
  }
  const posture = amscPosture(entry.code)
  const restricted =
    posture === 'restricted_attackable' || posture === 'restricted_closed_to_new_manufacturing_source'
  return {
    code: entry.code,
    recognized: true,
    posture,
    restricted,
    monopoly_shaped: restricted,
    bars_new_manufacturing_source: restricted,
    bars_surplus_supply_of_the_approved_article: false,
    explanation: entry.explanation,
    table_citation: AMSC_TABLE_CITATION,
    posture_citation: AMSC_POSTURE_CITATION,
    warning_citation: AMSC_NOT_A_CLOSED_DOOR,
  }
}
