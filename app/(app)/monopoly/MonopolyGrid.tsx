"use client";

import { useMemo, useState } from "react";
import { DataGrid, type GridColumn, type Cell } from "@/components/ui/DataGrid";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CornerRow } from "@/lib/intelligence/corner";
import styles from "./monopoly.module.css";

type Filter = "candidate" | "sole" | "all";

/**
 * The candidate grid. Every cell is one of three states, so a leg we did not read renders as
 * an explicit abstention, never as a blank or a zero. The availability column is ALWAYS
 * unknown by design: it is the unread third leg, and showing it as a stated gap on every row
 * is the honest shape of the product until the locator feed is connected.
 */
const columns: GridColumn<CornerRow>[] = [
  {
    id: "nsn",
    header: "Stock number",
    mono: true,
    width: "15ch",
    pinned: true,
    sortValue: (r) => r.nsn,
    cell: (r): Cell => ({ state: "known", value: r.nsn, provenance: "measured" }),
  },
  {
    id: "nomenclature",
    header: "Item",
    sortValue: (r) => r.nomenclature,
    cell: (r): Cell =>
      r.nomenclature.trim() === ""
        ? { state: "unknown", reason: "not published on this line" }
        : { state: "known", value: r.nomenclature.trim(), provenance: "measured" },
  },
  {
    id: "source",
    header: "Approved source",
    width: "20ch",
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
    header: "On a shelf?",
    width: "16ch",
    cell: (): Cell => ({
      state: "unknown",
      reason: "not read — no availability feed connected",
    }),
  },
  {
    id: "price",
    header: "Award price",
    align: "end",
    width: "15ch",
    cell: (): Cell => ({
      state: "unknown",
      reason: "award history not yet ingested",
    }),
  },
];

export function MonopolyGrid({ rows }: { rows: CornerRow[] }) {
  const [filter, setFilter] = useState<Filter>("candidate");

  const isCandidate = (r: CornerRow) => r.soleSource && r.silentSourceCount > 0;

  const shown = useMemo(() => {
    switch (filter) {
      case "candidate":
        return rows.filter(isCandidate);
      case "sole":
        return rows.filter((r) => r.soleSource);
      default:
        return rows;
    }
  }, [rows, filter]);

  const tabs: Array<{ id: Filter; label: string; n: number }> = [
    { id: "candidate", label: "Candidate corners", n: rows.filter(isCandidate).length },
    { id: "sole", label: "Sole source", n: rows.filter((r) => r.soleSource).length },
    { id: "all", label: "All with demand + source", n: rows.length },
  ];

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
          onClearFilters: () => setFilter("all"),
        }}
        expansion={(r) => [
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
          { field: "Availability", value: "not read — no locator credential connected" },
          { field: "Award price", value: "award history not yet ingested" },
          ...r.gaps.map((g, i) => ({ field: i === 0 ? "What is not established" : "", value: g })),
        ]}
      />
    </>
  );
}
