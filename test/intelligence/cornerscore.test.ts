import { describe, it, expect } from "vitest";
import { classifyInstrument, offersDescribeThisAward } from '@/lib/intelligence/awards/parent-child'
import { scoreCorner } from "@/lib/intelligence/scoring/cornerscore";
import { gradeFrom, measured, prior, unavailable } from "@/lib/intelligence/scoring/evidence-state";
import type { CornerRow } from "@/lib/intelligence/corner";
import type { AwardRecord, NsnAwardSummary } from "@/lib/intelligence/awards/nsn-now";
import { rollUpSurplus } from "@/lib/intelligence/awards/surplus";

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

  it("has award history but NO holder → INSUFFICIENT_DATA (cannot confirm the corner is fillable)", () => {
    const r = scoreCorner(baseRow(), awardWith({ holders: [] }));
    expect(r.legs.priceAnchor.state).toBe("MEASURED");
    expect(r.legs.feasibility.state).toBe("UNAVAILABLE");
    expect(r.disposition).toBe("INSUFFICIENT_DATA");
  });

  it("every reason code is tagged measured or prior; measured reasons trace to a fact", () => {
    const r = scoreCorner(baseRow(), awardWith());
    expect(r.reasons.length).toBeGreaterThan(0);
    for (const rc of r.reasons) {
      expect(["measured", "prior"]).toContain(rc.calibration);
    }
    // the sole-awardee bonus fired because distinctAwardees === 1
    expect(r.reasons.some((rc) => /single company/.test(rc.plain))).toBe(true);
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
