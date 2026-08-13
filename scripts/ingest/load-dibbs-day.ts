/**
 * T2 INGESTION. Load one archived DIBBS feed day into Postgres, end to end.
 *
 *   node --import ./scripts/ingest/ts-resolve.mjs scripts/ingest/load-dibbs-day.ts [YYYY-MM-DD]
 *
 * Reads the immutable archive, never the network. Parses, validates, quarantines what fails,
 * writes rows, and writes one immutable run-ledger row per file carrying every assertion with
 * its two booleans. Safe to run twice: the natural keys make a second run a no-op, which is
 * proven by running it twice rather than asserted.
 */

import EmbeddedPostgres from 'embedded-postgres'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'

import {
  ARCHIVE_ROOT,
  PG_DATABASE,
  PG_DIR,
  PG_PASSWORD,
  PG_PORT,
  PG_USER,
  applySchema,
  client,
} from '../../lib/ingest/db'
import { parseApprovedSource, parseDibbsIndex, parseQuoteFile } from '../../lib/ingest/parse/dibbs'
import { readZipMembers } from '../../lib/ingest/parse/zip'
import { parseSolicitation } from '../../lib/intelligence/niin'
import { blockingFailures, failures, landedFailures } from '../../lib/ingest/assert'
import { systemClock } from '../../lib/time/clock'
import type { AssertionResult, QuarantineRow } from '../../lib/ingest/types'

const LOGICAL_DATE = process.argv[2] ?? '2026-08-11'

function codeVersion(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

type ManifestRow = {
  source_key: string
  logical_date: string
  retrieved_at: string
  retrieved_at_basis?: string
  storage_key: string
  content_sha256: string
  byte_len: number
  source_url: string
  http_status: number
  content_type: string
  retrieval_method: string
  note: string
}

async function readManifest(): Promise<ManifestRow[]> {
  const text = await readFile(join(ARCHIVE_ROOT, 'MANIFEST.jsonl'), 'utf8')
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as ManifestRow)
}

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

  let started = false
  try {
    try {
      await pgServer.initialise()
    } catch {
      // Already initialised. The data directory persists next to the archive on purpose.
    }
    await pgServer.start()
    started = true
    try {
      await pgServer.createDatabase(PG_DATABASE)
    } catch {
      // Already there.
    }

    const c = client()
    await c.connect()
    await applySchema(c)

    await c.query(
      `INSERT INTO org (slug, name) VALUES ('onlysource','ONLYSOURCE')
       ON CONFLICT (slug) DO NOTHING`,
    )
    await c.query(
      `INSERT INTO source_registry (source_key, host, fetch_strategy, publisher_unit, retention_days, notes)
       VALUES
         ('dibbs-rfq-daily','dibbs2.bsm.dla.mil','consented GET, whole file','one file per business day',28,
          'T+1: records append to the current day file during business hours and publish the next day'),
         ('dibbs-consent-banner','dibbs2.bsm.dla.mil','n/a','n/a',NULL,
          'Not a data source. Captured consent-banner bodies kept as golden fixtures.')
       ON CONFLICT (source_key) DO NOTHING`,
    )

    const manifest = await readManifest()
    const forDay = manifest.filter(
      (m) => m.logical_date === LOGICAL_DATE && m.source_key === 'dibbs-rfq-daily',
    )
    if (forDay.length === 0) {
      console.log(`\n  No archived objects for ${LOGICAL_DATE}. Nothing loaded, nothing invented.\n`)
      return
    }

    // Register the archived bytes as raw_object rows. Provenance, verbatim from the manifest.
    for (const m of forDay) {
      await c.query(
        `INSERT INTO raw_object
           (source_key, logical_date, retrieved_at, retrieval_method, retrieved_at_basis,
            storage_key, content_sha256, byte_len, source_url, http_status, content_type, note)
         VALUES ($1,$2,$3,$4::retrieval_method,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (storage_key) DO NOTHING`,
        [
          m.source_key,
          m.logical_date,
          m.retrieved_at,
          m.retrieval_method,
          m.retrieved_at_basis ?? null,
          m.storage_key,
          m.content_sha256,
          m.byte_len,
          m.source_url,
          m.http_status,
          m.content_type,
          m.note,
        ],
      )
    }

    // R0.3: wall time is read ONLY through the injectable clock, and only here, because a
    // CLI entry point is a composition root. `new Date(string)` is deterministic and allowed.
    const clock = systemClock
    const nowIso = (): string => new Date(clock.now()).toISOString()
    const observedAt = new Date(`${LOGICAL_DATE}T00:00:00Z`).toISOString()
    const version = codeVersion()

    const runFile = async (
      label: string,
      storageKey: string,
      work: () => Promise<{
        rowsIn: number
        rowsLoaded: number
        quarantined: QuarantineRow[]
        assertions: AssertionResult[]
      }>,
    ): Promise<void> => {
      const runId = randomUUID()
      const startedAt = nowIso()
      await c.query(
        `INSERT INTO run_ledger (run_id, source_key, logical_date, started_at, status, code_version, storage_key, note)
         VALUES ($1,'dibbs-rfq-daily',$2,$3,'running',$4,$5,$6)`,
        [runId, LOGICAL_DATE, startedAt, version, storageKey, label],
      )

      const result = await work()

      for (const q of result.quarantined) {
        await c.query(
          `INSERT INTO quarantine
             (source_key, storage_key, logical_date, run_id, line_no, byte_offset, raw_line, rule_id, severity, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            q.sourceKey,
            q.storageKey,
            q.logicalDate,
            runId,
            q.lineNo,
            q.byteOffset,
            q.rawLine,
            q.ruleId,
            q.severity,
            q.detail,
          ],
        )
      }

      // Only a landed, failed, REJECT-severity assertion condemns a load. A probe that never
      // landed is a coverage gap; a `warn` is a contained source defect. Both are reported.
      const green = blockingFailures(result.assertions).length === 0
      const status = !green
        ? result.rowsLoaded > 0
          ? 'partial'
          : 'failed'
        : result.quarantined.length > 0
          ? 'partial'
          : 'succeeded'
      const failureKind = green
        ? result.quarantined.length > 0
          ? 'partially_loaded'
          : 'none'
        : 'assertion_failed'

      await c.query(
        `UPDATE run_ledger
            SET finished_at=$1, status=$2::ingest_status, failure_kind=$3::ingest_failure,
                rows_in=$4, rows_loaded=$5, rows_quarantined=$6, assertions=$7::jsonb
          WHERE run_id=$8`,
        [
          nowIso(),
          status,
          failureKind,
          result.rowsIn,
          result.rowsLoaded,
          result.quarantined.length,
          JSON.stringify(result.assertions),
          runId,
        ],
      )

      const broke = blockingFailures(result.assertions)
      const warned = landedFailures(result.assertions).filter((f) => f.severity === 'warn')
      const didNotLand = failures(result.assertions).filter((f) => !f.probeLanded)
      console.log(
        `  ${label.padEnd(22)} in=${String(result.rowsIn).padStart(5)} ` +
          `loaded=${String(result.rowsLoaded).padStart(5)} ` +
          `quarantined=${String(result.quarantined.length).padStart(3)} ` +
          `status=${status}` +
          (broke.length > 0 ? `\n      FAILED: ${broke.map((b) => `${b.id} (${b.actual})`).join('; ')}` : '') +
          (warned.length > 0 ? `\n      contained: ${warned.map((b) => b.id).join(', ')}` : '') +
          (didNotLand.length > 0 ? `\n      not yet proven: ${didNotLand.map((b) => b.id).join(', ')}` : ''),
      )
    }

    // ---- the index file, which is the requirement grain -------------------------------
    const indexObject = forDay.find((m) => m.storage_key.endsWith('.txt'))
    if (indexObject) {
      await runFile('index (requirements)', indexObject.storage_key, async () => {
        const text = await readFile(join(ARCHIVE_ROOT, indexObject.storage_key), 'utf8')
        const history = (
          await c.query<{ rows_loaded: number }>(
            `SELECT rows_loaded FROM run_ledger
              WHERE source_key='dibbs-rfq-daily' AND note='index (requirements)'
                AND status IN ('succeeded','partial') AND logical_date <> $1`,
            [LOGICAL_DATE],
          )
        ).rows.map((r) => Number(r.rows_loaded))

        const parsed = parseDibbsIndex(text, {
          sourceKey: 'dibbs-rfq-daily',
          logicalDate: LOGICAL_DATE,
          storageKey: indexObject.storage_key,
          observedAt,
          history,
        })

        let loaded = 0
        for (const r of parsed.rows) {
          const sol = parseSolicitation(r.solicitationNumber)
          const res = await c.query(
            `INSERT INTO requirement
               (solicitation_number, nsn_raw, niin, fsc, part_number, pr_number, return_by, quantity,
                unit_of_issue, nomenclature, solicitation_pdf_name, code_block, set_aside_code,
                set_aside_restricted, auto_award_eligible, observed_at, source_key, storage_key, line_no)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
             ON CONFLICT (solicitation_number, nsn_raw, pr_number, source_key, observed_at) DO NOTHING`,
            [
              r.solicitationNumber,
              r.nsnRaw,
              r.niin,
              r.fsc,
              r.partNumber,
              r.prNumber,
              r.returnBy,
              r.quantity,
              r.unitOfIssue,
              r.nomenclature,
              r.solicitationPdfName,
              r.codeBlock,
              r.setAsideCode,
              r.setAsideRestricted,
              sol?.automated ?? null,
              r.observedAt,
              r.sourceKey,
              r.storageKey,
              r.lineNo,
            ],
          )
          loaded += res.rowCount ?? 0
        }
        return {
          rowsIn: parsed.linesRead,
          rowsLoaded: loaded,
          quarantined: parsed.quarantined,
          assertions: parsed.assertions,
        }
      })
    }

    // ---- the zip, carrying the quoting file and the approved-source file ---------------
    const zipObject = forDay.find((m) => m.storage_key.endsWith('bq260811.zip'))
    if (zipObject) {
      const buffer = await readFile(join(ARCHIVE_ROOT, zipObject.storage_key))
      const zip = readZipMembers(buffer)
      if (zip.truncated) {
        console.log(`  NOTE: ${zipObject.storage_key} has no central directory (truncated download)`)
      }

      const asMember = zip.members.find((m) => m.name.startsWith('as') && m.complete)
      if (asMember) {
        await runFile('approved sources', zipObject.storage_key, async () => {
          const parsed = parseApprovedSource(asMember.data.toString('utf8'), {
            sourceKey: 'dibbs-rfq-daily',
            logicalDate: LOGICAL_DATE,
            storageKey: zipObject.storage_key,
            observedAt,
          })
          let loaded = 0
          for (const r of parsed.rows) {
            const res = await c.query(
              `INSERT INTO approved_source
                 (nsn_raw, niin, cage, part_number, observed_at, source_key, storage_key, line_no)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (niin, cage, part_number, source_key, observed_at) DO NOTHING`,
              [r.nsnRaw, r.niin, r.cage, r.partNumber, r.observedAt, r.sourceKey, r.storageKey, r.lineNo],
            )
            loaded += res.rowCount ?? 0
          }
          return {
            rowsIn: parsed.linesRead,
            rowsLoaded: loaded,
            quarantined: parsed.quarantined,
            assertions: parsed.assertions,
          }
        })
      }

      const bqMember = zip.members.find((m) => m.name.startsWith('bq') && m.complete)
      if (bqMember) {
        await runFile('quote lines', zipObject.storage_key, async () => {
          const parsed = parseQuoteFile(bqMember.data.toString('utf8'), {
            sourceKey: 'dibbs-rfq-daily',
            logicalDate: LOGICAL_DATE,
            storageKey: zipObject.storage_key,
            observedAt,
          })
          let loaded = 0
          for (const r of parsed.rows) {
            const res = await c.query(
              `INSERT INTO quote_line
                 (solicitation_number, clin, pr_number, nsn_raw, niin, unit_of_issue, quantity,
                  return_by, delivery_days_ado, item_source_category, observed_at, source_key,
                  storage_key, line_no)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
               ON CONFLICT (solicitation_number, clin, source_key, observed_at) DO NOTHING`,
              [
                r.solicitationNumber,
                r.clin,
                r.prNumber,
                r.nsnRaw,
                r.niin,
                r.unitOfIssue,
                r.quantity,
                r.returnBy,
                r.deliveryDaysAdo,
                r.itemSourceCategory,
                r.observedAt,
                r.sourceKey,
                r.storageKey,
                r.lineNo,
              ],
            )
            loaded += res.rowCount ?? 0
          }
          return {
            rowsIn: parsed.linesRead,
            rowsLoaded: loaded,
            quarantined: parsed.quarantined,
            assertions: parsed.assertions,
          }
        })
      }
    }

    // Watermark: the SET of dates loaded, not a high-water timestamp.
    await c.query(
      `INSERT INTO watermark (source_key, unit_kind, loaded_units, updated_at)
       VALUES ('dibbs-rfq-daily','feed_date', $1::jsonb, now())
       ON CONFLICT (source_key, unit_kind) DO UPDATE
         SET loaded_units = (
               SELECT jsonb_agg(DISTINCT d)
               FROM jsonb_array_elements_text(watermark.loaded_units || $1::jsonb) AS d
             ),
             updated_at = now()`,
      [JSON.stringify([LOGICAL_DATE])],
    )

    await c.end()
  } finally {
    if (started) await pgServer.stop()
  }
}

main().catch((error) => {
  console.error(`load-dibbs-day FAILED: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
