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
  it('portfolio withEscalation equals the predicate recomputed over the candidate set', { timeout: 30_000 }, () => {
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
