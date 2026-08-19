/**
 * T2 INGESTION. Shared plumbing for the daily capture and the backfill.
 *
 * LOADED DYNAMICALLY, AFTER THE BOOTSTRAP. This module statically imports the consent
 * connector, which imports the `server-only` marker, which THROWS unless the process runs
 * with the `react-server` resolution condition. The .mts entry points therefore carry no
 * static imports of this file: they check the condition, re-exec themselves with it when it
 * is missing, and only then `await import()` this module. Run from the repo root, where
 * tsx can see tsconfig.json for the `@/` alias the connector uses internally.
 *
 * PACING IS CITIZENSHIP, AND IT IS ALSO SELF-INTEREST. The DIBBS hosts sit behind an F5 ASM
 * measured on this estate to trip at roughly 30 rapid requests and clear in about 45 to 60
 * seconds. Every fetch here is spaced by seconds, and a measured block backs off beyond the
 * observed clearing window before ONE retry. Three unresolved blocks abort the run: a
 * capture fighting a WAF is manufacturing the outage it exists to prevent.
 */

import { getConsentedClient, ConsentError } from '../../lib/connectors/dibbs/consent'
import {
  fetchDailyFile,
  dailyFilename,
  DIBBS_SOURCE_KEY,
  DAILY_FILES,
  type ConsentedClientProvider,
  type DailyFileKind,
  type FetchOutcome,
} from '../../lib/ingest/sources/dibbs-fetch'
import { readManifestEntries, recordRejection } from '../../lib/ingest/archive'
import {
  reconcileArchive,
  reconciliationKey,
  type ArchiveReconciliation,
} from '../../lib/ingest/archive-reconcile'
import { ARCHIVE_ROOT, archiveRootResolution } from '../../lib/ingest/db'
import { systemClock } from '../../lib/time/clock'
import { civilInZone, addCivilDays } from '../../lib/time/zoned'
import { isNonBusinessDay } from '../../lib/time/federal-holidays'

export { DAILY_FILES, DIBBS_SOURCE_KEY, ARCHIVE_ROOT, archiveRootResolution }
export type { DailyFileKind, FetchOutcome }

export const nowIso = (): string => new Date(systemClock.now()).toISOString()

/* ------------------------------------------------------------------------------------ */
/* BUSINESS-DAY WALKING, in the publisher's calendar (Eastern, federal holidays out)      */
/* ------------------------------------------------------------------------------------ */

export type CivilDate = { year: number; month: number; day: number }

const p2 = (n: number) => String(n).padStart(2, '0')
export const civilKey = (d: CivilDate): string => `${d.year}-${p2(d.month)}-${p2(d.day)}`

export function easternToday(): CivilDate {
  const c = civilInZone(systemClock.now(), 'America/New_York')
  return { year: c.year, month: c.month, day: c.day }
}

export function previousBusinessDay(d: CivilDate): CivilDate {
  let cursor = addCivilDays(d.year, d.month, d.day, -1)
  while (isNonBusinessDay(cursor)) {
    cursor = addCivilDays(cursor.year, cursor.month, cursor.day, -1)
  }
  return cursor
}

/** Today when it is a business day, else the last business day before it. */
export function newestPossibleFeedDay(): CivilDate {
  const today = easternToday()
  return isNonBusinessDay(today) ? previousBusinessDay(today) : today
}

/** The most recent `count` business days, newest first, starting at `from`. */
export function businessDaysBack(from: CivilDate, count: number): string[] {
  const days: string[] = []
  let cursor = isNonBusinessDay(from) ? previousBusinessDay(from) : from
  while (days.length < count) {
    days.push(civilKey(cursor))
    cursor = previousBusinessDay(cursor)
  }
  return days
}

/* ------------------------------------------------------------------------------------ */
/* PACING                                                                                 */
/* ------------------------------------------------------------------------------------ */

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 3 to 5 seconds between requests. Jitter so the cadence is not itself a fingerprint. */
export function paceMs(): number {
  return 3000 + Math.floor(Math.random() * 2000)
}

/** Past the measured 45 to 60 second clearing window, with margin. */
export const WAF_BACKOFF_MS = 90_000
export const MAX_WAF_STRIKES = 3

/* ------------------------------------------------------------------------------------ */
/* WHAT THE MANIFEST ALREADY HOLDS                                                        */
/* ------------------------------------------------------------------------------------ */

/**
 * Reconcile the manifest against the bytes actually on disk.
 *
 * WHY THIS IS NOT JUST `readArchiveManifest()`. It used to be, and the manifest's own record
 * of a capture was taken as proof the file was there. On 2026-08-18 production held a
 * manifest asserting seven accepted captures whose 1.47 GB of bytes had been removed, and
 * because the skip-set was built from that record, every subsequent capture and backfill
 * would have skipped re-fetching them with no request and no report, permanently. The
 * manifest is what we wrote. The disk is what we have. Ask the disk.
 */
export async function reconcileHeld(): Promise<ArchiveReconciliation> {
  const entries = await readManifestEntries()
  return reconcileArchive(entries, ARCHIVE_ROOT)
}

/**
 * `logical_date/filename` keys of every capture whose bytes are present AND at the recorded
 * length. The idempotency contract: a file we can prove we hold is skipped without a
 * network request, so a re-run of a whole backfill costs the origin nothing. A file the
 * manifest claims but the disk does not hold is NOT held, and is fetched again.
 * Content-hash dedupe inside archiveBytes remains the second belt for the fetches that run.
 */
export async function heldFiles(): Promise<Set<string>> {
  const reconciliation = await reconcileHeld()
  return new Set(
    reconciliation.files
      .filter((f) => f.sourceKey === DIBBS_SOURCE_KEY && f.state === 'held')
      .map((f) => reconciliationKey(f.logicalDate, f.filename)),
  )
}

/* ------------------------------------------------------------------------------------ */
/* THE CONSENTED PROVIDER AND THE PACED, GATED DAY CAPTURE                                */
/* ------------------------------------------------------------------------------------ */

export const realClientProvider: ConsentedClientProvider = (host) => getConsentedClient(host)

export type DayFileResult = {
  logicalDate: string
  kind: DailyFileKind
  filename: string
  status: FetchOutcome['status'] | 'skipped_already_held' | 'waf_blocked'
  detail: string
  byteLen: number | null
}

export type CaptureDayReport = {
  logicalDate: string
  results: DayFileResult[]
  wafStrikes: number
}

/**
 * Capture one feed day's files through the content gate, paced, idempotent, refusals
 * recorded. Never throws for a per-file failure; throws only when the WAF strike budget is
 * exhausted, because continuing past that point deepens the block for every future run.
 */
export async function captureDay(
  provider: ConsentedClientProvider,
  logicalDate: string,
  kinds: readonly DailyFileKind[],
  held: Set<string>,
  state: { wafStrikes: number; requestsMade: number },
): Promise<CaptureDayReport> {
  const results: DayFileResult[] = []

  for (const kind of kinds) {
    const filename = dailyFilename(kind, logicalDate)
    if (held.has(`${logicalDate}/${filename}`)) {
      results.push({
        logicalDate,
        kind,
        filename,
        status: 'skipped_already_held',
        detail: 'the bytes are on disk at the recorded length, verified against the archive not the manifest',
        byteLen: null,
      })
      continue
    }

    if (state.requestsMade > 0) await sleep(paceMs())

    const attemptOnce = async (): Promise<FetchOutcome> => {
      state.requestsMade += 1
      return fetchDailyFile(provider, kind, logicalDate, nowIso)
    }

    try {
      let outcome: FetchOutcome
      try {
        outcome = await attemptOnce()
      } catch (error) {
        if (error instanceof ConsentError && error.code === 'waf_blocked') {
          // Measured block. Back off past the observed clearing window, then ONE retry.
          state.wafStrikes += 1
          process.stderr.write(
            `  WAF block observed on ${filename} (strike ${state.wafStrikes}); backing off ${WAF_BACKOFF_MS / 1000}s\n`,
          )
          if (state.wafStrikes >= MAX_WAF_STRIKES) throw error
          await sleep(WAF_BACKOFF_MS)
          outcome = await attemptOnce()
        } else {
          throw error
        }
      }
      results.push({
        logicalDate,
        kind,
        filename,
        status: outcome.status,
        detail: outcome.detail,
        byteLen: outcome.byteLen,
      })
    } catch (error) {
      if (error instanceof ConsentError && error.code === 'waf_blocked') {
        // Still blocked after the backoff, or the strike budget is spent. Record the
        // refusal in the manifest, then let the caller decide whether the run continues.
        await recordRejection({
          sourceKey: DIBBS_SOURCE_KEY,
          logicalDate,
          filename,
          sourceUrl: `https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/${filename}`,
          httpStatus: null,
          reason: 'the F5 WAF served its Request Rejected page and one paced retry did not clear it',
          verdict: 'waf_blocked',
          retrievedAt: nowIso(),
          recordedAt: nowIso(),
          retrievalMethod: 'pipeline_fetch',
          retrievedBy: 'T2 ingest capture script',
          note: `feed day ${logicalDate}, ${kind} file`,
        })
        results.push({
          logicalDate,
          kind,
          filename,
          status: 'waf_blocked',
          detail: 'WAF still blocking after one backed-off retry; recorded and moved on',
          byteLen: null,
        })
        if (state.wafStrikes >= MAX_WAF_STRIKES) {
          const report: CaptureDayReport = { logicalDate, results, wafStrikes: state.wafStrikes }
          throw new WafBudgetExhausted(report)
        }
        continue
      }

      /*
       * A TRANSPORT FAILURE IS A PER-FILE FACT, NOT A RUN-KILLER. A 400 MB zip transfer can
       * drop mid-stream; crashing the whole backfill on it would silently strand every
       * remaining day of a closing window behind one bad socket. The failure is recorded in
       * the manifest like every other refusal (so the ledger shows we ASKED and what
       * happened), reported as needing an operator, and the run moves to the next file. A
       * re-run retries it: transport reasons carry no dedupe value worth suppressing, and
       * recordRejection dedupes only an identical repeat.
       */
      const message = error instanceof Error ? error.message : String(error)
      await recordRejection({
        sourceKey: DIBBS_SOURCE_KEY,
        logicalDate,
        filename,
        sourceUrl: `https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/${filename}`,
        httpStatus: null,
        reason: `transport failure: ${message}`,
        verdict: 'transport_error',
        retrievedAt: nowIso(),
        recordedAt: nowIso(),
        retrievalMethod: 'pipeline_fetch',
        retrievedBy: 'T2 ingest capture script',
        note: `feed day ${logicalDate}, ${kind} file`,
      })
      results.push({
        logicalDate,
        kind,
        filename,
        status: 'failed',
        detail: `transport failure: ${message}`,
        byteLen: null,
      })
    }
  }

  return { logicalDate, results, wafStrikes: state.wafStrikes }
}

/* ------------------------------------------------------------------------------------ */
/* THE WINDOW WALK. A SCHEDULE THAT CANNOT SEE A HOLE WILL NEVER FILL ONE                 */
/* ------------------------------------------------------------------------------------ */

export type WindowStopReason =
  | 'window_complete'
  | 'refusal'
  | 'no_index_outcome'
  | 'request_budget_spent'

export type CaptureWindowReport = {
  days: CaptureDayReport[]
  /** Days every requested file of which we already hold. No request was made for these. */
  alreadyComplete: string[]
  /** Days we actually asked the origin about. */
  requested: string[]
  stopReason: WindowStopReason
}

/** Bound on how many days one run may ask the origin about. Pacing is citizenship. */
export const DEFAULT_WINDOW_DAYS = 10
export const DEFAULT_MAX_DAYS_REQUESTED = 6

/**
 * Walk a window of business days and capture every day we do not hold, instead of stopping
 * at the first day that exists.
 *
 * WHY THIS REPLACED THE OLD WALK. The daily capture used to start at the newest business day,
 * walk backwards over 404s, and STOP at the first day that answered with data, on the
 * reasoning that older days are the backfill's job. That is true right up until a day in the
 * middle of the window goes missing. Production lost 2026-08-17 hours after capturing it, and
 * because the next morning's run would find 08-18 or 08-19 and stop, the cron would never
 * have returned for it. A deleted day was permanently invisible to the only process that
 * could have noticed. The hole did not heal because nothing was looking.
 *
 * So the walk asks the DISK which days of the window are missing, and asks the origin for
 * those. A day whose files we already hold costs no request, so the steady state is one or
 * two fetches a morning exactly as before; the difference only shows up when there is a gap.
 *
 * IT STILL STOPS FOR A REFUSAL THAT IS NOT ABSENCE. A 404 means the origin does not have that
 * day and the walk continues, because a window legitimately contains days that were never
 * published. A rejected body, a consent failure or a WAF block means something is wrong
 * between us and the origin, and walking on would paper over it with an older success.
 *
 * AND IT IS BUDGETED. `maxDaysRequested` caps how many days one run may ask about, so a box
 * restored from an empty archive re-fills over several mornings rather than fetching a month
 * in one burst and manufacturing the WAF block this pipeline exists to avoid.
 */
export async function captureWindow(
  provider: ConsentedClientProvider,
  candidates: readonly string[],
  kinds: readonly DailyFileKind[],
  held: Set<string>,
  state: { wafStrikes: number; requestsMade: number },
  opts: { maxDaysRequested?: number } = {},
): Promise<CaptureWindowReport> {
  const maxDaysRequested = opts.maxDaysRequested ?? DEFAULT_MAX_DAYS_REQUESTED
  const days: CaptureDayReport[] = []
  const alreadyComplete: string[] = []
  const requested: string[] = []
  let stopReason: WindowStopReason = 'window_complete'

  for (const day of candidates) {
    const wanted = kinds.map((kind) => dailyFilename(kind, day))
    if (wanted.every((filename) => held.has(`${day}/${filename}`))) {
      alreadyComplete.push(day)
      continue
    }

    if (requested.length >= maxDaysRequested) {
      stopReason = 'request_budget_spent'
      break
    }

    process.stdout.write(`feed day ${day}:\n`)
    requested.push(day)
    const report = await captureDay(provider, day, kinds, held, state)
    for (const r of report.results) printResult(r)
    days.push(report)

    /*
     * A file we just captured must count as held for the rest of the walk. Without this the
     * window would re-request a day it had captured moments earlier if the same file were
     * reachable twice, and a caller reusing the set across runs would see a stale answer.
     */
    for (const r of report.results) {
      if (r.status === 'archived' || r.status === 'already_present') {
        held.add(`${day}/${r.filename}`)
      }
    }

    const blocking = report.results.find(
      (r) => !['archived', 'already_present', 'skipped_already_held', 'not_published'].includes(r.status),
    )
    if (blocking) {
      process.stderr.write(
        `capture: ${day} ${blocking.filename} came back ${blocking.status}, which is not the origin ` +
          `saying the day does not exist. Stopping rather than walking past it.\n`,
      )
      stopReason = 'refusal'
      break
    }

    if (kinds.includes('in') && !report.results.some((r) => r.kind === 'in')) {
      // The walk's evidence for a day is the index fetch. No index outcome means the day was
      // never measured, and describing an unmeasured day in either direction would be invented.
      process.stderr.write(`capture: no index outcome came back for ${day}; stopping rather than guessing\n`)
      stopReason = 'no_index_outcome'
      break
    }
  }

  return { days, alreadyComplete, requested, stopReason }
}

/** Thrown when the strike budget is spent; carries what WAS captured so nothing is silent. */
export class WafBudgetExhausted extends Error {
  constructor(readonly partial: CaptureDayReport) {
    super(
      `aborting: ${MAX_WAF_STRIKES} WAF blocks in one run. Continuing would extend the block. ` +
        `Everything captured before the abort is archived and recorded.`,
    )
    this.name = 'WafBudgetExhausted'
  }
}

/* ------------------------------------------------------------------------------------ */
/* REPORTING                                                                              */
/* ------------------------------------------------------------------------------------ */

export function printResult(r: DayFileResult): void {
  const size = r.byteLen === null ? '' : ` ${r.byteLen.toLocaleString('en-US')} B`
  process.stdout.write(`  ${r.logicalDate} ${r.filename}: ${r.status}${size} - ${r.detail}\n`)
}

/** True when a result needs an operator's eye. Skips and origin-absent days do not. */
export function isFailure(r: DayFileResult): boolean {
  return !['archived', 'already_present', 'skipped_already_held', 'not_published'].includes(r.status)
}
