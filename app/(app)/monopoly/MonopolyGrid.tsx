"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { DataGrid, type GridColumn, type Cell } from "@/components/ui/DataGrid";
import { normalizeNsn } from "@/lib/intelligence/nsn-key";
import { AiLoader } from "@/components/ui/AiLoader";
import { StatusChip } from "@/components/ui/StatusChip";
import { PriceSparkline } from "@/components/ui/PriceSparkline";
import { PursueButton } from "@/components/sales/PursueButton";
import { normalizeDealRef } from "@/lib/sales/pipeline";
import type { EnrichedCornerRow } from "@/lib/intelligence/monopoly-view";
import type { EligibilityState } from "@/lib/intelligence/eligibility/bid-eligibility";
import { dispositionLabel } from "@/lib/intelligence/scoring/evidence-state";
import { fmtPoints, rankCompare } from "@/lib/intelligence/scoring/cornerscore";
import { isRisingPrice } from "@/lib/intelligence/rising-price";
import { rowProvenanceEntries } from "./row-provenance";
import styles from "./monopoly.module.css";

/**
 * A corner row with its award history, DLA Forecast and CornerScore joined in, in the SLIM
 * wire shape lib/intelligence/monopoly-view builds: exactly the fields this grid renders,
 * because serializing the full records was a 26MB payload per visit. Plus the acquisition
 * codes, joined in `page.tsx` as five short fields for the same payload reason.
 *
 * `explanation` and `posture` are deliberately separate fields. `explanation` is DoD 4100.39-M
 * Vol 10 Table 71 quoted verbatim and may be rendered as fact. `posture` is this estate's own
 * grouping of those codes, graded ESTIMATED at source, and must render more quietly. One merged
 * field would make that distinction impossible at the render layer, which is where it matters.
 */
export type RowEligibility = {
  /*
   * THE UNION IS IMPORTED, NEVER RESTATED. It was written out here as four literals and went
   * stale the moment lib/intelligence/eligibility/bid-eligibility.ts added a fifth
   * (`abstained_suffix_code_not_in_table`): a hardcoded list is a defect with a delay on it,
   * and this one broke the build rather than lying, which was the lucky direction. Every cell
   * below already abstains on anything that is not `determined`, so a new abstention state
   * renders as an abstention with its own reason and needs no edit here.
   */
  state: EligibilityState;
  amsc: string | null;
  posture: string | null;
  explanation: string | null;
  reason: string;
  /*
   * WHERE THE GOVERNMENT DOES NOT AGREE WITH ITSELF ABOUT THIS ITEM. Three booleans, carried on
   * the slim wire shape because they qualify a claim the operator is about to act on. Measured
   * on the live catalogue: 116 items where two activities state a different acquisition method,
   * 319 a different suffix code, and 24 where ONE activity contradicts its own rows.
   */
  contested: { amc: boolean; amsc: boolean; selfContradiction: boolean };
};

/**
 * How many COMPANIES stand behind this row's CAGE codes.
 *
 * `evidence` is null unless two or more codes folded together here. `complex_confirmed` is the
 * government's own corporate-complex record; `same_operator_suspected` is our reading from a
 * matching company name plus a shared contract administration office, and it renders weaker
 * because a false merge invents a corner, which is the expensive direction.
 */
export type RowOperators = {
  cageCount: number;
  operatorCount: number;
  collapsed: boolean;
  evidence: "complex_confirmed" | "same_operator_suspected" | "distinct" | "unresolved" | null;
  name: string | null;
  basis: string | null;
};

export type CornerRowWithAward = EnrichedCornerRow & {
  eligibility?: RowEligibility;
  operators?: RowOperators;
};

// Amber is the award clock's alone. Watchlist is a neutral in-progress state, not an alarm.
/**
 * THE ACQUISITION-CODE CELL, EXPORTED SO IT CAN BE PRESSED RATHER THAN READ.
 *
 * MEASURED, and it is why this is a named function instead of an inline arrow: on a row whose
 * suffix code the transcribed Table 71 does not list, this cell painted
 * `<StatusChip tone="verified">AMSC E</StatusChip>` with provenance "measured" for a code nobody
 * has read. `resolveBidEligibility` returned state "determined" with a non-empty `amsc` and a null
 * table entry, and the only test here was `state !== "determined"`. The engine now returns
 * `abstained_suffix_code_not_in_table` for exactly that row, so the abstention below is reached and
 * renders the reason sentence the engine wrote. Both halves are asserted in
 * test/dossier-eligibility/monopoly-acquisition-cell.test.ts against the fixture that produced the
 * defect, which is the only way to know this cell abstains rather than to believe it.
 *
 * A blank AMSC is never rendered as "unrestricted". Fill is bimodal by managing activity: the
 * activities that publish it publish on ~100% of their rows and the rest publish none, so an
 * absence is a different PUBLISHER, not a permissive answer.
 */
/**
 * THE SENTENCE FOR AN ITEM THE GOVERNMENT DOES NOT AGREE WITH ITSELF ABOUT.
 *
 * Two authorities disagreeing and ONE authority contradicting itself are different facts and are
 * worded differently. A tie between sources is a fact about the catalogue; a source disagreeing
 * with its own rows is a fact about the quality of that source's record, and it is the one an
 * operator should weigh hardest before spending money on it.
 */
function contestedNote(
  /*
   * OPTIONAL ON PURPOSE, AND A TEST FOUND OUT WHY. An eligibility object assembled before this
   * field existed reaches here as `undefined`, and dereferencing it threw — inside a SERVER
   * COMPONENT, which means the whole page renders as the error boundary rather than one cell
   * rendering wrong. A row whose flags are absent is a row nothing contested, which is the same
   * answer the binary index gives for a file written before byte 7 carried them.
   */
  c: { amc: boolean; amsc: boolean; selfContradiction: boolean } | undefined,
): string | null {
  if (!c) return null;
  if (c.selfContradiction) return "one activity contradicts its own rows on this item";
  if (c.amc && c.amsc) return "two activities disagree on the method and the code";
  if (c.amsc) return "two activities disagree on the code";
  if (c.amc) return "two activities disagree on the method";
  return null;
}

export function acquisitionCodeCell(r: CornerRowWithAward): Cell {
  const e = r.eligibility;
  if (!e) return { state: "unknown", reason: "the acquisition-code index is not loaded" };
  if (e.state !== "determined" || !e.amsc) return { state: "unknown", reason: e.reason };

  /*
   * ★ THE CLAIM PLUS THE DISAGREEMENT, NOT A QUIETER CLAIM AND NOT A SEPARATE WARNING.
   *
   * The derivation picks the managing activity's row when an item appears under several MOE
   * rules. Picking is correct; presenting the pick as though the record were unanimous is not.
   * Measured on the live catalogue: 116 stock numbers where two activities state a different
   * acquisition method, 319 a different suffix code, and 24 where one activity contradicts
   * itself.
   *
   * So the code still renders, because it is still the managing activity's answer, and the
   * qualification rides ON the claim rather than as a badge somewhere else competing for
   * attention. The chip tone moves from verified to active: the same fact, held less firmly.
   */
  const note = contestedNote(e.contested);
  if (note === null) {
    return {
      state: "known",
      provenance: "measured",
      value: <StatusChip tone="verified">{`AMSC ${e.amsc}`}</StatusChip>,
    };
  }
  return {
    state: "known",
    provenance: "measured",
    value: (
      <span className={styles.contestedCell}>
        <StatusChip tone="active">{`AMSC ${e.amsc}`}</StatusChip>
        <span className={styles.contestedNote}>{note}</span>
      </span>
    ),
  };
}

const DISPOSITION_TONE: Record<string, "verified" | "active" | "idle"> = {
  FLAG: "verified",
  WATCHLIST: "active",
  INSUFFICIENT_DATA: "idle",
  SKIP: "idle",
};

// The lockup verdict, the sole-source inversion. Surplus opportunity is the money signal (the
// dead-OEM open door) and wears the brass accent; locked is a closed door and reads quiet.
const LOCKUP_LABEL: Record<string, string> = {
  surplus_opportunity: "Surplus opportunity",
  competitive: "Competitive",
  watchlist: "Watchlist",
  locked: "Locked",
};
const LOCKUP_TONE: Record<string, "verified" | "active" | "idle" | "accent"> = {
  surplus_opportunity: "accent",
  competitive: "verified",
  watchlist: "active",
  locked: "idle",
};
// Best-first when sorting the lockup column.
const LOCKUP_SORT: Record<string, number> = {
  surplus_opportunity: 0,
  competitive: 1,
  watchlist: 2,
  locked: 3,
};

type Filter = "candidate" | "sole" | "all";
type ToggleKey = "onForecast" | "machine" | "rising" | "priced";

const usd = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The candidate grid. Every cell is one of three states, so a leg we did not read renders as
 * an explicit abstention, never as a blank or a zero. The availability column is ALWAYS
 * unknown by design: it is the unread third leg, and showing it as a stated gap on every row
 * is the honest shape of the product until the locator feed is connected.
 */
/**
 * THE STOCK NUMBER COLUMN, built per render because it has to know what has already been opened.
 *
 * David, 2026-08-29: "click an opportunity and view it, and its stock number turns a glowing red
 * from then on ... so we know we have already looked at it". On a board of thousands of corners
 * the costly mistake is not reading a row, it is REREADING one, so the mark is carried by the one
 * cell the operator scans down.
 *
 * ★ THE MARK IS RENDERED FROM A NORMALIZED KEY, never from the displayed string. The row carries
 * `5340-01-608-5969` and the store keys on `5340016085969`; comparing the two raw would simply
 * never match and would never throw. `normalizeNsn` is the single shared definition.
 *
 * ⛔ `seenKnown === false` MEANS UNKNOWN, NOT UNSEEN. When the store could not be read, NO row is
 * marked and the filter is withdrawn, rather than painting a worked board as untouched.
 */
function nsnColumn(
  seen: ReadonlySet<string>,
  seenKnown: boolean,
  onOpen: (nsn: string) => void,
): GridColumn<CornerRowWithAward> {
  return {
    id: "nsn",
    header: "Stock number",
    mono: true,
    width: "16ch",
    pinned: true,
    sortValue: (r) => r.nsn,
    // The stock number is the way in. Every corner opens its full dossier: the price trajectory,
    // the whole award history, the score legs, and the AI brief — all from the same measured data.
    cell: (r): Cell => {
      const isSeen = seenKnown && seen.has(normalizeNsn(r.nsn));
      return {
        state: "known",
        provenance: "measured",
        value: (
          <Link
            href={`/corner/${normalizeNsn(r.nsn)}` as never}
            className={`${styles.nsnLink} ${isSeen ? styles.nsnSeen : ""}`}
            // Marked on the way OUT, so the row is already red when the back button returns the
            // operator to the board. The dossier page marks it again on open, which is what makes
            // a bookmark or a pasted URL count as seen; both writes are idempotent.
            onClick={() => onOpen(r.nsn)}
            title={isSeen ? "You have already opened this corner" : undefined}
          >
            {r.nsn}
            {isSeen ? <span className="vh"> (already opened)</span> : null}
          </Link>
        ),
      };
    },
  };
}

const columns: GridColumn<CornerRowWithAward>[] = [
  {
    id: "score",
    header: "CornerScore",
    width: "17ch",
    align: "end",
    // The flagship 0-100 rank finally explains itself where it is ranked by (census
    // 2026-08-17: the one major column with no eye was the one operators sort money by).
    // Sorted by the UNCLAMPED rankKey so two rows both showing a 100 badge still order by the
    // real value underneath; the badge shown is the clamped scoreV0.
    helpId: "score.corner_v0",
    sortValue: (r) => r.score.rankKey,
    cell: (r): Cell => ({
      state: "known",
      provenance: "measured",
      value: (
        <span className={styles.scoreCell}>
          <span className={`mono ${styles.scoreN}`}>{r.score.scoreV0}</span>
          <StatusChip tone={DISPOSITION_TONE[r.score.disposition] ?? "idle"}>
            {dispositionLabel(r.score.disposition)} · {r.score.grade}
          </StatusChip>
        </span>
      ),
    }),
  },
  {
    /**
     * THE DEAL VALUE, THE SPINE OF THE NEW RANK. Modeled: last award unit price × requested
     * quantity — a documented opportunity estimate, NOT a guaranteed figure, so it carries a
     * "modeled" glyph and never claims measured provenance. Unpriceable rows (≈89% of a live
     * board) render an honest INSUFFICIENT, never a zero.
     */
    id: "value",
    header: "Deal value",
    align: "end",
    mono: true,
    width: "18ch",
    helpId: "score.corner_v0",
    sortValue: (r) => r.score.valueUsd ?? -1,
    cell: (r): Cell => {
      const v = r.score.valueUsd;
      if (v == null) {
        return {
          state: "unknown",
          reason: "size cannot be computed: no usable award price on record for this stock number (INSUFFICIENT, not zero)",
        };
      }
      return {
        state: "known",
        value: (
          <span className={styles.itemCell}>
            <span className="mono">{usd(v)}</span>
            <StatusChip tone="idle">modeled</StatusChip>
          </span>
        ),
      };
    },
  },
  {
    /**
     * THE LOCKUP VERDICT, the inversion of the old +25 sole-source reward. Surplus opportunity is
     * the dead-OEM open door Wayne fishes in; locked is a confirmed closed door (AMC 4/5 or an
     * OEM/licence lock) and is hidden by default behind the toggle below.
     */
    id: "lockup",
    header: "Lockup",
    width: "20ch",
    sortValue: (r) => LOCKUP_SORT[r.score.lockup.status] ?? 9,
    cell: (r): Cell => {
      const l = r.score.lockup;
      return {
        state: "known",
        provenance: "measured",
        value: (
          <StatusChip tone={LOCKUP_TONE[l.status] ?? "idle"}>
            {LOCKUP_LABEL[l.status] ?? l.status}
          </StatusChip>
        ),
      };
    },
  },
  {
    /**
     * WAYNE HOLDS THIS. His CAGE (3BQS1/6KB87) among the NSN's listed holders, with the units he
     * lists and whether they can fill the buy. UNITS ONLY — the availability feed carries no price,
     * so none is invented. Absence is UNKNOWN (his shelf is not loaded), never "Wayne lacks it".
     *
     * ⛔ THE SOURCE IS A PROXY AND THE BADGE SAYS SO. His CAGE appears on 15 rows of the loaded
     * availability data — an incidental sample, not an export of his shelf. On the newest archived
     * feed day the boost can fire on ZERO of 275 rows. So this column is `prior`, not `measured`,
     * and its explainer names the coverage rather than leaving the operator to assume a full read.
     */
    id: "wayne",
    header: "Wayne holds",
    width: "16ch",
    align: "end",
    sortValue: (r) => (r.score.wayneHolds.held ? r.score.wayneHolds.units : -1),
    cell: (r): Cell => {
      const w = r.score.wayneHolds;
      if (!w.held) {
        return {
          state: "unknown",
          reason: "no Wayne holding is loaded for this part (his shelf is not loaded; absence is unknown, not a shortage)",
        };
      }
      /*
       * ★ THE BADGE SAYS WHAT KIND OF MATCH IT IS, AND WHETHER IT COUNTED. David 2026-08-29:
       * "badge the FACT, and only when the match is real; a partial match says so or says
       * nothing" and "if the inventory source is a PROXY rather than a real export, the badge
       * must say which - a badge that overstates certainty is worse than no badge."
       *
       * It used to render a bare unit count with "· fills buy" appended only at full coverage, so
       * a 3%-of-buy holding and a complete one were the same chip to anyone not doing arithmetic
       * against the quantity column. And a row under the $15,000 qualifying floor showed the same
       * confident accent chip while its boost was gated to nothing, which reads as a scoring bug.
       *
       * `provenance` is now "prior", not "measured". The holding itself is a real read, but the
       * SHELF is an incidental availability sample covering a small fraction of stock numbers -
       * calling that "measured" claims a coverage the source does not have.
       */
      const partial = w.fill < 1;
      const gated = w.qualification <= 0;
      // `measured` is right for a PRESENCE: we really did read that he lists these units for this
      // part. The proxy caveat is about ABSENCE - the shelf sample is thin, so a row with no
      // holding is `unknown` above and never "he lacks it". The coverage sentence and the gating
      // both travel in `wayneHolds.plain`, rendered in the row expansion below, because a `known`
      // cell carries no reason field and a chip is the wrong place for three clauses.
      return {
        state: "known",
        provenance: "measured",
        value: (
          <StatusChip tone={gated ? "idle" : "accent"}>
            {w.units.toLocaleString()} units
            {partial ? ` · ${Math.round(w.fill * 100)}% of buy` : " · fills buy"}
            {gated ? " · under floor" : ""}
          </StatusChip>
        ),
      };
    },
  },
  {
    id: "nomenclature",
    header: "Item",
    sortValue: (r) => r.nomenclature,
    cell: (r): Cell => {
      if (r.nomenclature.trim() === "") return { state: "unknown", reason: "not published on this line" };
      return {
        state: "known",
        provenance: "measured",
        value: (
          <span className={styles.itemCell}>
            <span>{r.nomenclature.trim()}</span>
            {r.forecast?.onForecast ? (
              <StatusChip tone="verified">
                On forecast{r.forecast.totalForecastQty > 0 ? ` · ${r.forecast.totalForecastQty.toLocaleString()}` : ""}
              </StatusChip>
            ) : null}
          </span>
        ),
      };
    },
  },
  {
    id: "source",
    header: "Approved source",
    width: "20ch",
    helpId: "monopoly.award_silence",
    sortValue: (r) => (r.soleSource ? 0 : r.approvedSourceCount),
    cell: (r): Cell => {
      if (r.soleSource) {
        const silent = r.silentSourceCount > 0;
        return {
          state: "known",
          provenance: "measured",
          value: (
            // Sole + silent is THE money signal on this page, so it wears the brass accent.
            // Amber stays reserved for the award clock.
            <StatusChip tone={silent ? "accent" : "verified"}>
              {silent ? "Sole + silent" : "Sole source"} · {r.approvedSources[0]}
            </StatusChip>
          ),
        };
      }
      // NOT sole-sourced by CAGE count. But a CAGE code is not a company: if the codes on this
      // row resolve to ONE operator, the row is describing a corner as a competitive market.
      // Surfaced, never applied — the disposition above is left exactly as the map computed it,
      // because a false merge invents a corner and that call belongs to a person.
      const ops = r.operators;
      if (ops?.collapsed && ops.operatorCount === 1) {
        const recorded = ops.evidence === "complex_confirmed";
        return {
          state: "known",
          provenance: recorded ? "measured" : undefined,
          value: (
            <span className={styles.itemCell}>
              <StatusChip tone={recorded ? "verified" : "idle"}>
                {`${ops.cageCount} codes · 1 firm`}
              </StatusChip>
              <span className={styles.faint}>
                {recorded ? "on the government record" : "same name and office, our reading"}
              </span>
            </span>
          ),
        };
      }
      return {
        state: "known",
        provenance: "measured",
        value: <StatusChip tone="idle">{r.approvedSourceCount} approved</StatusChip>,
      };
    },
  },
  {
    id: "legs",
    header: "Legs established",
    helpId: "monopoly.legs_established",
    width: "13ch",
    align: "end",
    sortValue: (r) => r.legsEstablished,
    cell: (r): Cell => ({
      state: "known",
      provenance: "measured",
      value: (
        <span className={styles.legs} aria-label={`${r.legsEstablished} of 3 legs established`}>
          <span className={r.legsEstablished >= 1 ? styles.legOn : styles.legOff} title="Demand" />
          <span className={r.legsEstablished >= 2 ? styles.legOn : styles.legOff} title="Source silent" />
          <span className={styles.legOff} title="Availability: not read" />
        </span>
      ),
    }),
  },
  {
    id: "award",
    header: "Award path",
    width: "15ch",
    sortValue: (r) => (r.automatedSolicitation === true ? 0 : r.automatedSolicitation === false ? 1 : 2),
    cell: (r): Cell => {
      if (r.automatedSolicitation === null) {
        return { state: "unknown", reason: "solicitation too short to name the path" };
      }
      return r.automatedSolicitation
        ? { state: "known", provenance: "measured", value: <StatusChip tone="active">Machine award</StatusChip> }
        : { state: "known", provenance: "measured", value: <StatusChip tone="idle">Manual</StatusChip> };
    },
  },
  {
    /**
     * CAN ANYONE ELSE LEGALLY MAKE THIS PART.
     *
     * The code is the government's own word and renders as a measured fact. What it MEANS
     * commercially is our reading and lives in the next column, quieter, because the two carry
     * different authority and a merged verdict would hide that.
     *
     * A blank AMSC is never rendered as "unrestricted". Fill is bimodal by managing activity:
     * the activities that publish it publish on ~100% of their rows and the rest publish none,
     * so an absence is a different PUBLISHER, not a permissive answer. Reading it the other way
     * would invent permission to bid, which is the expensive direction of this error.
     */
    id: "amsc",
    header: "Acquisition code",
    helpId: "monopoly.legs",
    width: "13ch",
    sortValue: (r) => (r.eligibility?.amsc ? r.eligibility.amsc.charCodeAt(0) : 999),
    cell: acquisitionCodeCell,
  },
  {
    id: "posture",
    header: "Who may make it",
    width: "26ch",
    sortValue: (r) => {
      const p = r.eligibility?.posture ?? "";
      return p === "open_to_surplus_dealer" ? 0 : p === "restricted_attackable" ? 1 : p === "restricted_closed_to_new_manufacturing_source" ? 2 : 3;
    },
    cell: (r): Cell => {
      const e = r.eligibility;
      if (!e) return { state: "unknown", reason: "the acquisition-code index is not loaded" };
      if (e.state !== "determined") return { state: "unknown", reason: e.reason };
      // ESTIMATED, not measured: this grouping is ours, so it never claims measured provenance.
      const label =
        e.posture === "open_to_surplus_dealer" ? "Open to a dealer"
        : e.posture === "restricted_attackable" ? "Restricted, can be attacked"
        : e.posture === "restricted_closed_to_new_manufacturing_source" ? "Closed to a new source"
        : "Not grouped in the source";
      if (e.posture === "unclassified_in_primary_source" || !e.posture) {
        return { state: "unknown", reason: `${e.explanation ?? "the code is not one the digest groups"} (our grouping does not classify this code)` };
      }
      return { state: "known", value: label };
    },
  },
  {
    id: "qty",
    header: "Qty",
    mono: true,
    align: "end",
    width: "10ch",
    sortValue: (r) => r.quantity ?? -1,
    cell: (r): Cell =>
      r.quantity == null
        ? { state: "unknown", reason: "did not parse from the index row" }
        : { state: "known", value: `${r.quantity} ${r.unitOfIssue}`.trim(), provenance: "measured" },
  },
  {
    id: "availability",
    header: "Listed stock",
    helpId: "monopoly.availability_unknown",
    width: "17ch",
    sortValue: (r) => r.award?.holders.length ?? -1,
    cell: (r): Cell => {
      const holders = r.award?.holders ?? [];
      if (!r.award) {
        return { state: "unknown", reason: "not read: no availability feed connected" };
      }
      if (holders.length === 0) {
        // We DID look (this NSN is in the export) and no holder is listed. Still not proof of
        // "none anywhere" — NSN-Now availability is self-reported — so it stays an honest empty.
        return { state: "empty" };
      }
      const units = holders.reduce((s, h) => s + (h.quantity ?? 0), 0);
      return {
        state: "known",
        provenance: "measured",
        value: (
          <StatusChip tone="idle">
            {holders.length} listed{units > 0 ? ` · ${units.toLocaleString()} ea` : ""}
          </StatusChip>
        ),
      };
    },
  },
  {
    id: "price",
    header: "Last award",
    align: "end",
    mono: true,
    width: "16ch",
    sortValue: (r) => r.award?.latestPrice ?? -1,
    cell: (r): Cell => {
      const latestPrice = r.award?.latestPrice ?? null;
      if (latestPrice == null || latestPrice <= 0) {
        return { state: "unknown", reason: "no positive award price on record for this NSN" };
      }
      const first = r.award?.firstUnitPrice;
      const rising = first != null && latestPrice > first;
      return {
        state: "known",
        provenance: "measured",
        value: (
          <span>
            {usd(latestPrice)}
            {rising ? (
              <span className={styles.escalation} title={`up from ${usd(first)}`}>
                {" "}↑ {Math.round(((latestPrice - first) / first) * 100).toLocaleString()}%
              </span>
            ) : null}
          </span>
        ),
      };
    },
  },
  {
    id: "trend",
    header: "Price trend",
    width: "14ch",
    // A sparkline of the real award unit prices in order. Two or more priced awards draw the
    // trajectory; fewer than two has no trend to draw, so the cell abstains rather than inventing a
    // line. The monopoly forming is visible at a glance, and it is measured, not modeled.
    sortValue: (r) => {
      const s = priceSeriesOf(r);
      return s.length >= 2 ? (s[s.length - 1] as number) - (s[0] as number) : -Infinity;
    },
    cell: (r): Cell => {
      const s = priceSeriesOf(r);
      if (s.length < 2) {
        return { state: "unknown", reason: "fewer than two priced awards to trend" };
      }
      const firstV = s[0] as number;
      const lastV = s[s.length - 1] as number;
      return {
        state: "known",
        provenance: "measured",
        value: (
          <PriceSparkline
            points={s}
            width={92}
            height={26}
            ariaLabel={`Award unit price across ${s.length} awards, ${usd(firstV)} to ${usd(lastV)}`}
          />
        ),
      };
    },
  },
];

/** The chronological priced-award series for one corner, only real unit prices. */
function priceSeriesOf(r: CornerRowWithAward): number[] {
  return r.award?.priceSeries ?? [];
}

/**
 * THE ACTION COLUMN — the pursuit wire. Every row can start a real deal. The modeled buy
 * value is quantity x last award unit price ONLY when both were measured on this row; when
 * either is unread the deal is created with no value, never an invention. `pursued` comes
 * from the server-read deal store, so a row already in the pipeline renders the flipped
 * state on first paint and a second press cannot duplicate (the API dedupes by ref too).
 */
function pursueColumn(pursued: Set<string>): GridColumn<CornerRowWithAward> {
  return {
    id: "pursue",
    header: "Action",
    helpId: "pursuit.pursue_action",
    width: "13ch",
    cell: (r): Cell => ({
      state: "known",
      value: (
        <PursueButton
          nsn={r.nsn}
          niin={r.niin}
          item={r.nomenclature.trim()}
          valueUsd={
            r.quantity != null && r.award?.latestPrice != null && r.award.latestPrice > 0
              ? r.quantity * r.award.latestPrice
              : null
          }
          initiallyInPipeline={pursued.has(normalizeDealRef(r.nsn))}
        />
      ),
    }),
  };
}

export function MonopolyGrid({
  rows,
  pursuedRefs,
  seenNsns,
  seenAvailable,
  totals,
  basis,
}: {
  /**
   * THE ROWS THAT CROSSED THE WIRE, WHICH IS A BOUNDED SLICE OF THE MAP.
   *
   * `page.tsx` ships the top GRID_ROW_BUDGET rows by CornerScore, candidates first, because
   * handing this component the whole served board measured a 25.98MB RSC flight payload per
   * visit. Everything in here that needs to speak about the MAP reads `totals`, never
   * `rows.length`: a count taken off this array is a count of the page, and printing it under
   * a map-shaped label is how a bound becomes a lie.
   */
  rows: CornerRowWithAward[];
  /** Normalized refs already in the deal store, read server-side. */
  pursuedRefs: string[];
  /**
   * Stock numbers this operator has already opened, read server-side so the mark is right on the
   * FIRST paint. Fetching after mount would flash a fully-unseen board and then repaint it.
   */
  seenNsns: string[];
  /**
   * Whether the seen store could be READ. False is the unknown state, and it is threaded through
   * rather than collapsed into an empty array precisely so the UI can refuse to claim a worked
   * board is untouched. An unreadable store withdraws the filter; it never fakes a clean one.
   */
  seenAvailable: boolean;
  /** The TRUE size of each tab, counted server-side over every served row. */
  totals: { candidate: number; sole: number; all: number };
  /**
   * Which world this board is in, straight off `CornerMap.coverage.basis`.
   *
   * Read ONLY by the row provenance block, and required rather than inferred: a row with no
   * feed day of its own means "the board is one capture and the header already cites it" on
   * the single-day path and "this row could not be resolved to any archived day" on the window
   * path, and those are opposite claims that the row itself cannot tell apart.
   */
  basis: "window" | "single_day";
}) {
  const [filter, setFilter] = useState<Filter>("candidate");
  /**
   * Widening to the whole map re-scores and re-lays every row and measured ~4.5s. React holds
   * the previous rows through a transition, which is correct, but a screen that appears to do
   * nothing for four seconds reads as broken rather than as busy. `pending` explains the wait.
   */
  const [pending, startTransition] = useTransition();
  // Secondary filters that AND with the active tab. Each is a real, measured property of the row,
  // so a filtered view is always an honest subset, never a re-scored one.
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>({
    onForecast: false,
    machine: false,
    rising: false,
    priced: false,
  });
  const [chain, setChain] = useState<string>("all");
  // Locked closed doors (AMC 4/5, confirmed OEM/licence locks) are out of sight by default — they
  // "mean nothing to us". They are never dropped from the data: this reveals them, appended at the
  // bottom by rankKey (the full LOCK_PENALTY keeps them below everything shown), each stamped with why.
  const [showLocked, setShowLocked] = useState(false);

  /* ------------------------------------------------------------------------------------
   * SEEN-STATE. The server set is the truth; `justOpened` is the optimistic overlay.
   *
   * The mark has to appear on the CLICK, not after a round trip, because the operator is already
   * navigating away — waiting for the POST would paint the mark onto a page he has left. So the
   * click adds to a local set and fires the write; the next server render folds it into `seenNsns`
   * and the overlay becomes redundant rather than contradictory.
   *
   * ⛔ THE OPTIMISTIC MARK IS ROLLED BACK IF THE WRITE FAILS. A cheerful red number over a store
   * that refused the write is a lie the operator would act on — he would skip that row forever
   * believing he had read it. On failure the mark is removed and `writeFailed` states it plainly.
   * ------------------------------------------------------------------------------------ */
  const [justOpened, setJustOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [writeFailed, setWriteFailed] = useState(false);

  const seenSet = useMemo(() => {
    const s = new Set<string>();
    for (const n of seenNsns) s.add(normalizeNsn(n));
    for (const n of justOpened) s.add(n);
    return s;
  }, [seenNsns, justOpened]);

  const markOpen = useCallback((rawNsn: string) => {
    const key = normalizeNsn(rawNsn);
    if (!key) return;
    setJustOpened((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    void fetch("/api/seen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nsn: key }),
    })
      .then((res) => {
        if (res.ok) return;
        // A non-2xx is a REFUSED write, not a slow one. Undo the mark and say so.
        setWriteFailed(true);
        setJustOpened((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      })
      .catch(() => {
        setWriteFailed(true);
        setJustOpened((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
  }, []);

  /**
   * "Unseen only" — the whole point of the mark, per the operator: it is how he sorts what he has
   * not looked into yet away from what he has. It is a filter over a MEASURED per-row property, so
   * the result stays an honest subset and nothing is re-scored.
   *
   * It is unavailable (and forced off below) when the store could not be read, because filtering
   * on an unknown is how a board silently hides rows the operator has never seen.
   */
  const [unseenOnly, setUnseenOnly] = useState(false);
  const unseenFilterActive = unseenOnly && seenAvailable;

  // The full column set: the measured columns plus the pursuit wire. Rebuilt only when the
  // pursued set changes (a set identity, not a per-render array), so the grid's column
  // identity stays stable across filtering.
  const allColumns = useMemo(
    () => [nsnColumn(seenSet, seenAvailable, markOpen), ...columns, pursueColumn(new Set(pursuedRefs))],
    [pursuedRefs, seenSet, seenAvailable, markOpen],
  );

  const isCandidate = (r: CornerRowWithAward) => r.soleSource && r.silentSourceCount > 0;
  // The SHARED definition (lib/intelligence/rising-price), the same one the Intelligence
  // dashboard's "with rising prices" total counts with, so the two surfaces cannot disagree.
  const isRising = (r: CornerRowWithAward) =>
    isRisingPrice(r.award?.firstUnitPrice, r.award?.lastUnitPrice);

  // Every supply chain present in the data, for the select. Real values only.
  const chains = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) for (const c of r.forecast?.supplyChains ?? []) if (c.trim()) s.add(c.trim());
    return [...s].sort();
  }, [rows]);

  const matches = (r: CornerRowWithAward): boolean => {
    // Locked closed doors are out of sight unless the operator explicitly asks for them.
    if (!showLocked && r.score.disposition === "SKIP") return false;
    if (filter === "candidate" && !isCandidate(r)) return false;
    if (filter === "sole" && !r.soleSource) return false;
    if (toggles.onForecast && !r.forecast?.onForecast) return false;
    if (toggles.machine && r.automatedSolicitation !== true) return false;
    if (toggles.rising && !isRising(r)) return false;
    if (toggles.priced && r.award?.latestPrice == null) return false;
    // Unseen-only. Guarded by `seenAvailable` inside `unseenFilterActive`, so an unreadable store
    // can never silently empty the board.
    if (unseenFilterActive && seenSet.has(normalizeNsn(r.nsn))) return false;
    if (chain !== "all" && !(r.forecast?.supplyChains ?? []).map((c) => c.trim()).includes(chain))
      return false;
    return true;
  };

  const shown = useMemo(() => {
    // Rank by the UNCLAMPED rankKey, the methodology's spine, so saturated-at-100 whales still
    // order correctly and locked rows (−40) sink to the bottom when revealed. The grid header can
    // re-sort any column; this is the default the operator sees first.
    return rows.filter(matches).sort((a, b) => rankCompare(a.score.rankKey, a.nsn, b.score.rankKey, b.nsn));
    // matches closes over filter/toggles/chain/showLocked, all in the dep list below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, toggles, chain, showLocked, unseenFilterActive, seenSet]);

  const clearAll = () => {
    setFilter("all");
    setUnseenOnly(false);
    setToggles({ onForecast: false, machine: false, rising: false, priced: false });
    setChain("all");
  };

  // The tab counts are the MAP's counts, passed in from the server, not counts of the slice
  // that happens to be loaded. `loaded` beside them is how many of each are actually here, and
  // the sentence under the toolbar states the difference in words rather than leaving it to be
  // inferred from two numbers that do not match.
  const tabs: Array<{ id: Filter; label: string; noun: string; n: number; loaded: number }> = [
    {
      id: "candidate",
      label: "Candidate corners",
      noun: "candidate corners",
      n: totals.candidate,
      loaded: rows.filter(isCandidate).length,
    },
    {
      id: "sole",
      label: "Sole source",
      noun: "sole-source positions",
      n: totals.sole,
      loaded: rows.filter((r) => r.soleSource).length,
    },
    {
      id: "all",
      label: "All with demand + source",
      noun: "positions",
      n: totals.all,
      loaded: rows.length,
    },
  ];
  const activeTab = tabs.find((t) => t.id === filter) ?? tabs[2]!;
  const bounded = activeTab.loaded < activeTab.n;

  const chips: Array<{ id: ToggleKey; label: string }> = [
    { id: "onForecast", label: "On forecast" },
    { id: "machine", label: "Machine award" },
    { id: "rising", label: "Rising price" },
    { id: "priced", label: "Has award price" },
  ];
  const anyToggle = Object.values(toggles).some(Boolean) || chain !== "all" || unseenOnly;
  // Locked closed doors loaded on this page, for the reveal control's count.
  const lockedCount = useMemo(() => rows.filter((r) => r.score.disposition === "SKIP").length, [rows]);
  /**
   * How many rows the operator has NOT opened, counted over the rows this board is serving.
   *
   * Counted with the unseen filter itself switched OFF, so the number on the button does not
   * collapse to the number of rows already showing the moment the filter is on. A count that
   * changes because you looked at it is not a count.
   */
  const unseenCount = useMemo(
    () =>
      seenAvailable
        ? rows.filter((r) => !seenSet.has(normalizeNsn(r.nsn)) && (showLocked || r.score.disposition !== "SKIP"))
            .length
        : 0,
    [rows, seenSet, seenAvailable, showLocked],
  );

  return (
    <>
      <div className={styles.filters} role="tablist" aria-label="Monopoly Map filters">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={filter === t.id}
            className={`${styles.filter} ${filter === t.id ? styles.filterOn : ""}`}
            onClick={() => startTransition(() => setFilter(t.id))}
          >
            {t.label}
            <span className={styles.filterN}>{t.n.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {/* Secondary filters. Each toggle is a measured property; they AND with the tab and each other,
          so the result is always an honest subset. The count is the live size of that subset. */}
      <div className={styles.toolbar}>
        <div className={styles.chipRow} role="group" aria-label="Refine by measured signal">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={toggles[c.id]}
              className={`${styles.chip} ${toggles[c.id] ? styles.chipOn : ""}`}
              onClick={() => setToggles((t) => ({ ...t, [c.id]: !t[c.id] }))}
            >
              {c.label}
            </button>
          ))}
          {chains.length > 0 ? (
            <label className={styles.chainLabel}>
              <span className="vh">Supply chain</span>
              <select
                className={styles.chainSelect}
                value={chain}
                onChange={(e) => setChain(e.target.value)}
              >
                <option value="all">All supply chains</option>
                {chains.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className={styles.toolbarRight}>
          {/* SEEN-STATE CONTROL. Rendered in three honest states and never in a fourth:
              · store readable      -> the toggle, with the live unseen count
              · store unreadable    -> a stated condition, NO toggle (filtering on an unknown
                                       would hide rows the operator has never opened)
              · a write was refused -> the mark is rolled back and the failure is named */}
          {seenAvailable ? (
            <button
              type="button"
              aria-pressed={unseenOnly}
              className={`${styles.chip} ${unseenOnly ? styles.chipOn : ""}`}
              onClick={() => setUnseenOnly((v) => !v)}
              title="Hide corners you have already opened. Opened rows keep their red stock number either way."
            >
              Unseen only ({unseenCount.toLocaleString()})
            </button>
          ) : (
            <span className={styles.seenNote}>
              Seen-state unavailable, so no row is marked as opened. This is unknown, not empty.
            </span>
          )}
          {writeFailed ? (
            <span className={styles.seenNote} role="status">
              A seen mark could not be saved, so it was undone rather than shown as saved.
            </span>
          ) : null}
          {lockedCount > 0 ? (
            <button
              type="button"
              aria-pressed={showLocked}
              className={`${styles.chip} ${showLocked ? styles.chipOn : ""}`}
              onClick={() => setShowLocked((v) => !v)}
              title="AMC 4/5 and confirmed OEM/licence locks — closed doors, appended at the bottom when shown"
            >
              {showLocked ? "Hide" : "Show"} locked / sole-provider items ({lockedCount.toLocaleString()})
            </button>
          ) : null}
          <span className={styles.resultCount} aria-live="polite">
            {shown.length.toLocaleString()} shown
          </span>
          {anyToggle ? (
            <button type="button" className={styles.clearBtn} onClick={clearAll}>
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------------------------ the bound, stated
       * WHAT IS ON THIS PAGE VERSUS WHAT THE MAP HOLDS, in a sentence, always visible.
       *
       * The board is bounded server-side because handing the browser all 5,366 served rows
       * measured a 25.98MB flight payload per visit. A bounded board is honest and a silently
       * bounded board is not, so the counts above are the map's and this line says how much of
       * the map is actually loaded underneath them. Same register as /goldmine's "Showing the
       * top 60 of 418 by size of buy".
       */}
      <p className={styles.bound}>
        {bounded ? (
          <>
            Showing <b>{activeTab.loaded.toLocaleString()}</b> of{" "}
            <b>{activeTab.n.toLocaleString()}</b> {activeTab.noun}. This page loads every
            candidate corner first, then the highest-scoring of the rest, so the other{" "}
            {(activeTab.n - activeTab.loaded).toLocaleString()} are counted in the funnel above
            but are not here, and the filters and sorting below run over what is.
          </>
        ) : (
          <>
            Showing all <b>{activeTab.n.toLocaleString()}</b> {activeTab.noun} the map holds.
            {rows.length < totals.all
              ? ` The wider tabs are bounded: ${rows.length.toLocaleString()} of the map's ${totals.all.toLocaleString()} positions are loaded on this page, candidate corners first.`
              : ""}
          </>
        )}
      </p>

      {pending ? (
        <AiLoader
          title="Re-scoring the map"
          stages={[
            "Reading the corner map for this feed day",
            "Applying the filter you picked",
            "Re-ranking by CornerScore",
            "Laying out the rows",
          ]}
          note="Every row is re-scored against the whole map rather than paged, so a filter change is a real recomputation. It settles in a moment, and sorting is instant afterwards."
        />
      ) : null}
      
      <DataGrid
        rows={shown}
        columns={allColumns}
        rowKey={(r) => `${r.niin}:${r.solicitation}`}
        label="Sole-source positions under open DLA demand, ranked by measured corner strength"
        /*
         * The approved-source CAGEs are in here on purpose, and they are the exception that
         * proves the identifier rule: on this page the holder IS an identifier. "who else is
         * cornered by this vendor" is the question the map exists to answer, and it is asked by
         * typing a CAGE.
         */
        search={{
          fields: (r) => [r.nsn, r.niin, r.nomenclature, r.solicitation, ...r.approvedSources],
          placeholder: "Search NSN, item, solicitation or approved-source CAGE",
          label: "Search the monopoly map by stock number, item name, solicitation or approved-source CAGE",
        }}
        density="compact"
        empty={{
          cause: "filtered",
          message:
            "No position loaded on this page matches this filter. The feed loaded correctly; this combination simply did not occur among the rows shown above.",
          onClearFilters: clearAll,
        }}
        expansion={(r) => [
          {
            field: "CornerScore",
            value: `${r.score.scoreV0}/100 · ${dispositionLabel(r.score.disposition)} · confidence ${r.score.grade} (an ordinal watchlist rank, not a probability)`,
          },
          /*
           * ★ THIS PRINTED THE POINTS ONLY WHEN THEY WERE POSITIVE. Fixed 2026-08-29.
           *
           * `rc.points > 0` meant every NEGATIVE leg rendered its prose with no number beside it,
           * so the one leg that can sink a row - the lockup penalty, now -LOCK_PENALTY - was the
           * single leg whose magnitude the operator could not see. A decomposition that hides its
           * largest term is worse than one that shows nothing: the visible legs sum to something
           * positive while the row sits at zero, and the operator reads that as a broken score.
           * Zero-point legs still print bare, because a leg contributing nothing is context and a
           * "+0" reads as a measurement that was taken and came back empty.
           */
          ...r.score.reasons.map((rc, i) => ({
            field: i === 0 ? "Why this score" : "",
            value: `${rc.points ? `${rc.points > 0 ? "+" : ""}${fmtPoints(rc.points)} ` : ""}[${rc.calibration}] ${rc.plain}`,
          })),
          /*
           * ★ `wayneHolds.plain` WAS COMPUTED ON EVERY ROW AND RENDERED NOWHERE. It is the only
           * place the inventory signal explains itself: whether the match is partial, whether the
           * value gate zeroed its boost, and that the shelf data is an incidental sample rather
           * than an export. The chip can carry three words; this can carry the caveat.
           */
          ...(r.score.wayneHolds.held
            ? [{ field: "Inventory we hold", value: r.score.wayneHolds.plain }]
            : []),
          { field: "Stock number", value: r.nsn },
          { field: "NIIN", value: r.niin },
          { field: "Item", value: r.nomenclature.trim() || "(not published)" },
          { field: "Solicitation", value: r.solicitation },
          { field: "Quantity", value: r.quantity == null ? "(did not parse)" : `${r.quantity} ${r.unitOfIssue}`.trim() },
          { field: "Return date", value: r.returnDate || "(not published)" },
          /*
           * THE ROW'S OWN CITATION, which the truth strip above the grid tells the operator to
           * open a row to read. It said that for a day while this array rendered none of it.
           * Built by a pure function so a test can execute it on a synthetic row whose archive
           * key differs from the map-level key; see ./row-provenance.ts.
           */
          ...rowProvenanceEntries(r.demand, basis),
          {
            field: "Approved sources",
            value: r.approvedSources.length
              ? `${r.approvedSourceCount} (CAGE ${r.approvedSources.join(", ")})`
              : "(none on this feed day)",
          },
          {
            field: "Source signal",
            value: r.signals
              .map((s) =>
                s.kind === "award_silent"
                  ? `CAGE ${s.cage}: ${s.measurement}`
                  : s.kind === "no_silence_signal"
                    ? `CAGE ${s.cage}: not on the award-silence list`
                    : `CAGE ${s.cage}: no signal either way`,
              )
              .join(" · "),
          },
          ...(r.award && r.award.count
            ? [
                {
                  field: "Award history",
                  value: `${r.award.count} awards, ${r.award.distinctAwardees} distinct awardee${r.award.distinctAwardees === 1 ? " (sole-awarded every time)" : "s"}${
                    r.award.firstUnitPrice != null && r.award.lastUnitPrice != null
                      ? `; ${usd(r.award.firstUnitPrice)} → ${usd(r.award.lastUnitPrice)}`
                      : ""
                  }`,
                },
                ...r.award.recent.map((a, i) => ({
                  field: i === 0 ? "Awards (recent first)" : "",
                  value: `${a.dateIso ?? "(no date)"} · ${a.price != null ? usd(a.price) : "(no price)"} · qty ${a.qty ?? "?"} · CAGE ${a.cage ?? "?"} ${a.company ?? ""}`.trim(),
                })),
              ]
            : [{ field: "Award price", value: "award history not yet ingested for this NSN" }]),
          {
            field: "DLA Forecast",
            value: r.forecast
              ? r.forecast.onForecast
                ? `on the government's forward-buy list${r.forecast.totalForecastQty > 0 ? `, ${r.forecast.totalForecastQty.toLocaleString()} units` : ""}${r.forecast.supplyChains.length ? ` (${r.forecast.supplyChains.join(", ")})` : ""}`
                : "not on the current DLA Forecast (a checked absence)"
              : "DLA Forecast not loaded",
          },
          ...(r.forecast && r.forecast.solicitationCount > 0
            ? [{ field: "Solicitation history", value: `re-solicited ${r.forecast.solicitationCount} times${r.forecast.lastSolicitation ? `, last ${r.forecast.lastSolicitation}` : ""}` }]
            : []),
          /*
           * THE TRUNCATION IS DISCLOSED, BECAUSE A CUT LIST READS AS A COMPLETE ONE.
           *
           * This showed `endItems.slice(0, 4)` with nothing saying there were more, so a stock
           * number that goes on thirty end items rendered exactly like one that goes on four.
           * "Goes on" is a claim about what an item is used for, and an operator sizing demand
           * off four platforms when there are thirty has been given a wrong answer by a control
           * that looked complete. Silent truncation on a rendered fact is the same family as a
           * silent zero: the absence is invisible, so it reads as a measurement.
           *
           * The remainder is stated rather than the cap being raised: four is a sensible amount
           * to show in a cell, and the honest version of a short list is the list plus its
           * count, not a longer list that truncates one row later.
           */
          ...(r.forecast && r.forecast.endItems.length
            ? [
                {
                  field: "Goes on",
                  value:
                    r.forecast.endItems.slice(0, 4).join(" · ") +
                    (r.forecast.endItems.length > 4
                      ? ` and ${(r.forecast.endItems.length - 4).toLocaleString()} more`
                      : ""),
                },
              ]
            : []),
          {
            field: "Listed stock",
            value: r.award
              ? r.award.holders.length
                ? r.award.holders
                    .map((h) => `${h.company ?? "?"} (CAGE ${h.cage ?? "?"}): ${h.quantity ?? "?"}`)
                    .join(" · ") + ". NSN-Now listing, self-reported, not ILS-confirmed"
                : "no holder listed in the NSN-Now export (self-reported; not proof none exists)"
              : "not read: no availability feed connected",
          },
          ...r.gaps.map((g, i) => ({ field: i === 0 ? "What is not established" : "", value: g })),
        ]}
      />
    </>
  );
}
