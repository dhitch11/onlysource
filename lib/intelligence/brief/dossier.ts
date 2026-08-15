import type { CornerRow } from '@/lib/intelligence/corner'
import type { NsnAwardSummary, AwardRecord } from '@/lib/intelligence/awards/nsn-now'
import type { ForecastSummary } from '@/lib/intelligence/forecast/dla-forecast'
import type { CornerScoreResult } from '@/lib/intelligence/scoring/cornerscore'

/**
 * THE CORNER DOSSIER — one stock number, every measured fact about it, and nothing else.
 *
 * This is the single grounding object. The AI brief is written from it and may state nothing that
 * is not in it; the detail page renders it as the human-readable evidence panel. Because both read
 * the same object, the prose and the panel can never diverge, and neither can carry a number this
 * build did not measure. Every field here traces to a government file on disk. A fact we do not have
 * is `null` or an explicit "unknown", never a placeholder.
 */
export type PricePoint = {
  dateIso: string | null
  unitPrice: number | null
  /** Post-modification price where the export carries one; else null. */
  finalPrice: number | null
  quantity: number | null
  cage: string | null
  company: string | null
}

export type CornerDossier = {
  nsn: string
  item: string
  /** Sole source + who, or the count of approved makers. */
  source: {
    soleSource: boolean
    approvedSourceCount: number
    approvedSources: string[]
    awardSilent: boolean
  }
  awardPath: 'machine_award' | 'manual' | 'unknown'
  demandQuantity: { value: number | null; unitOfIssue: string }
  /** Award history, chronological, only where the export carries it. Empty array = not ingested. */
  priceHistory: PricePoint[]
  pricing: {
    firstUnitPrice: number | null
    lastUnitPrice: number | null
    escalationPct: number | null
    distinctAwardees: number | null
    awardCount: number
  }
  forecast: {
    onForecast: boolean
    totalForecastQty: number | null
    solicitationCount: number | null
    supplyChains: string[]
    endItems: string[]
  }
  score: {
    scoreV0: number
    grade: string
    disposition: string
    legs: Array<{ leg: string; state: string; value: number | null }>
    reasons: Array<{ leg: string; plain: string; points: number; calibration: string }>
  }
  /** Named, never empty by omission: what a full read is still waiting on. */
  openGaps: string[]
}

function toPoint(a: AwardRecord): PricePoint {
  return {
    dateIso: a.awardDateIso,
    // The reliable per-unit price (corrects $1.00 placeholders), so the table, the sparkline, and
    // the escalation all agree.
    unitPrice: a.effectiveUnitPrice,
    finalPrice: a.finalPrice,
    quantity: a.quantity,
    cage: a.cage,
    company: a.company,
  }
}

export function buildCornerDossier(
  row: CornerRow,
  award: NsnAwardSummary | null,
  forecast: ForecastSummary | null,
  score: CornerScoreResult,
): CornerDossier {
  const first = award?.firstUnitPrice ?? null
  const last = award?.lastUnitPrice ?? null
  const escalationPct =
    first != null && last != null && first > 0 ? Math.round(((last - first) / first) * 100) : null

  return {
    nsn: row.nsn,
    item: row.nomenclature.trim() || 'unnamed on this line',
    source: {
      soleSource: row.soleSource,
      approvedSourceCount: row.approvedSourceCount,
      approvedSources: row.approvedSources,
      awardSilent: row.silentSourceCount > 0,
    },
    awardPath:
      row.automatedSolicitation === true
        ? 'machine_award'
        : row.automatedSolicitation === false
          ? 'manual'
          : 'unknown',
    demandQuantity: { value: row.quantity, unitOfIssue: row.unitOfIssue },
    priceHistory: (award?.awards ?? []).map(toPoint),
    pricing: {
      firstUnitPrice: first,
      lastUnitPrice: last,
      escalationPct,
      distinctAwardees: award?.distinctAwardees ?? null,
      awardCount: award?.awards.length ?? 0,
    },
    forecast: {
      onForecast: forecast?.onForecast ?? false,
      totalForecastQty: forecast?.totalForecastQty ?? null,
      solicitationCount: forecast?.solicitationCount ?? null,
      supplyChains: forecast?.supplyChains ?? [],
      endItems: forecast?.endItems ?? [],
    },
    score: {
      scoreV0: score.scoreV0,
      grade: score.grade,
      disposition: score.disposition,
      legs: Object.entries(score.legs).map(([leg, l]) => ({
        leg,
        state: l.state,
        value: typeof l.value === 'number' ? l.value : null,
      })),
      reasons: score.reasons.map((r) => ({
        leg: r.leg,
        plain: r.plain,
        points: r.points,
        calibration: r.calibration,
      })),
    },
    openGaps: score.dataGaps,
  }
}

/** The chronological unit-price series for the sparkline, only real points. */
export function priceSeries(d: CornerDossier): number[] {
  return d.priceHistory
    .map((p) => p.unitPrice)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}
