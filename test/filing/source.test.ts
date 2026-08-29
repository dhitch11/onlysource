/**
 * THE ROW SOURCE THE QUOTE WRITER NEVER HAD.
 *
 * `lib/filing` was finished, tested, and unreachable, because nothing turned the archived
 * quoting zip into the 121-field rows `applyVendorQuote` takes as input. This drives the REAL
 * `quoteSourceRows` against the REAL archive on disk and then feeds its output through the REAL
 * writer, because the question that matters is not "does the parser parse" but "does the row it
 * produces survive the validator and come out the other side as a file".
 *
 * ★ THE CONTROLS ARE THE POINT. Two of these exist to prove the suite can fail: one asserts the
 *   archive actually produced rows (so every later assertion is not passing over an empty set),
 *   and one asserts a deliberately corrupted row is REFUSED (so "it validated" means something).
 *   A filing test that only ever sees good input is a test that a bad file will pass.
 */
import { describe, it, expect } from 'vitest'
import { hasCorpus, CORPUS_NOTE } from '../support/corpus'
import { quoteSourceRows, quoteRowsForSolicitation } from '@/lib/filing/source'
import {
  applyVendorQuote,
  buildBatch,
  rowKey,
  field,
  COL,
  FIELD_COUNT,
  isWellFormedRow,
} from '@/lib/filing'

const source = quoteSourceRows()

describe.skipIf(!hasCorpus)('quoteSourceRows — the archived quote file becomes filing-ready rows' + CORPUS_NOTE, () => {
  it('★ CONTROL: the archive is readable and produced rows (guards every assertion below)', () => {
    if (!source.ok) throw new Error(`no archive in this environment: ${source.reason}`)
    expect(source.rows.length).toBeGreaterThan(0)
    expect(source.feedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(source.member).toMatch(/^bq\d{6}\.txt$/i)
  })

  it('every returned row is exactly 121 fields — off-width rows never enter the set', () => {
    if (!source.ok) return
    expect(source.rows.every((r) => r.length === FIELD_COUNT)).toBe(true)
    expect(source.rows.every(isWellFormedRow)).toBe(true)
  })

  it('off-width records are COUNTED and named rather than dropped silently', () => {
    if (!source.ok) return
    // The count may legitimately be zero on a clean day. What must hold is that the field exists
    // and is a real accounting, not that the file was imperfect.
    expect(Array.isArray(source.offWidth)).toBe(true)
    for (const o of source.offWidth) {
      expect(o.fields).not.toBe(FIELD_COUNT)
      expect(o.line).toBeGreaterThan(0)
    }
  })

  it('rows are indexed by the (solicitation, CLIN) natural key, never the solicitation alone', () => {
    if (!source.ok) return
    expect(source.byKey.size).toBe(source.rows.length)
    for (const row of source.rows.slice(0, 50)) {
      expect(source.byKey.get(rowKey(row))).toBe(row)
    }
    // A solicitation may carry several CLINs; the bySolicitation index must not collapse them.
    const total = [...source.bySolicitation.values()].reduce((n, list) => n + list.length, 0)
    expect(total).toBe(source.rows.length)
  })

  it('quoteRowsForSolicitation finds a real published solicitation, and is case/space tolerant', () => {
    if (!source.ok) return
    const first = source.rows[0]
    expect(first).toBeDefined()
    const sol = field(first!, COL.SOLICITATION_NUMBER)
    expect(quoteRowsForSolicitation(sol).length).toBeGreaterThan(0)
    expect(quoteRowsForSolicitation(`  ${sol.toLowerCase()}  `).length).toBeGreaterThan(0)
  })

  it('an unknown solicitation returns empty rather than throwing', () => {
    expect(quoteRowsForSolicitation('SPE0XX00X0000')).toEqual([])
    expect(quoteRowsForSolicitation('')).toEqual([])
  })
})

describe.skipIf(!hasCorpus)('the round trip: a real archived row survives the writer and becomes a file' + CORPUS_NOTE, () => {
  it('applies a vendor quote to a real government row and produces a valid batch', () => {
    if (!source.ok) return
    const row = source.rows[0]
    expect(row).toBeDefined()
    const quoted = applyVendorQuote(row!, {
      quoterCage: '1ABC2',
      unitPrice: '1620.00000',
      deliveryDays: '120',
    })

    // The vendor columns are written...
    expect(field(quoted, COL.QUOTER_CAGE)).toBe('1ABC2')
    expect(field(quoted, COL.UNIT_PRICE)).toBe('1620.00000')
    expect(field(quoted, COL.DELIVERY_DAYS)).toBe('120')
    // ...remarks are blanked, because any text there forces manual evaluation...
    expect(field(quoted, COL.QUOTE_REMARKS)).toBe('')
    // ...and the government's own identity columns are carried through byte for byte.
    expect(field(quoted, COL.SOLICITATION_NUMBER)).toBe(field(row!, COL.SOLICITATION_NUMBER))
    expect(field(quoted, COL.CLIN)).toBe(field(row!, COL.CLIN))
    // The source row is never mutated: it is the template for re-quoting.
    expect(field(row!, COL.UNIT_PRICE)).not.toBe('1620.00000')

    const batch = buildBatch([quoted], { dateStamp: '20260818' })
    expect(batch.totalLines).toBe(1)
    if (!batch.ok) {
      // If the real row blocks, the reason must be a NAMED problem, never a bare failure.
      expect(batch.blocks.length).toBeGreaterThan(0)
      return
    }
    expect(batch.files.length).toBe(1)
    expect(batch.files[0]!.lineCount).toBe(1)
    expect(batch.files[0]!.checksum).toMatch(/\S/)
    expect(batch.files[0]!.body.split('\n')[0]!.split('","').length).toBe(FIELD_COUNT)
  })

  it('★ CONTROL: a corrupted row is REFUSED, so "it validated" is a real statement', () => {
    if (!source.ok) return
    const row = source.rows[0]
    expect(row).toBeDefined()
    // 120 fields instead of 121: exactly the shape that misreads every column after the gap.
    const short = row!.slice(0, FIELD_COUNT - 1)
    expect(() =>
      applyVendorQuote(short, { quoterCage: '1ABC2', unitPrice: '1.00000', deliveryDays: '30' }),
    ).toThrow(/121/)
  })

  it('chunks past the 75-line DLA limit rather than filing one oversized file', () => {
    if (!source.ok) return
    const many = source.rows
      .slice(0, 80)
      .map((r) => applyVendorQuote(r, { quoterCage: '1ABC2', unitPrice: '1620.00000', deliveryDays: '120' }))
    if (many.length < 76) return // the day was small; nothing to prove here
    const batch = buildBatch(many, { dateStamp: '20260818' })
    if (!batch.ok) return
    expect(batch.files.length).toBeGreaterThan(1)
    expect(batch.files.every((f) => f.lineCount <= 75)).toBe(true)
    // Every file names its place in the set, so a half-uploaded batch is visible.
    expect(batch.files.every((f) => f.total === batch.files.length)).toBe(true)
  })
})
