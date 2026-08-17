/**
 * T4 INTELLIGENCE. The ONE rising-price definition, and the agreement it exists to enforce.
 *
 * The defect this file pins down: /intelligence counted "with rising prices" through
 * `Math.round(escalationPct) > 0` while /monopoly's "Rising price" chip compared the raw
 * first and last unit prices. A corner rising less than 0.5% rounded to a 0% escalation and
 * vanished from one surface while staying on the other, so the console said 49 in one place
 * and 50 in the other about the identical 115-corner set.
 *
 * The fix is a single shared predicate (lib/intelligence/rising-price) used by BOTH call
 * sites. These tests assert (1) the predicate's behavior including the exact rounding case
 * the old code dropped, and (2) on the real files, that the portfolio total equals an
 * independent recompute of the same predicate over the same candidate set the Monopoly
 * grid's chip filters, so the two rendered numbers are one number.
 */

import { describe, expect, it } from 'vitest'

import { isRisingPrice } from '@/lib/intelligence/rising-price'
import { buildPortfolio } from '@/lib/intelligence/portfolio'
import { buildAllDatasets, checkDataAvailability } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'

/*
 * TIMEOUT BUDGET 120s -- CORRECTED 2026-08-17. An earlier version of this comment blamed
 * archive growth (1 feed day -> 20 days, 1.4 GB). That diagnosis was wrong: this chain reads
 * exactly TWO archive files (both literals under one feed day) plus four seed workbooks, so
 * 1 day -> 20 days changed its input by ZERO BYTES.
 *
 * THE MEASURED CAUSE: this file, datasets.test.ts, alerts-route.test.ts and
 * monopoly-view.test.ts all call buildAllDatasets()/buildPortfolio()/buildNsnAwardIndex(),
 * whose memoization is per module graph. Vitest's default `forks` pool ran the four files in
 * four SEPARATE child processes, so the same ~15MB of source xlsx got parsed up to four times
 * concurrently, contending for the same CPUs -- not a data-volume problem. On three
 * consecutive runs of byte-identical code, THIS test alone measured 13.9s / 23.3s / 126s.
 * A plain tsx process runs the same chain once, cold, in 4.0s.
 *
 * FIX (see vitest.config.mts): these four files now share one `isolate:false,
 * fileParallelism:false` project, so the memoized builders actually memoize across files
 * instead of re-parsing per fork. Re-measured post-fix, three consecutive full-suite runs:
 * this test's own duration was 1ms / 0ms / 1ms -- whichever file lands first in the shared
 * group pays the one real parse, every file after it hits the memo. The 120s budget stays as
 * a margin for that first-payer under real machine contention (observed once at 25.7s for
 * monopoly-view.test.ts in the same group), not because this test is expected to take long.
 */

describe('the shared rising-price predicate', () => {
  it('rises on any real increase, including one the rounded percent would drop', () => {
    // POSITIVE CONTROL for the defect class: +0.001% rounds to an escalationPct of 0, which
    // is exactly the riser the old portfolio counting silently excluded.
    expect(isRisingPrice(1000, 1000.01)).toBe(true)
    expect(Math.round(((1000.01 - 1000) / 1000) * 100)).toBe(0)

    expect(isRisingPrice(1, 2)).toBe(true)
    expect(isRisingPrice(0.01, 0.02)).toBe(true)
  })

  it('refuses flat, falling, and unreadable price pairs', () => {
    expect(isRisingPrice(100, 100)).toBe(false)
    expect(isRisingPrice(100, 99.99)).toBe(false)
    expect(isRisingPrice(null, 100)).toBe(false)
    expect(isRisingPrice(100, null)).toBe(false)
    expect(isRisingPrice(undefined, undefined)).toBe(false)
    expect(isRisingPrice(null, null)).toBe(false)
  })
})

const ALL_PRESENT = checkDataAvailability().every((i) => i.present)

describe('the two surfaces count the same number on the real files', () => {
  if (!ALL_PRESENT) {
    it('SKIPPED the agreement assertion because feed inputs are missing', () => {
      expect(ALL_PRESENT).toBe(false)
    })
    return
  }

  // 30s: the cold call parses the NSN-Now workbooks in this worker, seconds under test CPU.
  it('portfolio withEscalation equals the predicate recomputed over the candidate set', { timeout: 120_000 }, () => {
    const pf = buildPortfolio()
    const { cornerMap } = buildAllDatasets()
    const idx = buildNsnAwardIndex()
    expect(idx.ok).toBe(true)
    if (!idx.ok) return

    // The independent recompute walks the SAME rows the Monopoly grid's Candidate tab holds
    // and applies the SAME shared predicate its "Rising price" chip applies. If either call
    // site ever reverts to a private definition, this number and the portfolio's diverge and
    // this test goes red.
    const risingAmongCandidates = cornerMap.rows.filter((r) => {
      if (!(r.soleSource && r.silentSourceCount > 0)) return false
      const a = idx.byNsn.get(r.nsn.replace(/[^0-9]/g, '')) ?? null
      return isRisingPrice(a?.firstUnitPrice, a?.lastUnitPrice)
    }).length

    expect(pf.totals.withEscalation).toBe(risingAmongCandidates)
    // And the count is a real, nonzero fact on this feed day, so this test cannot pass by
    // both sides being an accidental zero.
    expect(risingAmongCandidates).toBeGreaterThan(0)
  })
})
