/**
 * T4 INTELLIGENCE. The datasets, asserted against the REAL files on disk.
 *
 * These are the numbers the screens will render, so they are asserted at their measured
 * values rather than at "greater than zero". If a value moves, that is either a data refresh
 * or a defect, and both deserve a red test rather than a silent pass.
 *
 * The whole block skips, VISIBLY, when the inputs are absent, because a suite that reports
 * success while measuring nothing is the failure mode this estate keeps rediscovering.
 *
 * =========================================================================================
 * WHY THIS FILE NOW HAS TWO KINDS OF TEST (restructured 2026-08-17)
 * =========================================================================================
 * The product stopped serving a hardcoded feed day. `buildAllDatasets()` now resolves the
 * NEWEST complete, byte-re-verified, parse-verified day in the archive, so the counts it
 * produces legitimately change every time the capture cron lands a file. A suite that pinned
 * `2141` against that moving target would go red on a healthy morning, and the only way to
 * keep it green would be to re-pin it daily until somebody weakened it to `toBeGreaterThan`.
 *
 * So the two claims are separated, and both are asserted:
 *
 *   MEASURED VALUES are pinned against ONE IMMUTABLE ARCHIVED DAY, 2026-08-11, resolved
 *   through `resolveFeedDayInputs` — the identical verification the live path runs, just
 *   aimed at a day whose bytes can never change. Every number below is the number the old
 *   suite asserted, reproduced to the unit through the NEW chain (the approved-source member
 *   read out of the archived zip rather than out of a derived file beside it). That equality
 *   is the positive control for the whole refactor: it proves the new chain changed WHICH day
 *   is served and nothing whatsoever about how a day is read.
 *
 *   THE WIRING is asserted against the LIVE resolution, in relationships rather than
 *   literals: that the served day really is the newest complete one, that the pill, the
 *   provenance lines, the corner map, the monopoly view and the Board all name that SAME day,
 *   and that a refused day is carried by name instead of being silently swallowed.
 *
 * ONE ASSERTION COULD NOT BE KEPT AND WAS REPLACED, NOT DELETED. The old
 * "the derived approved-source file still hashes to what came out of the archive" test
 * pinned `DERIVED_SHA256.approvedSource` against `data/archive/derived/.../as260811.txt`.
 * That file is no longer in the serving path at all — the approved-source list is extracted
 * from the archived zip in memory — so the chain it guarded no longer exists to be broken.
 * The claim it was really making (a rendered number traces to a hashed government artifact)
 * is now asserted DIRECTLY and more strongly: the archived zip on disk is hashed here and
 * compared to the hash the map cites, for the served day and for the pinned day.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import {
  buildAllDatasets,
  buildDistressed,
  buildNoQuoteGoldmine,
  reverseCompetitor,
  checkDataAvailability,
} from '@/lib/intelligence/datasets'
import {
  resolveFeedDayInputs,
  resolveServedFeedDay,
  MIN_SERVABLE_INDEX_ROWS,
  type ServedFeedDay,
} from '@/lib/intelligence/feed-day'
import { discoverFeedDays, newestCompleteFeedDay } from '@/lib/ingest/feed-days'
import { buildBoard } from '@/lib/board/build'
import { buildMonopolyView, resetMonopolyViewCache } from '@/lib/intelligence/monopoly-view'
import { INDEX_ROW_WIDTH } from '@/lib/intelligence/seed/feed'
import { parseSolicitation } from '@/lib/intelligence/niin'

const inputs = checkDataAvailability()
const ALL_PRESENT = inputs.every((i) => i.present)

/**
 * The immutable day every measured value below is pinned to. Chosen because it is the day the
 * whole suite was originally calibrated on, so the numbers are comparable across the change.
 */
const PINNED_DAY = '2026-08-11'

describe('intelligence datasets over the real files', () => {
  it('reports which inputs are readable before computing anything', () => {
    expect(inputs).toHaveLength(6)
    for (const i of inputs) expect(typeof i.present).toBe('boolean')
  })

  if (!ALL_PRESENT) {
    it('SKIPPED the dataset assertions because inputs are missing', () => {
      // Named individually so the skip says WHICH file, not merely that something was absent.
      const missing = inputs.filter((i) => !i.present).map((i) => i.path)
      expect(missing.length).toBeGreaterThan(0)
    })
    return
  }

  const pinnedResolution = resolveFeedDayInputs(PINNED_DAY)
  if (!pinnedResolution.ok) {
    it(`SKIPPED the pinned assertions: ${PINNED_DAY} is not servable from this archive`, () => {
      // A loud skip that names the reason. This archive is shipped out of band and a checkout
      // can legitimately hold a different set of days; silently passing would be the defect.
      expect(pinnedResolution.ok).toBe(false)
    })
    return
  }
  const pinned: ServedFeedDay = pinnedResolution.served
  const pinnedDatasets = buildAllDatasets(pinned)

  /* ------------------------------------------------------------------------------- */
  describe('the chain from the rendered number back to a hashed government artifact', () => {
    it('cites an archived zip whose bytes on disk still hash to the value the map prints', () => {
      // The strongest form of the old derived-file check, with the derived file removed from
      // the chain entirely. The map prints a hash; the file that hash names is hashed HERE,
      // from disk, right now. A zip silently swapped, truncated or regenerated from another
      // feed day fails this instead of quietly changing every number on the map.
      const root = discoverFeedDays().root
      const onDisk = createHash('sha256')
        .update(readFileSync(join(root, pinned.archive.storageKey)))
        .digest('hex')
      expect(onDisk).toBe(pinned.archive.sha256)
      expect(pinnedDatasets.cornerMap.provenance.sourceArchiveSha256).toBe(onDisk)
      expect(pinnedDatasets.cornerMap.provenance.sourceArchiveKey).toContain('bq260811.zip')
    })

    it('cites the member INSIDE the archived zip, never a derived file beside it', () => {
      // `derived/` is a convenience tree and nothing about a path there proves where the bytes
      // came from. If the string "derived" ever reappears in a provenance line, a derived file
      // has re-entered the chain and the citation has stopped being a citation.
      const p = pinnedDatasets.cornerMap.provenance
      expect(p.approvedSourceFile).toBe(`${pinned.archive.storageKey}!as260811.txt`)
      expect(p.approvedSourceFile).not.toContain('derived')
      expect(p.indexFile).not.toContain('derived')
    })

    it('carries no wall-clock read in the provenance, so nothing can cross the hydration boundary', () => {
      /*
       * `computedAt` held `new Date().toISOString()` until 2026-08-17. Nothing rendered it, but
       * a wall-clock string riding on a server-rendered object is one toLocale* away from the
       * React #418 class this repo has been burned by three times, and it was wrong on its own
       * terms: the build is memoised, so it named the first request of the process, not "now".
       * The test that matters is DETERMINISM — two builds of the same day must agree — because
       * that is the property a clock read breaks and a stated capture instant does not.
       */
      const stamp = pinnedDatasets.cornerMap.provenance.computedAt
      // Exact, not "contains a date": the value is a pure function of the archived capture
      // record, so any clock read reintroduced here fails immediately rather than drifting.
      expect(stamp).toBe(`archive capture ${pinned.archive.retrievedAt}`)

      // And it tracks the DATA, not one shared clock read: a different served day must carry a
      // different stamp. Without this, a constant would pass the equality above.
      const live = buildAllDatasets()
      if (live.feed.feedDay !== PINNED_DAY) {
        expect(live.cornerMap.provenance.computedAt).not.toBe(stamp)
        expect(live.cornerMap.provenance.computedAt).toBe(
          `archive capture ${live.feed.archive.retrievedAt}`,
        )
      }
    })
  })

  describe('the daily feed parses at its specified shape', () => {
    it('reads every index row at the specified fixed width', () => {
      // The width assertion is the drift canary. A shape change must be loud, not silent.
      expect(pinned.index.offWidthRows).toBe(0)
      expect(pinned.index.rows).toHaveLength(3095)
      expect(INDEX_ROW_WIDTH).toBe(140)
    })

    it('inverts the approved-source file into both directions', () => {
      expect(pinned.approved.byNiin.size).toBe(2141)
      expect(pinned.approved.byCage.size).toBe(1680)
      // The inversion is what makes the manufacturer view possible, so assert it is populated.
      const [, firstCageItems] = [...pinned.approved.byCage.entries()][0] as [string, Set<string>]
      expect(firstCageItems.size).toBeGreaterThan(0)
    })

    it('counts unparsed lines rather than dropping them silently', () => {
      expect(pinned.approved.unparsedLines).toBe(14)
      expect(pinned.index.unparsedNsn).toBe(9)
    })
  })

  /* ------------------------------------------------------------------------------- */
  describe('the corner map, computed from real government data', () => {
    const d = pinnedDatasets

    it('finds the candidate corners at their measured count', () => {
      expect(d.cornerMap.rows).toHaveLength(2141)
      expect(d.cornerMap.summary.soleSourcedWithDemand).toBe(1523)
      expect(d.cornerMap.summary.candidateCorners).toBe(115)
      expect(d.cornerMap.summary.silentApprovedSources).toBe(157)
    })

    it('reports ZERO confirmed corners even though availability is now read', () => {
      /*
       * The ceiling is structural, not a data accident, and it SURVIVED the 2026-08-16 change
       * that started reading the availability leg. That is the point of this test now.
       *
       * NSN-Now availability is SELF-REPORTED by the listing company. Reading it answers "who
       * says they have it"; it does not answer "is it on a shelf". So a row can be
       * `listed_self_reported` and the confirmed count still must not move, because promoting a
       * self-report to a confirmation is exactly the fabrication this file exists to prevent.
       */
      expect(d.cornerMap.summary.confirmedCorners).toBe(0)
      for (const row of d.cornerMap.rows) {
        expect(['listed_self_reported', 'unknown_credential_absent']).toContain(row.availability)
        // Availability is deliberately kept OUT of legsEstablished, because that counter orders
        // the map and "we know the answer" is not "the answer is favourable".
        expect(row.legsEstablished).toBeLessThanOrEqual(2)
        // A read row carries its counts; an unread row carries null, never a zero.
        if (row.availability === 'listed_self_reported') {
          expect(row.availabilityHolders).toBeGreaterThan(0)
          expect(row.availabilityUnits).not.toBeNull()
        } else {
          expect(row.availabilityHolders).toBeNull()
          expect(row.availabilityUnits).toBeNull()
        }
      }
    })

    it('actually reads availability for a substantial share of rows, so the wiring is not inert', () => {
      // The positive control for the change. Before 2026-08-16 this was 0 on every row while the
      // Availability sheet sat in the same workbook as the award history.
      const read = d.cornerMap.rows.filter((r) => r.availability === 'listed_self_reported')
      expect(read.length).toBeGreaterThan(500)
      expect(read.length).toBeLessThan(d.cornerMap.rows.length)
    })

    it('names its gaps on every row, never empty by omission', () => {
      for (const row of d.cornerMap.rows.slice(0, 50)) {
        expect(row.gaps.length).toBeGreaterThan(0)
      }
    })

    it('names the availability gap on rows where it is genuinely absent, and not on rows where it is read', () => {
      const unread = d.cornerMap.rows.filter((r) => r.availability === 'unknown_credential_absent')
      const read = d.cornerMap.rows.filter((r) => r.availability === 'listed_self_reported')
      expect(unread.length).toBeGreaterThan(0)
      expect(read.length).toBeGreaterThan(0)
      for (const row of unread.slice(0, 30)) {
        expect(row.gaps.join(' ')).toContain('availability')
      }
      for (const row of read.slice(0, 30)) {
        // A gap that has been closed must stop being reported as a gap, or the operator learns
        // to ignore the gap list entirely.
        expect(row.gaps.join(' ')).not.toContain('availability')
      }
    })

    it('never labels an award-silent source as dead', () => {
      const silent = d.cornerMap.rows.flatMap((r) => r.signals).filter((s) => s.kind === 'award_silent')
      expect(silent.length).toBeGreaterThan(0)
      for (const s of silent) {
        expect(s.kind === 'award_silent' && s.measurement).toContain('no recorded prime award activity')
        expect(JSON.stringify(s).toLowerCase()).not.toContain('dead')
        expect(JSON.stringify(s).toLowerCase()).not.toContain('distressed')
      }
    })

    it('reads the ninth character on real solicitation numbers', () => {
      const withRead = d.cornerMap.rows.filter((r) => r.automatedSolicitation !== null)
      expect(withRead.length).toBe(d.cornerMap.rows.length)
    })

    it('never treats an ABSENT approved source as a monopoly', () => {
      // @T2-DATA's caution, turned into a standing check. On the real feed day, requirement
      // stock numbers carry no approved source at all. That is "we do not know who is
      // approved", NOT "nobody is approved", and reading it as the second manufactures a
      // corner out of a coverage gap. Measured: those stock numbers appear ZERO times in the
      // map, because the map is built by walking the approved-source mapping rather than the
      // requirement list.
      const withoutSource = [...pinned.index.byNiin.keys()].filter(
        (n) => !pinned.approved.byNiin.has(n),
      )
      expect(withoutSource.length).toBeGreaterThan(0) // positive control: the case exists
      const inMap = new Set(d.cornerMap.rows.map((r) => r.niin))
      expect(withoutSource.filter((n) => inMap.has(n))).toHaveLength(0)
    })

    it('agrees with the measured ninth character on every real solicitation', () => {
      // T2 measured position 8 across the real feed and found only Q, T and U. This asserts
      // this lane's reading agrees with the bytes rather than with the corpus description.
      for (const row of pinned.index.rows) {
        const ninth = row.solicitation.replace(/[-\s]/g, '').toUpperCase().charAt(8)
        const parsed = parseSolicitation(row.solicitation)
        expect(parsed?.automated).toBe(ninth === 'T' || ninth === 'U')
      }
    })

    it('ranks by legs established rather than by an opaque score', () => {
      const legs = d.cornerMap.rows.map((r) => r.legsEstablished)
      expect([...legs].sort((a, b) => b - a)).toEqual(legs)
    })
  })

  /* ------------------------------------------------------------------------------- */
  /* THE SERVED DAY. One resolution, and every surface reading it.                     */
  /* ------------------------------------------------------------------------------- */
  describe('the served feed day is discovered, and every surface names the same one', () => {
    const resolution = resolveServedFeedDay()

    it('serves a real day rather than throwing or falling back to a literal', () => {
      expect(resolution.ok).toBe(true)
    })

    it('serves the NEWEST complete day when nothing newer was refused', () => {
      if (!resolution.ok) return
      const discovery = discoverFeedDays()
      const newest = newestCompleteFeedDay(discovery)
      expect(newest).not.toBeNull()
      if (resolution.served.skipped.length === 0) {
        // Nothing was refused, so the served day MUST be the newest one held. This is the
        // assertion that catches "wired but never fed": a resolution that quietly kept
        // serving an older day would pass every other test in this file.
        expect(resolution.served.feedDay).toBe(newest?.logicalDate)
      } else {
        // Something newer WAS refused. Then every refused day must be strictly newer than the
        // one being served, and must carry a reason. Silence here is the failure mode.
        for (const s of resolution.served.skipped) {
          expect(s.feedDay > resolution.served.feedDay).toBe(true)
          expect(s.reason.length).toBeGreaterThan(10)
        }
      }
    })

    it('the pill day, the provenance day, the map, the view and the Board all name ONE day', () => {
      if (!resolution.ok) return
      const served = resolution.served.feedDay
      const live = buildAllDatasets()

      // The chrome pill is fed from exactly this value in app/(app)/layout.tsx.
      expect(live.cornerMap.provenance.feedDay).toBe(served)
      expect(live.feed.feedDay).toBe(served)

      resetMonopolyViewCache()
      const view = buildMonopolyView()
      expect(view.feedDay).toBe(served)
      expect(view.feed.feedDay).toBe(served)
      expect(view.provenance.feedDay).toBe(served)
      expect(view.rows).toHaveLength(live.cornerMap.rows.length)

      const board = buildBoard()
      expect(board.ok).toBe(true)
      if (board.ok) {
        expect(board.feedDay).toBe(served)
        // The Board counts the INDEX; the map counts the approved-source join. Different
        // numbers, same file: the board's published count must equal the served index rows.
        expect(board.counts.published).toBe(resolution.served.index.rows.length)
        expect(board.heldButNotServable).toEqual(resolution.served.skipped)
      }
    })

    it('serves a day the archive can prove, and refuses one it cannot', () => {
      if (!resolution.ok) return
      // Positive control on the floor: the served index really does clear it.
      expect(resolution.served.index.rows.length).toBeGreaterThanOrEqual(MIN_SERVABLE_INDEX_ROWS)

      // NEGATIVE PATH, which is where this class of instrument usually fails open. A day the
      // archive does not hold must come back as a stated refusal with a named reason, never
      // as an empty success and never as a throw.
      const absent = resolveFeedDayInputs('2001-01-01')
      expect(absent.ok).toBe(false)
      if (!absent.ok) expect(absent.reason).toContain('2001-01-01')
    })

    it('excludes a capture that fails re-verification rather than serving it', () => {
      // The archive holds, under the same (day, filename) as the real 439,490-byte index for
      // 2026-08-11, a 141-byte truncation fixture. "Newest capture wins" would serve it. This
      // asserts the exclusion is real and named, and that the pinned day still parses at full
      // size, so the gate is doing work rather than existing.
      const discovery = discoverFeedDays()
      const truncation = discovery.excluded.filter((e) => e.storageKey.includes('in260811.txt'))
      expect(truncation.length).toBeGreaterThan(0)
      expect(truncation[0]?.reason).toContain('content gate')
      expect(pinned.index.rows.length).toBe(3095)
    })

    it('the availability report names the day actually chosen, not a pinned one', () => {
      if (!resolution.ok) return
      const feedEntries = checkDataAvailability().slice(0, 2)
      expect(feedEntries[0]?.path).toBe(resolution.served.indexPath)
      expect(feedEntries[0]?.path).toContain(resolution.served.feedDay)
      expect(feedEntries[1]?.path).toBe(
        `${resolution.served.archive.storageKey}!${resolution.served.archive.member}`,
      )
    })
  })

  /* ------------------------------------------------------------------------------- */
  describe('the no-quote goldmine splits sourcing from make-side', () => {
    const nq = buildNoQuoteGoldmine()

    it('carries the 839 line items the corpus names', () => {
      expect(nq.summary.lineItems).toBe(839)
      expect(nq.summary.availabilityRows).toBe(2439)
    })

    /*
     * ★ THE TWO NUMBERS MUST STAY DIFFERENT, AND THAT IS THE POINT OF THIS TEST.
     *
     * `lineItems` was called `solicitations` and it is not one. A row is one stock number on
     * one dated version of one solicitation, so an amendment carrying `***REVISED***` and the
     * row it supersedes are two line items of a single solicitation. Measured on this corpus:
     * 839 rows, 803 distinct solicitation numbers, a gap of 36.
     *
     * This asserts the GAP, not just the two values, because the failure worth catching is the
     * two collapsing back into one. If a future change makes `distinctSolicitations` equal
     * `lineItems`, either the corpus genuinely lost every amendment or somebody wired the field
     * back to `rows.length`, and both need a human to look.
     */
    it('counts distinct solicitations apart from line items, and they do not agree', () => {
      expect(nq.summary.distinctSolicitations).toBe(803)
      expect(nq.summary.distinctSolicitations).toBeLessThan(nq.summary.lineItems)
      expect(nq.summary.lineItems - nq.summary.distinctSolicitations).toBe(36)
    })

    it('splits into holder-exists and nobody-holds-it, and they sum to the LINE ITEMS', () => {
      expect(nq.summary.withHolder).toBe(360)
      expect(nq.summary.makeSideOnly).toBe(479)
      // Deliberately the line-item count: the split is per row, so it cannot sum to a count of
      // solicitations. Asserting it against `distinctSolicitations` would be the same category
      // error this rename exists to remove.
      expect(nq.summary.withHolder + nq.summary.makeSideOnly).toBe(nq.summary.lineItems)
    })

    it('joins holders on a normalized solicitation number', () => {
      // The two workbooks spell the same solicitation differently, with and without hyphens.
      const withHolders = nq.rows.find((r) => r.holders.length > 0)
      expect(withHolders).toBeDefined()
      expect(withHolders?.holders[0]?.name).toBeTruthy()
    })

    it('does not move with the feed day, because it is a seed export and not a daily feed', () => {
      // The goldmine reads the four pinned seed workbooks. If a feed-day change ever moved
      // these counts, something has started reading the daily feed by accident.
      expect(buildAllDatasets().noQuote.summary).toEqual(nq.summary)
      expect(pinnedDatasets.noQuote.summary).toEqual(nq.summary)
    })
  })

  /* ------------------------------------------------------------------------------- */
  describe('the distressed candidate list, and the column that lies', () => {
    const dz = buildDistressed()

    it('carries both exports and reports who has no enrichment', () => {
      expect(dz.summary.candidates).toBe(3483)
      expect(dz.summary.enriched).toBe(3471)
      expect(dz.summary.withoutEnrichment).toBe(12)
    })

    it('distinguishes an unwritten column from a measured zero', () => {
      // MEASURED: the "Currently in Business" header exists and not one of the 3,471 rows
      // carries a value. Reported as a zero denominator, a signal built on it would read as a
      // permanent silent "not trading" for every firm in the file.
      expect(dz.summary.inBusinessColumnPopulated).toBe(0)
      expect(dz.summary.statedStillInBusiness).toBe(0)
      expect(dz.gaps.join(' ')).toContain('entirely unpopulated')
    })

    it('names the tier inputs it does not have rather than tiering anyway', () => {
      expect(dz.gaps.join(' ')).toContain('registration status')
    })

    it('never emits the word distressed as a property of a firm', () => {
      for (const f of dz.firms.slice(0, 200)) {
        expect(JSON.stringify(f).toLowerCase()).not.toContain('distressed')
      }
    })
  })

  /* ------------------------------------------------------------------------------- */
  describe('reverse the competitor abstains honestly', () => {
    it('abstains on the named competitor rather than returning an empty finding', () => {
      const result = reverseCompetitor('89YT2', pinned.approved)
      // Rural Route 2 is the corpus's named target and it is absent from this one feed day.
      // "No award history is loaded" and "this competitor has no sources" are different
      // answers, and returning an empty list would state the second while meaning the first.
      expect(result.abstained).toBe(true)
      expect(result.abstentionReason).toContain('no approved-source rows')
      expect(result.gaps.join(' ')).toContain('award-history')
    })

    it('returns item-level links with stated granularity when the company is present', () => {
      const anyCage = [...pinned.approved.byCage.keys()][0] as string
      const result = reverseCompetitor(anyCage, pinned.approved)
      expect(result.abstained).toBe(false)
      expect(result.links[0]?.granularity).toBe('item_level')
    })
  })
})
