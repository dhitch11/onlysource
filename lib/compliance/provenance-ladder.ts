/**
 * THE PROVENANCE LADDER: the four acceptable proofs of prior Government ownership, as a descending
 * ladder rather than a set.
 *
 * C04 lists four ways to demonstrate the offered material was previously owned by the Government. They
 * are not equivalent, and modelling them as a set loses the fact that matters commercially: which rung
 * you can reach is decided by the acquisition channel, so provenance strength is a SOURCING decision
 * made before the money moves, not a paperwork decision made when a request arrives.
 *
 * Rung 1 and 2 exist only for a purchaser at the government sale itself. A dealer buying second-hand
 * from another dealer usually reaches only rung 3, the package markings, and only if somebody
 * photographed the package before it was repacked. Rung 4 is an argument, not a document.
 *
 * WHY THIS MODULE COMPUTES A GAP AND NOT JUST A RUNG.
 * "You are on rung 3" is a status. "You are on rung 3, and the bill of sale would put you on rung 2"
 * is a task, and the charter requires every verdict to say what would change it. The gap is the
 * product feature; the rung is just the label on it.
 */

import { RULES, type RuleCitation } from './citations'
import { requireConfirmed, type Fact } from './confirmation'

/** 1 is strongest. Lower number, stronger proof. */
export type ProvenanceRung = 1 | 2 | 3 | 4

export const RUNG_NAME: Readonly<Record<ProvenanceRung, string>> = {
  1: 'Government sale award and release document',
  2: 'Commercial Venture sale receipt chain',
  3: 'Copy or facsimile of all original package markings',
  4: 'Other information demonstrating prior Government ownership',
}

export const RUNG_DETAIL: Readonly<Record<ProvenanceRung, string>> = {
  1:
    'The sale solicitation or Invitation For Bid together with the corresponding DLA Disposition ' +
    'Services Form 1427, Notice of Award, Statement and Release Document. The strongest rung, and it ' +
    'exists only if we or a traceable predecessor bought at that sale.',
  2:
    'For a DLA Disposition Services Commercial Venture sale, the shipment receipt or delivery pass ' +
    "document together with the invoices and receipts the original purchaser used to resell the " +
    'material.',
  3:
    'A copy or facsimile of all original package markings and data, including the national stock ' +
    'number, the CAGE code, the part number and the original contract number. This is the rung a ' +
    'dealer buying from another dealer can usually reach, and only if somebody photographed the ' +
    'package before it was repacked.',
  4:
    'Other information demonstrating prior Government ownership. This is an argument rather than a ' +
    'document. A human drafts it and a human signs it, and when a packet rests on this rung the packet ' +
    'says so plainly.',
}

/**
 * Evidence a lot may carry. Each is either present and confirmed, or it is not; there is no
 * "probably" and no partial credit, because a contracting officer either has the document or does not.
 */
export type ProvenanceEvidence = {
  /** Rung 1 needs BOTH: the award and release document AND the sale solicitation it belongs to. */
  readonly form_1427_document_id?: Fact<string>
  readonly sale_solicitation_document_id?: Fact<string>

  /** Rung 2 needs BOTH the receipt or delivery pass AND the original purchaser's resale documents. */
  readonly cv_sale_receipt_document_id?: Fact<string>
  readonly original_purchaser_resale_document_id?: Fact<string>

  /**
   * Rung 3 needs the four named markings, each confirmed. A label photograph missing the original
   * contract number does not satisfy the rung, and the original contract number is the single
   * highest-value field on the label because it is the hook that supports a prior-ownership claim when
   * the sale documents are gone.
   */
  readonly markings_nsn?: Fact<string>
  readonly markings_cage_code?: Fact<string>
  readonly markings_part_number?: Fact<string>
  readonly markings_original_contract_number?: Fact<string>

  /** Rung 4: a narrative drafted and signed by a person. Never model-generated. */
  readonly signed_provenance_narrative?: {
    readonly document_id: string
    readonly signed_by: string
    readonly signed_at: string
  }

  /**
   * The prescribed instrument when material changes hands between companies. Not itself a rung, but it
   * is what carries 1427-backed provenance forward, so we ask for it by name at buy time and record
   * whether it was provided.
   */
  readonly bill_of_sale_document_id?: Fact<string>
}

export type RungState =
  | { readonly rung: ProvenanceRung; readonly satisfied: true; readonly satisfied_by: readonly string[] }
  | {
      readonly rung: ProvenanceRung
      readonly satisfied: false
      /** Exactly what is absent, named, so the gap is actionable. */
      readonly missing: readonly string[]
    }

export type LadderResult = {
  /** The strongest rung actually satisfied, or null when none is. */
  readonly highest_rung: ProvenanceRung | null
  readonly rungs: readonly RungState[]
  /**
   * What it would take to climb one rung. Null when already on rung 1, or when no rung is satisfied
   * (in which case the missing lists on each rung are the actionable content).
   */
  readonly gap_to_next_rung_up: {
    readonly target_rung: ProvenanceRung
    readonly needs: readonly string[]
    readonly statement: string
  } | null
  readonly bill_of_sale_present: boolean
  readonly citation: RuleCitation
  /** True when the only thing we could reach is an argument, which the packet must state plainly. */
  readonly rests_on_argument_only: boolean
}

/**
 * Present, confirmed, AND not blank. An unconfirmed document reference does not satisfy a rung, and
 * neither does a confirmed one whose value is whitespace.
 *
 * THE BLANK CHECK IS NOT DEFENSIVE PADDING. T4's audit found that whitespace-only input read as
 * captured elsewhere in this lane, and the same class of defect lands harder here: a document id of
 * three spaces would have satisfied rung 1, which is the strongest available proof of prior
 * Government ownership, on a lot that has no such document at all. That is a false representation
 * with a signature waiting to go on it, and it is exactly the failure mode this whole module exists
 * to prevent. A reference that is only whitespace is not a reference.
 */
function has(f: Fact<string> | undefined, label: string): { ok: boolean; missing?: string } {
  const r = requireConfirmed(label, f)
  if (!r.ok) return { ok: false, missing: label }
  if (r.fact.value.trim() === '') return { ok: false, missing: label }
  return { ok: true }
}

/**
 * Evaluate the ladder. Pure: no clock, no IO, same inputs give the same result forever, which is what
 * makes a determination re-derivable years later when somebody asks what we knew.
 */
export function evaluateProvenanceLadder(ev: ProvenanceEvidence): LadderResult {
  const rungs: RungState[] = []

  // Rung 1
  {
    const a = has(ev.form_1427_document_id, 'DLA Disposition Services Form 1427')
    const b = has(ev.sale_solicitation_document_id, 'the sale solicitation or Invitation For Bid')
    const missing = [a.missing, b.missing].filter((m): m is string => m !== undefined)
    rungs.push(
      missing.length === 0
        ? { rung: 1, satisfied: true, satisfied_by: ['DLA Disposition Services Form 1427', 'sale solicitation'] }
        : { rung: 1, satisfied: false, missing },
    )
  }

  // Rung 2
  {
    const a = has(ev.cv_sale_receipt_document_id, 'the Commercial Venture shipment receipt or delivery pass')
    const b = has(ev.original_purchaser_resale_document_id, "the original purchaser's resale documents")
    const missing = [a.missing, b.missing].filter((m): m is string => m !== undefined)
    rungs.push(
      missing.length === 0
        ? { rung: 2, satisfied: true, satisfied_by: ['CV sale receipt', 'original purchaser resale documents'] }
        : { rung: 2, satisfied: false, missing },
    )
  }

  // Rung 3
  {
    const parts = [
      has(ev.markings_nsn, 'the national stock number on the original package'),
      has(ev.markings_cage_code, 'the CAGE code on the original package'),
      has(ev.markings_part_number, 'the part number on the original package'),
      has(ev.markings_original_contract_number, 'the original contract number on the original package'),
    ]
    const missing = parts.map((p) => p.missing).filter((m): m is string => m !== undefined)
    rungs.push(
      missing.length === 0
        ? { rung: 3, satisfied: true, satisfied_by: ['original package markings, all four required fields'] }
        : { rung: 3, satisfied: false, missing },
    )
  }

  // Rung 4
  {
    const n = ev.signed_provenance_narrative
    rungs.push(
      n !== undefined
        ? { rung: 4, satisfied: true, satisfied_by: [`signed provenance narrative, signed by ${n.signed_by}`] }
        : {
            rung: 4,
            satisfied: false,
            missing: ['a written provenance narrative drafted and signed by a person'],
          },
    )
  }

  const satisfied = rungs.filter((r) => r.satisfied).map((r) => r.rung)
  const highest = satisfied.length > 0 ? (Math.min(...satisfied) as ProvenanceRung) : null

  let gap: LadderResult['gap_to_next_rung_up'] = null
  if (highest !== null && highest > 1) {
    const target = (highest - 1) as ProvenanceRung
    const targetState = rungs.find((r) => r.rung === target)
    const needs = targetState && !targetState.satisfied ? targetState.missing : []
    gap = {
      target_rung: target,
      needs,
      statement:
        `This lot rests on rung ${highest}, ${RUNG_NAME[highest]}. Obtaining ` +
        `${needs.join(' and ')} would move it to rung ${target}, ${RUNG_NAME[target]}, which is ` +
        'stronger evidence of prior Government ownership.',
    }
  }

  return {
    highest_rung: highest,
    rungs,
    gap_to_next_rung_up: gap,
    bill_of_sale_present: requireConfirmed('bill of sale', ev.bill_of_sale_document_id).ok,
    citation: RULES.c04_provenance_proofs,
    rests_on_argument_only: highest === 4,
  }
}

/**
 * What rung a PROSPECTIVE purchase would land on, given only the channel, before any money moves.
 *
 * This is the feature that changes what the company buys, so it is deliberately conservative: it
 * returns the BEST rung the channel could support if the documents exist, and it is explicit that the
 * documents still have to actually arrive. It is a sourcing forecast, never a determination.
 */
export type AcquisitionChannel =
  | 'dla_disposition_sale'
  | 'dla_commercial_venture_sale'
  | 'dealer_purchase'
  | 'oem_direct'
  | 'oem_overrun_purchase'
  | 'terminated_contract_purchase'
  | 'affiliate_transfer'
  | 'unknown'

export function bestReachableRung(channel: AcquisitionChannel): {
  readonly rung: ProvenanceRung | null
  readonly statement: string
} {
  switch (channel) {
    case 'dla_disposition_sale':
      return {
        rung: 1,
        statement:
          'Buying at a DLA Disposition Services sale can reach rung 1 if the Form 1427 and the sale ' +
          'solicitation are obtained and kept. Ask for both at purchase.',
      }
    case 'dla_commercial_venture_sale':
      return {
        rung: 2,
        statement:
          'A Commercial Venture sale can reach rung 2 if the shipment receipt and the original ' +
          "purchaser's resale documents are obtained. Ask for both at purchase.",
      }
    case 'dealer_purchase':
      return {
        rung: 3,
        statement:
          'A dealer-to-dealer purchase can usually reach rung 3 at best, and only if the original ' +
          'package markings are photographed before repacking, including the original contract ' +
          'number. Ask for the label and the bill of sale before issuing the purchase order.',
      }
    case 'affiliate_transfer':
      return {
        rung: 3,
        statement:
          'An affiliate transfer inherits whatever the affiliate holds, so the reachable rung is ' +
          "theirs, not ours. Obtain the affiliate's provenance documents and the bill of sale that " +
          'evidences the transfer.',
      }
    case 'oem_direct':
    case 'oem_overrun_purchase':
    case 'terminated_contract_purchase':
      return {
        rung: null,
        statement:
          'This channel does not establish prior Government ownership at all, so no provenance rung ' +
          'applies. This material belongs on the L04 traceability path, where the evidence needed is ' +
          'traceability to the approved manufacturing source.',
      }
    case 'unknown':
      return {
        rung: null,
        statement:
          'The acquisition channel has not been recorded, so no reachable rung can be forecast. ' +
          'Record the channel at intake.',
      }
  }
}
