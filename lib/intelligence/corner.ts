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
 *  LEG 1, demand.        READ. Open solicitations in the index. This is observed recurrence,
 *                        not the agency's forward buy plan, and rows say so.
 *
 *                        WIDENED 2026-08-18 FROM ONE DAY TO THE ARCHIVED WINDOW. The DIBBS
 *                        daily index publishes the requirements ISSUED that day, so twenty
 *                        consecutive days are very nearly disjoint and serving the newest one
 *                        showed roughly a fortieth of the demand already on disk, with the
 *                        board's size swinging by weekday because Friday is the publishing
 *                        trough. Demand is now the union across every archived day the feed
 *                        window can parse-verify, NARROWED BACK to the requirements whose own
 *                        published return date has not passed. That second half is not
 *                        optional: measured on the twenty days ending 2026-08-14, half the
 *                        union had already closed, and a closed solicitation on a board that
 *                        says "DLA is buying this now" is a worse inaccuracy than a thin day.
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
import type {
  LifecycleStatus,
  WindowCoverage,
  WindowDay,
  WindowFieldName,
  WindowRow,
} from './feed-window'

/**
 * THE ARCHIVED CAPTURE ONE FEED DAY IS, held by reference on every row that day published.
 *
 * ONE OBJECT PER DAY, SHARED BY REFERENCE, DELIBERATELY, because the archived capture is a
 * fact about the DAY and not about the row. Measured on the twenty-day window: 10,488 rows
 * resolve to 14 source objects. Flattening those fields onto each row measured 6.38MB of
 * `JSON.stringify` against 5.80MB with the reference shared, and a serializer that emits a
 * repeated reference once pays for each day exactly once instead. That last number has NOT
 * been measured here and is not claimed, only noted as the direction sharing moves it.
 */
export type CornerDaySource = {
  /** The feed day whose published line the displayed demand values came from. */
  feedDay: string
  /** That day's archived index capture, by storage key. */
  indexStorageKey: string
  /** That day's archived quoting zip, and the member the approved-source list was read from. */
  archiveStorageKey: string
  archiveMember: string
  /** The manifest's recorded hash for that zip, or null where the manifest recorded none. */
  archiveSha256: string | null
  /** When those bytes were retrieved from the origin. ISO UTC. */
  retrievedAt: string
}

/**
 * WHERE ONE ROW'S DEMAND CAME FROM, WHEN THE MAP IS BUILT OVER A WINDOW OF DAYS.
 *
 * A single day needed no such thing: every row on the map came from the one capture the map
 * cited at the top, so the map-level provenance was the row-level provenance. A union breaks
 * that identity. Twenty archived days are twenty different files with twenty different
 * hashes, and a row that cannot say WHICH of them published it has lost the only property
 * this product sells. So the row carries its own day and that day's archived files, and the
 * map-level `provenance` block keeps naming the newest day, which is what the freshness pill
 * and the header are about.
 *
 * It travels WITH the row rather than through a lookup on the map, because rows travel alone:
 * `/corner/[nsn]`, the brief route and the pursuit package each take a single row and must be
 * able to cite the government file behind it without holding the whole map.
 *
 * The full per-field change history stays on `WindowRow.window.changes` rather than here.
 * This record is on the wire for every row on the board, so it carries the NAMES of the
 * fields DLA republished differently and not their values: enough for a row to disclose that
 * the buy moved, without putting a history nobody expanded onto every payload. For the same
 * reason it carries `observedDays` and nothing derivable from it, so a first-seen, a last-seen
 * and a day count cannot drift away from the list they summarise.
 */
export type CornerDemandProvenance = {
  /** The archived capture behind the displayed values. Shared by reference across the day. */
  source: CornerDaySource
  /** Every feed day this stock number was published on, oldest first. First and last included. */
  observedDays: string[]
  /** Published lines across the window. Can exceed observedDays.length: one day can carry two. */
  observations: number
  /** More than one means DLA re-solicited the item inside the window: a standing requirement. */
  distinctSolicitations: number
  recurring: boolean
  /** The government's own return date from the newest published line. Never inferred. */
  closeDate: string | null
  /**
   * Judged against `asOf`, which is the day the map was COMPUTED on and not a feed day. The
   * distinction is the whole point: a requirement's return date passes whether or not the
   * capture ran, so judging against the newest archived day serves closed solicitations for as
   * long as the capture has been missed.
   */
  lifecycle: LifecycleStatus
  asOf: string
  /** TRUE when this stock number also appears on the newest feed day's index. */
  onNewestDay: boolean
  /** Fields DLA republished with a different value inside the window. Usually empty. */
  changedFields: WindowFieldName[]
}

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
  /**
   * Which archived day published this row's demand, and how it behaved across the window.
   *
   * ABSENT OR NULL BOTH MEAN ONE THING: this row did not come from a window build, so the
   * map-level `provenance` block already names its source exactly. Neither ever means
   * "unknown", and `CornerMap.coverage.basis` is the authoritative discriminator between the
   * two worlds. Optional rather than strictly required only so that hand-written row fixtures
   * in the suite stay valid without every one of them restating a field they do not exercise;
   * `buildCornerMap` always writes it, null or populated, on every row it produces.
   */
  demand?: CornerDemandProvenance | null
  /** Named, never empty by omission. */
  gaps: string[]
}

/** The three counts the Monopoly Map's funnel renders, in order, widest first. */
export type CornerFunnel = {
  withDemandAndSource: number
  soleSourcedWithDemand: number
  candidateCorners: number
}

export function cornerFunnel(map: CornerMap): CornerFunnel {
  return {
    withDemandAndSource: map.summary.withDemandAndSource,
    soleSourcedWithDemand: map.summary.soleSourcedWithDemand,
    candidateCorners: map.summary.candidateCorners,
  }
}

/** What the demand side of the map left out, and why. Null when nothing filtered it. */
export type DemandExclusion = {
  /** Requirements whose own published return date had passed by `asOf`. */
  closed: number
  /** Requirements whose published line carried no readable return date. Never read as open. */
  undated: number
  /** The day retirement was judged against. On the serving path this is TODAY, not a feed day. */
  asOf: string
  /** What `asOf` is, in words, so no surface can print the day without its basis. */
  asOfBasis: string
  statement: string
}

/**
 * HOW MUCH OF THE ARCHIVE THIS MAP IS, AND WHAT THE NEWEST DAY ALONE WOULD HAVE SAID.
 *
 * Both numbers ship or neither does. A candidate count that grows sixty-fold between two
 * deploys, with nothing on the screen explaining what changed, reads as a product that has
 * started making things up, and it costs more trust than the small honest number cost. So the
 * map carries its own span and, when it was built over a window, the identical funnel
 * recomputed over the newest archived day alone, produced by this same builder from that day's
 * own files AND narrowed by the same `openDemand` reference day, so the two numbers are like
 * for like. Judging only one of them was itself a defect: measured a week past the newest
 * capture the surface printed 11 window candidates beside an unjudged 18.
 */
export type CornerMapCoverage = {
  /** 'window' when demand is the union of archived days; 'single_day' when it is one capture. */
  basis: 'window' | 'single_day'
  daysIncluded: string[]
  firstDay: string
  lastDay: string
  dayCount: number
  /** The window's span and its thin-day disclosure. Null on the single-day path. */
  window: WindowCoverage | null
  /**
   * The same three counts over the newest feed day alone. Null on the single-day path, where
   * the funnel above already IS the newest day and repeating it would say nothing.
   */
  newestDayFunnel: CornerFunnel | null
  /**
   * What the demand filter excluded. NULL on the single-day path, and null is the honest
   * value there: that path never evaluated a close date at all, so a zero would be a
   * measurement this map never took.
   */
  excludedFromDemand: DemandExclusion | null
  /** The one definition of the operator sentence for this basis. See `cornerCoverageStatement`. */
  statement: string
}

/**
 * The sentence that has to travel with every count this map produces.
 *
 * Named apart from `coverageStatement` in lib/intelligence/feed-window.ts on purpose: that one
 * describes a WINDOW and this one describes a MAP built over one, they take different arguments,
 * and a surface that imports both would otherwise have to alias one of them at every call site.
 *
 * ONE DEFINITION, exported, because the same explanation is owed on the Monopoly Map, the
 * dashboard, the nav count and inside the AI brief's dossier, and four hand-written versions
 * of it would drift within a week. It states the span, what was excluded from demand and why,
 * and what the newest archived day alone says when judged the same way, in that order, because
 * that is the order the questions arrive in when a number changes under an operator.
 */
export function cornerCoverageStatement(coverage: CornerMapCoverage): string {
  if (coverage.basis === 'single_day') {
    return `Counted on the single archived feed day ${coverage.firstDay}. The archive was not unioned for this build, so no count here is compared across days.`
  }
  const parts: string[] = []
  if (coverage.window) parts.push(coverage.window.statement)
  if (coverage.excludedFromDemand) parts.push(coverage.excludedFromDemand.statement)
  if (coverage.newestDayFunnel) {
    /*
     * THE WORD "IDENTICAL" HAS TO EARN ITSELF, AND UNTIL 2026-08-18 IT DID NOT.
     *
     * This sentence used to end "which is what this product showed before the window was
     * served", and both halves were wrong once the window started being judged against today.
     * The window count was narrowed by retirement and the newest-day count was not, so the two
     * numbers were printed side by side at equal confidence on different bases. MEASURED on
     * this archive at a reference day one week past the newest capture: 11 window candidates
     * beside an unjudged 18, and at two weeks, 0 beside 18.
     *
     * `buildWindowedDatasets` now judges both with one `openDemand` reference, so "identical"
     * is true, and the sentence NAMES THE DAY it was judged against rather than leaving a
     * reader to assume it. The "before the window was served" clause is gone: that was a claim
     * about this product's own history, which no file on disk can support, and it is not what
     * the number means any more.
     */
    const judged = coverage.excludedFromDemand
      ? `, judged against the same ${coverage.excludedFromDemand.asOf},`
      : ', judged on the same basis,'
    parts.push(
      `The identical computation over the newest archived day alone, ${coverage.lastDay}${judged} finds ${coverage.newestDayFunnel.candidateCorners} candidate corner${coverage.newestDayFunnel.candidateCorners === 1 ? '' : 's'}, which is what a board built on that one capture would show today.`,
    )
  }
  return parts.join(' ')
}

export type CornerMap = {
  rows: CornerRow[]
  coverage: CornerMapCoverage
  summary: {
    /**
     * Stock numbers in the approved-source input. One feed day's file on the single-day path,
     * and the union across `coverage.daysIncluded` on the window path. `coverage.basis` says
     * which, and the two must never be quoted as if they were the same measurement.
     */
    approvedSourceNiins: number
    /** Distinct companies named as an approved source, over that same basis. */
    approvedSourceCages: number
    /**
     * Stock numbers under OPEN solicitation in the demand input. On the window path the caller
     * has already dropped every requirement whose own return date passed, and how many it
     * dropped is on `coverage.excludedFromDemand`.
     */
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
  /**
   * The window `index` was drawn from, when it was drawn from one.
   *
   * ABSENT MEANS SINGLE DAY, and the map says so rather than implying a window it does not
   * have. Present, it supplies the per-day archived files each row's provenance resolves
   * against, the span the surface prints, and the newest-day funnel the surface prints beside
   * the window count. The caller computes that funnel by running THIS builder over the newest
   * day's own files, so the comparison is the same code on different input and not a second
   * definition of what a candidate corner is.
   */
  window?: {
    days: WindowDay[]
    coverage: WindowCoverage
    newestDayFunnel: CornerFunnel
    excludedFromDemand: DemandExclusion
  }
  /** Where each input came from, carried onto the surface. */
  provenance: Omit<CornerMap['provenance'], 'legsAvailable'>
}

/**
 * A demand row that carries window context, or null when it does not.
 *
 * `WindowedIndex` is deliberately assignable to `DailyIndex`, so this builder accepts either
 * without a second signature. The cost is that the window fields have to be recognised at
 * runtime rather than named in the type, which is why this is one guarded function rather
 * than a cast scattered through the loop.
 */
function windowContext(row: IndexRow): WindowRow['window'] | null {
  const candidate = (row as Partial<WindowRow>).window
  return candidate == null ? null : candidate
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

  // ONE source object per feed day, built once and handed to every row that day published, so
  // ten thousand rows share twenty objects rather than carrying ten thousand copies of the
  // same storage key and hash.
  const dayByFeedDay = new Map<string, CornerDaySource>()
  for (const day of input.window?.days ?? []) {
    dayByFeedDay.set(day.feedDay, {
      feedDay: day.feedDay,
      indexStorageKey: day.indexStorageKey,
      archiveStorageKey: day.archiveStorageKey,
      archiveMember: day.archiveMember,
      archiveSha256: day.archiveSha256,
      retrievedAt: day.retrievedAt,
    })
  }

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

    const context = windowContext(primary)
    const sourceDay = context == null ? null : dayByFeedDay.get(context.sourceDay) ?? null

    const gaps: string[] = [
      ...(avail
        ? []
        : ['present availability not read: the export carries no availability row for this stock number']),
      'source status is inferred from public award silence, not from a registration record',
    ]
    if (primary.quantity == null) gaps.push('solicitation quantity did not parse from the index row')
    if (context != null && sourceDay == null) {
      // A row naming a day the window did not carry is a wiring fault, not a data gap, and it
      // must be visible as one rather than rendering as a row with no provenance at all.
      gaps.push(
        `the feed day ${context.sourceDay} this row was published on is not among the days this window carried, so its archived file cannot be cited`,
      )
    }

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
      demand:
        context == null || sourceDay == null
          ? null
          : {
              source: sourceDay,
              observedDays: context.observedDays,
              observations: context.observations,
              distinctSolicitations: context.distinctSolicitations,
              recurring: context.recurring,
              closeDate: context.lifecycle.closeDate,
              lifecycle: context.lifecycle.status,
              asOf: context.lifecycle.asOf,
              onNewestDay: context.lifecycle.onNewestDay,
              changedFields: context.changes.map((c) => c.field),
            },
      gaps,
    })
  }

  rows.sort(byCornerStrength)

  const soleSourcedWithDemand = rows.filter((r) => r.soleSource).length
  const candidateCorners = rows.filter((r) => r.soleSource && r.silentSourceCount > 0).length
  const silentApprovedSources = countSilentApprovedSources(approved, awardSilentCages)

  const win = input.window
  const coverage: CornerMapCoverage = win
    ? {
        basis: 'window',
        daysIncluded: win.coverage.days,
        firstDay: win.coverage.firstDay,
        lastDay: win.coverage.lastDay,
        dayCount: win.coverage.dayCount,
        window: win.coverage,
        newestDayFunnel: win.newestDayFunnel,
        excludedFromDemand: win.excludedFromDemand,
        statement: '',
      }
    : {
        basis: 'single_day',
        daysIncluded: [input.provenance.feedDay],
        firstDay: input.provenance.feedDay,
        lastDay: input.provenance.feedDay,
        dayCount: 1,
        window: null,
        newestDayFunnel: null,
        excludedFromDemand: null,
        statement: '',
      }
  // Written after the facts exist, from the facts, so the stored sentence is this function's
  // output rather than a second hand-maintained copy of it.
  coverage.statement = cornerCoverageStatement(coverage)

  return {
    rows,
    coverage,
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
  // A PRE-SORT ONLY. The 08-28 doctrine inverts sole-source: a lone approved source is not a top
  // rank, so the `soleSource ? -1` and the approvedSourceCount-ascending tiebreaks that privileged
  // monopoly are GONE. This orders by legs established and then by size, and leaves the
  // authoritative, value-weighted ordering to the downstream rankKey on the enriched surface.
  if (a.legsEstablished !== b.legsEstablished) return b.legsEstablished - a.legsEstablished
  return (b.quantity ?? 0) - (a.quantity ?? 0)
}

function countSilentApprovedSources(approved: ApprovedSourceIndex, silent: Set<Cage>): number {
  let n = 0
  for (const cage of approved.byCage.keys()) if (silent.has(cage)) n += 1
  return n
}
