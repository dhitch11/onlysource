/**
 * THE WINDOW. THE UNION OF EVERY SERVABLE ARCHIVED DAY, DEDUPLICATED BY STOCK NUMBER.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS EXISTS: ONE DAY IS 3% OF WHAT WE HOLD, AND WHICH 3% DEPENDS ON THE WEEKDAY
 * ---------------------------------------------------------------------------------------
 * Serving a single feed day was correct about freshness and wrong about coverage, and the
 * measurement is not close. Across the twenty days this archive holds, MEASURED:
 *
 *     total published index lines                39,223
 *     distinct stock numbers (this module's key) 29,159
 *     appear on exactly ONE of the twenty days   24,530   (84.1%)
 *     the newest day alone (2026-08-14)             277 distinct stock numbers
 *     the window is therefore                     105.3x the newest day
 *
 * Consecutive days are very nearly DISJOINT. The DIBBS daily index publishes the
 * requirements ISSUED that day, so a solicitation appears once, on its issue day, and its
 * close date falls a fortnight later. Serving one day therefore discards ~28,880 stock
 * numbers already on disk, and because Friday is the publishing trough (231, 313, 228 and
 * 331 rows on the four archived Fridays, against 1,071-5,488 Monday to Thursday) the board's
 * size swung 10-20x by weekday. An operator who opened it on a Friday saw a product that
 * looked broken.
 *
 * Those figures are a reading of ONE archive state, twenty days ending 2026-08-14. Nothing in
 * this module is calibrated on them: the day count, the day list and every derived total are
 * read from whatever the archive holds at call time, so a twenty-first capture landing changes
 * the numbers and changes no code.
 *
 * ---------------------------------------------------------------------------------------
 * THE SEVEN RULES THIS MODULE IS BUILT ON
 * ---------------------------------------------------------------------------------------
 * 1. PROVENANCE STAYS EXACT. A single day traced a rendered number to one archived
 *    government byte. The window traces it to a NAMED DAY inside the window: every row
 *    carries `sourceDay`, the day its DISPLAYED values were published on, and `days[]`
 *    resolves that day to its archived storage key, member and recorded hash. The chain has
 *    no derived file in it and no averaging anywhere.
 *
 * 2. NEWEST OBSERVATION WINS FOR DISPLAY, AND THE CHANGE IS CARRIED. 5,002 stock numbers
 *    were published with a different quantity, close date, solicitation number or
 *    nomenclature on different days. Averaging would invent a number nobody published;
 *    silently picking one would hide that DLA changed the buy. So the newest published line
 *    is displayed and `changes[]` carries the full per-day history of every field that moved.
 *    `summary.changedAcrossDays` reads 5,350 rather than 5,002, and the gap is not an error:
 *    this module tracks SIX fields and the sentence above names four, so 348 rows moved only
 *    their unit of issue or their purchase-request number. Re-measured 2026-08-18: closeDate
 *    4,535, purchaseRequest 3,182, solicitation 3,114, quantity 2,381, nomenclature 459.
 *
 * 3. A ROW RETIRES HONESTLY, AGAINST THE GOVERNMENT'S OWN CLOSE DATE. Every index line in
 *    this archive carries a return date (39,223 of 39,223 parse at MM/DD/YY), so retirement
 *    is decided by that date, not by a row quietly vanishing. Re-measured 2026-08-18 against
 *    the newest held day, 2026-08-14: 14,539 stock numbers have already closed and 14,620 have
 *    not. This paragraph read 14,553 and 14,606 when the module was written and those figures
 *    did NOT reproduce; the totals agree, the split moves by 14, and the boundary rule is not
 *    the explanation (861 rows close exactly ON the reference day and every one of them is
 *    open, because a solicitation closing today has not closed). Whatever produced the older
 *    pair, the numbers above are what this code returns from this archive today.
 *
 *    THE BOUNDARY IS `closeDate < asOf`, deliberately. A row closing on the reference day is
 *    OPEN. A closed row is LABELLED closed and kept, because a row that disappears without
 *    explanation is how an operator stops trusting a board.
 *
 *    AND THE REFERENCE DAY IS THE CALLER'S, NOT THIS MODULE'S. `unionFeedDays` can only know
 *    the newest day it was handed, so that is what it stamps; `openDemand` re-judges against
 *    the day its caller names and rewrites the stamp to match. Judging a board against the
 *    newest ARCHIVED day is only correct on the morning the capture lands. Measured on this
 *    machine 2026-08-18, with the newest archived day 2026-08-14: 5,122 of the 10,488 rows the
 *    board served, 48.8%, had a government-published return date that had already gone, under
 *    a grid header reading "under open DLA demand" and a funnel hint reading "DLA is buying it
 *    now". Every day the capture does not run, that number grows and nothing says so.
 *
 * 4. A MALFORMED STOCK NUMBER IS A FIRST-CLASS ROW. `lib/ingest/parse/dibbs.ts` already
 *    records that these "are not well-formed 13-digit NSNs and they are REAL requirements".
 *    Measured across the window: 229 published lines resolving to 187 distinct non-standard
 *    stock numbers, plus 1 line carrying a bare 9-digit NIIN with no supply class, and ZERO
 *    blank cells. They are keyed on their own raw value, labelled so nobody reads one as an
 *    NSN, and NEVER coerced onto a neighbouring key -- attaching another item's data rights
 *    to a requirement is the expensive direction of this error. Catalogue joins that need a
 *    well-formed NSN abstain visibly on them instead of dropping them.
 *
 * 5. THE GRAIN IS KNOWN AND STAYS KNOWN. Across the window, NIIN-grain (28,969) and
 *    NSN-grain (28,971) differ by exactly 2: two NIINs are published under two different
 *    supply classes. This module keys on the FULL stock number, so those two stay separate
 *    here; the approved-source join downstream is NIIN-grain and cannot distinguish them, so
 *    `niinsUnderMultipleFscs` counts them and the affected corner rows name it as a gap. Two
 *    is a small number. The point is that it is a KNOWN number and must not become an
 *    unknown one as the window grows.
 *
 * 6. THE UNION IS NOT THE DEMAND, AND THE DEMAND IS DATED. `openDemand()` is the only door
 *    between this module and a board, and it exists because rule 3 keeps closed rows. MEASURED
 *    on the twenty days: 14,620 of the 29,159 stock numbers were still open against the newest
 *    held day and 14,539 had already closed, so a caller that served the raw union would put a
 *    fortnight of expired solicitations on a screen that says "DLA is buying this now". That is
 *    a larger and more embarrassing inaccuracy than the thin single day it replaced. A row with
 *    no readable close date is excluded from demand as well: a blank is not an open
 *    solicitation, it is a publisher that did not answer, and the two must never render alike.
 *
 *    `openDemand` takes a `DemandReference`, a day AND a sentence saying what that day is, and
 *    both travel out on `OpenDemand.statement` so the count on the screen carries the instant
 *    it was true at. A day with no stated basis is how the first version of this door judged
 *    an August board against a four-day-old capture and told nobody.
 *
 * 7. BOTH NUMBERS OR NEITHER. A count that grows sixty-fold overnight with no stated basis
 *    destroys more trust than the small count did. `coverage` carries the first day, the last
 *    day, the day list, the day count and the newest day's own size against the window's own
 *    mean, and `coverageStatement()` is the single definition of the sentence, so a surface
 *    can say, as the Monopoly Map now can, "562 candidate corners across twenty days captured
 *    2026-07-17 to 2026-08-14, of which the newest day alone accounts for 18" rather than an
 *    unexplained 562 where 18 stood yesterday.
 *    The thin-day disclosure is part of that: this archive's Fridays publish roughly a sixth
 *    of the mean, and until now a starved Friday rendered exactly as confidently as a rich
 *    Tuesday because nothing in the product had ever compared two days.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT THIS MODULE DOES NOT DO
 * ---------------------------------------------------------------------------------------
 * It does not replace `lib/intelligence/feed-day.ts` and it does not weaken it. Every day in
 * the window is admitted through `resolveFeedDayInputs`, the identical byte-re-verification
 * and parse-verification the single-day path runs, and single-day resolution stays exported
 * and tested so a suite can keep pinning measured values to one immutable archived day.
 *
 * It reads NO CLOCK, and it never will. Every retirement judgement in here is a string
 * comparison against a reference day the CALLER supplies, so this module stays a pure function
 * of its inputs: a test can pin any instant it likes, and the value that ships is computed once
 * on the server and travels as static text, so it cannot differ between the server that
 * rendered it and the browser that hydrated it. Reading the clock is the serving path's job
 * (`lib/intelligence/datasets.ts`), and the day it reads has to reach the memo key there or the
 * answer freezes at the first request of the process.
 */

import { discoverFeedDays, type FeedDayDiscovery } from '@/lib/ingest/feed-days'

import type { Cage, Fsc, Niin } from './niin'
import { parseNsn } from './niin'
import type { ApprovedSourceEntry, ApprovedSourceIndex, IndexRow } from './seed/feed'
import { resolveFeedDayInputs, type ServedFeedDay, type SkippedFeedDay } from './feed-day'

/* ------------------------------------------------------------------------------------ */
/* THE KEY                                                                               */
/* ------------------------------------------------------------------------------------ */

export type StockKeyKind =
  /** A well-formed 13-digit stock number: supply class + NIIN. Joins to everything. */
  | 'nsn'
  /** A bare 9-digit NIIN with no supply class published. Joins on NIIN; has no class. */
  | 'niin_only'
  /** Anything else the file carried. A real requirement under a locally assigned number. */
  | 'non_standard'

export type StockIdentity = {
  /** Namespaced so a non-standard value can never collide with a real stock number. */
  key: string
  kind: StockKeyKind
  /** Exactly what the government file carried, trimmed. Never normalised away. */
  raw: string
  niin: Niin | null
  fsc: Fsc | null
}

/**
 * THE WARNING THAT MUST TRAVEL WITH A NON-STANDARD STOCK NUMBER.
 *
 * A FUNCTION, NOT A STORED STRING, and the same is true of `lifecycleStatement` and
 * `closeDateBasis` below. The window carries 29,159 rows; a 190-character sentence stored on
 * each of them is 5.5MB of identical prose on the wire to say something derivable from a
 * one-word enum. The wire carries FACTS and the render layer turns them into copy, which also
 * means the copy has exactly one definition instead of one per surface.
 *
 * Returns null for a real NSN, so `label ?? ''` renders nothing rather than a reassurance.
 */
export function stockKeyLabel(kind: StockKeyKind): string | null {
  switch (kind) {
    case 'nsn':
      return null
    case 'niin_only':
      return 'published as a bare 9-digit item number with no federal supply class, so no class-level join is possible on this row'
    case 'non_standard':
      return 'locally assigned or non-standard stock number, not a 13-digit NSN: a real requirement that cannot be joined to the national catalogue'
  }
}

/**
 * Resolve one published stock-number cell to the key the window deduplicates on.
 *
 * A well-formed value keys on all thirteen digits, NOT on the NIIN, so two supply classes
 * over one NIIN stay two catalogue items here (see rule 5 above).
 *
 * A value that is not a stock number keys on itself, with separators stripped and letters
 * kept, so `1560-LL-NC0-0755` and `1560LLNC00755` dedupe to one requirement while nothing is
 * ever coerced onto a numeric key: `parseNsn` has already refused this value, so it either
 * carries a non-digit or is the wrong length, and the `x:` namespace keeps it out of the
 * `nsn:` space regardless.
 *
 * Returns null ONLY for an empty cell. Measured across the window: zero of 39,223 lines.
 */
export function stockIdentity(cell: string | null | undefined): StockIdentity | null {
  const raw = (cell ?? '').trim()
  if (raw === '') return null

  const parsed = parseNsn(raw)
  if (parsed && parsed.fsc != null) {
    return { key: `nsn:${parsed.fsc}${parsed.niin}`, kind: 'nsn', raw, niin: parsed.niin, fsc: parsed.fsc }
  }
  if (parsed) {
    return { key: `niin:${parsed.niin}`, kind: 'niin_only', raw, niin: parsed.niin, fsc: null }
  }
  return {
    key: `x:${raw.toUpperCase().replace(/[-/\s.]/g, '')}`,
    kind: 'non_standard',
    raw,
    niin: null,
    fsc: null,
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE PUBLISHED RETURN DATE                                                             */
/* ------------------------------------------------------------------------------------ */

const RETURN_DATE_SHAPE = /^(\d{2})\/(\d{2})\/(\d{2})$/

export type ParsedReturnDate = {
  /** ISO `YYYY-MM-DD`, or null when the published cell is not a readable date. */
  iso: string | null
  /** What was read, or why nothing was. Rendered beside the date, never hidden. */
  basis: string
}

/**
 * Read the index's own return date, `MM/DD/YY`, into ISO.
 *
 * THE CENTURY IS PIVOTED OFF THE PUBLISHING DAY, NOT HARDCODED. A literal `20${yy}` is
 * correct today and silently wrong from 2100, which is the hardcoded-list defect with a
 * long fuse on it. The two-digit year is resolved to whichever century puts it within fifty
 * years of the feed day that published it, which is derived from the data and needs no
 * maintenance. Measured across this window: 39,222 lines carry `26` and one carries `25`.
 *
 * The result is calendar-checked by round trip, so `02/30/26` is refused rather than
 * silently rolling into March.
 */
export function parseIndexReturnDate(cell: string, feedDay: string): ParsedReturnDate {
  const raw = (cell ?? '').trim()
  if (raw === '') return { iso: null, basis: 'the published line carried no return date' }
  const m = RETURN_DATE_SHAPE.exec(raw)
  if (!m) return { iso: null, basis: `the published return date "${raw}" is not in the MM/DD/YY shape this index uses` }

  const mm = Number(m[1])
  const dd = Number(m[2])
  const yy = Number(m[3])
  const pivotYear = Number(feedDay.slice(0, 4))
  if (!Number.isFinite(pivotYear)) {
    return { iso: null, basis: `the feed day "${feedDay}" carries no year to resolve the two-digit year against` }
  }

  let year = Math.floor(pivotYear / 100) * 100 + yy
  if (year - pivotYear > 50) year -= 100
  else if (pivotYear - year > 50) year += 100

  const asDate = new Date(Date.UTC(year, mm - 1, dd))
  const roundTripped =
    asDate.getUTCFullYear() === year && asDate.getUTCMonth() === mm - 1 && asDate.getUTCDate() === dd
  if (!roundTripped) {
    return { iso: null, basis: `the published return date "${raw}" is not a real calendar date` }
  }

  const iso = `${String(year).padStart(4, '0')}-${m[1]}-${m[2]}`
  return { iso, basis: `return date ${raw} as published on the ${feedDay} index` }
}

/* ------------------------------------------------------------------------------------ */
/* RETIREMENT                                                                            */
/* ------------------------------------------------------------------------------------ */

export type LifecycleStatus =
  /** The government's own stated close date has not passed as of the reference day. */
  | 'open'
  /** The government's own stated close date HAS passed. Kept, labelled, never shown current. */
  | 'closed'
  /** No readable close date. All we can honestly say is the day it was last published. */
  | 'last_seen_only'

export type RowLifecycle = {
  status: LifecycleStatus
  /** ISO close date from the NEWEST observation, or null. Never inferred, never averaged. */
  closeDate: string | null
  /**
   * THE DAY THIS JUDGEMENT WAS MADE AGAINST, and it is not always the newest archived day.
   *
   * `unionFeedDays` stamps the newest archived day here, because that is the only instant the
   * union itself knows about. `openDemand` RE-JUDGES against the reference day its caller
   * supplies and rewrites this field to match, because the serving path judges retirement
   * against the day the page is computed on. The two are different claims and this field is
   * the discriminator, so nothing downstream may assume it names a feed day.
   */
  asOf: string
  /** Whether this stock number appears on the newest archived day's index. A fact, not a warning. */
  onNewestDay: boolean
}

/**
 * Judge one row's retirement against a reference day.
 *
 * THE REFERENCE DAY IS AN ARGUMENT, NOT A CONVENTION, AND THE CALLER OWNS IT. Judging the
 * whole archive against the newest day the archive HOLDS is correct only on the morning the
 * capture lands: every day the capture does not run, a board judged that way keeps serving
 * solicitations whose government-published return date has already gone, and the error grows
 * silently with the staleness. Measured on this machine on 2026-08-18 against an archive whose
 * newest day was 2026-08-14: 5,122 of 10,488 served rows, 48.8%, had already closed while the
 * grid header read "under open DLA demand". So `openDemand` takes the day the page is computed
 * on, and this function is the one place the comparison is written.
 *
 * No clock is read here or anywhere in this module. The day arrives as a string, so the
 * function stays a pure comparison that a test can pin to any instant it likes.
 */
export function lifecycleAsOf(input: {
  closeDate: string | null
  onNewestDay: boolean
  asOf: string
}): RowLifecycle {
  const { closeDate, onNewestDay, asOf } = input
  if (closeDate == null) return { status: 'last_seen_only', closeDate: null, asOf, onNewestDay }
  if (closeDate < asOf) return { status: 'closed', closeDate, asOf, onNewestDay }
  return { status: 'open', closeDate, asOf, onNewestDay }
}

/**
 * THE OPERATOR SENTENCE FOR A ROW'S RETIREMENT. The single definition of this copy.
 *
 * ISO dates only, no locale formatting anywhere and no clock read, so it renders identically
 * on a UTC server and in a browser in any timezone. That is deliberate: `toLocale*` across the
 * hydration boundary is a defect class this repository has already shipped three times.
 *
 * A closed row says CLOSED and says when. It is never dropped and never shown as current: an
 * opportunity that disappears without explanation is how an operator stops trusting a board.
 */
export function lifecycleStatement(lifecycle: RowLifecycle, lastSeen: string): string {
  const { status, closeDate, asOf, onNewestDay } = lifecycle
  if (status === 'last_seen_only') {
    return `No readable close date in the published line. Last published on the ${lastSeen} index. Whether it is still open is not something this data answers.`
  }
  // `asOf` is the day the judgement was made against and is NOT necessarily a feed day, so
  // this copy says what it is rather than naming it as a capture. The earlier wording read
  // "the newest feed day held", which became false the moment the serving path started
  // judging retirement against the day the page is computed on.
  if (status === 'closed') {
    return `Closed ${closeDate}. Its own published return date had already passed on ${asOf}, the day this was judged against. Kept as history, not as a live opportunity.`
  }
  return onNewestDay
    ? `Open until ${closeDate}, judged against ${asOf}. Published on the newest feed day held, ${lastSeen}.`
    : `Open until ${closeDate}, judged against ${asOf}. Published on the ${lastSeen} index; the daily index lists the requirements ISSUED that day, so a later day not repeating it is expected and is not a withdrawal.`
}

/**
 * How a row's close date was read, for the provenance line beside it. A function for the same
 * reason as the sentence above: 29,159 stored copies of "return date 08/25/26 as published on
 * the 2026-08-12 index" is 1.3MB of derivable string.
 */
export function closeDateBasis(returnDateCell: string, sourceDay: string): string {
  return parseIndexReturnDate(returnDateCell, sourceDay).basis
}

/* ------------------------------------------------------------------------------------ */
/* THE ROW                                                                               */
/* ------------------------------------------------------------------------------------ */

export type WindowFieldName =
  | 'quantity'
  | 'closeDate'
  | 'solicitation'
  | 'nomenclature'
  | 'unitOfIssue'
  | 'purchaseRequest'

export type FieldChange = {
  field: WindowFieldName
  /** Oldest first, each value tied to the feed day that published it. Never averaged. */
  history: Array<{ feedDay: string; value: string }>
}

export type RowWindow = {
  key: string
  keyKind: StockKeyKind
  /** The stock number exactly as published on the newest observation. */
  rawStockNumber: string
  niin: Niin | null
  fsc: Fsc | null
  firstSeen: string
  lastSeen: string
  /** Every feed day this stock number was published on, oldest first. */
  observedDays: string[]
  daysObserved: number
  /** Published lines across the window. Can exceed daysObserved: one day can carry two. */
  observations: number
  /** Distinct solicitation numbers seen. >1 means DLA re-solicited it: a standing requirement. */
  solicitations: string[]
  distinctSolicitations: number
  /** TRUE when DLA issued more than one solicitation for this item inside the window. */
  recurring: boolean
  /**
   * THE DAY THE DISPLAYED VALUES CAME FROM. Resolve it through `dayProvenance()` to reach the
   * archived storage key, member and recorded hash. Carried as a day rather than as a repeated
   * storage key because 29,159 copies of a 60-character path is 1.7MB of identical strings.
   */
  sourceDay: string
  /** Only fields that ACTUALLY differed across days. Empty on 24,157 of 29,159 rows. */
  changes: FieldChange[]
  lifecycle: RowLifecycle
}

/**
 * The newest published line for a stock number, with its window context attached.
 *
 * Structurally a superset of `IndexRow`, deliberately: `WindowedIndex` is assignable to
 * `DailyIndex`, so every consumer written against a single day keeps working unchanged and
 * only the consumers that want window data name the wider type.
 */
export type WindowRow = IndexRow & { window: RowWindow }

export type WindowedIndex = {
  rows: WindowRow[]
  byNiin: Map<Niin, WindowRow[]>
  byKey: Map<string, WindowRow>
  /** Summed across the window. A shape drift on any day is loud rather than averaged away. */
  offWidthRows: number
  /** Published lines whose stock cell is not a well-formed NSN. They are SERVED, not dropped. */
  unparsedNsn: number
}

/* ------------------------------------------------------------------------------------ */
/* THE APPROVED-SOURCE UNION                                                             */
/* ------------------------------------------------------------------------------------ */

export type ApprovedSourceWindow = {
  /** The newest day that published an approved-source row for this item. */
  sourceDay: string
  cages: Cage[]
  /**
   * The newest day's published rows for this item, VERBATIM, so the part numbers the
   * government file carried survive the union. An earlier draft of this module rebuilt the
   * entries from the cage list alone and wrote `nsn: niin` with `partNumber: ''`, which put a
   * nine-digit item number in a field named for the thirteen-digit stock number and an empty
   * string where a part number would be read. Both are placeholders in slots that belong to
   * the publisher, and a downstream reader cannot tell either one from a real value.
   */
  entries: ApprovedSourceEntry[]
  firstSeen: string
  lastSeen: string
  daysObserved: number
  /** TRUE when the approved set differed across days. Measured: 35 items of 21,137. */
  changed: boolean
  /** Populated only when `changed`, oldest first. */
  history: Array<{ feedDay: string; cages: Cage[] }>
}

export type WindowedApprovedSourceIndex = ApprovedSourceIndex & {
  windowByNiin: Map<Niin, ApprovedSourceWindow>
}

/* ------------------------------------------------------------------------------------ */
/* THE WINDOW                                                                            */
/* ------------------------------------------------------------------------------------ */

export type WindowDay = {
  feedDay: string
  indexStorageKey: string
  archiveStorageKey: string
  archiveMember: string
  archiveSha256: string | null
  retrievedAt: string
  /** Lines that day's index published. The weekday swing is visible in this column. */
  indexRows: number
  /** Stock numbers that day contributed to the union for the FIRST time. */
  newStockNumbers: number
}

export type WindowSummary = {
  distinctStockNumbers: number
  wellFormedNsn: number
  bareNiinOnly: number
  nonStandard: number
  /** Published lines across every day. rows.length is the DEDUPLICATED count. */
  observations: number
  seenOnOneDayOnly: number
  recurring: number
  /**
   * Lifecycle counted against THE NEWEST ARCHIVED DAY, which is the only instant the union
   * itself knows. The board is narrowed by `openDemand` against the day it is computed on, so
   * these three and `coverage.excludedFromDemand` will disagree whenever a capture has been
   * missed. That disagreement is the staleness, not an error, and neither figure may be quoted
   * as the other.
   */
  open: number
  closed: number
  lastSeenOnly: number
  onNewestDay: number
  changedAcrossDays: number
  niinGrain: number
  nsnGrain: number
  /** Two NIINs published under two supply classes. Known, counted, never silently merged. */
  niinsUnderMultipleFscs: number
}

/**
 * The union itself, with no knowledge of where the days came from.
 *
 * `unionFeedDays` returns this and nothing else, so the whole deduplication, newest-wins and
 * retirement contract can be exercised against days a test constructed by hand.
 */
export type UnionOfDays = {
  newestDay: string
  oldestDay: string
  index: WindowedIndex
  approved: WindowedApprovedSourceIndex
  /** One entry per day folded in, oldest first, each naming its archived files and hash. */
  days: WindowDay[]
  summary: WindowSummary
  /** The span, and how the newest day compares to the window's own mean. */
  coverage: WindowCoverage
}

export type ServedWindow = UnionOfDays & {
  /** Oldest first. Every one of these was byte-re-verified and parse-verified individually. */
  daysServed: string[]
  daysHeld: number
  /** Days the archive holds that could not be served, by name and reason. Never hidden. */
  skipped: SkippedFeedDay[]
  /** The newest day, whole, exactly as the single-day path resolves it. */
  newest: ServedFeedDay
}

export type WindowResolution =
  | { ok: true; window: ServedWindow }
  | { ok: false; reason: string; skipped: SkippedFeedDay[] }

/** The archived capture a row's `sourceDay` names. The chain of custody, one lookup away. */
export function dayProvenance(window: ServedWindow, feedDay: string): WindowDay | null {
  return window.days.find((d) => d.feedDay === feedDay) ?? null
}

/**
 * Memoised per discovery object, exactly as `resolveServedFeedDay` is: `discoverFeedDays()`
 * returns the SAME object while the manifest is unchanged, so a WeakMap keyed on it gives
 * exact invalidation with no clock and no TTL. A capture landing rewrites the manifest,
 * produces a new discovery object, and the window rebuilds. Measured cold build: ~500ms for
 * twenty days, which is why it is built once rather than per request.
 */
const WINDOW_CACHE = new WeakMap<FeedDayDiscovery, WindowResolution>()

export function resolveServedWindow(root?: string): WindowResolution {
  const discovery = root == null ? discoverFeedDays() : discoverFeedDays(root)
  const cached = WINDOW_CACHE.get(discovery)
  if (cached) return cached
  const resolved = buildWindow(discovery, root)
  WINDOW_CACHE.set(discovery, resolved)
  return resolved
}

type Accumulated = {
  identity: StockIdentity
  first: string
  last: string
  days: string[]
  observations: number
  solicitations: string[]
  /** The newest published line, and the day it came from. */
  newestRow: IndexRow
  newestDay: string
  /** Per field, the values seen with the day that published each. Oldest first. */
  values: Map<WindowFieldName, Array<{ feedDay: string; value: string }>>
}

function buildWindow(discovery: FeedDayDiscovery, root?: string): WindowResolution {
  if (!discovery.present) {
    return { ok: false, reason: 'the archive manifest is absent in this environment, so no window can be served', skipped: [] }
  }

  const skipped: SkippedFeedDay[] = []
  const served: ServedFeedDay[] = []

  // Oldest first, so "newest wins" is simply "the last write wins" and needs no comparison.
  const ordered = [...discovery.days].sort((a, b) => a.logicalDate.localeCompare(b.logicalDate))

  for (const held of ordered) {
    const resolution = root == null ? resolveFeedDayInputs(held.logicalDate) : resolveFeedDayInputs(held.logicalDate, root)
    if (!resolution.ok) {
      skipped.push({ feedDay: held.logicalDate, reason: resolution.reason })
      continue
    }
    served.push(resolution.served)
  }

  const union = unionFeedDays(served)
  if (union == null) {
    return {
      ok: false,
      reason: 'no day in the archive could be parse-verified, so the window is empty',
      skipped,
    }
  }

  return {
    ok: true,
    window: {
      ...union,
      daysServed: union.days.map((d) => d.feedDay),
      daysHeld: discovery.days.length,
      skipped,
      newest: served[served.length - 1]!,
    },
  }
}

/**
 * THE UNION ITSELF, over days already admitted, with no filesystem in it.
 *
 * Separated from `buildWindow` so the deduplication, the newest-wins rule, the change history
 * and the retirement judgement can be settled with SYNTHETIC days whose answer is known in
 * advance. A verification written against the real archive can only ever confirm what the
 * archive happens to contain, and this estate has a recorded incident where a hand-written
 * check reproduced the parser bug it was checking for and agreed with itself.
 *
 * Days may arrive in any order; they are sorted oldest first here rather than by contract, so
 * a caller that iterates a Map cannot silently invert which observation is the newest.
 *
 * Returns null for an empty list. An empty window is not a window, and a caller must say so
 * rather than render zeroes.
 */
export function unionFeedDays(input: ServedFeedDay[]): UnionOfDays | null {
  if (input.length === 0) return null

  const days: WindowDay[] = []
  const acc = new Map<string, Accumulated>()
  const approvedByNiin = new Map<
    Niin,
    Array<{ feedDay: string; cages: Cage[]; entries: ApprovedSourceEntry[] }>
  >()
  let offWidthRows = 0
  let unparsedNsn = 0
  let unparsedSourceLines = 0

  const ordered = [...input].sort((a, b) => a.feedDay.localeCompare(b.feedDay))

  for (const served of ordered) {
    const feedDay = served.feedDay
    offWidthRows += served.index.offWidthRows
    unparsedNsn += served.index.unparsedNsn
    unparsedSourceLines += served.approved.unparsedLines

    const before = acc.size
    for (const row of served.index.rows) {
      const identity = stockIdentity(row.nsn)
      if (identity == null) continue
      const close = parseIndexReturnDate(row.returnDate, feedDay)
      const existing = acc.get(identity.key)
      if (existing == null) {
        acc.set(identity.key, {
          identity,
          first: feedDay,
          last: feedDay,
          days: [feedDay],
          observations: 1,
          solicitations: [row.solicitation],
          newestRow: row,
          newestDay: feedDay,
          values: newValueMap(row, close.iso, feedDay),
        })
        continue
      }
      existing.last = feedDay
      existing.observations += 1
      if (existing.days[existing.days.length - 1] !== feedDay) existing.days.push(feedDay)
      if (!existing.solicitations.includes(row.solicitation)) existing.solicitations.push(row.solicitation)
      // Days are walked oldest first, so the last write IS the newest observation.
      existing.identity = identity
      existing.newestRow = row
      existing.newestDay = feedDay
      pushValues(existing.values, row, close.iso, feedDay)
    }

    // Grouped from the published ENTRIES rather than from `byNiin`, because `byNiin` collapses
    // to a cage set and the part number the file carried is not recoverable from it.
    const entriesByNiin = new Map<Niin, ApprovedSourceEntry[]>()
    for (const entry of served.approved.entries) {
      const list = entriesByNiin.get(entry.niin)
      if (list) list.push(entry)
      else entriesByNiin.set(entry.niin, [entry])
    }
    for (const [niin, entries] of entriesByNiin) {
      const cages = [...new Set(entries.map((e) => e.cage))].sort()
      const list = approvedByNiin.get(niin)
      if (list) list.push({ feedDay, cages, entries })
      else approvedByNiin.set(niin, [{ feedDay, cages, entries }])
    }

    days.push({
      feedDay,
      indexStorageKey: served.indexStorageKey,
      archiveStorageKey: served.archive.storageKey,
      archiveMember: served.archive.member,
      archiveSha256: served.archive.sha256,
      retrievedAt: served.archive.retrievedAt,
      indexRows: served.index.rows.length,
      newStockNumbers: acc.size - before,
    })
  }

  const newestDay = days[days.length - 1]!.feedDay
  const oldestDay = days[0]!.feedDay

  const rows: WindowRow[] = []
  const byNiin = new Map<Niin, WindowRow[]>()
  const byKey = new Map<string, WindowRow>()
  const fscByNiin = new Map<Niin, Set<Fsc>>()

  for (const entry of acc.values()) {
    const closeHistory = entry.values.get('closeDate') ?? []
    const newestClose = closeHistory[closeHistory.length - 1]
    const window: RowWindow = {
      key: entry.identity.key,
      keyKind: entry.identity.kind,
      rawStockNumber: entry.identity.raw,
      niin: entry.identity.niin,
      fsc: entry.identity.fsc,
      firstSeen: entry.first,
      lastSeen: entry.last,
      observedDays: entry.days,
      daysObserved: entry.days.length,
      observations: entry.observations,
      solicitations: entry.solicitations,
      distinctSolicitations: entry.solicitations.length,
      recurring: entry.solicitations.length > 1,
      sourceDay: entry.newestDay,
      changes: collectChanges(entry.values),
      lifecycle: lifecycleAsOf({
        closeDate: newestClose && newestClose.value !== '' ? newestClose.value : null,
        onNewestDay: entry.last === newestDay,
        asOf: newestDay,
      }),
    }
    const row: WindowRow = { ...entry.newestRow, window }
    rows.push(row)
    byKey.set(window.key, row)
    if (window.niin != null) {
      const list = byNiin.get(window.niin)
      if (list) list.push(row)
      else byNiin.set(window.niin, [row])
      if (window.fsc != null) {
        const set = fscByNiin.get(window.niin)
        if (set) set.add(window.fsc)
        else fscByNiin.set(window.niin, new Set([window.fsc]))
      }
    }
  }

  // Stable and meaningful without a scorer: open before closed, then the closest close date,
  // then the largest buy. A surface is free to re-sort; this is what it sees first.
  rows.sort(byUrgency)

  const approved = buildApprovedWindow(approvedByNiin, unparsedSourceLines)

  const summary: WindowSummary = {
    distinctStockNumbers: rows.length,
    wellFormedNsn: rows.filter((r) => r.window.keyKind === 'nsn').length,
    bareNiinOnly: rows.filter((r) => r.window.keyKind === 'niin_only').length,
    nonStandard: rows.filter((r) => r.window.keyKind === 'non_standard').length,
    observations: rows.reduce((t, r) => t + r.window.observations, 0),
    seenOnOneDayOnly: rows.filter((r) => r.window.daysObserved === 1).length,
    recurring: rows.filter((r) => r.window.recurring).length,
    open: rows.filter((r) => r.window.lifecycle.status === 'open').length,
    closed: rows.filter((r) => r.window.lifecycle.status === 'closed').length,
    lastSeenOnly: rows.filter((r) => r.window.lifecycle.status === 'last_seen_only').length,
    onNewestDay: rows.filter((r) => r.window.lifecycle.onNewestDay).length,
    changedAcrossDays: rows.filter((r) => r.window.changes.length > 0).length,
    niinGrain: fscByNiin.size,
    nsnGrain: [...fscByNiin.values()].reduce((t, s) => t + s.size, 0),
    niinsUnderMultipleFscs: [...fscByNiin.values()].filter((s) => s.size > 1).length,
  }

  return {
    newestDay,
    oldestDay,
    index: { rows, byNiin, byKey, offWidthRows, unparsedNsn },
    approved,
    days,
    summary,
    coverage: coverageOf(days, newestDay, oldestDay),
  }
}

/* ------------------------------------------------------------------------------------ */
/* COVERAGE, AND THE THIN-DAY DISCLOSURE                                                 */
/* ------------------------------------------------------------------------------------ */

export type WindowCoverage = {
  firstDay: string
  lastDay: string
  dayCount: number
  /** Every day actually folded into the union, oldest first. Not the days held: the days USED. */
  days: string[]
  /** Index lines each included day published. The weekday swing is visible in this column. */
  indexRowsByDay: Array<{ feedDay: string; indexRows: number }>
  newestDayIndexRows: number
  /** The window's own mean and median, so the newest day is judged against its own archive. */
  meanIndexRowsPerDay: number
  medianIndexRowsPerDay: number
  /** TRUE when the newest day published fewer lines than the window's own mean. */
  newestDayBelowMean: boolean
  /** Newest over mean, two decimals. 1 is an average day; this archive's Fridays run near 0.2. */
  newestDayShareOfMean: number
  /** The one definition of the operator sentence. Produced by `coverageStatement`. */
  statement: string
}

/**
 * THE SENTENCE THAT KEEPS A SIXTY-FOLD JUMP HONEST.
 *
 * Stored on the coverage object rather than derived at each call site, because there is
 * exactly ONE coverage object per built window and a stored sentence cannot drift from the
 * facts beside it when both come out of this function. That is the opposite of the per-row
 * case above, where 29,159 copies of derivable prose would be megabytes on the wire.
 *
 * Exported so a surface that needs to restate it can call the same definition instead of
 * writing a second one.
 */
export function coverageStatement(coverage: WindowCoverage): string {
  const span =
    coverage.dayCount === 1
      ? `the single archived feed day ${coverage.firstDay}`
      : `${coverage.dayCount} archived feed days, ${coverage.firstDay} to ${coverage.lastDay}`
  const thin = coverage.newestDayBelowMean
    ? `The newest day, ${coverage.lastDay}, published ${groupDigits(coverage.newestDayIndexRows)} lines against a window mean of ${groupDigits(coverage.meanIndexRowsPerDay)}, so it is a THIN day and a board built on it alone would understate the market.`
    : `The newest day, ${coverage.lastDay}, published ${groupDigits(coverage.newestDayIndexRows)} lines against a window mean of ${groupDigits(coverage.meanIndexRowsPerDay)}, so it is a normal publishing day for this archive.`
  return `Counted across ${span}. ${thin}`
}

function coverageOf(days: WindowDay[], newestDay: string, oldestDay: string): WindowCoverage {
  const sizes = days.map((d) => d.indexRows)
  const total = sizes.reduce((t, n) => t + n, 0)
  const mean = Math.round((total / sizes.length) * 10) / 10
  const sorted = [...sizes].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 1 ? sorted[mid]! : Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10
  const newestRows = days[days.length - 1]!.indexRows
  const coverage: WindowCoverage = {
    firstDay: oldestDay,
    lastDay: newestDay,
    dayCount: days.length,
    days: days.map((d) => d.feedDay),
    indexRowsByDay: days.map((d) => ({ feedDay: d.feedDay, indexRows: d.indexRows })),
    newestDayIndexRows: newestRows,
    meanIndexRowsPerDay: mean,
    medianIndexRowsPerDay: median,
    newestDayBelowMean: newestRows < mean,
    newestDayShareOfMean: mean === 0 ? 0 : Math.round((newestRows / mean) * 100) / 100,
    statement: '',
  }
  coverage.statement = coverageStatement(coverage)
  return coverage
}

/* ------------------------------------------------------------------------------------ */
/* OPEN DEMAND: THE ONLY DOOR FROM THE UNION TO A BOARD                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * THE DAY A BOARD IS JUDGED AGAINST, AND WHAT THAT DAY IS.
 *
 * A pair, not a bare string, deliberately. `openDemand` used to take an `asOf` it did not
 * actually use: it read the lifecycle `unionFeedDays` had already frozen against the newest
 * archived day, so the row set was identical for every argument while a different day was
 * printed into the sentence that shipped to the operator. That is a measurement labelled with
 * a basis that did not produce it, and it also made the staleness defect unfixable from the
 * outside: a caller that tried to correct it by passing today's date saw the numbers not move
 * and concluded nothing was stale.
 *
 * Requiring the basis alongside the day means a caller cannot supply a reference day without
 * saying, in words a person reads, what that day IS. The sentence is the point: "open" against
 * a four-day-old archive and "open" against this morning's capture are different claims.
 */
export type DemandReference = {
  /** ISO `YYYY-MM-DD`. Retirement is judged against this and nothing else. */
  day: string
  /** What that day is, in the operator's words. Rendered in the statement, never implied. */
  basis: string
}

export type OpenDemand = {
  /** The same shape a single day serves, so every consumer written against a day still works. */
  index: WindowedIndex
  /**
   * The day retirement was judged against, and its stated basis. Every row inside `index`
   * carries the same day on `row.window.lifecycle.asOf`, because they were re-judged here.
   */
  reference: DemandReference
  /** The reference day alone. Kept because it is what most callers store and print. */
  asOf: string
  /** Rows whose own published close date had already passed. Kept in the window, not in demand. */
  closedExcluded: number
  /** Rows with no readable close date. A blank is not an open solicitation. */
  undatedExcluded: number
  /** The one definition of the operator sentence for what was left out. */
  statement: string
}

/**
 * Narrow a window to the requirements the government's own close date says are still open,
 * JUDGED AGAINST THE REFERENCE DAY THE CALLER SUPPLIES.
 *
 * THE WINDOW KEEPS CLOSED ROWS AND A BOARD MUST NOT SHOW THEM. Rule 3 keeps a closed row and
 * labels it, because a row that vanishes without explanation is how an operator stops trusting
 * a board. Rule 6 is the other half of that bargain: the moment those rows are called DEMAND,
 * the product is claiming DLA is buying something whose solicitation closed a fortnight ago.
 * MEASURED on the twenty days ending 2026-08-14: 14,539 of 29,159 stock numbers had already
 * closed, so serving the raw union would have made half the board false.
 *
 * THE JUDGEMENT IS MADE HERE, NOT READ BACK FROM THE UNION, and that is the whole repair.
 * This function used to read `row.window.lifecycle.status`, which `unionFeedDays` had already
 * frozen against the newest ARCHIVED day, so the `asOf` argument decorated the sentence and
 * governed nothing. Measured with two hand-built days closing 2026-01-30 and a reference day
 * of 2030-01-01: two rows came back as open demand, with `closedExcluded` at 0 and a statement
 * naming 2030. Every row is now re-judged with `lifecycleAsOf` and the SURVIVOR IS REWRITTEN
 * with the judgement that admitted it, so `row.window.lifecycle.asOf` and everything derived
 * from it downstream (`CornerRow.demand.asOf`, `.lifecycle`) name the day that actually
 * decided the row rather than a different one.
 *
 * `last_seen_only` is excluded with the closed rows and counted separately. It means the
 * published line carried no readable return date, which is a publisher silence, not a promise
 * that the requirement is live. Measured on this archive: zero rows, which is exactly why the
 * branch has to be written now rather than the first morning a malformed date lands.
 *
 * `offWidthRows` and `unparsedNsn` are carried through unchanged and deliberately: they count
 * LINES THE FILES CARRIED, a shape fact about the captures, and filtering rows for lifecycle
 * cannot retroactively change how many lines failed the published width.
 */
export function openDemand(index: WindowedIndex, reference: DemandReference): OpenDemand {
  const rows: WindowRow[] = []
  let closedExcluded = 0
  let undatedExcluded = 0
  for (const row of index.rows) {
    const lifecycle = lifecycleAsOf({
      closeDate: row.window.lifecycle.closeDate,
      onNewestDay: row.window.lifecycle.onNewestDay,
      asOf: reference.day,
    })
    if (lifecycle.status === 'open') {
      // The row that survives carries the judgement that admitted it. Handing on the union's
      // older stamp would make every downstream `asOf` name a day that did not decide anything.
      rows.push({ ...row, window: { ...row.window, lifecycle } })
      continue
    }
    if (lifecycle.status === 'closed') closedExcluded += 1
    else undatedExcluded += 1
  }

  const byNiin = new Map<Niin, WindowRow[]>()
  const byKey = new Map<string, WindowRow>()
  for (const row of rows) {
    byKey.set(row.window.key, row)
    if (row.window.niin == null) continue
    const list = byNiin.get(row.window.niin)
    if (list) list.push(row)
    else byNiin.set(row.window.niin, [row])
  }

  return {
    index: { rows, byNiin, byKey, offWidthRows: index.offWidthRows, unparsedNsn: index.unparsedNsn },
    reference,
    asOf: reference.day,
    closedExcluded,
    undatedExcluded,
    statement: openDemandStatement(closedExcluded, undatedExcluded, reference),
  }
}

/**
 * The one definition of the exclusion sentence. Exported so a surface restates rather than
 * rewrites.
 *
 * IT NAMES THE INSTANT AND WHAT THE INSTANT IS. A count of what was excluded is only readable
 * beside the day it was excluded on, and "the newest day we hold" and "today" are different
 * days whenever a capture has been missed, which is the condition this sentence exists to make
 * visible rather than to smooth over.
 */
export function openDemandStatement(
  closed: number,
  undated: number,
  reference: DemandReference,
): string {
  const parts = [
    `${groupDigits(closed)} requirement${closed === 1 ? '' : 's'} whose own published return date had already passed`,
  ]
  if (undated > 0) {
    parts.push(
      `${groupDigits(undated)} whose published line carried no readable return date, which this product will not read as open`,
    )
  }
  return `Held in the archive and excluded from demand as of ${reference.day}, ${reference.basis}: ${parts.join(', and ')}. They stay searchable and labelled; they are not counted as an opportunity.`
}

/* ------------------------------------------------------------------------------------ */

function fieldValues(row: IndexRow, closeIso: string | null): Array<[WindowFieldName, string]> {
  return [
    ['quantity', row.quantity == null ? '' : String(row.quantity)],
    ['closeDate', closeIso ?? ''],
    ['solicitation', row.solicitation],
    ['nomenclature', row.nomenclature],
    ['unitOfIssue', row.unitOfIssue],
    ['purchaseRequest', row.purchaseRequest],
  ]
}

function newValueMap(row: IndexRow, closeIso: string | null, feedDay: string) {
  const map = new Map<WindowFieldName, Array<{ feedDay: string; value: string }>>()
  for (const [field, value] of fieldValues(row, closeIso)) map.set(field, [{ feedDay, value }])
  return map
}

function pushValues(
  map: Map<WindowFieldName, Array<{ feedDay: string; value: string }>>,
  row: IndexRow,
  closeIso: string | null,
  feedDay: string,
): void {
  for (const [field, value] of fieldValues(row, closeIso)) {
    const list = map.get(field)
    if (!list) {
      map.set(field, [{ feedDay, value }])
      continue
    }
    // Only a CHANGE is recorded. Twenty identical republications are not twenty facts, and
    // storing them would put 39,223 entries on the wire to say nothing moved.
    if (list[list.length - 1]!.value !== value) list.push({ feedDay, value })
  }
}

function collectChanges(
  map: Map<WindowFieldName, Array<{ feedDay: string; value: string }>>,
): FieldChange[] {
  const changes: FieldChange[] = []
  for (const [field, history] of map) {
    if (history.length > 1) changes.push({ field, history })
  }
  return changes
}

/**
 * The approved-source union.
 *
 * NEWEST OBSERVATION WINS, and the reason matters: unioning the CAGE sets across days would
 * turn a sole source into a multiple source whenever an older day listed an extra company,
 * and sole-sourcing is the whole claim this product makes. Newest-wins keeps the displayed
 * set equal to the most recently published approved list, and `changed` + `history` carry the
 * fact that it moved. Measured: 35 of 21,137 items changed their approved set inside the
 * window, so this is a small and inspectable set rather than a silent policy.
 */
function buildApprovedWindow(
  observations: Map<Niin, Array<{ feedDay: string; cages: Cage[]; entries: ApprovedSourceEntry[] }>>,
  unparsedLines: number,
): WindowedApprovedSourceIndex {
  const entries: ApprovedSourceEntry[] = []
  const byNiin = new Map<Niin, Set<Cage>>()
  const byCage = new Map<Cage, Set<Niin>>()
  const windowByNiin = new Map<Niin, ApprovedSourceWindow>()

  for (const [niin, list] of observations) {
    const newest = list[list.length - 1]!
    const signatures = new Set(list.map((o) => o.cages.join('|')))
    const changed = signatures.size > 1
    windowByNiin.set(niin, {
      sourceDay: newest.feedDay,
      cages: newest.cages,
      entries: newest.entries,
      firstSeen: list[0]!.feedDay,
      lastSeen: newest.feedDay,
      daysObserved: new Set(list.map((o) => o.feedDay)).size,
      changed,
      history: changed ? list.map((o) => ({ feedDay: o.feedDay, cages: o.cages })) : [],
    })

    // The published rows themselves, so `nsn` is the thirteen-digit value the file carried and
    // `partNumber` is the publisher's, not a placeholder standing in for either.
    for (const entry of newest.entries) entries.push(entry)

    const set = new Set<Cage>(newest.cages)
    byNiin.set(niin, set)
    for (const cage of newest.cages) {
      const owned = byCage.get(cage)
      if (owned) owned.add(niin)
      else byCage.set(cage, new Set([niin]))
    }
  }

  return { entries, byNiin, byCage, unparsedLines, windowByNiin }
}

/**
 * Thousands separators without a locale read.
 *
 * `toLocaleString()` is the defect class this repository has shipped three times: it can
 * resolve differently on a server and in a browser and it is a hydration mismatch waiting for
 * an ICU difference. These strings are computed once on the server, but the function is
 * exported territory and a client could call it, so the formatting is written out rather than
 * borrowed from the runtime.
 */
function groupDigits(value: number): string {
  const negative = value < 0
  const [whole, fraction] = Math.abs(value).toString().split('.')
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`
}

/**
 * Open before closed, then soonest close date, then largest quantity.
 *
 * `last_seen_only` sorts with closed rather than with open, deliberately: a row we cannot
 * date must never outrank one the government says is still open.
 */
function byUrgency(a: WindowRow, b: WindowRow): number {
  const rank = (r: WindowRow): number => (r.window.lifecycle.status === 'open' ? 0 : 1)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  const ca = a.window.lifecycle.closeDate
  const cb = b.window.lifecycle.closeDate
  if (ca != null && cb != null && ca !== cb) return ra === 0 ? ca.localeCompare(cb) : cb.localeCompare(ca)
  if (ca == null && cb != null) return 1
  if (ca != null && cb == null) return -1
  return (b.quantity ?? 0) - (a.quantity ?? 0)
}
