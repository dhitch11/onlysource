import 'server-only'

/**
 * IS THIS THE DATA, OR IS IT THE CONSENT BANNER WEARING A 200?
 *
 * This is the single most important assertion in the ingest path, and the canonical worked
 * example of why "health checks perform the operation" is a rule. A plain GET of the DIBBS
 * daily index returns **HTTP 200 with a DoD consent banner as the body**. A builder asserting
 * on the status code ingests an HTML banner as a day of market data and notices weeks later,
 * when the day is no longer re-fetchable.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * WHY LENGTH IS NOT A SIGNAL, MEASURED BY @T2 AND NOT NEGOTIABLE.
 *
 * The research recorded the banner at 9,152 bytes. T2 measured it live at **9,032**, and
 * separately holds **two captures that are both exactly 9,152 bytes with DIFFERENT SHA-256
 * hashes**, because the banner embeds the target path in its body.
 *
 * So: same size, different content; different size, same page. A length check would pass a
 * banner as data on any day the path length shifts. **Never assert on length, and never on a
 * hash of the whole body.** The order below is content type, then shape, then a count band,
 * then a canary field. Every one of those is a property of the DATA, not of the transport.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

export type FeedVerdict =
  | { kind: 'data'; rows: number }
  /** 200 with the banner body. The trap this module exists for. */
  | { kind: 'consent_banner'; detail: string }
  /** Redirected to the consent page. Consent has lapsed; mint a new session and retry once. */
  | { kind: 'consent_redirect'; detail: string }
  /** Reached something that is neither. Never treated as data. */
  | { kind: 'assertion_failed'; detail: string }

export type FeedShape = {
  /** Fixed-width row length. The DIBBS daily index is 140 characters per row. */
  rowWidth: number
  /** A row count outside this band means we did not get a normal feed day. */
  countBand: { min: number; max: number }
  /**
   * A token that must appear in real data and cannot appear in a banner. Checked LAST, because
   * a canary alone would pass on a truncated file that happens to contain one good row.
   */
  canary: RegExp
}

/** The daily solicitation index. Row width and band are T2's to tune from measurement. */
export const DIBBS_INDEX_SHAPE: FeedShape = {
  rowWidth: 140,
  // A working day carries roughly 1,960 requirement lines; the band is deliberately wide
  // enough to admit a light Monday and narrow enough to reject a banner or a truncated file.
  countBand: { min: 200, max: 12000 },
  // A solicitation number, 13 characters: SPE, a 3-character office segment, the two-digit
  // fiscal year, a one-letter type (Q/T/U), and a four-character alphanumeric serial.
  //
  // ─────────────────────────────────────────────────────────────────────────────────────
  // THIS PATTERN HAS BEEN WRONG TWICE AND BOTH TIMES THE UNIT TESTS STAYED GREEN.
  //
  // v1 read `SPE[0-9A-Z]{2}...` and matched 0 of 2,736 real solicitations. v2 read `{3}` but
  // ended in `[0-9]{4}` and matched 859 of 2,736, missing every number whose serial ends in a
  // letter (SPE2DS26T294H). Both banner-rejection tests passed throughout, because a banner
  // fails on content type long before the canary is reached.
  //
  // Neither version was catchable by reading. @T2 found v1 by running it against the archived
  // 439,490-byte index; v2 fell to the same method. THE LESSON IS THE METHOD: a pattern that
  // encodes a claim about real-world data is only tested by real-world data.
  //
  // Current version measured against the real 2026-08-11 index: 2,721 of 2,736 distinct
  // SPE-prefixed tokens, whole file true, and BOTH captured consent banners false, which is
  // the negative control that actually matters for a canary.
  //
  // The 15 it does not match are a different identifier family (SPECIA*, SPECID*, SPECPL*,
  // SPECPM*, SPECPE*) reported to @T2, who owns the parse and can say whether they are
  // solicitations at all. They do not weaken the canary: this is a PRESENCE check on a sample,
  // and 2,721 hits is presence.
  // ─────────────────────────────────────────────────────────────────────────────────────
  canary: /SPE[0-9A-Z]{3}[0-9]{2}[A-Z][0-9A-Z]{4}/,
}

export type FeedResponseFacts = {
  status: number
  contentType: string | null
  /** The URL actually reached, AFTER redirects. */
  finalUrl: string
  /** A decoded prefix of the body. The whole body is never required to classify. */
  sample: string
}

/**
 * Classify a feed response.
 *
 * Deliberately takes FACTS rather than a Response, so it is fully testable offline against
 * captured bytes and cannot accidentally consume a stream a caller still needs.
 */
export function classifyFeedResponse(facts: FeedResponseFacts, shape: FeedShape): FeedVerdict {
  // 0. The redirect case first: both DIBBS hosts 302 every path to /dodwarning.aspx when
  //    consent has lapsed. If we only looked at the body we could not tell an expired session
  //    from a page that legitimately contains that word.
  if (/dodwarning\.aspx/i.test(facts.finalUrl)) {
    return {
      kind: 'consent_redirect',
      detail: `redirected to the consent page at ${facts.finalUrl}`,
    }
  }

  if (facts.status !== 200) {
    return { kind: 'assertion_failed', detail: `HTTP ${facts.status}` }
  }

  // 1. CONTENT TYPE. The feed is plain text; the banner is text/html. This is the cheapest
  //    honest discriminator and it comes first.
  const ct = (facts.contentType ?? '').toLowerCase()
  if (ct.includes('text/html')) {
    return {
      kind: 'consent_banner',
      detail:
        'the response is text/html, which the data feed never is. This is the consent banner ' +
        'served with HTTP 200.',
    }
  }

  // A banner served with a wrong or absent content type would slip past the check above, so
  // the body is checked for markup too rather than trusting the header alone.
  if (/<html|<!doctype html|dodwarning/i.test(facts.sample)) {
    return {
      kind: 'consent_banner',
      detail: 'the body contains HTML markup, so it is a page rather than a data feed',
    }
  }

  // 2. SHAPE. Fixed-width rows. A banner has no rows of the right width; a truncated file has
  //    a ragged final row.
  const lines = facts.sample.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) {
    return { kind: 'assertion_failed', detail: 'the response body is empty' }
  }
  const wrongWidth = lines.filter((l) => l.length !== shape.rowWidth)
  // The final line of a SAMPLE is legitimately partial, so one ragged row at the end is
  // tolerated; anything more means this is not the fixed-width feed.
  const tolerated = wrongWidth.length === 1 && wrongWidth[0] === lines[lines.length - 1]
  if (wrongWidth.length > 0 && !tolerated) {
    return {
      kind: 'assertion_failed',
      detail:
        `${wrongWidth.length} of ${lines.length} rows are not ${shape.rowWidth} characters wide, ` +
        `so this is not the fixed-width index`,
    }
  }

  // 3. COUNT BAND. Checked against the sample's own rows only when the sample is the whole
  //    body; a caller passing a prefix supplies the true count separately.
  const rows = tolerated ? lines.length - 1 : lines.length

  // 4. CANARY LAST. A canary alone would pass a truncated file containing one good row, which
  //    is why it is the final check rather than the only one.
  if (!shape.canary.test(facts.sample)) {
    return {
      kind: 'assertion_failed',
      detail: 'no solicitation number found in the sample, so the rows are not the expected data',
    }
  }

  return { kind: 'data', rows }
}

/**
 * THE BLOCK-PAGE MARKERS, measured from the two real interception pages this host serves.
 *
 * 'Warning and Consent' appears twice in each captured DoD banner (the 9,152-byte pages in
 * `data/archive/dibbs-consent-banner/`). 'Request Rejected' is the F5 ASM block page served
 * when the WAF fingerprints the client, previously measured live on this estate at roughly
 * 30 rapid requests. Neither phrase can appear in a fixed-width solicitation index, and a
 * body carrying either is an interception page regardless of every other signal.
 */
export const BLOCK_PAGE_MARKERS = /Warning and Consent|Request Rejected/i

/** The 4-byte zip local-file-header signature, PK\x03\x04, as raw bytes. */
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04])

/**
 * Count zip local-file-header signatures in a BUFFER, never through a string. The reason is
 * a measured production failure, not taste: the 2026-08-12 `ca` package is over 512 MB, and
 * `body.toString('latin1')` on it dies on V8's string-length ceiling (ERR_STRING_TOO_LONG
 * at 0x1fffffe8 characters). A native indexOf walk has no ceiling. On the real
 * bq260811.zip this equals its member count; compressed bytes can in principle collide
 * with the signature, so it is an entry-count measurement, not a parse.
 */
export function countZipLocalHeaders(body: Buffer): number {
  let count = 0
  let at = body.indexOf(ZIP_LOCAL_HEADER)
  while (at !== -1) {
    count += 1
    at = body.indexOf(ZIP_LOCAL_HEADER, at + 4)
  }
  return count
}

/**
 * Classify a ZIP feed response (the `bq` and `ca` daily files).
 *
 * The index classifier's fixed-width shape check would refuse every real zip, so binary
 * files get their own ladder: redirect, status, content type, HTML-and-block markers in the
 * decoded head, then the one property a zip cannot lack: the PK\x03\x04 local-file-header
 * magic at byte zero.
 *
 * `facts.sample` here is a decoded HEAD of the body, deliberately: an interception page is
 * small and its markers are in the first kilobytes or nowhere, compressed bytes further in
 * are effectively random and would eventually collide with any short phrase, and a daily
 * package can exceed V8's 512 MB string ceiling, so the whole body must never be decoded to
 * a string at all. `localHeaderCount` is measured on the raw buffer by
 * `countZipLocalHeaders` and passed in.
 */
export function classifyZipFeedResponse(
  facts: FeedResponseFacts,
  localHeaderCount: number,
): FeedVerdict {
  if (/dodwarning\.aspx/i.test(facts.finalUrl)) {
    return {
      kind: 'consent_redirect',
      detail: `redirected to the consent page at ${facts.finalUrl}`,
    }
  }
  if (facts.status !== 200) {
    return { kind: 'assertion_failed', detail: `HTTP ${facts.status}` }
  }
  const ct = (facts.contentType ?? '').toLowerCase()
  if (ct.includes('text/html')) {
    return {
      kind: 'consent_banner',
      detail:
        'the response is text/html, which a zip feed file never is. This is an interception ' +
        'page served with HTTP 200.',
    }
  }
  const head = facts.sample.slice(0, 65536)
  if (/<html|<!doctype html|dodwarning/i.test(head) || BLOCK_PAGE_MARKERS.test(head)) {
    return {
      kind: 'consent_banner',
      detail: 'the body opens with HTML or a block-page phrase, so it is a page, not a zip',
    }
  }
  if (!facts.sample.startsWith('PK\u0003\u0004')) {
    return {
      kind: 'assertion_failed',
      detail: 'the body does not begin with the zip local-file-header magic PK\\x03\\x04',
    }
  }
  if (localHeaderCount < 1) {
    return {
      kind: 'assertion_failed',
      detail: 'no zip local-file-header signature was found in the body',
    }
  }
  return { kind: 'data', rows: localHeaderCount }
}

/** Check a full-file row count against the band. Separate, because a sample cannot answer it. */
export function checkCountBand(rows: number, shape: FeedShape): FeedVerdict {
  if (rows < shape.countBand.min || rows > shape.countBand.max) {
    return {
      kind: 'assertion_failed',
      detail:
        `${rows} rows is outside the expected band of ${shape.countBand.min} to ` +
        `${shape.countBand.max}, so this is not a normal feed day`,
    }
  }
  return { kind: 'data', rows }
}
