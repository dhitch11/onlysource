/**
 * T2 ACQUISITION. READING A BATCH-EXPORT WORKBOOK WITHOUT INHERITING ITS SILENT TRUNCATION.
 *
 * ---------------------------------------------------------------------------------------
 * ★ THIS IS NOT HYPOTHETICAL. IT HAS ALREADY HAPPENED AND WE ARE SERVING THE RESULT.
 * ---------------------------------------------------------------------------------------
 * Measured on the seven workbooks in `data/nsn-now/`, pulled 2026-08-15:
 *
 *     file      requested   history returned   missing   sheet at cap?
 *     full_1        1,138                783     355     YES  -> 355 UNKNOWN
 *     full_3        1,140                826     314     YES  -> 314 UNKNOWN
 *     full_2        1,140                905     235     no   ->  235 honestly absent
 *
 * `full_2`'s Procurement sheet stopped at 19,966 rows, 34 short of the ceiling, so nothing was
 * cut and its 235 silent stock numbers genuinely have no award history at DLA. `full_1` and
 * `full_3` stopped at exactly 20,000, which is not a number a natural distribution lands on.
 * Their 669 silent stock numbers were never answered about at all.
 *
 * **BOTH LOOK IDENTICAL IN THE FILE: the NSN is simply not on the sheet.** Load them the obvious
 * way and 669 stock numbers enter the index as "no award history", the pricing engine drops to
 * its weakest basis for each, and the resulting "the anchor abstains on 98%" is a fact about a
 * download that stopped early, not about the market.
 *
 *     THE PRODUCT MUST NOT BE ABLE TO CONFUSE "WE ASKED, AND THE ANSWER IS NOTHING"
 *     WITH "WE NEVER GOT AN ANSWER."
 *
 * So this module refuses to collapse them. Every requested stock number leaves here in exactly
 * one of three states, and `never_answered` is a first-class outcome that costs a re-request
 * rather than quietly becoming a zero.
 *
 * ---------------------------------------------------------------------------------------
 * THE CAP IS PER SHEET, WHICH IS NOT WHAT THE SITE SAYS
 * ---------------------------------------------------------------------------------------
 * The account page says "You can export 20,000 records in a single report". Measured, the
 * ceiling binds PER SHEET: `full_1` carries 4,890 MCRL + 20,000 Procurement + 2,197
 * Availability = 27,087 rows in one report. A guard written against the per-report number would
 * never fire. This one is written against the sheet, because that is where it was observed.
 */

import { readWorkbookSheets } from '../../intelligence/seed/xlsx'
import { RECORDS_PER_REPORT, assertNoTruncation, type TruncationVerdict } from './plan'

/**
 * The per-SHEET data-row ceiling. Same number as the per-report cap the site advertises, applied
 * where it was actually observed to bind. Kept as its own constant so the distinction survives:
 * if the vendor ever changes one and not the other, these must be free to diverge.
 */
export const SHEET_ROW_CAP = RECORDS_PER_REPORT

/** The column every sheet carries, and the only one we join on. */
export const NSN_COLUMN = 'NSN Number'

/**
 * Sheet names as the vendor writes them. Resolved BY NAME through workbook.xml, never by index,
 * so a report that drops or reorders a sheet fails loudly instead of reading the wrong one.
 */
export const SHEET_PROCUREMENT = 'Procurement'
export const SHEET_MCRL = 'MCRL'
export const SHEET_DLA_FORECAST = 'DLA Forecast'

export type SheetReading = {
  name: string
  /** Data rows, excluding the header. */
  dataRows: number
  /** Distinct non-empty stock numbers appearing on this sheet. */
  nsns: string[]
  /**
   * The sheet stopped at the ceiling. NOT proof of truncation on its own — a sheet can legitimately
   * hold exactly the cap — but it is the precondition for it, and combined with a requested stock
   * number that never appears it is conclusive.
   */
  atCap: boolean
}

export type WorkbookReading = {
  path: string
  sha256: string
  bytes: number
  sheets: SheetReading[]
}

/** Distinct, order-preserving, empties dropped. */
function distinct(values: readonly (string | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const s = (v ?? '').trim()
    if (s === '' || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** Read one workbook into per-sheet stock-number sets. IO lives here and nowhere else below. */
export function readBatchExportWorkbook(path: string): WorkbookReading {
  const wb = readWorkbookSheets(path)
  const sheets: SheetReading[] = []
  for (const [name, sheet] of wb.sheets) {
    const nsns = distinct(sheet.rows.map((r) => r[NSN_COLUMN] ?? null))
    sheets.push({
      name,
      dataRows: sheet.rows.length,
      nsns,
      atCap: sheet.rows.length >= SHEET_ROW_CAP,
    })
  }
  return {
    path,
    sha256: wb.provenance.sha256,
    bytes: wb.provenance.bytes,
    sheets,
  }
}

/* ---------------------------------------------------------------------------------------- */
/* THE THREE STATES. THE ENTIRE POINT OF THIS FILE.                                           */
/* ---------------------------------------------------------------------------------------- */

/**
 * What a batch export actually told us about one stock number, on one sheet.
 *
 * - `answered`      the sheet carries rows for it
 * - `absent`        we asked, the sheet did not carry it, and the sheet did NOT hit the ceiling.
 *                   The origin answered and the answer was nothing. Honest, usable, final.
 * - `never_answered` we asked, the sheet did not carry it, and the sheet stopped AT the ceiling.
 *                   We do not know. This must never be stored as a zero, shown as "none", or
 *                   counted in a denominator. It is a re-request.
 */
export type StockNumberState = 'answered' | 'absent' | 'never_answered'

export type SheetAudit = {
  sheet: string
  dataRows: number
  atCap: boolean
  requested: number
  answered: string[]
  absent: string[]
  neverAnswered: string[]
  /** The shared assertion, run on this sheet's stock numbers. */
  truncation: TruncationVerdict
}

/**
 * Grade every requested stock number against one sheet.
 *
 * ★ THE `atCap` TEST IS WHAT SEPARATES THE TWO SILENCES, and it is the only thing that can.
 * A row count cannot: a truncated sheet and a complete one both return the cap. The stock
 * numbers cannot on their own either: an NSN is missing in both cases. Only "is this sheet
 * sitting exactly on the ceiling" tells them apart, which is why it is measured and carried
 * rather than inferred at read time.
 */
export function auditSheet(input: {
  sheet: SheetReading
  requested: readonly string[]
}): SheetAudit {
  const present = new Set(input.sheet.nsns)
  const answered: string[] = []
  const silent: string[] = []
  for (const nsn of input.requested) {
    if (present.has(nsn)) answered.push(nsn)
    else silent.push(nsn)
  }
  return {
    sheet: input.sheet.name,
    dataRows: input.sheet.dataRows,
    atCap: input.sheet.atCap,
    requested: input.requested.length,
    answered,
    absent: input.sheet.atCap ? [] : silent,
    neverAnswered: input.sheet.atCap ? silent : [],
    truncation: assertNoTruncation({
      nsnsRequested: input.requested,
      nsnsSeenInResult: input.sheet.nsns,
      recordsReturned: input.sheet.dataRows,
      recordsPerReport: SHEET_ROW_CAP,
    }),
  }
}

export type WorkbookAudit = {
  path: string
  sha256: string
  sheets: SheetAudit[]
  /** Union across sheets of stock numbers we could not get an answer for. The re-request list. */
  neverAnswered: string[]
  /** True when any sheet was cut short. The workbook is still usable; it is just not complete. */
  truncated: boolean
}

/**
 * Audit a whole workbook against the stock numbers it was asked for.
 *
 * A truncated workbook is NOT rejected outright — the rows it did return are real and worth
 * having, and throwing them away would cost a report to re-learn. What must not survive is the
 * IMPRESSION of completeness, so the stock numbers we never got an answer for come back as an
 * explicit list for the caller to carry, re-request, and refuse to store as zeroes.
 */
export function auditWorkbook(input: {
  reading: WorkbookReading
  requested: readonly string[]
}): WorkbookAudit {
  const sheets = input.reading.sheets.map((sheet) =>
    auditSheet({ sheet, requested: input.requested }),
  )
  const never = new Set<string>()
  for (const s of sheets) for (const n of s.neverAnswered) never.add(n)
  return {
    path: input.reading.path,
    sha256: input.reading.sha256,
    sheets,
    neverAnswered: [...never],
    truncated: sheets.some((s) => s.truncation.truncated),
  }
}

/**
 * ★ THE PLANNING NUMBER, MEASURED RATHER THAN ASSUMED, AND MEASURED ON THE RIGHT DENOMINATOR.
 *
 * Rows per stock number REQUESTED, not per stock number that came back with something. You spend
 * your allowance on what you ASK for, and ~20% of a request returns nothing at all, so a density
 * computed over responders alone under-counts the request and overfills the next report.
 *
 * Measured on `full_2`, the only Procurement sheet that did not hit the ceiling (19,966 of 20,000
 * rows, so nothing was cut): 19,966 / 1,140 requested = **17.5 rows per requested stock number**.
 *
 * A sheet that DID hit the cap cannot be used for this: its density is inflated by construction,
 * because a fixed 20,000 rows gets divided by only the stock numbers that fit.
 */
export const MEASURED_ROWS_PER_REQUESTED_NSN = 17.5

/**
 * Stock numbers to put in one report.
 *
 * ★ NOT 20,000. That is the RECORD cap, and confusing the two is a 17.5x error that returns 5.7%
 * of a request as a clean-looking workbook. And not 1,140 either: that is the observed EDGE, and
 * two of the three files that used it overflowed. 900 x 17.5 = 15,750, which leaves room for a
 * batch denser than average without touching the ceiling.
 *
 * Wasting a fifth of a report is recoverable. Truncating one is not.
 */
export const SAFE_NSNS_PER_REPORT = 900
