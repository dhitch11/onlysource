/**
 * THE OUTBOX. Chunk validated quote rows into ≤75-line files a person uploads, each with a
 * human-readable companion sheet. IN MEMORY ONLY — this returns file contents as strings; it
 * writes nothing to disk and opens no connection. A caller (a page the operator drives) hands
 * the results to a download. Nothing here transmits to DIBBS or anywhere else.
 *
 * The companion sheet exists because nobody can proofread 121 quoted columns: it states, per
 * file, how many lines, which solicitations, the vendor CAGE, the price and delivery on each
 * line, and a checksum — so an operator can confirm the file before uploading it.
 */

import { serializeRows, checksum } from './csv'
import { COL, MAX_LINES_PER_FILE, field, type SourceQuoteRow } from './format'
import { rowKey } from './quote'
import { validateFile, type QuoteProblem } from './validate'

export type QuoteFile = {
  /** 1-based index of this file within the batch, and the total, for "file 2 of 41". */
  index: number
  total: number
  /** Suggested filename, e.g. "onlysource-quotes-2026-08-18-02of41.csv". */
  filename: string
  /** The CSV body a person uploads to DIBBS. */
  body: string
  /** A plain-language sheet describing exactly what is in `body`. Not uploaded; for the operator. */
  companion: string
  lineCount: number
  checksum: string
}

export type BatchResult = {
  ok: boolean
  files: QuoteFile[]
  /** Blocking problems across all rows. When non-empty, `files` is empty: a bad batch is not emitted. */
  blocks: QuoteProblem[]
  warnings: QuoteProblem[]
  totalLines: number
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function companionSheet(rows: readonly SourceQuoteRow[], file: Omit<QuoteFile, 'companion'>): string {
  const lines: string[] = []
  lines.push(`ONLYSOURCE — DIBBS batch quote, file ${file.index} of ${file.total}`)
  lines.push(`Filename to upload:  ${file.filename}`)
  lines.push(`Lines in this file:  ${file.lineCount} (DLA limit is ${MAX_LINES_PER_FILE})`)
  lines.push(`Checksum:            ${file.checksum}`)
  lines.push('')
  lines.push('This is a file you upload to DIBBS yourself. ONLYSOURCE does not submit it for you.')
  lines.push('')
  lines.push('LINE  SOLICITATION   CLIN   NSN            QTY   UNIT PRICE     DELIVERY')
  rows.forEach((row, i) => {
    lines.push(
      [
        String(i + 1).padStart(4),
        field(row, COL.SOLICITATION_NUMBER).padEnd(13).slice(0, 13),
        field(row, COL.CLIN).padEnd(6).slice(0, 6),
        field(row, COL.NSN).padEnd(13).slice(0, 13),
        field(row, COL.QUANTITY).padStart(5),
        field(row, COL.UNIT_PRICE).padStart(13),
        field(row, COL.DELIVERY_DAYS).padStart(8),
      ].join('  '),
    )
  })
  return lines.join('\n') + '\n'
}

/**
 * Build the batch. Validates every row first; if ANY row blocks, no file is produced and the
 * blocks are returned — a batch quote is all-or-nothing because a partial upload against a
 * federal solicitation is worse than none. `dateStamp` is passed in (never read from a clock
 * here) so the same rows always produce the same filenames in a test.
 */
export function buildBatch(
  rows: readonly SourceQuoteRow[],
  opts: { dateStamp: string; requestedDeliveryDays?: (row: SourceQuoteRow) => number | undefined },
): BatchResult {
  const report = validateFile(rows, opts.requestedDeliveryDays)
  const totalLines = rows.length
  if (!report.ok) {
    return { ok: false, files: [], blocks: report.blocks, warnings: report.warnings, totalLines }
  }

  const groups = chunk(rows, MAX_LINES_PER_FILE)
  const total = groups.length
  const files: QuoteFile[] = groups.map((group, idx) => {
    const body = serializeRows(group)
    const base: Omit<QuoteFile, 'companion'> = {
      index: idx + 1,
      total,
      filename: `onlysource-quotes-${opts.dateStamp}-${pad2(idx + 1)}of${pad2(total)}.csv`,
      body,
      lineCount: group.length,
      checksum: checksum(body),
    }
    return { ...base, companion: companionSheet(group, base) }
  })

  return { ok: true, files, blocks: [], warnings: report.warnings, totalLines }
}

export { rowKey }
