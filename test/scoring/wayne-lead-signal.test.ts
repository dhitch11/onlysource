/*
 * WAYNE'S NUMBER ONE SIGNAL, WHICH WAS TAUGHT AND NEVER SCORED.
 *
 * His rubric, recorded verbatim in `_intel/access-and-systems.md`: "Last Supplier was a surplus
 * supplier -> higher win probability", and he says he sorts every match report by previous
 * supplier to find it. A source-fidelity audit of the material he gave us found the served
 * CornerScore ranked sole-source and award-silence instead, which is his SECONDARY idea, and read
 * the surplus flag only in the pricing path. The faithful encoding existed in the scorecard spec
 * and reached no surface. So the board he opens every morning ranked on a thesis he did not name
 * first.
 *
 * THE TWO THINGS THIS FILE PINS, because both fail silently and both fail expensively:
 *   1. THE LEG FIRES ON A MEASUREMENT OR NOT AT ALL. The researcher's supplier book is a PRIOR and
 *      must never score. A book label scoring as a surplus dealer puts the wrong rows at the top
 *      of the one screen he trusts.
 *   2. AN ABSENCE IS NOT EVIDENCE AGAINST A ROW. The government Surplus cell is read on 0.73% of
 *      the award history (311 of 42,698 rows, giving 73 measured dealers of 1,680 awardee CAGEs),
 *      so this leg abstains on almost everything, the abstention NAMES that coverage, and nothing
 *      may present the ranking as a confident classification.
 */
import { describe, expect, it } from 'vitest'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import type { AwardeeVerdict } from '@/lib/intelligence/suppliers/classify'
import type { CornerRow } from '@/lib/intelligence/corner'

const row = { nsn: '5340015541274', soleSource: true, approvedSourceCount: 1, quantity: 10 } as unknown as CornerRow

const measuredDealer: AwardeeVerdict = {
  cage: '89YT2', companyName: 'A SURPLUS SELLER', class: 'surplus_dealer', evidenceState: 'measured',
  basis: 'two awards on file read as surplus material',
  measured: { surplusYes: 2, surplusNo: 1, surplusUnread: 7, totalAwards: 10, distinctNsns: 4, readFraction: 0.3 },
  prior: null,
}
const bookOnly: AwardeeVerdict = {
  cage: '3BQS1', companyName: 'A MANUFACTURER', class: 'manufacturer', evidenceState: 'prior',
  basis: 'the distressed supplier book calls them a manufacturer',
  measured: null, prior: { bookClass: 'manufacturer', holdsInventory: 'yes' },
}
// The field is `evidenceWeight`, not `confidence`. My first version of this test guessed the
// name and read `undefined ?? 0` on both sides, so it compared 0 to 0 and failed for a reason
// that had nothing to do with the code. An instrument that invents a field name measures nothing.
const weight = (l: { evidenceWeight: number }) => l.evidenceWeight

describe("the operator's lead signal reaches the served score", () => {
  it("MEASURED surplus lineage scores, and says so in the operator's own terms", () => {
    const r = scoreCorner(row, null, null, { awardIndexLoaded: true }, measuredDealer)
    expect(r.legs.surplusLineage.state).toBe('MEASURED')
    const reason = r.reasons.find((x) => x.leg === 'surplusLineage')
    expect(reason).toBeDefined()
    expect(reason!.points).toBeGreaterThan(0)
    expect(reason!.calibration).toBe('measured')
    expect(reason!.plain).toContain('surplus dealer')
  })

  it('THE CONTROL: the same row WITHOUT the verdict scores strictly lower, so the leg is load bearing', () => {
    const withSignal = scoreCorner(row, null, null, { awardIndexLoaded: true }, measuredDealer)
    const without = scoreCorner(row, null, null, { awardIndexLoaded: true }, null)
    expect(withSignal.scoreV0).toBeGreaterThan(without.scoreV0)
    expect(without.legs.surplusLineage.state).toBe('UNAVAILABLE')
  })

  it('THE PRIOR NEVER SCORES: a book label contributes nothing and is not called a measurement', () => {
    const r = scoreCorner(row, null, null, { awardIndexLoaded: true }, bookOnly)
    const bare = scoreCorner(row, null, null, { awardIndexLoaded: true }, null)
    expect(r.scoreV0).toBe(bare.scoreV0)
    expect(r.legs.surplusLineage.state).not.toBe('MEASURED')
    expect(r.reasons.find((x) => x.leg === 'surplusLineage')).toBeUndefined()
    expect(r.dataGaps.join(' ')).toContain('context only')
  })

  it('an unread surplus history abstains and NAMES the coverage rather than shrugging', () => {
    const r = scoreCorner(row, null, null, { awardIndexLoaded: true }, null)
    expect(r.legs.surplusLineage.state).toBe('UNAVAILABLE')
    expect(r.dataGaps.join(' ')).toContain('0.73%')
    expect(r.dataGaps.join(' ')).toContain('not evidence against this one')
  })

  it('a verdict claiming measured with ZERO read surplus awards does NOT score (fails toward abstention)', () => {
    const hollow: AwardeeVerdict = {
      ...measuredDealer,
      measured: { surplusYes: 0, surplusNo: 3, surplusUnread: 7, totalAwards: 10, distinctNsns: 4, readFraction: 0.3 },
    }
    const r = scoreCorner(row, null, null, { awardIndexLoaded: true }, hollow)
    const bare = scoreCorner(row, null, null, { awardIndexLoaded: true }, null)
    expect(r.scoreV0).toBe(bare.scoreV0)
    expect(r.legs.surplusLineage.state).not.toBe('MEASURED')
  })

  it("confidence rises with how much of that supplier's history was actually readable", () => {
    const thin = scoreCorner(row, null, null, { awardIndexLoaded: true }, {
      ...measuredDealer,
      measured: { ...measuredDealer.measured!, readFraction: 0.05 },
    })
    const thick = scoreCorner(row, null, null, { awardIndexLoaded: true }, {
      ...measuredDealer,
      measured: { ...measuredDealer.measured!, readFraction: 0.9 },
    })
    expect(weight(thick.legs.surplusLineage)).toBeGreaterThan(weight(thin.legs.surplusLineage))
  })
})
