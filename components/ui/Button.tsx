"use client";

/*
 * <Button /> Owner: T8 DESIGN.
 *
 * THE TWO THINGS THIS HAS TO GET RIGHT, both of which most button components get wrong:
 *
 * 1. THE LOADING STATE KEEPS ITS WIDTH. A button that shrinks when its label becomes a
 *    spinner moves everything next to it, and on a dense toolbar that means the operator's
 *    next click lands on a different control than the one they aimed at. Misclicks in this
 *    product submit things to the government. The label stays in the DOM at zero opacity
 *    holding the box open, and the busy state is announced rather than only shown.
 *
 * 2. THE DESTRUCTIVE VARIANT IS NOT JUST RED TEXT. Red is reserved for the auto-award clock
 *    in this palette, so destructive carries its weight through the border, the confirm
 *    requirement and the word itself. If the only thing separating "save" from "delete for
 *    everyone" is a hue, someone will eventually click the wrong one.
 *
 * Activation is on the UP event, never the down event, so a pointer-down on the wrong
 * control can be dragged away and released harmlessly. That is browser default for a real
 * <button> and it is a reason not to build one out of a div.
 */

import styles from "./controls.module.css";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "quiet" | "destructive";
  /** Shows the busy state, keeps the width, and blocks re-entry. */
  busy?: boolean;
  /** Announced while busy, for example "Submitting quote". Required when busy is used,
   *  because a spinner alone tells a screen reader user nothing. */
  busyLabel?: string;
}

export function Button({
  variant = "secondary",
  busy = false,
  busyLabel,
  children,
  disabled,
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`${styles.btn} ${styles[variant]} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {/* The label always occupies the box, so the width never changes between states. */}
      <span className={busy ? styles.btnLabelHidden : undefined}>{children}</span>

      {busy ? (
        <>
          <span className={styles.btnSpinner} aria-hidden="true" />
          <span role="status" aria-live="polite" className="vh">
            {busyLabel ?? "Working"}
          </span>
        </>
      ) : null}
    </button>
  );
}
