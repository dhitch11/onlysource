import type { Metadata } from "next";
import { requireGateSession } from "@/lib/session/require-gate";
import { buildAllDatasets } from "@/lib/intelligence/datasets";
import { buildNsnAwardIndex } from "@/lib/intelligence/awards/nsn-now";
import { scoreCorner } from "@/lib/intelligence/scoring/cornerscore";
import { resolveDataRoot } from "@/lib/data-root";
import { MonopolyGrid } from "./MonopolyGrid";
import styles from "./monopoly.module.css";

export const metadata: Metadata = { title: "Monopoly Map · ONLYSOURCE" };
export const dynamic = "force-dynamic";

/**
 * THE MONOPOLY MAP.
 *
 * The one screen that tells the whole thesis in a glance: out of everything DLA is buying,
 * how few parts are held by a single company that has gone quiet, and how few of THOSE we
 * could take. It is a funnel, and every number in it is counted from the files on disk.
 *
 * The design rule that governs this page is the one from lib/intelligence/corner.ts: the cross
 * is demand × dead-source × thin-availability, and only two of those three legs are readable
 * today. So this page renders CANDIDATES, names the third leg as unread on every row, and never
 * lets the headline number imply a confirmed, takeable position. The confirmed count is shown
 * precisely because it is zero, and it becomes non-zero the day the availability feed lands.
 */
export default async function MonopolyPage() {
  await requireGateSession("/monopoly");

  const root = resolveDataRoot();
  if (!root.present) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Intelligence</p>
          <h1 className={styles.h1}>Monopoly Map</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>The data directory is not mounted here</h2>
          <p>
            The map is computed from the government feed files, and this environment has no data
            directory. Nothing is shown rather than a fabricated map, and nothing has been assumed
            in its place.
          </p>
          <p className={styles.pathList}>
            <code>{root.root}</code> <span className={styles.faint}>({root.basis})</span>
          </p>
        </div>
      </main>
    );
  }

  const { cornerMap } = buildAllDatasets();
  const { summary, rows, provenance } = cornerMap;

  // Join real award history + availability from the NSN-Now export, where we have it. Most rows
  // will not have it until the full export lands; those render the honest unread state. A row
  // that DOES have it shows the government's actual paid price, not an abstention.
  const awardIndex = buildNsnAwardIndex();
  const awardByNsn = awardIndex.ok ? awardIndex.byNsn : null;
  const enriched = rows.map((r) => {
    const award = awardByNsn?.get(r.nsn.replace(/[^0-9]/g, "")) ?? null;
    return { ...r, award, score: scoreCorner(r, award) };
  });
  const pricedCount = enriched.filter((r) => r.award?.latest?.unitPrice != null).length;

  // The funnel, widest to narrowest. Each step is a real count, and the width is proportional
  // to the widest step so the narrowing reads at a glance without exaggeration.
  const funnel = [
    {
      n: summary.withDemandAndSource,
      label: "held by an approved source, under open demand",
      hint: "a company is approved to make it, and DLA is buying it now",
      tone: "base" as const,
    },
    {
      n: summary.soleSourcedWithDemand,
      label: "held by exactly one approved source",
      hint: "nobody else may supply it without a new source approval",
      tone: "mid" as const,
    },
    {
      n: summary.candidateCorners,
      label: "and that one source has gone award-silent",
      hint: "no recorded prime award in two years: a candidate corner",
      tone: "hot" as const,
    },
  ];
  const widest = Math.max(...funnel.map((f) => f.n), 1);

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Intelligence · feed day {provenance.feedDay}</p>
        <h1 className={styles.h1}>Monopoly Map</h1>
        <p className={styles.sub}>
          Every stock number DLA is buying from a single approved source, narrowed to the ones
          where that source has quietly stopped winning awards. These are positions to
          investigate, not confirmed corners.
        </p>
      </header>

      {/* ---------------------------------------------------------------- the funnel
       * The count sits ABOVE a full-width track, never inside the bar. The bar encodes
       * magnitude and nothing else, so the narrowest step (a two-digit width) can never clip
       * its own three-digit number, which it did when the number lived inside the fill. */}
      <section className={styles.funnel} aria-label="How the candidate corners are found">
        {funnel.map((step, i) => (
          <div key={i} className={styles.funnelRow}>
            <div className={styles.funnelHead}>
              <span className={`${styles.funnelN} ${styles[`fnN_${step.tone}`]}`}>
                {step.n.toLocaleString()}
              </span>
              <span className={styles.funnelText}>
                <span className={styles.funnelLabel}>{step.label}</span>
                <span className={styles.funnelHint}>{step.hint}</span>
              </span>
            </div>
            <div className={styles.funnelTrack}>
              <div
                className={`${styles.funnelBar} ${styles[`fn_${step.tone}`]}`}
                style={{ width: `${Math.max((step.n / widest) * 100, 2)}%` }}
              />
            </div>
          </div>
        ))}
      </section>

      {/* ---------------------------------------------------------------- the counts */}
      <section className={styles.stats} aria-label="Measured counts for this feed day">
        <div className={`${styles.stat} ${styles.statHot}`}>
          <div className={styles.statN}>{summary.candidateCorners.toLocaleString()}</div>
          <div className={styles.statL}>
            <b>candidate corners</b>
            <span className={styles.statHint}>sole source, under demand, source award-silent</span>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statN}>{summary.soleSourcedWithDemand.toLocaleString()}</div>
          <div className={styles.statL}>
            sole-sourced under demand
            <span className={styles.statHint}>one approved maker, DLA buying now</span>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statN}>{summary.silentApprovedSources.toLocaleString()}</div>
          <div className={styles.statL}>
            award-silent approved sources
            <span className={styles.statHint}>companies approved today, quiet two years</span>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statN}>{summary.confirmedCorners.toLocaleString()}</div>
          <div className={styles.statL}>
            <b>confirmed</b> corners
            <span className={styles.statHint}>zero until availability is read — see below</span>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- the truth strip */}
      <div className={styles.truth}>
        <span className={styles.truthDot} aria-hidden="true" />
        <div>
          <p>
            A corner is three things at once: <b>DLA is buying it</b>, <b>one company may make
            it</b>, and <b>nobody has it on a shelf</b>. Two of those three are read from the
            government files here. The third — whether stock exists anywhere — is{" "}
            <b>not read yet</b>, because no availability feed is connected. So every row below
            abstains on availability, and the confirmed count stays at zero by construction until
            that feed lands. Nothing here is estimated to fill the gap.
          </p>
          <p className={styles.truthProv}>
            Counted from{" "}
            <code>{provenance.sourceArchiveKey}</code>{" "}
            <span className={styles.faint}>
              sha256 {provenance.sourceArchiveSha256.slice(0, 12)}…
            </span>{" "}
            · source status inferred from public award silence, which federal reporting does not
            require below the micro-purchase threshold, so it is a signal and not a death notice.
          </p>
          <p className={styles.truthProv}>
            {awardByNsn
              ? `Award history is joined from the NSN-Now export where present: ${pricedCount.toLocaleString()} of these positions now carry a real paid price and its ten-year trend. The rest await the full export and say so per row.`
              : "No NSN-Now export is loaded yet, so award price reads as unread on every row rather than as an estimate."}
          </p>
        </div>
      </div>

      <MonopolyGrid rows={enriched} />
    </main>
  );
}
