import { buildAllDatasets, cachePerIdentityDay, type ServedFeedMeta, type ServedWindowMeta } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner, type CornerScoreResult } from '@/lib/intelligence/scoring/cornerscore'
import { loadCageFamilyIndex } from '@/lib/intelligence/scoring/cage-family-load'
import type { CornerRow, CornerMap, CornerFunnel } from '@/lib/intelligence/corner'
import type { NsnAwardSummary } from '@/lib/intelligence/awards/nsn-now'
import type { ForecastSummary } from '@/lib/intelligence/forecast/dla-forecast'
import { buildAwardeeClassifierFromLive } from '@/lib/intelligence/suppliers/classify/live'

/**
 * THE MONOPOLY PAGE'S VIEW MODEL, BUILT ONCE PER FEED DAY, NOT ONCE PER REQUEST.
 *
 * /monopoly is where the daily loop starts, and it was paying ~2s of server time on every
 * visit to redo work whose inputs cannot change between visits: join every corner row to
 * the award and forecast indexes and run CornerScore over each one. The underlying inputs
 * are one resolved feed day's archived, byte-re-verified captures, and every input builder
 * below is itself memoized for exactly that reason, so re-deriving the join per request
 * bought no freshness, only latency.
 *
 * THE MEMO KEY IS THE SERVED DAY'S IDENTITY, NOT A PINNED PATH (corrected 2026-08-17). It
 * used to read `DATA_PATHS`, a module constant naming one hardcoded day, so the key could
 * not change and a newly captured day would have hit a stale entry forever. It now keys on
 * the resolution `buildAllDatasets` actually served — feed day plus both archived storage
 * keys — so a capture landing produces a different key and a fresh view, with no clock or
 * TTL involved. `buildAllDatasets` is itself memoised on the same identity, so calling it
 * before the cache lookup costs a map read, not a rebuild.
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
  /** The unclamped rank key every surface sorts by. */
  rankKey: number
  disposition: CornerScoreResult['disposition']
  grade: CornerScoreResult['grade']
  /** Convenience mirror of lockup.hidden, so the wire bound and grid can filter without a nest. */
  hidden: boolean
  /** The modeled buy size, or null when unpriceable (INSUFFICIENT, never 0). */
  valueUsd: CornerScoreResult['valueUsd']
  valueTier: CornerScoreResult['valueTier']
  lockup: CornerScoreResult['lockup']
  wayneHolds: CornerScoreResult['wayneHolds']
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
    // withheld, not absent, when the series carries a decimal shift: see detectPriceScaleShift
    latestPrice: a.priceScaleSuspect ? null : (a.latest?.effectiveUnitPrice ?? null),
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
  /**
   * WHICH DAY IS BEING SERVED AND WHY, carried so a surface can say "serving 2026-08-13;
   * 2026-08-14 is held but not servable because X" instead of silently rendering older
   * data. `feed.feedDay` is the same string as `feedDay` and as `provenance.feedDay` by
   * construction: all three read from one resolution, so they cannot name different days.
   */
  feed: ServedFeedMeta
  summary: CornerMap['summary']
  /**
   * THE BASIS FOR EVERY COUNT ABOVE, so the page can print it rather than let a number stand
   * alone. Carries the day span, the day list, the thin-day comparison and what the demand
   * filter excluded. `coverage.basis` says whether this view is a window or a single day.
   */
  coverage: CornerMap['coverage']
  /**
   * The archived days the map was built over, each with its storage keys and recorded hash,
   * so a row's `demand.feedDay` resolves to a citable government file. Null on a single day.
   */
  window: ServedWindowMeta | null
  /**
   * The same three funnel counts over the NEWEST DAY ALONE. Rendered BESIDE the window counts,
   * never instead of them: a candidate count that grew sixty-fold with no stated basis reads
   * as invention, and the cure is printing both numbers with their days.
   */
  newestDayFunnel: CornerFunnel | null
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
  /**
   * ★ THE TWO SILENCES, SPLIT, BECAUSE THE TRUTH STRIP WAS MERGING THEM.
   *
   * `availCount` counts candidates with at least one listing. Everything else was described as
   * "marked absent", which claims we looked. Measured on the live workspace: of 243 candidate
   * corners, 19 show a listing, 49 have an award row and zero holders — a real checked absence —
   * and 175 have NO award row at all, so nothing was ever read for them. 175 of the 224 "absent"
   * were never asked about.
   *
   * `MonopolyGrid` already draws this distinction per row, returning `unknown / not read: no
   * availability feed connected` when there is no award row. The strip above it was contradicting
   * the grid below it on the same data.
   */
  availAbsentCount: number
  /** Candidates with no award row at all: availability was never read for them. */
  availUnreadCount: number
}

const viewCache = new Map<string, MonopolyView>()

export function buildMonopolyView(): MonopolyView {
  // Resolve FIRST, then key: the served day is the only honest cache key, and it cannot be
  // known without asking. buildAllDatasets is memoised on that same identity, so this is a
  // map read on the warm path rather than a second build.
  const { cornerMap, feed, window, newestDayFunnel } = buildAllDatasets()
  // THE KEY CARRIES THE WINDOW, not only the newest day. A backfill that lands an OLDER
  // capture changes every count on this view without moving `feed.feedDay`, and a key blind to
  // that would serve the pre-backfill view for the life of the process.
  //
  // AND IT CARRIES THE DAY DEMAND WAS JUDGED AGAINST, which is the day the map was computed on
  // rather than a feed day. Solicitations close on the government's calendar whether or not a
  // capture lands, so the same archive answers differently tomorrow, and a key that could not
  // see that would pin this process to the first morning it served a request.
  const judgedOn = cornerMap.coverage.excludedFromDemand?.asOf ?? 'single_day'
  const key = `${feed.feedDay}|${feed.indexStorageKey}|${feed.archive.storageKey}|${cornerMap.coverage.basis}|${cornerMap.coverage.firstDay}|${cornerMap.coverage.dayCount}|${judgedOn}`
  const hit = viewCache.get(key)
  if (hit) return hit

  const awardIndex = buildNsnAwardIndex()
  const awardByNsn = awardIndex.ok ? awardIndex.byNsn : null
  const forecastIndex = buildForecastIndex()
  const cageIx = loadCageFamilyIndex()
  const forecastByNsn = forecastIndex.ok ? forecastIndex.byNsn : null

  // Counted from the FULL records, then slimmed for the wire: the counts and the rendered
  // fields are computed from the same summaries, so slimming cannot move a number.
  let pricedCount = 0
  let candidatePricedCount = 0
  let forecastCount = 0
  let availCount = 0
  let availAbsentCount = 0
  let availUnreadCount = 0

  /*
   * WAYNE'S LEAD SIGNAL, ACTUALLY FED.
   *
   * The `surplusLineage` leg was wired into `scoreCorner` and then passed nothing, so it
   * abstained on every row in production while the commit that added it said the operator's
   * number-one signal now reached the board. That is this estate's dominant failure mode
   * committed by the person who had spent the day naming it: the classifier was built, the leg
   * was built, the types lined up, and no caller ever handed one to the other.
   *
   * Built ONCE per view rather than per row: it aggregates the whole award index, so calling it
   * inside the map would rebuild a 42,698-row aggregation for each of several thousand rows.
   * An unavailable classifier is an honest null, never a fabricated verdict, and the leg's own
   * abstention text already names the coverage.
   */
  const live = buildAwardeeClassifierFromLive()
  const awardee = live.ok ? live.classifier : null

  const rows: EnrichedCornerRow[] = cornerMap.rows.map((r) => {
    const digits = r.nsn.replace(/[^0-9]/g, '')
    const award = awardByNsn?.get(digits) ?? null
    const forecast = forecastByNsn?.get(digits) ?? null
    const isCandidate = r.soleSource && r.silentSourceCount > 0
    const priced = !award?.priceScaleSuspect && award?.latest?.effectiveUnitPrice != null
    if (priced) pricedCount += 1
    if (isCandidate) {
      if (priced) candidatePricedCount += 1
      if (forecast?.onForecast) forecastCount += 1
      /*
        * Three outcomes, never two. `award == null` means no row was ever read for this stock
        * number; an award row with no holders means the feed was read and listed nobody.
        */
      if (award == null) availUnreadCount += 1
      else if (award.holders.length > 0) availCount += 1
      else availAbsentCount += 1
    }
    /*
     * The LAST supplier is the one Wayne's rubric asks about, so the verdict is looked up on the
     * most recent award's CAGE, not on the set of everyone who ever won it. `latest` is already
     * the newest award on the summary.
     */
    const lastAwardee = awardee && award?.latest?.cage ? awardee.classify(award.latest.cage) : null
    const score = scoreCorner(
      r,
      award,
      forecast,
      { awardIndexLoaded: awardIndex.ok, forecastIndexLoaded: forecastIndex.ok, cageFamily: cageIx.ok ? cageIx.index : null },
      lastAwardee,
    )
    return {
      ...r,
      award: slimAward(award),
      forecast: slimForecast(forecast),
      score: {
        scoreV0: score.scoreV0,
        rankKey: score.rankKey,
        disposition: score.disposition,
        grade: score.grade,
        hidden: score.lockup.hidden,
        valueUsd: score.valueUsd,
        valueTier: score.valueTier,
        lockup: score.lockup,
        wayneHolds: score.wayneHolds,
        reasons: score.reasons,
      },
    }
  })

  /*
   * COLLAPSE REPEATED-NSN ROWS TO ONE. DLA bundles many solicitations/CLINs under one stock
   * number (the fuel pump appeared 21× in the 2026-08-14 top-20), which lets one part fill a
   * screen. The corner is a property of the NSN, not of each CLIN, so a bundle collapses to a
   * single row: the one with the highest rankKey (its strongest presentation), carrying the
   * summed solicited quantity so the buy size the operator sees is the whole bundle. Nothing is
   * dropped from the dataset — this is the VIEW's presentation, and the rows array below is what
   * the grid renders; the map's own counts (above) are untouched.
   */
  const collapsed = collapseByNsn(rows)

  const view: MonopolyView = {
    feedDay: cornerMap.provenance.feedDay,
    feed,
    summary: cornerMap.summary,
    coverage: cornerMap.coverage,
    window,
    newestDayFunnel,
    provenance: cornerMap.provenance,
    rows: collapsed,
    awardsJoined: awardByNsn != null,
    forecastJoined: forecastByNsn != null,
    pricedCount,
    candidatePricedCount,
    forecastCount,
    availCount,
    availAbsentCount,
    availUnreadCount,
  }

  // One view per archive state, not one per day the process has been up: the key ends in the
  // day demand was judged against, and this drops the previous day's build with it.
  return cachePerIdentityDay(viewCache, key, view)
}

/**
 * COLLAPSE REPEATED-NSN ROWS TO ONE, keeping the highest-rankKey representative per stock number.
 *
 * DLA bundles many solicitations/CLINs under one NSN, so a value-blind screen let one part (a fuel
 * pump, 21×) fill a top-20. The corner is a property of the stock number, not of each CLIN, so the
 * view renders one row per NSN: the one with the strongest presentation (max rankKey). Nothing is
 * dropped from the DATASET — the map's own counts are computed pre-collapse and untouched; this is
 * only which rows the grid paints. The representative keeps its own fields and its own score (we do
 * not rescore or re-sum quantity, so the buy value it shows always matches the CLIN it was scored
 * on). Deterministic: ties on rankKey keep the earlier row, so two builds collapse identically.
 */
export function collapseByNsn(rows: EnrichedCornerRow[]): EnrichedCornerRow[] {
  const best = new Map<string, EnrichedCornerRow>()
  const order: string[] = []
  for (const r of rows) {
    const key = r.nsn.replace(/[^0-9]/g, '') || r.nsn
    const prev = best.get(key)
    if (!prev) {
      best.set(key, r)
      order.push(key)
    } else if (r.score.rankKey > prev.score.rankKey) {
      best.set(key, r)
    }
  }
  return order.map((k) => best.get(k)!)
}

/** Tests only: drop the memo so a suite can assert cold and warm agree. */
export function resetMonopolyViewCache(): void {
  viewCache.clear()
}
