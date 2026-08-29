/** @OS-VERIFY — the same question on REAL rows: where do Wayne-boosted rows sit, and are they qualified? */
import { describe, it } from 'vitest'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { resolveFeedDayInputs } from '@/lib/intelligence/feed-day'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { loadCageFamilyIndex } from '@/lib/intelligence/scoring/cage-family-load'
import { buildAwardeeClassifierFromLive } from '@/lib/intelligence/suppliers/classify/live'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { sizeOfBuy } from '@/lib/intelligence/opportunities/size-of-buy'
const DAY = process.env.VERIFY_DAY ?? '2026-08-14'
const usd = (n: number | null) => n == null ? 'NULL' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
describe('wayne rows on real data', () => {
  it('measures', () => {
    const res = resolveFeedDayInputs(DAY); if (!res.ok) { console.log('UNRESOLVABLE'); return }
    const ds = buildAllDatasets(res.served); const map = ds.cornerMap
    const aIx = buildNsnAwardIndex(), fIx = buildForecastIndex(), cIx = loadCageFamilyIndex(), lv = buildAwardeeClassifierFromLive()
    const rows = map.rows.map((r) => {
      const d = r.nsn.replace(/[^0-9]/g, ''); const aw = aIx.ok ? aIx.byNsn.get(d) ?? null : null
      let money: number | null = null
      if (aw && !aw.priceScaleSuspect && aw.latest?.effectiveUnitPrice != null) { const b = sizeOfBuy(aw.latest.effectiveUnitPrice, r.quantity); if (b.known) money = b.usd }
      const la = lv.ok && aw?.latest?.cage ? lv.classifier.classify(aw.latest.cage) : null
      const s: any = scoreCorner(r, aw, fIx.ok ? fIx.byNsn.get(d) ?? null : null, { awardIndexLoaded: aIx.ok, forecastIndexLoaded: fIx.ok, cageFamily: cIx.ok ? cIx.index : null }, la)
      return { nsn: r.nsn, money, rankKey: s.rankKey ?? s.scoreV0, wayne: !!s.wayneHolds?.held, units: s.wayneHolds?.units ?? 0, hidden: !!s.lockup?.hidden }
    })
    const vis = rows.filter((r) => !r.hidden).sort((a, b) => b.rankKey - a.rankKey)
    const w = vis.filter((r) => r.wayne)
    console.log(`BOARD ${DAY}: visible rows = ${vis.length}   Wayne-held rows = ${w.length}`)
    let sub = 0
    for (const r of w) {
      const rank = vis.indexOf(r) + 1
      const isSub = r.money != null && r.money < 15000
      const unpriced = r.money == null
      if (isSub || unpriced) sub += 1
      console.log(`  ${r.nsn}  rank ${String(rank).padStart(5)}/${vis.length} (top ${((rank / vis.length) * 100).toFixed(2)}%)  value ${usd(r.money).padStart(12)}  ${isSub ? '⛔ SUB-FLOOR (<$15K)' : unpriced ? '⛔ UNPRICEABLE' : '✅ qualified'}`)
    }
    console.log(`\nWayne rows BELOW David's $15K floor or unpriceable: ${sub} of ${w.length}`)
    const top3 = Math.ceil(vis.length * 0.03)
    console.log(`Wayne rows inside the top 3% (rank <= ${top3}): ${w.filter((r) => vis.indexOf(r) + 1 <= top3).length} of ${w.length}`)
  })
})
