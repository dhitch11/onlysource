import { describe, it, expect } from "vitest";
import { scoreCorner } from "@/lib/intelligence/scoring/cornerscore";
import { gradeFrom, measured, prior, unavailable } from "@/lib/intelligence/scoring/evidence-state";
import type { CornerRow } from "@/lib/intelligence/corner";
import type { NsnAwardSummary } from "@/lib/intelligence/awards/nsn-now";

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
  availability: "unknown_credential_absent",
  legsEstablished: 2,
  gaps: [],
  ...over,
});

const awardWith = (over: Partial<NsnAwardSummary> = {}): NsnAwardSummary => ({
  nsn: "5325015619853",
  awards: [
    { nsn: "5325015619853", contractNo: "C1", awardDateIso: "2016-01-01", quantity: 300, unitPrice: 1.48, company: "ACME", cage: "58794", finalPrice: 444, effectiveUnitPrice: 1.48 },
    { nsn: "5325015619853", contractNo: "C1b", awardDateIso: "2020-01-01", quantity: 200, unitPrice: 2.0, company: "ACME", cage: "58794", finalPrice: 400, effectiveUnitPrice: 2.0 },
    { nsn: "5325015619853", contractNo: "C2", awardDateIso: "2025-01-01", quantity: 100, unitPrice: 2.54, company: "ACME", cage: "58794", finalPrice: 254, effectiveUnitPrice: 2.54 },
  ],
  latest: { nsn: "5325015619853", contractNo: "C2", awardDateIso: "2025-01-01", quantity: 100, unitPrice: 2.54, company: "ACME", cage: "58794", finalPrice: 254, effectiveUnitPrice: 2.54 },
  distinctAwardees: 1,
  firstUnitPrice: 1.48,
  lastUnitPrice: 2.54,
  holders: [{ nsn: "5325015619853", company: "HOLDER", cage: "0AMA0", quantity: 3333 }],
  ...over,
});

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
