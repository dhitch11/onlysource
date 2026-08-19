/**
 * THE BINARY ACQUISITION-CODE INDEX: the reader, and every way it is allowed to refuse.
 *
 * The index moved from a JSON array parsed into a resident Map to a sorted fixed-width file
 * binary-searched on a descriptor, because the catalogue-wide scope is 7,060,851 NIINs and the
 * old shape would have been roughly 1.5 GB of JS on a 2 GB production box.
 *
 * A reader that returns rows is easy to believe and easy to get wrong at the edges, so every
 * assertion here has a NEGATIVE counterpart: the boundary records, the values either side of
 * the range, a NIIN that is absent from a file that definitely contains its neighbours, a
 * truncated file, and a sidecar that disagrees with the bytes. A lookup that silently returns
 * the wrong neighbour is the failure this shape invites, because a binary search that is off
 * by one still returns something.
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { loadAmscIndex, resetAmscIndexCache } from '@/lib/intelligence/eligibility/bid-eligibility'

const STRIDE = 10

/** Build a real index on disk: `rows` must be given in ascending NIIN order, as the writer emits. */
function writeIndex(
  rows: Array<{ niin: string; amc: string; amsc: string; aac: string; pica: number; flags?: number }>,
  opts: { dictionary?: string[]; truncateBytes?: number; claimRecords?: number } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'amsc-bin-'))
  mkdirSync(join(dir, 'flis'), { recursive: true })
  const buf = Buffer.alloc(rows.length * STRIDE)
  rows.forEach((r, i) => {
    const o = i * STRIDE
    buf.writeUInt32BE(Number(r.niin), o)
    buf.writeUInt8(r.amc ? r.amc.charCodeAt(0) : 0, o + 4)
    buf.writeUInt8(r.amsc ? r.amsc.charCodeAt(0) : 0, o + 5)
    buf.writeUInt8(r.aac ? r.aac.charCodeAt(0) : 0, o + 6)
    buf.writeUInt8(r.flags ?? 0, o + 7) // byte 7: contested flags (0 = nothing contested)
    buf.writeUInt16BE(r.pica, o + 8)
  })
  const bytes = opts.truncateBytes === undefined ? buf : buf.subarray(0, opts.truncateBytes)
  writeFileSync(join(dir, 'flis', 'amsc-index.bin'), bytes)
  writeFileSync(
    join(dir, 'flis', 'amsc-index.meta.json'),
    JSON.stringify({
      recordBytes: STRIDE,
      records: opts.claimRecords ?? rows.length,
      picaDictionary: opts.dictionary ?? ['GX', 'ZW'],
      publishers: { GX: { rows: 10000, withAmsc: 10000, rate: 1 } },
      provenance: { scope: 'test fixture' },
    }),
  )
  return dir
}

const made: string[] = []
function withIndex(...args: Parameters<typeof writeIndex>): void {
  const dir = writeIndex(...args)
  made.push(dir)
  process.env.ONLYSOURCE_DATA_DIR = dir
  resetAmscIndexCache()
}

afterEach(() => {
  delete process.env.ONLYSOURCE_DATA_DIR
  resetAmscIndexCache()
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

const ROWS = [
  { niin: '000000001', amc: '1', amsc: 'G', aac: 'B', pica: 1 },
  { niin: '000000005', amc: '3', amsc: 'P', aac: '', contested: { amc: false, amsc: false, selfContradiction: false }, pica: 1 },
  { niin: '000000009', amc: '', amsc: '', aac: '', contested: { amc: false, amsc: false, selfContradiction: false }, pica: 2 },
  { niin: '123456789', amc: '5', amsc: 'C', aac: 'D', pica: 1 },
  { niin: '999999999', amc: '2', amsc: 'Z', aac: '', contested: { amc: false, amsc: false, selfContradiction: false }, pica: 2 },
]

describe('the binary index resolves exactly the records it holds', () => {
  it('reports the binary backing and its true size', () => {
    withIndex(ROWS)
    const idx = loadAmscIndex()
    expect(idx.ok).toBe(true)
    if (!idx.ok) return
    expect(idx.backing).toBe('binary')
    expect(idx.size).toBe(ROWS.length)
  })

  it('finds every record, including both boundaries', () => {
    withIndex(ROWS)
    const idx = loadAmscIndex()
    if (!idx.ok) throw new Error('index did not load')
    for (const r of ROWS) {
      const got = idx.lookup(r.niin)
      expect(got, `NIIN ${r.niin} must resolve`).toBeDefined()
      expect(got!.amc).toBe(r.amc)
      expect(got!.amsc).toBe(r.amsc)
      expect(got!.aac).toBe(r.aac)
      expect(got!.pica).toBe(r.pica === 1 ? 'GX' : 'ZW')
    }
  })

  /*
   * THE CONTROL THAT MATTERS. A binary search that is off by one still returns a record, so
   * "it found something" proves nothing. These NIINs sit BETWEEN and OUTSIDE held records and
   * must resolve to nothing at all rather than to a neighbour.
   */
  it('returns nothing for a NIIN between two held records, and outside them', () => {
    withIndex(ROWS)
    const idx = loadAmscIndex()
    if (!idx.ok) throw new Error('index did not load')
    for (const absent of ['000000000', '000000002', '000000004', '000000006', '000000008', '123456788', '123456790', '500000000']) {
      expect(idx.lookup(absent), `NIIN ${absent} is not in the index and must not resolve`).toBeUndefined()
    }
  })

  it('refuses a stock number that is not nine digits rather than guessing', () => {
    withIndex(ROWS)
    const idx = loadAmscIndex()
    if (!idx.ok) throw new Error('index did not load')
    for (const bad of ['', '1', '12345678', '1234567890', 'abcdefghi']) {
      expect(idx.lookup(bad)).toBeUndefined()
    }
  })

  it('samples the whole file rather than its head', () => {
    withIndex(ROWS)
    const idx = loadAmscIndex()
    if (!idx.ok) throw new Error('index did not load')
    const two = idx.niins(2)
    expect(two).toHaveLength(2)
    // A head sample would return the two LOWEST NIINs. A full-range stride must return the
    // first and the LAST, which is the property a `count / want` step quietly fails.
    expect(two[0]).toBe('000000001')
    expect(two[1]).toBe('999999999')
    expect(idx.niins()).toHaveLength(ROWS.length)
  })
})

describe('the binary index refuses a file it cannot vouch for', () => {
  it('refuses a truncated file instead of reading a partial record', () => {
    withIndex(ROWS, { truncateBytes: ROWS.length * STRIDE - 3 })
    const idx = loadAmscIndex()
    expect(idx.ok).toBe(false)
    if (idx.ok) return
    expect(idx.reason).toContain('truncated')
  })

  it('refuses when the sidecar disagrees with the bytes on disk', () => {
    withIndex(ROWS, { claimRecords: ROWS.length + 4 })
    const idx = loadAmscIndex()
    expect(idx.ok).toBe(false)
    if (idx.ok) return
    expect(idx.reason).toContain('were not written together')
  })

  it('refuses an empty index rather than reporting every NIIN absent', () => {
    withIndex([])
    const idx = loadAmscIndex()
    expect(idx.ok).toBe(false)
  })
})

/* ---------------------------------------------------------------------------------- */
/* ★ THE CONTESTED FLAGS: A TIE BROKEN ON FILE POSITION IS NOT A GOVERNMENT FACT       */
/* ---------------------------------------------------------------------------------- */

describe('contested flags', () => {
  it('reports nothing contested when the authorities agree', () => {
    withIndex([{ niin: '000000001', amc: '1', amsc: 'G', aac: '', pica: 1 }])
    const idx = loadAmscIndex()
    if (!idx.ok) throw new Error(idx.reason)
    expect(idx.lookup('000000001')?.contested).toEqual({
      amc: false,
      amsc: false,
      selfContradiction: false,
    })
  })

  it('★ surfaces a disagreement rather than presenting the winning row as settled', () => {
    /*
     * Measured on the real catalogue: 3,260,593 NIINs carry more than one MOE rule and
     * 1,076,346 produce a genuine tie, but in 99.99% of those the tied rows AGREE. Only 116
     * disagree on AMC. EXPOSURE IS NOT HARM -- and 116 is not zero, and each one was a coin
     * flip on file order rendered as a determination.
     */
    withIndex([{ niin: '000000002', amc: '3', amsc: 'D', aac: '', pica: 1, flags: 1 }])
    const idx = loadAmscIndex()
    if (!idx.ok) throw new Error(idx.reason)
    const row = idx.lookup('000000002')
    expect(row?.contested.amc).toBe(true)
    expect(row?.contested.amsc).toBe(false)
    // The chosen row is still returned. The flag says another authority disagreed with it,
    // not that the value is absent.
    expect(row?.amc).toBe('3')
  })

  it('separates one activity contradicting ITSELF from two activities disagreeing', () => {
    // Not a tie between sources: a data-quality signal about one source. Twenty-four NIINs carry it.
    withIndex([{ niin: '000000003', amc: '3', amsc: 'D', aac: '', pica: 1, flags: 1 | 4 }])
    const idx = loadAmscIndex()
    if (!idx.ok) throw new Error(idx.reason)
    expect(idx.lookup('000000003')?.contested).toEqual({
      amc: true,
      amsc: false,
      selfContradiction: true,
    })
  })

  it('★ an index written BEFORE the flags existed reads as nothing contested, not as agreement', () => {
    /*
     * Byte 7 was `reserved, always 0`. An older file therefore reads all-false -- which is the
     * correct answer for a file that COULD NOT record the fact. The distinction matters: the
     * index is saying "no conflict was recorded", and a surface must not upgrade that into
     * "the authorities were checked and agreed."
     */
    withIndex([{ niin: '000000004', amc: '5', amsc: 'H', aac: '', pica: 1 }]) // flags omitted
    const idx = loadAmscIndex()
    if (!idx.ok) throw new Error(idx.reason)
    expect(idx.lookup('000000004')?.contested.amc).toBe(false)
    // POSITIVE CONTROL: the reader is genuinely reading byte 7 and not defaulting.
    withIndex([{ niin: '000000004', amc: '5', amsc: 'H', aac: '', pica: 1, flags: 2 }])
    const idx2 = loadAmscIndex()
    if (!idx2.ok) throw new Error(idx2.reason)
    expect(idx2.lookup('000000004')?.contested.amsc).toBe(true)
  })
})
