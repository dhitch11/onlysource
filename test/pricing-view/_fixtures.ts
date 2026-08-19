/**
 * SYNTHETIC INPUTS WHOSE ANSWERS ARE KNOWN BEFORE THE CODE RUNS.
 *
 * This estate has a recorded incident where a hand-written verification regex reproduced the
 * exact parser bug it was checking for and confirmed the wrong conclusion. The defence is not to
 * write the check more carefully, it is to drive the code with an input whose correct output was
 * worked out by hand first. Everything here is constructed for that reason.
 *
 * WHICH NUMBERS ARE REAL AND WHICH ARE FIXTURE, stated so no test asserts doctrine against a
 * number I made up:
 *
 *   REAL, from the corpus, and the only ones the doctrine tests assert:
 *     1537.85    the 2017 original manufacturer award unit price
 *     17         the quantity on that award
 *     2017       its year, which is also the base year both inflation factors are stated for
 *     3565       the price the expert actually quoted, recorded with its own derivation
 *
 *   FIXTURE, invented here, and never asserted as a doctrine figure:
 *     MFG01      a stand-in company code for the approved source. The corpus does not print
 *                the manufacturer's real CAGE and inventing a plausible one would be a
 *                fabricated identifier sitting in a test that looks authoritative.
 *     DLR01/2/3  stand-in company codes for the resale awardees
 *     the resale prices and dates, which exist only to exercise the band and the tripwire
 *
 * EVERY ROW HERE IS INTERNALLY CONSISTENT ON PURPOSE. `statedUnitPriceUsd` repeats the unit price
 * and `extendedPriceUsd` is that price times the quantity, which is what a clean export row looks
 * like. The anchor now refuses a row whose two price columns disagree, so a fixture that quietly
 * disagreed with itself would abstain and the failure would read as a doctrine change rather than
 * as a broken fixture. The contradicting shapes live in `anchor-price-columns.test.ts`, where they
 * are the subject rather than an accident.
 */

import type { QuoteViewInput } from '@/lib/intelligence/pricing'

/** The corpus figure. Asserted by the doctrine tests, so it lives in one place. */
export const OEM_UNIT_PRICE_USD = 1537.85
export const OEM_AWARD_QUANTITY = 17
export const OEM_AWARD_DATE_ISO = '2017-04-11'

/** The reference stock number, as the engine's own fixture spells it. */
export const REFERENCE_NSN = '1650-01-059-8221'

export const APPROVED_SOURCE_CAGE = 'MFG01'

/**
 * The pricing instant every test uses.
 *
 * 2026-01-29 is the newest award date in the live feed, so it is a real instant this product
 * would price at, and it is late enough for the DLAD Rev 5 tripwire bands (read 2026-01-12) to
 * resolve. Fixed rather than read from a clock, because a test whose answer changes with the
 * wall date is not a test.
 */
export const PRICING_INSTANT_MS = Date.UTC(2026, 0, 29)

const FEED_WINDOW = { firstAwardIso: '2016-01-03', lastAwardIso: '2026-01-29' }

/**
 * The reference item: one manufacturer award in the factors' base year, then resale awards.
 *
 * The resale rows carry no Surplus wording deliberately. The live export states surplus on 311
 * of 42,698 rows, so the ordinary case is a blank, and the fixture has to exercise the ordinary
 * case: these awards are classified as resale by the awardee NOT being on the approved-source
 * list, never by reading a blank column as a "no".
 */
export function referenceInput(overrides: Partial<QuoteViewInput> = {}): QuoteViewInput {
  return {
    nsn: REFERENCE_NSN,
    approvedSourceCages: [APPROVED_SOURCE_CAGE],
    awards: [
      {
        awardDateIso: OEM_AWARD_DATE_ISO,
        effectiveUnitPriceUsd: OEM_UNIT_PRICE_USD,
        statedUnitPriceUsd: OEM_UNIT_PRICE_USD,
        extendedPriceUsd: OEM_UNIT_PRICE_USD * OEM_AWARD_QUANTITY,
        quantity: OEM_AWARD_QUANTITY,
        awardeeCage: APPROVED_SOURCE_CAGE,
        awardeeCompany: 'APPROVED SOURCE (FIXTURE)',
        surplusAsWorded: null,
        contractNo: 'FIXTURE-OEM-1',
      },
      {
        awardDateIso: '2024-03-11',
        effectiveUnitPriceUsd: 812,
        statedUnitPriceUsd: 812,
        extendedPriceUsd: 3248,
        quantity: 4,
        awardeeCage: 'DLR01',
        awardeeCompany: 'RESALE ONE (FIXTURE)',
        surplusAsWorded: null,
        contractNo: 'FIXTURE-FLIP-1',
      },
      {
        awardDateIso: '2025-06-02',
        effectiveUnitPriceUsd: 1450,
        statedUnitPriceUsd: 1450,
        extendedPriceUsd: 2900,
        quantity: 2,
        awardeeCage: 'DLR02',
        awardeeCompany: 'RESALE TWO (FIXTURE)',
        surplusAsWorded: 'Yes',
        contractNo: 'FIXTURE-FLIP-2',
      },
    ],
    solicitationQuantity: 8,
    solicitation: 'SPE4A526T1234',
    automatedSolicitation: true,
    atInstantMs: PRICING_INSTANT_MS,
    feedWindow: FEED_WINDOW,
    ...overrides,
  }
}

/**
 * The ordinary live row: award history, an approved-source list, and no award to anyone on it.
 * 1,696 of the 2,514 live stock numbers carrying award history look like this.
 */
export function noManufacturerAwardInput(overrides: Partial<QuoteViewInput> = {}): QuoteViewInput {
  return {
    nsn: '5310-00-111-2222',
    approvedSourceCages: ['MFG99'],
    awards: [
      {
        awardDateIso: '2024-08-20',
        effectiveUnitPriceUsd: 640,
        statedUnitPriceUsd: 640,
        extendedPriceUsd: 6400,
        quantity: 10,
        awardeeCage: 'DLR03',
        awardeeCompany: 'RESALE THREE (FIXTURE)',
        surplusAsWorded: null,
        contractNo: 'FIXTURE-FLIP-3',
      },
      {
        awardDateIso: '2025-11-14',
        effectiveUnitPriceUsd: 1990,
        statedUnitPriceUsd: 1990,
        extendedPriceUsd: 11940,
        quantity: 6,
        awardeeCage: 'DLR04',
        awardeeCompany: 'RESALE FOUR (FIXTURE)',
        surplusAsWorded: null,
        contractNo: 'FIXTURE-FLIP-4',
      },
    ],
    solicitationQuantity: 6,
    solicitation: 'SPE4A526T9999',
    automatedSolicitation: true,
    atInstantMs: PRICING_INSTANT_MS,
    feedWindow: FEED_WINDOW,
    ...overrides,
  }
}

/** What only a human can state. Spread into an input when a test needs the evaluated figure. */
export const DECLARED_OFFER = {
  offeringUnusedFormerGovernmentSurplus: true,
  esaCoordinationCount: 1,
} as const
