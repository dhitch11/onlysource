/*
 * <StatusChip /> Owner: T8 DESIGN.
 *
 * The one status renderer. T5's document state (ready / draft / generate), T7's member
 * status (invited / active / suspended / offboarded), T6's pursuit stage, T3's disposition.
 * All of them are this component with a different `tone` and `children`.
 *
 * -------------------------------------------------------------------------------------
 * TWO RULES
 * -------------------------------------------------------------------------------------
 * 1. SHAPE AND TEXT IN ADDITION TO COLOUR, ALWAYS. The chip always carries its word. There
 *    is no icon-only variant and there will not be one. Hue is never load-bearing on its
 *    own: red-green colour deficiency is common enough that a hue-only encoding excludes
 *    real users, and the principal must never need a colour to read a fact.
 *
 * 2. STATUS IS A SMALL, QUIET, UNMISTAKABLE SIGNAL. A dot, a short label, one colour. Never
 *    a badge competing with the content it describes (Vercel steal 5). If your chip is
 *    louder than the row it sits in, the tone is wrong, not the size.
 *
 * ON `urgent`: amber and red are RESERVED for auto-award clock urgency and nothing else. A
 * red or an amber anywhere on a surface must mean the clock, or it is a bug. That
 * reservation is the entire reason the palette reads calm until something is genuinely about
 * to close. Do not reach for `urgent` to mean "important".
 */

import styles from "./controls.module.css";

export type ChipTone =
  /** A real, verified, in-hand, done state. Olive, the measured role. */
  | "verified"
  /** In progress, assigned, active. Neutral and quiet. */
  | "active"
  /** Not started, deferred, empty, not connected. Quietest of all. */
  | "idle"
  /**
   * The house brass accent: THE money signal (a live candidate corner, the hottest supplier
   * tier). Loud without borrowing the clock's amber, which stays reserved. Use it for the one
   * signal per surface a trader acts on first, never as a second "important".
   */
  | "accent"
  /** THE AUTO-AWARD CLOCK ONLY. Nothing else may use this. */
  | "urgent"
  /** The clock, critical. Nothing else may use this. */
  | "critical";

export interface StatusChipProps {
  tone: ChipTone;
  children: React.ReactNode;
  /** Optional longer form announced to screen readers, when the visible word is an
   *  abbreviation an operator knows and a new hire does not. */
  srLabel?: string;
}

export function StatusChip({ tone, children, srLabel }: StatusChipProps) {
  return (
    <span className={`${styles.chip} ${styles[tone]}`}>
      <span className={styles.chipDot} aria-hidden="true" />
      <span>{children}</span>
      {srLabel ? <span className="vh">{srLabel}</span> : null}
    </span>
  );
}
