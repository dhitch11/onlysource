/**
 * THE AIDC INVERSION, ASSERTED IN BOTH DIRECTIONS.
 *
 * Same material, same offer, opposite outcome, decided by one character in the ninth position of
 * the solicitation number. On the ordinary automated lane (T) quoting unused former Government
 * surplus is on the Master Solicitation's own list of things that do NOT make a quote ineligible.
 * On an AIDC lane (U) the identical act is a listed exception that takes the quote out of
 * automated award. Encoding that backwards points a surplus dealer at the 3.5 percent of daily
 * volume where their core product is structurally disadvantaged, so it is asserted here in both
 * directions rather than once.
 *
 * -----------------------------------------------------------------------------------------
 * THE CROSS-CHECK IS AGAINST A DIFFERENT INSTRUMENT, ON PURPOSE
 * -----------------------------------------------------------------------------------------
 * A test written by the same hand that wrote the mapping proves only that the hand is
 * consistent. So the last block asks `lib/engine/eligibility/gate.ts` the same question
 * directly, through its own public entry point, and pins the dossier verdict to the reason codes
 * that engine emits. If the two ever disagree, one of them is wrong and this file says which.
 *
 * The two solicitation numbers are REAL, read off the corner map for this feed day: SPE7L426U1037
 * is one of 30 U rows on a 186 row board and SPE4A626T15HA is one of 112 T rows. The manual lane
 * case is the same shape with the deciding character changed, which is the variable under test.
 */
import { describe, expect, it } from 'vitest'

import { evaluateEligibility } from '@/lib/engine/eligibility'
import { citationLabel, identifierSafe } from '@/lib/intelligence/eligibility/citation'
import { resolveDossierEligibility } from '@/lib/intelligence/eligibility/dossier-eligibility'
import type { AmscIndex } from '@/lib/intelligence/eligibility/bid-eligibility'

const IDX: AmscIndex = {
  ok: true,
  rows: new Map([['000000001', { niin: '000000001', amc: '1', amsc: 'G', aac: '', pica: 'GX' }]]),
  publishers: new Map([['GX', { rows: 10000, withAmsc: 10000, rate: 1 }]]),
  provenance: {},
}

const lane = (solicitationNumber: string) =>
  resolveDossierEligibility({ stockNumber: '000000001', solicitationNumber }, IDX).lane

const AUTOMATED = 'SPE4A626T15HA'
const AIDC = 'SPE7L426U1037'
const MANUAL = 'SPE4A626Q15HA'

describe('the lane is read from the ninth character, and it decides the surplus consequence', () => {
  it('★ T: quoting surplus is EXPRESSLY PERMITTED on the automated lane', () => {
    const l = lane(AUTOMATED)
    expect(l?.ninthPositionChar).toBe('T')
    expect(l?.instrument).toBe('automated_rfq')
    expect(l?.surplusOffer.consequence).toBe('expressly_permitted_on_this_lane')
    expect(l?.surplusOffer.sentence).toContain('do NOT make a quote')
    // The citation is pinned by its KEY, not by its prose: the package carries no `identifier`
    // string any more, because those strings were putting document numbers into the memo's
    // allowed-number set. `citationLabel` renders the paragraph at document time.
    expect(l?.surplusOffer.citation?.id).toBe('ms_part_i_L3a1_surplus_allowed')
    expect(citationLabel(l!.surplusOffer.citation!.id)).toContain('Part I para 3(a)(1), item 3')
  })

  it('★ U: the identical offer FALLS OUT OF AUTOMATED AWARD on the AIDC lane', () => {
    const l = lane(AIDC)
    expect(l?.ninthPositionChar).toBe('U')
    expect(l?.instrument).toBe('aidc')
    expect(l?.surplusOffer.consequence).toBe('falls_out_of_automated_award_on_this_lane')
    expect(l?.surplusOffer.sentence).toContain('out of automated award')
    expect(l?.surplusOffer.citation?.id).toBe('ms_part_ii_L1_aidc_exceptions')
    expect(citationLabel(l!.surplusOffer.citation!.id)).toContain('Part II para 1')
  })

  it('★ THE INVERSION ITSELF: one character apart, opposite outcomes, both stated', () => {
    // Not two separate assertions about two rows: the same question, the same material, and the
    // only difference between the inputs is the deciding character.
    const t = lane(AUTOMATED)!.surplusOffer
    const u = lane(AIDC)!.surplusOffer
    expect(t.hypothesis).toBe(u.hypothesis)
    expect(t.consequence).not.toBe(u.consequence)
    expect(t.citation?.id).not.toBe(u.citation?.id)
  })

  it('any other letter is a MANUAL solicitation, where the automated rules do not reach', () => {
    const l = lane(MANUAL)
    expect(l?.instrument).toBe('manual_rfq')
    expect(l?.surplusOffer.consequence).toBe('automated_award_rules_do_not_reach_this_lane')
    expect(l?.surplusOffer.sentence).toContain('a letter other than T or U')
  })

  it('the conditional is STATED, because no quote exists when a dossier is read', () => {
    expect(lane(AIDC)?.surplusOffer.hypothesis).toContain('No quote exists yet')
  })

  it('hyphens and spacing in the feed do not move the deciding character', () => {
    expect(lane('SPE7L4-26U1037')?.ninthPositionChar).toBe('U')
    expect(lane(' SPE7L426U1037 ')?.ninthPositionChar).toBe('U')
  })
})

describe('an undetermined lane is undetermined, never the permissive branch', () => {
  it('no solicitation on the row means no lane and a named gap', () => {
    const v = resolveDossierEligibility({ stockNumber: '000000001', solicitationNumber: null }, IDX)
    expect(v.lane).toBeNull()
    expect(v.gaps.join(' ')).toContain('no live solicitation is on this row')
    expect(v.cautions.map((c) => c.code)).not.toContain('surplus_falls_out_of_automated_award_on_this_lane')
  })

  it('a solicitation too short to carry a ninth position is a named gap, not an assumed T', () => {
    const v = resolveDossierEligibility({ stockNumber: '000000001', solicitationNumber: 'SPE4A6' }, IDX)
    expect(v.lane).toBeNull()
    expect(v.gaps.join(' ')).toContain('too short to carry a ninth position')
  })
})

describe('the U lane reaches the operator as a caution, not only as a field', () => {
  it('an AIDC row carries the caution and the stance moves off "no recorded bar"', () => {
    const v = resolveDossierEligibility({ stockNumber: '000000001', solicitationNumber: AIDC }, IDX)
    // The acquisition codes on this fixture are clean (AMSC G, open), so the ONLY thing that can
    // move the stance here is the lane. That is what makes this a control rather than a coincidence.
    expect(v.posture?.value.code).toBe('open_to_surplus_dealer')
    expect(v.pursuit.stance).toBe('proceed_with_stated_caution')
    expect(v.cautions.map((c) => c.code)).toEqual(['surplus_falls_out_of_automated_award_on_this_lane'])
    expect(v.gaps.some((g) => g.includes('out of automated award'))).toBe(true)
  })

  it('the same row on a T solicitation carries no caution at all', () => {
    const v = resolveDossierEligibility({ stockNumber: '000000001', solicitationNumber: AUTOMATED }, IDX)
    expect(v.cautions).toEqual([])
    expect(v.pursuit.stance).toBe('no_recorded_bar')
  })
})

describe('CROSS-CHECK: the gate engine, asked directly, says the same thing', () => {
  /*
   * `evaluateEligibility` is the orphaned 936 line engine that encodes the inversion against the
   * Master Solicitation's paragraphs. Material requirement code 4 is Unused Former Government
   * Surplus in the DIBBS batch specification. Asking it directly is the independent instrument:
   * it has no opinion about the shape of `DossierEligibility`.
   */
  const ask = (typeChar: string) =>
    evaluateEligibility({
      solicitation_id: 'CROSS-CHECK',
      solicitation_number_type_char: typeChar,
      offer_material_requirement_code: '4',
    }).reasons.map((r) => r.code)

  it('the engine disqualifies a surplus offer on U and permits it on T', () => {
    expect(ask('U')).toContain('aidc_surplus_disqualified')
    expect(ask('T')).toContain('surplus_permitted_on_automated_lane')
    expect(ask('U')).not.toContain('surplus_permitted_on_automated_lane')
    expect(ask('T')).not.toContain('aidc_surplus_disqualified')
  })

  it('★ the dossier verdict is pinned to the engine reason, not to a second copy of the rule', () => {
    const u = evaluateEligibility({
      solicitation_id: AIDC,
      solicitation_number_type_char: 'U',
      offer_material_requirement_code: '4',
    })
    const engineCitation = u.reasons.find((r) => r.code === 'aidc_surplus_disqualified')!.citation
    const dossierCitation = lane(AIDC)!.surplusOffer.citation!
    expect(dossierCitation.id).toBe(identifierSafe(engineCitation.id))
    expect(dossierCitation.verification).toBe(engineCitation.verification)
    // The label a reader sees is still the engine's own words, looked up from the engine's own
    // citation object at render time rather than copied onto the grounding package.
    expect(citationLabel(dossierCitation.id)).toContain(engineCitation.authority)
    // Same file, same line, written in the identifier form so the memo's number guard ignores it,
    // and reduced to the file name so no path off one developer's laptop reaches a partner.
    expect(dossierCitation.pin.replace(/:L/g, ':').replace(/-L/g, '-')).toBe(
      engineCitation.source.split('/').pop(),
    )
    expect(dossierCitation.pin).not.toContain('/')
  })
})
