"use client";

/*
 * <ExplainButton /> Owner: T8 DESIGN.
 *
 * The highest-leverage component in the product, and the owner's hard requirement: every
 * tool, metric and automated behaviour carries a discoverable explanation.
 *
 * -------------------------------------------------------------------------------------
 * THIS IS A SETTLED MARKUP CONTRACT, NOT A STYLE CHOICE. DO NOT SUBSTITUTE A TOOLTIP.
 * -------------------------------------------------------------------------------------
 * A real focusable <button> toggling a non-modal popover. Never role="tooltip". The
 * rule-outs are researched from primary sources and are recorded here so no lane
 * re-litigates them:
 *
 *  1. The W3C APG tooltip pattern is unfinished. Its own text: "this design pattern is work
 *     in progress; it does not yet have task force consensus", and it ships no developed
 *     example.
 *  2. "Tooltip widgets do not receive focus", and for interactive content the APG itself
 *     says to use a non-modal dialog instead. Our content is three sections and a link.
 *     That is interactive content.
 *  3. aria-describedby flattens its content to a plain string. aria-details preserves
 *     structure and interactivity. A three-section explainer flattened into one description
 *     is unusable by ear.
 *  4. Tooltips do not exist on touch at all.
 *
 * Also ruled out: the `title` attribute (no touch, no styling, inconsistent announcement),
 * which is what the approved comp uses as a placeholder. If you are about to write
 * title="..." on a control, this component is what you wanted.
 *
 * HOVER OPENS NOTHING. EVER. Quality Bar R4 makes the abolition of hover as an information
 * channel binding, and the gate tests it: a pointer resting anywhere on the board for ten
 * seconds must produce nothing. Beyond the accessibility argument, an older operator with an
 * unsteady hand scanning a dense grid would otherwise trigger dozens of accidental popups.
 * A click-triggered disclosure also sidesteps WCAG 1.4.13 entirely.
 */

import { useId, useRef, useState } from "react";
import { getHelp, inferOwner } from "../help/registry";
import styles from "./ExplainButton.module.css";

/**
 * The live computation record: the second half of L2, and the half that gets opened for
 * four years. Supplied by the lane that owns the number, for the specific row under the
 * cursor. Never generated at render time by a model.
 */
export interface ComputationRecord {
  /** Ordered principal reasons: the factors that fired, most important first. */
  factors: Array<{
    label: string;
    /** Signed contribution. Rendered with its sign so direction is never ambiguous. */
    contribution: number;
    unit?: string;
  }>;
  /** What would have made this not flag. The field an expert actually uses. */
  counterfactual?: string;
  /** Named inputs that were missing. An explicit list, never an empty implication. */
  dataGaps?: string[];
  modelVersion: string;
  /** ISO timestamp. Rendered with its age, because a number without an as-of is a claim
   *  with the expiry removed. */
  asOf: string;
  /** True when the engine abstained rather than scored. Abstention is an answer. */
  abstained?: boolean;
  /** The reason, drawn from the closed enumerated vocabulary. Never free text. */
  abstainReason?: string;
}

export interface ExplainButtonProps {
  /** Stable id in the help registry, for example `score.signal.surplus_run`. */
  helpId: string;
  /** The live computation record for the row under the cursor, when there is one. */
  computation?: ComputationRecord;
  /** Visual size. `sm` is for inside a dense table header, and still meets the 24px
   *  minimum pointer target through padding rather than through a smaller hit area. */
  size?: "sm" | "md";
}

function ageFrom(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown age";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ExplainButton({ helpId, computation, size = "md" }: ExplainButtonProps) {
  const panelId = useId();
  const anchorName = `--x${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const record = getHelp(helpId);

  // The accessible name includes WHAT it explains, so a screen reader user hears
  // "About Surplus Fit score", never "button".
  const name = record ? `About ${record.title}` : `About this control (explanation pending)`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.trigger} ${size === "sm" ? styles.sm : ""}`}
        aria-label={name}
        aria-expanded={open}
        aria-controls={panelId}
        // Belt and braces alongside aria-controls: aria-details preserves the panel's
        // structure for screen readers that support it, instead of flattening it.
        aria-details={panelId}
        // React 19 types this natively, so no suppression is needed here.
        popoverTarget={panelId}
        style={{ anchorName } as React.CSSProperties}
        onClick={() => setOpen((v) => !v)}
      >
        {/* An eye inside a circle: the owner's chosen mark for "here is a plain explanation."
            It reads as "look here to understand this," on every metric, tool and behaviour. */}
        <svg className={styles.eye} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M5 10c1.4-2.1 3.1-3.2 5-3.2s3.6 1.1 5 3.2c-1.4 2.1-3.1 3.2-5 3.2s-3.6-1.1-5-3.2Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="10" r="1.7" fill="currentColor" />
        </svg>
      </button>

      <div
        id={panelId}
        // popover="auto" gives top layer (so a table's overflow:hidden can never clip it),
        // light dismiss, and Escape-to-close with focus return, natively. No library, no
        // hand-rolled focus trap, which the handoff forbids me writing anyway.
        popover="auto"
        className={styles.panel}
        style={{ positionAnchor: anchorName } as React.CSSProperties}
        onToggle={(e) => setOpen((e as unknown as { newState: string }).newState === "open")}
      >
        {record ? (
          <>
            {/* L1. One line, in the operator's language. */}
            <p className={styles.lead}>{record.what}</p>

            {/* L2, static half: the HelpRecord. */}
            <dl className={styles.dl}>
              <dt>How to use it</dt>
              <dd>{record.how}</dd>
              <dt>Why it matters</dt>
              <dd>{record.why}</dd>
              <dt>Where the number came from</dt>
              <dd>{record.source}</dd>

              {/*
               * THE FIFTH FIELD. Rendered last and deliberately styled apart, because it is
               * the sentence that stops somebody acting on a number the data cannot support.
               * On a surface reading "115 candidate corners", this is where the product says
               * that none of them are confirmed available to buy.
               *
               * Absent renders nothing rather than a placeholder. Required on score
               * explainers, enforced by validateHelp and the coverage gate.
               */}
              {record.whatThisDoesNotDo ? (
                <>
                  <dt className={styles.limitsTerm}>What this does not do</dt>
                  <dd className={styles.limits}>{record.whatThisDoesNotDo}</dd>
                </>
              ) : null}
            </dl>

            {/* L2, live half: the computation record for this row. The half that gets
                opened for four years. */}
            {computation ? (
              <div className={styles.compute}>
                <p className={styles.computeHead}>
                  {computation.abstained ? "Why this abstained" : "How this row scored"}
                </p>

                {computation.abstained ? (
                  <p className={styles.abstain}>
                    Insufficient inputs
                    {computation.abstainReason ? `: ${computation.abstainReason}` : ""}
                  </p>
                ) : (
                  <ul className={styles.factors}>
                    {computation.factors.map((f) => (
                      <li key={f.label}>
                        <span>{f.label}</span>
                        <span
                          className={`mono ${f.contribution >= 0 ? styles.pos : styles.neg}`}
                        >
                          {f.contribution >= 0 ? "+" : ""}
                          {f.contribution}
                          {f.unit ?? ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {computation.counterfactual ? (
                  <p className={styles.counterfactual}>
                    <strong>What would change it: </strong>
                    {computation.counterfactual}
                  </p>
                ) : null}

                {computation.dataGaps && computation.dataGaps.length > 0 ? (
                  <p className={styles.gaps}>
                    <strong>Missing inputs: </strong>
                    {computation.dataGaps.join(", ")}
                  </p>
                ) : null}

                <p className={styles.stamp}>
                  <span className="mono">{computation.modelVersion}</span>
                  <span aria-hidden="true"> · </span>
                  <span>as of {ageFrom(computation.asOf)}</span>
                </p>
              </div>
            ) : null}

            {/* L3. One link. Never two. */}
            {record.moreHref ? (
              <a className={styles.more} href={record.moreHref}>
                Full reference
              </a>
            ) : null}
          </>
        ) : (
          /*
           * MISSING CONTENT IS AN HONEST EMPTY STATE, NOT A PLACEHOLDER.
           * It names the lane that owes the text. It never invents an explanation, and no
           * model writes one at render time. A confident wrong sentence about a compliance
           * path is worse than an honest gap.
           */
          <div className={styles.pending}>
            <p className={styles.lead}>No explanation has been written for this yet.</p>
            <p>
              Owed by <strong>{inferOwner(helpId) ?? "the lane that owns this number"}</strong>.
            </p>
            <p className={styles.stamp}>
              <span className="mono">{helpId}</span>
            </p>
          </div>
        )}
      </div>
    </>
  );
}
