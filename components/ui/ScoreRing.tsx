/*
 * <ScoreRing /> Owner: T8 DESIGN. The number itself is T3's and this component computes
 * nothing.
 *
 * The ring is REINFORCEMENT, not the signal. The number is always present as text, always
 * readable by ear, and always readable in greyscale and under forced colors, where the arc
 * simply disappears. If you find yourself relying on the arc to tell two rows apart, the
 * design has failed and the fix is in the column, not here.
 *
 * ABSTENTION IS AN ANSWER, NOT A FAILURE. When the engine abstained, this renders an
 * explicit "insufficient inputs" state naming what is missing. It never renders a zero and
 * it never renders a dash. A zero is a score. An abstention is the absence of one, and an
 * operator who reads one as the other makes a bad call on a real requirement.
 */

import styles from "./values.module.css";

export interface ScoreRingProps {
  /** 0 to 100. Pass null when the engine abstained. */
  value: number | null;
  /** What the score is called, for the accessible name. */
  label: string;
  /** Required when value is null. Drawn from the closed abstention vocabulary, never free
   *  text, so the reasons stay countable and the operator learns a fixed set. */
  abstainReason?: string;
}

export function ScoreRing({ value, label, abstainReason }: ScoreRingProps) {
  if (value === null) {
    return (
      <span
        className={`${styles.ring} ${styles.ringAbstain}`}
        role="img"
        aria-label={`${label}: insufficient inputs${abstainReason ? `, ${abstainReason}` : ""}`}
      >
        <span className={styles.ringValue} aria-hidden="true">
          {/* Not a zero, not a dash. A mark that reads as "no answer here". */}
          ··
        </span>
      </span>
    );
  }

  const band = value >= 70 ? "" : value >= 40 ? styles.ringMid : styles.ringLow;

  return (
    <span
      className={`${styles.ring} ${band}`}
      style={{ ["--ringValue" as string]: value }}
      role="img"
      aria-label={`${label}: ${value} out of 100`}
    >
      <span className={`mono ${styles.ringValue}`} aria-hidden="true">
        {value}
      </span>
    </span>
  );
}
