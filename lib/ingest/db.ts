/**
 * T2 INGESTION. The database handle and THE BOARD QUERY.
 *
 * Postgres runs on the box (hosting decision: one always-on Linux server, static IP, no
 * serverless ceiling). Locally that is an embedded Postgres cluster with a persistent data
 * directory next to the raw archive, which is a real Postgres server and real SQL, not a
 * stub, a mock or an in-memory imitation.
 */

import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const DATA_ROOT = process.env.ONLYSOURCE_DATA_ROOT ?? '/Users/user/onlysource-data'
export const ARCHIVE_ROOT = process.env.INGEST_ARCHIVE_ROOT ?? join(DATA_ROOT, 'archive')
export const PG_DIR = process.env.ONLYSOURCE_PG_DIR ?? join(DATA_ROOT, 'pg')
export const PG_PORT = Number(process.env.ONLYSOURCE_PG_PORT ?? 55432)
export const PG_HOST = process.env.ONLYSOURCE_PG_HOST ?? 'localhost'
export const PG_USER = 'onlysource'
export const PG_PASSWORD = process.env.ONLYSOURCE_PG_PASSWORD ?? 'onlysource-local-dev'
export const PG_DATABASE = 'onlysource'

/** Connect to the running cluster. Callers own the lifecycle. */
export function client(database = PG_DATABASE): pg.Client {
  return new pg.Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database,
  })
}

/** Apply the Zone B schema. Idempotent: every statement is CREATE ... IF NOT EXISTS or guarded. */
export async function applySchema(c: pg.Client): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url))
  const sql = await readFile(join(here, 'schema.sql'), 'utf8')
  // The enum types have no IF NOT EXISTS, so a re-run must tolerate them already existing.
  for (const statement of splitSql(sql)) {
    try {
      await c.query(statement)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/already exists/i.test(message)) continue
      throw new Error(`schema statement failed: ${message}\n--- statement ---\n${statement.slice(0, 300)}`)
    }
  }
}

/**
 * Split on semicolons that end a statement, respecting dollar-quoted function bodies.
 * The run_ledger immutability trigger is a `$$ ... $$` block and a naive split destroys it.
 */
function splitSql(sql: string): string[] {
  const out: string[] = []
  let current = ''
  let inDollar = false
  const lines = sql.split('\n')
  for (const line of lines) {
    if (line.trim().startsWith('--') && current.trim() === '') continue
    const dollarCount = (line.match(/\$\$/g) ?? []).length
    if (dollarCount % 2 === 1) inDollar = !inDollar
    current += line + '\n'
    if (!inDollar && line.trimEnd().endsWith(';')) {
      if (current.trim() !== '') out.push(current.trim())
      current = ''
    }
  }
  if (current.trim() !== '') out.push(current.trim())
  return out
}

/**
 * THE BOARD QUERY. One query, one row per government requirement line.
 *
 * WHAT IS REAL HERE AND WHAT IS HONESTLY ABSENT
 *
 * Real, from the free daily feed: the stock number, the item, the quantity, the unit of
 * issue, the return-by date, the purchase request, the confirmed delivery-days commitment,
 * the auto-award path flag, the restricted/unrestricted binary, and the approved sources.
 *
 * NOT in this query, because the free feed does not carry them and inventing them would be a
 * house-law-1 violation: the score and modeled lift (T3 computes those), the evaluated or
 * OEM-anchor price (needs award history), the corner flag (T4's monopoly map), and surplus
 * availability (needs ILS, which is not connected). Those columns render as their honest
 * named state until their source is wired. A zero would be a lie; an empty state is true.
 *
 * THE JOIN IS MEASURED, NOT ASSUMED. The index file and the quoting file key differently, so
 * the quoting file is collapsed to one row per (solicitation, nsn, pr) BEFORE the join.
 * Measured on real feed day 2026-08-11: all 3,095 index rows match a quoting key, but 62 of
 * them fan out to more than one CLIN. Joining without collapsing first would render roughly
 * 3,169 rows for a day on which the government published 3,095 requirement lines.
 *
 * MIN(delivery_days_ado) is LOSSLESS, and that was measured too: across all 67 multi-CLIN
 * keys, delivery days never differ between CLINs (0 of 67). Quantity DOES differ (57 of 67),
 * which is why quantity is taken from the index file, never aggregated from the quoting file.
 */
export const BOARD_QUERY = `
SELECT
  r.solicitation_number,
  r.nsn_raw,
  r.niin,
  r.fsc,
  r.nomenclature,
  r.quantity,
  r.unit_of_issue,
  r.return_by,
  r.pr_number,
  r.solicitation_pdf_name,
  r.auto_award_eligible,
  r.set_aside_restricted,
  r.set_aside_code,
  q.delivery_days_ado,
  q.clin_count,
  s.approved_source_count,
  s.approved_cages,
  r.observed_at,
  r.source_key,
  r.storage_key
FROM requirement r
LEFT JOIN (
  -- Collapse the quoting file to the requirement grain FIRST. See the note above.
  SELECT
    solicitation_number,
    nsn_raw,
    pr_number,
    MIN(delivery_days_ado) AS delivery_days_ado,
    COUNT(*)               AS clin_count
  FROM quote_line
  GROUP BY solicitation_number, nsn_raw, pr_number
) q
  ON  q.solicitation_number = r.solicitation_number
  AND q.nsn_raw             = r.nsn_raw
  AND q.pr_number           = r.pr_number
LEFT JOIN (
  SELECT niin,
         COUNT(DISTINCT cage)                      AS approved_source_count,
         array_agg(DISTINCT cage ORDER BY cage)    AS approved_cages
  FROM approved_source
  GROUP BY niin
) s ON s.niin = r.niin
WHERE r.observed_at = (SELECT MAX(observed_at) FROM requirement)
ORDER BY r.return_by NULLS LAST, r.solicitation_number, r.nsn_raw, r.pr_number
`

/** The freshness contract every other lane reads instead of asking this lane. */
export const FRESHNESS_QUERY = `
SELECT
  sr.source_key,
  sr.publisher_unit,
  l.logical_date,
  l.finished_at        AS last_load_finished_at,
  l.status,
  l.failure_kind,
  l.rows_loaded,
  l.rows_quarantined,
  l.assertions,
  (SELECT COUNT(*) FROM quarantine q
    WHERE q.source_key = sr.source_key AND q.state = 'held') AS quarantine_held
FROM source_registry sr
LEFT JOIN LATERAL (
  SELECT * FROM run_ledger rl
  WHERE rl.source_key = sr.source_key AND rl.finished_at IS NOT NULL
  ORDER BY rl.finished_at DESC LIMIT 1
) l ON true
ORDER BY sr.source_key
`
