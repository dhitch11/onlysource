import type { Metadata } from "next";
import { requireGateSession } from "@/lib/session/require-gate";
import { buildBoard, type BoardRow } from "@/lib/board/build";
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

      <section className={styles.stats} aria-label="Measured counts for this feed day">
        <div className={styles.stat}>
          <div className={styles.statN}>{counts.published.toLocaleString()}</div>
          <div className={styles.statL}>published requirements</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statN}>{counts.automated.toLocaleString()}</div>
          <div className={styles.statL}>
            machine-awarded, on price alone <span className={styles.statHint}>ninth character T or U</span>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statN}>{counts.soleSourced.toLocaleString()}</div>
          <div className={styles.statL}>
            one approved source only <span className={styles.statHint}>nobody else may supply it</span>
          </div>
        </div>
        <div className={`${styles.stat} ${styles.statHot}`}>
          <div className={styles.statN}>{counts.corners.toLocaleString()}</div>
          <div className={styles.statL}>
            <b>both at once</b> <span className={styles.statHint}>sole-sourced and machine-awarded</span>
          </div>
        </div>
      </section>

      <div className={styles.truth}>
        <span className={styles.truthDot} aria-hidden="true" />
        <p>
          Every figure on this page is counted from the two files DLA published for {feedDay}: the
          fixed-width requirement index and the approved-source list.{" "}
          <b>
            Price, availability and modeled lift are absent from this page because those files do
            not contain them
          </b>
          , and they are not estimated here.
          {drift.unparsedNsn > 0 || drift.unparsedSourceLines > 0 ? (
            <>
              {" "}
              Reported rather than hidden: {drift.unparsedNsn} index rows and{" "}
              {drift.unparsedSourceLines} approved-source lines could not be parsed and are excluded
              from the joins above.
            </>
          ) : null}
        </p>
      </div>

      <BoardGrid rows={rows} unjoined={counts.unjoined} />
    </main>
  );
}

export type { BoardRow };
