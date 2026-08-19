/**
 * AN EMPTY `awards[]` MEANS THREE DIFFERENT THINGS AND THE ARRAY CANNOT TELL YOU WHICH.
 *
 * Measured on the real 2026-08-15 export: of 3,418 stock numbers in the index, 2,514 hold award
 * rows, 235 were asked about and honestly answered "nothing", and 669 were never answered at all
 * because a Procurement sheet stopped at exactly the 20,000-row ceiling before reaching them.
 * All 904 present identically as `awards: []`, and the 669 have been served as though they were
 * the 235.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  awardHistoryState,
  buildNsnAwardIndex,
  resetNsnAwardIndexCache,
} from '../../lib/intelligence/awards/nsn-now'

const haveExport = existsSync(join(process.cwd(), 'data', 'nsn-now', 'full_1.xlsx'))

describe.skipIf(!haveExport)('award history state, on the real export', () => {
  /*
   * Built ONCE. Reading seven workbooks costs about five seconds, and resetting the memo before
   * every test spent that per assertion and timed the suite out. The index is immutable here, so
   * one build is also the honest shape: every assertion below reads the same measurement.
   */
  let ix!: Extract<ReturnType<typeof buildNsnAwardIndex>, { ok: true }>
  beforeAll(() => {
    resetNsnAwardIndexCache()
    const built = buildNsnAwardIndex()
    if (!built.ok) throw new Error(`the export did not load: ${built.reason}`)
    ix = built
    /*
     * 180s, raised from 60s on 2026-08-19 after this hook timed out in the full suite while the
     * same build costs ~5s alone.
     *
     * ★ IT IS A HANG GUARD, NOT A PERFORMANCE BUDGET, which is the reasoning vitest.config.mts
     * already records for the heavy project's 30s. This file cannot JOIN that project: it calls
     * `resetNsnAwardIndexCache()`, and that project runs `isolate: false` specifically so its
     * files SHARE one parsed index. Moving it there would have it throw away the shared parse the
     * other files depend on, converting a slow test into several slow tests.
     */
  }, 180_000)

  it('★ separates the two silences, and they reconcile to the whole index', () => {
    const tally: Record<string, number> = {}
    for (const nsn of ix.byNsn.keys()) {
      const s = awardHistoryState(ix, nsn)
      tally[s] = (tally[s] ?? 0) + 1
    }

    // Every stock number in the index lands in exactly one state, and they sum to the index.
    const total = Object.values(tally).reduce((a, b) => a + b, 0)
    expect(total).toBe(ix.byNsn.size)

    expect(tally.held).toBe(ix.counts.nsnsWithAwards)
    expect(tally.never_answered).toBe(ix.counts.nsnsNeverAnswered)
    expect(tally.never_answered).toBeGreaterThan(0) // the whole reason this exists

    // ★ THE POINT: the unknowns are NOT counted among the honest absences.
    expect(tally.none).toBeLessThan(tally.never_answered!)
  })

  it('★★ a never-answered stock number carries ZERO awards and must NOT read as "none"', () => {

    const sample = [...ix.neverAnswered][0]
    expect(sample).toBeDefined()

    // It is in the map, with an empty awards array — indistinguishable from a real absence by
    // any check that reads the array. This is precisely the read that was wrong.
    const summary = ix.byNsn.get(sample!)
    expect(summary?.awards.length).toBe(0)
    expect(awardHistoryState(ix, sample!)).toBe('never_answered')
    expect(awardHistoryState(ix, sample!)).not.toBe('none')
  })

  it('never claims a stock number with real awards is unknown', () => {
    for (const [nsn, s] of ix.byNsn) {
      if (s.awards.length > 0) {
        expect(ix.neverAnswered.has(nsn)).toBe(false)
        expect(awardHistoryState(ix, nsn)).toBe('held')
        break
      }
    }
  })

  it('NEGATIVE CONTROL: a stock number no report ever mentioned is never_asked, not none', () => {
    expect(ix.byNsn.has('9999999999999')).toBe(false)
    expect(awardHistoryState(ix, '9999999999999')).toBe('never_asked')
  })
})
