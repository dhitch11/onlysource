import { describe, it, expect } from "vitest";
import { classifyInstrument, offersDescribeThisAward } from '@/lib/intelligence/awards/parent-child'
import { scoreCorner, LOCK_PENALTY, valuePoints } from "@/lib/intelligence/scoring/cornerscore";
import { gradeFrom, measured, prior, unavailable } from "@/lib/intelligence/scoring/evidence-state";
import type { CornerRow } from "@/lib/intelligence/corner";
import type { AwardRecord, NsnAwardSummary } from "@/lib/intelligence/awards/nsn-now";
import { rollUpSurplus } from "@/lib/intelligence/awards/surplus";
import { buildCageFamilyIndex } from "@/lib/intelligence/scoring/cage-family";

/**
 * These tests exist to lock the ONE property the whole methodology rests on: a missing leg
 * abstains, it never fabricates. A corner with no data must never render as actionable, and
 * grade/disposition must degrade honestly as inputs drop out.
 */

const baseRow = (over: Partial<CornerRow> = {}): CornerRow => ({
  niin: "015619853",
  nsn: "5325015619853",
  nomenclature: "RING,RETAINING",
  quantity: 100,
  unitOfIssue: "EA",
  solicitation: "SPE4A626T15HA",
  returnDate: "08/19/26",
  automatedSolicitation: true,
  approvedSources: ["58794"],
  approvedSourceCount: 1,
  soleSource: true,
  signals: [{ kind: "award_silent", cage: "58794", measurement: "no prime award in two years" }],
  silentSourceCount: 1,
  availability: "unknown_credential_absent" as const,
  availabilityHolders: null,
  availabilityUnits: null,
  legsEstablished: 2,
  gaps: [],
  ...over,
});

/**
 * An award row with every field the record carries.
 *
 * The Batch Export columns the parser reads grew on 2026-08-16 (acquisition codes, offers,
 * delivery days, set-aside, first article, LTC expiry, surplus), so a fixture that spells out
 * one award literal per row would have to be edited every time a real column is wired in. This
 * helper defaults the new fields to null, which is exactly what an export row that omits them
 * produces, and lets each test override only the field it is actually about.
 */
/*
 * ★ THE FIXTURE DERIVES `instrument` AND `offersDescribeThisAward` RATHER THAN DECLARING THEM.
 *
 * Both are computed fields (see `lib/intelligence/awards/parent-child.ts`). A fixture that
 * hardcodes a derived value can assert a state the real parser would never produce, so a test
 * passing `deliveryOrder: 'F001'` gets a genuinely classified record and cannot accidentally
 * describe a delivery order whose offers still count as its own.
 */
const award = (over: Partial<AwardRecord> & { contractNo: string }): AwardRecord => {
  const base = {
    nsn: "5325015619853",
    awardDateIso: null,
    quantity: null,
    unitPrice: null,
    company: "ACME",
    cage: "58794",
    finalPrice: null,
    effectiveUnitPrice: null,
    amc: null,
    amsc: null,
    offers: null,
    deliveryDays: null,
    setAside: null,
    firstArticle: null,
    ltcExpirationIso: null,
    surplus: null,
    solicitation: null,
    closeDateIso: null,
  deliveryOrder: null,
    instrument: 'unreadable' as const,
    offersDescribeThisAward: false,
    ...over,
  }
  const rec: AwardRecord = { ...base, instrument: classifyInstrument(base) }
  return { ...rec, offersDescribeThisAward: offersDescribeThisAward(rec) }
};

const awardWith = (over: Partial<NsnAwardSummary> = {}): NsnAwardSummary => {
  const base: NsnAwardSummary = {
  nsn: "5325015619853",
  awards: [
    award({ contractNo: "C1", awardDateIso: "2016-01-01", quantity: 300, unitPrice: 1.48, finalPrice: 444, effectiveUnitPrice: 1.48 }),
    award({ contractNo: "C1b", awardDateIso: "2020-01-01", quantity: 200, unitPrice: 2.0, finalPrice: 400, effectiveUnitPrice: 2.0 }),
    award({ contractNo: "C2", awardDateIso: "2025-01-01", quantity: 100, unitPrice: 2.54, finalPrice: 254, effectiveUnitPrice: 2.54 }),
  ],
  latest: award({ contractNo: "C2", awardDateIso: "2025-01-01", quantity: 100, unitPrice: 2.54, finalPrice: 254, effectiveUnitPrice: 2.54 }),
  distinctAwardees: 1,
  firstUnitPrice: 1.48,
  lastUnitPrice: 2.54,
  priceScaleSuspect: null,
  holders: [{ nsn: "5325015619853", company: "HOLDER", cage: "0AMA0", quantity: 3333 }],
  amc: null,
  amsc: null,
  latestOffers: null,
    // Derived in the real builder from the award instruments; the fixture states the honest
    // default and any test that needs the other value sets it explicitly.
    latestOffersDescribeThatAward: false,
    deliveryOrderOnly: false,
    earliestOrderIso: null,
  minOffers: null,
  latestDeliveryDays: null,
  longestDemandGapYears: null,
  yearsSinceLastAward: null,
  approvedSources: [],
  ltcExpirationIso: null,
  surplus: rollUpSurplus([]),
  ...over,
  };
  // Derived from whatever awards the fixture ended up with, so a caller that overrides `awards`
  // cannot leave a surplus rollup describing a different set of rows behind.
  return { ...base, surplus: over.surplus ?? rollUpSurplus(base.awards) };
};

describe("evidence-state grade", () => {
  it("caps at D when any load-bearing leg is UNAVAILABLE", () => {
    expect(gradeFrom([measured(1, 0.9, "x"), unavailable("y")])).toBe("D");
  });
  it("caps at C when a leg is PRIOR but bounded", () => {
    expect(gradeFrom([measured(1, 0.9, "x"), prior(0.5, "y")])).toBe("C");
  });
  it("never reaches A without adequate calibration, even all-measured", () => {
    expect(gradeFrom([measured(1, 0.9, "x"), measured(1, 0.8, "y")])).toBe("B");
    expect(gradeFrom([measured(1, 0.9, "x")], true)).toBe("A");
  });
});

describe("scoreCorner abstention discipline", () => {
  it("a corner with NO award data is INSUFFICIENT_DATA / grade D, never actionable", () => {
    const r = scoreCorner(baseRow(), null);
    expect(r.disposition).toBe("INSUFFICIENT_DATA");
    expect(r.grade).toBe("D");
    expect(r.disposition).not.toBe("FLAG");
    // The price and feasibility legs must state their absence, not fake a number.
    expect(r.legs.priceAnchor.state).toBe("UNAVAILABLE");
    expect(r.legs.feasibility.state).toBe("UNAVAILABLE");
    // data_gaps is never empty by omission.
    expect(r.dataGaps.length).toBeGreaterThan(0);
  });

  it("a corner with award history AND availability reaches WATCHLIST / grade B, still not FLAG", () => {
    const r = scoreCorner(baseRow(), awardWith());
    expect(r.disposition).toBe("WATCHLIST");
    expect(r.grade).toBe("B"); // measured legs, but forward-demand is PRIOR and calibration is thin
    expect(r.disposition).not.toBe("FLAG");
    expect(r.legs.priceAnchor.state).toBe("MEASURED");
    expect(r.legs.feasibility.state).toBe("MEASURED");
    // forward demand is honestly a prior until the DLA Forecast is wired.
    expect(r.legs.forwardDemand.state).toBe("PRIOR");
  });

  it("has award history but NO holder → WATCHLIST (disposition is driven by value now, not feasibility)", () => {
    // 08-28 doctrine: disposition = locked?SKIP : v==null?INSUFFICIENT : WATCHLIST. This row IS
    // priceable (v = 2.54 × 100), so it is a WATCHLIST, while the feasibility leg still honestly
    // abstains — the corner cannot be CONFIRMED fillable, and the leg says so, but that no longer
    // forces INSUFFICIENT_DATA. Only an unpriceable row abstains at the disposition level.
    const r = scoreCorner(baseRow(), awardWith({ holders: [] }));
    expect(r.legs.priceAnchor.state).toBe("MEASURED");
    expect(r.legs.feasibility.state).toBe("UNAVAILABLE");
    expect(r.disposition).toBe("WATCHLIST");
    expect(r.valueUsd).toBe(254);
  });

  it("every reason code is tagged measured or prior; the lockup verdict is a first-class field", () => {
    const r = scoreCorner(baseRow(), awardWith());
    expect(r.reasons.length).toBeGreaterThan(0);
    for (const rc of r.reasons) {
      expect(["measured", "prior"]).toContain(rc.calibration);
    }
    // The +25 sole-source and +10 "single company" concentration reasons are DELETED. The lockup
    // classifier replaces them: a sole row whose award history cannot be family-resolved fails
    // closed to WATCHLIST (never a licence lock we cannot prove), and it is shown, not hidden.
    expect(r.reasons.some((rc) => /single company/.test(rc.plain))).toBe(false);
    expect(r.lockup.status).toBe("watchlist");
    expect(r.lockup.hidden).toBe(false);
    expect(r.reasons.some((rc) => rc.leg === "lockup")).toBe(true);
  });

  it("score is bounded 0..100 and rises with more corroborating signals", () => {
    const weak = scoreCorner(baseRow({ soleSource: false, approvedSourceCount: 4, silentSourceCount: 0, automatedSolicitation: false }), null);
    const strong = scoreCorner(baseRow(), awardWith());
    expect(weak.scoreV0).toBeGreaterThanOrEqual(0);
    expect(strong.scoreV0).toBeLessThanOrEqual(100);
    expect(strong.scoreV0).toBeGreaterThan(weak.scoreV0);
  });
});

/*
 * SOURCE-STATE HONESTY. The scorer used to tell one lie in two places: an NSN absent from a
 * LOADED index read "not loaded"/"not connected", contradicting the very memo it appeared in
 * (the neighbouring sentence quoted live forecast data), and the same real-world state scored
 * PRIOR 0.5 or measured 0 depending on which sheet happened to mention the NSN. These pin the
 * fix: a checked absence is a measurement, and only a truly unloaded source leaves a prior.
 */
describe("scoreCorner source-state honesty: checked absence versus unloaded source", () => {
  it("forecast index loaded + NSN absent → forward demand is a MEASURED zero, and no 'not loaded' gap", () => {
    const r = scoreCorner(baseRow(), awardWith(), null, { forecastIndexLoaded: true, awardIndexLoaded: true });
    expect(r.legs.forwardDemand.state).toBe("MEASURED");
    expect(r.legs.forwardDemand.value).toBe(0);
    expect(r.dataGaps.join("\n")).not.toContain("DLA Forecast not loaded");
    expect(r.reasons.some((rc) => rc.plain.includes("checked absence"))).toBe(true);
  });

  it("PARITY: absent-from-export and onForecast:false are the same state and score the same", () => {
    const absent = scoreCorner(baseRow(), awardWith(), null, { forecastIndexLoaded: true, awardIndexLoaded: true });
    const seenButOff = scoreCorner(
      baseRow(),
      awardWith(),
      { nsn: "5325015619853", onForecast: false, forecast: [], totalForecastQty: 0, supplyChains: [], solicitationCount: 1, lastSolicitation: null, specCount: 0, endItems: [] },
      { forecastIndexLoaded: true, awardIndexLoaded: true },
    );
    expect(absent.legs.forwardDemand.state).toBe(seenButOff.legs.forwardDemand.state);
    expect(absent.legs.forwardDemand.value).toBe(seenButOff.legs.forwardDemand.value);
    expect(absent.scoreV0).toBe(seenButOff.scoreV0);
  });

  it("forecast index NOT loaded keeps the honest prior and the 'not loaded' gap", () => {
    const r = scoreCorner(baseRow(), awardWith(), null, {});
    expect(r.legs.forwardDemand.state).toBe("PRIOR");
    expect(r.dataGaps.join("\n")).toContain("DLA Forecast not loaded");
  });

  it("award index loaded + no awards → the pricing gap names a checked absence, never 'not ingested/loaded'", () => {
    const r = scoreCorner(baseRow(), null, null, { awardIndexLoaded: true });
    expect(r.legs.priceAnchor.state).toBe("UNAVAILABLE");
    const gaps = r.dataGaps.join("\n");
    expect(gaps).toContain("carries no price for this stock number");
    expect(gaps).not.toContain("award history not loaded");
    expect(gaps).not.toContain("not ingested");
  });

  it("award index loaded + no availability row → feasibility says so, and never claims the sheet is unconnected", () => {
    const r = scoreCorner(baseRow(), awardWith({ holders: [] }), null, { awardIndexLoaded: true, forecastIndexLoaded: true });
    expect(r.legs.feasibility.state).toBe("UNAVAILABLE");
    expect(r.legs.feasibility.because).toContain("loaded export");
    const gaps = r.dataGaps.join("\n");
    expect(gaps).toContain("no company lists stock for this stock number");
    expect(gaps).not.toContain("ILS availability not connected");
  });

  it("no flags at all preserves the original unconnected wording (an honest caller with no index in hand)", () => {
    const r = scoreCorner(baseRow(), null);
    const gaps = r.dataGaps.join("\n");
    expect(gaps).toContain("ILS availability not connected");
    expect(gaps).toContain("award history not loaded");
  });
});

/*
 * THE 08-28 REDESIGN INVARIANTS. Value is the spine, sole-source is inverted into a lockup GATE,
 * Wayne-held is a first-class boost, and the calibration must not silently regress. Every anchor
 * below was known before scoreCorner ran.
 */
// An award summary priced at a chosen unit price, with no escalation (first == last) and no
// surplus, so a case can isolate the value term. v = unitPrice × row.quantity (100 on baseRow).
const pricedAward = (unit: number, over: Partial<NsnAwardSummary> = {}): NsnAwardSummary =>
  awardWith({
    firstUnitPrice: unit,
    lastUnitPrice: unit,
    distinctAwardees: 1,
    awards: [award({ contractNo: "P1", awardDateIso: "2025-01-01", quantity: 100, unitPrice: unit, finalPrice: unit * 100, effectiveUnitPrice: unit })],
    latest: award({ contractNo: "P1", awardDateIso: "2025-01-01", quantity: 100, unitPrice: unit, finalPrice: unit * 100, effectiveUnitPrice: unit }),
    ...over,
  });

describe("08-28 redesign: value spine, lockup gate, Wayne boost", () => {
  it("a ~$132K competitive row outscores a ~$4,686 sole row (value is the spine, not sole-source)", () => {
    const competitive = scoreCorner(
      baseRow({ soleSource: false, approvedSourceCount: 3, silentSourceCount: 0 }),
      pricedAward(1320), // 1320 × 100 = $132,000
    );
    const sole = scoreCorner(baseRow(), pricedAward(46.86)); // 46.86 × 100 = $4,686
    expect(competitive.valueUsd).toBe(132000);
    expect(sole.valueUsd).toBeCloseTo(4686, 2);
    expect(competitive.scoreV0).toBeGreaterThan(sole.scoreV0);
    expect(competitive.rankKey).toBeGreaterThan(sole.rankKey);
    // The sub-$5K sole row earns ZERO value points; it cannot ride sole-source to the top.
    expect(sole.valueTier).toBe("noise");
    expect(competitive.valueTier).toBe("whale");
  });

  it("an AMC-5 row is LOCKED: disposition SKIP and lockup.hidden", () => {
    const r = scoreCorner(baseRow(), awardWith({ amc: "5" }));
    expect(r.lockup.status).toBe("locked");
    expect(r.lockup.hidden).toBe(true);
    expect(r.disposition).toBe("SKIP");
    // The −40 penalty is real: the same row without the AMC lock scores strictly higher.
    const unlocked = scoreCorner(baseRow(), awardWith({ amc: null }));
    expect(unlocked.rankKey).toBeGreaterThan(r.rankKey);
  });

  it("a surplus award on file OVERRIDES the AMC lock: shown, not hidden", () => {
    const surplusAward = award({ contractNo: "S1", awardDateIso: "2025-01-01", quantity: 100, finalPrice: 254, effectiveUnitPrice: 2.54, surplus: "Yes" });
    const r = scoreCorner(baseRow(), awardWith({ amc: "5", awards: [surplusAward], latest: surplusAward }));
    // Branch (1) fires before branch (2): a completed surplus award proves the door is open.
    expect(r.lockup.status).toBe("surplus_opportunity");
    expect(r.lockup.hidden).toBe(false);
    expect(r.disposition).not.toBe("SKIP");
  });

  it("a grounded OUTSIDER winning OVERRIDES the AMC lock: a proven-open door is shown, not hidden", () => {
    // 08-28 audit fix: AMC 4/5 was checked before the outsider-won test, so a non-approved CAGE that
    // had actually WON (as strong a proof the door is open as a surplus flag) was wrongly hidden.
    const family = buildCageFamilyIndex({
      companies: [
        { cage: "58794", company: "ACME" }, // the approved source on baseRow
        { cage: "99999", company: "OUTSIDER CORP" }, // a genuinely different corporate family
      ],
      associations: [],
    });
    const outsiderWin = award({ contractNo: "O1", awardDateIso: "2025-01-01", quantity: 100, finalPrice: 500, effectiveUnitPrice: 5, cage: "99999" });
    const r = scoreCorner(
      baseRow(),
      awardWith({ amc: "5", awards: [outsiderWin], latest: outsiderWin }),
      null,
      { awardIndexLoaded: true, cageFamily: family },
    );
    expect(r.lockup.status).toBe("surplus_opportunity");
    expect(r.lockup.hidden).toBe(false);
    expect(r.disposition).not.toBe("SKIP");
  });

  it("the lock penalty DOMINATES uncapped value: a $10M LOCKED row can never outrank an open row", () => {
    // 08-28 audit fix: value is uncapped, so the old fixed −40 let a high-value locked row land at a
    // positive rankKey and outrank open rows. The penalty now exceeds the max reachable score.
    const lockedWhale = scoreCorner(
      baseRow(),
      awardWith({
        amc: "5",
        firstUnitPrice: 100000,
        lastUnitPrice: 100000,
        latest: award({ contractNo: "W1", awardDateIso: "2025-01-01", quantity: 100, finalPrice: 10000000, effectiveUnitPrice: 100000 }),
      }),
    );
    const bareOpen = scoreCorner(baseRow({ soleSource: false, approvedSourceCount: 3, silentSourceCount: 0 }), pricedAward(1));
    expect(lockedWhale.lockup.hidden).toBe(true);
    expect(lockedWhale.valueUsd).toBe(10000000); // it IS a $10M part…
    expect(lockedWhale.rankKey).toBeLessThan(10); // …but it sinks below the demand floor, i.e. below EVERY open row
    expect(lockedWhale.rankKey).toBeLessThan(bareOpen.rankKey);
    expect(lockedWhale.scoreV0).toBe(0); // the clamp reads 0, never a misleading positive
  });

  it("a Wayne-CAGE holder (3BQS1) outranks its identical non-holder twin, by the boost alone", () => {
    const held = scoreCorner(baseRow(), awardWith({ holders: [{ nsn: "5325015619853", company: "WKF (FRIEDMAN) ENTERPRISES, INC.", cage: "3BQS1", quantity: 50 }] }));
    const twin = scoreCorner(baseRow(), awardWith({ holders: [{ nsn: "5325015619853", company: "SOMEONE ELSE", cage: "0AMA0", quantity: 50 }] }));
    expect(held.wayneHolds.held).toBe(true);
    expect(held.wayneHolds.units).toBe(50);
    expect(twin.wayneHolds.held).toBe(false);
    expect(held.scoreV0).toBeGreaterThan(twin.scoreV0);
    // Absence applies ZERO penalty: the two differ ONLY by the positive boost (10 + 18·0.5 = 19).
    expect(held.rankKey - twin.rankKey).toBeCloseTo(19, 5);
    // The badge shows units with NO price — the availability feed carries none, so none is invented.
    expect(held.wayneHolds.plain).not.toContain("$");
  });

  it("value is smooth at the $15K knee: $14,000 scores within one rankKey point of $15,001", () => {
    const at14 = scoreCorner(baseRow(), pricedAward(140)); // $14,000
    const at15 = scoreCorner(baseRow(), pricedAward(150.01)); // $15,001
    expect(at14.valueUsd).toBe(14000);
    expect(at15.valueUsd).toBeCloseTo(15001, 2);
    expect(Math.abs(at15.rankKey - at14.rankKey)).toBeLessThan(1);
  });

  it("value is monotonic with NO ceiling, and diminishing (a $1M row beats $250K by < 4 pts)", () => {
    const at250k = scoreCorner(baseRow(), pricedAward(2500)); // $250,000
    const at1m = scoreCorner(baseRow(), pricedAward(10000)); // $1,000,000
    const at130k = scoreCorner(baseRow(), pricedAward(1300)); // $130,000
    expect(at1m.rankKey).toBeGreaterThan(at250k.rankKey);
    expect(at250k.rankKey).toBeGreaterThan(at130k.rankKey);
    expect(at1m.rankKey - at250k.rankKey).toBeLessThan(4);
  });

  it("FAIL-CLOSED: with no cage-family index, a would-be OEM lock is NOT declared locked", () => {
    // baseRow is sole, and every award went to the approved CAGE 58794 (an OEM-lock shape).
    const withoutFamily = scoreCorner(baseRow(), awardWith(), null, {});
    expect(withoutFamily.lockup.status).not.toBe("locked");
    expect(withoutFamily.disposition).not.toBe("SKIP");

    // WITH a grounded resolver that places every winner in the approved family, it locks.
    const family = buildCageFamilyIndex({ companies: [{ cage: "58794", company: "ACME" }], associations: [] });
    const withFamily = scoreCorner(baseRow(), awardWith(), null, { cageFamily: family });
    expect(withFamily.lockup.status).toBe("locked");
    expect(withFamily.disposition).toBe("SKIP");
  });

  it("an unpriceable row abstains at INSUFFICIENT_DATA with valueTier 'insufficient', never 0", () => {
    const r = scoreCorner(baseRow(), null, null, { awardIndexLoaded: true });
    expect(r.valueUsd).toBeNull();
    expect(r.valueTier).toBe("insufficient");
    expect(r.disposition).toBe("INSUFFICIENT_DATA");
  });

  /* --------------------------------------------------------------------------------------
   * THE DECOMPOSITION MUST RECONCILE WITH THE SORT KEY.
   *
   * The scorer subtracted 1000 for a lockup, rendered a ReasonCode that said -40, and carried a
   * prose formula that also said 40. Three numbers for one term. The operator reads the reason
   * codes to understand the score, so a decomposition that cannot be added back up to the key the
   * sort used is the product's central claim about itself failing quietly. These pin the identity
   * rather than the constant, so raising or lowering LOCK_PENALTY stays a one-line change.
   * -------------------------------------------------------------------------------------- */
  const lockedFixture = () => {
    const family = buildCageFamilyIndex({ companies: [{ cage: "58794", company: "ACME" }], associations: [] });
    return scoreCorner(baseRow(), awardWith(), null, { cageFamily: family });
  };

  it("the rendered lockup ReasonCode reports the SAME magnitude rankKey subtracts", () => {
    const locked = lockedFixture();
    expect(locked.lockup.status).toBe("locked");
    const leg = locked.reasons.find((r) => r.leg === "lockup");
    expect(leg).toBeDefined();
    // Not "is negative" and not "equals -1000": it must equal the term the key actually used.
    expect(leg!.points).toBe(-LOCK_PENALTY);
  });

  it("the reason codes SUM to rankKey, so the operator can add the score up by hand", () => {
    for (const r of [lockedFixture(), scoreCorner(baseRow(), pricedAward(2500))]) {
      const summed = r.reasons.reduce((acc, leg) => acc + leg.points, 0);
      // The legs are the whole key. If a term ever moves outside the decomposition, this fails.
      expect(summed).toBeCloseTo(r.rankKey, 6);
    }
  });

  it("NO locked row can outrank ANY open row, whatever it is worth (David: never rank a lockup high)", () => {
    // The worst open row reachable: unpriceable, no wayne holding, no corner signals.
    const worstOpen = scoreCorner(baseRow({ soleSource: false, approvedSourceCount: 4 }), null, null, {
      awardIndexLoaded: true,
    });
    // The best locked row reachable: a $10M buy, which earns the most value points the ramp emits.
    const family = buildCageFamilyIndex({ companies: [{ cage: "58794", company: "ACME" }], associations: [] });
    const bestLocked = scoreCorner(baseRow(), pricedAward(100000), null, { cageFamily: family });
    expect(bestLocked.lockup.status).toBe("locked");
    expect(bestLocked.valueUsd).toBe(10000000);
    expect(bestLocked.rankKey).toBeLessThan(worstOpen.rankKey);
    // And the penalty must dominate by construction, not by luck on this fixture: every positive
    // term is bounded by the demand floor + the uncapped value ramp + wayne + the 30-point bucket.
    expect(LOCK_PENALTY).toBeGreaterThan(10 + valuePoints(10000000) + 30 + 30);
  });

  it("a locked row still clamps to scoreV0 0 and never reports a negative score to the operator", () => {
    const locked = lockedFixture();
    expect(locked.rankKey).toBeLessThan(0);
    expect(locked.scoreV0).toBe(0);
    expect(locked.disposition).toBe("SKIP");
  });
});
