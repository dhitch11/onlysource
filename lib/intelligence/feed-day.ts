/**
 * WHICH FEED DAY THE SURFACES SERVE. DISCOVERED, PARSE-VERIFIED, NEVER HARDCODED.
 *
 * Until 2026-08-17 every surface read one pinned day (2026-08-11) through literals in
 * datasets.ts and board/build.ts, so the freshness pill honestly said "stale" while the
 * archive held twenty verified days the product never served. Holding data and not serving
 * it is the estate's named built-and-wired-but-never-fed failure mode; this module is the
 * wire.
 *
 * ---------------------------------------------------------------------------------------
 * THE CONTRACT
 * ---------------------------------------------------------------------------------------
 * 1. DISCOVERY belongs to lib/ingest/feed-days.ts (the T2 lane). A day is a candidate only
 *    if that module reports it COMPLETE (verified `in` index + verified `bq` zip) after
 *    re-checking the bytes against the manifest. This module never re-implements that gate;
 *    it consumes it.
 * 2. PARSE-VERIFICATION is this module's own gate: the candidate is only SERVED if its two
 *    parser inputs actually parse here and now — the fixed-width index yields a plausible
 *    row count and the approved-source member extracts complete from the archived zip and
 *    yields entries. "Verified at capture time" is a claim about then; serving is now.
 * 3. FALLBACK IS LOUD. If the newest complete day fails parse-verification, the next older
 *    complete day is tried, and every skipped day is carried on the result BY NAME with its
 *    reason, so the surfaces can say "serving YYYY-MM-DD; a newer day is held but not
 *    servable" instead of silently serving older data. The pill, the provenance lines and
 *    the rendered numbers all read from this one resolution, so they can never name
 *    different days.
 * 4. THE PROVENANCE CITED IS THE ARCHIVED ORIGINAL. The approved-source text is extracted
 *    from the archived `bq` zip in memory at resolve time, so the chain from rendered
 *    number to government-published byte has NO derived file in it at all. The citation is
 *    `<zip storage key>!<member name>`.
 *
 * THE ROW-COUNT FLOOR, MEASURED NOT GUESSED. The board once refused any index under 500
 * rows as "truncated or substituted", calibrated on one mid-week day. The archive now
 * proves real publish days run far lower: 2026-07-31 published 229 rows, 2026-07-17 232,
 * 2026-07-24 315, 2026-08-14 331 — all Fridays, all passing the ingest content gate, whose
 * own floor is 200 distinct solicitations. This module aligns with that ingest floor
 * (MIN_SERVABLE_INDEX_ROWS = 200): the two instruments must not disagree about what a real
 * day is. A row-boundary truncation above the floor is caught by neither and never was; the
 * content gate plus manifest byte-length re-check is the real defense.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  discoverFeedDays,
  newestCompleteFeedDay,
  type FeedDayDiscovery,
  type FeedDayHolding,
} from '@/lib/ingest/feed-days'
import { readZipMembers } from '@/lib/ingest/parse/zip'
import type { ArchiveRecord, ManifestEntry } from '@/lib/ingest/archive'
import {
  parseApprovedSourceText,
  parseDailyIndexText,
  type ApprovedSourceIndex,
  type DailyIndex,
} from './seed/feed'

/**
 * Aligned with the ingest content gate's own floor (>= 200 distinct SPE solicitations,
 * lib/ingest/sources/dibbs-fetch.ts). Measured minimum real day in the 20-day archive:
 * 229 rows (Friday 2026-07-31). A file below this is refused and the previous day served.
 */
export const MIN_SERVABLE_INDEX_ROWS = 200

export type SkippedFeedDay = { feedDay: string; reason: string }

export type ServedFeedDay = {
  feedDay: string
  /** Parsed once here so every consumer renders from the same read of the same bytes. */
  index: DailyIndex
  approved: ApprovedSourceIndex
  /** Absolute path of the verified index capture, for provenance display. */
  indexPath: string
  indexStorageKey: string
  /** The archived zip the approved-source member was extracted from. The cited original. */
  archive: {
    storageKey: string
    /** From the manifest row for this capture; the bytes were re-verified against it. */
    sha256: string | null
    byteLength: number
    sourceUrl: string | null
    retrievedAt: string
    retrievedAtBasis: string | null
    /** The member inside the zip the approved-source index was parsed from. */
    member: string
  }
  /** How many feed days the archive verifiably holds (complete or not). */
  daysHeld: number
  /**
   * Newer COMPLETE days that failed parse-verification, newest first, each with its
   * reason. Empty means the newest complete day is being served. Rendered, never hidden.
   */
  skipped: SkippedFeedDay[]
}

export type FeedDayResolution =
  | { ok: true; served: ServedFeedDay }
  | { ok: false; reason: string; skipped: SkippedFeedDay[] }

/**
 * Memoised per discovery result. discoverFeedDays() returns the SAME object while the
 * manifest is unchanged (it caches on manifest mtime+size), so keying a WeakMap on that
 * object gives exact invalidation: a new capture landing produces a new discovery object
 * and therefore a fresh resolution, with no clock or TTL involved.
 */
const RESOLUTION_CACHE = new WeakMap<FeedDayDiscovery, FeedDayResolution>()

export function resolveServedFeedDay(root?: string): FeedDayResolution {
  const discovery = root == null ? discoverFeedDays() : discoverFeedDays(root)
  const cached = RESOLUTION_CACHE.get(discovery)
  if (cached) return cached
  const resolved = resolveFrom(discovery)
  RESOLUTION_CACHE.set(discovery, resolved)
  return resolved
}

/**
 * Resolve one NAMED day through the identical verification, for tests that pin measured
 * values to an immutable archived day, and for any future day-switching surface. Returns
 * ok:false rather than throwing when the day is absent or unservable.
 */
export function resolveFeedDayInputs(feedDay: string, root?: string): FeedDayResolution {
  const discovery = root == null ? discoverFeedDays() : discoverFeedDays(root)
  if (!discovery.present) {
    return { ok: false, reason: 'the archive manifest is absent in this environment', skipped: [] }
  }
  const day = discovery.days.find((d) => d.logicalDate === feedDay)
  if (!day) {
    return { ok: false, reason: `the archive holds no verified captures for ${feedDay}`, skipped: [] }
  }
  if (!day.complete) {
    return {
      ok: false,
      reason: `${feedDay} is incomplete in the archive: the day needs both a verified index and a verified quoting zip to be servable`,
      skipped: [],
    }
  }
  const outcome = tryServeDay(discovery, day)
  if ('reason' in outcome) return { ok: false, reason: outcome.reason, skipped: [] }
  return { ok: true, served: { ...outcome.served, skipped: [] } }
}

function resolveFrom(discovery: FeedDayDiscovery): FeedDayResolution {
  if (!discovery.present) {
    return {
      ok: false,
      reason: 'the archive manifest is absent in this environment, so no feed day can be served',
      skipped: [],
    }
  }
  const newest = newestCompleteFeedDay(discovery)
  if (!newest) {
    return {
      ok: false,
      reason:
        'the archive holds no COMPLETE feed day: no day has both a verified index and a verified quoting zip',
      skipped: [],
    }
  }

  const skipped: SkippedFeedDay[] = []
  for (let i = discovery.days.length - 1; i >= 0; i--) {
    const day = discovery.days[i]!
    if (!day.complete) continue
    const outcome = tryServeDay(discovery, day)
    if ('reason' in outcome) {
      skipped.push({ feedDay: day.logicalDate, reason: outcome.reason })
      continue
    }
    return { ok: true, served: { ...outcome.served, skipped } }
  }
  return {
    ok: false,
    reason: 'every complete feed day in the archive failed parse-verification',
    skipped,
  }
}

function tryServeDay(
  discovery: FeedDayDiscovery,
  day: FeedDayHolding,
): { served: Omit<ServedFeedDay, 'skipped'> } | { reason: string } {
  // `complete` guarantees both captures; the checks keep the type honest.
  if (!day.in || !day.bq) return { reason: 'marked complete but missing a capture record' }

  const indexPath = join(discovery.root, day.in.storageKey)
  let index: DailyIndex
  try {
    index = parseDailyIndexText(readFileSync(indexPath, 'utf8'))
  } catch (e) {
    return { reason: `the index capture could not be read: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (index.rows.length < MIN_SERVABLE_INDEX_ROWS) {
    return {
      reason: `the index parses to ${index.rows.length} rows, below the ${MIN_SERVABLE_INDEX_ROWS}-row servable floor (measured real-day minimum in this archive: 229)`,
    }
  }
  if (index.offWidthRows >= index.rows.length) {
    return { reason: 'every index line failed the published 140-character width, so this is not the fixed-width index' }
  }

  const zipPath = join(discovery.root, day.bq.storageKey)
  let approved: ApprovedSourceIndex
  let memberName: string
  try {
    const zip = readZipMembers(readFileSync(zipPath))
    const member = zip.members.find((m) => /^as\d{6}\.txt$/i.test(m.name))
    if (!member) {
      return { reason: `the quoting zip carries no approved-source member (as*.txt); members: ${zip.members.map((m) => m.name).join(', ') || 'none readable'}` }
    }
    if (!member.complete) {
      return { reason: `the approved-source member ${member.name} is cut off mid-stream inside the archived zip` }
    }
    memberName = member.name
    approved = parseApprovedSourceText(member.data.toString('utf8'))
  } catch (e) {
    return { reason: `the quoting zip could not be read: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (approved.entries.length === 0) {
    return { reason: 'the approved-source member parsed to zero entries, so no source standing could be joined' }
  }

  const manifestRow = manifestRowFor(discovery.root, day.bq.storageKey)

  return {
    served: {
      feedDay: day.logicalDate,
      index,
      approved,
      indexPath,
      indexStorageKey: day.in.storageKey,
      archive: {
        storageKey: day.bq.storageKey,
        sha256: manifestRow?.content_sha256 ?? null,
        byteLength: day.bq.byteLen,
        sourceUrl: manifestRow?.source_url ?? null,
        retrievedAt: day.bq.retrievedAt,
        retrievedAtBasis: manifestRow?.retrieved_at_basis ?? null,
        member: memberName,
      },
      daysHeld: discovery.days.length,
    },
  }
}

/**
 * The manifest row for a storage key, read directly so the citation can carry the recorded
 * hash and source URL. Read-only over T2's file; the parse mirrors lib/ingest/feed-days.
 */
function manifestRowFor(root: string, storageKey: string): ArchiveRecord | null {
  try {
    const rows = readFileSync(join(root, 'MANIFEST.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as ManifestEntry)
    for (const row of rows) {
      if ((row as { kind?: string }).kind === 'rejected') continue
      const record = row as ArchiveRecord
      if (record.storage_key === storageKey) return record
    }
    return null
  } catch {
    return null
  }
}
