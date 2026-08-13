/**
 * T2 INGESTION. The fetch path, tested against the REAL captured consent banner.
 *
 * The client is faked because T7 owns the handshake and this lane must never perform it. The
 * BYTES are not faked: the banner these tests feed in is the actual 9,152-byte body DIBBS
 * served at the exact URL of the index file, captured and archived. That is the difference
 * between testing the guard and testing a mock of the guard.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  dailyFilename,
  feedStamp,
  fetchDailyFile,
  unavailableConsentedClient,
  type ConsentedClient,
  type ConsentedClientProvider,
  type ConsentedResponse,
} from '../../lib/ingest/sources/dibbs-fetch'

const ARCHIVE = process.env.INGEST_ARCHIVE_ROOT ?? '/Users/user/onlysource-data/archive'
const FIXED_NOW = '2026-08-13T12:00:00.000Z'
const now = (): string => FIXED_NOW

function capturedBanner(): Buffer {
  const manifestPath = join(ARCHIVE, 'MANIFEST.jsonl')
  if (!existsSync(manifestPath)) {
    throw new Error(
      `The raw landing archive is not present at ${ARCHIVE}. This test runs against the real ` +
        `captured consent banner and must not be made to pass by skipping it.`,
    )
  }
  const rows = readFileSync(manifestPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { storage_key: string })
  const row = rows.find((r) => r.storage_key.includes('consent-banner-at-in260811-url.html'))
  if (!row) throw new Error('the captured consent banner is not in the archive')
  return readFileSync(join(ARCHIVE, row.storage_key))
}

/** A client that serves whatever the test tells it to, and counts refreshes. */
function fakeClient(responses: ConsentedResponse[]): {
  provider: ConsentedClientProvider
  refreshes: () => number
} {
  let index = 0
  let refreshCount = 0
  const client: ConsentedClient = {
    host: 'dibbs2',
    async get() {
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      if (!response) throw new Error('fake client exhausted')
      return response
    },
    async refresh() {
      refreshCount += 1
    },
  }
  return { provider: async () => client, refreshes: () => refreshCount }
}

function response(over: Partial<ConsentedResponse> & { body: Buffer }): ConsentedResponse {
  return {
    status: over.status ?? 200,
    headers: over.headers ?? {},
    finalUrl: over.finalUrl ?? 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in260811.txt',
    bytes: async () => over.body,
  }
}

describe('filename derivation matches what the publisher actually names its files', () => {
  it('derives the stamp and the three daily filenames', () => {
    expect(feedStamp('2026-08-11')).toBe('260811')
    expect(dailyFilename('in', '2026-08-11')).toBe('in260811.txt')
    expect(dailyFilename('bq', '2026-08-11')).toBe('bq260811.zip')
    expect(dailyFilename('ca', '2026-08-11')).toBe('ca260811.zip')
  })

  it('refuses a date it cannot parse rather than producing a wrong filename', () => {
    expect(() => feedStamp('08/11/26')).toThrow()
  })
})

describe('the consent banner served with HTTP 200 at the data URL', () => {
  const banner = capturedBanner()

  it('is REFUSED, and nothing is archived. THE RED RUN, on real bytes', async () => {
    const { provider, refreshes } = fakeClient([
      response({ body: banner, status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      response({ body: banner, status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    ])

    const outcome = await fetchDailyFile(provider, 'in', '2026-08-11', now)

    expect(outcome.status).toBe('consent_expired')
    expect(outcome.storageKey).toBeNull() // NOTHING went into the archive
    // Refreshed exactly once, then stopped. Never a loop against a WAF-fronted host.
    expect(refreshes()).toBe(1)
  })

  it('recovers when the refresh works, proving the guard is not simply always-refusing', async () => {
    const realIndex = Buffer.from('X'.repeat(140) + '\n', 'utf8')
    const { provider, refreshes } = fakeClient([
      response({ body: banner, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      response({ body: realIndex, headers: { 'content-type': 'text/plain' } }),
    ])

    const outcome = await fetchDailyFile(provider, 'in', '2026-08-11', now)

    expect(refreshes()).toBe(1)
    expect(outcome.status).not.toBe('consent_expired')
  })

  it('is caught by a redirect to dodwarning even when the body would pass', async () => {
    const plausible = Buffer.from('X'.repeat(140) + '\n', 'utf8')
    const { provider } = fakeClient([
      response({
        body: plausible,
        headers: { 'content-type': 'text/plain' },
        finalUrl: 'https://dibbs2.bsm.dla.mil/dodwarning.aspx?goto=%2fDownloads',
      }),
      response({
        body: plausible,
        headers: { 'content-type': 'text/plain' },
        finalUrl: 'https://dibbs2.bsm.dla.mil/dodwarning.aspx?goto=%2fDownloads',
      }),
    ])

    const outcome = await fetchDailyFile(provider, 'in', '2026-08-11', now)
    expect(outcome.status).toBe('consent_expired')
  })
})

describe('a day the publisher never posted', () => {
  it('is a NAMED state, not a gap and not a zero', async () => {
    const { provider } = fakeClient([response({ body: Buffer.alloc(0), status: 404 })])
    const outcome = await fetchDailyFile(provider, 'in', '2026-01-01', now)
    expect(outcome.status).toBe('not_published')
    expect(outcome.storageKey).toBeNull()
  })
})

describe('with no consent connector available', () => {
  it('refuses by name and never improvises a handshake', async () => {
    await expect(fetchDailyFile(unavailableConsentedClient, 'in', '2026-08-11', now)).rejects.toThrow(
      /B-T2-2/,
    )
  })
})
