import { describe, expect, it } from 'vitest'
import { evaluateEligibility, instrumentFromNinthPositionChar, amscPosture, amscCompetitionSignal, type EligibilityInputs } from '@/lib/engine/eligibility'
import { AMSC_NOT_A_CLOSED_DOOR, AMSC_POSTURE_CITATION } from '@/lib/engine/eligibility/amsc'

const BASE: EligibilityInputs = {
  solicitation_id: 'X', solicitation_number_type_char: 'T', bid_type_code: 'BI',
  offer_material_requirement_code: '4', quote_remarks: null,
  first_article_testing_required: false, production_lot_testing_required: false,
  set_aside_indicator: 'N', offeror_set_aside_statuses: ['small_business'],
  critical_safety_item: false, long_term_contract_coverage: false, amsc: 'G', amc: 1,
}

describe('probes', () => {
  it('P1 manual RFQ with nothing wrong', () => {
    const r = evaluateEligibility({ ...BASE, solicitation_number_type_char: 'Q' })
    console.log('P1 verdict=', r.verdict, 'instrument=', r.instrument, 'routing=', r.routing)
    console.log('P1 reasons=', r.reasons.map(x=>x.code))
  })
  it('P2 non-letter ninth char', () => {
    for (const ch of ['3', '@', ' T', 't', '0']) {
      console.log('P2 ch=', JSON.stringify(ch), '->', instrumentFromNinthPositionChar(ch))
    }
  })
  it('P3 manual RFQ + FAT', () => {
    const r = evaluateEligibility({ ...BASE, solicitation_number_type_char: 'Q', first_article_testing_required: true })
    console.log('P3 verdict=', r.verdict, 'routing=', r.routing, 'instrument=', r.instrument)
  })
  it('P4 AMSC Z with AMC 5 posture', () => {
    console.log('P4 posture Z=', amscPosture('Z'), 'combo Z/5 valid?')
    const r = evaluateEligibility({ ...BASE, amsc: 'Z', amc: 5 })
    console.log('P4 reasons=', r.reasons.map(x=>x.code))
    const open = r.reasons.find(x=>x.code==='amsc_open_competition_signal')
    console.log('P4 open text=', open?.operator_text)
  })
  it('P5 verification labels on the warning', () => {
    console.log('P5 warning verification=', AMSC_NOT_A_CLOSED_DOOR.verification, 'source=', AMSC_NOT_A_CLOSED_DOOR.source)
    console.log('P5 posture verification=', AMSC_POSTURE_CITATION.verification, 'source=', AMSC_POSTURE_CITATION.source)
  })
  it('P6 CSI operator text', () => {
    const r = evaluateEligibility({ ...BASE, critical_safety_item: true })
    for (const x of r.reasons.filter(y=>y.code==='critical_safety_item')) console.log('P6:', x.operator_text)
  })
  it('P7 AIDC 89 days but material 4 (both fire?)', () => {
    const r = evaluateEligibility({ ...BASE, solicitation_number_type_char: 'U', days_quote_valid: 89 })
    console.log('P7 reasons=', r.reasons.map(x=>x.code), r.verdict, r.routing)
  })
  it('P8 large business on unrestricted N', () => {
    const r = evaluateEligibility({ ...BASE, set_aside_indicator: 'N', offeror_set_aside_statuses: [] })
    console.log('P8 verdict=', r.verdict, r.reasons.map(x=>x.code))
  })
  it('P9 WOSB L with wosb status / EDWOSB', () => {
    const r = evaluateEligibility({ ...BASE, set_aside_indicator: 'L', offeror_set_aside_statuses: ['small_business','wosb'] })
    console.log('P9 L+wosb verdict=', r.verdict, r.reasons.map(x=>x.code))
    const r2 = evaluateEligibility({ ...BASE, set_aside_indicator: 'A', offeror_set_aside_statuses: ['small_business'] })
    console.log('P9 A+sb verdict=', r2.verdict, r2.reasons.map(x=>x.code))
  })
  it('P10 amsc case/whitespace + empty string amsc', () => {
    console.log('P10 lower g=', amscCompetitionSignal('g').code, ' pad=', amscCompetitionSignal(' G ').code)
    const r = evaluateEligibility({ ...BASE, amsc: '' })
    console.log('P10 empty amsc reasons=', r.reasons.map(x=>x.code), 'gaps=', r.data_gaps)
  })
  it('P11 AIDC + alternate offer routing precedence', () => {
    const r = evaluateEligibility({ ...BASE, solicitation_number_type_char: 'U', bid_type_code: 'AB', set_aside_indicator: 'Y', offeror_set_aside_statuses: [] })
    console.log('P11 verdict=', r.verdict, 'routing=', r.routing, r.reasons.filter(x=>x.disposition==='disqualifying').map(x=>[x.code,x.routes_to]))
  })
})
