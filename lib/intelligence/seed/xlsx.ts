/**
 * A MINIMAL, DEPENDENCY FREE XLSX READER, SCOPED TO THE SEED WORKBOOKS.
 *
 * ---------------------------------------------------------------------------------------
 * SCOPE, SO THIS DOES NOT QUIETLY BECOME A SECOND INGESTION PIPELINE
 * ---------------------------------------------------------------------------------------
 * T2 owns the production loaders. This reads the four operator-supplied seed workbooks that
 * the charter names as buildable inputs to this lane's surfaces, nothing else. It is here so
 * the intelligence logic is exercised against REAL rows rather than invented ones. If it ever
 * needs to read a government extract, that is the signal it has left its lane.
 *
 * ---------------------------------------------------------------------------------------
 * THE TRAP THIS EXISTS TO AVOID, MEASURED ON THE REAL FILE
 * ---------------------------------------------------------------------------------------
 * Excel omits empty cells from the XML entirely. In `no_quote_matches.xlsx` the header row
 * declares 27 columns while a data row serialises only 24 `<c>` elements, because three cells
 * are empty. A reader that zips values to headers BY POSITION shifts every column after the
 * first gap, silently, and produces rows that look perfectly well formed and are wrong.
 *
 * So this reader is keyed on the cell reference attribute (`r="M2"`) and never on order. A
 * missing cell reads as null, which is the honest answer, and the column it belongs to is
 * decided by its letter, not by how many siblings preceded it.
 *
 * The second trap is dates. The same logical date appears as `03/03/2026` in one workbook and
 * as the serial `46084` in another. Both are carried through as the raw string plus a parsed
 * ISO date where one could be derived, never coerced silently.
 */

import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

/* ------------------------------------------------------------------------------------ */
/* ZIP. An xlsx is a zip container; this reads the entries it needs and nothing else.     */
/* ------------------------------------------------------------------------------------ */

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50

type ZipEntry = { name: string; offset: number; compression: number; size: number }

function readZipEntries(buf: Buffer): Map<string, ZipEntry> {
  // The end-of-central-directory record sits within the last 64KB, after a variable comment.
  let eocd = -1
  const from = Math.max(0, buf.length - 66_000)
  for (let i = buf.length - 22; i >= from; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('xlsx: no zip end-of-central-directory record found')

  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map<string, ZipEntry>()

  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIGNATURE) break
    const compression = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const offset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { name, offset, compression, size })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readEntry(buf: Buffer, entry: ZipEntry): string {
  // The local header repeats the name and extra lengths, which may differ from the central
  // directory's, so the data offset has to be computed from the LOCAL header.
  const nameLen = buf.readUInt16LE(entry.offset + 26)
  const extraLen = buf.readUInt16LE(entry.offset + 28)
  const start = entry.offset + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.size)
  if (entry.compression === 0) return raw.toString('utf8')
  if (entry.compression === 8) return inflateRawSync(raw).toString('utf8')
  throw new Error(`xlsx: unsupported zip compression method ${entry.compression}`)
}

/* ------------------------------------------------------------------------------------ */
/* XML. Small hand parsers, because the shapes here are fixed and known.                  */
/* ------------------------------------------------------------------------------------ */

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const re = /<si>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(unescapeXml(stripTags(m[1] ?? '')))
  return out
}

/** `M12` becomes `M`. The column letter is the identity of the column, never its position. */
function columnLetter(ref: string): string {
  const m = /^([A-Z]+)/.exec(ref)
  return m ? (m[1] as string) : ''
}

/* ------------------------------------------------------------------------------------ */
/* DATES                                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * Excel's serial day number to an ISO date.
 *
 * The epoch is 1899-12-30 rather than 1900-01-01 because Excel deliberately reproduces the
 * Lotus 1-2-3 bug that treats 1900 as a leap year. Using the intuitive epoch puts every date
 * two days out, which is exactly the kind of error that reads as plausible forever.
 *
 * Serials below 1000 are refused: in these workbooks a small integer in a date column is far
 * more likely to be a quantity or a code than a date in 1902.
 */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1000 || serial > 80_000) return null
  const ms = Math.round((serial - 25_569) * 86_400_000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** `MM/DD/YYYY` to ISO. Returns null rather than reordering an ambiguous value. */
export function usDateToIso(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!m) return null
  const [, mm, dd, yyyy] = m
  const month = Number(mm)
  const day = Number(dd)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${yyyy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Best effort date read that never invents one. Returns the ISO date and which encoding it
 * came from, so an evidence row can say how the date was derived.
 */
export function readDate(value: string | null): { iso: string | null; basis: string } {
  if (value == null || value.trim() === '') return { iso: null, basis: 'absent' }
  const iso = usDateToIso(value)
  if (iso) return { iso, basis: 'us_date_string' }
  const asNumber = Number(value)
  if (Number.isFinite(asNumber)) {
    const fromSerial = excelSerialToIso(asNumber)
    if (fromSerial) return { iso: fromSerial, basis: 'excel_serial' }
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    return { iso: value.trim().slice(0, 10), basis: 'iso_string' }
  }
  return { iso: null, basis: 'unparsed' }
}

/* ------------------------------------------------------------------------------------ */
/* THE READER                                                                             */
/* ------------------------------------------------------------------------------------ */

export type SeedProvenance = {
  path: string
  /** Content hash, so a reload can prove the bytes did not change under us. */
  sha256: string
  bytes: number
  /** File modification time, the honest stand-in for a retrieval date we did not observe. */
  fileModifiedAt: string
  retrievedAtBasis: 'origin_file_mtime'
  /** Never a verdict. Seeds are candidate inputs and this field says so on every load. */
  role: 'candidate_input_only'
}

export type SeedTable = {
  provenance: SeedProvenance
  headers: string[]
  /** One record per data row, keyed by header name. Missing cells are null, never shifted. */
  rows: Array<Record<string, string | null>>
  /** Rows the sheet declared versus rows actually materialised. A gap here is a real defect. */
  declaredRowCount: number
}

/** The parsed body of one worksheet, independent of which file it came from. */
export type ParsedSheet = {
  headers: string[]
  rows: Array<Record<string, string | null>>
  declaredRowCount: number
}

/**
 * Parse ONE worksheet's XML into header-keyed rows.
 *
 * Cells are keyed on their reference attribute (A1, B1, ...), never on document order, because
 * Excel omits empty cells entirely and an order-based read silently shifts every value after a
 * gap into the wrong column. The single most important property of this whole module.
 */
function parseSheetXml(sheetXml: string, shared: string[]): ParsedSheet {
  const dim = /<dimension ref="[A-Z]+\d+:([A-Z]+)(\d+)"/.exec(sheetXml)
  const declaredRowCount = dim ? Number(dim[2]) : 0

  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g
  /*
   * THE ATTRIBUTE GROUP IS LAZY, AND THAT ONE CHARACTER IS LOAD BEARING.
   *
   * It was `([^>]*)`, greedy, and greedy is wrong here in a way no test caught for weeks.
   * Given a self-closing cell `<c r="W2" s="5"/>`, the greedy group swallows ` s="5"/`
   * INCLUDING THE SLASH. The `\/>` branch then cannot match (the next character is `>`), so
   * the engine takes the `>([\s\S]*?)<\/c>` branch instead, which matches the `>` and then
   * scans forward to the NEXT CELL'S `</c>`.
   *
   * The consequences, measured on data/nsn-now/full_1.xlsx (13,859 self-closing cells in the
   * Procurement sheet alone):
   *   - the empty cell is assigned a value belonging to a LATER cell
   *   - every cell in between is consumed and never emitted at all
   * An empty AMSC cell ate the Award Date, which is why 156 rows carried a date serial like
   * "13190" in the AMC column. Award Date orders the price series behind every escalation
   * figure on the map and in the AI brief, so this reached the screen.
   *
   * Lazy fixes it: the group starts empty and grows one character at a time, and at each
   * length the alternation is tried with `\/>` FIRST, so a self-closing cell matches as a
   * self-closing cell. The module's own doc comment above promised cells are keyed on their
   * reference and never on document order. This is the line that was quietly breaking that
   * promise.
   */
  const cellRe = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g

  const byRow = new Map<number, Map<string, string>>()
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(sheetXml)) !== null) {
    const rowNumber = Number(rm[1])
    const cells = new Map<string, string>()
    let cm: RegExpExecArray | null
    const body = rm[2] ?? ''
    cellRe.lastIndex = 0
    while ((cm = cellRe.exec(body)) !== null) {
      const ref = cm[1] as string
      const attrs = cm[2] ?? ''
      const inner = cm[3] ?? ''
      let value: string
      if (/t="s"/.test(attrs)) {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
        const idx = v ? Number(v[1]) : NaN
        value = Number.isInteger(idx) && idx >= 0 && idx < shared.length ? (shared[idx] as string) : ''
      } else if (/t="inlineStr"/.test(attrs)) {
        value = unescapeXml(stripTags(inner))
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
        value = v ? unescapeXml(v[1] ?? '') : ''
      }
      cells.set(columnLetter(ref), value.trim())
    }
    byRow.set(rowNumber, cells)
  }

  const headerCells = byRow.get(1) ?? new Map<string, string>()
  const letters = [...headerCells.keys()].sort(compareColumnLetters)
  const headers = letters.map((l) => headerCells.get(l) ?? '')

  const rows: Array<Record<string, string | null>> = []
  const rowNumbers = [...byRow.keys()].filter((n) => n > 1).sort((a, b) => a - b)
  for (const n of rowNumbers) {
    const cells = byRow.get(n) as Map<string, string>
    const record: Record<string, string | null> = {}
    let any = false
    letters.forEach((letter, i) => {
      const header = headers[i] as string
      const raw = cells.get(letter)
      const value = raw == null || raw === '' ? null : raw
      if (value !== null) any = true
      record[header] = value
    })
    // A row of entirely empty cells is structure, not data.
    if (any) rows.push(record)
  }

  return { headers, rows, declaredRowCount }
}

function buildProvenance(path: string, buf: Buffer, stat: { mtime: Date }): SeedProvenance {
  return {
    path,
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
    fileModifiedAt: stat.mtime.toISOString(),
    retrievedAtBasis: 'origin_file_mtime',
    role: 'candidate_input_only',
  }
}

export function readSeedWorkbook(path: string): SeedTable {
  const buf = readFileSync(path)
  const stat = statSync(path)
  const entries = readZipEntries(buf)

  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared = sharedEntry ? parseSharedStrings(readEntry(buf, sharedEntry)) : []

  const sheetName = [...entries.keys()]
    .filter((n) => n.startsWith('xl/worksheets/sheet'))
    .sort()[0]
  if (!sheetName) throw new Error(`xlsx: no worksheet found in ${path}`)
  const parsed = parseSheetXml(readEntry(buf, entries.get(sheetName) as ZipEntry), shared)

  return { provenance: buildProvenance(path, buf, stat), ...parsed }
}

export type WorkbookSheets = {
  provenance: SeedProvenance
  /** Keyed by the human sheet NAME from workbook.xml (e.g. "Procurement"), not sheetN.xml. */
  sheets: Map<string, ParsedSheet>
}

/**
 * Read a multi-sheet workbook, resolving the human sheet names.
 *
 * The NSN-Now Batch Export ships five named sheets (MCRL, Procurement, Availability, RFQ,
 * Tech Info) and the whole value is in reading the RIGHT one by name. The name lives in
 * xl/workbook.xml as `<sheet name=".." r:id="rIdN">`; the rId maps to a worksheet file through
 * xl/_rels/workbook.xml.rels. Resolving by that chain, never by sheet order, because a report
 * that reorders or drops a sheet must fail to find "Procurement" loudly rather than silently
 * read "Availability" in its place.
 */
export function readWorkbookSheets(path: string): WorkbookSheets {
  const buf = readFileSync(path)
  const stat = statSync(path)
  const entries = readZipEntries(buf)

  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared = sharedEntry ? parseSharedStrings(readEntry(buf, sharedEntry)) : []

  const workbookEntry = entries.get('xl/workbook.xml')
  const relsEntry = entries.get('xl/_rels/workbook.xml.rels')
  if (!workbookEntry || !relsEntry) {
    throw new Error(`xlsx: ${path} is missing workbook.xml or its rels; cannot resolve sheet names`)
  }
  const workbookXml = readEntry(buf, workbookEntry)
  const relsXml = readEntry(buf, relsEntry)

  // rId -> worksheet file path (normalised to xl/worksheets/sheetN.xml)
  const ridToTarget = new Map<string, string>()
  const relRe = /<Relationship\b[^>]*\/>/g
  let rel: RegExpExecArray | null
  while ((rel = relRe.exec(relsXml)) !== null) {
    const tag = rel[0]
    const id = /\bId="([^"]+)"/.exec(tag)?.[1]
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1]
    if (id && target && /worksheets\//.test(target)) {
      ridToTarget.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'))
    }
  }

  const sheets = new Map<string, ParsedSheet>()
  const sheetRe = /<sheet\b[^>]*\/?>/g
  let sh: RegExpExecArray | null
  while ((sh = sheetRe.exec(workbookXml)) !== null) {
    const tag = sh[0]
    const name = /\bname="([^"]+)"/.exec(tag)?.[1]
    const rid = /\br:id="([^"]+)"/.exec(tag)?.[1]
    if (!name || !rid) continue
    const target = ridToTarget.get(rid)
    const entry = target ? entries.get(target) : undefined
    if (!entry) continue
    sheets.set(name, parseSheetXml(readEntry(buf, entry), shared))
  }

  return { provenance: buildProvenance(path, buf, stat), sheets }
}

/** `AA` sorts after `Z`, which a plain string comparison gets wrong. */
function compareColumnLetters(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}
