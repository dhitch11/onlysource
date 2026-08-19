/**
 * THE SURPLUS ROLLUP AGAINST THE REAL EXPORT. Every number below was measured before the code
 * that produces it was written, and none of them was adjusted afterwards to match an output.
 *
 * ===========================================================================================
 * WHY THIS FILE EXISTS AND WHY IT ASSERTS EXACT COUNTS
 * ===========================================================================================
 * A red badge on a supplier is a claim about a government record. The two ways this feature can
 * be wrong are both silent: it can badge a company that never delivered surplus (a blank read as
 * a flag), or it can badge everyone identically when the underlying evidence ranges from six
 * awards out of six to one out of four thousand. Neither shows up in a type check or a 200.
 *
 * So the population is pinned to the digit. If the export changes, these fail LOUDLY and a human
 * decides whether the new numbers are a better measurement or a parser regression. A rollup test
 * that only asserted internal consistency would have passed just as happily over an index that
 * had silently stopped reading the column at all — which is exactly what happened to this column
 * once already, when a greedy regex in `seed/xlsx.ts` ate 301 of the 318 populated cells and left
 * 17 behind, and nothing anywhere noticed.
 *
 * ===========================================================================================
 * THE SECOND INSTRUMENT
 * ===========================================================================================
 * The census is derived FROM the per-NSN rollups, on purpose, so the headline cannot disagree
 * with the rows. That also means asserting the census against the rollups would be asking one
 * instrument to confirm itself. The `SECOND INSTRUMENT` test therefore re-derives every figure
 * from `summary.awards[]` using raw string equality against 'Yes' — no `readSurplus`, no
 * `rollUpSurplus`, no `latest` — so a defect in the shared reader cannot reproduce itself in the
 * check for it.
 */
import { describe, expect, it } from 'vitest'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildAwardeeClassifierFromLive } from '@/lib/intelligence/suppliers/classify/live'

/**
 * MEASURED 2026-08-18 over the deployed NSN-Now Batch Export (7 distinct workbooks).
 * Two independent probes produced these before any of this code existed.
 */
const M = {
  awardRows: 42_698,
  flaggedRows: 311,
  explicitNoRows: 0,
  nsnsWithAwards: 2_514,
  nsnsFlagged: 186,
  nsnsMixed: 158,
  nsnsLatestFlagged: 73,
  distinctAwardeeCages: 1_680,
  flaggedAwardeeCages: 73,
  /** Awardees whose entire surplus record is ONE award. The reason a ratio had to be exposed. */
  singleAwardDealers: 33,
  occasionalDealers: 1,
  frequentDealers: 11,
  predominantDealers: 28,
} as const

const index = buildNsnAwardIndex()

describe('the surplus rollup over the real NSN-Now export', () => {
  if (!('byNsn' in index)) {
    // The data directory is gitignored and shipped out of band, so a clean checkout legitimately
    // has no export. Named so it can never be mistaken for the real assertions passing.
    it('SKIPPED: the NSN-Now export is absent in this environment, so nothing was measured', () => {
      expect('byNsn' in index).toBe(false)
    })
  } else {
    const census = index.surplusCensus

    it('the census reports the measured population', () => {
      expect(census.totalRows).toBe(M.awardRows)
      expect(census.flaggedRows).toBe(M.flaggedRows)
      expect(census.nsnsWithAwards).toBe(M.nsnsWithAwards)
      expect(census.nsnsFlagged).toBe(M.nsnsFlagged)
      expect(census.nsnsLatestFlagged).toBe(M.nsnsLatestFlagged)
      expect(census.distinctAwardeeCages).toBe(M.distinctAwardeeCages)
      expect(census.flaggedAwardeeCages).toBe(M.flaggedAwardeeCages)
      // The honesty number, to the two decimals a surface would print: 0.73%.
      expect(census.readFraction).not.toBeNull()
      expect(((census.readFraction as number) * 100).toFixed(2)).toBe('0.73')
    })

    it('THE FLAG IS POSITIVE-ONLY: the column has never once said No, so a blank is UNREAD', () => {
      // Not "we chose to treat blanks as unread". The export contains no negative statement at
      // all, so there is nothing for a blank to mean.
      expect(census.observedValues).toEqual(['Yes'])
      expect(census.observedValuesTruncated).toBe(false)
      expect(census.explicitNoRows).toBe(M.explicitNoRows)
      // 42,387 rows the product must never render as "not surplus".
      expect(census.totalRows - census.readRows).toBe(M.awardRows - M.flaggedRows)
    })

    it('SECOND INSTRUMENT: re-derived from awards[] with no rollup and no reader, all figures agree', () => {
      let rows = 0
      let flagged = 0
      let nsnsWithAwards = 0
      let nsnsFlagged = 0
      let nsnsMixed = 0
      let nsnsLatestFlagged = 0
      const cages = new Set<string>()
      const flaggedCages = new Set<string>()
      const rawValues = new Set<string>()

      for (const s of index.byNsn.values()) {
        if (s.awards.length > 0) nsnsWithAwards += 1
        let yes = 0
        let newest: string | null = null
        for (const a of s.awards) {
          rows += 1
          const raw = (a.surplus ?? '').trim()
          if (raw !== '') rawValues.add(raw)
          const cage = (a.cage ?? '').trim().toUpperCase()
          if (cage !== '') cages.add(cage)
          if (raw === 'Yes') {
            yes += 1
            flagged += 1
            if (cage !== '') flaggedCages.add(cage)
          }
          if (a.awardDateIso !== null && (newest === null || a.awardDateIso > newest)) newest = a.awardDateIso
        }
        if (yes > 0) nsnsFlagged += 1
        if (yes > 0 && yes < s.awards.length) nsnsMixed += 1
        if (newest !== null && s.awards.some((a) => a.awardDateIso === newest && (a.surplus ?? '').trim() === 'Yes')) {
          nsnsLatestFlagged += 1
        }
      }

      expect(rows).toBe(M.awardRows)
      expect(flagged).toBe(M.flaggedRows)
      expect(nsnsWithAwards).toBe(M.nsnsWithAwards)
      expect(nsnsFlagged).toBe(M.nsnsFlagged)
      expect(nsnsMixed).toBe(M.nsnsMixed)
      expect(nsnsLatestFlagged).toBe(M.nsnsLatestFlagged)
      expect(cages.size).toBe(M.distinctAwardeeCages)
      expect(flaggedCages.size).toBe(M.flaggedAwardeeCages)
      expect([...rawValues]).toEqual(['Yes'])

      // And the census, built the other way, lands on the same numbers.
      expect(census.totalRows).toBe(rows)
      expect(census.flaggedRows).toBe(flagged)
      expect(census.nsnsFlagged).toBe(nsnsFlagged)
      expect(census.nsnsMixed).toBe(nsnsMixed)
      expect(census.nsnsLatestFlagged).toBe(nsnsLatestFlagged)
      expect(census.flaggedAwardeeCages).toBe(flaggedCages.size)
    })

    it('IT IS PER DELIVERY, NOT PER ITEM: 158 of the 186 flagged stock numbers are MIXED', () => {
      expect(census.nsnsMixed).toBe(M.nsnsMixed)
      // Which is why a stock number can never be badged on its own: on 158 of them, whether the
      // article was surplus depends entirely on WHICH award you are looking at.
      expect(census.nsnsMixed / census.nsnsFlagged).toBeGreaterThan(0.8)
    })

    it('every rollup carries its own denominator, and a no-award stock number reports null', () => {
      let checkedWithAwards = 0
      let checkedWithout = 0
      for (const s of index.byNsn.values()) {
        if (s.awards.length === 0) {
          // Absent history is not a read fraction of zero.
          expect(s.surplus.readFraction).toBeNull()
          expect(s.surplus.latestAwardState).toBeNull()
          expect(s.surplus.flaggedAwards).toBe(0)
          checkedWithout += 1
        } else {
          expect(s.surplus.totalAwards).toBe(s.awards.length)
          expect(s.surplus.readFraction).not.toBeNull()
          expect(s.surplus.flaggedAwards + s.surplus.explicitNoAwards + s.surplus.unreadAwards).toBe(s.awards.length)
          checkedWithAwards += 1
        }
      }
      // A loop that checked nothing would pass every assertion above.
      expect(checkedWithAwards).toBe(M.nsnsWithAwards)
      expect(checkedWithout).toBeGreaterThan(0)
      expect(checkedWithAwards + checkedWithout).toBe(index.byNsn.size)
    })

    it('flaggedCages names only companies that really carried the flag ON THAT stock number', () => {
      let checked = 0
      for (const s of index.byNsn.values()) {
        for (const cage of s.surplus.flaggedCages) {
          const real = s.awards.some(
            (a) => (a.cage ?? '').trim().toUpperCase() === cage && (a.surplus ?? '').trim() === 'Yes',
          )
          expect(real, `${s.nsn} names ${cage} as a surplus awardee`).toBe(true)
          checked += 1
        }
        // And nobody flagged is left out.
        for (const a of s.awards) {
          if ((a.surplus ?? '').trim() !== 'Yes') continue
          const cage = (a.cage ?? '').trim().toUpperCase()
          if (cage === '') continue
          expect(s.surplus.flaggedCages, s.nsn).toContain(cage)
        }
      }
      expect(checked).toBeGreaterThanOrEqual(M.nsnsFlagged)
    })
  }
})

const live = buildAwardeeClassifierFromLive()

describe('the ratio-aware awardee verdict over the real export', () => {
  if (!live.ok) {
    it('SKIPPED: the NSN-Now export is absent in this environment, so nothing was measured', () => {
      expect(live.ok).toBe(false)
    })
  } else {
    const { classifier } = live

    it('the presence rule alone puts 73 companies in one bucket, and it is not one population', () => {
      expect(classifier.coverage.distinctAwardees).toBe(M.distinctAwardeeCages)
      expect(classifier.coverage.surplusDealers).toBe(M.flaggedAwardeeCages)
      expect(classifier.coverage.awardRowsSeen).toBe(M.awardRows)
      expect(classifier.coverage.awardRowsSurplusRead).toBe(M.flaggedRows)
      expect((classifier.coverage.surplusFillRate * 100).toFixed(2)).toBe('0.73')

      const b = classifier.coverage.bands
      expect(b.single_award).toBe(M.singleAwardDealers)
      expect(b.occasional).toBe(M.occasionalDealers)
      expect(b.frequent).toBe(M.frequentDealers)
      expect(b.predominant).toBe(M.predominantDealers)
      // The four flagged bands account for exactly the surplus_dealer population.
      expect(b.single_award + b.occasional + b.frequent + b.predominant).toBe(M.flaggedAwardeeCages)
      // 45% of the badge's population would rest on one award.
      expect(b.single_award / M.flaggedAwardeeCages).toBeGreaterThan(0.4)
    })

    /**
     * The named companies from the measurement. These are real CAGEs in the real export and the
     * numbers are the government's, not ours. They are asserted individually because the whole
     * argument for this change is that these five rows used to be indistinguishable.
     */
    const named = [
      { cage: '6U890', name: 'P & R TRADING INCORPORATED', yes: 6, total: 6, band: 'predominant' },
      { cage: '78286', name: 'SIKORSKY AIRCRAFT CORPORATION', yes: 5, total: 5933, band: 'occasional' },
      { cage: '1CAY9', name: 'ATLANTIC DIVING SUPPLY, INC.', yes: 1, total: 4126, band: 'single_award' },
      { cage: '04MP1', name: 'CUMMINS INC', yes: 1, total: 335, band: 'single_award' },
      { cage: '54X10', name: 'RAYTHEON COMPANY', yes: 1, total: 13, band: 'single_award' },
    ] as const

    it.each(named)('$name: $yes of $total awards, banded $band', ({ cage, name, yes, total, band }) => {
      const v = classifier.classify(cage)
      expect(v, cage).not.toBeNull()
      expect(v!.companyName).toBe(name)
      // The presence rule: all five are surplus_dealer, and that is the defect.
      expect(v!.class).toBe('surplus_dealer')
      expect(v!.measured!.surplusYes).toBe(yes)
      expect(v!.measured!.totalAwards).toBe(total)
      expect(v!.measured!.surplusRatio).toBeCloseTo(yes / total, 10)
      // The repair: the band tells them apart.
      expect(v!.band).toBe(band)
      // And the rendered sentence carries the denominator, so it cannot read as "won 1".
      expect(v!.basis).toContain(`${yes} of ${total}`)
    })

    it('the strongest and the thinnest carry the SAME class and DIFFERENT bands', () => {
      const strong = classifier.classify('6U890')!
      const thin = classifier.classify('1CAY9')!
      expect(strong.class).toBe(thin.class)
      expect(strong.band).not.toBe(thin.band)
      expect(strong.measured!.surplusRatio).toBeGreaterThan(thin.measured!.surplusRatio * 1000)
    })

    it('an unflagged awardee is NOT called a non-surplus firm, and its basis says unread, not no', () => {
      // The classifier and the index are built from the same export, so if one is available the
      // other is. Asserted rather than assumed, so this cannot pass by returning early.
      expect('byNsn' in index).toBe(true)
      if (!('byNsn' in index)) return
      // Any real awardee with award history and no flagged award.
      const unflagged = [...index.byNsn.values()]
        .flatMap((s) => s.awards)
        .map((a) => (a.cage ?? '').trim().toUpperCase())
        .find((c) => c !== '' && classifier.classify(c)?.measured?.surplusYes === 0)
      expect(unflagged, 'expected at least one awardee with no flagged award').toBeTruthy()
      const v = classifier.classify(unflagged as string)!
      expect(v.band).toBe('no_flagged_award')
      expect(v.measured!.surplusYes).toBe(0)
      // The wording DedicatedPullView already uses for the same fact.
      expect(v.basis).toContain('Unread, not no.')
      expect(v.class).not.toBe('surplus_dealer')
    })
  }
})
