/**
 * T2 INGESTION. The data-health route, EXERCISED rather than asserted.
 *
 * This calls the real route handler, which runs the real SQL against a real Postgres holding
 * the real ingested rows. It is not a mock of the handler and not a check that a module
 * exports a function.
 *
 * THE NEGATIVE PATH IS THE POINT. A data-health surface that fails open is worse than none,
 * because it turns an outage into a green light. So the database-unreachable case is tested
 * first and explicitly: it must return the named state `offline`, not an empty source list
 * that a badge would render as "all quiet".
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { PG_DIR, PG_PASSWORD, PG_PORT, PG_USER } from '../../lib/ingest/db'

/**
 * ==========================================================================================
 * THIS FILE FAILED ALL NIGHT AND SAID "Unknown Error: undefined". Fixed 2026-08-24.
 * ==========================================================================================
 * `PG_DIR` does not resolve through `lib/data-root.ts`, so it has none of the `<cwd>/data`
 * fallback the rest of the product relies on. `lib/ingest/db.ts` reads `ONLYSOURCE_DATA_ROOT`
 * and falls back to a macOS path, while everything else reads `ONLYSOURCE_DATA_DIR`. On a
 * machine where the cluster lives anywhere else, this suite was pointing at nothing.
 *
 * ★ AND `onError: () => {}` THREW THE EXPLANATION AWAY, so an absent path presented as a 60
 * second hang. An absence presenting as a wrong answer, inside the suite whose own subject is
 * a data-health surface that must never fail open. The irony is the point: the note below
 * exists so this file can never again be the thing it is testing against.
 *
 * ⛔ THE FIRST BLOCK MUST NEVER SKIP. "With the ingest database UNREACHABLE" needs no cluster,
 * by construction, and it is the most valuable assertion in the file: a data-health route that
 * returns an empty green list instead of `offline` turns an outage into a badge saying all
 * quiet. Only the second block is gated, so a machine without a cluster still proves the
 * negative path.
 *
 * Measured 2026-08-24: against the real cluster all 4 tests pass in 429ms. If this suite skips
 * on a machine that HAS the data, that is a configuration bug to fix, not a state to accept.
 */

/**
 * Probes `PG_VERSION`, a FILE, exactly as `test/support/corpus.ts` probes a file rather than a
 * directory: an empty directory exists on more machines than a populated one.
 */
const PG_PRESENT = existsSync(join(PG_DIR, 'PG_VERSION'))

/** Suffix for the suite name, so the run output says WHY and what to do about it. */
const PG_NOTE = PG_PRESENT
  ? ''
  : ` [SKIPPED: no ingest cluster at ${PG_DIR}. Set ONLYSOURCE_PG_DIR, or ONLYSOURCE_DATA_ROOT to the directory holding pg/]`


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

/** Whatever Postgres actually said, captured so it can be attached to the throw. */
let startupError: string | null = null
let server: EmbeddedPostgres | null = null

async function startPostgres(): Promise<void> {
  server = new EmbeddedPostgres({
    databaseDir: PG_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
    onLog: () => {},
    // SURFACE IT, NEVER SWALLOW IT. This was `() => {}` and it cost a night.
    onError: (error: unknown) => {
      startupError = error instanceof Error ? error.message : String(error)
    },
  })
  try {
    await server.start()
  } catch (error) {
    const why = startupError ?? (error instanceof Error ? error.message : String(error))
    server = null
    throw new Error(
      `the ingest cluster at ${PG_DIR} exists but would not start: ${why}. ` +
        `Set ONLYSOURCE_PG_DIR to a working cluster, or ONLYSOURCE_DATA_ROOT to the directory holding pg/.`,
    )
  }
}

/** Teardown must not explode because setup did, or one clear failure becomes two confusing ones. */
async function stopPostgres(): Promise<void> {
  if (server) await server.stop().catch(() => {})
  server = null
}

describe('with the ingest database UNREACHABLE (the negative path, tested first)', () => {
  it('returns the named state `offline` and a 503, never an empty green list', async () => {
    // No Postgres running at this point in the suite.
    const { GET } = await import('../../app/api/data-health/route')
    const response = await GET()
    const body = (await response.json()) as { state: string; sources: unknown[]; detail?: string }

    expect(response.status).toBe(503)
    expect(body.state).toBe('offline')
    expect(body.sources).toEqual([])
    // The reason is carried, so an operator is told what is wrong rather than that nothing is.
    expect(body.detail).toBeTruthy()
  }, 30_000)
})

describe.skipIf(!PG_PRESENT)(`with the ingest database up and holding the real ingested rows${PG_NOTE}`, () => {
  beforeAll(async () => {
    await startPostgres()
  }, 60_000)
  afterAll(async () => {
    await stopPostgres()
  }, 30_000)

  it('reports every registered source with a resolved honest state', async () => {
    const { GET } = await import('../../app/api/data-health/route')
    const response = await GET()
    const body = (await response.json()) as {
      state: string
      sources: {
        source_key: string
        state: string
        explanation: string
        logical_date: string | null
        rows_loaded: number | null
        quarantine_held: number
        assertions: { id: string; probeLanded: boolean; passed: boolean; severity: string }[]
      }[]
      vocabulary: string[]
      note: string
    }

    expect(response.status).toBe(200)
    const daily = body.sources.find((s) => s.source_key === 'dibbs-rfq-daily')
    expect(daily).toBeDefined()

    // Every state must come from the closed vocabulary. A free-string state is unalarmable.
    for (const source of body.sources) {
      expect(body.vocabulary).toContain(source.state)
    }

    // The explanation is a sentence a non-technical expert can act on, not a raw timestamp.
    expect(daily?.explanation.length).toBeGreaterThan(40)

    // The T+1 publisher rule is stated, so no surface renders correct behaviour as lateness.
    expect(body.note).toContain('T+1')
  }, 60_000)

  it('carries BOTH booleans on every assertion, so an unproven check cannot read as passing', async () => {
    const { GET } = await import('../../app/api/data-health/route')
    const body = (await (await GET()).json()) as {
      sources: { source_key: string; assertions: { probeLanded: boolean; gateFired: boolean }[] }[]
    }
    const daily = body.sources.find((s) => s.source_key === 'dibbs-rfq-daily')
    expect(daily?.assertions.length).toBeGreaterThan(0)
    for (const assertion of daily?.assertions ?? []) {
      expect(typeof assertion.probeLanded).toBe('boolean')
      expect(typeof assertion.gateFired).toBe('boolean')
    }
  }, 60_000)

  it('reports a source that has never been loaded as `empty`, not as healthy', async () => {
    const { GET } = await import('../../app/api/data-health/route')
    const body = (await (await GET()).json()) as {
      sources: { source_key: string; state: string; explanation: string }[]
    }
    // dibbs-consent-banner is registered and deliberately never loaded: it holds fixtures.
    const banner = body.sources.find((s) => s.source_key === 'dibbs-consent-banner')
    expect(banner?.state).toBe('empty')
    expect(banner?.explanation).toMatch(/never been loaded/i)
  }, 60_000)
})
