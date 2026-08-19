/**
 * CSV SERIALIZATION for the DIBBS batch quote file, and the character-stripping rule.
 *
 * DLA reads a comma-delimited, double-quote-qualified CSV. We quote EVERY field (uniform, so a
 * value that happens to contain a comma or quote can never shift the column count — the defect
 * that silently corrupts a whole row). A double-quote inside a value is escaped by doubling it,
 * per RFC 4180, which DLA's reader follows.
 *
 * THE STRIPPING RULE IS DLA'S, AND WE APPLY IT OURSELVES SO WHAT WE WRITE IS WHAT DLA STORES.
 * On import DLA strips `,'~`!@#$%^&*;{}[]|\+=?;<>` and any character below ASCII 32 or above 126,
 * from every field EXCEPT the part-number field and the remarks fields. If we did not apply it,
 * a value would look right in our file and arrive different at DLA — the writer would be lying
 * about what it produced. So we strip the same characters from the same fields, and leave the
 * exempt fields alone (a comma in a part number is real data DLA keeps).
 *
 * No I/O here. These functions turn arrays into strings and back; a caller decides what to do
 * with the string, and the only sanctioned thing is to hand it to a person.
 */

import { FIELD_COUNT, STRIP_EXEMPT_COLUMNS, at, isWellFormedRow, type SourceQuoteRow } from './format'

/** The exact set DLA strips, plus control/high characters, applied to non-exempt fields. */
const STRIPPED = new Set(",'~`!@#$%^&*;{}[]|\\+=?<>".split(''))

/** Apply DLA's stripping to one field value. Exempt columns pass through untouched. */
export function stripField(value: string, column: number): string {
  if (STRIP_EXEMPT_COLUMNS.includes(column)) return value
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 32 || code > 126) continue
    if (STRIPPED.has(ch)) continue
    out += ch
  }
  return out
}

/** Quote one field for CSV output: wrap in double quotes, double any embedded double quote. */
export function quoteField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Serialize a single 121-field row to one CSV line, applying DLA's stripping first.
 *
 * Throws on a row that is not exactly 121 fields. A short or long row is not this file, and a
 * writer that silently padded or truncated it would produce a file DLA rejects with no
 * explanation the operator can act on.
 */
export function serializeRow(row: readonly string[]): string {
  const width = row.length
  if (!isWellFormedRow(row)) {
    throw new Error(`a batch quote row must have exactly ${FIELD_COUNT} fields, received ${width}`)
  }
  return row.map((value, i) => quoteField(stripField(value ?? '', i + 1))).join(',')
}

/** Serialize many rows to a file body, one row per line, trailing newline. */
export function serializeRows(rows: readonly SourceQuoteRow[]): string {
  return rows.map(serializeRow).join('\n') + '\n'
}

/**
 * Parse a quoted-CSV line back into fields. Used only by the round-trip test that proves the
 * serializer and the field model agree; it is not a general CSV parser and expects our own output.
 */
export function parseLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

/** A stable checksum of a file body, for the companion sheet. FNV-1a: no crypto, no I/O, tiny. */
export function checksum(body: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export { at }
