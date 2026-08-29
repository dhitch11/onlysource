/**
 * THE ANCHOR'S BASE PRICE, WHICH IS THE ONE INPUT THE WHOLE DOCTRINE RESTS ON.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT WENT WRONG, MEASURED ON THE LIVE FEED RATHER THAN IMAGINED
 * ---------------------------------------------------------------------------------------
 * The awards module derives a per-unit price as Final Price divided by quantity whenever Final
 * Price is positive. That derivation exists to repair $1.00 placeholders in the Unit Price column.
 * It also FABRICATES a unit price on rows where the export puts a UNIT price into the Final Price
 * column, and nothing downstream noticed that the derived figure contradicted the row's own Unit
 * Price. The result shipped graded MEASURED.
 *
 * Two live rows, both traced to raw award rows on 2026-08-18:
 *
 *   NSN 5905-01-413-6345   five approved-source awards, all dated 2017-05-15, all to CAGE 54X10,
 *                          all stating Unit Price 94.26. One carries Final Price 94.26 on
 *                          quantity 25, so the derivation returned 3.77. The date tie made the
 *                          sort stable and file order picked the corrupt row. Published anchor:
 *                          3.77 x 1.40 = 5.28. The resale band on the same screen read 140.
 *
 *   NSN 5310-01-102-8932   two approved-source awards dated 2017-06-21, both stating Unit Price
 *                          36.33. One carries Final Price 94,458 on quantity 6,600, so the
 *                          derivation returned 14.31. Published anchor: 20.03, on an item whose
 *                          later manufacturer awards run 36.85 to 37.49 and whose 2023 award to
 *                          Sikorsky was 69.52.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT THE FIX IS, AND WHY IT IS NOT "PREFER THE STATED UNIT PRICE"
 * ---------------------------------------------------------------------------------------
 * Preferring one column would be picking a side on rows where we cannot know which side is right,
 * and it would re-open the $1.00 placeholder hole the moment the feed carries one again. So a
 * candidate row must AGREE WITH ITSELF: the derived figure and the stated Unit Price within a
 * cent. A row that fails is set aside by name with both figures printed, and if every candidate
 * fails, the anchor abstains rather than publishing a number the row itself contradicts.
 *
 * Then, among the rows that survive, several may share the earliest date. `localeCompare` returns
 * 0 on equal dates, so the sort is stable and index 0 is whichever row the workbook listed first.
 * When those rows disagree on price, there is no earliest award to report and the anchor abstains.
 *
 * ORDER MATTERS AND IS ASSERTED BELOW. The contradiction filter runs FIRST. On 5905 that leaves
 * four rows that agree with each other and with themselves at 94.26, so the anchor answers instead
 * of abstaining, which is a better outcome than the abstention a tie-first ordering would produce.
 *
 * EVERY NUMBER IN THIS FILE IS THE MEASURED SHAPE OF A LIVE ROW, and every expectation was worked
 * out by hand before the code ran:
 *
 *     94.26 stated, Final Price 94.26 over quantity 25    ->  derived 3.77   (94.26 / 25 = 3.7704)
 *     94.26 stated, Final Price 2356.50 over quantity 25  ->  derived 94.26  (2356.50 / 25)
 *     94.26 x 1.3223 = 124.639998    94.26 x 1.40 = 131.964
 *       (9426 x 13223 = 124,639,998, then shift six places)
 */

import { describe, expect, it } from 'vitest'
import { buildQuoteView, identifyOemAward, type QuoteViewInput } from '@/lib/intelligence/pricing'
import { PRICING_INSTANT_MS } from './_fixtures'

const FEED_WINDOW = { firstAwardIso: '2016-01-03', lastAwardIso: '2026-01-29' }
const APPROVED = 'MFG01'

/** The measured shape of the 5905 rows, with the CAGE replaced by the fixture stand-in. */
const CORRUPT_ROW = {
  awardDateIso: '2017-05-15',
  effectiveUnitPriceUsd: 3.77,
  statedUnitPriceUsd: 94.26,
  extendedPriceUsd: 94.26,
  quantity: 25,
  awardeeCage: APPROVED,
  awardeeCompany: 'APPROVED SOURCE (FIXTURE)',
  surplusAsWorded: null,
  contractNo: 'FIXTURE-CORRUPT',
} as const

const cleanSibling = (contractNo: string) =>
  ({
    awardDateIso: '2017-05-15',
    effectiveUnitPriceUsd: 94.26,
    statedUnitPriceUsd: 94.26,
    extendedPriceUsd: 2356.5,
    quantity: 25,
    awardeeCage: APPROVED,
    awardeeCompany: 'APPROVED SOURCE (FIXTURE)',
    surplusAsWorded: null,
    contractNo,
  }) as const

function inputWith(awards: QuoteViewInput['awards']): QuoteViewInput {
  return {
    nsn: '5905-01-413-6345',
    approvedSourceCages: [APPROVED],
    awards,
    solicitationQuantity: 8,
    solicitation: 'SPE4A526T1234',
    automatedSolicitation: true,
    atInstantMs: PRICING_INSTANT_MS,
    feedWindow: FEED_WINDOW,
  }
}

/** No numeric field anywhere on an abstained arm, however deep. */
function everyNumberIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value)
  else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) everyNumberIn(child, out)
  }
  return out
}

describe('a row whose two price columns disagree cannot anchor', () => {
  /*
   * THE LIVE SHAPE, REBUILT. The corrupt row is listed FIRST, which is what the workbook does and
   * what made file order decide the answer. If the contradiction filter is removed, `usable[0]` is
   * this row again and every expectation in this block goes red.
   */
  const view = buildQuoteView(
    inputWith([
      CORRUPT_ROW,
      cleanSibling('FIXTURE-CLEAN-1'),
      cleanSibling('FIXTURE-CLEAN-2'),
      cleanSibling('FIXTURE-CLEAN-3'),
      cleanSibling('FIXTURE-CLEAN-4'),
    ]),
  )

  it('anchors on the price four sibling rows agree on, never on the divided one', () => {
    expect(view.oemAward.identified).toBe(true)
    if (!view.oemAward.identified) return
    expect(view.oemAward.unitPriceUsd).toBe(94.26)
    expect(view.oemAward.unitPriceUsd).not.toBe(3.77)
    expect(view.oemAward.contractNo).not.toBe('FIXTURE-CORRUPT')
  })

  it('carries the arithmetic off the corroborated price, on both index lines', () => {
    const anchor = view.figures[0]
    expect(anchor.resolved).toBe(true)
    if (anchor.resolved !== true) return
    const [cpi, dod] = anchor.lines
    // 9426 x 13223 = 124,639,998 and 9426 x 14 = 131,964, both worked by hand on paper.
    expect(cpi.exactUnitPriceUsd).toBeCloseTo(124.639998, 9)
    expect(dod.exactUnitPriceUsd).toBeCloseTo(131.964, 9)
    expect(dod.arithmetic).toContain('94.26 x 1.40')
    // 3.77 x 1.40 = 5.278, the figure that actually shipped. It must be nowhere in the payload.
    for (const n of everyNumberIn(view)) expect(n).not.toBeCloseTo(5.278, 6)
  })

  it('says out loud that a row was set aside, so the earliest-award claim stays true', () => {
    if (!view.oemAward.identified) throw new Error('expected an identified award')
    expect(view.oemAward.limitation).toContain('excluded from this choice')
    // Both figures, so a reader can see the contradiction rather than take our word for it.
    expect(view.oemAward.limitation).toContain('94.26')
    expect(view.oemAward.limitation).toContain('3.77')
    expect(view.oemAward.limitation).toContain('quantity of 25')
    // The corrupt row shares the chosen date, so the earliest-award claim IS weakened here.
    expect(view.oemAward.limitation).toContain('price columns AGREE')
  })
})

/* ------------------------------------------------------------------------------------ */
/* A FALSE REFUSAL IS A DEFECT TOO                                                        */
/* ------------------------------------------------------------------------------------ */

/**
 * THE HEDGE FIRED ON 4.2% OF LIVE ANCHORS WHERE IT WAS SIMPLY UNTRUE.
 *
 * The exclusion note used to fire whenever ANY approved-source row was set aside, regardless of
 * its date, and then withdrew the earliest-award claim: "this is the earliest approved-source
 * award whose price columns AGREE, which is not necessarily the earliest approved-source award on
 * file." When every set-aside row is dated AFTER the chosen award, nothing earlier was dropped,
 * the chosen row IS the earliest approved-source award on file, and the hedge retracted a measured
 * fact. The old wording made it worse by reading temporally, "set aside before this one was
 * chosen", in a sentence whose whole subject is dates.
 *
 * MEASURED over the live feed on 2026-08-18: 808 identified anchors, 44 carrying an exclusion
 * note, and 34 of those retracting while every set-aside row on the item is later. NSN
 * 8145-01-512-1012 chose 2023-01-17 and the earliest row it set aside is dated 2025-01-31. After
 * the repair: 34 affirm, 10 retract, 0 false refusals, 0 overclaims, checked against ground truth
 * computed from the raw rows outside the module.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. An abstention that fires when the answer is known teaches an
 * operator that our abstentions are noise. Once they are read past, every honest abstention on
 * every other figure is spent too, and the evidence-state contract is the product.
 *
 * EQUALITY COUNTS AS WEAKENING. A set-aside row sharing the chosen date would have gone to the
 * tie check had it survived, so the retraction fires at `<=`, not at `<`. Wrong in the direction
 * that abstains.
 */
describe('the exclusion is always disclosed; the retraction fires only when it is true', () => {
  const CHOSEN_DATE = '2017-05-15'
  const chosen = cleanSibling('FIXTURE-CHOSEN')

  const corruptOn = (awardDateIso: string, contractNo: string) => ({
    ...CORRUPT_ROW,
    awardDateIso,
    contractNo,
  })

  it('retracts when a set-aside row is dated EARLIER than the chosen award', () => {
    const oem = identifyOemAward(inputWith([corruptOn('2016-02-02', 'FIXTURE-EARLIER'), chosen]))
    expect(oem.identified).toBe(true)
    if (!oem.identified) return
    expect(oem.awardDateIso).toBe(CHOSEN_DATE)
    expect(oem.limitation).toContain('excluded from this choice')
    expect(oem.limitation).toContain('not necessarily the earliest approved-source award on file')
    expect(oem.limitation).not.toContain('IS the earliest approved-source award on file')
  })

  it('retracts when a set-aside row SHARES the chosen date, because a tie is a weakening', () => {
    const oem = identifyOemAward(inputWith([corruptOn(CHOSEN_DATE, 'FIXTURE-SAME-DAY'), chosen]))
    if (!oem.identified) throw new Error('expected an identified award')
    expect(oem.limitation).toContain('not necessarily the earliest approved-source award on file')
  })

  it('does NOT retract when every set-aside row is dated LATER, and says so plainly', () => {
    /*
     * THE FALSE REFUSAL, REBUILT. NSN 8145-01-512-1012's live shape: the chosen award is the
     * earliest on file and the only excluded row is two years later.
     */
    const oem = identifyOemAward(inputWith([chosen, corruptOn('2019-01-31', 'FIXTURE-LATER')]))
    expect(oem.identified).toBe(true)
    if (!oem.identified) return
    expect(oem.awardDateIso).toBe(CHOSEN_DATE)
    expect(oem.limitation).toContain('IS the earliest approved-source award on file')
    expect(oem.limitation).not.toContain(
      'not necessarily the earliest approved-source award on file',
    )
  })

  it('still discloses the exclusion in the later case, with the row and both its figures', () => {
    /*
     * Not retracting is not the same as staying quiet. The exclusion is real, it changed the pool,
     * and a reader who wants to check the anchor needs to know a row was dropped.
     */
    const oem = identifyOemAward(inputWith([chosen, corruptOn('2019-01-31', 'FIXTURE-LATER')]))
    if (!oem.identified) throw new Error('expected an identified award')
    expect(oem.limitation).toContain('1 approved-source award row(s) were excluded from this choice')
    expect(oem.limitation).toContain('2019-01-31')
    expect(oem.limitation).toContain('94.26')
    expect(oem.limitation).toContain('3.77')
    expect(oem.limitation).toContain('dated AFTER this award')
  })

  it('drops the temporal wording that invited the wrong reading', () => {
    const oem = identifyOemAward(inputWith([chosen, corruptOn('2019-01-31', 'FIXTURE-LATER')]))
    if (!oem.identified) throw new Error('expected an identified award')
    expect(oem.limitation).not.toContain('set aside before this one was chosen')
  })

  it('THE CONTROL FOR THE CONTROL: no set-aside row means no note of either kind', () => {
    const oem = identifyOemAward(inputWith([chosen]))
    if (!oem.identified) throw new Error('expected an identified award')
    expect(oem.limitation).not.toContain('excluded from this choice')
    expect(oem.limitation).not.toContain('IS the earliest approved-source award on file')
    expect(oem.limitation).not.toContain(
      'not necessarily the earliest approved-source award on file',
    )
  })
})

describe('when the contradicting row has no clean sibling, the anchor abstains', () => {
  const only = identifyOemAward(inputWith([CORRUPT_ROW]))

  it('names the contradiction rather than publishing either column', () => {
    expect(only.identified).toBe(false)
    if (only.identified) return
    expect(only.reason).toBe('NO_APPROVED_SOURCE_AWARD_WHOSE_PRICE_COLUMNS_AGREE')
    expect(only.missingInput).toContain('Unit Price column and Final Price column agree')
    expect(only.sentence).toContain('94.26')
    expect(only.sentence).toContain('3.77')
    expect(only.sentence).toContain('abstention and not a zero')
  })

  it('puts no number on the abstained anchor arm for a page to render', () => {
    const anchor = buildQuoteView(inputWith([CORRUPT_ROW])).figures[0]
    expect(anchor.resolved).toBe(false)
    expect(everyNumberIn(anchor)).toEqual([])
  })

  it('abstains the same way when the row states no Unit Price at all to check against', () => {
    const unstated = identifyOemAward(
      inputWith([{ ...CORRUPT_ROW, statedUnitPriceUsd: null, effectiveUnitPriceUsd: 3.77 }]),
    )
    expect(unstated.identified).toBe(false)
    if (unstated.identified) return
    expect(unstated.reason).toBe('NO_APPROVED_SOURCE_AWARD_WHOSE_PRICE_COLUMNS_AGREE')
    expect(unstated.sentence).toContain('state no Unit Price at all')
  })

  it('accepts the ordinary row where Final Price is blank and Unit Price stands alone', () => {
    /*
     * THE CONTROL FOR THE CONTROL. Without this, "the guard abstains" could equally describe a
     * guard that abstains on everything. A row with no Final Price has nothing to divide, the
     * derived figure IS the stated one, and it must anchor.
     */
    const plain = identifyOemAward(
      inputWith([
        {
          ...CORRUPT_ROW,
          effectiveUnitPriceUsd: 94.26,
          extendedPriceUsd: null,
          contractNo: 'FIXTURE-PLAIN',
        },
      ]),
    )
    expect(plain.identified).toBe(true)
    if (!plain.identified) return
    expect(plain.unitPriceUsd).toBe(94.26)
    expect(plain.limitation).not.toContain('set aside')
  })

  it('tolerates a rounding difference of one cent, which is not a contradiction', () => {
    /*
     * The derived figure is rounded to cents while the stated one is carried raw, so a clean row
     * whose stated price has more decimals can differ from its own derivation by under a cent.
     * 33.333 stated, 33.33 derived. A guard that fired here would abstain on arithmetic noise.
     */
    const rounded = identifyOemAward(
      inputWith([
        {
          ...CORRUPT_ROW,
          statedUnitPriceUsd: 33.333,
          effectiveUnitPriceUsd: 33.33,
          extendedPriceUsd: 833.33,
          quantity: 25,
          contractNo: 'FIXTURE-ROUNDED',
        },
      ]),
    )
    expect(rounded.identified).toBe(true)
    if (!rounded.identified) return
    expect(rounded.unitPriceUsd).toBe(33.33)
  })
})

describe('several awards sharing the earliest date is not a tie-break', () => {
  /*
   * Both rows agree with themselves, so the contradiction filter passes both through and this is
   * the guard that has to act. File order would hand back 250.00 and never say why.
   */
  const tied = inputWith([
    {
      ...cleanSibling('FIXTURE-TIE-HIGH'),
      effectiveUnitPriceUsd: 250,
      statedUnitPriceUsd: 250,
      extendedPriceUsd: 6250,
    },
    {
      ...cleanSibling('FIXTURE-TIE-LOW'),
      effectiveUnitPriceUsd: 100,
      statedUnitPriceUsd: 100,
      extendedPriceUsd: 2500,
    },
  ])

  it('abstains and names both prices instead of trusting workbook order', () => {
    const result = identifyOemAward(tied)
    expect(result.identified).toBe(false)
    if (result.identified) return
    expect(result.reason).toBe('EARLIEST_APPROVED_SOURCE_AWARDS_DISAGREE_ON_PRICE')
    expect(result.sentence).toContain('250.00')
    expect(result.sentence).toContain('100.00')
    expect(result.sentence).toContain('2017-05-15')
    expect(result.missingInput).toContain('same day')
  })

  it('puts no number on the abstained anchor arm', () => {
    const anchor = buildQuoteView(tied).figures[0]
    expect(anchor.resolved).toBe(false)
    expect(everyNumberIn(anchor)).toEqual([])
  })

  it('still anchors when the tied awards agree, so this is not "abstain on any tie"', () => {
    // THE CONTROL FOR THE CONTROL again. Four rows, same date, same price: an answer, not a gap.
    const agreeing = identifyOemAward(
      inputWith([cleanSibling('A'), cleanSibling('B'), cleanSibling('C'), cleanSibling('D')]),
    )
    expect(agreeing.identified).toBe(true)
    if (!agreeing.identified) return
    expect(agreeing.unitPriceUsd).toBe(94.26)
  })

  it('is checked AFTER the contradicting rows are removed, not before', () => {
    /*
     * The ordering assertion, and it is the difference between an answer and an abstention on the
     * live row. Corrupt row plus one clean row, same date, prices 3.77 and 94.26. Checking the tie
     * first sees a disagreement and abstains; filtering first leaves one row and anchors on 94.26.
     */
    const result = identifyOemAward(inputWith([CORRUPT_ROW, cleanSibling('FIXTURE-CLEAN-1')]))
    expect(result.identified).toBe(true)
    if (!result.identified) return
    expect(result.unitPriceUsd).toBe(94.26)
  })
})

describe('the second live row, NSN 5310-01-102-8932, rebuilt from its raw award rows', () => {
  /*
   * Two approved-source awards dated 2017-06-21, both stating 36.33. One carries Final Price
   * 94,458 over quantity 6,600, which divides to 14.31. The shipped adapter took 14.31 and
   * published a DoD anchor of 20.03 on an item the government later paid 36.85 to 69.52 for, and
   * the band abstained, so nothing on the screen contradicted it.
   */
  const rows = [
    {
      awardDateIso: '2017-06-21',
      effectiveUnitPriceUsd: 14.31,
      statedUnitPriceUsd: 36.33,
      extendedPriceUsd: 94458,
      quantity: 6600,
      awardeeCage: APPROVED,
      awardeeCompany: 'APPROVED SOURCE (FIXTURE)',
      surplusAsWorded: null,
      contractNo: 'FIXTURE-8932-DIVIDED',
    },
    {
      awardDateIso: '2017-06-21',
      effectiveUnitPriceUsd: 36.33,
      statedUnitPriceUsd: 36.33,
      extendedPriceUsd: 145320,
      quantity: 4000,
      awardeeCage: APPROVED,
      awardeeCompany: 'APPROVED SOURCE (FIXTURE)',
      surplusAsWorded: null,
      contractNo: 'FIXTURE-8932-CLEAN',
    },
  ] as const

  it('anchors on 36.33 and never on 14.31', () => {
    const view = buildQuoteView({ ...inputWith(rows), nsn: '5310-01-102-8932' })
    expect(view.oemAward.identified).toBe(true)
    if (!view.oemAward.identified) return
    expect(view.oemAward.unitPriceUsd).toBe(36.33)
    const anchor = view.figures[0]
    if (anchor.resolved !== true) throw new Error('expected a resolved anchor')
    // 14.31 x 1.40 = 20.034, the figure that shipped. 36.33 x 1.40 = 50.862 is the honest one.
    expect(anchor.lines[1].exactUnitPriceUsd).toBeCloseTo(50.862, 9)
    for (const n of everyNumberIn(view)) expect(n).not.toBeCloseTo(20.034, 6)
  })
})
