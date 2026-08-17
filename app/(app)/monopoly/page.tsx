import type { Metadata } from "next";
import { requireGateSession } from "@/lib/session/require-gate";
import { buildMonopolyView } from "@/lib/intelligence/monopoly-view";
import { loadAmscIndex, resolveBidEligibility } from "@/lib/intelligence/eligibility/bid-eligibility";
import { resolveDataRoot } from "@/lib/data-root";
import { readDeals } from "@/lib/sales/deals-store";
import { normalizeDealRef } from "@/lib/sales/pipeline";
import { ExplainButton } from "@/components/ui/ExplainButton";
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

  // The whole join + score is memoized per feed day (lib/intelligence/monopoly-view): the
  // inputs are a pinned, hash-asserted snapshot, so recomputing them per request bought no
  // freshness, only ~2s of TTFB on the page the daily loop starts on. Rendering stays
  // force-dynamic; only the pure computation is reused.
  const view = buildMonopolyView();
  const { summary, provenance, rows: baseRows } = view;

  /**
   * BID ELIGIBILITY, joined here rather than inside `monopoly-view` on purpose.
   *
   * The view builds a deliberately SLIM wire shape because serializing the full records was a
   * 26 MB payload per visit, so this adds five short fields per row and nothing else. The whole
   * catalogue lookup is a Map hit against a 1.7 MB derived index that is loaded once, not once
   * per row.
   *
   * The two fields are kept SEPARATE and are not merged into one verdict, because they carry
   * different authority: `explanation` is DoD 4100.39-M Vol 10 Table 71 verbatim, a government
   * statement, while `posture` is this estate's own grouping of those codes and is graded
   * ESTIMATED in `lib/engine/eligibility/amsc.ts`. Collapsing them into a single string would
   * make it impossible for the grid to render one as fact and the other as a reading, which is
   * the entire point of carrying both.
   */
  const amscIndex = loadAmscIndex();
  const enriched = baseRows.map((r) => {
    const e = resolveBidEligibility(r.nsn, amscIndex);
    return {
      ...r,
      eligibility: {
        state: e.state,
        amsc: e.amsc,
        posture: e.posture,
        /** Verbatim government text, or null. Rendered as fact. */
        explanation: e.amscEntry?.explanation ?? null,
        /** Why we are abstaining, in words. Rendered instead of a blank, never as "unrestricted". */
        reason: e.reason,
      },
    };
  });
  // Two priced counts, two denominators, NEVER implied into one another: the map-wide figure
  // spans every enriched row, while the candidate figure is scoped to the funnel's own 115.
  // The strip sentence below names both denominators explicitly because a bare count directly
  // under a candidate-scoped sentence reads as candidate coverage, an 18x overstatement.
  const { pricedCount, candidatePricedCount, forecastCount, availCount } = view;
  const awardsJoined = view.awardsJoined;
  const forecastJoined = view.forecastJoined;

  // The refs already in the operator's pipeline, read from the real store, so every pursued
  // row renders its flipped "In pipeline" state on first paint.
  const pursuedRefs = readDeals()
    .map((d) => normalizeDealRef(d.ref))
    .filter((r) => r.length > 0);

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
        <div className={styles.titleRow}>
          <h1 className={styles.h1}>Monopoly Map</h1>
          {/* The page-level explainer for the whole tool, written and registered since the
              first milestone and mounted nowhere until the 2026-08-17 census. */}
          <ExplainButton helpId="monopoly.map" />
        </div>
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
            <span className={styles.statHint}>sole source, under open demand, award-silent</span>
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
            {/* Availability IS read now, from the export's own Availability sheet. What is still
                missing is an INDEPENDENT check, and that is the reason this stays at zero. The
                old hint said "until availability is read", which stopped being true on 08-16. */}
            <span className={styles.statHint}>
              zero until a listing is independently confirmed; see below
            </span>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- the truth strip */}
      <div className={styles.truth}>
        <span className={styles.truthDot} aria-hidden="true" />
        <div>
          <p>
            A corner is three things at once: <b>DLA is buying it</b>, <b>one company may make
            it</b>, and <b>nobody has it on a shelf</b>. The first two are read from the government
            files here. For the third, the NSN-Now export lists who <b>self-reports</b> stock:{" "}
            {awardsJoined ? (
              <>
                <b>{availCount.toLocaleString()}</b> of these candidate corners show a listing and
                the rest are marked absent.
              </>
            ) : (
              "no listing is loaded yet."
            )}{" "}
            A self-reported listing is not an independent shelf check, so the confirmed count stays
            at <b>zero</b> until a verified availability feed is connected. Nothing here is estimated
            to fill a gap.
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
            {awardsJoined
              ? `Award history is joined from the NSN-Now export where present: ${candidatePricedCount.toLocaleString()} of the ${summary.candidateCorners.toLocaleString()} candidate corners now carry a real paid price and its ten-year trend. Across the whole corner map (${enriched.length.toLocaleString()} positions): ${pricedCount.toLocaleString()}. The rest await the full export and say so per row.`
              : "No NSN-Now export is loaded yet, so award price reads as unread on every row rather than as an estimate."}
          </p>
          {forecastJoined ? (
            <p className={styles.truthProv}>
              <b>Forward demand is now measured, not inferred.</b>{" "}
              <b>{forecastCount.toLocaleString()}</b> of these candidate corners appear on the
              government's own <b>DLA Forecast</b> of parts it plans to buy again. A sole-source,
              award-silent part the buyer has said it will re-purchase is the strongest position on
              this page, and those rows carry it.
            </p>
          ) : null}
        </div>
      </div>

      <MonopolyGrid rows={enriched} pursuedRefs={pursuedRefs} />
    </main>
  );
}
