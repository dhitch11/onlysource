/**
 * THE PRE-SUBMISSION VALIDATOR. The whole reason a batch quote writer earns its place.
 *
 * A DIBBS batch file that trips any of DLA's silent traps is not rejected with a helpful message
 * — it is quietly dropped from automated award, or read as something the vendor did not mean
 * (a $0.00 "no charge" bid). Nobody can proofread 121 quoted columns by eye. So every rule DLA
 * enforces silently, this validator enforces loudly, naming the failing field and the line.
 *
 * Two severities, never blurred:
 *   - `block`: the file will be mis-processed or the bid mis-read. Do not produce the file.
 *   - `warn`: legal, but a human should confirm it is intended (e.g. quoting former surplus,
 *     which also needs a web-form step batch cannot perform).
 *
 * It never throws and never guesses. A field it cannot evaluate (because the source row is
 * malformed) is reported as a block with that reason, not silently passed.
 */

import {
  COL,
  FIELD_COUNT,
  field,
  isAutomatedAward,
  isSpmSolicitation,
  isWellFormedRow,
  type SourceQuoteRow,
} from './format'

export type Severity = 'block' | 'warn'

export type QuoteProblem = {
  severity: Severity
  /** The DLA 1-based column the problem is about, or null for a whole-row problem. */
  column: number | null
  field: string | null
  /** The (solicitation, CLIN) key so a problem in a 75-line file is locatable. */
  line: string
  message: string
}

export type ValidationReport = {
  ok: boolean
  blocks: QuoteProblem[]
  warnings: QuoteProblem[]
}

const DELIVERY_MAX_DIGITS_DEFAULT = 4
const DELIVERY_MAX_DIGITS_SPM = 3

/** Validate one finished (vendor-overlaid) row against DLA's rules. Pure; never throws. */
export function validateRow(row: readonly string[], requestedDeliveryDays?: number): ValidationReport {
  const blocks: QuoteProblem[] = []
  const warnings: QuoteProblem[] = []
  const width = row.length

  if (!isWellFormedRow(row)) {
    blocks.push({
      severity: 'block',
      column: null,
      field: null,
      line: '(unknown)',
      message: `the row has ${width} fields, not ${FIELD_COUNT}; it is not a batch quote row`,
    })
    return { ok: false, blocks, warnings }
  }

  const line = `${field(row, COL.SOLICITATION_NUMBER)}::${field(row, COL.CLIN)}`
  const add = (severity: Severity, column: number | null, name: string | null, message: string) => {
    ;(severity === 'block' ? blocks : warnings).push({ severity, column, field: name, line, message })
  }

  const price = field(row, COL.UNIT_PRICE).trim()
  const days = field(row, COL.DELIVERY_DAYS).trim()

  // Trap 1 — remarks must be blank on an automated-award line.
  if (isAutomatedAward(row) && field(row, COL.QUOTE_REMARKS).trim() !== '') {
    add('block', COL.QUOTE_REMARKS, 'Quote Remarks',
      'remarks are present on a Fast-Auto/Auto-Eval solicitation; any text forces manual evaluation and drops the bid out of automated award')
  }

  // Trap 2 — the zero-price semantics. Blank price is invalid; the two zero cases mean different things.
  if (price === '') {
    add('block', COL.UNIT_PRICE, 'Unit Price', 'unit price is blank; DLA requires a price and a blank field is not "no bid"')
  } else if (!/^\d+(\.\d{1,5})?$/.test(price)) {
    add('block', COL.UNIT_PRICE, 'Unit Price', `unit price "${price}" is not a number with 0–5 decimals (".00000"–"9999999.99999")`)
  } else if (Number(price) === 0) {
    const zeroDays = days !== '' && Number(days) === 0
    add('warn', COL.UNIT_PRICE, 'Unit Price', zeroDays
      ? 'price 0 and delivery 0 reads to DLA as NO BID — confirm that is intended'
      : 'price 0 with a non-zero delivery reads to DLA as NO CHARGE (free) — confirm that is intended')
  }

  // Trap 3 — delivery days format and the SPM length rule.
  if (days === '') {
    add('block', COL.DELIVERY_DAYS, 'Delivery Days', 'delivery days is blank; DLA needs the offered delivery in whole days')
  } else if (!/^\d+$/.test(days)) {
    add('block', COL.DELIVERY_DAYS, 'Delivery Days', `delivery days "${days}" must be a whole number with no decimals`)
  } else {
    const maxDigits = isSpmSolicitation(row) ? DELIVERY_MAX_DIGITS_SPM : DELIVERY_MAX_DIGITS_DEFAULT
    if (days.length > maxDigits) {
      add('block', COL.DELIVERY_DAYS, 'Delivery Days',
        `delivery days "${days}" exceeds the ${maxDigits}-digit limit for this solicitation${isSpmSolicitation(row) ? ' (SPM solicitations cap at 3 digits)' : ''}`)
    }
    // Trap 5 — never quote more delivery days than the government asked for.
    if (typeof requestedDeliveryDays === 'number' && Number.isFinite(requestedDeliveryDays) && Number(days) > requestedDeliveryDays) {
      add('block', COL.DELIVERY_DAYS, 'Delivery Days',
        `offered ${days} days exceeds the ${requestedDeliveryDays} days the solicitation requires; a longer delivery is non-conforming`)
    }
  }

  // Auto-DQ gate: the conforming defaults that keep a bid in automated evaluation.
  const bidType = field(row, COL.BID_TYPE).trim().toUpperCase()
  if (isAutomatedAward(row) && bidType !== '' && bidType !== 'BI') {
    add('block', COL.BID_TYPE, 'Bid Type',
      `bid type "${bidType}" is not BI (Bid Without Exception); an exception drops the bid out of automated award`)
  }
  const childLabor = field(row, COL.CHILD_LABOR).trim().toUpperCase()
  if (childLabor !== '' && childLabor !== 'N') {
    add('block', COL.CHILD_LABOR, 'Child Labor',
      `child labor indicator "${childLabor}" is not N; a non-N value disqualifies the bid`)
  }

  // The vendor's own CAGE must be present and 5 characters.
  const cage = field(row, COL.QUOTER_CAGE).trim()
  if (cage === '') {
    add('block', COL.QUOTER_CAGE, 'Quoter CAGE', 'the quoter CAGE is blank; DLA cannot attribute the quote')
  } else if (cage.length !== 5) {
    add('block', COL.QUOTER_CAGE, 'Quoter CAGE', `the quoter CAGE "${cage}" is not 5 characters`)
  }

  // Former-government-surplus is legal but needs a web-form C04 step batch cannot perform.
  if (field(row, COL.MATERIAL_REQUIREMENTS).trim() === '4') {
    add('warn', COL.MATERIAL_REQUIREMENTS, 'Material Requirements',
      'this quote offers unused former government surplus (code 4), which requires a C04 surplus certification on the DIBBS web form that a batch file cannot carry — complete it online after upload')
  }

  return { ok: blocks.length === 0, blocks, warnings }
}

/** Validate a whole file's worth of rows. `requested` maps a row key to its required delivery days. */
export function validateFile(
  rows: readonly SourceQuoteRow[],
  requested?: (row: SourceQuoteRow) => number | undefined,
): ValidationReport {
  const blocks: QuoteProblem[] = []
  const warnings: QuoteProblem[] = []
  for (const row of rows) {
    const r = validateRow(row, requested?.(row))
    blocks.push(...r.blocks)
    warnings.push(...r.warnings)
  }
  if (rows.length > FIELD_COUNT_GUARD) {
    // A file this large is a caller bug (the outbox chunks at 75); flag rather than emit silently.
    warnings.push({
      severity: 'warn', column: null, field: null, line: '(file)',
      message: `${rows.length} rows in one file exceeds DLA's 75-line limit; the outbox must chunk before this`,
    })
  }
  return { ok: blocks.length === 0, blocks, warnings }
}

// Named for readability at the one call site; the 75-line ceiling lives in format.ts.
const FIELD_COUNT_GUARD = 75
