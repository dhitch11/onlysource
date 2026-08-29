/**
 * WHAT CROSSES THE WIRE TO THE MONOPOLY GRID, SETTLED ON AN INPUT WHOSE ANSWER IS KNOWN.
 *
 * =========================================================================================
 * WHY THIS FIXTURE IS SHAPED THE WAY IT IS
 * =========================================================================================
 * The bound exists because widening demand to the archived window took the /monopoly flight
 * payload from 0.342MB to 25.98MB per visit. The obvious implementation of a bound is "rank by
 * CornerScore and take the top N", and MEASURED on the real archive at this budget that ships
 * 57 of the 273 candidate corners: it silently drops 216 rows from the one tab the page opens
 * on. So the
 * candidates in this fixture carry the LOWEST scores on the board. A naive top-N passes every
 * size assertion here and fails every candidate assertion, which is the whole point of writing
 * the fixture upside down rather than the way the data happens to look today.
 *
 * Every expected number below is a literal that was known before `boundRowsForWire` ran: ten
 * rows in, three of them candidates, four sole-sourced without a silent incumbent, three with
 * more than one approved source.
 */

import { describe, expect, it } from 'vitest'

import { boundRowsForWire, isCandidateCorner, type BoundableRow } from '@/app/(app)/monopoly/wire-bound'

type Row = BoundableRow & { id: string }

const row = (id: string, scoreV0: number, soleSource: boolean, silentSourceCount: number): Row => ({
  id,
  soleSource,
  silentSourceCount,
  score: { scoreV0, rankKey: scoreV0, hidden: false, disposition: "WATCHLIST" },
})

/*
 * THE BOARD, UPSIDE DOWN ON PURPOSE.
 *   c1 c2 c3   candidates, scores 3 / 2 / 1, the three LOWEST on the board
 *   s1..s4     sole-sourced, incumbent NOT silent, scores 90 / 80 / 70 / 60
 *   m1..m3     more than one approved source, scores 95 / 85 / 75
 */
const BOARD: Row[] = [
  row('m1', 95, false, 0),
  row('s1', 90, true, 0),
  row('m2', 85, false, 0),
  row('s2', 80, true, 0),
  row('m3', 75, false, 0),
  row('s3', 70, true, 0),
  row('s4', 60, true, 0),
  row('c1', 3, true, 1),
  row('c2', 2, true, 2),
  row('c3', 1, true, 1),
]

describe('the wire bound', () => {
  it('reads candidacy the way the map defines it, not the way the score orders it', () => {
    expect(isCandidateCorner(row('x', 100, true, 1))).toBe(true)
    // Sole-sourced but the incumbent is still winning awards: not a candidate.
    expect(isCandidateCorner(row('x', 100, true, 0))).toBe(false)
    // Award-silent but somebody else may also make it: not a corner.
    expect(isCandidateCorner(row('x', 100, false, 3))).toBe(false)
  })

  it('ships EVERY candidate corner even when every one of them scores at the bottom', () => {
    const bound = boundRowsForWire(BOARD, 5)

    // THE CONTROL. A top-5-by-score would be m1, s1, m2, s2, m3 and would carry zero
    // candidates. Reverting the bound to a plain `ranked.slice(0, budget)` turns this red.
    const shippedIds = bound.shipped.map((r) => r.id)
    expect(shippedIds).toContain('c1')
    expect(shippedIds).toContain('c2')
    expect(shippedIds).toContain('c3')
    expect(bound.shipped.filter(isCandidateCorner)).toHaveLength(3)

    // Five rows, the three candidates plus the two highest-scoring others.
    expect(shippedIds).toEqual(['m1', 's1', 'c1', 'c2', 'c3'])
    expect(bound.shipped).toHaveLength(5)
  })

  it('never exceeds the budget, and gives candidates the budget when they fill it', () => {
    const tight = boundRowsForWire(BOARD, 2)
    expect(tight.shipped).toHaveLength(2)
    // The two highest-scoring CANDIDATES, not the two highest-scoring rows.
    expect(tight.shipped.map((r) => r.id)).toEqual(['c1', 'c2'])

    const zero = boundRowsForWire(BOARD, 0)
    expect(zero.shipped).toHaveLength(0)
    // And the counts still describe the whole board, which is what makes an empty page honest
    // rather than an empty map.
    expect(zero.totals).toEqual({ candidate: 3, sole: 7, all: 10 })
  })

  it('counts the totals over the WHOLE board, never over the slice that shipped', () => {
    const bound = boundRowsForWire(BOARD, 5)
    // Ten rows in, five out. If any of these were derived from `shipped` they would read
    // 3 / 4 / 5 and the grid would print a page-sized count under a map-shaped label.
    expect(bound.totals).toEqual({ candidate: 3, sole: 7, all: 10 })
    expect(bound.totals.all).not.toBe(bound.shipped.length)
    expect(bound.budget).toBe(5)
  })

  it('ships everything, in score order, when the board fits inside the budget', () => {
    const bound = boundRowsForWire(BOARD, 100)
    expect(bound.shipped).toHaveLength(10)
    expect(bound.shipped.map((r) => r.score.scoreV0)).toEqual([95, 90, 85, 80, 75, 70, 60, 3, 2, 1])
    expect(bound.totals).toEqual({ candidate: 3, sole: 7, all: 10 })
  })

  it('does not mutate the array it was handed', () => {
    const before = BOARD.map((r) => r.id)
    boundRowsForWire(BOARD, 4)
    expect(BOARD.map((r) => r.id)).toEqual(before)
  })

  it('is deterministic: the same board twice ships the same rows in the same order', () => {
    const a = boundRowsForWire(BOARD, 6).shipped.map((r) => r.id)
    const b = boundRowsForWire([...BOARD].reverse(), 6).shipped.map((r) => r.id)
    // Handed in reversed, the answer must be identical: the bound sorts, it does not inherit
    // the caller's ordering. A bound that depended on input order would ship a different page
    // whenever an upstream sort changed, with nothing on screen saying so.
    expect(a).toEqual(b)
  })
})
