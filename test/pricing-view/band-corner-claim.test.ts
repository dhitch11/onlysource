/**
 * "ON THIS ITEM THE MANUFACTURER HAS TAKEN EVERY RECORDED BUY" IS THE LOUDEST COMMERCIAL
 * SENTENCE ON THE QUOTE SCREEN, AND IT WAS BEING EMITTED FROM AN ARM THAT ONLY LOOKED AT
 * PRICED AWARDS.
 *
 * The band classifies rows out of `priced`, which requires a positive unit price and an award
 * date. Everything with a null price, a zero price or no date was never examined. When NO row
 * survived that filter, the code still reached the corner arm and said the manufacturer had taken
 * every recorded buy over a file in which no buy had been attributed to anybody at all. A quieter
 * version of the same overclaim arrived whenever an unread row had gone to a company that is not
 * on the approved-source list: a dealer bought the item, and the screen called it a corner.
 *
 * MEASURED, live feed, 2026-08-18: 0 of 42,698 award rows carry a null or non-positive effective
 * unit price, so the corpus cannot reach this arm today. That is not a defence. `DossierAward`
 * types the field `number | null` precisely because the export can be silent, and a commercial
 * claim resting on a field never being null is a claim waiting for a feed revision.
 *
 * THE SPLIT, and what each arm may say:
 *
 *   no readable priced row at all   NO_PRICED_AWARD_ON_FILE, and it says explicitly that this is
 *                                   not a finding about who holds the item
 *   priced rows, all to the source,
 *     nothing unread                the full claim, and it says so: every recorded buy
 *   priced rows, all to the source,
 *     unread rows exist             the claim is scoped to priced buys and the unread rows are
 *                                   counted out loud
 *   an unread row went to a dealer  the sentence states that this is NOT a corner
 */

import { describe, expect, it } from 'vitest'
import { buildQuoteView, type QuoteViewInput } from '@/lib/intelligence/pricing'
import { PRICING_INSTANT_MS } from './_fixtures'

const APPROVED = 'MFG01'
const FEED_WINDOW = { firstAwardIso: '2016-01-03', lastAwardIso: '2026-01-29' }

function inputWith(awards: QuoteViewInput['awards']): QuoteViewInput {
  return {
    nsn: '5310-00-111-2222',
    approvedSourceCages: [APPROVED],
    awards,
    solicitationQuantity: 4,
    solicitation: 'SPE4A526T1234',
    automatedSolicitation: true,
    atInstantMs: PRICING_INSTANT_MS,
    feedWindow: FEED_WINDOW,
  }
}

const award = (over: Partial<QuoteViewInput['awards'][number]>): QuoteViewInput['awards'][number] => ({
  awardDateIso: '2025-03-04',
  effectiveUnitPriceUsd: 100,
  statedUnitPriceUsd: 100,
  extendedPriceUsd: 1200,
  quantity: 12,
  awardeeCage: APPROVED,
  awardeeCompany: 'APPROVED SOURCE (FIXTURE)',
  surplusAsWorded: null,
  contractNo: 'FIXTURE-1',
  ...over,
})

function bandOf(awards: QuoteViewInput['awards']) {
  const figure = buildQuoteView(inputWith(awards)).figures[1]
  if (figure.resolved !== false) throw new Error('expected the band to abstain on this input')
  return figure
}

function everyNumberIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value)
  else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) everyNumberIn(child, out)
  }
  return out
}

describe('awards exist and not one of them carries a price', () => {
  /*
   * THE REVIEWER'S FAILING INPUT, unchanged in shape: two recorded buys, both to companies that
   * are NOT the approved source, neither carrying a price. Before the split this returned
   * NO_SECONDARY_AWARD_ON_FILE and told the operator the manufacturer had taken every recorded
   * buy, while both buys on file had gone to dealers.
   */
  const dealerBuysWithNoPrices = [
    award({
      awardDateIso: '2025-03-04',
      effectiveUnitPriceUsd: null,
      statedUnitPriceUsd: null,
      extendedPriceUsd: null,
      awardeeCage: 'DLR01',
      awardeeCompany: 'A DEALER (FIXTURE)',
      contractNo: 'FIXTURE-D1',
    }),
    award({
      awardDateIso: '2025-09-19',
      effectiveUnitPriceUsd: null,
      statedUnitPriceUsd: null,
      extendedPriceUsd: null,
      quantity: 5,
      awardeeCage: 'DLR02',
      awardeeCompany: 'ANOTHER DEALER (FIXTURE)',
      contractNo: 'FIXTURE-D2',
    }),
  ]

  it('returns its own reason instead of the corner arm', () => {
    const band = bandOf(dealerBuysWithNoPrices)
    expect(band.reason).toBe('NO_PRICED_AWARD_ON_FILE')
  })

  it('never claims the manufacturer took anything', () => {
    const band = bandOf(dealerBuysWithNoPrices)
    expect(band.sentence).not.toContain('every recorded buy')
    expect(band.sentence).not.toContain('has taken')
    expect(band.sentence).toContain('NOT a finding that the manufacturer holds the item')
    expect(band.sentence).toContain('2 carry no price at all')
  })

  it('carries no number on the abstained arm', () => {
    expect(everyNumberIn(bandOf(dealerBuysWithNoPrices))).toEqual([])
  })

  it('reaches the same arm when the price is present but zero, not only when it is null', () => {
    // A zero is a different publisher from a null and neither is a price. Both land here.
    const band = bandOf([
      award({ effectiveUnitPriceUsd: 0, statedUnitPriceUsd: 0, extendedPriceUsd: 0 }),
    ])
    expect(band.reason).toBe('NO_PRICED_AWARD_ON_FILE')
  })

  it('says so when the silence is the DATE rather than the price', () => {
    const band = bandOf([award({ awardDateIso: null, contractNo: 'FIXTURE-UNDATED' })])
    expect(band.reason).toBe('NO_PRICED_AWARD_ON_FILE')
    expect(band.sentence).toContain('carry a price with no award date')
  })
})

describe('priced awards exist and all of them went to the approved source', () => {
  it('makes the full claim only when every recorded buy was actually read', () => {
    const band = bandOf([award({ contractNo: 'FIXTURE-OEM-A' })])
    expect(band.reason).toBe('NO_SECONDARY_AWARD_ON_FILE')
    expect(band.sentence).toContain('every priced buy on file')
    expect(band.sentence).toContain('so that covers every recorded buy')
  })

  it('scopes the claim and counts the unread rows when a row was not read', () => {
    const band = bandOf([
      award({ contractNo: 'FIXTURE-OEM-A' }),
      award({
        effectiveUnitPriceUsd: null,
        statedUnitPriceUsd: null,
        extendedPriceUsd: null,
        contractNo: 'FIXTURE-OEM-UNPRICED',
      }),
    ])
    expect(band.reason).toBe('NO_SECONDARY_AWARD_ON_FILE')
    expect(band.sentence).toContain('every priced buy on file')
    expect(band.sentence).toContain('1 further award(s) were not read here')
    expect(band.sentence).not.toContain('every recorded buy')
  })

  it('states plainly that it is NOT a corner when an unread buy went to a dealer', () => {
    /*
     * The smaller overclaim, and the one that costs money: the manufacturer took every PRICED buy,
     * but a dealer is on the file too and only the price of that row is missing. Calling this a
     * corner would price the item as though nobody else could supply it.
     */
    const band = bandOf([
      award({ contractNo: 'FIXTURE-OEM-A' }),
      award({
        effectiveUnitPriceUsd: null,
        statedUnitPriceUsd: null,
        extendedPriceUsd: null,
        awardeeCage: 'DLR01',
        awardeeCompany: 'A DEALER (FIXTURE)',
        contractNo: 'FIXTURE-DEALER-UNPRICED',
      }),
    ])
    expect(band.reason).toBe('NO_SECONDARY_AWARD_ON_FILE')
    expect(band.sentence).toContain('this is NOT a corner')
    expect(band.sentence).toContain('1 of them went to a company that is not on the approved-source')
    expect(band.sentence).not.toContain('the manufacturer has taken')
  })

  it('carries no number on the abstained arm in any of those shapes', () => {
    expect(everyNumberIn(bandOf([award({ contractNo: 'FIXTURE-OEM-A' })]))).toEqual([])
  })
})

/* ------------------------------------------------------------------------------------ */
/* THE SECOND OVERCLAIM IN THE SAME SENTENCE: WHY AN UNREAD ROW WAS COUNTED AS A DEALER   */
/* ------------------------------------------------------------------------------------ */

/**
 * THE FIX FOR THE OVERCLAIM ABOVE INTRODUCED A SMALLER ONE, IN THE OPPOSITE DIRECTION.
 *
 * It counted the unread rows with `unread.filter((a) => classify(a) !== null)` and printed the
 * result as "N of them went to a company that is not on the approved-source list", then concluded
 * "So this is NOT a corner: a recorded buy on this item went to a dealer". But `classify` returns
 * a non-null value for TWO facts and only one of them is membership:
 *
 *   FLAGGED_SURPLUS_BY_THE_EXPORT              any surplus-flagged row, WHOEVER took it, including
 *                                              the approved source itself
 *   AWARDEE_NOT_ON_THE_APPROVED_SOURCE_LIST    also returned when the CAGE is BLANK, because
 *                                              `normaliseCage(null)` is '' and '' is never in the
 *                                              approved set
 *
 * So an unread award to the approved source, and an unread award whose awardee is not recorded at
 * all, were both published as a named finding that a dealer had taken a buy on this item. A
 * silence and a different fact, rendered as the same finding, which is the failure the corner
 * sentence had just been repaired to stop making in the other direction.
 *
 * A blank CAGE is read here exactly the way an empty approved-source list is read: as a silence
 * about who took the award, never as evidence against the manufacturer.
 *
 * MEASURED live 2026-08-18: 0 of 42,698 rows are undated or unpriced and 0 carry a blank CAGE, so
 * none of this fires from today's export and all of it is one feed revision from firing.
 */
describe('an unread row is counted as what it actually is, never collapsed to "a dealer"', () => {
  const pricedToTheSource = award({ contractNo: 'FIXTURE-OEM-A' })

  it('reports a surplus flag as a fact about the MATERIAL, not about the awardee', () => {
    /*
     * The reviewer's ATTACK D verbatim: the unread row went to MFG01, which IS on the
     * approved-source list, and carries the export's surplus wording.
     */
    const band = bandOf([
      pricedToTheSource,
      award({
        awardDateIso: '2025-06-01',
        effectiveUnitPriceUsd: null,
        statedUnitPriceUsd: null,
        extendedPriceUsd: null,
        awardeeCage: APPROVED,
        awardeeCompany: 'APPROVED SOURCE (FIXTURE)',
        surplusAsWorded: 'Yes',
        contractNo: 'FIXTURE-SURPLUS-UNPRICED',
      }),
    ])
    expect(band.reason).toBe('NO_SECONDARY_AWARD_ON_FILE')
    expect(band.sentence).toContain(
      '1 of them was flagged as surplus by the export, which describes the material and not the awardee',
    )
    // The three things it may not say, because the awardee is on the list.
    expect(band.sentence).not.toContain('went to a company that is not on the approved-source list')
    expect(band.sentence).not.toContain('NOT a corner')
    expect(band.sentence).not.toContain('went to a dealer')
  })

  it('says the awardee is UNREAD when the CAGE is blank, and attributes the buy to nobody', () => {
    const band = bandOf([
      pricedToTheSource,
      award({
        awardDateIso: '2025-06-01',
        effectiveUnitPriceUsd: null,
        statedUnitPriceUsd: null,
        extendedPriceUsd: null,
        awardeeCage: null,
        awardeeCompany: null,
        contractNo: 'FIXTURE-BLANK-CAGE',
      }),
    ])
    expect(band.reason).toBe('NO_SECONDARY_AWARD_ON_FILE')
    expect(band.sentence).toContain('1 of them carries no awardee CAGE')
    expect(band.sentence).toContain('who took them is unread')
    expect(band.sentence).toContain('attributed to nobody')
    expect(band.sentence).not.toContain('went to a company that is not on the approved-source list')
    expect(band.sentence).not.toContain('NOT a corner')
  })

  it('treats an empty-string CAGE the same as a null one, because both are blank', () => {
    const band = bandOf([
      pricedToTheSource,
      award({
        effectiveUnitPriceUsd: null,
        statedUnitPriceUsd: null,
        extendedPriceUsd: null,
        awardeeCage: '   ',
        contractNo: 'FIXTURE-WHITESPACE-CAGE',
      }),
    ])
    expect(band.sentence).toContain('1 of them carries no awardee CAGE')
    expect(band.sentence).not.toContain('NOT a corner')
  })

  it('THE CONTROL FOR THE CONTROL: a named CAGE that is genuinely off the list still kills the corner', () => {
    /*
     * Without this, "the sentence stopped saying dealer" could equally describe a sentence that
     * can never say it, which would bury the finding that actually costs money.
     */
    const band = bandOf([
      pricedToTheSource,
      award({
        effectiveUnitPriceUsd: null,
        statedUnitPriceUsd: null,
        extendedPriceUsd: null,
        awardeeCage: 'DLR07',
        awardeeCompany: 'A DEALER (FIXTURE)',
        contractNo: 'FIXTURE-REAL-DEALER',
      }),
    ])
    expect(band.sentence).toContain('1 of them went to a company that is not on the approved-source list')
    expect(band.sentence).toContain('this is NOT a corner')
    expect(band.sentence).not.toContain('carries no awardee CAGE')
  })

  it('counts each reason separately when all three shapes are on one item', () => {
    const band = bandOf([
      pricedToTheSource,
      award({
        effectiveUnitPriceUsd: null,
        statedUnitPriceUsd: null,
        extendedPriceUsd: null,
        awardeeCage: 'DLR07',
        contractNo: 'FIXTURE-MIX-DEALER',
      }),
      award({
        effectiveUnitPriceUsd: null,
        statedUnitPriceUsd: null,
        extendedPriceUsd: null,
        awardeeCage: APPROVED,
        surplusAsWorded: 'Yes',
        contractNo: 'FIXTURE-MIX-SURPLUS',
      }),
      award({
        effectiveUnitPriceUsd: null,
        statedUnitPriceUsd: null,
        extendedPriceUsd: null,
        awardeeCage: null,
        contractNo: 'FIXTURE-MIX-BLANK',
      }),
      award({
        effectiveUnitPriceUsd: null,
        statedUnitPriceUsd: null,
        extendedPriceUsd: null,
        contractNo: 'FIXTURE-MIX-ON-LIST',
      }),
    ])
    expect(band.sentence).toContain('4 further award(s) were not read here')
    expect(band.sentence).toContain('1 of them went to a company that is not on the approved-source list')
    expect(band.sentence).toContain('1 of them was flagged as surplus by the export')
    expect(band.sentence).toContain('1 of them carries no awardee CAGE')
    // Only the membership count licenses the attribution, and exactly one row supports it.
    expect(band.sentence).toContain('this is NOT a corner')
  })
})
