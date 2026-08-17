/**
 * DLA FORECAST + SOLICITATION RECURRENCE + SPECS, from the NSN-Now export.
 *
 * This is the leg that turns the corner map from reactive to predictive. The DLA Forecast is the
 * government's OWN statement of what it plans to buy next: per NSN, a supply chain, a quantity, and
 * a forecast month. A sole-source corner that is ALSO on the forecast is a position the buyer has
 * already told us it will need again, which is exactly the signal Wayne's flagship report is built
 * around (his own funnel: 120k with surplus-award history, 52k on the forecast, 20k with availability).
 *
 * Three companion sheets ride along in the same export and are indexed here too:
 *   RFQ        every solicitation the NSN has drawn, so we can measure recurrence (how often the
 *              government re-buys it) and the most recent solicitation.
 *   Tech Info  dimensional specifications, kept for the interchangeability work.
 *   End Item   the platforms and weapon systems the part goes on, for context and filtering.
 *
 * Everything here is a MEASUREMENT read from the export. An NSN that is not on the forecast is
 * reported as `onForecast: false`, which is a real fact (the government did not list it), never an
 * abstention dressed as a negative. Absence of the export entirely is reported as unavailable.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { readWorkbookSheets, distinctWorkbookPaths, type SeedProvenance } from '@/lib/intelligence/seed/xlsx'
import { dataPath } from '@/lib/data-root'

const NSN_NOW_DIR = 'nsn-now'

export type ForecastRecord = { supplyChain: string | null; quantity: number | null; forecastDate: string | null }

export type ForecastSummary = {
  nsn: string
  /** On the government's forward-buy list. A measured fact, not a guess. */
  onForecast: boolean
  forecast: ForecastRecord[]
  /** Sum of forecast quantities across supply chains. */
  totalForecastQty: number
  supplyChains: string[]
  /** How many solicitations this NSN has drawn (recurrence). */
  solicitationCount: number
  lastSolicitation: string | null
  /** Count of dimensional spec rows in Tech Info (interchangeability raw material). */
  specCount: number
  /** Platforms / weapon systems the part goes on. */
  endItems: string[]
}

export type ForecastIndex = {
  ok: true
  byNsn: Map<string, ForecastSummary>
  counts: { files: number; forecastRows: number; rfqRows: number; onForecastNsns: number }
  provenance: SeedProvenance[]
}
export type ForecastUnavailable = { ok: false; reason: string; dir: string }

let cache: ForecastIndex | ForecastUnavailable | null = null

const nsn13 = (v: string | null | undefined): string | null => {
  const d = (v ?? '').replace(/[^0-9]/g, '')
  return d.length === 13 ? d : null
}
const num = (v: string | null | undefined): number | null => {
  if (v == null) return null
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function buildForecastIndex(): ForecastIndex | ForecastUnavailable {
  if (cache) return cache
  const dir = dataPath(NSN_NOW_DIR)
  if (!existsSync(dir)) {
    cache = { ok: false, reason: 'No NSN-Now export directory on disk; the DLA Forecast is read from it.', dir }
    return cache
  }
  // Distinct BY CONTENT (same rule as the award index): a workbook present under two
  // filenames is read and reported once, so the provenance file count cannot inflate.
  const { files } = distinctWorkbookPaths(
    readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~'))
      .map((f) => path.join(dir, f))
      .sort(),
  )
  if (files.length === 0) {
    cache = { ok: false, reason: 'The NSN-Now directory holds no .xlsx export yet.', dir }
    return cache
  }

  const byNsn = new Map<string, ForecastSummary>()
  const provenance: SeedProvenance[] = []
  let forecastRows = 0
  let rfqRows = 0
  const seenForecast = new Set<string>()
  const seenSolic = new Set<string>()

  const ensure = (nsn: string): ForecastSummary => {
    let s = byNsn.get(nsn)
    if (!s) {
      s = { nsn, onForecast: false, forecast: [], totalForecastQty: 0, supplyChains: [], solicitationCount: 0, lastSolicitation: null, specCount: 0, endItems: [] }
      byNsn.set(nsn, s)
    }
    return s
  }

  for (const file of files) {
    const wb = readWorkbookSheets(file)
    let touched = false

    const forecast = wb.sheets.get('DLA Forecast')
    for (const r of forecast?.rows ?? []) {
      const nsn = nsn13(r['NSN Number'])
      if (!nsn) continue
      const rec: ForecastRecord = { supplyChain: r['Supply Chain'] ?? null, quantity: num(r['Quantity']), forecastDate: r['Forecast Date'] ?? null }
      const key = `${nsn}|${rec.supplyChain}|${rec.forecastDate}|${rec.quantity}`
      if (seenForecast.has(key)) continue
      seenForecast.add(key)
      const s = ensure(nsn)
      s.forecast.push(rec)
      s.onForecast = true
      if (rec.quantity != null) s.totalForecastQty += rec.quantity
      if (rec.supplyChain && !s.supplyChains.includes(rec.supplyChain)) s.supplyChains.push(rec.supplyChain)
      forecastRows += 1
      touched = true
    }

    const rfq = wb.sheets.get('RFQ')
    for (const r of rfq?.rows ?? []) {
      const nsn = nsn13(r['NSN Number'])
      const sol = r['Solicitation Number']
      if (!nsn || !sol) continue
      const key = `${nsn}|${sol}`
      if (seenSolic.has(key)) continue
      seenSolic.add(key)
      const s = ensure(nsn)
      s.solicitationCount += 1
      const iso = usDate(r['Issue Date'] ?? '')
      if (iso && (!s.lastSolicitation || iso > s.lastSolicitation)) s.lastSolicitation = iso
      rfqRows += 1
      touched = true
    }

    const tech = wb.sheets.get('Tech Info')
    for (const r of tech?.rows ?? []) {
      const nsn = nsn13(r['NSN Number'])
      if (!nsn) continue
      ensure(nsn).specCount += 1
      touched = true
    }

    const end = wb.sheets.get('End Item')
    for (const r of end?.rows ?? []) {
      const nsn = nsn13(r['NSN Number'])
      const detail = r['Detail']
      if (!nsn || !detail) continue
      const s = ensure(nsn)
      if (!s.endItems.includes(detail) && s.endItems.length < 20) s.endItems.push(detail)
      touched = true
    }

    if (touched) provenance.push(wb.provenance)
  }

  cache = {
    ok: true,
    byNsn,
    counts: { files: provenance.length, forecastRows, rfqRows, onForecastNsns: [...byNsn.values()].filter((s) => s.onForecast).length },
    provenance,
  }
  return cache
}

export function resetForecastIndexCache(): void {
  cache = null
}

/** MM/DD/YYYY -> ISO, else null. Local to this module to avoid coupling. */
function usDate(v: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim())
  if (!m) return null
  const [, mm, dd, yyyy] = m
  return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`
}
