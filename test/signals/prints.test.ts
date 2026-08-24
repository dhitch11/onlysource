/**
 * THE PRINTS FLAG: A PRESENT FACT WITH AN UNKNOWN MEANING.
 *
 * Every case here is settled against a synthetic input whose answer was known before the code
 * ran, because an independent check written by the same head is not independent. The real
 * corpus is measured separately in `.probe/prints/`, and the two are cross-checked there.
 *
 * The controls that matter, and what each one catches:
 *
 *   TRI-STATE DOES NOT COLLAPSE   fails the moment `present_without_flag` and `not_in_export`
 *                                 become the same answer, which is the defect that sank the
 *                                 MEDALS attempt: a blank cell read as a negative finding.
 *   A BLANK IS NOT A DRAWING      fails if the copy for the blank state ever starts asserting
 *   VERDICT                       that no drawing exists.
 *   NO SCORE FIELD                fails if a numeric weight is added to the record before the
 *                                 publisher's code list is in hand.
 *   A BAD KEY REFUSES             fails if an unreadable stock number is answered with
 *                                 `not_in_export`, which would be a claim about the catalogue
 *                                 that no file supported.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import {
  buildPrintsIndex,
  printsAnswerability,
  printsFor,
  readPrintsIndex,
  resetPrintsIndexCache,
  MCRL_SHEET_NAME,
  NSN_COLUMN_HEADER,
  PRINTS_COLUMN_HEADER,
  PRINTS_DECODER_DOCUMENT,
  PRINTS_DECODER_STATUS,
  PRINTS_FLAG_STATES,
  PRINTS_MEANING_UNCONFIRMED,
  PRINTS_STATE_STATEMENTS,
  type PrintsIndex,
  type PrintsSourceInput,
} from '@/lib/intelligence/signals/prints'

/* ------------------------------------------------------------------------------------ */
/* SYNTHETIC INPUT, ANSWER KNOWN IN ADVANCE                                               */
/* ------------------------------------------------------------------------------------ */

type Row = Record<string, string | null>

const row = (nsn: string | null, cage: string, part: string, prints: string | null): Row => ({
  [NSN_COLUMN_HEADER]: nsn,
  Cage: cage,
  'Part Number': part,
  [PRINTS_COLUMN_HEADER]: prints,
})

const provenanceFor = (p: string) => ({
  path: p,
  sha256: `sha-${p}`,
  bytes: 1,
  fileModifiedAt: '2026-08-15T00:00:00.000Z',
  retrievedAtBasis: 'origin_file_mtime' as const,
  role: 'candidate_input_only' as const,
})

const source = (p: string, rows: Row[] | null): PrintsSourceInput => ({
  path: p,
  provenance: provenanceFor(p),
  rows,
})

/** 5905-00-111-1111 flagged, 5905-00-222-2222 present twice with no flag, one unkeyable row. */
const WORKBOOK_A = source('nsn-now/a.xlsx', [
  row('5905-00-111-1111', 'AAAAA', 'P1', 'X'),
  row('5905-00-222-2222', 'BBBBB', 'P2', ''),
  row('5905-00-222-2222', 'CCCCC', 'P3', null),
  row('NOT-A-STOCK-NUMBER', 'DDDDD', 'P4', 'X'),
])

/** Row 1 is a byte-for-byte repeat of A's row 1. Row 2 exists in no other workbook. */
const WORKBOOK_B = source('suppliers/b.xlsx', [
  row('5905-00-111-1111', 'AAAAA', 'P1', 'X'),
  row('5905-00-333-3333', 'EEEEE', 'P5', 'X'),
])

/** A workbook with no MCRL sheet at all. Named in coverage, never counted as zero rows. */
const WORKBOOK_C = source('seed/c.xlsx', null)

const fixture = (): PrintsIndex => buildPrintsIndex([WORKBOOK_A, WORKBOOK_B, WORKBOOK_C])

const unwrap = (index: PrintsIndex, nsn: string) => {
  const lookup = printsFor(index, nsn)
  if (!lookup.ok) throw new Error(`expected a readable stock number, got ${lookup.reason}`)
  return lookup.record
}

/* ------------------------------------------------------------------------------------ */

describe('the tri-state', () => {
  it('reads a flagged row as flagged, and says so without saying what the flag means', () => {
    const record = unwrap(fixture(), '5905-00-111-1111')
    expect(record.state).toBe('flag_present')
    expect(record.rowsInExport).toBe(1)
    expect(record.rowsWithFlag).toBe(1)
    expect(record.flagValues).toEqual(['X'])
    expect(record.statement).toContain('marks this stock number with a Prints flag')
    expect(record.statement).toContain(PRINTS_MEANING_UNCONFIRMED)
  })

  it('reads a present-but-blank stock number as PRESENT WITHOUT A FLAG, not as absent', () => {
    const record = unwrap(fixture(), '5905-00-222-2222')
    expect(record.state).toBe('present_without_flag')
    // Two rows really were read for it. That is the fact that separates this state from the
    // next one, and it is why a blank here can never be reported as "not in the export".
    expect(record.rowsInExport).toBe(2)
    expect(record.rowsWithFlag).toBe(0)
    expect(record.flagValues).toEqual([])
  })

  it('reads a stock number the export never mentions as NOT IN THE EXPORT', () => {
    const record = unwrap(fixture(), '5905-00-999-9999')
    expect(record.state).toBe('not_in_export')
    expect(record.rowsInExport).toBe(0)
    expect(record.sourcePaths).toEqual([])
  })

  it('accepts the bare 9 digit NIIN and the punctuated 13 digit NSN as the same key', () => {
    const index = fixture()
    expect(unwrap(index, '5905-00-111-1111').niin).toBe('001111111')
    expect(unwrap(index, '5905001111111').niin).toBe('001111111')
    expect(unwrap(index, '001111111').state).toBe('flag_present')
  })
})

describe('POSITIVE CONTROL: the tri-state does not collapse to a boolean', () => {
  it('all three states are REACHABLE from one fixture, and are pairwise distinct', () => {
    const index = fixture()
    const observed = [
      unwrap(index, '5905-00-111-1111').state,
      unwrap(index, '5905-00-222-2222').state,
      unwrap(index, '5905-00-999-9999').state,
    ]
    // Three inputs, three DIFFERENT answers. Collapse any two of them, in either direction,
    // and this set shrinks. A boolean return would shrink it to two.
    expect(new Set(observed).size).toBe(3)
    expect(observed).toEqual(['flag_present', 'present_without_flag', 'not_in_export'])
    // And every declared state is one of the reachable ones, so a state cannot be quietly
    // retired by making nothing produce it.
    expect(PRINTS_FLAG_STATES).toHaveLength(3)
    expect([...PRINTS_FLAG_STATES].sort()).toEqual([...observed].sort())
  })

  it('the two kinds of silence are different facts and carry different evidence', () => {
    const index = fixture()
    const blank = unwrap(index, '5905-00-222-2222')
    const absent = unwrap(index, '5905-00-999-9999')
    expect(blank.state).not.toBe(absent.state)
    expect(blank.statement).not.toBe(absent.statement)
    // The distinguishing evidence, not just a different label: one has rows behind it.
    expect(blank.rowsInExport).toBeGreaterThan(0)
    expect(absent.rowsInExport).toBe(0)
  })

  it('the state is never a boolean and never coerces to one', () => {
    const index = fixture()
    for (const nsn of ['5905-00-111-1111', '5905-00-222-2222', '5905-00-999-9999']) {
      const record = unwrap(index, nsn)
      expect(typeof record.state).toBe('string')
      expect(PRINTS_FLAG_STATES).toContain(record.state)
    }
  })
})

describe('POSITIVE CONTROL: a blank is never read as "no drawing"', () => {
  it('the blank state says in words that an empty cell is not a negative finding', () => {
    expect(PRINTS_STATE_STATEMENTS.present_without_flag).toContain(
      'An empty cell is not a statement that no drawing exists.',
    )
    expect(PRINTS_STATE_STATEMENTS.present_without_flag).toContain('with no Prints flag recorded')
  })

  it('no statement claims a drawing IS available, and every one carries the qualifier', () => {
    const everyStatement = [
      ...PRINTS_FLAG_STATES.map((s) => PRINTS_STATE_STATEMENTS[s]),
      printsAnswerability(fixture(), ['5905-00-111-1111']).statement,
    ]
    for (const statement of everyStatement) {
      expect(statement).toContain(PRINTS_MEANING_UNCONFIRMED)
      // The words this signal is not allowed to say, in any state, until the code list arrives.
      expect(statement).not.toMatch(/drawings?\s+(is|are)\s+available/i)
      expect(statement).not.toMatch(/blueprint/i)
      expect(statement).not.toMatch(/technical data package/i)
      expect(statement).not.toMatch(/\bdrawing available\b/i)
    }
  })

  /*
   * ⛔ THIS TEST USED TO PIN A CLAIM THAT WAS FALSE, WHICH IS THE WORST THING A TEST CAN DO.
   *
   * It was titled "names the document that would settle the meaning, so the gap is actionable"
   * and it asserted `decoderDocument === 'Codes on NSN-Now.docx'` and that the operator-facing
   * qualifier contained that filename. Both passed. Both were wrong.
   *
   * MEASURED from the file, two identical copies in the estate's own Downloads folder, md5
   * `df29f34b08fa7740c96a5c436ad51bb2`. `docProps/core.xml` gives `dc:creator` David Goodreau,
   * created 2025-12-31T21:59Z, revision 1. `word/document.xml` gives 477 words, `AMC` 14 times,
   * `AMSC` 9 times, and the string `Prints` ZERO times. It is the owner's own AMC/AMSC notes,
   * written six weeks before this platform existed, and it was never withheld from us.
   *
   * ★ A GREEN TEST OVER A FALSE PREMISE IS NOT NEUTRAL, IT IS LOAD BEARING. This assertion
   * would have made the false provenance a regression-protected invariant: the next lane to
   * correct the module would have been met with a failing test telling them they were wrong.
   * That is how a mistaken belief becomes permanent. It was caught before it was committed.
   *
   * So the property under test changes with the fact. The gap is NOT "a named document exists
   * and we lack it", which is actionable and has a known cure. It is "we do not know what this
   * column means and we do not know that anyone has written it down", which is weaker and true.
   */
  it('states an unestablished meaning without inventing a document that would settle it', () => {
    expect(PRINTS_DECODER_STATUS).toBe('absent')
    expect(fixture().decoderStatus).toBe('absent')

    // Null, never a placeholder name: `null` is the one value a renderer cannot accidentally print.
    expect(PRINTS_DECODER_DOCUMENT).toBeNull()
    expect(fixture().decoderDocument).toBeNull()

    // The qualifier claims only what was measured, and names no file.
    expect(PRINTS_MEANING_UNCONFIRMED).toMatch(/not confirmed/i)
    expect(PRINTS_MEANING_UNCONFIRMED).toMatch(/have not established that the publisher issues one/i)
    expect(PRINTS_MEANING_UNCONFIRMED).not.toMatch(/\.docx/i)
    expect(PRINTS_MEANING_UNCONFIRMED).not.toMatch(/Codes on NSN-Now/i)

    /*
     * A CONTROL ON THE WHOLE MODULE, not just this constant. Nothing the index hands a renderer
     * may name that document, in any field, ever again. This fails if the string returns anywhere
     * on the shipped surface rather than only where this constant is read.
     */
    const shipped = JSON.stringify({
      qualifier: PRINTS_MEANING_UNCONFIRMED,
      decoderDocument: fixture().decoderDocument,
      statements: Object.values(PRINTS_STATE_STATEMENTS),
    })
    expect(shipped).not.toMatch(/Codes on NSN-Now/i)
    expect(shipped).not.toMatch(/\.docx/i)
  })
})

describe('POSITIVE CONTROL: nothing here feeds a score', () => {
  it('the record carries no numeric weight of any kind', () => {
    const record = unwrap(fixture(), '5905-00-111-1111')
    const scoreish = Object.keys(record).filter((k) => /score|weight|point|rank|rating/i.test(k))
    expect(scoreish).toEqual([])
  })
})

describe('POSITIVE CONTROL: an unreadable key refuses instead of answering', () => {
  it('does not report a part number as "not in the export"', () => {
    const lookup = printsFor(fixture(), 'MS51957-32')
    expect(lookup.ok).toBe(false)
    expect(lookup.ok === false && lookup.reason).toBe('unparseable_stock_number')
    expect(lookup.ok === false && lookup.statement).toContain('not a readable stock number')
  })

  it('refuses null, empty and a wrong-length number the same way', () => {
    for (const bad of [null, undefined, '', '   ', '12345', '59050011111119999']) {
      expect(printsFor(fixture(), bad).ok).toBe(false)
    }
  })

  it('answerability counts an unreadable key separately, never as absent from the export', () => {
    const answer = printsAnswerability(fixture(), ['MS51957-32', '5905-00-999-9999'])
    expect(answer.unparseable).toBe(1)
    expect(answer.notInExport).toBe(1)
    expect(answer.considered).toBe(2)
    expect(answer.answerable).toBe(0)
    expect(answer.statement).toContain('were not readable stock numbers')
  })
})

describe('coverage travels with the answer', () => {
  it('counts rows, duplicates, unkeyable rows and stock numbers, each as its own fact', () => {
    const { coverage } = fixture()
    expect(coverage.workbooksScanned).toBe(3)
    expect(coverage.workbooksWithMcrlSheet).toBe(2)
    expect(coverage.workbooksWithoutMcrlSheet).toEqual(['seed/c.xlsx'])
    expect(coverage.mcrlRowsRead).toBe(6)
    // A repeats B's first row exactly, so it is counted once.
    expect(coverage.mcrlRowsAfterDedup).toBe(4)
    expect(coverage.duplicateRowsDropped).toBe(1)
    expect(coverage.rowsUnkeyable).toBe(1)
    // The flag census is over every row READ, including the one whose key would not parse,
    // so numerator and denominator describe the same population.
    expect(coverage.rowsWithFlag).toBe(4)
    expect(coverage.stockNumbers).toBe(3)
    expect(coverage.stockNumbersFlagged).toBe(2)
    expect(coverage.stockNumbersWithoutFlag).toBe(1)
    expect(coverage.flagValuesObserved).toEqual(['X'])
  })

  it('a workbook with no MCRL sheet is NAMED, never counted as a workbook of zero rows', () => {
    const { sources } = fixture()
    const c = sources.find((s) => s.path === 'seed/c.xlsx')
    expect(c?.hasMcrlSheet).toBe(false)
    expect(c?.mcrlRowsRead).toBe(0)
    const a = sources.find((s) => s.path === 'nsn-now/a.xlsx')
    expect(a?.hasMcrlSheet).toBe(true)
    expect(a?.mcrlRowsRead).toBe(4)
    expect(a?.rowsUnkeyable).toBe(1)
  })

  it('a fraction with nothing to divide by is null, never zero', () => {
    const empty = buildPrintsIndex([source('nsn-now/empty.xlsx', [])])
    expect(empty.coverage.stockNumbers).toBe(0)
    expect(empty.coverage.flaggedRowFraction).toBeNull()
    expect(empty.coverage.flaggedStockNumberFraction).toBeNull()
    expect(printsAnswerability(empty, []).answerableFraction).toBeNull()
    expect(printsAnswerability(empty, []).statement).toContain('No stock numbers were checked')
  })

  it('answerability states what fraction of a caller list the export can answer at all', () => {
    const answer = printsAnswerability(fixture(), [
      '5905-00-111-1111',
      '5905-00-222-2222',
      '5905-00-999-9999',
      '5905-00-888-8888',
    ])
    expect(answer.considered).toBe(4)
    expect(answer.flagged).toBe(1)
    expect(answer.presentWithoutFlag).toBe(1)
    expect(answer.notInExport).toBe(2)
    expect(answer.answerable).toBe(2)
    expect(answer.answerableFraction).toBe(0.5)
    expect(answer.statement).toContain('covers 2 of 4 stock numbers checked (50%)')
  })
})

describe('rows that disagree about the flag are kept and reported, never averaged away', () => {
  const disagreeing = buildPrintsIndex([
    source('nsn-now/mixed.xlsx', [
      row('5905-00-444-4444', 'AAAAA', 'P1', 'X'),
      row('5905-00-444-4444', 'BBBBB', 'P2', ''),
    ]),
  ])

  it('rolls up to flagged, because the claim is about the export and not about the part', () => {
    const record = unwrap(disagreeing, '5905-00-444-4444')
    expect(record.state).toBe('flag_present')
    // The disagreement stays visible on the record itself.
    expect(record.rowsInExport).toBe(2)
    expect(record.rowsWithFlag).toBe(1)
  })

  it('counts the stock number as mixed, so a change in the export is not silent', () => {
    expect(disagreeing.coverage.stockNumbersWithMixedRows).toBe(1)
    // The corpus on disk measures zero of these. A future export could differ, and this
    // counter is how anyone would find out.
    expect(fixture().coverage.stockNumbersWithMixedRows).toBe(0)
  })

  it('a duplicate that DISAGREES about the flag survives the row dedup', () => {
    // Same stock number, same cage, same part number, different flag. Deduping on identity
    // alone would drop one of these and pick whichever was read first.
    const index = buildPrintsIndex([
      source('nsn-now/x.xlsx', [row('5905-00-555-5555', 'AAAAA', 'P1', 'X')]),
      source('nsn-now/y.xlsx', [row('5905-00-555-5555', 'AAAAA', 'P1', '')]),
    ])
    const record = unwrap(index, '5905-00-555-5555')
    expect(record.rowsInExport).toBe(2)
    expect(record.rowsWithFlag).toBe(1)
    expect(index.coverage.duplicateRowsDropped).toBe(0)
    expect(index.coverage.stockNumbersWithMixedRows).toBe(1)
  })
})

/* ------------------------------------------------------------------------------------ */
/* THE REAL READER, ON A REAL WORKBOOK, WITH AN ANSWER KNOWN BEFORE IT RAN                */
/* ------------------------------------------------------------------------------------ */

/**
 * A minimal but genuine .xlsx: a real zip container with a real workbook, real relationships
 * and a real worksheet, written here so the loader can be exercised end to end without the
 * 19MB corpus and without inventing a second parser to read it back. The bytes go in through
 * `readWorkbookSheets`, exactly as production does.
 */
function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i] as number
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function zip(entries: Array<{ name: string; body: string }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.from(entry.body, 'utf8')
    const data = deflateRawSync(raw)
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    // The reader takes its entry size from the UNCOMPRESSED field at offset 24 and then
    // inflates, so this must be the raw length.
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + data.length
  }
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([Buffer.concat(locals), centralBytes, eocd])
}

const COLUMNS = ['A', 'B', 'C', 'D']

function sheetXml(rows: string[][]): string {
  const cells = (values: string[], rowNumber: number) =>
    values
      .map((value, i) =>
        value === ''
          ? `<c r="${COLUMNS[i]}${rowNumber}" s="1"/>`
          : `<c r="${COLUMNS[i]}${rowNumber}" t="inlineStr"><is><t>${value}</t></is></c>`,
      )
      .join('')
  const body = rows
    .map((values, i) => `<row r="${i + 1}">${cells(values, i + 1)}</row>`)
    .join('')
  return `<?xml version="1.0"?><worksheet><dimension ref="A1:D${rows.length}"/><sheetData>${body}</sheetData></worksheet>`
}

function workbook(sheetNames: string[], sheets: string[][][]): Buffer {
  const sheetTags = sheetNames
    .map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')
  const relTags = sheetNames
    .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')
  return zip([
    { name: 'xl/workbook.xml', body: `<?xml version="1.0"?><workbook><sheets>${sheetTags}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', body: `<?xml version="1.0"?><Relationships>${relTags}</Relationships>` },
    ...sheetNames.map((_, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      body: sheetXml(sheets[i] as string[][]),
    })),
  ])
}

const HEADER = [NSN_COLUMN_HEADER, 'Cage', 'Part Number', PRINTS_COLUMN_HEADER]

/**
 * A copy of the real environment with the data root pointed somewhere else. Copied rather
 * than mutated: vitest runs several test files in one process, and a `process.env` this file
 * changed underneath them would move another lane's data root without anything saying so.
 */
const envFor = (dir: string): NodeJS.ProcessEnv => ({ ...process.env, ONLYSOURCE_DATA_DIR: dir })

const root = mkdtempSync(path.join(tmpdir(), 'os-prints-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  resetPrintsIndexCache()
})

describe('the loader, driven through the real xlsx reader', () => {
  mkdirSync(path.join(root, 'nsn-now'), { recursive: true })
  mkdirSync(path.join(root, 'suppliers'), { recursive: true })
  mkdirSync(path.join(root, 'nsn-now', 'ex_0'), { recursive: true })

  writeFileSync(
    path.join(root, 'nsn-now', 'full_9.xlsx'),
    workbook(
      [MCRL_SHEET_NAME, 'Procurement'],
      [
        [
          HEADER,
          ['5905-00-111-1111', 'AAAAA', 'P1', 'X'],
          // An EMPTY cell, serialised self-closing exactly as Excel does it. The blank has to
          // survive as a blank rather than stealing the next cell's value.
          ['5905-00-222-2222', 'BBBBB', 'P2', ''],
        ],
        [['Contract No'], ['SPE4A6-25-V-1234']],
      ],
    ),
  )
  writeFileSync(
    path.join(root, 'suppliers', 'parts.xlsx'),
    workbook([MCRL_SHEET_NAME], [[HEADER, ['5905-00-333-3333', 'EEEEE', 'P5', 'X']]]),
  )
  // No MCRL sheet at all. Must be named in coverage, not silently ignored.
  writeFileSync(
    path.join(root, 'suppliers', 'other.xlsx'),
    workbook(['Availability'], [[['Company'], ['Acme']]]),
  )
  /*
   * TWO SEPARATE DEFENCES AGAINST READING THE SAME EXPORT TWICE, TESTED SEPARATELY BECAUSE
   * THEY CATCH DIFFERENT THINGS. The real `data/nsn-now` holds both shapes.
   *
   *   1. A copy one directory DEEPER, in `ex_0/`. Only the one-level scan stops this one, so
   *      the fixture gives it a stock number found in NO other workbook. If the scan ever
   *      recurses, that stock number appears and the test says so. Content dedup cannot save
   *      this case, which is exactly why the file is not a byte-identical copy.
   *   2. A byte-identical copy at the SAME level. The scan cannot tell it apart by path, so
   *      `distinctWorkbookPaths` has to catch it by content hash and report the pairing.
   */
  writeFileSync(
    path.join(root, 'nsn-now', 'ex_0', 'BatchExport_1.xlsx'),
    workbook(
      [MCRL_SHEET_NAME],
      [[HEADER, ['5905-00-666-6666', 'FFFFF', 'P6', 'X']]],
    ),
  )
  writeFileSync(
    path.join(root, 'nsn-now', 'full_9_copy.xlsx'),
    workbook(
      [MCRL_SHEET_NAME, 'Procurement'],
      [
        [
          HEADER,
          ['5905-00-111-1111', 'AAAAA', 'P1', 'X'],
          ['5905-00-222-2222', 'BBBBB', 'P2', ''],
        ],
        [['Contract No'], ['SPE4A6-25-V-1234']],
      ],
    ),
  )

  const env = envFor(root)
  resetPrintsIndexCache()
  const index = readPrintsIndex(env)

  it('reads the MCRL sheet BY NAME out of a real workbook and finds the Prints column', () => {
    expect(index.ok).toBe(true)
    if (!index.ok) return
    expect(index.coverage.workbooksScanned).toBe(3)
    expect(index.coverage.workbooksWithMcrlSheet).toBe(2)
    expect(index.coverage.workbooksWithoutMcrlSheet).toEqual([path.join('suppliers', 'other.xlsx')])
    expect(index.coverage.mcrlRowsRead).toBe(3)
    expect(index.coverage.stockNumbers).toBe(3)
    expect(index.coverage.flagValuesObserved).toEqual(['X'])
  })

  it('the tri-state survives the round trip through the real parser', () => {
    if (!index.ok) throw new Error(index.reason)
    expect(unwrap(index, '5905-00-111-1111').state).toBe('flag_present')
    // The self-closing empty cell must read as a blank on ITS OWN row, not as the next
    // row's value. This is the exact shape of the greedy-regex defect this repo already had.
    expect(unwrap(index, '5905-00-222-2222').state).toBe('present_without_flag')
    expect(unwrap(index, '5905-00-333-3333').state).toBe('flag_present')
    expect(unwrap(index, '5905-00-777-7777').state).toBe('not_in_export')
  })

  it('does not descend into the subdirectory holding the renamed originals', () => {
    if (!index.ok) throw new Error(index.reason)
    // This stock number exists ONLY in nsn-now/ex_0/. Reaching it means the scan recursed.
    expect(unwrap(index, '5905-00-666-6666').state).toBe('not_in_export')
    expect(index.coverage.mcrlRowsRead).toBe(3)
  })

  it('drops a byte-identical copy at the same level and REPORTS the pairing', () => {
    if (!index.ok) throw new Error(index.reason)
    // Three MCRL rows, not five. The copy would double every row count if read.
    expect(index.coverage.mcrlRowsRead).toBe(3)
    expect(unwrap(index, '5905-00-111-1111').rowsInExport).toBe(1)
    expect(index.coverage.duplicateWorkbooksDropped).toEqual([
      { kept: path.join('nsn-now', 'full_9.xlsx'), dropped: path.join('nsn-now', 'full_9_copy.xlsx') },
    ])
  })

  it('memoizes per resolved root, and a second read is the same object', () => {
    expect(readPrintsIndex(env)).toBe(index)
  })
})

describe('an absent or empty data directory refuses, and never returns an empty index', () => {
  it('reports the path it looked at when the directory is not there', () => {
    resetPrintsIndexCache()
    const missing = path.join(root, 'no-such-directory')
    const result = readPrintsIndex(envFor(missing))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain(missing)
    expect(result.ok === false && result.reason).toContain('no Prints flag can be reported')
  })

  it('refuses when workbooks exist but not one carries an MCRL sheet', () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'os-prints-bare-'))
    mkdirSync(path.join(bare, 'nsn-now'), { recursive: true })
    writeFileSync(
      path.join(bare, 'nsn-now', 'only.xlsx'),
      workbook(['Availability'], [[['Company'], ['Acme']]]),
    )
    resetPrintsIndexCache()
    const result = readPrintsIndex(envFor(bare))
    // Zero flagged stock numbers would have been a perfectly cheerful, perfectly wrong answer.
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('none carried a sheet named MCRL')
    rmSync(bare, { recursive: true, force: true })
  })

  it('does not cache a refusal, so a directory that appears later is picked up', () => {
    const late = mkdtempSync(path.join(tmpdir(), 'os-prints-late-'))
    const target = path.join(late, 'data')
    resetPrintsIndexCache()
    const before = readPrintsIndex(envFor(target))
    expect(before.ok).toBe(false)

    mkdirSync(path.join(target, 'nsn-now'), { recursive: true })
    writeFileSync(
      path.join(target, 'nsn-now', 'late.xlsx'),
      workbook([MCRL_SHEET_NAME], [[HEADER, ['5905-00-111-1111', 'AAAAA', 'P1', 'X']]]),
    )
    const after = readPrintsIndex(envFor(target))
    expect(after.ok).toBe(true)
    rmSync(late, { recursive: true, force: true })
  })
})
