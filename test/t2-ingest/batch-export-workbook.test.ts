/**
 * THE TWO SILENCES MUST NOT BE THE SAME VALUE.
 *
 * A stock number missing from a batch export means one of two opposite things, and the file
 * looks identical either way. Measured on the real 08-15 pull: `full_2` was 34 rows short of the
 * ceiling so its 235 silent stock numbers are honestly absent, while `full_1` and `full_3`
 * stopped at exactly 20,000 so their 669 were never answered about at all. Collapse them and 669
 * stock numbers become zeroes that the pricing engine treats as facts.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  MEASURED_ROWS_PER_REQUESTED_NSN,
  SAFE_NSNS_PER_REPORT,
  SHEET_ROW_CAP,
  auditSheet,
  auditWorkbook,
  readBatchExportWorkbook,
  type SheetReading,
} from '../../lib/ingest/batch-export/workbook'

const sheet = (over: Partial<SheetReading> = {}): SheetReading => ({
  name: 'Procurement',
  dataRows: 100,
  nsns: ['A', 'B'],
  atCap: false,
  ...over,
})

describe('the two silences', () => {
  it('★ a missing stock number BELOW the cap is ABSENT: the origin answered, and the answer was nothing', () => {
    const a = auditSheet({
      sheet: sheet({ dataRows: SHEET_ROW_CAP - 34, nsns: ['A'], atCap: false }),
      requested: ['A', 'B'],
    })
    expect(a.answered).toEqual(['A'])
    expect(a.absent).toEqual(['B'])
    expect(a.neverAnswered).toEqual([])
    expect(a.truncation.truncated).toBe(false)
  })

  it('★ the SAME missing stock number AT the cap is NEVER ANSWERED: we do not know', () => {
    const a = auditSheet({
      sheet: sheet({ dataRows: SHEET_ROW_CAP, nsns: ['A'], atCap: true }),
      requested: ['A', 'B'],
    })
    expect(a.answered).toEqual(['A'])
    expect(a.absent).toEqual([]) // NOT absent — that would be a claim we cannot support
    expect(a.neverAnswered).toEqual(['B'])
    expect(a.truncation.truncated).toBe(true)
  })

  it('★★ POSITIVE CONTROL: the stock numbers alone cannot tell these apart — only the cap can', () => {
    // Identical requested set, identical returned set, opposite meanings. The ONLY difference in
    // the input is whether the sheet sat on the ceiling. If a future refactor drops `atCap`, this
    // test fails and the 669 come back.
    const common = { requested: ['A', 'B'] as const, nsns: ['A'] }
    const below = auditSheet({ sheet: sheet({ ...common, dataRows: 19_999, atCap: false }), requested: common.requested })
    const at = auditSheet({ sheet: sheet({ ...common, dataRows: 20_000, atCap: true }), requested: common.requested })

    expect(below.answered).toEqual(at.answered) // the answered set is identical
    expect(below.absent).not.toEqual(at.absent) // the VERDICT is not
    expect(below.absent).toEqual(['B'])
    expect(at.neverAnswered).toEqual(['B'])
    expect(Math.abs(below.dataRows - at.dataRows)).toBe(1) // one row apart, opposite conclusions
  })

  it('does not invent a re-request when the sheet answered everything it was asked', () => {
    const a = auditSheet({ sheet: sheet({ nsns: ['A', 'B'], atCap: true }), requested: ['A', 'B'] })
    expect(a.neverAnswered).toEqual([])
    expect(a.truncation.truncated).toBe(false) // at the cap, but nothing is missing
  })

  it('unions never-answered across sheets, because a re-request is per stock number', () => {
    const audit = auditWorkbook({
      reading: {
        path: '/x.xlsx',
        sha256: 'deadbeef',
        bytes: 1,
        sheets: [
          sheet({ name: 'Procurement', nsns: ['A'], dataRows: SHEET_ROW_CAP, atCap: true }),
          sheet({ name: 'MCRL', nsns: ['A', 'B'], dataRows: 10, atCap: false }),
        ],
      },
      requested: ['A', 'B'],
    })
    expect(audit.neverAnswered).toEqual(['B']) // Procurement never answered for B
    expect(audit.truncated).toBe(true)
  })
})

describe('the planning constants', () => {
  it('★ the report allowance is spent in STOCK NUMBERS, and it is nowhere near the record cap', () => {
    // The 17.5x error: chunking a list at 20,000 stock numbers against a 20,000 RECORD cap.
    expect(SAFE_NSNS_PER_REPORT).toBeLessThan(SHEET_ROW_CAP / 10)
    expect(SAFE_NSNS_PER_REPORT * MEASURED_ROWS_PER_REQUESTED_NSN).toBeLessThan(SHEET_ROW_CAP)
  })

  it('leaves real headroom, because 1,140 was the observed edge and two of three overflowed', () => {
    const predicted = SAFE_NSNS_PER_REPORT * MEASURED_ROWS_PER_REQUESTED_NSN
    expect(SHEET_ROW_CAP - predicted).toBeGreaterThan(4_000)
  })
})

/* ------------------------------------------------------------------------------------------ */
/* AGAINST THE REAL FILES. A fixture cannot prove this; the fixture is where the confusion hides. */
/* ------------------------------------------------------------------------------------------ */

const DIR = join(process.cwd(), 'data', 'nsn-now')
const real = (n: string) => join(DIR, n)
const havePull = existsSync(real('full_1.xlsx')) && existsSync(real('full_2.xlsx'))

describe.skipIf(!havePull)('the real 2026-08-15 workbooks', () => {
  /*
   * Read ONCE, with a real budget. These parse ~7MB of xlsx apiece; alone that is ~300ms, but
   * under the full suite the workers contend and it passed 5s and timed out — a green file and a
   * red suite from identical code. Reading once is also the honest shape: all three assertions
   * are about the same two measurements.
   */
  let full1!: ReturnType<typeof readBatchExportWorkbook>
  let full2!: ReturnType<typeof readBatchExportWorkbook>
  beforeAll(() => {
    full1 = readBatchExportWorkbook(real('full_1.xlsx'))
    full2 = readBatchExportWorkbook(real('full_2.xlsx'))
  }, 120_000)

  it('★ full_1 Procurement sat EXACTLY on the ceiling — the signature of a list cut short', () => {
    const proc = full1.sheets.find((s) => s.name === 'Procurement')
    expect(proc).toBeDefined()
    expect(proc!.dataRows).toBe(SHEET_ROW_CAP)
    expect(proc!.atCap).toBe(true)
  })

  it('★ full_2 Procurement stopped 34 rows SHORT, so its silences are honest absences', () => {
    const proc = full2.sheets.find((s) => s.name === 'Procurement')!
    expect(proc.dataRows).toBeLessThan(SHEET_ROW_CAP)
    expect(proc.atCap).toBe(false)
  })

  it('★★ the cap binds PER SHEET, not per report — a per-report guard would never fire', () => {
    const total = full1.sheets.reduce((s, x) => s + x.dataRows, 0)
    expect(total).toBeGreaterThan(SHEET_ROW_CAP) // 27,087 rows in one "20,000 record" report
  })
})
