/**
 * T2 INGESTION. Fetch a DIBBS feed day through T7's consented client and archive it.
 *
 * OWNERSHIP, WHICH IS NOT NEGOTIABLE HERE. T7 mints and holds the DoD consent session as a
 * connector object, per host, because `www.dibbs.bsm.dla.mil` and `dibbs2.bsm.dla.mil` hold
 * SEPARATE consent state on what looks like one system. **This lane never performs the
 * consent POST.** It requests a consented client and uses it. If the client is absent, this
 * module says so plainly and does nothing; it does not improvise a handshake.
 *
 * WHY THIS EXISTS BEFORE THE CLIENT DOES. The conductor has ruled the re-fetch fleet-critical
 * and it is gated on that client. Everything except the handshake is written and tested here,
 * so the moment T7 lands the connector the re-fetch is one command rather than a day's work.
 * The `ca` package we hold is 217 of roughly 3,095 solicitations, truncated mid-stream, and
 * the retention window on feed day 2026-08-11 closes around mid-September.
 */

import { archiveBytes } from '../archive'
import { assertContentLength, assertNotAConsentBanner, assertion } from '../assert'
import type { AssertionResult } from '../types'

/**
 * The handle T7 provides. Signature agreed in the claims file, including the four additions
 * this lane needs and a plain `Response` does not give:
 *   - a STREAMABLE body, because the monthly catalog archive is 1,733,717,329 bytes
 *   - HTTP Range, for the 206 read of the zip central directory in the drift canary
 *   - the FINAL URL after redirects, because a lapsed consent 302s to /dodwarning.aspx and
 *     without the final URL an expired session is indistinguishable from a page
 *   - refresh(), so an expired consent can be retried exactly once and then fail loudly
 */
export interface ConsentedClient {
  readonly host: 'dibbs' | 'dibbs2'
  get(path: string, options?: { range?: { start: number; end: number } }): Promise<ConsentedResponse>
  refresh(): Promise<void>
}

export interface ConsentedResponse {
  status: number
  headers: Record<string, string>
  /** The URL actually served, after redirects. */
  finalUrl: string
  bytes(): Promise<Buffer>
}

export type ConsentedClientProvider = (host: 'dibbs' | 'dibbs2') => Promise<ConsentedClient>

export const DIBBS_ARCHIVE_PATH = '/Downloads/RFQ/Archive'
export const DIBBS_SOURCE_KEY = 'dibbs-rfq-daily'

/** The three files published per feed day, plus the batch file whose contents are disputed. */
export const DAILY_FILES = ['in', 'bq', 'ca'] as const
export type DailyFileKind = (typeof DAILY_FILES)[number]

/** `2026-08-11` to the `260811` the publisher uses in filenames. */
export function feedStamp(logicalDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(logicalDate)
  if (!m) throw new Error(`feedStamp: "${logicalDate}" is not YYYY-MM-DD`)
  const [, yyyy, mm, dd] = m
  return `${(yyyy as string).slice(2)}${mm}${dd}`
}

export function dailyFilename(kind: DailyFileKind, logicalDate: string): string {
  const stamp = feedStamp(logicalDate)
  return kind === 'in' ? `in${stamp}.txt` : `${kind}${stamp}.zip`
}

export type FetchOutcome = {
  kind: DailyFileKind
  filename: string
  status: 'archived' | 'already_present' | 'consent_expired' | 'not_published' | 'failed'
  byteLen: number | null
  storageKey: string | null
  assertions: AssertionResult[]
  detail: string
}

/**
 * Fetch one file of one feed day and archive the original bytes.
 *
 * THE CONTENT LADDER RUNS BEFORE ANYTHING IS ARCHIVED AS DATA. A 200 is not data and on this
 * feed it is actively a lie: DIBBS serves the DoD consent banner as HTTP 200, `text/html`, at
 * the exact URL of the data file. Two captured banners of identical 9,152-byte length carry
 * different SHA-256 hashes because the banner embeds the target path, so length detects
 * nothing either. Assert content type, then shape, and never status or size.
 *
 * An HTML body on a data URL means the consent lapsed. This refreshes ONCE and then fails
 * loudly, because a silent retry loop against a WAF-fronted government host is how a lane
 * gets an address blocked for everyone.
 */
export async function fetchDailyFile(
  getClient: ConsentedClientProvider,
  kind: DailyFileKind,
  logicalDate: string,
  now: () => string,
): Promise<FetchOutcome> {
  const filename = dailyFilename(kind, logicalDate)
  const path = `${DIBBS_ARCHIVE_PATH}/${filename}`
  const assertions: AssertionResult[] = []

  const client = await getClient('dibbs2')

  const attempt = async (): Promise<ConsentedResponse> => client.get(path)
  let response = await attempt()

  const looksLikeConsent = (r: ConsentedResponse, body: Buffer): boolean => {
    const contentType = r.headers['content-type'] ?? r.headers['Content-Type'] ?? null
    const banner = assertNotAConsentBanner('dibbs.fetch.not_banner', body, contentType)
    return !banner.passed || r.finalUrl.toLowerCase().includes('dodwarning')
  }

  let body = await response.bytes()
  if (looksLikeConsent(response, body)) {
    // Exactly one refresh, then stop. Never a loop.
    await client.refresh()
    response = await attempt()
    body = await response.bytes()
    if (looksLikeConsent(response, body)) {
      assertions.push(
        assertion(
          'dibbs.fetch.not_banner',
          'payload is data, not the DoD consent banner',
          false,
          'data',
          `consent banner still served after one refresh; final URL ${response.finalUrl}`,
        ),
      )
      return {
        kind,
        filename,
        status: 'consent_expired',
        byteLen: null,
        storageKey: null,
        assertions,
        detail: 'consent expired and did not recover after one refresh',
      }
    }
  }

  const contentType = response.headers['content-type'] ?? response.headers['Content-Type'] ?? null
  assertions.push(assertNotAConsentBanner('dibbs.fetch.not_banner', body, contentType))

  // A day the publisher never posted is a NAMED state, not a gap and not a zero.
  if (response.status === 404) {
    return {
      kind,
      filename,
      status: 'not_published',
      byteLen: null,
      storageKey: null,
      assertions,
      detail: `${filename} is not published for ${logicalDate}`,
    }
  }

  assertions.push(
    assertion(
      'dibbs.fetch.non_empty',
      'the response carries bytes',
      body.length > 0,
      'more than 0 bytes',
      `${body.length} bytes`,
    ),
  )

  // THE DIRECT TRUNCATION CHECK. A row-count floor infers truncation from the shape of what
  // arrived; Content-Length states how many bytes the publisher meant to send. A file cut on a
  // row boundary parses perfectly clean and only this check sees it for what it is.
  assertions.push(
    assertContentLength(
      'dibbs.fetch.content_length',
      body.length,
      response.headers['content-length'] ?? response.headers['Content-Length'],
    ),
  )

  if (assertions.some((a) => a.probeLanded && !a.passed && a.severity === 'reject')) {
    return {
      kind,
      filename,
      status: 'failed',
      byteLen: body.length,
      storageKey: null,
      assertions,
      detail: 'content assertions failed; nothing archived',
    }
  }

  const outcome = await archiveBytes({
    bytes: body,
    sourceKey: DIBBS_SOURCE_KEY,
    logicalDate,
    filename,
    sourceUrl: response.finalUrl,
    retrievedAt: now(),
    // Our own fetch, so the retrieval instant is the response instant, not a file mtime.
    retrievedAtBasis: 'http_response',
    retrievalMethod: 'pipeline_fetch',
    retrievedBy: 'T2 ingest via T7 consented client',
    httpStatus: response.status,
    contentType,
    responseHeaders: response.headers,
    archivedAt: now(),
    note: `feed day ${logicalDate}, ${kind} file`,
  })

  return {
    kind,
    filename,
    status: outcome.status === 'archived' ? 'archived' : 'already_present',
    byteLen: body.length,
    storageKey: outcome.record.storage_key,
    assertions,
    detail:
      outcome.status === 'archived'
        ? `archived ${body.length} bytes`
        : 'identical bytes already archived, no-op',
  }
}

/**
 * Fetch a whole feed day.
 *
 * Deliberately sequential. Citizenship on this host is expressed in rate and volume, which is
 * what the operator of a WAF-fronted government host actually feels, not in a polite user
 * agent string. DIBBS sits behind an F5 ASM that fingerprints requests and whose
 * `GET /robots.txt` returns a block page, so there is no robots.txt to honor and no published
 * rate limit to read. Three files a day, one at a time, is not a load worth optimising.
 */
export async function fetchFeedDay(
  getClient: ConsentedClientProvider,
  logicalDate: string,
  now: () => string,
  kinds: readonly DailyFileKind[] = DAILY_FILES,
): Promise<FetchOutcome[]> {
  const outcomes: FetchOutcome[] = []
  for (const kind of kinds) {
    outcomes.push(await fetchDailyFile(getClient, kind, logicalDate, now))
  }
  return outcomes
}

/**
 * The provider used until T7's connector exists.
 *
 * It does not improvise a handshake, does not fall back to an unconsented GET, and does not
 * return a client that would quietly retrieve 9 KB of banner. It refuses, by name, with the
 * blocker id, so the failure reads as "not connected yet" rather than as a bug.
 */
export const unavailableConsentedClient: ConsentedClientProvider = async (host) => {
  throw new Error(
    `The DIBBS consent connector is not available for host "${host}". T7 owns minting the ` +
      `consent session (blocker B-T2-2); this lane must never perform the consent POST itself. ` +
      `No bytes were fetched and nothing was archived.`,
  )
}
