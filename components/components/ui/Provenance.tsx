/*
 * <Provenance /> and <Unconfirmed />. Owner: T8 DESIGN.
 *
 * -------------------------------------------------------------------------------------
 * TWO ORTHOGONAL AXES. THIS IS THE THING LANES GET WRONG, SO READ IT ONCE.
 * -------------------------------------------------------------------------------------
 * Quality Bar R1 corrects an earlier wording that listed UNCONFIRMED "next to measured,
 * modelled and insufficient" as though it were a fourth state. It is not.
 *
 *   AXIS 1, PROVENANCE: exactly three glyph states. measured | modelled | insufficient.
 *   AXIS 2, CONFIRMATION: an overlay. unconfirmed, or nothing.
 *
 * They COMPOSE. A value can be modelled AND unconfirmed. Never a fourth glyph, never a
 * bolted-on badge. The codebase carries three glyph variants and one overlay, and /design
 * renders the composition matrix so this cannot drift.
 *
 * -------------------------------------------------------------------------------------
 * SHAPE PLUS COLOUR, NEVER COLOUR ALONE
 * -------------------------------------------------------------------------------------
 * measured      filled square
 * modelled      filled circle
 * insufficient  dashed outline
 *
 * Red-green colour deficiency is common enough that any hue-only encoding excludes real
 * users, and the principal must never need a hover or a colour to read a fact. Render the
 * board in greyscale and you must still be able to work it. The shapes above are why that
 * is true, and the acceptance gate runs one pass under forced colors to prove it.
 */

import styles from "./values.module.css";

export type ProvenanceKind = "measured" | "modelled" | "insufficient";

const LABEL: Record<ProvenanceKind, string> = {
  measured: "Measured",
  modelled: "Modelled",
  insufficient: "Insufficient data",
};

export interface ProvenanceProps {
  kind: ProvenanceKind;
  /** Show the word as well as the glyph. Off inside a dense grid cell where the column
   *  header already carries the meaning, on everywhere there is room. The accessible name
   *  is present either way. */
  showLabel?: boolean;
}

export function Provenance({ kind, showLabel = false }: ProvenanceProps) {
  return (
    <span className={`${styles.prov} ${styles[kind]}`}>
      <span className={styles.glyph} aria-hidden="true" />
      {showLabel ? <span>{LABEL[kind]}</span> : <span className="vh">{LABEL[kind]}</span>}
    </span>
  );
}

export interface UnconfirmedProps {
  children: React.ReactNode;
  /** Where the value came from, so a human can check it before accepting. An unconfirmed
   *  value with no traceable source is not reviewable and should not be rendered. */
  sourceHref?: string;
  /** Called on the one-keystroke accept. Accepting is undoable for the full undo window,
   *  and a later revert writes a correcting decision event, never a silent edit. */
  onAccept?: () => void;
}

/**
 * The confirmation overlay. Composes with any provenance glyph.
 *
 * Every call-extracted, ILS-listed or document-extracted number, identifier and date renders
 * visibly UNCONFIRMED with its source attached until a human accepts it with one keystroke.
 *
 * UNCONFIRMED VALUES ARE INERT TO EVERY COMPUTED TOTAL until accepted. That is enforced by
 * the lane that owns the arithmetic, not by this component, but the visual state exists so
 * an operator can see which figures are and are not counting.
 */
export function Unconfirmed({ children, sourceHref, onAccept }: UnconfirmedProps) {
  return (
    <span className={styles.unconfirmed}>
      <span className={styles.unconfirmedValue}>{children}</span>
      <span className={styles.unconfirmedTag}>
        <span className="vh">Unconfirmed value. </span>
        <span aria-hidden="true">UNCONFIRMED</span>
      </span>
      {sourceHref ? (
        <a href={sourceHref} className={styles.unconfirmedSource}>
          <span className="vh">Open the source for this unconfirmed value</span>
          <span aria-hidden="true">source</span>
        </a>
      ) : null}
      {onAccept ? (
        <button type="button" className={styles.accept} onClick={onAccept}>
          Accept
        </button>
      ) : null}
    </span>
  );
}
