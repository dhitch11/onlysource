/**
 * A BLANK CELL IS AN ABSENCE. THE READER USED TO CALL IT A MEASURED ZERO.
 *
 * ==========================================================================================
 * THE DEFECT THIS FILE EXISTS TO KEEP DEAD
 * ==========================================================================================
 * `lib/intelligence/opportunities/size-of-buy.ts` was written to end a silent zero in the
 * RANKING. The same commit left one alive in the READER, one layer further down:
 *
 *     const num = (v) => { const n = Number(clean(v).replace(/[$,]/g, '')); ... }
 *
 * `Number('')` is 0 and `Number.isFinite(0)` is true, so a "Last Sold Price" cell that Excel
 * omitted entirely came back as the number zero. `sizeOfBuy` accepts a measured zero, correctly
 * (a real $0.00 on a government line is a fact), so it answered `{known: true, usd: 0}` for a
 * buy nobody has ever priced. Three consequences, all measured on a copy of the real workbook
 * with one `<c>` element deleted:
 *
 *     the table printed "$0" in the Size of buy column
 *     summary.size.unsized stayed 0, so BOTH disclosure sentences went unrendered
 *     the tile hint read "last price times quantity, every solicitation on the file"
 *
 * The last one is the worst: a false sentence about coverage, produced by the absence it was
 * written to disclose. The guard the same diff replaced (`estValue > 0 ? ... : dash`) had been
 * hiding it by accident, so the repair made the surface less honest than the code it replaced.
 *
 * ==========================================================================================
 * WHY THE FIXTURE IS BUILT HERE, BYTE BY BYTE
 * ==========================================================================================
 * Nothing exercised `buildHubzoneMatches` at all: the whole builder shipped with no coverage,
 * which is why a type change went through it unobserved. It reads one workbook off disk, so a
 * test of it needs a workbook, and the real one is gitignored government data that is absent in
 * some environments and carries real company names in others. So this file writes a genuine
 * xlsx (a stored zip, correct CRC32, real workbook.xml and rels) into a temp directory and
 * points the data root at it. Every value in it is synthetic and its answer is known before the
 * code runs: 12.5 times 4 is 50, and a person can check that without trusting this repo's
 * parser, this repo's arithmetic, or the head that wrote either.
 *
 * ==========================================================================================
 * THE POSITIVE CONTROL, AND WHAT REVERTING THE FIX DOES
 * ==========================================================================================
 * Restore the old one-line `num` and these go red, because the old reader manufactures a
 * measured zero out of each absence:
 *
 *     "an omitted Last Sold Price cell is not a price of zero"      known:true, usd:0
 *     "an omitted quantity cell is not a quantity of zero"          known:true, usd:0
 *     "a row with neither leg reports neither, not a zero buy"      known:true, usd:0
 *     "a cell holding only a currency symbol carries no number"     known:true, usd:0
 *     "the summary counts the absences instead of swallowing them"  counted 6 not 2
 *     "the tile renders the sentence this file actually earns"      says 1 of 7, not 5 of 7
 *
 * And "a stated zero price IS a measurement and stays known" is the guard in the other
 * direction: a reader that answers null for every zero would pass the six above and would be
 * just as wrong, because it would erase a fact the government did publish.
 *
 * MEASURED, not asserted: the revert was applied to the real file (backed up first, restored
 * after, `cmp` byte identical) and the run reported 6 FAILED / 5 PASSED across the 11 tests in
 * this file. The five that stayed green are the two labelled INVARIANT below, the two
 * instrument checks that read the fixture directly, and the counter-control
 * ("a stated zero price IS a measurement"). A case that passes with the defect in place proves
 * nothing about the repair and must not be counted as a control. The currency-symbol case IS a
 * control: it went red, because the strip empties the cell before the emptiness test sees it.
 *
 * THE EARLIER VERSION OF THIS PARAGRAPH SAID 5 FAILED / 6 PASSED, WHICH IS IMPOSSIBLE: six red
 * plus six green is twelve and this file holds eleven tests. It was caught by a reviewer who
 * re-ran the revert rather than reading the claim. A hand-maintained tally in a comment is a
 * measurement that rots the moment a test is added, and this paragraph is the ENTIRE evidence
 * that the control fires, so getting it wrong retires the control while looking like rigour.
 * Re-derive it, do not edit it: the reverted body is kept at
 * `.probe/rev-e-hubzone.reverted.ts` and can be aliased in without touching the tree.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { join } from 'node:path'
import type { HubzoneDataset } from '@/lib/intelligence/opportunities/hubzone'

/* ------------------------------------------------------------------------------------ */
/* A MINIMAL XLSX WRITER. Stored entries only, because this repo's reader takes the       */
/* central directory's UNCOMPRESSED size as the byte length to slice, which is only the   */
/* same number as the compressed size when nothing is compressed.                         */
/* ------------------------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf: Buffer): number {
  let crc = -1
  for (let i = 0; i < buf.length; i += 1) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ (buf[i] as number)) & 0xff] as number)
  }
  return (crc ^ -1) >>> 0
}

function zipStored(files: Array<{ name: string; body: string }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const data = Buffer.from(f.body, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10) // stored
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += 30 + name.length + data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd])
}

/* ------------------------------------------------------------------------------------ */
/* THE SHEET. `null` means the cell is OMITTED, which is exactly what Excel writes for an  */
/* empty cell and exactly the input that produced the defect.                              */
/* ------------------------------------------------------------------------------------ */

const HEADERS = [
  'NSN Number',
  'Solicitation Number',
  'Description',
  'Close Date',
  'Solicitation Quantity',
  'Last Sold Price',
  'Issue Date',
] as const

type Cell = { n: number } | { s: string } | null

/**
 * Seven rows. The first is the instrument check, the middle five are the control, the last is
 * an invariant the old reader already satisfied and is labelled as such so nobody mistakes it
 * for proof of anything.
 */
const ROWS: Array<{ tag: string; cells: Cell[] }> = [
  {
    tag: 'CTRL-BOTH-LEGS',
    // 12.5 times 4 is 50. Verifiable by a person, which is the point.
    cells: [{ s: '5905-01-000-0001' }, { s: 'SPE0X0-26-T-0001' }, { s: 'RESISTOR' }, { s: '01/02/2027' }, { n: 4 }, { n: 12.5 }, { s: '12/01/2026' }],
  },
  {
    tag: 'BLANK-PRICE',
    cells: [{ s: '5905-01-000-0002' }, { s: 'SPE0X0-26-T-0002' }, { s: 'CAPACITOR' }, { s: '01/03/2027' }, { n: 40 }, null, { s: '12/01/2026' }],
  },
  {
    tag: 'BLANK-QUANTITY',
    cells: [{ s: '5905-01-000-0003' }, { s: 'SPE0X0-26-T-0003' }, { s: 'BEARING' }, { s: '01/04/2027' }, null, { n: 9.75 }, { s: '12/01/2026' }],
  },
  {
    tag: 'BLANK-BOTH',
    cells: [{ s: '5905-01-000-0004' }, { s: 'SPE0X0-26-T-0004' }, { s: 'VALVE' }, { s: '01/05/2027' }, null, null, { s: '12/01/2026' }],
  },
  {
    tag: 'STATED-ZERO-PRICE',
    // The government said zero. That is a measurement and it must survive the fix.
    cells: [{ s: '5905-01-000-0005' }, { s: 'SPE0X0-26-T-0005' }, { s: 'GASKET' }, { s: '01/06/2027' }, { n: 3 }, { n: 0 }, { s: '12/01/2026' }],
  },
  {
    tag: 'CURRENCY-SYMBOL-ONLY',
    // Empties to '' only AFTER the $ and , strip, which is why the emptiness test runs there.
    cells: [{ s: '5905-01-000-0006' }, { s: 'SPE0X0-26-T-0006' }, { s: 'SEAL' }, { s: '01/07/2027' }, { n: 7 }, { s: '$' }, { s: '12/01/2026' }],
  },
  {
    tag: 'UNPARSEABLE-PRICE',
    // An invariant, NOT a control: Number('N/A') was already NaN, so the old reader also
    // answered null here. Kept so a future rewrite of num cannot lose it.
    cells: [{ s: '5905-01-000-0007' }, { s: 'SPE0X0-26-T-0007' }, { s: 'CLAMP' }, { s: '01/08/2027' }, { n: 11 }, { s: 'N/A' }, { s: '12/01/2026' }],
  },
]

const COLUMN = (i: number): string => String.fromCharCode(65 + i)
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function cellXml(ref: string, cell: Cell): string {
  if (cell == null) return '' // Excel omits an empty cell entirely. So does this.
  if ('n' in cell) return `<c r="${ref}"><v>${cell.n}</v></c>`
  return `<c r="${ref}" t="inlineStr"><is><t>${esc(cell.s)}</t></is></c>`
}

function sheetXml(): string {
  const header = HEADERS.map((h, i) => cellXml(`${COLUMN(i)}1`, { s: h })).join('')
  const body = ROWS.map((r, ri) => {
    const n = ri + 2
    const cells = r.cells.map((c, ci) => cellXml(`${COLUMN(ci)}${n}`, c)).join('')
    return `<row r="${n}">${cells}</row>`
  }).join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${COLUMN(HEADERS.length - 1)}${ROWS.length + 1}"/>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`
  )
}

function workbookBytes(): Buffer {
  return zipStored([
    {
      name: '[Content_Types].xml',
      body:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      body:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      body:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Solicitation" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      body:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    { name: 'xl/worksheets/sheet1.xml', body: sheetXml() },
  ])
}

/* ------------------------------------------------------------------------------------ */
/* THE RUN                                                                                */
/* ------------------------------------------------------------------------------------ */

let dir = ''
let priorDataDir: string | undefined
let ds: HubzoneDataset

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'onlysource-hubzone-'))
  mkdirSync(path.join(dir, 'suppliers'), { recursive: true })
  writeFileSync(path.join(dir, 'suppliers', 'hubzone-matches.xlsx'), workbookBytes())

  priorDataDir = process.env.ONLYSOURCE_DATA_DIR
  process.env.ONLYSOURCE_DATA_DIR = dir
  // The builder memoizes per module graph, so it has to be loaded AFTER the root is pointed
  // at the fixture. A stale registry here would silently measure the real workbook instead.
  vi.resetModules()
  const mod = await import('@/lib/intelligence/opportunities/hubzone')
  ds = mod.buildHubzoneMatches()
})

afterAll(() => {
  // Restore rather than delete: the variable is process wide and other files in this worker
  // resolve the data root at import time.
  if (priorDataDir === undefined) delete process.env.ONLYSOURCE_DATA_DIR
  else process.env.ONLYSOURCE_DATA_DIR = priorDataDir
  vi.resetModules()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const ok = (): Extract<HubzoneDataset, { ok: true }> => {
  if (!ds.ok) throw new Error(`the builder refused the fixture: ${ds.reason}`)
  return ds
}
const bySolicitation = (n: string) => {
  const row = ok().matches.find((m) => m.solicitation === n)
  if (!row) throw new Error(`fixture row ${n} did not survive the read`)
  return row
}

describe('buildHubzoneMatches: the instrument, checked before it is trusted', () => {
  it('reads the workbook this test wrote, with every row present and none shifted', () => {
    // The premise guard. If the writer or the reader were broken, every assertion below would
    // be vacuously true, so the fixture is asserted before any conclusion is drawn from it.
    expect(ok().matches).toHaveLength(ROWS.length)
    expect(bySolicitation('SPE0X0-26-T-0002').description).toBe('CAPACITOR')
    expect(bySolicitation('SPE0X0-26-T-0002').quantity).toBe(40)
  })

  it('computes a size a person can check by hand: 12.5 times 4 is 50', () => {
    expect(bySolicitation('SPE0X0-26-T-0001').size).toEqual({ known: true, usd: 50 })
  })
})

describe('an omitted cell is an absence, never a measured zero', () => {
  it('an omitted Last Sold Price cell is not a price of zero', () => {
    const r = bySolicitation('SPE0X0-26-T-0002')
    expect(r.lastSoldPrice).toBeNull()
    expect(r.size).toEqual({ known: false, reason: 'no_recorded_price' })
    // Shape assertion: there is no `usd` field to misread, so no surface can print a zero.
    expect((r.size as { usd?: number }).usd).toBeUndefined()
  })

  it('an omitted quantity cell is not a quantity of zero', () => {
    const r = bySolicitation('SPE0X0-26-T-0003')
    expect(r.quantity).toBeNull()
    expect(r.lastSoldPrice).toBe(9.75)
    expect(r.size).toEqual({ known: false, reason: 'no_stated_quantity' })
  })

  it('a row with neither leg reports neither, not a zero buy', () => {
    const r = bySolicitation('SPE0X0-26-T-0004')
    expect(r.size).toEqual({ known: false, reason: 'neither_recorded' })
  })

  it('a cell holding only a currency symbol carries no number', () => {
    // The strip runs first and empties it, so the emptiness test has to run after the strip.
    const r = bySolicitation('SPE0X0-26-T-0006')
    expect(r.lastSoldPrice).toBeNull()
    expect(r.size).toEqual({ known: false, reason: 'no_recorded_price' })
  })

  it('an unparseable cell carries no number either (invariant, not a control)', () => {
    expect(bySolicitation('SPE0X0-26-T-0007').lastSoldPrice).toBeNull()
  })
})

describe('the other direction: a stated zero is a measurement and must survive', () => {
  it('a stated zero price IS a measurement and stays known', () => {
    // A reader that answered null for every zero would pass every control above and would be
    // just as dishonest, because it would erase a number the government actually published.
    const r = bySolicitation('SPE0X0-26-T-0005')
    expect(r.lastSoldPrice).toBe(0)
    expect(r.size).toEqual({ known: true, usd: 0 })
  })
})

describe('the summary, which is what the page prints and what the page discloses', () => {
  it('counts the absences instead of swallowing them into the total', () => {
    // 50 from the both-legs row, 0 from the stated-zero row, and nothing from the four
    // absences. Under the old reader all six would have counted and the total would still
    // read $50, which is exactly why the money alone never revealed this.
    expect(ok().summary).toEqual({
      total: 7,
      size: { usd: 50, counted: 2, unsized: 5 },
    })
  })

  it('renders the sentence this file actually earns, not a smaller one', () => {
    /*
     * MIRRORING IS NOT BINDING, AND THIS TEST USED TO ONLY MIRROR.
     *
     * It copied the page's hint expression into the test and asserted the copy, with a comment
     * claiming the control was "on the SENTENCE A PERSON READS rather than on a field". It was
     * not: nothing here imported, read or rendered the page, so replacing the page's ternary
     * with the unconditional literal "every solicitation on the file" left this test GREEN
     * while the tile claimed full coverage over a file carrying five unsizable buys. A reviewer
     * proved exactly that by making the substitution and watching the suite stay green.
     *
     * So it now READS THE PAGE, the way test/honesty/nav-copy.test.ts already does, and asserts
     * both branch strings AND the expression that gates them. Delete the ternary, flip the
     * comparison, or reword either branch, and this goes red.
     *
     * Why the sentence matters and a count alone did not: the old reader still reported 1
     * unsized row here (the unparseable one it could not fake a zero for), so a bare
     * `unsized > 0` check stayed green while the tile told the operator 1 of 7 buys could not
     * be sized when the true answer was 5. A disclosure that understates the gap is the same
     * defect as no disclosure, only harder to notice.
     */
    const page = readFileSync(
      join(process.cwd(), 'app', '(app)', 'hubzone', 'page.tsx'),
      'utf8',
    )
    // Comments are stripped first: this file's own prose quotes the strings it checks for, and
    // an instrument that reads a comment about a defect as the defect is the recorded failure
    // mode from test/honesty/nav-copy.test.ts.
    const src = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    expect(src).toContain('summary.size.unsized === 0')
    expect(src).toContain('last price times quantity, every solicitation on the file')
    expect(src).toContain('have no computable size and are not in this total')

    const s = ok().summary
    const tileHint =
      s.size.unsized === 0
        ? 'last price times quantity, every solicitation on the file'
        : `last price times quantity. ${s.size.unsized.toLocaleString()} of ${s.total.toLocaleString()} have no computable size and are not in this total`
    expect(tileHint).toBe(
      'last price times quantity. 5 of 7 have no computable size and are not in this total',
    )
    expect(s.size.counted + s.size.unsized).toBe(s.total)
  })

  it('never hands an unsized row a figure to be ranked by (invariant, not a control)', () => {
    // Green with the defect in place too, because the old reader made these rows `known`
    // rather than leaving a readable zero on an unknown. Kept as a shape guard on SizeOfBuy.
    for (const m of ok().matches) {
      if (!m.size.known) expect((m.size as { usd?: number }).usd).toBeUndefined()
    }
  })
})
