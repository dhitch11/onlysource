/**
 * WHAT THE PRODUCT SAYS ABOUT THE MULTIPLE IT IS USING, AND WHY EVERY CLAIM IS COMPUTED.
 *
 * ---------------------------------------------------------------------------------------
 * THE DEFECT THIS FILE EXISTS TO CATCH
 * ---------------------------------------------------------------------------------------
 * Rung 2 shipped ONE caveat about the multiplier, whose sentence opened "The 3x is your own rule,
 * stated once about one item, and it is not a measured relationship." Every word of it was true of
 * the 3x. Then the default moved off 3 and THE SENTENCE DID NOT MOVE WITH IT, so the product began
 * telling the operator that a measured default was his own hunch, with the substituted number
 * making the sentence read as though somebody had checked.
 *
 * That is a provenance claim STORED beside a number instead of COMPUTED from it, and it is the
 * same failure as a confidence tier derived from ladder position, which this product also shipped.
 * The cure in both places is the same: compute the claim from the thing it claims about.
 *
 * So every assertion here drives the REAL engine at several multiples and checks that what it says
 * about the multiple is true OF THAT MULTIPLE. No assertion pins a string to the default, because
 * a test that goes red when an unrelated ruling moves is testing policy while claiming to test
 * behaviour, and twenty assertions in this suite already learned that the hard way.
 *
 * ---------------------------------------------------------------------------------------
 * POSITIVE CONTROLS, PERFORMED AND RECORDED
 * ---------------------------------------------------------------------------------------
 * Each was made in `lib/intelligence/pricing/recommend.ts`, the named test was watched going RED,
 * and the engine was restored. A test never seen to fail is decoration.
 *
 *   1. `multiplierCaveat` returning `MULTIPLIER_IS_A_STATED_RULE_NOT_A_MEASURED_SERIES` on both
 *      arms (the shipped behaviour before this change)
 *        -> "a measured multiple and a chosen one do not share a caveat code" RED.
 *   2. `multiplierInput` returning `evidenceState: 'PRIOR'` unconditionally (also the shipped
 *      behaviour before this change)
 *        -> "the multiplier's evidence grade follows the number" RED.
 *   3. `measuredRecordSentence` returning the nearest observation instead of abstaining off-grid
 *        -> "a multiple the grid does not hold gets an abstention, never an interpolation" RED.
 *   4. `AWARD_MULTIPLE_PRESETS` with the operator preset's `record` emptied
 *        -> "no preset is offered without its measured record" RED.
 *   5. `classifyAwardMultiple` returning 'MEASURED_OPTIMUM' for everything
 *        -> "a chosen multiple is never described as measured" RED.
 *   6. `rungLabelFor` returning `${m} times the last award price` with the standing dropped
 *        -> "a label that names a multiple also names where that multiple came from" RED.
 *
 * Each break was applied, the named test run alone, the file restored from a byte snapshot, and the
 * test re-run green. `.probe/positive-controls.py` performs all of them and asserts the restore is
 * byte-identical, because a control that leaves the tree altered is worse than no control.
 */

import { describe, expect, it } from 'vitest'
import {
  AWARD_MULTIPLE_PRESETS,
  DEFAULT_AWARD_MULTIPLE,
  MEASURED_CLEARANCE_CURVE,
  MEASURED_AWARD_MULTIPLE,
  MEASURED_AWARD_MULTIPLE_BAND,
  OPERATOR_AWARD_MULTIPLE,
  RECOMMENDATION_CONFIG,
  classifyAwardMultiple,
  describeAwardMultiple,
  measuredClearanceAt,
  measuredRecordSentence,
  presetForMultiple,
  recommendPrice,
  rungLabelFor,
  type RecommendationCaveat,
  type RecommendationConfig,
} from '@/lib/intelligence/pricing/recommend'
import { PRICING_INSTANT_MS, cleanAward } from './_fixtures'

/** A multiple the measured grid deliberately does not hold, used to prove the abstention. */
const OFF_GRID_MULTIPLE = 1.35

function at(multiple: number): RecommendationConfig {
  return { ...RECOMMENDATION_CONFIG, awardMultiple: multiple }
}

/**
 * One clean award dated at the pricing instant, so age widening is zero and rung 2 stands alone.
 * The price is a fixture: nothing here asserts a corpus figure.
 */
function rowAt(multiple: number) {
  return recommendPrice({
    nsn: '1650-01-059-8221',
    awards: [
      cleanAward({
        awardDateIso: '2026-01-29',
        unitPriceUsd: 1000,
        quantity: 4,
        awardeeCage: 'DLR01',
      }),
    ],
    approvedSourceCages: [],
    requirementQuantity: 4,
    atInstantMs: PRICING_INSTANT_MS,
    config: at(multiple),
  })
}

function multiplierCaveatOn(multiple: number): RecommendationCaveat {
  const rec = rowAt(multiple)
  if (!rec.resolved) throw new Error('the fixture must resolve on rung 2')
  const found = rec.caveats.find(
    (c) =>
      c.code === 'MULTIPLIER_IS_A_STATED_RULE_NOT_A_MEASURED_SERIES' ||
      c.code === 'MULTIPLIER_IS_A_MEASURED_OPTIMUM_WITH_ITS_OWN_RECORD',
  )
  if (found === undefined) throw new Error('rung 2 must always caveat its multiplier')
  return found
}

function multiplierInputOn(multiple: number) {
  const rec = rowAt(multiple)
  if (!rec.resolved) throw new Error('the fixture must resolve on rung 2')
  const found = rec.inputs.find((i) => i.label === 'Multiplier')
  if (found === undefined) throw new Error('rung 2 must always show its multiplier')
  return found
}

/* ------------------------------------------------- the two provenances are two codes */

describe('a measured multiple and a chosen one do not share a caveat', () => {
  it('a measured multiple and a chosen one do not share a caveat code', () => {
    // Inside the band, whatever the current default is: measured.
    expect(multiplierCaveatOn(MEASURED_AWARD_MULTIPLE).code).toBe(
      'MULTIPLIER_IS_A_MEASURED_OPTIMUM_WITH_ITS_OWN_RECORD',
    )
    expect(multiplierCaveatOn(MEASURED_AWARD_MULTIPLE_BAND.lowMultiple).code).toBe(
      'MULTIPLIER_IS_A_MEASURED_OPTIMUM_WITH_ITS_OWN_RECORD',
    )
    expect(multiplierCaveatOn(MEASURED_AWARD_MULTIPLE_BAND.highMultiple).code).toBe(
      'MULTIPLIER_IS_A_MEASURED_OPTIMUM_WITH_ITS_OWN_RECORD',
    )
    // Outside it, however defensible the operator's reason: chosen.
    expect(multiplierCaveatOn(OPERATOR_AWARD_MULTIPLE).code).toBe(
      'MULTIPLIER_IS_A_STATED_RULE_NOT_A_MEASURED_SERIES',
    )
    expect(multiplierCaveatOn(OFF_GRID_MULTIPLE).code).toBe(
      'MULTIPLIER_IS_A_STATED_RULE_NOT_A_MEASURED_SERIES',
    )
  })

  it('a chosen multiple is never described as measured, and a measured one never as a rule', () => {
    const chosen = multiplierCaveatOn(OPERATOR_AWARD_MULTIPLE).sentence
    const measured = multiplierCaveatOn(MEASURED_AWARD_MULTIPLE).sentence

    // The old sentence's opening, which was true of the 3x and false of everything else.
    expect(chosen).toContain('somebody chose')
    expect(measured).not.toContain('somebody chose')
    expect(measured).not.toContain('your own rule')

    // And they are not the same sentence with a number swapped in.
    expect(measured).not.toBe(chosen)
    expect(measured.replace(/[\d.]+/g, '#')).not.toBe(chosen.replace(/[\d.]+/g, '#'))
  })

  it('the caveat states the band rather than pretending the second decimal is precision', () => {
    const sentence = multiplierCaveatOn(MEASURED_AWARD_MULTIPLE).sentence
    expect(sentence).toContain('0.95x to 1x')
    expect(sentence).toContain('FLAT')
    // The cost basis is assumed, and a margin claim that hides that is a claim we cannot make.
    expect(sentence).toContain('ASSUMED')
    expect(sentence).toContain('no cost of goods')
  })

  it('the operator’s own rule keeps its record wherever it is offered', () => {
    const sentence = multiplierCaveatOn(OPERATOR_AWARD_MULTIPLE).sentence
    expect(sentence).toContain('I quoted $3,565')
    // Its measured outcome, as an upper bound, never as a win rate.
    expect(sentence).toContain('1.50%')
    expect(sentence).toContain('upper bound')
    // And the mitigation somebody will reach for next, measured and refuted before it shipped.
    expect(sentence).toContain('sole-source')
    expect(sentence).toContain('0.00%')
  })

  it('every rung that multiplies carries the caveat, and rung 1 never does', () => {
    // Rung 1 does not multiply, so nothing about the multiple may be said on it.
    const rec = rowAt(OPERATOR_AWARD_MULTIPLE)
    if (!rec.resolved) throw new Error('unreachable')
    for (const rung of rec.ladder) {
      if (!rung.resolved) continue
      const carries = rung.caveats.some(
        (c) =>
          c.code === 'MULTIPLIER_IS_A_STATED_RULE_NOT_A_MEASURED_SERIES' ||
          c.code === 'MULTIPLIER_IS_A_MEASURED_OPTIMUM_WITH_ITS_OWN_RECORD',
      )
      expect(carries).toBe(rung.rung !== 'R1_MANUFACTURER_ANCHOR')
    }
  })
})

/* --------------------------------------------------------------- the evidence grade */

describe('the multiplier’s evidence grade follows the number', () => {
  it('the multiplier’s evidence grade follows the number', () => {
    /*
     * ESTIMATED and not MEASURED inside the band, deliberately. The clearance curve is measured;
     * the choice of a point on it rests on an ASSUMED cost basis, and deriving is what makes a
     * figure ESTIMATED. Grading it MEASURED would launder the assumption into a reading.
     */
    expect(multiplierInputOn(MEASURED_AWARD_MULTIPLE).evidenceState).toBe('ESTIMATED')
    expect(multiplierInputOn(MEASURED_AWARD_MULTIPLE_BAND.highMultiple).evidenceState).toBe(
      'ESTIMATED',
    )
    // Outside the band it is somebody's bare judgement, which is what PRIOR means.
    expect(multiplierInputOn(OPERATOR_AWARD_MULTIPLE).evidenceState).toBe('PRIOR')
    expect(multiplierInputOn(OFF_GRID_MULTIPLE).evidenceState).toBe('PRIOR')
  })

  it('renders the multiple the way a human types it, at every multiple', () => {
    expect(multiplierInputOn(3).renderedValue).toBe('3x')
    expect(multiplierInputOn(0.98).renderedValue).toBe('0.98x')
    expect(multiplierInputOn(1).renderedValue).toBe('1x')
  })

  it('describes the multiple in force and not the one that used to be the default', () => {
    const three = multiplierInputOn(OPERATOR_AWARD_MULTIPLE).source
    const measured = multiplierInputOn(MEASURED_AWARD_MULTIPLE).source
    expect(three).toContain('three times the unit price of the previous')
    expect(measured).not.toContain('three times the unit price of the previous')
  })

  it('honours a stated source instead of writing one over the top of it', () => {
    const rec = recommendPrice({
      nsn: '1650-01-059-8221',
      awards: [
        cleanAward({
          awardDateIso: '2026-01-29',
          unitPriceUsd: 1000,
          quantity: 4,
          awardeeCage: 'DLR01',
        }),
      ],
      approvedSourceCages: [],
      requirementQuantity: 4,
      atInstantMs: PRICING_INSTANT_MS,
      config: { ...at(1.25), awardMultipleSource: 'Because the buyer told me so on the phone.' },
    })
    if (!rec.resolved) throw new Error('unreachable')
    const input = rec.inputs.find((i) => i.label === 'Multiplier')
    expect(input?.source).toBe('Because the buyer told me so on the phone.')
  })
})

/* ------------------------------------------- absence is a state, never a zero */

describe('a multiple the grid does not hold gets an abstention, never an interpolation', () => {
  it('a multiple the grid does not hold gets an abstention, never an interpolation', () => {
    // The lookup itself distinguishes "measured, and here it is" from "we have nothing".
    expect(measuredClearanceAt(MEASURED_AWARD_MULTIPLE)).not.toBeNull()
    expect(measuredClearanceAt(OFF_GRID_MULTIPLE)).toBeNull()

    const sentence = measuredRecordSentence(OFF_GRID_MULTIPLE)
    expect(sentence).toContain(`No clearance rate was measured at ${OFF_GRID_MULTIPLE}x`)
    expect(sentence).toContain('no measured record of its own')
    // It must not report a clearance rate for a multiple nobody measured.
    expect(sentence).not.toContain('came in at or below')
    // Naming the two real points either side is not an interpolation, and it says so.
    expect(sentence).toContain('nothing between them is interpolated')
    expect(sentence).toContain('1.2x at 12.50%')
    expect(sentence).toContain('1.5x at 6.20%')
  })

  it('a measured point reports its rate as an upper bound and names its sample', () => {
    const sentence = measuredRecordSentence(MEASURED_AWARD_MULTIPLE)
    expect(sentence).toContain('19,475')
    expect(sentence).toContain('2,019 stock numbers')
    expect(sentence).toContain('75.70%')
    expect(sentence).toContain('upper bound')
  })

  it('never reports a margin figure for a multiple the lane did not publish one for', () => {
    // 0.95 has a clearance rate and NO published margin share. The absence must stay absent.
    const observation = measuredClearanceAt(MEASURED_AWARD_MULTIPLE_BAND.lowMultiple)
    expect(observation?.shareOfPeakMarginEvAtAssumedCost080).toBeNull()
    expect(measuredRecordSentence(MEASURED_AWARD_MULTIPLE_BAND.lowMultiple)).not.toContain(
      'of the expected margin available',
    )
    // And the multiple that does have one says so, with its assumption attached - TO A CALLER
    // PERMITTED TO SEE MARGIN. The capability is explicit here because it now defaults CLOSED.
    expect(measuredRecordSentence(OPERATOR_AWARD_MULTIPLE, true)).toContain(
      'of the expected margin available',
    )
  })
})

/* ---------------------------------------------------------------- margin.view */

/**
 * THE SECRET IS ASSERTED ABSENT, NOT THE GUARD ASSERTED PRESENT.
 *
 * A test that checks "the permission was consulted" passes on the day somebody adds a second
 * sentence carrying the same figure. These assert that nothing margin-shaped survives into the
 * text at all, which is the property that actually matters.
 *
 * WHY THIS EXISTS: `margin.view` governs SEEING a fact, and this product enforces permissions at
 * the point of ACTION, so read paths had none. This figure is the only margin-shaped content the
 * pricing engine can emit and it travels as PROSE, through `rec.inputs[].source` and
 * `rec.caveats[].sentence`. No component references the field; a reachability census calls it
 * unreached; a grep for "margin" on the rendered page returns only generic explanation. Third
 * instance on this estate of one law: a protected fact that travels as prose is invisible to
 * every field-level check.
 *
 * POSITIVE CONTROL, run by hand: making the margin clause unconditional turns the first two of
 * these red, and defaulting `mayReadMargin` to true turns the third red.
 */
describe('a caller without margin.view is never told a margin figure', () => {
  const MARGIN_SHAPES = [
    /of the expected margin available/i,
    /assumed cost/i,
    /0\.80 x the previous award price/i,
    /% of the expected margin/i,
    /margin available at/i,
  ]

  /*
   * The first draft of this list carried /\d+% of the/ and it was WRONG: it matched the clearance
   * rate, "came in at or below ... 91.10% of the time", which `margin.view` does not protect and
   * which a caller without it is entitled to see. An over-broad secret shape does not make a test
   * stricter, it makes it test something else, and it would have forced an honest reduction to
   * withhold the very number the operator came for.
   */

  it('emits no margin-shaped phrase for any multiple in the grid', () => {
    for (const o of MEASURED_CLEARANCE_CURVE) {
      const text = measuredRecordSentence(o.multiple)
      for (const shape of MARGIN_SHAPES) {
        expect(text, `multiple ${o.multiple} leaked ${shape}`).not.toMatch(shape)
      }
    }
  })

  it('says a margin comparison was withheld rather than staying silent about it', () => {
    // A reader who cannot see a number should know one exists and was withheld. Silence teaches
    // them the product had nothing to say, which is a different and false claim.
    const withheld = measuredRecordSentence(OPERATOR_AWARD_MULTIPLE)
    expect(withheld).toContain('is held and is not shown to you')
    expect(withheld).not.toMatch(/assumed cost/i)
  })

  it('defaults closed, so a call site that forgets to ask cannot leak', () => {
    const forgot = describeAwardMultiple({ ...RECOMMENDATION_CONFIG, awardMultiple: 1.1 })
    for (const shape of MARGIN_SHAPES) expect(forgot).not.toMatch(shape)
    // And the same call with the capability granted DOES carry it, so the gate is the cause.
    expect(describeAwardMultiple({ ...RECOMMENDATION_CONFIG, awardMultiple: 1.1 }, true)).toMatch(
      /assumed cost/i,
    )
  })

  it('keeps the clearance rate, which margin.view does not protect', () => {
    // An honest reduction removes the margin and nothing else. Withholding the whole record would
    // be a different lie: it would imply we had not measured the item at all.
    expect(measuredRecordSentence(OPERATOR_AWARD_MULTIPLE)).toMatch(/came in at or below/)
  })
})

/* ------------------------------------------------------------------- the presets */

describe('the presets are data, and no preset is offered without its record', () => {
  it('no preset is offered without its measured record', () => {
    expect(AWARD_MULTIPLE_PRESETS.length).toBeGreaterThan(1)
    for (const preset of AWARD_MULTIPLE_PRESETS) {
      expect(preset.label.trim()).not.toBe('')
      expect(preset.record.trim()).not.toBe('')
      // Every record either states a measured rate or states that none was measured. Never mute.
      const saysSomethingMeasured =
        preset.record.includes('Measured over') || preset.record.includes('No clearance rate')
      expect(saysSomethingMeasured).toBe(true)
    }
  })

  it('grades the operator’s rule differently from the measured points', () => {
    const operator = AWARD_MULTIPLE_PRESETS.find((p) => p.id === 'OPERATOR_STATED_RULE')
    expect(operator?.value).toBe(OPERATOR_AWARD_MULTIPLE)
    expect(operator?.provenance).toBe('PRIOR')
    for (const preset of AWARD_MULTIPLE_PRESETS) {
      if (preset.id === 'OPERATOR_STATED_RULE') continue
      expect(preset.provenance).toBe('MEASURED')
    }
  })

  it('is matched BY VALUE, so reordering the list moves nothing', () => {
    expect(presetForMultiple(OPERATOR_AWARD_MULTIPLE)?.id).toBe('OPERATOR_STATED_RULE')
    expect(presetForMultiple(MEASURED_AWARD_MULTIPLE)?.id).toBe('MEASURED_MARGIN_OPTIMUM')
    // A number that is not a preset is not silently rounded into the nearest one.
    expect(presetForMultiple(OFF_GRID_MULTIPLE)).toBeNull()
  })

  it('keeps the operator’s 3x available and off the default at the same time', () => {
    expect(AWARD_MULTIPLE_PRESETS.some((p) => p.value === OPERATOR_AWARD_MULTIPLE)).toBe(true)
    expect(DEFAULT_AWARD_MULTIPLE).not.toBe(OPERATOR_AWARD_MULTIPLE)
    expect(RECOMMENDATION_CONFIG.awardMultiple).not.toBe(OPERATOR_AWARD_MULTIPLE)
  })
})

/* ---------------------------------------------------------------- the classifier */

describe('where a multiple stands is a fact about the number, not about the rung', () => {
  it('places every preset and the two edges of the band', () => {
    expect(classifyAwardMultiple(MEASURED_AWARD_MULTIPLE)).toBe('MEASURED_OPTIMUM')
    expect(classifyAwardMultiple(MEASURED_AWARD_MULTIPLE_BAND.lowMultiple)).toBe(
      'INSIDE_THE_MEASURED_BAND',
    )
    expect(classifyAwardMultiple(MEASURED_AWARD_MULTIPLE_BAND.highMultiple)).toBe(
      'INSIDE_THE_MEASURED_BAND',
    )
    expect(classifyAwardMultiple(MEASURED_AWARD_MULTIPLE_BAND.advisoryCeilingMultiple)).toBe(
      'ABOVE_THE_BAND_WITHIN_THE_ADVISORY_CEILING',
    )
    expect(classifyAwardMultiple(OPERATOR_AWARD_MULTIPLE)).toBe('OUTSIDE_THE_MEASURED_BAND')
    // Under the band is outside it too. Bidding far below the last award is not measured either.
    expect(classifyAwardMultiple(0.5)).toBe('OUTSIDE_THE_MEASURED_BAND')
  })

  it('a label that names a multiple also names where that multiple came from', () => {
    /*
     * A label giving only the digits leaves the reader to assume, and the assumption anybody makes
     * about a headline number is that somebody measured it. "0.98 times the last award price" and
     * "3 times the last award price" would otherwise read as equally authoritative.
     */
    const measured = rungLabelFor('R2_LAST_AWARD_MULTIPLE', at(MEASURED_AWARD_MULTIPLE))
    expect(measured).toContain('0.98')
    expect(measured).toContain('measured')

    const chosen = rungLabelFor('R2_LAST_AWARD_MULTIPLE', at(OFF_GRID_MULTIPLE))
    expect(chosen).toContain('1.35')
    expect(chosen).toContain('outside the measured band')

    // His rule keeps his own words, named by identity rather than by any position.
    expect(rungLabelFor('R2_LAST_AWARD_MULTIPLE', at(OPERATOR_AWARD_MULTIPLE))).toBe(
      'three times the last award price, the rule you gave us',
    )
    // Rung 1 never multiplies, so its label may not move with the multiple at all.
    expect(rungLabelFor('R1_MANUFACTURER_ANCHOR', at(OFF_GRID_MULTIPLE))).toBe(
      rungLabelFor('R1_MANUFACTURER_ANCHOR', at(MEASURED_AWARD_MULTIPLE)),
    )
  })

  it('whatever the default is, it is inside the band the measurement supports', () => {
    /*
     * Deliberately NOT an assertion that the default equals any particular number: that belongs in
     * one file and one file only. This asserts the property the product must hold whichever point
     * inside the band the owner rules for.
     */
    const stance = classifyAwardMultiple(DEFAULT_AWARD_MULTIPLE)
    expect(['MEASURED_OPTIMUM', 'INSIDE_THE_MEASURED_BAND']).toContain(stance)
    expect(DEFAULT_AWARD_MULTIPLE).toBeGreaterThanOrEqual(
      MEASURED_AWARD_MULTIPLE_BAND.lowMultiple,
    )
    expect(DEFAULT_AWARD_MULTIPLE).toBeLessThanOrEqual(
      MEASURED_AWARD_MULTIPLE_BAND.advisoryCeilingMultiple,
    )
  })
})
