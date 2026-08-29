import { describe, it } from 'vitest'
import { hasCorpus, CORPUS_NOTE } from '../support/corpus'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { evaluateScorecard, SCORECARD_V0 } from '@/lib/engine/scorecard'

describe.skipIf(!hasCorpus)('PROBE: two scorers over the same real rows' + CORPUS_NOTE, () => {
  it('measures', () => {
    const { cornerMap } = buildAllDatasets()
    const awardIx = buildNsnAwardIndex()
    const fcIx = buildForecastIndex()
    console.log('rows=', cornerMap.rows.length, 'awardIx.ok=', awardIx.ok, 'fcIx.ok=', fcIx.ok)

    const rows = cornerMap.rows.slice(0, 400)
    const live = rows.map((row) => {
      const key = row.nsn.replace(/[^0-9]/g, '')
      const award = awardIx.ok ? awardIx.byNsn.get(key) ?? null : null
      const forecast = fcIx.ok ? fcIx.byNsn.get(key) ?? null : null
      return {
        nsn: row.nsn,
        row,
        award,
        forecast,
        r: scoreCorner(row, award, forecast, {
          awardIndexLoaded: awardIx.ok,
          forecastIndexLoaded: fcIx.ok,
        }),
      }
    })

    // ---- HOW MANY OF THE 13 SCORECARD FEATURES CAN LIVE DATA ACTUALLY ANSWER? ----
    // Derived ONLY where a real field exists. No estimate, no default, no zero-for-unknown.
    const core = new Set(SCORECARD_V0.coverage.core_features)
    const observedCount = new Map<string, number>()
    const dispositions = new Map<string, number>()

    for (const x of live) {
      const obs: Record<string, number | string | boolean | null> = {}
      // offers_on_prior_solicitation: COUNTED on the award rows.
      if (x.award?.latestOffers != null) obs['offers_on_prior_solicitation'] = x.award.latestOffers
      // award_count_last_5y: COUNTED from the award list (feed-relative, no wall clock).
      if (x.award) obs['award_count_last_5y'] = x.award.awards.length
      // Everything else has no producer in this repo. Left unobserved rather than invented.
      for (const k of Object.keys(obs)) observedCount.set(k, (observedCount.get(k) ?? 0) + 1)
      const ev = evaluateScorecard(obs, '2026-08-17')
      dispositions.set(ev.disposition, (dispositions.get(ev.disposition) ?? 0) + 1)
    }

    console.log('\n== FEATURES THE LIVE PIPELINE CAN ANSWER (of 13; 7 are core) ==')
    for (const f of SCORECARD_V0.features) {
      const n = observedCount.get(f.key) ?? 0
      console.log(
        `  ${core.has(f.key) ? 'CORE' : 'aux '}  ${f.key.padEnd(38)} observed on ${String(n).padStart(4)}/${live.length} rows`,
      )
    }
    console.log('\n== ORPHAN SCORER DISPOSITION OVER REAL ROWS ==')
    for (const [d, n] of dispositions) console.log(`  ${d.padEnd(20)} ${n}`)
    console.log('  min_core_features_observed required =', SCORECARD_V0.coverage.min_core_features_observed)

    // ---- LIVE SCORER: what does it produce over the same rows? ----
    const sorted = [...live].sort((a, b) => b.r.scoreV0 - a.r.scoreV0)
    console.log('\n== LIVE SCORER (cornerscore v0) ==')
    console.log('  scores:', sorted.slice(0, 5).map((s) => s.r.scoreV0).join(', '), '... low:', sorted.slice(-3).map((s) => s.r.scoreV0).join(', '))
    const dist = new Map<number, number>()
    for (const s of live) dist.set(s.r.scoreV0, (dist.get(s.r.scoreV0) ?? 0) + 1)
    console.log('  distinct scores:', [...dist.keys()].sort((a, b) => b - a).join(' '))
    const disp = new Map<string, number>()
    for (const s of live) disp.set(s.r.disposition, (disp.get(s.r.disposition) ?? 0) + 1)
    console.log('  dispositions:', [...disp.entries()].map(([k, v]) => `${k}=${v}`).join(' '))
  }, 300_000)
})
