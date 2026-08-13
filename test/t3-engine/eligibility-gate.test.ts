/**
 * T3 ENGINE. The structural eligibility gate, and the three inversions that make it worth writing.
 *
 * THE INSTRUMENT IS BUILT TO BE ABLE TO FAIL. Every expectation below is a literal written out by
 * hand after tracing the module, never a value re-derived by calling the code under test. The reason
 * arrays are spelled out in full and in order, so a rule that stops firing, starts firing, or fires
 * in a different place fails the assertion instead of sliding past it.
 *
 * THREE PROPERTIES THIS FILE EXISTS TO PIN, EACH THE OPPOSITE OF THE OBVIOUS READING:
 *
 * 1. THE AIDC INVERSION. One character decides whether unused former Government surplus is welcome
 *    or is out of automated award. The paired test below feeds byte-identical rows differing only in
 *    the ninth position character and asserts the verdicts DIFFER. An implementation that applied
 *    the ordinary Part I rule everywhere passes every single-row test and fails that pair.
 *
 * 2. THE AMSC TRAP, and it is the single most important assertion in this file. A restricted AMSC
 *    reads as "closed" to everyone who has not read the warning beneath Table 71. An engine that
 *    emitted 'ineligible' from it would delete exactly the monopoly shaped rows the product exists
 *    to find, and it would look correct while doing it. Every one of the twenty codes is run through
 *    a live surplus row and none may produce a disqualifier. A negative control proves that
 *    assertion has a failure mode rather than being vacuously true.
 *
 * 3. THE SET-ASIDE CASCADE. A small business that is not SDVOSB is not out of an SDVOSB set-aside.
 *    And where the cascade text on disk does not reach, the answer is 'unknown', not an extension of
 *    the rule.
 *
 * A fourth property, cheap to check and expensive to get wrong: NO CITATION PRINTS A REVISION
 * NUMBER. The corpus carries two revisions of the Master Solicitation and the conductor has not
 * ruled, so the scan below walks every citation string in the module and a fixture proves the
 * scanner actually catches one.
 */

import { describe, expect, it } from 'vitest'
import {
  AMC_TABLE,
  AMSC_TABLE,
  GATE_CITATIONS,
  amcAmscCombinationValid,
  amcEntry,
  amscCompetitionSignal,
  amscEntry,
  amscPosture,
  evaluateEligibility,
  instrumentFromNinthPositionChar,
  instrumentFromTypeIndicator,
  type Citation,
  type EligibilityInputs,
  type EligibilityReason,
} from '@/lib/engine/eligibility'
import {
  AMC_DEALER_NOTE,
  AMSC_NOT_A_CLOSED_DOOR,
  AMSC_POSTURE_CITATION,
  AMSC_TABLE_CITATION,
} from '@/lib/engine/eligibility/amsc'

const codesOf = (reasons: readonly EligibilityReason[]) => reasons.map((r) => r.code)

/**
 * A clean automated-lane row quoting unused former Government surplus. Everything that could stall
 * the verdict is supplied, so any 'unknown' in a test below is caused by the thing that test varies.
 */
const T_TYPE_SURPLUS: EligibilityInputs = {
  solicitation_id: 'SPE4A726T1001',
  solicitation_number_type_char: 'T',
  bid_type_code: 'BI',
  offer_material_requirement_code: '4',
  quote_remarks: null,
  first_article_testing_required: false,
  production_lot_testing_required: false,
  set_aside_indicator: 'N',
  offeror_set_aside_statuses: ['small_business'],
  critical_safety_item: false,
  long_term_contract_coverage: false,
  amsc: 'G',
  amc: 1,
}

// The one gap string that a fully supplied row still carries, because the upstream lane posted the
// parsed set-aside indicator as not yet confirmed against primary solicitation documents.
const SET_ASIDE_GAP =
  'set_aside_indicator is parsed but not yet confirmed against primary solicitation documents'

// ============================================================================================
// 1. THE TABLE. Transcribed from DoD 4100.39-M Volume 10 Chapter 4 Table 71, read on disk at
//    /Users/user/project-x/03-findings/research/nsn-cataloging-and-interchangeability.md:527-546.
// ============================================================================================

describe('T3 the AMSC table is the table on disk, not a recollection of it', () => {
  it('carries exactly the twenty codes Table 71 lists, in order', () => {
    // Hand-transcribed from lines 527 through 546. E, F, I, J, O, W and X are not in the table.
    expect(AMSC_TABLE.map((e) => e.code)).toEqual([
      '0', 'A', 'B', 'C', 'D', 'G', 'H', 'K', 'L', 'M',
      'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'Y', 'Z',
    ])
    expect(AMSC_TABLE).toHaveLength(20)
  })

  it('does not invent the letters the table skips', () => {
    for (const absent of ['E', 'F', 'I', 'J', 'O', 'W', 'X']) {
      expect(amscEntry(absent)).toBeNull()
    }
  })

  it('carries the restricted Valid AMCs columns exactly, which are the three that are not 1 to 5', () => {
    // Line 531: D is 3,4,5. Line 532: G is 1,2. Line 542: T is 1,2. Line 527: the 0 cell is blank
    // and the prose at line 548 restricts it to AMC 0.
    expect(amscEntry('D')?.valid_amcs).toEqual([3, 4, 5])
    expect(amscEntry('G')?.valid_amcs).toEqual([1, 2])
    expect(amscEntry('T')?.valid_amcs).toEqual([1, 2])
    expect(amscEntry('0')?.valid_amcs).toEqual([0])
    // A representative row from the seventeen that carry the full set.
    expect(amscEntry('B')?.valid_amcs).toEqual([1, 2, 3, 4, 5])
  })

  it('records that the AMSC 0 row did not come from the Valid AMCs column', () => {
    expect(amscEntry('0')?.valid_amcs_note).toContain('blank')
    expect(amscEntry('D')?.valid_amcs_note).toBeUndefined()
  })

  it('carries the explanations verbatim for the two codes people paraphrase', () => {
    expect(amscEntry('Z')?.explanation).toBe(
      'This part is a commercial/non-developmental/off-the-shelf-item.',
    )
    expect(amscEntry('P')?.explanation).toBe(
      'The rights to use the data needed to purchase this part from additional sources are not owned ' +
        'by the Government and cannot be purchased.',
    )
  })

  it('carries the six AMC codes and the dealer sentence that is the whole legal footing', () => {
    expect(AMC_TABLE.map((e) => e.code)).toEqual([0, 1, 2, 3, 4, 5])
    expect(amcEntry(1)?.explanation).toBe('Suitable for competitive acquisition.')
    expect(AMC_DEALER_NOTE.quote).toBe('Potential sources shall include dealers/distributors.')
  })

  it('validates AMC and AMSC pairs against the columns, and says unknown rather than guessing', () => {
    expect(amcAmscCombinationValid(1, 'G')).toBe('valid')
    expect(amcAmscCombinationValid(3, 'G')).toBe('invalid')
    expect(amcAmscCombinationValid(3, 'D')).toBe('valid')
    expect(amcAmscCombinationValid(1, 'D')).toBe('invalid')
    expect(amcAmscCombinationValid(0, '0')).toBe('valid')
    expect(amcAmscCombinationValid(1, '0')).toBe('invalid')
    // Absent code, either side: absence of a code is not evidence of a bad combination.
    expect(amcAmscCombinationValid(9, 'G')).toBe('unknown')
    expect(amcAmscCombinationValid(1, 'X')).toBe('unknown')
    expect(amcAmscCombinationValid(null, null)).toBe('unknown')
  })

  it('groups only the ten codes the source groups, and admits nothing about the other ten', () => {
    // ESTIMATED grouping, lines 557 to 563. Written out by hand, code by code.
    expect(amscPosture('G')).toBe('open_to_surplus_dealer')
    expect(amscPosture('Z')).toBe('open_to_surplus_dealer')
    expect(amscPosture('L')).toBe('open_to_surplus_dealer')
    expect(amscPosture('B')).toBe('restricted_attackable')
    expect(amscPosture('C')).toBe('restricted_attackable')
    expect(amscPosture('D')).toBe('restricted_attackable')
    expect(amscPosture('P')).toBe('restricted_closed_to_new_manufacturing_source')
    expect(amscPosture('R')).toBe('restricted_closed_to_new_manufacturing_source')
    expect(amscPosture('S')).toBe('restricted_closed_to_new_manufacturing_source')
    expect(amscPosture('M')).toBe('restricted_closed_to_new_manufacturing_source')
    for (const ungrouped of ['0', 'A', 'H', 'K', 'N', 'Q', 'T', 'U', 'V', 'Y'] as const) {
      expect(amscPosture(ungrouped)).toBe('unclassified_in_primary_source')
    }
  })

  it('labels the grouping ESTIMATED and the table VERIFIED, and never blends the two', () => {
    expect(AMSC_TABLE_CITATION.verification).toBe('verified_primary')
    expect(AMSC_POSTURE_CITATION.verification).toBe('estimated')
  })
})

// ============================================================================================
// 2. THE FIVE REQUIRED ROWS.
// ============================================================================================

describe('T3 a T-type surplus row is eligible, with its reasons on its face', () => {
  const result = evaluateEligibility(T_TYPE_SURPLUS)

  it('emits eligible and routes to the automated lane', () => {
    expect(result.verdict).toBe('eligible')
    expect(result.instrument).toBe('automated_rfq')
    expect(result.routing).toBe('automated_award_candidate')
  })

  it('emits exactly these reasons, in this order', () => {
    expect(codesOf(result.reasons)).toEqual([
      'instrument_type_resolved',
      'surplus_permitted_on_automated_lane',
      'set_aside_unrestricted',
      'amsc_open_competition_signal',
    ])
  })

  it('says out loud that surplus is permitted HERE, citing the paragraph that permits it', () => {
    const r = result.reasons.find((x) => x.code === 'surplus_permitted_on_automated_lane')
    expect(r?.disposition).toBe('qualifying')
    expect(r?.citation.identifier).toBe('Part I para 3(a)(1), item 3')
  })

  it('still reports the one honest gap rather than presenting the row as fully settled', () => {
    expect(result.data_gaps).toEqual([SET_ASIDE_GAP])
  })
})

describe('T3 THE AIDC INVERSION: the same surplus row is ineligible on a U-type solicitation', () => {
  const u: EligibilityInputs = { ...T_TYPE_SURPLUS, solicitation_number_type_char: 'U' }
  const result = evaluateEligibility(u)

  it('emits ineligible with the AIDC reason named', () => {
    expect(result.verdict).toBe('ineligible')
    expect(result.instrument).toBe('aidc')
    expect(codesOf(result.reasons)).toEqual([
      'instrument_type_resolved',
      'aidc_surplus_disqualified',
      'set_aside_unrestricted',
      'amsc_open_competition_signal',
    ])
  })

  it('cites Part II para 1 by paragraph, quoting the sentence that does the work', () => {
    const r = result.reasons.find((x) => x.code === 'aidc_surplus_disqualified')
    expect(r?.disposition).toBe('disqualifying')
    expect(r?.citation.identifier).toBe('Part II para 1')
    expect(r?.citation.quote).toContain('unused former Government surplus property')
    expect(r?.deciding_field).toBe('offer_material_requirement_code')
  })

  it('keeps the row visible and routes it to manual evaluation rather than dropping it', () => {
    expect(result.routing).toBe('manual_evaluation')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('THE PAIR: one character flips the verdict, which a single-lane implementation cannot do', () => {
    const t = evaluateEligibility(T_TYPE_SURPLUS)
    expect(t.verdict).toBe('eligible')
    expect(result.verdict).toBe('ineligible')
    expect(t.verdict).not.toBe(result.verdict)
    // And the ONLY difference between the two inputs is that one character.
    expect(T_TYPE_SURPLUS.solicitation_number_type_char).toBe('T')
    expect(u.solicitation_number_type_char).toBe('U')
  })

  it('applies the same inversion to used, reconditioned and remanufactured, per the quoted list', () => {
    for (const code of ['1', '2', '3', '4'] as const) {
      const row = { ...u, offer_material_requirement_code: code }
      expect(evaluateEligibility(row).verdict).toBe('ineligible')
    }
    // Code 0 is not one of the four the paragraph names, so it is not disqualified by this rule.
    const newMaterial = { ...u, offer_material_requirement_code: '0' as const }
    expect(evaluateEligibility(newMaterial).verdict).toBe('eligible')
  })
})

describe('T3 THE AMSC TRAP: a restricted AMSC never makes a surplus row ineligible', () => {
  // AMSC P is the most closed-reading code in the table: the rights "cannot be purchased".
  const restricted: EligibilityInputs = { ...T_TYPE_SURPLUS, amsc: 'P', amc: 3 }
  const result = evaluateEligibility(restricted)

  it('IS NOT INELIGIBLE. This is the assertion the product depends on', () => {
    expect(result.verdict).not.toBe('ineligible')
    expect(result.verdict).toBe('eligible')
    expect(result.routing).toBe('automated_award_candidate')
  })

  it('emits the restriction as a competition signal, never as a gate emission', () => {
    expect(codesOf(result.reasons)).toEqual([
      'instrument_type_resolved',
      'surplus_permitted_on_automated_lane',
      'set_aside_unrestricted',
      'amsc_restricted_competition_signal',
    ])
    const r = result.reasons.find((x) => x.code === 'amsc_restricted_competition_signal')
    expect(r?.disposition).toBe('signal')
    expect(r?.citation.id).toBe('amsc_restricted_does_not_bar_surplus_supply')
  })

  it('reads the restriction as a monopoly shape, which is what makes the row valuable', () => {
    expect(result.amsc_signal.restricted).toBe(true)
    expect(result.amsc_signal.monopoly_shaped).toBe(true)
    expect(result.amsc_signal.bars_new_manufacturing_source).toBe(true)
    expect(result.amsc_signal.bars_surplus_supply_of_the_approved_article).toBe(false)
  })

  it('carries the warning verbatim, so the rule travels with the verdict', () => {
    expect(AMSC_NOT_A_CLOSED_DOOR.quote).toContain('A restricted AMSC bars manufacturing by a new source')
    expect(AMSC_NOT_A_CLOSED_DOOR.quote).toContain(
      'does not by itself bar supplying new surplus of the originally approved article',
    )
  })

  it('holds for all seven restricted codes, not just the one this test picked', () => {
    // B, C, D attackable (line 561) and P, R, S, M closed (line 563). AMC 3 is valid for all seven.
    for (const code of ['B', 'C', 'D', 'P', 'R', 'S', 'M'] as const) {
      const r = evaluateEligibility({ ...T_TYPE_SURPLUS, amsc: code, amc: 3 })
      expect(r.verdict).toBe('eligible')
      expect(r.reasons.filter((x) => x.disposition === 'disqualifying')).toHaveLength(0)
    }
  })

  it('holds for every one of the twenty codes in the table', () => {
    for (const entry of AMSC_TABLE) {
      const r = evaluateEligibility({ ...T_TYPE_SURPLUS, amsc: entry.code, amc: 3 })
      expect(r.verdict).toBe('eligible')
      expect(r.reasons.filter((x) => x.code.startsWith('amsc') && x.disposition !== 'signal')).toHaveLength(0)
    }
  })

  it('an unrecognised AMSC is a data defect, still not a gate emission', () => {
    const r = evaluateEligibility({ ...T_TYPE_SURPLUS, amsc: 'X' })
    expect(r.verdict).toBe('eligible')
    expect(codesOf(r.reasons)).toContain('amsc_code_not_in_table_71')
    expect(r.amsc_signal.recognized).toBe(false)
  })

  it('an impossible AMC and AMSC pair is flagged as a data defect, still not a gate emission', () => {
    // G is valid with AMC 1 and 2 only, so AMC 3 with G is an impossible catalogue row.
    const r = evaluateEligibility({ ...T_TYPE_SURPLUS, amsc: 'G', amc: 3 })
    expect(r.verdict).toBe('eligible')
    expect(codesOf(r.reasons)).toContain('amsc_amc_combination_invalid')
    const flag = r.reasons.find((x) => x.code === 'amsc_amc_combination_invalid')
    expect(flag?.disposition).toBe('signal')
  })

  it('NEGATIVE CONTROL: the trap assertion has a real failure mode', () => {
    // The predicate the tests above rely on. If it could not fire, every assertion using it would be
    // decoration. Sabotage the reason list the way a broken implementation would and prove it fires.
    const amscDisqualifiers = (rs: readonly EligibilityReason[]) =>
      rs.filter((r) => r.code.startsWith('amsc') && r.disposition === 'disqualifying')

    expect(amscDisqualifiers(result.reasons)).toHaveLength(0)

    const sabotaged: EligibilityReason[] = [
      ...result.reasons,
      {
        code: 'amsc_restricted_competition_signal',
        disposition: 'disqualifying',
        operator_text: 'A deliberately wrong reason, used only to prove the instrument fires.',
        deciding_field: 'amsc',
        citation: AMSC_NOT_A_CLOSED_DOOR,
      },
    ]
    expect(amscDisqualifiers(sabotaged)).toHaveLength(1)
  })
})

describe('T3 an alternate offer routes to future evaluation and is never priced as a live candidate', () => {
  const alternate: EligibilityInputs = {
    ...T_TYPE_SURPLUS,
    solicitation_id: 'SPE4A726T4004',
    bid_type_code: 'AB',
    amsc: 'C',
    amc: 1,
  }
  const result = evaluateEligibility(alternate)

  it('emits ineligible for the instant award and routes to the future evaluation channel', () => {
    expect(result.verdict).toBe('ineligible')
    expect(result.routing).toBe('future_evaluation')
    expect(codesOf(result.reasons)).toEqual([
      'instrument_type_resolved',
      'surplus_permitted_on_automated_lane',
      'alternate_offer_not_automated',
      'set_aside_unrestricted',
      'amsc_restricted_competition_signal',
    ])
  })

  it('cites Part I para 3(g) by paragraph, quoting both sentences', () => {
    const r = result.reasons.find((x) => x.code === 'alternate_offer_not_automated')
    expect(r?.citation.identifier).toBe('Part I para 3(g)')
    expect(r?.citation.quote).toBe(
      'Alternate offers will not be considered for automated award. Alternate offers may be ' +
        'submitted for evaluation for future procurements.',
    )
    expect(r?.routes_to).toBe('future_evaluation')
  })

  it('is barred on the AIDC lane too, because both T and U are automated solicitations', () => {
    const onU = evaluateEligibility({ ...alternate, solicitation_number_type_char: 'U' })
    expect(codesOf(onU.reasons)).toContain('alternate_offer_not_automated')
  })

  it('is NOT barred on a manual solicitation, because the quoted rule is the complement of T and U', () => {
    const manual = evaluateEligibility({ ...alternate, solicitation_number_type_char: 'Q' })
    expect(manual.verdict).toBe('eligible')
    expect(codesOf(manual.reasons)).toEqual([
      'instrument_type_resolved',
      'alternate_offer_considerable_on_manual_solicitation',
      'set_aside_unrestricted',
      'amsc_restricted_competition_signal',
    ])
  })
})

describe('T3 a missing instrument type is unknown, and unknown is a real answer', () => {
  const noType: EligibilityInputs = {
    ...T_TYPE_SURPLUS,
    solicitation_id: 'SPE4A726X5005',
    solicitation_type_indicator: null,
    solicitation_number_type_char: null,
  }
  const result = evaluateEligibility(noType)

  it('emits unknown, not eligible and not ineligible', () => {
    expect(result.verdict).toBe('unknown')
    expect(result.instrument).toBeNull()
    expect(result.routing).toBe('undetermined')
  })

  it('names the missing field and skips every rule that depends on the lane', () => {
    expect(codesOf(result.reasons)).toEqual([
      'instrument_type_missing',
      'set_aside_unrestricted',
      'amsc_open_competition_signal',
    ])
    // The surplus and bid-type rules did NOT run: guessing the lane is the AIDC trap.
    expect(codesOf(result.reasons)).not.toContain('surplus_permitted_on_automated_lane')
    expect(codesOf(result.reasons)).not.toContain('aidc_surplus_disqualified')
  })

  it('reports exactly which fields were not evaluated and why', () => {
    expect(result.data_gaps).toEqual([
      'solicitation_type_indicator',
      'solicitation_number_type_char',
      'bid_type_code, offer_material_requirement_code and quote_remarks were not evaluated because instrument type is undetermined',
      SET_ASIDE_GAP,
    ])
  })

  it('refuses to resolve a lane when the two feed fields disagree', () => {
    const conflict = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      solicitation_type_indicator: 'I',
      solicitation_number_type_char: 'T',
    })
    expect(conflict.verdict).toBe('unknown')
    expect(conflict.instrument).toBeNull()
    expect(codesOf(conflict.reasons)).toContain('instrument_type_conflict')
  })

  it('a known bar still outranks an unknown, so a missing lane cannot hide a disqualifier', () => {
    const fat = evaluateEligibility({ ...noType, first_article_testing_required: true })
    expect(fat.verdict).toBe('ineligible')
    expect(codesOf(fat.reasons)).toContain('first_article_or_production_lot_testing')
  })
})

// ============================================================================================
// 3. THE INSTRUMENT TYPE MAPPINGS, WHICH ARE TRANSCRIBED RULES AND NOT INFERENCES.
// ============================================================================================

describe('T3 instrument type comes from the feed fields and from nowhere else', () => {
  it('maps batch field 002 exactly as the specification lists it', () => {
    expect(instrumentFromTypeIndicator('F')).toBe('automated_rfq')
    expect(instrumentFromTypeIndicator('P')).toBe('automated_rfq')
    expect(instrumentFromTypeIndicator('I')).toBe('aidc')
    expect(instrumentFromTypeIndicator(null)).toBeNull()
    expect(instrumentFromTypeIndicator(undefined)).toBeNull()
  })

  it('maps the ninth position, with every other letter manual per the quoted complement rule', () => {
    expect(instrumentFromNinthPositionChar('T')).toBe('automated_rfq')
    expect(instrumentFromNinthPositionChar('U')).toBe('aidc')
    expect(instrumentFromNinthPositionChar('Q')).toBe('manual_rfq')
    expect(instrumentFromNinthPositionChar('D')).toBe('manual_rfq')
    expect(instrumentFromNinthPositionChar(null)).toBeNull()
    expect(instrumentFromNinthPositionChar('TU')).toBeNull()
  })

  it('the letter F means opposite things in the two fields, which is why they are read separately', () => {
    // Field 002 F is Fast Auto Evaluation. A ninth position F is not T or U, so it is manual.
    expect(instrumentFromTypeIndicator('F')).toBe('automated_rfq')
    expect(instrumentFromNinthPositionChar('F')).toBe('manual_rfq')
    expect(instrumentFromTypeIndicator('F')).not.toBe(instrumentFromNinthPositionChar('F'))
  })
})

// ============================================================================================
// 4. THE REMAINING GATES.
// ============================================================================================

describe('T3 first article and production lot testing remove the solicitation from automated award', () => {
  it('disqualifies on first article testing and routes to manual evaluation', () => {
    const r = evaluateEligibility({ ...T_TYPE_SURPLUS, first_article_testing_required: true })
    expect(r.verdict).toBe('ineligible')
    expect(r.routing).toBe('manual_evaluation')
    const reason = r.reasons.find((x) => x.code === 'first_article_or_production_lot_testing')
    expect(reason?.deciding_field).toBe('first_article_testing_required')
    expect(reason?.citation.quote).toContain('shall be manually evaluated and manually awarded')
  })

  it('disqualifies on production lot testing alone', () => {
    const r = evaluateEligibility({ ...T_TYPE_SURPLUS, production_lot_testing_required: true })
    expect(r.verdict).toBe('ineligible')
    const reason = r.reasons.find((x) => x.code === 'first_article_or_production_lot_testing')
    expect(reason?.deciding_field).toBe('production_lot_testing_required')
  })

  it('pins no paragraph it cannot back, because the digest on disk pins none', () => {
    expect(GATE_CITATIONS.first_article.identifier).toBeNull()
    expect(GATE_CITATIONS.first_article.source).toContain('dla-procurement-mechanics.md:298-300')
  })
})

describe('T3 remarks are radioactive on the automated lane', () => {
  it('any free text at all disqualifies, including a short helpful one', () => {
    const r = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      quote_remarks: 'New surplus, original packaging, traceability available on request.',
    })
    expect(r.verdict).toBe('ineligible')
    expect(r.routing).toBe('manual_evaluation')
    const reason = r.reasons.find((x) => x.code === 'quote_remarks_present')
    expect(reason?.disposition).toBe('disqualifying')
    expect(reason?.citation.quote).toBe('Quoting Remarks.')
  })

  it('whitespace is not free text, so an empty field does not manufacture a disqualifier', () => {
    const r = evaluateEligibility({ ...T_TYPE_SURPLUS, quote_remarks: '   \n  ' })
    expect(r.verdict).toBe('eligible')
    expect(codesOf(r.reasons)).not.toContain('quote_remarks_present')
  })

  it('is a signal, not a bar, on a manual solicitation', () => {
    const r = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      solicitation_number_type_char: 'Q',
      quote_remarks: 'Traceability available.',
    })
    expect(r.verdict).toBe('eligible')
    expect(r.reasons.find((x) => x.code === 'quote_remarks_present')?.disposition).toBe('signal')
  })
})

describe('T3 the AIDC ninety day validity minimum, from the same quoted paragraph', () => {
  it('disqualifies an eighty-nine day quote on the AIDC lane', () => {
    const r = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      solicitation_number_type_char: 'U',
      offer_material_requirement_code: '0',
      days_quote_valid: 89,
    })
    expect(r.verdict).toBe('ineligible')
    expect(codesOf(r.reasons)).toContain('aidc_validity_period_below_minimum')
  })

  it('accepts exactly ninety, which is the boundary the text names', () => {
    const r = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      solicitation_number_type_char: 'U',
      offer_material_requirement_code: '0',
      days_quote_valid: 90,
    })
    expect(r.verdict).toBe('eligible')
  })

  it('does not apply on the ordinary automated lane', () => {
    const r = evaluateEligibility({ ...T_TYPE_SURPLUS, days_quote_valid: 30 })
    expect(codesOf(r.reasons)).not.toContain('aidc_validity_period_below_minimum')
  })
})

describe('T3 THE SET-ASIDE CASCADE: a small business is not out of an SDVOSB set-aside', () => {
  it('treats a small business without the specific status as a cascade candidate, not as excluded', () => {
    const r = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      set_aside_indicator: 'R',
      offeror_set_aside_statuses: ['small_business'],
    })
    expect(r.verdict).toBe('eligible')
    const reason = r.reasons.find((x) => x.code === 'set_aside_cascade_candidate')
    expect(reason?.disposition).toBe('signal')
    expect(reason?.citation.identifier).toContain('19.590')
  })

  it('does the same on a HUBZone set-aside, which the cascade text also names', () => {
    const r = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      set_aside_indicator: 'H',
      offeror_set_aside_statuses: ['small_business'],
    })
    expect(r.verdict).toBe('eligible')
    expect(codesOf(r.reasons)).toContain('set_aside_cascade_candidate')
  })

  it('qualifies an offeror that actually holds the status', () => {
    const r = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      set_aside_indicator: 'R',
      offeror_set_aside_statuses: ['small_business', 'sdvosb'],
    })
    expect(r.verdict).toBe('eligible')
    expect(codesOf(r.reasons)).toContain('set_aside_status_matches')
  })

  it('excludes an other-than-small offeror, and routes it to excluded rather than manual review', () => {
    const r = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      set_aside_indicator: 'Y',
      offeror_set_aside_statuses: [],
    })
    expect(r.verdict).toBe('ineligible')
    expect(r.routing).toBe('excluded')
    expect(codesOf(r.reasons)).toContain('set_aside_offeror_not_small_business')
  })

  it('answers unknown where the cascade text on disk does not reach, rather than extending it', () => {
    // The quoted DLAD 19.590 text names SDVOSB and HUBZone only. WOSB is not in it.
    const r = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      set_aside_indicator: 'L',
      offeror_set_aside_statuses: ['small_business'],
    })
    expect(r.verdict).toBe('unknown')
    expect(codesOf(r.reasons)).toContain('set_aside_cascade_not_established_in_primary_text')
  })

  it('distinguishes an unrecorded representation from a recorded absence', () => {
    const unrecorded = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      set_aside_indicator: 'Y',
      offeror_set_aside_statuses: null,
    })
    const recordedNone = evaluateEligibility({
      ...T_TYPE_SURPLUS,
      set_aside_indicator: 'Y',
      offeror_set_aside_statuses: [],
    })
    expect(unrecorded.verdict).toBe('unknown')
    expect(recordedNone.verdict).toBe('ineligible')
    expect(unrecorded.verdict).not.toBe(recordedNone.verdict)
  })

  it('answers unknown when the indicator itself is absent, and never infers it', () => {
    const r = evaluateEligibility({ ...T_TYPE_SURPLUS, set_aside_indicator: null })
    expect(r.verdict).toBe('unknown')
    expect(codesOf(r.reasons)).toContain('set_aside_indicator_absent')
    expect(r.data_gaps).toContain('set_aside_indicator')
  })

  it('carries the upstream caveat even when the field is present and benign', () => {
    expect(GATE_CITATIONS.set_aside_field.verification).toBe('estimated')
    expect(evaluateEligibility(T_TYPE_SURPLUS).data_gaps).toContain(SET_ASIDE_GAP)
  })
})

describe('T3 critical safety item and long term contract coverage suppress, they do not gate', () => {
  it('keeps a CSI row eligible and explains the cost and the risk', () => {
    const r = evaluateEligibility({ ...T_TYPE_SURPLUS, critical_safety_item: true })
    expect(r.verdict).toBe('eligible')
    expect(codesOf(r.reasons)).toEqual([
      'instrument_type_resolved',
      'surplus_permitted_on_automated_lane',
      'set_aside_unrestricted',
      'critical_safety_item',
      'critical_safety_item_esa_may_restrict_surplus',
      'amsc_open_competition_signal',
    ])
    const esa = r.reasons.find((x) => x.code === 'critical_safety_item')
    expect(esa?.disposition).toBe('signal')
    expect(esa?.citation.quote).toContain('$600')
  })

  it('keeps an LTC-covered row eligible and names the exclusion that suppresses its volume', () => {
    const r = evaluateEligibility({ ...T_TYPE_SURPLUS, long_term_contract_coverage: true })
    expect(r.verdict).toBe('eligible')
    const ltc = r.reasons.find((x) => x.code === 'long_term_contract_coverage')
    expect(ltc?.disposition).toBe('signal')
    expect(ltc?.citation.identifier).toBe('13.003(e)(1)')
  })

  it('reports an unrecorded CSI flag as a gap rather than as a false', () => {
    const r = evaluateEligibility({ ...T_TYPE_SURPLUS, critical_safety_item: null })
    expect(r.data_gaps).toContain('critical_safety_item')
    expect(codesOf(r.reasons)).not.toContain('critical_safety_item')
  })
})

// ============================================================================================
// 5. THE CITATION DISCIPLINE.
// ============================================================================================

describe('T3 no citation prints a Master Solicitation revision number', () => {
  const ALL_CITATIONS: readonly Citation[] = [
    ...Object.values(GATE_CITATIONS),
    AMSC_TABLE_CITATION,
    AMSC_POSTURE_CITATION,
    AMSC_NOT_A_CLOSED_DOOR,
    AMC_DEALER_NOTE,
  ]

  // A revision token: the word Rev, optionally separated, followed by digits.
  const REVISION = /\bRev[\s.\-_]*\d+/i

  const stringsOf = (c: Citation) => [c.id, c.authority, c.identifier ?? '', c.quote ?? '', c.source]

  it('finds no revision token anywhere in any citation field', () => {
    for (const c of ALL_CITATIONS) {
      for (const s of stringsOf(c)) {
        expect(s).not.toMatch(REVISION)
      }
    }
  })

  it('NEGATIVE CONTROL: the scanner catches the exact strings the corpus is split between', () => {
    expect('Master Solicitation Rev 104, Part I para 3(g)').toMatch(REVISION)
    expect('Master Solicitation Rev-81, Part II para 1').toMatch(REVISION)
    expect('DLAD Rev 5').toMatch(REVISION)
    // And it does not fire on ordinary prose that merely contains the letters.
    expect('converts an automatic win into a manual review').not.toMatch(REVISION)
  })

  it('cites the Master Solicitation by paragraph, which is the stable part of the pin', () => {
    expect(GATE_CITATIONS.alternate_offer.identifier).toBe('Part I para 3(g)')
    expect(GATE_CITATIONS.aidc_exceptions.identifier).toBe('Part II para 1')
    expect(GATE_CITATIONS.alternate_offer.authority).toBe('DLA Master Solicitation')
  })

  it('gives every citation a distinct id and a source a human can open', () => {
    const ids = ALL_CITATIONS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of ALL_CITATIONS) {
      expect(c.source).toMatch(/^\/Users\/user\/project-x\/03-findings\/research\/.+\.md:\d/)
    }
  })
})

describe('T3 no reason is ever emitted without words and a citation', () => {
  const ROWS: readonly EligibilityInputs[] = [
    T_TYPE_SURPLUS,
    { ...T_TYPE_SURPLUS, solicitation_number_type_char: 'U' },
    { ...T_TYPE_SURPLUS, amsc: 'P', amc: 3 },
    { ...T_TYPE_SURPLUS, bid_type_code: 'AB' },
    { ...T_TYPE_SURPLUS, solicitation_number_type_char: null, solicitation_type_indicator: null },
    { ...T_TYPE_SURPLUS, first_article_testing_required: true },
    { ...T_TYPE_SURPLUS, quote_remarks: 'note' },
    { ...T_TYPE_SURPLUS, set_aside_indicator: 'L', offeror_set_aside_statuses: ['small_business'] },
    { ...T_TYPE_SURPLUS, critical_safety_item: true, long_term_contract_coverage: true },
  ]

  it('every reason on every row carries operator words, a deciding field and a citation', () => {
    let seen = 0
    for (const row of ROWS) {
      for (const r of evaluateEligibility(row).reasons) {
        seen += 1
        expect(r.operator_text.length).toBeGreaterThan(20)
        expect(r.deciding_field.length).toBeGreaterThan(0)
        expect(r.citation.source).toContain(':')
      }
    }
    // The count is asserted so a future change that stops emitting reasons cannot pass this silently.
    expect(seen).toBe(41)
  })

  it('an ineligible row is never empty, because an operator has to be able to argue with it', () => {
    for (const row of ROWS) {
      const result = evaluateEligibility(row)
      if (result.verdict === 'ineligible') {
        expect(result.reasons.filter((r) => r.disposition === 'disqualifying').length).toBeGreaterThan(0)
      }
    }
  })

  it('stamps the gate version on every verdict, so a stored one stays attributable', () => {
    expect(evaluateEligibility(T_TYPE_SURPLUS).gate_version).toBe(1)
  })
})
