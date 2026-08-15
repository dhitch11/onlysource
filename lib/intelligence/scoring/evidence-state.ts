/**
 * THE EVIDENCE-STATE CONTRACT.
 *
 * The one mechanism that makes "a missing leg never fabricates" true by construction, from the
 * ONLYSOURCE scoring methodology (architecture of record, _intel/scoring-methodology.md §0/§2.3).
 *
 * Every leg of the score emits not a scalar but a triple: a value, the STATE that value is in,
 * and how much independent evidence actually moved it. The composite is then gated on the STATE,
 * never on the number. This is what lets a sole-source monopoly — where the data is thinnest and
 * the money is largest — rank on a watchlist with a published prior-weight instead of rendering a
 * fabricated 0.85 probability.
 *
 *   MEASURED    the value is pinned by at least one independent FACT (an observed award order
 *               statistic, a realized zero-quote event, a verified SAM expiry, a held UBR).
 *               evidence_weight reflects effective sample size / how far the posterior moved
 *               from the prior. High weight only when DATA, not the prior, set the number.
 *   PRIOR       the value is low/high only because a hand-set or elicited prior says so, with
 *               negligible data. Legitimate for RANKING A WATCHLIST, illegitimate for rendering
 *               a point probability or a calibrated EV.
 *   UNAVAILABLE a load-bearing input could not be read (feed not landed, credential absent).
 *               Explicit, never a silent zero.
 *   GATE_FAIL   a deterministic hard gate is violated (structural zero, distinct from abstention).
 */

export type LegState = "MEASURED" | "PRIOR" | "UNAVAILABLE" | "GATE_FAIL";

export type Leg<T = number> = {
  /** The leg's value in its own units. Meaningful only in combination with `state`. */
  value: T | null;
  state: LegState;
  /**
   * How much independent evidence moved this value, 0..1. For a MEASURED leg it scales with
   * effective sample size; for PRIOR/UNAVAILABLE/GATE_FAIL it is 0. The composite never treats a
   * PRIOR value as if evidence backed it, whatever the value is.
   */
  evidenceWeight: number;
  /** One plain-language sentence: why this value, and why this state. Becomes a reason code. */
  because: string;
};

export function measured<T>(value: T, evidenceWeight: number, because: string): Leg<T> {
  return { value, state: "MEASURED", evidenceWeight: clamp01(evidenceWeight), because };
}
export function prior<T>(value: T, because: string): Leg<T> {
  return { value, state: "PRIOR", evidenceWeight: 0, because };
}
export function unavailable<T>(because: string): Leg<T> {
  return { value: null, state: "UNAVAILABLE", evidenceWeight: 0, because };
}
export function gateFail<T>(because: string): Leg<T> {
  return { value: null, state: "GATE_FAIL", evidenceWeight: 0, because };
}

/**
 * The confidence grade — the hard gate (§2.4). It encodes how many load-bearing inputs were
 * ACTUALLY present, so a partial score can never read identically to a complete one. At launch
 * every Decision-B CornerScore is C/D by construction: there are ~0 resolved multi-year margin
 * outcomes and the reliability curve is empty, so nothing here renders a calibrated band yet.
 *
 *   A  all load-bearing legs MEASURED, calibration set adequate        (not reachable at launch)
 *   B  legs MEASURED, calibration thin                                 (not reachable at launch)
 *   C  >=1 load-bearing leg PRIOR but bounded; watchlist-eligible
 *   D  driving quantity PRIOR, or a disqualifying gate UNCHECKED       (never a confident band)
 */
export type ConfidenceGrade = "A" | "B" | "C" | "D";

/** Disposition from the Evidence-State decision table (§2.3), first match wins upstream. */
export type Disposition =
  | "FLAG" // all load-bearing legs measured, calibration adequate — actionable
  | "WATCHLIST" // ordinal rank only; a driving quantity is PRIOR-thin
  | "INSUFFICIENT_DATA" // a disqualifying gate is UNCHECKED, or a load-bearing leg UNAVAILABLE
  | "SKIP"; // a hard gate FAILED — structural zero

/**
 * Grade from the set of load-bearing legs. Conservative by construction: any UNAVAILABLE
 * load-bearing leg or any PRIOR driving quantity caps the grade, and calibration is never
 * asserted as adequate at launch (there is no resolved-outcome set yet), so A/B are unreachable
 * here and that is deliberate rather than a missing feature.
 */
export function gradeFrom(loadBearing: Leg<unknown>[], calibrationAdequate = false): ConfidenceGrade {
  if (loadBearing.some((l) => l.state === "UNAVAILABLE")) return "D";
  const anyPrior = loadBearing.some((l) => l.state === "PRIOR");
  if (anyPrior) return "C";
  if (loadBearing.every((l) => l.state === "MEASURED")) return calibrationAdequate ? "A" : "B";
  return "D";
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
