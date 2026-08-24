/**
 * T2 INGESTION. The Board query must never manufacture an absence.
 *
 * A FALSE ABSENCE IS THE MOST DANGEROUS SHAPE OF MISSING DATA, because it reads as a finding
 * rather than as a gap. "No approved source on file" is not a blank in this product: it is the
 * raw material of a sole-source corner. An absence we manufactured becomes a monopoly
 * candidate somebody quotes against.
 *
 * MEASURED, ON THE REAL DAY. 9 requirements and 14 approved-source rows carry LOCALLY ASSIGNED
 * stock numbers (1560LN0032666, 1560LLNC00755, 5306LN0035726) which are not 13 digits and
 * therefore have no NIIN. Joined on NIIN alone they can never match anything, so 8 requirements
 * rendered "no approved source" while actually having up to FIVE approved suppliers.
 *
 * The fix keeps NIIN as the key wherever it exists, because the supply class can change while
 * the item does not, and falls back to the raw stock number only where the government issued
 * no NIIN at all.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import EmbeddedPostgres from 'embedded-postgres'
import type pg from 'pg'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { BOARD_QUERY, PG_DIR, PG_PASSWORD, PG_PORT, PG_USER, client } from '../../lib/ingest/db'

/**
 * ==========================================================================================
 * WHY THIS FILE SPENT A NIGHT FAILING FOR A REASON NOBODY COULD READ. Fixed 2026-08-24.
 * ==========================================================================================
 * It failed with a 60s `beforeAll` timeout and the literal string "Unknown Error: undefined",
 * followed by `Cannot read properties of undefined (reading 'end')` from `afterAll`. Three
 * separate hypotheses were spent on that, including ARM64 Postgres, before anyone measured.
 *
 * NONE OF THEM WERE IT. The binaries are fine: `postgres --version` reports PostgreSQL 17.5 on
 * aarch64 and the cluster starts in under a second. The real cause was a PATH:
 *
 *     lib/ingest/db.ts   DATA_ROOT = process.env.ONLYSOURCE_DATA_ROOT ?? '/Users/user/onlysource-data'
 *                        PG_DIR    = process.env.ONLYSOURCE_PG_DIR   ?? join(DATA_ROOT, 'pg')
 *
 * `PG_DIR` does NOT resolve through `lib/data-root.ts`, so it has none of the `<cwd>/data`
 * fallback the rest of the product relies on. With no environment set it points at a macOS
 * path, and on any other machine the cluster is simply somewhere else.
 *
 * ★ AND THE ERROR THAT WOULD HAVE SAID SO WAS BEING DISCARDED. `onError: () => {}` swallowed
 * whatever Postgres actually reported, so an absent path presented as a mysterious hang. That
 * is the estate's own dominant defect class, AN ABSENCE PRESENTING AS A WRONG ANSWER, occurring
 * inside the suite that exists to catch it.
 *
 * ==========================================================================================
 * SO THIS FILE NOW FAILS, OR SKIPS, FOR A READABLE REASON, AND NAMES THE CURE
 * ==========================================================================================
 * A blind skip would have hidden this exactly as well as the swallowed error did. A skip
 * without its cure is the same defect wearing a friendlier face. So the note carries the path
 * that was actually resolved and the variable that changes it, and anyone who reads a skip line
 * can act on it in one command.
 *
 * ⛔ AND THE TESTS BELOW ARE NOT APPROXIMATE. Measured 2026-08-24 against the real cluster:
 * 3,095 `requirement` rows, 3,683 `approved_source` rows, and `1560LN0032666` carrying exactly
 * 5 approved suppliers. Every assertion in this file passes against it. **If this suite is
 * skipping on a machine that has the data, that is a configuration bug to fix, not a state to
 * accept**, because these eight assertions cover a real government day.
 */

/**
 * Is there a cluster to start, and where did we look?
 *
 * Probes `PG_VERSION`, a FILE, exactly as `test/support/corpus.ts` probes a file rather than a
 * directory and for the same reason: an empty directory exists on more machines than a populated
 * one, and a directory check calls a stray `mkdir` or a half-finished copy "present".
 */
const PG_PRESENT = existsSync(join(PG_DIR, 'PG_VERSION'))

/** Suffix for the suite name, so the run output says WHY and what to do about it. */
const PG_NOTE = PG_PRESENT
  ? ''
  : ` [SKIPPED: no ingest cluster at ${PG_DIR} — set ONLYSOURCE_PG_DIR, or ONLYSOURCE_DATA_ROOT to the directory holding pg/]`

/** Whatever Postgres actually said, captured so it can be attached to the throw. */

/*
 * ★ AND THE NOTE IS PRINTED, NOT JUST ATTACHED TO A SUITE NAME.
 *
 * MEASURED: a suite-name suffix (the `CORPUS_NOTE` idiom in `test/support/corpus.ts`) is only
 * rendered by `--reporter=verbose`. On a default run the skip is a bare down-arrow and the cure
 * is invisible, which is the same silence this file was written to end. So it also goes to
 * stderr once, at module load, where every reporter shows it.
 */
if (!PG_PRESENT) {
  // eslint-disable-next-line no-console
  console.warn(
    `\n  [t2-ingest] SKIPPING the ingest-database suites: no cluster at ${PG_DIR}\n` +
      `             This machine has the tests but not the database. They are not broken.\n` +
      `             Point ONLYSOURCE_PG_DIR at an initialised cluster (a directory holding PG_VERSION),\n` +
      `             or ONLYSOURCE_DATA_ROOT at the directory that holds pg/, and they will run.\n`,
  )
}

let startupError: string | null = null
let server: EmbeddedPostgres | null = null
let c: pg.Client | null = null

beforeAll(async () => {
  if (!PG_PRESENT) return
  server = new EmbeddedPostgres({
    databaseDir: PG_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
    onLog: () => {},
    /*
     * SURFACE IT, NEVER SWALLOW IT. This was `() => {}`, which is why a wrong path read as a
     * hang. The message is captured rather than logged so it can be attached to the throw
     * below: an error printed into a 60-second timeout scrolls past unread.
     */
    onError: (error: unknown) => {
      startupError = error instanceof Error ? error.message : String(error)
    },
  })
  try {
    await server.start()
    c = client()
    await c.connect()
  } catch (error) {
    const why = startupError ?? (error instanceof Error ? error.message : String(error))
    server = null
    c = null
    throw new Error(
      `the ingest cluster at ${PG_DIR} exists but would not start or accept a connection: ${why}. ` +
        `Set ONLYSOURCE_PG_DIR to a working cluster, or ONLYSOURCE_DATA_ROOT to the directory holding pg/.`,
    )
  }
}, 60_000)

/**
 * TEARDOWN MUST NOT EXPLODE BECAUSE SETUP DID. Both handles were declared un-assignable-checked
 * and `await c.end()` threw "Cannot read properties of undefined", turning one clear failure
 * into two confusing ones and burying the first.
 */
afterAll(async () => {
  if (c) await c.end().catch(() => {})
  if (server) await server.stop().catch(() => {})
  c = null
  server = null
}, 30_000)

/** Non-null accessor, so a skipped suite can never dereference a client it never opened. */
const db = (): pg.Client => {
  if (!c) throw new Error('the ingest client was never opened; this suite should have skipped')
  return c
}

describe.skipIf(!PG_PRESENT)(`the Board query manufactures no absences${PG_NOTE}`, () => {
  it('reports ZERO requirements that show no supplier while a supplier exists', async () => {
    const result = await db().query<{ n: string }>(`
      SELECT count(*)::text AS n
      FROM (${BOARD_QUERY}) b
      WHERE COALESCE(b.approved_source_count, 0) = 0
        AND EXISTS (SELECT 1 FROM approved_source a WHERE a.nsn_raw = b.nsn_raw)
    `)
    // THE ASSERTION THAT MATTERS. Any number above zero is a monopoly signal we invented.
    expect(Number(result.rows[0]?.n)).toBe(0)
  }, 30_000)

  it('carries the real suppliers for locally assigned stock numbers', async () => {
    const result = await db().query<{ nsn_raw: string; approved_source_count: string }>(`
      SELECT nsn_raw, approved_source_count::text
      FROM (${BOARD_QUERY}) b
      WHERE b.niin IS NULL AND b.approved_source_count > 0
      ORDER BY b.approved_source_count DESC
    `)
    expect(result.rows.length).toBeGreaterThanOrEqual(8)

    // This one would have read as a sole-source corner. It has five approved suppliers.
    const worstCase = result.rows.find((r) => r.nsn_raw === '1560LN0032666')
    expect(Number(worstCase?.approved_source_count)).toBe(5)
  }, 30_000)

  it('a genuine absence is still reported as an absence, so the fix did not just hide the state', async () => {
    const result = await db().query<{ n: string }>(`
      SELECT count(*)::text AS n
      FROM (${BOARD_QUERY}) b
      WHERE COALESCE(b.approved_source_count, 0) = 0
    `)
    // 551 requirements genuinely have no approved source in that day's file. That is
    // "insufficient", not "zero suppliers", and it must remain visible.
    expect(Number(result.rows[0]?.n)).toBeGreaterThan(500)
  }, 30_000)

  it('still returns exactly one row per published requirement line, with no fan-out', async () => {
    const result = await db().query<{ n: string }>(`SELECT count(*)::text AS n FROM (${BOARD_QUERY}) b`)
    // The join change must not reintroduce the CLIN fan-out that would inflate 3,095 to ~3,169.
    expect(Number(result.rows[0]?.n)).toBe(3095)
  }, 30_000)
})
