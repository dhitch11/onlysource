/**
 * T2 INGESTION. WHICH FEED DAYS THE ARCHIVE ACTUALLY HOLDS, AND HOW OLD THE SERVED ONE IS.
 *
 * DISCOVERED, NEVER LISTED. The hardcoded-list lesson (a loop that enumerated pages by name
 * left two new pages silently uncovered) applies with force here: a hardcoded feed day is a
 * defect with a delay on it, wrong on the first morning the capture cron lands a newer day.
 * This module reads the archive MANIFEST and reports what is really there.
 *
 * VERIFIED, NEVER TRUSTED. The manifest is a claim; the bytes are the fact. This archive
 * holds, under the SAME (day, filename) as the real 439,490-byte index, a 141-byte capture
 * of the letter X, written before the content gate existed. "Newest capture wins" would
 * serve it. So a capture only counts after its bytes re-pass the content gate: the full
 * index assertion for `in` files, the zip magic plus the manifest's recorded length for
 * zips. A capture that fails is EXCLUDED and named in `excluded`, not silently skipped.
 *
 * This module stays importable from scripts, tests and server components alike, so it
 * reads the filesystem only and carries no 'server-only' marker of its own.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { archivePath } from '../data-root'
import { civilInZone, addCivilDays } from '../time/zoned'
import { isNonBusinessDay } from '../time/federal-holidays'
import { blockingFailures } from './assert'
import { assertIndexFileContent } from './sources/dibbs-fetch'
import type { ArchiveRecord, ManifestEntry } from './archive'

/**
 * Kept in sync with lib/ingest/sources/dibbs-fetch.ts by a test that imports both, rather
 * than by an import that would drag the fetch pipeline into every consumer of this module.
 */
export const DIBBS_SOURCE_KEY = 'dibbs-rfq-daily'

export type VerifiedCapture = {
  filename: string
  storageKey: string
  /** When the bytes were retrieved from the origin. ISO UTC. */
  retrievedAt: string
  byteLen: number
  /** Which re-verification admitted it: the full index gate, or zip magic plus length. */
  verifiedBy: 'index_content_gate' | 'zip_magic_and_length'
}

export type ExcludedCapture = {
  filename: string
  storageKey: string
  reason: string
}

export type FeedDayHolding = {
  logicalDate: string
  in?: VerifiedCapture
  bq?: VerifiedCapture
  ca?: VerifiedCapture
  /**
   * TRUE when the two files the parsers are built on, the `in` index and the `bq` quoting
   * zip, are both verified present. The `ca` PDF package strengthens a day but its absence
   * does not break the board, so it does not gate completeness.
   */
  complete: boolean
}

export type FeedDayDiscovery = {
  root: string
  /** Measured: the archive directory and manifest exist. False renders an empty state. */
  present: boolean
  /** Every feed day with at least one verified capture, oldest first. */
  days: FeedDayHolding[]
  /** Captures the manifest lists that failed re-verification, named with their reason. */
  excluded: ExcludedCapture[]
}

function defaultRoot(): string {
  return process.env.INGEST_ARCHIVE_ROOT ?? archivePath()
}

function isDataRecord(entry: ManifestEntry): entry is ArchiveRecord {
  return (entry as { kind?: string }).kind !== 'rejected'
}

/** The zip local-file-header magic. Read from the file itself, never from the manifest. */
function hasZipMagic(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(4)
    const n = readSync(fd, head, 0, 4, 0)
    return n === 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
  } finally {
    closeSync(fd)
  }
}

type CacheEntry = { mtimeMs: number; size: number; value: FeedDayDiscovery }
const CACHE = new Map<string, CacheEntry>()

/**
 * Discover the feed days the archive holds, re-verifying every candidate capture.
 *
 * Memoised per manifest (mtime, size): the layout chrome calls this on every request and the
 * verification reads real files, but a manifest that has not changed cannot have changed the
 * answer. A capture landing invalidates the cache because appending to the manifest moves
 * its mtime and size.
 */
export function discoverFeedDays(root: string = defaultRoot()): FeedDayDiscovery {
  const manifest = join(root, 'MANIFEST.jsonl')
  if (!existsSync(manifest)) {
    return { root, present: false, days: [], excluded: [] }
  }
  const stat = statSync(manifest)
  const cached = CACHE.get(root)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.value
  }

  const rows = readFileSync(manifest, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as ManifestEntry)
    .filter(isDataRecord)
    .filter((r) => r.source_key === DIBBS_SOURCE_KEY)

  const excluded: ExcludedCapture[] = []

  /** Verify one manifest row against its bytes. Returns null and records why when it fails. */
  const verify = (row: ArchiveRecord): VerifiedCapture | null => {
    const filename = row.storage_key.split('/').pop() ?? row.storage_key
    const path = join(root, row.storage_key)
    if (!existsSync(path)) {
      excluded.push({ filename, storageKey: row.storage_key, reason: 'listed in the manifest but absent on disk' })
      return null
    }
    const onDisk = statSync(path).size
    if (onDisk !== row.byte_len) {
      excluded.push({
        filename,
        storageKey: row.storage_key,
        reason: `on-disk length ${onDisk} differs from the manifest's ${row.byte_len}`,
      })
      return null
    }
    if (filename.startsWith('in') && filename.endsWith('.txt')) {
      const failures = blockingFailures(assertIndexFileContent(readFileSync(path)))
      if (failures.length > 0) {
        const first = failures[0]!
        excluded.push({
          filename,
          storageKey: row.storage_key,
          reason: `failed the index content gate: ${first.id} (${first.actual})`,
        })
        return null
      }
      return {
        filename,
        storageKey: row.storage_key,
        retrievedAt: row.retrieved_at,
        byteLen: row.byte_len,
        verifiedBy: 'index_content_gate',
      }
    }
    if (filename.endsWith('.zip')) {
      if (!hasZipMagic(path)) {
        excluded.push({
          filename,
          storageKey: row.storage_key,
          reason: 'does not begin with the zip local-file-header magic',
        })
        return null
      }
      return {
        filename,
        storageKey: row.storage_key,
        retrievedAt: row.retrieved_at,
        byteLen: row.byte_len,
        verifiedBy: 'zip_magic_and_length',
      }
    }
    excluded.push({ filename, storageKey: row.storage_key, reason: 'not a recognised daily file shape' })
    return null
  }

  const byDay = new Map<string, FeedDayHolding>()
  for (const row of rows) {
    const capture = verify(row)
    if (!capture) continue
    const kind = capture.filename.startsWith('in')
      ? 'in'
      : capture.filename.startsWith('bq')
        ? 'bq'
        : capture.filename.startsWith('ca')
          ? 'ca'
          : null
    if (!kind) {
      excluded.push({
        filename: capture.filename,
        storageKey: capture.storageKey,
        reason: 'verified but not an in/bq/ca daily file',
      })
      continue
    }
    const day = byDay.get(row.logical_date) ?? { logicalDate: row.logical_date, complete: false }
    const existing = day[kind]
    // Newest VERIFIED capture wins. Verification already threw out the traps.
    if (!existing || capture.retrievedAt > existing.retrievedAt) {
      day[kind] = capture
    }
    byDay.set(row.logical_date, day)
  }

  const days = [...byDay.values()]
    .map((d) => ({ ...d, complete: Boolean(d.in && d.bq) }))
    .sort((a, b) => a.logicalDate.localeCompare(b.logicalDate))

  const value: FeedDayDiscovery = { root, present: true, days, excluded }
  CACHE.set(root, { mtimeMs: stat.mtimeMs, size: stat.size, value })
  return value
}

/** The newest day whose parser-critical files are verified present, or null. */
export function newestCompleteFeedDay(discovery: FeedDayDiscovery): FeedDayHolding | null {
  for (let i = discovery.days.length - 1; i >= 0; i--) {
    const day = discovery.days[i]!
    if (day.complete) return day
  }
  return null
}

/** Test seam. The cache keys on manifest identity, which a scratch dir reuses across tests. */
export function resetFeedDayCache(): void {
  CACHE.clear()
}

/* ------------------------------------------------------------------------------------ */
/* FRESHNESS, MEASURED IN BUSINESS DAYS                                                   */
/* ------------------------------------------------------------------------------------ */

export type FreshnessTone = 'fresh' | 'aging' | 'stale'

export type FeedFreshness = {
  feedDay: string
  /**
   * Business days from the feed day to now, in the publisher's own calendar: DLA operates
   * on US federal business days, so the count skips weekends and observed federal holidays,
   * evaluated on the Eastern civil date. A Friday feed day read on Sunday is 0 behind,
   * because no newer file can exist yet.
   */
  businessDaysBehind: number
  tone: FreshnessTone
  /** The Eastern civil date the measurement was made on. */
  measuredOn: string
}

/**
 * TONE THRESHOLDS, a judgement stated rather than smuggled: the publisher posts one file
 * set per business day, so 0 or 1 behind is the newest publishable state (`fresh`); 2 or 3
 * behind means captures are being missed while the retention window advances (`aging`);
 * more is `stale`, the state the whole capture machine exists to prevent, and at roughly 28
 * business days behind the missed days start becoming permanently unbuyable.
 */
export const FRESH_MAX_BUSINESS_DAYS = 1
export const AGING_MAX_BUSINESS_DAYS = 3

/** Cap on the walk so a corrupt far-past date cannot loop for centuries. */
const WALK_CAP_DAYS = 3660

export function measureFeedFreshness(feedDay: string, nowMs: number): FeedFreshness {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(feedDay)
  if (!m) throw new Error(`measureFeedFreshness: "${feedDay}" is not YYYY-MM-DD`)

  const today = civilInZone(nowMs, 'America/New_York')
  const p2 = (n: number) => String(n).padStart(2, '0')
  const keyOf = (d: { year: number; month: number; day: number }) =>
    `${d.year}-${p2(d.month)}-${p2(d.day)}`
  const todayKey = keyOf(today)

  let cursor = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  let businessDaysBehind = 0
  let steps = 0
  while (keyOf(cursor) < todayKey) {
    cursor = addCivilDays(cursor.year, cursor.month, cursor.day, 1)
    if (!isNonBusinessDay(cursor)) businessDaysBehind += 1
    steps += 1
    if (steps >= WALK_CAP_DAYS) break
  }

  const tone: FreshnessTone =
    businessDaysBehind <= FRESH_MAX_BUSINESS_DAYS
      ? 'fresh'
      : businessDaysBehind <= AGING_MAX_BUSINESS_DAYS
        ? 'aging'
        : 'stale'

  return { feedDay, businessDaysBehind, tone, measuredOn: todayKey }
}
