/**
 * CORNERSCORE v0 — the launch-honest opportunity score.
 *
 * Implements the buildable-today core of the ONLYSOURCE scoring methodology
 * (_intel/scoring-methodology.md). At launch this is deliberately NOT a calibrated probability or
 * a dollar EV: there are ~0 resolved multi-year outcomes, so per §2.4 every corner is confidence
 * grade C/D and its disposition is WATCHLIST, not FLAG. What ships now is the v0 integer scorecard
 * (the SLIM, napkin-auditable surface Wayne's successors actually read) computed from what the
 * live data can support, wrapped in the Evidence-State Contract so no missing leg is faked.
 *
 * WHAT THIS IS BETTER AT THAN A HUMAN HEURISTIC, even at v0:
 *   - it is computed over the WHOLE corner map, not a sampled handful;
 *   - every point traces to an observed fact or is marked PRIOR and sent to a watchlist;
 *   - it carries its own reason codes and data gaps, so it is auditable rather than intuited.
 *
 * WHAT IT DOES NOT DO YET, and says so: no win probability (λ is unobservable at scale until the
 * private UBR corpus accrues — §3.1), no calibrated EV (no resolved outcomes), no feasibility
 * confirmation (no ILS/FLIS). Those legs render UNAVAILABLE/PRIOR, which caps the grade honestly.
 */
import type { CornerRow } from "@/lib/intelligence/corner";
import type { NsnAwardSummary } from "@/lib/intelligence/awards/nsn-now";
import type { ForecastSummary } from "@/lib/intelligence/forecast/dla-forecast";
import {
  measured,
  prior,
  unavailable,
  gradeFrom,
  type Leg,
  type ConfidenceGrade,
  type Disposition,
} from "./evidence-state";

export type ReasonCode = {
  /** Which leg or signal this reason belongs to. */
  leg: string;
  /**
   * Which SIGNAL within the leg, when a leg contributes more than one. Surfaces render it as
   * "Price anchor · trend" so two cards for one leg never carry the same title, and the
   * five-leg claim reconciles with the card count instead of contradicting it.
   */
  facet?: string;
  /** Plain language, decomposing the ranked quantity — never a bare number. */
  plain: string;
  /** Points this signal contributed to the v0 scorecard (may be 0 for context-only reasons). */
  points: number;
  /** Whether this reason is backed by a measurement or is a prior. */
  calibration: "measured" | "prior";
};

export type CornerScoreResult = {
  nsn: string;
  /** The v0 integer scorecard, 0..100. An ORDINAL watchlist rank, not a probability or a dollar. */
  scoreV0: number;
  disposition: Disposition;
  grade: ConfidenceGrade;
  /** The five legs, each carrying its own evidence state. */
  legs: {
    demand: Leg<number>;
    competition: Leg<number>;
    priceAnchor: Leg<number>;
    forwardDemand: Leg<number>;
    feasibility: Leg<number>;
  };
  reasons: ReasonCode[];
  /** Never empty by omission: what a full score is still waiting on for THIS NSN. */
  dataGaps: string[];
};

/**
 * Score one corner. Pure: (row, its award history) -> result. No I/O, so it is trivially testable
 * and the surface can call it per row.
 */
export function scoreCorner(
  row: CornerRow,
  award: NsnAwardSummary | null,
  forecast: ForecastSummary | null = null,
): CornerScoreResult {
  const reasons: ReasonCode[] = [];
  const dataGaps: string[] = [];
  let points = 0;
  const add = (n: number) => (points += n);

  // ---- DEMAND (ρ): MEASURED. The NSN is under open DLA demand — it is in today's index. ----
  const demand = measured(
    1,
    0.9,
    "under open DLA demand in today's requirement index",
  );
  add(20);
  reasons.push({ leg: "demand", plain: "DLA is actively buying this now", points: 20, calibration: "measured" });

  // ---- COMPETITION (W): from the approved-source count + historical awardee concentration. ----
  // Sole-source with demand is the corner itself; a single historical awardee compounds it.
  let competition: Leg<number>;
  if (row.soleSource) {
    add(25);
    reasons.push({ leg: "competition", plain: "exactly one approved source may make it", points: 25, calibration: "measured" });
    if (award && award.awards.length >= 3 && award.distinctAwardees === 1) {
      add(10);
      reasons.push({
        leg: "competition",
        facet: "concentration",
        plain: `every one of ${award.awards.length} past awards went to a single company (CAGE ${award.latest?.cage ?? "?"})`,
        points: 10,
        calibration: "measured",
      });
      competition = measured(1, 0.85, "sole approved source and sole historical awardee");
    } else {
      competition = measured(0.7, 0.6, "sole approved source; award-concentration not yet loaded");
      if (!award) dataGaps.push("award history not loaded, so sole-awardee concentration cannot be confirmed");
    }
  } else {
    competition = measured(0.2, 0.5, `${row.approvedSourceCount} approved sources: competitive`);
    reasons.push({ leg: "competition", plain: `${row.approvedSourceCount} approved sources: this is competitive, not a corner`, points: 0, calibration: "measured" });
  }

  // ---- SOURCE SILENCE: the award-silent signal (a measurement, never a death claim). ----
  if (row.silentSourceCount > 0) {
    add(15);
    reasons.push({
      leg: "competition",
      facet: "award silence",
      plain: "the approved source has no recorded prime award in two years (a silence signal, not a death notice)",
      points: 15,
      calibration: "measured",
    });
  }

  // ---- AWARD PATH: machine award on price alone is the shape a corner monetizes through. ----
  if (row.automatedSolicitation === true) {
    add(10);
    reasons.push({ leg: "path", plain: "awarded by machine on price alone (T/U ninth character)", points: 10, calibration: "measured" });
  }

  // ---- PRICE ANCHOR (m): MEASURED where we have award history; the rent signal is escalation. ----
  let priceAnchor: Leg<number>;
  if (award?.latest?.effectiveUnitPrice != null) {
    const last = award.latest.effectiveUnitPrice;
    const first = award.firstUnitPrice;
    priceAnchor = measured(last, 0.8, `last award ${fmt(last)}`);
    if (first != null && last > first) {
      const pct = Math.round(((last - first) / first) * 100);
      // Escalation to a single source is the rent signal Wayne prices off. Bounded contribution.
      const pts = Math.min(15, Math.round(pct / 10));
      add(pts);
      reasons.push({
        leg: "priceAnchor",
        facet: "trend",
        plain: `unit price rose ${pct.toLocaleString()}% over the award history (${fmt(first)} → ${fmt(last)})`,
        points: pts,
        calibration: "measured",
      });
    }
    // Surplus-drag context (the flat $200 evaluated adder matters most on small single-unit buys).
    if (row.quantity && row.quantity > 0) {
      const drag = 200 / (last * row.quantity);
      reasons.push({
        leg: "priceAnchor",
        facet: "surplus drag",
        plain: `surplus evaluated-drag is ${(drag * 100).toFixed(drag < 0.01 ? 2 : 1)}% of the buy, ${drag < 0.02 ? "negligible" : "meaningful"}`,
        points: 0,
        calibration: "measured",
      });
    }
  } else {
    priceAnchor = unavailable("no award history ingested for this NSN yet");
    dataGaps.push("award price not ingested for this NSN, so the pricing leg abstains");
  }

  // ---- FORWARD DEMAND (ρ_forward): MEASURED when the NSN is on the government's own DLA Forecast.
  // A sole-source, award-silent part that the buyer has SAID it will purchase again is the
  // strongest signal on this page: demand is not inferred, it is stated. Off the forecast, the
  // leg is a prior (absence from the forecast is not proof of no future demand).
  let forwardDemand: Leg<number>;
  if (forecast?.onForecast) {
    forwardDemand = measured(
      1,
      0.9,
      `on the DLA Forecast${forecast.totalForecastQty > 0 ? `, ${forecast.totalForecastQty.toLocaleString()} units` : ""}${forecast.supplyChains.length ? ` (${forecast.supplyChains.join(", ")})` : ""}`,
    );
    add(15);
    reasons.push({
      leg: "forwardDemand",
      plain: `the government's own DLA Forecast lists this part for a future buy${forecast.totalForecastQty > 0 ? ` of ${forecast.totalForecastQty.toLocaleString()} units` : ""}`,
      points: 15,
      calibration: "measured",
    });
  } else if (forecast) {
    forwardDemand = measured(0, 0.5, "not on the current DLA Forecast");
    reasons.push({
      leg: "forwardDemand",
      plain: "not on the current DLA Forecast (a checked absence, not a gap)",
      points: 0,
      calibration: "measured",
    });
  } else {
    forwardDemand = prior(0.5, "forward demand is a prior until the DLA Forecast is loaded");
    dataGaps.push("DLA Forecast not loaded, so the forward-demand leg is a prior, not a measurement");
  }
  // Solicitation recurrence, a supporting signal: a part re-solicited many times is re-bought often.
  if (forecast && forecast.solicitationCount >= 5) {
    add(5);
    reasons.push({
      leg: "forwardDemand",
      facet: "recurrence",
      plain: `re-solicited ${forecast.solicitationCount} times: a recurring buy`,
      points: 5,
      calibration: "measured",
    });
  }

  // ---- FEASIBILITY (φ): the unread leg. NSN-Now availability where present, else UNAVAILABLE. --
  let feasibility: Leg<number>;
  if (award && award.holders.length > 0) {
    const units = award.holders.reduce((s, h) => s + (h.quantity ?? 0), 0);
    feasibility = measured(
      Math.min(1, units / Math.max(1, row.quantity ?? 1)),
      0.4,
      `${award.holders.length} holder(s) list stock in NSN-Now (self-reported, not ILS-confirmed)`,
    );
    reasons.push({
      leg: "feasibility",
      plain: `${award.holders.length} supplier(s) list ${units.toLocaleString()} units (self-reported; ILS not yet confirmed)`,
      points: 0,
      calibration: "measured",
    });
  } else {
    feasibility = unavailable("no availability feed connected (ILS not wired)");
    dataGaps.push("ILS availability not connected, so the feasibility leg abstains and a corner cannot be CONFIRMED");
  }

  // ---- DISPOSITION via the Evidence-State decision table (§2.3), first match wins. ----
  // Win-probability is not modeled at v0 (λ unobservable at scale), so the driving quantity for a
  // corner is PRIOR by construction → WATCHLIST, never FLAG. Feasibility UNAVAILABLE → the corner
  // cannot be confirmed. This is the honest launch posture, not a limitation to paper over.
  const loadBearing = [demand, competition, priceAnchor, feasibility];
  const grade = gradeFrom(loadBearing);
  let disposition: Disposition;
  if (feasibility.state === "UNAVAILABLE" || priceAnchor.state === "UNAVAILABLE") {
    disposition = "INSUFFICIENT_DATA";
  } else {
    // Everything measured that CAN be, but win-probability is still PRIOR at launch.
    disposition = "WATCHLIST";
  }

  return {
    nsn: row.nsn,
    scoreV0: Math.max(0, Math.min(100, points)),
    disposition,
    grade,
    legs: { demand, competition, priceAnchor, forwardDemand, feasibility },
    reasons,
    dataGaps,
  };
}

function fmt(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
