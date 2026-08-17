import { buildAllDatasets, DATA_PATHS } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner, type CornerScoreResult } from '@/lib/intelligence/scoring/cornerscore'
import type { CornerRow, CornerMap } from '@/lib/intelligence/corner'
import type { NsnAwardSummary } from '@/lib/intelligence/awards/nsn-now'
import type { ForecastSummary } from '@/lib/intelligence/forecast/dla-forecast'

/**
 * THE MONOPOLY PAGE'S VIEW MODEL, BUILT ONCE PER FEED DAY, NOT ONCE PER REQUEST.
 *
 * /monopoly is where the daily loop starts, and it was paying ~2s of server time on every
 * visit to redo work whose inputs cannot change between visits: join 2,141 corner rows to
 * the award and forecast indexes and run CornerScore over every row. The underlying archive
 * is a pinned, hash-asserted snapshot (see datasets.ts SOURCE_ARCHIVE), and every input
 * builder below is itself memoized for exactly that reason, so re-deriving the join per
 * request bought no freshness, only latency.
 *
 * The memo is keyed by feed day plus the resolved input paths, the same discipline as
 * `datasetCache` in datasets.ts: a test pointing at custom paths, or a future second feed
 * day, gets its own entry rather than a stale hit. A new feed day arrives as a deploy plus
 * process restart, which clears the memo. Rendering stays force-dynamic in the page: the
 * gate check and the RSC render still run per request; only the pure computation is reused.
 *
 * NOTHING here changes a number. The values are computed by the same functions, once,
 * and `test/intelligence/monopoly-view.test.ts` asserts the memo returns the identical
 * counts a fresh computation produces.
 */

/*
 * THE CLIENT ROW IS EXACTLY WHAT THE GRID RENDERS, AND NOTHING ELSE.
 *
 * Serializing the full NsnAwardSummary + ForecastSummary + CornerScoreResult for 2,141 rows
 * produced a 26MB flight payload per /monopoly request, which was most of the page's ~2s
 * warm TTFB. The grid renders a precise subset: the price anchors, the self-reported
 * holders, the sparkline series, the ten newest award lines of the expansion, the forecast
 * facts, and the score's headline + reason codes. So that subset IS the wire type. Nothing
 * rendered was removed: every string and number the grid showed before is still computed
 * from the full records here, server-side, and shipped verbatim.
 */
export type GridAwardLine = {
  dateIso: string | null
  price: number | null
  qty: number | null
  cage: string | null
  company: string | null
}

export type GridAward = {
  /** Total recorded awards for this NSN (the expansion header count). */
  count: number
  distinctAwardees: number
  firstUnitPrice: number | null
  lastUnitPrice: number | null
  /** The latest award's effective unit price, the pricing anchor the cell renders. */
  latestPrice: number | null
  holders: Array<{ company: string | null; cage: string | null; quantity: number | null }>
  /** Chronological measured unit prices, for the sparkline. Only real points. */
  priceSeries: number[]
  /** The ten newest award lines, newest first, exactly as the expansion prints them. */
  recent: GridAwardLine[]
}

export type GridForecast = {
  onForecast: boolean
  totalForecastQty: number
  supplyChains: string[]
  solicitationCount: number
  lastSolicitation: string | null
  endItems: string[]
}

export type GridScore = {
  scoreV0: number
  disposition: CornerScoreResult['disposition']
  grade: CornerScoreResult['grade']
  reasons: CornerScoreResult['reasons']
}

export type EnrichedCornerRow = CornerRow & {
  award: GridAward | null
  forecast: GridForecast | null
  score: GridScore
}

function slimAward(a: NsnAwardSummary | null): GridAward | null {
  if (!a) return null
  return {
    count: a.awards.length,
    distinctAwardees: a.distinctAwardees,
    firstUnitPrice: a.firstUnitPrice,
    lastUnitPrice: a.lastUnitPrice,
    latestPrice: a.latest?.effectiveUnitPrice ?? null,
    holders: a.holders.map((h) => ({ company: h.company, cage: h.cage, quantity: h.quantity })),
    priceSeries: a.awards
      .map((x) => x.effectiveUnitPrice)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
    recent: a.awards
      .slice()
      .reverse()
      .slice(0, 10)
      .map((x) => ({
        dateIso: x.awardDateIso,
        price: x.effectiveUnitPrice,
        qty: x.quantity,
        cage: x.cage,
        company: x.company,
      })),
  }
}

function slimForecast(f: ForecastSummary | null): GridForecast | null {
  if (!f) return null
  return {
    onForecast: f.onForecast,
    totalForecastQty: f.totalForecastQty,
    supplyChains: f.supplyChains,
    solicitationCount: f.solicitationCount,
    lastSolicitation: f.lastSolicitation,
    endItems: f.endItems,
  }
}

export type MonopolyView = {
  feedDay: string
  summary: CornerMap['summary']
  provenance: CornerMap['provenance']
  rows: EnrichedCornerRow[]
  /** True when the award index (and so prices + listed stock) is joined. */
  awardsJoined: boolean
  /** True when the DLA Forecast index is joined. */
  forecastJoined: boolean
  /** Map-wide: every enriched row whose latest award carries a real paid price. */
  pricedCount: number
  /** Candidate-scoped: priced rows among the sole+silent candidate corners only. */
  candidatePricedCount: number
  /** Candidate corners on the DLA Forecast. */
  forecastCount: number
  /** Candidate corners with at least one self-reported holder listing stock. */
  availCount: number
}

const viewCache = new Map<string, MonopolyView>()

export function buildMonopolyView(): MonopolyView {
  const key = `${DATA_PATHS.feedDay}|${DATA_PATHS.approvedSource}|${DATA_PATHS.index}`
  const hit = viewCache.get(key)
  if (hit) return hit

  const { cornerMap } = buildAllDatasets()
  const awardIndex = buildNsnAwardIndex()
  const awardByNsn = awardIndex.ok ? awardIndex.byNsn : null
  const forecastIndex = buildForecastIndex()
  const forecastByNsn = forecastIndex.ok ? forecastIndex.byNsn : null

  // Counted from the FULL records, then slimmed for the wire: the counts and the rendered
  // fields are computed from the same summaries, so slimming cannot move a number.
  let pricedCount = 0
  let candidatePricedCount = 0
  let forecastCount = 0
  let availCount = 0

  const rows: EnrichedCornerRow[] = cornerMap.rows.map((r) => {
    const digits = r.nsn.replace(/[^0-9]/g, '')
    const award = awardByNsn?.get(digits) ?? null
    const forecast = forecastByNsn?.get(digits) ?? null
    const isCandidate = r.soleSource && r.silentSourceCount > 0
    const priced = award?.latest?.effectiveUnitPrice != null
    if (priced) pricedCount += 1
    if (isCandidate) {
      if (priced) candidatePricedCount += 1
      if (forecast?.onForecast) forecastCount += 1
      if ((award?.holders.length ?? 0) > 0) availCount += 1
    }
    const score = scoreCorner(r, award, forecast, {
      awardIndexLoaded: awardIndex.ok,
      forecastIndexLoaded: forecastIndex.ok,
    })
    return {
      ...r,
      award: slimAward(award),
      forecast: slimForecast(forecast),
      score: {
        scoreV0: score.scoreV0,
        disposition: score.disposition,
        grade: score.grade,
        reasons: score.reasons,
      },
    }
  })

  const view: MonopolyView = {
    feedDay: cornerMap.provenance.feedDay,
    summary: cornerMap.summary,
    provenance: cornerMap.provenance,
    rows,
    awardsJoined: awardByNsn != null,
    forecastJoined: forecastByNsn != null,
    pricedCount,
    candidatePricedCount,
    forecastCount,
    availCount,
  }

  viewCache.set(key, view)
  return view
}

/** Tests only: drop the memo so a suite can assert cold and warm agree. */
export function resetMonopolyViewCache(): void {
  viewCache.clear()
}
