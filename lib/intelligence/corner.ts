/**
 * CORNER-ABILITY. The Monopoly Map's computation, over the data that actually exists today.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT THIS COMPUTES, AND WHAT IT REFUSES TO CLAIM
 * ---------------------------------------------------------------------------------------
 * The full cross is forecasted demand x dead approved source x thin availability. Two of
 * those three legs are readable from free data on disk right now. The third is not, and the
 * whole design of this file is about being honest which is which.
 *
 *  LEG 1, demand.        READ. Open solicitations in the daily index. This is observed
 *                        recurrence, not the agency's forward buy plan, and rows say so.
 *  LEG 2, source status. PARTIAL. What is readable is that an approved source has no
 *                        recorded prime award in two years. That is a MEASUREMENT.
 *                        It is NOT a death claim, and this file never promotes it to one,
 *                        because federal award reporting is not required at or below the
 *                        micro-purchase threshold, so a firm of exactly this size can be
 *                        winning awards monthly and show total silence in the public data.
 *  LEG 3, availability.  READ WHERE THE EXPORT ANSWERS IT, and abstaining where it does not.
 *                        Corrected 2026-08-16. This leg was hardcoded to abstain on every row
 *                        with the reason "no commercial locator credential is connected", and
 *                        that reason was true about ILS and false about the data on disk: the
 *                        NSN-Now Batch Export ships an Availability sheet, and it answers this
 *                        leg for 908 of the 2,141 rows on the map, 641 of them THIN (three or
 *                        fewer holders), including 35 of the 115 candidate corners.
 *
 *                        An abstention that outlives its reason is not caution, it is a second
 *                        kind of inaccuracy: it told an operator we could not know something we
 *                        already knew, and the surface said the count would stay "at zero until
 *                        a verified availability feed is connected" while the feed sat in the
 *                        same workbook as the award history.
 *
 *                        What is still true, and is preserved exactly: NSN-Now availability is
 *                        SELF-REPORTED by the listing company and is NOT an ILS confirmation and
 *                        NOT a confirmed unit on a shelf. So the state is `listed_self_reported`,
 *                        never `confirmed`, and a row with no availability row stays UNKNOWN
 *                        rather than becoming a measured zero.
 *
 * So the output is a CANDIDATE list, ranked by how much of the cross could be established,
 * and the interface must render it as candidates. A row here is a position worth an hour of
 * an operator's time, never a position worth money on its own.
 */

import type { Cage, Niin } from './niin'
import type { ApprovedSourceIndex, DailyIndex, IndexRow } from './seed/feed'

export type SourceSignal =
  /** The approved source appears on the award-silence list. A measurement, not a death. */
  | { kind: 'award_silent'; cage: Cage; measurement: string }
  /** The source is not on the silence list, so nothing suggests it stopped trading. */
  | { kind: 'no_silence_signal'; cage: Cage }
  /** We hold no signal either way for this company. First class, never read as dead. */
  | { kind: 'unresolved'; cage: Cage }

export type CornerRow = {
  niin: Niin
  nsn: string
  nomenclature: string
  quantity: number | null
  unitOfIssue: string
  solicitation: string
  returnDate: string
  /** T or U in the ninth position means an alternate offer cannot win the instant buy. */
  automatedSolicitation: boolean | null
  approvedSources: Cage[]
  approvedSourceCount: number
  soleSource: boolean
  signals: SourceSignal[]
  /** How many approved sources carry the award-silence measurement. */
  silentSourceCount: number
  /**
   * Read from the NSN-Now Availability sheet where it exists, abstaining where it does not.
   * `listed_self_reported` is deliberately not called `confirmed`: the holder self-reports and
   * nothing here has seen a shelf.
   */
  availability: 'listed_self_reported' | 'unknown_credential_absent'
  /** Companies listing stock for this stock number, or null when the export carries none. */
  availabilityHolders: number | null
  /** Units those companies list, in total, or null. Self-reported, never confirmed. */
  availabilityUnits: number | null
  /**
   * 0 to 2 in practice. Counts DEMAND and SOURCE SILENCE only, deliberately. Availability is now
   * read where the export answers it and travels on `availability*` above, but it is kept out of
   * this counter because this counter orders the map, and a row with fifty listed holders would
   * rise on "we know the answer" while being the opposite of a corner.
   */
  legsEstablished: number
  /** Named, never empty by omission. */
  gaps: string[]
}

export type CornerMap = {
  rows: CornerRow[]
  summary: {
    /** Stock numbers in the approved-source file for this feed day. */
    approvedSourceNiins: number
    /** Distinct companies named as an approved source. */
    approvedSourceCages: number
    /** Stock numbers under open solicitation in the index. */
    demandNiins: number
    /** Both an approved source and open demand. */
    withDemandAndSource: number
    /** Sole-sourced with open demand. */
    soleSourcedWithDemand: number
    /** The candidate corners: sole-sourced, open demand, source award-silent. */
    candidateCorners: number
    /** Companies that are both an approved source today and award-silent. */
    silentApprovedSources: number
    /** Always 0 while the locator credential is absent. Rendered, not hidden. */
    confirmedCorners: number
  }
  provenance: {
    feedDay: string
    /** The ARCHIVED ORIGINAL this derives from, with its hash. Cited on the surface. */
    sourceArchiveKey: string
    sourceArchiveSha256: string
    approvedSourceFile: string
    indexFile: string
    silenceListFile: string
    computedAt: string
    /** Stated on the surface, because it decides how much the map is worth. */
    legsAvailable: string
  }
}

export type BuildCornerMapInput = {
  approved: ApprovedSourceIndex
  index: DailyIndex
  /** Companies with no recorded prime award in the trailing two years. */
  awardSilentCages: Set<Cage>
  /**
   * Self-reported availability from the NSN-Now export, keyed by 13-digit NSN.
   * Optional so a caller with no export still builds a map; absent simply means every row
   * abstains on the leg, which is the old behaviour and remains correct in that case.
   */
  availabilityByNsn?: Map<string, { holders: number; units: number }>
  /** Where each input came from, carried onto the surface. */
  provenance: Omit<CornerMap['provenance'], 'legsAvailable'>
}

/**
 * Build the map.
 *
 * Ranking is by legs established and then by demand quantity. It is deliberately NOT a score:
 * the two inputs of corner strength stay separate and countable, so the principal can rank
 * them himself rather than argue with a number he cannot audit.
 */
export function buildCornerMap(input: BuildCornerMapInput): CornerMap {
  const { approved, index, awardSilentCages, availabilityByNsn } = input
  const rows: CornerRow[] = []

  for (const [niin, cages] of approved.byNiin) {
    const demandRows = index.byNiin.get(niin)
    if (!demandRows || demandRows.length === 0) continue

    const primary = pickPrimaryDemandRow(demandRows)
    const sourceList = [...cages].sort()

    const signals: SourceSignal[] = sourceList.map((cage) => {
      if (awardSilentCages.has(cage)) {
        return {
          kind: 'award_silent',
          cage,
          measurement: 'no recorded prime award activity in the trailing two years',
        }
      }
      return { kind: 'no_silence_signal', cage }
    })

    const silentSourceCount = signals.filter((s) => s.kind === 'award_silent').length
    const soleSource = sourceList.length === 1

    // The NSN the demand row carries, so availability can be joined. The corner map is keyed on
    // NIIN; the award and availability data are keyed on the 13-digit NSN.
    const nsn13 = (primary.nsn ?? '').replace(/[^0-9]/g, '')
    const avail = nsn13.length === 13 ? availabilityByNsn?.get(nsn13) : undefined

    const gaps: string[] = [
      ...(avail
        ? []
        : ['present availability not read: the export carries no availability row for this stock number']),
      'source status is inferred from public award silence, not from a registration record',
    ]
    if (primary.quantity == null) gaps.push('solicitation quantity did not parse from the index row')

    /*
     * Legs ESTABLISHED, never legs assumed. DELIBERATELY UNCHANGED by the availability wiring,
     * and the reason is worth stating because the obvious edit is wrong.
     *
     * `legsEstablished` feeds `byCornerStrength`, so it orders the map. Counting a read of the
     * availability leg would raise every row whose availability we can SEE, including a row with
     * fifty companies listing stock, which is the opposite of a corner. "We know the answer" and
     * "the answer is favourable" are different facts and this counter must not blur them.
     *
     * The honest reading of availability now travels on the row as its own fields, where the
     * interface can show it and the scorer can weigh it, without silently reordering the map on
     * a semantic nobody agreed to change.
     */
    let legsEstablished = 1 // demand, observed in the index
    if (silentSourceCount > 0) legsEstablished += 1

    rows.push({
      niin,
      nsn: primary.nsn,
      nomenclature: primary.nomenclature,
      quantity: primary.quantity,
      unitOfIssue: primary.unitOfIssue,
      solicitation: primary.solicitation,
      returnDate: primary.returnDate,
      automatedSolicitation: readNinthCharacter(primary.solicitation),
      approvedSources: sourceList,
      approvedSourceCount: sourceList.length,
      soleSource,
      signals,
      silentSourceCount,
      availability: avail ? 'listed_self_reported' : 'unknown_credential_absent',
      availabilityHolders: avail ? avail.holders : null,
      availabilityUnits: avail ? avail.units : null,
      legsEstablished,
      gaps,
    })
  }

  rows.sort(byCornerStrength)

  const soleSourcedWithDemand = rows.filter((r) => r.soleSource).length
  const candidateCorners = rows.filter((r) => r.soleSource && r.silentSourceCount > 0).length
  const silentApprovedSources = countSilentApprovedSources(approved, awardSilentCages)

  return {
    rows,
    summary: {
      approvedSourceNiins: approved.byNiin.size,
      approvedSourceCages: approved.byCage.size,
      demandNiins: index.byNiin.size,
      withDemandAndSource: rows.length,
      soleSourcedWithDemand,
      candidateCorners,
      silentApprovedSources,
      // Cannot be anything but zero while leg 3 is unread. Shown so the ceiling is visible.
      confirmedCorners: 0,
    },
    provenance: {
      ...input.provenance,
      legsAvailable:
        'demand read from the daily index; source status inferred from award silence; availability read from the NSN-Now export where it carries a row, self-reported and never confirmed',
    },
  }
}

/** The demand row that best represents the item today: the largest parsed quantity. */
function pickPrimaryDemandRow(rows: IndexRow[]): IndexRow {
  let best = rows[0] as IndexRow
  for (const r of rows) {
    if ((r.quantity ?? -1) > (best.quantity ?? -1)) best = r
  }
  return best
}

function readNinthCharacter(solicitation: string): boolean | null {
  const normalized = solicitation.replace(/[-\s]/g, '').toUpperCase()
  if (normalized.length < 9) return null
  const ninth = normalized.charAt(8)
  return ninth === 'T' || ninth === 'U'
}

function byCornerStrength(a: CornerRow, b: CornerRow): number {
  if (a.legsEstablished !== b.legsEstablished) return b.legsEstablished - a.legsEstablished
  if (a.soleSource !== b.soleSource) return a.soleSource ? -1 : 1
  if (a.approvedSourceCount !== b.approvedSourceCount) return a.approvedSourceCount - b.approvedSourceCount
  return (b.quantity ?? 0) - (a.quantity ?? 0)
}

function countSilentApprovedSources(approved: ApprovedSourceIndex, silent: Set<Cage>): number {
  let n = 0
  for (const cage of approved.byCage.keys()) if (silent.has(cage)) n += 1
  return n
}
