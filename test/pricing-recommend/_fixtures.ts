import {
  OPERATOR_AWARD_MULTIPLE,
  RECOMMENDATION_CONFIG,
  type RecommendationConfig,
} from '@/lib/intelligence/pricing/recommend'
/**
 * SYNTHETIC INPUTS WHOSE ANSWERS WERE WORKED OUT BY HAND BEFORE THE CODE RAN.
 *
 * This estate has a recorded incident where a hand-written verification regex reproduced the exact
 * parser bug it was checking for and confirmed the wrong conclusion. The defence is not to write
 * the check more carefully, it is to drive the code with an input whose correct output is known in
 * advance. Everything here exists for that reason.
 *
 * WHICH NUMBERS ARE REAL AND WHICH ARE FIXTURE, stated so no test asserts doctrine against an
 * invented figure:
 *
 *   REAL, from the corpus:
 *     1537.85   the 2017 original manufacturer award unit price
 *     17        the quantity on that award
 *     2017      its year, which is also the base year both inflation factors are stated for
 *     1.3223    the CPI factor the expert states
 *     1.40      the DoD procurement factor he states and prefers
 *     3565      the price he actually quoted, and his sentence giving its derivation
 *     1188.33   IMPLIED BY HIS OWN SENTENCE (3565 / 3), and used here ONLY as a fixture input to
 *               prove the rule reproduces his figure. It is printed nowhere in the corpus, it is
 *               graded DERIVED in `lib/engine/pricing/anchor.ts`, and no production path reads it.
 *
 *   FIXTURE, invented here, and never asserted as a doctrine figure:
 *     MFG01 / DLR01..DLR04   stand-in CAGEs. The corpus does not print the real ones and inventing
 *                            a plausible CAGE would put a fabricated identifier in a test that
 *                            looks authoritative.
 *     every resale price and date, which exist only to exercise the ladder
 *
 * EVERY ROW BUILT BY `cleanAward` IS INTERNALLY CONSISTENT ON PURPOSE: the stated Unit Price, the
 * extended Final Price divided by quantity, and the derived per-unit figure all agree. The engine
 * refuses a row that contradicts itself, so a fixture that quietly disagreed with itself would
 * abstain and the failure would read as a doctrine change rather than as a broken fixture. The
 * contradicting shapes live in `quantity-normalisation.test.ts`, where they are the subject.
 */

import type { DossierAward } from '@/lib/intelligence/pricing/quote-view'
import type { PricedPeer, RecommendationInput } from '@/lib/intelligence/pricing/recommend'

/** The corpus figures. */
export const OEM_UNIT_PRICE_USD = 1537.85
export const OEM_AWARD_QUANTITY = 17
export const OEM_AWARD_DATE_ISO = '2017-04-11'
export const REFERENCE_NSN = '1650-01-059-8221'
export const REFERENCE_FSC = '1650'
export const APPROVED_SOURCE_CAGE = 'MFG01'

/**
 * The pricing instant every test uses. 2026-01-29 is the newest award date in the live feed, so it
 * is a real instant this product prices at, and it is late enough for the DLAD Rev 5 bands (read
 * 2026-01-12) to resolve. Fixed rather than read from a clock: a test whose answer changes with the
 * wall date is not a test.
 */
export const PRICING_INSTANT_MS = Date.UTC(2026, 0, 29)

export const FEED_WINDOW = { firstAwardIso: '2016-01-03', lastAwardIso: '2026-01-29' }

/** A row that agrees with itself, which is what a clean export row looks like. */
export function cleanAward(args: {
  readonly awardDateIso: string
  readonly unitPriceUsd: number
  readonly quantity: number
  readonly awardeeCage: string
  readonly awardeeCompany?: string
  readonly surplusAsWorded?: string | null
  readonly contractNo?: string
}): DossierAward {
  const extended = Math.round(args.unitPriceUsd * args.quantity * 100) / 100
  return {
    awardDateIso: args.awardDateIso,
    effectiveUnitPriceUsd: args.unitPriceUsd,
    statedUnitPriceUsd: args.unitPriceUsd,
    extendedPriceUsd: extended,
    quantity: args.quantity,
    awardeeCage: args.awardeeCage,
    awardeeCompany: args.awardeeCompany ?? `${args.awardeeCage} (FIXTURE)`,
    surplusAsWorded: args.surplusAsWorded ?? null,
    contractNo: args.contractNo ?? `FIXTURE-${args.awardDateIso}`,
  }
}

/**
 * A row that contradicts itself, in the exact shape measured on live NSN 5905-01-413-6345: the
 * Unit Price column states 94.26 and the extended total divides to 3.77, a figure 25 times too
 * low, and both were shipping graded MEASURED.
 */
export function contradictingAward(args: {
  readonly awardDateIso: string
  readonly statedUnitPriceUsd: number
  readonly derivedUnitPriceUsd: number
  readonly extendedPriceUsd: number
  readonly quantity: number
  readonly awardeeCage: string
}): DossierAward {
  return {
    awardDateIso: args.awardDateIso,
    effectiveUnitPriceUsd: args.derivedUnitPriceUsd,
    statedUnitPriceUsd: args.statedUnitPriceUsd,
    extendedPriceUsd: args.extendedPriceUsd,
    quantity: args.quantity,
    awardeeCage: args.awardeeCage,
    awardeeCompany: `${args.awardeeCage} (FIXTURE)`,
    surplusAsWorded: null,
    contractNo: `FIXTURE-BROKEN-${args.awardDateIso}`,
  }
}

export function peer(args: {
  readonly nsn: string
  readonly unitPriceUsd: number
  readonly quantity?: number | null
  readonly awardDateIso?: string | null
  readonly awardeeCage?: string | null
  readonly surplusAsWorded?: string | null
}): PricedPeer {
  return {
    nsn: args.nsn,
    unitPriceUsd: args.unitPriceUsd,
    quantity: args.quantity ?? 5,
    awardDateIso: args.awardDateIso ?? '2025-04-01',
    awardeeCage: args.awardeeCage ?? 'DLR09',
    surplusAsWorded: args.surplusAsWorded ?? null,
  }
}

/** A lookup that answers for one supply class only, so a test can prove the FSC was derived. */
export function peerLookupFor(fsc: string, peers: readonly PricedPeer[]) {
  return (asked: string): readonly PricedPeer[] => (asked === fsc ? peers : [])
}

/**
 * THE FULL LADDER ROW: every rung can resolve on it.
 *
 *   R1  the 2017 award to MFG01, which is on the approved-source list, in the factors' base year
 *   R2  the most recent award, 2025-06-02 at 1450.00
 *   R3  three awards inside the 36 month window ending 2026-01-29 (window opens 2023-01-29)
 *   R4  four readable dated awards in total
 *   R5  four priced peers in supply class 1650, supplied by the caller
 */
export function fullLadderInput(
  overrides: Partial<RecommendationInput> = {},
): RecommendationInput {
  return {
    /*
     * The multiple is PINNED at the operator's 3x for every test built on this fixture. They
     * assert engine behaviour, not product policy.
     */
    config: AT_OPERATOR_MULTIPLE,
    nsn: REFERENCE_NSN,
    awards: [
      cleanAward({
        awardDateIso: OEM_AWARD_DATE_ISO,
        unitPriceUsd: OEM_UNIT_PRICE_USD,
        quantity: OEM_AWARD_QUANTITY,
        awardeeCage: APPROVED_SOURCE_CAGE,
        contractNo: 'FIXTURE-OEM-1',
      }),
      cleanAward({
        awardDateIso: '2023-08-15',
        unitPriceUsd: 900,
        quantity: 5,
        awardeeCage: 'DLR03',
      }),
      cleanAward({
        awardDateIso: '2024-03-11',
        unitPriceUsd: 812,
        quantity: 4,
        awardeeCage: 'DLR01',
      }),
      cleanAward({
        awardDateIso: '2025-06-02',
        unitPriceUsd: 1450,
        quantity: 2,
        awardeeCage: 'DLR02',
      }),
    ],
    approvedSourceCages: [APPROVED_SOURCE_CAGE],
    requirementQuantity: 8,
    atInstantMs: PRICING_INSTANT_MS,
    feedWindow: FEED_WINDOW,
    peerLookup: peerLookupFor(REFERENCE_FSC, [
      peer({ nsn: '1650-01-000-0001', unitPriceUsd: 100 }),
      peer({ nsn: '1650-01-000-0002', unitPriceUsd: 200 }),
      peer({ nsn: '1650-01-000-0003', unitPriceUsd: 400 }),
      peer({ nsn: '1650-01-000-0004', unitPriceUsd: 800 }),
    ]),
    ...overrides,
  }
}

/** What only a human can state. Spread in when a test needs the evaluated figures. */
export const DECLARED_OFFER = {
  offeringUnusedFormerGovernmentSurplus: true,
  esaCoordinationCount: 1,
} as const

/**
 * THE OPERATOR'S 3x, PINNED, FOR TESTS THAT ASSERT THE MULTIPLICATION ITSELF.
 *
 * ★ WHY THESE TESTS PIN A MULTIPLE INSTEAD OF RIDING THE DEFAULT. On 2026-08-19 the product
 * default moved from 3 to 1 and twenty assertions across seven files went red, all of them
 * arithmetic like "expected 1450 to be 4350". NONE of those tests were about the default: they are
 * about quantity normalisation, band monotonicity, the peer floor, surplus exclusion and the
 * quoted-versus-evaluated separation. They had baked the multiple of the day into their expected
 * values, so a ruling about product POLICY broke tests about engine BEHAVIOUR.
 *
 * Pinning separates the two for good. These files assert that whatever multiple is in force is
 * applied correctly to a per-unit price; `default-multiple.test.ts` asserts what the default IS.
 * A future ruling changes one file rather than twenty numbers scattered through the suite.
 */
export const AT_OPERATOR_MULTIPLE: RecommendationConfig = {
  ...RECOMMENDATION_CONFIG,
  awardMultiple: OPERATOR_AWARD_MULTIPLE,
}
