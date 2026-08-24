import { describe, expect, it } from 'vitest'
import { buildRowKeys } from '@/components/ui/DataGrid'

/**
 * ROW IDENTITY IN <DataGrid />.
 *
 * WHY THIS FILE EXISTS, measured on the live app 2026-08-24 before the fix:
 *   /goldmine rendered 187 rows carrying only 179 distinct keys, so 8 keys were shared by 16
 *   rows. The rows were genuinely different (a "***REVISED***" buy and the row it supersedes,
 *   with different close dates), so the defect was an insufficient key, not duplicated data.
 *   React's answer to a duplicate key is that children "may be duplicated and/or omitted", and
 *   an omitted row on the No-Quote Goldmine is a lost deal that nobody sees go.
 *
 * EVERY POSITIVE CHECK HAS A NEGATIVE CONTROL BESIDE IT. A uniqueness assertion passes trivially
 * against an implementation that returns the row index for everything, so the uniqueness tests
 * are paired with stability tests that an index-keyed implementation FAILS.
 */

/** The naive implementation this fix exists to rule out. Used as a negative control. */
function indexKeys(rows: readonly { id: string; base: string }[]): string[] {
  return rows.map((_, i) => String(i))
}

const distinct = [
  { id: '0', base: 'a' },
  { id: '1', base: 'b' },
  { id: '2', base: 'c' },
]

/** The real shape of the /goldmine defect: same stock number, genuinely different rows. */
const colliding = [
  { id: '0', base: '2835-01-281-5811:' },
  { id: '1', base: '2835-01-281-5811:' },
  { id: '2', base: '5310-00-761-6882:' },
]

describe('buildRowKeys', () => {
  it('leaves already-unique caller keys exactly as they are', () => {
    const { keys, collided } = buildRowKeys(distinct)
    expect(keys).toEqual(['a', 'b', 'c'])
    expect(collided).toEqual([])
  })

  it('makes colliding caller keys unique', () => {
    const { keys } = buildRowKeys(colliding)
    expect(new Set(keys).size).toBe(colliding.length)
  })

  it('reports WHICH caller key collided, so the caller can be fixed', () => {
    const { collided } = buildRowKeys(colliding)
    expect(collided).toEqual(['2835-01-281-5811:'])
  })

  it('does not disambiguate the rows that did not collide', () => {
    const { keys } = buildRowKeys(colliding)
    expect(keys[2]).toBe('5310-00-761-6882:')
  })

  it('disambiguates with the SOURCE row id, not a render position', () => {
    const { keys } = buildRowKeys(colliding)
    expect(keys[0]).toBe('2835-01-281-5811:\u00000')
    expect(keys[1]).toBe('2835-01-281-5811:\u00001')
  })

  /**
   * THE TEST THAT ACTUALLY MATTERS. Sorting must not change a row's key, or React re-associates
   * rows to the wrong DOM nodes: the exact bug an index key would introduce.
   */
  it('gives a row the SAME key before and after a reorder', () => {
    const sorted = [colliding[2]!, colliding[0]!, colliding[1]!]
    const before = buildRowKeys(colliding).keys
    const after = buildRowKeys(sorted).keys
    expect(after[0]).toBe(before[2])
    expect(after[1]).toBe(before[0])
    expect(after[2]).toBe(before[1])
  })

  it('NEGATIVE CONTROL: an index key is unique but is NOT stable under a reorder', () => {
    const sorted = [colliding[2]!, colliding[0]!, colliding[1]!]
    const before = indexKeys(colliding)
    const after = indexKeys(sorted)
    expect(new Set(before).size).toBe(before.length)
    expect(after[0]).not.toBe(before[2])
  })

  it('falls back to a key that cannot collide when a caller key contains the separator', () => {
    const nasty = [
      { id: '0', base: 'x\u00001' },
      { id: '1', base: 'x' },
      { id: '2', base: 'x' },
    ]
    const { keys } = buildRowKeys(nasty)
    expect(new Set(keys).size).toBe(3)
  })

  it('handles an empty grid without inventing a key', () => {
    expect(buildRowKeys([])).toEqual({ keys: [], collided: [] })
  })
})
