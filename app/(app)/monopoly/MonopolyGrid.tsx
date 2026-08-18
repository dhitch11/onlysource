"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { DataGrid, type GridColumn, type Cell } from "@/components/ui/DataGrid";
import { AiLoader } from "@/components/ui/AiLoader";
import { StatusChip } from "@/components/ui/StatusChip";
import { PriceSparkline } from "@/components/ui/PriceSparkline";
import { PursueButton } from "@/components/sales/PursueButton";
import { normalizeDealRef } from "@/lib/sales/pipeline";
import type { EnrichedCornerRow } from "@/lib/intelligence/monopoly-view";
import { dispositionLabel } from "@/lib/intelligence/scoring/evidence-state";
import { isRisingPrice } from "@/lib/intelligence/rising-price";
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
  state: "determined" | "abstained_pica_does_not_publish" | "abstained_not_in_catalogue" | "index_absent";
  amsc: string | null;
  posture: string | null;
  explanation: string | null;
  reason: string;
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
const DISPOSITION_TONE: Record<string, "verified" | "active" | "idle"> = {
  FLAG: "verified",
  WATCHLIST: "active",
  INSUFFICIENT_DATA: "idle",
  SKIP: "idle",
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
const columns: GridColumn<CornerRowWithAward>[] = [
  {
    id: "nsn",
    header: "Stock number",
    mono: true,
    width: "16ch",
    pinned: true,
    sortValue: (r) => r.nsn,
    // The stock number is the way in. Every corner opens its full dossier: the price trajectory,
    // the whole award history, the score legs, and the AI brief — all from the same measured data.
    cell: (r): Cell => ({
      state: "known",
      provenance: "measured",
      value: (
        <Link href={`/corner/${r.nsn.replace(/[^0-9]/g, "")}` as never} className={styles.nsnLink}>
          {r.nsn}
        </Link>
      ),
    }),
  },
  {
    id: "score",
    header: "CornerScore",
    width: "17ch",
    align: "end",
    // The flagship 0-100 rank finally explains itself where it is ranked by (census
    // 2026-08-17: the one major column with no eye was the one operators sort money by).
    helpId: "score.corner_v0",
    sortValue: (r) => r.score.scoreV0,
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
    cell: (r): Cell => {
      const e = r.eligibility;
      if (!e) return { state: "unknown", reason: "the acquisition-code index is not loaded" };
      if (e.state !== "determined" || !e.amsc) return { state: "unknown", reason: e.reason };
      return {
        state: "known",
        provenance: "measured",
        value: <StatusChip tone="verified">{`AMSC ${e.amsc}`}</StatusChip>,
      };
    },
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
}: {
  rows: CornerRowWithAward[];
  /** Normalized refs already in the deal store, read server-side. */
  pursuedRefs: string[];
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

  // The full column set: the measured columns plus the pursuit wire. Rebuilt only when the
  // pursued set changes (a set identity, not a per-render array), so the grid's column
  // identity stays stable across filtering.
  const allColumns = useMemo(
    () => [...columns, pursueColumn(new Set(pursuedRefs))],
    [pursuedRefs],
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
    if (filter === "candidate" && !isCandidate(r)) return false;
    if (filter === "sole" && !r.soleSource) return false;
    if (toggles.onForecast && !r.forecast?.onForecast) return false;
    if (toggles.machine && r.automatedSolicitation !== true) return false;
    if (toggles.rising && !isRising(r)) return false;
    if (toggles.priced && r.award?.latestPrice == null) return false;
    if (chain !== "all" && !(r.forecast?.supplyChains ?? []).map((c) => c.trim()).includes(chain))
      return false;
    return true;
  };

  const shown = useMemo(() => {
    // Rank by the CornerScore, the methodology's spine. The grid header can re-sort any column;
    // this is the default the operator sees first.
    return rows.filter(matches).sort((a, b) => b.score.scoreV0 - a.score.scoreV0);
    // matches closes over filter/toggles/chain, all in the dep list below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, toggles, chain]);

  const clearAll = () => {
    setFilter("all");
    setToggles({ onForecast: false, machine: false, rising: false, priced: false });
    setChain("all");
  };

  const tabs: Array<{ id: Filter; label: string; n: number }> = [
    { id: "candidate", label: "Candidate corners", n: rows.filter(isCandidate).length },
    { id: "sole", label: "Sole source", n: rows.filter((r) => r.soleSource).length },
    { id: "all", label: "All with demand + source", n: rows.length },
  ];

  const chips: Array<{ id: ToggleKey; label: string }> = [
    { id: "onForecast", label: "On forecast" },
    { id: "machine", label: "Machine award" },
    { id: "rising", label: "Rising price" },
    { id: "priced", label: "Has award price" },
  ];
  const anyToggle = Object.values(toggles).some(Boolean) || chain !== "all";

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
        density="compact"
        empty={{
          cause: "filtered",
          message:
            "No position on this feed day matches this filter. The feed loaded correctly; this combination simply did not occur.",
          onClearFilters: clearAll,
        }}
        expansion={(r) => [
          {
            field: "CornerScore",
            value: `${r.score.scoreV0}/100 · ${dispositionLabel(r.score.disposition)} · confidence ${r.score.grade} (an ordinal watchlist rank, not a probability)`,
          },
          ...r.score.reasons.map((rc, i) => ({
            field: i === 0 ? "Why this score" : "",
            value: `${rc.points > 0 ? `+${rc.points} ` : ""}[${rc.calibration}] ${rc.plain}`,
          })),
          { field: "Stock number", value: r.nsn },
          { field: "NIIN", value: r.niin },
          { field: "Item", value: r.nomenclature.trim() || "(not published)" },
          { field: "Solicitation", value: r.solicitation },
          { field: "Quantity", value: r.quantity == null ? "(did not parse)" : `${r.quantity} ${r.unitOfIssue}`.trim() },
          { field: "Return date", value: r.returnDate || "(not published)" },
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
          ...(r.forecast && r.forecast.endItems.length
            ? [{ field: "Goes on", value: r.forecast.endItems.slice(0, 4).join(" · ") }]
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
