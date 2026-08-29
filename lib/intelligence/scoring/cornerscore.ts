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
import type { AwardeeVerdict } from "@/lib/intelligence/suppliers/classify";
import type { CageFamilyIndex } from "./cage-family";
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
    /**
     * The operator's own declared NUMBER ONE signal: was the last supplier a surplus dealer.
     * Sixth leg, added after a source-fidelity audit found the served score ranked his SECONDARY
     * dormancy idea while this one sat encoded and unwired. It abstains far more often than it
     * fires, because the government Surplus cell is read on 0.73% of the award history, and that
     * abstention is the honest state rather than a gap to be filled.
     */
    surplusLineage: Leg<number>;
  };
  reasons: ReasonCode[];
  /** Never empty by omission: what a full score is still waiting on for THIS NSN. */
  dataGaps: string[];
};

/**
 * WHICH SOURCES WERE LOADED when this row was scored. Without it the scorer cannot tell
 * "the index is not on disk" apart from "the index is loaded and this NSN is absent from it",
 * and it shipped gap strings that lied about the build: an NSN missing from the loaded
 * forecast read "DLA Forecast not loaded" while the forecast was serving 300-unit reads one
 * row over, and the same memo carried both halves of the contradiction. A checked absence is
 * a MEASUREMENT; only a truly unloaded source leaves a leg on a prior.
 */
export type ScoreSourceState = {
  /** True when the NSN-Now award/availability index was loaded and this NSN was looked up in it. */
  awardIndexLoaded?: boolean;
  /** True when the NSN-Now forecast/RFQ index was loaded and this NSN was looked up in it. */
  forecastIndexLoaded?: boolean;
  /**
   * The corporate-family resolver, when the caller loaded one.
   *
   * ★ PASSED IN RATHER THAN IMPORTED, so `scoreCorner` stays pure. It is a function of its
   * arguments and does no I/O, which is what makes it trivially testable and callable per row.
   *
   * ⛔ ABSENT MEANS THE SILENCE LEG WITHHOLDS. It does NOT mean "fall back to comparing one
   * CAGE string": single-CAGE comparison IS the defect. A caller that has no index has not
   * established silence, and an unestablished signal is not paid.
   */
  cageFamily?: CageFamilyIndex | null;
  /**
   * The instant "expired" is judged against. Defaults to today. Exposed so a test can pin it:
   * an assertion whose expected value drifts with the wall clock is not an assertion.
   */
  asOfIso?: string;
};

/**
 * Score one corner. Pure: (row, its award history) -> result. No I/O, so it is trivially testable
 * and the surface can call it per row. `sources` says which indexes the caller actually loaded;
 * omitted flags are treated as not-loaded, which keeps the prior/unavailable wording honest for
 * a caller that genuinely had no index in hand.
 */
export function scoreCorner(
  row: CornerRow,
  award: NsnAwardSummary | null,
  forecast: ForecastSummary | null = null,
  sources: ScoreSourceState = {},
  lastAwardee: AwardeeVerdict | null = null,
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
    } else if (award || sources.awardIndexLoaded) {
      // The award index was consulted; this NSN just has too few (or zero) recorded awards.
      competition = measured(0.7, 0.6, "sole approved source; too little recorded award history to read concentration");
      if (!award)
        dataGaps.push(
          "no recorded award in the loaded export for this stock number, so sole-awardee concentration cannot be confirmed",
        );
    } else {
      competition = measured(0.7, 0.6, "sole approved source; award history not loaded");
      dataGaps.push("award history not loaded, so sole-awardee concentration cannot be confirmed");
    }
  } else {
    competition = measured(0.2, 0.5, `${row.approvedSourceCount} approved sources: competitive`);
    reasons.push({ leg: "competition", plain: `${row.approvedSourceCount} approved sources: this is competitive, not a corner`, points: 0, calibration: "measured" });
  }

  /* ------------------------------------------------------------------------------------
   * SOURCE SILENCE: the award-silent signal (a measurement, never a death claim).
   *
   * ★ THIS LEG COMPARED ONE CAGE STRING AND WAS WRONG BY +15 ON A LIVE CALL. Fixed 2026-08-24.
   *
   * On NSN 5340-01-608-5969 the approved source is CAGE 49956, RAYTHEON COMPANY DIV CORP of
   * Arlington VA, the registration that holds the drawing and never contracts. Every one of the
   * six awards went to CAGE 54X10, RAYTHEON COMPANY of Fairdale KY, the plant. The maker never
   * went silent. The row scored +15 for that silence AND +10 for "every one of 6 past awards
   * went to a single company (54X10)" in the same breath, which is a contradiction the moment
   * you know both CAGEs are Raytheon.
   *
   * A registration is not a plant. Two things sharing a name are not the same thing, and its
   * converse bit us here: two things NOT sharing a CAGE can be one company.
   *
   * SO SILENCE NOW MEANS: no award on this stock number went to ANY CAGE in the approved
   * source's corporate family. That is POSITIVE, measured evidence of activity, read off the
   * award rows this dossier already holds, rather than an inference from a list.
   *
   * THE FORKS, ALL RULED EXPLICITLY, ALL FAILING CLOSED:
   *   - no resolver loaded          -> withhold, and say so in dataGaps
   *   - approved CAGE absent        -> withhold, and log the miss (a counted, greppable line)
   *   - a family member won here    -> withhold, and say who won
   *   - resolver says distinct      -> pay, this is a real silence
   * ------------------------------------------------------------------------------------ */
  if (row.silentSourceCount > 0) {
    const family = sources.cageFamily ?? null;
    const approved = row.approvedSources.filter((c) => (c ?? "").trim() !== "");
    const winners = [
      ...new Set((award?.awards ?? []).map((a) => (a.cage ?? "").trim().toUpperCase()).filter((c) => c !== "")),
    ];

    if (!family) {
      dataGaps.push(
        "the corporate CAGE index is not loaded, so award silence cannot be checked against the approved source's corporate family and this leg withholds its points rather than crediting a silence it cannot ground",
      );
      reasons.push({
        leg: "competition",
        facet: "award silence",
        plain:
          "the approved source is on the award-silence list, but the corporate CAGE index is not loaded, so this cannot be separated from a sibling registration still winning awards. No points credited.",
        points: 0,
        calibration: "measured",
      });
    } else {
      // Which approved CAGEs could not be grounded at all, and which winners are family.
      const ungrounded: string[] = [];
      const familyWinners: string[] = [];
      for (const src of approved) {
        const r = family.resolve(src);
        if (r.state === "absent") {
          ungrounded.push(src);
          /*
           * A counted, greppable line. The fork is ruled (no credit) and the miss is VISIBLE,
           * because a fail-closed branch nobody can see firing is indistinguishable from a
           * branch that never fires.
           */
          // eslint-disable-next-line no-console
          console.warn(`silence-leg: CAGE ${src} absent from cage-index, silence credit withheld`);
          continue;
        }
        for (const w of winners) {
          if (family.sameFamily(src, w).verdict === "same_family") familyWinners.push(w);
        }
      }

      if (ungrounded.length > 0) {
        dataGaps.push(
          `approved source CAGE ${ungrounded.join(", ")} is absent from the corporate CAGE index, so its award silence cannot be grounded and this leg withholds its points`,
        );
        reasons.push({
          leg: "competition",
          facet: "award silence",
          plain: `the approved source CAGE ${ungrounded.join(", ")} is not in the corporate index, so a sibling registration winning awards cannot be ruled out. No points credited.`,
          points: 0,
          calibration: "measured",
        });
      } else if (familyWinners.length > 0) {
        const who = [...new Set(familyWinners)].join(", ");
        reasons.push({
          leg: "competition",
          facet: "award silence",
          plain: `the approved source has no prime award of its own, but the same corporate family won this stock number under CAGE ${who}. The maker is active, so no silence bonus is credited.`,
          points: 0,
          calibration: "measured",
        });
      } else {
        add(15);
        reasons.push({
          leg: "competition",
          facet: "award silence",
          plain:
            "no CAGE in the approved source's corporate family has a recorded prime award on this stock number (a silence signal, not a death notice)",
          points: 15,
          calibration: "measured",
        });
      }
    }
  }

  // ---- AWARD PATH: machine award on price alone is the shape a corner monetizes through. ----
  if (row.automatedSolicitation === true) {
    add(10);
    reasons.push({ leg: "path", plain: "awarded by machine on price alone (T/U ninth character)", points: 10, calibration: "measured" });
  }

  /* ------------------------------------------------------------------------------------
   * LONG-TERM CONTRACT EXPIRY. Rendered as a FACT, scored at ZERO. Added 2026-08-24 (H10).
   *
   * ★ A FIELD INHERITED FROM A PARENT ROW IS NOT A MEASUREMENT OF THE CHILD, and the LTC date
   * is the most parent-shaped field on the sheet: it describes the VEHICLE, not the delivery
   * order the row happens to be. So it is read at the stock-number grain off the award summary,
   * never as a per-order fact, and it is never multiplied by the number of orders under it.
   *
   * ⛔ WHY ZERO AND NOT A NUMBER, WITH THE MEASUREMENT ATTACHED. The handoff set the ship bar
   * BEFORE the result was seen: n >= 200 treatment NSNs with a post-expiry buy, and a >= 5pp
   * treatment-over-control gap holding across BOTH outcome definitions.
   * Measured 2026-08-24 by `scripts/h10/backtest-ltc.mts` over the 10-year served corpus
   * (2016-01-03 to 2026-01-29, 42,698 award rows, 21,898 carrying an LTC date):
   *
   *   TREATMENT  buys after LTC expiry     81 NSNs    707 buys   newFamily 53.04%  competed 84.58%
   *   CONTROL A  same NSNs, vehicle live  305 NSNs 12,738 buys   newFamily 10.83%  competed 18.40%
   *   CONTROL B  sole NSNs, no LTC date   784 NSNs 10,502 buys   newFamily 39.89%  competed 94.90%
   *
   * TWO REASONS THE BAR IS NOT MET, and neither is "the effect looks small":
   *   1. n = 82 treatment NSNs against a bar of 200, and the CORPUS CANNOT REACH 200 - dropping
   *      the sole-source filter entirely still yields only 172. The ceiling is the data, not the
   *      predicate (verified by `scripts/h10/probe-ltc-population.mts`, because a threshold
   *      sitting above its own input reports a defect in working code).
   *   2. THE "COMPETED INSTRUMENT" OUTCOME IS CONFOUNDED AND CANNOT DISCRIMINATE. While a
   *      vehicle is live, buys flow under it as delivery orders BY CONSTRUCTION, so Control A's
   *      18.40% is a tautology rather than a finding. Control B settles it: sole-source items
   *      with no LTC at all compete at 94.90%, HIGHER than the treatment group's 84.58%. A true
   *      fact that is true in both worlds is not evidence.
   *
   * The newFamily cut does look directionally real (+13.15pp over Control B, the honest control),
   * and that is exactly why it is written down rather than spent: it is a reason to re-measure
   * when the corpus grows, not a licence to pay points now. A preset without its record is how
   * the 3x rule shipped behind a "High confidence" label.
   * ------------------------------------------------------------------------------------ */
  {
    const ltc = award?.ltcExpirationIso ?? null;
    if (ltc) {
      /*
       * ★ "HAS LAPSED" IS A CLAIM ABOUT TODAY, SO IT NEEDS AN AS-OF DATE THAT WAS PASSED IN.
       *
       * This read `sources.asOfIso ?? new Date()...`. The injection point existed and NOTHING
       * EVER PASSED IT — no caller in lib/, app/ or test/ supplied `asOfIso` — so the fallback
       * was the only path that ever ran, and the lapse verdict was decided by whatever clock
       * happened to be running. Across the server/client boundary those are two different
       * clocks, and one midnight apart they disagree: the server renders "has lapsed" and the
       * client hydrates "expires", which is a React #418 that only production shows. R0.3 exists
       * because this repo has been burned by that three times.
       *
       * So the undated branch no longer guesses. It states the date the government recorded and
       * declines the lapse verdict, in the same shape as every other fork in this file: withhold,
       * and say why. Both branches still score ZERO — the LTC backtest did not clear its ship bar
       * (n=82 against a bar of 200), so nothing here moves a score either way, and this changes
       * only which sentence an operator reads.
       */
      const asOf = sources.asOfIso ?? null;
      if (asOf === null) {
        dataGaps.push(
          "no as-of date was supplied to the scorer, so a long-term contract's expiry is reported as the recorded date without a lapsed/current verdict",
        );
      }
      const lapsed = asOf === null ? null : ltc < asOf;
      reasons.push({
        leg: "path",
        facet: "ltc expiry",
        plain:
          lapsed === null
            ? `long-term contract expiry on file is ${ltc}; whether it has lapsed is not stated because no as-of date was supplied (recorded, not scored)`
            : lapsed
              ? `long-term contract expired ${ltc}; the vehicle has lapsed (recorded, not scored: the backtest did not clear its ship bar, n=82 against a bar of 200)`
              : `long-term contract expires ${ltc} (recorded, not scored)`,
        points: 0,
        calibration: "measured",
      });
    }
  }

  // ---- PRICE ANCHOR (m): MEASURED where we have award history; the rent signal is escalation. ----
  let priceAnchor: Leg<number>;
  if (award?.priceScaleSuspect) {
    /*
     * THE WHOLE PRICING LEG ABSTAINS ON A SERIES WITH A DECIMAL SHIFT, ANCHOR AND TREND BOTH.
     *
     * The trend was the loud half: an 18,271% ramp cleared `min(15, pct / 10)` outright, so the
     * one stock number whose trend is an artifact collected the maximum trend contribution the
     * score can award. The anchor is the quiet half and matters just as much, because
     * `measured(last, 0.8, ...)` would have anchored the leg to $1,826.06 and printed it as the
     * last award, which is a measured-looking number sitting on the wrong side of the shift.
     *
     * `unavailable` and not a zero: a zero is a score, and this is a refusal to score.
     */
    priceAnchor = unavailable("the award series carries a decimal shift, so no price could be trusted");
    reasons.push({
      leg: "priceAnchor",
      facet: "trend",
      plain: `price trend not scored: ${award.priceScaleSuspect.sentence}`,
      points: 0,
      calibration: "measured",
    });
    dataGaps.push(
      "the award series for this stock number changes scale by a factor of ten inside one contract, so the pricing leg abstains",
    );
  } else if (award?.latest?.effectiveUnitPrice != null) {
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
  } else if (sources.awardIndexLoaded) {
    // A checked absence: the export is loaded and carries no priced award for this NSN.
    priceAnchor = unavailable("no recorded award price in the loaded export for this NSN");
    dataGaps.push(
      "the loaded award history carries no price for this stock number, so the pricing leg abstains",
    );
  } else {
    priceAnchor = unavailable("award history not loaded, so no price could be read for this NSN");
    dataGaps.push("award history not loaded, so the pricing leg abstains");
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
  } else if (sources.forecastIndexLoaded) {
    /*
     * The forecast index only materialises a summary for NSNs its sheets mention, so an NSN
     * absent from the whole export arrives here as null EVEN THOUGH the forecast was loaded
     * and checked. That is the same real-world state as the branch above (the government did
     * not list it) and it scores the same measured zero. It used to fall to the prior branch
     * below and claim "DLA Forecast not loaded" inside a memo whose neighbouring sentence
     * read live forecast data, and to score 0.5 while its RFQ-seen sibling scored 0.
     */
    forwardDemand = measured(0, 0.5, "not on the current DLA Forecast (checked against the loaded export)");
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
  } else if (sources.awardIndexLoaded) {
    // The availability sheet was loaded and checked; nobody lists stock for THIS NSN. ILS is a
    // separate, genuinely unwired source, and the wording keeps the two facts apart.
    feasibility = unavailable("no availability row for this NSN in the loaded export, and ILS is not wired");
    dataGaps.push(
      "no company lists stock for this stock number in the export, and ILS is not connected, so the feasibility leg abstains and a corner cannot be CONFIRMED",
    );
  } else {
    feasibility = unavailable("no availability feed connected (ILS not wired)");
    dataGaps.push("ILS availability not connected, so the feasibility leg abstains and a corner cannot be CONFIRMED");
  }

  /* ------------------------------------------------------------------------------------
   * SURPLUS LINEAGE: the operator's OWN declared number-one signal, and it was never scored.
   *
   * His rubric, recorded verbatim in `_intel/access-and-systems.md`: "Last Supplier was a
   * surplus supplier -> higher win probability", and he says he sorts every match report by
   * previous supplier to find it. The product scored sole-source and award-silence instead,
   * which is his SECONDARY dormancy idea, and read the surplus flag only in the pricing path.
   * So the board he opens every morning ranked on a thesis he did not name first.
   *
   * ★ IT FIRES ON A MEASUREMENT OR NOT AT ALL. The verdict carries `measured` (the government
   * award record) and `prior` (the researcher's book) as SEPARATE types precisely so the second
   * cannot pose as the first. Points come only from `measured` with at least one award whose
   * Surplus cell actually read yes. The book's label never scores; it renders as context.
   *
   * ★★ AND THE HONEST PART, WHICH IS THE WHOLE REASON THIS LEG ABSTAINS SO OFTEN. Measured over
   * the live award history: 42,698 award rows, Surplus cell READ on 311 of them, a fill rate of
   * 0.73%, yielding 73 measured surplus dealers out of 1,680 distinct awardee CAGEs. The signal
   * is REAL and the ledger behind it is THIN. So the absence of this leg is never evidence
   * against a row, the abstention names the coverage rather than shrugging, and no surface may
   * present this ranking as a confident classification. It is a watchlist ordering with a
   * published effective sample size, which is the truthful version of "it has been taught".
   * ------------------------------------------------------------------------------------ */
  let surplusLineage: Leg<number>;
  if (lastAwardee && lastAwardee.evidenceState === "measured" && (lastAwardee.measured?.surplusYes ?? 0) > 0) {
    const m = lastAwardee.measured!;
    add(20);
    surplusLineage = measured(
      1,
      Math.min(0.9, 0.3 + m.readFraction * 0.6),
      `${m.surplusYes} of this awardee's ${m.totalAwards} recorded awards read as surplus material`,
    );
    reasons.push({
      leg: "surplusLineage",
      plain:
        `the last supplier is a recorded surplus dealer (${m.surplusYes} surplus award(s) on file), ` +
        "which the operator's own rubric ranks as the strongest single indicator of a winnable surplus buy",
      points: 20,
      calibration: "measured",
    });
  } else if (lastAwardee && lastAwardee.prior) {
    // The book has a read and the government record does not. It informs, it does not score.
    surplusLineage = unavailable(
      `no award on file for this supplier carries a read surplus flag; the supplier book calls them a ${lastAwardee.prior.bookClass}, which is a researcher's judgement and not a government record`,
    );
    dataGaps.push(
      "the last supplier's surplus history is unread in the government record, so the operator's lead signal abstains here and the book's own label is shown as context only",
    );
  } else if (sources.awardIndexLoaded) {
    surplusLineage = unavailable(
      "no recorded award for this stock number carries a readable surplus flag, so the last supplier cannot be classified",
    );
    dataGaps.push(
      "the surplus flag is read on 0.73% of the loaded award history, so the operator's lead signal abstains on most rows and its absence is not evidence against this one",
    );
  } else {
    surplusLineage = unavailable("award history not loaded, so the last supplier cannot be classified");
    dataGaps.push("award history not loaded, so the operator's lead surplus signal abstains");
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
    legs: { demand, competition, priceAnchor, forwardDemand, feasibility, surplusLineage },
    reasons,
    dataGaps,
  };
}

function fmt(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
