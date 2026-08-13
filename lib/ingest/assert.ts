/**
 * T2 INGESTION. The assertion framework every load runs through.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: if an assertion has no plausible way to fail, it is
 * decoration. The dangerous run in this lane is not the crash, it is the run that completes
 * minus the rows nobody counted.
 *
 * TWO BOOLEANS ON EVERY PROBE (acceptance gate section 0 item 4). `probeLanded` says the
 * check actually ran against real input; `gateFired` says it reached a verdict. They are not
 * the same and collapsing them is how a check that silently skipped comes to read as a check
 * that passed. The first load of a new source has no history to build a row-count band from,
 * so that band assertion reports `probeLanded: false` and is visibly not evidence, rather
 * than quietly returning green.
 */

import type { AssertionResult } from './types'

/** A check that ran and reached a verdict. */
export function assertion(
  id: string,
  description: string,
  passed: boolean,
  expected: string,
  actual: string,
): AssertionResult {
  return { id, description, probeLanded: true, gateFired: true, passed, expected, actual }
}

/**
 * A check that could not run, and says so.
 *
 * Used where the input for the check genuinely does not exist yet, most commonly the
 * row-count band on the first load of a source. It is recorded as NOT passed, because an
 * assertion that never ran is not a passing assertion; it is an absent one.
 */
export function notLanded(id: string, description: string, why: string): AssertionResult {
  return {
    id,
    description,
    probeLanded: false,
    gateFired: false,
    passed: false,
    expected: 'a verdict',
    actual: `did not run: ${why}`,
  }
}

/**
 * THE CONTENT LADDER. Assert in this order, because status is the weakest signal available.
 *
 * DIBBS serves the DoD consent banner as HTTP 200, `text/html`, at the exact URL of the data
 * file. A loader that checks the status code ingests a web page as the day's requirements.
 * Measured twice on this estate: 9,152 bytes in the research pass, 9,032 bytes live on
 * 2026-08-12, and two archived captures of identical length carry different SHA-256 hashes
 * because the banner embeds the target path. So length is not a detector either. Only the
 * shape of the content is.
 */
export function assertNotAConsentBanner(
  id: string,
  bytes: Buffer | string,
  declaredContentType: string | null,
): AssertionResult {
  const head = (typeof bytes === 'string' ? bytes : bytes.toString('latin1', 0, 2048))
    .slice(0, 2048)
    .toLowerCase()
  const looksLikeHtml =
    head.includes('<!doctype html') ||
    head.includes('<html') ||
    head.includes('dodwarning') ||
    head.includes('__viewstate')
  const contentTypeIsHtml = (declaredContentType ?? '').toLowerCase().includes('text/html')
  const isBanner = looksLikeHtml || contentTypeIsHtml
  return assertion(
    id,
    'payload is data, not the DoD consent banner served at the data URL',
    !isBanner,
    'no HTML markers, content type not text/html',
    isBanner
      ? `HTML markers present or content type ${declaredContentType ?? 'unknown'}: this is the consent banner, not data`
      : `content type ${declaredContentType ?? 'unstated'}, no HTML markers in first 2 KB`,
  )
}

/**
 * Row count inside a band derived from prior loads.
 *
 * `history` is the row counts of previous successful loads of this source. With fewer than
 * two prior loads there is no band to speak of and the check reports that it did not land.
 * The band is deliberately wide (half to double the median) because a real feed day varies;
 * the point is catching a load that returned 12 rows or a whole extra file, not policing
 * normal variation.
 */
export function assertRowCountBand(
  id: string,
  actualRows: number,
  history: number[],
): AssertionResult {
  if (history.length < 2) {
    return notLanded(
      id,
      'row count inside the band derived from prior loads',
      `only ${history.length} prior load(s) recorded, a band needs at least 2`,
    )
  }
  const sorted = [...history].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0)
  const low = Math.floor(median * 0.5)
  const high = Math.ceil(median * 2)
  const ok = actualRows >= low && actualRows <= high
  return assertion(
    id,
    'row count inside the band derived from prior loads',
    ok,
    `between ${low} and ${high} (median ${median} of ${history.length} prior loads)`,
    String(actualRows),
  )
}

/** Did every assertion that reached a verdict pass, and did they all actually run. */
export function allPassed(results: AssertionResult[]): boolean {
  return results.every((r) => r.probeLanded && r.gateFired && r.passed)
}

/**
 * Assertions that LANDED and FAILED. These, and only these, mean the data is suspect.
 *
 * An assertion that never landed is a gap in coverage, not evidence of a bad load, and
 * conflating the two marks every first load of a new source as degraded forever. The gap is
 * still reported: `failures()` returns it, the ledger stores it, and the freshness surface
 * shows it. It just does not condemn the rows.
 */
export function landedFailures(results: AssertionResult[]): AssertionResult[] {
  return results.filter((r) => r.probeLanded && r.gateFired && !r.passed)
}

/** The ones that failed or never ran, for an operator to read at 6am. */
export function failures(results: AssertionResult[]): AssertionResult[] {
  return results.filter((r) => !(r.probeLanded && r.gateFired && r.passed))
}
