/**
 * THE UNION, SETTLED ON INPUTS WHOSE ANSWER IS KNOWN BEFORE THE CODE RUNS.
 *
 * =========================================================================================
 * WHY THIS FILE IS SYNTHETIC AND THE ONE BESIDE IT IS NOT
 * =========================================================================================
 * `test/feed-window/wiring.test.ts` runs against the real archive and asserts that the
 * product actually serves the window. It cannot settle whether the union is CORRECT, only
 * that it is large: an assertion written against the archive can only ever confirm whatever
 * the archive happens to contain, and this repository has a recorded incident where a
 * hand-written verification reproduced the exact parser bug it was checking for and agreed
 * with itself.
 *
 * So the contract is settled here, on two days a person wrote by hand, where every expected
 * number was known before `unionFeedDays` was called:
 *
 *   ONE stock number published on BOTH days with five fields different, to pin which day wins
 *   ONE requirement whose own return date has already passed, to pin that it is not demand
 *   ONE published line with no readable return date, to pin that a blank is not "open"
 *   ONE requirement closing exactly ON the reference day, to pin the boundary
 *   ONE non-standard stock number in two spellings, to pin that it dedupes without coercion
 *   ONE approved-source list that SHRANK between the days, to pin that sets are not unioned
 *
 * AND THE REFERENCE DAY IS VARIED, which is the assertion that was missing. Every earlier test
 * in this file passed `union.newestDay`, so `openDemand` could have ignored its argument
 * entirely and nothing here would have moved. It did ignore it: it read the lifecycle the union
 * had already frozen, so a caller passing 2030-01-01 got the identical two rows back with a
 * statement naming 2030. The `describe` block "the reference day actually governs the answer"
 * below is the control for that, and it is written as a SWEEP over three days whose answers
 * were known in advance rather than as one assertion at one instant.
 *
 * Every count below is written as a literal, never as a recomputation of the thing under
 * test, because a check that recomputes the answer the same way cannot disagree with it.
 */

import { describe, expect, it } from 'vitest'

import {
  coverageStatement,
  openDemand,
  unionFeedDays,
  stockIdentity,
  parseIndexReturnDate,
  lifecycleAsOf,
  type DemandReference,
} from '@/lib/intelligence/feed-window'
import { buildCornerMap } from '@/lib/intelligence/corner'
import { parseNsn, type Cage, type Niin } from '@/lib/intelligence/niin'
import type { ApprovedSourceEntry, ApprovedSourceIndex, DailyIndex, IndexRow } from '@/lib/intelligence/seed/feed'
import type { ServedFeedDay } from '@/lib/intelligence/feed-day'

/* ----------------------------------------------------------------- the hand-built inputs */

type RowSpec = {
  nsn: string
  solicitation: string
  quantity: number | null
  unitOfIssue?: string
  nomenclature: string
  returnDate: string
  purchaseRequest: string
}

function indexOf(specs: RowSpec[]): DailyIndex {
  const rows: IndexRow[] = specs.map((s) => ({
    solicitation: s.solicitation,
    nsn: s.nsn,
    niin: parseNsn(s.nsn)?.niin ?? null,
    quantity: s.quantity,
    unitOfIssue: s.unitOfIssue ?? 'EA',
    nomenclature: s.nomenclature,
    returnDate: s.returnDate,
    purchaseRequest: s.purchaseRequest,
  }))
  const byNiin = new Map<Niin, IndexRow[]>()
  for (const row of rows) {
    if (row.niin == null) continue
    const list = byNiin.get(row.niin)
    if (list) list.push(row)
    else byNiin.set(row.niin, [row])
  }
  return { rows, byNiin, offWidthRows: 0, unparsedNsn: 0 }
}

function approvedOf(pairs: Array<{ nsn: string; cage: string; partNumber: string }>): ApprovedSourceIndex {
  const entries: ApprovedSourceEntry[] = []
  const byNiin = new Map<Niin, Set<Cage>>()
  const byCage = new Map<Cage, Set<Niin>>()
  for (const p of pairs) {
    const niin = parseNsn(p.nsn)?.niin
    if (niin == null) throw new Error(`fixture: ${p.nsn} is not a stock number`)
    entries.push({ niin, nsn: p.nsn, cage: p.cage, partNumber: p.partNumber })
    const n = byNiin.get(niin) ?? new Set<Cage>()
    n.add(p.cage)
    byNiin.set(niin, n)
    const c = byCage.get(p.cage) ?? new Set<Niin>()
    c.add(niin)
    byCage.set(p.cage, c)
  }
  return { entries, byNiin, byCage, unparsedLines: 0 }
}

function dayOf(
  feedDay: string,
  sha: string,
  specs: RowSpec[],
  approvedPairs: Array<{ nsn: string; cage: string; partNumber: string }>,
): ServedFeedDay {
  const stamp = feedDay.replace(/-/g, '')
  return {
    feedDay,
    index: indexOf(specs),
    approved: approvedOf(approvedPairs),
    indexPath: `/fixture/${feedDay}/in${stamp}.txt`,
    indexStorageKey: `dibbs-rfq-daily/${feedDay}/T/in${stamp}.txt`,
    archive: {
      storageKey: `dibbs-rfq-daily/${feedDay}/T/bq${stamp}.zip`,
      sha256: sha,
      byteLength: 1234,
      sourceUrl: null,
      retrievedAt: `${feedDay}T11:00:00.000Z`,
      retrievedAtBasis: null,
      member: `as${stamp}.txt`,
    },
    daysHeld: 2,
    skipped: [],
  }
}

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

/*
 * DAY A, the older day. Four published lines.
 *   BOTH_DAYS   a real NSN that day B republishes with five fields changed
 *   ALREADY_CLOSED  return date 01/02/26, which has passed by day B
 *   NON_STANDARD    a locally assigned number, hyphenated here
 *   CLOSES_ON_REF   return date 01/06/26, EXACTLY the reference day
 */
const DAY_A = dayOf(
  '2026-01-05',
  SHA_A,
  [
    {
      nsn: '5310-01-111-1111',
      solicitation: 'SPE1AAA26T0001',
      quantity: 100,
      nomenclature: 'WASHER FLAT',
      returnDate: '01/30/26',
      purchaseRequest: 'PR-A-0001',
    },
    {
      nsn: '5340-01-222-2222',
      solicitation: 'SPE1CCC26T0002',
      quantity: 40,
      nomenclature: 'BRACKET ANGLE',
      returnDate: '01/02/26',
      purchaseRequest: 'PR-A-0002',
    },
    {
      nsn: '1560-LL-NC0-0755',
      solicitation: 'SPE1DDD26T0003',
      quantity: 2,
      nomenclature: 'PANEL STRUCTURAL',
      returnDate: '02/15/26',
      purchaseRequest: 'PR-A-0003',
    },
    {
      nsn: '5310-01-444-4444',
      solicitation: 'SPE1EEE26T0004',
      quantity: 7,
      nomenclature: 'NUT PLAIN HEX',
      returnDate: '01/06/26',
      purchaseRequest: 'PR-A-0004',
    },
  ],
  [
    { nsn: '5310-01-111-1111', cage: 'AAAAA', partNumber: 'P-111-A' },
    { nsn: '5310-01-111-1111', cage: 'BBBBB', partNumber: 'P-111-B' },
    { nsn: '5340-01-222-2222', cage: 'DDDDD', partNumber: 'P-222' },
    { nsn: '5310-01-444-4444', cage: 'CCCCC', partNumber: 'P-444' },
  ],
)

/*
 * DAY B, the newer day. Three published lines.
 *   BOTH_DAYS   republished with a different quantity, close date, solicitation,
 *               nomenclature and purchase request. Unit of issue is unchanged on purpose.
 *   NO_RETURN_DATE  a line whose return-date cell is blank
 *   NON_STANDARD    the same locally assigned number, spelled WITHOUT separators
 * Its approved-source list for the both-days item has SHRUNK from two companies to one.
 */
const DAY_B = dayOf(
  '2026-01-06',
  SHA_B,
  [
    {
      nsn: '5310-01-111-1111',
      solicitation: 'SPE1BBB26T0009',
      quantity: 250,
      nomenclature: 'WASHER, FLAT, STEEL',
      returnDate: '01/30/26',
      purchaseRequest: 'PR-B-0009',
    },
    {
      nsn: '5305-01-333-3333',
      solicitation: 'SPE1FFF26T0010',
      quantity: 12,
      nomenclature: 'SCREW CAP HEX',
      returnDate: '',
      purchaseRequest: 'PR-B-0010',
    },
    {
      nsn: '1560LLNC00755',
      solicitation: 'SPE1DDD26T0003',
      quantity: 2,
      nomenclature: 'PANEL STRUCTURAL',
      returnDate: '02/15/26',
      purchaseRequest: 'PR-A-0003',
    },
  ],
  [{ nsn: '5310-01-111-1111', cage: 'AAAAA', partNumber: 'P-111-A' }],
)

// Day B republishes the both-days item with a LATER close date too, so the change history has
// something to carry on the field retirement is judged from.
DAY_B.index.rows[0]!.returnDate = '02/28/26'

/**
 * The pair `openDemand` requires: a day, and a sentence saying what that day is.
 *
 * The basis is deliberately a fixture sentence rather than a copy of the product's, so an
 * assertion below that reads it back is reading what THIS file supplied and not agreeing with
 * whatever wording the serving path happens to use today.
 */
const refOf = (day: string): DemandReference => ({ day, basis: 'the day this fixture judged against' })

const KEY_BOTH = 'nsn:5310011111111'
const KEY_CLOSED = 'nsn:5340012222222'
const KEY_UNDATED = 'nsn:5305013333333'
const KEY_NON_STANDARD = 'x:1560LLNC00755'
const KEY_ON_REF_DAY = 'nsn:5310014444444'

/* ------------------------------------------------------------------------------- the tests */

describe('the union over two hand-built feed days', () => {
  const union = unionFeedDays([DAY_A, DAY_B])
  if (union == null) throw new Error('the fixture produced no window, which is itself a failure')

  it('takes the newest and oldest day from the DATA, not from the argument order', () => {
    // Handed newest-first, the answer must be identical. A caller iterating a Map has no
    // ordering contract, and "newest wins" implemented as "last write wins" is silently
    // inverted by a reversed list.
    const reversed = unionFeedDays([DAY_B, DAY_A])
    expect(union.newestDay).toBe('2026-01-06')
    expect(union.oldestDay).toBe('2026-01-05')
    expect(reversed?.newestDay).toBe('2026-01-06')
    expect(reversed?.oldestDay).toBe('2026-01-05')
    expect(reversed?.summary).toEqual(union.summary)
  })

  it('returns null for no days at all rather than an empty window', () => {
    expect(unionFeedDays([])).toBeNull()
  })

  it('deduplicates to five stock numbers from seven published lines, and does not double count', () => {
    // Seven lines in, five distinct stock numbers out. Written as literals: the fixture above
    // has four lines on day A and three on day B, and exactly two of them are republications.
    expect(union.index.rows).toHaveLength(5)
    expect(union.summary.distinctStockNumbers).toBe(5)
    expect(union.summary.observations).toBe(7)
    expect(union.index.byKey.size).toBe(5)
    expect(new Set(union.index.rows.map((r) => r.window.key)).size).toBe(5)

    // The published-line total must equal the sum of the per-row observation counts, or some
    // line was counted twice or dropped.
    const summed = union.index.rows.reduce((t, r) => t + r.window.observations, 0)
    expect(summed).toBe(7)
  })

  it('displays the NEWEST published line and carries every field that moved', () => {
    const row = union.index.byKey.get(KEY_BOTH)
    expect(row).toBeDefined()
    if (!row) return

    // Day B's values, not day A's, and not an average of the two.
    expect(row.quantity).toBe(250)
    expect(row.solicitation).toBe('SPE1BBB26T0009')
    expect(row.nomenclature).toBe('WASHER, FLAT, STEEL')
    expect(row.purchaseRequest).toBe('PR-B-0009')
    expect(row.window.sourceDay).toBe('2026-01-06')

    // And day A is not lost: five fields changed, each tied to the day that published it.
    const changed = row.window.changes.map((c) => c.field).sort()
    expect(changed).toEqual(['closeDate', 'nomenclature', 'purchaseRequest', 'quantity', 'solicitation'])
    const quantity = row.window.changes.find((c) => c.field === 'quantity')
    expect(quantity?.history).toEqual([
      { feedDay: '2026-01-05', value: '100' },
      { feedDay: '2026-01-06', value: '250' },
    ])
    // Unit of issue was identical on both days, so it is not a change and must not appear.
    expect(changed).not.toContain('unitOfIssue')

    expect(row.window.observations).toBe(2)
    expect(row.window.observedDays).toEqual(['2026-01-05', '2026-01-06'])
    expect(row.window.distinctSolicitations).toBe(2)
    expect(row.window.recurring).toBe(true)
  })

  it('judges retirement on the published return date, against the newest day held', () => {
    const closed = union.index.byKey.get(KEY_CLOSED)
    const undated = union.index.byKey.get(KEY_UNDATED)
    const onRefDay = union.index.byKey.get(KEY_ON_REF_DAY)
    const open = union.index.byKey.get(KEY_BOTH)

    expect(closed?.window.lifecycle.status).toBe('closed')
    expect(closed?.window.lifecycle.closeDate).toBe('2026-01-02')
    expect(closed?.window.lifecycle.asOf).toBe('2026-01-06')

    // A blank return-date cell is a publisher silence. It must never resolve to "open".
    expect(undated?.window.lifecycle.status).toBe('last_seen_only')
    expect(undated?.window.lifecycle.closeDate).toBeNull()

    // THE BOUNDARY: closing exactly ON the reference day is still open, not closed.
    expect(onRefDay?.window.lifecycle.closeDate).toBe('2026-01-06')
    expect(onRefDay?.window.lifecycle.status).toBe('open')

    // The both-days row retires on day B's LATER date, not day A's.
    expect(open?.window.lifecycle.closeDate).toBe('2026-02-28')
    expect(open?.window.lifecycle.status).toBe('open')

    expect(union.summary.open).toBe(3)
    expect(union.summary.closed).toBe(1)
    expect(union.summary.lastSeenOnly).toBe(1)
  })

  it('keeps a closed row in the window and refuses to call it demand', () => {
    const demand = openDemand(union.index, refOf(union.newestDay))

    // Still in the archive, still labelled.
    expect(union.index.byKey.has(KEY_CLOSED)).toBe(true)
    // Not in demand, and the reason is counted rather than implied by an absence.
    expect(demand.index.byKey.has(KEY_CLOSED)).toBe(false)
    expect(demand.index.byKey.has(KEY_UNDATED)).toBe(false)
    expect(demand.closedExcluded).toBe(1)
    expect(demand.undatedExcluded).toBe(1)
    expect(demand.asOf).toBe('2026-01-06')
    expect(demand.index.rows).toHaveLength(3)
    expect(demand.statement).toContain('as of 2026-01-06')
    expect(demand.statement).toContain('the day this fixture judged against')
    expect(demand.statement).toContain('return date had already passed')
    expect(demand.statement).toContain('no readable return date')

    // The exclusions and what survives must account for every row. A filter that drops a row
    // without counting it is the failure this assertion exists to catch.
    expect(demand.index.rows.length + demand.closedExcluded + demand.undatedExcluded).toBe(
      union.index.rows.length,
    )
  })

  it('keeps a non-standard stock number as its own row and never coerces it onto a real NSN', () => {
    const row = union.index.byKey.get(KEY_NON_STANDARD)
    expect(row).toBeDefined()
    // Two spellings on two days, one row.
    expect(row?.window.observations).toBe(2)
    expect(row?.window.keyKind).toBe('non_standard')
    // No NIIN, so it can never join the catalogue by accident.
    expect(row?.window.niin).toBeNull()
    expect(union.index.byNiin.has('1560LLNC0' as Niin)).toBe(false)
    expect(union.summary.nonStandard).toBe(1)
    expect(union.summary.wellFormedNsn).toBe(4)
    expect(union.summary.bareNiinOnly).toBe(0)
  })

  it('takes the newest approved-source list rather than unioning the companies', () => {
    // Day A named two companies, day B named one. Unioning would turn a sole source into a
    // multiple source, which is the whole claim this product makes, so newest wins.
    const both = union.approved.windowByNiin.get('011111111' as Niin)
    expect(both?.cages).toEqual(['AAAAA'])
    expect(both?.sourceDay).toBe('2026-01-06')
    expect(both?.changed).toBe(true)
    expect(both?.history.map((h) => h.cages)).toEqual([['AAAAA', 'BBBBB'], ['AAAAA']])
    expect(union.approved.byNiin.get('011111111' as Niin)).toEqual(new Set(['AAAAA']))

    // An item only day A listed is still carried: the union can only grow.
    expect(union.approved.byNiin.get('012222222' as Niin)).toEqual(new Set(['DDDDD']))
    expect(union.approved.byNiin.size).toBe(3)

    // And the published part numbers survive the union rather than being blanked.
    const carried = union.approved.entries.find((e) => e.niin === ('014444444' as Niin))
    expect(carried?.partNumber).toBe('P-444')
    expect(carried?.nsn).toBe('5310-01-444-4444')
  })

  it('resolves every row to the archived file and hash of the day that published it', () => {
    const both = union.index.byKey.get(KEY_BOTH)
    const onRefDay = union.index.byKey.get(KEY_ON_REF_DAY)
    const dayB = union.days.find((d) => d.feedDay === both?.window.sourceDay)
    const dayA = union.days.find((d) => d.feedDay === onRefDay?.window.sourceDay)

    expect(dayB?.archiveSha256).toBe(SHA_B)
    expect(dayB?.archiveStorageKey).toBe('dibbs-rfq-daily/2026-01-06/T/bq20260106.zip')
    expect(dayB?.indexStorageKey).toBe('dibbs-rfq-daily/2026-01-06/T/in20260106.txt')
    expect(dayB?.archiveMember).toBe('as20260106.txt')

    // The two rows must resolve to DIFFERENT captures, or the union is quietly citing one file
    // for everything, which is the exact way provenance dies inside a union.
    expect(dayA?.archiveSha256).toBe(SHA_A)
    expect(dayA?.feedDay).toBe('2026-01-05')
    expect(union.days).toHaveLength(2)
    expect(union.days.map((d) => d.indexRows)).toEqual([4, 3])
    expect(union.days.map((d) => d.newStockNumbers)).toEqual([4, 1])
  })

  it('states its span and discloses that the newest day is thin', () => {
    // Four lines then three: the newest day is below the window's own mean of 3.5.
    expect(union.coverage.dayCount).toBe(2)
    expect(union.coverage.firstDay).toBe('2026-01-05')
    expect(union.coverage.lastDay).toBe('2026-01-06')
    expect(union.coverage.days).toEqual(['2026-01-05', '2026-01-06'])
    expect(union.coverage.newestDayIndexRows).toBe(3)
    expect(union.coverage.meanIndexRowsPerDay).toBe(3.5)
    expect(union.coverage.medianIndexRowsPerDay).toBe(3.5)
    expect(union.coverage.newestDayBelowMean).toBe(true)
    expect(union.coverage.newestDayShareOfMean).toBe(0.86)
    expect(union.coverage.statement).toContain('2 archived feed days, 2026-01-05 to 2026-01-06')
    expect(union.coverage.statement).toContain('THIN day')
    // The stored sentence IS the function's output, so the two can never drift apart.
    expect(union.coverage.statement).toBe(coverageStatement(union.coverage))
  })

  it('reports a normal newest day as normal, so the thin flag means something', () => {
    // The negative path for the disclosure above. Day B is the LARGER day here, so nothing
    // may call it thin. A flag that is always true tells an operator nothing.
    const flipped = unionFeedDays([DAY_B, { ...DAY_A, feedDay: '2026-01-07', index: DAY_A.index }])
    expect(flipped?.coverage.newestDayIndexRows).toBe(4)
    expect(flipped?.coverage.newestDayBelowMean).toBe(false)
    expect(flipped?.coverage.statement).toContain('normal publishing day')
    expect(flipped?.coverage.statement).not.toContain('THIN')
  })
})

describe('the corner map over the union', () => {
  const union = unionFeedDays([DAY_A, DAY_B])
  if (union == null) throw new Error('the fixture produced no window')
  const demand = openDemand(union.index, refOf(union.newestDay))

  const provenance = {
    feedDay: union.newestDay,
    sourceArchiveKey: 'fixture',
    sourceArchiveSha256: SHA_B,
    approvedSourceFile: 'fixture!as20260106.txt',
    indexFile: 'fixture',
    silenceListFile: 'fixture',
    computedAt: 'fixture',
  }

  // BOTH approved companies that could produce a candidate are award-silent, deliberately. If
  // a closed requirement were ever counted as demand, the candidate count would be 2 and not 1,
  // so this fixture can tell the two behaviours apart by their numbers alone.
  const awardSilentCages = new Set<Cage>(['AAAAA', 'DDDDD'])

  const map = buildCornerMap({
    approved: union.approved,
    index: demand.index,
    awardSilentCages,
    provenance,
    window: {
      days: union.days,
      coverage: union.coverage,
      newestDayFunnel: { withDemandAndSource: 1, soleSourcedWithDemand: 1, candidateCorners: 1 },
      excludedFromDemand: {
        closed: demand.closedExcluded,
        undated: demand.undatedExcluded,
        asOf: demand.asOf,
        asOfBasis: demand.reference.basis,
        statement: demand.statement,
      },
    },
  })

  it('joins only the requirements that are still open', () => {
    // Three approved items exist; only two of them have OPEN demand, and the third is the one
    // whose solicitation closed. Its company is award-silent, so counting it would show.
    expect(map.rows).toHaveLength(2)
    expect(map.summary.withDemandAndSource).toBe(2)
    expect(map.summary.soleSourcedWithDemand).toBe(2)
    expect(map.summary.candidateCorners).toBe(1)
    expect(map.rows.map((r) => r.niin).sort()).toEqual(['011111111', '014444444'])
  })

  it('gives every row the archived file and hash of ITS day, not the map\'s newest day', () => {
    const both = map.rows.find((r) => r.niin === '011111111')
    const older = map.rows.find((r) => r.niin === '014444444')

    expect(both?.demand?.source.feedDay).toBe('2026-01-06')
    expect(both?.demand?.source.archiveSha256).toBe(SHA_B)
    expect(both?.demand?.observedDays).toEqual(['2026-01-05', '2026-01-06'])
    expect(both?.demand?.recurring).toBe(true)
    expect(both?.demand?.onNewestDay).toBe(true)
    expect(both?.demand?.changedFields.sort()).toEqual([
      'closeDate',
      'nomenclature',
      'purchaseRequest',
      'quantity',
      'solicitation',
    ])

    // The row published only on the OLDER day cites the older day, with the older hash. This
    // is the assertion that fails if a union ever cites one file for every row it holds.
    expect(older?.demand?.source.feedDay).toBe('2026-01-05')
    expect(older?.demand?.source.archiveSha256).toBe(SHA_A)
    expect(older?.demand?.onNewestDay).toBe(false)
    expect(older?.demand?.source.archiveSha256).not.toBe(both?.demand?.source.archiveSha256)

    // Every row on a window-built map carries a source, and every lifecycle is open.
    for (const row of map.rows) {
      expect(row.demand).not.toBeNull()
      expect(row.demand?.lifecycle).toBe('open')
      expect(union.coverage.days).toContain(row.demand?.source.feedDay)
    }
  })

  it('one source object per day, shared by reference across the rows that day published', () => {
    // Not a micro-optimisation: the archived capture is a fact about the DAY, and duplicating
    // it per row measured megabytes of byte-identical strings on the real window.
    const sources = new Set(map.rows.map((r) => r.demand?.source))
    expect(sources.size).toBe(2)
  })

  it('states its basis, and carries the newest-day funnel beside the window funnel', () => {
    expect(map.coverage.basis).toBe('window')
    expect(map.coverage.dayCount).toBe(2)
    expect(map.coverage.newestDayFunnel?.candidateCorners).toBe(1)
    expect(map.coverage.excludedFromDemand?.closed).toBe(1)
    expect(map.coverage.statement).toContain('archived feed days')
    expect(map.coverage.statement).toContain('excluded from demand')
  })

  it('says single_day, and abstains on the window fields, when it is built from one day', () => {
    // The negative path. A single-day map must not report zero exclusions: it never evaluated
    // a close date at all, and a zero there would be a measurement that was never taken.
    const single = buildCornerMap({
      approved: DAY_B.approved,
      index: DAY_B.index,
      awardSilentCages,
      provenance,
    })
    expect(single.coverage.basis).toBe('single_day')
    expect(single.coverage.dayCount).toBe(1)
    expect(single.coverage.window).toBeNull()
    expect(single.coverage.newestDayFunnel).toBeNull()
    expect(single.coverage.excludedFromDemand).toBeNull()
    expect(single.coverage.statement).toContain('single archived feed day')
    for (const row of single.rows) expect(row.demand ?? null).toBeNull()
  })
})

/**
 * THE CONTROL FOR THE DEFECT THAT SHIPPED: `openDemand` ignoring its own reference day.
 *
 * Written as a SWEEP rather than one assertion, because one assertion at one instant is
 * exactly what the earlier version of this file had: every call passed `union.newestDay`, so a
 * function that read the frozen lifecycle instead of the argument agreed with every test in
 * the suite. Reverting `openDemand` to `row.window.lifecycle.status` turns this whole block
 * red, which is what makes it a control and not a green tick.
 *
 * The fixture's close dates, and therefore every expectation below, are known before the code
 * runs: 2026-01-02 (closed), 2026-01-06 (the union's newest day), 2026-02-15, 2026-02-28, and
 * one line with no readable return date at all.
 */
describe('the reference day actually governs the answer', () => {
  const union = unionFeedDays([DAY_A, DAY_B])
  if (union == null) throw new Error('the fixture produced no window')

  // day, open rows, closed excluded. Undated is 1 at every reference day: a blank is refused
  // as open no matter what day it is judged on, and that invariance is itself an assertion.
  const sweep: Array<{ day: string; open: number; closed: number; why: string }> = [
    { day: '2026-01-01', open: 4, closed: 0, why: 'before every published return date' },
    { day: '2026-01-06', open: 3, closed: 1, why: "the union's own newest day" },
    { day: '2026-01-07', open: 2, closed: 2, why: 'one day past the boundary row' },
    { day: '2026-02-16', open: 1, closed: 3, why: 'past the non-standard row' },
    { day: '2030-01-01', open: 0, closed: 4, why: 'past every return date in the fixture' },
  ]

  for (const step of sweep) {
    it(`returns ${step.open} open and ${step.closed} closed at ${step.day} (${step.why})`, () => {
      const demand = openDemand(union.index, refOf(step.day))
      expect(demand.index.rows).toHaveLength(step.open)
      expect(demand.closedExcluded).toBe(step.closed)
      expect(demand.undatedExcluded).toBe(1)
      expect(demand.asOf).toBe(step.day)
      // Nothing is dropped without being counted, at any reference day.
      expect(demand.index.rows.length + demand.closedExcluded + demand.undatedExcluded).toBe(5)
    })
  }

  it('stamps the surviving rows with the day that admitted them, not the union\'s', () => {
    const demand = openDemand(union.index, refOf('2026-01-07'))
    const row = demand.index.byKey.get(KEY_BOTH)
    expect(row).toBeDefined()
    // The row went out judged against 2026-01-07. If it carried 2026-01-06 the row would be
    // labelled with a day that did not decide it, which is the same class of defect one level
    // down: a measurement wearing a basis that did not produce it.
    expect(row?.window.lifecycle.asOf).toBe('2026-01-07')
    expect(row?.window.lifecycle.status).toBe('open')
    for (const r of demand.index.rows) expect(r.window.lifecycle.asOf).toBe('2026-01-07')

    // The boundary row closed on 2026-01-06, so at 2026-01-07 it is out.
    expect(demand.index.byKey.has(KEY_ON_REF_DAY)).toBe(false)
  })

  it('leaves the union itself untouched, so the archive keeps its own judgement', () => {
    openDemand(union.index, refOf('2030-01-01'))
    const onRefDay = union.index.byKey.get(KEY_ON_REF_DAY)
    expect(onRefDay?.window.lifecycle.asOf).toBe('2026-01-06')
    expect(onRefDay?.window.lifecycle.status).toBe('open')
    expect(union.summary.open).toBe(3)
  })

  it('prints the reference day AND its basis into the sentence that ships', () => {
    const demand = openDemand(union.index, {
      day: '2026-01-09',
      basis: 'the day this was computed, 1 US federal business day after the newest archived feed day 2026-01-06',
    })
    expect(demand.statement).toContain('as of 2026-01-09')
    expect(demand.statement).toContain('1 US federal business day after the newest archived feed day 2026-01-06')
    // The day named in the sentence is the day that produced the count beside it.
    expect(demand.statement).toContain(`${demand.closedExcluded} requirements`)
  })

  it('empties the candidate funnel once every requirement has closed', () => {
    // The end-to-end shape of the defect: a map built over demand judged past every return
    // date must find nothing, because there is nothing left open to corner. Before the fix
    // this returned the same two rows and the same one candidate at every reference day.
    const demand = openDemand(union.index, refOf('2030-01-01'))
    const map = buildCornerMap({
      approved: union.approved,
      index: demand.index,
      awardSilentCages: new Set<Cage>(['AAAAA', 'DDDDD']),
      provenance: {
        feedDay: union.newestDay,
        sourceArchiveKey: 'fixture',
        sourceArchiveSha256: SHA_B,
        approvedSourceFile: 'fixture!as20260106.txt',
        indexFile: 'fixture',
        silenceListFile: 'fixture',
        computedAt: 'fixture',
      },
      window: {
        days: union.days,
        coverage: union.coverage,
        newestDayFunnel: { withDemandAndSource: 1, soleSourcedWithDemand: 1, candidateCorners: 1 },
        excludedFromDemand: {
          closed: demand.closedExcluded,
          undated: demand.undatedExcluded,
          asOf: demand.asOf,
          asOfBasis: demand.reference.basis,
          statement: demand.statement,
        },
      },
    })
    expect(map.rows).toHaveLength(0)
    expect(map.summary.candidateCorners).toBe(0)
    expect(map.coverage.excludedFromDemand?.asOf).toBe('2030-01-01')
  })
})

describe('the pieces the union is assembled from', () => {
  it('keys a well-formed stock number on all thirteen digits, not on the NIIN', () => {
    expect(stockIdentity('5310-01-111-1111')?.key).toBe('nsn:5310011111111')
    expect(stockIdentity('5340011111111')?.key).toBe('nsn:5340011111111')
    // Same NIIN, two supply classes, two keys. Collapsing them would merge two catalogue items.
    expect(stockIdentity('5310-01-111-1111')?.key).not.toBe(stockIdentity('5340011111111')?.key)
  })

  it('keys a non-standard number on itself, in either spelling, and never on a numeric key', () => {
    expect(stockIdentity('1560-LL-NC0-0755')?.key).toBe('x:1560LLNC00755')
    expect(stockIdentity('1560LLNC00755')?.key).toBe('x:1560LLNC00755')
    expect(stockIdentity('1560-LL-NC0-0755')?.kind).toBe('non_standard')
    expect(stockIdentity('  ')).toBeNull()
  })

  it('reads a return date against the publishing day, and refuses a date that is not real', () => {
    expect(parseIndexReturnDate('01/30/26', '2026-01-06').iso).toBe('2026-01-30')
    // February 30th is refused rather than rolling into March.
    expect(parseIndexReturnDate('02/30/26', '2026-01-06').iso).toBeNull()
    expect(parseIndexReturnDate('', '2026-01-06').basis).toContain('no return date')
    // The century is pivoted off the feed day, so a two-digit year needs no maintenance.
    expect(parseIndexReturnDate('01/30/99', '2026-01-06').iso).toBe('1999-01-30')
  })

  it('never calls an undated row open', () => {
    expect(lifecycleAsOf({ closeDate: null, onNewestDay: true, asOf: '2026-01-06' }).status).toBe(
      'last_seen_only',
    )
    expect(lifecycleAsOf({ closeDate: '2026-01-05', onNewestDay: true, asOf: '2026-01-06' }).status).toBe(
      'closed',
    )
    expect(lifecycleAsOf({ closeDate: '2026-01-06', onNewestDay: false, asOf: '2026-01-06' }).status).toBe(
      'open',
    )
  })
})
