"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataGrid, type GridColumn, type Cell } from "@/components/ui/DataGrid";
import { StatusChip } from "@/components/ui/StatusChip";
import { PriceSparkline } from "@/components/ui/PriceSparkline";
import type { CornerRow } from "@/lib/intelligence/corner";
import type { NsnAwardSummary } from "@/lib/intelligence/awards/nsn-now";
import type { ForecastSummary } from "@/lib/intelligence/forecast/dla-forecast";
import type { CornerScoreResult } from "@/lib/intelligence/scoring/cornerscore";
import styles from "./monopoly.module.css";

/** A corner row with its NSN-Now award history, DLA Forecast, and CornerScore joined in. */
export type CornerRowWithAward = CornerRow & {
  award: NsnAwardSummary | null;
  forecast: ForecastSummary | null;
  score: CornerScoreResult;
};

const DISPOSITION_TONE: Record<string, "verified" | "urgent" | "idle"> = {
  FLAG: "verified",
  WATCHLIST: "urgent",
  INSUFFICIENT_DATA: "idle",
  SKIP: "idle",
};
const DISPOSITION_LABEL: Record<string, string> = {
  FLAG: "Flag",
  WATCHLIST: "Watchlist",
  INSUFFICIENT_DATA: "Needs data",
  SKIP: "Skip",
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
    sortValue: (r) => r.score.scoreV0,
    cell: (r): Cell => ({
      state: "known",
      provenance: "measured",
      value: (
        <span className={styles.scoreCell}>
          <span className={`mono ${styles.scoreN}`}>{r.score.scoreV0}</span>
          <StatusChip tone={DISPOSITION_TONE[r.score.disposition] ?? "idle"}>
            {DISPOSITION_LABEL[r.score.disposition] ?? r.score.disposition} · {r.score.grade}
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
            <StatusChip tone={silent ? "urgent" : "verified"}>
              {silent ? "Sole + silent" : "Sole source"} · {r.approvedSources[0]}
            </StatusChip>
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
          <span className={styles.legOff} title="Availability — not read" />
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
        ? { state: "known", provenance: "measured", value: <StatusChip tone="urgent">Machine award</StatusChip> }
        : { state: "known", provenance: "measured", value: <StatusChip tone="idle">Manual</StatusChip> };
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
        return { state: "unknown", reason: "not read — no availability feed connected" };
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
    sortValue: (r) => r.award?.latest?.effectiveUnitPrice ?? -1,
    cell: (r): Cell => {
      const latest = r.award?.latest;
      const latestPrice = latest?.effectiveUnitPrice ?? null;
      if (!latest || latestPrice == null || latestPrice <= 0) {
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
                {" "}↑ {Math.round(((latestPrice - first) / first) * 100)}%
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
  return (r.award?.awards ?? [])
    .map((a) => a.effectiveUnitPrice)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

export function MonopolyGrid({ rows }: { rows: CornerRowWithAward[] }) {
  const [filter, setFilter] = useState<Filter>("candidate");
  // Secondary filters that AND with the active tab. Each is a real, measured property of the row,
  // so a filtered view is always an honest subset, never a re-scored one.
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>({
    onForecast: false,
    machine: false,
    rising: false,
    priced: false,
  });
  const [chain, setChain] = useState<string>("all");

  const isCandidate = (r: CornerRowWithAward) => r.soleSource && r.silentSourceCount > 0;
  const isRising = (r: CornerRowWithAward) =>
    r.award?.firstUnitPrice != null &&
    r.award?.lastUnitPrice != null &&
    r.award.lastUnitPrice > r.award.firstUnitPrice;

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
    if (toggles.priced && r.award?.latest?.effectiveUnitPrice == null) return false;
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
            onClick={() => setFilter(t.id)}
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

      <DataGrid
        rows={shown}
        columns={columns}
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
            value: `${r.score.scoreV0}/100 · ${DISPOSITION_LABEL[r.score.disposition] ?? r.score.disposition} · confidence ${r.score.grade} — an ordinal watchlist rank, not a probability`,
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
              ? `${r.approvedSourceCount} — CAGE ${r.approvedSources.join(", ")}`
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
          ...(r.award && r.award.awards.length
            ? [
                {
                  field: "Award history",
                  value: `${r.award.awards.length} awards, ${r.award.distinctAwardees} distinct awardee${r.award.distinctAwardees === 1 ? " (sole-awarded every time)" : "s"}${
                    r.award.firstUnitPrice != null && r.award.lastUnitPrice != null
                      ? `; ${usd(r.award.firstUnitPrice)} → ${usd(r.award.lastUnitPrice)}`
                      : ""
                  }`,
                },
                ...r.award.awards
                  .slice()
                  .reverse()
                  .slice(0, 10)
                  .map((a, i) => ({
                    field: i === 0 ? "Awards (recent first)" : "",
                    value: `${a.awardDateIso ?? "(no date)"} · ${a.effectiveUnitPrice != null ? usd(a.effectiveUnitPrice) : "(no price)"} · qty ${a.quantity ?? "?"} · CAGE ${a.cage ?? "?"} ${a.company ?? ""}`.trim(),
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
                    .join(" · ") + " — NSN-Now listing, self-reported, not ILS-confirmed"
                : "no holder listed in the NSN-Now export (self-reported; not proof none exists)"
              : "not read — no availability feed connected",
          },
          ...r.gaps.map((g, i) => ({ field: i === 0 ? "What is not established" : "", value: g })),
        ]}
      />
    </>
  );
}
