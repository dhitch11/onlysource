/**
 * H10 / DEFECT 3 — `surplusSupplyOpen` was inverted on the non-competitive branch.
 *
 * The shipped predicate was `competitive || suffix.manufacturing !== 'open'`, which returns
 * FALSE for a sole-source item whose suffix IS open. That made the LEAST restricted items in
 * the corpus render as the MOST restricted, on 14.38% of coded rows, in a favourable-looking
 * sentence an operator would act on.
 *
 * These assertions are written the way the estate's own lesson requires: a flip is verified by
 * what it must NOT touch, and the control cells were chosen from a derivation run BEFORE the
 * fix existed (`scripts/derive-surplus-cells.mts`).
 */
import { describe, it, expect } from 'vitest'
import { AMC, AMSC, AMC_OPEN_TO_DEALERS, readDealerEligibility } from '@/lib/intelligence/codebook'

/** Every AMC the codebook recognises, and every AMSC, so the table cannot be partial. */
const ALL_AMC = Object.values(AMC)
const ALL_AMSC = Object.keys(AMSC)

describe('H10 defect 3: the surplus-supply truth table', () => {
  it('answers OPEN on every determined (AMC, AMSC) pair, including the six cells that were inverted', () => {
    /*
     * THE WHOLE TABLE, not a sample. 6 methods x 20 suffixes = 120 cells, and every cell is
     * asserted. A truth table checked on the cases you thought of is a truth table with a hole
     * in exactly the place you did not think of.
     */
    let determined = 0
    let abstained = 0
    for (const amc of ALL_AMC) {
      for (const amsc of ALL_AMSC) {
        const e = readDealerEligibility(amc, amsc)
        if (amc === AMC.NOT_ESTABLISHED) {
          // The government's own "no method established" code. Abstains, and must keep abstaining.
          abstained += 1
          expect(e.unknown, `AMC ${amc}/${amsc} must abstain`).toBe(true)
          expect(e.surplusSupplyOpen, `AMC ${amc}/${amsc} must not claim open`).toBe(false)
          continue
        }
        determined += 1
        expect(e.unknown, `${amc}/${amsc} should be determined`).toBe(false)
        expect(e.surplusSupplyOpen, `${amc}/${amsc}: surplus supply of the APPROVED ARTICLE is not barred by any acquisition code`).toBe(true)
      }
    }
    expect(determined).toBe(5 * ALL_AMSC.length)
    expect(abstained).toBe(ALL_AMSC.length)
  })

  it('★ the inverted cells: non-competitive method with an OPEN suffix now reads open', () => {
    /*
     * ★ NINE CELLS IN THE TRUTH TABLE, SIX IN THE DATA, AND THE GAP IS THE POINT.
     *
     * The 2026-08-20 record names six cells (3/Z 3/L 4/Z 5/L 5/Z 4/L) because those are the six
     * that OCCUR. The table itself is inverted on nine: {3,4,5} x {G,L,Z}. The missing three all
     * carry suffix G, and they are absent for a documented reason rather than by luck. AMSC G is
     * legal only with AMC 1 or 2 (DLA SAR Guide: "ASMC G will not be evaluated as material in
     * this status is already full and open competition"), so 3/G, 4/G and 5/G do not exist in a
     * well-formed corpus at all.
     *
     * Asserting only the six would have left three real table cells untested on the grounds that
     * today's feed happens not to contain them, which is how a branch nobody can reach survives.
     */
    const OPEN_SUFFIXES = ALL_AMSC.filter((a) => AMSC[a]!.manufacturing === 'open')
    expect(OPEN_SUFFIXES.sort()).toEqual(['G', 'L', 'Z'])
    const NON_COMPETITIVE = ALL_AMC.filter((m) => m !== AMC.NOT_ESTABLISHED && !AMC_OPEN_TO_DEALERS.includes(m))
    expect(NON_COMPETITIVE.sort()).toEqual(['3', '4', '5'])

    const INVERTED: Array<[string, string]> = NON_COMPETITIVE.flatMap((m) => OPEN_SUFFIXES.map((s) => [m, s] as [string, string]))
    expect(INVERTED).toHaveLength(9)
    // The six the record names are a SUBSET of the nine, and the other three are the G column.
    const OBSERVED: Array<[string, string]> = [['3','Z'],['3','L'],['4','Z'],['5','L'],['5','Z'],['4','L']]
    for (const [m, s] of OBSERVED) expect(INVERTED.some(([a, b]) => a === m && b === s)).toBe(true)
    expect(INVERTED.filter(([, s]) => !OBSERVED.some(([, o]) => o === s)).map(([m, s]) => `${m}/${s}`).sort())
      .toEqual(['3/G', '4/G', '5/G'])
    for (const [amc, amsc] of INVERTED) {
      // The precondition that made each one a defect: non-competitive method, open suffix.
      expect(AMC_OPEN_TO_DEALERS.includes(amc)).toBe(false)
      expect(AMSC[amsc]!.manufacturing).toBe('open')
      // The shipped predicate, reproduced here so the test states what it is defending against.
      const shipped = AMC_OPEN_TO_DEALERS.includes(amc) || AMSC[amsc]!.manufacturing !== 'open'
      expect(shipped, `${amc}/${amsc} must be one of the cells that WAS wrong`).toBe(false)
      // And the correction.
      expect(readDealerEligibility(amc, amsc).surplusSupplyOpen).toBe(true)
    }
  })

  it('★ VERIFIED BY WHAT IT MUST NOT TOUCH: no cell outside {3,4,5} x open-suffix changed answer', () => {
    /*
     * The control set. For every OTHER determined cell the shipped predicate already said true,
     * so the fix must be a no-op there. If this ever fails, the flip widened beyond its blast
     * radius, which is risk-ledger row 1.
     */
    let unchanged = 0
    for (const amc of ALL_AMC) {
      if (amc === AMC.NOT_ESTABLISHED) continue
      for (const amsc of ALL_AMSC) {
        const wasInverted = !AMC_OPEN_TO_DEALERS.includes(amc) && AMSC[amsc]!.manufacturing === 'open'
        if (wasInverted) continue
        const shipped = AMC_OPEN_TO_DEALERS.includes(amc) || AMSC[amsc]!.manufacturing !== 'open'
        expect(shipped, `${amc}/${amsc} is a control cell and must have been true before`).toBe(true)
        expect(readDealerEligibility(amc, amsc).surplusSupplyOpen, `${amc}/${amsc} must not have moved`).toBe(shipped)
        unchanged += 1
      }
    }
    // 5 determined methods x every suffix, minus the NINE inverted cells ({3,4,5} x {G,L,Z}).
    const openSuffixCount = ALL_AMSC.filter((a) => AMSC[a]!.manufacturing === 'open').length
    expect(unchanged).toBe(5 * ALL_AMSC.length - 3 * openSuffixCount)
  })

  it('does NOT merge the two questions: manufacturing access still varies cell by cell', () => {
    /*
     * The mechanism this fix must not destroy. Merging two priceless-code predicates destroyed
     * real data once on this estate already, and `surplusSupplyOpen` becoming a constant is
     * exactly the shape that invites someone to delete its sibling next.
     */
    expect(readDealerEligibility('3', 'P').manufacturing).toBe('closed_to_new_manufacturing')
    expect(readDealerEligibility('3', 'Z').manufacturing).toBe('open')
    expect(readDealerEligibility('3', 'C').manufacturing).toBe('source_approval_possible')
    const distinct = new Set(ALL_AMSC.map((a) => readDealerEligibility('3', a).manufacturing))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('an undetermined code still abstains rather than inheriting the new constant', () => {
    // The one honest `false`. If a later edit hoists `true` above this branch, this goes red.
    for (const pair of [[null, null], ['3', null], [null, 'Z'], ['9', 'Z'], ['3', '~'], ['0', 'G']] as const) {
      const e = readDealerEligibility(pair[0], pair[1])
      expect(e.unknown, `${pair[0]}/${pair[1]} must abstain`).toBe(true)
      expect(e.surplusSupplyOpen, `${pair[0]}/${pair[1]} must not claim open`).toBe(false)
    }
  })
})
