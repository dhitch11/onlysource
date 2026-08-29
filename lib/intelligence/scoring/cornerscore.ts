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
 * ★ THE 2026-08-28 REDESIGN — VALUE SPINE, LOCKUP GATE, WAYNE BOOST.
 * The old score was a flat integer sum with NO dollar term, and its biggest single block rewarded
 * the exact monopoly it should hide: sole-source paid +25 (up to +50 with concentration+silence),
 * which floated OEM/licensee-locked rows to a 100%-locked top-20 while the biggest live deals sank.
 * The rank is now three parts on one line, each explainable in a sentence:
 *   rankKey = 10 (demand floor) + valuePoints(v) + waynePoints(holders,q) + min(30, cornerBucket)
 *             − (locked ? LOCK_PENALTY : 0)
 * Value is the largest single positive term (a log ramp calibrated to the measured award-value
 * distribution, uncapped with a gentle tail so a $1M deal still beats a $250K one). Sole-source
 * stops paying anything; a deterministic lockup classifier sinks-and-hides the two true closed
 * doors (AMC 4/5, and an OEM/licensee that wins every award of its own item with zero surplus)
 * while PRESERVING the dead-OEM surplus opportunity that is Wayne's actual hunting ground. A
 * Wayne-holds-this boost is added uncapped. The old soft signals survive but share one capped
 * bucket so no pile of them can bury a real whale. No refuted pattern returns: no 3x multiplier,
 * no sole-source price premium, no ladder-position confidence.
 *
 * WHAT THIS IS BETTER AT THAN A HUMAN HEURISTIC, even at v0:
 *   - it is computed over the WHOLE corner map, not a sampled handful;
 *   - every point traces to an observed fact or is marked PRIOR and sent to a watchlist;
 *   - it carries its own reason codes and data gaps, so it is auditable rather than intuited.
 *
 * WHAT IT DOES NOT DO YET, and says so: no win probability (λ is unobservable at scale until the
 * private UBR corpus accrues — §3.1), no calibrated EV (no resolved outcomes), no feasibility
 * confirmation (no ILS/FLIS). Those legs render UNAVAILABLE/PRIOR, which caps the grade honestly.
 * Value is MODELED (last award price × requested qty); it ships paired with a not-guaranteed
 * qualifier. Wayne inventory is a PROXY (a 15-NSN incidental sample), so its ABSENCE reads
 * UNKNOWN, never "Wayne lacks it", and it is never priced.
 */
import type { CornerRow } from "@/lib/intelligence/corner";
import type { NsnAwardSummary, AvailabilityRecord } from "@/lib/intelligence/awards/nsn-now";
import type { ForecastSummary } from "@/lib/intelligence/forecast/dla-forecast";
import type { AwardeeVerdict } from "@/lib/intelligence/suppliers/classify";
import type { CageFamilyIndex } from "./cage-family";
import { sizeOfBuy } from "@/lib/intelligence/opportunities/size-of-buy";
import { bandSurplus, type SurplusBand } from "@/lib/intelligence/awards/surplus";
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

/** The value tier a deal falls in, from the measured award-value distribution. Never a markup. */
export type ValueTier = "noise" | "small" | "meaningful" | "strong" | "whale" | "insufficient";

/**
 * The lockup verdict — the inversion of the old +25 sole-source reward.
 *
 * `locked` is a closed door (AMC 4/5, or a confirmed OEM/licence lock): hidden and penalised.
 * `surplus_opportunity` is the dead-OEM open door Wayne fishes in (a surplus award on file, or a
 * non-approved source winning). `watchlist` is a bare sole-source with no readable history:
 * present and sortable, just not elevated. `competitive` is multiple approved sources.
 */
export type LockupStatus = "locked" | "surplus_opportunity" | "watchlist" | "competitive";

export type CornerScoreResult = {
  nsn: string;
  /** The v0 integer scorecard, 0..100 (clamped round of rankKey). An ORDINAL watchlist rank. */
  scoreV0: number;
  /**
   * The UNCLAMPED rank key every surface SORTS by. Unclamped so ties at the saturated top still
   * order correctly (two 100-badge rows can still be ranked against each other by real value).
   */
  rankKey: number;
  disposition: Disposition;
  grade: ConfidenceGrade;
  /**
   * The modeled size of this buy in USD (last award unit price × requested qty), or NULL when it
   * cannot be computed (INSUFFICIENT, never 0). A modeled estimate, not a guaranteed figure.
   */
  valueUsd: number | null;
  /** Which tier `valueUsd` falls in. `insufficient` when unpriceable — abstain, never 0. */
  valueTier: ValueTier;
  /** The sole-source inversion: the closed-door verdict, whether it is hidden, and why in a line. */
  lockup: { status: LockupStatus; hidden: boolean; plain: string };
  /**
   * Whether Wayne (CAGE 3BQS1/6KB87) is a listed holder of this NSN, and how much of the buy his
   * on-hand quantity could fill. `held:false` is UNKNOWN (his shelf is not loaded), never a
   * shortage. Units only — the availability feed carries no price, so no unit price is invented.
   */
  wayneHolds: { held: boolean; units: number; fill: number; plain: string };
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
   * ⛔ ABSENT MEANS THE SILENCE LEG WITHHOLDS AND THE OEM-LOCK GATE FAILS CLOSED. It does NOT
   * mean "fall back to comparing one CAGE string": single-CAGE comparison IS the defect. A caller
   * that has no index has not established silence and has not confirmed a licence lock, and
   * neither unestablished signal is paid.
   */
  cageFamily?: CageFamilyIndex | null;
  /**
   * The instant "expired" is judged against. Defaults to today. Exposed so a test can pin it:
   * an assertion whose expected value drifts with the wall clock is not an assertion.
   */
  asOfIso?: string;
};

/* ==========================================================================================
 * THE VALUE SPINE. A base-10 log ramp grounded in the MEASURED award-value distribution
 * (42,698 dedup rows: p50 $541, p75 $3,695, p90 $20,701, p95 $52,777; 87.6% under $15K,
 * 91.2% under $25K, 8.8% ≥ $25K holding 82.3% of all dollars).
 * ========================================================================================== */
/** Noise floor: below this, a deal earns no value credit (≈73rd percentile of the corpus). */
const VALUE_V0 = 5000;
/** The reference top of the ramp: $250K → VALUE_MAX points. */
const VALUE_VREF = 250000;
/** Points at $250K. Value is the largest single positive term. */
const VALUE_MAX = 45;
/** Above $250K the ramp keeps climbing at this rate per decade — unbounded, but diminishing. */
const VALUE_OVERAGE_PER_DECADE = 5;

/**
 * Value points for a modeled buy size. Uncapped, monotonic, NO ceiling.
 *   $5K → 0, $15K → ~12.6, $25K → ~18.5, $250K → 45, then +5/decade ($1M → ~48, $10M → ~53).
 * Smooth and continuous, so $14,000 lands within one point of $15,001 — no cliff, because the
 * measured distribution has no cliff there. null or ≤ noise floor → 0 (INSUFFICIENT, never faked).
 */
export function valuePoints(usd: number | null): number {
  // Defence in depth: sizeOfBuy already reduces v to finite-non-negative-or-null before this, but a
  // NaN/Infinity must never propagate into rankKey (NaN poisons every comparison in the sort).
  if (usd == null || !Number.isFinite(usd) || usd <= VALUE_V0) return 0;
  const lo = Math.log10(VALUE_V0);
  const hi = Math.log10(VALUE_VREF);
  const l = Math.log10(usd);
  const frac = (l - lo) / (hi - lo);
  return frac <= 1 ? VALUE_MAX * frac : VALUE_MAX + VALUE_OVERAGE_PER_DECADE * (l - hi);
}

/**
 * The tier label for a modeled buy size. Cut points are a product choice over the measured
 * distribution (not a claimed measurement): $15K is the "meaningful" knee, $25K is "strong" (the
 * top ~8.8% of deals by count, holding ~82% of the dollars), and $100K+ is "whale". Unpriceable
 * rows are `insufficient` (abstain), never 0-and-buried.
 */
export function valueTierOf(usd: number | null): ValueTier {
  if (usd == null || !Number.isFinite(usd)) return "insufficient";
  if (usd <= VALUE_V0) return "noise";
  if (usd < 15000) return "small";
  if (usd < 25000) return "meaningful";
  if (usd < 100000) return "strong";
  return "whale";
}

/* ==========================================================================================
 * THE LOCKUP PENALTY. ONE constant, because it is read in three places and they disagreed.
 *
 * The penalty MUST dominate the maximum reachable positive score, not merely offset it. Value is
 * uncapped, so the old fixed -40 let a high-value locked row (a $10M part earns ~53 value points)
 * still land at a positive rankKey and outrank open rows. Every non-locked row is >= 10 (the demand
 * floor), so a penalty larger than any reachable score is what actually guarantees a locked row can
 * never outrank an open one: the "not even in sight" requirement enforced by the SCORE, not by the
 * display filter alone. Locked rows still order among themselves by their (value + wayne) tiebreak,
 * all far below every shown row, and their clamped scoreV0 correctly reads 0.
 *
 * WHY IT IS EXPORTED AND WHY IT IS ONE NAME. It was written three times as three different numbers:
 * rankKey subtracted 1000, the rendered ReasonCode reported -40, and the prose formula in the
 * assembly comment also said 40. So the operator was shown a decomposition summing to roughly +55
 * beside a score of 0 and could not reconcile the two. Real case on the 2026-08-11 board: NSN
 * 1650013552818, a $287,722 buy, sat at rank 1923 of 2141 with rankKey -944.69 and a displayed
 * scoreV0 of 0. "Every point traces to an observed fact" is the product's claim about itself, and a
 * decomposition that does not add up breaks it. One constant, referenced everywhere, is the fix.
 * ========================================================================================== */
export const LOCK_PENALTY = 1000;

/**
 * A reason code's points, formatted for a human.
 *
 * ★ POINTS ARE STORED EXACT AND FORMATTED HERE, NEVER THE OTHER WAY AROUND. Rounding a leg at the
 * point it is pushed put the decomposition out of step with the rank key, and the reconciliation
 * leg then reported the difference as withheld points under a sentence that was false for the row.
 * So the model keeps full precision and the screen gets one decimal, which is the resolution an
 * operator can actually act on. Trailing ".0" is dropped so the common whole-number case reads as
 * "+10" and not "+10.0". ONE function, used by every surface, so the leg card and the explainer
 * can never disagree about the same number.
 */
export function fmtPoints(points: number): string {
  if (!Number.isFinite(points)) return "—";
  const r = Math.round(points * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/* ==========================================================================================
 * THE WAYNE-HOLDS-THIS BOOST. Fires when Wayne's CAGE appears among the NSN's listed holders.
 * Match on the CAGE set, NEVER on "Western*" name text (unrelated firms). This is the ONLY
 * loaded path where a holder's CAGE identity survives (award.holders is NsnAwardSummary.holders,
 * an AvailabilityRecord with .cage and .quantity), so the boost needs no new plumbing.
 * ========================================================================================== */
/** Both CAGEs resolve to WKF (FRIEDMAN) ENTERPRISES. The whole match set, and it is exact. */
export const WAYNE_CAGES = new Set(["3BQS1", "6KB87"]);

/**
 * +10 for a listed presence, rising to +28 when his on-hand quantity can fill the whole buy from
 * stock. Uncapped and first-class (outside the corner-signal bucket). Renders units and fill only,
 * NEVER a fabricated unit price or margin — the availability sheet carries no price or condition.
 */
export function waynePoints(
  holders: readonly Pick<AvailabilityRecord, "cage" | "quantity">[] | null | undefined,
  q: number | null,
): { points: number; held: boolean; units: number; fill: number } {
  const held = (holders ?? []).filter((h) => WAYNE_CAGES.has((h.cage ?? "").trim().toUpperCase()));
  if (held.length === 0) return { points: 0, held: false, units: 0, fill: 0 };
  // Defence in depth against a non-finite quantity poisoning rankKey with NaN (the parser guards
  // these today, but a NaN here would silently drop the whole row out of every sort).
  const units = held.reduce((s, h) => s + (Number.isFinite(h.quantity) ? (h.quantity as number) : 0), 0);
  const denom = Number.isFinite(q) && (q as number) > 0 ? (q as number) : 1;
  const fill = Math.min(1, units / denom);
  return { points: 10 + 18 * fill, held: true, units, fill };
}

/* ==========================================================================================
 * THE LOCKUP CLASSIFIER — the inversion of the old +25 sole-source reward.
 *
 * Deterministic, first-match-wins, run before scoring. It replaces the flat sole-source bonus and
 * the single-awardee concentration bonus (both DELETED). The two true closed doors are AMC 4/5 and
 * a confirmed OEM/licence lock (the DERCO/BOA archetype: the one approved source wins every award
 * of its own item, with zero surplus on file). Everything else is shown — most importantly the
 * dead-OEM surplus opportunity (a surplus award on file, or a non-approved CAGE winning), which is
 * Wayne's actual hunting ground and must NEVER be sunk.
 *
 * ⛔ FAIL-CLOSED: the OEM-lock branch requires a LOADED, GROUNDED family resolver. If the resolver
 * is absent or any CAGE is ungrounded, the row is NOT declared locked (it falls through to
 * watchlist/competitive). A licence lock is a claim we only make when we can ground it.
 * ========================================================================================== */
type AwardPattern = {
  /** True only when a resolver is loaded AND every approved/winner CAGE grounds in it. */
  familyResolved: boolean;
  /** Resolver-grounded: every winner is in the approved source's corporate family. */
  allWinnersInApprovedFamily: boolean;
  /** Resolver-grounded: some winner is a different corporate family from ALL approved CAGEs. */
  outsiderWon: boolean;
  /** Resolver-grounded: there are winners, and no approved-family CAGE is among them. */
  approvedSourceSilent: boolean;
};

/** Resolve the winner-vs-approved pattern against the family index, failing closed without one. */
export function resolveAwardPattern(
  approvedCages: readonly string[],
  winners: readonly string[],
  family: CageFamilyIndex | null | undefined,
): AwardPattern {
  const off: AwardPattern = {
    familyResolved: false,
    allWinnersInApprovedFamily: false,
    outsiderWon: false,
    approvedSourceSilent: false,
  };
  if (!family || approvedCages.length === 0 || winners.length === 0) return off;
  const grounded = (c: string) => family.resolve(c).state !== "absent";
  const familyResolved = approvedCages.every(grounded) && winners.every(grounded);
  if (!familyResolved) return off;
  const inFamily = (w: string) => approvedCages.some((c) => family.sameFamily(c, w).verdict === "same_family");
  const outsider = (w: string) => approvedCages.every((c) => family.sameFamily(c, w).verdict === "different_families");
  return {
    familyResolved: true,
    allWinnersInApprovedFamily: winners.every(inFamily),
    outsiderWon: winners.some(outsider),
    approvedSourceSilent: winners.every((w) => !inFamily(w)),
  };
}

export type LockupVerdict = {
  status: LockupStatus;
  hidden: boolean;
  /** 0..18, graded, strongest-single-not-stacked. Only spent when the row is NOT locked. */
  openDoorPoints: number;
  plain: string;
};

/** The first-match-wins classifier. `family` absent ⇒ the OEM-lock branch cannot fire. */
export function classifyLockup(
  row: CornerRow,
  award: NsnAwardSummary | null,
  family: CageFamilyIndex | null | undefined,
): LockupVerdict {
  const surplusBand: SurplusBand = award
    ? bandSurplus(award.surplus.flaggedAwards, award.surplus.totalAwards)
    : "no_flagged_award";
  const amc = (award?.amc ?? "").trim();
  const approvedCages = [
    ...new Set(
      [
        ...(award?.approvedSources ?? []).map((s) => s.cage),
        ...(row.approvedSources ?? []),
      ]
        .map((c) => (c ?? "").trim().toUpperCase())
        .filter((c) => c !== ""),
    ),
  ];
  const winners = [
    ...new Set(
      (award?.awards ?? [])
        .map((a) => (a.cage ?? "").trim().toUpperCase())
        .filter((c) => c !== ""),
    ),
  ];
  const hasHistory = winners.length > 0;
  const pat = resolveAwardPattern(approvedCages, winners, family);

  // openDoorPoints: strongest single reason, never stacked (a max, not a sum). Honours "band on
  // the ratio+count, never surplusYes>0": the surplus contribution comes from the banded rollup.
  let openDoorPoints = 0;
  if (pat.outsiderWon) openDoorPoints = Math.max(openDoorPoints, 18);
  if (surplusBand === "predominant" || surplusBand === "frequent") openDoorPoints = Math.max(openDoorPoints, 18);
  else if (surplusBand === "occasional") openDoorPoints = Math.max(openDoorPoints, 12);
  else if (surplusBand === "single_award") openDoorPoints = Math.max(openDoorPoints, 7);
  if (pat.approvedSourceSilent) openDoorPoints = Math.max(openDoorPoints, 10);

  // (1) A completed surplus award proves the door is open, and it OVERRIDES AMC.
  if (surplusBand !== "no_flagged_award") {
    return {
      status: "surplus_opportunity",
      hidden: false,
      openDoorPoints,
      plain: "DLA has accepted surplus on this line before, so the door is open.",
    };
  }
  // (1b) A GROUNDED outsider actually winning proves the door is open, and it OVERRIDES AMC — a
  //      non-approved CAGE that has won is as strong a signal as a surplus flag, and the module's
  //      contract is that such a row must NEVER be sunk. `pat.outsiderWon` is fail-closed (it needs
  //      a grounded family resolver), so an absent resolver cannot manufacture this override.
  if (pat.outsiderWon) {
    return {
      status: "surplus_opportunity",
      hidden: false,
      openDoorPoints,
      plain: "A non-approved source has been winning this item, so the door is open to a dealer.",
    };
  }
  // (2) AMC 4/5 are the only code-level locks (AMC 3 dominates and is case-by-case, never a lock).
  if (amc === "4" || amc === "5") {
    return {
      status: "locked",
      hidden: true,
      openDoorPoints: 0,
      plain: `AMC ${amc}: DLA buys this only from the approved prime, so it is not biddable for us.`,
    };
  }
  // (3) The OEM/licence lock (DERCO/BOA): the one approved source wins every award of its own item,
  //     no surplus ever accepted. FAIL-CLOSED: needs a grounded resolver.
  if (row.soleSource && hasHistory && pat.familyResolved && pat.allWinnersInApprovedFamily) {
    return {
      status: "locked",
      hidden: true,
      openDoorPoints: 0,
      plain: "The one approved source wins every award of its own item (a licence lock): an outside quote cannot win.",
    };
  }
  // (4) An outsider won, or the sole approved source is silent while others win: the dead-OEM door.
  if (pat.outsiderWon || (row.soleSource && pat.approvedSourceSilent)) {
    return {
      status: "surplus_opportunity",
      hidden: false,
      openDoorPoints,
      plain: "A non-approved source has been winning this item, so the door is open to a dealer.",
    };
  }
  // (5) A bare sole-source with no readable award history: present and sortable, just not elevated.
  if (row.soleSource && !hasHistory) {
    return {
      status: "watchlist",
      hidden: false,
      openDoorPoints,
      plain: "One approved source and no readable award history yet: on the watchlist, not in the top on its own.",
    };
  }
  // (6) Multiple approved sources: competitive, and value carries it.
  if (!row.soleSource) {
    return {
      status: "competitive",
      hidden: false,
      openDoorPoints,
      plain: `${row.approvedSourceCount} approved sources: competitive, so deal value carries the rank.`,
    };
  }
  // Fall-through: a sole-source with history the resolver could not ground. Fail closed to
  // watchlist — never a licence lock we cannot prove.
  return {
    status: "watchlist",
    hidden: false,
    openDoorPoints,
    plain: "One approved source with award history that could not be family-resolved: on the watchlist, not declared locked (fail-closed).",
  };
}

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

  // ---- THE LOCKUP GATE, computed first: it replaces the old +25 sole-source / +10 concentration.
  const lockup = classifyLockup(row, award, sources.cageFamily ?? null);
  const isLocked = lockup.status === "locked";

  // ---- DEMAND (ρ): MEASURED. The NSN is under open DLA demand — it is in today's index. The
  // demand FLOOR is a rank-neutral constant (same on every row), kept only so a bare in-demand
  // row is not 0. It is added directly to rankKey below, not through the capped bucket.
  const demand = measured(1, 0.9, "under open DLA demand in today's requirement index");
  reasons.push({ leg: "demand", plain: "DLA is actively buying this now", points: 10, calibration: "measured" });

  // ---- COMPETITION (W): the leg object still feeds the grade machinery, but its POINTS are gone.
  // The sole-source reward and the single-awardee concentration bonus are DELETED; the lockup gate
  // above is the honest replacement. The leg still records what the approved-source picture is.
  let competition: Leg<number>;
  if (row.soleSource) {
    if (award && award.awards.length >= 3 && award.distinctAwardees === 1) {
      competition = measured(1, 0.85, "sole approved source and sole historical awardee");
    } else if (award || sources.awardIndexLoaded) {
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
  }

  // The lockup verdict, rendered as a first-class reason: the full −LOCK_PENALTY when locked, or the
  // graded open-door points when the door is open (unless the last-awardee leg below owns a
  // strictly larger door, in which case this stays context so the two do not double-count).
  //
  // It reports −LOCK_PENALTY and not a friendlier −40 because this is the line the operator reads to
  // understand why a large buy is sitting at zero. A penalty that dwarfs every other leg is exactly
  // what happened to the row, and rounding it down for readability would restate the sum as one that
  // never ran. The magnitude IS the finding: this row is out of reach, not merely marked down.
  const lastAwardeeDoor =
    lastAwardee && lastAwardee.evidenceState === "measured" && (lastAwardee.measured?.surplusYes ?? 0) > 0 ? 18 : 0;
  reasons.push({
    leg: "lockup",
    plain: lockup.plain,
    points: isLocked ? -LOCK_PENALTY : lockup.openDoorPoints > lastAwardeeDoor ? lockup.openDoorPoints : 0,
    calibration: "measured",
  });

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
   * award rows this dossier already holds, rather than an inference from a list. Its weight was
   * reduced from +15 to +8 in the 08-28 redesign and it now shares the capped corner bucket.
   *
   * THE FORKS, ALL RULED EXPLICITLY, ALL FAILING CLOSED:
   *   - no resolver loaded          -> withhold, and say so in dataGaps
   *   - approved CAGE absent        -> withhold, and log the miss (a counted, greppable line)
   *   - a family member won here    -> withhold, and say who won
   *   - resolver says distinct      -> pay, this is a real silence
   * ------------------------------------------------------------------------------------ */
  let silenceEstablished = false;
  if (row.silentSourceCount > 0) {
    const family = sources.cageFamily ?? null;
    const approved = (row.approvedSources ?? []).filter((c) => (c ?? "").trim() !== "");
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
        silenceEstablished = true;
        reasons.push({
          leg: "competition",
          facet: "award silence",
          plain:
            "no CAGE in the approved source's corporate family has a recorded prime award on this stock number (a silence signal, not a death notice)",
          points: 8,
          calibration: "measured",
        });
      }
    }
  }

  // ---- AWARD PATH: machine award on price alone is the shape a corner monetizes through. Reduced
  // from +10 to +5 in the 08-28 redesign; it now feeds the capped corner bucket, not the raw sum.
  if (row.automatedSolicitation === true) {
    reasons.push({ leg: "path", plain: "awarded by machine on price alone (T/U ninth character)", points: 5, calibration: "measured" });
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
  // The escalation contribution was reduced from min(15, pct/10) to min(8, round(pct/12)) in the
  // 08-28 redesign and now feeds the capped corner bucket. It is a HISTORICAL price rise only,
  // never a forward projection.
  let priceAnchor: Leg<number>;
  let escalationPct = 0;
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
     * `unavailable` and not a zero: a zero is a score, and this is a refusal to score. The value
     * spine ALSO abstains on a suspect series (v = null), for the same reason.
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
      escalationPct = Math.round(((last - first) / first) * 100);
      const pts = Math.min(8, Math.round(escalationPct / 12));
      reasons.push({
        leg: "priceAnchor",
        facet: "trend",
        plain: `unit price rose ${escalationPct.toLocaleString()}% over the award history (${fmt(first)} → ${fmt(last)})`,
        points: pts,
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

  // ---- THE VALUE SPINE. v = last effective unit price × requested qty (the sizeOfBuy primitive),
  // computed only on a priceable, non-suspect series; else NULL (INSUFFICIENT, never 0). This
  // REPLACES the old discarded surplus-drag context block (which computed a number and scored 0).
  let v: number | null = null;
  if (award && !award.priceScaleSuspect && award.latest?.effectiveUnitPrice != null) {
    const buy = sizeOfBuy(award.latest.effectiveUnitPrice, row.quantity);
    if (buy.known) v = buy.usd;
  }
  const vPoints = valuePoints(v);
  if (v != null) {
    reasons.push({
      leg: "value",
      plain: `expected buy value ≈ ${fmt(v)} (modeled: last award unit price × requested quantity; a documented opportunity estimate, not a guaranteed figure)`,
      // ★ EXACT, NOT ROUNDED. `Math.round` here put the leg 0.5 out of step with the key, which the
      // reconciliation below then reported as withheld points under a sentence about capping that
      // was false for the row. Points are STORED exact so the column sums; they are FORMATTED at
      // the render sites. Rounding for readability is a display concern and belongs at the display.
      points: vPoints,
      calibration: "measured",
    });
  }

  // ---- FORWARD DEMAND (ρ_forward): MEASURED when the NSN is on the government's own DLA Forecast.
  // A sole-source, award-silent part that the buyer has SAID it will purchase again is the
  // strongest signal on this page: demand is not inferred, it is stated. Off the forecast, the
  // leg is a prior (absence from the forecast is not proof of no future demand). Reduced from +15
  // to +12 and moved into the capped corner bucket in the 08-28 redesign.
  let forwardDemand: Leg<number>;
  if (forecast?.onForecast) {
    forwardDemand = measured(
      1,
      0.9,
      `on the DLA Forecast${forecast.totalForecastQty > 0 ? `, ${forecast.totalForecastQty.toLocaleString()} units` : ""}${forecast.supplyChains.length ? ` (${forecast.supplyChains.join(", ")})` : ""}`,
    );
    reasons.push({
      leg: "forwardDemand",
      plain: `the government's own DLA Forecast lists this part for a future buy${forecast.totalForecastQty > 0 ? ` of ${forecast.totalForecastQty.toLocaleString()} units` : ""}`,
      points: 12,
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

  // ---- THE WAYNE BOOST: his CAGE among the NSN's listed holders, scaled by whether his on-hand
  // quantity can fill the buy. Uncapped, first-class, added OUTSIDE the corner bucket. Never priced.
  const wayne = waynePoints(award?.holders, row.quantity);
  if (wayne.held) {
    reasons.push({
      leg: "wayne",
      plain: `Wayne lists ${wayne.units.toLocaleString()} units for this part (listed, not price-confirmed)`,
      points: wayne.points, // exact, for the same reason as the value leg above

      calibration: "measured",
    });
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
   * ★★ IN THE 08-28 REDESIGN this leg no longer adds a flat +20 to a raw sum. It contributes to
   * the graded open-door signal in the capped corner bucket (a strongest-single term, so it does
   * not stack with the NSN-level surplus band), which is where the awardee-level version is
   * richer than the item-level band. The leg's evidence state and its coverage caveat are
   * unchanged: measured over the live award history, the Surplus cell is read on 0.73% of rows,
   * so the absence of this leg is never evidence against a row.
   * ------------------------------------------------------------------------------------ */
  let surplusLineage: Leg<number>;
  let surplusLineageDoor = 0;
  if (lastAwardee && lastAwardee.evidenceState === "measured" && (lastAwardee.measured?.surplusYes ?? 0) > 0) {
    const m = lastAwardee.measured!;
    surplusLineageDoor = 18;
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
      points: 18,
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

  /* ------------------------------------------------------------------------------------
   * ASSEMBLE THE RANK KEY.
   *   rankKey = 10 (demand floor) + valuePoints(v) + waynePoints + min(30, cornerBucket) − LOCK_PENALTY·locked
   * value and wayne are OUTSIDE the cap; the soft corner signals share one capped bucket so no
   * pile of them can bury a real whale. The corner bucket is only spent when the row is NOT locked.
   * ------------------------------------------------------------------------------------ */
  const openDoorPoints = Math.max(lockup.openDoorPoints, surplusLineageDoor);
  let cornerBucket = 0;
  if (!isLocked) {
    cornerBucket =
      openDoorPoints +
      (forecast?.onForecast ? 12 : 0) +
      (forecast && forecast.solicitationCount >= 5 ? 5 : 0) +
      (silenceEstablished ? 8 : 0) +
      Math.min(8, Math.round(escalationPct / 12)) +
      (row.automatedSolicitation === true ? 5 : 0);
  }
  // LOCK_PENALTY is module-level (see its block above): the same number the rendered ReasonCode
  // reports, so the decomposition the operator reads adds up to the key the sort actually used.
  const rankKey = 10 + vPoints + wayne.points + Math.min(30, cornerBucket) - (isLocked ? LOCK_PENALTY : 0);

  /* ------------------------------------------------------------------------------------
   * RECONCILE THE DECOMPOSITION WITH THE KEY. Added 2026-08-29.
   *
   * ★ THE OPERATOR WAS SHOWN POINTS THE SCORE NEVER SPENT. Measured on the locked fixture:
   * the reason codes summed to −979 while rankKey was −990. The 11-point gap was `path` (+5,
   * automated award path) and `priceAnchor` (+6, escalation) — both corner-bucket members, and
   * the bucket is ZEROED when the row is locked. So a locked row printed two positive legs that
   * bought it nothing, and the operator adding the column up got a different number than the one
   * the sort used. That is the "every point traces to an observed fact" claim failing quietly.
   *
   * TWO WAYS THE SUM CAN LEGITIMATELY DIVERGE, and both are deliberate scoring behaviour, not
   * bugs to be scored away: a locked row spends NO corner bucket at all, and an open row spends
   * at most 30 of it however high the signals stack. Neither should change. What has to change is
   * that the operator is told, in the same column, instead of being left to find the gap.
   *
   * WHY IT IS COMPUTED FROM THE LEGS RATHER THAN FROM A LIST OF BUCKET MEMBERS. Deriving the
   * withheld amount as (key − what the legs declare) is true by construction: any future leg that
   * reports points the key does not spend is caught the day it is added, with no list to keep in
   * sync. A hand-maintained roster of bucket members is exactly how the −40/−1000 split happened.
   * ------------------------------------------------------------------------------------ */
  const declared = reasons.reduce((acc, r) => acc + r.points, 0);
  const withheld = rankKey - declared;
  if (Math.abs(withheld) >= 0.005) {
    reasons.push({
      leg: "notSpent",
      // ★ THE SENTENCE MUST BE TRUE EVERY TIME IT APPEARS, so it names the reason that actually
      // applied rather than one plausible reason for both. It first fired on a plain open row with
      // no corner signal at all, announcing a cap that had not happened — the whole −0.35 was
      // rounding residue, now removed at the source above. A leg that explains itself wrongly is
      // worse than no leg: it teaches the operator to discount the column.
      plain: isLocked
        ? "the positive signals above are shown as context and were NOT spent on this row: the door is " +
          "closed, and a closed door is not opened by a good price trend or an automated award path"
        : "the soft corner signals above reached their combined cap, so the points past it are shown " +
          "for reading and were not spent; no stack of soft signals can outrank a real buy",
      points: withheld,
      calibration: "measured",
    });
  }

  // ---- DISPOSITION. locked → SKIP (hidden); else unpriceable → INSUFFICIENT_DATA (abstain);
  // else WATCHLIST. Win-probability is not modeled at v0, so nothing reaches FLAG. Grade is
  // unchanged: the evidence-state machinery over [demand, competition, priceAnchor, feasibility].
  const loadBearing = [demand, competition, priceAnchor, feasibility];
  const grade = gradeFrom(loadBearing);
  let disposition: Disposition;
  if (isLocked) disposition = "SKIP";
  else if (v == null) disposition = "INSUFFICIENT_DATA";
  else disposition = "WATCHLIST";

  return {
    nsn: row.nsn,
    scoreV0: Math.max(0, Math.min(100, Math.round(rankKey))),
    rankKey,
    disposition,
    grade,
    valueUsd: v,
    valueTier: valueTierOf(v),
    lockup: { status: lockup.status, hidden: lockup.hidden, plain: lockup.plain },
    wayneHolds: {
      held: wayne.held,
      units: wayne.units,
      fill: wayne.fill,
      plain: wayne.held
        ? `Wayne lists ${wayne.units.toLocaleString()} units for this part (listed, not price-confirmed).`
        : "No Wayne holding is loaded for this part; absence is unknown, not a shortage (his shelf is not loaded).",
    },
    legs: { demand, competition, priceAnchor, forwardDemand, feasibility, surplusLineage },
    reasons,
    dataGaps,
  };
}

function fmt(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
