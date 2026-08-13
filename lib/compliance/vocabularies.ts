/**
 * THE THREE CODE VOCABULARIES THAT MUST NEVER DERIVE FROM EACH OTHER.
 *
 * Three different vocabularies describe "new surplus" in this business and the corpus uses all three
 * interchangeably. They are not synonyms, and the research states the build rule directly: store them
 * as three independent fields and never derive one from another
 * (surplus-material-traceability-compliance.md section 1.4).
 *
 * WHY THIS IS A TYPE-LEVEL PROBLEM AND NOT A NAMING CONVENTION.
 * The failure is specific and it kills offers: a broker's marketing legend becomes a compliance
 * determination. A quote line coded "NS" (New Surplus) is a *sales* claim by a dealer. The seller's own
 * legend in the corpus reads "Majority will come with traceability back to the MFG or previous
 * supplier," and two words in that sentence are fatal. "Majority" means some fraction arrive with
 * nothing at all, so the code is a probability rather than a document. And "previous supplier" is the
 * wrong terminus, because the chain has to end at the approved manufacturing source with every
 * intermediary named. So NS is not evidence of anything, and any code path that could turn it into
 * evidence is a defect.
 *
 * The three types below are branded and therefore mutually unassignable. A function that wants a DLAD
 * material category cannot be handed a trade condition code, even though both are strings at runtime.
 * There is deliberately NO mapping function anywhere in this module, and `test/t5-compliance/`
 * asserts that absence, because the safest converter is the one that does not exist.
 */

// ---------------------------------------------------------------------------------------------------
// 1. TRADE CONDITION CODE. Commercial aviation aftermarket convention. Zero legal weight at DLA.
// ---------------------------------------------------------------------------------------------------

/**
 * The broker's marketing legend. Carried because it is what the seller's quote says and we must
 * record what we were told, never because it proves anything.
 */
export const TRADE_CONDITION_CODES = ['NE', 'NS', 'SV', 'AR', 'OH', 'FN'] as const
export type TradeConditionCodeValue = (typeof TRADE_CONDITION_CODES)[number]

declare const TRADE_CODE: unique symbol
export type TradeConditionCode = TradeConditionCodeValue & { readonly [TRADE_CODE]: true }

/** What the seller means by each code, in the seller's own framing, for display beside the code. */
export const TRADE_CONDITION_GLOSS: Readonly<Record<TradeConditionCodeValue, string>> = {
  NE: 'New Equipment. The seller expects most items to carry a manufacturer certificate of conformance.',
  NS: 'New Surplus. The seller expects most items to carry traceability to the manufacturer or to a previous supplier.',
  SV: 'Serviceable. Used and certified airworthy against a serviceable tag.',
  AR: 'As Removed. Condition unknown until inspected.',
  OH: 'Overhauled.',
  FN: 'Factory New.',
}

/**
 * The sentence that must appear wherever a trade code is displayed on a compliance surface. It exists
 * because an operator reading "NS" will otherwise supply the missing inference themselves.
 */
export const TRADE_CODE_DISCLAIMER =
  'A trade condition code is a seller claim about likelihood, not a document, and it carries no weight ' +
  'in a DLA solicitation. It never satisfies a traceability requirement.'

export function isTradeConditionCode(v: string): v is TradeConditionCodeValue {
  return (TRADE_CONDITION_CODES as readonly string[]).includes(v)
}

/** Mint a trade code. Rejects anything outside the closed set rather than coercing it. */
export function tradeConditionCode(v: string): TradeConditionCode | null {
  return isTradeConditionCode(v) ? (v as TradeConditionCode) : null
}

// ---------------------------------------------------------------------------------------------------
// 2. DOD SUPPLY CONDITION CODE. Appears on disposition sale documents. Not an input to acceptability.
// ---------------------------------------------------------------------------------------------------

/**
 * Single characters A through X, grouped serviceable / unserviceable / suspended. Nothing in C04 or
 * L04 references a supply condition code, so it appears on DLA Disposition Services sale paperwork but
 * is not an input to whether a quote is acceptable. We store it because it is on the document.
 */
export const DOD_SUPPLY_CONDITION_CODES = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M',
  'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'X',
] as const
export type DodSupplyConditionCodeValue = (typeof DOD_SUPPLY_CONDITION_CODES)[number]

declare const DOD_CODE: unique symbol
export type DodSupplyConditionCode = DodSupplyConditionCodeValue & { readonly [DOD_CODE]: true }

export type DodConditionGroup = 'serviceable' | 'unserviceable' | 'suspended'

/**
 * Grouping per DLM 4000.25 Volume 2 Appendix 2.5, reported through a secondary reference because the
 * DLA-hosted primary refuses automated retrieval. Labeled REPORTED rather than VERIFIED on purpose:
 * the grouping informs display only, and no determination may rest on it.
 */
export const DOD_CONDITION_GROUP: Readonly<Record<DodSupplyConditionCodeValue, DodConditionGroup>> = {
  A: 'serviceable', B: 'serviceable', C: 'serviceable', D: 'serviceable',
  T: 'serviceable', U: 'serviceable',
  E: 'unserviceable', F: 'unserviceable', G: 'unserviceable', H: 'unserviceable',
  P: 'unserviceable', S: 'unserviceable', V: 'unserviceable',
  J: 'suspended', K: 'suspended', L: 'suspended', M: 'suspended', N: 'suspended',
  Q: 'suspended', R: 'suspended', X: 'suspended',
}

export const DOD_CONDITION_PROVENANCE = 'REPORTED' as const

export function isDodSupplyConditionCode(v: string): v is DodSupplyConditionCodeValue {
  return (DOD_SUPPLY_CONDITION_CODES as readonly string[]).includes(v)
}

export function dodSupplyConditionCode(v: string): DodSupplyConditionCode | null {
  return isDodSupplyConditionCode(v) ? (v as DodSupplyConditionCode) : null
}

// ---------------------------------------------------------------------------------------------------
// 3. DLAD MATERIAL CATEGORY, and the axis correction the estate needs to see
// ---------------------------------------------------------------------------------------------------

/**
 * The enum as the research proposes it, carried complete so there is one spelling of it in the estate.
 *
 * BUT NOTE THE AXIS SPLIT, which this lane posted to the claims file and which matters at the type
 * level. The first four values answer "who owned it before us" and are properties of the LOT. The last
 * two answer "what is this offer relative to the item description" and are properties of the CANDIDATE,
 * a lot joined to a specific requirement. They are also only two of L04's five self-classification
 * buckets. Forcing one field to carry both axes means an OEM overrun quoted as an exact product has to
 * discard one true fact in order to store the other, so the two axes are separated below while the enum
 * itself stays whole.
 */
export const DLAD_MATERIAL_CATEGORIES = [
  'government_surplus',
  'commercial_surplus',
  'oem_overrun',
  'terminated_contract_residual',
  'exact_product',
  'alternate_product',
] as const
export type DladMaterialCategory = (typeof DLAD_MATERIAL_CATEGORIES)[number]

/** The four values a LOT may carry. Provenance axis: who owned the material before us. */
export const LOT_PROVENANCE_CATEGORIES = [
  'government_surplus',
  'commercial_surplus',
  'oem_overrun',
  'terminated_contract_residual',
] as const
export type LotProvenanceCategory = (typeof LOT_PROVENANCE_CATEGORIES)[number]

/**
 * What a lot's category resolves to, including the answer we will give most often for broker stock.
 * UNKNOWN is a legitimate, visible, shippable answer and is never softened into a recommendation.
 */
export type LotCategoryOutcome = LotProvenanceCategory | 'UNKNOWN'

/**
 * L04's five self-classification buckets, which the offeror must pick per contract line item.
 * `exact_product` and `alternate_product` live here, on the candidate, where they belong.
 */
export const L04_SELF_CLASSIFICATIONS = [
  'exact_product',
  'alternate_product',
  'superseding_part_number',
  'previously_approved_product',
  'cage_or_part_number_correction',
] as const
export type L04SelfClassification = (typeof L04_SELF_CLASSIFICATIONS)[number]

export function isLotProvenanceCategory(v: string): v is LotProvenanceCategory {
  return (LOT_PROVENANCE_CATEGORIES as readonly string[]).includes(v)
}

// ---------------------------------------------------------------------------------------------------
// THE COMPLIANCE PATH
// ---------------------------------------------------------------------------------------------------

/**
 * Which legal product this lot is, which decides the document set, the clock and the failure mode.
 * `unknown` is shippable: it routes the lot to a worklist and blocks a surplus representation, which is
 * far better than guessing C04 and inviting a request for a disposition document that does not exist.
 */
export type CompliancePath =
  | 'c04_surplus_representation'
  | 'l04_part_numbered_traceability'
  | 'unknown'

export const COMPLIANCE_PATH_RULE: Readonly<Record<CompliancePath, string | null>> = {
  c04_surplus_representation: 'c04_carve_out',
  l04_part_numbered_traceability: 'c04_carve_out',
  unknown: null,
}

/** Operator-facing name for each path. Written here so every surface says the same words. */
export const COMPLIANCE_PATH_LABEL: Readonly<Record<CompliancePath, string>> = {
  c04_surplus_representation:
    'C04 surplus representation, DLAD 11.390. Nine-block representation with the offer, supporting ' +
    'documentation due within 24 hours of request.',
  l04_part_numbered_traceability:
    'L04 part-numbered traceability, DLAD 11.391. Traceability to the approved manufacturing source, ' +
    'evidence due within 2 days of request.',
  unknown:
    'Not yet classified. Neither path may be asserted, so nothing is drafted and no representation is ' +
    'filed until the deciding facts are captured.',
}

/**
 * Certificate of Conformance modelling, and the conflation trap it exists to stop.
 *
 * Two different documents share this name. FAR 52.246-15 is the offeror's OWN certificate, a Government
 * contract clause artifact we may legitimately generate. A commercial manufacturer's C of C attests
 * conformity, not provenance. A C of C issued by an independent distributor that covers conformity only
 * satisfies nothing under DLAD 11.392 and carries zero traceability weight. A document lane shipped
 * without this distinction accepts a broker C of C as traceability evidence, which is precisely the
 * failure this lane exists to prevent.
 */
export const COC_ISSUER_ROLES = [
  'approved_source',
  'authorized_distributor',
  'independent_distributor',
  'offeror',
] as const
export type CocIssuerRole = (typeof COC_ISSUER_ROLES)[number]

export const COC_COVERAGE = ['conformity_only', 'provenance', 'both'] as const
export type CocCoverage = (typeof COC_COVERAGE)[number]

export type CertificateOfConformance = {
  readonly issuer_role: CocIssuerRole
  readonly covers: CocCoverage
}

/**
 * Traceability weight of a certificate of conformance under DLAD 11.392: zero unless the issuer is a
 * source whose word establishes provenance AND the certificate actually covers provenance.
 *
 * Deliberately returns 0 rather than throwing for the broker case, because a zero-weight document is a
 * normal thing to hold: we still file it, we simply never let it satisfy a traceability requirement.
 */
export function cocTraceabilityWeight(coc: CertificateOfConformance): 0 | 1 {
  const issuerEstablishesProvenance =
    coc.issuer_role === 'approved_source' || coc.issuer_role === 'authorized_distributor'
  const coversProvenance = coc.covers === 'provenance' || coc.covers === 'both'
  return issuerEstablishesProvenance && coversProvenance ? 1 : 0
}

/** Why a certificate scored zero, in operator vocabulary, so the verdict is never bare. */
export function cocZeroWeightReason(coc: CertificateOfConformance): string | null {
  if (cocTraceabilityWeight(coc) === 1) return null
  if (coc.issuer_role === 'independent_distributor' || coc.issuer_role === 'offeror') {
    return (
      `A certificate of conformance from ${coc.issuer_role.replace(/_/g, ' ')} attests conformity, not ` +
      'provenance. It does not establish the line of ownership back to the approved source, so it ' +
      'carries no traceability weight under DLAD 11.392. It is filed as evidence, and it does not ' +
      'satisfy the traceability requirement.'
    )
  }
  return (
    'This certificate covers conformity only. Traceability under DLAD 11.392 needs the line of ' +
    'ownership from the approved source, which a conformity statement does not provide.'
  )
}
