import { existsSync } from 'node:fs'
import { readWorkbookSheets } from '@/lib/intelligence/seed/xlsx'
import { dataPath } from '@/lib/data-root'
import { compareBySizeOfBuy, sizeOfBuy, totalKnownSize, type SizeOfBuy } from './size-of-buy'

/**
 * HUBZONE SET-ASIDE SOLICITATIONS — real government buys reserved for HUBZone-certified small firms.
 *
 * A distinct opportunity class from the corners: these are open (or recently closed) solicitations the
 * agency set aside for HUBZone businesses. Eligibility is real and it matters — a firm bids these only
 * if it is HUBZone certified, or it partners with one — so the surface frames them as intelligence and
 * a partner angle, never as "yours to bid" by default. Every field is read from the government export;
 * nothing is estimated except the labelled size figure (last unit price times quantity).
 *
 * THE SIZE FIGURE IS A `SizeOfBuy`, NOT A NUMBER. It used to be `price * qty : price ?? 0`, and that
 * zero was an absence spelled as a measurement: it sorted an unsized buy below every priced one and
 * added nothing to a total that claimed to be everything. All 23 rows on the current export carry both
 * legs, so the shape changes and the rendered figures do not; the reasoning and the measurements are
 * in size-of-buy.ts, which is the single owner of this arithmetic for both opportunity surfaces.
 *
 * ★ AND THE SAME ZERO LIVED ON IN THE READER BELOW, WHICH IS WHERE IT WAS FINALLY KILLED. Fixing the
 * ranking did nothing while `num()` was still handing `sizeOfBuy` a 0 for a cell Excel had omitted.
 * The story is on `num()` itself; the control is test/honesty/blank-cell-is-not-a-zero.test.ts, which
 * is the first test that ever exercised this builder at all.
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
  /** The modeled size of this buy, or the stated reason there is not one. Never a zero. */
  size: SizeOfBuy
}

export type HubzoneDataset =
  | {
      ok: true
      matches: HubzoneMatch[]
      /**
       * `size` carries the total AND the count of rows that could not be sized, together, so a
       * surface cannot print the money without being handed the disclosure that belongs beside it.
       */
      summary: { total: number; size: { usd: number; counted: number; unsized: number } }
    }
  | { ok: false; reason: string }

const clean = (v: string | undefined | null): string => (v ?? '').trim()
const niinOf = (nsn: string): string => nsn.replace(/[^0-9]/g, '').slice(-9)
const usDateToIso = (s: string): string | null => {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, mm, dd, yyyy] = m
  return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`
}
/**
 * A number this cell actually carries, or null when it carries none.
 *
 * ===========================================================================================
 * A CELL EXCEL OMITTED IS AN ABSENCE, NEVER A ZERO.
 * ===========================================================================================
 * `Number('')` is 0 and `Number.isFinite(0)` is true, so the earlier body turned a blank
 * "Last Sold Price" into a MEASURED zero. `sizeOfBuy` accepts a measured zero (rightly: a real
 * $0.00 on the file is a fact), so it answered `{known: true, usd: 0}`, the table printed "$0"
 * against a buy nobody has ever priced, and `summary.size.unsized` stayed 0, which silenced
 * BOTH disclosure sentences and left the tile claiming its total covered "every solicitation on
 * the file". That is the same silent zero this module was written to end, one layer down in the
 * reader instead of in the ranking, and it survived because nothing exercised this builder.
 *
 * MEASURED (2026-08-18, a copy of the real hubzone-matches.xlsx with `<c r="H2">` deleted, the
 * exact serialisation Excel produces for a blank cell): solicitation SPE8E7-26-T-0526 came back
 * lastSoldPrice=0, quantity=40, size={known:true,usd:0}, rendered "$0", summary.unsized=0.
 * Zero of the 23 cells on the current export are blank, but the sibling export from the same
 * vendor with the identical column names has a blank Last Sold Price on 68 of 839 rows (8.1%).
 *
 * The emptiness test runs AFTER the `$`/`,` strip, deliberately: a cell holding only a currency
 * symbol or only a thousands separator empties to `''` at that point and would otherwise take
 * the same route to 0. `lib/intelligence/datasets.ts:toNumber` reaches the same answer for the
 * goldmine's workbook, which is why that surface never carried this defect.
 *
 * Both legs go through here, so an absent QUANTITY is an absence too: a quantity nobody
 * published is not a quantity of zero, and `sizeOfBuy` reports `no_stated_quantity` for it
 * rather than multiplying a real price by an invented count.
 */
const num = (v: string | undefined | null): number | null => {
  const s = clean(v).replace(/[$,]/g, '')
  if (s === '') return null
  const n = Number(s)
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
      size: sizeOfBuy(lastSoldPrice, quantity),
    })
  }
  // Soonest close first, because the deadline is what governs the work here. Size only breaks a
  // tie, and it breaks it through the shared comparator, so an unsized row loses the tie rather
  // than being ranked as though it were worth nothing.
  matches.sort(
    (a, b) => (a.closeDate ?? '9999').localeCompare(b.closeDate ?? '9999') || compareBySizeOfBuy(a, b),
  )

  cache =
    matches.length > 0
      ? { ok: true, matches, summary: { total: matches.length, size: totalKnownSize(matches) } }
      : { ok: false, reason: 'The HUBZone export holds no solicitations.' }
  return cache
}
