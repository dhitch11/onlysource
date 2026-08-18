/*
 * <Money /> Owner: T8 DESIGN.
 *
 * EVERY DOLLAR FIGURE IN THE PRODUCT GOES THROUGH THIS ONE COMPONENT. Not most of them. All
 * of them. It owns alignment, precision, the negative treatment, and the visual difference
 * between a measured figure and a modelled one.
 *
 * -------------------------------------------------------------------------------------
 * WHY ONE RENDERER, AND WHY THE MEASURED/MODELLED DISTINCTION IS THE WHOLE POINT
 * -------------------------------------------------------------------------------------
 * A quoted price and an estimated extended value must never look identical. They are worth
 * different amounts and they carry different risk, and on a dense screen the only thing
 * separating them is how they are typeset. A modelled figure that reads as measured is how a
 * firm loses money on a contract it already won.
 *
 * TWO HARD RULES THIS COMPONENT CANNOT ENFORCE ALONE, SO THEY ARE WRITTEN HERE FOR THE LANE
 * PASSING THE PROP:
 *
 *   1. A HEADLINE FIGURE IS A STORED VETTED FIELD, NEVER A CLIENT-SIDE RE-SUM. If you are
 *      computing a total in the browser by adding up rendered rows, you have produced a
 *      number nobody vetted and it will disagree with the server's version the moment a
 *      filter changes. Pass the stored figure.
 *   2. UNCONFIRMED VALUES ARE INERT TO ANY COMPUTED TOTAL until a human accepts them.
 *
 * Deterministic code owns every number. This component owns how it looks and nothing else.
 * It does no arithmetic, on purpose. There is no `sum` prop and there will not be one.
 */

import { Provenance, type ProvenanceKind } from "./Provenance";
import styles from "./values.module.css";

export interface MoneyProps {
  /** Whole units of currency. Pass the stored vetted value, not a computed one. */
  amount: number | null | undefined;
  /** measured = a real quoted or awarded figure. modelled = an estimate the engine derived.
   *  insufficient = we cannot know, which renders as an honest absence and never a zero. */
  provenance: ProvenanceKind;
  currency?: string;
  /** Cents matter on a unit price and are noise on a pipeline total. */
  precision?: 0 | 2;
  /** Larger treatment for a headline figure such as the recommended quote. */
  emphasis?: boolean;
  /** Shown when amount is null. Say what is missing, never render a dash or a zero. */
  absentReason?: string;
}

export function Money({
  amount,
  provenance,
  currency = "USD",
  precision = 0,
  emphasis = false,
  absentReason,
}: MoneyProps) {
  /*
   * A NULL AMOUNT IS NOT A ZERO AND IS NEVER RENDERED AS ONE.
   * "Insufficient data" is a respected, shippable answer. A zero here would be a fabricated
   * measurement, which is a house law 1 violation, and on a federal quote it is the kind of
   * mistake this business does not survive.
   */
  if (amount === null || amount === undefined || provenance === "insufficient") {
    return (
      <span className={styles.moneyAbsent}>
        <Provenance kind="insufficient" />
        <span>{absentReason ?? "insufficient data"}</span>
      </span>
    );
  }

  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(amount);

  return (
    <span
      className={[
        styles.money,
        emphasis ? styles.moneyEmphasis : "",
        amount < 0 ? styles.moneyNegative : "",
        provenance === "modelled" ? styles.moneyModelled : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="mono">{formatted}</span>
      <Provenance kind={provenance} />
      {/* Said in words as well as shown in a glyph, because the distinction is the whole
          reason this component exists and a glyph alone is not readable by ear. */}
      <span className="vh">
        {provenance === "modelled" ? "modelled estimate" : "measured figure"}
      </span>
    </span>
  );
}
