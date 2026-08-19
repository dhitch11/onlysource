/**
 * THE BOARD IS JUDGED AGAINST TODAY, NOT AGAINST ITS OWN FEED DAY.
 *
 * DLA publishes a return date per requirement and that date passes whether or not our capture
 * ran. A board that judges "open" against the feed day it was built from therefore keeps
 * presenting expired solicitations for exactly as long as the capture has been missed, and says
 * "open" for the whole time. Measured on the windowed surface on 2026-08-18 against an archive
 * whose newest day was 2026-08-14: 5,122 of 10,488 rows, 48.8%, had already closed while the
 * header read open.
 *
 * This drives the REAL `buildBoard` against the REAL archive on disk, not the pure comparison
 * behind it. `lifecycleAsOf` is already unit-tested; what was never tested is whether the board
 * actually CALLS it, with the clock rather than the feed day. A check validated one layer away
 * from the code that runs can pass on the exact defect it exists to catch.
 *
 * ★ THE POSITIVE CONTROL IS THE WHOLE POINT: the same archive judged on two different days must
 *   produce DIFFERENT closed counts. If the numbers do not move when the clock moves, the
 *   judgement is not being made, and every other assertion here would pass anyway.
 */
import { describe, it, expect } from 'vitest'
import { buildBoard } from '@/lib/board/build'
import { fixedClock } from '@/lib/time/clock'

/** Midday UTC keeps the Eastern civil date unambiguous either side of a DST boundary. */
const at = (iso: string) => fixedClock(Date.parse(`${iso}T16:00:00Z`))

const built = (iso: string) => {
  const b = buildBoard(at(iso))
  if (!b.ok) throw new Error(`archive not servable in this environment: ${b.reason}`)
  return b
}

describe('buildBoard — retirement is judged against the clock', () => {
  it('serves a board at all (guards every assertion below from passing on an empty page)', () => {
    const b = built('2026-08-18')
    expect(b.rows.length).toBeGreaterThan(0)
    expect(b.counts.published).toBe(b.rows.length)
  })

  it('every row carries a lifecycle, and the three states partition the board exactly', () => {
    const b = built('2026-08-18')
    expect(b.rows.every((r) => r.lifecycle != null)).toBe(true)
    expect(b.counts.open + b.counts.closed + b.counts.undated).toBe(b.counts.published)
  })

  it('asOf is the CLOCK day, never the feed day, and says which it is', () => {
    const b = built('2026-08-18')
    expect(b.asOf).toBe('2026-08-18')
    expect(b.asOfBasis).toMatch(/the day this was computed/)
    // Every row agrees with the board: one judgement, not one per row.
    expect(b.rows.every((r) => r.lifecycle.asOf === b.asOf)).toBe(true)
  })

  it('★ POSITIVE CONTROL: moving the clock forward CLOSES rows — proves the judgement is live', () => {
    const onTheDay = built('2026-08-18')
    const muchLater = built('2027-01-01')
    // Far in the future every dated row must have retired.
    expect(muchLater.counts.closed).toBeGreaterThan(onTheDay.counts.closed)
    expect(muchLater.counts.open).toBe(0)
    // and nothing was dropped to achieve it
    expect(muchLater.counts.published).toBe(onTheDay.counts.published)
  })

  it('★ POSITIVE CONTROL: moving the clock backward OPENS them again', () => {
    const early = built('2020-01-01')
    expect(early.counts.closed).toBe(0)
    expect(early.counts.open + early.counts.undated).toBe(early.counts.published)
  })

  it('a closed row is KEPT and labelled, never dropped from the board', () => {
    const b = built('2027-01-01')
    expect(b.rows.length).toBe(b.counts.published)
    const closed = b.rows.filter((r) => r.lifecycle.status === 'closed')
    expect(closed.length).toBe(b.counts.closed)
    expect(closed.every((r) => r.lifecycle.closeDate != null)).toBe(true)
  })

  it('an undated line is never silently counted as open', () => {
    const b = built('2026-08-18')
    const undated = b.rows.filter((r) => r.lifecycle.status === 'last_seen_only')
    expect(undated.length).toBe(b.counts.undated)
    expect(undated.every((r) => r.lifecycle.closeDate == null)).toBe(true)
  })

  it('the cache is keyed on the reference day, so a board judged yesterday is not served today', () => {
    // Same archive, two days: if the reference day were missing from the cache key the second
    // call would return the first board and these counts would be identical.
    const a = built('2026-08-18')
    const b = built('2027-01-01')
    expect(b.counts.closed).not.toBe(a.counts.closed)
  })
})
