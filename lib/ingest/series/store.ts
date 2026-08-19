/**
 * T2 INGESTION. THE APPEND-ONLY LEDGER FOR DATED PRICE SERIES.
 *
 * Same discipline as the archive manifest, for the same reasons and after the same lessons.
 * One JSONL file, append-only, one row per observation. A revision is a new row. Nothing is
 * ever rewritten in place, because a figure we showed a customer has to stay reproducible
 * even after the publisher changes its mind.
 *
 * ★ THE DEDUPE KEY IS (series_id, period, vintage, value), AND THE VALUE IS PART OF IT ON
 * PURPOSE. Re-running an ingest on the same day must not grow the file, so an identical
 * observation is a no-op. But if the SAME period at the SAME vintage comes back with a
 * DIFFERENT number, that is not a duplicate to suppress, it is a publisher contradicting
 * itself, and it gets recorded and reported rather than silently dropped. A dedupe that
 * swallows a changed value is how a corrected figure disappears.
 *
 * ★ AND THE WRITE ORDER IS BYTES-THEN-RECORD, deliberately, copying the archive. On
 * 2026-08-18 a capture on this estate was killed mid-run by a memory watchdog and the archive
 * survived intact for exactly one reason: `archiveBytes` writes the file, verifies it by
 * re-reading, and only THEN appends the manifest row. Had it recorded first, the kill would
 * have created a row vouching for bytes that were never written, which is the defect that
 * cost this build a night. There is only one file here so the ordering is simpler, but the
 * rule is the same: never record a fact before the fact is durable.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { dataPath } from '../../data-root'
import { civilInZone } from '../../time/zoned'
import type { SeriesObservation } from './bls'

/**
 * Beside the archive, under the SAME resolved data root, outside git for the same reason: it
 * grows forever and is not source.
 *
 * ★ IT IS `dataPath()` AND NOT `DATA_ROOT`, AND THAT DISTINCTION WAS A LIVE DEFECT. This
 * originally read `join(DATA_ROOT, 'series')`. `DATA_ROOT` comes from `lib/ingest/db.ts`, whose
 * own comment says it "feeds the LOCAL embedded-Postgres location only", and it is hardcoded to
 * `/Users/user/onlysource-data` when `ONLYSOURCE_DATA_ROOT` is unset. On the production droplet
 * that variable is unset and that directory does not exist, so the scheduled ingest would have
 * created a tree under a laptop path on a Linux box and written the ledger somewhere the
 * application never looks: `resolveDataRoot()` returns the bundled `<cwd>/data` there.
 *
 * The two roots agree on nothing but the archive, which resolves through `archivePath()` and so
 * was never affected. Measured on prod: `dataPath('series')` = /opt/onlysource/data/series,
 * `join(DATA_ROOT, 'series')` = /Users/user/onlysource-data/series.
 *
 * BUILT, CORRECT, AND WRITING WHERE NOTHING READS. The test below asserts the series root shares
 * a parent with the archive root, so a second data root can never silently reappear.
 */
export const SERIES_ROOT = process.env.INGEST_SERIES_ROOT ?? dataPath('series')

export const seriesLedgerPath = (root: string = SERIES_ROOT): string =>
  join(root, 'SERIES.jsonl')

export type AppendOutcome = {
  appended: number
  /** Identical rows already held. Re-running an ingest is free. */
  alreadyHeld: number
  /**
   * The same (series_id, period, vintage) already on file with a DIFFERENT value. Never
   * suppressed, never overwritten: both rows stay and the caller is told.
   */
  contradictions: {
    series_id: string
    period: string
    vintage: string
    held: number
    incoming: number
  }[]
}

const identity = (o: SeriesObservation): string => `${o.series_id}::${o.period}::${o.vintage}`
const exact = (o: SeriesObservation): string => `${identity(o)}::${o.value}`

/** Every observation on file, oldest first. Absent ledger is an empty list, never an error. */
export async function readSeriesLedger(
  root: string = SERIES_ROOT,
): Promise<SeriesObservation[]> {
  const path = seriesLedgerPath(root)
  if (!existsSync(path)) return []
  const text = await readFile(path, 'utf8')
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as SeriesObservation)
}

/**
 * Append observations we do not already hold.
 *
 * Idempotent on the exact row. Contradictions are appended AND reported: the ledger records
 * what the publisher said each time it was asked, and reconciling two disagreeing readings is
 * an operator's judgement, not a write-time heuristic.
 */
export async function appendObservations(
  observations: readonly SeriesObservation[],
  root: string = SERIES_ROOT,
): Promise<AppendOutcome> {
  const held = await readSeriesLedger(root)
  const exactKeys = new Set(held.map(exact))
  const byIdentity = new Map(held.map((o) => [identity(o), o]))

  const outcome: AppendOutcome = { appended: 0, alreadyHeld: 0, contradictions: [] }
  const lines: string[] = []

  for (const o of observations) {
    if (exactKeys.has(exact(o))) {
      outcome.alreadyHeld += 1
      continue
    }
    const prior = byIdentity.get(identity(o))
    if (prior && prior.value !== o.value) {
      outcome.contradictions.push({
        series_id: o.series_id,
        period: o.period,
        vintage: o.vintage,
        held: prior.value,
        incoming: o.value,
      })
    }
    lines.push(JSON.stringify(o))
    exactKeys.add(exact(o))
    byIdentity.set(identity(o), o)
    outcome.appended += 1
  }

  if (lines.length > 0) {
    const path = seriesLedgerPath(root)
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, lines.join('\n') + '\n', 'utf8')
  }
  return outcome
}

export type SeriesCoverage = {
  series_id: string
  periods: number
  firstPeriod: string
  lastPeriod: string
  vintages: string[]
  /** Periods holding more than one vintage: the series has been revised, or re-read. */
  revisedPeriods: number
}

/**
 * What the ledger actually covers, per series. For an operator surface, so "we have the
 * series" can be replaced by which periods, at which vintages.
 */
export function summariseCoverage(
  observations: readonly SeriesObservation[],
): SeriesCoverage[] {
  const bySeries = new Map<string, SeriesObservation[]>()
  for (const o of observations) {
    const list = bySeries.get(o.series_id) ?? []
    list.push(o)
    bySeries.set(o.series_id, list)
  }
  const out: SeriesCoverage[] = []
  for (const [series_id, rows] of bySeries) {
    const periods = new Map<string, Set<string>>()
    for (const r of rows) {
      const set = periods.get(r.period) ?? new Set<string>()
      set.add(r.vintage)
      periods.set(r.period, set)
    }
    const sorted = [...periods.keys()].sort()
    out.push({
      series_id,
      periods: sorted.length,
      firstPeriod: sorted[0] ?? '',
      lastPeriod: sorted[sorted.length - 1] ?? '',
      vintages: [...new Set(rows.map((r) => r.vintage))].sort(),
      revisedPeriods: [...periods.values()].filter((v) => v.size > 1).length,
    })
  }
  return out.sort((a, b) => a.series_id.localeCompare(b.series_id))
}

/* ------------------------------------------------------------------------------------ */
/* SERIES FRESHNESS. A DATED SERIES NOBODY REFRESHES IS A SLOWER STALE CONSTANT           */
/* ------------------------------------------------------------------------------------ */

export type SeriesTone = 'fresh' | 'aging' | 'stale'

export type SeriesFreshness = {
  series_id: string
  /** The newest MONTHLY period held. Annual averages are excluded: see below. */
  newestMonthlyPeriod: string | null
  /** Calendar months from that period to the month this was measured in. */
  monthsBehind: number | null
  tone: SeriesTone
  /** The Eastern civil month the measurement was made in, as YYYY-MM. */
  measuredIn: string
  /** The most recent vintage any row of this series carries. */
  newestVintage: string | null
}

/**
 * TONE THRESHOLDS, stated rather than smuggled, and calibrated to the PUBLISHER'S cadence
 * rather than to a calendar. BLS publishes a month's CPI-U in the middle of the FOLLOWING
 * month, so being one month behind is the newest publishable state and is not staleness. Two
 * is a missed release. More than that and the anchor is escalating with an index that has
 * stopped tracking the economy it is supposed to describe.
 *
 * This is the same distinction the feed archive already draws, and for the same reason: an
 * alarm that fires on a source's normal operating lag is an alarm nobody reads by the end of
 * the month.
 */
export const SERIES_FRESH_MAX_MONTHS = 1
export const SERIES_AGING_MAX_MONTHS = 2

/**
 * How current the ledger is, per series.
 *
 * ★ ANNUAL AVERAGES ARE EXCLUDED FROM THE MEASUREMENT ON PURPOSE. BLS publishes a year's
 * annual average (period M13) only after that year ends, so a ledger holding 2025-M13 and
 * nothing newer looks respectable while being eight months behind on the monthly series the
 * anchor actually resolves against. Judging freshness by the annual average would report the
 * comfortable number instead of the true one, which is the same error as judging a
 * solicitation against the newest day captured instead of against today.
 *
 * ★ AND IT USES THE SAME EASTERN CIVIL CLOCK AS THE FEED ARCHIVE, imported rather than
 * re-derived. Two clocks in one product is how the chrome and the filter came to name two
 * different todays on this build in a single day.
 */
export function measureSeriesFreshness(
  observations: readonly SeriesObservation[],
  nowMs: number,
): SeriesFreshness[] {
  const today = civilInZone(nowMs, 'America/New_York')
  const p2 = (n: number) => String(n).padStart(2, '0')
  const measuredIn = `${today.year}-${p2(today.month)}`

  const bySeries = new Map<string, SeriesObservation[]>()
  for (const o of observations) {
    const list = bySeries.get(o.series_id) ?? []
    list.push(o)
    bySeries.set(o.series_id, list)
  }

  const out: SeriesFreshness[] = []
  for (const [series_id, rows] of bySeries) {
    const monthly = rows.filter((r) => /^M(0[1-9]|1[0-2])$/.test(r.period_code))
    const newest = monthly.reduce<SeriesObservation | null>(
      (a, b) => (a === null || b.period > a.period ? b : a),
      null,
    )
    const newestVintage = rows.reduce<string | null>(
      (a, b) => (a === null || b.vintage > a ? b.vintage : a),
      null,
    )

    if (newest === null) {
      // Holding only annual averages is not a freshness reading, it is an absence of one.
      out.push({
        series_id,
        newestMonthlyPeriod: null,
        monthsBehind: null,
        tone: 'stale',
        measuredIn,
        newestVintage,
      })
      continue
    }

    const year = Number(newest.period.slice(0, 4))
    const month = Number(newest.period_code.slice(1))
    const monthsBehind = (today.year - year) * 12 + (today.month - month)
    const tone: SeriesTone =
      monthsBehind <= SERIES_FRESH_MAX_MONTHS
        ? 'fresh'
        : monthsBehind <= SERIES_AGING_MAX_MONTHS
          ? 'aging'
          : 'stale'
    out.push({
      series_id,
      newestMonthlyPeriod: newest.period,
      monthsBehind,
      tone,
      measuredIn,
      newestVintage,
    })
  }
  return out.sort((a, b) => a.series_id.localeCompare(b.series_id))
}

/** One line per series that is not fresh. Empty when every series is current. */
export function seriesFreshnessReport(freshness: readonly SeriesFreshness[]): string[] {
  return freshness
    .filter((f) => f.tone !== 'fresh')
    .map((f) =>
      f.newestMonthlyPeriod === null
        ? `series ${f.series_id}: NO MONTHLY READING HELD (annual averages alone cannot date an award)`
        : `series ${f.series_id}: ${f.tone.toUpperCase()}, newest monthly reading ${f.newestMonthlyPeriod} is ` +
          `${f.monthsBehind} month(s) behind ${f.measuredIn}. The anchor is escalating with an index that ` +
          `has stopped tracking. Run: npm run ingest:series`,
    )
}
