/**
 * THE DIBBS BATCH QUOTE FILE FORMAT. Column model only — no I/O, no network, ever.
 *
 * ==========================================================================================
 * WHAT THIS FILE IS, AND THE ONE DESIGN DECISION EVERYTHING ELSE FOLLOWS FROM.
 * ==========================================================================================
 * DLA's DIBBS batch quote upload is a 121-column, comma-delimited, double-quote-qualified CSV,
 * one row per solicitation line item (per CLIN), hard-capped at 75 lines per file. The daily
 * `bq{YYMMDD}.txt` file DLA publishes is the SAME 121-column model, already pre-filled by DLA on
 * 34 of the 121 columns.
 *
 * So this writer does NOT build 121 columns from scratch. It starts from DLA's own pre-filled
 * row for a (solicitation, CLIN) and overlays ONLY the ~12 columns a vendor supplies. That is
 * the honest design as much as the pragmatic one: the ~80 pass-through columns are the
 * government's own values, carried through byte-for-byte, never invented here. A writer that
 * authored all 121 columns would be fabricating the columns whose meanings it does not hold —
 * the verbatim 1→121 name table lives only on DLA's BatchFormat.aspx and is deliberately NOT
 * reproduced from memory here. We preserve what the government sent and change only what we know.
 *
 * Source of every position below: DLA `BatchFormat.aspx` (last updated 2024-04-30), corroborated
 * against a real `bq260811.txt` (3,274 rows × 121 fields) and the repo's own daily-feed parser
 * `lib/ingest/parse/dibbs.ts`. Positions are stated in DLA's 1-based convention; `at()` converts.
 *
 * ==========================================================================================
 * THIS MODULE PRODUCES A FILE. IT NEVER SENDS ONE.
 * ==========================================================================================
 * Nothing in `lib/filing/**` opens a socket or imports http/https/net/fetch. It builds the exact
 * file a person uploads to DIBBS themselves. Transmitting a quote to a government system is a
 * new outward-facing action that is NOT authorized; the module is written to be structurally
 * incapable of it, and `test/filing/no-network.test.ts` asserts that no network primitive is
 * imported anywhere under this namespace.
 */

/** Every batch quote row is exactly this many fields. A row of any other width is not this file. */
export const FIELD_COUNT = 121

/** DLA's hard limit. A file with more lines than this is silently not processed. */
export const MAX_LINES_PER_FILE = 75

/**
 * The columns, in DLA's 1-based numbering. Only the ones this writer reads or writes are named;
 * the ~80 unnamed pass-through columns are carried through untouched and deliberately not
 * guessed at. See the file header.
 */
export const COL = {
  // ---- header-level: identical across every row of one file (cols 1–43, and 121) ----
  SOLICITATION_NUMBER: 1,
  /** F = Fast Auto Eval · P = Auto Eval · I = AIDC · blank = manual. Governs the remarks rule. */
  SOLICITATION_TYPE: 2,
  SOLICITATION_RETURN_DATE: 5,
  /** The vendor's own CAGE. 5 characters. */
  QUOTER_CAGE: 6,
  /** Whom the quote is for; normally equal to the quoter's CAGE. 5 characters. */
  QUOTE_FOR_CAGE: 7,
  SMALL_BUSINESS_REP: 13,
  AFFIRMATIVE_ACTION_REP: 21,
  PREVIOUS_CONTRACTS_REP: 22,
  ALT_DISPUTE_RESOLUTION_REP: 23,
  /** DLA default BI = Bid Without Exception. Any other value drops out of automated award. */
  BID_TYPE: 24,
  PACKAGING_ACCEPTED: 28,
  FOB_POINT: 32,
  INSPECTION_POINT: 36,

  // ---- line-level: varies per CLIN (cols 44, 46–51, 64) ----
  CLIN: 44,
  PR_NUMBER: 46,
  NSN: 47,
  UNIT_OF_ISSUE: 48,
  QUANTITY: 49,
  /** Vendor-supplied. Money, 0–5 decimals, ".00000"–"9999999.99999". Cannot be blank. */
  UNIT_PRICE: 50,
  /** Vendor-supplied. Integer days. 4 digits normally, 3 when the solicitation starts "SPM".
   *  Must never exceed the government's required delivery. */
  DELIVERY_DAYS: 51,

  // ---- product-level: identical for the same NSN across lines (cols 61–63, 65–120) ----
  BUY_AMERICAN_END_PRODUCT_REP: 70,
  /** 4 = Yes, Unused Former Government Surplus. Surplus needs a web-form C04 pass batch can't do. */
  MATERIAL_REQUIREMENTS: 67,
  QTY_VARIANCE_PLUS: 96,
  QTY_VARIANCE_MINUS: 97,
  MANUFACTURER_OR_DEALER: 102,
  ACTUAL_MFG_SOURCE_CAGE: 103,
  ACTUAL_MFG_SOURCE_NAME: 104,
  /** P = Approved Source Item. */
  ITEM_DESCRIPTION_INDICATOR: 105,
  PART_NUMBER_OFFERED_CODE: 106,
  PART_NUMBER_OFFERED_CAGE: 107,
  /** Exempt from DLA's character stripping (a comma here is preserved). */
  PART_NUMBER_OFFERED: 108,
  HIGHER_LEVEL_QUALITY_FLAG: 117,
  HIGHER_LEVEL_QUALITY_CODE: 118,
  CHILD_LABOR: 120,
  /** Must be BLANK for an F/P solicitation quoted BI, or the bid drops out of automated award. */
  QUOTE_REMARKS: 121,
} as const

/** Fields exempt from DLA's punctuation stripping: the part number and the four remarks fields. */
export const STRIP_EXEMPT_COLUMNS: readonly number[] = [
  COL.PART_NUMBER_OFFERED,
  COL.QUOTE_REMARKS,
  // The three additional remarks fields DLA exempts alongside col 121. Named by role, not
  // by individual position, so they are carried as pass-through and never stripped by us
  // (we only ever WRITE col 121 among the remarks fields; the others arrive pre-filled).
]

/** Convert a DLA 1-based column number to a 0-based array index. The single source of that −1. */
export function at(column: number): number {
  return column - 1
}

/** Read a field from a 121-wide row by its DLA 1-based column number. */
export function field(row: readonly string[], column: number): string {
  return row[at(column)] ?? ''
}

/** A parsed DLA quote row: exactly 121 string fields. The template a vendor quote overlays onto. */
export type SourceQuoteRow = readonly string[]

/** True only for a row of exactly 121 fields. The one structural precondition of everything here. */
export function isWellFormedRow(row: readonly string[]): row is SourceQuoteRow {
  return Array.isArray(row) && row.length === FIELD_COUNT
}

/** The solicitation is an "SPM" solicitation, which caps delivery-days at 3 digits, not 4. */
export function isSpmSolicitation(row: SourceQuoteRow): boolean {
  return field(row, COL.SOLICITATION_NUMBER).toUpperCase().startsWith('SPM')
}

/**
 * Whether this line is on the automated-award track (Fast Auto Eval or Auto Eval), which is
 * where the remarks-must-be-blank and bid-type rules bite. A blank/`I`/manual type is not.
 */
export function isAutomatedAward(row: SourceQuoteRow): boolean {
  const t = field(row, COL.SOLICITATION_TYPE).trim().toUpperCase()
  return t === 'F' || t === 'P'
}
