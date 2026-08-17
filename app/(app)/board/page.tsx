import type { Metadata } from "next";
import { requireGateSession } from "@/lib/session/require-gate";
import { buildBoard, type BoardRow } from "@/lib/board/build";
import { ExplainButton } from "@/components/ui/ExplainButton";
import { BoardGrid } from "./BoardGrid";
import styles from "./board.module.css";

export const metadata: Metadata = { title: "The Board · ONLYSOURCE" };
export const dynamic = "force-dynamic";

export default async function BoardPage() {
  await requireGateSession("/board");
  const data = buildBoard();

  if (!data.ok) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.h1}>The Board</h1>
          <p className={styles.sub}>Every open requirement DLA published, ranked by measured signal.</p>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>The feed for this day is not readable</h2>
          <p>{data.reason}</p>
          <p className={styles.pathList}>
            {data.missing.map((m) => (
              <code key={m}>{m}</code>
            ))}
          </p>
          <p className={styles.note}>
            Nothing has been assumed in its place. When the daily capture runs, this page fills
            itself from the government file and nothing else.
          </p>
        </div>
      </main>
    );
  }

  const { counts, drift, feedDay, rows } = data;

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>The Board</h1>
          <p className={styles.sub}>
            Feed day <b>{feedDay}</b> · <b>{counts.published.toLocaleString()}</b> requirements as
            published by DLA
          </p>
        </div>
      </header>

      {/* The shared metric tiles from globals.css, not a fourth private copy of them. The
          bespoke .stat block this replaces also lifted 2px on hover, which the shared card
          documents as forbidden: an operator reads these counts fifty times a day and a tile
          that moves under the cursor is a position-permanence failure. */}
      <section className="metricGrid" aria-label="Measured counts for this feed day">
        <div className="metricCard">
          <span className="metricN">{counts.published.toLocaleString()}</span>
          <span className="metricLabel">published requirements</span>
        </div>
        <div className="metricCard">
          <span className="metricN">{counts.automated.toLocaleString()}</span>
          <span className="metricLabel">machine-awarded, on price alone</span>
          <span className="metricHint">ninth character T or U</span>
        </div>
        <div className="metricCard">
          <span className="metricN">{counts.soleSourced.toLocaleString()}</span>
          <span className="metricLabel">one approved source only</span>
          <span className="metricHint">nobody else may supply it</span>
        </div>
        <div className="metricCard metricCard--hot">
          <span className="metricN">{counts.corners.toLocaleString()}</span>
          <span className="metricLabel">both at once</span>
          <span className="metricHint">sole-sourced and machine-awarded</span>
        </div>
      </section>

      <div className={styles.truth}>
        <span className={styles.truthDot} aria-hidden="true" />
        {/*
         * THE EXPLAINER IS A SIBLING OF THE PARAGRAPH, NEVER A CHILD OF IT.
         *
         * <ExplainButton> renders its popover panel as a <div> next to the trigger, and a <div>
         * inside a <p> is invalid HTML: the browser closes the paragraph early, the server tree
         * and the client tree stop matching, and React throws a hydration error. Measured on the
         * serving path when this was first written inline: "In HTML, <div> cannot be a descendant
         * of <p>" plus a full "Hydration failed" pageerror on every load of /board. The fix is
         * structural, not cosmetic.
         */}
        <div className={styles.truthBody}>
          <p>
            Every figure on this page is counted from the two files DLA published for {feedDay}:
            the fixed-width requirement index and the approved-source list.{" "}
            <b>
              Price, availability and modeled lift are absent from this page because those files do
              not contain them
            </b>
            , and they are not estimated here.
            {drift.unparsedNsn > 0 || drift.unparsedSourceLines > 0 ? (
              <>
                {" "}
                Reported rather than hidden: {drift.unparsedNsn} index rows and{" "}
                {drift.unparsedSourceLines} approved-source lines could not be parsed and are
                excluded from the joins above.
              </>
            ) : null}
          </p>
          {/*
           * THIS EXPLAINER IS WHY THE EVALUATED-PRICE COLUMN IS NO LONGER IN THE GRID. That column
           * took no row argument: it returned the identical abstention for every row on every feed
           * day, so it rendered one dashed box and one wrapped sentence per row and set the pitch
           * of the whole grid. The fact is stated once here, where the sentence already said it,
           * and once per row in the expansion. Nothing was deleted.
           */}
          <span className={styles.truthExplain}>
            <ExplainButton helpId="board.evaluated_price" size="sm" />
          </span>
        </div>
      </div>

      <BoardGrid rows={rows} unjoined={counts.unjoined} />
    </main>
  );
}

export type { BoardRow };
