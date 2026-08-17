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

import { archiveBytes, recordRejection } from '../archive'
import {
  assertContentLength,
  assertNotAConsentBanner,
  assertion,
  blockingFailures,
  notLanded,
} from '../assert'
import {
  checkCountBand,
  classifyFeedResponse,
  classifyZipFeedResponse,
  countZipLocalHeaders,
  BLOCK_PAGE_MARKERS,
  DIBBS_INDEX_SHAPE,
  type FeedVerdict,
} from '../../connectors/dibbs/classify'
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
  status:
    | 'archived'
    | 'already_present'
    | 'consent_expired'
    | 'not_published'
    /** The bytes arrived and the content gate refused them. Recorded in the manifest. */
    | 'rejected'
    | 'failed'
  byteLen: number | null
  storageKey: string | null
  assertions: AssertionResult[]
  detail: string
}

/** Options threaded to the archive layer. Tests point `archiveRoot` at a scratch directory. */
export type FetchOptions = { archiveRoot?: string }

/**
 * THE BELT-AND-BRACES CONTENT ASSERTION FOR THE DAILY INDEX, run on the WHOLE file after the
 * classifier. The classifier tolerates one ragged final line because it is specified over a
 * SAMPLE; this runs where the full file is in hand and tolerates nothing.
 *
 * The four legs, each of which has independently caught a real artifact on this estate:
 *   1. A byte floor of 28,000 B: the 200-row count-band minimum times the 142 bytes a CRLF
 *      row occupies, rounded down. It backs the token leg rather than encoding a separate
 *      guess about daily volume, and it kills the archived 141-byte truncation fixture and
 *      every 9 KB interception page with a 3x margin. An earlier draft used 70,000 B
 *      derived from the 500-row judgement floor, and the FIRST live day fetched through
 *      this gate refuted it: 2026-08-14 is a real, complete, Content-Length-verified feed
 *      day of 331 rows and 47,002 bytes. Daily volume varies 10x (331 to 3,095 measured);
 *      the floor is for artifacts, not for light days.
 *   2. Every line exactly 140 characters. A file truncated mid-row survives a sample check
 *      and dies here.
 *   3. At least 200 DISTINCT solicitation tokens. A 439 KB file of the letter X passes a
 *      width check; it contains zero solicitation numbers. Measured days carry 286 and
 *      2,721 distinct; no interception page carries any.
 *   4. No block-page phrase anywhere in the body. 'Warning and Consent' appears twice in
 *      each captured DoD banner; 'Request Rejected' is the F5 block page. A text file is
 *      scanned whole: unlike a compressed stream, real index text cannot collide with these
 *      phrases by chance, so anywhere-in-body is safe here and is the strongest form.
 */
export function assertIndexFileContent(body: Buffer): AssertionResult[] {
  const results: AssertionResult[] = []
  const text = body.toString('latin1')

  const BYTE_FLOOR = 28_000
  results.push(
    assertion(
      'dibbs.index.byte_floor',
      `the index file is at least ${BYTE_FLOOR} bytes`,
      body.length >= BYTE_FLOOR,
      `at least ${BYTE_FLOOR} bytes`,
      `${body.length} bytes`,
    ),
  )

  const lines = text.split(/\r?\n/)
  // A trailing newline yields one empty final element; that is the file ending cleanly,
  // not a row. Everything else must be exactly 140 characters, with no ragged-line grace.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const wrongWidth = lines.filter((l) => l.length !== 140)
  results.push(
    assertion(
      'dibbs.index.fixed_width',
      'every line of the full file is exactly 140 characters',
      lines.length > 0 && wrongWidth.length === 0,
      'all lines 140 characters',
      lines.length === 0
        ? 'the file has no lines'
        : wrongWidth.length === 0
          ? `${lines.length} lines, all 140 characters`
          : `${wrongWidth.length} of ${lines.length} lines are not 140 characters ` +
            `(first wrong length: ${wrongWidth[0]?.length})`,
    ),
  )

  const tokens = new Set(text.match(/SPE[0-9A-Z]{3}[0-9]{2}[A-Z][0-9A-Z]{4}/g) ?? [])
  results.push(
    assertion(
      'dibbs.index.distinct_solicitations',
      'the file carries at least 200 distinct SPE solicitation tokens',
      tokens.size >= 200,
      'at least 200 distinct tokens',
      `${tokens.size} distinct tokens`,
    ),
  )

  const blockMarker = BLOCK_PAGE_MARKERS.exec(text)
  results.push(
    assertion(
      'dibbs.index.no_block_page_phrase',
      'no interception-page phrase appears anywhere in the body',
      blockMarker === null,
      'neither "Warning and Consent" nor "Request Rejected" present',
      blockMarker === null ? 'no interception phrase found' : `found "${blockMarker[0]}"`,
    ),
  )

  return results
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
  opts: FetchOptions = {},
): Promise<FetchOutcome> {
  const filename = dailyFilename(kind, logicalDate)
  const path = `${DIBBS_ARCHIVE_PATH}/${filename}`
  const assertions: AssertionResult[] = []

  const client = await getClient('dibbs2')

  /** Every refusal is a MANIFEST ROW, never silence. Idempotent on its reason. */
  const refuse = async (input: {
    status: FetchOutcome['status']
    verdict: string
    reason: string
    httpStatus: number | null
    contentType?: string | null
    bytes?: Buffer | null
    detail: string
    sourceUrl: string
  }): Promise<FetchOutcome> => {
    await recordRejection(
      {
        sourceKey: DIBBS_SOURCE_KEY,
        logicalDate,
        filename,
        sourceUrl: input.sourceUrl,
        httpStatus: input.httpStatus,
        contentType: input.contentType ?? null,
        bytes: input.bytes ?? null,
        reason: input.reason,
        verdict: input.verdict,
        retrievedAt: now(),
        recordedAt: now(),
        retrievalMethod: 'pipeline_fetch',
        retrievedBy: 'T2 ingest via T7 consented client',
        note: `feed day ${logicalDate}, ${kind} file`,
      },
      opts.archiveRoot,
    )
    return {
      kind,
      filename,
      status: input.status,
      byteLen: input.bytes ? input.bytes.length : null,
      storageKey: null,
      assertions,
      detail: input.detail,
    }
  }

  const attempt = async (): Promise<ConsentedResponse> => client.get(path)
  let response = await attempt()

  const looksLikeConsent = (r: ConsentedResponse, body: Buffer): boolean => {
    const contentType = r.headers['content-type'] ?? r.headers['Content-Type'] ?? null
    const banner = assertNotAConsentBanner('dibbs.fetch.not_banner', body, contentType)
    return !banner.passed || r.finalUrl.toLowerCase().includes('dodwarning')
  }

  /**
   * ORIGIN 404/410 OUTRANKS THE BANNER CHECK, measured live on 2026-08-17: DIBBS answers a
   * 404 for an unpublished day WITH a 5,684-byte HTML error body, and a banner check that
   * runs first reads that page as a lapsed consent. The status is authoritative here in a
   * way it never is for a 200: a 404 through a consented session means the file is not
   * there, while "200 with HTML" means nothing until the body is classified.
   */
  const originGone = (r: ConsentedResponse): boolean => r.status === 404 || r.status === 410

  let body = await response.bytes()
  if (!originGone(response) && looksLikeConsent(response, body)) {
    // Exactly one refresh, then stop. Never a loop.
    await client.refresh()
    response = await attempt()
    body = await response.bytes()
    if (!originGone(response) && looksLikeConsent(response, body)) {
      assertions.push(
        assertion(
          'dibbs.fetch.not_banner',
          'payload is data, not the DoD consent banner',
          false,
          'data',
          `consent banner still served after one refresh; final URL ${response.finalUrl}`,
        ),
      )
      return refuse({
        status: 'consent_expired',
        verdict: 'consent_banner',
        reason: 'the DoD consent banner was served at the file URL and one refresh did not clear it',
        httpStatus: response.status,
        contentType: response.headers['content-type'] ?? response.headers['Content-Type'] ?? null,
        bytes: body,
        detail: 'consent expired and did not recover after one refresh',
        sourceUrl: response.finalUrl,
      })
    }
  }

  const contentType = response.headers['content-type'] ?? response.headers['Content-Type'] ?? null

  // A day the publisher never posted is a NAMED state, not a gap and not a zero. Recorded
  // in the manifest with its status, because a silent 404 and a fetch nobody ran look
  // identical a month later, and only one of them is a hole in the capture discipline.
  if (originGone(response)) {
    return refuse({
      status: 'not_published',
      verdict: 'not_published',
      reason: `origin refused with HTTP ${response.status}: not published or outside the retention window`,
      httpStatus: response.status,
      contentType,
      bytes: null,
      detail: `${filename} is not published for ${logicalDate} (HTTP ${response.status})`,
      sourceUrl: response.finalUrl,
    })
  }

  assertions.push(assertNotAConsentBanner('dibbs.fetch.not_banner', body, contentType))

  if (response.status !== 200) {
    return refuse({
      status: 'failed',
      verdict: 'http_error',
      reason: `origin answered HTTP ${response.status}`,
      httpStatus: response.status,
      contentType,
      bytes: null,
      detail: `${filename}: HTTP ${response.status}`,
      sourceUrl: response.finalUrl,
    })
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
  //
  // EXCEPT when the response was content-encoded: fetch hands back DECODED bytes while the
  // Content-Length header keeps describing the WIRE bytes, so on a gzip-served day the two
  // legitimately differ and comparing them would reject real data as truncated. In that case
  // the check honestly reports it could not land rather than lying in either direction.
  const contentEncoding =
    response.headers['content-encoding'] ?? response.headers['Content-Encoding'] ?? null
  assertions.push(
    contentEncoding
      ? notLanded(
          'dibbs.fetch.content_length',
          'bytes received match the advertised Content-Length',
          `the response was content-encoded (${contentEncoding}); the advertised length describes ` +
            `the encoded wire bytes, not the decoded payload`,
        )
      : assertContentLength(
          'dibbs.fetch.content_length',
          body.length,
          response.headers['content-length'] ?? response.headers['Content-Length'],
        ),
  )

  /*
   * THE CLASSIFIER IS THE GATE. Nothing reaches archiveBytes unless the verdict is `data`.
   * Before 2026-08-17 the archive call ran on transport checks alone, which is exactly how
   * this estate once recorded 141 bytes of the letter X as a captured feed day.
   *
   * The sample for a zip is HEAD-ONLY and its entry count is measured on the buffer:
   * decoding a whole `ca` package to a string died live on V8's 512 MB string ceiling
   * (ERR_STRING_TOO_LONG, the 2026-08-12 package). Index files are under a megabyte and
   * their full-file assertions genuinely need the whole text.
   */
  const sample =
    kind === 'in' ? body.toString('latin1') : body.toString('latin1', 0, 65_536)
  const facts = { status: response.status, contentType, finalUrl: response.finalUrl, sample }
  let verdict: FeedVerdict =
    kind === 'in'
      ? classifyFeedResponse(facts, DIBBS_INDEX_SHAPE)
      : classifyZipFeedResponse(facts, countZipLocalHeaders(body))
  if (verdict.kind === 'data' && kind === 'in') {
    // The sample IS the whole body here, so the row count is the true count.
    verdict = checkCountBand(verdict.rows, DIBBS_INDEX_SHAPE)
  }
  assertions.push(
    assertion(
      'dibbs.fetch.classified_as_data',
      'the content classifier reached a data verdict',
      verdict.kind === 'data',
      'data',
      verdict.kind === 'data' ? `data, ${verdict.rows} rows` : `${verdict.kind}: ${verdict.detail}`,
    ),
  )

  // Belt and braces on top of the classifier, full-file, index only.
  if (kind === 'in') {
    assertions.push(...assertIndexFileContent(body))
  }

  const blocking = blockingFailures(assertions)
  if (blocking.length > 0) {
    const first = blocking[0]!
    return refuse({
      status: 'rejected',
      verdict: verdict.kind === 'data' ? 'assertion_failed' : verdict.kind,
      reason: `content gate refused: ${first.id} expected ${first.expected}, got ${first.actual}`,
      httpStatus: response.status,
      contentType,
      bytes: body,
      detail: `content gate refused ${filename}: ${first.id} (${first.actual})`,
      sourceUrl: response.finalUrl,
    })
  }

  const outcome = await archiveBytes(
    {
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
    },
    opts.archiveRoot,
  )

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
  opts: FetchOptions = {},
): Promise<FetchOutcome[]> {
  const outcomes: FetchOutcome[] = []
  for (const kind of kinds) {
    outcomes.push(await fetchDailyFile(getClient, kind, logicalDate, now, opts))
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
