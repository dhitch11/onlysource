import { existsSync } from 'node:fs'
import { readWorkbookSheets } from '@/lib/intelligence/seed/xlsx'
import { dataPath } from '@/lib/data-root'

/**
 * HUBZONE SET-ASIDE SOLICITATIONS — real government buys reserved for HUBZone-certified small firms.
 *
 * A distinct opportunity class from the corners: these are open (or recently closed) solicitations the
 * agency set aside for HUBZone businesses. Eligibility is real and it matters — a firm bids these only
 * if it is HUBZone certified, or it partners with one — so the surface frames them as intelligence and
 * a partner angle, never as "yours to bid" by default. Every field is read from the government export;
 * nothing is estimated except the labelled size figure (last unit price times quantity).
 */

const FILE = 'suppliers/hubzone-matches.xlsx'

export type HubzoneMatch = {
  nsn: string
  niin: string
  solicitation: string
  description: string
  closeDate: string | null
  quantity: number | null
  lastSoldPrice: number | null
  issueDate: string | null
  pointOfInspection: string | null
  deliveryDays: string | null
  relatedCage: string | null
  relatedPart: string | null
  /** T or U from the solicitation's ninth position: U disqualifies an alternate on the instant buy. */
  typeChar: 'T' | 'U' | null
  estValue: number
}

export type HubzoneDataset =
  | { ok: true; matches: HubzoneMatch[]; summary: { total: number; totalValue: number } }
  | { ok: false; reason: string }

const clean = (v: string | undefined | null): string => (v ?? '').trim()
const niinOf = (nsn: string): string => nsn.replace(/[^0-9]/g, '').slice(-9)
const usDateToIso = (s: string): string | null => {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, mm, dd, yyyy] = m
  return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`
}
const num = (v: string | undefined | null): number | null => {
  const n = Number(clean(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}
const typeCharOf = (sol: string): 'T' | 'U' | null => {
  const m = clean(sol).toUpperCase().match(/-([TU])-\d/)
  return m ? (m[1] as 'T' | 'U') : null
}

let cache: HubzoneDataset | null = null

export function buildHubzoneMatches(): HubzoneDataset {
  if (cache) return cache
  const path = dataPath(FILE)
  if (!existsSync(path)) {
    cache = { ok: false, reason: 'No HUBZone export on disk.' }
    return cache
  }
  const wb = readWorkbookSheets(path)
  const sheet = wb.sheets.get('Solicitation')
  if (!sheet) {
    cache = { ok: false, reason: 'The HUBZone export has no Solicitation sheet.' }
    return cache
  }

  const matches: HubzoneMatch[] = []
  for (const r of sheet.rows) {
    const nsn = clean(r['NSN Number'])
    const solicitation = clean(r['Solicitation Number'])
    if (!nsn && !solicitation) continue
    const quantity = num(r['Solicitation Quantity'])
    const lastSoldPrice = num(r['Last Sold Price'])
    matches.push({
      nsn,
      niin: niinOf(nsn),
      solicitation,
      description: clean(r['Description']),
      closeDate: usDateToIso(r['Close Date'] ?? ''),
      quantity,
      lastSoldPrice,
      issueDate: usDateToIso(r['Issue Date'] ?? ''),
      pointOfInspection: clean(r['Point of Inspection']) || null,
      deliveryDays: clean(r['Delivery Days']) || null,
      relatedCage: clean(r['Related Cage']) || null,
      relatedPart: clean(r['Related Part']) || null,
      typeChar: typeCharOf(solicitation),
      estValue: lastSoldPrice != null && quantity != null ? lastSoldPrice * quantity : lastSoldPrice ?? 0,
    })
  }
  // Soonest close first, then biggest.
  matches.sort((a, b) => (a.closeDate ?? '9999').localeCompare(b.closeDate ?? '9999') || b.estValue - a.estValue)

  cache = matches.length > 0
    ? { ok: true, matches, summary: { total: matches.length, totalValue: matches.reduce((s, m) => s + m.estValue, 0) } }
    : { ok: false, reason: 'The HUBZone export holds no solicitations.' }
  return cache
}
