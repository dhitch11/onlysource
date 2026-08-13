/**
 * GATES R3.5 (score determinism) and R3.7 (the flipped sign fixture), plus the v0 card itself.
 *
 * THE INSTRUMENT IS BUILT TO BE ABLE TO FAIL. Every point total below is added up by hand in a
 * comment and written out as a literal. Nothing is re-derived by calling the code under test, so
 * a scorer that mis-bands a value, drops a feature, or quietly changes a weight fails these
 * assertions instead of agreeing with itself.
 *
 * The two worked rows come from the corpus and nowhere else:
 *   NSN 4730-00-536-2210, the quote-decision fixture, hand annotated by the expert, at
 *   `/Users/user/Downloads/Notes on 4730-00-536-2210 1-8-26.docx`. Every feature value in
 *   `WAYNE_4730` is quoted in the comment beside it. Where the document is silent the value is
 *   `null`, because inventing one is the failure this whole product exists to avoid.
 *
 * NEGATIVE CONTROLS are included on purpose: a flipped direction word, a bare digit in a
 * sentence, a mis-declared point total, an out-of-domain enum token and a hash that must change.
 * A check that cannot fail proves nothing about the check.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  SCORECARD_V0,
  ScorecardCardError,
  auditCardSentences,
  buildCounterfactual,
  buildPrincipalReasons,
  canonicalInputVector,
  checkSignAgreement,
  evaluateScorecard,
  inputVectorSha256,
  loadScorecard,
  maxPointsFor,
  scoreOpportunity,
  type FeatureObservations,
  type Scorecard,
} from '@/lib/engine/scorecard'
import rawV0 from '@/lib/engine/scorecard/versions/v0.json'

const AS_OF = '2026-08-13'
const card = SCORECARD_V0

const score = (obs: FeatureObservations) => scoreOpportunity(card, obs, AS_OF)

/* ------------------------------------------------------------------------------------------ *
 * THE CARD IS WHAT THIS TEST THINKS IT IS.
 * Every literal here is copied from `versions/v0.json` by hand. If a reviewer changes a weight
 * without changing this table, the arithmetic tests below would still pass against the new card
 * and would silently stop testing anything. This table is what stops that.
 * ------------------------------------------------------------------------------------------ */
describe('the v0 card, as a reviewed artifact', () => {
  it('carries the thirteen features and the exact maximum each can contribute', () => {
    const declared: ReadonlyArray<readonly [string, number]> = [
      ['recent_surplus_award_run', 12],
      ['oem_qty_ratio_log10', 10],
      ['offers_on_prior_solicitation', 12],
      ['scarcity_gradient', 10],
      ['last_supplier_class', 8],
      ['depot_stock_zero_years', 10],
      ['award_count_last_5y', 7],
      ['prior_awardee_mortality', 5],
      ['contracting_office_single_offer_rate', 4],
      ['platform_longevity_proxy', 6],
      ['non_stocked_flag', 6],
      ['incumbent_activity_decline', 6],
      ['stock_in_hand_or_affiliate', 4],
    ]
    expect(card.features.length).toBe(13)
    expect(card.features.map((f) => f.key)).toEqual(declared.map(([key]) => key))
    for (const [key, points] of declared) {
      const feature = card.features.find((f) => f.key === key)
      expect(feature).toBeDefined()
      expect(maxPointsFor(feature!)).toBe(points)
    }
    // 12+10+12+10+8+10+7+5+4+6+6+6+4 = 100, added by hand.
    expect(declared.reduce((sum, [, points]) => sum + points, 0)).toBe(100)
    expect(card.max_positive_points).toBe(100)
    expect(card.threshold.flag_at_or_above).toBe(50)
  })

  it('states on its face that the weights are a PRIOR and not a measurement', () => {
    expect(card.epistemic_status.weights_are).toBe('PRIOR')
    expect(card.epistemic_status.grade).toBe('ESTIMATED')
    expect(card.epistemic_status.statement).toContain('not a measurement')
    expect(card.epistemic_status.refit_precondition.length).toBeGreaterThan(0)
    // A version with no author, date, rationale or diff makes every historical score unreadable.
    expect(card.author.length).toBeGreaterThan(0)
    expect(card.reviewed_on).toBe('2026-08-13')
    expect(card.rationale.length).toBeGreaterThan(0)
    expect(card.previous_version).toBeNull()
    expect(card.diff_from_previous).toBeNull()
  })

  it('keeps the coverage floor low enough that it can never suppress a row that would flag on core evidence alone', () => {
    // The four heaviest CORE features are 12 (surplus run), 12 (offers), 10 (oem ratio) and
    // 10 (scarcity). 12+12+10+10 = 44, which is below the threshold of 50. So a row observed at
    // exactly the coverage floor cannot have reached the threshold on those four alone.
    expect(card.coverage.min_core_features_observed).toBe(4)
    const coreMaxima = card.coverage.core_features
      .map((key) => maxPointsFor(card.features.find((f) => f.key === key)!))
      .sort((a, b) => b - a)
    expect(coreMaxima.slice(0, 4)).toEqual([12, 12, 10, 10])
    expect(44).toBeLessThan(card.threshold.flag_at_or_above)
  })

  it('records the cues the expert acted on that v0 deliberately does not score', () => {
    const cues = card.cues_present_not_cited.map((c) => c.cue)
    expect(cues).toContain('demand_gap_as_maintenance_tell')
    expect(cues).toContain('price_jump_on_falling_volume')
    expect(cues).toContain('lead_time_urgency')
    expect(cues).toContain('management_price_as_market_read')
    for (const cue of card.cues_present_not_cited) {
      expect(card.expert_spans.spans[cue.expert_span_ref]).toBeDefined()
      expect(cue.why.length).toBeGreaterThan(0)
    }
  })

  it('keeps price discovery, supersession and the eligibility gate OUT of the score', () => {
    const excluded = card.excluded_by_design.map((e) => e.feature)
    expect(excluded).toContain('observed_losing_bid')
    expect(excluded).toContain('management_price')
    expect(excluded).toContain('latest_award_cancelled')
    expect(excluded).toContain('forecast_application')
    expect(excluded).toContain('first_article_test_required')
    // No feature on the card may be one of the excluded ones.
    for (const key of card.features.map((f) => f.key)) {
      expect(excluded).not.toContain(key)
    }
  })

  it('labels the inferred demand feature as inferred and never as a forecast', () => {
    const inferred = card.features.find((f) => f.key === 'award_count_last_5y')!
    expect(inferred.signal_class).toBe('inferred_demand')
    expect(inferred.labels.join(' ')).toContain('INFERRED FROM AWARD HISTORY')
    expect(inferred.labels.join(' ')).toContain('not a forecast')
    const proxy = card.features.find((f) => f.key === 'platform_longevity_proxy')!
    expect(proxy.labels.join(' ')).toContain('PROXY')
    expect(proxy.labels.join(' ')).toContain('never the forecast')
  })

  it('reads the OEM small lot signal as competition and monopoly, never as a price input', () => {
    const qty = card.features.find((f) => f.key === 'oem_qty_ratio_log10')!
    expect(qty.signal_class).toBe('competition_and_monopoly')
    expect(qty.never_price_input).toBe(true)
    expect(qty.labels.join(' ')).toContain('never a price input')
  })
})

/* ------------------------------------------------------------------------------------------ *
 * THE WORKED ROW. NSN 4730-00-536-2210, scored from the expert's own written findings.
 * ------------------------------------------------------------------------------------------ */
const WAYNE_4730: FeatureObservations = {
  // "Last order was to a manufacturer", so the most recent award did not go to a surplus dealer.
  recent_surplus_award_run: 0,
  // The document does not state the manufacturer award quantity. It stays unobserved.
  oem_qty_ratio_log10: null,
  // "Only one other company bid on the last solicitation", read as the awardee plus that bidder.
  offers_on_prior_solicitation: 2,
  // "Very few available on NSN now, lots on EFF"
  scarcity_gradient: 'few_primary_many_secondary',
  // "Last order was to a manufacturer"
  last_supplier_class: 'manufacturer',
  // "0 stock since 2009", read against the 2025 the same note refers to.
  depot_stock_zero_years: 16,
  // "The last order was in 2017 and before that it was 2004", so none in the last five years.
  award_count_last_5y: 0,
  // Not stated in the document.
  prior_awardee_mortality: null,
  // Not stated in the document.
  contracting_office_single_offer_rate: null,
  // "They go on good planes F16 and F14"
  platform_longevity_proxy: 'active_fleet',
  // "Listed as non stocked"
  non_stocked_flag: true,
  // "doing considerably less work in 2025 than in past years maybe 80 to 90% less"
  incumbent_activity_decline: 'confirmed_major_decline',
  // "Western air has five pieces"
  stock_in_hand_or_affiliate: true,
}

describe('R3 the worked row, added up by hand', () => {
  it('scores exactly 50, and every band that produced it is the one written here', () => {
    const result = score(WAYNE_4730)
    const points = Object.fromEntries(result.contributions.map((c) => [c.feature, c.points]))

    // recent_surplus_award_run 0            ->  0   (no_run)
    // oem_qty_ratio_log10      unobserved   ->  0
    // offers_on_prior_solicitation 2        ->  8   (thin)
    // scarcity_gradient  few_primary...     -> 10   (cornerable)
    // last_supplier_class 'manufacturer'    ->  0   (last_supplier_other)
    // depot_stock_zero_years 16             -> 10   (zero_long_span)
    // award_count_last_5y 0                 ->  0   (none)
    // prior_awardee_mortality  unobserved   ->  0
    // contracting_office...    unobserved   ->  0
    // platform_longevity_proxy active_fleet ->  6   (platform_active)
    // non_stocked_flag true                 ->  6   (non_stocked)
    // incumbent_activity_decline confirmed  ->  6   (incumbent_declining)
    // stock_in_hand_or_affiliate true       ->  4   (held)
    //                             8 + 10 + 10 + 6 + 6 + 6 + 4 = 50
    expect(points['recent_surplus_award_run']).toBe(0)
    expect(points['oem_qty_ratio_log10']).toBe(0)
    expect(points['offers_on_prior_solicitation']).toBe(8)
    expect(points['scarcity_gradient']).toBe(10)
    expect(points['last_supplier_class']).toBe(0)
    expect(points['depot_stock_zero_years']).toBe(10)
    expect(points['award_count_last_5y']).toBe(0)
    expect(points['prior_awardee_mortality']).toBe(0)
    expect(points['contracting_office_single_offer_rate']).toBe(0)
    expect(points['platform_longevity_proxy']).toBe(6)
    expect(points['non_stocked_flag']).toBe(6)
    expect(points['incumbent_activity_decline']).toBe(6)
    expect(points['stock_in_hand_or_affiliate']).toBe(4)
    expect(result.raw_points).toBe(50)
    expect(result.score).toBe(50)
  })

  it('flags it, because 50 is at the threshold of 50 and six of the seven core features were seen', () => {
    const result = score(WAYNE_4730)
    expect(result.observed_core_count).toBe(6)
    expect(result.disposition).toBe('flag')
    expect(result.abstention_ground).toBeNull()
    expect(result.disposition_sentence).toContain('flagged')
  })

  it('names exactly the three fields the document never stated, and what would resolve each', () => {
    const result = score(WAYNE_4730)
    expect(result.data_gaps.map((g) => g.field)).toEqual([
      'oem_qty_ratio_log10',
      'prior_awardee_mortality',
      'contracting_office_single_offer_rate',
    ])
    for (const gap of result.data_gaps) {
      expect(gap.what_would_resolve_it.length).toBeGreaterThan(0)
    }
    // 10 (oem ratio) + 5 (mortality) + 4 (office) = 19 points were never on the table.
    expect(result.unobserved_upside).toBe(19)
  })

  it('surfaces three principal reasons, in points order, with the expert speaking in his own words', () => {
    const reasons = buildPrincipalReasons(card, score(WAYNE_4730))
    // Non zero contributions were 10, 10, 8, 6, 6, 6, 4. The two tens tie, and the card's own
    // feature order breaks it: scarcity_gradient sits ahead of depot_stock_zero_years.
    expect(reasons.map((r) => r.feature)).toEqual([
      'scarcity_gradient',
      'depot_stock_zero_years',
      'offers_on_prior_solicitation',
    ])
    expect(reasons.map((r) => r.points)).toEqual([10, 10, 8])
    expect(reasons[0]?.expert_span_ref).toBe('wayne.4730.scarcity_gradient')
    expect(reasons[0]?.expert_span?.quote).toContain(
      'Having control of all the available inventory is a great position to be in for controlling price',
    )
    expect(reasons[2]?.sentence).toContain('2 offers were received on the prior solicitation')
    expect(reasons[2]?.sentence).toContain('raises the score by 8 points')
  })

  it('answers what would have made it not flag, with the most actionable single change', () => {
    const result = score(WAYNE_4730)
    const cf = buildCounterfactual(card, result)
    // The score is 50 and the threshold is 50, so it must fall to 49: a gap of 1 point.
    expect(cf.direction).toBe('to_not_flag')
    expect(cf.gap_points).toBe(1)
    // Six observed features could each shed at least one point. All of them tie at one change,
    // so the card's actionability list decides, and buying or holding the shelf is rank one.
    expect(cf.combination).toBe(false)
    expect(cf.changes.length).toBe(1)
    expect(cf.changes[0]?.field).toBe('stock_in_hand_or_affiliate')
    expect(cf.changes[0]?.current_value).toBe(true)
    expect(cf.changes[0]?.flip_value).toBe(false)
    expect(cf.changes[0]?.points_delta).toBe(-4)
    // 50 - 4 = 46, which is below 50 but not a confident skip: 46 + 19 unobserved = 65, still
    // over the threshold, so the honest resulting verdict is an abstention.
    expect(cf.resulting_score).toBe(46)
    expect(cf.resulting_verdict).toBe('insufficient_data')
    expect(cf.flippable).toBe(true)
    expect(cf.sentence).toContain('fallen by 4 points to 46')
    expect(cf.sentence).toContain('threshold of 50')
  })
})

/* ------------------------------------------------------------------------------------------ *
 * REASONS ARE NEVER PADDED.
 * ------------------------------------------------------------------------------------------ */
describe('R3 principal reasons are never padded to three', () => {
  it('returns exactly two when only two features moved the number', () => {
    // scarcity 10 + non_stocked 6 = 16. Four core features observed, which meets the floor.
    const result = score({
      recent_surplus_award_run: 0,
      oem_qty_ratio_log10: 0,
      offers_on_prior_solicitation: 5,
      scarcity_gradient: 'few_primary_many_secondary',
      non_stocked_flag: true,
    })
    expect(result.score).toBe(16)
    expect(result.observed_core_count).toBe(4)
    const reasons = buildPrincipalReasons(card, result)
    expect(reasons.length).toBe(2)
    expect(reasons.map((r) => r.feature)).toEqual(['scarcity_gradient', 'non_stocked_flag'])
  })

  it('returns none at all when nothing moved the number', () => {
    expect(buildPrincipalReasons(card, score(DEAD_ROW)).length).toBe(0)
  })

  it('never returns more than the card allows, and orders ties by the card feature order', () => {
    const reasons = buildPrincipalReasons(card, score(BIG_FLAG))
    // Non zero contributions on that row are 12, 10, 12, 10, 10, 6, 4. The two twelves tie and
    // the card order puts recent_surplus_award_run (index 0) ahead of offers (index 2).
    expect(reasons.length).toBe(3)
    expect(reasons.map((r) => r.feature)).toEqual([
      'recent_surplus_award_run',
      'offers_on_prior_solicitation',
      'oem_qty_ratio_log10',
    ])
    expect(reasons.map((r) => r.points)).toEqual([12, 12, 10])
  })
})

/* ------------------------------------------------------------------------------------------ *
 * THE THIRD DISPOSITION. Two grounds, kept distinct.
 * ------------------------------------------------------------------------------------------ */
describe('R3 insufficient_data is a shippable answer and fires on two distinct grounds', () => {
  it('abstains on a HIGH scoring row when too few core features were observed', () => {
    // 12 (surplus run) + 12 (offers) + 10 (scarcity) + 5 (mortality) + 4 (office) + 6 (platform)
    // + 6 (non stocked) + 6 (decline) + 4 (stock) = 65, well over the threshold of 50.
    const result = score({
      recent_surplus_award_run: 3,
      offers_on_prior_solicitation: 1,
      scarcity_gradient: 'few_primary_many_secondary',
      prior_awardee_mortality: 0.6,
      contracting_office_single_offer_rate: 0.7,
      platform_longevity_proxy: 'active_fleet',
      non_stocked_flag: true,
      incumbent_activity_decline: 'confirmed_major_decline',
      stock_in_hand_or_affiliate: true,
    })
    expect(result.score).toBe(65)
    expect(result.observed_core_count).toBe(3)
    expect(result.disposition).toBe('insufficient_data')
    expect(result.abstention_ground).toBe('thin_core_coverage')
    expect(result.data_gaps.map((g) => g.field)).toEqual([
      'oem_qty_ratio_log10',
      'last_supplier_class',
      'depot_stock_zero_years',
      'award_count_last_5y',
    ])
    const cf = buildCounterfactual(card, result)
    expect(cf.direction).toBe('to_resolve_abstention')
    expect(cf.changes).toEqual([])
    expect(cf.flippable).toBe(false)
    expect(cf.combination).toBe(false)
    expect(cf.sentence).toContain('too few core features were observed')
    expect(cf.missing_fields).toEqual([
      'oem_qty_ratio_log10',
      'last_supplier_class',
      'depot_stock_zero_years',
      'award_count_last_5y',
    ])
  })

  it('abstains on a LOW scoring row when the unobserved features alone could carry it over', () => {
    // offers 2 -> 8. Everything else observed scores zero, and nine features are unobserved:
    // 8 + 10 + 7 + 5 + 4 + 6 + 6 + 6 + 4 = 56 of upside. 8 + 56 = 64, over the threshold.
    const result = score({
      recent_surplus_award_run: 0,
      oem_qty_ratio_log10: 0,
      offers_on_prior_solicitation: 2,
      scarcity_gradient: 'similar',
    })
    expect(result.score).toBe(8)
    expect(result.observed_core_count).toBe(4)
    expect(result.unobserved_upside).toBe(56)
    expect(result.disposition).toBe('insufficient_data')
    expect(result.abstention_ground).toBe('unobserved_could_cross')
    expect(result.disposition_sentence).toContain('could carry it over')
  })

  it('is not the same answer as a low score, and says which kind of blindness it is', () => {
    const abstained = score({
      recent_surplus_award_run: 0,
      oem_qty_ratio_log10: 0,
      offers_on_prior_solicitation: 2,
      scarcity_gradient: 'similar',
    })
    const skipped = score(DEAD_ROW)
    expect(skipped.disposition).toBe('skip')
    expect(skipped.abstention_ground).toBeNull()
    expect(abstained.disposition).not.toBe(skipped.disposition)
  })
})

/* ------------------------------------------------------------------------------------------ *
 * THE COUNTERFACTUAL, all four endings.
 * ------------------------------------------------------------------------------------------ */

// 12 (surplus run 3) + 8 (last supplier surplus dealer) + 10 (depot 16y) + 5 (mortality 0.6)
// + 6 (platform) + 6 (non stocked) + 6 (decline) = 53. Everything else observed at zero.
const NEAR_THRESHOLD: FeatureObservations = {
  recent_surplus_award_run: 3,
  oem_qty_ratio_log10: 0,
  offers_on_prior_solicitation: 5,
  scarcity_gradient: 'similar',
  last_supplier_class: 'surplus_dealer',
  depot_stock_zero_years: 16,
  award_count_last_5y: 0,
  prior_awardee_mortality: 0.6,
  contracting_office_single_offer_rate: 0.3,
  platform_longevity_proxy: 'active_fleet',
  non_stocked_flag: true,
  incumbent_activity_decline: 'confirmed_major_decline',
  stock_in_hand_or_affiliate: false,
}

// 12 (surplus run) + 10 (oem ratio 2.0) + 12 (offers 1) + 10 (scarcity) + 10 (depot) + 6
// (platform) + 4 (stock) = 64.
const BIG_FLAG: FeatureObservations = {
  recent_surplus_award_run: 3,
  oem_qty_ratio_log10: 2,
  offers_on_prior_solicitation: 1,
  scarcity_gradient: 'few_primary_many_secondary',
  last_supplier_class: 'unknown',
  depot_stock_zero_years: 16,
  award_count_last_5y: 0,
  prior_awardee_mortality: 0,
  contracting_office_single_offer_rate: 0.3,
  platform_longevity_proxy: 'active_fleet',
  non_stocked_flag: false,
  incumbent_activity_decline: 'none_observed',
  stock_in_hand_or_affiliate: true,
}

// Every feature observed, every one of them in its zero band. This is the ordinary requirement.
const DEAD_ROW: FeatureObservations = {
  recent_surplus_award_run: 0,
  oem_qty_ratio_log10: 0,
  offers_on_prior_solicitation: 5,
  scarcity_gradient: 'similar',
  last_supplier_class: 'unknown',
  depot_stock_zero_years: 0,
  award_count_last_5y: 0,
  prior_awardee_mortality: 0,
  contracting_office_single_offer_rate: 0.3,
  platform_longevity_proxy: 'unknown',
  non_stocked_flag: false,
  incumbent_activity_decline: 'none_observed',
  stock_in_hand_or_affiliate: false,
}

describe('R3 the counterfactual finds the minimal flip', () => {
  it('names the SMALLEST band change that still crosses, not the largest available', () => {
    const result = score(NEAR_THRESHOLD)
    expect(result.score).toBe(53)
    expect(result.disposition).toBe('flag')
    const cf = buildCounterfactual(card, result)
    // 53 must fall to 49, so the gap is 4 points. Ranked by actionability, the first four
    // entries (stock, scarcity, oem ratio, offers) all sit in their zero bands and can only go
    // up, so depot_stock_zero_years is the first candidate that can shed points. It offers minus
    // 5 (down to the one-to-four year band) and minus 10 (down to nothing). Minus 5 is enough
    // and is the smaller change, so it is the one named.
    expect(cf.gap_points).toBe(4)
    expect(cf.changes.length).toBe(1)
    expect(cf.changes[0]?.field).toBe('depot_stock_zero_years')
    expect(cf.changes[0]?.current_value).toBe(16)
    expect(cf.changes[0]?.flip_value).toBe(1)
    expect(cf.changes[0]?.points_delta).toBe(-5)
    expect(cf.resulting_score).toBe(48)
    expect(cf.resulting_verdict).toBe('skip')
    expect(cf.flippable).toBe(true)
    expect(cf.combination).toBe(false)
    expect(cf.minimum_features_required).toBe(1)
  })

  it('proves it can fail: the largest change on that row would have been minus 20, not minus 5', () => {
    // last_supplier_class sits at surplus_dealer (+8) and could fall to oem (-12), a swing of 20.
    // A search that took the biggest hammer would have named that. It names depot minus 5.
    const cf = buildCounterfactual(card, score(NEAR_THRESHOLD))
    expect(cf.changes[0]?.field).not.toBe('last_supplier_class')
    expect(Math.abs(cf.changes[0]?.points_delta ?? 0)).toBeLessThan(20)
  })

  it('names the smallest COMBINATION when no single feature closes the gap, and says it is one', () => {
    const result = score(BIG_FLAG)
    expect(result.score).toBe(64)
    expect(result.disposition).toBe('flag')
    const cf = buildCounterfactual(card, result)
    // 64 must fall to 49, a gap of 15. The largest single drop available on this row is 12
    // (offers 1 to 3, or the surplus run to nothing, or the last supplier to the manufacturer),
    // so no single feature closes it. Two do: taking the candidates in actionability order,
    // stock (minus 4) with scarcity (minus 10) is only 14, stock with the oem ratio is 14, and
    // stock with offers is 16, which is the first pair that closes the gap.
    expect(cf.gap_points).toBe(15)
    expect(cf.combination).toBe(true)
    expect(cf.minimum_features_required).toBe(2)
    expect(cf.changes.map((c) => c.field)).toEqual([
      'stock_in_hand_or_affiliate',
      'offers_on_prior_solicitation',
    ])
    expect(cf.changes.map((c) => c.points_delta)).toEqual([-4, -12])
    // Every member of a combination reports a null verdict of its own, because neither one alone
    // produces one.
    expect(cf.changes.map((c) => c.resulting_verdict)).toEqual([null, null])
    expect(cf.resulting_score).toBe(48)
    expect(cf.resulting_verdict).toBe('skip')
    expect(cf.flippable).toBe(true)
    expect(cf.sentence).toContain('No single feature closes the 15 point gap')
    expect(cf.sentence).toContain('That is a combination, not a single change.')
  })

  it('says plainly when nothing realistic flips it, rather than inventing an answer', () => {
    const result = score(DEAD_ROW)
    expect(result.score).toBe(0)
    expect(result.disposition).toBe('skip')
    const cf = buildCounterfactual(card, result)
    // To flag, this row must gain 50. The four largest gains available are 12, 12, 10 and 10,
    // which is 44 and not enough. The fifth adds another 10 for 54. Five simultaneous changes is
    // more than the card treats as realistic, which is three.
    expect(cf.direction).toBe('to_flag')
    expect(cf.gap_points).toBe(50)
    expect(cf.minimum_features_required).toBe(5)
    expect(card.counterfactual.realistic_combination_max_features).toBe(3)
    expect(cf.flippable).toBe(false)
    expect(cf.combination).toBe(false)
    expect(cf.changes).toEqual([])
    expect(cf.sentence).toContain('at least 5 features changing at once')
    expect(cf.sentence).toContain('nothing realistic flips this row')
  })

  it('says when NO combination at all closes the gap, on a card where that is reachable', () => {
    // On v0 this branch is unreachable, and provably so: the most any row can gain is 100 minus
    // its score, while the gap is only 50 minus its score, so the available gain always exceeds
    // the gap. The branch is exercised on a card whose points cannot reach its own threshold.
    const tiny = loadScorecard(testCard())
    const result = scoreOpportunity(tiny, { alpha: 5, beta: 0 }, AS_OF)
    expect(result.score).toBe(10)
    expect(result.disposition).toBe('skip')
    const cf = buildCounterfactual(tiny, result)
    // The gap is 40 and beta can contribute at most 10 more, so nothing closes it.
    expect(cf.gap_points).toBe(40)
    expect(cf.minimum_features_required).toBeNull()
    expect(cf.flippable).toBe(false)
    expect(cf.changes).toEqual([])
    expect(cf.sentence).toContain('closes the 40 point gap')
    expect(cf.sentence).toContain('nothing this card can see would change this disposition')
  })

  it('never proposes changing a field it never observed', () => {
    const cf = buildCounterfactual(card, score(WAYNE_4730))
    for (const change of cf.changes) {
      expect(cf.missing_fields).not.toContain(change.field)
    }
    expect(card.counterfactual.changes_only_observed_features).toBe(true)
  })
})

/* ------------------------------------------------------------------------------------------ *
 * R3.7 THE FLIPPED SIGN FIXTURE.
 * ------------------------------------------------------------------------------------------ */
describe('R3.7 a direction word that contradicts the sign fails, and the check is not vacuous', () => {
  it('passes every band sentence on the shipped card', () => {
    expect(auditCardSentences(card)).toEqual([])
  })

  it('accepts agreement and rejects each way of disagreeing', () => {
    expect(checkSignAgreement(card, { points: 12, sentence: 'It raises the score by 12 points.' }).ok).toBe(true)
    expect(checkSignAgreement(card, { points: -12, sentence: 'It lowers the score by 12 points.' }).ok).toBe(true)
    expect(checkSignAgreement(card, { points: 0, sentence: 'It contributes nothing.' }).ok).toBe(true)

    const positiveSaysLowers = checkSignAgreement(card, {
      points: 12,
      sentence: 'It lowers the score by 12 points.',
    })
    expect(positiveSaysLowers.ok).toBe(false)
    expect(positiveSaysLowers.problem).toContain('lowered while the contribution is positive')

    const negativeSaysRaises = checkSignAgreement(card, {
      points: -12,
      sentence: 'It raises the score by 12 points.',
    })
    expect(negativeSaysRaises.ok).toBe(false)
    expect(negativeSaysRaises.problem).toContain('raised while the contribution is negative')

    const silent = checkSignAgreement(card, { points: 12, sentence: 'It changes the score.' })
    expect(silent.ok).toBe(false)
    expect(silent.problem).toContain('states no direction')

    const bothWays = checkSignAgreement(card, {
      points: 12,
      sentence: 'It raises and lowers the score.',
    })
    expect(bothWays.ok).toBe(false)

    const zeroClaimsDirection = checkSignAgreement(card, {
      points: 0,
      sentence: 'It raises the score.',
    })
    expect(zeroClaimsDirection.ok).toBe(false)
    expect(zeroClaimsDirection.problem).toContain('contribution of zero')
  })

  it('catches a flipped word in a real card, and refuses to render a reason from it', () => {
    const flipped = structuredClone(rawV0) as typeof rawV0
    const feature = flipped.features.find((f) => f.key === 'scarcity_gradient')!
    const band = feature.bands.find((b) => b.id === 'cornerable')!
    band.sentence = band.sentence.replace('raises the score', 'lowers the score')
    const flippedCard: Scorecard = loadScorecard(flipped)

    // The card still LOADS, which is the point: the defect is in the prose, not the structure.
    expect(flippedCard.features.length).toBe(13)
    const problems = auditCardSentences(flippedCard)
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('scarcity_gradient.cornerable')
    expect(problems[0]).toContain('lowered while the contribution is positive')

    // And it never reaches a reader: building reasons from it throws rather than rendering.
    const result = scoreOpportunity(flippedCard, WAYNE_4730, AS_OF)
    expect(() => buildPrincipalReasons(flippedCard, result)).toThrow(/sign disagreement/)
  })
})

/* ------------------------------------------------------------------------------------------ *
 * R3.5 DETERMINISM.
 * ------------------------------------------------------------------------------------------ */
describe('R3.5 the same inputs and the same card version reproduce the same record', () => {
  it('produces a byte identical record on two independent runs', () => {
    const first = score(WAYNE_4730)
    const second = score(WAYNE_4730)
    expect(first.input_vector_sha256).toBe(second.input_vector_sha256)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first.input_vector_sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes the hash when one input changes, even when the score does not move', () => {
    const base = score(WAYNE_4730)
    // 16 years and 15 years land in the same band, so the score is unchanged. The INPUT is not,
    // and a replay that could not tell them apart could not prove it replayed the same row.
    const nudged = score({ ...WAYNE_4730, depot_stock_zero_years: 15 })
    expect(nudged.score).toBe(base.score)
    expect(nudged.input_vector_sha256).not.toBe(base.input_vector_sha256)
  })

  it('changes the hash when the card version changes', () => {
    const renamed = structuredClone(rawV0) as typeof rawV0
    renamed.version = 'v0-candidate'
    const other = loadScorecard(renamed)
    expect(inputVectorSha256(other, WAYNE_4730, AS_OF)).not.toBe(
      inputVectorSha256(card, WAYNE_4730, AS_OF),
    )
  })

  it('changes the hash when as_of changes, because features are read as of a date', () => {
    expect(inputVectorSha256(card, WAYNE_4730, '2026-08-14')).not.toBe(
      inputVectorSha256(card, WAYNE_4730, AS_OF),
    )
  })

  it('treats an omitted key and an explicit null as the same input', () => {
    const withNulls = score(WAYNE_4730)
    const withOmissions: FeatureObservations = { ...WAYNE_4730 }
    delete (withOmissions as Record<string, unknown>)['oem_qty_ratio_log10']
    delete (withOmissions as Record<string, unknown>)['prior_awardee_mortality']
    delete (withOmissions as Record<string, unknown>)['contracting_office_single_offer_rate']
    expect(score(withOmissions).input_vector_sha256).toBe(withNulls.input_vector_sha256)
  })

  it('does not depend on the order the caller built the object in', () => {
    const reversed: Record<string, unknown> = {}
    for (const key of Object.keys(WAYNE_4730).reverse()) reversed[key] = WAYNE_4730[key]
    expect(score(reversed as FeatureObservations).input_vector_sha256).toBe(
      score(WAYNE_4730).input_vector_sha256,
    )
  })

  it('serialises to exactly the bytes written out here, and hashes exactly those bytes', () => {
    // Hand written, from the card's own feature keys sorted lexicographically. The hash is taken
    // over this literal with node:crypto directly, so it never asks the module under test what
    // its own answer was.
    const tiny = loadScorecard(testCard())
    const expected = '{"as_of":"2026-08-13","features":{"alpha":3,"beta":null},"scorecard_version":"t"}'
    expect(canonicalInputVector(tiny, { alpha: 3 }, AS_OF)).toBe(expected)
    expect(inputVectorSha256(tiny, { alpha: 3 }, AS_OF)).toBe(
      createHash('sha256').update(expected, 'utf8').digest('hex'),
    )
  })

  it('sorts every feature key on the real card, so the serialisation is canonical', () => {
    const serialised = canonicalInputVector(card, WAYNE_4730, AS_OF)
    const parsed = JSON.parse(serialised) as { features: Record<string, unknown> }
    expect(Object.keys(parsed.features)).toEqual([
      'award_count_last_5y',
      'contracting_office_single_offer_rate',
      'depot_stock_zero_years',
      'incumbent_activity_decline',
      'last_supplier_class',
      'non_stocked_flag',
      'oem_qty_ratio_log10',
      'offers_on_prior_solicitation',
      'platform_longevity_proxy',
      'prior_awardee_mortality',
      'recent_surplus_award_run',
      'scarcity_gradient',
      'stock_in_hand_or_affiliate',
    ])
  })

  it('refuses to hash a value it cannot serialise deterministically', () => {
    expect(() => score({ ...WAYNE_4730, depot_stock_zero_years: Number.NaN })).toThrow()
  })
})

/* ------------------------------------------------------------------------------------------ *
 * THE CARD LOADER REFUSES A BROKEN CARD. Negative controls throughout.
 * ------------------------------------------------------------------------------------------ */
describe('a card that is wrong does not score at reduced fidelity, it throws', () => {
  it('rejects a mis-declared maximum, which is how a silent reweighting would arrive', () => {
    const broken = structuredClone(rawV0) as typeof rawV0
    const feature = broken.features.find((f) => f.key === 'scarcity_gradient')!
    const band = feature.bands.find((b) => b.id === 'cornerable')!
    band.points = 11
    expect(() => loadScorecard(broken)).toThrow(ScorecardCardError)
    expect(() => loadScorecard(broken)).toThrow(/max_positive_points/)
  })

  it('rejects a bare digit in a sentence, which no numeral firewall could trace to a field', () => {
    const broken = structuredClone(rawV0) as typeof rawV0
    const feature = broken.features.find((f) => f.key === 'non_stocked_flag')!
    const band = feature.bands.find((b) => b.id === 'non_stocked')!
    band.sentence = 'The item is listed non stocked on all 3 sources, which raises the score by {abs_points} points.'
    expect(() => loadScorecard(broken)).toThrow(/bare digit/)
  })

  it('rejects a band whose declared direction contradicts its own sign', () => {
    const broken = structuredClone(rawV0) as typeof rawV0
    const feature = broken.features.find((f) => f.key === 'last_supplier_class')!
    const band = feature.bands.find((b) => b.id === 'last_was_oem')!
    band.direction = 'raises'
    expect(() => loadScorecard(broken)).toThrow(/negative points with direction raises/)
  })

  it('rejects an actionability list that does not rank every feature, so no tie break is undefined', () => {
    const broken = structuredClone(rawV0) as typeof rawV0
    broken.counterfactual.actionability_rank = broken.counterfactual.actionability_rank.filter(
      (key) => key !== 'non_stocked_flag',
    )
    expect(() => loadScorecard(broken)).toThrow(/actionability_rank omits feature non_stocked_flag/)
  })

  it('rejects an expert span reference the card does not carry', () => {
    const broken = structuredClone(rawV0) as typeof rawV0
    const feature = broken.features.find((f) => f.key === 'scarcity_gradient')!
    feature.expert_span_ref = 'wayne.does.not.exist'
    expect(() => loadScorecard(broken)).toThrow(/does not carry/)
  })

  it('treats an enum token it does not know as an error, never as a zero', () => {
    expect(() => score({ ...WAYNE_4730, scarcity_gradient: 'sort_of_thin' })).toThrow(
      /not in its declared domain/,
    )
  })

  it('refuses a non integer where the card declares an integer', () => {
    expect(() => score({ ...WAYNE_4730, offers_on_prior_solicitation: 2.5 })).toThrow(/expects an integer/)
  })
})

/* ------------------------------------------------------------------------------------------ *
 * THE ASSEMBLED PAYLOAD.
 * ------------------------------------------------------------------------------------------ */
describe('the evaluation the consuming lanes receive', () => {
  it('carries every key on every call, with absence expressed explicitly', () => {
    const evaluation = evaluateScorecard(WAYNE_4730, AS_OF)
    expect(evaluation.scorecard_version).toBe('v0')
    expect(evaluation.as_of).toBe(AS_OF)
    expect(evaluation.score).toBe(50)
    expect(evaluation.disposition).toBe('flag')
    expect(evaluation.abstention_ground).toBeNull()
    expect(evaluation.principal_reasons.length).toBe(3)
    expect(evaluation.counterfactual.changes.length).toBe(1)
    expect(evaluation.data_gaps.length).toBe(3)
    expect(evaluation.weights_are_a_prior).toContain('PRIOR')
    expect(evaluation.input_vector_sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is reproducible end to end, which is what R3.5 actually asks for', () => {
    expect(JSON.stringify(evaluateScorecard(WAYNE_4730, AS_OF))).toBe(
      JSON.stringify(evaluateScorecard(WAYNE_4730, AS_OF)),
    )
  })
})

/* ------------------------------------------------------------------------------------------ *
 * THE PACKAGE STAYS A PURE LIBRARY. Checked here rather than trusted, because the day this
 * module imports a database client or reads the wall clock is the day a score stops being
 * reproducible, and nothing else in the suite would notice.
 * ------------------------------------------------------------------------------------------ */
describe('the scorecard package is framework free, clock free and reproducible by construction', () => {
  const files = [
    'lib/engine/scorecard/card.ts',
    'lib/engine/scorecard/score.ts',
    'lib/engine/scorecard/reasons.ts',
    'lib/engine/scorecard/counterfactual.ts',
    'lib/engine/scorecard/index.ts',
    'lib/engine/scorecard/versions/v0.json',
  ]
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')

  const ALLOWED_SPECIFIERS = new Set([
    'zod',
    'node:crypto',
    './card',
    './score',
    './reasons',
    './counterfactual',
    './versions/v0.json',
  ])

  it('imports nothing beyond node builtins, zod and its own files', () => {
    for (const rel of files.filter((f) => f.endsWith('.ts'))) {
      const specifiers = [...read(rel).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!)
      expect(specifiers.length).toBeGreaterThan(0)
      for (const spec of specifiers) {
        expect(ALLOWED_SPECIFIERS.has(spec), `${rel} imports ${spec}`).toBe(true)
      }
    }
  })

  it('never reads wall time, so every score can be replayed', () => {
    for (const rel of files.filter((f) => f.endsWith('.ts'))) {
      const src = read(rel)
      expect(/\bDate\.now\s*\(/.test(src), `${rel} calls Date.now()`).toBe(false)
      expect(/new\s+Date\s*\(\s*\)/.test(src), `${rel} calls new Date()`).toBe(false)
    }
  })

  it('produces no number from randomness or from a hash', () => {
    for (const rel of files) {
      const src = read(rel)
      expect(/Math\.random/.test(src), `${rel} calls Math.random`).toBe(false)
      expect(/charCodeAt/.test(src), `${rel} hashes characters into a value`).toBe(false)
    }
  })

  it('contains no em dash, in code, comment, string or card', () => {
    for (const rel of files) {
      // Matched by code point so this file does not have to contain the character it forbids.
      expect(read(rel).includes(String.fromCharCode(8212)), `${rel} contains an em dash`).toBe(false)
    }
  })

  it('PROVES THE SCANS FIRE: they reject a deliberately bad sample', () => {
    const bad = `import x from 'pg'\nconst t = Date.now()\nconst u = new Date()\nMath.random()\n// ${String.fromCharCode(8212)}`
    const specifiers = [...bad.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!)
    expect(specifiers).toEqual(['pg'])
    expect(ALLOWED_SPECIFIERS.has(specifiers[0]!)).toBe(false)
    expect(/\bDate\.now\s*\(/.test(bad)).toBe(true)
    expect(/new\s+Date\s*\(\s*\)/.test(bad)).toBe(true)
    expect(/Math\.random/.test(bad)).toBe(true)
    expect(bad.includes(String.fromCharCode(8212))).toBe(true)
  })
})

/**
 * A minimal, structurally valid card. It exists so the "nothing at all closes the gap" branch and
 * the canonical serialisation can be tested against something small enough to write out by hand.
 * It is a fixture, never shipped data.
 */
function testCard(): unknown {
  const band = (id: string, points: number, gte: number) => ({
    id,
    when: gte === 0 ? { op: 'always' } : { op: 'gte', value: gte },
    points,
    direction: points === 0 ? 'neutral' : 'raises',
    representative_value: gte,
    sentence: points === 0 ? `${id} contributes nothing.` : `${id} raises the score by {abs_points} points.`,
  })
  const feature = (key: string) => ({
    key,
    label: key,
    value_type: 'integer',
    signal_class: 'test',
    never_price_input: true,
    labels: [],
    resolves_with: 'a test fixture',
    provenance: { grade: 'ESTIMATED', source: 'test fixture', quote: 'test fixture' },
    expert_span_ref: null,
    bands: [band(`${key}_hi`, 10, 1), band(`${key}_lo`, 0, 0)],
  })
  return {
    schema_version: 1,
    version: 't',
    name: 'test card',
    author: 'test',
    reviewed_on: '2026-08-13',
    previous_version: null,
    diff_from_previous: null,
    rationale: 'test fixture',
    epistemic_status: {
      weights_are: 'PRIOR',
      grade: 'ESTIMATED',
      statement: 'test fixture',
      refit_precondition: 'test fixture',
      calibration_note: 'test fixture',
    },
    scale: { min: 0, max: 100, integer: true, direction: 'higher is stronger' },
    max_positive_points: 20,
    threshold: { flag_at_or_above: 50, rationale: 'test fixture' },
    coverage: {
      min_core_features_observed: 1,
      core_features: ['alpha'],
      rationale: 'test fixture',
      abstain_when_unobserved_could_cross: true,
      abstain_when_unobserved_could_cross_rationale: 'test fixture',
    },
    counterfactual: {
      tie_break: ['fewest_features_changed', 'most_actionable'],
      tie_break_statement: 'test fixture',
      realistic_combination_max_features: 3,
      realistic_combination_rationale: 'test fixture',
      changes_only_observed_features: true,
      changes_only_observed_features_rationale: 'test fixture',
      actionability_rank: ['alpha', 'beta'],
      actionability_rank_rationale: 'test fixture',
    },
    reasons: {
      max_principal_reasons: 3,
      never_pad: true,
      order: 'test fixture',
      order_rationale: 'test fixture',
      direction_lexicon: { raises: ['raises'], lowers: ['lowers'] },
      direction_lexicon_rationale: 'test fixture',
      sentence_placeholders: ['{value}', '{points}', '{abs_points}'],
      sentence_numeral_rule: 'test fixture',
    },
    excluded_by_design: [],
    cues_present_not_cited: [],
    expert_spans: { note: 'test fixture', spans: {} },
    features: [feature('alpha'), feature('beta')],
  }
}
