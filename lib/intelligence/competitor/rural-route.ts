/**
 * THE DEDICATED PULL. A company-specific export, read for everything it holds, and kept
 * visibly apart from the generic teardown that is derived for every other company.
 *
 * =========================================================================================
 * THE QUESTION THIS FILE EXISTS TO ANSWER
 * =========================================================================================
 * The operator's customer asked one thing, by name: look at this competitor's awards,
 * identify whom they procure parts from, and work out whether we can buy from those
 * manufacturers too. That is a JOIN, not a list. The award history says what the competitor
 * sold to the government; the approved-source list says who is allowed to make each of those
 * items; the operator's own supplier book says which of those makers we already hold a way
 * in to. This module performs those three joins and refuses, loudly, wherever a link is not
 * in the data.
 *
 * =========================================================================================
 * WHY THE ANSWER IS A DEALER READ, NOT A MONOPOLY READ. MEASURED, NOT ASSUMED.
 * =========================================================================================
 * The generic teardown counts approved-source rows per CAGE and calls a company with the
 * only row on a stock number a private monopoly. Applied to a spot-buy wholesaler that is a
 * confident category error, and it was live: on the export this lane was pointed at, the
 * subject holds 6 approved-source rows over 865, four of them the only row on their stock
 * number, so the page reported four private manufacturing monopolies for a reseller. One of
 * those four rows carries the literal part number "DISTRIBUTOR".
 *
 * The refutation is in the government's own reference codes, which the export already
 * carries and nothing read. Every one of the subject's six rows is RNCC 5, a SECONDARY
 * reference. None is RNCC 3, the design-control number assigned by the organisation that
 * controls the design. `isIdentityGradeReference` in the codebook is the existing, audited
 * test for that distinction, so this module uses it rather than inventing a second opinion:
 * a company holding zero identity-grade references on the stock numbers it won is not the
 * maker of them, and the sole-source lens is pointed at the makers instead.
 *
 * =========================================================================================
 * ATTRIBUTION IS THREE-STATE, BECAUSE THE HONEST ANSWER IS OFTEN "ONE OF SEVERAL"
 * =========================================================================================
 * For a stock number the competitor won, the makers behind it are the approved sources the
 * MCRL lists. When there is exactly ONE besides the competitor, the article can only have
 * come from that firm and the awarded dollars are attributable. When there are several, the
 * file cannot say which one supplied, and splitting the dollars evenly would be an estimate
 * wearing the clothes of a measurement. So shared dollars are carried as an explicit CEILING
 * on a named set of stock numbers, never as revenue, and the two never share a column.
 *
 * A third state exists and is not a rounding error: stock numbers the competitor won that
 * have no approved-source row in this export at all. The maker is UNKNOWN there, which is a
 * different fact from "no maker" and is counted and shown as its own line.
 *
 * =========================================================================================
 * WHAT THIS FILE WILL NOT DO
 * =========================================================================================
 *  1. It will not name a subject company by guessing. The workbook is identified by its own
 *     filename stem matching a company name inside it, uniquely. Anything else refuses and
 *     the surface falls back to the generic teardown with a stated reason.
 *  2. It will not read the supplier book's silence as a verdict. The book is a researched
 *     list of firms that went AWARD SILENT. A maker missing from it is unknown to us, not
 *     absent from the market, and when the book is not on disk at all every maker reports
 *     `book_unavailable` rather than `not_in_book`.
 *  3. It will not imply freshness. This is a one-time export. The sheets carry no pull date,
 *     so the surface gets a measured bracket (newest award row, file modification time) and
 *     a sentence saying it does not update.
 *
 *     ONE FOLLOW-UP FOR THE LANE THAT OWNS `seed/xlsx.ts`, RECORDED HERE RATHER THAN ACTED
 *     ON: the workbook's own `docProps/core.xml` carries a created timestamp, which is the
 *     true pull date and is strictly better than the bracket below. Exposing it would mean
 *     `readWorkbookSheets` returning it alongside the sheets. Reaching into the zip from
 *     here would mean a second container parser in the codebase, which is exactly the thing
 *     that produces two readers that disagree, so this module does without it.
 *
 * Pure computation is separated from I/O on purpose: `computeDedicatedPull` takes rows and a
 * book port and returns the whole analysis, so it can be exercised against a synthetic
 * workbook whose answers are known by construction rather than only against the real file.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { readWorkbookSheets, usDateToIso, type ParsedSheet, type SeedProvenance } from '@/lib/intelligence/seed/xlsx'
import { dataPath } from '@/lib/data-root'
import { isIdentityGradeReference, readDealerEligibility, type ManufacturingAccess } from '@/lib/intelligence/codebook'
import { buildDistressedSuppliers } from '@/lib/intelligence/suppliers/distressed'

/** Where the operator-supplied exports land. Gitignored, shipped out of band. */
const SUPPLIERS_DIR = 'suppliers'

/**
 * A dedicated pull is only a dedicated pull if all four sheets are there. A file with three
 * of them is a different artifact and must not be half-rendered under this heading.
 */
const REQUIRED_SHEETS = ['MCRL', 'Procurement', 'Availability', 'DLA Forecast'] as const

export type SheetRow = Record<string, string | null>

/* ------------------------------------------------------------------------------------ */
/* TYPES                                                                                  */
/* ------------------------------------------------------------------------------------ */

/** How confidently the makers behind one awarded stock number can be named. */
export type Attribution =
  /** Exactly one approved source besides the subject. The article can only have come from it. */
  | 'single_approved_source'
  /** Several approved sources. The file cannot say which one supplied. */
  | 'several_approved_sources'
  /** No approved-source row for this stock number in this export. The maker is unknown. */
  | 'no_approved_source_recorded'

/** What the operator's own supplier book knows about a maker. Absence is never a verdict. */
export type BookMatch =
  | {
      state: 'contactable' | 'in_book_no_channel'
      tier: string | null
      score: number | null
      contacts: number
      hasEmail: boolean
      hasPhone: boolean
      /** The researcher's read, carried through as a PRIOR and labelled as one. */
      holdsInventory: string | null
      lastAwardedAt: string | null
    }
  | { state: 'not_in_book' }
  | { state: 'book_unavailable'; reason: string }

export type MakerRow = {
  cage: string
  company: string | null
  /** Stock numbers where this maker is the ONLY approved source besides the subject. */
  soleNsns: string[]
  /** Awarded value on those stock numbers. Attributable to this maker and to no one else. */
  soleAwardedValue: number
  /** Stock numbers where this maker is one of several approved sources. */
  sharedNsns: string[]
  /**
   * UPPER BOUND on this maker's share of the shared stock numbers, being the whole awarded
   * value of them. It is not revenue and the several makers' ceilings deliberately overlap.
   */
  sharedAwardedValueCeiling: number
  /** True where this maker holds a design-control or source-control reference on at least one. */
  holdsIdentityGradeReference: boolean
  identityGradeNsns: number
  book: BookMatch
  /** Other CAGE codes in this export carrying an identical company name. Not confirmed as one firm. */
  sameNameCages: string[]
}

/** One stock number the subject won, with everything this export knows about it. */
export type SubjectPart = {
  nsn: string
  niin: string
  description: string
  awards: number
  awardedValue: number
  /** Awards whose value cell could not be read as a number. Excluded from the sum, never zeroed. */
  awardsWithUnreadValue: number
  latestAwardIso: string | null
  latestUnitPrice: number | null
  latestOffers: number | null
  attribution: Attribution
  makers: Array<{ cage: string; company: string | null; identityGrade: boolean }>
  /** The codebook read on the newest award's acquisition codes. Unknown where a code is absent. */
  route: { access: ManufacturingAccess; sourceApprovalEligible: boolean; unknown: boolean; basis: string }
  /** Null means no forecast row at all. A zero quantity is a published zero and is not null. */
  forecast: { rows: number; quantity: number } | null
  /** Null means no availability row at all, which is unknown and never "nobody has it". */
  spot: { holders: number; quantity: number } | null
}

export type RivalRow = {
  cage: string
  company: string | null
  awards: number
  awardedValue: number
  nsns: number
  /** True where this rival is also an approved source on at least one of the subject's parts. */
  isApprovedSource: boolean
}

export type SpotHolder = {
  cage: string
  company: string | null
  nsns: number
  unitsListed: number
  isApprovedSource: boolean
  inBook: boolean
}

export type SubjectRole = {
  awardRows: number
  awardedNsns: number
  awardedValue: number
  awardsWithUnreadValue: number
  windowStartIso: string | null
  windowEndIso: string | null
  /** Approved-source rows the subject itself holds anywhere in this export. */
  approvedSourceRows: number
  approvedSourceNsns: number
  /** Of the stock numbers it WON, how many list it as an approved source. */
  approvedOnAwardedNsns: number
  /** Rows where the subject's own reference is identity grade (RNCC 3/1/2 with RNVC 2). */
  identityGradeRows: number
  verdict: 'dealer_pattern' | 'maker_pattern' | 'undetermined'
  basis: string
}

export type AcquisitionRead = {
  /** Award counts by acquisition method code, the export's own values, blanks counted as blanks. */
  amc: Array<{ code: string; awards: number }>
  amsc: Array<{ code: string; awards: number }>
  /** Awards the government directed at the manufacturer or a prime (AMC 3, 4, 5). */
  directFromManufacturerAwards: number
  singleBidAwards: number
  awardsWithOffersRead: number
  /** Awards whose Surplus cell was blank. Blank is UNREAD, never "not surplus". */
  surplusUnreadAwards: number
  surplusYesAwards: number
}

export type PullSnapshot = {
  fileLabel: string
  provenance: SeedProvenance
  sheetRows: Array<{ sheet: string; rows: number }>
  /** The newest award date in the export. The export was pulled on or after this. */
  newestAwardIso: string | null
  oldestAwardIso: string | null
  /** First month of the demand forecast horizon, which opens after the pull. */
  forecastOpensMonth: string | null
  forecastClosesMonth: string | null
  /** THE HONEST STATEMENT. The sheets carry no pull date; these two dates bracket it. */
  pullDateBasis: 'bracketed_by_newest_award_and_file_mtime'
}

export type DedicatedPull = {
  subject: { cage: string; company: string | null }
  /** Corroboration for the identification, shown next to it rather than trusted silently. */
  identification: {
    basis: 'filename_stem_matches_company_name'
    stem: string
    /** Share of all award rows in the export won by the subject. */
    awardRowShare: number
    isPluralityAwardee: boolean
  }
  snapshot: PullSnapshot
  role: SubjectRole
  attribution: {
    singleMakerNsns: number
    singleMakerValue: number
    severalMakerNsns: number
    severalMakerValueCeiling: number
    noRecordNsns: number
    noRecordValue: number
  }
  makers: MakerRow[]
  /** The subset we already hold a way in to, sorted by attributable dollars. The Monday list. */
  contactableMakers: MakerRow[]
  /**
   * The four book states counted once, here, so no surface re-sums a headline from rendered
   * rows and no surface has to decide what an absent book means.
   */
  bookSummary: {
    makers: number
    contactable: number
    inBookNoChannel: number
    notInBook: number
    unknownBecauseBookMissing: number
  }
  bookAvailable: boolean
  bookReason: string | null
  parts: SubjectPart[]
  rivals: RivalRow[]
  spotMarket: {
    firms: number
    rows: number
    nsns: number
    unitsListed: number
    zeroQuantityRows: number
    firmsAlsoApprovedSource: number
    holders: SpotHolder[]
  }
  forecast: {
    rows: number
    nsns: number
    nsnsAlsoAwarded: number
    unitsForecast: number
    zeroQuantityRows: number
    unparsedDateRows: number
    supplyChains: Array<{ chain: string; rows: number }>
  }
  acquisition: AcquisitionRead
}

export type DedicatedPullIndex = {
  /** Keyed by subject CAGE. */
  pulls: Map<string, DedicatedPull>
  /** Files that look like a dedicated pull and were not read, each with the reason. */
  skipped: Array<{ file: string; reason: string }>
}

/* ------------------------------------------------------------------------------------ */
/* SMALL PURE HELPERS                                                                     */
/* ------------------------------------------------------------------------------------ */

const cell = (row: SheetRow, key: string): string => (row[key] ?? '').trim()

const numberOrNull = (raw: string): number | null => {
  if (raw === '') return null
  const n = Number(raw.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Compare by name only. Never used to merge CAGEs, only to note that a name repeats. */
export function normalizeCompanyName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const niinOf = (nsn: string): string => nsn.replace(/[^0-9]/g, '').slice(-9)

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * `Apr 2027` to `2027-04`. Returns null rather than inventing a month, because the forecast
 * horizon is rendered as a range and a mis-parsed bound would move it silently.
 */
export function forecastMonthToIso(value: string): string | null {
  const m = /^([A-Za-z]{3,})\s+(\d{4})$/.exec(value.trim())
  if (!m) return null
  const idx = MONTHS.indexOf((m[1] as string).slice(0, 3).toLowerCase())
  if (idx < 0) return null
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}`
}

/**
 * The awarded value of one award row.
 *
 * Final Price is the post-modification total and is the number the government actually
 * committed; Total Price is the pre-modification one. On the export this was built against,
 * 7 of the subject's 533 rows carry a negative modification, so the two sums differ by
 * $181,832. Final Price wins where it reads as a number, Total Price is the fallback, and a
 * row where neither reads is COUNTED as unread rather than added as a zero.
 */
export function awardValue(row: SheetRow): number | null {
  return numberOrNull(cell(row, 'Final Price')) ?? numberOrNull(cell(row, 'Total Price'))
}

/** The subject's own identification. Refuses on zero matches and on ambiguity alike. */
export function resolveSubjectCage(
  fileName: string,
  rows: SheetRow[],
): { ok: true; cage: string; company: string; stem: string } | { ok: false; reason: string; stem: string } {
  const stem = fileName.replace(/-parts\.xlsx$/i, '')
  const normalizedStem = normalizeCompanyName(stem)
  if (normalizedStem.length < 4) {
    return { ok: false, stem, reason: `the filename stem "${stem}" is too short to identify a company` }
  }
  const byName = new Map<string, { display: string; cages: Set<string> }>()
  for (const row of rows) {
    const company = cell(row, 'Company')
    const cage = cell(row, 'Cage').toUpperCase()
    if (!company || !cage) continue
    const key = normalizeCompanyName(company)
    const entry = byName.get(key) ?? { display: company, cages: new Set<string>() }
    entry.cages.add(cage)
    byName.set(key, entry)
  }
  const matches = [...byName.entries()].filter(([key]) => key.startsWith(normalizedStem))
  if (matches.length === 0) {
    return { ok: false, stem, reason: `no company in the export is named for the file stem "${stem}"` }
  }
  const cages = new Set(matches.flatMap(([, v]) => [...v.cages]))
  if (cages.size !== 1) {
    return {
      ok: false,
      stem,
      reason: `the file stem "${stem}" matches ${cages.size} company codes (${[...cages].join(', ')}), so the subject is ambiguous`,
    }
  }
  const [first] = matches
  return { ok: true, cage: [...cages][0] as string, company: (first as [string, { display: string }])[1].display, stem }
}

/* ------------------------------------------------------------------------------------ */
/* THE SUPPLIER BOOK PORT                                                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * What this module needs from the operator's supplier book, and nothing more.
 *
 * `available` is separate from the lookup on purpose. When the book is not on disk every
 * lookup returns null, and reading that as "this maker is not in our book" would turn a
 * missing FILE into a claim about 159 companies.
 */
export type BookPort = {
  available: boolean
  reason: string | null
  lookup: (cage: string) => {
    tier: string | null
    score: number | null
    contacts: number
    hasEmail: boolean
    hasPhone: boolean
    holdsInventory: string | null
    lastAwardedAt: string | null
  } | null
}

export function liveBookPort(): BookPort {
  const book = buildDistressedSuppliers()
  if (!book.ok) return { available: false, reason: book.reason, lookup: () => null }
  return {
    available: true,
    reason: null,
    lookup: (cage) => {
      const s = book.byCage.get(cage.toUpperCase())
      if (!s) return null
      return {
        tier: s.prospectTier,
        score: s.prospectScore,
        contacts: s.contacts.length,
        hasEmail: Boolean(s.email) || s.contacts.some((c) => Boolean(c.email)),
        hasPhone: Boolean(s.phone) || s.contacts.some((c) => Boolean(c.phone)),
        holdsInventory: s.holdsInventory,
        lastAwardedAt: s.lastAwardedAt,
      }
    },
  }
}

function matchBook(cage: string, book: BookPort): BookMatch {
  if (!book.available) {
    return { state: 'book_unavailable', reason: book.reason ?? 'the supplier book is not loaded' }
  }
  const hit = book.lookup(cage)
  if (!hit) return { state: 'not_in_book' }
  const reachable = hit.hasEmail || hit.hasPhone || hit.contacts > 0
  return {
    state: reachable ? 'contactable' : 'in_book_no_channel',
    tier: hit.tier,
    score: hit.score,
    contacts: hit.contacts,
    hasEmail: hit.hasEmail,
    hasPhone: hit.hasPhone,
    holdsInventory: hit.holdsInventory,
    lastAwardedAt: hit.lastAwardedAt,
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE COMPUTATION                                                                        */
/* ------------------------------------------------------------------------------------ */

export type PullInput = {
  fileLabel: string
  provenance: SeedProvenance
  subjectCage: string
  subjectCompany: string | null
  stem: string
  mcrl: SheetRow[]
  procurement: SheetRow[]
  availability: SheetRow[]
  forecast: SheetRow[]
  book: BookPort
}

export function computeDedicatedPull(input: PullInput): DedicatedPull {
  const subject = input.subjectCage.toUpperCase()

  /* ---- the approved-source web, one entry per (stock number, CAGE) ------------------ */
  type Source = { cage: string; company: string | null; identityGrade: boolean }
  const sourcesByNsn = new Map<string, Map<string, Source>>()
  const companyOfCage = new Map<string, string | null>()
  let subjectApprovedRows = 0
  let subjectIdentityGradeRows = 0

  for (const row of input.mcrl) {
    const nsn = cell(row, 'NSN Number')
    const cage = cell(row, 'Cage').toUpperCase()
    if (!nsn || !cage) continue
    const company = cell(row, 'Company') || null
    const identityGrade = isIdentityGradeReference(cell(row, 'RNCC') || null, cell(row, 'RNVC') || null)
    if (cage === subject) {
      subjectApprovedRows += 1
      if (identityGrade) subjectIdentityGradeRows += 1
    }
    const perNsn = sourcesByNsn.get(nsn) ?? new Map<string, Source>()
    const existing = perNsn.get(cage)
    if (existing) {
      // The same CAGE can hold several references on one stock number. Identity grade is a
      // property of the strongest one, so it is OR-ed rather than overwritten by the last row.
      existing.identityGrade = existing.identityGrade || identityGrade
    } else {
      perNsn.set(cage, { cage, company, identityGrade })
    }
    sourcesByNsn.set(nsn, perNsn)
    if (!companyOfCage.has(cage) && company) companyOfCage.set(cage, company)
  }

  /* ---- the subject's award history -------------------------------------------------- */
  type Award = {
    nsn: string
    description: string
    iso: string | null
    value: number | null
    unitPrice: number | null
    offers: number | null
    amc: string
    amsc: string
    surplus: string
  }
  const subjectAwards: Award[] = []
  const rivalAwards: Array<{ cage: string; company: string | null; nsn: string; value: number | null }> = []

  for (const row of input.procurement) {
    const cage = cell(row, 'Cage').toUpperCase()
    const nsn = cell(row, 'NSN Number')
    if (!nsn || !cage) continue
    const company = cell(row, 'Company') || null
    if (!companyOfCage.has(cage) && company) companyOfCage.set(cage, company)
    if (cage !== subject) {
      rivalAwards.push({ cage, company, nsn, value: awardValue(row) })
      continue
    }
    subjectAwards.push({
      nsn,
      description: cell(row, 'Description'),
      iso: usDateToIso(cell(row, 'Award Date')),
      value: awardValue(row),
      unitPrice: numberOrNull(cell(row, 'Unit Price')),
      offers: numberOrNull(cell(row, 'Offers')),
      amc: cell(row, 'AMC'),
      amsc: cell(row, 'AMSC'),
      surplus: cell(row, 'Surplus'),
    })
  }

  const awardedNsns = new Set(subjectAwards.map((a) => a.nsn))
  const valueByNsn = new Map<string, number>()
  let awardedValue = 0
  let awardsWithUnreadValue = 0
  for (const a of subjectAwards) {
    if (a.value == null) {
      awardsWithUnreadValue += 1
      continue
    }
    awardedValue += a.value
    valueByNsn.set(a.nsn, (valueByNsn.get(a.nsn) ?? 0) + a.value)
  }
  const awardDates = subjectAwards.map((a) => a.iso).filter((d): d is string => d != null).sort()

  /* ---- attribution, and the makers behind the awards -------------------------------- */
  const attributionOf = (nsn: string): { state: Attribution; others: Source[] } => {
    const others = [...(sourcesByNsn.get(nsn)?.values() ?? [])].filter((s) => s.cage !== subject)
    if (others.length === 0) return { state: 'no_approved_source_recorded', others }
    if (others.length === 1) return { state: 'single_approved_source', others }
    return { state: 'several_approved_sources', others }
  }

  const makerAccum = new Map<string, MakerRow>()
  const attribution = {
    singleMakerNsns: 0,
    singleMakerValue: 0,
    severalMakerNsns: 0,
    severalMakerValueCeiling: 0,
    noRecordNsns: 0,
    noRecordValue: 0,
  }

  for (const nsn of awardedNsns) {
    const { state, others } = attributionOf(nsn)
    const value = valueByNsn.get(nsn) ?? 0
    if (state === 'no_approved_source_recorded') {
      attribution.noRecordNsns += 1
      attribution.noRecordValue += value
      continue
    }
    if (state === 'single_approved_source') {
      attribution.singleMakerNsns += 1
      attribution.singleMakerValue += value
    } else {
      attribution.severalMakerNsns += 1
      attribution.severalMakerValueCeiling += value
    }
    for (const source of others) {
      const row =
        makerAccum.get(source.cage) ??
        ({
          cage: source.cage,
          company: source.company ?? companyOfCage.get(source.cage) ?? null,
          soleNsns: [],
          soleAwardedValue: 0,
          sharedNsns: [],
          sharedAwardedValueCeiling: 0,
          holdsIdentityGradeReference: false,
          identityGradeNsns: 0,
          book: matchBook(source.cage, input.book),
          sameNameCages: [],
        } satisfies MakerRow)
      if (source.identityGrade) {
        row.holdsIdentityGradeReference = true
        row.identityGradeNsns += 1
      }
      if (state === 'single_approved_source') {
        row.soleNsns.push(nsn)
        row.soleAwardedValue += value
      } else {
        row.sharedNsns.push(nsn)
        row.sharedAwardedValueCeiling += value
      }
      makerAccum.set(source.cage, row)
    }
  }

  /*
   * SAME NAME IS NOT SAME COMPANY, AND THIS NOTE IS DELIBERATELY NOT A MERGE.
   * On the export this was built against, 13 company names appear on more than one CAGE
   * (Boeing on 5, Northrop Grumman on 8). Fusing them would change every count on the page
   * and would invent a corporate structure the file does not assert. So each row carries the
   * other codes wearing its name, and the reader decides.
   */
  const cagesByName = new Map<string, string[]>()
  for (const row of makerAccum.values()) {
    if (!row.company) continue
    const key = normalizeCompanyName(row.company)
    cagesByName.set(key, [...(cagesByName.get(key) ?? []), row.cage])
  }
  for (const row of makerAccum.values()) {
    if (!row.company) continue
    const siblings = (cagesByName.get(normalizeCompanyName(row.company)) ?? []).filter((c) => c !== row.cage)
    row.sameNameCages = siblings.sort()
  }

  const makers = [...makerAccum.values()].sort(
    (a, b) =>
      b.soleAwardedValue - a.soleAwardedValue ||
      b.sharedAwardedValueCeiling - a.sharedAwardedValueCeiling ||
      a.cage.localeCompare(b.cage),
  )

  /* ---- the forecast and the spot market, both keyed by stock number ------------------ */
  const forecastByNsn = new Map<string, { rows: number; quantity: number }>()
  const forecastMonths: string[] = []
  const supplyChains = new Map<string, number>()
  let forecastZeroRows = 0
  let forecastUnparsedDates = 0
  let forecastUnits = 0
  for (const row of input.forecast) {
    const nsn = cell(row, 'NSN Number')
    if (!nsn) continue
    const qty = numberOrNull(cell(row, 'Quantity'))
    if (qty === 0) forecastZeroRows += 1
    const entry = forecastByNsn.get(nsn) ?? { rows: 0, quantity: 0 }
    entry.rows += 1
    entry.quantity += qty ?? 0
    forecastUnits += qty ?? 0
    forecastByNsn.set(nsn, entry)
    const month = forecastMonthToIso(cell(row, 'Forecast Date'))
    if (month) forecastMonths.push(month)
    else forecastUnparsedDates += 1
    const chain = cell(row, 'Supply Chain') || 'unstated'
    supplyChains.set(chain, (supplyChains.get(chain) ?? 0) + 1)
  }
  forecastMonths.sort()

  const spotByNsn = new Map<string, { holders: number; quantity: number }>()
  const spotByCage = new Map<string, SpotHolder>()
  let spotZeroRows = 0
  let spotUnits = 0
  for (const row of input.availability) {
    const nsn = cell(row, 'NSN Number')
    const cage = cell(row, 'Cage').toUpperCase()
    if (!nsn || !cage) continue
    const qty = numberOrNull(cell(row, 'Quantity'))
    if (qty === 0) spotZeroRows += 1
    spotUnits += qty ?? 0
    const perNsn = spotByNsn.get(nsn) ?? { holders: 0, quantity: 0 }
    perNsn.holders += 1
    perNsn.quantity += qty ?? 0
    spotByNsn.set(nsn, perNsn)
    const holder =
      spotByCage.get(cage) ??
      ({
        cage,
        company: cell(row, 'Company') || null,
        nsns: 0,
        unitsListed: 0,
        isApprovedSource: false,
        inBook: false,
      } satisfies SpotHolder)
    holder.nsns += 1
    holder.unitsListed += qty ?? 0
    spotByCage.set(cage, holder)
  }
  const everyApprovedCage = new Set<string>()
  for (const perNsn of sourcesByNsn.values()) for (const c of perNsn.keys()) everyApprovedCage.add(c)
  for (const holder of spotByCage.values()) {
    holder.isApprovedSource = everyApprovedCage.has(holder.cage)
    holder.inBook = input.book.available && input.book.lookup(holder.cage) != null
  }

  /* ---- the per stock number table ---------------------------------------------------- */
  const byNsn = new Map<string, Award[]>()
  for (const a of subjectAwards) byNsn.set(a.nsn, [...(byNsn.get(a.nsn) ?? []), a])

  const parts: SubjectPart[] = []
  for (const [nsn, awards] of byNsn) {
    const ordered = [...awards].sort((a, b) => (a.iso ?? '').localeCompare(b.iso ?? ''))
    const latest = ordered[ordered.length - 1] as Award
    const { state, others } = attributionOf(nsn)
    const eligibility = readDealerEligibility(latest.amc || null, latest.amsc || null)
    parts.push({
      nsn,
      niin: niinOf(nsn),
      description: latest.description,
      awards: awards.length,
      awardedValue: valueByNsn.get(nsn) ?? 0,
      awardsWithUnreadValue: awards.filter((a) => a.value == null).length,
      latestAwardIso: latest.iso,
      latestUnitPrice: latest.unitPrice,
      latestOffers: latest.offers,
      attribution: state,
      makers: others.map((o) => ({ cage: o.cage, company: o.company, identityGrade: o.identityGrade })),
      route: {
        access: eligibility.manufacturing,
        sourceApprovalEligible: eligibility.sourceApprovalEligible,
        unknown: eligibility.unknown,
        basis: eligibility.basis,
      },
      forecast: forecastByNsn.get(nsn) ?? null,
      spot: spotByNsn.get(nsn) ?? null,
    })
  }
  parts.sort((a, b) => b.awardedValue - a.awardedValue || a.nsn.localeCompare(b.nsn))

  /* ---- rivals on the subject's own stock numbers -------------------------------------- */
  const rivalAccum = new Map<string, { cage: string; company: string | null; awards: number; value: number; nsns: Set<string> }>()
  for (const r of rivalAwards) {
    if (!awardedNsns.has(r.nsn)) continue
    const entry = rivalAccum.get(r.cage) ?? { cage: r.cage, company: r.company, awards: 0, value: 0, nsns: new Set<string>() }
    entry.awards += 1
    entry.value += r.value ?? 0
    entry.nsns.add(r.nsn)
    rivalAccum.set(r.cage, entry)
  }
  const rivals: RivalRow[] = [...rivalAccum.values()]
    .map((r) => ({
      cage: r.cage,
      company: r.company,
      awards: r.awards,
      awardedValue: r.value,
      nsns: r.nsns.size,
      isApprovedSource: everyApprovedCage.has(r.cage),
    }))
    .sort((a, b) => b.awardedValue - a.awardedValue || a.cage.localeCompare(b.cage))

  /* ---- the acquisition read ----------------------------------------------------------- */
  const amc = new Map<string, number>()
  const amsc = new Map<string, number>()
  let directFromManufacturerAwards = 0
  let singleBidAwards = 0
  let awardsWithOffersRead = 0
  let surplusUnreadAwards = 0
  let surplusYesAwards = 0
  for (const a of subjectAwards) {
    const amcKey = a.amc || 'absent'
    const amscKey = a.amsc || 'absent'
    amc.set(amcKey, (amc.get(amcKey) ?? 0) + 1)
    amsc.set(amscKey, (amsc.get(amscKey) ?? 0) + 1)
    if (a.amc === '3' || a.amc === '4' || a.amc === '5') directFromManufacturerAwards += 1
    if (a.offers != null) {
      awardsWithOffersRead += 1
      if (a.offers === 1) singleBidAwards += 1
    }
    if (a.surplus === '') surplusUnreadAwards += 1
    else if (/^y|^true|^surplus/i.test(a.surplus)) surplusYesAwards += 1
  }

  /* ---- the subject's own role --------------------------------------------------------- */
  const approvedOnAwardedNsns = [...awardedNsns].filter((n) => sourcesByNsn.get(n)?.has(subject)).length
  const subjectApprovedNsns = [...sourcesByNsn.entries()].filter(([, m]) => m.has(subject)).length
  const verdict: SubjectRole['verdict'] =
    awardedNsns.size === 0
      ? 'undetermined'
      : subjectIdentityGradeRows === 0 && approvedOnAwardedNsns * 2 < awardedNsns.size
        ? 'dealer_pattern'
        : subjectIdentityGradeRows > 0 && approvedOnAwardedNsns * 2 >= awardedNsns.size
          ? 'maker_pattern'
          : 'undetermined'
  const basis =
    verdict === 'dealer_pattern'
      ? `holds no design-control or source-control reference in this export, and is a listed approved source on ${approvedOnAwardedNsns} of the ${awardedNsns.size} stock numbers it won`
      : verdict === 'maker_pattern'
        ? `holds ${subjectIdentityGradeRows} identity-grade reference rows and is a listed approved source on ${approvedOnAwardedNsns} of the ${awardedNsns.size} stock numbers it won`
        : `identity-grade rows ${subjectIdentityGradeRows}, approved on ${approvedOnAwardedNsns} of ${awardedNsns.size} awarded stock numbers, which does not settle either reading`

  const subjectRowShare = input.procurement.length > 0 ? subjectAwards.length / input.procurement.length : 0
  const awardRowsByCage = new Map<string, number>()
  for (const row of input.procurement) {
    const cage = cell(row, 'Cage').toUpperCase()
    if (cage) awardRowsByCage.set(cage, (awardRowsByCage.get(cage) ?? 0) + 1)
  }
  const topAwardee = [...awardRowsByCage.entries()].sort((a, b) => b[1] - a[1])[0]

  return {
    subject: { cage: subject, company: input.subjectCompany },
    identification: {
      basis: 'filename_stem_matches_company_name',
      stem: input.stem,
      awardRowShare: subjectRowShare,
      isPluralityAwardee: topAwardee ? topAwardee[0] === subject : false,
    },
    snapshot: {
      fileLabel: input.fileLabel,
      provenance: input.provenance,
      sheetRows: [
        { sheet: 'MCRL', rows: input.mcrl.length },
        { sheet: 'Procurement', rows: input.procurement.length },
        { sheet: 'Availability', rows: input.availability.length },
        { sheet: 'DLA Forecast', rows: input.forecast.length },
      ],
      newestAwardIso: awardDates.length > 0 ? (awardDates[awardDates.length - 1] as string) : null,
      oldestAwardIso: awardDates.length > 0 ? (awardDates[0] as string) : null,
      forecastOpensMonth: forecastMonths.length > 0 ? (forecastMonths[0] as string) : null,
      forecastClosesMonth: forecastMonths.length > 0 ? (forecastMonths[forecastMonths.length - 1] as string) : null,
      pullDateBasis: 'bracketed_by_newest_award_and_file_mtime',
    },
    role: {
      awardRows: subjectAwards.length,
      awardedNsns: awardedNsns.size,
      awardedValue,
      awardsWithUnreadValue,
      windowStartIso: awardDates.length > 0 ? (awardDates[0] as string) : null,
      windowEndIso: awardDates.length > 0 ? (awardDates[awardDates.length - 1] as string) : null,
      approvedSourceRows: subjectApprovedRows,
      approvedSourceNsns: subjectApprovedNsns,
      approvedOnAwardedNsns,
      identityGradeRows: subjectIdentityGradeRows,
      verdict,
      basis,
    },
    attribution,
    makers,
    contactableMakers: makers.filter((m) => m.book.state === 'contactable'),
    bookSummary: {
      makers: makers.length,
      contactable: makers.filter((m) => m.book.state === 'contactable').length,
      inBookNoChannel: makers.filter((m) => m.book.state === 'in_book_no_channel').length,
      notInBook: makers.filter((m) => m.book.state === 'not_in_book').length,
      unknownBecauseBookMissing: makers.filter((m) => m.book.state === 'book_unavailable').length,
    },
    bookAvailable: input.book.available,
    bookReason: input.book.reason,
    parts,
    rivals,
    spotMarket: {
      firms: spotByCage.size,
      rows: input.availability.length,
      nsns: spotByNsn.size,
      unitsListed: spotUnits,
      zeroQuantityRows: spotZeroRows,
      firmsAlsoApprovedSource: [...spotByCage.values()].filter((h) => h.isApprovedSource).length,
      holders: [...spotByCage.values()].sort((a, b) => b.nsns - a.nsns || b.unitsListed - a.unitsListed),
    },
    forecast: {
      rows: input.forecast.length,
      nsns: forecastByNsn.size,
      nsnsAlsoAwarded: [...forecastByNsn.keys()].filter((n) => awardedNsns.has(n)).length,
      unitsForecast: forecastUnits,
      zeroQuantityRows: forecastZeroRows,
      unparsedDateRows: forecastUnparsedDates,
      supplyChains: [...supplyChains.entries()]
        .map(([chain, rows]) => ({ chain, rows }))
        .sort((a, b) => b.rows - a.rows),
    },
    acquisition: {
      amc: [...amc.entries()].map(([code, awards]) => ({ code, awards })).sort((a, b) => b.awards - a.awards),
      amsc: [...amsc.entries()].map(([code, awards]) => ({ code, awards })).sort((a, b) => b.awards - a.awards),
      directFromManufacturerAwards,
      singleBidAwards,
      awardsWithOffersRead,
      surplusUnreadAwards,
      surplusYesAwards,
    },
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE LOADER                                                                             */
/* ------------------------------------------------------------------------------------ */

let cache: DedicatedPullIndex | null = null

const sheetRows = (sheet: ParsedSheet | undefined): SheetRow[] => sheet?.rows ?? []

/**
 * Read every `<company>-parts.xlsx` in the suppliers directory that carries all four sheets
 * and resolves to exactly one subject company. Nothing is hardcoded to a filename: a second
 * export dropped beside the first gets its own deep view on the next request.
 */
export function buildDedicatedPulls(book: BookPort = liveBookPort()): DedicatedPullIndex {
  if (cache) return cache
  const dir = dataPath(SUPPLIERS_DIR)
  if (!existsSync(dir)) {
    cache = { pulls: new Map(), skipped: [] }
    return cache
  }
  const pulls = new Map<string, DedicatedPull>()
  const skipped: Array<{ file: string; reason: string }> = []

  for (const file of readdirSync(dir).filter((f) => /-parts\.xlsx$/i.test(f)).sort()) {
    let workbook
    try {
      workbook = readWorkbookSheets(path.join(dir, file))
    } catch (error) {
      skipped.push({ file, reason: `the workbook could not be read (${(error as Error).message})` })
      continue
    }
    const missing = REQUIRED_SHEETS.filter((name) => !workbook.sheets.has(name))
    if (missing.length > 0) {
      skipped.push({ file, reason: `no ${missing.join(', ')} sheet, so this is not a full dedicated pull` })
      continue
    }
    const mcrl = sheetRows(workbook.sheets.get('MCRL'))
    const procurement = sheetRows(workbook.sheets.get('Procurement'))
    const subject = resolveSubjectCage(file, [...mcrl, ...procurement])
    if (!subject.ok) {
      skipped.push({ file, reason: subject.reason })
      continue
    }
    pulls.set(
      subject.cage,
      computeDedicatedPull({
        fileLabel: file,
        provenance: workbook.provenance,
        subjectCage: subject.cage,
        subjectCompany: subject.company,
        stem: subject.stem,
        mcrl,
        procurement,
        availability: sheetRows(workbook.sheets.get('Availability')),
        forecast: sheetRows(workbook.sheets.get('DLA Forecast')),
        book,
      }),
    )
  }

  cache = { pulls, skipped }
  return cache
}

/** Tests build several indexes in one process; the memo would otherwise leak between them. */
export function resetDedicatedPullCache(): void {
  cache = null
}
