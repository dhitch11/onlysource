/**
 * T4 INTELLIGENCE. The datasets, asserted against the REAL files on disk.
 *
 * These are the numbers the screens will render, so they are asserted at their measured
 * values rather than at "greater than zero". If a value moves, that is either a data refresh
 * or a defect, and both deserve a red test rather than a silent pass.
 *
 * The whole block skips, VISIBLY, when the inputs are absent, because a suite that reports
 * success while measuring nothing is the failure mode this estate keeps rediscovering.
 */

import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'

import {
  DATA_PATHS,
  buildAllDatasets,
  buildDistressed,
  buildNoQuoteGoldmine,
  reverseCompetitor,
  checkDataAvailability,
} from '@/lib/intelligence/datasets'
import { readApprovedSourceFile, readDailyIndex, INDEX_ROW_WIDTH } from '@/lib/intelligence/seed/feed'

const inputs = checkDataAvailability()
const ALL_PRESENT = inputs.every((i) => i.present)

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

  /* ------------------------------------------------------------------------------- */
  describe('the daily feed parses at its specified shape', () => {
    it('reads every index row at the specified fixed width', () => {
      const index = readDailyIndex(DATA_PATHS.index)
      // The width assertion is the drift canary. A shape change must be loud, not silent.
      expect(index.offWidthRows).toBe(0)
      expect(index.rows).toHaveLength(3095)
      expect(INDEX_ROW_WIDTH).toBe(140)
    })

    it('inverts the approved-source file into both directions', () => {
      const approved = readApprovedSourceFile(DATA_PATHS.approvedSource)
      expect(approved.byNiin.size).toBe(2141)
      expect(approved.byCage.size).toBe(1680)
      // The inversion is what makes the manufacturer view possible, so assert it is populated.
      const [, firstCageItems] = [...approved.byCage.entries()][0] as [string, Set<string>]
      expect(firstCageItems.size).toBeGreaterThan(0)
    })

    it('counts unparsed lines rather than dropping them silently', () => {
      const approved = readApprovedSourceFile(DATA_PATHS.approvedSource)
      const index = readDailyIndex(DATA_PATHS.index)
      expect(approved.unparsedLines).toBe(14)
      expect(index.unparsedNsn).toBe(9)
    })
  })

  /* ------------------------------------------------------------------------------- */
  describe('the corner map, computed from real government data', () => {
    const d = buildAllDatasets()

    it('finds the candidate corners at their measured count', () => {
      expect(d.cornerMap.summary.soleSourcedWithDemand).toBe(1523)
      expect(d.cornerMap.summary.candidateCorners).toBe(115)
      expect(d.cornerMap.summary.silentApprovedSources).toBe(157)
    })

    it('reports ZERO confirmed corners while the availability leg is unread', () => {
      // The ceiling is structural, not a data accident. A corner is never confirmed off a
      // missing availability read, so this number cannot move until a credential lands.
      expect(d.cornerMap.summary.confirmedCorners).toBe(0)
      for (const row of d.cornerMap.rows) {
        expect(row.availability).toBe('unknown_credential_absent')
        expect(row.legsEstablished).toBeLessThanOrEqual(2)
      }
    })

    it('names its gaps on every row, never empty by omission', () => {
      for (const row of d.cornerMap.rows.slice(0, 50)) {
        expect(row.gaps.length).toBeGreaterThan(0)
        expect(row.gaps.join(' ')).toContain('availability')
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

    it('ranks by legs established rather than by an opaque score', () => {
      const legs = d.cornerMap.rows.map((r) => r.legsEstablished)
      expect([...legs].sort((a, b) => b - a)).toEqual(legs)
    })
  })

  /* ------------------------------------------------------------------------------- */
  describe('the no-quote goldmine splits sourcing from make-side', () => {
    const nq = buildNoQuoteGoldmine()

    it('carries the 839 solicitations the corpus names', () => {
      expect(nq.summary.solicitations).toBe(839)
      expect(nq.summary.availabilityRows).toBe(2439)
    })

    it('splits into holder-exists and nobody-holds-it, and they sum', () => {
      expect(nq.summary.withHolder).toBe(360)
      expect(nq.summary.makeSideOnly).toBe(479)
      expect(nq.summary.withHolder + nq.summary.makeSideOnly).toBe(nq.summary.solicitations)
    })

    it('joins holders on a normalized solicitation number', () => {
      // The two workbooks spell the same solicitation differently, with and without hyphens.
      const withHolders = nq.rows.find((r) => r.holders.length > 0)
      expect(withHolders).toBeDefined()
      expect(withHolders?.holders[0]?.name).toBeTruthy()
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
      const approved = readApprovedSourceFile(DATA_PATHS.approvedSource)
      const result = reverseCompetitor('89YT2', approved)
      // Rural Route 2 is the corpus's named target and it is absent from this one feed day.
      // "No award history is loaded" and "this competitor has no sources" are different
      // answers, and returning an empty list would state the second while meaning the first.
      expect(result.abstained).toBe(true)
      expect(result.abstentionReason).toContain('no approved-source rows')
      expect(result.gaps.join(' ')).toContain('award-history')
    })

    it('returns item-level links with stated granularity when the company is present', () => {
      const approved = readApprovedSourceFile(DATA_PATHS.approvedSource)
      const anyCage = [...approved.byCage.keys()][0] as string
      const result = reverseCompetitor(anyCage, approved)
      expect(result.abstained).toBe(false)
      expect(result.links[0]?.granularity).toBe('item_level')
    })
  })
})
