"use client";

/*
 * <Identifier /> Owner: T8 DESIGN.
 *
 * NSN, CAGE, solicitation number, purchase request number, part number. These are compared
 * by eye, character by character, hundreds of times a day.
 *
 * -------------------------------------------------------------------------------------
 * THREE RULES, ALL OF THEM LOAD-BEARING
 * -------------------------------------------------------------------------------------
 * 1. MONOSPACE WITH TABULAR NUMERALS, so 1 and 7 never shift the column and nothing jitters
 *    between renders.
 *
 * 2. NEVER TRUNCATE AT THE END. The discriminating characters live at the end. Truncate in
 *    the MIDDLE, keep the full value selectable, and put copy-on-click on every one.
 *
 * 3. A FIELD THAT ARRIVES TRUNCATED FROM THE SOURCE HAS NO FULL VALUE TO REVEAL, AND MUST
 *    NOT PRETEND OTHERWISE. Nomenclature is truncated to 21 characters upstream by the
 *    government feed and is lossy: "COVERALLS,ANTI-EXPO" is the verified observed value.
 *    Pass `sourceTruncated` and this component renders an explicit marker and REMOVES the
 *    copy affordance, because promising the whole value and handing back a truncated one is
 *    a claim the product cannot honour.
 *
 * The `title` attribute is banned here (Quality Bar R3) and the CI grep asserts that
 * `title=` never appears on an identifier cell. The full value goes in the row detail panel.
 */

import { useState } from "react";
import styles from "./values.module.css";

/**
 * The thirteen fixed-width fields of the daily index file, verified against production data
 * where every one of 3,095 records was exactly 140 bytes. Columns are sized from these so
 * nothing shifts on first paint.
 */
export const FIELD_WIDTHS = {
  solicitation: 13,
  nsnOrPart: 46,
  purchaseRequest: 13,
  returnByDate: 8,
  fileName: 19,
  qty: 7,
  unitIssue: 2,
  nomenclature: 21,
  buyerCode: 5,
  amsc: 1,
  itemTypeIndicator: 1,
  setAsideIndicator: 1,
  setAsidePercentage: 3,
} as const;

export type IdentifierField = keyof typeof FIELD_WIDTHS;

export interface IdentifierProps {
  value: string;
  /** Which government field this is. Sets the column width from the verified byte widths. */
  field?: IdentifierField;
  /** Characters to show before truncation kicks in. Defaults to the field width. */
  max?: number;
  /** True when the SOURCE truncated it, not us. Renders the marker, kills the copy control
   *  and kills any promise of a fuller value. */
  sourceTruncated?: boolean;
  /** Accessible name for the copy control, for example "solicitation number". */
  label?: string;
}

function middleTruncate(v: string, max: number): string {
  if (v.length <= max) return v;
  // Keep the tail intact. The discriminating characters live at the end.
  const tail = Math.ceil((max - 1) / 2);
  const head = max - 1 - tail;
  return `${v.slice(0, head)}…${v.slice(v.length - tail)}`;
}

export function Identifier({
  value,
  field,
  max,
  sourceTruncated = false,
  label = "identifier",
}: IdentifierProps) {
  const [copied, setCopied] = useState(false);
  const limit = max ?? (field ? FIELD_WIDTHS[field] : value.length);
  const shown = middleTruncate(value, limit);
  const isTruncatedByUs = shown !== value;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be denied by permission or unavailable over plain http. Say nothing
      // false: the value stays selectable, which is the fallback that always works.
      setCopied(false);
    }
  }

  return (
    <span className={styles.ident}>
      {/* The full value is always in the DOM and always selectable, even when the visible
          form is middle-truncated, so browser find and copy-paste both still work. */}
      <span
        className={`mono ${styles.identValue}`}
        style={field ? { minInlineSize: `${FIELD_WIDTHS[field]}ch` } : undefined}
      >
        <span aria-hidden="true">{shown}</span>
        <span className="vh">{value}</span>
      </span>

      {sourceTruncated ? (
        <span className={styles.sourceTrunc}>
          <span className="vh">
            This value arrived truncated from the government source. The full value is not
            available.
          </span>
          <span aria-hidden="true">source-truncated</span>
        </span>
      ) : (
        <button
          type="button"
          className={styles.copy}
          onClick={copy}
          aria-label={`Copy ${label} ${value}`}
        >
          <span aria-hidden="true">{copied ? "copied" : "copy"}</span>
        </button>
      )}

      {/* Announced, not just coloured. A copy confirmation nobody hears is not a
          confirmation. */}
      <span role="status" aria-live="polite" className="vh">
        {copied ? `${label} copied` : ""}
      </span>

      {isTruncatedByUs && !sourceTruncated ? (
        <span className="vh">Shown abbreviated. Full value is available to copy.</span>
      ) : null}
    </span>
  );
}
