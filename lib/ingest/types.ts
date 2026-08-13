/**
 * T2 INGESTION. The closed vocabularies and record shapes every loader shares.
 *
 * Runtime-neutral on purpose: no `next` import, no `server-only`, no serverless assumption.
 * These modules run in the Next server, in vitest, and in a long-running loader process on
 * the box, and they must behave identically in all three. Hosting is one always-on Linux
 * server, so there is no wall-clock ceiling to design around, but there is also no platform
 * to hide behind: a load either proves what it did or it did not happen.
 *
 * Every enum here is CLOSED. A status, a failure kind or a state that is a free string is a
 * status nobody can alarm on, and the first thing that rots in an ingest layer is the
 * vocabulary its own operators read at 6am.
 */

/**
 * THE HONEST-STATE VOCABULARY. Quality Bar law 1, closed set.
 *
 * Every surface in the product resolves to one of these in place of a fabricated or silently
 * defaulted value. A held-back row, an unloaded source and a lapsed feed each read as a named
 * state, never as a zero, a blank or a guess.
 */
export const NAMED_STATES = [
  'ok',
  'empty',
  'insufficient',
  'stale',
  'degraded',
  'refused',
  'offline',
  'over_quota',
] as const
export type NamedState = (typeof NAMED_STATES)[number]

/** What a run did. `partial` is a first-class outcome, not a rounding of success. */
export const INGEST_STATUSES = [
  'running',
  'succeeded',
  'partial',
  'failed',
  'skipped_no_publish',
] as const
export type IngestStatus = (typeof INGEST_STATUSES)[number]

/**
 * WHY a run failed, as five distinct operator responses rather than one red dot.
 *
 * These are not decoration. At 6am "consent expired" means re-mint a session, "layout
 * changed" means stop every load on this source and read a diff, and "assertion failed"
 * means the bytes arrived and lied. One generic error string collapses three different
 * mornings into the same shrug.
 */
export const INGEST_FAILURES = [
  'none',
  'source_unreachable',
  'consent_expired',
  'layout_changed',
  'assertion_failed',
  'partially_loaded',
  'archive_unreadable',
] as const
export type IngestFailure = (typeof INGEST_FAILURES)[number]

/**
 * How a byte reached us. NEVER upgraded to flatter a capture.
 *
 * `research_capture` means a human or an earlier session retrieved it and we adopted the
 * bytes. `pipeline_fetch` means our own client, through the consent handshake, on a
 * schedule. Relabeling the first as the second is a fabricated measurement, and this lane
 * exists so the estate can say which one it is looking at.
 */
export const RETRIEVAL_METHODS = ['pipeline_fetch', 'research_capture', 'manual_upload'] as const
export type RetrievalMethod = (typeof RETRIEVAL_METHODS)[number]

/**
 * Authorship of a span of corpus text. Closed at five values.
 *
 * The expert corpus interleaves the expert's own reasoning with a forwarder's commentary and
 * with pasted chatbot output. Attributing a machine's paraphrase to the expert, in a product
 * whose purpose is teaching his successors, is the worst failure available to the retrieval
 * layer. The taxonomy does not grow to hold a second human: any human author who is not the
 * expert is `counterparty`.
 */
export const AUTHOR_CLASSES = [
  'wayne',
  'counterparty',
  'pasted_ai',
  'quoted_source',
  'attachment_text',
] as const
export type AuthorClass = (typeof AUTHOR_CLASSES)[number]

/**
 * A row held back from a load, with everything needed to explain and to release it.
 *
 * Quarantine is a worklist, not a graveyard. A quarantined row keeps the raw source line and
 * its byte offset so an operator can be shown the actual text that failed, and so a fixed
 * parser can replay it. Nothing is ever dropped and nothing is ever silently coerced.
 */
export type QuarantineRow = {
  sourceKey: string
  /** The archived object the line came from. Provenance is not optional. */
  storageKey: string
  logicalDate: string
  /** 1-based, as a human counts lines in a file. */
  lineNo: number
  byteOffset: number
  rawLine: string
  ruleId: string
  severity: 'reject' | 'warn'
  detail: string
}

/**
 * One assertion result. TWO BOOLEANS, ALWAYS, per acceptance gate section 0 item 4.
 *
 * `probeLanded` says the check actually ran against real input. `gateFired` says it reached
 * a verdict. A probe that never landed proves nothing, and reporting only a verdict lets a
 * check that silently skipped read as a check that passed. This is the difference between an
 * instrument and a decoration.
 */
export type AssertionResult = {
  id: string
  description: string
  probeLanded: boolean
  gateFired: boolean
  passed: boolean
  expected: string
  actual: string
}

/** An immutable record of one load attempt. Written once, never updated. */
export type RunLedgerRow = {
  runId: string
  sourceKey: string
  logicalDate: string
  attempt: number
  startedAt: string
  finishedAt: string | null
  status: IngestStatus
  failureKind: IngestFailure
  rowsIn: number
  rowsLoaded: number
  rowsQuarantined: number
  assertions: AssertionResult[]
  codeVersion: string
  /** The archive key of the bytes this run read. A run with no bytes names none. */
  storageKey: string | null
  note: string | null
}

/**
 * A requirement observation from the DIBBS daily index file.
 *
 * OBSERVATION, NOT STATE. Keyed on (solicitationNumber, nsnRaw, prNumber) plus source and
 * observedAt. A snapshot is not a change feed, so a row is never updated in place and never
 * deleted because a later file stopped mentioning it.
 *
 * THE NATURAL KEY IS MEASURED, NOT ASSUMED. On the real feed day 2026-08-11:
 * 3,095 rows carry only 2,721 distinct solicitation numbers, one appearing 23 times, because
 * DLA bundles many purchase requests under one solicitation. (solicitation, pr) collides too.
 * (solicitation, nsn, pr) is unique at 3,095/3,095. Keying on solicitation alone silently
 * discards 374 rows on day one.
 */
export type RequirementObservation = {
  solicitationNumber: string
  /** The 13 digit NSN exactly as the file carried it. Kept so an operator can find their row. */
  nsnRaw: string
  /** THE key for every shared table. Nine digits. Null when the file's NSN did not parse. */
  niin: string | null
  fsc: string | null
  /** Blank on all 3,095 rows of the measured day. A part-numbered path exists and is rare. */
  partNumber: string | null
  prNumber: string
  /** ISO date. The file carries MM/DD/YY and the century is inferred, see parser notes. */
  returnBy: string | null
  quantity: number | null
  unitOfIssue: string
  /** Truncated to 21 characters by the publisher. Never padded out or guessed at. */
  nomenclature: string
  solicitationPdfName: string
  codeBlock: string
  /**
   * The 8th character of the code block. VERIFIED binary only.
   *
   * `N` versus not-`N` is confirmed: across 205 recovered solicitation PDFs whose code was
   * `N`, zero carried FAR 52.219-6 (Notice of Total Small Business Set-Aside). The specific
   * program decode is NOT confirmed: `Y` carried 52.219-6 on only 6 of 10 samples, and no
   * `H`, `L` or `E` solicitation was recoverable at all. Carry the raw character; let no lane
   * render a program name off it.
   */
  setAsideCode: string
  /** The confirmed binary. True means restricted in some way, not which way. */
  setAsideRestricted: boolean
  observedAt: string
  sourceKey: string
  storageKey: string
  lineNo: number
}

/**
 * An approved-source observation: which company and part number DLA will accept for an item.
 *
 * The highest-value artifact in the free feed. One day's file holds only that day's board, so
 * accumulating it produces a longitudinal table no single day contains. Modeled as
 * observations for exactly that reason.
 */
export type ApprovedSourceObservation = {
  nsnRaw: string
  niin: string | null
  cage: string | null
  partNumber: string
  observedAt: string
  sourceKey: string
  storageKey: string
  lineNo: number
}

/**
 * A quote-file line. One row per CLIN, which is a DIFFERENT grain from the index file.
 *
 * Measured on the same real day: (solicitation, CLIN) is unique at 3,274/3,274, while
 * (solicitation, pr) is not unique here either (108 pairs twice, 26 three times, 6 four
 * times). The index file carries no CLIN at all. The two files therefore do NOT join on
 * solicitation, and do not join on (solicitation, pr).
 */
export type QuoteLineObservation = {
  solicitationNumber: string
  clin: string
  prNumber: string
  nsnRaw: string
  niin: string | null
  unitOfIssue: string
  quantity: number | null
  returnBy: string | null
  /**
   * Delivery days After Date of Order. CONFIRMED against primary source, not inferred.
   *
   * Verified by comparing field [50] against Block 6 "DELIVER BY (Date)" of the actual
   * solicitation PDF for every recoverable document of feed day 2026-08-11: 216 matches, 0
   * mismatches, across 18 distinct values including 81, 97, 163 and 183, which excludes
   * coincidence. This is the input to the expert's third signal: fewer delivery days means
   * material already sitting on a shelf.
   */
  deliveryDaysAdo: number | null
  itemSourceCategory: string
  observedAt: string
  sourceKey: string
  storageKey: string
  lineNo: number
}

/** Everything one parse produced, including what it refused to load. */
export type ParseResult<T> = {
  rows: T[]
  quarantined: QuarantineRow[]
  assertions: AssertionResult[]
  /** Physical lines read, which is NOT always the number of records. */
  linesRead: number
}
