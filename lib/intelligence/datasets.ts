/**
 * THE FOUR OUTPUTS THE SCREENS CONSUME.
 *
 * One assembly point, computed from the real files on disk, so the surfaces are a thin render
 * over data that already exists rather than a screen that computes as it draws.
 *
 *   1. cornerMap        the Monopoly Map's rows
 *   2. noQuoteGoldmine  solicitations that drew no quotes, joined to who holds material
 *   3. distressed       award-silent holders, enriched where the enrichment exists
 *   4. reverseCompetitor  a competitor's derivable sources, at stated granularity
 *
 * ---------------------------------------------------------------------------------------
 * THE RULE APPLIED THROUGHOUT
 * ---------------------------------------------------------------------------------------
 * Every output carries its provenance and its gaps. Where a leg of an analysis cannot be read
 * from the data on disk, the output says so IN THE ROW rather than omitting the row or
 * quietly treating the missing leg as a negative. Two of these four are structurally
 * incomplete today and both say which part is missing and why.
 */

import { existsSync } from 'node:fs'
import type { Cage, Niin } from './niin'
import { parseNsn } from './niin'
import type { ApprovedSourceIndex, DailyIndex } from './seed/feed'
import { readSeedWorkbook, readDate, type SeedProvenance } from './seed/xlsx'
import { buildCornerMap, cornerFunnel, type CornerFunnel, type CornerMap } from './corner'
import { buildNsnAwardIndex } from './awards/nsn-now'
import { seedPath } from '@/lib/data-root'
import { resolveServedFeedDay, type ServedFeedDay, type SkippedFeedDay } from './feed-day'
import {
  openDemand,
  resolveServedWindow,
  unionFeedDays,
  type DemandReference,
  type ServedWindow,
  type WindowCoverage,
  type WindowDay,
  type WindowSummary,
} from './feed-window'
import { measureFeedFreshness } from '@/lib/ingest/feed-days'
import { systemClock, type Clock } from '@/lib/time/clock'

/* ------------------------------------------------------------------------------------ */
/* WHERE THE REAL FILES LIVE                                                              */
/* ------------------------------------------------------------------------------------ */

/**
 * THE FEED DAY IS DISCOVERED, NEVER PINNED HERE. lib/intelligence/feed-day.ts resolves the
 * newest COMPLETE archived day whose bytes re-verify and whose two parser inputs actually
 * parse, falling back LOUDLY (by name, with reasons) when a newer held day is unservable.
 * The approved-source text is extracted from the archived `bq` zip in memory, so the chain
 * from rendered number to government-published byte carries no derived file at all.
 *
 * The SEED workbooks are a different kind of input: point-in-time exports, not a daily
 * feed. They stay pinned paths, and their absence renders as a stated empty state.
 */
export const SEED_PATHS = {
  awardSilence: seedPath('no awards in past 2 years (1).xlsx'),
  awardSilenceEnriched: seedPath('no awards in past 2 years.xlsx'),
  noQuotes: seedPath('NO QUOTES.xlsx'),
  noQuoteMatches: seedPath('no_quote_matches.xlsx'),
} as const

export type SeedPaths = typeof SEED_PATHS

export type DatasetAvailability = { path: string; present: boolean }

/**
 * Report what is readable BEFORE computing, so an absent input is a stated fact.
 *
 * THE FEED ENTRIES NAME THE DAY ACTUALLY CHOSEN, not a pinned one. Two entries, always, so
 * the shape is stable for the callers that gate a whole suite on "every input present": the
 * resolved index capture and the archived zip member the approved-source list is parsed from.
 * A day that was HELD but refused is not an availability failure — the product is serving a
 * real day — so it is carried on `IntelligenceDatasets.feed.skipped` by name and reason
 * rather than turned into a false absent-input reading here.
 */
export function checkDataAvailability(seeds: SeedPaths = SEED_PATHS): DatasetAvailability[] {
  const feed = resolveServedFeedDay()
  const feedEntries: DatasetAvailability[] = feed.ok
    ? [
        { path: feed.served.indexPath, present: true },
        { path: `${feed.served.archive.storageKey}!${feed.served.archive.member}`, present: true },
      ]
    : [
        // Every candidate tried is named here, because "no data" with no reason is the state
        // an operator cannot act on. This branch means the archive itself is unusable.
        {
          path: `no servable feed day: ${feed.reason}${
            feed.skipped.length > 0
              ? ` (tried ${feed.skipped.map((s) => `${s.feedDay}: ${s.reason}`).join('; ')})`
              : ''
          }`,
          present: false,
        },
        { path: 'archive quoting zip: unresolved because no feed day resolved', present: false },
      ]
  return [
    ...feedEntries,
    ...[seeds.awardSilence, seeds.awardSilenceEnriched, seeds.noQuotes, seeds.noQuoteMatches].map(
      (path) => ({ path, present: existsSync(path) }),
    ),
  ]
}

/* ------------------------------------------------------------------------------------ */
/* 1. THE AWARD SILENCE LIST, AND ITS ENRICHMENT                                          */
/* ------------------------------------------------------------------------------------ */

export type SilentFirm = {
  cage: Cage
  company: string | null
  awardsInWindow: number | null
  lastAwardedAt: string | null
  lastAwardedBasis: string
  /** Enrichment, present only for firms carried by the wider export. */
  city: string | null
  state: string | null
  phone: string | null
  email: string | null
  currentlyInBusiness: string | null
  /** TRUE when no enrichment row exists for this company. An honest empty, not a blank. */
  enrichmentMissing: boolean
}

export type DistressedDataset = {
  firms: SilentFirm[]
  provenance: { candidateList: SeedProvenance; enrichment: SeedProvenance | null }
  summary: {
    candidates: number
    enriched: number
    /** Firms on the candidate list with NO enrichment row. Rendered as a state, not hidden. */
    withoutEnrichment: number
    /**
     * Firms whose enrichment states they are still trading. Disconfirming evidence.
     *
     * READ THIS WITH `inBusinessColumnPopulated`. A zero here means one of two completely
     * different things and they must never be conflated: nobody is trading, or nobody filled
     * the column in. Measured on the real file it is the second, which is why the count is
     * never reported without its denominator.
     */
    statedStillInBusiness: number
    /** How many rows actually carry a value in that column. Zero means the column is unwritten. */
    inBusinessColumnPopulated: number
  }
  gaps: string[]
}

/**
 * Assemble the award-silence candidate list.
 *
 * TWO FILES, AND NEITHER DOMINATES, which is the finding that matters here. The four column
 * export carries 3,483 firms. The fourteen column export carries 3,471 of those same firms
 * plus city, state, contact details and a stated in-business flag. Twelve firms exist only in
 * the narrow file and get no enrichment at all.
 *
 * That matters because one of the three mandatory suppression checks is "a successor company
 * at the same address", and address exists ONLY in the enrichment. Loading the narrow file
 * alone makes that check unrunnable while looking perfectly complete.
 *
 * Nothing here calls a firm distressed. The publishable statement is the measurement.
 */
export function buildDistressed(seeds: SeedPaths = SEED_PATHS): DistressedDataset {
  const candidates = readSeedWorkbook(seeds.awardSilence)
  const hasEnrichment = existsSync(seeds.awardSilenceEnriched)
  const enrichment = hasEnrichment ? readSeedWorkbook(seeds.awardSilenceEnriched) : null

  const enrichmentByCage = new Map<string, Record<string, string | null>>()
  for (const row of enrichment?.rows ?? []) {
    const cage = row['cage']
    if (cage) enrichmentByCage.set(cage.toUpperCase(), row)
  }

  const firms: SilentFirm[] = candidates.rows.map((row) => {
    const cage = (row['cage'] ?? '').toUpperCase()
    const extra = enrichmentByCage.get(cage)
    const last = readDate(row['last_awarded_at'] ?? null)
    const awards = row['awards_in_window']
    return {
      cage,
      company: row['company'] ?? null,
      awardsInWindow: awards != null && /^\d+$/.test(awards) ? Number(awards) : null,
      lastAwardedAt: last.iso,
      lastAwardedBasis: last.basis,
      city: extra?.['city'] ?? null,
      state: extra?.['state'] ?? null,
      phone: extra?.['Phone'] ?? null,
      email: extra?.['Email'] ?? null,
      currentlyInBusiness: extra?.['Currently in Business'] ?? null,
      enrichmentMissing: extra == null,
    }
  })

  const inBusinessColumnPopulated = firms.filter(
    (f) => f.currentlyInBusiness != null && f.currentlyInBusiness !== '',
  ).length

  const gaps: string[] = [
    'registration status and expiration date are not in either export, so the S1 and S2 tiers cannot be computed from this data alone',
  ]
  if (!hasEnrichment) {
    gaps.push(
      'the wider export is absent, so no address is available and the successor-at-same-address suppression check cannot run',
    )
  }
  if (enrichment && inBusinessColumnPopulated === 0) {
    // Measured on the real file: the header exists and not one of the 3,471 rows carries a
    // value. A liveness signal built on it would read as a permanent, silent "not trading".
    gaps.push(
      'the "Currently in Business" column exists in the wider export but is entirely unpopulated, so it carries no liveness signal and must not be read as one',
    )
  }

  return {
    firms,
    provenance: { candidateList: candidates.provenance, enrichment: enrichment?.provenance ?? null },
    summary: {
      candidates: firms.length,
      enriched: firms.filter((f) => !f.enrichmentMissing).length,
      withoutEnrichment: firms.filter((f) => f.enrichmentMissing).length,
      statedStillInBusiness: firms.filter((f) => (f.currentlyInBusiness ?? '').toLowerCase().startsWith('y')).length,
      inBusinessColumnPopulated,
    },
    gaps,
  }
}

/* ------------------------------------------------------------------------------------ */
/* 2. THE NO-QUOTE GOLDMINE                                                               */
/* ------------------------------------------------------------------------------------ */

export type NoQuoteRow = {
  niin: Niin | null
  nsn: string
  solicitation: string
  description: string
  quantity: number | null
  closeDate: string | null
  lastSoldPrice: number | null
  relatedCage: string | null
  relatedPart: string | null
  /** Suppliers showing material against this solicitation in the availability snapshot. */
  holders: Array<{ name: string; unitsAvailable: number | null; basePrice: number | null }>
  /** TRUE when nobody in the snapshot holds material. The make-side case. */
  noHolderFound: boolean
}

export type NoQuoteDataset = {
  rows: NoQuoteRow[]
  provenance: { solicitations: SeedProvenance; availability: SeedProvenance }
  summary: {
    solicitations: number
    withHolder: number
    /** The make-side set: nobody holds it, so somebody has to build it. */
    makeSideOnly: number
    availabilityRows: number
  }
}

/**
 * The 839 solicitations that drew no quotes at all, joined to who shows material.
 *
 * The split is the product. A no-quote solicitation where somebody DOES hold material is a
 * sourcing problem worth an hour. One where nobody holds material anywhere is the make-side
 * case, and that is the class the customer sized at millions precisely because a human cannot
 * work it: each one burns a couple of hours and usually ends with no path to the part.
 */
export function buildNoQuoteGoldmine(seeds: SeedPaths = SEED_PATHS): NoQuoteDataset {
  const solicitations = readSeedWorkbook(seeds.noQuotes)
  const availability = readSeedWorkbook(seeds.noQuoteMatches)

  const holdersBySolicitation = new Map<string, NoQuoteRow['holders']>()
  for (const row of availability.rows) {
    const key = (row['solicitation_number'] ?? '').toUpperCase().replace(/[-\s]/g, '')
    if (!key) continue
    const list = holdersBySolicitation.get(key) ?? []
    list.push({
      name: row['supplier_name'] ?? 'unnamed supplier',
      unitsAvailable: toNumber(row['supplier_quantity_available']),
      basePrice: toNumber(row['base_price']),
    })
    holdersBySolicitation.set(key, list)
  }

  const rows: NoQuoteRow[] = solicitations.rows.map((row) => {
    const solicitation = row['Solicitation Number'] ?? ''
    const key = solicitation.toUpperCase().replace(/[-\s]/g, '')
    const holders = holdersBySolicitation.get(key) ?? []
    const nsn = row['NSN Number'] ?? ''
    return {
      niin: parseNsn(nsn)?.niin ?? null,
      nsn,
      solicitation,
      description: row['Description'] ?? '',
      quantity: toNumber(row['Solicitation Quantity']),
      closeDate: readDate(row['Close Date'] ?? null).iso,
      lastSoldPrice: toNumber(row['Last Sold Price']),
      relatedCage: row['Related Cage'] ?? null,
      relatedPart: row['Related Part'] ?? null,
      holders,
      noHolderFound: holders.length === 0,
    }
  })

  return {
    rows,
    provenance: { solicitations: solicitations.provenance, availability: availability.provenance },
    summary: {
      solicitations: rows.length,
      withHolder: rows.filter((r) => !r.noHolderFound).length,
      makeSideOnly: rows.filter((r) => r.noHolderFound).length,
      availabilityRows: availability.rows.length,
    },
  }
}

/* ------------------------------------------------------------------------------------ */
/* 3. REVERSE THE COMPETITOR                                                              */
/* ------------------------------------------------------------------------------------ */

export type ReverseSourceLink = {
  manufacturerCage: Cage
  niins: Niin[]
  /** What the link is drawn from. Approved-source is item level and strongest. */
  granularity: 'item_level'
  evidence: string
}

export type ReverseCompetitorResult = {
  competitorCage: Cage
  links: ReverseSourceLink[]
  /** TRUE when no award history exists on disk, which is the honest state today. */
  abstained: boolean
  abstentionReason: string | null
  gaps: string[]
}

/**
 * Derive the manufacturers behind a competitor's resales.
 *
 * THE HONEST STATE TODAY: this analysis is built on award history, and no award-history
 * source is on disk. What IS readable is the approved-source mapping, which answers a
 * narrower question: which items this company is itself an approved source for.
 *
 * Those are different claims and conflating them would be the exact failure this lane exists
 * to prevent, so when the competitor has no approved-source rows the result ABSTAINS with a
 * named reason rather than returning an empty list that reads like a finding of "no sources".
 */
export function reverseCompetitor(
  competitorCage: Cage,
  approved: ApprovedSourceIndex,
): ReverseCompetitorResult {
  const cage = competitorCage.toUpperCase()
  const own = approved.byCage.get(cage)

  const gaps = [
    'no award-history source is loaded, so manufacturers behind this competitor\'s resales cannot be derived today',
    'the approved-source file covers one feed day only, so absence here is not absence in the catalog',
  ]

  if (!own || own.size === 0) {
    return {
      competitorCage: cage,
      links: [],
      abstained: true,
      abstentionReason:
        'no approved-source rows and no award history for this company in the loaded data, so no manufacturer link can be established',
      gaps,
    }
  }

  return {
    competitorCage: cage,
    links: [
      {
        manufacturerCage: cage,
        niins: [...own].sort(),
        granularity: 'item_level',
        evidence: 'company is itself a recorded approved source for these stock numbers',
      },
    ],
    abstained: false,
    abstentionReason: null,
    gaps,
  }
}

/* ------------------------------------------------------------------------------------ */
/* 4. THE ASSEMBLY                                                                        */
/* ------------------------------------------------------------------------------------ */

export type ServedFeedMeta = {
  feedDay: string
  daysHeld: number
  /** Newer complete days held but not servable, by name with reasons. Empty = newest served. */
  skipped: SkippedFeedDay[]
  archive: ServedFeedDay['archive']
  indexPath: string
  indexStorageKey: string
}

/**
 * THE ARCHIVED WINDOW THE CORNER MAP WAS BUILT OVER, WITH ITS PROVENANCE INTACT.
 *
 * `days` is the whole point: a union that cannot say which government file each of its rows
 * came from is worse than the single day it replaced, because it looks bigger and cites less.
 * Every row on the map carries its own `demand.feedDay`, and this array resolves that day to
 * the archived index capture, the archived quoting zip, the member inside it and the hash the
 * manifest recorded for it.
 */
export type ServedWindowMeta = {
  newestDay: string
  oldestDay: string
  /** Oldest first. Every one was byte-re-verified and parse-verified individually. */
  daysIncluded: string[]
  dayCount: number
  /** Days the archive holds at all, including any that could not be served. */
  daysHeld: number
  /** Days held but not servable, by name and reason. Never hidden, never silently dropped. */
  skipped: SkippedFeedDay[]
  /** The span, and whether the newest day is thin against the window's own mean. */
  coverage: WindowCoverage
  /** The union's own census: distinct stock numbers, observations, open, closed, recurring. */
  summary: WindowSummary
  /** Requirements the window holds that are NOT counted as demand, with the reason. */
  excludedFromDemand: {
    closed: number
    undated: number
    asOf: string
    /** What `asOf` IS, in words. Carried so no surface can print the day without its basis. */
    asOfBasis: string
    statement: string
  }
  /** One entry per included day, naming its archived files and recorded hash. */
  days: WindowDay[]
}

export type IntelligenceDatasets = {
  cornerMap: CornerMap
  noQuote: NoQuoteDataset
  distressed: DistressedDataset
  /** The NEWEST SERVED DAY's approved-source file, unchanged. The window's union is on `window`. */
  approved: ApprovedSourceIndex
  /** The NEWEST SERVED DAY's index, unchanged, so a caller asking for "today" still gets today. */
  index: DailyIndex
  /** Which day is being served and why, one resolution shared by every surface. */
  feed: ServedFeedMeta
  /**
   * The window the corner map was actually built over, or null when only one day was used
   * (a pinned build, or an archive whose window could not be resolved). Null never means
   * "no window exists"; `cornerMap.coverage.basis` says which world the map is in.
   */
  window: ServedWindowMeta | null
  /**
   * The identical funnel over the newest feed day alone: the three numbers this product
   * showed before the window was wired. Carried so a surface prints both, labelled, rather
   * than replacing a small number with a large one and explaining nothing.
   */
  newestDayFunnel: CornerFunnel | null
}

/**
 * Memoized per served feed day + seed paths. The feed inputs are static until a new capture
 * lands (the resolution itself invalidates on manifest change), and both the nav (for its
 * candidate-corner count) and the Monopoly page call this on the same request; rebuilding
 * twice would read the files twice for no new information. Keyed so a test passing explicit
 * feed inputs or seed paths gets its own entry rather than a stale hit.
 */
const datasetCache = new Map<string, IntelligenceDatasets>()

/**
 * STORE ONE ENTRY PER IDENTITY WHEN THE LAST KEY SEGMENT IS A DAY.
 *
 * The window path's memo key now ends in the day demand was judged against, which is correct
 * (the same archive answers differently tomorrow) and, left alone, is an unbounded map that
 * grows by one full corner map every morning a process stays up. Measured on this archive a
 * single entry serialises to 11.8MB, so a month of uptime would retain hundreds of megabytes
 * of boards nobody can ever ask for again.
 *
 * Only entries that differ from the incoming key in that LAST segment are dropped, so a
 * different archive state, a different seed set or a pinned single day keeps its own entry.
 * Exported because the monopoly view and the portfolio memoise on the same day dimension and a
 * second hand-written copy of this rule would drift from this one.
 */
export function cachePerIdentityDay<V>(cache: Map<string, V>, key: string, value: V): V {
  const cut = key.lastIndexOf('|')
  if (cut > 0) {
    const prefix = key.slice(0, cut + 1)
    for (const existing of [...cache.keys()]) {
      if (existing !== key && existing.startsWith(prefix)) cache.delete(existing)
    }
  }
  cache.set(key, value)
  return value
}

/**
 * Build everything the screens read.
 *
 * TWO WORLDS, AND THE CALLER CHOOSES BY ARGUMENT, DELIBERATELY.
 *
 * With NO argument this is the serving path, and the serving path is the WINDOW: demand is
 * the union of every archived day that parse-verifies, narrowed to the requirements whose own
 * published return date has not passed. That is the fix this function exists to carry. The
 * archive held twenty days and the product served one of them, which on a Friday meant 18
 * candidate corners out of 562 already on disk.
 *
 * With a `feedOverride` this stays exactly what it always was: one named day, computed from
 * that day's own two files, with `window` null and `cornerMap.coverage.basis` reading
 * `single_day`. That is not a legacy branch left lying around. It is how a suite pins measured
 * values to an immutable archived day, and how any future day-picker will ask for one day. A
 * window silently substituted under a caller that asked for 2026-08-11 would answer a question
 * nobody asked.
 *
 * THE MEMO KEY CARRIES THE WINDOW'S IDENTITY, not just the newest day's. A backfill that lands
 * an OLDER capture changes the union without changing the newest day, and a key built only
 * from the newest day would serve the pre-backfill map forever.
 *
 * AND IT CARRIES THE REFERENCE DAY, because the window path now judges retirement against the
 * day it is computed on rather than against the newest day the archive holds. Without the
 * reference day in the key the answer would freeze at the first request of the process, which
 * is the same defect in a different costume: a board that is correct the morning it is built
 * and quietly wrong every morning after.
 *
 * `clock` is a parameter so a suite can pin the reference day. It defaults to the system clock
 * and is read exactly once per build, here, so nothing deeper in the chain reads wall time.
 */
export function buildAllDatasets(
  feedOverride?: ServedFeedDay,
  seeds: SeedPaths = SEED_PATHS,
  clock: Clock = systemClock,
): IntelligenceDatasets {
  const seedKey = `${seeds.awardSilence}|${seeds.noQuotes}`

  if (feedOverride) {
    const cacheKey = `day|${feedOverride.feedDay}|${feedOverride.indexStorageKey}|${feedOverride.archive.storageKey}|${seedKey}`
    const hit = datasetCache.get(cacheKey)
    if (hit) return hit
    const built = buildSingleDayDatasets(feedOverride, seeds)
    datasetCache.set(cacheKey, built)
    return built
  }

  const resolution = resolveServedWindow()
  if (!resolution.ok) {
    // A window that cannot resolve is not an empty state to render, it is an archive that
    // could not be read at all, and the single-day resolver produces the same failure with a
    // per-day breakdown. Falling through to it keeps ONE description of that failure.
    const feed = resolveServedOrThrow()
    const cacheKey = `day|${feed.feedDay}|${feed.indexStorageKey}|${feed.archive.storageKey}|${seedKey}`
    const hit = datasetCache.get(cacheKey)
    if (hit) return hit
    const built = buildSingleDayDatasets(feed, seeds)
    datasetCache.set(cacheKey, built)
    return built
  }

  const window = resolution.window
  const reference = demandReference(window.newestDay, clock)
  // The reference day is the LAST segment deliberately: `cachePerIdentityDay` reads it there to
  // keep exactly one build per archive state rather than one per day the process has been up.
  const cacheKey = `window|${window.newestDay}|${window.oldestDay}|${window.coverage.dayCount}|${window.newest.indexStorageKey}|${window.newest.archive.storageKey}|${seedKey}|${reference.day}`
  const hit = datasetCache.get(cacheKey)
  if (hit) return hit
  return cachePerIdentityDay(datasetCache, cacheKey, buildWindowedDatasets(window, seeds, reference))
}

/**
 * THE DAY THE BOARD IS JUDGED AGAINST: TODAY, ON THE PUBLISHER'S OWN CALENDAR.
 *
 * Not the newest archived day. DLA publishes a close date per requirement and that date passes
 * whether or not our capture ran, so a board judged against the newest capture serves expired
 * solicitations for exactly as long as the capture has been missed, and the error is invisible
 * because every surface says "open". MEASURED on this machine 2026-08-18 against an archive
 * whose newest day was 2026-08-14: 5,122 of 10,488 served rows, 48.8%, had already closed. The
 * same measurement on the pre-window single-day board was 3 of 186, because every row on it had
 * been issued that morning. So this is a regression the window introduced, not an inherited
 * condition, and it is fixed by asking the clock.
 *
 * EASTERN, VIA `measureFeedFreshness`, ON PURPOSE. DLA operates on the US federal business
 * calendar, and `measuredOn` is already this estate's one definition of "the Eastern civil date
 * now". Reusing it means the freshness pill in the chrome and the demand filter under the board
 * can never name two different todays, and the business-day count it returns gives the sentence
 * below its honest gap between the day we judged on and the day we last captured.
 */
function demandReference(newestArchivedDay: string, clock: Clock): DemandReference {
  const freshness = measureFeedFreshness(newestArchivedDay, clock.now())
  const day = freshness.measuredOn
  const behind = `${freshness.businessDaysBehind} US federal business day${freshness.businessDaysBehind === 1 ? '' : 's'}`
  const basis =
    day === newestArchivedDay
      ? 'the day this was computed, which is also the newest archived feed day'
      : day > newestArchivedDay
        ? `the day this was computed, ${behind} after the newest archived feed day ${newestArchivedDay}`
        : `the day this was computed, which is earlier than the newest archived feed day ${newestArchivedDay}`
  return { day, basis }
}

/**
 * An unservable archive is an EXCEPTIONAL state, not an empty state: the callers of this
 * function already gated on the data root being present, so reaching here with no servable
 * day means the archive itself is broken. The throw names every candidate tried and why,
 * so the failure is actionable rather than mysterious.
 */
function resolveServedOrThrow(): ServedFeedDay {
  const resolution = resolveServedFeedDay()
  if (resolution.ok) return resolution.served
  const tried = resolution.skipped.map((s) => `${s.feedDay}: ${s.reason}`).join('; ')
  throw new Error(
    `no servable feed day: ${resolution.reason}${tried ? ` (tried ${tried})` : ''}`,
  )
}

/**
 * The two inputs the corner map needs that come from neither the feed nor the window: who has
 * gone award-silent, and who self-reports stock. Read once and shared by both build paths so
 * the single-day comparison and the window map cannot be computed against different books.
 */
function sharedCornerInputs(seeds: SeedPaths) {
  const distressed = buildDistressed(seeds)
  const awardSilentCages = new Set<Cage>(distressed.firms.map((f) => f.cage))

  /*
   * Self-reported availability, joined from the NSN-Now export by 13-digit NSN.
   *
   * This is the leg the map abstained on for every row with the reason "no commercial locator
   * credential is connected". True about ILS, false about the data: the Availability sheet ships
   * inside the same workbook as the award history and answers the leg for 908 of 2,141 rows.
   * Built here rather than inside buildCornerMap so the corner module keeps no knowledge of where
   * the export lives, and so a caller without an export still gets a map.
   */
  const awardIx = buildNsnAwardIndex()
  const availabilityByNsn = new Map<string, { holders: number; units: number }>()
  if (awardIx.ok) {
    for (const [nsn, summary] of awardIx.byNsn) {
      if (summary.holders.length === 0) continue
      availabilityByNsn.set(nsn, {
        holders: summary.holders.length,
        units: summary.holders.reduce((t, h) => t + (h.quantity ?? 0), 0),
      })
    }
  }

  return { distressed, awardSilentCages, availabilityByNsn }
}

/**
 * The provenance block, always naming the NEWEST SERVED DAY.
 *
 * That stays true on the window path and it is not a compromise: this block feeds the
 * freshness pill and the header, which are about how current the product is, and the answer to
 * that is the newest capture. WHICH archived file each individual ROW came from is a different
 * question with a different answer, and it is carried per row on `CornerRow.demand`.
 */
function cornerProvenance(feed: ServedFeedDay, seeds: SeedPaths) {
  return {
    feedDay: feed.feedDay,
    // The archived original, exactly as the manifest records it. Never a derived file.
    sourceArchiveKey: feed.archive.storageKey,
    // Non-null on every capture in this archive (measured: 20 of 20 `bq` rows carry
    // content_sha256). The fallback is a stated absence, never a fabricated hash, and it
    // is deliberately a word rather than hex so a truncated render cannot read as one.
    sourceArchiveSha256: feed.archive.sha256 ?? 'unrecorded',
    // THE MEMBER INSIDE THE ARCHIVED ZIP, not the derived extraction beside it. The chain
    // from a rendered number to a government-published byte now has no derived file in it.
    approvedSourceFile: `${feed.archive.storageKey}!${feed.archive.member}`,
    indexFile: feed.indexStorageKey,
    silenceListFile: seeds.awardSilence,
    /*
     * NOT A CLOCK READ, DELIBERATELY. `new Date().toISOString()` stood here until
     * 2026-08-17. Nothing in the tree renders this field today (the only references are
     * this assignment and the type in corner.ts), but a wall-clock string riding on a
     * server-rendered object is one `toLocale*` away from the React #418 class this repo
     * has already been burned by three times. It was also wrong on its own terms:
     * buildAllDatasets is memoised per served feed day, so the value named the first
     * request of the process rather than "now", and it changed on every restart while the
     * data did not. The map is a pure function of the captured bytes plus the pinned seed
     * workbooks, so the only instant that carries information is the capture instant, and
     * it is labelled as what it is rather than posing as a build clock.
     */
    computedAt: `archive capture ${feed.archive.retrievedAt}`,
  }
}

function feedMeta(feed: ServedFeedDay): ServedFeedMeta {
  return {
    feedDay: feed.feedDay,
    daysHeld: feed.daysHeld,
    skipped: feed.skipped,
    archive: feed.archive,
    indexPath: feed.indexPath,
    indexStorageKey: feed.indexStorageKey,
  }
}

/** One named day, computed from that day\'s own two files. The pinned-suite path. */
function buildSingleDayDatasets(feed: ServedFeedDay, seeds: SeedPaths): IntelligenceDatasets {
  const { approved, index } = feed
  const { distressed, awardSilentCages, availabilityByNsn } = sharedCornerInputs(seeds)

  const cornerMap = buildCornerMap({
    approved,
    index,
    awardSilentCages,
    availabilityByNsn,
    provenance: cornerProvenance(feed, seeds),
  })

  return {
    cornerMap,
    noQuote: buildNoQuoteGoldmine(seeds),
    distressed,
    approved,
    index,
    feed: feedMeta(feed),
    window: null,
    newestDayFunnel: null,
  }
}

/**
 * THE SERVING PATH. Demand is the union of every archived day, narrowed to what is still open.
 *
 * The order of the two operations is the whole correctness argument and it is worth writing
 * down. UNION FIRST, because the daily index publishes the requirements ISSUED that day and
 * consecutive days are therefore very nearly disjoint: 81.6% of the stock numbers in this
 * archive appear on exactly one of the twenty days. NARROW SECOND, because roughly half of
 * what that union recovers has already reached its own published return date, and a closed
 * solicitation is history, not an opportunity.
 *
 * THE NEWEST-DAY FUNNEL BESIDE IT IS JUDGED AGAINST THE SAME REFERENCE DAY. That is the
 * second half of the same repair and it was missing until 2026-08-18. Before the reference day
 * moved to today the two bases coincided, so building the comparison over the newest day's RAW
 * index was near enough true. Once the window started being judged against today and the
 * newest day was not, the surface printed two numbers side by side at equal confidence where
 * one had been narrowed by retirement and the other had not. MEASURED on this archive at three
 * reference days: 273 window candidates against 18 unjudged on 2026-08-18, 11 against 18 on
 * 2026-08-25, and 0 against 18 on 2026-09-01, under a sentence claiming both came from the
 * identical computation. Judged the same way the newest day reads 17, 1 and 0.
 *
 * So the newest day is routed through `unionFeedDays([feed])` (a union of one, which is what
 * gives the rows the lifecycle machinery `openDemand` judges) and then through the SAME
 * `openDemand(index, reference)` call the window uses. MEASURED that the union-of-one changes
 * nothing else: over the newest archived day of this archive the raw daily index and the
 * unjudged union of one produce the identical funnel, 186 / 130 / 18, so the only difference
 * the routing introduces is the retirement judgement it exists to add.
 *
 * The comparison the surface prints is therefore one definition of "candidate corner"
 * evaluated on two inputs and judged on one day, not two definitions or two days that happen
 * to agree on the morning a capture lands.
 */
function buildWindowedDatasets(
  window: ServedWindow,
  seeds: SeedPaths,
  reference: DemandReference,
): IntelligenceDatasets {
  const feed = window.newest
  const { distressed, awardSilentCages, availabilityByNsn } = sharedCornerInputs(seeds)
  const provenance = cornerProvenance(feed, seeds)

  /*
   * THE NEWEST DAY AS A UNION OF ONE, so it can be judged by the same function on the same day.
   *
   * `unionFeedDays` returns null ONLY for an empty list, and this list holds exactly one day.
   * Reaching the branch would mean that contract had changed underneath this call, and the
   * honest response to that is to refuse rather than to fall back to the raw index: the
   * fallback is precisely the unjudged comparison this block exists to remove, and it would
   * come back silently, printed at equal confidence beside a judged number.
   */
  const newestOnly = unionFeedDays([feed])
  if (newestOnly == null) {
    throw new Error(
      `the newest archived day ${feed.feedDay} could not be unioned with itself, so the newest-day comparison cannot be judged against ${reference.day}; refusing to print an unjudged number beside a judged one`,
    )
  }

  // THE REFERENCE DAY IS TODAY, NOT `window.newestDay`. See `demandReference` above for the
  // measurement that made this a defect rather than a preference.
  const demand = openDemand(window.index, reference)
  // The SAME `reference`, by construction: one binding, read twice, so the two funnels the
  // surface prints cannot have been judged against different days.
  const newestDayDemand = openDemand(newestOnly.index, reference)
  const newestDayMap = buildCornerMap({
    approved: newestOnly.approved,
    index: newestDayDemand.index,
    awardSilentCages,
    availabilityByNsn,
    provenance,
  })
  const excludedFromDemand = {
    closed: demand.closedExcluded,
    undated: demand.undatedExcluded,
    asOf: demand.asOf,
    asOfBasis: demand.reference.basis,
    statement: demand.statement,
  }

  const cornerMap = buildCornerMap({
    approved: window.approved,
    index: demand.index,
    awardSilentCages,
    availabilityByNsn,
    provenance,
    window: {
      days: window.days,
      coverage: window.coverage,
      newestDayFunnel: cornerFunnel(newestDayMap),
      excludedFromDemand,
    },
  })

  return {
    cornerMap,
    noQuote: buildNoQuoteGoldmine(seeds),
    distressed,
    approved: feed.approved,
    index: feed.index,
    feed: feedMeta(feed),
    window: {
      newestDay: window.newestDay,
      oldestDay: window.oldestDay,
      daysIncluded: window.daysServed,
      dayCount: window.coverage.dayCount,
      daysHeld: window.daysHeld,
      skipped: window.skipped,
      coverage: window.coverage,
      summary: window.summary,
      excludedFromDemand,
      days: window.days,
    },
    newestDayFunnel: cornerFunnel(newestDayMap),
  }
}

function toNumber(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
