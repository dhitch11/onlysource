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

import { BOARD_QUERY, PG_DIR, PG_PASSWORD, PG_PORT, PG_USER, client } from '../../lib/ingest/db'

let server: EmbeddedPostgres
let c: pg.Client

beforeAll(async () => {
  server = new EmbeddedPostgres({
    databaseDir: PG_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
    onLog: () => {},
    onError: () => {},
  })
  await server.start()
  c = client()
  await c.connect()
}, 60_000)

afterAll(async () => {
  await c.end()
  await server.stop()
}, 30_000)

describe('the Board query manufactures no absences', () => {
  it('reports ZERO requirements that show no supplier while a supplier exists', async () => {
    const result = await c.query<{ n: string }>(`
      SELECT count(*)::text AS n
      FROM (${BOARD_QUERY}) b
      WHERE COALESCE(b.approved_source_count, 0) = 0
        AND EXISTS (SELECT 1 FROM approved_source a WHERE a.nsn_raw = b.nsn_raw)
    `)
    // THE ASSERTION THAT MATTERS. Any number above zero is a monopoly signal we invented.
    expect(Number(result.rows[0]?.n)).toBe(0)
  }, 30_000)

  it('carries the real suppliers for locally assigned stock numbers', async () => {
    const result = await c.query<{ nsn_raw: string; approved_source_count: string }>(`
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
    const result = await c.query<{ n: string }>(`
      SELECT count(*)::text AS n
      FROM (${BOARD_QUERY}) b
      WHERE COALESCE(b.approved_source_count, 0) = 0
    `)
    // 551 requirements genuinely have no approved source in that day's file. That is
    // "insufficient", not "zero suppliers", and it must remain visible.
    expect(Number(result.rows[0]?.n)).toBeGreaterThan(500)
  }, 30_000)

  it('still returns exactly one row per published requirement line, with no fan-out', async () => {
    const result = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${BOARD_QUERY}) b`)
    // The join change must not reintroduce the CLIN fan-out that would inflate 3,095 to ~3,169.
    expect(Number(result.rows[0]?.n)).toBe(3095)
  }, 30_000)
})
