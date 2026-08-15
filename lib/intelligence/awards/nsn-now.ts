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
}

export type AvailabilityRecord = {
  nsn: string
  company: string | null
  cage: string | null
  quantity: number | null
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
}

export type NsnAwardIndex = {
  ok: true
  byNsn: Map<string, NsnAwardSummary>
  provenance: SeedProvenance[]
  counts: { files: number; procurementRows: number; availabilityRows: number; nsnsWithAwards: number }
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
  const provenance: SeedProvenance[] = []
  let procurementRows = 0
  let availabilityRows = 0

  // Dedup keys, because chunked reports can overlap and a duplicated award would double a count.
  const seenAward = new Set<string>()
  const seenHolder = new Set<string>()

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
      const effectiveUnitPrice =
        finalPrice != null && quantity != null && quantity > 0
          ? Math.round((finalPrice / quantity) * 100) / 100
          : unitPrice
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
      }
      const key = `${nsn}|${rec.contractNo}|${rec.awardDateIso}|${rec.unitPrice}|${rec.cage}`
      if (seenAward.has(key)) continue
      seenAward.add(key)
      const list = awardsByNsn.get(nsn) ?? []
      list.push(rec)
      awardsByNsn.set(nsn, list)
      procurementRows += 1
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

  const byNsn = new Map<string, NsnAwardSummary>()
  for (const [nsn, awards] of awardsByNsn) {
    // Sort chronologically; rows without a date sink to the front so they never masquerade as latest.
    const sorted = [...awards].sort((a, b) => (a.awardDateIso ?? '').localeCompare(b.awardDateIso ?? ''))
    const dated = sorted.filter((a) => a.awardDateIso)
    // Price the series on the RELIABLE per-unit figure, not the raw Unit Price (which can be a
    // $1.00 placeholder). first/last drive every escalation number in the product.
    const priced = sorted.filter((a) => a.effectiveUnitPrice != null)
    const distinctAwardees = new Set(awards.map((a) => a.cage).filter(Boolean)).size
    byNsn.set(nsn, {
      nsn,
      awards: sorted,
      latest: dated.length ? (dated[dated.length - 1] as AwardRecord) : null,
      distinctAwardees,
      firstUnitPrice: priced.length ? (priced[0] as AwardRecord).effectiveUnitPrice : null,
      lastUnitPrice: priced.length ? (priced[priced.length - 1] as AwardRecord).effectiveUnitPrice : null,
      holders: holdersByNsn.get(nsn) ?? [],
    })
  }
  // NSNs that have availability but no award rows still deserve a summary.
  for (const [nsn, holders] of holdersByNsn) {
    if (byNsn.has(nsn)) continue
    byNsn.set(nsn, {
      nsn, awards: [], latest: null, distinctAwardees: 0,
      firstUnitPrice: null, lastUnitPrice: null, holders,
    })
  }

  cache = {
    ok: true,
    byNsn,
    provenance,
    counts: {
      files: files.length,
      procurementRows,
      availabilityRows,
      nsnsWithAwards: [...awardsByNsn.keys()].length,
    },
  }
  return cache
}

/** Test seam: drop the memoized index so a fresh export on disk is picked up. */
export function resetNsnAwardIndexCache(): void {
  cache = null
}
