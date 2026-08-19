"use client";

import { useMemo, useState } from "react";
import { DataGrid, type GridColumn, type Cell } from "@/components/ui/DataGrid";
import { StatusChip } from "@/components/ui/StatusChip";
import type { BoardRow } from "@/lib/board/build";
import styles from "./board.module.css";

type Filter = "all" | "open" | "corner" | "automated" | "unjoined";

/** Every cell is one of three states. There is no path here that renders a blank or a zero
 *  for something we did not measure, which is the whole point of the grid's Cell type. */
const columns: GridColumn<BoardRow>[] = [
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
    // Nomenclatures are comma-joined single tokens ("VALVE,LINEAR,DIRECTIONAL"), so without
    // a wrap allowance the longest one sets the whole grid's min width and pushed it 19px
    // past a 1440 viewport, clipping the price column's insufficient-inputs chips.
    wrap: true,
    cell: (r): Cell =>
      r.nomenclature.trim() === ""
        ? { state: "unknown", reason: "not published on this line" }
        : { state: "known", value: r.nomenclature.trim(), provenance: "measured" },
  },
  {
    id: "standing",
    header: "Approved sources",
    sortValue: (r) => (r.standing.kind === "sole" ? 0 : r.standing.kind === "multiple" ? 1 : 2),
    cell: (r): Cell => {
      if (r.standing.kind === "sole") {
        return {
          state: "known",
          provenance: "measured",
          value: <StatusChip tone="verified">Sole source · {r.standing.cages[0]}</StatusChip>,
        };
      }
      if (r.standing.kind === "multiple") {
        return {
          state: "known",
          provenance: "measured",
          value: <StatusChip tone="idle">{r.standing.count} approved</StatusChip>,
        };
      }
      return { state: "unknown", reason: r.standing.why };
    },
  },
  {
    id: "award",
    header: "Award path",
    // Tightened (16ch -> 15ch, with the price column 17ch -> 15ch) so the whole grid fits a
    // 1440 viewport with the insufficient-inputs chips visible at rest instead of 19px cut.
    width: "15ch",
    helpId: "monopoly.award_path",
    sortValue: (r) => (r.automated === true ? 0 : r.automated === false ? 1 : 2),
    cell: (r): Cell => {
      if (r.automated === null) {
        return {
          state: "unknown",
          reason: "solicitation too short to name the path",
        };
      }
      return r.automated
        ? {
            state: "known",
            provenance: "measured",
            // Neutral, not amber: amber is the clock's alone. The word carries the fact.
            value: <StatusChip tone="active">Machine award</StatusChip>,
          }
        : { state: "known", provenance: "measured", value: <StatusChip tone="idle">Manual</StatusChip> };
    },
  },
  {
    id: "qty",
    header: "Qty",
    mono: true,
    align: "end",
    width: "9ch",
    sortValue: (r) => r.quantity ?? -1,
    cell: (r): Cell =>
      r.quantity == null
        ? { state: "unknown", reason: "not published" }
        : { state: "known", value: `${r.quantity} ${r.unitOfIssue}`.trim(), provenance: "measured" },
  },
  {
    id: "return",
    header: "Return date",
    mono: true,
    width: "11ch",
    sortValue: (r) => r.returnDate,
    cell: (r): Cell =>
      r.returnDate.trim() === ""
        ? { state: "unknown", reason: "not published" }
        : { state: "known", value: r.returnDate.trim(), provenance: "measured" },
  },
  /*
   * THE EVALUATED-PRICE COLUMN IS DELIBERATELY NOT HERE, AND ITS SENTENCE DID NOT GO ANYWHERE.
   *
   * It used to be the last column, and its cell function took no row argument: it returned the
   * identical abstention for every row on every feed day. Measured on the serving path at 1440
   * (2026-08-17, corner tab, 129 rows): 258 of the page's 258 dashed boxes came from that one
   * column (the <InsufficientData> wrapper is dashed and so is its glyph), the reason wrapped to
   * three lines inside a 13ch cell, and the row pitch was 78px instead of the compact 32px the
   * density token asks for. One column with nothing in it was costing the operator more than
   * half the rows on his screen.
   *
   * A fact that is true of the COLUMN does not belong in a CELL. It is now stated once in the
   * truth strip above the grid, where the sentence "Price, availability and modeled lift are
   * absent from this page because those files do not contain them" already said it, with the
   * registered `board.evaluated_price` explainer mounted beside it; and it is repeated per row
   * in the expansion below, in full, where the sentence has room. Clip at the cell, overflow to
   * row detail. Nothing the operator could read before is unreadable now.
   *
   * WHEN AWARD HISTORY IS JOINED INTO buildBoard, THIS COLUMN COMES BACK, keyed on the row, and
   * it will abstain per row instead of per page. /monopoly already renders exactly that shape.
   */
];

export function BoardGrid({ rows, unjoined }: { rows: BoardRow[]; unjoined: number }) {
  const [filter, setFilter] = useState<Filter>("corner");

  const shown = useMemo(() => {
    switch (filter) {
      case "open":
        return rows.filter((r) => r.lifecycle.status === "open");
      case "corner":
        return rows.filter((r) => r.standing.kind === "sole" && r.automated === true);
      case "automated":
        return rows.filter((r) => r.automated === true);
      case "unjoined":
        return rows.filter((r) => r.standing.kind === "unjoined");
      default:
        return rows;
    }
  }, [rows, filter]);

  const tabs: Array<{ id: Filter; label: string; n: number }> = [
    { id: "corner", label: "Sole source + machine award", n: rows.filter((r) => r.standing.kind === "sole" && r.automated === true).length },
    { id: "open", label: "Still open today", n: rows.filter((r) => r.lifecycle.status === "open").length },
    { id: "automated", label: "Machine award", n: rows.filter((r) => r.automated === true).length },
    { id: "all", label: "Everything published", n: rows.length },
    { id: "unjoined", label: "Source unknown", n: unjoined },
  ];

  return (
    <>
      <div className={styles.filters} role="tablist" aria-label="Board filters">
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
        rowKey={(r) => `${r.solicitation}:${r.nsn}:${r.purchaseRequest}`}
        /*
         * The four identifiers a person arrives holding: the stock number off a drawing, the
         * solicitation off an email, the PR off a buyer's note, and the item's own name. Not the
         * standing, lifecycle or automated flags — those are the tabs above, and folding them in
         * would make "open" return most of the board.
         */
        search={{
          fields: (r) => [r.nsn, r.niin, r.nomenclature, r.solicitation, r.purchaseRequest],
          placeholder: "Search NSN, item, solicitation or PR",
          label: "Search the board by stock number, item name, solicitation or purchase request",
        }}
        label="DLA requirements from the served feed day, ranked by measured sourcing signal, each judged open or closed against today"
        density="compact"
        empty={{
          cause: "filtered",
          message:
            "No published requirement on this feed day matches this filter. The feed loaded correctly; this combination simply did not occur.",
          onClearFilters: () => setFilter("all"),
        }}
        expansion={(r) => [
          { field: "Solicitation", value: r.solicitation },
          { field: "NSN", value: r.nsn },
          { field: "NIIN", value: r.niin ?? "(none: locally assigned stock number)" },
          { field: "Nomenclature", value: r.nomenclature },
          { field: "Quantity", value: r.quantity == null ? "(not published)" : String(r.quantity) },
          { field: "Unit of issue", value: r.unitOfIssue || "(not published)" },
          { field: "Return date", value: r.returnDate || "(not published)" },
          { field: "Purchase request", value: r.purchaseRequest || "(not published)" },
          {
            field: "Approved sources",
            value:
              r.standing.kind === "sole"
                ? `1 (CAGE ${r.standing.cages[0]})`
                : r.standing.kind === "multiple"
                  ? String(r.standing.count)
                  : `unknown: ${r.standing.why}`,
          },
          // The stated gap the grid used to repeat in a cell on every row, kept per row and in
          // full. The two files this page is built from carry no price of any kind.
          {
            field: "Evaluated price",
            value:
              "not published in either file this page reads; it needs award history + availability, and it is not estimated here",
          },
        ]}
      />
    </>
  );
}
