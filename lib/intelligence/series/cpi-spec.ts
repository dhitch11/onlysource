/**
 * THE ONE-LINE WIRE BETWEEN THE DATED LEDGER AND THE PRICE ANCHOR.
 *
 * =====================================================================================
 * WHY THIS FILE EXISTS AT ALL, WHICH IS A COORDINATION FACT AND NOT A TECHNICAL ONE
 * =====================================================================================
 * `resolveSeriesRatio` and the BLS ledger have both been live and correct for hours while
 * production shipped a hardcoded 1.3223 against a measured truth of 1.3623. Every piece was
 * built. What stood between them was that the remaining change lived in `lib/engine/pricing/`,
 * which another lane owns and was mid-flight in, and a third writer in a shared tree during a
 * demo is how work gets clobbered rather than how it gets shipped.
 *
 * So the adapter sits on THIS side of the boundary. The engine's change becomes one line, and
 * the lane that owns the engine still writes it. Nothing here imports engine code at runtime:
 * `InflationIndexSpec` is a TYPE-ONLY import, so this file contributes no coupling and cannot
 * pull the engine into a bundle that did not already have it.
 *
 * =====================================================================================
 * WHAT IT DOES, AND THE THREE THINGS IT REFUSES TO DO
 * =====================================================================================
 * `refreshFromLedger(CPI_INDEX_1650, { toPeriod, asOfVintage })` returns the same spec with the
 * factor resolved out of the dated series, and its vintage note rewritten to say which two
 * readings produced it.
 *
 * 1. **On abstention it returns the spec UNCHANGED, never a fallback figure.** The pinned
 *    1.3223 is not wrong, it is UNDATED, and that distinction is the whole point: a dated stale
 *    number is honest where an undated fresh-looking one is not. So the note is rewritten to say
 *    the figure is a reading taken in November 2025 and to name what was missing, and the number
 *    itself is left alone. A rung must not go dark because a ledger was not captured, and it
 *    must not silently present a 2025 reading as current either.
 * 2. **It never invents a period or a vintage.** Both are required arguments with no defaults
 *    and no clock is read here, for the same reason `resolveSeriesRatio` requires them: a
 *    default vintage is a wall-clock read hidden in a helper, and the same figure resolved today
 *    and in March must be able to differ, correctly, and to say so.
 * 3. **It does no arithmetic.** The ratio is the resolver's, the doctrine is the engine's, and
 *    this file renames fields. If arithmetic appears here it belongs in one of the other two.
 */
import type { InflationIndexSpec } from '@/lib/engine/pricing/anchor'
import { readSeriesLedger } from '@/lib/ingest/series/store'
import { resolveSeriesRatio, type RatioResolution } from './ratio'

export type RefreshRequest = {
  /** The period the money is being carried TO. Required: see the header. */
  readonly toPeriod: string
  /** Read the series as it stood at this release. Required: see the header. */
  readonly asOfVintage: string
  /** Defaults to the spec's own base year as a BLS annual average, e.g. 2017 -> "2017-M13". */
  readonly fromPeriod?: string
  /** Only rows retrieved this way count as evidence. Defaults to a live API read. */
  readonly acceptRetrievalMethods?: readonly ('api_fetch' | 'published_table' | 'operator_entry')[]
  /** Test seam. Absent means the app's own resolved series root. */
  readonly ledgerRoot?: string
}

export type RefreshedSpec = {
  readonly spec: InflationIndexSpec
  /** True when the factor came from the ledger rather than from the pinned constant. */
  readonly refreshed: boolean
  /** The resolver's own answer, carried so a surface can render the abstention verbatim. */
  readonly resolution: RatioResolution
}

/** A BLS annual average is period code M13, which is the base the stated factors were read on. */
const annualAverage = (year: number): string => `${year}-M13`

export async function refreshFromLedger(
  spec: InflationIndexSpec,
  req: RefreshRequest,
): Promise<RefreshedSpec> {
  const seriesId = spec.vintage.publishedSeriesId
  if (seriesId === null) {
    // A spec with no published series id is a stated judgement, not a reading. There is nothing
    // to refresh it from and pretending otherwise would dress an opinion as a measurement.
    return {
      spec,
      refreshed: false,
      resolution: {
        resolved: false,
        reason: 'series_not_held',
        missingInput: 'a published series identifier on this index spec',
        sentence:
          'This factor names no published series, so it is a stated judgement rather than a ' +
          'reading, and no ledger can refresh it.',
      },
    }
  }

  const rows = await readSeriesLedger(req.ledgerRoot)
  const resolution = resolveSeriesRatio(rows, {
    seriesId,
    fromPeriod: req.fromPeriod ?? annualAverage(spec.vintage.baseYear),
    toPeriod: req.toPeriod,
    asOfVintage: req.asOfVintage,
    acceptRetrievalMethods: req.acceptRetrievalMethods ?? ['api_fetch'],
  })

  if (!resolution.resolved) {
    return {
      spec: {
        ...spec,
        vintage: {
          ...spec.vintage,
          note:
            `${spec.vintage.note} NOT REFRESHED from the ledger: ${resolution.sentence} ` +
            `This figure remains the reading stated at ${spec.vintage.statedAtSourceDate} and is ` +
            'presented as that reading, not as a current one.',
        },
      },
      refreshed: false,
      resolution,
    }
  }

  return {
    spec: {
      ...spec,
      factor: resolution.ratio,
      vintage: {
        ...spec.vintage,
        statedAtSourceDate: resolution.to.vintage,
        note:
          `Resolved from the dated ledger rather than pinned: ${resolution.citation} ` +
          `Retrieved by ${resolution.to.retrievalMethod} from ${resolution.to.sourceUrl}.`,
      },
    },
    refreshed: true,
    resolution,
  }
}
