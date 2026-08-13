import { describe, expect, it } from 'vitest'
import {
  RULES,
  citationLabel,
  quarantinedCitations,
  quotationOf,
} from '@/lib/compliance/citations'
import {
  cocTraceabilityWeight,
  cocZeroWeightReason,
  dodSupplyConditionCode,
  tradeConditionCode,
} from '@/lib/compliance/vocabularies'
import {
  IDENTIFIER_CONFIRMATION_THRESHOLD,
  acceptFact,
  extracted,
  measured,
  requireConfirmed,
} from '@/lib/compliance/confirmation'
import { bestReachableRung, evaluateProvenanceLadder } from '@/lib/compliance/provenance-ladder'
import { applyOverride, classifyLot } from '@/lib/compliance/classify'

const SRC = { kind: 'database_column', ref: 'lot.id', as_of: '2026-08-13T00:00:00Z' } as const
const OCR = (confidence?: number) =>
  ({
    kind: 'label_capture_ocr' as const,
    ref: 'label_capture:abc',
    as_of: '2026-08-13T00:00:00Z',
    ...(confidence === undefined ? {} : { field_confidence: confidence }),
  })

// =====================================================================================================
describe('citations: an unverified quote cannot become a quotation', () => {
  it('REFUSES to quote C03, whose clause text is quarantined', () => {
    const r = quotationOf(RULES.c03_retention)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toBe('unverified_pending_primary_pull')
    // The argument survives even though the quotation does not. That distinction is the whole point.
    expect(r.argument_instead).toContain('certification')
  })

  it('grants a quotation for a rule read in the primary source', () => {
    const r = quotationOf(RULES.c04_24_hour_clock)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.quote).toContain('24 hours')
  })

  it('lists C03 as quarantined so an honesty panel can render it', () => {
    const ids = quarantinedCitations().map((c) => c.id)
    expect(ids).toContain('c03_retention')
    // POSITIVE CONTROL: the list is not simply everything.
    expect(ids).not.toContain('c04_24_hour_clock')
  })
})

describe('citations: a moving revision number is not rendered to a customer unchecked', () => {
  it('refuses a customer label for a Rev-pinned citation with no live check', () => {
    const r = citationLabel(RULES.ms_surplus_ineligible_on_aidc, { audience: 'customer' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toBe('bare_revision_needs_live_check')
  })

  it('allows the same citation internally, because the operator may see what we built against', () => {
    const r = citationLabel(RULES.ms_surplus_ineligible_on_aidc, { audience: 'internal' })
    expect(r.ok).toBe(true)
  })

  it('allows a customer label once a live revision check is supplied', () => {
    const r = citationLabel(RULES.ms_surplus_ineligible_on_aidc, {
      audience: 'customer',
      liveCheck: { checked_revision: 'Rev-104', checked_at: '2026-08-13', checked_by: 'dhitchman' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.label).toContain('Rev-104')
  })
})

// =====================================================================================================
describe('vocabularies: a broker certificate of conformance satisfies nothing', () => {
  it('scores an independent distributor conformity-only C of C at ZERO traceability weight', () => {
    const coc = { issuer_role: 'independent_distributor', covers: 'conformity_only' } as const
    expect(cocTraceabilityWeight(coc)).toBe(0)
    expect(cocZeroWeightReason(coc)).toContain('attests conformity, not')
  })

  it('scores an approved-source provenance C of C at weight 1', () => {
    const coc = { issuer_role: 'approved_source', covers: 'provenance' } as const
    expect(cocTraceabilityWeight(coc)).toBe(1)
    expect(cocZeroWeightReason(coc)).toBeNull()
  })

  it('still scores zero when the issuer is right but the coverage is conformity only', () => {
    expect(cocTraceabilityWeight({ issuer_role: 'authorized_distributor', covers: 'conformity_only' })).toBe(0)
  })

  it('rejects a code outside the closed set rather than coercing it', () => {
    expect(tradeConditionCode('NS')).toBe('NS')
    expect(tradeConditionCode('XX')).toBeNull()
    expect(dodSupplyConditionCode('A')).toBe('A')
    // I and O are deliberately absent from the DoD condition code set.
    expect(dodSupplyConditionCode('I')).toBeNull()
  })
})

// =====================================================================================================
describe('confirmation: a low-confidence extraction cannot reach a determination', () => {
  it('treats confidence AT the threshold as needing confirmation', () => {
    const f = extracted('SPE4A626Q0227', OCR(IDENTIFIER_CONFIRMATION_THRESHOLD), 'Contract number.')
    expect('unconfirmed' in f).toBe(true)
  })

  it('treats confidence just below the threshold as needing confirmation', () => {
    const f = extracted('SPE4A626Q0227', OCR(0.9799), 'Contract number.')
    expect('unconfirmed' in f).toBe(true)
  })

  it('accepts confidence above the threshold', () => {
    const f = extracted('SPE4A626Q0227', OCR(0.99), 'Contract number.')
    expect('unconfirmed' in f).toBe(false)
  })

  it('treats ABSENT confidence as unconfirmed, never as passing', () => {
    // A column nobody wrote must not read as a measurement.
    const f = extracted('SPE4A626Q0227', OCR(undefined), 'Contract number.')
    expect('unconfirmed' in f).toBe(true)
    if (!('unconfirmed' in f)) throw new Error('unreachable')
    expect(f.needs_confirmation_because).toContain('no confidence')
  })

  it('requireConfirmed names the field and the next action instead of failing silently', () => {
    const f = extracted('X', OCR(0.5), 'Contract number.')
    if (!('unconfirmed' in f)) throw new Error('expected unconfirmed')
    const r = requireConfirmed('the original contract number', f)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toBe('unconfirmed')
    expect(r.statement).toContain('the original contract number')
    expect(r.next_action.length).toBeGreaterThan(0)
  })

  it('promotes on human acceptance, recording who and when, and allows a correction', () => {
    const f = extracted('SPE4A626Q0228', OCR(0.4), 'Contract number.')
    if (!('unconfirmed' in f)) throw new Error('expected unconfirmed')
    const ok = acceptFact(f, 'dgoodreau', '2026-08-13T12:00:00Z', 'SPE4A626Q0227')
    expect(ok.value).toBe('SPE4A626Q0227')
    expect(ok.accepted_by).toBe('dgoodreau')
    expect(requireConfirmed('contract number', ok).ok).toBe(true)
  })

  it('requireConfirmed reports a missing fact as insufficient, not as false', () => {
    const r = requireConfirmed('the acquisition channel', undefined)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toBe('insufficient')
  })
})

// =====================================================================================================
describe('provenance ladder: rung 3 needs all four markings, confirmed', () => {
  const m = (v: string) => measured(v, SRC)

  it('is NOT satisfied when the original contract number is missing', () => {
    const r = evaluateProvenanceLadder({
      markings_nsn: m('1650-01-059-8221'),
      markings_cage_code: m('99207'),
      markings_part_number: m('70550-28900-106'),
    })
    expect(r.highest_rung).toBeNull()
    const rung3 = r.rungs.find((x) => x.rung === 3)
    expect(rung3?.satisfied).toBe(false)
    if (rung3?.satisfied === false) {
      expect(rung3.missing.join(' ')).toContain('original contract number')
    }
  })

  it('is NOT satisfied by an unconfirmed OCR marking', () => {
    const shaky = extracted('SPE4A626Q0227', OCR(0.6), 'Contract number.')
    const r = evaluateProvenanceLadder({
      markings_nsn: m('1650-01-059-8221'),
      markings_cage_code: m('99207'),
      markings_part_number: m('70550-28900-106'),
      markings_original_contract_number: shaky,
    })
    expect(r.highest_rung).toBeNull()
  })

  it('is satisfied when all four are confirmed, and reports the gap upward', () => {
    const r = evaluateProvenanceLadder({
      markings_nsn: m('1650-01-059-8221'),
      markings_cage_code: m('99207'),
      markings_part_number: m('70550-28900-106'),
      markings_original_contract_number: m('SPE4A626Q0227'),
    })
    expect(r.highest_rung).toBe(3)
    expect(r.gap_to_next_rung_up?.target_rung).toBe(2)
    expect(r.gap_to_next_rung_up?.statement).toContain('rung 2')
  })

  it('rung 1 needs BOTH the 1427 and the sale solicitation', () => {
    const only1427 = evaluateProvenanceLadder({ form_1427_document_id: m('doc-1') })
    expect(only1427.highest_rung).toBeNull()
    const both = evaluateProvenanceLadder({
      form_1427_document_id: m('doc-1'),
      sale_solicitation_document_id: m('doc-2'),
    })
    expect(both.highest_rung).toBe(1)
    expect(both.gap_to_next_rung_up).toBeNull()
  })

  it('flags a packet that rests on an argument alone', () => {
    const r = evaluateProvenanceLadder({
      signed_provenance_narrative: {
        document_id: 'doc-9',
        signed_by: 'dhitchman',
        signed_at: '2026-08-13T00:00:00Z',
      },
    })
    expect(r.highest_rung).toBe(4)
    expect(r.rests_on_argument_only).toBe(true)
  })

  it('forecasts the reachable rung from the channel, and says a dealer buy caps at 3', () => {
    expect(bestReachableRung('dla_disposition_sale').rung).toBe(1)
    expect(bestReachableRung('dealer_purchase').rung).toBe(3)
    // An OEM channel does not establish government ownership at all.
    expect(bestReachableRung('oem_direct').rung).toBeNull()
  })
})

// =====================================================================================================
describe('classifier: the fork, and it fails closed', () => {
  const m = <T>(v: T) => measured(v, SRC)

  it('routes broker stock with no provenance to L04, which is the common true answer', () => {
    const d = classifyLot({
      lot_id: 'lot-1',
      material_condition: m('new_unused'),
      acquisition_channel: m('dealer_purchase'),
      provenance_evidence: {},
    })
    expect(d.path).toBe('l04_part_numbered_traceability')
    expect(d.category).toBe('commercial_surplus')
    expect(d.reasons[0]?.code).toBe('unused_but_government_ownership_not_shown')
    expect(d.what_would_change_it.length).toBeGreaterThan(0)
  })

  it('routes a disposition-sale lot with rung 1 evidence to C04', () => {
    const d = classifyLot({
      lot_id: 'lot-2',
      material_condition: m('new_unused'),
      acquisition_channel: m('dla_disposition_sale'),
      provenance_evidence: {
        form_1427_document_id: m('doc-1'),
        sale_solicitation_document_id: m('doc-2'),
      },
    })
    expect(d.path).toBe('c04_surplus_representation')
    expect(d.category).toBe('government_surplus')
    expect(d.citations.map((c) => c.id)).toContain('c04_24_hour_clock')
  })

  it('does NOT reach C04 on an unconfirmed contract number (the wrong-character case)', () => {
    const shaky = extracted('SPE4A626Q0227', OCR(0.55), 'Contract number.')
    const d = classifyLot({
      lot_id: 'lot-3',
      material_condition: m('new_unused'),
      acquisition_channel: m('dealer_purchase'),
      provenance_evidence: {
        markings_nsn: m('1650-01-059-8221'),
        markings_cage_code: m('99207'),
        markings_part_number: m('70550-28900-106'),
        markings_original_contract_number: shaky,
      },
    })
    expect(d.path).toBe('l04_part_numbered_traceability')
    expect(d.path).not.toBe('c04_surplus_representation')
  })

  it('returns UNKNOWN, not a path, when the condition is unconfirmed', () => {
    const d = classifyLot({
      lot_id: 'lot-4',
      acquisition_channel: m('dealer_purchase'),
      provenance_evidence: {},
    })
    expect(d.path).toBe('unknown')
    expect(d.category).toBe('UNKNOWN')
    expect(d.blocked_facts.length).toBeGreaterThan(0)
  })

  it('returns UNKNOWN for used material, and does not offer it as surplus', () => {
    const d = classifyLot({
      lot_id: 'lot-5',
      material_condition: m('reconditioned'),
      acquisition_channel: m('dealer_purchase'),
      provenance_evidence: {},
    })
    expect(d.path).toBe('unknown')
    expect(d.reasons[0]?.code).toBe('material_not_new_unused')
  })

  it('keeps the category UNKNOWN rather than guessing when the channel is unconfirmed', () => {
    const d = classifyLot({
      lot_id: 'lot-6',
      material_condition: m('new_unused'),
      provenance_evidence: {},
    })
    expect(d.path).toBe('l04_part_numbered_traceability')
    expect(d.category).toBe('UNKNOWN')
  })

  it('is re-derivable: same inputs, same determination', () => {
    const inputs = {
      lot_id: 'lot-7',
      material_condition: m('new_unused' as const),
      acquisition_channel: m('oem_overrun_purchase' as const),
      provenance_evidence: {},
    }
    expect(JSON.stringify(classifyLot(inputs))).toBe(JSON.stringify(classifyLot(inputs)))
    expect(classifyLot(inputs).category).toBe('oem_overrun')
  })

  it('records an override beside the machine answer, never instead of it', () => {
    const machine = classifyLot({
      lot_id: 'lot-8',
      material_condition: m('new_unused'),
      acquisition_channel: m('dealer_purchase'),
      provenance_evidence: {},
    })
    const o = applyOverride(machine, {
      lot_id: 'lot-8',
      overridden_to_path: 'c04_surplus_representation',
      overridden_to_category: 'government_surplus',
      written_basis: 'I bought this lot at the Warner Robins sale in 2019 and the 1427 is in the file cabinet.',
      actor_id: 'dhitchman',
      at: '2026-08-13T12:00:00Z',
    })
    expect(o.effective_path).toBe('c04_surplus_representation')
    expect(o.machine.path).toBe('l04_part_numbered_traceability')
    expect(o.disclosure).toContain('overriding the system determination')
    expect(o.disclosure).toContain('file cabinet')
  })
})
