import type { CornerRow } from '@/lib/intelligence/corner'
import type { AwardHistoryState } from '../awards/nsn-now'
import { readQuoteSignals, type QuoteSignal } from '../scoring/quote-signals'
import type { FeedWindow, NsnAwardSummary, AwardRecord } from '@/lib/intelligence/awards/nsn-now'
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
    /**
     * THE RECONCILED READ of the two approved-source counters, computed here ONCE.
     *
     * The corner row's source list (from the feed-day quoting package) and the export's
     * cross-reference rows (one row per CAGE per part number) genuinely disagree on raw
     * counts, and every served brief used to burn its word budget re-litigating the same
     * arithmetic ("Note the internal disagreement… should be reconciled before hours go
     * in"). The reconciliation is mechanical — distinct CAGEs, rows per CAGE, which CAGEs
     * appear in only one source — so the engine does it and the brief quotes the resolved
     * picture. Null when no cross-reference rows exist for this NSN.
     */
    crossReference: {
      /** Cross-reference rows for this NSN (a CAGE can appear once per part number). */
      rows: number
      /** Distinct CAGEs across those rows. */
      distinctCages: number
      /** CAGEs the cross-reference names that the corner row's source list does not. */
      cagesOnlyInCrossReference: string[]
      /** CAGEs on the corner row's source list that the cross-reference does not carry. */
      cagesOnlyInSourceList: string[]
      /** The resolved read in words the brief can quote directly. */
      note: string
    } | null
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
    /**
     * ★ WHAT `awardCount: 0` MEANS, WHICH THE NUMBER ITSELF CANNOT SAY. `held` we have rows.
     * `none` we asked and DLA has bought this from nobody. `never_answered` we asked and the
     * export stopped at its row ceiling before reaching this stock number, so the zero is our
     * failure and not a market fact. `never_asked` no pull list has ever carried it. Measured:
     * 235 `none` against 669 `never_answered`, and until this field existed every one of the 904
     * rendered as the same zero.
     */
    awardHistoryState: AwardHistoryState | null
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
  /**
   * The operator's own quote checklist, computed. See `scoring/quote-signals.ts`.
   *
   * It lives on the DOSSIER rather than on the page because the dossier is the single object
   * that feeds both the on-page evidence panels and the AI brief, which is what stops the prose
   * and the panel from ever disagreeing. A signal the brief can quote is a signal the operator
   * can see the working for.
   */
  quoteSignals: QuoteSignal[]
  /** Named, never empty by omission: what a full read is still waiting on. */
  openGaps: string[]
}

/** Reconcile the corner row's source list against the export's cross-reference rows. */
function reconcileApprovedSources(
  row: CornerRow,
  award: NsnAwardSummary | null,
): CornerDossier['source']['crossReference'] {
  const xr = award?.approvedSources ?? []
  if (xr.length === 0) return null
  const xrCages = [...new Set(xr.map((s) => (s.cage ?? '').trim().toUpperCase()).filter(Boolean))]
  const listCages = new Set(row.approvedSources.map((c) => c.trim().toUpperCase()))
  const cagesOnlyInCrossReference = xrCages.filter((c) => !listCages.has(c))
  const cagesOnlyInSourceList = [...listCages].filter((c) => !xrCages.includes(c))
  const parts: string[] = [
    `The cross-reference carries ${xr.length} row(s) resolving to ${xrCages.length} distinct CAGE(s); ` +
      'a CAGE appears once per part number, so rows can outnumber companies.',
  ]
  if (cagesOnlyInCrossReference.length === 0 && cagesOnlyInSourceList.length === 0) {
    parts.push('The two sources name the same companies.')
  } else {
    if (cagesOnlyInCrossReference.length > 0) {
      parts.push(`In the cross-reference only: ${cagesOnlyInCrossReference.join(', ')}.`)
    }
    if (cagesOnlyInSourceList.length > 0) {
      parts.push(`On the corner row's source list only: ${cagesOnlyInSourceList.join(', ')}.`)
    }
  }
  return {
    rows: xr.length,
    distinctCages: xrCages.length,
    cagesOnlyInCrossReference,
    cagesOnlyInSourceList,
    note: parts.join(' '),
  }
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
  /* The span of the award feed. Required for any dormancy reading to be honest: a gap of nine
     years means something different in an eleven year feed than in a forty year one. */
  window: FeedWindow = { firstAwardIso: null, lastAwardIso: null, years: null },
  /**
   * What the export established about this stock number's award history. Optional: a caller that
   * has not been taught the difference keeps today's wording rather than having a claim asserted
   * on its behalf. Absence is not `'none'`.
   */
  awardHistory?: AwardHistoryState,
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
      crossReference: reconcileApprovedSources(row, award),
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
      awardHistoryState: awardHistory ?? null,
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
    // Computed from the award summary when there is one. With no award rows there is nothing to
    // read, and an empty list is the honest answer rather than nine "unknown" rows.
    quoteSignals: award ? readQuoteSignals(award, window, awardHistory) : [],
    openGaps: score.dataGaps,
  }
}

/** The chronological unit-price series for the sparkline, only real points. */
export function priceSeries(d: CornerDossier): number[] {
  return d.priceHistory
    .map((p) => p.unitPrice)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}
