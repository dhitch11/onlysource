/**
 * APPLYING A VENDOR QUOTE onto DLA's own pre-filled row.
 *
 * The input is the government's 121-field row for one (solicitation, CLIN) plus a small typed set
 * of vendor decisions. The output is a new 121-field row with ONLY the vendor columns overlaid.
 * Everything else is carried through byte-for-byte. This module never computes a price and never
 * imports the pricing engine: the four price figures are decided upstream and arrive here as
 * already-decided strings, so a fabrication in pricing cannot originate in the filing layer.
 *
 * Immutability is deliberate: the source row is never mutated in place, because the same daily
 * `bq` row is the template for re-quoting and a mutation would corrupt the next quote silently.
 */

import { COL, FIELD_COUNT, at, field, isWellFormedRow, type SourceQuoteRow } from './format'

/**
 * The vendor's decisions for one line. A field left `undefined` is NOT written — the row keeps
 * whatever DLA pre-filled. `unitPrice` and `deliveryDays` are strings, already formatted by the
 * caller (money to its decimals, days as an integer), so this layer performs no arithmetic and
 * cannot round or reformat a number into a different one.
 */
export type VendorQuote = {
  /** The vendor's own CAGE, 5 chars. Written to both quoter and quote-for unless overridden. */
  quoterCage: string
  quoteForCage?: string
  /** Already-formatted price string, e.g. "1620.00000". The caller owns the formatting. */
  unitPrice: string
  /** Integer delivery days as a string, e.g. "120". */
  deliveryDays: string
  /** Reps & certs codes; each written only if provided. */
  smallBusinessRep?: string
  affirmativeActionRep?: string
  previousContractsRep?: string
  altDisputeResolutionRep?: string
  buyAmericanRep?: string
  /** "4" for unused former government surplus; leave undefined for standard material. */
  materialRequirements?: string
  manufacturerOrDealer?: string
  actualMfgSourceCage?: string
  actualMfgSourceName?: string
  partNumberOfferedCode?: string
  partNumberOfferedCage?: string
  partNumberOffered?: string
  higherLevelQualityCode?: string
}

/** Set a field in a mutable working copy by 1-based column, only when the value is defined. */
function put(row: string[], column: number, value: string | undefined): void {
  if (value !== undefined) row[at(column)] = value
}

/**
 * Overlay a vendor quote onto a DLA source row and return a NEW 121-field row.
 *
 * Two things it always does, regardless of input, because they are conditions of an automated
 * award and forgetting either drops the bid out of automated evaluation:
 *   - blanks col 121 (quote remarks): any text there forces manual evaluation.
 *   - leaves bid type (col 24) exactly as DLA pre-filled it (BI), never overwriting it.
 * It does NOT decide whether the quote is valid — that is `validateRow`'s job, run after this.
 */
export function applyVendorQuote(source: readonly string[], quote: VendorQuote): SourceQuoteRow {
  const width = source.length
  if (!isWellFormedRow(source)) {
    throw new Error(`applyVendorQuote needs a ${FIELD_COUNT}-field source row, received ${width}`)
  }
  const row = source.slice()

  put(row, COL.QUOTER_CAGE, quote.quoterCage)
  put(row, COL.QUOTE_FOR_CAGE, quote.quoteForCage ?? quote.quoterCage)
  put(row, COL.UNIT_PRICE, quote.unitPrice)
  put(row, COL.DELIVERY_DAYS, quote.deliveryDays)
  put(row, COL.SMALL_BUSINESS_REP, quote.smallBusinessRep)
  put(row, COL.AFFIRMATIVE_ACTION_REP, quote.affirmativeActionRep)
  put(row, COL.PREVIOUS_CONTRACTS_REP, quote.previousContractsRep)
  put(row, COL.ALT_DISPUTE_RESOLUTION_REP, quote.altDisputeResolutionRep)
  put(row, COL.BUY_AMERICAN_END_PRODUCT_REP, quote.buyAmericanRep)
  put(row, COL.MATERIAL_REQUIREMENTS, quote.materialRequirements)
  put(row, COL.MANUFACTURER_OR_DEALER, quote.manufacturerOrDealer)
  put(row, COL.ACTUAL_MFG_SOURCE_CAGE, quote.actualMfgSourceCage)
  put(row, COL.ACTUAL_MFG_SOURCE_NAME, quote.actualMfgSourceName)
  put(row, COL.PART_NUMBER_OFFERED_CODE, quote.partNumberOfferedCode)
  put(row, COL.PART_NUMBER_OFFERED_CAGE, quote.partNumberOfferedCage)
  put(row, COL.PART_NUMBER_OFFERED, quote.partNumberOffered)
  put(row, COL.HIGHER_LEVEL_QUALITY_CODE, quote.higherLevelQualityCode)

  // Remarks must be blank on an automated-award line. Always enforced here so no caller can forget.
  row[at(COL.QUOTE_REMARKS)] = ''

  return row
}

/** The (solicitation, CLIN) natural key of a row — never the solicitation number alone. */
export function rowKey(row: SourceQuoteRow): string {
  return `${field(row, COL.SOLICITATION_NUMBER)}::${field(row, COL.CLIN)}`
}
