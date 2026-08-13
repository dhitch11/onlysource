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
 *  LEG 3, availability.  NOT READ. No locator credential. Every row abstains on this leg
 *                        rather than assuming thin availability, because a corner fabricated
 *                        off a missing availability read is the exact Law 1 failure.
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
  /** Never read. Present so the interface renders the abstention rather than omitting it. */
  availability: 'unknown_credential_absent'
  /**
   * 0 to 3. Counts only legs actually ESTABLISHED, so it can never reach 3 while the
   * availability credential is absent. That ceiling is deliberate and visible.
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
  const { approved, index, awardSilentCages } = input
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

    const gaps: string[] = [
      'present availability not read: no commercial locator credential is connected',
      'source status is inferred from public award silence, not from a registration record',
    ]
    if (primary.quantity == null) gaps.push('solicitation quantity did not parse from the index row')

    // Legs ESTABLISHED, never legs assumed. Availability can never contribute while unread.
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
      availability: 'unknown_credential_absent',
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
        'demand read from the daily index; source status inferred from award silence; availability not read',
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
