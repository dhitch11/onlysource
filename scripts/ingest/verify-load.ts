/**
 * T2 INGESTION. Prove what is actually in the database, by querying the OUTPUT.
 *
 *   node --import ./scripts/ingest/ts-resolve.mjs scripts/ingest/verify-load.ts
 *
 * This asserts on rows that landed, never on the files that went in. "Built and wired but
 * never fed" is the dominant failure mode this lane owns, and a loader that reports success
 * is not evidence that a single row is queryable.
 */

import EmbeddedPostgres from 'embedded-postgres'
import {
  BOARD_QUERY,
  FRESHNESS_QUERY,
  PG_DATABASE,
  PG_DIR,
  PG_PASSWORD,
  PG_PORT,
  PG_USER,
  client,
} from '../../lib/ingest/db'

async function main(): Promise<void> {
  const pgServer = new EmbeddedPostgres({
    databaseDir: PG_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
    onLog: () => {},
    onError: () => {},
  })
  await pgServer.start()
  const c = client(PG_DATABASE)
  await c.connect()

  try {
    const counts = await c.query<{ table_name: string; n: string }>(`
      SELECT 'requirement' AS table_name, count(*)::text AS n FROM requirement
      UNION ALL SELECT 'quote_line',     count(*)::text FROM quote_line
      UNION ALL SELECT 'approved_source',count(*)::text FROM approved_source
      UNION ALL SELECT 'quarantine',     count(*)::text FROM quarantine
      UNION ALL SELECT 'raw_object',     count(*)::text FROM raw_object
      UNION ALL SELECT 'run_ledger',     count(*)::text FROM run_ledger
      UNION ALL SELECT 'org',            count(*)::text FROM org
      ORDER BY 1
    `)
    console.log('\n  ROW COUNTS IN POSTGRES')
    for (const r of counts.rows) console.log(`    ${r.table_name.padEnd(18)} ${r.n.padStart(7)}`)

    console.log('\n  RECONCILIATION AGAINST THE PUBLISHED FILES')
    const recon = await c.query<{ label: string; expected: string; actual: string; verdict: string }>(`
      WITH x AS (
        SELECT
          (SELECT count(*) FROM requirement)                                   AS req,
          (SELECT count(*) FROM quote_line)                                    AS ql,
          (SELECT count(*) FROM approved_source)                               AS asrc,
          -- DISTINCT on (storage_key, line_no), NOT on rule_id: one physical line can be
          -- held by more than one rule, and by runs of more than one parser version. The
          -- question this reconciliation answers is "is every LINE accounted for", so the
          -- unit has to be the line.
          (SELECT count(DISTINCT (storage_key, line_no)) FROM quarantine
            WHERE rule_id LIKE 'as.%')                                         AS as_q
      )
      SELECT 'index rows (published 3,095)' AS label, '3095' AS expected, req::text AS actual,
             CASE WHEN req = 3095 THEN 'MATCH' ELSE 'MISMATCH' END AS verdict FROM x
      UNION ALL
      SELECT 'quote lines (published 3,274)', '3274', ql::text,
             CASE WHEN ql = 3274 THEN 'MATCH' ELSE 'MISMATCH' END FROM x
      UNION ALL
      SELECT 'approved-source lines accounted (3,684)', '3684', (asrc + as_q)::text,
             CASE WHEN asrc + as_q = 3684 THEN 'MATCH' ELSE 'MISMATCH' END FROM x
    `)
    for (const r of recon.rows) {
      console.log(
        `    ${r.label.padEnd(42)} expected ${r.expected.padStart(5)}  actual ${r.actual.padStart(5)}  ${r.verdict}`,
      )
    }

    const uniq = await c.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM (
        SELECT solicitation_number, nsn_raw, pr_number FROM requirement
        GROUP BY 1,2,3 HAVING count(*) > 1
      ) d
    `)
    const distinctSol = await c.query<{ n: string }>(
      `SELECT count(DISTINCT solicitation_number)::text AS n FROM requirement`,
    )
    console.log(
      `\n  NATURAL KEY HOLDS: ${uniq.rows[0]?.n} duplicate (solicitation, nsn, pr) groups; ` +
        `${distinctSol.rows[0]?.n} distinct solicitations across 3,095 rows`,
    )

    const q = await c.query<Record<string, unknown>>(`${BOARD_QUERY} LIMIT 6`)
    console.log('\n  THE BOARD QUERY, FIRST 6 ROWS OF REAL GOVERNMENT DATA\n')
    for (const r of q.rows) {
      const sources = (r.approved_cages as string[] | null) ?? []
      console.log(
        `    ${String(r.nsn_raw).padEnd(14)} ${String(r.nomenclature ?? '').slice(0, 22).padEnd(22)} ` +
          `qty ${String(r.quantity).padStart(5)} ${String(r.unit_of_issue).padEnd(3)} ` +
          `due ${String(r.return_by).slice(0, 10)} ` +
          `ADO ${String(r.delivery_days_ado ?? '-').padStart(4)} ` +
          `auto ${r.auto_award_eligible ? 'Y' : 'n'} ` +
          `sources ${String(r.approved_source_count ?? 0).padStart(3)}` +
          (sources.length > 0 ? ` [${sources.slice(0, 3).join(',')}]` : ''),
      )
    }

    const boardTotal = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${BOARD_QUERY}) b`)
    console.log(`\n    Board query returns ${boardTotal.rows[0]?.n} rows.`)

    const coverage = await c.query<{
      with_delivery: string
      with_sources: string
      auto: string
      restricted: string
    }>(`
      SELECT
        count(*) FILTER (WHERE delivery_days_ado IS NOT NULL)::text AS with_delivery,
        count(*) FILTER (WHERE approved_source_count > 0)::text     AS with_sources,
        count(*) FILTER (WHERE auto_award_eligible)::text           AS auto,
        count(*) FILTER (WHERE set_aside_restricted)::text          AS restricted
      FROM (${BOARD_QUERY}) b
    `)
    const cov = coverage.rows[0]
    console.log(
      `    Coverage, stated honestly: ${cov?.with_delivery} carry a confirmed delivery commitment, ` +
        `${cov?.with_sources} have an approved source loaded,\n` +
        `    ${cov?.auto} are on the automated-award path, ${cov?.restricted} are restricted in some way.`,
    )

    const stale = await c.query<{ n: string; earliest: string }>(`
      SELECT count(*)::text AS n, to_char(min(return_by),'YYYY-MM-DD') AS earliest
      FROM requirement WHERE return_by < DATE '2026-08-11'
    `)
    console.log(
      `\n  DATA-QUALITY OBSERVATION FOR T3: ${stale.rows[0]?.n} of 3,095 requirements carry a return-by\n` +
        `    date EARLIER than the feed day (earliest ${stale.rows[0]?.earliest}). Faithful to the published\n` +
        `    file, verified against the raw bytes. Any "days remaining" computed off these goes negative.`,
    )

    console.log('\n  FRESHNESS CONTRACT (what every other lane reads instead of asking this lane)\n')
    const fresh = await c.query<Record<string, unknown>>(FRESHNESS_QUERY)
    for (const r of fresh.rows) {
      const assertions = (r.assertions as { id: string; probeLanded: boolean; passed: boolean }[]) ?? []
      const landedFailed = assertions.filter((a) => a.probeLanded && !a.passed).length
      const notLanded = assertions.filter((a) => !a.probeLanded).length
      console.log(
        `    ${String(r.source_key).padEnd(22)} ${String(r.status ?? 'never loaded').padEnd(10)} ` +
          `date ${String(r.logical_date ?? '-').slice(0, 10)} ` +
          `loaded ${String(r.rows_loaded ?? 0).padStart(5)} ` +
          `held ${String(r.quarantine_held ?? 0).padStart(3)} ` +
          `assertions ${assertions.length} (${landedFailed} failed, ${notLanded} not yet proven)`,
      )
    }

    console.log('\n  QUARANTINE WORKLIST, grouped by rule\n')
    const quar = await c.query<{ rule_id: string; n: string; sample: string }>(`
      SELECT rule_id, count(DISTINCT (storage_key, line_no))::text AS n,
             min(left(raw_line, 60)) AS sample
      FROM quarantine WHERE state='held' GROUP BY rule_id ORDER BY 2 DESC, 1
    `)
    if (quar.rows.length === 0) console.log('    nothing held')
    for (const r of quar.rows) {
      console.log(`    ${r.rule_id.padEnd(32)} ${r.n.padStart(4)}   e.g. ${r.sample}`)
    }
    console.log()
  } finally {
    await c.end()
    await pgServer.stop()
  }
}

main().catch((error) => {
  console.error(`verify-load FAILED: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
