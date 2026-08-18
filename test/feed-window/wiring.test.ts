/**
 * THE POSITIVE CONTROL: the product must actually SERVE the window, not merely contain one.
 *
 * =========================================================================================
 * WHAT THIS FILE IS FOR
 * =========================================================================================
 * `lib/intelligence/feed-window.ts` existed for a day with 764 lines, zero importers and no
 * tests. It was correct and it changed nothing, which is this estate's named
 * built-and-wired-but-never-fed failure mode. Every assertion below is written so that it goes
 * RED if `buildAllDatasets()` reverts to serving one feed day, and the relationships are
 * asserted rather than the literals, because the archive grows by one capture every weekday
 * morning and a pinned count would go red on a healthy Tuesday.
 *
 * The sibling file `union.test.ts` settles whether the union is CORRECT, on synthetic days
 * whose answer was known in advance. This file settles whether it is REACHED.
 *
 * It skips loudly, by name, when the archive is absent, because a suite that reports success
 * while measuring nothing is worse than one that fails.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildAllDatasets,
  buildDistressed,
  cachePerIdentityDay,
  checkDataAvailability,
  SEED_PATHS,
} from '@/lib/intelligence/datasets'
import { buildCornerMap, cornerFunnel, type CornerDemandProvenance } from '@/lib/intelligence/corner'
import { openDemand, resolveServedWindow, unionFeedDays } from '@/lib/intelligence/feed-window'
import { discoverFeedDays, measureFeedFreshness } from '@/lib/ingest/feed-days'
import { resolveFeedDayInputs } from '@/lib/intelligence/feed-day'
import { buildMonopolyView } from '@/lib/intelligence/monopoly-view'
import { boundRowsForWire, isCandidateCorner, GRID_ROW_BUDGET } from '@/app/(app)/monopoly/wire-bound'
import { rowProvenanceEntries } from '@/app/(app)/monopoly/row-provenance'
import { fixedClock, systemClock } from '@/lib/time/clock'

/**
 * NOON EASTERN ON A NAMED CIVIL DAY, as a UTC instant.
 *
 * 17:00 UTC is 13:00 EDT and 12:00 EST, so it lands on the same Eastern civil date on both
 * sides of a DST boundary. Written out rather than borrowed, because a clock fixture that
 * silently slips a day would make every assertion below measure the wrong morning.
 */
const noonEastern = (isoDay: string): number => {
  const [y, m, d] = isoDay.split('-').map(Number)
  return Date.UTC(y as number, (m as number) - 1, d as number, 17, 0, 0)
}

/** N days after an ISO civil day, as an ISO civil day. Pure, no clock, no locale. */
const addDays = (isoDay: string, n: number): string => {
  const [y, m, d] = isoDay.split('-').map(Number)
  const t = Date.UTC(y as number, (m as number) - 1, (d as number) + n)
  return new Date(t).toISOString().slice(0, 10)
}

const inputs = checkDataAvailability()
const ALL_PRESENT = inputs.every((i) => i.present)

describe('the served corner map is the archived window, not one feed day', () => {
  if (!ALL_PRESENT) {
    it('SKIPPED: the feed inputs are absent in this environment', () => {
      const missing = inputs.filter((i) => !i.present).map((i) => i.path)
      expect(missing.length).toBeGreaterThan(0)
    })
    return
  }

  const resolution = resolveServedWindow()
  if (!resolution.ok) {
    it(`SKIPPED: no window resolved from this archive (${resolution.reason})`, () => {
      expect(resolution.ok).toBe(false)
    })
    return
  }
  const window = resolution.window

  // A one-day archive cannot demonstrate a window. Say so rather than passing vacuously.
  if (window.coverage.dayCount < 2) {
    it(`SKIPPED: this archive holds ${window.coverage.dayCount} servable day, so a window cannot be demonstrated`, () => {
      expect(window.coverage.dayCount).toBeLessThan(2)
    })
    return
  }

  /*
   * BUILT ON FIRST USE, NOT AT COLLECTION. `buildAllDatasets()` parses the NSN-Now workbooks,
   * which is tens of seconds of CPU, and doing it in the describe body charges it to module
   * import where no timeout applies and where it overlaps every other file the default project
   * is collecting. Memoised here so the eight tests below still share one build.
   *
   * This file belongs in `HEAVY_INTELLIGENCE_TESTS` in vitest.config.mts, beside the other
   * four files that call `buildAllDatasets()`, so it runs pinned to one worker with a shared
   * module registry. That config file is owned by another lane and is not edited from here.
   */
  let built: ReturnType<typeof buildAllDatasets> | null = null
  const served = () => (built ??= buildAllDatasets())

  it('serves EVERY servable archived day, and names them', { timeout: 180_000 }, () => {
    // THE CONTROL. If the wiring reverts to a single day this reads 'single_day' and 1, and
    // three assertions here go red at once.
    expect(served().cornerMap.coverage.basis).toBe('window')
    expect(served().cornerMap.coverage.dayCount).toBeGreaterThan(1)
    expect(served().window).not.toBeNull()

    const held = discoverFeedDays().days.filter((d) => d.complete).map((d) => d.logicalDate)
    const included = served().window?.daysIncluded ?? []
    const refused = (served().window?.skipped ?? []).map((s) => s.feedDay)

    // Every complete day is either served or refused BY NAME with a reason. A day that is
    // neither has been silently dropped, which is how coverage quietly rots.
    for (const day of held) expect(included.includes(day) || refused.includes(day)).toBe(true)
    for (const s of served().window?.skipped ?? []) expect(s.reason.length).toBeGreaterThan(10)

    expect(included).toEqual([...included].sort())
    expect(served().cornerMap.coverage.firstDay).toBe(included[0])
    expect(served().cornerMap.coverage.lastDay).toBe(included[included.length - 1])
    expect(served().cornerMap.coverage.dayCount).toBe(included.length)
  })

  it('holds strictly more than the newest day alone, and says what the newest day held', () => {
    const newestFunnel = served().newestDayFunnel
    expect(newestFunnel).not.toBeNull()
    if (!newestFunnel) return

    // The defect this lane exists to fix, stated as an inequality so it survives the archive
    // growing. If serving reverts to one day these become equalities and the test goes red.
    expect(served().cornerMap.summary.withDemandAndSource).toBeGreaterThan(
      newestFunnel.withDemandAndSource,
    )
    expect(served().cornerMap.summary.candidateCorners).toBeGreaterThan(newestFunnel.candidateCorners)

    // BOTH numbers are reachable, and the sentence names both bases. A count that grows without
    // an explanation on the same screen is the failure this assertion guards.
    expect(newestFunnel.candidateCorners).toBeGreaterThan(0)
    expect(served().cornerMap.coverage.statement).toContain('archived feed days')
    expect(served().cornerMap.coverage.statement).toContain('newest archived day alone')
    // The comparison names the day it was judged against. The sentence used to end "which is
    // what this product showed before the window was served", which was a claim about this
    // product's history that no file on disk supports AND was false about the basis: only the
    // window was judged. Both numbers are judged now and the sentence says on which day.
    const judgedOn = served().cornerMap.coverage.excludedFromDemand?.asOf
    expect(judgedOn).toBeTruthy()
    expect(served().cornerMap.coverage.statement).toContain(`judged against the same ${judgedOn}`)
    expect(served().cornerMap.coverage.statement).not.toContain('before the window was served')
  })

  /*
   * A RECOMPUTE OF THE NEWEST-DAY COMPARISON, FROM SCRATCH, ON THE DAY IT CLAIMS TO BE JUDGED
   * ON. Resolve the newest day through the SINGLE-DAY resolver (a different code path from the
   * window resolver the serving build uses), union it with itself so it carries the lifecycle
   * machinery, narrow it with the same reference day the window was narrowed by, and run the
   * map. If the served funnel disagrees, one of the two is inventing a definition or a basis.
   */
  const recomputeNewestDayFunnel = (judgedOn: string) => {
    const single = resolveFeedDayInputs(window.newestDay)
    expect(single.ok).toBe(true)
    if (!single.ok) throw new Error('the newest archived day did not resolve through the single-day path')
    const provenance = {
      feedDay: single.served.feedDay,
      sourceArchiveKey: single.served.archive.storageKey,
      sourceArchiveSha256: single.served.archive.sha256 ?? 'unrecorded',
      approvedSourceFile: `${single.served.archive.storageKey}!${single.served.archive.member}`,
      indexFile: single.served.indexStorageKey,
      silenceListFile: 'independent recompute',
      computedAt: 'independent recompute',
    }
    const awardSilentCages = new Set(buildDistressed(SEED_PATHS).firms.map((f) => f.cage))
    const union = unionFeedDays([single.served])
    expect(union).not.toBeNull()
    if (union == null) throw new Error('a single archived day did not union with itself')

    // The UNJUDGED funnel is what the defect shipped: the newest day's raw index, with no
    // retirement applied, printed beside a window that had been judged against today.
    const unjudged = cornerFunnel(
      buildCornerMap({
        approved: single.served.approved,
        index: single.served.index,
        awardSilentCages,
        provenance,
      }),
    )
    const demand = openDemand(union.index, { day: judgedOn, basis: 'an independent recompute' })
    const judged = cornerFunnel(
      buildCornerMap({ approved: union.approved, index: demand.index, awardSilentCages, provenance }),
    )
    return { unjudged, judged, closedByThen: demand.closedExcluded }
  }

  it('the newest-day funnel is the same builder over that day, not a second definition', { timeout: 180_000 }, () => {
    const judgedOn = served().cornerMap.coverage.excludedFromDemand?.asOf
    expect(judgedOn).toBeTruthy()
    if (!judgedOn) return
    expect(served().newestDayFunnel).toEqual(recomputeNewestDayFunnel(judgedOn).judged)
  })

  /*
   * =======================================================================================
   * THE CONTROL FOR THE UNJUDGED COMPARISON (defect 1 of the second review round)
   * =======================================================================================
   * The window funnel was narrowed by `openDemand` against today while the newest-day funnel
   * beside it was built over that day's RAW index with no retirement judgement at all, and the
   * two were printed side by side under a sentence claiming they came from the identical
   * computation. MEASURED on this archive through `buildAllDatasets` at three pinned clocks:
   * 273 window candidates against an unjudged 18 on 2026-08-18, 11 against 18 on 2026-08-25,
   * and 0 against 18 on 2026-09-01. So a board reading "0 candidate corners" sat beside a claim
   * that the thin single day held 18.
   *
   * This test pins the clock ONE WEEK past the newest archived capture, which is the state the
   * whole window repair exists to make visible, and demands that BOTH sides moved. Reverting
   * `buildWindowedDatasets` to `buildCornerMap({ approved: feed.approved, index: feed.index })`
   * turns it red at the first assertion.
   */
  it('judges the newest-day comparison against the SAME day as the window beside it', { timeout: 180_000 }, () => {
    const plusSeven = addDays(window.newestDay, 7)
    const late = buildAllDatasets(undefined, SEED_PATHS, fixedClock(noonEastern(plusSeven)))
    expect(late.cornerMap.coverage.excludedFromDemand?.asOf).toBe(plusSeven)

    const { unjudged, judged, closedByThen } = recomputeNewestDayFunnel(plusSeven)

    // The control has to have something to measure. If nothing the newest capture published had
    // closed within a week, the comparison below would pass without exercising anything, and
    // this assertion says so loudly rather than reporting a green. Measured on this archive:
    // 244 of the newest day's 277 stock numbers had closed by then.
    expect(closedByThen).toBeGreaterThan(0)
    expect(judged).not.toEqual(unjudged)

    // THE ASSERTION THAT FAILS ON REVERT. The served comparison equals the JUDGED recompute,
    // never the unjudged one the defect shipped.
    expect(late.newestDayFunnel).toEqual(judged)
    expect(late.newestDayFunnel).not.toEqual(unjudged)
    expect(late.newestDayFunnel?.candidateCorners).toBeLessThan(unjudged.candidateCorners)

    // And the sentence that ships names the one day both sides were judged against, so a reader
    // cannot take the pair as two numbers on two bases.
    expect(late.cornerMap.coverage.statement).toContain(`judged against the same ${plusSeven}`)
  })

  it('a reference day past every close date empties BOTH sides, not just the window', { timeout: 180_000 }, () => {
    // The strongest form of the same control: no requirement in this archive can still be open
    // in 2031, so an honest comparison is zero on both sides. Under the defect the newest-day
    // funnel stays at whatever the raw index held, printed beside a board of zero rows.
    const late = buildAllDatasets(undefined, SEED_PATHS, fixedClock(noonEastern('2031-01-01')))
    expect(late.cornerMap.summary.candidateCorners).toBe(0)
    expect(late.newestDayFunnel).toEqual({
      withDemandAndSource: 0,
      soleSourcedWithDemand: 0,
      candidateCorners: 0,
    })
  })

  it('puts no closed requirement on the board, and counts what it excluded', () => {
    for (const row of served().cornerMap.rows) expect(row.demand?.lifecycle).toBe('open')

    const excluded = served().cornerMap.coverage.excludedFromDemand
    expect(excluded).not.toBeNull()
    if (!excluded) return
    // Nonzero, or this assertion passes by the filter never having anything to do. Measured on
    // the twenty days ending 2026-08-14: 14,539 of 29,159 had already closed.
    expect(excluded.closed).toBeGreaterThan(0)

    // The exclusion accounts for the whole window: nothing is dropped without being counted.
    const demand = openDemand(window.index, { day: excluded.asOf, basis: excluded.asOfBasis })
    expect(demand.index.rows.length + demand.closedExcluded + demand.undatedExcluded).toBe(
      window.index.rows.length,
    )
    expect(demand.closedExcluded).toBe(excluded.closed)
    expect(demand.undatedExcluded).toBe(excluded.undated)
  })

  /*
   * =======================================================================================
   * THE CONTROL FOR THE STALENESS DEFECT (defects 1 and 2, one bug seen from two sides)
   * =======================================================================================
   * The board judged retirement against the newest ARCHIVED day, so every morning the capture
   * did not run it served solicitations whose government-published return date had already
   * gone, under a header reading "under open DLA demand". MEASURED on this machine 2026-08-18
   * against an archive whose newest day was 2026-08-14: 5,122 of 10,488 served rows, 48.8%,
   * had already closed. On the pre-window single-day board the same measurement was 3 of 186.
   *
   * The two tests below are written to fire on a FRESH archive as well as a stale one. The
   * first would pass vacuously on the morning a capture lands, when today and the newest
   * archived day are the same string, so the second pins the clock and demands that the board
   * actually move: that one goes red whatever state the archive is in.
   */
  it('judges retirement against the day it is computed on, and says which day that was', () => {
    const excluded = served().cornerMap.coverage.excludedFromDemand
    expect(excluded).not.toBeNull()
    if (!excluded) return

    const today = measureFeedFreshness(window.newestDay, systemClock.now()).measuredOn
    expect(excluded.asOf).toBe(today)
    // The basis is not decoration: the day is only readable beside what the day IS.
    expect(excluded.asOfBasis).toContain('the day this was computed')
    if (today !== window.newestDay) expect(excluded.asOfBasis).toContain(window.newestDay)
    expect(excluded.statement).toContain(`as of ${today}`)

    // NOT ONE ROW ON THE BOARD MAY HAVE CLOSED. This is the assertion the defect failed:
    // before the fix, 48.8% of these rows carried a close date earlier than this string.
    let expired = 0
    for (const row of served().cornerMap.rows) {
      const closeDate = row.demand?.closeDate
      if (closeDate != null && closeDate < today) expired += 1
      expect(row.demand?.asOf).toBe(today)
    }
    expect(expired).toBe(0)
  })

  it('the reference day is a real input: pinning the clock moves the board', { timeout: 180_000 }, () => {
    // Judged from inside the window's own span, before most of the archive could have closed.
    const early = buildAllDatasets(undefined, SEED_PATHS, fixedClock(noonEastern(window.oldestDay)))
    // Judged long after every return date this archive carries. An archive of closed
    // solicitations is not a board, and the honest answer is nothing at all.
    const late = buildAllDatasets(undefined, SEED_PATHS, fixedClock(noonEastern('2031-01-01')))

    expect(early.cornerMap.coverage.excludedFromDemand?.asOf).toBe(window.oldestDay)
    expect(late.cornerMap.coverage.excludedFromDemand?.asOf).toBe('2031-01-01')

    // Strictly monotone: later reference day, never more open demand, and here strictly less.
    expect(early.cornerMap.rows.length).toBeGreaterThan(late.cornerMap.rows.length)
    expect(late.cornerMap.rows).toHaveLength(0)
    expect(late.cornerMap.summary.candidateCorners).toBe(0)
    // Everything the window holds is accounted for as excluded rather than quietly missing.
    expect(late.cornerMap.coverage.excludedFromDemand?.closed).toBe(
      window.index.rows.length - (late.cornerMap.coverage.excludedFromDemand?.undated ?? 0),
    )
  })

  it('every row cites the archived government file its own day published', () => {
    const days = new Set(served().window?.daysIncluded ?? [])
    let missing = 0
    const cited = new Set<string>()
    for (const row of served().cornerMap.rows) {
      const source = row.demand?.source
      if (source == null) {
        missing += 1
        continue
      }
      cited.add(source.feedDay)
      expect(days.has(source.feedDay)).toBe(true)
      expect(source.archiveStorageKey).toContain(source.feedDay)
      expect(source.indexStorageKey).toContain(source.feedDay)
    }
    // Not one row on the board may be unable to name its source.
    expect(missing).toBe(0)
    // And the board must genuinely draw on more than one capture, or the union is a relabelling
    // of a single day.
    expect(cited.size).toBeGreaterThan(1)
  })

  it('the hash a row cites still matches the bytes on disk for that row\'s own day', () => {
    // The strongest available form of "provenance survived the union": take the row whose
    // demand came from the OLDEST cited day, not the newest, and hash the file it names.
    const root = discoverFeedDays().root
    const withSource = served().cornerMap.rows.filter((r) => r.demand?.source.archiveSha256 != null)
    expect(withSource.length).toBeGreaterThan(0)

    const oldest = withSource.reduce((a, b) =>
      (a.demand?.source.feedDay ?? '') <= (b.demand?.source.feedDay ?? '') ? a : b,
    )
    const source = oldest.demand?.source
    expect(source).toBeDefined()
    if (!source) return

    const onDisk = createHash('sha256')
      .update(readFileSync(join(root, source.archiveStorageKey)))
      .digest('hex')
    expect(onDisk).toBe(source.archiveSha256)

    // And that day is NOT the day the map header cites, so this really is per-row provenance
    // rather than the map's own hash copied onto every row.
    expect(source.feedDay).not.toBe(served().cornerMap.provenance.feedDay)
    expect(source.archiveSha256).not.toBe(served().cornerMap.provenance.sourceArchiveSha256)
  })

  it('discloses whether the newest day is thin against the window\'s own mean', () => {
    const coverage = served().cornerMap.coverage.window
    expect(coverage).not.toBeNull()
    if (!coverage) return
    expect(coverage.indexRowsByDay).toHaveLength(coverage.dayCount)
    expect(coverage.meanIndexRowsPerDay).toBeGreaterThan(0)
    // The flag must agree with the arithmetic it claims to summarise.
    expect(coverage.newestDayBelowMean).toBe(coverage.newestDayIndexRows < coverage.meanIndexRowsPerDay)
    expect(coverage.statement).toContain(coverage.lastDay)
  })

  /*
   * =======================================================================================
   * THE CONTROL FOR THE FLIGHT PAYLOAD (defect 3)
   * =======================================================================================
   * The page hands its rows to a "use client" grid on a force-dynamic route, so every row is
   * serialised into the RSC payload on every visit. MEASURED before the bound: 25.98MB per
   * visit over 10,488 rows, against 0.342MB over 186 before the window was served, on a page
   * whose own view model was written to kill a 26MB payload once already.
   *
   * Asserted as a RATIO as well as an absolute, so the test keeps meaning as the archive grows
   * and does not quietly pass on a day the board happens to be small.
   */
  it('bounds what crosses the wire to the grid, and keeps every candidate on it', { timeout: 180_000 }, () => {
    const view = buildMonopolyView()
    const bound = boundRowsForWire(view.rows, GRID_ROW_BUDGET)

    expect(bound.shipped.length).toBeLessThanOrEqual(GRID_ROW_BUDGET)
    // The totals are the MAP's, not the slice's. If these were counted off `shipped` the grid
    // would print a page-sized number under a map-shaped label.
    expect(bound.totals.all).toBe(view.rows.length)
    expect(bound.totals.candidate).toBe(view.summary.candidateCorners)
    expect(bound.totals.sole).toBe(view.summary.soleSourcedWithDemand)

    // Nothing was truncated out of the tab this page opens on.
    const shippedCandidates = bound.shipped.filter(isCandidateCorner).length
    expect(shippedCandidates).toBe(Math.min(bound.totals.candidate, GRID_ROW_BUDGET))

    const allBytes = JSON.stringify(view.rows).length
    const shippedBytes = JSON.stringify(bound.shipped).length
    // There has to be something to bound, or this test passes by measuring nothing.
    expect(view.rows.length).toBeGreaterThan(GRID_ROW_BUDGET * 2)
    expect(shippedBytes).toBeLessThan(allBytes / 3)
    // The absolute ceiling. The view rows alone measured 11.80MB unbounded on this archive;
    // bounded they measure well under a megabyte before the page's own five joined fields.
    expect(shippedBytes).toBeLessThan(4_000_000)
  })

  /*
   * =======================================================================================
   * THE CONTROL FOR THE ATTRIBUTION (defect 4)
   * =======================================================================================
   * The truth strip printed "Counted from <one archive key> sha256 <12 chars>" beside counts
   * taken across the whole window. MEASURED: 184 of the 10,488 counted rows, 1.8%, came from
   * that file. The sentence was true before demand widened and false after it.
   *
   * The first half below is a real measurement of that misattribution. The second half is a
   * SOURCE assertion and is labelled as one: this repository has no React render harness, so
   * there is no way to execute the page's JSX in a test. A source assertion cannot see runtime
   * and is not evidence that the page renders correctly; it is evidence that the specific
   * sentence which was measured false is no longer written in the file.
   */
  it('does not attribute a window-wide count to one archived capture', { timeout: 180_000 }, () => {
    const view = buildMonopolyView()
    const newestKey = view.provenance.sourceArchiveKey
    const fromNewest = view.rows.filter((r) => r.demand?.source.archiveStorageKey === newestKey).length
    const citedDays = new Set(view.rows.map((r) => r.demand?.source.feedDay))

    // The measurement that makes the old sentence false: the newest capture is a small
    // minority of what is counted, and the rows cite many other files.
    expect(citedDays.size).toBeGreaterThan(1)
    expect(fromNewest).toBeLessThan(view.rows.length / 2)

    // The basis sentence the page now prints, from ONE definition in lib/intelligence/corner.ts.
    const statement = view.coverage.statement
    expect(statement).toContain(`${view.coverage.dayCount} archived feed days`)
    expect(statement).toContain(view.coverage.firstDay)
    expect(statement).toContain(view.coverage.lastDay)
    expect(statement).toContain('excluded from demand as of')
    expect(statement).toContain('newest archived day alone')
    expect(statement).not.toContain(newestKey)

    // ---- source assertion, not a render. See the block comment above. ----
    const page = readFileSync(join(process.cwd(), 'app/(app)/monopoly/page.tsx'), 'utf8')
    expect(page).toContain('{coverage.statement}')
    // The exact misattributing line that measured false: the archive key labelled as the thing
    // every count was "Counted from".
    expect(page).not.toContain('Counted from{" "}')
    expect(page).not.toContain('feed day {provenance.feedDay}')
    // Both candidate numbers on the screen, never one replacing the other.
    expect(page).toContain('newestDayFunnel.candidateCorners')
    // The bound is actually applied by the page, with the totals passed through.
    expect(page).toContain('boundRowsForWire(baseRows, GRID_ROW_BUDGET)')
    expect(page).toContain('totals={gridTotals}')
  })

  /*
   * =======================================================================================
   * THE CONTROL FOR THE UNFOLLOWABLE INSTRUCTION (defect 2 of the second review round)
   * =======================================================================================
   * The truth strip told the operator to open a row to read that row's archived file and its
   * sha256. The expansion rendered neither: `grep -c -e sha256 -e archiveStorageKey
   * -e archiveSha256 -e feedDay -e '\.demand' app/(app)/monopoly/MonopolyGrid.tsx` returned 0.
   * The fields were on the wire and paid for in payload and were never drawn, so a false
   * map-level attribution had been replaced by a false instruction.
   *
   * This runs the real expansion builder over REAL served rows, and specifically over a row
   * whose own capture is NOT the one the map header cites, which is the case the whole per-row
   * provenance exists for.
   */
  it('renders each row its OWN archived file, not the map header\'s', { timeout: 180_000 }, () => {
    const view = buildMonopolyView()
    const mapKey = view.provenance.sourceArchiveKey
    const foreign = view.rows.find(
      (r) => r.demand != null && r.demand.source.archiveStorageKey !== mapKey,
    )
    // There must BE such a row, or the union is a relabelling of one capture and this test
    // would be measuring nothing.
    expect(foreign).toBeDefined()
    if (!foreign?.demand) return

    const text = rowProvenanceEntries(foreign.demand, view.coverage.basis)
      .map((e) => `${e.field}: ${e.value}`)
      .join('\n')

    expect(text).toContain(foreign.demand.source.feedDay)
    expect(text).toContain(foreign.demand.source.archiveStorageKey)
    expect(text).toContain(foreign.demand.source.archiveMember)
    if (foreign.demand.source.archiveSha256 != null) {
      // The WHOLE hash, so it can be checked against the file with `shasum -a 256`.
      expect(text).toContain(foreign.demand.source.archiveSha256)
    }
    // And the map-level key must not have been substituted back in, which is the regression a
    // source grep could never have told apart from the correct render.
    expect(text).not.toContain(mapKey)
    expect(text).not.toContain(view.provenance.sourceArchiveSha256)

    // ---- source assertions, not renders. This repository has no React render harness. ----
    const grid = readFileSync(join(process.cwd(), 'app/(app)/monopoly/MonopolyGrid.tsx'), 'utf8')
    expect(grid).toContain('rowProvenanceEntries(r.demand, basis)')
    const page = readFileSync(join(process.cwd(), 'app/(app)/monopoly/page.tsx'), 'utf8')
    expect(page).toContain('basis={coverage.basis}')
    // The strip may not tell an operator to open a row unless the row carries it. It now names
    // the two headings by the exact labels the expansion renders.
    expect(page).toContain('<b>Feed day</b>')
    expect(page).toContain('<b>Archived file</b>')
  })

  /*
   * =======================================================================================
   * THE CONTROL FOR THE TWO SURFACES OUTSIDE /monopoly (defect 3 of the second review round)
   * =======================================================================================
   * app/(app)/page.tsx printed "Counted from <one archive key> · feed day <one day>" under the
   * window-wide candidate count, and "Built from the real DLA files for feed day <one day>" as
   * the hero lede over the same window numbers. app/(app)/intelligence/page.tsx printed
   * "Intelligence · feed day X" and "The whole candidate book for this feed day" over totals
   * taken across every archived day. MEASURED through the serving path below: the rows behind
   * those counts cite many captures and the named one is a small minority of them.
   *
   * The first half is a measurement. The second half is a SOURCE assertion and is labelled as
   * one: it is evidence that the sentences measured false are no longer written in the files,
   * not evidence about what a browser paints.
   */
  it('does not label a window-wide count on the workspace or the dashboard as one feed day', { timeout: 180_000 }, () => {
    const view = buildMonopolyView()
    const newestKey = view.provenance.sourceArchiveKey
    const fromNewest = view.rows.filter((r) => r.demand?.source.archiveStorageKey === newestKey).length
    const citedDays = new Set(view.rows.map((r) => r.demand?.source.feedDay))
    expect(citedDays.size).toBeGreaterThan(1)
    expect(fromNewest).toBeLessThan(view.rows.length / 2)

    // ---- source assertions, not renders. ----
    const home = readFileSync(join(process.cwd(), 'app/(app)/page.tsx'), 'utf8')
    expect(home).not.toContain('Counted from ${cmProv?.sourceArchiveKey')
    expect(home).not.toContain('Built from the real DLA files for feed day')
    expect(home).not.toContain('workspace ${feedNote}')
    expect(home).toContain('archived feed days')
    expect(home).toContain('with open demand judged against')
    // The score explainer's `asOf` named the build's newest capture for a card that shows ONE
    // row, whose own published line can be weeks older on a windowed board. It names the row's
    // day now, falling back to the build's newest capture only when the row carries none, which
    // is the direction that abstains rather than the one that overstates freshness.
    expect(home).toContain('asOf: topCorner.asOfFeedDay ?? feedDay')

    const intel = readFileSync(join(process.cwd(), 'app/(app)/intelligence/page.tsx'), 'utf8')
    expect(intel).not.toContain('Intelligence · feed day {pf.feedDay}')
    expect(intel).not.toContain('The whole candidate book for this feed day')
    // `pf.coverage.statement` was built for this and rendered on no surface at all.
    expect(intel).toContain('{coverage.statement}')
    expect(intel).toContain('counted across {spanLabel}')
  })

  it('still serves the ONE named day when a caller asks for one', () => {
    // The other half of the contract. A pinned build must not be silently widened into a
    // window, or every suite that pins a measured value to an immutable day starts lying.
    const single = resolveFeedDayInputs(window.newestDay)
    expect(single.ok).toBe(true)
    if (!single.ok) return
    const pinned = buildAllDatasets(single.served)
    expect(pinned.cornerMap.coverage.basis).toBe('single_day')
    expect(pinned.window).toBeNull()
    expect(pinned.newestDayFunnel).toBeNull()
    expect(pinned.cornerMap.rows.length).toBeLessThan(served().cornerMap.rows.length)
  })
})

/**
 * THE ROW'S OWN CITATION, ON AN INPUT WHOSE ANSWER IS KNOWN BEFORE THE FUNCTION RUNS.
 *
 * The archive-backed test above proves the real rows carry their own file. This one settles the
 * three branches the real archive does not currently exercise: a capture the manifest recorded
 * no hash for, and the two completely different meanings of "this row has no feed day of its
 * own". Pure, so it runs in an environment with no data directory at all.
 *
 * The synthetic row's archive key is deliberately unlike any map-level key, so a regression
 * that substitutes the header's key back in cannot pass by coincidence.
 */
describe('the row provenance expansion', () => {
  const MAP_LEVEL_KEY = 'dibbs-rfq-daily/2026-01-09/20260109T000000Z/map-level.zip'
  const row = (over: Partial<CornerDemandProvenance['source']> = {}): CornerDemandProvenance => ({
    source: {
      feedDay: '2026-01-02',
      indexStorageKey: 'dibbs-rfq-daily/2026-01-02/index.txt',
      archiveStorageKey: 'dibbs-rfq-daily/2026-01-02/20260102T000000Z/row-own.zip',
      archiveMember: 'bq260102.txt',
      archiveSha256: 'b'.repeat(64),
      retrievedAt: '2026-01-02T11:00:00Z',
      ...over,
    },
    observedDays: ['2026-01-01', '2026-01-02'],
    observations: 2,
    distinctSolicitations: 1,
    recurring: false,
    closeDate: '2026-02-01',
    lifecycle: 'open',
    asOf: '2026-01-05',
    onNewestDay: true,
    changedFields: [],
  })
  const text = (d: CornerDemandProvenance | null, basis: 'window' | 'single_day') =>
    rowProvenanceEntries(d, basis).map((e) => `${e.field}: ${e.value}`).join('\n')

  it('cites the ROW\'s archived file and its whole hash, never the map header\'s', () => {
    const out = text(row(), 'window')
    expect(out).toContain('dibbs-rfq-daily/2026-01-02/20260102T000000Z/row-own.zip')
    expect(out).toContain('bq260102.txt')
    expect(out).toContain('b'.repeat(64))
    expect(out).toContain('2026-01-02')
    expect(out).not.toContain(MAP_LEVEL_KEY)
    // Both headings the truth strip names by hand must actually be produced here.
    expect(rowProvenanceEntries(row(), 'window').map((e) => e.field)).toEqual([
      'Feed day',
      'Archived file',
    ])
  })

  it('states an unrecorded hash as an absence, never as a value', () => {
    const out = text(row({ archiveSha256: null }), 'window')
    expect(out).toContain('sha256 not recorded in the manifest for this capture')
    expect(out).not.toContain('sha256 null')
    expect(out).not.toContain('sha256 undefined')
    // No hex at all, so nothing on the line can be mistaken for a hash that was checked.
    expect(/\b[0-9a-f]{12,}\b/.test(out)).toBe(false)
  })

  it('gives the two no-feed-day cases their two different answers', () => {
    // One capture: the header IS this row's source, and saying so is honest.
    const single = text(null, 'single_day')
    expect(single).toContain('single archived capture')
    expect(single).toContain('top of the page')

    // Many captures and this row resolved to none of them: a refusal, pointing at the gap the
    // builder already wrote. It must NOT tell the operator the header covers it, because on a
    // window the header names one file out of many.
    const windowed = text(null, 'window')
    expect(windowed).toContain('could not be resolved')
    expect(windowed).toContain('What is not established')
    expect(windowed).not.toContain('top of the page')
    // Never an empty list: a missing citation renders as a stated absence, not as nothing.
    expect(rowProvenanceEntries(null, 'window').length).toBeGreaterThan(0)
    expect(rowProvenanceEntries(null, 'single_day').length).toBeGreaterThan(0)
  })
})

/**
 * THE MEMO KEYS NOW CARRY A DAY, SO THEY HAVE TO DROP YESTERDAY'S BUILD.
 *
 * Judging demand against the day the page is computed on is the fix for defects 1 and 2, and it
 * puts a day into three memo keys. Left unbounded that is a map that grows by one whole corner
 * map every morning a process stays up; one entry serialises to 11.8MB on this archive.
 *
 * Pure, so it runs whether or not the archive is present, on inputs whose answer is known.
 */
describe('the day-keyed caches keep one entry per identity', () => {
  it('drops the previous day for the same identity and keeps every other one', () => {
    const cache = new Map<string, string>()
    cachePerIdentityDay(cache, 'window|A|seeds|2026-08-17', 'monday')
    cachePerIdentityDay(cache, 'window|B|seeds|2026-08-17', 'other archive')
    cachePerIdentityDay(cache, 'day|A|seeds', 'a pinned single day')
    expect([...cache.keys()]).toHaveLength(3)

    cachePerIdentityDay(cache, 'window|A|seeds|2026-08-18', 'tuesday')
    // Monday's build for identity A is gone; identity B and the pinned day are untouched.
    expect(cache.get('window|A|seeds|2026-08-17')).toBeUndefined()
    expect(cache.get('window|A|seeds|2026-08-18')).toBe('tuesday')
    expect(cache.get('window|B|seeds|2026-08-17')).toBe('other archive')
    expect(cache.get('day|A|seeds')).toBe('a pinned single day')
    expect([...cache.keys()]).toHaveLength(3)
  })

  it('refuses to treat a key with no segments as a prefix, which would empty the cache', () => {
    const cache = new Map<string, string>()
    cachePerIdentityDay(cache, 'alpha', 'one')
    cachePerIdentityDay(cache, 'beta', 'two')
    expect([...cache.keys()].sort()).toEqual(['alpha', 'beta'])
  })
})
