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
import { readApprovedSourceFile, readDailyIndex, type ApprovedSourceIndex, type DailyIndex } from './seed/feed'
import { readSeedWorkbook, readDate, type SeedProvenance } from './seed/xlsx'
import { buildCornerMap, type CornerMap } from './corner'

/* ------------------------------------------------------------------------------------ */
/* WHERE THE REAL FILES LIVE                                                              */
/* ------------------------------------------------------------------------------------ */

/**
 * THE PROVENANCE WE CITE IS THE ARCHIVED ZIP, NEVER THE DERIVED FILE.
 *
 * A derived file is a convenience: it can be regenerated, moved, or replaced, and nothing
 * about it proves where it came from. The archived original is the artifact with a retrieval
 * record and a hash, so that is what every surface cites.
 *
 * The chain is verified rather than assumed. The archived zip hashes to the value its
 * manifest records, and each derived file hashes to the same value as the corresponding entry
 * extracted from that zip. `test/intelligence/datasets.test.ts` asserts both, so a derived
 * file that is silently swapped, truncated or regenerated from a different day fails the
 * suite instead of quietly changing every number on the map.
 */
export const SOURCE_ARCHIVE = {
  storageKey: 'dibbs-rfq-daily/2026-08-11/20260812T225617Z/bq260811.zip',
  sha256: '491dad3652c4cca9ffc83006e23618d4822a72b848443902755ce0d7be2a5705',
  byteLength: 119_233,
  sourceUrl: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/bq260811.zip',
  retrievedAt: '2026-08-12T22:56:17.334Z',
  retrievedAtBasis: 'origin_file_mtime',
} as const

/** Hashes of the derived extractions, so the chain from the archive can be asserted. */
export const DERIVED_SHA256 = {
  approvedSource: '844c8677da9206f3543ba1ec4eab8f96c58ca0b81a43bcfd838d13e7c690b409',
  quoting: 'be5a1104a538d96966f5693106ed28b1a98246e5c1dd54285b60bf897d086d3e',
} as const

export const DATA_PATHS = {
  feedDay: '2026-08-11',
  // Stabilised by T2 out of volatile /tmp. Read here, cited as SOURCE_ARCHIVE above.
  approvedSource:
    '/Users/user/onlysource-data/archive/derived/dibbs-rfq-daily/2026-08-11/as260811.txt',
  index:
    '/Users/user/onlysource-data/archive/dibbs-rfq-daily/2026-08-11/20260812T225616Z/in260811.txt',
  awardSilence: '/Users/user/Downloads/no awards in past 2 years (1).xlsx',
  awardSilenceEnriched: '/Users/user/Downloads/no awards in past 2 years.xlsx',
  noQuotes: '/Users/user/Downloads/NO QUOTES.xlsx',
  noQuoteMatches: '/Users/user/Downloads/no_quote_matches.xlsx',
} as const

export type DatasetAvailability = { path: string; present: boolean }

/** Report what is readable BEFORE computing, so an absent input is a stated fact. */
export function checkDataAvailability(paths = DATA_PATHS): DatasetAvailability[] {
  return [
    paths.approvedSource,
    paths.index,
    paths.awardSilence,
    paths.awardSilenceEnriched,
    paths.noQuotes,
    paths.noQuoteMatches,
  ].map((path) => ({ path, present: existsSync(path) }))
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
export function buildDistressed(paths = DATA_PATHS): DistressedDataset {
  const candidates = readSeedWorkbook(paths.awardSilence)
  const hasEnrichment = existsSync(paths.awardSilenceEnriched)
  const enrichment = hasEnrichment ? readSeedWorkbook(paths.awardSilenceEnriched) : null

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
export function buildNoQuoteGoldmine(paths = DATA_PATHS): NoQuoteDataset {
  const solicitations = readSeedWorkbook(paths.noQuotes)
  const availability = readSeedWorkbook(paths.noQuoteMatches)

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

export type IntelligenceDatasets = {
  cornerMap: CornerMap
  noQuote: NoQuoteDataset
  distressed: DistressedDataset
  approved: ApprovedSourceIndex
  index: DailyIndex
}

export function buildAllDatasets(paths = DATA_PATHS): IntelligenceDatasets {
  const approved = readApprovedSourceFile(paths.approvedSource)
  const index = readDailyIndex(paths.index)
  const distressed = buildDistressed(paths)
  const awardSilentCages = new Set<Cage>(distressed.firms.map((f) => f.cage))

  const cornerMap = buildCornerMap({
    approved,
    index,
    awardSilentCages,
    provenance: {
      feedDay: paths.feedDay,
      sourceArchiveKey: SOURCE_ARCHIVE.storageKey,
      sourceArchiveSha256: SOURCE_ARCHIVE.sha256,
      approvedSourceFile: paths.approvedSource,
      indexFile: paths.index,
      silenceListFile: paths.awardSilence,
      computedAt: new Date().toISOString(),
    },
  })

  return { cornerMap, noQuote: buildNoQuoteGoldmine(paths), distressed, approved, index }
}

function toNumber(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
