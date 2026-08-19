/**
 * THE SOURCE OF ROWS THE QUOTE WRITER NEVER HAD.
 *
 * ==========================================================================================
 * WHY THIS FILE EXISTS.
 * ==========================================================================================
 * `lib/filing` writes the 121-column DIBBS batch quote file, validates it against DLA's silent
 * traps, and chunks it to the 75-line limit. It is finished, it is tested, and until now it
 * reached nobody, for one reason that had nothing to do with the writer: **nothing produced its
 * input.** `applyVendorQuote` takes DLA's own pre-filled 121-field row, and no module turned the
 * archived quoting zip into those rows. The door was built and it opened onto nothing.
 *
 * The bytes were always there. Every archived feed day carries a `bq<yymmdd>.zip` holding two
 * members: `as<yymmdd>.txt`, the approved-source list, which the feed-day resolver already reads
 * and every surface already renders; and `bq<yymmdd>.txt`, the 121-column quote file, which
 * nothing had ever opened. Measured on 2026-08-14: 163,033 bytes, and its first record is
 * `SPE1C126Q0426` carrying `BI` in column 24, exactly the pre-filled bid type `applyVendorQuote`
 * is written to preserve.
 *
 * ==========================================================================================
 * FOUR PROPERTIES THIS MODULE HOLDS, EACH BECAUSE OF SOMETHING THAT WENT WRONG ON THIS ESTATE.
 * ==========================================================================================
 *
 *  1. IT READS THE ARCHIVED ORIGINAL, NEVER A DERIVED FILE. The same zip, resolved by the same
 *     `resolveServedFeedDay` every other surface reads, so a quote can never be filed against a
 *     different day than the board displayed. A second read of the same day from a second path
 *     is how two surfaces come to disagree about what the government published.
 *
 *  2. A ROW OF THE WRONG WIDTH IS REPORTED, NEVER REPAIRED AND NEVER DROPPED SILENTLY. A
 *     121-field format where a record arrives with 120 fields means every column after the gap
 *     is misread, and a quote filed off a misread row is a real bid at a wrong price on a wrong
 *     part. Off-width records are counted and named, and they never enter the returned set.
 *
 *  3. IT COMPUTES NO PRICE AND IMPORTS NO PRICING. Consistent with the rest of `lib/filing`:
 *     the vendor's figures arrive as already-decided strings. This module only supplies the
 *     government's own row. It cannot originate a number.
 *
 *  4. IT OPENS NO NETWORK CONNECTION. `test/filing/no-network.test.ts` scans every source file
 *     in this namespace for a network primitive, and this file must keep passing it. Reading a
 *     local archived zip is a filesystem read; filing a quote to DLA remains a thing a person
 *     does, deliberately, elsewhere.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readZipMembers } from '@/lib/ingest/parse/zip'
import { parseCsvByLine } from '@/lib/ingest/parse/csv'
import { resolveDataRoot } from '@/lib/data-root'
import { discoverFeedDays } from '@/lib/ingest/feed-days'
import { resolveServedFeedDay } from '@/lib/intelligence/feed-day'
import { COL, FIELD_COUNT, field, isWellFormedRow, type SourceQuoteRow } from './format'
import { rowKey } from './quote'

export type QuoteSourceRows = {
  ok: true
  /** The feed day these rows were published on. The quote is filed against THIS day. */
  feedDay: string
  /** The zip member the rows came from, for the provenance line. */
  member: string
  /** Storage key of the archived zip, so a filed quote can cite the bytes it was built from. */
  storageKey: string
  /** Well-formed 121-field rows, in published order. */
  rows: SourceQuoteRow[]
  /** Rows keyed by `<solicitation>::<CLIN>` — the natural key, never the solicitation alone. */
  byKey: Map<string, SourceQuoteRow>
  /** Every CLIN published for a solicitation number. A solicitation can carry more than one. */
  bySolicitation: Map<string, SourceQuoteRow[]>
  /**
   * Records the file carried that were NOT 121 fields wide. Reported so the operator sees that
   * the day was partially unreadable rather than believing the shortfall is what DLA published.
   */
  offWidth: Array<{ line: number; fields: number }>
}

export type QuoteSourceUnavailable = {
  ok: false
  /** Named in the operator's terms, with what was tried, so this is actionable. */
  reason: string
}

export type QuoteSource = QuoteSourceRows | QuoteSourceUnavailable

/** Keyed on the archived zip, so a new capture is a new read and a re-read is free. */
const cache = new Map<string, QuoteSourceRows>()

/**
 * Read the served feed day's 121-column quote file into filing-ready rows.
 *
 * Returns an honest unavailable rather than throwing or returning an empty set: "no archive is
 * servable" and "the day published no quotable lines" are different facts, and a page that
 * cannot tell them apart shows the operator an empty table for two opposite reasons.
 */
export function quoteSourceRows(): QuoteSource {
  const root = resolveDataRoot()
  if (!root.present) {
    return { ok: false, reason: 'No data root is mounted, so no archived quoting file can be read.' }
  }

  const resolution = resolveServedFeedDay()
  if (!resolution.ok) {
    return {
      ok: false,
      reason:
        `No archived feed day can be served right now: ${resolution.reason}. ` +
        'A quote is filed against a published day, and nothing has been assumed in its place.',
    }
  }

  const served = resolution.served
  const key = served.archive.storageKey
  const hit = cache.get(key)
  if (hit) return hit

  /*
   * THE STORAGE KEY IS RELATIVE TO THE ARCHIVE ROOT, NOT THE DATA ROOT. Measured: a manifest row
   * reads `dibbs-rfq-daily/2026-08-11/.../in260811.txt`, and the archive lives at `data/archive`.
   * Joining it to the data root silently addresses a path that does not exist. `discoverFeedDays`
   * is the same resolution `feed-day.ts` joins against, so this module and the resolver cannot
   * disagree about where the bytes are.
   */
  const archiveRoot = discoverFeedDays().root
  let members
  try {
    members = readZipMembers(readFileSync(join(archiveRoot, key)))
  } catch (e) {
    return {
      ok: false,
      reason: `The archived quoting zip for ${served.feedDay} could not be read: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  /*
   * The quote member is `bq<yymmdd>.txt`, beside the `as<yymmdd>.txt` the resolver already reads.
   * Matched by shape rather than by an assembled filename: the day's stem is derivable, but a
   * pattern that cannot be wrong about a naming convention is better than one that can, and the
   * miss is reported with the member list rather than as an empty file.
   */
  const member = members.members.find((m) => /^bq\d{6}\.txt$/i.test(m.name))
  if (!member) {
    return {
      ok: false,
      reason:
        `The archived zip for ${served.feedDay} carries no quote member (bq*.txt). ` +
        `Members present: ${members.members.map((m) => m.name).join(', ') || 'none readable'}.`,
    }
  }
  if (!member.complete) {
    return {
      ok: false,
      reason: `The quote member ${member.name} is cut off mid-stream inside the archived zip, so its rows cannot be trusted.`,
    }
  }

  const parsed = parseCsvByLine(member.data.toString('utf8'))
  const rows: SourceQuoteRow[] = []
  const offWidth: Array<{ line: number; fields: number }> = []

  for (const record of parsed.records) {
    // Width is read BEFORE the guard: `isWellFormedRow` narrows its argument, so inside the
    // negative branch the compiler no longer believes the value has a length to report.
    const width = record.fields.length
    if (!isWellFormedRow(record.fields)) {
      // NOT repaired and NOT padded. A misread column in a 121-field format is a wrong price on
      // a wrong part, and this is the layer that still knows the record was short.
      offWidth.push({ line: record.startLine, fields: width })
      continue
    }
    rows.push(record.fields)
  }

  const byKey = new Map<string, SourceQuoteRow>()
  const bySolicitation = new Map<string, SourceQuoteRow[]>()
  for (const row of rows) {
    byKey.set(rowKey(row), row)
    const sol = field(row, COL.SOLICITATION_NUMBER)
    const list = bySolicitation.get(sol) ?? []
    list.push(row)
    bySolicitation.set(sol, list)
  }

  const built: QuoteSourceRows = {
    ok: true,
    feedDay: served.feedDay,
    member: member.name,
    storageKey: key,
    rows,
    byKey,
    bySolicitation,
    offWidth,
  }
  cache.set(key, built)
  return built
}

/**
 * The rows for one solicitation number, or an empty array.
 *
 * ★ AN EMPTY ARRAY HERE IS NOT "NOT QUOTABLE". The daily quote file lists the lines DLA opened
 * for quoting on that day; a solicitation absent from it may be open on a day we do not hold, or
 * may not be batch-quotable at all. The caller must render that distinction rather than showing
 * a bare "0", which is the silent-zero this estate has already shipped twice.
 */
export function quoteRowsForSolicitation(solicitation: string): SourceQuoteRow[] {
  const source = quoteSourceRows()
  if (!source.ok) return []
  return source.bySolicitation.get(solicitation.trim().toUpperCase()) ?? []
}

/** How wide the format is, re-exported so a caller need not import two modules to check a row. */
export { FIELD_COUNT }
