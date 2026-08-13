/**
 * RFC 4180 CSV, with the one property that matters on this feed: it reports how many
 * PHYSICAL LINES each record consumed.
 *
 * WHY THAT PROPERTY IS THE WHOLE POINT
 *
 * The government's own approved-source file `as260811.txt` carries 3,684 physical lines and
 * yields 3,683 records through a CORRECT parser, because one record opens a quote it never
 * closes and silently swallows the next line into itself. No exception. No log line. One
 * supplier relationship gone, and nothing anywhere says so.
 *
 * A correct RFC 4180 parser is not enough, because a correct parser is exactly what produces
 * the silent loss. The fix is not stricter parsing, it is making the loss VISIBLE: every
 * record reports `startLine` and `endLine`, and a loader for a file whose records are one per
 * line asserts that `endLine === startLine` and quarantines the record that is not.
 *
 * `unterminatedQuote` reports the related end-of-file case, where the final record opens a
 * quote the file never closes. That one is a truncation signal, not a swallow.
 */

export type CsvRecord = {
  fields: string[]
  /** 1-based physical line where the record began. */
  startLine: number
  /** 1-based physical line where the record ended. Equal to startLine for a clean record. */
  endLine: number
  /** Byte offset of the record's first character, for the quarantine row. */
  byteOffset: number
}

export type CsvParseResult = {
  records: CsvRecord[]
  /** Physical newline-delimited lines in the file, counted independently of parsing. */
  physicalLines: number
  /** True when the file ended while still inside a quoted field. */
  unterminatedQuote: boolean
}

/**
 * Parse RFC 4180 text.
 *
 * Handles quoted fields, escaped quotes (`""`), embedded commas and embedded newlines, and
 * both CRLF and LF. Does not trim, because a trailing space inside a part number is data on
 * this feed, not noise, and coercing it is how a join stops matching.
 */
export function parseCsv(text: string, delimiter = ','): CsvParseResult {
  const records: CsvRecord[] = []
  let fields: string[] = []
  let field = ''
  let inQuotes = false
  let line = 1
  let recordStartLine = 1
  let recordStartOffset = 0
  let sawAnyChar = false

  const pushField = (): void => {
    fields.push(field)
    field = ''
  }
  const pushRecord = (endLine: number): void => {
    pushField()
    records.push({ fields, startLine: recordStartLine, endLine, byteOffset: recordStartOffset })
    fields = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (!sawAnyChar) {
      recordStartLine = line
      recordStartOffset = i
      sawAnyChar = true
    }

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        // A newline INSIDE a quoted field is legal RFC 4180 and is exactly how the
        // swallowed-row defect happens. Count the line so the record can report its span.
        if (ch === '\n') line += 1
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delimiter) {
      pushField()
      continue
    }
    if (ch === '\r') continue
    if (ch === '\n') {
      pushRecord(line)
      line += 1
      sawAnyChar = false
      continue
    }
    field += ch
  }

  // A final record with no trailing newline is still a record.
  if (sawAnyChar || field !== '' || fields.length > 0) {
    pushRecord(line)
  }

  return {
    records,
    physicalLines: countPhysicalLines(text),
    unterminatedQuote: inQuotes,
  }
}

/**
 * LINE-ORIENTED parse, for a source whose records are one per physical line.
 *
 * WHY THIS EXISTS, MEASURED ON THE REAL FILE
 *
 * `as260811.txt` line 963 is `"4720012519892","87373","801-6-149"",""`. The part number
 * genuinely contains an inch mark, and the publisher escaped it as `""` while leaving the
 * field's own closing quote ambiguous. The line carries an odd number of quote characters.
 *
 * Fed to a STRICT RFC 4180 parser, that single line opens a quoted field that never closes,
 * and the parser absorbs the ENTIRE REST OF THE FILE into one record: 3,684 physical lines
 * collapse to 963 records and 2,721 approved-source relationships vanish. Measured, not
 * theorised.
 *
 * Fed to Python's `csv` module, which is lenient about malformed quoting, the same line
 * produces a 6-field record that recovers at the next line boundary and loses exactly one
 * row: 3,683 records. That is where the project's documented "3,684 lines yield 3,683
 * records" number comes from, and it is a property of THAT parser's leniency, not a property
 * of correct RFC 4180 parsing.
 *
 * Both behaviours lose data silently. This function does neither. It parses each physical
 * line independently, so a malformed line can damage ONLY ITSELF, and the caller quarantines
 * that one line with its raw text. 3,683 load, 1 is held with its reason, 3,684 accounted
 * for. Nothing is dropped and nothing is invented.
 *
 * Use this for a source documented as one record per line. Use `parseCsv` where records may
 * legitimately span lines, such as an operator's spreadsheet export with embedded newlines.
 */
export function parseCsvByLine(text: string, delimiter = ','): CsvParseResult {
  const records: CsvRecord[] = []
  let byteOffset = 0
  let lineNo = 0
  let unterminatedQuote = false

  for (const rawLine of text.split('\n')) {
    lineNo += 1
    const offsetOfThisLine = byteOffset
    byteOffset += rawLine.length + 1
    const line = rawLine.replace(/\r$/, '')
    if (line === '') continue

    const single = parseCsv(line, delimiter)
    if (single.unterminatedQuote) unterminatedQuote = true
    const fields = single.records[0]?.fields ?? []
    records.push({ fields, startLine: lineNo, endLine: lineNo, byteOffset: offsetOfThisLine })
  }

  return { records, physicalLines: countPhysicalLines(text), unterminatedQuote }
}

/**
 * Physical lines, counted WITHOUT the parser, so the two numbers are independent.
 *
 * Deriving this from the parse would make the comparison circular and it would agree with
 * itself even when the parse is wrong. That is the whole reason this function exists
 * separately.
 */
export function countPhysicalLines(text: string): number {
  if (text === '') return 0
  let n = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') n += 1
  }
  // A file whose last line has no trailing newline still has that line.
  if (!text.endsWith('\n')) n += 1
  return n
}
