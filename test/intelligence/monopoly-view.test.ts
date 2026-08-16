/**
 * T4 INTELLIGENCE. The memoized Monopoly view: faster is only allowed if it is IDENTICAL.
 *
 * /monopoly paid ~2s of per-request recomputation of a pinned snapshot. The fix is a module
 * memo keyed by feed day, and this suite is the contract that makes the memo safe: every
 * number the page renders from the view must equal an independent recompute through the
 * same underlying builders, and a warm hit must be the cold value, not a drifted one.
 */

import { describe, expect, it } from 'vitest'

import {
  buildMonopolyView,
  resetMonopolyViewCache,
} from '@/lib/intelligence/monopoly-view'
import { buildAllDatasets, checkDataAvailability } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'

const ALL_PRESENT = checkDataAvailability().every((i) => i.present)

describe('the memoized monopoly view over the real files', () => {
  if (!ALL_PRESENT) {
    it('SKIPPED: feed inputs are absent in this environment', () => {
      expect(ALL_PRESENT).toBe(false)
    })
    return
  }

  // 30s: the cold call parses the NSN-Now workbooks in this worker, seconds under test CPU.
  it('warm equals cold: the memo returns the identical view, not a drifted one', { timeout: 30_000 }, () => {
    resetMonopolyViewCache()
    const cold = buildMonopolyView()
    const warm = buildMonopolyView()
    // Same reference is the strongest possible "byte-identical": nothing recomputed, nothing
    // could have drifted between the two reads.
    expect(warm).toBe(cold)
  })

  it('every rendered count equals an independent recompute through the same builders', () => {
    resetMonopolyViewCache()
    const view = buildMonopolyView()

    const { cornerMap } = buildAllDatasets()
    const awardIx = buildNsnAwardIndex()
    const fcIx = buildForecastIndex()
    const awardBy = awardIx.ok ? awardIx.byNsn : null
    const fcBy = fcIx.ok ? fcIx.byNsn : null

    let priced = 0
    let candidatePriced = 0
    let forecastCount = 0
    let availCount = 0
    let topScore = -1
    for (const r of cornerMap.rows) {
      const digits = r.nsn.replace(/[^0-9]/g, '')
      const award = awardBy?.get(digits) ?? null
      const forecast = fcBy?.get(digits) ?? null
      const isCandidate = r.soleSource && r.silentSourceCount > 0
      if (award?.latest?.effectiveUnitPrice != null) {
        priced += 1
        if (isCandidate) candidatePriced += 1
      }
      if (isCandidate && forecast?.onForecast) forecastCount += 1
      if (isCandidate && (award?.holders.length ?? 0) > 0) availCount += 1
      if (isCandidate) {
        const s = scoreCorner(r, award, forecast)
        if (s.scoreV0 > topScore) topScore = s.scoreV0
      }
    }

    expect(view.rows).toHaveLength(cornerMap.rows.length)
    expect(view.summary).toEqual(cornerMap.summary)
    expect(view.feedDay).toBe(cornerMap.provenance.feedDay)
    expect(view.pricedCount).toBe(priced)
    expect(view.candidatePricedCount).toBe(candidatePriced)
    expect(view.forecastCount).toBe(forecastCount)
    expect(view.availCount).toBe(availCount)

    // The dashboard's "strongest position" is the max score among candidates in this view;
    // assert it matches the independent scoring pass, so the memo can never change a rank.
    const viewTop = Math.max(
      ...view.rows.filter((r) => r.soleSource && r.silentSourceCount > 0).map((r) => r.score.scoreV0),
    )
    expect(viewTop).toBe(topScore)

    // Nonzero positive controls: this test cannot pass by everything being zero.
    expect(view.rows.length).toBeGreaterThan(0)
    expect(view.pricedCount).toBeGreaterThan(0)
  })
})
