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
import { buildCornerMap, type CornerMap } from './corner'
import { buildNsnAwardIndex } from './awards/nsn-now'
import { seedPath } from '@/lib/data-root'
import { resolveServedFeedDay, type ServedFeedDay, type SkippedFeedDay } from './feed-day'

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

export type IntelligenceDatasets = {
  cornerMap: CornerMap
  noQuote: NoQuoteDataset
  distressed: DistressedDataset
  approved: ApprovedSourceIndex
  index: DailyIndex
  /** Which day is being served and why, one resolution shared by every surface. */
  feed: ServedFeedMeta
}

/**
 * Memoized per served feed day + seed paths. The feed inputs are static until a new capture
 * lands (the resolution itself invalidates on manifest change), and both the nav (for its
 * candidate-corner count) and the Monopoly page call this on the same request; rebuilding
 * twice would read the files twice for no new information. Keyed so a test passing explicit
 * feed inputs or seed paths gets its own entry rather than a stale hit.
 */
const datasetCache = new Map<string, IntelligenceDatasets>()

export function buildAllDatasets(
  feedOverride?: ServedFeedDay,
  seeds: SeedPaths = SEED_PATHS,
): IntelligenceDatasets {
  const feed = feedOverride ?? resolveServedOrThrow()
  const cacheKey = `${feed.feedDay}|${feed.indexStorageKey}|${feed.archive.storageKey}|${seeds.awardSilence}|${seeds.noQuotes}`
  const hit = datasetCache.get(cacheKey)
  if (hit) return hit
  const built = buildAllDatasetsUncached(feed, seeds)
  datasetCache.set(cacheKey, built)
  return built
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

function buildAllDatasetsUncached(feed: ServedFeedDay, seeds: SeedPaths): IntelligenceDatasets {
  const { approved, index } = feed
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

  const cornerMap = buildCornerMap({
    approved,
    index,
    awardSilentCages,
    availabilityByNsn,
    provenance: {
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
    },
  })

  return {
    cornerMap,
    noQuote: buildNoQuoteGoldmine(seeds),
    distressed,
    approved,
    index,
    feed: {
      feedDay: feed.feedDay,
      daysHeld: feed.daysHeld,
      skipped: feed.skipped,
      archive: feed.archive,
      indexPath: feed.indexPath,
      indexStorageKey: feed.indexStorageKey,
    },
  }
}

function toNumber(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
