/**
 * THE TRANSLATION LAYER between what the dossier holds and what the quote view needs.
 *
 * `quote-view.ts` is pure: no I/O, no clock, no feed. That is deliberate, because every test in
 * `test/pricing-view/**` drives it with synthetic rows whose answers are known in advance, and a
 * module that reaches for a workbook cannot be driven that way. This file is the one place that
 * knows the shape of the award index, so the pure core never has to.
 *
 * It is a mapping and nothing else. It computes no price, applies no factor and makes no
 * judgement about what is quotable. Everything it does is rename a field or hand a null through
 * unchanged. If arithmetic appears here, it belongs in the engine.
 */

import type { NsnAwardSummary } from '@/lib/intelligence/awards/nsn-now'
import type { DossierAward, QuoteViewInput } from './quote-view'

/**
 * What the solicitation side of the dossier contributes. Separate from the award summary because
 * they come from different files: the awards are the NSN-Now export, and these three come from
 * the daily solicitation index.
 */
export type SolicitationFacts = {
  /** Quantity on the live requirement, or null when the index row did not parse one. */
  readonly quantity: number | null
  readonly solicitation: string | null
  /** T or U in the ninth position. Null when the number was too short to read one. */
  readonly automatedSolicitation: boolean | null
}

/** What only a human can state about our own offer. Null everywhere means nothing is assumed. */
export type OperatorDeclarations = {
  readonly proposedUnitPriceUsd?: number | null
  readonly offeringUnusedFormerGovernmentSurplus?: boolean | null
  readonly esaCoordinationCount?: number | null
  readonly buyAmericanOrBalanceOfPayments?: boolean | null
}

/**
 * Map one award row.
 *
 * `effectiveUnitPrice` is carried because the export puts $1.00 placeholders in the Unit Price
 * column on rows whose real money is in the extended Final Price, and the awards module already
 * corrects for that by dividing. THE RAW COLUMNS ARE CARRIED BESIDE IT, and that is not
 * belt-and-braces: the same division fabricates a unit price on rows where the export puts a UNIT
 * price into the Final Price column. MEASURED over the live feed on 2026-08-18, across the 11,392
 * approved-source rows the anchor draws from: 68 rows where the derived figure and the stated Unit
 * Price disagree by more than a cent, 4 of them carrying Final Price EQUAL to Unit Price on a
 * multi-unit award, and ZERO carrying the $1.00 placeholder the division exists to repair. On NSN
 * 5905-01-413-6345 that division published $3.77 against a stated $94.26. So the quote view checks
 * the derivation against the row rather than trusting it, and it needs both columns to do that.
 */
export function toDossierAward(a: NsnAwardSummary['awards'][number]): DossierAward {
  return {
    awardDateIso: a.awardDateIso,
    effectiveUnitPriceUsd: a.effectiveUnitPrice,
    statedUnitPriceUsd: a.unitPrice,
    extendedPriceUsd: a.finalPrice,
    quantity: a.quantity,
    awardeeCage: a.cage,
    awardeeCompany: a.company,
    surplusAsWorded: a.surplus,
    contractNo: a.contractNo,
  }
}

/**
 * Assemble the quote view's input from an award summary, the solicitation row, and whatever the
 * operator has declared.
 *
 * `atInstantMs` is a required argument with no default. A default would be a wall-clock read
 * hidden in a helper, and every threshold and band the engine resolves is dated: the same row
 * priced in 2019 and in 2026 lands in different bands, correctly.
 */
export function quoteViewInputFromAwardSummary(args: {
  readonly summary: NsnAwardSummary
  readonly solicitation: SolicitationFacts
  readonly feedWindow: { readonly firstAwardIso: string | null; readonly lastAwardIso: string | null }
  readonly atInstantMs: number
  readonly declarations?: OperatorDeclarations
}): QuoteViewInput {
  const { summary, solicitation, feedWindow, atInstantMs } = args
  const d = args.declarations ?? {}
  return {
    nsn: summary.nsn,
    awards: summary.awards.map(toDossierAward),
    // The MCRL sheet's CAGEs. An empty list stays empty and is never widened into "anyone",
    // because the quote view reads an empty approved-source list as a silence rather than as a
    // statement that every awardee was a dealer.
    approvedSourceCages: summary.approvedSources
      .map((s) => s.cage)
      .filter((c): c is string => c !== null && c.trim() !== ''),
    solicitationQuantity: solicitation.quantity,
    solicitation: solicitation.solicitation,
    automatedSolicitation: solicitation.automatedSolicitation,
    atInstantMs,
    feedWindow,
    proposedUnitPriceUsd: d.proposedUnitPriceUsd ?? null,
    offeringUnusedFormerGovernmentSurplus: d.offeringUnusedFormerGovernmentSurplus ?? null,
    esaCoordinationCount: d.esaCoordinationCount ?? null,
    buyAmericanOrBalanceOfPayments: d.buyAmericanOrBalanceOfPayments ?? null,
  }
}
