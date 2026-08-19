/**
 * THE PRICE-SERIES RESOLVER: the consumer half of the dated inflation series.
 *
 * =====================================================================================
 * WHY THIS IS A RATIO AND NOT A FACTOR
 * =====================================================================================
 * The anchor shipped a stored multiplier: 1.3223, and 1.40 beside it. The first is a real
 * reading (CPI-U `CUUR0000SA0`, 324.122 / 245.120 = 1.32229928, which reproduces the shipped
 * figure to four decimals) and the second is a stated judgement. Both were pinned to a base
 * year of 2017 with no published series behind them.
 *
 * A stored multiplier is not a stale number waiting to be refreshed. **It is a number that
 * becomes wrong on a schedule nobody is watching.** Measured 2026-08-19: the November 2025
 * reading the product was pinned to gives 1.3223, while the latest published period gives
 * 1.3623. Every anchor computed today is about 3% low, and it drifts further every month on
 * its own, silently, with no code change and no alert.
 *
 * So nothing here resolves "the factor". It resolves `ratio(fromPeriod -> toPeriod)` out of a
 * dated series, and the answer carries the two readings it divided and the vintage it read
 * them from. A figure we showed last week stays reproducible because the vintage is an input,
 * not a default.
 *
 * =====================================================================================
 * FIVE REFUSALS, AND EVERY ONE OF THEM IS THE POINT
 * =====================================================================================
 * 1. **A period we do not hold is ABSENT.** Never interpolated, never carried forward from a
 *    neighbouring month, never filled from the nearest year. The ingest half guarantees it
 *    never writes a row it did not observe; this half guarantees it never invents one either.
 * 2. **A missing vintage NEVER falls back to the latest.** It resolves the newest vintage at
 *    or before the one asked for, and abstains if there is none. Falling back to the newest is
 *    the same defect as judging "still biddable" against the newest day we captured rather
 *    than against today, which cost this build three wrong headline numbers in one day.
 * 3. **A contradicted reading abstains rather than choosing.** The ledger deliberately records
 *    both when a publisher returns a different value for the same period at the same vintage.
 *    A resolver that silently picks one turns a publisher's self-contradiction into a number
 *    an operator bids. Two readings that disagree are not evidence, they are a question.
 * 4. **A base of zero or less abstains.** Not because of the division, but because a
 *    non-positive index level is a sentinel or a parse artifact, and dividing by it produces a
 *    confident number from a broken input.
 * 5. **A caller may refuse a row below a provenance grade.** Measured on this estate the same
 *    week: a file matched its recorded byte count exactly and was 8% of the real thing, and
 *    the only tell was its retrieval method. A length check validates internal consistency,
 *    never completeness. So the grade travels on the row and the caller decides what it will
 *    stand on, rather than every row counting as equal evidence.
 *
 * PURE, AND `asOfVintage` HAS NO DEFAULT. No clock is read here and none may be added. A
 * default vintage would be a wall-clock read hidden in a helper, and the whole reason this
 * module exists is that a figure resolved today and the same figure resolved in March must be
 * able to differ, correctly, and to say so.
 *
 * Deterministic arithmetic owns the number. The language layer explains it and never computes
 * a figure that ships.
 */
import type { SeriesObservation, SeriesRetrievalMethod } from '../../ingest/series/bls'

/** The reading a ratio divided, carried so the arithmetic can be redone by hand. */
export type SeriesReading = {
  readonly period: string
  readonly value: number
  readonly vintage: string
  readonly retrievalMethod: SeriesRetrievalMethod
  readonly sourceUrl: string
}

export type RatioResolved = {
  readonly resolved: true
  readonly seriesId: string
  readonly from: SeriesReading
  readonly to: SeriesReading
  /** to.value / from.value. Unrounded: the caller decides presentation. */
  readonly ratio: number
  /**
   * The sentence a surface may render, naming the publisher's own identifier and both
   * readings, so a reader can reproduce the division without this product's help.
   */
  readonly citation: string
}

export type RatioAbstentionReason =
  | 'series_not_held'
  | 'from_period_not_held'
  | 'to_period_not_held'
  | 'no_vintage_at_or_before_as_of'
  | 'readings_contradict'
  | 'base_not_positive'
  | 'below_required_provenance'

export type RatioAbstained = {
  readonly resolved: false
  readonly reason: RatioAbstentionReason
  /**
   * The thing to go and get. Never "insufficient data", which tells an operator nothing they
   * can act on.
   */
  readonly missingInput: string
  readonly sentence: string
}

export type RatioResolution = RatioResolved | RatioAbstained

export type RatioRequest = {
  readonly seriesId: string
  /** The period the money is being carried FROM, e.g. the award year: "2017-M13". */
  readonly fromPeriod: string
  /** The period it is being carried TO. */
  readonly toPeriod: string
  /**
   * Read the series as it stood at this release. Required, no default: see the header. A
   * vintage string compares lexically, which is why the ingest half writes ISO dates.
   */
  readonly asOfVintage: string
  /**
   * When present, only rows retrieved this way are evidence. Absent means every row counts,
   * which is the right default for a display and the wrong one for a figure being bid.
   */
  readonly acceptRetrievalMethods?: readonly SeriesRetrievalMethod[]
}

const abstain = (
  reason: RatioAbstentionReason,
  missingInput: string,
  sentence: string,
): RatioAbstained => ({ resolved: false, reason, missingInput, sentence })

/**
 * The newest reading for one period at or before `asOfVintage`.
 *
 * Returns the candidates rather than a value, because two rows sharing the winning vintage
 * with different values is a contradiction the caller must refuse rather than a tie to break.
 */
function readingAt(
  rows: readonly SeriesObservation[],
  period: string,
  asOfVintage: string,
): { winners: SeriesObservation[]; sawPeriod: boolean } {
  const forPeriod = rows.filter((r) => r.period === period)
  if (forPeriod.length === 0) return { winners: [], sawPeriod: false }
  const eligible = forPeriod.filter((r) => r.vintage <= asOfVintage)
  if (eligible.length === 0) return { winners: [], sawPeriod: true }
  let newest = eligible[0]!.vintage
  for (const r of eligible) if (r.vintage > newest) newest = r.vintage
  return { winners: eligible.filter((r) => r.vintage === newest), sawPeriod: true }
}

const toReading = (o: SeriesObservation): SeriesReading => ({
  period: o.period,
  value: o.value,
  vintage: o.vintage,
  retrievalMethod: o.retrieval_method,
  sourceUrl: o.source_url,
})

export function resolveSeriesRatio(
  observations: readonly SeriesObservation[],
  req: RatioRequest,
): RatioResolution {
  const { seriesId, fromPeriod, toPeriod, asOfVintage, acceptRetrievalMethods } = req

  let rows = observations.filter((o) => o.series_id === seriesId)
  if (rows.length === 0) {
    return abstain(
      'series_not_held',
      `an ingested observation of series ${seriesId}`,
      `No reading of ${seriesId} is held, so no ratio can be formed from it.`,
    )
  }

  if (acceptRetrievalMethods && acceptRetrievalMethods.length > 0) {
    const accepted = new Set<SeriesRetrievalMethod>(acceptRetrievalMethods)
    const kept = rows.filter((o) => accepted.has(o.retrieval_method))
    if (kept.length === 0) {
      return abstain(
        'below_required_provenance',
        `a reading of ${seriesId} retrieved by ${acceptRetrievalMethods.join(' or ')}`,
        `Readings of ${seriesId} are held, but none was retrieved by ${acceptRetrievalMethods.join(' or ')}, ` +
          'which is the grade this figure requires.',
      )
    }
    rows = kept
  }

  const from = readingAt(rows, fromPeriod, asOfVintage)
  if (!from.sawPeriod) {
    return abstain(
      'from_period_not_held',
      `an observation of ${seriesId} for ${fromPeriod}`,
      `${seriesId} carries no reading for ${fromPeriod}, so the base of the ratio is absent. ` +
        'It was not filled from a neighbouring period.',
    )
  }
  const to = readingAt(rows, toPeriod, asOfVintage)
  if (!to.sawPeriod) {
    return abstain(
      'to_period_not_held',
      `an observation of ${seriesId} for ${toPeriod}`,
      `${seriesId} carries no reading for ${toPeriod}, so the ratio has no endpoint. ` +
        'It was not carried forward from an earlier period.',
    )
  }
  if (from.winners.length === 0 || to.winners.length === 0) {
    const which = from.winners.length === 0 ? fromPeriod : toPeriod
    return abstain(
      'no_vintage_at_or_before_as_of',
      `a reading of ${seriesId} for ${which} published at or before vintage ${asOfVintage}`,
      `${seriesId} holds ${which} only at a vintage later than ${asOfVintage}. ` +
        'The later reading was NOT substituted, because that would answer a question about ' +
        'the past with a number that did not exist yet.',
    )
  }

  for (const [period, side] of [
    [fromPeriod, from],
    [toPeriod, to],
  ] as const) {
    const distinct = new Set(side.winners.map((r) => r.value))
    if (distinct.size > 1) {
      return abstain(
        'readings_contradict',
        `a reconciliation of ${seriesId} for ${period} at vintage ${side.winners[0]!.vintage}`,
        `${seriesId} carries ${distinct.size} different values for ${period} at the same vintage ` +
          `(${[...distinct].join(', ')}). The publisher contradicted itself and this product does ` +
          'not choose between them.',
      )
    }
  }

  const f = from.winners[0]!
  const t = to.winners[0]!
  if (!(f.value > 0)) {
    return abstain(
      'base_not_positive',
      `a positive index level for ${seriesId} at ${fromPeriod}`,
      `${seriesId} reports ${f.value} for ${fromPeriod}. A non-positive index level is a sentinel ` +
        'or a parse artifact, not a base, so no ratio was formed from it.',
    )
  }

  const ratio = t.value / f.value
  return {
    resolved: true,
    seriesId,
    from: toReading(f),
    to: toReading(t),
    ratio,
    citation:
      `${seriesId} ${toPeriod} ${t.value} divided by ${fromPeriod} ${f.value} = ${ratio.toFixed(6)}, ` +
      `read at vintage ${t.vintage === f.vintage ? t.vintage : `${f.vintage} and ${t.vintage}`}.`,
  }
}
