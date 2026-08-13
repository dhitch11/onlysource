/**
 * THE C04 VS L04 CLASSIFIER. Nothing may be drafted until this has run.
 *
 * C04 and L04 are two legally different products with two document sets, two clocks and two failure
 * modes, and the fork is decided by ONE question: who owned the material before us. Not whether it is
 * unused. The distinction is the whole reason this lane exists, and the research states the consequence
 * plainly: quote broker-to-broker stock as surplus under C04 and the contracting officer asks for a
 * disposition document that does not exist, and the offer dies on the spot.
 *
 * THREE PROPERTIES THIS MODULE HOLDS ON PURPOSE.
 *
 * 1. IT IS DETERMINISTIC CODE AND NO MODEL TOUCHES IT. There is no string input from an AI service
 *    anywhere in the signature. A determination is a function of stored facts, so it is re-derivable:
 *    given the same inputs it returns the same answer in year four as it did on the day it was made,
 *    which is what makes a reclassification auditable rather than a mystery.
 *
 * 2. UNKNOWN IS A REAL ANSWER AND IS NEVER SOFTENED. It routes the lot to a worklist and blocks a
 *    surplus representation. The most common true answer for broker stock is "the material is unused,
 *    and we cannot show it was ever government-owned," and surfacing that at acquisition is worth more
 *    than any downstream automation. A classifier that guessed C04 to avoid saying UNKNOWN would be
 *    manufacturing exactly the offer that dies.
 *
 * 3. IT FAILS CLOSED, AND CLOSED HERE MEANS L04 OR UNKNOWN, NEVER C04. Absence of provenance evidence
 *    is never read as provenance. If we cannot even establish the material is new and unused, neither
 *    path may be asserted and the answer is UNKNOWN, because L04 is not a dumping ground either.
 */

import { RULES, type RuleCitation } from './citations'
import { requireConfirmed, type Fact, type FactRequirementFailure } from './confirmation'
import {
  evaluateProvenanceLadder,
  type AcquisitionChannel,
  type LadderResult,
  type ProvenanceEvidence,
} from './provenance-ladder'
import type { CompliancePath, LotCategoryOutcome } from './vocabularies'

/**
 * Bump when the rules change. A stored determination carries the version that produced it, so a later
 * disagreement between two determinations is attributable to a rule change rather than to a ghost.
 */
export const CLASSIFIER_VERSION = 1

/** What the material is, as a matter of condition. Separate from who owned it. */
export type MaterialCondition = 'new_unused' | 'used' | 'reconditioned' | 'remanufactured'

export type ClassifierInputs = {
  readonly lot_id: string
  /**
   * Whether the material is new and unused, per C04 item (1). A Fact, so an unconfirmed OCR read or an
   * unrecorded field cannot silently satisfy it.
   */
  readonly material_condition?: Fact<MaterialCondition>
  readonly acquisition_channel?: Fact<AcquisitionChannel>
  readonly provenance_evidence: ProvenanceEvidence
}

export type ClassifierReason = {
  readonly code: string
  /** Operator vocabulary, names the deciding field, never a bare code. */
  readonly statement: string
  readonly deciding_field: string
  readonly rule_id: string | null
}

export type Determination = {
  readonly lot_id: string
  readonly path: CompliancePath
  readonly category: LotCategoryOutcome
  readonly reasons: readonly ClassifierReason[]
  /** Every verdict says what would change it. This is that, and it is required, never optional. */
  readonly what_would_change_it: readonly string[]
  readonly ladder: LadderResult
  readonly citations: readonly RuleCitation[]
  readonly classifier_version: number
  /** Echoed so the determination is re-derivable without the original caller. */
  readonly inputs_echo: {
    readonly material_condition: MaterialCondition | 'unconfirmed_or_absent'
    readonly acquisition_channel: AcquisitionChannel | 'unconfirmed_or_absent'
    readonly highest_provenance_rung: number | null
  }
  /** Gates that could not run, named. Present so a caller cannot mistake silence for a pass. */
  readonly blocked_facts: readonly FactRequirementFailure[]
}

function categoryFromChannel(channel: AcquisitionChannel): LotCategoryOutcome {
  switch (channel) {
    case 'oem_overrun_purchase':
      return 'oem_overrun'
    case 'terminated_contract_purchase':
      return 'terminated_contract_residual'
    case 'dealer_purchase':
      return 'commercial_surplus'
    case 'oem_direct':
      // Material bought new from the maker is not surplus of any kind. Saying commercial_surplus here
      // would be a small lie that a downstream filter would treat as a fact.
      return 'UNKNOWN'
    case 'dla_disposition_sale':
    case 'dla_commercial_venture_sale':
      return 'government_surplus'
    case 'affiliate_transfer':
    case 'unknown':
      return 'UNKNOWN'
  }
}

/**
 * Classify a lot. Pure function of stored facts.
 *
 * Order of reasoning matters and is deliberate: condition first, because if the material is not new and
 * unused then neither surplus path is available at all and the provenance question is moot. Then
 * provenance, because that is the fork. Channel only colours the category.
 */
export function classifyLot(inputs: ClassifierInputs): Determination {
  const reasons: ClassifierReason[] = []
  const blocked: FactRequirementFailure[] = []
  const citations: RuleCitation[] = [RULES.c04_carve_out]

  const ladder = evaluateProvenanceLadder(inputs.provenance_evidence)

  const conditionReq = requireConfirmed('the material condition (new and unused)', inputs.material_condition)
  const channelReq = requireConfirmed('the acquisition channel', inputs.acquisition_channel)
  if (!conditionReq.ok) blocked.push(conditionReq)
  if (!channelReq.ok) blocked.push(channelReq)

  const condition = conditionReq.ok ? conditionReq.fact.value : null
  const channel = channelReq.ok ? channelReq.fact.value : null

  const inputs_echo = {
    material_condition: condition ?? ('unconfirmed_or_absent' as const),
    acquisition_channel: channel ?? ('unconfirmed_or_absent' as const),
    highest_provenance_rung: ladder.highest_rung,
  }

  // ---- Condition gate. Not new and unused means neither surplus path is on the table.
  if (condition !== null && condition !== 'new_unused') {
    citations.push(RULES.c04_acceptability)
    reasons.push({
      code: 'material_not_new_unused',
      statement:
        `The recorded condition is ${condition.replace(/_/g, ' ')}. C04 requires material that is new ` +
        'and unused, so this lot cannot be offered as unused former Government surplus, and offers of ' +
        'used, reconditioned or remanufactured supplies must be coordinated with the product ' +
        'specialist rather than classified here.',
      deciding_field: 'material_condition',
      rule_id: RULES.c04_acceptability.id,
    })
    return {
      lot_id: inputs.lot_id,
      path: 'unknown',
      category: 'UNKNOWN',
      reasons,
      what_would_change_it: [
        'Nothing about documentation changes this. The condition itself is the bar, and a used or ' +
          'reconditioned item is a different conversation with the product specialist.',
      ],
      ladder,
      citations,
      classifier_version: CLASSIFIER_VERSION,
      inputs_echo,
      blocked_facts: blocked,
    }
  }

  // ---- Cannot establish condition at all. Fail closed to UNKNOWN, never to a path.
  if (condition === null) {
    reasons.push({
      code: 'condition_unconfirmed',
      statement:
        'Whether this material is new and unused has not been confirmed, so no compliance path can be ' +
        'asserted. This is not a documentation gap, it is the first fact the classification needs.',
      deciding_field: 'material_condition',
      rule_id: RULES.c04_acceptability.id,
    })
    return {
      lot_id: inputs.lot_id,
      path: 'unknown',
      category: 'UNKNOWN',
      reasons,
      what_would_change_it: [
        'Confirm the material condition at intake. Once it is recorded as new and unused, the ' +
          'provenance evidence on this lot decides between the C04 and L04 paths.',
      ],
      ladder,
      citations,
      classifier_version: CLASSIFIER_VERSION,
      inputs_echo,
      blocked_facts: blocked,
    }
  }

  // ---- Material is new and unused. Now the fork: can we show prior Government ownership.
  if (ladder.highest_rung !== null) {
    reasons.push({
      code: 'prior_government_ownership_evidenced',
      statement:
        `Prior Government ownership is evidenced at rung ${ladder.highest_rung}. This lot goes down the ` +
        'C04 surplus representation path: the nine-block representation is filed with the offer and ' +
        'supporting documentation is due within 24 hours of a request.',
      deciding_field: 'provenance_evidence',
      rule_id: RULES.c04_provenance_proofs.id,
    })
    citations.push(RULES.c04_provenance_proofs, RULES.c04_24_hour_clock, RULES.m05_evaluation_factors)

    if (ladder.rests_on_argument_only) {
      reasons.push({
        code: 'rests_on_argument_only',
        statement:
          'The only provenance evidence is rung 4, a written argument rather than a document. The ' +
          'packet must say so plainly, and a person signs it.',
        deciding_field: 'provenance_evidence.signed_provenance_narrative',
        rule_id: RULES.c04_provenance_proofs.id,
      })
    }

    const changes: string[] = []
    if (ladder.gap_to_next_rung_up) changes.push(ladder.gap_to_next_rung_up.statement)
    if (!ladder.bill_of_sale_present) {
      changes.push(
        'The bill of sale is the prescribed instrument when material changes hands between companies ' +
          'and it is not on file for this lot. Ask for it by name and record whether it was provided.',
      )
    }
    changes.push(
      'New evidence does not edit this determination. It produces a new versioned determination, and ' +
        'both remain on the record.',
    )

    return {
      lot_id: inputs.lot_id,
      path: 'c04_surplus_representation',
      category: 'government_surplus',
      reasons,
      what_would_change_it: changes,
      ladder,
      citations,
      classifier_version: CLASSIFIER_VERSION,
      inputs_echo,
      blocked_facts: blocked,
    }
  }

  // ---- New and unused, no provenance evidence. The most common true answer for broker stock.
  reasons.push({
    code: 'unused_but_government_ownership_not_shown',
    statement:
      'The material is unused, and we cannot show it was ever government-owned. Nothing in a ' +
      'dealer-to-dealer purchase establishes prior Government ownership, so this lot goes down the L04 ' +
      'part-numbered traceability path: traceability to the approved manufacturing source, with ' +
      'evidence due within 2 days of a request. Quoting it as surplus under C04 would invite a request ' +
      'for a disposition document that does not exist.',
    deciding_field: 'provenance_evidence',
    rule_id: RULES.c04_carve_out.id,
  })
  citations.push(RULES.l04_traceability_2_day, RULES.cdap_complete_line_of_ownership)

  const category = channel !== null ? categoryFromChannel(channel) : 'UNKNOWN'
  if (category === 'UNKNOWN') {
    reasons.push({
      code: 'category_unknown',
      statement:
        channel === null
          ? 'The acquisition channel has not been confirmed, so the material category stays UNKNOWN. ' +
            'The path is still L04, because the path turns on the absence of Government ownership ' +
            'rather than on the channel.'
          : `The recorded channel, ${channel.replace(/_/g, ' ')}, does not by itself resolve which ` +
            'material category applies, so the category stays UNKNOWN rather than being guessed. The ' +
            'L04 path is unaffected.',
      deciding_field: 'acquisition_channel',
      rule_id: null,
    })
  }

  return {
    lot_id: inputs.lot_id,
    path: 'l04_part_numbered_traceability',
    category,
    reasons,
    what_would_change_it: [
      'Evidence of prior Government ownership would move this lot to the C04 path. The reachable ' +
        'evidence is decided by where it was bought: the Form 1427 and sale solicitation from a ' +
        'disposition sale, the receipt chain from a Commercial Venture sale, or a photograph of all ' +
        'original package markings including the original contract number.',
      'On the L04 path the evidence that matters is traceability to the approved manufacturing source ' +
        'with every intermediary named, so an invoice from the dealer we bought from proves one hop ' +
        'and not the hop above it.',
    ],
    ladder,
    citations,
    classifier_version: CLASSIFIER_VERSION,
    inputs_echo,
    blocked_facts: blocked,
  }
}

// ---------------------------------------------------------------------------------------------------
// OVERRIDE
// ---------------------------------------------------------------------------------------------------

export type ClassificationOverride = {
  readonly lot_id: string
  readonly overridden_to_path: CompliancePath
  readonly overridden_to_category: LotCategoryOutcome
  /** Required. An override with no stated basis is not a judgment, it is a change nobody can defend. */
  readonly written_basis: string
  readonly actor_id: string
  readonly at: string
}

export type OverriddenDetermination = {
  readonly machine: Determination
  readonly override: ClassificationOverride
  readonly effective_path: CompliancePath
  readonly effective_category: LotCategoryOutcome
  /** Rendered wherever the overridden value appears, so the machine answer is never hidden. */
  readonly disclosure: string
}

/**
 * Record an operator override.
 *
 * The principal has forty years of judgment and will sometimes be right when the data is thin, so the
 * override exists. It is a NEW versioned determination rather than an edit, the machine determination
 * stays visible beside it, and the basis, identity and instant are all required, because an override
 * that cannot be interrogated later is indistinguishable from a mistake.
 */
export function applyOverride(
  machine: Determination,
  override: ClassificationOverride,
): OverriddenDetermination {
  return {
    machine,
    override,
    effective_path: override.overridden_to_path,
    effective_category: override.overridden_to_category,
    disclosure:
      `Set to ${override.overridden_to_path} by ${override.actor_id} on ${override.at}, overriding the ` +
      `system determination of ${machine.path}. Stated basis: ${override.written_basis}`,
  }
}
