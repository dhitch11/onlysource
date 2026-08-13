/**
 * T2 INGESTION. The three DIBBS daily-feed parsers.
 *
 * All three read from the immutable archive, never from the network. Field positions are
 * VERIFIED against 3,095 real rows of feed day 2026-08-11 and are not re-derived here.
 *
 * The natural keys are MEASURED, and they differ between the two files, which is the single
 * most load-bearing fact in this module:
 *   index file  `in{YYMMDD}.txt`  (solicitation, nsn, pr)      unique 3,095 / 3,095
 *   quote file  `bq{YYMMDD}.txt`  (solicitation, CLIN)         unique 3,274 / 3,274
 * `solicitation_number` alone is NOT unique in either (3,095 rows carry 2,721 distinct, one
 * solicitation appears 23 times because DLA bundles many purchase requests under one number)
 * and (solicitation, pr) is not unique in either. Never join these files on solicitation.
 */

import { parseNsn, parseCage } from '../../intelligence/niin'
import { parseCsv, parseCsvByLine } from './csv'
import { assertion, assertRowCountBand, notLanded, assertNotAConsentBanner } from '../assert'
import type {
  ApprovedSourceObservation,
  ParseResult,
  QuarantineRow,
  QuoteLineObservation,
  RequirementObservation,
} from '../types'

/** The index file is fixed width. Every row is exactly this many characters. */
export const INDEX_ROW_WIDTH = 140

/**
 * Byte offsets of the index file, VERIFIED against 3,095 real rows. Do not re-derive.
 * `[26:62]` the part number was blank on all 3,095 rows of the measured day; a part-numbered
 * path exists in the layout and is rare.
 */
export const INDEX_OFFSETS = {
  solicitationNumber: [0, 13],
  nsn: [13, 26],
  partNumber: [26, 62],
  prNumber: [62, 72],
  returnBy: [72, 80],
  solicitationPdfName: [80, 99],
  quantity: [99, 106],
  unitOfIssue: [106, 108],
  nomenclature: [108, 129],
  codeBlock: [129, 140],
} as const

/** Field indexes of the 121-field quote file, VERIFIED by value distribution across 3,274 rows. */
export const QUOTE_FIELDS = {
  solicitationNumber: 0,
  returnBy: 4,
  clin: 43,
  prNumber: 45,
  nsn: 46,
  unitOfIssue: 47,
  quantity: 48,
  /** CONFIRMED delivery days ADO: 216 of 216 solicitation PDFs matched Block 6. */
  deliveryDaysAdo: 50,
  itemSourceCategory: 104,
} as const

export const QUOTE_FIELD_COUNT = 121
export const APPROVED_SOURCE_FIELD_COUNT = 4

type ParseContext = {
  sourceKey: string
  logicalDate: string
  storageKey: string
  observedAt: string
  /** Row counts of prior successful loads, for the band assertion. Empty on a first load. */
  history?: number[]
}

function slice(row: string, span: readonly [number, number] | number[]): string {
  return row.slice(span[0] as number, span[1] as number).trim()
}

/**
 * `MM/DD/YY` to an ISO date.
 *
 * The century is INFERRED as 2000 + yy. That inference is safe for this feed for the
 * foreseeable life of the product and it is stated rather than hidden: a solicitation return
 * date is always in the near future, and DIBBS has published this two-digit form for
 * decades. A date that does not match the shape returns null and the row is quarantined
 * rather than defaulted to today, which is the coercion that makes a deadline lie.
 */
export function parseFeedDate(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value.trim())
  if (!m) return null
  const [, mm, dd, yy] = m
  const month = Number(mm)
  const day = Number(dd)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `20${yy}-${mm}-${dd}`
}

/** `MM/DD/YYYY`, the form the quote file uses. Different file, different shape, stated. */
export function parseQuoteDate(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
  if (!m) return null
  const [, mm, dd, yyyy] = m
  const month = Number(mm)
  const day = Number(dd)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Parse the fixed-width requirement index.
 *
 * A row of the wrong width is a LAYOUT CHANGE, not a bad row. It stops the load rather than
 * filling the quarantine, because a shifted layout produces rows that parse cleanly into the
 * wrong columns, and a quarantine full of them looks like a data-quality problem when it is
 * actually a schema event.
 */
export function parseDibbsIndex(text: string, ctx: ParseContext): ParseResult<RequirementObservation> {
  const rows: RequirementObservation[] = []
  const quarantined: QuarantineRow[] = []
  const assertions = []

  assertions.push(assertNotAConsentBanner('dibbs.index.not_banner', text, null))

  const lines = text.split('\n').filter((l) => l !== '')
  const badWidth = lines
    .map((l, i) => ({ width: l.replace(/\r$/, '').length, lineNo: i + 1 }))
    .filter((x) => x.width !== INDEX_ROW_WIDTH)

  assertions.push(
    assertion(
      'dibbs.index.row_width',
      `every row is exactly ${INDEX_ROW_WIDTH} characters`,
      badWidth.length === 0,
      `0 rows of a width other than ${INDEX_ROW_WIDTH}`,
      badWidth.length === 0
        ? `0 of ${lines.length} rows off-width`
        : `${badWidth.length} rows off-width, first at line ${badWidth[0]?.lineNo} width ${badWidth[0]?.width}`,
    ),
  )

  // A layout change stops the load. Return what we know and let the caller refuse to commit.
  if (badWidth.length > 0) {
    return { rows: [], quarantined: [], assertions, linesRead: lines.length }
  }

  let byteOffset = 0
  lines.forEach((rawLine, index) => {
    const lineNo = index + 1
    const row = rawLine.replace(/\r$/, '')
    const offsetOfThisLine = byteOffset
    byteOffset += rawLine.length + 1

    const solicitationNumber = slice(row, INDEX_OFFSETS.solicitationNumber)
    const nsnRaw = slice(row, INDEX_OFFSETS.nsn)
    const prNumber = slice(row, INDEX_OFFSETS.prNumber)
    const returnByRaw = slice(row, INDEX_OFFSETS.returnBy)
    const quantityRaw = slice(row, INDEX_OFFSETS.quantity)
    const codeBlock = slice(row, INDEX_OFFSETS.codeBlock)

    const quarantine = (ruleId: string, detail: string): void => {
      quarantined.push({
        sourceKey: ctx.sourceKey,
        storageKey: ctx.storageKey,
        logicalDate: ctx.logicalDate,
        lineNo,
        byteOffset: offsetOfThisLine,
        rawLine: row,
        ruleId,
        severity: 'reject',
        detail,
      })
    }

    if (solicitationNumber === '') {
      quarantine('index.solicitation_missing', 'solicitation number is blank')
      return
    }
    if (prNumber === '') {
      quarantine('index.pr_missing', 'purchase request number is blank')
      return
    }

    // The NSN is allowed to be absent or malformed. 9 of the 3,095 measured rows are not
    // well-formed 13-digit NSNs and they are REAL requirements, so they load with a null
    // NIIN and a stated reason rather than being discarded.
    const parsedNsn = parseNsn(nsnRaw)
    const returnBy = parseFeedDate(returnByRaw)
    if (returnByRaw !== '' && returnBy === null) {
      quarantine('index.return_by_unparseable', `return-by "${returnByRaw}" is not MM/DD/YY`)
      return
    }

    const quantity = /^\d+$/.test(quantityRaw) ? Number(quantityRaw) : null
    if (quantityRaw !== '' && quantity === null) {
      quarantine('index.quantity_not_numeric', `quantity "${quantityRaw}" is not numeric`)
      return
    }

    // The 8th character of the code block. Only the N versus not-N binary is confirmed.
    const setAsideCode = codeBlock.charAt(7)

    rows.push({
      solicitationNumber,
      nsnRaw,
      niin: parsedNsn?.niin ?? null,
      fsc: parsedNsn?.fsc ?? null,
      partNumber: slice(row, INDEX_OFFSETS.partNumber) || null,
      prNumber,
      returnBy,
      quantity,
      unitOfIssue: slice(row, INDEX_OFFSETS.unitOfIssue),
      nomenclature: slice(row, INDEX_OFFSETS.nomenclature),
      solicitationPdfName: slice(row, INDEX_OFFSETS.solicitationPdfName),
      codeBlock,
      setAsideCode,
      setAsideRestricted: setAsideCode !== 'N',
      observedAt: ctx.observedAt,
      sourceKey: ctx.sourceKey,
      storageKey: ctx.storageKey,
      lineNo,
    })
  })

  assertions.push(assertRowCountBand('dibbs.index.row_count_band', rows.length, ctx.history ?? []))

  // The canary: a well-formed NSN must come back. A file of 3,095 rows that yields zero
  // parseable stock numbers parsed cleanly into the wrong columns.
  const withNiin = rows.filter((r) => r.niin !== null).length
  assertions.push(
    assertion(
      'dibbs.index.niin_canary',
      'at least 90 percent of loaded rows carry a parseable NIIN',
      rows.length > 0 && withNiin / rows.length >= 0.9,
      'at least 90 percent',
      rows.length === 0
        ? 'no rows loaded'
        : `${withNiin} of ${rows.length} (${((withNiin / rows.length) * 100).toFixed(1)} percent)`,
    ),
  )

  return { rows, quarantined, assertions, linesRead: lines.length }
}

/**
 * Parse the approved-source file, which is the highest-value artifact in the free feed.
 *
 * This is the file that carries the measured swallowed-row defect, so the one-record-per-line
 * assertion here is not a formality. It is the detector.
 */
export function parseApprovedSource(
  text: string,
  ctx: ParseContext,
): ParseResult<ApprovedSourceObservation> {
  const rows: ApprovedSourceObservation[] = []
  const quarantined: QuarantineRow[] = []
  const assertions = []

  assertions.push(assertNotAConsentBanner('dibbs.as.not_banner', text, null))

  // LINE-ORIENTED, deliberately. This file is one record per line, and a strict RFC 4180
  // parse of it loses 2,721 of 3,684 rows to a single malformed line. See parseCsvByLine.
  const parsed = parseCsvByLine(text)

  // Lines carrying an odd number of quote characters are malformed and would, under a
  // whole-file parse, swallow everything after them. Named here so the count is visible
  // rather than inferred from a shortfall.
  const oddQuoteLines = text
    .split('\n')
    .map((l, i) => ({ line: l.replace(/\r$/, ''), lineNo: i + 1 }))
    .filter((x) => x.line !== '' && (x.line.match(/"/g) ?? []).length % 2 === 1)

  assertions.push(
    assertion(
      'dibbs.as.balanced_quotes',
      'no line carries an odd number of quote characters',
      oddQuoteLines.length === 0,
      '0 lines with unbalanced quotes',
      oddQuoteLines.length === 0
        ? `0 of ${parsed.records.length} lines unbalanced`
        : `${oddQuoteLines.length} unbalanced line(s), first at line ${oddQuoteLines[0]?.lineNo}: a whole-file RFC 4180 parse would swallow the remainder of the file here`,
    ),
  )

  for (const record of parsed.records) {
    const quarantine = (ruleId: string, detail: string): void => {
      quarantined.push({
        sourceKey: ctx.sourceKey,
        storageKey: ctx.storageKey,
        logicalDate: ctx.logicalDate,
        lineNo: record.startLine,
        byteOffset: record.byteOffset,
        rawLine: record.fields.join(','),
        ruleId,
        severity: 'reject',
        detail,
      })
    }

    if (record.fields.length !== APPROVED_SOURCE_FIELD_COUNT) {
      quarantine(
        'as.field_count',
        `expected ${APPROVED_SOURCE_FIELD_COUNT} fields, found ${record.fields.length}`,
      )
      continue
    }

    const [nsnRaw = '', cageRaw = '', partNumber = ''] = record.fields
    const parsedNsn = parseNsn(nsnRaw)
    if (!parsedNsn) {
      quarantine('as.nsn_unparseable', `"${nsnRaw}" is not an NSN or NIIN`)
      continue
    }
    const cage = parseCage(cageRaw)
    if (cage === null) {
      quarantine('as.cage_shape', `"${cageRaw}" is not a 5 character CAGE code`)
      continue
    }

    rows.push({
      nsnRaw,
      niin: parsedNsn.niin,
      cage,
      partNumber,
      observedAt: ctx.observedAt,
      sourceKey: ctx.sourceKey,
      storageKey: ctx.storageKey,
      lineNo: record.startLine,
    })
  }

  // THE RECONCILIATION. Every physical line is either loaded or held, never neither.
  // This is the assertion that would have caught the 2,721-row loss, because it compares the
  // OUTPUT against the file rather than comparing the parser against itself.
  assertions.push(
    assertion(
      'dibbs.as.full_accounting',
      'every non-empty physical line is either loaded or quarantined',
      rows.length + quarantined.length === parsed.records.length,
      `${parsed.records.length} lines accounted for`,
      `${rows.length} loaded + ${quarantined.length} quarantined = ${rows.length + quarantined.length} of ${parsed.records.length} lines`,
    ),
  )

  assertions.push(
    assertion(
      'dibbs.bq.full_accounting',
      'every non-empty physical line is either loaded or quarantined',
      rows.length + quarantined.length === parsed.records.length,
      `${parsed.records.length} lines accounted for`,
      `${rows.length} loaded + ${quarantined.length} quarantined = ${rows.length + quarantined.length} of ${parsed.records.length} lines`,
    ),
  )

  return { rows, quarantined, assertions, linesRead: parsed.physicalLines }
}

/** Parse the 121-field quote file. Every field is loaded by position, known meaning or not. */
export function parseQuoteFile(text: string, ctx: ParseContext): ParseResult<QuoteLineObservation> {
  const rows: QuoteLineObservation[] = []
  const quarantined: QuarantineRow[] = []
  const assertions = []

  assertions.push(assertNotAConsentBanner('dibbs.bq.not_banner', text, null))

  // One record per line, same reasoning as the approved-source file.
  const parsed = parseCsvByLine(text)
  const wrongWidth = parsed.records.filter((r) => r.fields.length !== QUOTE_FIELD_COUNT)
  assertions.push(
    assertion(
      'dibbs.bq.field_count',
      `every record carries exactly ${QUOTE_FIELD_COUNT} fields`,
      wrongWidth.length === 0,
      `0 records off-width`,
      wrongWidth.length === 0
        ? `0 of ${parsed.records.length} records off-width`
        : `${wrongWidth.length} records off-width, first at line ${wrongWidth[0]?.startLine} with ${wrongWidth[0]?.fields.length} fields`,
    ),
  )

  for (const record of parsed.records) {
    const f = (i: number): string => (record.fields[i] ?? '').trim()
    const quarantine = (ruleId: string, detail: string): void => {
      quarantined.push({
        sourceKey: ctx.sourceKey,
        storageKey: ctx.storageKey,
        logicalDate: ctx.logicalDate,
        lineNo: record.startLine,
        byteOffset: record.byteOffset,
        rawLine: record.fields.slice(0, 8).join(','),
        ruleId,
        severity: 'reject',
        detail,
      })
    }

    if (record.fields.length !== QUOTE_FIELD_COUNT) {
      quarantine('bq.field_count', `expected ${QUOTE_FIELD_COUNT} fields, found ${record.fields.length}`)
      continue
    }

    const solicitationNumber = f(QUOTE_FIELDS.solicitationNumber)
    const clin = f(QUOTE_FIELDS.clin)
    if (solicitationNumber === '' || clin === '') {
      quarantine('bq.key_missing', 'solicitation number or CLIN is blank, so the record has no key')
      continue
    }

    const nsnRaw = f(QUOTE_FIELDS.nsn)
    const parsedNsn = parseNsn(nsnRaw)
    const deliveryRaw = f(QUOTE_FIELDS.deliveryDaysAdo)
    const quantityRaw = f(QUOTE_FIELDS.quantity)

    rows.push({
      solicitationNumber,
      clin,
      prNumber: f(QUOTE_FIELDS.prNumber),
      nsnRaw,
      niin: parsedNsn?.niin ?? null,
      unitOfIssue: f(QUOTE_FIELDS.unitOfIssue),
      quantity: /^\d+(\.\d+)?$/.test(quantityRaw) ? Number(quantityRaw) : null,
      returnBy: parseQuoteDate(f(QUOTE_FIELDS.returnBy)),
      deliveryDaysAdo: /^\d+$/.test(deliveryRaw) ? Number(deliveryRaw) : null,
      itemSourceCategory: f(QUOTE_FIELDS.itemSourceCategory),
      observedAt: ctx.observedAt,
      sourceKey: ctx.sourceKey,
      storageKey: ctx.storageKey,
      lineNo: record.startLine,
    })
  }

  assertions.push(assertRowCountBand('dibbs.bq.row_count_band', rows.length, ctx.history ?? []))

  const withDelivery = rows.filter((r) => r.deliveryDaysAdo !== null).length
  assertions.push(
    rows.length === 0
      ? notLanded('dibbs.bq.delivery_canary', 'delivery days present on most rows', 'no rows loaded')
      : assertion(
          'dibbs.bq.delivery_canary',
          'at least 90 percent of rows carry a numeric delivery-days value',
          withDelivery / rows.length >= 0.9,
          'at least 90 percent',
          `${withDelivery} of ${rows.length}`,
        ),
  )

  return { rows, quarantined, assertions, linesRead: parsed.physicalLines }
}
