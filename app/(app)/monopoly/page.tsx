import { TextNote } from "@/components/ui/Note";
import type { Metadata } from "next";
import { requireGateSession } from "@/lib/session/require-gate";
import { buildMonopolyView } from "@/lib/intelligence/monopoly-view";
import { loadAmscIndex, resolveBidEligibility } from "@/lib/intelligence/eligibility/bid-eligibility";
import { groupByOperator, loadCageIndex } from "@/lib/intelligence/manufacturers/cage";
import { resolveDataRoot } from "@/lib/data-root";
import { readDeals } from "@/lib/sales/deals-store";
import { readSeen } from "@/lib/intelligence/seen-store";
import { readCaller, callerAccountId } from "@/lib/session/authz";
import { normalizeDealRef } from "@/lib/sales/pipeline";
import { ExplainButton } from "@/components/ui/ExplainButton";
import { MonopolyGrid } from "./MonopolyGrid";
import { boundRowsForWire, GRID_ROW_BUDGET } from "./wire-bound";
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
  const { summary, provenance, newestDayFunnel, rows: baseRows } = view;

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
  /**
   * COMPANIES, NOT CODES.
   *
   * `approvedSourceCount` counts CAGE CODES, and a CAGE code is not a company: one operator can
   * hold several, in different towns, under names that are not equal. Every row that reads "two
   * approved sources" while both codes belong to one firm is a corner being reported as a
   * competitive market, which is the direction of this error that costs an operator money.
   *
   * The resolution is SURFACED, never applied: `soleSource` and the disposition are left exactly
   * as the map computed them. `complex_confirmed` is a government record and could be counted,
   * but `same_operator_suspected` is our own reading and a false merge INVENTS a corner, so a
   * person decides. The grid shows the count and the evidence and lets them.
   */
  const cageIndex = loadCageIndex();

  /*
   * THE WIRE BOUND, APPLIED BEFORE THE ENRICHMENT RATHER THAN AFTER IT.
   *
   * The rule and the measurements live in ./wire-bound.ts, which is a pure function so the
   * behaviour is settled by test/feed-window/wire-bound.test.ts on inputs whose answer is known
   * in advance, rather than by reading this page. `totals` comes back from the same call and is
   * counted over every served row, so the grid's tab counts stay the MAP's counts while its
   * rows are a slice. Bounding before the enrichment also spares the catalogue and CAGE lookups
   * for the thousands of rows nobody was going to receive.
   */
  const bound = boundRowsForWire(baseRows, GRID_ROW_BUDGET);
  const gridTotals = bound.totals;

  const enriched = bound.shipped.map((r) => {
    const e = resolveBidEligibility(r.nsn, amscIndex);
    const ops = groupByOperator(r.approvedSources.map(String), cageIndex);
    const merged = ops.clusters.find((c) => c.cages.length > 1) ?? null;
    return {
      ...r,
      operators: {
        cageCount: ops.cageCount,
        operatorCount: ops.operatorCount,
        collapsed: ops.collapsed,
        /** Null unless two or more codes folded together on this row. */
        evidence: merged?.evidence ?? null,
        name: merged?.name ?? null,
        basis: merged?.basis ?? null,
      },
      eligibility: {
        state: e.state,
        amsc: e.amsc,
        posture: e.posture,
        /** Verbatim government text, or null. Rendered as fact. */
        explanation: e.amscEntry?.explanation ?? null,
        /** Why we are abstaining, in words. Rendered instead of a blank, never as "unrestricted". */
        reason: e.reason,
        /*
         * CARRIED, NOT RESOLVED. The derivation picks the managing activity's row when an item
         * appears under several MOE rules, and picking is correct. Presenting the pick as though
         * the record were unanimous is not, so the disagreement travels with the claim.
         */
        contested: e.contested,
      },
    };
  });
  // Two priced counts, two denominators, NEVER implied into one another: the map-wide figure
  // spans every SERVED row, while the candidate figure is scoped to the funnel's narrowest step.
  // The strip sentence below names both denominators explicitly because a bare count directly
  // under a candidate-scoped sentence reads as candidate coverage, an 18x overstatement.
  //
  // THE MAP-WIDE DENOMINATOR IS `view.rows.length`, NOT `enriched.length`. `pricedCount` is
  // counted in monopoly-view over every served row; `enriched` is now the bounded slice that
  // crosses the wire, so printing its length beside that count would have divided a whole-map
  // numerator by a page-sized denominator and overstated coverage roughly tenfold.
  const { pricedCount, candidatePricedCount, forecastCount, availCount, availAbsentCount, availUnreadCount } = view;
  const servedRowCount = view.rows.length;
  const awardsJoined = view.awardsJoined;
  const forecastJoined = view.forecastJoined;

  // The refs already in the operator's pipeline, read from the real store, so every pursued
  // row renders its flipped "In pipeline" state on first paint.
  const pursuedRefs = readDeals()
    .map((d) => normalizeDealRef(d.ref))
    .filter((r) => r.length > 0);

  /**
   * SEEN-STATE, read SERVER-SIDE so the glow is correct on the very first paint.
   *
   * Fetching this from the client after mount would paint every row as unseen for one frame and
   * then repaint the worked ones red, which on a board this size is a visible flash that says the
   * opposite of the truth. It is also why `available` is threaded through rather than collapsed to
   * an empty array: an unreadable store must render as UNKNOWN, never as a clean board.
   */
  const seen = readSeen(callerAccountId(await readCaller()));

  /**
   * THE SPAN AND THE INSTANT, both printed rather than implied.
   *
   * `coverage` is built by lib/intelligence/corner.ts over the whole window and was rendered
   * nowhere, while the header and this strip named ONE archived file. Measured before this fix:
   * the page printed "Counted from dibbs-rfq-daily/2026-08-14/.../bq260814.zip" beside counts
   * where 184 of 10,488 rows, 1.8%, came from that file and the other 98.2% came from thirteen
   * other captures with thirteen other hashes. The archive key and hash are correct PER ROW and
   * stay there; the map-level line now states the span the counts were actually taken over.
   */
  const coverage = view.coverage;
  const isWindow = coverage.basis === "window";
  const spanLabel = isWindow
    ? `${coverage.dayCount} archived feed days, ${coverage.firstDay} to ${coverage.lastDay}`
    : `the single archived feed day ${coverage.firstDay}`;
  const judgedOn = coverage.excludedFromDemand?.asOf ?? null;

  // The funnel, widest to narrowest. Each step is a real count over every served row, never
  // over the bounded slice the grid receives, and the width is proportional to the widest step
  // so the narrowing reads at a glance without exaggeration.
  const funnel = [
    {
      n: summary.withDemandAndSource,
      label: "held by an approved source, under open demand",
      hint: judgedOn
        ? `a company is approved to make it, and its solicitation had not closed as of ${judgedOn}`
        : "a company is approved to make it, and DLA is buying it now",
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
        {/* The eyebrow named ONE feed day while every count beside it was counted across the
            whole window. It names the span now; the newest capture keeps its own billing in
            the freshness pill in the shell, which is a claim about currency, not about basis. */}
        <p className={styles.eyebrow}>Intelligence · counted across {spanLabel}</p>
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
      <section className={styles.stats} aria-label={`Measured counts across ${spanLabel}`}>
        <div className={`${styles.stat} ${styles.statHot}`}>
          <div className={styles.statN}>{summary.candidateCorners.toLocaleString()}</div>
          <div className={styles.statL}>
            <b>candidate corners</b>
            {/* BOTH NUMBERS OR NEITHER, AND BOTH JUDGED ON THE SAME DAY. A count that grew
                from 18 to the hundreds between two deploys, with nothing on the screen saying
                the basis changed, reads as invention. The newest day's own figure is computed
                by the same builder over that day's own files AND narrowed by the same
                `openDemand` reference, so the two numbers here are like for like. Until
                2026-08-18 only the window was judged: measured a week past the newest capture
                that printed 11 beside an unjudged 18, and two weeks past it, 0 beside 18. */}
            <span className={styles.statHint}>
              sole source, under open demand, award-silent
              {newestDayFunnel
                ? ` · the newest archived day alone, ${coverage.lastDay}${
                    judgedOn ? `, judged against the same ${judgedOn}` : ""
                  }, shows ${newestDayFunnel.candidateCorners.toLocaleString()}`
                : ""}
            </span>
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
                <b>{availCount.toLocaleString()}</b> of these candidate corners show a listing,{" "}
                <b>{availAbsentCount.toLocaleString()}</b> were read and list nobody, and{" "}
                <b>{availUnreadCount.toLocaleString()}</b> have no availability row at all, so
                nothing has been read for them.
              </>
            ) : (
              "no listing is loaded yet."
            )}{" "}
            A self-reported listing is not an independent shelf check, so the confirmed count stays
            at <b>zero</b> until a verified availability feed is connected. Nothing here is estimated
            to fill a gap.
          </p>
          {/* THE BASIS, IN THE WORDS THE BUILDER WROTE IT IN. One sentence, one definition
              (lib/intelligence/corner.ts `cornerCoverageStatement`), so this strip cannot drift
              from the dashboard or from the dossier the AI brief is written out of. It carries
              the span, the thin-day comparison, what was excluded from demand and on which day,
              and what the newest archived day alone shows judged against that same day. */}
          <TextNote text={coverage.statement} label="How the window is counted" tone="quiet" />
          {/* THE INSTRUCTION HAS TO BE FOLLOWABLE. This sentence told the operator to open a
              row to read that row's archived file and hash while the expansion rendered
              neither: `grep -c -e sha256 -e archiveStorageKey -e feedDay` over MonopolyGrid.tsx
              returned 0. The fields were on the wire and paid for in bytes and were simply
              never drawn. They are drawn now, by ./row-provenance.ts, under the two headings
              named here, so the sentence says WHERE the citation is rather than that one
              exists. */}
          <p className={styles.truthProv}>
            Each row cites the archived government file <b>its own feed day</b> published, with
            that day&rsquo;s recorded sha256. Expand any row: they are the{" "}
            <b>Feed day</b> and <b>Archived file</b> lines, and the hash is printed whole so it
            can be checked against the file. The newest capture is{" "}
            <code>{provenance.sourceArchiveKey}</code>{" "}
            <span className={styles.faint}>
              sha256 {provenance.sourceArchiveSha256.slice(0, 12)}…
            </span>
            , which is one of {coverage.daysIncluded.length.toLocaleString()} captures behind these
            counts and not the source of all of them. Source status is inferred from public award
            silence, which federal reporting does not require below the micro-purchase threshold,
            so it is a signal and not a death notice.
          </p>
          <p className={styles.truthProv}>
            {awardsJoined
              ? `Award history is joined from the NSN-Now export where present: ${candidatePricedCount.toLocaleString()} of the ${summary.candidateCorners.toLocaleString()} candidate corners now carry a real paid price and its ten-year trend. Across the whole corner map (${servedRowCount.toLocaleString()} positions): ${pricedCount.toLocaleString()}. The rest await the full export and say so per row.`
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

      <MonopolyGrid
        rows={enriched}
        pursuedRefs={pursuedRefs}
        seenNsns={seen.nsns}
        seenAvailable={seen.available}
        awardsJoined={awardsJoined}
        totals={gridTotals}
        basis={coverage.basis}
      />
    </main>
  );
}
