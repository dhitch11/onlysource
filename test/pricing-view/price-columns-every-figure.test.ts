/**
 * THE SAME CHECK ON EVERY FIGURE THAT PUBLISHES A PER-UNIT FIGURE OFF A ROW.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS FILE EXISTS: ONE DEFECT WAS FIXED IN ONE PLACE AND SHIPPED IN TWO OTHERS
 * ---------------------------------------------------------------------------------------
 * `anchor-price-columns.test.ts` beside this file locks the rule for FIGURE 1: a row whose Unit
 * Price column and whose Final-Price-divided-by-quantity disagree by more than a cent cannot be
 * carried forward, because nothing on the row says which of the two is the unit price. That
 * repair was applied to the anchor and to nothing else, so the identical fabrication kept
 * shipping on the same screen, at the same MEASURED grade, from two other figures.
 *
 * MEASURED over the live NSN-Now feed on 2026-08-18, 42,698 award rows, 3,418 stock numbers:
 *
 *   FIGURE 1  ANCHOR      49 resolved,     0 built on a self-contradicting row   (already fixed)
 *   FIGURE 2  BAND      1,783 resolved,  115 containing one, 91 with one AS AN ENDPOINT
 *   FIGURE 3  EVALUATED   49 resolved,     0  (it is a function of the basis, never of a row)
 *   FIGURE 4  TRIPWIRE 1,531 resolved,     7 measured against one, 1 where CROSSED FLIPS
 *
 * THE TWO LIVE ROWS THIS FILE IS BUILT FROM, both traced to raw workbook rows:
 *
 *   NSN 6140-01-482-9031   band 22.38 to 276.97, n=461, graded MEASURED. The LOW endpoint of
 *                          22.38 is divided out of a row STATING Unit Price 179.00 with a Final
 *                          Price of 179.00 on a quantity of 8. Eight times too low, and the low
 *                          endpoint is the number a bidder undercuts.
 *
 *   NSN 2940-01-535-9467   tripwire read 311.0% and CROSSED off a derived 24.33, while the row's
 *                          own stated Unit Price of 81.11 gives 23.3% and NOT CROSSED. The
 *                          operational conclusion of the figure changes with which column you
 *                          believe, and it was published as a measurement.
 *
 * ---------------------------------------------------------------------------------------
 * WHY ABSTAIN RATHER THAN PICK A COLUMN, IN BOTH DIRECTIONS
 * ---------------------------------------------------------------------------------------
 * NSN 6505-01-146-0539 states Unit Price 0.06 against a derived 32.34, and there the DERIVATION
 * is the truth. NSN 6140-01-482-9031 states 179.00 against a derived 22.38, and there the STATED
 * column is. Both shapes are live in the same feed, so a rule that prefers either column is wrong
 * on the other half of the corpus. Refusing the contradiction is the only rule correct in both
 * directions, and it is the one asserted here.
 *
 * THE COST, MEASURED AND CHEAP: 461 of 42,698 rows contradict themselves (1.08%). After the
 * repair, resolved bands go 1,783 -> 1,773 and resolved tripwires go 1,531 -> 1,524.
 *
 * EVERY NUMBER BELOW WAS WORKED OUT BY HAND BEFORE THE CODE RAN:
 *     374 / 2  = 187.00   the fabricated endpoint, against a stated 17.00
 *     179 / 8  = 22.375   rounds to 22.38, against a stated 179.00
 *     (100 - 80) / 80 = 0.25 = 25.0%   the clean tripwire, hand-checked
 */

import { describe, expect, it } from 'vitest'
import { buildQuoteView, type DossierAward, type QuoteViewInput } from '@/lib/intelligence/pricing'
import { PRICING_INSTANT_MS } from './_fixtures'

const FEED_WINDOW = { firstAwardIso: '2016-01-03', lastAwardIso: '2026-01-29' }
const APPROVED = 'MFG01'

/** No numeric field anywhere on an abstained arm, however deep. */
function everyNumberIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value)
  else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) everyNumberIn(child, out)
  }
  return out
}

/** A resale row: the CAGE is not on the approved-source list, which is what makes it secondary. */
function resale(o: Partial<DossierAward> & { readonly contractNo: string }): DossierAward {
  return {
    awardDateIso: '2025-03-04',
    effectiveUnitPriceUsd: 100,
    statedUnitPriceUsd: 100,
    extendedPriceUsd: 200,
    quantity: 2,
    awardeeCage: 'DLR01',
    awardeeCompany: 'A DEALER (FIXTURE)',
    surplusAsWorded: null,
    ...o,
  }
}

function inputWith(
  awards: readonly DossierAward[],
  overrides: Partial<QuoteViewInput> = {},
): QuoteViewInput {
  return {
    nsn: '6140-01-482-9031',
    approvedSourceCages: [APPROVED],
    awards,
    solicitationQuantity: 8,
    solicitation: 'SPE4A526T1234',
    automatedSolicitation: true,
    atInstantMs: PRICING_INSTANT_MS,
    feedWindow: FEED_WINDOW,
    ...overrides,
  }
}

/* ---------------------------------------------------------------------------------- */
/* FIGURE 2: THE RESALE BAND                                                            */
/* ---------------------------------------------------------------------------------- */

describe('FIGURE 2, the resale band, refuses an endpoint the row itself contradicts', () => {
  /*
   * THE REVIEWER'S PRESCRIBED SHAPE. Three in-window resale rows: two agree with themselves at
   * 100.00, and one states a Unit Price of 17.00 while its Final Price of 374.00 over a quantity
   * of 2 divides to 187.00. Before the repair the band published 100.00 to 187.00 at MEASURED and
   * 187.00 was the high endpoint, which is the number the gap against the anchor is measured from.
   */
  const contradicting = resale({
    contractNo: 'FIXTURE-BAND-CORRUPT',
    awardDateIso: '2025-07-15',
    effectiveUnitPriceUsd: 187,
    statedUnitPriceUsd: 17,
    extendedPriceUsd: 374,
    quantity: 2,
  })
  const view = buildQuoteView(
    inputWith([
      resale({ contractNo: 'FIXTURE-BAND-CLEAN-1', awardDateIso: '2025-01-06' }),
      contradicting,
      resale({ contractNo: 'FIXTURE-BAND-CLEAN-2', awardDateIso: '2025-11-20' }),
    ]),
  )
  const band = view.figures[1]

  it('forms the band from the two rows that agree with themselves, and only those', () => {
    expect(band.resolved).toBe(true)
    if (band.resolved !== true) return
    expect(band.lowUnitPriceUsd).toBe(100)
    expect(band.highUnitPriceUsd).toBe(100)
    expect(band.sampleCount).toBe(2)
    expect(band.observations).toHaveLength(2)
  })

  it('keeps 187.00 out of the payload entirely, not merely off the endpoints', () => {
    /*
     * A band that dropped the row from min/max while still listing it as an observation would
     * pass an endpoint assertion and still publish the fabricated figure on screen. So the check
     * is over every number in the payload, not over two fields.
     */
    expect(everyNumberIn(band)).not.toContain(187)
  })

  it('names the set-aside row and BOTH of its figures, so the reader can see the contradiction', () => {
    if (band.resolved !== true) throw new Error('expected a resolved band')
    expect(band.limitation).toContain('set aside')
    expect(band.limitation).toContain('17.00')
    expect(band.limitation).toContain('187.00')
    expect(band.limitation).toContain('374.00')
    expect(band.limitation).toContain('quantity of 2')
    expect(band.limitation).toContain('Neither column is preferred')
  })

  it('says the count changed where a reader looks for the sample size', () => {
    if (band.resolved !== true) throw new Error('expected a resolved band')
    expect(band.arithmetic).toContain('across 2 resale award(s)')
    expect(band.arithmetic).toContain('1 further in-window award(s) set aside')
    const inWindow = band.inputs.find((i) => i.label === 'Resale awards in window')
    expect(inWindow?.renderedValue).toContain('set aside')
  })

  it('THE CONTROL FOR THE CONTROL: a clean pool still resolves, with no set-aside note', () => {
    /*
     * Without this, "the band refuses the contradicting row" could equally describe a band that
     * refuses everything, which would be a coverage collapse dressed as a repair.
     */
    const clean = buildQuoteView(
      inputWith([
        resale({ contractNo: 'FIXTURE-OK-1', awardDateIso: '2025-01-06' }),
        resale({
          contractNo: 'FIXTURE-OK-2',
          awardDateIso: '2025-07-15',
          effectiveUnitPriceUsd: 187,
          statedUnitPriceUsd: 187,
          extendedPriceUsd: 374,
          quantity: 2,
        }),
      ]),
    ).figures[1]
    expect(clean.resolved).toBe(true)
    if (clean.resolved !== true) return
    expect(clean.lowUnitPriceUsd).toBe(100)
    expect(clean.highUnitPriceUsd).toBe(187)
    expect(clean.sampleCount).toBe(2)
    expect(clean.limitation).not.toContain('set aside')
  })

  it('sets aside a row that states no Unit Price at all, and names that as the reason', () => {
    /*
     * THE OTHER REACHABLE ARM OF THE SAME CHECK, and a different silence from a contradiction: a
     * figure divided out of an extended total with nothing on the row to check it against is not
     * a reading either. MEASURED live: 0 of 42,698 rows carry this shape today, which is why the
     * arm needs a synthetic input rather than a live one, and why it is still asserted.
     */
    const band = buildQuoteView(
      inputWith([
        resale({ contractNo: 'FIXTURE-STATED-OK', awardDateIso: '2025-01-06' }),
        resale({
          contractNo: 'FIXTURE-NO-STATED',
          awardDateIso: '2025-07-15',
          effectiveUnitPriceUsd: 187,
          statedUnitPriceUsd: null,
          extendedPriceUsd: 374,
          quantity: 2,
        }),
      ]),
    ).figures[1]
    expect(band.resolved).toBe(true)
    if (band.resolved !== true) return
    expect(band.sampleCount).toBe(1)
    expect(everyNumberIn(band)).not.toContain(187)
    expect(band.limitation).toContain('1 state no Unit Price at all')
    expect(band.limitation).toContain('states no Unit Price of its own')
  })

  it('tolerates a rounding difference of one cent, which is not a contradiction', () => {
    // 100.005 stated, 100.00 derived. A guard firing here would abstain on arithmetic noise.
    const rounded = buildQuoteView(
      inputWith([
        resale({
          contractNo: 'FIXTURE-ROUNDED',
          statedUnitPriceUsd: 100.005,
          effectiveUnitPriceUsd: 100,
          extendedPriceUsd: 200.01,
        }),
      ]),
    ).figures[1]
    expect(rounded.resolved).toBe(true)
    if (rounded.resolved !== true) return
    expect(rounded.sampleCount).toBe(1)
    expect(rounded.limitation).not.toContain('set aside')
  })
})

describe('when every in-window resale row contradicts itself, the band abstains by name', () => {
  const band = buildQuoteView(
    inputWith([
      resale({
        contractNo: 'FIXTURE-ALL-CORRUPT-1',
        awardDateIso: '2025-07-15',
        effectiveUnitPriceUsd: 187,
        statedUnitPriceUsd: 17,
        extendedPriceUsd: 374,
        quantity: 2,
      }),
      resale({
        contractNo: 'FIXTURE-ALL-CORRUPT-2',
        awardDateIso: '2025-09-02',
        effectiveUnitPriceUsd: 22.38,
        statedUnitPriceUsd: 179,
        extendedPriceUsd: 179,
        quantity: 8,
      }),
    ]),
  ).figures[1]

  it('carries its own reason rather than narrowing into a one-sided band', () => {
    expect(band.resolved).toBe(false)
    if (band.resolved !== false) return
    expect(band.reason).toBe('NO_RESALE_AWARD_IN_THE_WINDOW_WHOSE_PRICE_COLUMNS_AGREE')
    expect(band.missingInput).toContain('Unit Price column and Final Price column agree')
  })

  it('explains the refusal in a sentence a person reads, and calls it an abstention', () => {
    if (band.resolved !== false) throw new Error('expected an abstention')
    expect(band.sentence).toContain('2 resale award(s) fall inside')
    expect(band.sentence).toContain('not one of them agrees with itself')
    expect(band.sentence).toContain('the number a bidder undercuts')
    expect(band.sentence).toContain('abstention and not a zero')
  })

  it('puts no number on the abstained arm for a page to render', () => {
    expect(everyNumberIn(band)).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------- */
/* FIGURE 4: THE TRIPWIRE                                                               */
/* ---------------------------------------------------------------------------------- */

describe('FIGURE 4, the tripwire, refuses a prior price the row itself contradicts', () => {
  /*
   * The tripwire is a function of exactly ONE row: the most recent dated priced award. The live
   * shape below is NSN 2940-01-535-9467 rebuilt, with 81.11 stated against a Final Price of
   * 486.66 over a quantity of 20, which divides to 24.33.
   */
  const CORRUPT_PRIOR = resale({
    contractNo: 'FIXTURE-PRIOR-CORRUPT',
    awardDateIso: '2025-12-01',
    effectiveUnitPriceUsd: 24.33,
    statedUnitPriceUsd: 81.11,
    extendedPriceUsd: 486.66,
    quantity: 20,
  })
  const EARLIER_CLEAN = resale({
    contractNo: 'FIXTURE-PRIOR-EARLIER',
    awardDateIso: '2025-08-01',
    effectiveUnitPriceUsd: 80,
    statedUnitPriceUsd: 80,
    extendedPriceUsd: 160,
    quantity: 2,
  })

  const tripwire = buildQuoteView(
    inputWith([EARLIER_CLEAN, CORRUPT_PRIOR], { proposedUnitPriceUsd: 100 }),
  ).figures[3]

  it('abstains with its own reason instead of measuring against a contradicted figure', () => {
    expect(tripwire.resolved).toBe(false)
    if (tripwire.resolved !== false) return
    expect(tripwire.reason).toBe('MOST_RECENT_PRIOR_AWARD_CONTRADICTS_ITSELF_ON_PRICE')
    expect(tripwire.missingInput).toContain('most recent prior award')
  })

  it('prints both figures and says why an earlier award is not substituted', () => {
    if (tripwire.resolved !== false) throw new Error('expected an abstention')
    expect(tripwire.sentence).toContain('81.11')
    expect(tripwire.sentence).toContain('24.33')
    expect(tripwire.sentence).toContain('MOST RECENT prior price')
    expect(tripwire.sentence).toContain('An earlier award is not substituted')
    expect(tripwire.sentence).toContain('fabricated all-clear')
  })

  it('DOES NOT WALK BACK to the earlier clean row, which would answer a different question', () => {
    /*
     * The permissive failure this forecloses. Measuring 100.00 against the earlier 80.00 gives
     * 25.0% and a clean-looking answer under a label that promises the most recent prior price.
     * Neither 80 nor 25 may appear anywhere on this arm.
     */
    expect(everyNumberIn(tripwire)).toEqual([])
  })

  it('THE CONTROL FOR THE CONTROL: a clean most-recent row still resolves, hand-checked', () => {
    const clean = buildQuoteView(
      inputWith(
        [
          EARLIER_CLEAN,
          resale({
            contractNo: 'FIXTURE-PRIOR-CLEAN',
            awardDateIso: '2025-12-01',
            effectiveUnitPriceUsd: 80,
            statedUnitPriceUsd: 80,
            extendedPriceUsd: 160,
            quantity: 2,
          }),
        ],
        { proposedUnitPriceUsd: 100 },
      ),
    ).figures[3]
    expect(clean.resolved).toBe(true)
    if (clean.resolved !== true) return
    // (100 - 80) / 80 = 0.25 exactly, worked by hand.
    expect(clean.impliedIncreasePercent).toBeCloseTo(25, 10)
    expect(clean.impliedMultipleOfPrior).toBeCloseTo(1.25, 10)
  })
})
