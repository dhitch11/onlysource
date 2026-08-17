/**
 * T2 INGESTION. THE CONTENT GATE, PROVEN AGAINST THE THREE REAL ARTIFACTS ON DISK.
 *
 * This estate has archived, as if they were data: a 9,152-byte DoD consent banner served
 * with HTTP 200 at the exact URL of the index file, and a 141-byte file of the letter X
 * logged as a successful pipeline fetch. Both are still on disk, deliberately, as the
 * negative fixtures for this suite. The 439,490-byte real index sits beside them as the
 * positive control, because a gate that can only refuse proves nothing.
 *
 *   1. banner   -> REFUSED, and the refusal is a manifest row, not silence
 *   2. X file   -> REFUSED, same discipline
 *   3. real day -> ACCEPTED and archived
 *
 * Every fetch here runs against a SCRATCH archive root, so exercising the gate can never
 * append test rows to the real manifest.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertIndexFileContent,
  fetchDailyFile,
  DIBBS_SOURCE_KEY,
  type ConsentedClient,
  type ConsentedClientProvider,
  type ConsentedResponse,
} from '../../lib/ingest/sources/dibbs-fetch'
import { blockingFailures } from '../../lib/ingest/assert'
import { readArchiveManifest, readRejections, readManifestEntries } from '../../lib/ingest/archive'
import { classifyZipFeedResponse, countZipLocalHeaders } from '../../lib/connectors/dibbs/classify'
import {
  DIBBS_SOURCE_KEY as FEED_DAYS_SOURCE_KEY,
  discoverFeedDays,
  newestCompleteFeedDay,
  resetFeedDayCache,
} from '../../lib/ingest/feed-days'
import { archivePath } from '../../lib/data-root'

const ARCHIVE = process.env.INGEST_ARCHIVE_ROOT ?? archivePath()
const FIXED_NOW = '2026-08-17T12:00:00.000Z'
const now = (): string => FIXED_NOW

/** The three artifacts, read from the real archive. Absent archive = loud failure, never skip. */
function fixture(storageKeyPart: string): Buffer {
  const manifestPath = join(ARCHIVE, 'MANIFEST.jsonl')
  if (!existsSync(manifestPath)) {
    throw new Error(
      `The raw landing archive is not present at ${ARCHIVE}. This suite runs against the real ` +
        `captured artifacts and must not be made to pass by skipping them.`,
    )
  }
  const rows = readFileSync(manifestPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { storage_key: string })
  const row = rows.find((r) => r.storage_key.includes(storageKeyPart))
  if (!row) throw new Error(`fixture ${storageKeyPart} is not in the archive manifest`)
  return readFileSync(join(ARCHIVE, row.storage_key))
}

const banner = (): Buffer => fixture('consent-banner-at-in260811-url.html')
const xFile = (): Buffer => fixture('20260813T120000Z/in260811.txt')
const realIndex = (): Buffer => fixture('20260812T225616Z/in260811.txt')
const realBqZip = (): Buffer => fixture('20260812T225617Z/bq260811.zip')

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
    headers: over.headers ?? { 'content-type': 'text/plain' },
    finalUrl: over.finalUrl ?? 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in260811.txt',
    bytes: async () => over.body,
  }
}

let scratch: string
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'gated-archive-'))
})

describe('FIXTURE 1: the 9,152-byte consent banner served with HTTP 200 at the file URL', () => {
  it('is REFUSED, nothing is archived, and the refusal is a MANIFEST ROW saying why', async () => {
    const b = banner()
    expect(b.length).toBe(9152) // the artifact this whole gate exists for
    const { provider, refreshes } = fakeClient([
      response({ body: b, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      response({ body: b, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    ])

    const outcome = await fetchDailyFile(provider, 'in', '2026-08-11', now, { archiveRoot: scratch })

    expect(outcome.status).toBe('consent_expired')
    expect(outcome.storageKey).toBeNull()
    expect(refreshes()).toBe(1) // exactly one refresh, never a loop
    // NOTHING entered the archive as data...
    expect(await readArchiveManifest(scratch)).toEqual([])
    // ...and the refusal is recorded, not silenced.
    const rejections = await readRejections(scratch)
    expect(rejections).toHaveLength(1)
    expect(rejections[0]!.kind).toBe('rejected')
    expect(rejections[0]!.reason).toMatch(/consent banner/i)
    expect(rejections[0]!.byte_len).toBe(9152)
  })
})

describe('FIXTURE 2: the 141-byte file of the letter X that was once logged as a successful fetch', () => {
  it('is REFUSED by the content gate with a manifest row, and nothing is archived', async () => {
    const b = xFile()
    expect(b.length).toBe(141) // the exact artifact from the incident
    const { provider } = fakeClient([
      response({ body: b, headers: { 'content-type': 'text/plain', 'content-length': '141' } }),
    ])

    const outcome = await fetchDailyFile(provider, 'in', '2026-08-11', now, { archiveRoot: scratch })

    expect(outcome.status).toBe('rejected')
    expect(outcome.storageKey).toBeNull()
    expect(await readArchiveManifest(scratch)).toEqual([])
    const rejections = await readRejections(scratch)
    expect(rejections).toHaveLength(1)
    expect(rejections[0]!.reason).toMatch(/content gate refused/i)
  })
})

describe('FIXTURE 3: the real 439,490-byte index. THE POSITIVE CONTROL', () => {
  it('is ACCEPTED through the same gate and archived byte-identical', async () => {
    const b = realIndex()
    expect(b.length).toBe(439490)
    const { provider } = fakeClient([
      response({
        body: b,
        headers: { 'content-type': 'text/plain', 'content-length': String(b.length) },
      }),
    ])

    const outcome = await fetchDailyFile(provider, 'in', '2026-08-11', now, { archiveRoot: scratch })

    expect(outcome.status).toBe('archived')
    expect(outcome.storageKey).not.toBeNull()
    const archived = readFileSync(join(scratch, outcome.storageKey!))
    expect(archived.equals(b)).toBe(true)
    expect(await readRejections(scratch)).toEqual([])
    // A gate that cannot fail is decoration: the same suite proves both verdicts, so a
    // regression that welds it open or shut fails one of the two.
  })
})

describe('the belt-and-braces index assertion, leg by leg', () => {
  it('POSITIVE CONTROL: the real index passes every leg', () => {
    const results = assertIndexFileContent(realIndex())
    expect(blockingFailures(results)).toEqual([])
    const tokens = results.find((r) => r.id === 'dibbs.index.distinct_solicitations')
    // 2,721 distinct solicitations measured on this file; the assertion floor is 200.
    expect(tokens?.actual).toBe('2721 distinct tokens')
  })

  it('rejects the 141-byte X file on the byte floor AND the token count', () => {
    const failed = blockingFailures(assertIndexFileContent(xFile())).map((r) => r.id)
    expect(failed).toContain('dibbs.index.byte_floor')
    expect(failed).toContain('dibbs.index.distinct_solicitations')
  })

  it('rejects a file truncated MID-ROW, which a sample classifier tolerates', () => {
    const cut = realIndex().subarray(0, realIndex().length - 10)
    const failed = blockingFailures(assertIndexFileContent(cut)).map((r) => r.id)
    expect(failed).toContain('dibbs.index.fixed_width')
  })

  it('rejects a width-perfect file whose solicitation tokens are gone', () => {
    // Surgical negative: same bytes, same widths, SPE prefix broken. Only the token leg
    // can catch it, which proves that leg is the one doing the catching.
    const mutated = Buffer.from(realIndex().toString('latin1').replaceAll('SPE', 'XPE'), 'latin1')
    const results = assertIndexFileContent(mutated)
    expect(results.find((r) => r.id === 'dibbs.index.fixed_width')?.passed).toBe(true)
    const failed = blockingFailures(results).map((r) => r.id)
    expect(failed).toContain('dibbs.index.distinct_solicitations')
  })

  it('rejects a width-perfect file carrying an interception phrase', () => {
    const line = 'Warning and Consent'.padEnd(140, ' ')
    const mutated = Buffer.concat([realIndex(), Buffer.from(line + '\r\n', 'latin1')])
    const results = assertIndexFileContent(mutated)
    expect(results.find((r) => r.id === 'dibbs.index.fixed_width')?.passed).toBe(true)
    const failed = blockingFailures(results).map((r) => r.id)
    expect(failed).toContain('dibbs.index.no_block_page_phrase')
  })

  it('rejects "Request Rejected" anywhere in the body, the F5 block page phrase', () => {
    const line = 'Request Rejected'.padEnd(140, ' ')
    const mutated = Buffer.concat([realIndex(), Buffer.from(line + '\r\n', 'latin1')])
    const failed = blockingFailures(assertIndexFileContent(mutated)).map((r) => r.id)
    expect(failed).toContain('dibbs.index.no_block_page_phrase')
  })
})

describe('the zip classifier used for bq and ca files', () => {
  it('accepts the real bq260811.zip, its members counted on the BUFFER, head-only sample', () => {
    // Head-only sample plus a buffer count is the production shape: decoding a whole ca
    // package to a string died live on V8's 512 MB string ceiling (2026-08-12 package).
    const b = realBqZip()
    const verdict = classifyZipFeedResponse(
      {
        status: 200,
        contentType: 'application/x-zip-compressed',
        finalUrl: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/bq260811.zip',
        sample: b.toString('latin1', 0, 65536),
      },
      countZipLocalHeaders(b),
    )
    expect(verdict.kind).toBe('data')
    // The archived zip carries the quoting file and the approved-source file.
    if (verdict.kind === 'data') expect(verdict.rows).toBe(2)
  })

  it('refuses the consent banner presented at a zip URL', () => {
    const b = banner()
    const verdict = classifyZipFeedResponse(
      {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        finalUrl: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/bq260811.zip',
        sample: b.toString('latin1', 0, 65536),
      },
      countZipLocalHeaders(b),
    )
    expect(verdict.kind).toBe('consent_banner')
  })

  it('refuses a body with no zip magic even when the content type claims a zip', () => {
    const b = Buffer.from('not a zip at all', 'latin1')
    const verdict = classifyZipFeedResponse(
      {
        status: 200,
        contentType: 'application/zip',
        finalUrl: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/bq260811.zip',
        sample: b.toString('latin1'),
      },
      countZipLocalHeaders(b),
    )
    expect(verdict.kind).toBe('assertion_failed')
  })
})

describe('manifest idempotency, which is what makes a re-run of the backfill safe', () => {
  it('archives identical bytes ONCE: the second call is already_present, no new row', async () => {
    const b = realIndex()
    const make = () =>
      fakeClient([
        response({
          body: b,
          headers: { 'content-type': 'text/plain', 'content-length': String(b.length) },
        }),
      ])

    const first = await fetchDailyFile(make().provider, 'in', '2026-08-11', now, {
      archiveRoot: scratch,
    })
    const second = await fetchDailyFile(make().provider, 'in', '2026-08-11', now, {
      archiveRoot: scratch,
    })

    expect(first.status).toBe('archived')
    expect(second.status).toBe('already_present')
    expect(second.storageKey).toBe(first.storageKey)
    expect(await readArchiveManifest(scratch)).toHaveLength(1)
  })

  it('records the SAME refusal once: a re-observed 404 does not grow the manifest', async () => {
    const notFound = () => fakeClient([response({ body: Buffer.alloc(0), status: 404 })])

    const first = await fetchDailyFile(notFound().provider, 'in', '2026-01-02', now, {
      archiveRoot: scratch,
    })
    const second = await fetchDailyFile(notFound().provider, 'in', '2026-01-02', now, {
      archiveRoot: scratch,
    })

    expect(first.status).toBe('not_published')
    expect(second.status).toBe('not_published')
    const rejections = await readRejections(scratch)
    expect(rejections).toHaveLength(1)
    expect(rejections[0]!.http_status).toBe(404)
    expect(rejections[0]!.reason).toMatch(/HTTP 404/)
    // and the refusal row never contaminates the data view
    expect(await readArchiveManifest(scratch)).toEqual([])
    expect(await readManifestEntries(scratch)).toHaveLength(1)
  })
})

describe('feed-day discovery: what the archive holds, verified rather than trusted', () => {
  /** Build a scratch archive holding BOTH in-captures (real + X) and the bq zip. */
  function seedScratchArchive(): void {
    const writes: Array<{ storageKey: string; bytes: Buffer; retrievedAt: string }> = [
      {
        storageKey: 'dibbs-rfq-daily/2026-08-11/20260812T225616Z/in260811.txt',
        bytes: realIndex(),
        retrievedAt: '2026-08-12T22:56:16.000Z',
      },
      {
        // The trap: a LATER capture of the same day and filename, 141 bytes of X.
        storageKey: 'dibbs-rfq-daily/2026-08-11/20260813T120000Z/in260811.txt',
        bytes: xFile(),
        retrievedAt: '2026-08-13T12:00:00.000Z',
      },
      {
        storageKey: 'dibbs-rfq-daily/2026-08-11/20260812T225617Z/bq260811.zip',
        bytes: realBqZip(),
        retrievedAt: '2026-08-12T22:56:17.000Z',
      },
    ]
    const manifestLines: string[] = []
    for (const w of writes) {
      const dest = join(scratch, w.storageKey)
      mkdirSync(join(dest, '..'), { recursive: true })
      writeFileSync(dest, w.bytes)
      manifestLines.push(
        JSON.stringify({
          source_key: 'dibbs-rfq-daily',
          logical_date: '2026-08-11',
          retrieved_at: w.retrievedAt,
          retrieved_at_basis: 'http_response',
          storage_key: w.storageKey,
          content_sha256: 'not-checked-by-discovery',
          byte_len: w.bytes.length,
          source_url: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/x',
          http_status: 200,
          content_type: null,
          response_headers: null,
          retrieval_method: 'pipeline_fetch',
          retrieved_by: 'test seed',
          archived_at: w.retrievedAt,
          note: '',
        }),
      )
    }
    writeFileSync(join(scratch, 'MANIFEST.jsonl'), manifestLines.join('\n') + '\n')
  }

  it('shares its source key with the fetch pipeline, asserted so the constants cannot drift', () => {
    expect(FEED_DAYS_SOURCE_KEY).toBe(DIBBS_SOURCE_KEY)
  })

  it('picks the VERIFIED capture, not the newest one: the X file is excluded by name', () => {
    seedScratchArchive()
    resetFeedDayCache()
    const discovery = discoverFeedDays(scratch)

    expect(discovery.present).toBe(true)
    expect(discovery.days).toHaveLength(1)
    const day = discovery.days[0]!
    expect(day.logicalDate).toBe('2026-08-11')
    // "Newest capture wins" would have picked the 2026-08-13 X file. Verification refused it.
    expect(day.in?.storageKey).toBe('dibbs-rfq-daily/2026-08-11/20260812T225616Z/in260811.txt')
    expect(day.in?.byteLen).toBe(439490)
    expect(day.complete).toBe(true) // in + bq both verified
    expect(discovery.excluded.map((e) => e.storageKey)).toContain(
      'dibbs-rfq-daily/2026-08-11/20260813T120000Z/in260811.txt',
    )
    expect(newestCompleteFeedDay(discovery)?.logicalDate).toBe('2026-08-11')
  })

  it('reports an absent archive as absent, never as an empty list of days that "exist"', () => {
    resetFeedDayCache()
    const discovery = discoverFeedDays(join(scratch, 'does-not-exist'))
    expect(discovery.present).toBe(false)
    expect(discovery.days).toEqual([])
  })
})
