/**
 * NSN-NOW AWARD HISTORY + AVAILABILITY, PARSED FROM THE BATCH EXPORT.
 *
 * This is the leg the corner map could not read on its own: what the government actually PAID
 * for a part over time, who won it, and who currently lists stock. It comes from the NSN-Now
 * Batch Export (an .xlsx with five named sheets); we read the Procurement and Availability
 * sheets by NAME and join everything on the 13-digit NSN.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT THIS ESTABLISHES, AND WHAT IT STILL WILL NOT CLAIM
 * ---------------------------------------------------------------------------------------
 * Procurement gives real award rows: contract, date, quantity, unit price, awardee (company +
 * CAGE). That is a MEASUREMENT and the pricing surface can finally show a number instead of an
 * abstention. Availability is the NSN-Now view of who lists material, which is NOT the same as
 * ILS and NOT a confirmation the part is physically on a shelf: it is self-reported and may be
 * stale. So an availability row is rendered as "listed by N holders", never as "confirmed
 * available", and the absence of a row is UNKNOWN, never "nobody has it".
 *
 * Every derived figure (last price, escalation, distinct awardees) is computed from the rows
 * present in the export and carries no estimate. A field the export does not contain — a
 * condition code, a price on the availability side — is reported as absent, because it is
 * genuinely absent from this feed, not withheld.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { readWorkbookSheets, usDateToIso, type SeedProvenance } from '@/lib/intelligence/seed/xlsx'
import { dataPath } from '@/lib/data-root'

/** Where the batch exports land. Gitignored; shipped out of band. */
const NSN_NOW_DIR = 'nsn-now'

export type AwardRecord = {
  nsn: string
  contractNo: string | null
  awardDateIso: string | null
  quantity: number | null
  unitPrice: number | null
  company: string | null
  cage: string | null
  /** Post-modification price where the export carries one; else null. This is the EXTENDED total. */
  finalPrice: number | null
  /**
   * The reliable per-unit price. The DIBBS export sometimes carries a $1.00 (or sub-dollar)
   * placeholder in Unit Price while the real money is in the extended Final Price, which produced
   * absurd escalations like $1.00 -> $6,678 (+667,700%) when the true trajectory was ~$5,394 ->
   * $6,678. So the effective unit price is Final Price / quantity whenever both are present, which
   * equals Unit Price when the row is clean and corrects it when Unit Price is a placeholder.
   */
  effectiveUnitPrice: number | null

  /*
   * ============================================================================================
   * THE COLUMNS THAT WERE ON DISK ALL ALONG AND WERE NEVER READ. Added 2026-08-16.
   * ============================================================================================
   * Measured before adding them, over the seven Batch Export workbooks:
   *
   *   AMC             73,714 rows populated      AMSC          73,434 rows populated
   *   Offers          59,990 rows (ALL of them)  Delivery Days 58,401 rows
   *   LTC Expiration  56,637 rows                Set Aside      2,507 rows
   *   First Article      779 rows
   *
   * Every one of them is a signal the trader whose method this product encodes uses by hand,
   * and none of them reached the scoring pipeline. `Offers` is the sharpest: it is the number
   * of bids the government received, and 14,618 rows carry exactly ONE. A single-bidder award
   * on a live requirement is the thinnest competition the data can show.
   *
   * Kept as raw strings where the export's own vocabulary matters (Set Aside, First Article,
   * Surplus), because normalising them here would bury the distinction the operator reads.
   */
  /** Acquisition Method Code. Decoded by `lib/intelligence/codebook.ts`, never here. */
  amc: string | null
  /** Acquisition Method Suffix Code. The reason behind the AMC. */
  amsc: string | null
  /** Number of offers the government received. 1 means a single bidder. */
  offers: number | null
  /** Days the government allowed for delivery. Short means urgent, and urgency pays. */
  deliveryDays: number | null
  /** Set-aside designation as the export words it, or null when the buy was unrestricted. */
  setAside: string | null
  /** First Article Test requirement as worded. A FAT is a real barrier to a new source. */
  firstArticle: string | null
  /** Long-term contract expiry. A corner opens the day an LTC lapses. */
  ltcExpirationIso: string | null
  /** Whether the award was filled from surplus, as worded by the export. */
  surplus: string | null
  solicitation: string | null
  closeDateIso: string | null
}

export type AvailabilityRecord = {
  nsn: string
  company: string | null
  cage: string | null
  quantity: number | null
}

/**
 * A MASTER CROSS REFERENCE LIST row: an APPROVED SOURCE for the item.
 *
 * The MCRL sheet sits inside every Batch Export and was read only from the competitor parts
 * workbook, never from the main exports, so 13,769 approved-source rows carrying the item's
 * acquisition codes went unread. This is the authoritative answer to "who is allowed to make
 * this", which is the first half of the corner thesis.
 */
export type McrlRecord = {
  nsn: string
  company: string | null
  cage: string | null
  partNumber: string | null
  amc: string | null
  amsc: string | null
  /** Whether a technical data package (prints) exists, as worded by the export. */
  prints: string | null
  /** Reference Number Category Code and Reference Number Variation Code. */
  rncc: string | null
  rnvc: string | null
  assignDateIso: string | null
  munitions: string | null
}

/** Per-NSN rollup the surfaces consume. Every field is measured from the rows, never estimated. */
export type NsnAwardSummary = {
  nsn: string
  awards: AwardRecord[]
  /** Most recent award by date. The single most useful anchor for pricing. */
  latest: AwardRecord | null
  /** Distinct awardee CAGEs. 1 = every award went to one company (a hard sole-award signal). */
  distinctAwardees: number
  /** Oldest and newest unit price, so the surface can show the escalation without recomputing. */
  firstUnitPrice: number | null
  lastUnitPrice: number | null
  /** Availability rows for this NSN, from the same export. Listed, not confirmed. */
  holders: AvailabilityRecord[]

  /*
   * ============================================================================================
   * DERIVED SIGNALS. Each one is a line from the operator's own written quote checklist.
   * ============================================================================================
   * Source: "Notes on 4730-00-536-2210 1-8-26.docx", the trader's thought process written out
   * as he decided whether to quote a real requirement. Every field below is COUNTED from the
   * award rows, never estimated, and is null when the rows cannot answer it.
   */
  /** Acquisition codes as most recently recorded against an award. Feeds `readDealerEligibility`. */
  amc: string | null
  amsc: string | null
  /** Offers on the most recent dated award. 1 = a single bidder took it. */
  latestOffers: number | null
  /** The thinnest competition ever recorded on this NSN. */
  minOffers: number | null
  /** Delivery days on the most recent award. Short means the government needed it. */
  latestDeliveryDays: number | null
  /** Largest gap in whole years between consecutive awards. A long gap then a new buy is the
   *  "maintenance opportunity ahead" signal, and it is also when incumbents have moved on. */
  longestDemandGapYears: number | null
  /** Years between the most recent award and the newest award anywhere in the feed, so the
   *  reading is relative to the data, never to the wall clock (which no module here may read). */
  yearsSinceLastAward: number | null
  /** Approved sources from the MCRL sheet. Empty when the export carried none for this NSN. */
  approvedSources: McrlRecord[]
  /** A long-term contract expiry recorded against this NSN, latest first. */
  ltcExpirationIso: string | null
}

/**
 * The span of award dates the feed actually covers.
 *
 * Load-bearing for honesty, not decoration. A "longest gap in demand" of 9.3 years sounds
 * absolute and is not: the export spans 2016 to 2026, so no gap longer than about ten years
 * COULD be observed, whatever the item's real history. Every surface that renders a dormancy
 * figure has to be able to say what the window was, so the window travels with the index.
 */
export type FeedWindow = { firstAwardIso: string | null; lastAwardIso: string | null; years: number | null }

export type NsnAwardIndex = {
  ok: true
  byNsn: Map<string, NsnAwardSummary>
  window: FeedWindow
  provenance: SeedProvenance[]
  counts: {
    files: number
    procurementRows: number
    availabilityRows: number
    /** Approved-source rows read from the MCRL sheet of the main exports. */
    mcrlRows: number
    nsnsWithAwards: number
    nsnsWithApprovedSources: number
  }
}

export type NsnAwardUnavailable = {
  ok: false
  reason: string
  dir: string
}

let cache: NsnAwardIndex | NsnAwardUnavailable | null = null

const digits = (v: string | null | undefined): string => (v ?? '').replace(/[^0-9]/g, '')
const nsn13 = (v: string | null | undefined): string | null => {
  const d = digits(v)
  return d.length === 13 ? d : null
}
const num = (v: string | null | undefined): number | null => {
  if (v == null) return null
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/*
 * ==============================================================================================
 * COLUMN INTEGRITY. Measured on 2026-08-16 across all 59,990 procurement rows in the exports.
 * ==============================================================================================
 * Several columns of the Batch Export are CONTAMINATED: they carry values that cannot be what the
 * header says. This was found by rendering them and disbelieving the result ("9114 bidders on the
 * last award", "the government allowed 1 days"), then counting.
 *
 *     column            clean    dirty   dirty%   examples of dirty values
 *     AMC              59,834      156     0.3%   13190, 13809, 16897, 21528
 *     AMSC             59,834        0     0.0%   (clean)
 *     Offers           44,977   15,013    25.0%   437, 88, 90, 11050, 11063
 *     Delivery Days    57,956      445     0.8%   0, -17, -84, 1170, 1321
 *     LTC Expiration   36,690   19,947    35.2%   437, 88, 727, 2214, 12022
 *     Set Aside         2,507        0     0.0%   (clean)
 *     First Article       779        0     0.0%   (clean)
 *
 * The dirty values in `Offers` and `LTC Expiration` are the SAME family of numbers, which is what a
 * column shift inside the source export looks like. It is NOT this reader: a raw cell-by-cell read
 * of the sheet XML, bypassing this module entirely, returns the identical value from the identical
 * cell reference. The export is wrong, and it is wrong on a quarter to a third of its rows.
 *
 * THE CONSEQUENCE, AND IT IS NOT NEGOTIABLE: a number that is a stray one time in four cannot be
 * put in front of somebody deciding what to bid. So the parse validates ranges here, and the
 * SIGNALS built on `Offers` and `LTC Expiration` abstain outright in `scoring/quote-signals.ts`
 * with the contamination rate stated, rather than showing a plausible-looking figure that is wrong
 * a quarter of the time. The fields stay parsed so the day a clean export arrives, the signal is a
 * one-line change rather than a rebuild.
 */

/** A single character code, or null. Rejects the multi-digit strays measured in AMC. */
const single = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return /^[A-Za-z0-9]$/.test(s) ? s.toUpperCase() : null
}

/** A count inside a plausible range, or null. Outside the range is a stray, not a reading. */
const bounded = (v: string | null | undefined, min: number, max: number): number | null => {
  const s = (v ?? '').trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return n >= min && n <= max ? n : null
}

/**
 * Build the index from every .xlsx in the data-root's nsn-now directory.
 *
 * Multiple files exist because the export is capped at 20,000 records, so a full pull is
 * chunked across several reports. They are merged by NSN. Reading them all, not the newest,
 * because each chunk covers a different slice of the NSN universe.
 */
export function buildNsnAwardIndex(): NsnAwardIndex | NsnAwardUnavailable {
  if (cache) return cache

  const dir = dataPath(NSN_NOW_DIR)
  if (!existsSync(dir)) {
    cache = {
      ok: false,
      reason:
        'No NSN-Now export directory on disk. Award prices come from the Batch Export, so with no export there is no price, and none is estimated in its place.',
      dir,
    }
    return cache
  }

  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~'))
    .map((f) => path.join(dir, f))
    .sort()

  if (files.length === 0) {
    cache = { ok: false, reason: 'The NSN-Now directory exists but holds no .xlsx export yet.', dir }
    return cache
  }

  const awardsByNsn = new Map<string, AwardRecord[]>()
  const holdersByNsn = new Map<string, AvailabilityRecord[]>()
  const mcrlByNsn = new Map<string, McrlRecord[]>()
  const provenance: SeedProvenance[] = []
  let procurementRows = 0
  let availabilityRows = 0
  let mcrlRows = 0

  // Dedup keys, because chunked reports can overlap and a duplicated award would double a count.
  const seenAward = new Set<string>()
  const seenHolder = new Set<string>()
  const seenMcrl = new Set<string>()

  for (const file of files) {
    const wb = readWorkbookSheets(file)
    provenance.push(wb.provenance)

    const proc = wb.sheets.get('Procurement')
    for (const r of proc?.rows ?? []) {
      const nsn = nsn13(r['NSN Number'])
      if (!nsn) continue
      const quantity = num(r['Total Quantity'])
      const unitPrice = num(r['Unit Price'])
      const finalPrice = num(r['Final Price'])
      // finalPrice/quantity ONLY when finalPrice is POSITIVE. Many real rows carry Final Price = 0
      // alongside a good Unit Price; dividing there would zero out a real price and render $0.00 as
      // a measured award. So a zero (or absent) Final Price falls back to the Unit Price.
      const effectiveUnitPrice =
        finalPrice != null && finalPrice > 0 && quantity != null && quantity > 0
          ? Math.round((finalPrice / quantity) * 100) / 100
          : unitPrice
      const txt = (v: string | null | undefined): string | null => {
        const s = (v ?? '').trim()
        return s === '' ? null : s
      }
      const rec: AwardRecord = {
        nsn,
        contractNo: r['Contract No'] ?? null,
        awardDateIso: usDateToIso(r['Award Date'] ?? '') ?? null,
        quantity,
        unitPrice,
        company: r['Company'] ?? null,
        cage: r['Cage'] ?? null,
        finalPrice,
        effectiveUnitPrice,
        // Range-validated, because these columns are measurably contaminated. See
        // COLUMN INTEGRITY below. A value outside its plausible range is not a reading,
        // it is a stray from another column, and it becomes null rather than a number.
        amc: single(r['AMC']),
        amsc: single(r['AMSC']),
        offers: bounded(r['Offers'], 1, 25),
        deliveryDays: bounded(r['Delivery Days'], 1, 1095),
        setAside: txt(r['Set Aside']),
        firstArticle: txt(r['First Article']),
        ltcExpirationIso: usDateToIso(r['LTC Expiration'] ?? '') ?? null,
        surplus: txt(r['Surplus']),
        // The export misspells this header as "Solcitation". Reading the header the file
        // actually carries, not the one it should have carried, because a corrected spelling
        // here would silently read null on every row.
        solicitation: txt(r['Solcitation']) ?? txt(r['Solicitation']),
        closeDateIso: usDateToIso(r['Close Date'] ?? '') ?? null,
      }
      const key = `${nsn}|${rec.contractNo}|${rec.awardDateIso}|${rec.unitPrice}|${rec.cage}`
      if (seenAward.has(key)) continue
      seenAward.add(key)
      const list = awardsByNsn.get(nsn) ?? []
      list.push(rec)
      awardsByNsn.set(nsn, list)
      procurementRows += 1
    }

    // THE MCRL SHEET: the approved-source list, present in every Batch Export and read here
    // for the first time. It is the authoritative half of the corner thesis ("who is even
    // allowed to make this") and it carries the acquisition codes at item level rather than
    // at award level, which is where they actually belong.
    const mcrl = wb.sheets.get('MCRL')
    for (const r of mcrl?.rows ?? []) {
      const nsn = nsn13(r['NSN Number'])
      if (!nsn) continue
      const t = (v: string | null | undefined): string | null => {
        const s = (v ?? '').trim()
        return s === '' ? null : s
      }
      const rec: McrlRecord = {
        nsn,
        company: t(r['Company']),
        cage: t(r['Cage']),
        partNumber: t(r['Part Number']),
        amc: single(r['AMC']),
        amsc: single(r['AMSC']),
        prints: t(r['Prints']),
        rncc: t(r['RNCC']),
        rnvc: t(r['RNVC']),
        assignDateIso: usDateToIso(r['Assign Date'] ?? '') ?? null,
        munitions: t(r['Munitions']),
      }
      const key = `${nsn}|${rec.cage}|${rec.partNumber}`
      if (seenMcrl.has(key)) continue
      seenMcrl.add(key)
      const list = mcrlByNsn.get(nsn) ?? []
      list.push(rec)
      mcrlByNsn.set(nsn, list)
      mcrlRows += 1
    }

    const avail = wb.sheets.get('Availability')
    for (const r of avail?.rows ?? []) {
      const nsn = nsn13(r['NSN Number'])
      if (!nsn) continue
      const rec: AvailabilityRecord = {
        nsn,
        company: r['Company'] ?? null,
        cage: r['Cage'] ?? null,
        quantity: num(r['Quantity']),
      }
      const key = `${nsn}|${rec.cage}|${rec.company}|${rec.quantity}`
      if (seenHolder.has(key)) continue
      seenHolder.add(key)
      const list = holdersByNsn.get(nsn) ?? []
      list.push(rec)
      holdersByNsn.set(nsn, list)
      availabilityRows += 1
    }
  }

  /*
   * The newest award date anywhere in the feed. Every "how long ago" reading below is measured
   * against THIS, not against the wall clock, for two reasons. One, `lib/time/clock.ts` is the
   * only file allowed to read wall time and a parser is not it. Two, a dormancy figure measured
   * against today would drift every day while the underlying export stayed frozen, so the number
   * would change without the evidence changing. Relative to the feed, it is reproducible.
   */
  let feedNewestIso: string | null = null
  let feedOldestIso: string | null = null
  for (const list of awardsByNsn.values()) {
    for (const a of list) {
      if (!a.awardDateIso) continue
      if (feedNewestIso === null || a.awardDateIso > feedNewestIso) feedNewestIso = a.awardDateIso
      if (feedOldestIso === null || a.awardDateIso < feedOldestIso) feedOldestIso = a.awardDateIso
    }
  }
  const yearsBetween = (fromIso: string, toIso: string): number =>
    Math.round(((Date.parse(toIso) - Date.parse(fromIso)) / 31_557_600_000) * 10) / 10

  const byNsn = new Map<string, NsnAwardSummary>()
  for (const [nsn, awards] of awardsByNsn) {
    // Sort chronologically; rows without a date sink to the front so they never masquerade as latest.
    const sorted = [...awards].sort((a, b) => (a.awardDateIso ?? '').localeCompare(b.awardDateIso ?? ''))
    const dated = sorted.filter((a) => a.awardDateIso)
    // Price the series on the RELIABLE per-unit figure, not the raw Unit Price (which can be a
    // $1.00 placeholder). first/last drive every escalation number in the product. A non-positive
    // price is not a real award price, so it never enters the series.
    const priced = sorted.filter((a) => a.effectiveUnitPrice != null && a.effectiveUnitPrice > 0)
    const distinctAwardees = new Set(awards.map((a) => a.cage).filter(Boolean)).size
    const latest = dated.length ? (dated[dated.length - 1] as AwardRecord) : null
    const sources = mcrlByNsn.get(nsn) ?? []

    // The longest quiet stretch between two consecutive awards. The operator's own note:
    // "There were large gaps in demand. It may indicate that there are maintenance
    // opportunities ahead." A gap needs two dated awards to exist at all.
    let longestDemandGapYears: number | null = null
    for (let i = 1; i < dated.length; i += 1) {
      const prev = dated[i - 1]?.awardDateIso
      const cur = dated[i]?.awardDateIso
      if (!prev || !cur) continue
      const gap = yearsBetween(prev, cur)
      if (longestDemandGapYears === null || gap > longestDemandGapYears) longestDemandGapYears = gap
    }

    // Acquisition codes: prefer the item-level MCRL record, fall back to the latest award row.
    // MCRL is the authoritative statement of how the item is acquired; an award row merely
    // records how one buy went.
    const amc = sources.find((s) => s.amc)?.amc ?? latest?.amc ?? null
    const amsc = sources.find((s) => s.amsc)?.amsc ?? latest?.amsc ?? null

    const offersSeen = sorted.map((a) => a.offers).filter((n): n is number => n != null && n > 0)
    const ltc = dated
      .map((a) => a.ltcExpirationIso)
      .filter((d): d is string => Boolean(d))
      .sort()

    byNsn.set(nsn, {
      nsn,
      awards: sorted,
      latest,
      distinctAwardees,
      firstUnitPrice: priced.length ? (priced[0] as AwardRecord).effectiveUnitPrice : null,
      lastUnitPrice: priced.length ? (priced[priced.length - 1] as AwardRecord).effectiveUnitPrice : null,
      holders: holdersByNsn.get(nsn) ?? [],
      amc,
      amsc,
      latestOffers: latest?.offers ?? null,
      minOffers: offersSeen.length ? Math.min(...offersSeen) : null,
      latestDeliveryDays: latest?.deliveryDays ?? null,
      longestDemandGapYears,
      yearsSinceLastAward:
        latest?.awardDateIso && feedNewestIso ? yearsBetween(latest.awardDateIso, feedNewestIso) : null,
      approvedSources: sources,
      ltcExpirationIso: ltc.length ? (ltc[ltc.length - 1] as string) : null,
    })
  }
  // NSNs that have availability or an approved-source record but no award rows still deserve a
  // summary. An approved source with no award history is the purest form of the corner thesis:
  // somebody is allowed to make it and nobody has bought it from them.
  const emptySummary = (nsn: string): NsnAwardSummary => {
    const sources = mcrlByNsn.get(nsn) ?? []
    return {
      nsn,
      awards: [],
      latest: null,
      distinctAwardees: 0,
      firstUnitPrice: null,
      lastUnitPrice: null,
      holders: holdersByNsn.get(nsn) ?? [],
      amc: sources.find((s) => s.amc)?.amc ?? null,
      amsc: sources.find((s) => s.amsc)?.amsc ?? null,
      latestOffers: null,
      minOffers: null,
      latestDeliveryDays: null,
      longestDemandGapYears: null,
      yearsSinceLastAward: null,
      approvedSources: sources,
      ltcExpirationIso: null,
    }
  }
  for (const nsn of holdersByNsn.keys()) if (!byNsn.has(nsn)) byNsn.set(nsn, emptySummary(nsn))
  for (const nsn of mcrlByNsn.keys()) if (!byNsn.has(nsn)) byNsn.set(nsn, emptySummary(nsn))

  cache = {
    ok: true,
    byNsn,
    window: {
      firstAwardIso: feedOldestIso,
      lastAwardIso: feedNewestIso,
      years:
        feedOldestIso && feedNewestIso ? Math.round(yearsBetween(feedOldestIso, feedNewestIso)) : null,
    },
    provenance,
    counts: {
      files: files.length,
      procurementRows,
      availabilityRows,
      mcrlRows,
      nsnsWithAwards: [...awardsByNsn.keys()].length,
      nsnsWithApprovedSources: [...mcrlByNsn.keys()].length,
    },
  }
  return cache
}

/** Test seam: drop the memoized index so a fresh export on disk is picked up. */
export function resetNsnAwardIndexCache(): void {
  cache = null
}
