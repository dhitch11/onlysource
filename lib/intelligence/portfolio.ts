import { buildAllDatasets, cachePerIdentityDay } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { isRisingPrice } from '@/lib/intelligence/rising-price'
import { scoreCorner, type CornerScoreResult } from '@/lib/intelligence/scoring/cornerscore'
import type { CornerFunnel, CornerMap, CornerRow } from '@/lib/intelligence/corner'
import type { NsnAwardSummary } from '@/lib/intelligence/awards/nsn-now'
import type { ForecastSummary } from '@/lib/intelligence/forecast/dla-forecast'

/**
 * THE PORTFOLIO — the whole candidate book, aggregated for the intelligence dashboard.
 *
 * Every figure here is counted or measured from the same feed the Monopoly Map reads; nothing is
 * projected. A candidate corner is sole-sourced, under open demand, with the incumbent award-silent
 * (the map's definition, reused verbatim). The dashboard charts and the AI portfolio brief both read
 * THIS object, so a number on a chart and a number in the brief are the same number.
 */

export type EnrichedCorner = {
  nsn: string
  item: string
  cage: string | null
  score: number
  grade: string
  disposition: string
  onForecast: boolean
  forecastQty: number
  machineAward: boolean
  lastPrice: number | null
  firstPrice: number | null
  escalationPct: number | null
  awardCount: number
  /** Chronological measured unit prices, for the trend sparkline. Only real points. */
  priceSeries: number[]
  supplyChains: string[]
  endItems: string[]
}

export type CountBar = { label: string; value: number }

export type Portfolio = {
  ok: boolean
  feedDay: string
  /**
   * THE BASIS FOR `totals.candidateCorners`, carried so the dashboard never prints a count
   * without its span. This book is now the archived WINDOW rather than one feed day, and a
   * headline that grows sixty-fold between two deploys with nothing explaining it reads as a
   * product that started making numbers up.
   */
  coverage: CornerMap['coverage']
  /**
   * The same candidate definition over the NEWEST DAY ALONE: what this dashboard showed before
   * the window was wired. Printed beside the window count, never in place of it.
   */
  newestDayFunnel: CornerFunnel | null
  totals: {
    candidateCorners: number
    onForecast: number
    priced: number
    machineAward: number
    withEscalation: number
  }
  /** Candidate corners grouped by DLA supply chain (from the forecast). Sorted desc. */
  bySupplyChain: CountBar[]
  /** Disposition mix across candidates, fixed order FLAG→WATCHLIST→INSUFFICIENT_DATA→SKIP. */
  byDisposition: CountBar[]
  /** Award path split across candidates. */
  byAwardPath: CountBar[]
  /** CornerScore histogram, fixed 20-wide buckets. */
  scoreBuckets: CountBar[]
  /** Top corners by escalation percent (priced, >=2 awards, rising). */
  escalationLeaders: EnrichedCorner[]
  /** Top corners by CornerScore — the "top plays". */
  topCorners: EnrichedCorner[]
}

const DISPOSITION_ORDER = ['FLAG', 'WATCHLIST', 'INSUFFICIENT_DATA', 'SKIP'] as const

function enrich(
  row: CornerRow,
  award: NsnAwardSummary | null,
  forecast: ForecastSummary | null,
  score: CornerScoreResult,
): EnrichedCorner {
  const first = award?.firstUnitPrice ?? null
  const last = award?.lastUnitPrice ?? null
  const escalationPct =
    first != null && last != null && first > 0 ? Math.round(((last - first) / first) * 100) : null
  return {
    nsn: row.nsn,
    item: row.nomenclature.trim() || 'unnamed on this line',
    cage: row.approvedSources[0] ?? null,
    score: score.scoreV0,
    grade: score.grade,
    disposition: score.disposition,
    onForecast: forecast?.onForecast ?? false,
    forecastQty: forecast?.totalForecastQty ?? 0,
    machineAward: row.automatedSolicitation === true,
    lastPrice: last,
    firstPrice: first,
    escalationPct,
    awardCount: award?.awards.length ?? 0,
    priceSeries: (award?.awards ?? [])
      .map((a) => a.effectiveUnitPrice)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
    supplyChains: forecast?.supplyChains ?? [],
    endItems: forecast?.endItems ?? [],
  }
}

/**
 * KEYED, NOT A SINGLE SLOT. This was one module-level `Portfolio | null` with no key at all,
 * so the first build of a process was the only build of that process: a capture landing, or a
 * backfill widening the window, could never invalidate it. The key is the corner map's own
 * basis, which is exactly the identity `buildAllDatasets` memoises on, so the two caches
 * cannot disagree about which archive state is being served.
 */
const cache = new Map<string, Portfolio>()

export function buildPortfolio(): Portfolio {
  const { cornerMap, newestDayFunnel } = buildAllDatasets()
  // The day demand was judged against is part of the identity: the same archive yields a
  // smaller open book tomorrow, because return dates pass on the government's calendar and not
  // on our capture schedule.
  const judgedOn = cornerMap.coverage.excludedFromDemand?.asOf ?? 'single_day'
  const cacheKey = `${cornerMap.provenance.feedDay}|${cornerMap.coverage.basis}|${cornerMap.coverage.firstDay}|${cornerMap.coverage.dayCount}|${judgedOn}`
  const hit = cache.get(cacheKey)
  if (hit) return hit
  const awardIx = buildNsnAwardIndex()
  const fcIx = buildForecastIndex()
  const awardBy = awardIx.ok ? awardIx.byNsn : null
  const fcBy = fcIx.ok ? fcIx.byNsn : null

  const candidates: EnrichedCorner[] = []
  for (const r of cornerMap.rows) {
    if (!(r.soleSource && r.silentSourceCount > 0)) continue
    const key = r.nsn.replace(/[^0-9]/g, '')
    const award = awardBy?.get(key) ?? null
    const forecast = fcBy?.get(key) ?? null
    candidates.push(
      enrich(
        r,
        award,
        forecast,
        scoreCorner(r, award, forecast, { awardIndexLoaded: awardIx.ok, forecastIndexLoaded: fcIx.ok }),
      ),
    )
  }

  // Supply-chain mix (a corner can touch more than one chain; count each once per chain).
  const chainCounts = new Map<string, number>()
  for (const c of candidates) {
    const seen = new Set<string>()
    for (const ch of c.supplyChains) {
      const name = ch.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      chainCounts.set(name, (chainCounts.get(name) ?? 0) + 1)
    }
  }
  const bySupplyChain: CountBar[] = [...chainCounts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)

  // Disposition mix, fixed order.
  const dispCount = new Map<string, number>()
  for (const c of candidates) dispCount.set(c.disposition, (dispCount.get(c.disposition) ?? 0) + 1)
  const byDisposition: CountBar[] = DISPOSITION_ORDER.filter((d) => dispCount.has(d)).map((d) => ({
    label: d,
    value: dispCount.get(d) ?? 0,
  }))

  // Award path mix.
  const machine = candidates.filter((c) => c.machineAward).length
  const byAwardPath: CountBar[] = [
    { label: 'Machine award', value: machine },
    { label: 'Manual / unknown', value: candidates.length - machine },
  ].filter((b) => b.value > 0)

  // Score histogram, 20-wide buckets.
  const buckets = [
    { label: '0–19', lo: 0, hi: 19 },
    { label: '20–39', lo: 20, hi: 39 },
    { label: '40–59', lo: 40, hi: 59 },
    { label: '60–79', lo: 60, hi: 79 },
    { label: '80–100', lo: 80, hi: 100 },
  ]
  const scoreBuckets: CountBar[] = buckets.map((b) => ({
    label: b.label,
    value: candidates.filter((c) => c.score >= b.lo && c.score <= b.hi).length,
  }))

  const escalationLeaders = candidates
    .filter((c) => c.escalationPct != null && c.escalationPct > 0 && c.awardCount >= 2)
    .sort((a, b) => (b.escalationPct ?? 0) - (a.escalationPct ?? 0))
    .slice(0, 8)

  const topCorners = [...candidates].sort((a, b) => b.score - a.score).slice(0, 10)

  const portfolio: Portfolio = {
    ok: candidates.length > 0,
    feedDay: cornerMap.provenance.feedDay,
    coverage: cornerMap.coverage,
    newestDayFunnel,
    totals: {
      candidateCorners: candidates.length,
      onForecast: candidates.filter((c) => c.onForecast).length,
      priced: candidates.filter((c) => c.lastPrice != null).length,
      machineAward: machine,
      // The SHARED predicate, never the rounded percent: a sub-0.5% riser rounds to an
      // escalationPct of 0 and used to vanish from this count while the Monopoly grid still
      // showed it rising. One definition, one number, on both surfaces.
      withEscalation: candidates.filter((c) => isRisingPrice(c.firstPrice, c.lastPrice)).length,
    },
    bySupplyChain,
    byDisposition,
    byAwardPath,
    scoreBuckets,
    escalationLeaders,
    topCorners,
  }
  // Keyed with the judged-against day last, so yesterday's book is dropped rather than kept.
  return cachePerIdentityDay(cache, cacheKey, portfolio)
}

/** Tests only: drop the memo so a suite can assert cold and warm agree. */
export function resetPortfolioCache(): void {
  cache.clear()
}

/** The compact dossier the AI portfolio brief is written from. Only measured aggregates + top plays. */
export function buildPortfolioDossier(pf: Portfolio) {
  return {
    feedDay: pf.feedDay,
    // The span every total below was counted over, so the language model writing the brief
    // cannot describe a twenty-day book as if it were today's solicitations.
    coveredDays: pf.coverage.daysIncluded,
    coverageBasis: pf.coverage.statement,
    totals: pf.totals,
    supplyChainMix: pf.bySupplyChain.slice(0, 8),
    dispositionMix: pf.byDisposition,
    awardPathMix: pf.byAwardPath,
    topPlays: pf.topCorners.map((c) => ({
      nsn: c.nsn,
      item: c.item,
      cage: c.cage,
      score: c.score,
      grade: c.grade,
      disposition: c.disposition,
      onForecast: c.onForecast,
      forecastQty: c.forecastQty,
      machineAward: c.machineAward,
      lastPrice: c.lastPrice,
      escalationPct: c.escalationPct,
      endItems: c.endItems.slice(0, 4),
    })),
    escalationLeaders: pf.escalationLeaders.map((c) => ({
      nsn: c.nsn,
      item: c.item,
      escalationPct: c.escalationPct,
      firstPrice: c.firstPrice,
      lastPrice: c.lastPrice,
    })),
  }
}
