/**
 * THE CONSEQUENCE, MEASURED THROUGH THE SERVING PATH ON THE REAL GOVERNMENT FILE.
 *
 * size-of-buy.test.ts pins the arithmetic against synthetic inputs. This file answers the
 * different question: on the workbook the product actually serves, how many real solicitations
 * did the zero delete from the page, and are they now reachable?
 *
 * It reads through `buildNoQuoteGoldmine`, the same builder /goldmine renders from, rather than
 * re-parsing the workbook with a second reader. A fixture cannot drift from the file here
 * because there is no fixture.
 *
 * INDEPENDENTLY MEASURED FIRST, with a stdlib OOXML reader that shares no code with this repo's
 * parser (.probe, 2026-08-18, data/seed/NO QUOTES.xlsx, sheet "Solicitation", column E =
 * Solicitation Quantity, column I = Last Sold Price):
 *
 *     839 data rows
 *     771 carry both legs
 *      68 carry a quantity and NO last sold price          (8.1%)
 *       0 carry a price and no quantity
 *       0 carry neither
 *      61 of the 68 are make-side; 7 are sourcing
 *     the 60th make-side row by size is $211,500, so all 61 fell past the cut
 *
 * The assertions below deliberately do NOT pin 68 exactly. The feed changes and a test that
 * fails when the government publishes a different file is a test that gets deleted. What is
 * pinned is the INVARIANT: whatever the count, an unpriced row is never sized, never sums into
 * a total, and never sorts as though it were worth nothing.
 */

import { describe, expect, it } from 'vitest'
import { buildNoQuoteGoldmine } from '@/lib/intelligence/datasets'
import { resolveDataRoot } from '@/lib/data-root'
import {
  partitionBySizeKnown,
  sizeOfBuy,
  totalKnownSize,
} from '@/lib/intelligence/opportunities/size-of-buy'

/** The cut each /goldmine section applies to its ranked table. */
const SHOWN = 60

/*
 * An environment with no data directory cannot measure a file it does not have, and inventing
 * a verdict for it would be the defect this whole lane is about. The suite says which case it
 * is in rather than passing quietly either way.
 */
const dataPresent = resolveDataRoot().present

describe.skipIf(!dataPresent)('the no-quote file, as the goldmine actually reads it', () => {
  const nq = buildNoQuoteGoldmine()
  const rows = nq.rows.map((r) => ({
    nsn: r.nsn,
    quantity: r.quantity,
    lastSoldPrice: r.lastSoldPrice,
    makeSide: r.holders.length === 0,
    size: sizeOfBuy(r.lastSoldPrice, r.quantity),
  }))
  const unpriced = rows.filter((r) => r.lastSoldPrice == null && r.quantity != null)

  it('the file really does carry buys with a quantity and no price, which is the whole premise', () => {
    // The guard against a vacuous pass: if this is ever 0, every assertion below is trivially
    // true and proves nothing, so the premise is asserted before the conclusions.
    expect(rows.length).toBeGreaterThan(100)
    expect(unpriced.length).toBeGreaterThan(0)
  })

  it('never sizes one of them, and never lets a zero stand in for the missing price', () => {
    for (const r of unpriced) {
      expect(r.size.known).toBe(false)
      expect((r.size as { usd?: number }).usd).toBeUndefined()
    }
  })

  it('keeps every one of them out of the make-side total, and reports how many', () => {
    const makeSide = rows.filter((r) => r.makeSide)
    const total = totalKnownSize(makeSide)
    expect(total.counted + total.unsized).toBe(makeSide.length)
    expect(total.unsized).toBe(makeSide.filter((r) => !r.size.known).length)
    // The total is the sum of the sized rows and nothing else, recomputed independently here.
    const expected = makeSide.reduce((s, r) => (r.size.known ? s + r.size.usd : s), 0)
    expect(total.usd).toBeCloseTo(expected, 6)
  })

  it('THE DEFECT, REPRODUCED: under the old zero rule these rows fell past the 60-row cut', () => {
    const makeSide = rows.filter((r) => r.makeSide)
    const oldEst = (r: (typeof makeSide)[number]) => (r.size.known ? r.size.usd : 0)
    const oldOrder = [...makeSide].sort((a, b) => oldEst(b) - oldEst(a))
    const rendered = new Set(oldOrder.slice(0, SHOWN))
    const hidden = makeSide.filter((r) => !r.size.known && !rendered.has(r))
    // Every unsized make-side row was invisible: not one of them reached the rendered slice.
    expect(hidden.length).toBe(makeSide.filter((r) => !r.size.known).length)
    expect(hidden.length).toBeGreaterThan(0)
  })

  it('now reaches the operator: the unsized class is its own list with its own count', () => {
    const makeSide = rows.filter((r) => r.makeSide)
    const { sized, unsized } = partitionBySizeKnown(makeSide)
    expect(sized.length + unsized.length).toBe(makeSide.length)
    expect(unsized.length).toBeGreaterThan(0)
    // Ranked by the one magnitude the government did publish, so the block is ordered, not a heap.
    const quantities = unsized.map((r) => r.quantity ?? -1)
    expect(quantities).toEqual([...quantities].sort((a, b) => b - a))
    // And the ranked table above it still carries only rows that have a real figure.
    expect(sized.every((r) => r.size.known)).toBe(true)
  })
})

describe.skipIf(dataPresent)('no data directory in this environment', () => {
  it('says so rather than reporting a measurement it could not take', () => {
    expect(resolveDataRoot().present).toBe(false)
  })
})
