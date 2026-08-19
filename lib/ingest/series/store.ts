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

import { DATA_ROOT } from '../db'
import type { SeriesObservation } from './bls'

/** Beside the archive, outside git, for the same reason: it grows forever and is not source. */
export const SERIES_ROOT = process.env.INGEST_SERIES_ROOT ?? join(DATA_ROOT, 'series')

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
