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

import { PG_DIR, PG_PASSWORD, PG_PORT, PG_USER } from '../../lib/ingest/db'

let server: EmbeddedPostgres | null = null

async function startPostgres(): Promise<void> {
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
}

async function stopPostgres(): Promise<void> {
  if (server) await server.stop()
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

describe('with the ingest database up and holding the real ingested rows', () => {
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
