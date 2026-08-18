/**
 * THE SILENT ZERO, AND THE ORDER IT CORRUPTED.
 *
 * Two opportunity surfaces computed the modeled size of a buy inline and both wrote:
 *
 *     const est = price != null && qty != null ? price * qty : price ?? 0
 *
 * The trailing zero is not a size. It is the ABSENCE of a size spelled with a digit, and both
 * pages rank by that number descending and cut the list at 60 rows. An unpriced solicitation
 * therefore sorted below every priced row on the file and was never rendered, inside a list
 * captioned "sorted by the size of the buy".
 *
 * ==========================================================================================
 * EVERY CASE HERE IS SYNTHETIC AND ITS ANSWER IS KNOWN BEFORE THE CODE RUNS.
 * ==========================================================================================
 * That is deliberate. A check written by the same head that wrote the implementation, over the
 * same real file, can reproduce the implementation's own misreading and confirm it. So the
 * arithmetic is pinned against inputs a person can verify by hand (7 x 3 is 21), and the
 * separate real-file test measures the CONSEQUENCE against the government workbook.
 *
 * ==========================================================================================
 * THE POSITIVE CONTROLS, AND WHAT REMOVING THE FIX DOES TO EACH.
 * ==========================================================================================
 *   - "an unread price is not a size of zero"      restore `: price ?? 0` and it fails: the
 *                                                  result becomes {known:true, usd:0}.
 *   - "an unstated quantity is not a quantity of 1" restore it and it fails: 12 comes back as
 *                                                  a size when nobody said how many.
 *   - "the unsized rows survive the 60-row cut"     restore it and it fails: the unpriced row
 *                                                  lands at rank 61 of 61 and is sliced away.
 */

import { describe, expect, it } from 'vitest'
import {
  compareBySizeOfBuy,
  partitionBySizeKnown,
  sizeOfBuy,
  SIZE_UNKNOWN_REASON,
  totalKnownSize,
  type Sizable,
} from '@/lib/intelligence/opportunities/size-of-buy'

/** The cut both surfaces apply to a section. Mirrored here so the ranking test is the real one. */
const SHOWN = 60

const row = (lastSoldPrice: number | null, quantity: number | null, tag: string) => ({
  tag,
  quantity,
  size: sizeOfBuy(lastSoldPrice, quantity),
})

describe('sizeOfBuy: a size, or the stated reason there is not one', () => {
  it('multiplies the two measured legs and nothing else', () => {
    const s = sizeOfBuy(7, 3)
    expect(s.known).toBe(true)
    expect(s).toEqual({ known: true, usd: 21 })
  })

  it('an unread price is NOT a size of zero, it is an unknown size', () => {
    const s = sizeOfBuy(null, 268)
    expect(s.known).toBe(false)
    // The shape assertion is the control. `usd` must not exist at all: a caller cannot
    // accidentally read a zero out of an absence if there is no field to read.
    expect(s).toEqual({ known: false, reason: 'no_recorded_price' })
    expect((s as { usd?: number }).usd).toBeUndefined()
  })

  it('an unstated quantity is NOT a quantity of one, so a unit price is not a size', () => {
    const s = sizeOfBuy(12, null)
    expect(s).toEqual({ known: false, reason: 'no_stated_quantity' })
  })

  it('names the both-absent case separately, because it is a different fact', () => {
    expect(sizeOfBuy(null, null)).toEqual({ known: false, reason: 'neither_recorded' })
  })

  it('treats a NaN or an Infinity from a parser as unread rather than computing with it', () => {
    expect(sizeOfBuy(Number.NaN, 10)).toEqual({ known: false, reason: 'no_recorded_price' })
    expect(sizeOfBuy(10, Number.POSITIVE_INFINITY)).toEqual({
      known: false,
      reason: 'no_stated_quantity',
    })
  })

  it('a genuine zero price is a MEASURED zero and stays known, unlike an absent one', () => {
    // The distinction the old line destroyed: 0 read from the file and 0 invented by a fallback
    // are different facts, and only one of them may render as a number.
    expect(sizeOfBuy(0, 5)).toEqual({ known: true, usd: 0 })
  })

  it('carries an operator-readable sentence for every absence it can report', () => {
    for (const reason of ['no_recorded_price', 'no_stated_quantity', 'neither_recorded'] as const) {
      expect(SIZE_UNKNOWN_REASON[reason]).toMatch(/cannot be computed$/)
    }
  })
})

describe('compareBySizeOfBuy: unknown is its own class, never the smallest', () => {
  it('ranks a measured size above an unknown one, however large that unknown buy looks', () => {
    const tiny = row(1, 1, 'a $1 buy')
    const huge = row(null, 100_000, 'unpriced, 100,000 units')
    // Positive, so `tiny` sorts first. The unknown is not promoted: nothing in the file says it
    // is bigger, and asserting that would be the mirror image of the zero.
    expect(compareBySizeOfBuy(huge, tiny)).toBeGreaterThan(0)
    expect(compareBySizeOfBuy(tiny, huge)).toBeLessThan(0)
  })

  it('ranks unknowns among themselves by the quantity the government DID publish', () => {
    const big = row(null, 268, 'unpriced, 268 units')
    const small = row(null, 1, 'unpriced, 1 unit')
    expect(compareBySizeOfBuy(big, small)).toBeLessThan(0)
  })

  it('puts a row with no quantity to rank by at the very end of the unknown class', () => {
    const someQty = row(null, 1, 'unpriced, 1 unit')
    const noQty = row(null, null, 'nothing recorded at all')
    expect(compareBySizeOfBuy(someQty, noQty)).toBeLessThan(0)
  })
})

describe('the 60-row cut: what the zero actually hid', () => {
  /*
   * A reconstruction of the measured make-side shape, at 1/8 scale in row count but with the
   * real boundary figure. On the live file the 60th make-side row by size is $211,500 and 61
   * unpriced rows sit below it. Here: 60 priced rows ending at $211,500, plus the one real
   * unpriced 268-unit row from the workbook. Under the old rule its est was 0, so it ranked
   * 61st of 61 and the `.slice(0, 60)` deleted it from the page.
   */
  const priced: Array<Sizable & { tag: string }> = Array.from({ length: SHOWN }, (_, i) =>
    row(1_000, 211.5 + (SHOWN - i) * 100, `priced #${i}`),
  )
  const unpriced = row(null, 268, 'the 268-unit buy with no price history')
  const all = [...priced, unpriced]

  it('would have been cut under the old rule: sorting by a zeroed size puts it last', () => {
    // The defect, reproduced. This is not the fix under test; it is the proof the fix has a job.
    const oldEst = (r: (typeof all)[number]) => (r.size.known ? r.size.usd : 0)
    const oldOrder = [...all].sort((a, b) => oldEst(b) - oldEst(a))
    expect(oldOrder.indexOf(unpriced)).toBe(SHOWN)
    expect(oldOrder.slice(0, SHOWN)).not.toContain(unpriced)
  })

  it('now lands in its own class, where the surface renders it with a count', () => {
    const { sized, unsized } = partitionBySizeKnown(all)
    expect(sized).toHaveLength(SHOWN)
    expect(unsized).toEqual([unpriced])
    // And it is NOT smuggled into the ranked list, which would claim a size it does not have.
    expect(sized.slice(0, SHOWN)).not.toContain(unpriced)
  })

  it('ranks the sized class exactly as before, largest first', () => {
    const { sized } = partitionBySizeKnown(all)
    const sizes = sized.map((r) => (r.size.known ? r.size.usd : Number.NaN))
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
  })
})

describe('totalKnownSize: the money and the omission travel together', () => {
  it('sums only what it could size, and reports how many it could not', () => {
    const rows = [row(10, 2, 'a'), row(5, 4, 'b'), row(null, 9, 'c'), row(3, null, 'd')]
    expect(totalKnownSize(rows)).toEqual({ usd: 40, counted: 2, unsized: 2 })
  })

  it('reports zero counted rather than a zero total when nothing could be sized', () => {
    // A caller reading `counted === 0` renders an honest dash; a caller reading `usd === 0`
    // would render "$0", which is the same lie one level up from the per-row zero.
    expect(totalKnownSize([row(null, 1, 'a'), row(null, 2, 'b')])).toEqual({
      usd: 0,
      counted: 0,
      unsized: 2,
    })
  })
})
