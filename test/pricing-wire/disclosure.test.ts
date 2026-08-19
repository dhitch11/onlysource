/**
 * A CAP THE READER HAS TO DERIVE IS THE SILENT VERSION OF A CAP.
 *
 * `/pricing` renders a bounded board. It used to say "Showing the top 1,200" in one sentence and
 * "counted over all 5,488" in another, and left the operator to subtract 4,288 for themselves.
 * Nobody subtracts. On the page that tells somebody what to bid, the rows they cannot reach are
 * the fact, and a fact assembled from two sentences by the reader is not stated.
 *
 * So the count and the sentence come from `boundPricingRowsForWire` rather than being composed at
 * the render site. A sentence built in a page from three separate fields is one edit away from
 * dropping the half that hurts, and this one already had a hardcoded "3.93MB" in it that had
 * stopped being true of anything.
 *
 * POSITIVE CONTROL, run by hand and recorded here: returning `withheld: 0` unconditionally turns
 * the first two tests red, and dropping the count out of the sentence turns the third red.
 */
import { describe, expect, it } from 'vitest'
import { boundPricingRowsForWire, type PricingWireRow } from '@/app/(app)/pricing/wire'

const row = (n: number): PricingWireRow =>
  ({
    digits: String(100000000 + n),
    nsn: `1005-01-${String(n).padStart(3, '0')}-0000`,
    nomenclature: 'TEST ITEM',
    solicitation: `SPE${n}`,
    quantity: 1,
    returnDate: '2026-09-01',
    lifecycle: 'open',
    soleSource: false,
    rung: null,
    rungLabel: 'no rung on the ladder reached',
    confidence: null,
    figure: null,
    quotedTotal: null,
    observationCount: null,
    basisDateIso: null,
    arithmetic: null,
    sentence: 'nothing reached',
    missingInput: 'award history',
    crossesDladBand: false,
    wouldSharpenWith: [],
    caveats: [],
  }) as unknown as PricingWireRow

const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i))

describe('the board says what it is not showing', () => {
  it('counts the withheld rows rather than leaving them to be inferred', () => {
    const bound = boundPricingRowsForWire(rows(5488), 1200)
    expect(bound.shipped).toHaveLength(1200)
    expect(bound.withheld).toBe(4288)
  })

  it('names the withheld count IN THE SENTENCE, not only in a field', () => {
    // A number available on the object and absent from the prose is a number nobody reads.
    const bound = boundPricingRowsForWire(rows(5488), 1200)
    expect(bound.disclosure).toContain('4,288')
    expect(bound.disclosure).toContain('NOT')
    expect(bound.disclosure).toContain('5,488')
  })

  it('says everything is shown when nothing was withheld, and claims no cap that did not apply', () => {
    // The Friday board is 331 rows against a 1,200 budget. Saying "the top 331" there would be a
    // different lie: it implies a cap the reader is not subject to.
    const bound = boundPricingRowsForWire(rows(331), 1200)
    expect(bound.withheld).toBe(0)
    expect(bound.disclosure).toContain('331')
    expect(bound.disclosure).not.toMatch(/NOT shown/i)
  })

  it('never reports negative withholding when the budget exceeds the board', () => {
    expect(boundPricingRowsForWire(rows(10), 1200).withheld).toBe(0)
  })

  it('withholds everything when the budget is zero, and says so', () => {
    // A degenerate budget must produce an honest sentence rather than a cheerful empty page.
    const bound = boundPricingRowsForWire(rows(50), 0)
    expect(bound.shipped).toHaveLength(0)
    expect(bound.withheld).toBe(50)
    expect(bound.disclosure).toContain('50')
  })
})
