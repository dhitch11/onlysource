import { describe, it, expect } from 'vitest'
import {
  FIELD_COUNT,
  MAX_LINES_PER_FILE,
  COL,
  field,
  applyVendorQuote,
  validateRow,
  buildBatch,
  serializeRow,
  parseLine,
  stripField,
  type SourceQuoteRow,
  type VendorQuote,
} from '@/lib/filing'
import { at } from '@/lib/filing/format'

/**
 * A conforming DLA source row: 121 fields, the pre-filled ones set to automated-award-conforming
 * values, the vendor columns blank. Tests overlay a vendor quote onto this and assert behaviour.
 * Nothing here is a real solicitation; the values are shaped to exercise the rules.
 */
function sourceRow(overrides: Partial<Record<number, string>> = {}): SourceQuoteRow {
  const row = new Array<string>(FIELD_COUNT).fill('')
  row[at(COL.SOLICITATION_NUMBER)] = 'SPE7M126T0001'
  row[at(COL.SOLICITATION_TYPE)] = 'F' // Fast Auto Eval
  row[at(COL.SOLICITATION_RETURN_DATE)] = '09/01/2026'
  row[at(COL.BID_TYPE)] = 'BI'
  row[at(COL.CLIN)] = '0001'
  row[at(COL.NSN)] = '5340015541274'
  row[at(COL.UNIT_OF_ISSUE)] = 'EA'
  row[at(COL.QUANTITY)] = '2'
  row[at(COL.CHILD_LABOR)] = 'N'
  row[at(COL.ITEM_DESCRIPTION_INDICATOR)] = 'P'
  for (const [col, val] of Object.entries(overrides)) if (val !== undefined) row[at(Number(col))] = val
  return row
}

const goodQuote: VendorQuote = {
  quoterCage: '1ABC2',
  unitPrice: '1620.00000',
  deliveryDays: '120',
  smallBusinessRep: 'Y',
}

describe('applyVendorQuote', () => {
  it('overlays only the vendor columns and preserves the 121-field width', () => {
    const out = applyVendorQuote(sourceRow(), goodQuote)
    expect(out).toHaveLength(FIELD_COUNT)
    expect(field(out, COL.UNIT_PRICE)).toBe('1620.00000')
    expect(field(out, COL.DELIVERY_DAYS)).toBe('120')
    expect(field(out, COL.QUOTER_CAGE)).toBe('1ABC2')
    expect(field(out, COL.QUOTE_FOR_CAGE)).toBe('1ABC2') // defaults to quoter
    // pass-through columns untouched
    expect(field(out, COL.NSN)).toBe('5340015541274')
    expect(field(out, COL.BID_TYPE)).toBe('BI')
  })

  it('does not mutate the source row', () => {
    const src = sourceRow()
    const before = src.slice()
    applyVendorQuote(src, goodQuote)
    expect(src).toEqual(before)
  })

  it('always blanks quote remarks (col 121), even if the source carried text', () => {
    const src = sourceRow({ [COL.QUOTE_REMARKS]: 'please consider our alternate' })
    const out = applyVendorQuote(src, goodQuote)
    expect(field(out, COL.QUOTE_REMARKS)).toBe('')
  })

  it('writes the offered part number only when provided', () => {
    const out = applyVendorQuote(sourceRow(), { ...goodQuote, partNumberOffered: 'FD3-125,2' })
    expect(field(out, COL.PART_NUMBER_OFFERED)).toBe('FD3-125,2')
  })
})

describe('validateRow — DLA silent traps, each named', () => {
  it('passes a conforming quote', () => {
    const r = validateRow(applyVendorQuote(sourceRow(), goodQuote), 200)
    expect(r.ok).toBe(true)
    expect(r.blocks).toHaveLength(0)
  })

  it('TRAP 1: blocks remarks on an automated-award line', () => {
    // Force remarks back in after apply (apply blanks them), to prove the validator is independent.
    const row = applyVendorQuote(sourceRow(), goodQuote).slice()
    row[at(COL.QUOTE_REMARKS)] = 'see note'
    const r = validateRow(row, 200)
    expect(r.ok).toBe(false)
    expect(r.blocks.some((b) => b.column === COL.QUOTE_REMARKS)).toBe(true)
  })

  it('TRAP 2: blank price blocks; zero price warns with the right no-charge/no-bid meaning', () => {
    expect(validateRow(applyVendorQuote(sourceRow(), { ...goodQuote, unitPrice: '' }), 200).ok).toBe(false)

    const noCharge = validateRow(applyVendorQuote(sourceRow(), { ...goodQuote, unitPrice: '0', deliveryDays: '120' }), 200)
    expect(noCharge.warnings.some((w) => /NO CHARGE/.test(w.message))).toBe(true)

    const noBid = validateRow(applyVendorQuote(sourceRow(), { ...goodQuote, unitPrice: '0', deliveryDays: '0' }), 200)
    expect(noBid.warnings.some((w) => /NO BID/.test(w.message))).toBe(true)
  })

  it('TRAP 2: a non-numeric or over-precise price blocks', () => {
    expect(validateRow(applyVendorQuote(sourceRow(), { ...goodQuote, unitPrice: '16,20' }), 200).ok).toBe(false)
    expect(validateRow(applyVendorQuote(sourceRow(), { ...goodQuote, unitPrice: '1.123456' }), 200).ok).toBe(false)
  })

  it('TRAP 3: SPM solicitations cap delivery days at 3 digits; others allow 4', () => {
    // SPM + 4-digit days blocks
    const spm = validateRow(applyVendorQuote(sourceRow({ [COL.SOLICITATION_NUMBER]: 'SPM7M126T0001' }), { ...goodQuote, deliveryDays: '1200' }), 9999)
    expect(spm.blocks.some((b) => b.column === COL.DELIVERY_DAYS)).toBe(true)
    // non-SPM + 4-digit days is fine (within requested)
    const spe = validateRow(applyVendorQuote(sourceRow({ [COL.SOLICITATION_NUMBER]: 'SPE7M126T0001' }), { ...goodQuote, deliveryDays: '1200' }), 9999)
    expect(spe.blocks.some((b) => b.column === COL.DELIVERY_DAYS)).toBe(false)
  })

  it('TRAP 5: blocks quoting more delivery days than the solicitation requires', () => {
    const r = validateRow(applyVendorQuote(sourceRow(), { ...goodQuote, deliveryDays: '300' }), 200)
    expect(r.ok).toBe(false)
    expect(r.blocks.some((b) => b.column === COL.DELIVERY_DAYS && /exceeds/.test(b.message))).toBe(true)
  })

  it('auto-DQ: a non-BI bid type on an automated line blocks', () => {
    const row = applyVendorQuote(sourceRow({ [COL.BID_TYPE]: 'BW' }), goodQuote)
    const r = validateRow(row, 200)
    expect(r.blocks.some((b) => b.column === COL.BID_TYPE)).toBe(true)
  })

  it('CAGE must be present and 5 characters', () => {
    expect(validateRow(applyVendorQuote(sourceRow(), { ...goodQuote, quoterCage: '' }), 200).ok).toBe(false)
    expect(validateRow(applyVendorQuote(sourceRow(), { ...goodQuote, quoterCage: 'ABC' }), 200).ok).toBe(false)
  })

  it('former government surplus (code 4) warns about the web-form C04 step', () => {
    const r = validateRow(applyVendorQuote(sourceRow(), { ...goodQuote, materialRequirements: '4' }), 200)
    expect(r.ok).toBe(true) // legal
    expect(r.warnings.some((w) => w.column === COL.MATERIAL_REQUIREMENTS)).toBe(true)
  })

  it('a row that is not 121 fields blocks as "not a batch quote row"', () => {
    const r = validateRow(['too', 'short'], 200)
    expect(r.ok).toBe(false)
    expect(r.blocks[0]?.message).toMatch(/not a batch quote row/)
  })
})

describe('CSV serialization', () => {
  it('serializes exactly 121 quoted fields and round-trips', () => {
    const row = applyVendorQuote(sourceRow(), { ...goodQuote, partNumberOffered: 'A"B' })
    const line = serializeRow(row)
    const back = parseLine(line)
    expect(back).toHaveLength(FIELD_COUNT)
    // the doubled-quote escaping survives the round trip in the exempt part-number field
    expect(back[at(COL.PART_NUMBER_OFFERED)]).toBe('A"B')
    expect(back[at(COL.UNIT_PRICE)]).toBe('1620.00000')
  })

  it('strips DLA-forbidden punctuation from non-exempt fields but not the part number', () => {
    // a stray comma in a non-exempt field is stripped
    expect(stripField('12,34', COL.QUOTER_CAGE)).toBe('1234')
    // the part number is exempt: its comma survives
    expect(stripField('FD3-125,2', COL.PART_NUMBER_OFFERED)).toBe('FD3-125,2')
  })

  it('refuses to serialize a row that is not 121 fields', () => {
    expect(() => serializeRow(['a', 'b'])).toThrow(/121/)
  })
})

describe('buildBatch — the outbox', () => {
  const rows = (n: number): SourceQuoteRow[] =>
    Array.from({ length: n }, (_, i) =>
      applyVendorQuote(sourceRow({ [COL.CLIN]: String(i + 1).padStart(4, '0') }), goodQuote),
    )

  it('chunks at 75 lines: 76 conforming rows produce 2 files (75 + 1)', () => {
    const res = buildBatch(rows(76), { dateStamp: '2026-08-18', requestedDeliveryDays: () => 200 })
    expect(res.ok).toBe(true)
    expect(res.files).toHaveLength(2)
    expect(res.files[0]?.lineCount).toBe(MAX_LINES_PER_FILE)
    expect(res.files[1]?.lineCount).toBe(1)
    expect(res.files[0]?.total).toBe(2)
    expect(res.files[0]?.filename).toBe('onlysource-quotes-2026-08-18-01of02.csv')
  })

  it('a single blocking row produces NO files (a batch is all-or-nothing)', () => {
    const bad = rows(3)
    bad[1] = applyVendorQuote(sourceRow(), { ...goodQuote, unitPrice: '' }) // blank price blocks
    const res = buildBatch(bad, { dateStamp: '2026-08-18', requestedDeliveryDays: () => 200 })
    expect(res.ok).toBe(false)
    expect(res.files).toHaveLength(0)
    expect(res.blocks.length).toBeGreaterThan(0)
  })

  it('each file carries a companion sheet naming the writer-not-submitter boundary', () => {
    const res = buildBatch(rows(2), { dateStamp: '2026-08-18', requestedDeliveryDays: () => 200 })
    expect(res.files[0]?.companion).toMatch(/does not submit it for you/)
    expect(res.files[0]?.companion).toMatch(/5340015541274/) // the NSN appears in the sheet
    expect(res.files[0]?.checksum).toMatch(/^[0-9a-f]{8}$/)
  })

  it('the same rows and date stamp produce identical output (deterministic, no clock)', () => {
    const a = buildBatch(rows(3), { dateStamp: '2026-08-18', requestedDeliveryDays: () => 200 })
    const b = buildBatch(rows(3), { dateStamp: '2026-08-18', requestedDeliveryDays: () => 200 })
    expect(a.files[0]?.body).toBe(b.files[0]?.body)
    expect(a.files[0]?.checksum).toBe(b.files[0]?.checksum)
  })
})
