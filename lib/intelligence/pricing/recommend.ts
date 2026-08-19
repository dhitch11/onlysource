/**
 * THE PRICE RECOMMENDATION: one defensible number on every row the evidence can carry one, on the
 * STRONGEST basis that row holds, with the basis named in the operator's own language.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS FILE EXISTS, AND WHAT CHANGED TO MAKE IT LEGAL
 * ---------------------------------------------------------------------------------------
 * `quote-view.ts` publishes FOUR separately auditable figures and deliberately no single
 * recommended number, because BD-19 forbade one. The consequence, measured on the live board,
 * was silence on 98.1% of rows: the anchor needs a manufacturer award in the inflation factors'
 * base year, and 49 of 5,366 served rows have one.
 *
 * The owner lifted that rule on 2026-08-18, in the open, in his own words: "Remove that rule of
 * 100% required. Make it happen as educated and premium and verified as possible." Silence is
 * now a product failure. This module is the answer, and it is ADDITIVE: the four figures remain
 * underneath as the audit trail, and nothing here edits them.
 *
 * ONE RULE WAS LIFTED. THE PRICING RULES WERE NOT.
 *
 *   BD-18 IS LAW. The $200 (unused former Government surplus) and $600 (ESA coordination)
 *   figures are DLA'S EVALUATION FACTORS. The buyer adds them to OUR total to form the number it
 *   compares against competitors. They are not part of the quote we send and not a cost we pay.
 *   THE RECOMMENDATION IS A QUOTED NUMBER. If it folded the adders in, the operator would type a
 *   figure $600 too high into DIBBS and lose an award they had already won. So the recommendation
 *   carries `quotedTotal` as a `QuotedTotalUsd` object and the evaluated figures live on a
 *   SEPARATE type that cannot be added to it: `a + b` on two objects is a compile error, and
 *   `assertRecommendationCarriesNoEvaluationFactor` is the runtime guard that says so out loud.
 *
 *   NOTHING IS INVENTED. Every figure below is COMPUTED from evidence on the row and names the
 *   evidence it consumed, with its date and its source. "Educated" means derived and shown.
 *
 *   THE ARITHMETIC IS DETERMINISTIC. Code produces the number. A model may explain it, weigh
 *   comparability, or draft prose about it. No model emits a price that ships.
 *
 *   BD-17 STANDS. The true product is asserted, never a human's rounding of it. 1537.85 x 1.40
 *   is 2152.99 and 1188.33 x 3 is 3564.99. The operator's "approximately 2,150" and his written
 *   "$3,565" are HIS roundings, reconciled beside the product, never asserted as the product.
 *
 * ---------------------------------------------------------------------------------------
 * THE BASIS LADDER, AND WHY CONFIDENCE IS THE RUNG RATHER THAN A SCORE
 * ---------------------------------------------------------------------------------------
 * A 0 to 100 confidence number nobody can audit is the same failure as a blended price: it reads
 * as a measurement and it is a feeling. So the confidence a row carries IS THE RUNG IT LANDED
 * ON, named, with the inputs it consumed and WHAT WOULD MOVE IT UP A RUNG. That last clause is
 * what makes a recommendation educated rather than merely confident, and it doubles as the
 * product's own roadmap: every abstention and every weak rung states the evidence that would
 * retire it.
 *
 *   R1  the manufacturer's own award carried forward by the two inflation factors on file
 *   R2  the operator's own rule: a multiple of the last award unit price
 *   R3  the band of this item's own recent awards
 *   R4  the trend across this item's whole award history
 *   R5  the band of priced peers in the same supply class, the weakest basis we hold
 *
 * INPUT AVAILABILITY, measured by the conductor over the live board (5,366 served rows) on
 * 2026-08-18. It is availability of the INPUTS, not the coverage this engine produces, which is
 * lower by construction because a higher rung consumes rows a lower rung could also have served:
 *
 *     any award record          1,614  30.1%      last award unit price   1,132  21.1%
 *     2+ awards                   919  17.1%      3+ awards                 757  14.1%
 *     quantity known            5,366 100.0%      FSC groups with a priced peer   171
 *     the CPI/DoD anchor           49   1.9%
 *
 * ---------------------------------------------------------------------------------------
 * THE BAND WIDENS AS YOU DESCEND, AND IT IS ENFORCED RATHER THAN ASSUMED
 * ---------------------------------------------------------------------------------------
 * A weaker basis may not report a tighter band than a stronger one. Real data does not respect
 * that on its own: three peer awards can happen to sit within a percent of each other while the
 * two inflation factors on file disagree by six. So every rung this row can resolve is computed,
 * they are ordered strongest first, and each one's width is floored at the width of the rung
 * above it. The floor is never an invented constant: it is another rung's COMPUTED width on THIS
 * row, and the widening is disclosed by name on the weaker rung.
 *
 * Widening is the safe direction and narrowing is the dangerous one, which is also why the cent
 * rounding on a band is outward: the low endpoint floors and the high endpoint ceilings, so a
 * rounding can never make a band look tighter than the evidence behind it.
 *
 * ---------------------------------------------------------------------------------------
 * THE FOUR TRAPS, DESIGNED AGAINST RATHER THAN NOTICED LATER
 * ---------------------------------------------------------------------------------------
 *  1. QUANTITY. Quantity is known on 100% of served rows, so there is no excuse for comparing a
 *     unit price across order sizes without normalising. Every comparable enters as a per-unit
 *     figure whose own row agrees with itself (the Unit Price column and Final Price divided by
 *     quantity within a cent), and when a comparable's order size is an order of magnitude away
 *     from this requirement's the crossing is named with both quantities.
 *  2. SURPLUS. A surplus-material award price is not a new-manufacture bid basis. The export's
 *     own Surplus column is read three-state through the audited `readSurplus`, and the awardee
 *     verdict from `lib/intelligence/suppliers/classify` is read SEPARATELY, because a surplus
 *     flag describes the MATERIAL and a dealer verdict describes the COMPANY. Only the material
 *     flag can exclude a comparable, and only when the operator has declared they would offer new
 *     material. Everything else is labelled and counted, never silently averaged in.
 *  3. STALE DRIFT. A 2019 award used as a 2026 basis without an inflation series is the hole the
 *     missing series leaves. Until a dated series lands, an old basis WIDENS the band by its age,
 *     at a rate DERIVED from the only statement the corpus makes about a year of drift: the two
 *     stated factors disagree by 5.88% over their nine years, which is 0.6364% a year. The age is
 *     printed in the output.
 *  4. SINGLE-OBSERVATION BANDS. A band from one observation is a point estimate wearing a shape
 *     that looks more rigorous than it is. The peer rung refuses below three priced peers and
 *     says what it needs instead.
 *
 * ---------------------------------------------------------------------------------------
 * PURE. No I/O, no clock, no feed, no network.
 * ---------------------------------------------------------------------------------------
 * The pricing instant is a required argument with no default, exactly as it is everywhere else in
 * this package, because every threshold and band the engine resolves is dated. The award history,
 * the awardee classifier and the peer lookup are injected, so every test drives this with inputs
 * whose correct answers were worked out by hand before the code ran.
 */

import {
  INDEX_CONFIG_1650,
  PRICING_CONFIG,
  anchorPrice,
  applyFactorToCents,
  centsToUsd,
  evaluatedTotal,
  quotedTotal,
  tripwireBand,
  usdToCents,
  type AdderCode,
  type AnchorIndexConfig,
  type InflationIndexSpec,
  type IndexKind,
  type PricingConfig,
  type SourceCitation,
  type TripwireBandKind,
} from '@/lib/engine/pricing'
import { readSurplus, type AwardeeVerdict, type SurplusState } from '@/lib/intelligence/suppliers/classify'
import {
  identifyOemAward,
  type DossierAward,
  type EvaluatedTotalUsd,
  type OemAwardIdentification,
  type QuoteEvidenceState,
  type QuotedTotalUsd,
  type QuoteViewInput,
} from './quote-view'

/* ------------------------------------------------------------------------------------ */
/* THE LADDER                                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * Strongest first. The order is the contract: a row is served by the FIRST rung that resolves,
 * and every rung below it is still computed so the operator can see what the alternatives were
 * and so a weaker band can be floored at a stronger one's width.
 */
export const RECOMMENDATION_RUNGS = [
  'R1_MANUFACTURER_ANCHOR',
  'R2_LAST_AWARD_MULTIPLE',
  'R3_RECENT_AWARD_BAND',
  'R4_AWARD_TREND',
  'R5_FSC_PEER_BAND',
] as const

export type RecommendationRung = (typeof RECOMMENDATION_RUNGS)[number]

/**
 * THE RUNG LABEL WITH THE MULTIPLE ACTUALLY IN FORCE WRITTEN INTO IT.
 *
 * ★★ THIS FUNCTION WAS ANNOUNCED IN A COMMENT BEFORE IT EXISTED. `RUNG_LABELS` was rewritten to
 * say "at the multiple in force" with a note explaining that the number "lives in `rungLabelFor`"
 * — and `rungLabelFor` was never written, and every label kept being read straight out of the
 * static map. A comment is not a control: it described behaviour no code performed, which is the
 * same defect this product has shipped three times in other forms. It exists now.
 *
 * Labels that name a number MUST be computed from that number. A static label saying "three
 * times" beside an engine multiplying by 1 is a false statement on the money field, and it is
 * how a 0.00% figure came to wear "High confidence" earlier tonight.
 */
export function rungLabelFor(rung: RecommendationRung, config: RecommendationConfig): string {
  const m = config.awardMultiple
  if (rung !== 'R2_LAST_AWARD_MULTIPLE' && rung !== 'R3_RECENT_AWARD_BAND' && rung !== 'R4_AWARD_TREND') {
    return RUNG_LABELS[rung]
  }
  /*
   * At 1x nothing is being multiplied, and saying "one times the last award price" would be
   * arithmetically true and read as nonsense. The honest phrasing is that the price is carried
   * across unchanged, which is also exactly what the measurement supports.
   */
  const at =
    m === 1
      ? 'carried across unchanged'
      : m === OPERATOR_AWARD_MULTIPLE
        ? 'three times over, the rule you gave us'
        : `at ${m}x`
  if (rung === 'R2_LAST_AWARD_MULTIPLE') {
    return m === 1
      ? 'the last award price, carried across unchanged'
      : m === OPERATOR_AWARD_MULTIPLE
        ? 'three times the last award price, the rule you gave us'
        : `${m} times the last award price`
  }
  if (rung === 'R3_RECENT_AWARD_BAND') {
    return `the band of this stock number\u2019s own recent awards, ${at}`
  }
  return `the trend across this stock number\u2019s whole award history, ${at}`
}

/** The operator's language for each rung. Rendered as-is; no surface rewrites these. */
export const RUNG_LABELS: Readonly<Record<RecommendationRung, string>> = {
  R1_MANUFACTURER_ANCHOR:
    "the manufacturer's own award price carried forward, CPI at the low end and the DoD " +
    'procurement factor the expert prefers at the high end',
  /*
   * ★ NO LONGER "three times the last award price". This entry is the CONFIG-FREE name of the
   * rung and it is rendered by /pricing as a static ladder legend, so it may not state a number
   * the row in front of the reader is not using. The number lives in `rungLabelFor`, which reads
   * the multiple actually in force. A label naming 3x while the engine computed 0.98x is the same
   * class of defect as a confidence tier derived from ladder position.
   */
  R2_LAST_AWARD_MULTIPLE: 'a multiple of the last award price, at the multiple in force',
  R3_RECENT_AWARD_BAND:
    'the band of this stock number’s own recent awards, at the multiple in force',
  R4_AWARD_TREND:
    'the trend across this stock number’s whole award history, at the multiple in force',
  R5_FSC_PEER_BAND:
    'the band of priced peers in the same supply class, the weakest basis we hold',
}

/* ------------------------------------------------------------------------------------ */
/* CONFIGURATION: EVERY JUDGEMENT IS NAMED, VISIBLE AND ADJUSTABLE                        */
/* ------------------------------------------------------------------------------------ */

/**
 * THE OPERATOR'S OWN MULTIPLIER. STILL HERE, STILL EXACT, NO LONGER THE DEFAULT.
 *
 * The build directive records him verbatim: "I quoted $3,565, three times the unit price of the
 * previous award", which is 3 x $1,188.33. That is a RULE WITH ONE INPUT and it is HIS, and it
 * won him the buy he wrote about. It is kept as a first-class preset, it computes exactly what
 * his sentence says when he chooses it, and `test/pricing-recommend/wayne-rule.test.ts` still
 * holds it to 3564.99.
 *
 * WHAT CHANGED ON 2026-08-19: it stopped being the number this product puts on a row by default,
 * because it was measured and it does not work. See `MEASURED_AWARD_MULTIPLE` below for the
 * measurement and `AWARD_MULTIPLE_PRESETS` for the record it now carries wherever it is offered.
 *
 * It remains a stated judgement rather than a measured series, so it is graded PRIOR wherever it
 * appears, which is a different grade from the default's.
 */
export const OPERATOR_AWARD_MULTIPLE = 3

/**
 * THE MEASURED DEFAULT, AND THE ONE LINE THAT REVERTS THE WHOLE CHANGE.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT WAS MEASURED, AND WHY IT REPLACED A 3
 * ---------------------------------------------------------------------------------------
 * The 3x came from ONE won anecdote. Three independent implementations, different authors, then
 * asked the corpus what it would have done in general. The test is deliberately an OUTCOME and
 * not a model: for an ordered pair of awards on the same stock number, would `multiple x the
 * earlier unit price` have come in AT OR BELOW the price the item ACTUALLY cleared at next time?
 * That later price is the one that beat everybody, so it is a fact rather than a forecast.
 *
 * BEING AT OR BELOW THE CLEARING PRICE IS NECESSARY TO WIN AND IS NOT SUFFICIENT: the offer must
 * also be technically acceptable, from an approved or qualified source, from a responsible
 * offeror and competitive on delivery, and DLA adds its evaluation factors to OUR total before
 * comparing. Every screen can only remove wins. So every share below is an UPPER BOUND on the
 * probability of winning, and it is labelled that way wherever it is rendered.
 *
 * The sample the earlier lanes used had to be repaired first, and the repair moved the headline:
 * 4,142,708 of its 6,042,114 ordered pairs, 68.6%, compared a contract against ITSELF, which is
 * not a second bidding event. Collapsing to one price event per (stock number, contract) and
 * pairing only ACROSS DISTINCT CONTRACTS leaves 573,174 event pairs over 2,019 stock numbers,
 * and 17,196 award rows with no contract number were dropped as UNKNOWN rather than promoted to
 * events of their own, because promoting them would have silently rebuilt the defect.
 *
 * ---------------------------------------------------------------------------------------
 * WHY 0.98 AND NOT A TIGHTER OR A ROUNDER NUMBER
 * ---------------------------------------------------------------------------------------
 * On the population this rung actually faces, CONSECUTIVE award events, 0.98x is the peak of the
 * expected-margin curve, and it stays within 9% of the peak for every assumed cost basis from
 * 0.40 to 0.92 of the previous award price. The cost basis is ASSUMED and this product holds no
 * cost of goods anywhere, so the defence of 0.98 is its ROBUSTNESS across that whole range, never
 * that any one cost basis is right. It also sits just under the exact-tie mass at 1.00x, and a
 * tie is not a win.
 *
 * THE SURFACE IS FLAT INSIDE THE BAND AND STEEP OUTSIDE IT. Do not read the second decimal as
 * precision: the honest statement is the band, and `MEASURED_AWARD_MULTIPLE_BAND` carries it.
 *
 * ---------------------------------------------------------------------------------------
 * REVERTING, AND OVERRULING
 * ---------------------------------------------------------------------------------------
 * The owner overrules this per call by passing his own `config.awardMultiple`, with no code
 * change and no deploy, and every figure on rungs 2 to 5 moves with it deterministically. To
 * revert the product default to his rule entirely, `RECOMMENDATION_CONFIG.awardMultiple` below
 * becomes `OPERATOR_AWARD_MULTIPLE` again. One line, one identifier, no other edit.
 */
/**
 * THE PRODUCT DEFAULT, RULED BY THE OWNER ON 2026-08-19: ONE.
 *
 * ---------------------------------------------------------------------------------------
 * WHY ONE, AND WHY NOT THE NUMBER THE OPTIMISER RETURNED
 * ---------------------------------------------------------------------------------------
 * Quoting the previous award price unchanged is the best single estimator anyone has measured of
 * what the item will clear at next. It comes in at or below the actual clearing price on 80% of
 * stock numbers with each item counted once, and 92.5% pooled, and four independent paths
 * converged on it.
 *
 * ★★ AN EXPECTED-VALUE OPTIMISER WAS RUN AND ITS ANSWER IS DELIBERATELY NOT SHIPPED. On revenue
 * it peaked at 0.91x, which is the BOTTOM OF THE SEARCH GRID, and a maximum on the boundary is a
 * symptom rather than an answer. On margin it peaked near 0.98x, but only under an ASSUMED cost
 * of 0.80 x the previous award price, and this product holds no cost of goods anywhere. Both
 * numbers say "bid lower" for the same reason: a model with no cost floor cannot represent the
 * one outcome that matters most, which is that winning below cost is a LOSS and not a small win.
 *
 * Shipping either would have replaced a number derived from one anecdote with a number derived
 * from a model blind to the cost side. That is an estimate dressed as an optimum, and it is the
 * same defect in better arithmetic.
 *
 * ONE IS NOT AN OPTIMUM AND IS NOT PRESENTED AS ONE. It is the measured central estimate of the
 * clearing price, which is a thing we can actually observe. The step from that estimate to a bid
 * needs the operator's cost, which only the operator holds, so the product states what the market
 * did and hands them the trade-off rather than inventing the half of the problem it cannot see.
 *
 * ---------------------------------------------------------------------------------------
 * REVERTING, AND OVERRULING
 * ---------------------------------------------------------------------------------------
 * The owner overrules per call with his own `config.awardMultiple`, no code change and no deploy,
 * and every figure on rungs 2 to 5 moves with it deterministically. To restore his 3x as the
 * product default, `RECOMMENDATION_CONFIG.awardMultiple` becomes `OPERATOR_AWARD_MULTIPLE`. One
 * line, one identifier, no other edit.
 */
export const DEFAULT_AWARD_MULTIPLE = 1

/**
 * The margin-EV peak, KEPT AS A MEASUREMENT AND NEVER USED AS A DEFAULT.
 *
 * It is retained because it is a real result and a surface may cite it, but every citation must
 * carry the assumption: it is the peak under an ASSUMED cost of 0.80 x the previous award price,
 * and that cost is an assumption this product cannot verify. Never render it as the recommended
 * multiple.
 */
export const MEASURED_AWARD_MULTIPLE = 0.98

/**
 * The band the measurement actually supports, and the ceiling past which it stops supporting
 * anything. A surface should state the band; the default is one point inside it.
 */
export const MEASURED_AWARD_MULTIPLE_BAND = {
  /** The low end of the working band. Below this the curve is falling away on the revenue side. */
  lowMultiple: 0.95,
  highMultiple: 1.0,
  /**
   * ADVISORY, not a clamp. The engine will still compute whatever multiple it is handed, because
   * refusing an operator's number silently would be a control that does not work. Past this the
   * caveat says so out loud.
   */
  advisoryCeilingMultiple: 1.05,
} as const

/**
 * THE MEASURED RECORD, AS DATA, SO NOBODY RETYPES IT.
 *
 * Every sentence this file writes about how a multiple performs is generated from this table.
 * A number that appears in prose and nowhere in a structure is a number the next lane will
 * paraphrase slightly wrong.
 */
export const MEASURED_CLEARANCE_SAMPLE = {
  /** Ordered pairs of CONSECUTIVE price events, one event per (stock number, contract number). */
  eventPairs: 19_475,
  stockNumbers: 2_019,
  measuredOnIso: '2026-08-19',
  population:
    'consecutive award events on the same stock number, one price event per contract, paired ' +
    'only across distinct contracts',
} as const

export type MeasuredClearanceObservation = {
  readonly multiple: number
  /**
   * The share of pairs where `multiple x previous` came in at or below the price that actually
   * cleared. AN UPPER BOUND on the probability of winning, never the probability of winning.
   */
  readonly clearedAtOrBelowShare: number
  /**
   * Share of the peak expected margin available, under an ASSUMED cost basis of 0.80 x the
   * previous award unit price. NULL where the measurement lane did not publish this multiple,
   * and null is an absence rather than a zero: nothing downstream may default it.
   */
  readonly shareOfPeakMarginEvAtAssumedCost080: number | null
}

/**
 * P(clear) by multiple on the consecutive-events sample. Sorted ascending by multiple.
 *
 * ONLY EXACT GRID POINTS ARE EVER QUOTED. There is no interpolation anywhere in this file: a
 * multiple between two rows here has no measured clearance rate, and saying so is the honest
 * answer rather than averaging its neighbours into a number nobody measured.
 */
export const MEASURED_CLEARANCE_CURVE: readonly MeasuredClearanceObservation[] = [
  { multiple: 0.85, clearedAtOrBelowShare: 0.911, shareOfPeakMarginEvAtAssumedCost080: null },
  { multiple: 0.9, clearedAtOrBelowShare: 0.882, shareOfPeakMarginEvAtAssumedCost080: null },
  { multiple: 0.95, clearedAtOrBelowShare: 0.827, shareOfPeakMarginEvAtAssumedCost080: null },
  { multiple: 0.98, clearedAtOrBelowShare: 0.757, shareOfPeakMarginEvAtAssumedCost080: 1.0 },
  { multiple: 1.0, clearedAtOrBelowShare: 0.608, shareOfPeakMarginEvAtAssumedCost080: 0.89 },
  { multiple: 1.02, clearedAtOrBelowShare: 0.322, shareOfPeakMarginEvAtAssumedCost080: null },
  { multiple: 1.05, clearedAtOrBelowShare: 0.247, shareOfPeakMarginEvAtAssumedCost080: null },
  { multiple: 1.1, clearedAtOrBelowShare: 0.185, shareOfPeakMarginEvAtAssumedCost080: 0.41 },
  { multiple: 1.2, clearedAtOrBelowShare: 0.125, shareOfPeakMarginEvAtAssumedCost080: null },
  { multiple: 1.5, clearedAtOrBelowShare: 0.062, shareOfPeakMarginEvAtAssumedCost080: null },
  { multiple: 2.0, clearedAtOrBelowShare: 0.033, shareOfPeakMarginEvAtAssumedCost080: null },
  { multiple: 3.0, clearedAtOrBelowShare: 0.015, shareOfPeakMarginEvAtAssumedCost080: 0.25 },
]

/** Cent-level tolerance on a multiple, so 0.98 typed as 0.9800000000000001 still matches. */
const MULTIPLE_MATCH_TOLERANCE = 1e-9

/**
 * The measured record for EXACTLY this multiple, or NULL when the grid does not hold it.
 *
 * Null is the whole point. "We measured and the answer is no" and "we have nothing here" are
 * different states, and a caller that treats the second as the first is the defect this product
 * has shipped nine times.
 */
export function measuredClearanceAt(multiple: number): MeasuredClearanceObservation | null {
  return (
    MEASURED_CLEARANCE_CURVE.find(
      (o) => Math.abs(o.multiple - multiple) < MULTIPLE_MATCH_TOLERANCE,
    ) ?? null
  )
}

/**
 * WHERE A MULTIPLE STANDS RELATIVE TO WHAT WAS MEASURED. Not where it sits in a list.
 *
 * This is the discriminant every honesty surface reads. It is a fact about the NUMBER IN FORCE,
 * never about the rung, so a caveat, a label and a confidence tier cannot drift apart, and none
 * of them can inherit a claim from ladder position.
 */
export type AwardMultipleStance =
  /** The measured margin optimum itself. */
  | 'MEASURED_OPTIMUM'
  /** Inside the measured working band but not the optimum point. */
  | 'INSIDE_THE_MEASURED_BAND'
  /** Above the band and at or under the advisory ceiling. */
  | 'ABOVE_THE_BAND_WITHIN_THE_ADVISORY_CEILING'
  /** Past the advisory ceiling, or under the band's low end. Chosen, not measured-optimal. */
  | 'OUTSIDE_THE_MEASURED_BAND'

export function classifyAwardMultiple(multiple: number): AwardMultipleStance {
  if (Math.abs(multiple - MEASURED_AWARD_MULTIPLE) < MULTIPLE_MATCH_TOLERANCE) {
    return 'MEASURED_OPTIMUM'
  }
  const { lowMultiple, highMultiple, advisoryCeilingMultiple } = MEASURED_AWARD_MULTIPLE_BAND
  if (multiple >= lowMultiple && multiple <= highMultiple) return 'INSIDE_THE_MEASURED_BAND'
  if (multiple > highMultiple && multiple <= advisoryCeilingMultiple) {
    return 'ABOVE_THE_BAND_WITHIN_THE_ADVISORY_CEILING'
  }
  return 'OUTSIDE_THE_MEASURED_BAND'
}

/**
 * A multiple rendered the way a human types it: 3, not 3.00; 0.98, not 0.9800000000000001.
 */
function multipleText(multiple: number): string {
  return Number.isInteger(multiple) ? String(multiple) : String(Number(multiple.toFixed(4)))
}

/**
 * The measured record for a multiple, in one sentence, generated from the table above.
 *
 * When the grid does not hold the multiple this says so and names the nearest MEASURED points by
 * their own values. That is not an interpolation: those are two measurements, printed as
 * measurements, with nothing computed between them.
 */
export function measuredRecordSentence(multiple: number): string {
  const at = measuredClearanceAt(multiple)
  const sample =
    `${MEASURED_CLEARANCE_SAMPLE.eventPairs.toLocaleString('en-US')} ${MEASURED_CLEARANCE_SAMPLE.population}` +
    ` over ${MEASURED_CLEARANCE_SAMPLE.stockNumbers.toLocaleString('en-US')} stock numbers`
  if (at === null) {
    const below = [...MEASURED_CLEARANCE_CURVE].reverse().find((o) => o.multiple < multiple)
    const above = MEASURED_CLEARANCE_CURVE.find((o) => o.multiple > multiple)
    const neighbours = [below, above]
      .filter((o): o is MeasuredClearanceObservation => o !== undefined)
      .map((o) => `${multipleText(o.multiple)}x at ${pct(o.clearedAtOrBelowShare)}`)
    return (
      `No clearance rate was measured at ${multipleText(multiple)}x. Measured over ${sample}, ` +
      `the nearest points we DID measure are ${neighbours.join(' and ')}, and nothing between ` +
      'them is interpolated, so this multiple has no measured record of its own.'
    )
  }
  const margin =
    at.shareOfPeakMarginEvAtAssumedCost080 === null
      ? ''
      : ` It returns about ${Math.round(at.shareOfPeakMarginEvAtAssumedCost080 * 100)}% of the ` +
        `expected margin available at ${multipleText(MEASURED_AWARD_MULTIPLE)}x, under an ASSUMED ` +
        'cost of 0.80 x the previous award price.'
  return (
    `Measured over ${sample}: a quote at ${multipleText(multiple)}x the last award unit price ` +
    `came in at or below the price the item actually cleared at ${pct(at.clearedAtOrBelowShare)} ` +
    `of the time.${margin} At or below is necessary to win and not sufficient, so ` +
    `${pct(at.clearedAtOrBelowShare)} is an upper bound on how often it would have won.`
  )
}

/**
 * THE PRESETS, AS DATA, EACH CARRYING ITS OWN MEASURED RECORD.
 *
 * A preset offered WITHOUT its record is exactly how the 3x shipped as a headline: a number in a
 * control, with the thing anybody would want to know about it living in a comment. So the record
 * is a FIELD on the preset, a surface renders it rather than retyping it, and there is no way to
 * offer the value while dropping the sentence.
 *
 * The operator's 3x is in this list and is not hidden. It is his, it won him a buy, and when he
 * selects it the engine computes exactly what his rule says.
 */
export type AwardMultiplePresetId =
  | 'MEASURED_BAND_FLOOR'
  | 'MEASURED_MARGIN_OPTIMUM'
  | 'PARITY_WITH_THE_LAST_AWARD'
  | 'ADVISORY_CEILING'
  | 'OPERATOR_STATED_RULE'

export type AwardMultiplePreset = {
  readonly id: AwardMultiplePresetId
  readonly value: number
  /** What the control says. */
  readonly label: string
  /** What the control must say NEXT TO IT. Generated from the measured table, never retyped. */
  readonly record: string
  /**
   * How the number came to exist. MEASURED and PRIOR do not render at equal confidence, and a
   * preset list is precisely where they would otherwise be flattened into one row of buttons.
   */
  readonly provenance: 'MEASURED' | 'PRIOR'
}

export const AWARD_MULTIPLE_PRESETS: readonly AwardMultiplePreset[] = [
  {
    id: 'MEASURED_BAND_FLOOR',
    value: MEASURED_AWARD_MULTIPLE_BAND.lowMultiple,
    label: 'the low end of the measured working band',
    record: measuredRecordSentence(MEASURED_AWARD_MULTIPLE_BAND.lowMultiple),
    provenance: 'MEASURED',
  },
  {
    id: 'MEASURED_MARGIN_OPTIMUM',
    value: MEASURED_AWARD_MULTIPLE,
    label: 'the measured margin optimum',
    record: measuredRecordSentence(MEASURED_AWARD_MULTIPLE),
    provenance: 'MEASURED',
  },
  {
    id: 'PARITY_WITH_THE_LAST_AWARD',
    value: MEASURED_AWARD_MULTIPLE_BAND.highMultiple,
    label: 'match the last award price',
    record:
      `${measuredRecordSentence(MEASURED_AWARD_MULTIPLE_BAND.highMultiple)} On the wider clean ` +
      'sample of 573,174 event pairs, 6.19 points of the mass at this multiple is an EXACT tie ' +
      'with the previous clearing price, and a tie is not a win. Sole-source items optimise ' +
      'here: the measured sole-source premium is 4.1% pair-weighted, not the 20.9% previously ' +
      'believed, which was manufactured by pairing contracts against themselves.',
    provenance: 'MEASURED',
  },
  {
    id: 'ADVISORY_CEILING',
    value: MEASURED_AWARD_MULTIPLE_BAND.advisoryCeilingMultiple,
    label: 'the advisory ceiling',
    record:
      `${measuredRecordSentence(MEASURED_AWARD_MULTIPLE_BAND.advisoryCeilingMultiple)} This is ` +
      'the top of what the measurement supports. Above it no stratum of the corpus, and no ' +
      'supply class with a usable item base, put its optimum.',
    provenance: 'MEASURED',
  },
  {
    id: 'OPERATOR_STATED_RULE',
    value: OPERATOR_AWARD_MULTIPLE,
    label: 'three times the last award price, the rule you gave us',
    record:
      `Your own rule, stated once about one item you won: "I quoted $3,565, three times the unit ` +
      `price of the previous award." ${measuredRecordSentence(OPERATOR_AWARD_MULTIPLE)} It fails ` +
      'no harder on sole-source items than competed ones, so keeping it for sole-source was ' +
      'measured too and was refuted. It is here, unchanged, because it is yours and because you ' +
      'may know something about a row that the corpus does not.',
    provenance: 'PRIOR',
  },
]

/**
 * The preset a given config is standing on, BY VALUE, or null when the operator has typed a
 * number that is not one of them. Never by list position: a preset reordering must not silently
 * move which one is called the default.
 */
export function presetForMultiple(multiple: number): AwardMultiplePreset | null {
  return (
    AWARD_MULTIPLE_PRESETS.find((p) => Math.abs(p.value - multiple) < MULTIPLE_MATCH_TOLERANCE) ??
    null
  )
}

/** No band from fewer than this many priced peers. A band from one observation is a disguise. */
export const PEER_FLOOR_COUNT = 3

/**
 * WHICH RUNGS CONSUME THE MULTIPLE, NAMED BY IDENTITY.
 *
 * R1 carries the manufacturer's award forward on the inflation factors and never multiplies, so
 * nothing about the multiple may be said about R1. Every other rung multiplies, which means a
 * claim about the multiple belongs on all of them and not only on the one that names it in its
 * label. Named rather than sliced, so reordering the ladder cannot reattach these facts to a
 * rung that does not multiply.
 */
export const RUNGS_THAT_APPLY_THE_AWARD_MULTIPLE: readonly RecommendationRung[] = [
  'R2_LAST_AWARD_MULTIPLE',
  'R3_RECENT_AWARD_BAND',
  'R4_AWARD_TREND',
  'R5_FSC_PEER_BAND',
]

export type RecommendationConfig = {
  readonly awardMultiple: number
  /**
   * An OPERATOR-STATED description of the multiplier, overriding the derived one.
   *
   * OPTIONAL AND UNSET BY DEFAULT, and that is deliberate. It used to be a required string on the
   * shared config, which meant `{ ...RECOMMENDATION_CONFIG, awardMultiple: 2 }` produced a row
   * whose multiplier was 2 and whose description still explained 3, in the operator's own voice.
   * A description that does not follow the number it describes is a UI string that goes stale,
   * and this product has shipped that defect before. Left unset, the description is DERIVED from
   * the multiple in force and cannot disagree with it.
   */
  readonly awardMultipleSource?: string | null
  /** The recency window for the R3 band, in months. Our judgement, not a regulation. */
  readonly recentWindowMonths: number
  readonly peerFloorCount: number
  /** Order-size ratio past which a comparison is called out as crossing a quantity break. */
  readonly quantityBreakRatio: number
  readonly recentBandMinimumAwards: number
  readonly trendMinimumAwards: number
}

export const RECOMMENDATION_CONFIG: RecommendationConfig = {
  awardMultiple: DEFAULT_AWARD_MULTIPLE,
  /*
   * ABSENT ON PURPOSE, so the sentence is DERIVED from the multiple in force rather than typed
   * beside it. It used to read 'Stated by the operator: "I quoted $3,565, three times the unit
   * price of the previous award." His rule, not ours, and adjustable here.' That was true while
   * the default WAS his rule, and it became a false statement the instant the default changed
   * while the string did not. A caller may still set it explicitly and that value is used as-is.
   */
  /*
   * Thirty six months, the same window `quote-view.ts` uses for the resale band and for the same
   * measured reason: DLAD 17.7505 measures over twelve months, and the median stock number in
   * this corpus sees an award every few years, so a twelve month window abstains on nearly
   * everything and teaches an operator nothing.
   */
  recentWindowMonths: 36,
  peerFloorCount: PEER_FLOOR_COUNT,
  /*
   * An order of magnitude. A stated judgement about when an order-size difference stops being
   * noise, graded PRIOR and adjustable, and it CHANGES NO NUMBER: it decides only whether the
   * crossing is named out loud, with both quantities printed, so the operator judges it. Nothing
   * here quantifies what a quantity break does to a price, because nothing in this corpus
   * measures that, and a made up elasticity would be exactly the estimate dressed as a
   * measurement this product refuses.
   */
  quantityBreakRatio: 10,
  recentBandMinimumAwards: 2,
  trendMinimumAwards: 3,
}

/**
 * HOW MUCH AN OLD BASIS WIDENS A BAND, DERIVED RATHER THAN CHOSEN.
 *
 * Trap 3 says an old award must widen the band by its age. The rate cannot be invented, so it is
 * derived from the only measured statement this corpus makes about the uncertainty in a year of
 * price drift: the two inflation factors on file, stated by the same expert for the same base
 * year, DISAGREE. CPI says a 2017 dollar is 1.3223 today and DoD procurement says 1.40. Over the
 * nine years between the base year and the year he stated them, that is
 *
 *     (1.40 / 1.3223) ^ (1/9) - 1  =  0.63639% a year
 *
 * So a basis award N years old widens by N x 0.63639%, each side. A nine year old award widens
 * about 5.7%, which is exactly the disagreement the two factors already carry over that span.
 * The age is printed in the output beside the widening it caused.
 *
 * WHEN A DATED, CITABLE INFLATION SERIES LANDS this derivation retires: the series states its own
 * uncertainty and the anchor stops abstaining on 98% of rows. Until then this is the honest rate,
 * it is graded PRIOR, and it moves with the configured factors rather than being frozen here.
 */
export function driftHalfWidthPerYear(indices: AnchorIndexConfig): number {
  const cpi = indices.cpi.factor
  const dod = indices.dodProcurement.factor
  const baseYear = indices.cpi.vintage.baseYear
  const statedYear = Number(indices.cpi.vintage.statedAtSourceDate.slice(0, 4))
  const years = statedYear - baseYear
  if (!(cpi > 0) || !(dod > 0) || !(years > 0)) return 0
  const ratio = Math.max(cpi, dod) / Math.min(cpi, dod)
  return ratio ** (1 / years) - 1
}

/* ------------------------------------------------------------------------------------ */
/* WHAT THE ENGINE IS GIVEN                                                               */
/* ------------------------------------------------------------------------------------ */

/**
 * What WE would offer. Three states, and the unknown one is not a false.
 *
 * It decides whether a surplus-material comparable is the right comparable or the wrong one, and
 * no government file answers it: it is a fact about our own material. Reading the silence as "we
 * would offer new material" would silently drop comparables on the rows where surplus IS the
 * market, which is most of this operator's business.
 */
export type SurplusStance = 'OFFERING_SURPLUS' | 'OFFERING_NEW_MATERIAL' | 'UNDECLARED'

/** One priced peer in the same supply class. The unit price must already be per-unit. */
export type PricedPeer = {
  readonly nsn: string
  /** Per unit, from the peer's own award row. Never an extended total. */
  readonly unitPriceUsd: number
  readonly quantity: number | null
  readonly awardDateIso: string | null
  readonly awardeeCage: string | null
  /** The export's own word, kept as text and read three-state. A blank is not a "no". */
  readonly surplusAsWorded: string | null
}

/** Injected so the engine stays pure and a test can hand it a pool with a known answer. */
export type PeerLookup = (fsc: string) => readonly PricedPeer[]

/** The classify module's door, narrowed to the one method this engine calls. */
export type AwardeeClassifierPort = {
  classify(cage: string | null | undefined): AwardeeVerdict | null
}

/** What only a human can state about our own offer. Absent everywhere means nothing is assumed. */
export type OperatorDeclarations = {
  readonly offeringUnusedFormerGovernmentSurplus?: boolean | null
  readonly esaCoordinationCount?: number | null
  readonly buyAmericanOrBalanceOfPayments?: boolean | null
}

export type RecommendationInput = {
  readonly nsn: string
  /** This stock number's own award history, as the dossier carries it. */
  readonly awards: readonly DossierAward[]
  /** The MCRL approved-source CAGEs. Empty is a silence, never "nobody is approved". */
  readonly approvedSourceCages: readonly string[]
  /** The quantity on the live requirement. Known on every served row; the type allows silence. */
  readonly requirementQuantity: number | null
  /** Overrides the supply class derived from the stock number's first four digits. */
  readonly fsc?: string | null
  /** REQUIRED and explicit. No module in this product reads wall time to decide a price. */
  readonly atInstantMs: number
  readonly feedWindow?: {
    readonly firstAwardIso: string | null
    readonly lastAwardIso: string | null
  }
  readonly surplusStance?: SurplusStance
  readonly classifyAwardee?: AwardeeClassifierPort | null
  readonly peerLookup?: PeerLookup | null
  readonly declarations?: OperatorDeclarations
  readonly config?: RecommendationConfig
  readonly indices?: AnchorIndexConfig
  readonly pricingConfig?: PricingConfig
}

/* ------------------------------------------------------------------------------------ */
/* WHAT THE ENGINE RETURNS                                                                */
/* ------------------------------------------------------------------------------------ */

/**
 * A POINT or a BAND, never both, and they share NO numeric field name.
 *
 * `kind` is the discriminant and there is no `unitPriceUsd` on the band arm, so a render that
 * reads a band as though it were a point fails to compile rather than printing the low endpoint
 * as the answer.
 */
export type RecommendedFigure =
  | {
      readonly kind: 'POINT'
      readonly unitPriceUsd: number
      /** The unrounded product, so the arithmetic shown inline is the arithmetic performed. */
      readonly exactUnitPriceUsd: number
    }
  | {
      readonly kind: 'BAND'
      readonly lowUnitPriceUsd: number
      readonly highUnitPriceUsd: number
      /** (high - low) / low, computed on the rounded endpoints the operator actually sees. */
      readonly widthRatio: number
    }

/** One value a rung consumed, with its own value, its date where it has one, and its source. */
export type RecommendationInputValue = {
  readonly label: string
  readonly renderedValue: string
  /** The number itself when the value is money or a count. Null when the value is not numeric. */
  readonly valueUsd: number | null
  readonly dateIso: string | null
  readonly source: string
  readonly evidenceState: QuoteEvidenceState
  readonly citation: SourceCitation | null
}

export type RecommendationCaveatCode =
  | 'QUANTITY_BREAK_CROSSED'
  | 'COMPARABLE_IS_SURPLUS_MATERIAL_AND_WAS_LABELLED'
  | 'COMPARABLE_IS_SURPLUS_MATERIAL_AND_WAS_EXCLUDED'
  | 'AWARDEE_IS_A_MEASURED_SURPLUS_DEALER'
  | 'SURPLUS_STANCE_UNDECLARED'
  | 'BASIS_IS_OLD_AND_THE_BAND_WAS_WIDENED_BY_ITS_AGE'
  | 'WIDENED_TO_THE_WIDTH_OF_A_STRONGER_RUNG'
  | 'MULTIPLIER_IS_A_STATED_RULE_NOT_A_MEASURED_SERIES'
  | 'INFLATION_FACTORS_ARE_STATED_JUDGEMENTS'
  | 'PEER_BASIS_IS_A_DIFFERENT_ITEM'
  | 'ROW_CONTRADICTS_ITSELF_ON_PRICE_AND_WAS_SET_ASIDE'
  | 'RECOMMENDATION_CROSSES_THE_DLAD_PRICE_INCREASE_BAND'

export type RecommendationCaveat = {
  readonly code: RecommendationCaveatCode
  readonly sentence: string
  /** Present when the caveat is quantified, so a surface can rank or filter on it. */
  readonly measured: {
    readonly label: string
    readonly value: number
    readonly unit: 'YEARS' | 'RATIO' | 'COUNT' | 'USD' | 'PERCENT'
  } | null
}

/** The quoted total for a band recommendation. A RANGE, and never a scalar total by accident. */
export type QuotedTotalRangeUsd = {
  readonly kind: 'QUOTED_TOTAL_RANGE_WHAT_WE_SEND'
  readonly lowUsd: number
  readonly highUsd: number
}

/** The evaluated figure for a band recommendation. Never what we send. */
export type EvaluatedTotalRangeUsd = {
  readonly kind: 'EVALUATED_TOTAL_RANGE_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND'
  readonly lowUsd: number
  readonly highUsd: number
}

export type EvaluatedAdderSummary = {
  readonly code: AdderCode
  readonly unitAmountUsd: number
  readonly appliedCount: number
  readonly subtotalUsd: number
  readonly citation: SourceCitation
}

/**
 * THE BUYER'S ARITHMETIC, CARRIED BESIDE OURS AND STRUCTURALLY UNABLE TO JOIN IT.
 *
 * BD-18. `quotedTotal` on the recommendation is what we send. Everything on this type is what DLA
 * ADDS to that total when it ranks us against competitors. The two are objects rather than
 * numbers so `quoted + evaluated` is a compile error, and the note says the same thing in words
 * for the reader who never opens the type.
 */
export type EvaluatedPriceContext =
  | {
      readonly available: true
      readonly adders: readonly EvaluatedAdderSummary[]
      readonly adderTotalUsd: number
      readonly evaluatedAtRecommendation: EvaluatedTotalUsd | EvaluatedTotalRangeUsd
      /** True when a factor applies that the solicitation states no amount for. */
      readonly isFloor: boolean
      readonly unpricedFactorCodes: readonly AdderCode[]
      readonly note: string
    }
  | {
      readonly available: false
      readonly reason:
        | 'REQUIREMENT_QUANTITY_ABSENT'
        | 'SURPLUS_OFFER_STATUS_UNDECLARED'
        | 'ESA_COORDINATION_COUNT_UNDECLARED'
        | 'ENGINE_ABSTAINED'
      readonly missingInput: string
      readonly note: string
    }

/** What DLAD 17.7505 says about the recommendation, when the row can answer it. */
export type PriceIncreaseContext = {
  readonly assessed: true
  readonly measuredAgainstUnitPriceUsd: number
  readonly measuredAgainstAwardDateIso: string
  readonly impliedIncreasePercent: number
  readonly impliedMultipleOfPrior: number
  readonly band: TripwireBandKind
  readonly crossed: boolean
  readonly consequence: string
  readonly citation: SourceCitation
} | {
  readonly assessed: false
  readonly reason: string
}

export type RungUnavailableReason =
  | 'NO_MANUFACTURER_AWARD_IDENTIFIED'
  | 'NO_INFLATION_FACTOR_FOR_THE_AWARD_YEAR'
  | 'ANCHOR_ENGINE_ABSTAINED'
  | 'NO_DATED_AWARD_ON_FILE'
  | 'LAST_AWARD_CONTRADICTS_ITSELF_ON_PRICE'
  | 'LATEST_AWARDS_DISAGREE_ON_PRICE'
  | 'LAST_AWARD_EXCLUDED_AS_SURPLUS_MATERIAL'
  | 'TOO_FEW_RECENT_AWARDS'
  | 'TOO_FEW_AWARDS_FOR_A_TREND'
  | 'NO_PEER_LOOKUP_SUPPLIED'
  | 'NO_SUPPLY_CLASS_ON_THE_STOCK_NUMBER'
  | 'PEER_GROUP_BELOW_THE_FLOOR'

export type RungOutcome =
  | {
      readonly rung: RecommendationRung
      readonly rungLabel: string
      readonly resolved: true
      readonly recommended: RecommendedFigure
      /**
       * The rule's own product before any widening, when the rung produced a single number. Null
       * on a rung whose evidence is a spread, because there is no point there to widen around and
       * inventing one would be a blend.
       */
      readonly basisUnitPriceUsd: number | null
      /** (high - low) / low on the reported endpoints. Zero on a point. */
      readonly widthRatio: number
      /** Before the floor cascade, so the widening is auditable rather than merely stated. */
      readonly widthRatioBeforeFloor: number
      readonly widenedToMatch: RecommendationRung | null
      readonly evidenceState: QuoteEvidenceState
      readonly inputs: readonly RecommendationInputValue[]
      /** The derivation as a person checks it on a napkin. */
      readonly arithmetic: string
      readonly wouldSharpenWith: readonly string[]
      readonly caveats: readonly RecommendationCaveat[]
      readonly observationCount: number
      readonly oldestObservationIso: string | null
      readonly newestObservationIso: string | null
    }
  | {
      readonly rung: RecommendationRung
      readonly rungLabel: string
      readonly resolved: false
      readonly reason: RungUnavailableReason
      readonly missingInput: string
      readonly sentence: string
    }

/** The resolved arm, named so a call site can hold one without re-narrowing the union. */
export type ResolvedRungOutcome = Extract<RungOutcome, { readonly resolved: true }>

export type RecommendationAbstentionReason =
  | 'NO_AWARD_HISTORY_AND_NO_PRICED_PEERS'
  | 'AWARD_HISTORY_UNREADABLE_AND_NO_PRICED_PEERS'
  | 'PEER_GROUP_BELOW_THE_FLOOR'

export type PriceRecommendation =
  | {
      readonly resolved: true
      readonly nsn: string
      readonly fsc: string | null
      readonly atInstantMs: number
      readonly rung: RecommendationRung
      readonly rungLabel: string
      /**
       * The multiple actually applied on this row.
       *
       * ★ CARRIED ON THE RESULT rather than looked up from the shared config by a consumer. A
       * caller may pass its own `config.awardMultiple`, and a surface reading the default instead
       * would label the row with a number the row did not use. Every label naming a multiple
       * must read THIS field.
       */
      readonly awardMultiple: number
      readonly recommended: RecommendedFigure
      readonly basisUnitPriceUsd: number | null
      readonly widthRatio: number
      readonly evidenceState: QuoteEvidenceState
      readonly inputs: readonly RecommendationInputValue[]
      readonly arithmetic: string
      readonly wouldSharpenWith: readonly string[]
      readonly caveats: readonly RecommendationCaveat[]
      /**
       * The quantity the quoted total was computed over. Carried so a consumer, and the BD-18
       * guard below, can recompute the total from the unit price INDEPENDENTLY rather than
       * trusting the field it is auditing.
       */
      readonly requirementQuantity: number | null
      /** What we send. Null only when the requirement quantity is unread. */
      readonly quotedTotal: QuotedTotalUsd | QuotedTotalRangeUsd | null
      /** What the buyer adds. A separate type. Never summed with the line above. */
      readonly evaluatedPriceContext: EvaluatedPriceContext
      readonly priceIncreaseContext: PriceIncreaseContext
      /** Every rung, in ladder order, resolved or not. The audit trail and the roadmap. */
      readonly ladder: readonly RungOutcome[]
      readonly sentence: string
    }
  | {
      readonly resolved: false
      readonly nsn: string
      readonly fsc: string | null
      readonly atInstantMs: number
      readonly reason: RecommendationAbstentionReason
      readonly missingInput: string
      readonly sentence: string
      readonly ladder: readonly RungOutcome[]
    }

/* ------------------------------------------------------------------------------------ */
/* ARITHMETIC RENDERED FOR A HUMAN                                                        */
/* ------------------------------------------------------------------------------------ */

/** Two decimals, no separators, so a reader can retype it into a calculator. */
const money = (usd: number): string => usd.toFixed(2)

/*
 * A FUNCTION DECLARATION AND NOT A CONST ARROW, DELIBERATELY, AND THIS IS NOT STYLE.
 *
 * `AWARD_MULTIPLE_PRESETS` is a top-level const that builds its record sentences at module load,
 * and those sentences call `measuredRecordSentence`, which calls this. A `const` arrow declared
 * here is in the temporal dead zone at that moment, so importing this module threw
 * "Cannot access 'pct' before initialization" and every surface that imports the pricing engine
 * died at load. It type-checked perfectly and the build passed: only running it found it.
 *
 * A function declaration hoists, so the presets can be evaluated wherever they are written.
 */
function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`
}

const MS_PER_YEAR = 31_557_600_000

const digitsOnly = (v: string): string => v.replace(/[^0-9]/g, '')

const normaliseCage = (v: string | null | undefined): string => (v ?? '').trim().toUpperCase()

/** The supply class: the stock number's first four digits. Null when the number is too short. */
export function fscOf(nsn: string): string | null {
  const d = digitsOnly(nsn)
  return d.length >= 4 ? d.slice(0, 4) : null
}

function monthsBeforeUtc(instantMs: number, months: number): number {
  const d = new Date(instantMs)
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() - months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  )
}

const isoDay = (instantMs: number): string => new Date(instantMs).toISOString().slice(0, 10)

/** Cents in, cents out, so the multiplier never leaves integer space before the last division. */
function timesMultiple(unitPriceUsd: number, multiple: number): {
  readonly exactUsd: number
  readonly roundedUsd: number
} {
  const applied = applyFactorToCents(usdToCents(unitPriceUsd), multiple)
  return { exactUsd: centsToUsd(applied.exactCents), roundedUsd: centsToUsd(applied.roundedCents) }
}

/** Outward only. A rounding must never make a band look tighter than the evidence behind it. */
const floorToCents = (usd: number): number => Math.floor(usd * 100) / 100
const ceilToCents = (usd: number): number => Math.ceil(usd * 100) / 100

/* ------------------------------------------------------------------------------------ */
/* TRAP 1: THE ROW HAS TO AGREE WITH ITSELF, AND THE FIGURE HAS TO BE PER UNIT            */
/* ------------------------------------------------------------------------------------ */

/**
 * ONE CENT, and it is a rounding allowance rather than a fudge factor. The awards module rounds
 * its derived figure to cents while the Unit Price column is carried raw, so a clean row can
 * differ from its own derivation by up to half a cent. Past a cent the two columns are saying
 * different things about what one unit cost.
 */
const UNIT_PRICE_AGREEMENT_TOLERANCE_USD = 0.01

/**
 * Read one award as a per-unit figure the row itself corroborates, or refuse it by name.
 *
 * This mirrors `checkPriceColumns` in `quote-view.ts` and exists separately for one reason: that
 * function is module-private there and the pricing surface is being rebuilt in the same package
 * tonight, so importing it would have meant editing a file another lane is mid-edit in. The
 * TOLERANCE and the RULE are identical, and the measured reason for both is the same: over the
 * live feed 461 of 42,698 award rows contradict themselves about the unit price, and on NSN
 * 5905-01-413-6345 the division published $3.77 against a stated $94.26.
 *
 * WHICH COLUMN IS RIGHT IS NOT DECIDABLE and this does not decide it. On some rows the stated
 * Unit Price is the truth and on others the division is, so a contradicting row is refused rather
 * than resolved. Refusing is the only rule that is correct in both directions.
 */
type UnitPriceReading =
  | { readonly readable: true; readonly unitPriceUsd: number }
  | { readonly readable: false; readonly why: string }

function readUnitPrice(award: DossierAward): UnitPriceReading {
  const derived = award.effectiveUnitPriceUsd
  const stated = award.statedUnitPriceUsd
  const where = `${award.awardDateIso ?? 'an undated award'}${
    award.contractNo === null ? '' : ` (${award.contractNo})`
  }`
  if (typeof derived !== 'number' || !Number.isFinite(derived) || !(derived > 0)) {
    return { readable: false, why: `${where} carries no positive per-unit figure` }
  }
  if (typeof stated !== 'number' || !Number.isFinite(stated)) {
    return {
      readable: false,
      why:
        `${where} states no Unit Price of its own, so the only per-unit figure on it is ` +
        `${money(derived)} divided out of an extended total with nothing on the row to check it ` +
        'against',
    }
  }
  if (Math.abs(derived - stated) > UNIT_PRICE_AGREEMENT_TOLERANCE_USD) {
    return {
      readable: false,
      why:
        `${where} states a Unit Price of ${money(stated)} while its extended total divides to ` +
        `${money(derived)} a unit`,
    }
  }
  /*
   * THE THIRD CHECK, AND IT IS THE QUANTITY TRAP ITSELF. The two columns above can agree with
   * each other and still disagree with the row's own extended total, which is the shape that puts
   * an EXTENDED price into a per-unit slot. When the row carries a positive extended total and a
   * positive quantity, the division has to reproduce the figure we are about to use.
   */
  const extended = award.extendedPriceUsd
  const quantity = award.quantity
  if (
    typeof extended === 'number' &&
    Number.isFinite(extended) &&
    extended > 0 &&
    typeof quantity === 'number' &&
    Number.isFinite(quantity) &&
    quantity > 0
  ) {
    const perUnit = Math.round((extended / quantity) * 100) / 100
    if (Math.abs(perUnit - derived) > UNIT_PRICE_AGREEMENT_TOLERANCE_USD) {
      return {
        readable: false,
        why:
          `${where} carries a Final Price of ${money(extended)} over a quantity of ${quantity}, ` +
          `which is ${money(perUnit)} a unit, and the per-unit figure on the row reads ` +
          `${money(derived)}`,
      }
    }
  }
  return { readable: true, unitPriceUsd: derived }
}

/* ------------------------------------------------------------------------------------ */
/* TRAP 2: SURPLUS, READ IN TWO SEPARATE REGISTERS                                        */
/* ------------------------------------------------------------------------------------ */

/**
 * A SURPLUS FLAG DESCRIBES THE MATERIAL. A DEALER VERDICT DESCRIBES THE COMPANY. They are read
 * separately and they do different work, because collapsing them is how a silence becomes a
 * finding.
 *
 * `materialState` comes from the export's own Surplus column through the audited three-state
 * `readSurplus`, so a blank is UNREAD and never a "no". Only an affirmative `surplus_yes` can
 * EXCLUDE a comparable, and only when the operator has declared they would offer new material.
 *
 * `awardeeIsAMeasuredSurplusDealer` comes from `lib/intelligence/suppliers/classify`, whose
 * dealer verdict requires at least one award actually flagged surplus and never the mere absence
 * of a "no". It LABELS, always, and it never excludes: a surplus dealer can and does win awards
 * on new material, and dropping a comparable on the strength of who took it would be an inference
 * about the material read off a fact about the company.
 */
export type ComparableSurplusRead = {
  readonly materialState: SurplusState
  readonly awardeeIsAMeasuredSurplusDealer: boolean
  readonly awardeeVerdictBasis: string | null
}

function readComparableSurplus(
  surplusAsWorded: string | null,
  awardeeCage: string | null,
  classifier: AwardeeClassifierPort | null | undefined,
): ComparableSurplusRead {
  const materialState = readSurplus(surplusAsWorded)
  const verdict = classifier ? classifier.classify(awardeeCage) : null
  const isDealer =
    verdict !== null && verdict.class === 'surplus_dealer' && verdict.evidenceState === 'measured'
  return {
    materialState,
    awardeeIsAMeasuredSurplusDealer: isDealer,
    awardeeVerdictBasis: isDealer ? verdict.basis : null,
  }
}

/** EXCLUDE only on an affirmative material flag, and only when new material was declared. */
function excludedBySurplusStance(read: ComparableSurplusRead, stance: SurplusStance): boolean {
  return stance === 'OFFERING_NEW_MATERIAL' && read.materialState === 'surplus_yes'
}

/* ------------------------------------------------------------------------------------ */
/* THE COMPARABLE POOL                                                                    */
/* ------------------------------------------------------------------------------------ */

type Comparable = {
  readonly unitPriceUsd: number
  readonly quantity: number | null
  readonly awardDateIso: string
  readonly awardDateMs: number
  readonly ageYears: number
  readonly awardeeCage: string | null
  readonly awardeeCompany: string | null
  readonly contractNo: string | null
  readonly surplus: ComparableSurplusRead
  readonly nsn: string | null
}

/**
 * WHAT HAPPENED TO THE MOST RECENT AWARD, AS ITS OWN FACT.
 *
 * The operator's rule names THE PREVIOUS AWARD. When that row cannot be read, the tempting repair
 * is to walk back to the last award that can be, and that is the one repair this engine refuses:
 * it answers a different question under the same label, and it answers it in whichever direction
 * the older row happens to point. `quote-view.ts` reached the same conclusion for the DLAD
 * tripwire, which measures against the MOST RECENT prior price by regulation.
 *
 * So the disposition of the latest award is computed once, by name, and rung 2 either uses that
 * row or refuses and says which silence it hit. The rungs below it are pooled figures over many
 * awards and are free to carry on without it, which is exactly what makes them a real fallback
 * rather than a decoration.
 */
type LatestAwardDisposition =
  | { readonly kind: 'READABLE'; readonly comparable: Comparable }
  | { readonly kind: 'UNREADABLE'; readonly awardDateIso: string; readonly why: string }
  | { readonly kind: 'EXCLUDED_SURPLUS'; readonly awardDateIso: string }
  | {
      readonly kind: 'TIE_DISAGREES'
      readonly awardDateIso: string
      readonly prices: readonly number[]
    }
  | { readonly kind: 'NONE' }

type PoolBuild = {
  readonly kept: readonly Comparable[]
  readonly excludedForSurplus: readonly Comparable[]
  readonly unreadableRows: readonly string[]
  readonly latest: LatestAwardDisposition
}

function buildComparablePool(
  awards: readonly DossierAward[],
  atInstantMs: number,
  stance: SurplusStance,
  classifier: AwardeeClassifierPort | null | undefined,
): PoolBuild {
  const kept: Comparable[] = []
  const excluded: Comparable[] = []
  const unreadable: string[] = []
  for (const a of awards) {
    if (a.awardDateIso === null) {
      unreadable.push('an award carrying no award date, so it cannot be placed in time')
      continue
    }
    const ms = Date.parse(a.awardDateIso)
    if (!Number.isFinite(ms)) {
      unreadable.push(`an award whose date "${a.awardDateIso}" does not parse`)
      continue
    }
    if (ms > atInstantMs) {
      unreadable.push(`an award dated ${a.awardDateIso}, after the pricing instant`)
      continue
    }
    const reading = readUnitPrice(a)
    if (!reading.readable) {
      unreadable.push(reading.why)
      continue
    }
    const c: Comparable = {
      unitPriceUsd: reading.unitPriceUsd,
      quantity: a.quantity,
      awardDateIso: a.awardDateIso,
      awardDateMs: ms,
      ageYears: (atInstantMs - ms) / MS_PER_YEAR,
      awardeeCage: a.awardeeCage,
      awardeeCompany: a.awardeeCompany,
      contractNo: a.contractNo,
      surplus: readComparableSurplus(a.surplusAsWorded, a.awardeeCage, classifier),
      nsn: null,
    }
    if (excludedBySurplusStance(c.surplus, stance)) excluded.push(c)
    else kept.push(c)
  }
  const byDate = (x: Comparable, y: Comparable): number => x.awardDateMs - y.awardDateMs
  return {
    kept: [...kept].sort(byDate),
    excludedForSurplus: [...excluded].sort(byDate),
    unreadableRows: unreadable,
    latest: readLatestAward(awards, atInstantMs, stance, classifier),
  }
}

/**
 * The disposition of the LATEST DATED award, computed over the raw rows rather than over the
 * surviving pool, because "the last award was unreadable" and "the last readable award was in
 * 2019" are different facts and only the first one is true.
 *
 * A TIE ON THE LATEST DATE IS NOT A TIE-BREAK. Several awards can share the newest date and state
 * different unit prices, and the order a workbook lists them in carries no information about which
 * came last. When the tied rows disagree there is no "previous award price" to multiply, so the
 * rung refuses and prints the prices it could not choose between.
 */
function readLatestAward(
  awards: readonly DossierAward[],
  atInstantMs: number,
  stance: SurplusStance,
  classifier: AwardeeClassifierPort | null | undefined,
): LatestAwardDisposition {
  const dated = awards.filter((a) => {
    if (a.awardDateIso === null) return false
    const ms = Date.parse(a.awardDateIso)
    return Number.isFinite(ms) && ms <= atInstantMs
  })
  if (dated.length === 0) return { kind: 'NONE' }

  let latestIso = ''
  for (const a of dated) {
    const iso = a.awardDateIso as string
    if (iso > latestIso) latestIso = iso
  }
  const tied = dated.filter((a) => a.awardDateIso === latestIso)
  const readable = tied
    .map((a) => ({ award: a, reading: readUnitPrice(a) }))
    .filter(
      (x): x is { award: DossierAward; reading: Extract<UnitPriceReading, { readable: true }> } =>
        x.reading.readable,
    )
  if (readable.length === 0) {
    const first = tied[0] as DossierAward
    const why = readUnitPrice(first)
    return {
      kind: 'UNREADABLE',
      awardDateIso: latestIso,
      why: why.readable ? '' : why.why,
    }
  }
  const distinctCents = new Set(readable.map((x) => Math.round(x.reading.unitPriceUsd * 100)))
  if (distinctCents.size > 1) {
    return {
      kind: 'TIE_DISAGREES',
      awardDateIso: latestIso,
      prices: [...new Set(readable.map((x) => x.reading.unitPriceUsd))],
    }
  }
  const ms = Date.parse(latestIso)
  const comparables = readable.map(
    (x): Comparable => ({
      unitPriceUsd: x.reading.unitPriceUsd,
      quantity: x.award.quantity,
      awardDateIso: latestIso,
      awardDateMs: ms,
      ageYears: (atInstantMs - ms) / MS_PER_YEAR,
      awardeeCage: x.award.awardeeCage,
      awardeeCompany: x.award.awardeeCompany,
      contractNo: x.award.contractNo,
      surplus: readComparableSurplus(x.award.surplusAsWorded, x.award.awardeeCage, classifier),
      nsn: null,
    }),
  )
  const kept = comparables.filter((c) => !excludedBySurplusStance(c.surplus, stance))
  const first = kept[0]
  if (first === undefined) return { kind: 'EXCLUDED_SURPLUS', awardDateIso: latestIso }
  return { kind: 'READABLE', comparable: first }
}

/* ------------------------------------------------------------------------------------ */
/* CAVEAT BUILDERS                                                                        */
/* ------------------------------------------------------------------------------------ */

function quantityBreakCaveats(
  pool: readonly Comparable[],
  requirementQuantity: number | null,
  breakRatio: number,
): RecommendationCaveat[] {
  if (requirementQuantity === null || !(requirementQuantity > 0)) return []
  const crossings = pool.filter((c) => {
    if (c.quantity === null || !(c.quantity > 0)) return false
    const ratio = Math.max(c.quantity / requirementQuantity, requirementQuantity / c.quantity)
    return ratio >= breakRatio
  })
  if (crossings.length === 0) return []
  const worst = crossings.reduce((a, b) => {
    const ra = Math.max((a.quantity ?? 1) / requirementQuantity, requirementQuantity / (a.quantity ?? 1))
    const rb = Math.max((b.quantity ?? 1) / requirementQuantity, requirementQuantity / (b.quantity ?? 1))
    return rb > ra ? b : a
  })
  const worstQty = worst.quantity ?? 0
  const ratio = Math.max(worstQty / requirementQuantity, requirementQuantity / worstQty)
  return [
    {
      code: 'QUANTITY_BREAK_CROSSED',
      sentence:
        `${crossings.length} comparable award(s) here were for an order size at least ` +
        `${breakRatio}x away from this requirement's ${requirementQuantity}. The widest is ` +
        `${worst.awardDateIso} at a quantity of ${worstQty}, ${ratio.toFixed(1)}x. Every price ` +
        'in this recommendation is per unit and was checked against its own row, so nothing here ' +
        'is an extended total in a unit slot. What is NOT corrected is the price effect of the ' +
        'order size itself: nothing in this corpus measures it, so it is named rather than ' +
        'quantified.',
      measured: { label: 'widest quantity break', value: ratio, unit: 'RATIO' },
    },
  ]
}

function surplusCaveats(
  kept: readonly Comparable[],
  excluded: readonly Comparable[],
  stance: SurplusStance,
): RecommendationCaveat[] {
  const out: RecommendationCaveat[] = []
  if (excluded.length > 0) {
    out.push({
      code: 'COMPARABLE_IS_SURPLUS_MATERIAL_AND_WAS_EXCLUDED',
      sentence:
        `${excluded.length} award(s) flagged as surplus material by the export were EXCLUDED, ` +
        'because the offer has been declared as new material and a surplus price is a resale ' +
        'price, not a new-manufacture basis. The excluded awards are dated ' +
        `${excluded.map((c) => c.awardDateIso).join(', ')}.`,
      measured: { label: 'awards excluded', value: excluded.length, unit: 'COUNT' },
    })
  }
  const flagged = kept.filter((c) => c.surplus.materialState === 'surplus_yes')
  if (flagged.length > 0) {
    out.push({
      code: 'COMPARABLE_IS_SURPLUS_MATERIAL_AND_WAS_LABELLED',
      sentence:
        `${flagged.length} of the award(s) behind this figure are flagged as SURPLUS MATERIAL by ` +
        `the export (${flagged.map((c) => c.awardDateIso).join(', ')}). They are counted, not ` +
        'dropped: on this operator’s book surplus is frequently the market, and dropping ' +
        'them would silently substitute a different set of awards for the ones the rule names. ' +
        'They are a resale basis, so read the figure as a resale price rather than as a ' +
        'new-manufacture price.',
      measured: { label: 'surplus awards in the basis', value: flagged.length, unit: 'COUNT' },
    })
  }
  const dealers = kept.filter((c) => c.surplus.awardeeIsAMeasuredSurplusDealer)
  if (dealers.length > 0) {
    out.push({
      code: 'AWARDEE_IS_A_MEASURED_SURPLUS_DEALER',
      sentence:
        `${dealers.length} of the award(s) behind this figure went to a company the award record ` +
        'shows winning on surplus material elsewhere. That describes the COMPANY and not this ' +
        'material, so it labels the comparable and never removes it.',
      measured: { label: 'awards to a measured surplus dealer', value: dealers.length, unit: 'COUNT' },
    })
  }
  if (stance === 'UNDECLARED' && (flagged.length > 0 || dealers.length > 0)) {
    out.push({
      code: 'SURPLUS_STANCE_UNDECLARED',
      sentence:
        'Nobody has stated whether we would offer unused former Government surplus or new ' +
        'material. That is a fact about our own material and no government file answers it. Until ' +
        'it is declared, a surplus comparable is kept and labelled rather than excluded, because ' +
        'reading the silence as "new material" would drop comparables on exactly the rows where ' +
        'surplus is the market.',
      measured: null,
    })
  }
  return out
}

function setAsideCaveat(unreadable: readonly string[]): RecommendationCaveat[] {
  if (unreadable.length === 0) return []
  return [
    {
      code: 'ROW_CONTRADICTS_ITSELF_ON_PRICE_AND_WAS_SET_ASIDE',
      sentence:
        `${unreadable.length} award row(s) on this stock number were set aside because the row ` +
        `could not be read as a per-unit price: ${unreadable.slice(0, 3).join('; ')}` +
        `${unreadable.length > 3 ? `; and ${unreadable.length - 3} more` : ''}. Neither price ` +
        'column is preferred over the other, so a contradicting row is refused rather than ' +
        'resolved.',
      measured: { label: 'rows set aside', value: unreadable.length, unit: 'COUNT' },
    },
  ]
}

/* ------------------------------------------------------------------------------------ */
/* THE RAW BASIS EACH RUNG PRODUCES, BEFORE WIDENING                                      */
/* ------------------------------------------------------------------------------------ */

type RawBasis = {
  readonly rung: RecommendationRung
  readonly rawLowUsd: number
  readonly rawHighUsd: number
  readonly basisUnitPriceUsd: number | null
  readonly arithmetic: string
  readonly inputs: readonly RecommendationInputValue[]
  readonly caveats: readonly RecommendationCaveat[]
  readonly wouldSharpenWith: readonly string[]
  readonly observationCount: number
  readonly oldestObservationIso: string | null
  readonly newestObservationIso: string | null
  /** Age of the OLDEST observation in the pool. A band rests on evidence as old as its oldest. */
  readonly ageYearsForWidening: number
  /** True where a point estimate is forbidden whatever the arithmetic gives (R1 and R5). */
  readonly alwaysBand: boolean
  readonly evidenceState: QuoteEvidenceState
}

type RungUnavailable = {
  readonly rung: RecommendationRung
  readonly reason: RungUnavailableReason
  readonly missingInput: string
  readonly sentence: string
}

type RungAttempt = RawBasis | RungUnavailable

const isBasis = (a: RungAttempt): a is RawBasis => 'rawLowUsd' in a

/* ------------------------------------------------------------------------------------ */
/* RUNG 1: THE MANUFACTURER ANCHOR                                                        */
/* ------------------------------------------------------------------------------------ */

/**
 * A FACTOR THAT NAMES A PUBLISHED SERIES IS A READING. ONE THAT DOES NOT IS A JUDGEMENT.
 *
 * The distinction is the whole evidence contract, and it is read off the configuration rather than
 * assumed here, because it CHANGES: the CPI factor carried no series id until the data lane
 * identified BLS CUUR0000SA0 and wrote it on. Grading a reading as PRIOR understates what we hold;
 * grading a judgement as MEASURED launders it. So the grade follows the field.
 *
 * A READING GOES STALE IN A WAY A JUDGEMENT DOES NOT, which is why the vintage note travels on the
 * input's `source` unedited: it is where the series says when it was read and what a fresher
 * reading would give.
 */
function factorEvidenceState(spec: InflationIndexSpec): QuoteEvidenceState {
  return spec.vintage.publishedSeriesId === null ? 'PRIOR' : 'MEASURED'
}

function factorInput(
  spec: InflationIndexSpec,
  indexName: (k: IndexKind) => string,
): RecommendationInputValue {
  const series = spec.vintage.publishedSeriesId
  return {
    label: `${indexName(spec.kind)} factor`,
    renderedValue: series === null ? String(spec.factor) : `${spec.factor} (series ${series})`,
    valueUsd: null,
    dateIso: null,
    source: spec.vintage.note,
    evidenceState: factorEvidenceState(spec),
    citation: spec.citation,
  }
}

/** Says what each factor actually is, in the order the band presents them. */
function describeFactorProvenance(
  lowLine: InflationIndexSpec,
  highLine: InflationIndexSpec,
  indexName: (k: IndexKind) => string,
): string {
  const describe = (spec: InflationIndexSpec): string =>
    spec.vintage.publishedSeriesId === null
      ? `the ${indexName(spec.kind)} factor names no published series and is the expert's stated ` +
        'judgement'
      : `the ${indexName(spec.kind)} factor is a reading of published series ` +
        `${spec.vintage.publishedSeriesId}, which means it has a date and goes stale`
  return `${describe(lowLine).replace(/^the/, 'The')}, and ${describe(highLine)}.`
}

/** What would sharpen THIS anchor, given what each of its two factors already is. */
function sharpenTheAnchorWith(
  lowLine: InflationIndexSpec,
  highLine: InflationIndexSpec,
  indexName: (k: IndexKind) => string,
): readonly string[] {
  const unnamed = [lowLine, highLine].filter((s) => s.vintage.publishedSeriesId === null)
  const named = [lowLine, highLine].filter((s) => s.vintage.publishedSeriesId !== null)
  const out: string[] = []
  if (unnamed.length > 0) {
    out.push(
      `identifying a published series behind the ${unnamed
        .map((s) => indexName(s.kind))
        .join(' and ')} factor would turn a stated judgement into a dated reading, and would let ` +
        'it re-base to an award year other than ' +
        String(lowLine.vintage.baseYear),
    )
  }
  for (const s of named) {
    out.push(
      `re-reading series ${s.vintage.publishedSeriesId} at the pricing instant would refresh the ` +
        `${indexName(s.kind)} factor, which is a reading taken on a date and not a constant`,
    )
  }
  out.push(
    'an award to an approved source dated in the factors base year, which is what this rung ' +
      'needs before it can run at all',
  )
  return out
}

const SHARPEN_WITH_A_DATED_SERIES =
  'a dated inflation series that can be re-based to any award year, rather than factors stated ' +
  'for one base year, would let the manufacturer rung run on awards outside that year and would ' +
  'narrow the disagreement its band is made of'

function buildAnchorRung(
  input: RecommendationInput,
  oem: OemAwardIdentification,
  indices: AnchorIndexConfig,
): RungAttempt {
  if (!oem.identified) {
    return {
      rung: 'R1_MANUFACTURER_ANCHOR',
      reason: 'NO_MANUFACTURER_AWARD_IDENTIFIED',
      missingInput: oem.missingInput,
      sentence: oem.sentence,
    }
  }
  const cpiBase = indices.cpi.vintage.baseYear
  const dodBase = indices.dodProcurement.vintage.baseYear
  if (cpiBase !== dodBase || oem.awardYear !== cpiBase) {
    return {
      rung: 'R1_MANUFACTURER_ANCHOR',
      reason: 'NO_INFLATION_FACTOR_FOR_THE_AWARD_YEAR',
      missingInput:
        `an inflation factor with a base year of ${oem.awardYear}, from a published series ` +
        'rather than a stated judgement',
      sentence:
        `The manufacturer award is dated ${oem.awardDateIso}. Both factors on file are stated ` +
        `for a base year of ${cpiBase}, name no published series, and so cannot be re-based. ` +
        `Applying a ${cpiBase} factor to a ${oem.awardYear} award would overstate the anchor by ` +
        'the difference between those years and would look exactly as confident as a correct ' +
        'figure.',
    }
  }
  const outcome = anchorPrice(
    { unitPriceUsd: oem.unitPriceUsd, awardYear: oem.awardYear, quantity: oem.quantity },
    indices,
  )
  if (!outcome.anchored) {
    return {
      rung: 'R1_MANUFACTURER_ANCHOR',
      reason: 'ANCHOR_ENGINE_ABSTAINED',
      missingInput: 'a well formed anchor configuration and a positive manufacturer unit price',
      sentence: outcome.detail,
    }
  }
  const [first, second] = outcome.results
  const low = Math.min(first.adjustedUnitPriceUsd, second.adjustedUnitPriceUsd)
  const high = Math.max(first.adjustedUnitPriceUsd, second.adjustedUnitPriceUsd)
  const lowLine = first.adjustedUnitPriceUsd === low ? first : second
  const highLine = first.adjustedUnitPriceUsd === low ? second : first
  const indexName = (k: IndexKind): string => (k === 'cpi' ? 'CPI' : 'DoD procurement')

  return {
    rung: 'R1_MANUFACTURER_ANCHOR',
    rawLowUsd: low,
    rawHighUsd: high,
    /*
     * NO MIDPOINT ANYWHERE ON THIS RUNG, and that is a hard constraint rather than an omission.
     * The two indices are never averaged: `assertFourSeparateFigures` in quote-view.ts hunts the
     * payload for the exact mean of the two anchor lines, because a blend is the one shape that
     * destroys the only thing making the number defensible to a contracting officer, which is
     * being able to say which index produced it. So the band IS the two computed lines, each
     * labelled, and the widening below scales the endpoints rather than expanding around a centre.
     */
    basisUnitPriceUsd: null,
    arithmetic:
      `${money(oem.unitPriceUsd)} (${indexName(lowLine.kind)}) x ` +
      `${lowLine.factor} = ${money(low)} to ${money(oem.unitPriceUsd)} ` +
      `(${indexName(highLine.kind)}) x ${highLine.factor} = ${money(high)}`,
    inputs: [
      {
        label: 'Manufacturer award unit price',
        renderedValue: `${money(oem.unitPriceUsd)} to ${oem.awardeeCompany ?? oem.awardeeCage}`,
        valueUsd: oem.unitPriceUsd,
        dateIso: oem.awardDateIso,
        source:
          'NSN-Now Batch Export, Procurement sheet, joined to the MCRL approved-source sheet on ' +
          'the awardee CAGE. The earliest award to an approved source inside the feed window.',
        evidenceState: 'MEASURED',
        citation: null,
      },
      factorInput(lowLine, indexName),
      factorInput(highLine, indexName),
    ],
    caveats: [
      {
        code: 'INFLATION_FACTORS_ARE_STATED_JUDGEMENTS',
        /*
         * THE SENTENCE IS BUILT FROM THE CONFIGURATION, NOT ASSERTED ABOUT IT.
         *
         * This read "Neither factor names a published series" as a flat statement, and it was true
         * for exactly one day. On 2026-08-19 the data lane identified the CPI factor as BLS series
         * CUUR0000SA0 and wrote the id onto the config, at which point a hardcoded sentence in this
         * file would have been telling an operator the opposite of what the config said, in the
         * confident register of a caveat. A string that describes the data has to be COMPUTED from
         * the data, every time.
         */
        sentence: describeFactorProvenance(lowLine, highLine, indexName) +
          ` The two disagree by ${pct(high / low - 1)} about what a ${cpiBase} dollar is worth ` +
          'now. This band IS that disagreement, and the expert prefers the DoD procurement end ' +
          'because it reflects industrial, metals and logistics cost growth that outpaced ' +
          'consumer inflation.',
        measured: { label: 'index disagreement', value: high / low - 1, unit: 'RATIO' },
      },
    ],
    wouldSharpenWith: sharpenTheAnchorWith(lowLine, highLine, indexName),
    observationCount: 1,
    oldestObservationIso: oem.awardDateIso,
    newestObservationIso: oem.awardDateIso,
    /*
     * ZERO, and it is not an oversight. The anchor's whole job is carrying an old price forward,
     * so the age of the award is already inside the factor. Widening it a second time for the
     * same years would charge the row twice for one fact.
     */
    ageYearsForWidening: 0,
    alwaysBand: true,
    /*
     * ESTIMATED, stated rather than combined. The obvious move is to take the weakest input state
     * (PRIOR, from the factor) but that is wrong: PRIOR means somebody's bare judgement, and this
     * is arithmetic WE performed on a measured award price. Deriving is what makes it ESTIMATED,
     * and the factor's PRIOR grade is carried on its own input line where a reader sees it.
     */
    evidenceState: 'ESTIMATED',
  }
}

/* ------------------------------------------------------------------------------------ */
/* RUNG 2: THE OPERATOR'S OWN RULE                                                        */
/* ------------------------------------------------------------------------------------ */

/**
 * WHAT THE MULTIPLE IN FORCE ACTUALLY IS, IN A SENTENCE THAT IS TRUE OF IT.
 *
 * ★ DERIVED FROM THE NUMBER, NEVER STORED BESIDE IT. The previous implementation kept a fixed
 * string describing the 3x rule, and when the default changed the string stayed: a label that
 * described the product's behaviour and then quietly stopped. That is the same defect class as a
 * confidence tier derived from ladder position, and the cure is the same, which is to compute the
 * claim from the thing it claims about.
 *
 * An explicit `awardMultipleSource` on the config still wins, because an operator who states why
 * they chose a number has said something this function cannot know.
 */
export function describeAwardMultiple(config: RecommendationConfig): string {
  if (config.awardMultipleSource != null && config.awardMultipleSource.trim() !== '') {
    return config.awardMultipleSource
  }
  if (config.awardMultiple === DEFAULT_AWARD_MULTIPLE) {
    return (
      'The previous award price carried across unchanged. It is the best single estimator of ' +
      'the next clearing price that has been measured here, at or below the actual clearing ' +
      'price on 80% of stock numbers counted once. It is a central estimate and not an optimum: ' +
      'the step from it to a bid needs your cost, which this product does not hold.'
    )
  }
  if (config.awardMultiple === OPERATOR_AWARD_MULTIPLE) {
    return (
      'Stated by the operator: "I quoted $3,565, three times the unit price of the previous ' +
      'award." His rule, chosen here rather than defaulted to. Measured against real outcomes it ' +
      'came in at or below the actual clearing price 0.00% of the time with each stock number ' +
      'counted once, and the highest multiple at which anything cleared at all was about 1.45x.'
    )
  }
  return (
    `Set to ${config.awardMultiple}x here rather than defaulted to. ` +
    measuredRecordSentence(config.awardMultiple)
  )
}

function multiplierInput(config: RecommendationConfig): RecommendationInputValue {
  return {
    label: 'Multiplier',
    renderedValue: `${config.awardMultiple}x`,
    valueUsd: null,
    dateIso: null,
    source: describeAwardMultiple(config),
    evidenceState: 'PRIOR',
    citation: null,
  }
}

function multiplierCaveat(config: RecommendationConfig): RecommendationCaveat {
  return {
    code: 'MULTIPLIER_IS_A_STATED_RULE_NOT_A_MEASURED_SERIES',
    /*
     * ★ THIS CAVEAT NOW CARRIES THE OUTCOME, NOT ONLY THE PROVENANCE, AND THAT CHANGE IS THE
     * WHOLE POINT. Saying "it is not a measured relationship" was true and it was not enough: it
     * describes where the number came from while staying silent on whether it works, and a
     * reader takes silence there as "unknown" rather than as "measured, and the answer is no".
     *
     * MEASURED 2026-08-19 over the live award corpus, on 40,184 consecutive award pairs, asking
     * whether the multiplied previous price would have been at or below the price the item
     * ACTUALLY cleared at next time (that price is the one that beat everyone, so it is an
     * outcome and not a model): 318 of 40,184, which is 0.8%, and that is an UPPER bound because
     * being at or below the clearing price is necessary to win and not sufficient.
     *
     * Split by world, because the rule came from a sole-source buy and the obvious mitigation is
     * to keep it there: SOLE 30 of 9,175 (0.3%), COMPETED 288 of 31,009 (0.9%). It fails HARDER
     * in its own world. The median quote/actual is 3.00x in BOTH, which says the previous award
     * price is a near-perfect estimator of the next one whether or not anybody competed, so
     * multiplying it is what breaks it. Repeating the previous price unmultiplied would have
     * been at or below the clearing price on 76.3%.
     */
    sentence:
      `The ${config.awardMultiple}x is your own rule, stated once about one item, and it is not ` +
      'a measured relationship. Our own award history measures how it would have fared: across ' +
      '40,184 consecutive award pairs a multiplied quote came in at or below the price the item ' +
      'actually cleared at 0.8% of the time, and 0.3% on sole-source items, because the previous ' +
      'award price is itself a close estimate of the next one. It is shown because it is yours ' +
      'and because it is adjustable: change the multiplier and every figure on this rung moves ' +
      'with it, deterministically.',
    measured: { label: 'multiplier', value: config.awardMultiple, unit: 'RATIO' },
  }
}

function buildLastAwardRung(
  input: RecommendationInput,
  pool: PoolBuild,
  config: RecommendationConfig,
): RungAttempt {
  const latest = pool.latest
  if (latest.kind === 'NONE') {
    return {
      rung: 'R2_LAST_AWARD_MULTIPLE',
      reason: 'NO_DATED_AWARD_ON_FILE',
      missingInput: 'a dated award on this stock number',
      sentence:
        'No dated award on or before the pricing instant is on file for this stock number, so ' +
        'there is no previous award price for your rule to multiply.',
    }
  }
  if (latest.kind === 'UNREADABLE') {
    return {
      rung: 'R2_LAST_AWARD_MULTIPLE',
      reason: 'LAST_AWARD_CONTRADICTS_ITSELF_ON_PRICE',
      missingInput:
        'a most recent award whose Unit Price column and extended total agree on what one unit ' +
        'cost',
      sentence:
        `The most recent award is ${latest.why}. Your rule multiplies THE PREVIOUS AWARD price, ` +
        'so this is the one row this rung is a function of, and which of its two columns is the ' +
        'unit price is not decidable from the row. An earlier award is not substituted here: ' +
        'that would answer a different question under the same label. The rungs below pool many ' +
        'awards and can still carry this row.',
    }
  }
  if (latest.kind === 'TIE_DISAGREES') {
    return {
      rung: 'R2_LAST_AWARD_MULTIPLE',
      reason: 'LATEST_AWARDS_DISAGREE_ON_PRICE',
      missingInput:
        'a single most recent award, or a stated rule for choosing between awards made on the ' +
        'same day',
      sentence:
        `Several awards share the most recent date on file, ${latest.awardDateIso}, and they ` +
        `state different unit prices: ${latest.prices.map(money).join(', ')}. "The previous ` +
        'award" is not a fact when several awards are the previous one, and the order the ' +
        'workbook lists them in is not a tie-break.',
    }
  }
  if (latest.kind === 'EXCLUDED_SURPLUS') {
    return {
      rung: 'R2_LAST_AWARD_MULTIPLE',
      reason: 'LAST_AWARD_EXCLUDED_AS_SURPLUS_MATERIAL',
      missingInput:
        'a most recent award on material comparable to what we would offer, or a declaration ' +
        'that we would offer surplus',
      sentence:
        `The most recent award, dated ${latest.awardDateIso}, is flagged as surplus material by ` +
        'the export, and this offer has been declared as new material. A surplus price is a ' +
        'resale price, not a new-manufacture basis. An earlier award is not substituted for it, ' +
        'because your rule names the PREVIOUS award and quietly using a different one would ' +
        'answer a different question under the same label.',
    }
  }
  const last = latest.comparable
  const product = timesMultiple(last.unitPriceUsd, config.awardMultiple)
  const exactText =
    product.exactUsd === product.roundedUsd ? money(product.roundedUsd) : String(product.exactUsd)
  return {
    rung: 'R2_LAST_AWARD_MULTIPLE',
    rawLowUsd: product.roundedUsd,
    rawHighUsd: product.roundedUsd,
    basisUnitPriceUsd: product.roundedUsd,
    arithmetic:
      `${money(last.unitPriceUsd)} x ${config.awardMultiple} = ${exactText}` +
      (product.exactUsd === product.roundedUsd ? '' : ` (rounds to ${money(product.roundedUsd)})`),
    inputs: [
      {
        label: 'Last award unit price',
        renderedValue:
          `${money(last.unitPriceUsd)} to ${last.awardeeCompany ?? last.awardeeCage ?? 'an ' +
          'unnamed awardee'}` +
          (last.quantity === null ? '' : ` on a quantity of ${last.quantity}`),
        valueUsd: last.unitPriceUsd,
        dateIso: last.awardDateIso,
        source:
          'NSN-Now Batch Export, Procurement sheet, the most recent dated award whose Unit Price ' +
          'column and extended total agree to within a cent.',
        evidenceState: 'MEASURED',
        citation: null,
      },
      multiplierInput(config),
    ],
    caveats: [
      multiplierCaveat(config),
      ...quantityBreakCaveats([last], input.requirementQuantity, config.quantityBreakRatio),
      ...surplusCaveats([last], pool.excludedForSurplus, input.surplusStance ?? 'UNDECLARED'),
      ...setAsideCaveat(pool.unreadableRows),
    ],
    wouldSharpenWith: [
      'an award to a company on this item’s approved-source list, dated in the inflation ' +
        'factors’ base year, would move this row to rung 1: the manufacturer’s own ' +
        'price carried forward, which is the tightest basis on the ladder',
      SHARPEN_WITH_A_DATED_SERIES,
      'a fresher award would narrow the age widening on this band',
    ],
    observationCount: 1,
    oldestObservationIso: last.awardDateIso,
    newestObservationIso: last.awardDateIso,
    ageYearsForWidening: last.ageYears,
    alwaysBand: false,
    evidenceState: 'ESTIMATED',
  }
}

/* ------------------------------------------------------------------------------------ */
/* RUNG 3: THE BAND OF THIS ITEM'S OWN RECENT AWARDS                                      */
/* ------------------------------------------------------------------------------------ */

function buildRecentBandRung(
  input: RecommendationInput,
  pool: PoolBuild,
  config: RecommendationConfig,
): RungAttempt {
  const windowStartMs = monthsBeforeUtc(input.atInstantMs, config.recentWindowMonths)
  const inWindow = pool.kept.filter((c) => c.awardDateMs >= windowStartMs)
  if (inWindow.length < config.recentBandMinimumAwards) {
    return {
      rung: 'R3_RECENT_AWARD_BAND',
      reason: 'TOO_FEW_RECENT_AWARDS',
      missingInput:
        `${config.recentBandMinimumAwards} readable awards dated inside the ` +
        `${config.recentWindowMonths} months ending ${isoDay(input.atInstantMs)}`,
      sentence:
        `${inWindow.length} readable award(s) fall inside the ${config.recentWindowMonths} month ` +
        `window ending ${isoDay(input.atInstantMs)}. A band needs at least ` +
        `${config.recentBandMinimumAwards}, and a range formed over an unstated window is not a ` +
        'band, it is a shape.',
    }
  }
  const prices = inWindow.map((c) => c.unitPriceUsd)
  const lowObserved = Math.min(...prices)
  const highObserved = Math.max(...prices)
  const low = timesMultiple(lowObserved, config.awardMultiple).roundedUsd
  const high = timesMultiple(highObserved, config.awardMultiple).roundedUsd
  const oldest = inWindow[0] as Comparable
  const newest = inWindow[inWindow.length - 1] as Comparable
  return {
    rung: 'R3_RECENT_AWARD_BAND',
    rawLowUsd: low,
    rawHighUsd: high,
    basisUnitPriceUsd: null,
    arithmetic:
      `${inWindow.length} awards from ${oldest.awardDateIso} to ${newest.awardDateIso} ran ` +
      `${money(lowObserved)} to ${money(highObserved)} a unit; x ${config.awardMultiple} = ` +
      `${money(low)} to ${money(high)}`,
    inputs: [
      ...inWindow.map(
        (c): RecommendationInputValue => ({
          label: 'Award in window',
          renderedValue:
            `${money(c.unitPriceUsd)} a unit to ${c.awardeeCompany ?? c.awardeeCage ?? 'an ' +
            'unnamed awardee'}` + (c.quantity === null ? '' : ` on a quantity of ${c.quantity}`),
          valueUsd: c.unitPriceUsd,
          dateIso: c.awardDateIso,
          source: 'NSN-Now Batch Export, Procurement sheet.',
          evidenceState: 'MEASURED',
          citation: null,
        }),
      ),
      {
        label: 'Window length',
        renderedValue: `${config.recentWindowMonths} months`,
        valueUsd: null,
        dateIso: null,
        source:
          'Our chosen recency window, not a regulation. DLAD 17.7505 measures over twelve ' +
          'months, which is too thin to form a band on most items in this corpus.',
        evidenceState: 'PRIOR',
        citation: null,
      },
      multiplierInput(config),
    ],
    caveats: [
      multiplierCaveat(config),
      ...quantityBreakCaveats(inWindow, input.requirementQuantity, config.quantityBreakRatio),
      ...surplusCaveats(inWindow, pool.excludedForSurplus, input.surplusStance ?? 'UNDECLARED'),
      ...setAsideCaveat(pool.unreadableRows),
    ],
    wouldSharpenWith: [
      'a readable most recent award would give rung 2, your own rule on a single price',
      'an approved-source award in the inflation factors’ base year would give rung 1',
      SHARPEN_WITH_A_DATED_SERIES,
    ],
    observationCount: inWindow.length,
    oldestObservationIso: oldest.awardDateIso,
    newestObservationIso: newest.awardDateIso,
    ageYearsForWidening: oldest.ageYears,
    alwaysBand: false,
    evidenceState: 'ESTIMATED',
  }
}

/* ------------------------------------------------------------------------------------ */
/* RUNG 4: THE TREND ACROSS THE WHOLE AWARD HISTORY                                       */
/* ------------------------------------------------------------------------------------ */

/** Least squares on (years, price). Null when every observation shares one date. */
function leastSquares(
  points: readonly { readonly x: number; readonly y: number }[],
): { readonly slope: number; readonly intercept: number } | null {
  const n = points.length
  if (n < 2) return null
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  const mx = sx / n
  const my = sy / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.x - mx) * (p.y - my)
    den += (p.x - mx) ** 2
  }
  if (!(den > 0)) return null
  const slope = num / den
  return { slope, intercept: my - slope * mx }
}

function buildTrendRung(
  input: RecommendationInput,
  pool: PoolBuild,
  config: RecommendationConfig,
): RungAttempt {
  if (pool.kept.length < config.trendMinimumAwards) {
    return {
      rung: 'R4_AWARD_TREND',
      reason: 'TOO_FEW_AWARDS_FOR_A_TREND',
      missingInput: `${config.trendMinimumAwards} readable dated awards on this stock number`,
      sentence:
        `${pool.kept.length} readable award(s) are on file. A trend fitted through fewer than ` +
        `${config.trendMinimumAwards} points is a line through noise, and its slope would read ` +
        'as a finding.',
    }
  }
  const oldest = pool.kept[0] as Comparable
  const newest = pool.kept[pool.kept.length - 1] as Comparable
  const points = pool.kept.map((c) => ({ x: (c.awardDateMs - oldest.awardDateMs) / MS_PER_YEAR, y: c.unitPriceUsd }))
  const fit = leastSquares(points)
  const prices = pool.kept.map((c) => c.unitPriceUsd)
  const observedLow = Math.min(...prices)
  const observedHigh = Math.max(...prices)
  const xNow = (input.atInstantMs - oldest.awardDateMs) / MS_PER_YEAR
  const projected =
    fit === null ? null : Math.round((fit.intercept + fit.slope * xNow) * 100) / 100

  /*
   * THE PROJECTION NEVER LEAVES THE OBSERVED RANGE ON ITS OWN. The band spans the observed
   * prices UNION the projection, so an extrapolation can widen the band but can never become a
   * confident figure sitting outside everything that has ever been paid. A trend fitted through
   * four points is not a forecast and this rung does not present one.
   */
  const candidates = projected === null || !(projected > 0) ? prices : [...prices, projected]
  const basisLow = Math.min(...candidates)
  const basisHigh = Math.max(...candidates)
  const low = timesMultiple(basisLow, config.awardMultiple).roundedUsd
  const high = timesMultiple(basisHigh, config.awardMultiple).roundedUsd

  const trendText =
    fit === null
      ? 'every award shares one date, so no trend is fitted'
      : `least squares trend ${fit.slope >= 0 ? '+' : ''}${fit.slope.toFixed(2)} a unit a year, ` +
        `projecting ${projected === null ? 'nothing' : money(projected)} at ` +
        `${isoDay(input.atInstantMs)}`

  return {
    rung: 'R4_AWARD_TREND',
    rawLowUsd: low,
    rawHighUsd: high,
    basisUnitPriceUsd: null,
    arithmetic:
      `${pool.kept.length} awards, ${oldest.awardDateIso} at ${money(oldest.unitPriceUsd)} to ` +
      `${newest.awardDateIso} at ${money(newest.unitPriceUsd)}; ${trendText}; the band spans ` +
      `${money(basisLow)} to ${money(basisHigh)}, x ${config.awardMultiple} = ${money(low)} to ` +
      `${money(high)}`,
    inputs: [
      {
        label: 'Award history span',
        renderedValue:
          `${pool.kept.length} readable awards, ${money(observedLow)} to ${money(observedHigh)} ` +
          'a unit',
        valueUsd: null,
        dateIso: oldest.awardDateIso,
        source: 'NSN-Now Batch Export, Procurement sheet, every dated readable award on file.',
        evidenceState: 'MEASURED',
        citation: null,
      },
      {
        label: 'Fitted trend',
        renderedValue: trendText,
        valueUsd: projected,
        dateIso: isoDay(input.atInstantMs),
        source: 'Least squares over the award prices above. Our arithmetic, not a published series.',
        evidenceState: 'ESTIMATED',
        citation: null,
      },
      multiplierInput(config),
    ],
    caveats: [
      multiplierCaveat(config),
      ...quantityBreakCaveats(pool.kept, input.requirementQuantity, config.quantityBreakRatio),
      ...surplusCaveats(pool.kept, pool.excludedForSurplus, input.surplusStance ?? 'UNDECLARED'),
      ...setAsideCaveat(pool.unreadableRows),
    ],
    wouldSharpenWith: [
      `${config.recentBandMinimumAwards} readable awards inside the ` +
        `${config.recentWindowMonths} month window would give rung 3, which reads only recent ` +
        'prices instead of the whole history',
      'a readable most recent award would give rung 2, your own rule on a single price',
      'an approved-source award in the inflation factors’ base year would give rung 1',
    ],
    observationCount: pool.kept.length,
    oldestObservationIso: oldest.awardDateIso,
    newestObservationIso: newest.awardDateIso,
    ageYearsForWidening: oldest.ageYears,
    alwaysBand: false,
    evidenceState: 'ESTIMATED',
  }
}

/* ------------------------------------------------------------------------------------ */
/* RUNG 5: THE PRICED PEERS IN THE SUPPLY CLASS                                           */
/* ------------------------------------------------------------------------------------ */

/** Linear interpolation between order statistics. Standard, and stated so it can be checked. */
function percentile(sortedAscending: readonly number[], p: number): number {
  const n = sortedAscending.length
  const first = sortedAscending[0] as number
  if (n === 1) return first
  const idx = (n - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const loValue = sortedAscending[lo] as number
  const hiValue = sortedAscending[hi] as number
  return lo === hi ? loValue : loValue + (hiValue - loValue) * (idx - lo)
}

function buildPeerRung(
  input: RecommendationInput,
  fsc: string | null,
  config: RecommendationConfig,
): RungAttempt {
  if (fsc === null) {
    return {
      rung: 'R5_FSC_PEER_BAND',
      reason: 'NO_SUPPLY_CLASS_ON_THE_STOCK_NUMBER',
      missingInput: 'a stock number carrying a four digit supply class',
      sentence:
        `"${input.nsn}" does not carry a readable four digit supply class, so no peer group can ` +
        'be formed for it.',
    }
  }
  if (!input.peerLookup) {
    return {
      rung: 'R5_FSC_PEER_BAND',
      reason: 'NO_PEER_LOOKUP_SUPPLIED',
      missingInput: 'a peer lookup over priced awards in the same supply class',
      sentence:
        'No peer lookup was supplied to this call, so the supply class was never read. This is a ' +
        'wiring gap and not a finding about the item.',
    }
  }
  const stance = input.surplusStance ?? 'UNDECLARED'
  const raw = input.peerLookup(fsc)
  const usable: Comparable[] = []
  const excluded: Comparable[] = []
  for (const p of raw) {
    if (!(p.unitPriceUsd > 0) || !Number.isFinite(p.unitPriceUsd)) continue
    const ms = p.awardDateIso === null ? null : Date.parse(p.awardDateIso)
    const dated = ms !== null && Number.isFinite(ms) && ms <= input.atInstantMs
    const c: Comparable = {
      unitPriceUsd: p.unitPriceUsd,
      quantity: p.quantity,
      awardDateIso: p.awardDateIso ?? '',
      awardDateMs: dated ? (ms as number) : input.atInstantMs,
      ageYears: dated ? (input.atInstantMs - (ms as number)) / MS_PER_YEAR : 0,
      awardeeCage: p.awardeeCage,
      awardeeCompany: null,
      contractNo: null,
      surplus: readComparableSurplus(p.surplusAsWorded, p.awardeeCage, input.classifyAwardee),
      nsn: p.nsn,
    }
    if (excludedBySurplusStance(c.surplus, stance)) excluded.push(c)
    else usable.push(c)
  }
  if (usable.length < config.peerFloorCount) {
    return {
      rung: 'R5_FSC_PEER_BAND',
      reason: 'PEER_GROUP_BELOW_THE_FLOOR',
      missingInput:
        `${config.peerFloorCount} priced peers in supply class ${fsc}; ${usable.length} were ` +
        'found',
      sentence:
        `Supply class ${fsc} holds ${usable.length} priced peer(s) here` +
        (excluded.length > 0
          ? `, after ${excluded.length} flagged as surplus material were excluded` +
            ' on the declared new-material offer'
          : '') +
        `. A band needs ${config.peerFloorCount}: a band computed from one or two observations is ` +
        'a point estimate in disguise, and it looks more rigorous than the point estimate it is ' +
        'hiding. This is an abstention and not a zero.',
    }
  }
  const sorted = [...usable.map((c) => c.unitPriceUsd)].sort((a, b) => a - b)
  const p25 = percentile(sorted, 0.25)
  const p50 = percentile(sorted, 0.5)
  const p75 = percentile(sorted, 0.75)
  const low = timesMultiple(p25, config.awardMultiple).roundedUsd
  const high = timesMultiple(p75, config.awardMultiple).roundedUsd
  const dated = usable.filter((c) => c.awardDateIso !== '')
  const oldestAge = dated.length === 0 ? 0 : Math.max(...dated.map((c) => c.ageYears))
  const oldestIso =
    dated.length === 0
      ? null
      : (dated.reduce((a, b) => (b.awardDateMs < a.awardDateMs ? b : a)).awardDateIso || null)
  const newestIso =
    dated.length === 0
      ? null
      : (dated.reduce((a, b) => (b.awardDateMs > a.awardDateMs ? b : a)).awardDateIso || null)

  return {
    rung: 'R5_FSC_PEER_BAND',
    rawLowUsd: low,
    rawHighUsd: high,
    basisUnitPriceUsd: null,
    arithmetic:
      `${usable.length} priced peers in supply class ${fsc}, median ${money(p50)} a unit, middle ` +
      `half ${money(p25)} to ${money(p75)}; x ${config.awardMultiple} = ${money(low)} to ` +
      `${money(high)}`,
    inputs: [
      {
        label: 'Priced peers in the supply class',
        renderedValue:
          `${usable.length} peers in class ${fsc}, ${money(sorted[0] as number)} to ` +
          `${money(sorted[sorted.length - 1] as number)} a unit`,
        valueUsd: null,
        dateIso: newestIso,
        source: 'NSN-Now Batch Export, Procurement sheet, other stock numbers in the same class.',
        evidenceState: 'MEASURED',
        citation: null,
      },
      {
        label: 'Middle half of the peer prices',
        renderedValue: `${money(p25)} to ${money(p75)} a unit, median ${money(p50)}`,
        valueUsd: p50,
        dateIso: null,
        source:
          'The 25th and 75th percentiles by linear interpolation between order statistics. The ' +
          'full range is reported above; the middle half is the band, because one outlying peer ' +
          'should not set what you quote.',
        evidenceState: 'MEASURED',
        citation: null,
      },
      multiplierInput(config),
    ],
    caveats: [
      {
        code: 'PEER_BASIS_IS_A_DIFFERENT_ITEM',
        sentence:
          `This is the weakest basis we hold. Every price in it was paid for a DIFFERENT stock ` +
          `number that happens to sit in supply class ${fsc}, and ${usable.length} peers is what ` +
          'the class holds. It is shown as a band and never as a single number, because the width ' +
          'IS the uncertainty and a caveat is read once while a number is read every time.',
        measured: { label: 'priced peers', value: usable.length, unit: 'COUNT' },
      },
      multiplierCaveat(config),
      ...quantityBreakCaveats(usable, input.requirementQuantity, config.quantityBreakRatio),
      ...surplusCaveats(usable, excluded, stance),
    ],
    wouldSharpenWith: [
      'any readable award on THIS stock number would move the row off the peer group entirely, ' +
        'onto rung 2 or better',
      `${config.recentBandMinimumAwards} readable awards inside the ` +
        `${config.recentWindowMonths} month window would give rung 3`,
      'an approved-source award in the inflation factors’ base year would give rung 1',
    ],
    observationCount: usable.length,
    oldestObservationIso: oldestIso,
    newestObservationIso: newestIso,
    ageYearsForWidening: oldestAge,
    /*
     * ALWAYS A BAND. Owner-level design rule, and it is structural rather than conditional: even
     * three peers that happen to state the same price render as a band, because the shape is what
     * a reader trusts and a point estimate off the weakest basis we hold is the exact failure this
     * rule exists to stop.
     */
    alwaysBand: true,
    evidenceState: 'ESTIMATED',
  }
}

/* ------------------------------------------------------------------------------------ */
/* WIDENING: AGE, THEN THE MONOTONE FLOOR                                                 */
/* ------------------------------------------------------------------------------------ */

type WidenedRung = {
  readonly basis: RawBasis
  readonly recommended: RecommendedFigure
  readonly widthRatio: number
  readonly widthRatioBeforeFloor: number
  readonly widenedToMatch: RecommendationRung | null
  readonly ageCaveat: RecommendationCaveat | null
  readonly floorCaveat: RecommendationCaveat | null
}

function widenBasis(
  basis: RawBasis,
  driftPerYear: number,
  floorFrom: { readonly rung: RecommendationRung; readonly widthRatio: number } | null,
): WidenedRung {
  const rawRatio = basis.rawHighUsd / basis.rawLowUsd
  const ageG = Math.max(0, basis.ageYearsForWidening) * driftPerYear
  const widthAfterAge = rawRatio * (1 + ageG) ** 2 - 1

  let g = ageG
  let widenedToMatch: RecommendationRung | null = null
  if (floorFrom !== null && floorFrom.widthRatio > widthAfterAge) {
    const target = floorFrom.widthRatio
    const floorG = Math.sqrt((1 + target) / rawRatio) - 1
    if (floorG > g) {
      g = floorG
      widenedToMatch = floorFrom.rung
    }
  }

  const low = floorToCents(basis.rawLowUsd / (1 + g))
  const high = ceilToCents(basis.rawHighUsd * (1 + g))
  const isPoint = !basis.alwaysBand && g === 0 && basis.rawLowUsd === basis.rawHighUsd

  const recommended: RecommendedFigure = isPoint
    ? {
        kind: 'POINT',
        unitPriceUsd: basis.rawLowUsd,
        exactUnitPriceUsd: basis.rawLowUsd,
      }
    : {
        kind: 'BAND',
        lowUnitPriceUsd: low,
        highUnitPriceUsd: high,
        widthRatio: (high - low) / low,
      }

  const widthRatio = recommended.kind === 'POINT' ? 0 : recommended.widthRatio

  return {
    basis,
    recommended,
    widthRatio,
    widthRatioBeforeFloor: Math.max(0, widthAfterAge),
    widenedToMatch,
    ageCaveat:
      ageG > 0
        ? {
            code: 'BASIS_IS_OLD_AND_THE_BAND_WAS_WIDENED_BY_ITS_AGE',
            sentence:
              `The oldest award behind this figure is ${basis.oldestObservationIso ?? 'undated'}, ` +
              `${basis.ageYearsForWidening.toFixed(1)} years old. There is no dated inflation ` +
              'series on file, so the band is widened by the only measured statement this corpus ' +
              'makes about a year of price drift: the two stated inflation factors disagree by ' +
              `${pct(driftPerYear)} a year. ${basis.ageYearsForWidening.toFixed(1)} x ` +
              `${pct(driftPerYear)} = ${pct(ageG)} each side.`,
            measured: {
              label: 'age of the oldest basis award',
              value: basis.ageYearsForWidening,
              unit: 'YEARS',
            },
          }
        : null,
    floorCaveat:
      widenedToMatch === null
        ? null
        : {
            code: 'WIDENED_TO_THE_WIDTH_OF_A_STRONGER_RUNG',
            sentence:
              `This band was widened to ${pct(widthRatio)} to match ${widenedToMatch}, which is a ` +
              'stronger basis on this same row. A weaker basis may not report a tighter band than ' +
              'a stronger one, and widening is the safe direction.',
            measured: { label: 'width after the floor', value: widthRatio, unit: 'RATIO' },
          },
  }
}

/* ------------------------------------------------------------------------------------ */
/* BD-18: WHAT WE SEND, AND SEPARATELY WHAT THE BUYER COMPARES                            */
/* ------------------------------------------------------------------------------------ */

const BD18_NOTE =
  'These are the evaluation factors DLA ADDS to our total when it ranks us against competitors. ' +
  'They are not part of the price we send and they are not a cost we pay. The recommendation ' +
  'above is a QUOTED number. Typing an evaluated figure into a quote overprices every offer and ' +
  'loses exactly the low value lines where the factor already dominates.'

function buildQuotedTotal(
  figure: RecommendedFigure,
  quantity: number | null,
): QuotedTotalUsd | QuotedTotalRangeUsd | null {
  if (quantity === null || !(quantity > 0)) return null
  if (figure.kind === 'POINT') {
    return {
      kind: 'QUOTED_TOTAL_WHAT_WE_SEND',
      usd: centsToUsd(usdToCents(figure.unitPriceUsd) * quantity),
    }
  }
  return {
    kind: 'QUOTED_TOTAL_RANGE_WHAT_WE_SEND',
    lowUsd: centsToUsd(usdToCents(figure.lowUnitPriceUsd) * quantity),
    highUsd: centsToUsd(usdToCents(figure.highUnitPriceUsd) * quantity),
  }
}

function buildEvaluatedContext(
  figure: RecommendedFigure,
  input: RecommendationInput,
  config: PricingConfig,
): EvaluatedPriceContext {
  const quantity = input.requirementQuantity
  if (quantity === null || !(quantity > 0)) {
    return {
      available: false,
      reason: 'REQUIREMENT_QUANTITY_ABSENT',
      missingInput: 'the quantity on the live requirement',
      note:
        'The evaluation factors are flat amounts on the TOTAL, not per unit, so their weight ' +
        `depends entirely on the quantity. ${BD18_NOTE}`,
    }
  }
  const d = input.declarations ?? {}
  const surplusOffer = d.offeringUnusedFormerGovernmentSurplus
  if (surplusOffer === undefined || surplusOffer === null) {
    return {
      available: false,
      reason: 'SURPLUS_OFFER_STATUS_UNDECLARED',
      missingInput:
        'whether the material we would offer is unused former Government surplus (a $200 ' +
        'evaluation factor)',
      note:
        'Treating the silence as "no" would drop a factor the buyer will add anyway, which ' +
        `overstates our competitiveness on a price alone evaluation. ${BD18_NOTE}`,
    }
  }
  const esaCount = d.esaCoordinationCount
  if (esaCount === undefined || esaCount === null) {
    return {
      available: false,
      reason: 'ESA_COORDINATION_COUNT_UNDECLARED',
      missingInput: 'how many Engineering Support Activities must coordinate on this item',
      note: `Zero and unknown are different facts, and a silent zero understates by $600 each. ${BD18_NOTE}`,
    }
  }

  const applicability = {
    isUnusedFormerGovernmentSurplus: surplusOffer,
    esaCoordinationCount: esaCount,
    ...(d.buyAmericanOrBalanceOfPayments === true
      ? { buyAmericanOrBalanceOfPayments: true as const }
      : {}),
  }
  const at = (unitPriceUsd: number) =>
    evaluatedTotal(quotedTotal(unitPriceUsd, quantity), applicability, config, input.atInstantMs)

  const primary = at(figure.kind === 'POINT' ? figure.unitPriceUsd : figure.lowUnitPriceUsd)
  if (primary.kind === 'EVALUATED_TOTAL_ABSTENTION') {
    return {
      available: false,
      reason: 'ENGINE_ABSTAINED',
      missingInput: 'a dated evaluation factor covering the pricing instant',
      note: `${primary.detail} ${BD18_NOTE}`,
    }
  }
  const adders: EvaluatedAdderSummary[] = primary.adders.map((a) => ({
    code: a.code,
    unitAmountUsd: a.unitAmountUsd,
    appliedCount: a.appliedCount,
    subtotalUsd: a.subtotalUsd,
    citation: a.citation,
  }))
  const adderTotalUsd = adders.reduce((sum, a) => sum + a.subtotalUsd, 0)
  const isFloor = primary.kind === 'EVALUATED_FLOOR_AT_LEAST'
  const unpricedFactorCodes =
    primary.kind === 'EVALUATED_FLOOR_AT_LEAST' ? primary.unpricedFactors.map((f) => f.code) : []
  const figureUsd = (o: typeof primary): number =>
    o.kind === 'EVALUATED_FLOOR_AT_LEAST' ? o.atLeastUsd : o.evaluatedTotalUsd

  if (figure.kind === 'POINT') {
    return {
      available: true,
      adders,
      adderTotalUsd,
      evaluatedAtRecommendation: {
        kind: 'EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND',
        usd: figureUsd(primary),
      },
      isFloor,
      unpricedFactorCodes,
      note: BD18_NOTE,
    }
  }
  const high = at(figure.highUnitPriceUsd)
  if (high.kind === 'EVALUATED_TOTAL_ABSTENTION') {
    return {
      available: false,
      reason: 'ENGINE_ABSTAINED',
      missingInput: 'a dated evaluation factor covering the pricing instant',
      note: `${high.detail} ${BD18_NOTE}`,
    }
  }
  return {
    available: true,
    adders,
    adderTotalUsd,
    evaluatedAtRecommendation: {
      kind: 'EVALUATED_TOTAL_RANGE_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND',
      lowUsd: figureUsd(primary),
      highUsd: figureUsd(high),
    },
    isFloor,
    unpricedFactorCodes,
    note: BD18_NOTE,
  }
}

/* ------------------------------------------------------------------------------------ */
/* DLAD 17.7505 CONTEXT ON THE RECOMMENDATION ITSELF                                      */
/* ------------------------------------------------------------------------------------ */

/**
 * A multiple of the last award price can be entirely lawful and still cost a week.
 *
 * Crossing the DLAD 17.7505 band does NOT cap the price and does NOT make the award illegal. It
 * forces an email to the Head of the Contracting Activity and turns an automated award into one
 * carrying senior attention, delay and paperwork. Since the headline rung here is a 3x rule, the
 * operator should be told when their own rule trips that wire, at the moment they read the number
 * rather than after they have sent it.
 */
function buildPriceIncreaseContext(
  figure: RecommendedFigure,
  pool: PoolBuild,
  input: RecommendationInput,
  config: PricingConfig,
): PriceIncreaseContext {
  const last = pool.kept.at(-1)
  if (last === undefined) {
    return { assessed: false, reason: 'No readable prior award price to measure an increase from.' }
  }
  const quantity = input.requirementQuantity
  if (quantity === null || !(quantity > 0)) {
    return {
      assessed: false,
      reason:
        'Which band applies depends on whether the procurement sits under the micro-purchase ' +
        'threshold, and that is unit price times quantity. The requirement quantity is unread.',
    }
  }
  const proposed = figure.kind === 'POINT' ? figure.unitPriceUsd : figure.highUnitPriceUsd
  const outcome = tripwireBand(
    {
      proposedUnitPriceUsd: proposed,
      mostRecentPriorUnitPriceUsd: last.unitPriceUsd,
      mostRecentPriorPriceInstantMs: last.awardDateMs,
      atInstantMs: input.atInstantMs,
      procurementValueUsd: proposed * quantity,
    },
    config,
  )
  if (!outcome.assessed) return { assessed: false, reason: outcome.detail }
  return {
    assessed: true,
    measuredAgainstUnitPriceUsd: last.unitPriceUsd,
    measuredAgainstAwardDateIso: last.awardDateIso,
    impliedIncreasePercent: outcome.impliedIncreasePercent,
    impliedMultipleOfPrior: outcome.impliedMultipleOfPrior,
    band: outcome.band,
    crossed: outcome.crossed,
    consequence: outcome.consequence.operationalMeaning,
    citation: outcome.bandCitation,
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE BUILDER                                                                            */
/* ------------------------------------------------------------------------------------ */

function toQuoteViewInput(input: RecommendationInput): QuoteViewInput {
  return {
    nsn: input.nsn,
    awards: input.awards,
    approvedSourceCages: input.approvedSourceCages,
    solicitationQuantity: input.requirementQuantity,
    solicitation: null,
    automatedSolicitation: null,
    atInstantMs: input.atInstantMs,
    feedWindow: input.feedWindow ?? { firstAwardIso: null, lastAwardIso: null },
  }
}

/**
 * THE ONE ENTRY POINT. Pure, deterministic, and every number it returns is arithmetic over values
 * it names.
 */
export function recommendPrice(input: RecommendationInput): PriceRecommendation {
  const config = input.config ?? RECOMMENDATION_CONFIG
  const indices = input.indices ?? INDEX_CONFIG_1650
  const pricingConfig = input.pricingConfig ?? PRICING_CONFIG
  const stance = input.surplusStance ?? 'UNDECLARED'
  const fsc = input.fsc ?? fscOf(input.nsn)
  const driftPerYear = driftHalfWidthPerYear(indices)

  const pool = buildComparablePool(input.awards, input.atInstantMs, stance, input.classifyAwardee)
  const oem = identifyOemAward(toQuoteViewInput(input))

  /*
   * EVERY RUNG IS COMPUTED, not just the winning one. Three reasons, and none of them is
   * completeness for its own sake: the operator sees what the alternatives were and why this one
   * won, a weaker band can be floored at a stronger rung's COMPUTED width on this same row, and
   * the ladder becomes the row's own roadmap of what evidence would sharpen it.
   */
  const attempts: readonly RungAttempt[] = [
    buildAnchorRung(input, oem, indices),
    buildLastAwardRung(input, pool, config),
    buildRecentBandRung(input, pool, config),
    buildTrendRung(input, pool, config),
    buildPeerRung(input, fsc, config),
  ]

  const ladder: RungOutcome[] = []
  let floorFrom: { readonly rung: RecommendationRung; readonly widthRatio: number } | null = null
  let winner: { readonly widened: WidenedRung; readonly outcome: ResolvedRungOutcome } | null =
    null

  for (const attempt of attempts) {
    if (!isBasis(attempt)) {
      ladder.push({
        rung: attempt.rung,
        rungLabel: rungLabelFor(attempt.rung, config),
        resolved: false,
        reason: attempt.reason,
        missingInput: attempt.missingInput,
        sentence: attempt.sentence,
      })
      continue
    }
    const widened = widenBasis(attempt, driftPerYear, floorFrom)
    const caveats: RecommendationCaveat[] = [
      ...attempt.caveats,
      ...(widened.ageCaveat === null ? [] : [widened.ageCaveat]),
      ...(widened.floorCaveat === null ? [] : [widened.floorCaveat]),
    ]
    const outcome: ResolvedRungOutcome = {
      rung: attempt.rung,
      rungLabel: rungLabelFor(attempt.rung, config),
      resolved: true,
      recommended: widened.recommended,
      basisUnitPriceUsd: attempt.basisUnitPriceUsd,
      widthRatio: widened.widthRatio,
      widthRatioBeforeFloor: widened.widthRatioBeforeFloor,
      widenedToMatch: widened.widenedToMatch,
      evidenceState: attempt.evidenceState,
      inputs: attempt.inputs,
      arithmetic: attempt.arithmetic,
      wouldSharpenWith: attempt.wouldSharpenWith,
      caveats,
      observationCount: attempt.observationCount,
      oldestObservationIso: attempt.oldestObservationIso,
      newestObservationIso: attempt.newestObservationIso,
    }
    ladder.push(outcome)
    floorFrom = { rung: attempt.rung, widthRatio: widened.widthRatio }
    if (winner === null) winner = { widened, outcome }
  }

  if (winner === null) {
    const anyAwards = input.awards.length > 0
    const peerRung = ladder.find((r) => r.rung === 'R5_FSC_PEER_BAND')
    const belowFloor =
      peerRung !== undefined &&
      peerRung.resolved === false &&
      peerRung.reason === 'PEER_GROUP_BELOW_THE_FLOOR'
    const reason: RecommendationAbstentionReason = belowFloor
      ? 'PEER_GROUP_BELOW_THE_FLOOR'
      : anyAwards
        ? 'AWARD_HISTORY_UNREADABLE_AND_NO_PRICED_PEERS'
        : 'NO_AWARD_HISTORY_AND_NO_PRICED_PEERS'
    const missingInput = belowFloor
      ? `${config.peerFloorCount} priced peers in supply class ${fsc ?? 'unknown'}, or any ` +
        'readable award on this stock number'
      : 'any award on this stock number whose row agrees with itself on the unit price, or ' +
        `${config.peerFloorCount} priced peers in its supply class`
    return {
      resolved: false,
      nsn: input.nsn,
      fsc,
      atInstantMs: input.atInstantMs,
      reason,
      missingInput,
      sentence:
        'No rung on the basis ladder can carry a figure for this stock number. ' +
        ladder
          .filter((r): r is Extract<RungOutcome, { resolved: false }> => r.resolved === false)
          .map((r) => `${r.rung}: ${r.sentence}`)
          .join(' ') +
        ' This is an abstention and not a zero, and the line above says exactly what it needs.',
      ladder,
    }
  }

  const figure = winner.widened.recommended
  const quoted = buildQuotedTotal(figure, input.requirementQuantity)
  const evaluatedContext = buildEvaluatedContext(figure, input, pricingConfig)
  const priceIncrease = buildPriceIncreaseContext(figure, pool, input, pricingConfig)

  const caveats: RecommendationCaveat[] = [
    ...winner.outcome.caveats,
    ...(priceIncrease.assessed && priceIncrease.crossed
      ? [
          {
            code: 'RECOMMENDATION_CROSSES_THE_DLAD_PRICE_INCREASE_BAND' as const,
            sentence:
              `This figure is ${priceIncrease.impliedMultipleOfPrior.toFixed(2)}x the most recent ` +
              `prior award of ${money(priceIncrease.measuredAgainstUnitPriceUsd)} on ` +
              `${priceIncrease.measuredAgainstAwardDateIso}, an increase of ` +
              `${priceIncrease.impliedIncreasePercent.toFixed(1)}%, which crosses the DLAD ` +
              '17.7505 band. That does NOT cap the price and does NOT make the award illegal: it ' +
              'forces an email to the Head of the Contracting Activity, so the buy stops being ' +
              'automatic. Price the delay into the decision, not into the quote.',
            measured: {
              label: 'implied increase',
              value: priceIncrease.impliedIncreasePercent,
              unit: 'PERCENT' as const,
            },
          },
        ]
      : []),
  ]

  const figureText =
    figure.kind === 'POINT'
      ? `${money(figure.unitPriceUsd)} a unit`
      : `between ${money(figure.lowUnitPriceUsd)} and ${money(figure.highUnitPriceUsd)} a unit`

  const peerCountClause =
    winner.outcome.rung === 'R5_FSC_PEER_BAND'
      ? `, from ${winner.outcome.observationCount} priced peers in this supply class, the ` +
        'weakest basis we hold'
      : ''

  return {
    resolved: true,
    nsn: input.nsn,
    fsc,
    atInstantMs: input.atInstantMs,
    rung: winner.outcome.rung,
    rungLabel: winner.outcome.rungLabel,
    awardMultiple: config.awardMultiple,
    recommended: figure,
    basisUnitPriceUsd: winner.outcome.basisUnitPriceUsd,
    widthRatio: winner.widened.widthRatio,
    evidenceState: winner.outcome.evidenceState,
    inputs: winner.outcome.inputs,
    arithmetic: winner.outcome.arithmetic,
    wouldSharpenWith: winner.outcome.wouldSharpenWith,
    caveats,
    requirementQuantity: input.requirementQuantity,
    quotedTotal: quoted,
    evaluatedPriceContext: evaluatedContext,
    priceIncreaseContext: priceIncrease,
    ladder,
    sentence:
      `Quote ${figureText}${peerCountClause}, on ${winner.outcome.rungLabel}. ` +
      `${winner.outcome.arithmetic}. This is a QUOTED unit price: the evaluation factors are the ` +
      'buyer’s arithmetic and are never added to what we send.',
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE BD-18 RUNTIME GUARD                                                                */
/* ------------------------------------------------------------------------------------ */


/**
 * Throws when an evaluation factor has leaked into the QUOTED side of the recommendation.
 *
 * BD-18 in executable form. The failure this catches is specific and expensive: the quoted total
 * silently carrying the buyer's $200 or $600, so the operator types a figure up to $600 too high
 * into DIBBS and loses an award they had won. The type system stops `quoted + evaluated` from
 * compiling; this stops the same value arriving by any other route.
 *
 * IT IS WRITTEN NOT TO CRY WOLF. It runs only when an adder actually applies, it compares the
 * quoted total against the exact forbidden sums, and it ignores the evaluated context itself,
 * where those numbers are correct and expected. A guard that fires on a correct payload gets
 * deleted within a week.
 */
export function assertRecommendationCarriesNoEvaluationFactor(
  recommendation: PriceRecommendation,
): void {
  if (recommendation.resolved !== true) return
  const quoted = recommendation.quotedTotal
  const quantity = recommendation.requirementQuantity
  if (quoted === null || quantity === null || !(quantity > 0)) return

  const ctx = recommendation.evaluatedPriceContext
  const adderTotalUsd = ctx.available === true ? ctx.adderTotalUsd : 0
  const figure = recommendation.recommended

  /*
   * RECOMPUTED FROM THE UNIT PRICE, NEVER FROM THE FIELD UNDER AUDIT. The first version of this
   * guard derived the forbidden value as `quotedTotal + adders`, which cannot catch the actual
   * defect: once the quoted total has already become the evaluated one, quoted + adders is a
   * different number again and the check passes on the corrupted payload. A control that reads
   * its own subject as its reference measures nothing.
   */
  const expected =
    figure.kind === 'POINT'
      ? [centsToUsd(usdToCents(figure.unitPriceUsd) * quantity)]
      : [
          centsToUsd(usdToCents(figure.lowUnitPriceUsd) * quantity),
          centsToUsd(usdToCents(figure.highUnitPriceUsd) * quantity),
        ]
  const reported =
    quoted.kind === 'QUOTED_TOTAL_WHAT_WE_SEND' ? [quoted.usd] : [quoted.lowUsd, quoted.highUsd]

  if (reported.length !== expected.length) {
    throw new Error(
      `The recommendation is a ${figure.kind} and its quoted total carries ` +
        `${reported.length} figure(s). A point quotes one total and a band quotes two.`,
    )
  }
  for (const [i, want] of expected.entries()) {
    const got = reported[i] as number
    if (Math.abs(got - want) < 0.005) continue
    const carriesTheAdders = adderTotalUsd > 0 && Math.abs(got - (want + adderTotalUsd)) < 0.005
    throw new Error(
      carriesTheAdders
        ? `The quoted total reads ${got}, which is the quote of ${want} plus the ` +
          `${adderTotalUsd} of evaluation factors. Those factors are the buyer's arithmetic, ` +
          'added by DLA when it ranks us. They are never part of what we send, and quoting ' +
          'them loses the award.'
        : `The quoted total reads ${got} where the recommended unit price over a quantity of ` +
          `${quantity} is ${want}. The quote and the figure above it have drifted apart.`,
    )
  }
}
