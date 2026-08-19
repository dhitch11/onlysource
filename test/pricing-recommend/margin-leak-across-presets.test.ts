/**
 * NO MARGIN-SHAPED TEXT CROSSES TO THE PAGE, FOR ANY PRESET AN OPERATOR CAN ACTUALLY PICK.
 *
 * =========================================================================================
 * WHY THIS EXISTS SEPARATELY FROM THE OTHER MARGIN TEST
 * =========================================================================================
 * The first leak test called `measuredRecordSentence` and `describeAwardMultiple` directly. That
 * proved those two functions are gated. It did NOT prove that nothing margin-shaped reaches the
 * page, because a recommendation carries prose in several places: `inputs[].source`,
 * `caveats[].sentence`, the winning rung's `arithmetic`, `wouldSharpenWith`, the top-level
 * `sentence`, and every rung of `ladder`. A guard on two call sites says nothing about the seventh.
 *
 * ★ THE GAP WAS FOUND BY SOMEBODY MEASURING THE SERVED ROUTE WHILE I HAD MEASURED THE FUNCTIONS.
 * Both readings were correct and they were of different things. So this asserts against the WHOLE
 * SERIALISED RECOMMENDATION, which is exactly the object that becomes the page, for every preset
 * value the control offers.
 *
 * It is the same principle as before: ASSERT THE SECRET IS ABSENT, NOT THAT THE GUARD IS PRESENT.
 * A guard check passes the day somebody adds an eighth prose field.
 *
 * POSITIVE CONTROL, run by hand and recorded: passing `mayReadMargin: true` turns the first test
 * red on the presets that carry a margin record, which proves the assertion can see into the
 * serialised object rather than merely finding nothing.
 */
import { describe, expect, it } from 'vitest'
import {
  AWARD_MULTIPLE_PRESETS,
  RECOMMENDATION_CONFIG,
  recommendPrice,
} from '@/lib/intelligence/pricing/recommend'
import { PRICING_INSTANT_MS, fullLadderInput } from './_fixtures'

/**
 * The shapes that mean "a margin figure". Deliberately NOT `/\d+% of the/`: that matched the
 * clearance rate, which `margin.view` does not protect and which the operator came for. An
 * over-broad secret shape does not make a test stricter, it makes it test something else.
 */
const MARGIN_SHAPES: readonly RegExp[] = [
  /% of the expected margin/i,
  /margin available at/i,
  /assumed cost of/i,
  /0\.80 x the previous award price/i,
]

/*
 * ★★ WHERE THE BOUNDARY IS, DECIDED DELIBERATELY RATHER THAN FITTED TO MAKE THE CODE PASS.
 *
 * The first draft of this list carried `/of the expected margin/i` and it went red on a real
 * sentence: "the 0.98x is a MEASURED figure ... it is the peak of the expected margin curve on our
 * own award history." That names the ANALYSIS. It carries no margin amount, no percentage and no
 * cost basis.
 *
 * I could have gated that sentence and made the test green. It would have been incoherent, and
 * the proof is one line up on the same screen: the preset the operator clicks is LABELLED "the
 * measured margin optimum", and that label renders to every caller unconditionally. Gating the
 * word in a caveat while the button beside it says the same thing protects nothing and only
 * makes the product read as though it were hiding something.
 *
 * SO THE BOUNDARY IS: `margin.view` protects margin FIGURES and the COST BASIS, which is what the
 * permission itself says it is for ("See cost, margin and pricing on a quote"). It does not
 * protect the EXISTENCE of the analysis or the IDENTITY of the optimum, both of which are already
 * visible in the multiple itself.
 *
 * This is the second time tonight an over-broad secret shape has gone red on something the
 * operator is entitled to see: the other caught the CLEARANCE rate. The lesson is not "loosen the
 * regex until it passes" — it is that a secret shape encodes a DECISION about what the secret is,
 * and writing one without making that decision produces an instrument that confidently measures
 * something else.
 */

const forMultiple = (multiple: number, mayReadMargin: boolean) =>
  recommendPrice({
    ...fullLadderInput({ approvedSourceCages: [] }),
    atInstantMs: PRICING_INSTANT_MS,
    config: { ...RECOMMENDATION_CONFIG, awardMultiple: multiple },
    mayReadMargin,
  })

describe('every preset an operator can pick, serialised whole', () => {
  it('carries no margin-shaped text anywhere for a caller without margin.view', () => {
    for (const preset of AWARD_MULTIPLE_PRESETS) {
      const serialised = JSON.stringify(forMultiple(preset.value, false))
      for (const shape of MARGIN_SHAPES) {
        expect(serialised, `preset ${preset.id} (${preset.value}x) leaked ${shape}`).not.toMatch(
          shape,
        )
      }
    }
  })

  it('still produces a usable recommendation at every preset, so the gate is not a blank page', () => {
    // An honest reduction removes the protected figure and NOTHING else. A leak test that passes
    // because the page broke is the worst possible green.
    for (const preset of AWARD_MULTIPLE_PRESETS) {
      const rec = forMultiple(preset.value, false)
      expect(rec.resolved, `preset ${preset.id} stopped resolving`).toBe(true)
      if (!rec.resolved) continue
      expect(rec.awardMultiple).toBe(preset.value)
      expect(rec.arithmetic.length).toBeGreaterThan(0)
      expect(rec.sentence.length).toBeGreaterThan(0)
    }
  })

  it('names the analysis and the optimum, which the permission does not protect', () => {
    // The boundary, asserted rather than left to a comment. The preset LABEL says "the measured
    // margin optimum" to every caller, so the caveat naming the same analysis is not a leak. If
    // this ever needs to change, it changes here and on the label together, or the product is
    // gating one half of one fact.
    const rec = forMultiple(0.98, false)
    expect(rec.resolved).toBe(true)
    if (!rec.resolved) return
    const prose = JSON.stringify(rec.caveats)
    expect(prose).toMatch(/expected margin curve/i)
    for (const shape of MARGIN_SHAPES) expect(prose).not.toMatch(shape)
  })

  it('is a real check, because granting the permission puts the margin text back', () => {
    // Without this the first test could pass on an engine that never emits margin text at all,
    // which would make it a tautology rather than a control.
    const withMargin = AWARD_MULTIPLE_PRESETS.map((p) =>
      JSON.stringify(forMultiple(p.value, true)),
    )
    expect(
      withMargin.some((s) => MARGIN_SHAPES.some((shape) => shape.test(s))),
      'no preset emits margin text even when permitted, so the leak test proves nothing',
    ).toBe(true)
  })
})
