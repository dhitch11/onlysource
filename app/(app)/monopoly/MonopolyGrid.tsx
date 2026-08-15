"use client";

import { useMemo, useState } from "react";
import { DataGrid, type GridColumn, type Cell } from "@/components/ui/DataGrid";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CornerRow } from "@/lib/intelligence/corner";
import type { NsnAwardSummary } from "@/lib/intelligence/awards/nsn-now";
import styles from "./monopoly.module.css";

/** A corner row with its NSN-Now award history joined in, where we have it. */
export type CornerRowWithAward = CornerRow & { award: NsnAwardSummary | null };

type Filter = "candidate" | "sole" | "all";

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
    header: "Listed stock",
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
    sortValue: (r) => r.award?.latest?.unitPrice ?? -1,
    cell: (r): Cell => {
      const latest = r.award?.latest;
      if (!latest || latest.unitPrice == null) {
        return { state: "unknown", reason: "award history not yet ingested for this NSN" };
      }
      const first = r.award?.firstUnitPrice;
      const rising = first != null && latest.unitPrice > first;
      return {
        state: "known",
        provenance: "measured",
        value: (
          <span>
            {usd(latest.unitPrice)}
            {rising ? (
              <span className={styles.escalation} title={`up from ${usd(first)}`}>
                {" "}↑ {Math.round(((latest.unitPrice - first) / first) * 100)}%
              </span>
            ) : null}
          </span>
        ),
      };
    },
  },
];

export function MonopolyGrid({ rows }: { rows: CornerRowWithAward[] }) {
  const [filter, setFilter] = useState<Filter>("candidate");

  const isCandidate = (r: CornerRowWithAward) => r.soleSource && r.silentSourceCount > 0;

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
                    value: `${a.awardDateIso ?? "(no date)"} · ${a.unitPrice != null ? usd(a.unitPrice) : "(no price)"} · qty ${a.quantity ?? "?"} · CAGE ${a.cage ?? "?"} ${a.company ?? ""}`.trim(),
                  })),
              ]
            : [{ field: "Award price", value: "award history not yet ingested for this NSN" }]),
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
