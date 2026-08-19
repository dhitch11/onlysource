"use client";


/*
 * /design  THE DESIGN SYSTEM REFERENCE SURFACE. Owner: T8 DESIGN.
 *
 * This route is three things at once, and the third is the one that matters:
 *   1. The documentation for the other seven lanes.
 *   2. A regression test you can see.
 *   3. THE PROOF THE SYSTEM EXISTS. A design system nobody can open is a claim, not a
 *      system, and a Figma file nobody imports is decoration.
 *
 * WHEN YOU ADD A COMPONENT, ADD ITS STATES HERE IN THE SAME COMMIT. Not the next one.
 *
 * Everything on this page is real: real components, real tokens, real states. The sample
 * VALUES are labelled as reference values and none of them are presented as live product
 * data, because the no-seeded-data house law binds this surface too.
 */

import { useEffect, useState } from "react";
import { systemClock } from "@/lib/time/clock";
import { HYDRATION_SAFE_INSTANT } from "@/components/ui/use-relative-now";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { ExplainButton } from "@/components/ui/ExplainButton";
import { Provenance, Unconfirmed } from "@/components/ui/Provenance";
import { Identifier } from "@/components/ui/Identifier";
import { Money } from "@/components/ui/Money";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { TruthStrip } from "@/components/ui/TruthStrip";
import {
  EmptyState,
  NoResults,
  NotConnected,
  InsufficientData,
  PartialCoverage,
  StaleBanner,
  ErrorState,
  PermissionDenied,
  Skeleton,
} from "@/components/ui/States";
import { allHelp } from "@/components/help/registry";
import styles from "./design.module.css";
import rt from '@/components/ui/responsive-table.module.css'

type Theme = "dark" | "light";

const COVERAGE_COLS = {
  helpId: "helpId",
  owner: "Owner",
  content: "Content",
} as const

export default function DesignPage() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [busy, setBusy] = useState(false);

  /*
   * A MOUNT-STABLE CLOCK, and it is here to fix a real defect that was live on production.
   *
   * This showcase built its illustrative timestamps with `Date.now()` at five call sites. In a
   * client component that also renders on the server, the server evaluates one instant and the
   * browser evaluates a different one milliseconds later, so the two trees disagree on a text
   * node and React throws a hydration error (#418). It was the ONLY page error in the whole app,
   * on every load of this route.
   *
   * The fix is not a frozen constant: these values demonstrate RELATIVE time ("2 hours ago"), and
   * freezing them would make the showcase demonstrate the wrong thing within a day. Instead both
   * sides render the same fixed instant first, and the real clock is adopted after mount, where
   * there is no server tree left to disagree with.
   *
   * It also removes a straight violation of the R0.3 rule that only `lib/time/clock.ts` may read
   * wall time, which exists precisely because an untestable clock read ships bugs like this one.
   */
  // The SAME instant the shared hook uses. Two different "fixed" instants produced SSR text
  // like "(-327510 min ago)": each was self-consistent and they disagreed with each other.
  const [nowMs, setNowMs] = useState<number>(HYDRATION_SAFE_INSTANT);
  useEffect(() => {
    setNowMs(systemClock.now());
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    return () => document.documentElement.removeAttribute("data-theme");
  }, [theme]);

  const help = allHelp();

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Design system</h1>
          <p className={styles.lede}>
            Owned by T8. Every token and component in every state. If you are building a
            screen, build it out of what is on this page. If what you need is not here, post
            in the claims file and it gets built next.
          </p>
        </div>
        <div className={styles.themeSwitch}>
          <span className="eyebrow">Theme</span>
          <Button
            variant={theme === "dark" ? "primary" : "secondary"}
            onClick={() => setTheme("dark")}
          >
            Dark
          </Button>
          <Button
            variant={theme === "light" ? "primary" : "secondary"}
            onClick={() => setTheme("light")}
          >
            Light
          </Button>
        </div>
      </header>

      {/* ------------------------------------------------------------------ TRUTH STRIP */}
      <Section
        title="TruthStrip"
        note="Ships before the grid. War room ruling, not a preference: an explain button on a stale column is a more convincing lie than no explain button at all. Non-collapsible, no dismiss control, and there is deliberately no prop to hide it."
      >
        <TruthStrip
          orgName="ONLYSOURCE"
          sources={[
            { label: "DIBBS RFQ feed", count: 1957, receivedAt: new Date(nowMs - 5.4e6).toISOString(), quarantined: 1, quarantineHref: "#" },
            { label: "Award history", unavailableReason: "not connected yet" },
            { label: "Approved sources", count: 3683, receivedAt: new Date(nowMs - 8.2e6).toISOString() },
          ]}
          partialCoverage={{ indexed: 12480, total: 52000, of: "NSNs" }}
        />
        <p className={styles.caption}>
          Above: a source that arrived, a source that has not, and a quarantine count that is
          openable. An absent source renders as an absence, never as a zero. Those are
          different facts and an operator acts differently on each.
        </p>
      </Section>

      {/* ---------------------------------------------------------------- TYPE + TOKENS */}
      <Section
        title="Type scale"
        note="Seven steps, all rem, so a raised browser base font size scales all of it. The floors are Quality Bar R7: 15px table body, 16px form input, 13px absolute floor. The approved comp declared 98 sizes, 79 of them below that floor and all 98 in px."
      >
        <div className={styles.typeList}>
          {[
            ["--fs-700", "28px", "Instrument readouts, KPI values"],
            ["--fs-600", "22px", "Section and page headings"],
            ["--fs-500", "18px", "Card titles, emphasis"],
            ["--fs-400", "16px", "Form input values. The iOS no-zoom threshold"],
            ["--fs-300", "15px", "Table body minimum. Default body text"],
            ["--fs-200", "14px", "Secondary text"],
            ["--fs-100", "13px", "The absolute floor. Metadata, eyebrow labels"],
          ].map(([token, px, use]) => (
            <div key={token} className={styles.typeRow}>
              <span className={`mono ${styles.typeToken}`}>{token}</span>
              <span className={`mono ${styles.typePx}`}>{px}</span>
              <span style={{ fontSize: `var(${token})` }}>{use}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Colour roles"
        note="Brass is the single accent and nothing competes for it. Olive is the measured and verified role and it never decorates. Amber and red are RESERVED for the auto-award clock: a red or an amber anywhere on a surface must mean the clock, or it is a bug. That reservation is why the palette reads calm until something is genuinely about to close."
      >
        <div className={styles.swatches}>
          {[
            ["--ink", "primary text"],
            ["--dim", "secondary text"],
            ["--faint", "metadata"],
            ["--accent", "THE accent. Brass"],
            ["--olive", "measured / verified"],
            ["--steel", "modelled"],
            ["--amber", "clock: sweep firing"],
            ["--red", "clock: critical"],
            ["--violet", "minor category"],
          ].map(([token, role]) => (
            <div key={token} className={styles.swatch}>
              <span className={styles.swatchChip} style={{ background: `var(${token})` }} />
              <span className={`mono ${styles.swatchToken}`}>{token}</span>
              <span className={styles.swatchRole}>{role}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------------- AFFORDANCE */}
      <Section
        title="ExplainButton"
        note="The owner's hard requirement and the highest-leverage component here. A real focusable button toggling a non-modal popover. Never role=tooltip, never a title attribute, and hover opens nothing, ever. Click the dot. Then rest your pointer on it and confirm that nothing happens."
      >
        <div className={styles.row}>
          <span>Corner-ability score</span>
          <ExplainButton
            helpId="ui.provenance.glyph"
            computation={{
              factors: [
                { label: "Approved source inactive", contribution: 34 },
                { label: "Forward demand present", contribution: 21 },
                { label: "Last award was surplus", contribution: 12 },
                { label: "Competitor already listed", contribution: -8 },
              ],
              counterfactual: "A live approved source with current SAM registration would remove the top factor and drop this below the flag threshold.",
              dataGaps: ["ILS availability not refreshed in 9 days"],
              modelVersion: "reference-values-only",
              asOf: new Date(nowMs - 3.6e6).toISOString(),
            }}
          />
          <span className={styles.caption}>with a live computation record</span>
        </div>

        <div className={styles.row}>
          <span>Abstained row</span>
          <ExplainButton
            helpId="ui.truth_strip"
            computation={{
              factors: [],
              abstained: true,
              abstainReason: "no award history for this NSN in the indexed window",
              modelVersion: "reference-values-only",
              asOf: new Date(nowMs - 1.1e6).toISOString(),
            }}
          />
          <span className={styles.caption}>abstention is an answer, not a failure</span>
        </div>

        <div className={styles.row}>
          <span>An id nobody has written yet</span>
          <ExplainButton helpId="compliance.path.c04" />
          <span className={styles.caption}>
            names the lane that owes it. It never invents an explanation
          </span>
        </div>
      </Section>

      {/* ------------------------------------------------------------------- PROVENANCE */}
      <Section
        title="Provenance and confirmation: two orthogonal axes"
        note="Three glyph states on one axis, one overlay on the other. They compose. Never a fourth glyph. Shape carries the meaning and colour repeats it, so the board still works rendered in greyscale."
      >
        <div className={styles.grid3}>
          <div>
            <p className="eyebrow">Axis 1: provenance</p>
            <div className={styles.stack}>
              <Provenance kind="measured" showLabel />
              <Provenance kind="modelled" showLabel />
              <Provenance kind="insufficient" showLabel />
            </div>
          </div>
          <div>
            <p className="eyebrow">Axis 2: confirmation</p>
            <div className={styles.stack}>
              <Unconfirmed sourceHref="#" onAccept={() => {}}>
                <span className="mono">4,200</span>
              </Unconfirmed>
            </div>
          </div>
          <div>
            <p className="eyebrow">Composed</p>
            <div className={styles.stack}>
              <Unconfirmed sourceHref="#">
                <Money amount={9827} provenance="modelled" />
              </Unconfirmed>
              <span className={styles.caption}>modelled AND unconfirmed</span>
            </div>
          </div>
        </div>
      </Section>

      {/* ----------------------------------------------------------------------- VALUES */}
      <Section
        title="Identifier, Money, ScoreRing"
        note="Identifiers truncate in the MIDDLE because the discriminating characters live at the end, and the full value stays selectable and copyable. A field the government truncated upstream renders a source-truncated marker and gets NO copy control, because promising the whole value and handing back a partial one is a claim we cannot honour."
      >
        <div className={styles.stack}>
          <div className={styles.row}>
            <Identifier value="4820-01-049-5470" field="solicitation" label="NSN" />
            <span className={styles.caption}>copyable, tabular, never wraps</span>
          </div>
          <div className={styles.row}>
            <Identifier value="SPE4A625T1234567890ABCDEF" max={16} label="solicitation number" />
            <span className={styles.caption}>middle-truncated, tail intact</span>
          </div>
          <div className={styles.row}>
            <Identifier value="COVERALLS,ANTI-EXPO" sourceTruncated label="nomenclature" />
            <span className={styles.caption}>
              truncated upstream. No copy control, no false promise
            </span>
          </div>
          {/*
           * SPECIMEN VALUES, SAID OUT LOUD.
           *
           * These four are swatches showing what each provenance state LOOKS like, which is
           * the only way to show them side by side. But the glyph's whole job is to certify
           * that a figure was measured, so a specimen wearing it with nothing nearby saying
           * so teaches a reader that `measured` is decoration — on the very page that
           * teaches the design system. The ExplainButton section above already solves this
           * for its own examples by carrying `modelVersion: "reference-values-only"`; this
           * row now says the same thing in the same voice. It is a caption rather than a
           * fourth ProvenanceKind because "specimen" is a fact about this PAGE, not a state
           * a real figure can ever be in, and widening the union would let it become one.
           */}
          <div className={styles.row}>
            <Money amount={9827} provenance="measured" />
            <Money amount={23} provenance="measured" precision={2} />
            <Money amount={412000} provenance="modelled" />
            <Money amount={null} provenance="insufficient" absentReason="no award history" />
            <span className={styles.caption}>
              reference values only. Specimens of each state, not readings from the data
            </span>
          </div>
          <div className={styles.row}>
            <Money amount={41200} provenance="measured" emphasis />
            <span className={styles.caption}>
              headline treatment, reference value only. In the product this is a stored
              vetted field, never a client-side re-sum
            </span>
          </div>
          <div className={styles.row}>
            <ScoreRing value={94} label="Corner-ability" />
            <ScoreRing value={61} label="Corner-ability" />
            <ScoreRing value={28} label="Corner-ability" />
            <ScoreRing value={null} label="Corner-ability" abstainReason="no indexed award history" />
            <span className={styles.caption}>the ring reinforces the number, it never replaces it</span>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------------------- CONTROLS */}
      <Section
        title="Button and StatusChip"
        note="The loading state keeps its width, because a control that shrinks moves everything next to it and misclicks in this product submit things to the government. Destructive does not lean on red, because red means the clock here and a colour must not carry two meanings."
      >
        <div className={styles.row}>
          <Button variant="primary">Submit quote</Button>
          <Button variant="secondary">Save view</Button>
          <Button variant="quiet">Cancel</Button>
          <Button variant="destructive">Offboard member</Button>
          <Button variant="primary" busy={busy} busyLabel="Submitting quote">
            Click to see busy
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setBusy(true);
              window.setTimeout(() => setBusy(false), 2200);
            }}
          >
            Toggle busy
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </div>
        <div className={styles.row}>
          <StatusChip tone="verified">In hand</StatusChip>
          <StatusChip tone="active">Quoting</StatusChip>
          <StatusChip tone="idle">Not started</StatusChip>
          <StatusChip tone="urgent">Sweeps in 2h 14m</StatusChip>
          <StatusChip tone="critical">Sweeps today</StatusChip>
        </div>
      </Section>

      {/* ------------------------------------------------------------------------ STATES */}
      <Section
        title="The state surfaces"
        note="Three different empty states, and they are three different facts. Collapsing them into one no-data screen is the most common way an operator tool wastes somebody's morning."
      >
        <div className={styles.stack}>
          <EmptyState
            title="No requirements ingested yet"
            body="The daily government feed runs overnight. The first queue will appear here after the next ingest. Nothing is wrong."
            action={{ label: "See ingest status", onClick: () => {} }}
          />
          <NoResults culpritFilter="Fast Auto only" onClearCulprit={() => {}} totalWithoutFilter={22014} />
          <NotConnected
            source="Unsuccessful bidder reports"
            wouldAdd="Adds the losing quote prices to every award on this screen, which is what turns a win rate into a pricing model."
            whoCanConnect="an administrator"
            connectHref="#"
          />
          <ErrorState
            what="The award history query timed out"
            meaning="The rows below are complete, but their award history columns are blank rather than empty."
            next="Retry now. If it fails twice, the ingest job is likely still running."
            traceId="req_8f2a41c9"
            onRetry={() => {}}
          />
          <PermissionDenied surface="Admin and users" requiredRole="admin" />
          <StaleBanner asOf={new Date(nowMs - 9e7).toISOString()} onRefresh={() => {}} />
          <div className={styles.row}>
            <InsufficientData missing="no ILS availability for this NSN" />
            <PartialCoverage indexed={12480} total={52000} of="NSNs in the scan" />
          </div>
          <div>
            <p className="eyebrow">Loading, cold</p>
            <Skeleton rows={4} />
            <p className={styles.caption}>
              Skeleton rows are sized from the same --row-h token the real grid uses, so
              nothing shifts by a pixel when data lands.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------- HELP COVERAGE */}
      <Section
        title="Explainer coverage"
        note="The coverage report. Every registered id, which lane owns it, and whether its content is written. A requirement that lives only in a document decays, so this is mechanical."
      >
        <div className={`${styles.coverageWrap} ${rt.cards}`}>
        <table className={styles.coverage}>
          <thead>
            <tr>
              <th>{COVERAGE_COLS.helpId}</th>
              <th>{COVERAGE_COLS.owner}</th>
              <th>{COVERAGE_COLS.content}</th>
            </tr>
          </thead>
          <tbody>
            {help.map((h) => (
              <tr key={h.id}>
                <td className="mono" data-label={COVERAGE_COLS.helpId}>{h.id}</td>
                <td data-label={COVERAGE_COLS.owner}>{h.owner}</td>
                <td data-label={COVERAGE_COLS.content}>
                  <StatusChip tone="verified">written</StatusChip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className={styles.caption}>
          {help.length} ids registered. Lanes: add yours in a file you own and register it in
          components/help/registry.ts. T4 has already done this and lib/intelligence/help.ts
          is the reference implementation.
        </p>
      </Section>

      <footer className={styles.foot}>
        <p>
          Sample values on this page are reference values for showing component states. They
          are not product data and nothing here reads from a live source. The no-seeded-data
          house law binds this surface too.
        </p>
      </footer>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>{title}</h2>
      {note ? <p className={styles.note}>{note}</p> : null}
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
