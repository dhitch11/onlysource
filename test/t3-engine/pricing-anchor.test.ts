/**
 * THE PRICING ENGINE, ASSERTED AGAINST HAND-COMPUTED LITERALS ONLY.
 *
 * EVERY expectation below is a number I worked out by hand and typed out. Not one of them is
 * re-derived by calling the code under test, because an expectation produced by the
 * implementation shares the implementation's bug and proves nothing.
 *
 * THE ARITHMETIC, WORKED LONGHAND SO A REVIEWER CAN CHECK IT WITHOUT RUNNING ANYTHING:
 *
 *   1537.85 x 1.3223
 *     = 153785 x 13223 / 10^6
 *     = 2,033,499,055 / 10^6
 *     = 2033.499055     ->  $2,033.50 to the cent
 *
 *   1537.85 x 1.40
 *     = 153785 x 14 / 10^3
 *     = 2,152,990 / 10^3
 *     = 2152.99 EXACTLY  ->  $2,152.99, no rounding involved at all
 *
 * THE TWO THINGS THIS FILE REFUSES TO DO, AND WHY:
 *
 *   (a) IT NEVER ASSERTS $2,150.00. The true product is $2,152.99. His text says
 *       "approximately $2,150", which is HIS rounding of it. An assertion of 2150.00 would
 *       pass against arithmetic that is wrong by $2.99 and would fail against arithmetic that
 *       is right, which makes it worse than having no test at all. The true product is
 *       asserted, and his approximation is reconciled to it separately.
 *
 *   (b) IT NEVER MANUFACTURES $3,565 FROM THE ANCHOR. He really did quote $3,565, and his own
 *       sentence gives the derivation: "three times the unit price of the previous award".
 *       That is a different rule on a different input. The tests below prove positively that
 *       no chaining of the two configured factors reaches it, so nobody can later "fix" the
 *       engine by back-solving a coefficient until the number appears.
 *
 * AND A FINDING THE INSTRUMENT ITSELF PRODUCED: his two stated approximations are not
 * reproducible by any single rounding rule. $2,034 requires rounding UP from 2033.499055
 * (nearest-dollar gives 2033), while $2,150 requires rounding DOWN from 2152.99 to the
 * nearest ten (nearest-dollar gives 2153). No one convention yields both. They were written
 * by hand, and `sharedRoundingRules` returning empty is the assertion that says so.
 */

import { describe, expect, it } from 'vitest'
import {
  CORPUS_DRAG_REFERENCE_CASES,
  INDEX_CONFIG_1650,
  NSN_1650_01_059_8221,
  PRICING_CONFIG,
  SURPLUS_CLEARING_CITATION,
  anchorPrice,
  evaluatedTotal,
  quotedTotal,
  reconcileStatedApproximation,
  resolveThreshold,
  sharedRoundingRules,
  surplusClearingEstimate,
  surplusDrag,
  tripwireBand,
  twelveMonthsBeforeUtc,
  type AnchorIndexConfig,
  type AnchorOutcome,
  type DatedEntry,
  type DatedSeries,
  type EvaluatedTotal,
  type EvaluatedTotalOutcome,
  type PricingConfig,
  type TripwireAssessment,
  type TripwireOutcome,
} from '@/lib/engine/pricing'

/* Narrowing guards. They assert a shape, never a value. */
function mustAnchor(o: AnchorOutcome) {
  if (!o.anchored) throw new Error(`expected an anchor, got abstention: ${o.reason}`)
  return o
}
function mustAssess(o: TripwireOutcome): TripwireAssessment {
  if (!o.assessed) throw new Error(`expected an assessment, got abstention: ${o.reason}`)
  return o
}
/**
 * Narrows to the TOTAL arm, and refuses the floor arm out loud.
 *
 * This helper is where the floor arm's safety property first fired, and on its own author. It
 * previously returned after excluding only the abstention, so once `EvaluatedTotalOutcome` gained
 * `EvaluatedFloor` it stopped compiling: a floor has no `evaluatedTotalUsd` to read. That refusal
 * is the entire reason the floor's figure is named `atLeastUsd` rather than sharing one field
 * behind a boolean. A caller that forgets cannot silently read a floor as a total, it fails to
 * build. Every case in this file supplies no applicable-but-unpriced factor, so a floor here would
 * mean the implementation had started flooring unconditionally, which is worth failing loudly on.
 */
function mustEvaluate(o: EvaluatedTotalOutcome): EvaluatedTotal {
  if (o.kind === 'EVALUATED_TOTAL_ABSTENTION') {
    throw new Error(`expected an evaluated total, got abstention: ${o.reason}`)
  }
  if (o.kind === 'EVALUATED_FLOOR_AT_LEAST') {
    throw new Error(
      'expected an evaluated total, got a FLOOR. No case in this file declares an ' +
        `applicable-but-unpriced factor, so this means the module floored unconditionally. ` +
        `Unpriced factors named: ${o.unpricedFactors.map((f) => f.code).join(', ')}`,
    )
  }
  return o
}

/* Instants, written out. 2026-03-02 sits after DLAD Rev 5 so every band resolves. */
const AT_2026_03_02 = Date.UTC(2026, 2, 2)
const AT_2024_06_01 = Date.UTC(2024, 5, 1)
const AT_2021_06_01 = Date.UTC(2021, 5, 1)
const AT_2019_06_15 = Date.UTC(2019, 5, 15)
const AT_2015_01_01 = Date.UTC(2015, 0, 1)

describe('anchorPrice on NSN 1650-01-059-8221', () => {
  const outcome = mustAnchor(anchorPrice(NSN_1650_01_059_8221.oemAward, INDEX_CONFIG_1650))
  const [cpi, dod] = outcome.results

  it('runs on the 2017 OEM award of 17 units at $1,537.85, not on the 13 surplus flips', () => {
    expect(outcome.oemAward.unitPriceUsd).toBe(1537.85)
    expect(outcome.oemAward.awardYear).toBe(2017)
    expect(outcome.oemAward.quantity).toBe(17)
    expect(NSN_1650_01_059_8221.priorAwardsAllSurplusCount).toBe(13)
  })

  it('carries BOTH indices, separately and labelled, never one without the other', () => {
    expect(outcome.results).toHaveLength(2)
    expect(cpi.kind).toBe('cpi')
    expect(dod.kind).toBe('dod_procurement')
  })

  it('computes the CPI figure as $2,033.50, the true product to the cent', () => {
    expect(cpi.factor).toBe(1.3223)
    expect(cpi.adjustedUnitPriceExactUsd).toBe(2033.499055)
    expect(cpi.adjustedUnitPriceUsd).toBe(2033.5)
    expect(cpi.adjustedUnitPriceCents).toBe(203350)
  })

  it('computes the DoD figure as $2,152.99 EXACTLY, and never as his stated $2,150', () => {
    expect(dod.factor).toBe(1.4)
    expect(dod.adjustedUnitPriceExactUsd).toBe(2152.99)
    expect(dod.adjustedUnitPriceUsd).toBe(2152.99)
    expect(dod.adjustedUnitPriceCents).toBe(215299)
    // The fabricated assertion this product exists to prevent. It must not hold.
    expect(dod.adjustedUnitPriceUsd).not.toBe(2150)
    expect(dod.adjustedUnitPriceUsd).not.toBe(2150.0)
  })

  it('marks the DoD index preferred, with the expert stated rationale attached', () => {
    expect(dod.preferred).toBe(true)
    expect(cpi.preferred).toBe(false)
    expect(outcome.preferred.kind).toBe('dod_procurement')
    expect(outcome.preferred.adjustedUnitPriceUsd).toBe(2152.99)
    expect(dod.preferenceRationale).toContain('industrial')
    expect(cpi.preferenceRationale).toBeNull()
  })

  it('carries a series vintage per index, with an honest null where no series is named', () => {
    expect(cpi.vintage.baseYear).toBe(2017)
    expect(dod.vintage.baseYear).toBe(2017)
    expect(cpi.vintage.publishedSeriesId).toBeNull()
    expect(dod.vintage.publishedSeriesId).toBeNull()
    expect(cpi.vintage.statedAtSourceDate).toBe('2026-08-12')
  })

  it('NEVER blends the two into a single number', () => {
    // The mean of 2033.50 and 2152.99 is 2093.245. If any blend leaked into the payload it
    // would appear in the serialised outcome. It must appear nowhere.
    expect(JSON.stringify(outcome)).not.toContain('2093.245')
    expect(cpi.adjustedUnitPriceUsd).not.toBe(dod.adjustedUnitPriceUsd)
  })

  it('NEGATIVE CONTROL: two identical factors would collapse the pair, so the pair is real', () => {
    const collapsed: AnchorIndexConfig = {
      cpi: { ...INDEX_CONFIG_1650.cpi, factor: 1.4 },
      dodProcurement: INDEX_CONFIG_1650.dodProcurement,
    }
    const broken = mustAnchor(anchorPrice(NSN_1650_01_059_8221.oemAward, collapsed))
    expect(broken.results[0].adjustedUnitPriceUsd).toBe(2152.99)
    expect(broken.results[1].adjustedUnitPriceUsd).toBe(2152.99)
    // Proving the instrument can tell the two apart, and does.
    expect(cpi.adjustedUnitPriceUsd).toBe(2033.5)
  })
})

describe('$3,565 is a recorded observation and is NOT an output of the anchor chain', () => {
  const outcome = mustAnchor(anchorPrice(NSN_1650_01_059_8221.oemAward, INDEX_CONFIG_1650))
  const [cpi, dod] = outcome.results

  it('neither index result equals 3565', () => {
    expect(cpi.adjustedUnitPriceUsd).not.toBe(3565)
    expect(dod.adjustedUnitPriceUsd).not.toBe(3565)
    expect(outcome.preferred.adjustedUnitPriceUsd).not.toBe(3565)
  })

  it('no chaining of the two configured factors reaches 3565 either', () => {
    // 2033.499055 x 1.40 = 2846.898677 and 2152.99 x 1.3223 = 2846.898677 (same, by commutativity).
    expect(cpi.adjustedUnitPriceExactUsd * 1.4).toBeCloseTo(2846.898677, 6)
    expect(dod.adjustedUnitPriceExactUsd * 1.3223).toBeCloseTo(2846.898677, 6)
    // 2152.99 x 1.40 = 3014.186, the closest a double application gets, and still not 3565.
    expect(dod.adjustedUnitPriceExactUsd * 1.4).toBeCloseTo(3014.186, 6)
    expect(dod.adjustedUnitPriceExactUsd * 1.4).not.toBe(3565)
  })

  it('the coefficient needed to manufacture 3565 is neither factor nor their product', () => {
    // 3565 / 1537.85 = 2.3181714731605814. The configured factors are 1.3223 and 1.40, whose
    // product is 1.85122. Reaching 3565 from the anchor requires inventing 2.31817, which is
    // exactly the fabrication this test exists to make impossible to slip in later.
    expect(3565 / 1537.85).toBeCloseTo(2.3181714731605814, 12)
    expect(3565 / 1537.85).not.toBeCloseTo(1.3223, 3)
    expect(3565 / 1537.85).not.toBeCloseTo(1.4, 3)
    expect(3565 / 1537.85).not.toBeCloseTo(1.85122, 3)
  })

  it('the fixture records 3565 with its real derivation and flags it as not an anchor output', () => {
    const q = NSN_1650_01_059_8221.observations.quotedUnitPriceUsd
    expect(q.value).toBe(3565)
    expect(q.isAnAnchorOutput).toBe(false)
    expect(q.grade).toBe('CORPUS_STATED')
    expect(q.derivationStatedBySource).toBe('three times the unit price of the previous award')
  })

  it('the implied previous award unit price is 1188.3333 and is graded DERIVED', () => {
    const implied = NSN_1650_01_059_8221.observations.impliedPreviousAwardUnitPriceUsd
    // 3565 / 3 = 1188.3333333333333
    expect(Math.round(implied.value * 10000) / 10000).toBe(1188.3333)
    expect(implied.grade).toBe('DERIVED')
    // And it is NOT the $1,021.50 supplier price, which the corpus also ties to that award.
    expect(implied.value).not.toBe(1021.5)
    expect(NSN_1650_01_059_8221.observations.supplierPurchaseOrder.unitPriceUsd).toBe(1021.5)
    expect(NSN_1650_01_059_8221.observations.supplierPurchaseOrder.quantity).toBe(8)
  })
})

describe('his stated approximations are reconciled, never asserted as the product', () => {
  const outcome = mustAnchor(anchorPrice(NSN_1650_01_059_8221.oemAward, INDEX_CONFIG_1650))
  const [cpi, dod] = outcome.results
  const stated = NSN_1650_01_059_8221.observations.statedApproximations

  const cpiApprox = reconcileStatedApproximation(
    cpi.adjustedUnitPriceExactUsd,
    stated.cpiUsd,
    stated.cpiVerbatim,
  )
  const dodApprox = reconcileStatedApproximation(
    dod.adjustedUnitPriceExactUsd,
    stated.dodUsd,
    stated.dodVerbatim,
  )

  it('$2,034 is reproducible ONLY by rounding up to the dollar', () => {
    expect(cpiApprox.statedUsd).toBe(2034)
    expect(cpiApprox.trueProductUsd).toBe(2033.499055)
    // 2034 - 2033.499055 = 0.500945
    expect(cpiApprox.deltaUsd).toBeCloseTo(0.500945, 9)
    expect([...cpiApprox.reproducibleBy]).toEqual(['ceil_to_dollar'])
    // Nearest-dollar gives 2033, so his figure is NOT ordinary rounding.
    expect(cpiApprox.reproducibleBy).not.toContain('nearest_dollar')
  })

  it('$2,150 is reproducible only by rounding to the nearest 10 or 50 dollars', () => {
    expect(dodApprox.statedUsd).toBe(2150)
    expect(dodApprox.trueProductUsd).toBe(2152.99)
    // 2150 - 2152.99 = -2.99
    expect(dodApprox.deltaUsd).toBeCloseTo(-2.99, 9)
    expect([...dodApprox.reproducibleBy]).toEqual(['nearest_10_dollars', 'nearest_50_dollars'])
    expect(dodApprox.reproducibleBy).not.toContain('nearest_dollar')
    expect(dodApprox.reproducibleBy).not.toContain('ceil_to_dollar')
  })

  it('NO single rounding rule reproduces both, so the figures were written by hand', () => {
    expect([...sharedRoundingRules([cpiApprox, dodApprox])]).toEqual([])
  })

  it('POSITIVE AND NEGATIVE CONTROL: the reconciler is neither vacuous nor omnivorous', () => {
    // Omnivorous check: a number nothing produces must match nothing.
    const nonsense = reconcileStatedApproximation(2033.499055, 9999, 'not a real figure')
    expect([...nonsense.reproducibleBy]).toEqual([])
    // Vacuous check: an exact hit must match, so the empty results above mean something.
    const exact = reconcileStatedApproximation(2152.99, 2153, 'nearest dollar')
    expect([...exact.reproducibleBy]).toEqual(['nearest_dollar', 'ceil_to_dollar'])
  })
})

describe('anchorPrice ABSTAINS rather than falling back to a surplus flip', () => {
  it('with no OEM award row it returns an explicit abstention and no number', () => {
    const outcome = anchorPrice(null, INDEX_CONFIG_1650)
    expect(outcome.anchored).toBe(false)
    if (outcome.anchored) throw new Error('unreachable')
    expect(outcome.reason).toBe('NO_OEM_AWARD_ROW')
    expect(outcome.detail).toContain('does not fall back')
    // There is no anchor figure anywhere on an abstention.
    expect('results' in outcome).toBe(false)
    expect('preferred' in outcome).toBe(false)
    expect(JSON.stringify(outcome)).not.toContain('2152.99')
    expect(JSON.stringify(outcome)).not.toContain('2033.5')
  })

  it('abstains on a non-positive OEM unit price', () => {
    const outcome = anchorPrice({ unitPriceUsd: 0, awardYear: 2017, quantity: 17 }, INDEX_CONFIG_1650)
    expect(outcome.anchored).toBe(false)
    if (outcome.anchored) throw new Error('unreachable')
    expect(outcome.reason).toBe('OEM_UNIT_PRICE_NOT_POSITIVE')
  })

  it('abstains when the preference is ambiguous, rather than picking an index', () => {
    const bothPreferred: AnchorIndexConfig = {
      cpi: { ...INDEX_CONFIG_1650.cpi, preferred: true },
      dodProcurement: INDEX_CONFIG_1650.dodProcurement,
    }
    const outcome = anchorPrice(NSN_1650_01_059_8221.oemAward, bothPreferred)
    expect(outcome.anchored).toBe(false)
    if (outcome.anchored) throw new Error('unreachable')
    expect(outcome.reason).toBe('PREFERENCE_NOT_RESOLVABLE')
  })
})

describe('surplusClearingEstimate is an observation, not a floor we quote at', () => {
  const outcome = mustAnchor(anchorPrice(NSN_1650_01_059_8221.oemAward, INDEX_CONFIG_1650))
  const obs = surplusClearingEstimate(outcome.preferred, 0.5, SURPLUS_CLEARING_CITATION)

  it('applies the observed 50% to the preferred inflation-adjusted value', () => {
    expect(NSN_1650_01_059_8221.observations.surplusClearingRatio.value).toBe(0.5)
    expect(obs.appliedToIndexKind).toBe('dod_procurement')
    expect(obs.inflationAdjustedUnitPriceUsd).toBe(2152.99)
    // 0.5 x 2152.99 = 1076.495, which is $1,076.50 to the cent. Naive float math gives
    // 1076.4949999999999 and rounds to 1076.49, a cent short. Integer cents avoid that.
    expect(obs.impliedClearingUnitPriceUsd).toBe(1076.5)
  })

  it('is labelled as an observed market ratio and refuses to be a quotable floor', () => {
    expect(obs.label).toBe('OBSERVED_MARKET_RATIO_FROM_CORPUS')
    expect(obs.ratioBasis).toBe('inflation_adjusted_oem_value')
    expect(obs.isAQuotableFloor).toBe(false)
    expect(obs.caveat).toContain('not a floor')
    expect(obs.citation.grade).toBe('CORPUS_STATED')
  })
})

describe('evaluatedTotal keeps the adders OUT of the recommended quote', () => {
  const quoted = quotedTotal(1021.5, 8)

  it('builds the quoted total in exact cents: 1021.50 x 8 = $8,172.00', () => {
    expect(quoted.kind).toBe('QUOTED_TOTAL_WHAT_WE_SEND')
    expect(quoted.totalCents).toBe(817200)
    expect(quoted.totalUsd).toBe(8172)
  })

  it('adds $200 to the EVALUATED total and nothing to the quote', () => {
    const ev = mustEvaluate(
      evaluatedTotal(
        quoted,
        { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: 0 },
        PRICING_CONFIG,
        AT_2026_03_02,
      ),
    )
    expect(ev.kind).toBe('EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND')
    expect(ev.adderTotalUsd).toBe(200)
    expect(ev.evaluatedTotalUsd).toBe(8372)
    // The number we send is untouched. This is the whole point of the two types.
    expect(ev.quotedTotalUsd).toBe(8172)
    expect(ev.recommendedQuoteTotalUsd).toBe(8172)
    expect(ev.addersAreIncludedInRecommendedQuote).toBe(false)
    expect(ev.adders).toHaveLength(1)
    expect(ev.adders[0]?.code).toBe('UNUSED_FORMER_GOVERNMENT_SURPLUS')
    expect(ev.adders[0]?.unitAmountUsd).toBe(200)
  })

  it('adds $600 per ESA coordination: 8172 + 200 + 600 = $8,972.00', () => {
    const ev = mustEvaluate(
      evaluatedTotal(
        quoted,
        { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: 1 },
        PRICING_CONFIG,
        AT_2026_03_02,
      ),
    )
    expect(ev.adderTotalUsd).toBe(800)
    expect(ev.evaluatedTotalUsd).toBe(8972)
    expect(ev.recommendedQuoteTotalUsd).toBe(8172)
    expect(ev.adders).toHaveLength(2)
    expect(ev.adders[1]?.code).toBe('ESA_COORDINATION')
    expect(ev.adders[1]?.appliedCount).toBe(1)
    expect(ev.adders[1]?.subtotalUsd).toBe(600)
  })

  it('charges $600 per ESA, so two ESAs add $1,200: 8172 + 200 + 1200 = $9,572.00', () => {
    const ev = mustEvaluate(
      evaluatedTotal(
        quoted,
        { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: 2 },
        PRICING_CONFIG,
        AT_2026_03_02,
      ),
    )
    expect(ev.adders[1]?.subtotalUsd).toBe(1200)
    expect(ev.adderTotalUsd).toBe(1400)
    expect(ev.evaluatedTotalUsd).toBe(9572)
    expect(ev.recommendedQuoteTotalUsd).toBe(8172)
  })

  it('applies nothing when no adder is applicable, and the two totals coincide', () => {
    const ev = mustEvaluate(
      evaluatedTotal(
        quoted,
        { isUnusedFormerGovernmentSurplus: false, esaCoordinationCount: 0 },
        PRICING_CONFIG,
        AT_2026_03_02,
      ),
    )
    expect(ev.adders).toHaveLength(0)
    expect(ev.adderTotalUsd).toBe(0)
    expect(ev.evaluatedTotalUsd).toBe(8172)
    expect(ev.surplusDrag).toBeNull()
  })

  it('leaves the QuotedTotal object itself byte-identical after evaluation', () => {
    evaluatedTotal(
      quoted,
      { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: 3 },
      PRICING_CONFIG,
      AT_2026_03_02,
    )
    expect(quoted).toEqual({
      kind: 'QUOTED_TOTAL_WHAT_WE_SEND',
      unitPriceUsd: 1021.5,
      quantity: 8,
      totalCents: 817200,
      totalUsd: 8172,
    })
  })

  it('ABSTAINS rather than applying zero when an applicable adder predates the config', () => {
    const ev = evaluatedTotal(
      quoted,
      { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: 0 },
      PRICING_CONFIG,
      AT_2015_01_01,
    )
    expect(ev.kind).toBe('EVALUATED_TOTAL_ABSTENTION')
    if (ev.kind !== 'EVALUATED_TOTAL_ABSTENTION') throw new Error('unreachable')
    expect(ev.reason).toBe('APPLICABLE_ADDER_NOT_RESOLVABLE_AT_INSTANT')
    expect(ev.detail).toContain('rather than using zero')
  })

  it('rejects a fractional or negative ESA count instead of coercing it', () => {
    const frac = evaluatedTotal(
      quoted,
      { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: 1.5 },
      PRICING_CONFIG,
      AT_2026_03_02,
    )
    expect(frac.kind).toBe('EVALUATED_TOTAL_ABSTENTION')
    const neg = evaluatedTotal(
      quoted,
      { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: -1 },
      PRICING_CONFIG,
      AT_2026_03_02,
    )
    expect(neg.kind).toBe('EVALUATED_TOTAL_ABSTENTION')
  })

  it('flags that the config may lag the FAR for an instant past the primary-text read', () => {
    const recent = mustEvaluate(
      evaluatedTotal(
        quoted,
        { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: 0 },
        PRICING_CONFIG,
        AT_2026_03_02,
      ),
    )
    expect(recent.anyAdderLaterAmendmentsUnverified).toBe(true)
    // And the same call inside the read window is NOT flagged, so the flag means something.
    const inWindow = mustEvaluate(
      evaluatedTotal(
        quoted,
        { isUnusedFormerGovernmentSurplus: true, esaCoordinationCount: 0 },
        PRICING_CONFIG,
        AT_2024_06_01,
      ),
    )
    expect(inWindow.anyAdderLaterAmendmentsUnverified).toBe(false)
    expect(inWindow.evaluatedTotalUsd).toBe(8372)
  })
})

describe('surplusDrag, the regressive-adder metric, on both corpus worked cases', () => {
  it('a 1-unit $300 buy carries a 66.7% drag, which the source calls usually fatal', () => {
    const d = surplusDrag(200, 300, 1)
    expect(d.computed).toBe(true)
    if (!d.computed) throw new Error('unreachable')
    expect(d.lineTotalUsd).toBe(300)
    // 200 / 300 = 0.666666..., i.e. 66.666...%
    expect(Math.round(d.dragRatio * 1e6)).toBe(666667)
    expect(Math.round(d.dragPercent * 10) / 10).toBe(66.7)
    // The research file states it as 67%, which is the same number to the whole percent.
    expect(Math.round(d.dragPercent)).toBe(67)
    expect(CORPUS_DRAG_REFERENCE_CASES.fatal.statedPercentInSource).toBe(67)
  })

  it('a 190-unit quote totalling $532,000 carries a 0.04% drag, which is noise', () => {
    const d = surplusDrag(200, 2800, 190)
    expect(d.computed).toBe(true)
    if (!d.computed) throw new Error('unreachable')
    // 2800 x 190 = 532,000
    expect(d.lineTotalUsd).toBe(532000)
    // 200 / 532000 = 0.000375939849..., i.e. 0.0375939...%
    expect(Math.round(d.dragRatio * 1e6)).toBe(376)
    expect(Math.round(d.dragPercent * 100) / 100).toBe(0.04)
    expect(CORPUS_DRAG_REFERENCE_CASES.noise.statedPercentInSource).toBe(0.04)
  })

  it('the two cases differ by roughly three orders of magnitude, which is the whole point', () => {
    const fatal = surplusDrag(200, 300, 1)
    const noise = surplusDrag(200, 2800, 190)
    if (!fatal.computed || !noise.computed) throw new Error('unreachable')
    // 0.666666... / 0.000375939... = 1773.333...
    expect(Math.round(fatal.dragRatio / noise.dragRatio)).toBe(1773)
  })

  it('abstains on a non-positive line total instead of emitting a sentinel that sorts', () => {
    const d = surplusDrag(200, 0, 5)
    expect(d.computed).toBe(false)
    if (d.computed) throw new Error('unreachable')
    expect(d.reason).toBe('LINE_TOTAL_NOT_POSITIVE')
  })

  it('cites the worked cases to their line numbers in the research file', () => {
    expect(CORPUS_DRAG_REFERENCE_CASES.citation.sourceLines).toBe('384-386')
    expect(CORPUS_DRAG_REFERENCE_CASES.citation.sourceFile).toContain(
      'dla-procurement-mechanics.md',
    )
  })
})

describe('resolveThreshold selects the value in force on the date being analysed', () => {
  // THE SERIES IS PERIOD-CORRECT, WHICH IS THE WHOLE REASON IT IS DATED.
  // This previously asserted one value forever. That is what let a superseded 2020 figure
  // extrapolate silently into the present. A procurement is evaluated against the threshold in
  // force on ITS date, so each era is asserted separately and the pair is the real instrument.
  it('resolves $10,000 for an instant inside the 2020 era', () => {
    const r = resolveThreshold(PRICING_CONFIG.microPurchaseThreshold, AT_2024_06_01)
    expect(r.resolved).toBe(true)
    if (!r.resolved) throw new Error('unreachable')
    expect(r.value).toBe(1_000_000)
    expect(r.entry.citation.authority).toContain('85 FR 40064')
    expect(r.entry.citation.grade).toBe('PRIMARY_TEXT')
  })

  it('resolves $15,000 for a present-day instant, because the threshold moved', () => {
    const r = resolveThreshold(PRICING_CONFIG.microPurchaseThreshold, AT_2026_03_02)
    expect(r.resolved).toBe(true)
    if (!r.resolved) throw new Error('unreachable')
    expect(r.value).toBe(1_500_000)
    expect(r.entry.citation.authority).toContain('FAC 2026-01')
    // The VALUE is block-quoted regulation text. The authority string carries the boundary date's
    // weaker REPORTED grade on its face so the two cannot be read as one.
    expect(r.entry.citation.grade).toBe('PRIMARY_TEXT')
    expect(r.entry.citation.authority).toContain('EFFECTIVE DATE')
    expect(r.entry.citation.authority).toContain('REPORTED')
  })

  it('THE PAIR: one series, two eras, and the boundary actually moves the value', () => {
    // If this pair ever returned the same figure, every period-correctness claim in this module
    // would be decorative. The boundary is 2025-10-01.
    const before = resolveThreshold(
      PRICING_CONFIG.microPurchaseThreshold,
      Date.UTC(2025, 8, 30),
    )
    const after = resolveThreshold(PRICING_CONFIG.microPurchaseThreshold, Date.UTC(2025, 9, 1))
    if (!before.resolved || !after.resolved) throw new Error('unreachable')
    expect(before.value).toBe(1_000_000)
    expect(after.value).toBe(1_500_000)
  })

  it('ABSTAINS for a 2019 award rather than applying a later era threshold to it', () => {
    const r = resolveThreshold(PRICING_CONFIG.microPurchaseThreshold, AT_2019_06_15)
    expect(r.resolved).toBe(false)
    if (r.resolved) throw new Error('unreachable')
    expect(r.reason).toBe('NO_ENTRY_IN_FORCE_AT_INSTANT')
    expect(r.detail).toContain('does not extrapolate')
  })

  it('flags staleness past the primary-text read, and does not flag it inside', () => {
    const later = resolveThreshold(PRICING_CONFIG.microPurchaseThreshold, AT_2026_03_02)
    if (!later.resolved) throw new Error('unreachable')
    expect(later.laterAmendmentsUnverified).toBe(true)
    expect(later.stalenessNote).toContain('Re-verify')

    const onDate = resolveThreshold(PRICING_CONFIG.microPurchaseThreshold, Date.UTC(2020, 7, 31))
    if (!onDate.resolved) throw new Error('unreachable')
    expect(onDate.laterAmendmentsUnverified).toBe(false)
    expect(onDate.stalenessNote).toBeNull()
  })

  it('carries the SAT for each era too, $250,000 then $350,000', () => {
    const old = resolveThreshold(PRICING_CONFIG.simplifiedAcquisitionThreshold, AT_2024_06_01)
    const now = resolveThreshold(PRICING_CONFIG.simplifiedAcquisitionThreshold, AT_2026_03_02)
    if (!old.resolved || !now.resolved) throw new Error('unreachable')
    expect(old.value).toBe(25_000_000)
    expect(now.value).toBe(35_000_000)
  })

  it('carries NO $20,000 anywhere, because that figure has no primary text behind it', () => {
    // THIS TEST WAS ITSELF WRONG AND IT IS WORTH RECORDING WHY.
    // It asserted that neither $20,000 NOR $15,000 could appear, treating them as the same class
    // of unbacked figure. They are not the same class at all:
    //   $20,000 is advocacy shorthand repeated in the SMI/SBAIC documents with NO primary text
    //           anywhere behind it. It must never appear. That half was right and is kept.
    //   $15,000 is the CURRENT value of FAR 2.101, block-quoted from the regulation in
    //           dla-procurement-mechanics.md:172-186 and graded VERIFIED at line 1087. Asserting
    //           it could never appear pinned a superseded 2020 figure in place as though it were
    //           today's, and turned a stale number into an enforced invariant.
    // A test that forbids a correct value is worse than no test: it defends the error.
    const serialised = JSON.stringify([
      PRICING_CONFIG.microPurchaseThreshold,
      PRICING_CONFIG.simplifiedAcquisitionThreshold,
    ])
    for (const entry of PRICING_CONFIG.microPurchaseThreshold.entries) {
      expect(entry.value).not.toBe(2_000_000)
    }
    expect(serialised).not.toContain('"value":2000000')
    // And the positive half: $15,000 IS present, as the entry in force today.
    expect(serialised).toContain('"value":1500000')
  })
})

describe('tripwireBand: the same increase lands in opposite bands either side of the MPT', () => {
  const PRIOR_AT = Date.UTC(2025, 5, 1)

  it('a 25% increase at or above the MPT crosses the 25% band', () => {
    // prior $1,000 -> proposed $1,250. (125000 - 100000) / 100000 = 0.25 exactly.
    const t = mustAssess(
      tripwireBand(
        {
          proposedUnitPriceUsd: 1250,
          mostRecentPriorUnitPriceUsd: 1000,
          mostRecentPriorPriceInstantMs: PRIOR_AT,
          atInstantMs: AT_2026_03_02,
          // $20,000 is at or above the CURRENT $15,000 MPT. This fixture was $12,500, which sat
          // above the superseded $10,000 figure and below the real one, so it silently changed
          // sides when the threshold was corrected. That is the whole hazard in one number.
          procurementValueUsd: 20000,
        },
        PRICING_CONFIG,
      ),
    )
    expect(t.impliedIncreaseRatio).toBe(0.25)
    expect(t.impliedIncreasePercent).toBe(25)
    expect(t.impliedMultipleOfPrior).toBe(1.25)
    expect(t.band).toBe('AT_OR_ABOVE_MPT_25_PERCENT')
    expect(t.bandThresholdRatio).toBe(0.25)
    expect(t.crossed).toBe(true)
    expect(t.microPurchaseThresholdUsd).toBe(15000)
  })

  it('THE SAME 25% increase UNDER the MPT does not cross, because that band is 51%', () => {
    const t = mustAssess(
      tripwireBand(
        {
          proposedUnitPriceUsd: 1250,
          mostRecentPriorUnitPriceUsd: 1000,
          mostRecentPriorPriceInstantMs: PRIOR_AT,
          atInstantMs: AT_2026_03_02,
          procurementValueUsd: 5000,
        },
        PRICING_CONFIG,
      ),
    )
    expect(t.impliedIncreaseRatio).toBe(0.25)
    expect(t.band).toBe('UNDER_MPT_51_PERCENT')
    expect(t.bandThresholdRatio).toBe(0.51)
    expect(t.crossed).toBe(false)
    expect(t.consequence.awardPathway).toBe('AUTOMATED')
    expect(t.consequence.requiredAction).toBeNull()
  })

  it('treats a procurement valued exactly AT the MPT as at-or-above, not under', () => {
    const t = mustAssess(
      tripwireBand(
        {
          proposedUnitPriceUsd: 1250,
          mostRecentPriorUnitPriceUsd: 1000,
          mostRecentPriorPriceInstantMs: PRIOR_AT,
          atInstantMs: AT_2026_03_02,
          procurementValueUsd: 15000,
        },
        PRICING_CONFIG,
      ),
    )
    expect(t.band).toBe('AT_OR_ABOVE_MPT_25_PERCENT')
    expect(t.crossed).toBe(true)
  })

  it('crosses the 51% band at exactly 51%, and not at 50.9%', () => {
    // prior $1,000 -> proposed $1,510 is 0.51 exactly. -> $1,509 is 0.509.
    const at51 = mustAssess(
      tripwireBand(
        {
          proposedUnitPriceUsd: 1510,
          mostRecentPriorUnitPriceUsd: 1000,
          mostRecentPriorPriceInstantMs: PRIOR_AT,
          atInstantMs: AT_2026_03_02,
          procurementValueUsd: 5000,
        },
        PRICING_CONFIG,
      ),
    )
    expect(at51.impliedIncreaseRatio).toBe(0.51)
    expect(at51.crossed).toBe(true)

    const just_below = mustAssess(
      tripwireBand(
        {
          proposedUnitPriceUsd: 1509,
          mostRecentPriorUnitPriceUsd: 1000,
          mostRecentPriorPriceInstantMs: PRIOR_AT,
          atInstantMs: AT_2026_03_02,
          procurementValueUsd: 5000,
        },
        PRICING_CONFIG,
      ),
    )
    expect(just_below.impliedIncreaseRatio).toBe(0.509)
    expect(just_below.crossed).toBe(false)
  })

  it('encodes the CONSEQUENCE, which is notification and delay, never a cap or illegality', () => {
    const t = mustAssess(
      tripwireBand(
        {
          proposedUnitPriceUsd: 1250,
          mostRecentPriorUnitPriceUsd: 1000,
          mostRecentPriorPriceInstantMs: PRIOR_AT,
          atInstantMs: AT_2026_03_02,
          // At or above the CURRENT $15,000 MPT, so the 25% band applies and 25% crosses it.
          // Was $12,500, which sat above the superseded threshold and below the real one.
          procurementValueUsd: 20000,
        },
        PRICING_CONFIG,
      ),
    )
    expect(t.consequence.awardPathway).toBe('REQUIRES_SENIOR_NOTIFICATION')
    expect(t.consequence.capsPrice).toBe(false)
    expect(t.consequence.makesAwardIllegal).toBe(false)
    expect(t.consequence.requiredAction).toContain('notify the HCA by email')
    expect(t.consequence.operationalMeaning).toContain('Lawful')
    expect(t.bandCitation.authority).toContain('17.7505')
    expect(t.bandCitation.sourceLines).toBe('569-570')
  })

  it('handles a large multiple without treating it as prohibited', () => {
    // prior $23 -> proposed $9,827.32. (982732 - 2300) / 2300 = 426.2747826...
    const t = mustAssess(
      tripwireBand(
        {
          proposedUnitPriceUsd: 9827.32,
          mostRecentPriorUnitPriceUsd: 23,
          mostRecentPriorPriceInstantMs: PRIOR_AT,
          atInstantMs: AT_2026_03_02,
          procurementValueUsd: 98273.2,
        },
        PRICING_CONFIG,
      ),
    )
    expect(t.impliedIncreaseRatio).toBeCloseTo(426.2747826086957, 10)
    expect(t.impliedMultipleOfPrior).toBeCloseTo(427.2747826086957, 10)
    expect(t.crossed).toBe(true)
    expect(t.consequence.makesAwardIllegal).toBe(false)
    expect(t.consequence.capsPrice).toBe(false)
  })
})

describe('tripwireBand abstentions, each for a different and honest reason', () => {
  it('abstains when the only prior price is outside the trailing twelve months', () => {
    // At instant 2026-03-02 the window opens 2025-03-02. A 2025-01-01 price is outside it.
    const t = tripwireBand(
      {
        proposedUnitPriceUsd: 1250,
        mostRecentPriorUnitPriceUsd: 1000,
        mostRecentPriorPriceInstantMs: Date.UTC(2025, 0, 1),
        atInstantMs: AT_2026_03_02,
        procurementValueUsd: 12500,
      },
      PRICING_CONFIG,
    )
    expect(t.assessed).toBe(false)
    if (t.assessed) throw new Error('unreachable')
    expect(t.reason).toBe('PRIOR_PRICE_OUTSIDE_TRAILING_12_MONTHS')
    expect(t.detail).toContain('fabricated all-clear')
  })

  it('abstains on a 2019 award because no MPT is dated for that era', () => {
    const t = tripwireBand(
      {
        proposedUnitPriceUsd: 1250,
        mostRecentPriorUnitPriceUsd: 1000,
        mostRecentPriorPriceInstantMs: Date.UTC(2018, 11, 1),
        atInstantMs: AT_2019_06_15,
        procurementValueUsd: 12500,
      },
      PRICING_CONFIG,
    )
    expect(t.assessed).toBe(false)
    if (t.assessed) throw new Error('unreachable')
    expect(t.reason).toBe('MICRO_PURCHASE_THRESHOLD_NOT_RESOLVABLE_AT_INSTANT')
    expect(t.detail).toContain('silently misclassify')
  })

  it('abstains in 2021, where the MPT resolves but the band revision read does not reach back', () => {
    const t = tripwireBand(
      {
        proposedUnitPriceUsd: 1250,
        mostRecentPriorUnitPriceUsd: 1000,
        mostRecentPriorPriceInstantMs: Date.UTC(2020, 11, 1),
        atInstantMs: AT_2021_06_01,
        procurementValueUsd: 12500,
      },
      PRICING_CONFIG,
    )
    expect(t.assessed).toBe(false)
    if (t.assessed) throw new Error('unreachable')
    expect(t.reason).toBe('BAND_NOT_RESOLVABLE_AT_INSTANT')
  })

  it('abstains on a non-positive prior price rather than dividing by zero', () => {
    const t = tripwireBand(
      {
        proposedUnitPriceUsd: 1250,
        mostRecentPriorUnitPriceUsd: 0,
        mostRecentPriorPriceInstantMs: Date.UTC(2025, 5, 1),
        atInstantMs: AT_2026_03_02,
        procurementValueUsd: 12500,
      },
      PRICING_CONFIG,
    )
    expect(t.assessed).toBe(false)
    if (t.assessed) throw new Error('unreachable')
    expect(t.reason).toBe('PRIOR_PRICE_NOT_POSITIVE')
  })
})

describe('the threshold is READ FROM THE CONFIG, not baked into the call site', () => {
  /*
   * A mutation sweep found the one thing the tests above could not distinguish: replacing
   * `mpt.value` with the literal 1_000_000 inside tripwireBand passed every assertion, because
   * the real config carries exactly that value. These two cases close that hole by feeding a
   * DIFFERENT config and requiring the verdict to move with it.
   *
   * THE DOLLAR FIGURES BELOW ARE SYNTHETIC INSTRUMENTS, NOT CLAIMS. $2,000 and $99,999 are
   * chosen precisely because no real threshold has ever been either, so nothing here can be
   * mistaken for a citable figure if it is read out of context.
   */
  const SYNTHETIC_MPT_2000: PricingConfig = {
    ...PRICING_CONFIG,
    microPurchaseThreshold: {
      ...PRICING_CONFIG.microPurchaseThreshold,
      entries: [
        {
          ...(PRICING_CONFIG.microPurchaseThreshold.entries[0] as DatedEntry<number>),
          value: 200_000,
          // The real entries[0] is now the CLOSED 2020 era, so copying it wholesale leaves this
          // synthetic series covering nothing at a present-day instant and the assertion below
          // dies in the narrowing guard rather than testing anything. Left open on purpose: this
          // fixture exists to prove the band is read from config, not to model a real era.
          inForceUntilMs: null,
        },
      ],
    },
  }

  it('flips the band for identical inputs when the config carries a different threshold', () => {
    const input = {
      proposedUnitPriceUsd: 1250,
      mostRecentPriorUnitPriceUsd: 1000,
      mostRecentPriorPriceInstantMs: Date.UTC(2025, 5, 1),
      atInstantMs: AT_2026_03_02,
      procurementValueUsd: 5000,
    }
    // Against the real threshold in force today ($15,000), a $5,000 procurement is UNDER, so
    // the band is 51% and a 25% increase does not cross.
    const real = mustAssess(tripwireBand(input, PRICING_CONFIG))
    expect(real.microPurchaseThresholdUsd).toBe(15000)
    expect(real.band).toBe('UNDER_MPT_51_PERCENT')
    expect(real.crossed).toBe(false)

    // Against a $2,000 threshold the same $5,000 procurement is AT OR ABOVE, the band becomes
    // 25%, and the identical 25% increase now crosses. Only a config read can do that.
    const synthetic = mustAssess(tripwireBand(input, SYNTHETIC_MPT_2000))
    expect(synthetic.microPurchaseThresholdUsd).toBe(2000)
    expect(synthetic.band).toBe('AT_OR_ABOVE_MPT_25_PERCENT')
    expect(synthetic.crossed).toBe(true)
    expect(synthetic.consequence.awardPathway).toBe('REQUIRES_SENIOR_NOTIFICATION')
  })

  it('selects by DATE within a series, so each era gets its own threshold', () => {
    const first = PRICING_CONFIG.microPurchaseThreshold.entries[0] as DatedEntry<number>
    const twoEras: DatedSeries<number> = {
      ...PRICING_CONFIG.microPurchaseThreshold,
      entries: [
        { ...first, inForceUntilMs: Date.UTC(2030, 0, 1) },
        { ...first, value: 9_999_900, inForceFromMs: Date.UTC(2030, 0, 1), inForceUntilMs: null },
      ],
    }
    // 2026 falls in the first era.
    const early = resolveThreshold(twoEras, AT_2026_03_02)
    if (!early.resolved) throw new Error('unreachable')
    expect(early.value).toBe(1_000_000)
    // 2031 falls in the second. A call site holding a constant could not tell these apart.
    const late = resolveThreshold(twoEras, Date.UTC(2031, 0, 1))
    if (!late.resolved) throw new Error('unreachable')
    expect(late.value).toBe(9_999_900)
    // And the boundary is inclusive at the start of the later era, exclusive at its end.
    const onBoundary = resolveThreshold(twoEras, Date.UTC(2030, 0, 1))
    if (!onBoundary.resolved) throw new Error('unreachable')
    expect(onBoundary.value).toBe(9_999_900)
  })
})

describe('twelveMonthsBeforeUtc is a calendar year, not 365 days', () => {
  it('maps 2026-03-02 back to 2025-03-02', () => {
    expect(new Date(twelveMonthsBeforeUtc(Date.UTC(2026, 2, 2))).toISOString()).toBe(
      '2025-03-02T00:00:00.000Z',
    )
  })

  it('rolls a leap day to March 1 of the prior year, deterministically', () => {
    expect(new Date(twelveMonthsBeforeUtc(Date.UTC(2024, 1, 29))).toISOString()).toBe(
      '2023-03-01T00:00:00.000Z',
    )
  })

  it('is not a fixed 365-day subtraction, which would land a day early across a leap year', () => {
    const DAY = 86_400_000
    // 2024-03-02 minus 365 days is 2023-03-03, because 2024 is a leap year. The calendar
    // answer is 2023-03-02. If these agreed, the function would be doing day arithmetic.
    expect(new Date(Date.UTC(2024, 2, 2) - 365 * DAY).toISOString()).toBe(
      '2023-03-03T00:00:00.000Z',
    )
    expect(new Date(twelveMonthsBeforeUtc(Date.UTC(2024, 2, 2))).toISOString()).toBe(
      '2023-03-02T00:00:00.000Z',
    )
  })
})
