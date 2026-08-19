/**
 * THE ANCHOR'S INFLATION FACTOR, READ FROM THE INGESTED SERIES INSTEAD OF PINNED IN SOURCE.
 *
 * =========================================================================================
 * WHY THIS EXISTS: 1.3223 WAS NEVER WRONG. IT WAS UNDATED, WHICH IS A DIFFERENT DEFECT.
 * =========================================================================================
 * The expert stated the CPI factor as 1.3223 without naming a series. It was later identified by
 * measurement as BLS CPI-U `CUUR0000SA0`, reproducing exactly from 2017 annual 245.120 to
 * 2025-M11 324.122. So it is a READING, not a judgement.
 *
 * A reading goes stale. A judgement cannot. The same series at 2026-M07 gives 1.3623, so every
 * anchor computed from the pinned figure is about 3 percent LOW and drifts further every month
 * with no code change and no alert. While the product only displayed four auditable figures that
 * was a labelling problem. Now that it recommends a number an operator types into DIBBS, a
 * silently stale factor is a wrong recommendation WITH A CITATION ON IT, which is the worst
 * combination available.
 *
 * =========================================================================================
 * WHY IT IS A SEPARATE MODULE AND NOT A CHANGE INSIDE anchor.ts
 * =========================================================================================
 * `readSeriesLedger` is async. `buildQuoteView` and `recommendPrice` are PURE and SYNCHRONOUS,
 * read no clock and perform no I/O, which is what lets a test hand them a world with a known
 * answer. Awaiting a file read inside them would destroy that property for every caller.
 *
 * So the ledger is read at the edge, the factor is resolved here, and the result is injected
 * through the `indices` parameter the engine already accepts. The engine stays pure and gains a
 * live number.
 *
 * =========================================================================================
 * THE ABSTENTION IS NOT A FALLBACK TO SILENCE, AND NOT A SILENT FALLBACK EITHER
 * =========================================================================================
 * If the ledger cannot answer, this returns the PINNED factor and says so, carrying the
 * abstention's own reason and missing input. Two failure modes are deliberately refused:
 *   - Going dark. Dropping the anchor because a ledger is missing makes a wiring gap look
 *     identical to thin evidence about the item, and those are different sentences.
 *   - Substituting quietly. Serving the pinned 1.3223 as though it were current is exactly the
 *     defect this module exists to remove.
 * The pinned figure travels WITH its November 2025 vintage, so a surface can render it as the
 * dated reading it demonstrably is.
 */
import type { SeriesObservation } from '@/lib/ingest/series/bls'
import { resolveSeriesRatio, type RatioResolution } from '@/lib/intelligence/series/ratio'
import { CPI_INDEX_1650, INDEX_CONFIG_1650, type AnchorIndexConfig, type InflationIndexSpec } from './anchor'

/** The published series the pinned factor was measured to reproduce. */
export const CPI_SERIES_ID = 'CUUR0000SA0'

/**
 * The base period. `M13` is the BLS annual average, and 2017 is the expert's stated base year, so
 * this is the SAME base the pinned 1.3223 used. Keeping it identical is what makes the new figure
 * comparable to the old one rather than a different calculation wearing the same name.
 */
export function basePeriodOf(spec: InflationIndexSpec): string {
  return `${spec.vintage.baseYear}-M13`
}

/**
 * The base period, DERIVED FROM THE SPEC'S OWN `baseYear` rather than written here as a constant.
 *
 * ★ ADOPTED FROM @LANE-4's parallel adapter, and it is a better property than the constant it
 * replaces: a spec carrying a different base year would otherwise have been silently priced off
 * 2017 while its own vintage said something else. `M13` is the BLS annual average, so 2017 gives
 * the annual figure the expert's 1.3223 was measured against. Keeping the base identical is what
 * makes the live figure comparable to the pinned one rather than a different calculation wearing
 * the same name.
 */
export const CPI_BASE_PERIOD = basePeriodOf(CPI_INDEX_1650)

/**
 * The as-of vintage for a pricing instant, AS A UTC DATE.
 *
 * ★★ THIS FUNCTION EXISTS BECAUSE THE OBVIOUS THING IS WRONG AND FAILS SILENTLY. Vintages are
 * stamped by the ingest from `retrieved_at`, which is UTC. The rest of this product defines
 * "today" as the EASTERN civil date, via `measureFeedFreshness(...).measuredOn`, because that is
 * the publisher's calendar for feed days. Those are different dates for four hours of every day,
 * and `resolveSeriesRatio` compares vintages LEXICALLY.
 *
 * MEASURED while wiring this: the ledger held exactly one vintage, `2026-08-19`, written at
 * 02:59 UTC. The page passed the Eastern civil date `2026-08-18`. Every reading therefore looked
 * like it had not been published yet, the resolver correctly refused them all, and the anchor
 * fell back to the pinned 1.3223 WITH NO ERROR ANYWHERE. The wire would have shipped, passed a
 * type check, rendered a 200, and done nothing at all.
 *
 * So the as-of must be measured on the same clock the vintages were stamped on. Feed days stay
 * Eastern; series vintages are UTC; the two must never be compared.
 */
export function seriesVintageAsOf(atInstantMs: number): string {
  return new Date(atInstantMs).toISOString().slice(0, 10)
}

const MONTHLY = /^M(0[1-9]|1[0-2])$/

/**
 * The newest MONTHLY reading held at or before a vintage.
 *
 * ★ NOT THE CURRENT CALENDAR MONTH, AND THIS IS A CORRECTNESS POINT RATHER THAN A CONVENIENCE.
 * BLS publishes CPI with a lag of about two weeks, so a request for "this month" would abstain
 * every single time and the anchor would never once use live data. Asking for the newest reading
 * actually published is the honest question: carry the money as far forward as the publisher has
 * gone, and say which month that was.
 *
 * Annual rows (`M13`) are excluded as a TARGET because mixing an annual average into the numerator
 * against a monthly denominator silently changes what the ratio means.
 */
export function newestMonthlyPeriod(
  observations: readonly SeriesObservation[],
  seriesId: string,
  asOfVintage: string,
): string | null {
  let best: string | null = null
  for (const o of observations) {
    if (o.series_id !== seriesId) continue
    if (!MONTHLY.test(o.period_code)) continue
    if (o.vintage > asOfVintage) continue
    if (best === null || o.period > best) best = o.period
  }
  return best
}

export type LiveIndexOutcome = {
  readonly config: AnchorIndexConfig
  /** True when the CPI leg came from the ledger rather than the pinned constant. */
  readonly cpiIsLive: boolean
  /** The period the factor carries money TO, when live. */
  readonly carriedToPeriod: string | null
  /** Present whenever the ledger could not answer, so a surface can say WHY it is pinned. */
  readonly abstention: Extract<RatioResolution, { resolved: false }> | null
  /** The sentence a surface may render verbatim. Always true of whichever factor is in force. */
  readonly note: string
}

/**
 * Resolve the anchor's index configuration against an ingested series.
 *
 * `asOfVintage` is REQUIRED with no default and no clock is read here, matching the discipline of
 * `atInstantMs` in the recommendation engine. A default would be a wall-clock read hidden in a
 * helper, and a question about the past answered with a reading that did not exist yet is the
 * same defect as judging "still biddable" against the newest captured day.
 */
export function resolveLiveIndexConfig(
  observations: readonly SeriesObservation[],
  asOfVintage: string,
): LiveIndexOutcome {
  const pinnedNote =
    `Carried on the pinned factor ${CPI_INDEX_1650.factor}, which is a reading of ` +
    `${CPI_SERIES_ID} taken in November 2025 and not a current one. It is shown with its vintage ` +
    'rather than as today\'s figure.'

  /*
   * ★★ A SPEC THAT NAMES NO PUBLISHED SERIES MAY NEVER BE REFRESHED FROM A LEDGER. Adopted from
   * @LANE-4's adapter, and it is the sharpest guard either of us wrote.
   *
   * The DoD procurement factor is the expert's STATED JUDGEMENT, not a reading of anything. It
   * carries `publishedSeriesId: null` precisely to say so. Refreshing such a spec against a series
   * would dress an opinion as a measurement and hand it a citation, which is this module's own
   * defect pointed the other way. The check is on the SPEC rather than on a caller's good
   * intentions, so no future call site can bypass it.
   */
  if (CPI_INDEX_1650.vintage.publishedSeriesId === null) {
    return {
      config: INDEX_CONFIG_1650,
      cpiIsLive: false,
      carriedToPeriod: null,
      abstention: null,
      note:
        'This factor names no published series, so it is a stated judgement rather than a ' +
        'reading and nothing may refresh it. ' + pinnedNote,
    }
  }

  const toPeriod = newestMonthlyPeriod(observations, CPI_SERIES_ID, asOfVintage)
  if (toPeriod === null) {
    return {
      config: INDEX_CONFIG_1650,
      cpiIsLive: false,
      carriedToPeriod: null,
      abstention: null,
      note:
        `No monthly reading of ${CPI_SERIES_ID} is held at or before ${asOfVintage}. ` + pinnedNote,
    }
  }

  const r = resolveSeriesRatio(observations, {
    seriesId: CPI_SERIES_ID,
    fromPeriod: CPI_BASE_PERIOD,
    toPeriod,
    asOfVintage,
    // A figure that gets bid may only stand on a reading we actually fetched from the publisher.
    acceptRetrievalMethods: ['api_fetch'],
  })

  if (!r.resolved) {
    return {
      config: INDEX_CONFIG_1650,
      cpiIsLive: false,
      carriedToPeriod: null,
      abstention: r,
      note: `${r.sentence} ${pinnedNote}`,
    }
  }

  /*
   * THE VINTAGE IS STAMPED ONTO THE FIGURE, which is the point of the whole exercise. The old
   * constant was wrong only in that nothing on it recorded WHEN it had been read, so nobody could
   * see it aging. This one names its series, its base period, the period it was carried to, and
   * the release it was read at, so the same defect cannot recur silently.
   */
  /*
   * ROUNDED TO FOUR DECIMALS, AND THE ROUNDING IS THE COMPUTED VALUE RATHER THAN A DISPLAY
   * FORMAT. The engine prints its own arithmetic for the operator to check on a napkin, and the
   * house rule is that the arithmetic SHOWN is the arithmetic PERFORMED. Carrying
   * 1.3622633812010443 internally while printing 1.3623 would put a sum on the screen that does
   * not reproduce by hand, which is worse than a slightly coarser factor.
   *
   * Four decimals is also the convention the pinned 1.3223 already used, so the new figure is
   * directly comparable to the one it replaces instead of merely close to it.
   */
  const factor = Math.round(r.ratio * 10_000) / 10_000

  const cpi: InflationIndexSpec = {
    ...CPI_INDEX_1650,
    factor,
    vintage: {
      ...CPI_INDEX_1650.vintage,
      statedAtSourceDate: asOfVintage,
      publishedSeriesId: CPI_SERIES_ID,
      note:
        `Read from the ingested series rather than pinned in source. ${r.citation} Carried from ` +
        `${CPI_BASE_PERIOD} to ${toPeriod}, read at vintage ${asOfVintage}.`,
    },
  }

  return {
    config: { ...INDEX_CONFIG_1650, cpi },
    cpiIsLive: true,
    carriedToPeriod: toPeriod,
    abstention: null,
    note:
      `CPI factor ${factor} read from ${CPI_SERIES_ID}, carried from ` +
      `${CPI_BASE_PERIOD} to ${toPeriod} at vintage ${asOfVintage}.`,
  }
}
