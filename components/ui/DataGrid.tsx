"use client";

/*
 * <DataGrid /> Owner: T8 DESIGN. The hardest thing in this lane and the surface the product
 * lives in.
 *
 * Built to @T4-INTELLIGENCE's posted props (claims file, 2026-08-13) so nobody was guessing:
 * cell-level provenance, a first-class abstention cell, row expansion to literal records, a
 * three-cause empty state, and column-level help ids.
 *
 * =========================================================================================
 * THE CELL CONTRACT, WHICH IS THE PART THAT MATTERS MOST
 * =========================================================================================
 * A cell is NOT a value-or-empty. It is one of three states, and the third is why this type
 * exists:
 *
 *     { state: 'known',   value, provenance? }
 *     { state: 'unknown', reason }              <- the abstention cell
 *     { state: 'empty' }                        <- genuinely, verifiably nothing
 *
 * T4 put it exactly right: "Availability is not read on every row today, and it must render
 * as a visible honest state, never blank and never zero. A blank cell reads as 'none' and
 * that is the exact Law 1 failure on this surface."
 *
 * So the type FORCES the choice. There is no way to express "I do not know" by returning
 * undefined, because undefined would render as blank and blank is a claim. A lane that has
 * not read a value must say so in words, and the words are theirs because they own the
 * reason.
 *
 * PROVENANCE IS PER CELL, NOT PER ROW. On one row a quantity can be measured while the
 * source status is inferred, and one row-level glyph would overstate the weaker half.
 *
 * =========================================================================================
 * WHAT IS DELIBERATELY NOT HERE YET, so nobody builds on a promise
 * =========================================================================================
 * VIRTUALISATION IS NOT ON. The rule is "virtualise only after you have measured, and always
 * ship the escape hatch", and the escape hatches (aria-rowcount, roving tabindex restored
 * across window shifts, an in-grid find over the FULL result set, print of the whole view)
 * are what make it safe. The row count and the measured frame timings are reported by
 * `onMeasure` so the threshold is chosen from this grid's real row shape rather than from a
 * number I made up. T4 is at 2,141 rows today against a 52,000 target, so this WILL need it.
 * It is the next commit, not a claim in this one.
 */

import { useCallback, useId, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Provenance, type ProvenanceKind } from "./Provenance";
import { ExplainButton } from "./ExplainButton";
import { InsufficientData } from "./States";
import { Scrollable } from "./Scrollable";
import styles from "./DataGrid.module.css";

/* ------------------------------------------------------------------- the cell contract */

export type Cell =
  | { state: "known"; value: React.ReactNode; provenance?: ProvenanceKind }
  /** Not read, not computed, or the data cannot support an answer. NEVER blank, never zero.
   *  The reason is the owning lane's words, because they own why it is unknown. */
  | { state: "unknown"; reason: string }
  /** Verifiably nothing. Use this ONLY when absence is itself the measured fact. If you are
   *  reaching for it because you did not look, you want `unknown`. */
  | { state: "empty" };

export interface GridColumn<T> {
  id: string;
  header: string;
  /** Returns the three-state cell. There is no way to return "nothing" by accident. */
  cell: (row: T) => Cell;
  /** Sort key. Omit to make the column unsortable. */
  sortValue?: (row: T) => string | number | null;
  /** Monospace with tabular numerals. For every identifier and every machine value. */
  mono?: boolean;
  align?: "start" | "end";
  /** Registered helpId. The column header renders a real ExplainButton for it. */
  helpId?: string;
  /** Column width. Defaults to content. Use ch units for identifier columns so the width
   *  comes from the government field width and nothing jitters on first paint. */
  width?: string;
  /** Pins the column to the start and keeps it visible while scrolling sideways. */
  pinned?: boolean;
  /**
   * Lets this column's cells break INSIDE a long unbroken token (overflow-wrap: anywhere).
   * For prose-ish columns (nomenclatures are comma-joined single tokens) whose min-content
   * width would otherwise force the whole grid past the viewport. Identifier columns must
   * never set it: a stock number that wraps reads as two numbers.
   */
  wrap?: boolean;
}

/** The three causes of an empty grid. They are three different facts and one generic
 *  "no results" sends the reader to the wrong remedy. */
export type EmptyCause =
  | { cause: "computing"; message: string }
  | { cause: "filtered"; message: string; onClearFilters?: () => void }
  | { cause: "narrow"; message: string };

export interface DataGridProps<T> {
  rows: T[];
  columns: GridColumn<T>[];
  rowKey: (row: T) => string;
  /** Describes the grid for screen readers, for example "Monopoly map, ranked by legs". */
  label: string;
  /** Rendered when `rows` is empty. Required, because a grid with no rows and no explanation
   *  is the single most common way an operator concludes the product is broken. */
  empty: EmptyCause;
  /** The literal source records for a row, shown on expansion. Monospace, copyable, NEVER
   *  truncated. This is the control the principal uses on the first row he sees to decide
   *  whether to trust the tool, so it shows the actual government column names and values,
   *  not a summary. */
  expansion?: (row: T) => Array<{ field: string; value: string }>;
  /**
   * Fired when a row opens or closes, with the row or null.
   *
   * Additive and optional, so every existing caller is unaffected. It exists because a surface
   * may need to FETCH what an expansion shows rather than already hold it: /suppliers keeps
   * contact details off the wire entirely and behind `supplier.identity.view`, so the detail is
   * requested when a person actually opens one company. Without this the fetch would have to be
   * fired from inside `expansion()`, which runs during render.
   */
  onExpand?: (row: T | null) => void;
  density?: "compact" | "default" | "comfortable";
  /** Reports the real row count and the measured render time, so the virtualisation
   *  threshold is chosen from measurement rather than from a guess. */
  onMeasure?: (m: { rows: number; renderMs: number }) => void;
}

const DENSITY_PAD: Record<NonNullable<DataGridProps<unknown>["density"]>, string> = {
  compact: "var(--row-pad-y-compact)",
  default: "var(--row-pad-y)",
  comfortable: "var(--row-pad-y-comfortable)",
};

function CellBody({ cell, mono }: { cell: Cell; mono?: boolean }) {
  if (cell.state === "unknown") {
    // An answer, not a failure. Names exactly what is missing. Never a zero, never a dash.
    return <InsufficientData missing={cell.reason} />;
  }
  if (cell.state === "empty") {
    // The one case where nothing is the measured fact. Said in words for screen readers so
    // it is distinguishable from a cell that simply failed to render.
    return (
      <span className={styles.emptyCell}>
        <span aria-hidden="true">none</span>
        <span className="vh">none, and that is a measured value rather than a gap</span>
      </span>
    );
  }
  return (
    <span className={styles.cellValue}>
      <span className={mono ? "mono" : undefined}>{cell.value}</span>
      {cell.provenance ? <Provenance kind={cell.provenance} /> : null}
    </span>
  );
}

/**
 * How many card-rows render below 700px. Fifteen at ~550px each is about nine screens, which is
 * a board somebody can actually scan on a phone. It is a constant rather than a prop because the
 * constraint is the viewport, not the caller.
 */
const NARROW_ROW_CAP = 15;

export function DataGrid<T>({
  rows,
  columns,
  rowKey,
  label,
  empty,
  expansion,
  onExpand,
  density = "default",
  onMeasure,
}: DataGridProps<T>) {
  const gridId = useId();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const started = useRef<number>(0);

  const tanstackColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        accessorFn: (row: T) => (c.sortValue ? c.sortValue(row) : null),
        enableSorting: Boolean(c.sortValue),
        cell: (ctx) => <CellBody cell={c.cell(ctx.row.original)} mono={c.mono} />,
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: tanstackColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const modelRows = table.getRowModel().rows;

  // Measure the real render rather than guessing the virtualisation threshold.
  started.current = typeof performance !== "undefined" ? performance.now() : 0;
  const report = useCallback(
    (node: HTMLTableSectionElement | null) => {
      bodyRef.current = node;
      if (node && onMeasure && started.current) {
        onMeasure({ rows: modelRows.length, renderMs: performance.now() - started.current });
      }
    },
    [modelRows.length, onMeasure],
  );

  /*
   * ROVING TABINDEX. Arrow keys move, Enter opens the row, Tab leaves the grid entirely
   * rather than walking the operator through twenty thousand cells. This is the React Aria
   * Table behaviour implemented against its specification, which is how the engine decision
   * was recorded: React Aria is the spec, TanStack is the render layer.
   */
  const [focusCell, setFocusCell] = useState<{ r: number; c: number }>({ r: 0, c: 0 });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableElement>) => {
      const maxR = modelRows.length - 1;
      const maxC = columns.length - 1;
      let { r, c } = focusCell;
      switch (e.key) {
        case "ArrowDown": r = Math.min(maxR, r + 1); break;
        case "ArrowUp": r = Math.max(0, r - 1); break;
        case "ArrowRight": c = Math.min(maxC, c + 1); break;
        case "ArrowLeft": c = Math.max(0, c - 1); break;
        case "Home": c = 0; break;
        case "End": c = maxC; break;
        case "Enter":
          if (expansion && modelRows[r]) {
            const key = rowKey(modelRows[r]!.original);
            setExpanded((cur) => {
              const next = cur === key ? null : key;
              if (onExpand) onExpand(next === null ? null : modelRows[r]?.original ?? null);
              return next;
            });
            e.preventDefault();
          }
          return;
        default:
          return;
      }
      e.preventDefault();
      setFocusCell({ r, c });
      const sel = `[data-cell="${r}-${c}"]`;
      bodyRef.current?.querySelector<HTMLElement>(sel)?.focus();
    },
    [focusCell, modelRows, columns.length, expansion, rowKey],
  );

  /* ------------------------------------------------------------------- the empty states */

  if (rows.length === 0) {
    return (
      <div className={styles.empty} role="status">
        <p className={styles.emptyTitle}>
          {empty.cause === "computing"
            ? "Still computing"
            : empty.cause === "filtered"
              ? "Nothing matches this view"
              : "Nothing meets this profile"}
        </p>
        <p className={styles.emptyBody}>{empty.message}</p>
        {empty.cause === "filtered" && empty.onClearFilters ? (
          <button type="button" className={styles.emptyAction} onClick={empty.onClearFilters}>
            Clear the filters
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.wrap} style={{ ["--row-pad-y" as string]: DENSITY_PAD[density] }}>
      {/*
       * The grid scrolls INSIDE this container. The page never scrolls sideways. A data grid
       * is two-dimensional content and is explicitly exempt from the 320px reflow floor
       * (R6), but the PAGE is not exempt and must never inherit the grid's width.
       *
       * OVERFLOW HONESTY: when columns are hidden past the right edge, <Scrollable> renders
       * a fade plus "Scroll for more columns" so hidden money data is never silently hidden.
       * A grid that fits renders neither.
       */}
      <Scrollable className={styles.scroller}>
        <table
          className={styles.table}
          aria-label={label}
          /* The FILTERED TOTAL, not the rendered window. When virtualisation lands this must
           * keep reporting the true total or screen reader row counting silently lies. */
          aria-rowcount={rows.length}
          onKeyDown={onKeyDown}
        >
          <thead>
            <tr>
              {columns.map((c, ci) => {
                const sorted = sorting.find((s) => s.id === c.id);
                return (
                  <th
                    key={c.id}
                    scope="col"
                    className={[
                      c.pinned ? styles.pinned : "",
                      c.align === "end" ? styles.alignEnd : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={c.width ? { inlineSize: c.width } : undefined}
                    aria-sort={
                      sorted ? (sorted.desc ? "descending" : "ascending") : c.sortValue ? "none" : undefined
                    }
                  >
                    <span className={styles.headCell}>
                      {c.sortValue ? (
                        <button
                          type="button"
                          className={styles.sortBtn}
                          onClick={() => table.getColumn(c.id)?.toggleSorting()}
                        >
                          {c.header}
                          <span className={styles.sortMark} aria-hidden="true">
                            {sorted ? (sorted.desc ? "▼" : "▲") : "↕"}
                          </span>
                        </button>
                      ) : (
                        <span>{c.header}</span>
                      )}
                      {/* Column-level help, wired to the registry. T4's ids are already
                          registered, so these resolve to real content rather than a
                          pending panel. */}
                      {c.helpId ? <ExplainButton helpId={c.helpId} size="sm" /> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody ref={report}>
            {modelRows.map((row, ri) => {
              const key = rowKey(row.original);
              const isOpen = expanded === key;
              return (
                <>
                  <tr
                    key={key}
                    className={
                      [isOpen ? styles.rowOpen : "", expansion ? styles.rowClickable : ""]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    aria-rowindex={ri + 2}
                    aria-expanded={expansion ? isOpen : undefined}
                    onClick={
                      expansion
                        ? (e) => {
                            // A cell may hold a link or button (e.g. the stock-number link).
                            // Let those act; a click anywhere else on the row opens its records.
                            if ((e.target as HTMLElement).closest("a, button")) return;
                            setExpanded((cur) => {
                              const next = cur === key ? null : key;
                              if (onExpand) onExpand(next === null ? null : row.original);
                              return next;
                            });
                          }
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell, ci) => {
                      const col = columns[ci]!;
                      return (
                        <td
                          key={cell.id}
                          data-cell={`${ri}-${ci}`}
                          /*
                           * ★ THE COLUMN'S OWN HEADER, CARRIED ONTO THE CELL, so the narrow-width
                           * card layout labels each value from the ONE place that already knows the
                           * header text. The only other hook the DOM offered was the column INDEX in
                           * `data-cell`, and a label bound to column position desyncs silently the
                           * day a column moves.
                           */
                          data-label={col.header}
                          tabIndex={focusCell.r === ri && focusCell.c === ci ? 0 : -1}
                          onFocus={() => setFocusCell({ r: ri, c: ci })}
                          className={[
                            col.pinned ? styles.pinned : "",
                            col.align === "end" ? styles.alignEnd : "",
                            col.wrap ? styles.wrapAnywhere : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>

                  {/*
                   * ROW EXPANSION TO LITERAL RECORDS. Not a summary. The actual source rows
                   * with their government column names, monospace, copyable, never
                   * truncated. This is the control that decides whether the principal
                   * trusts the tool at all, so it shows him the raw thing.
                   */}
                  {isOpen && expansion ? (
                    <tr key={`${key}-x`} className={styles.expansionRow}>
                      <td colSpan={columns.length}>
                        <div className={styles.expansion}>
                          <p className={styles.expansionHead}>Source records, exactly as received</p>
                          <dl className={styles.expansionList}>
                            {expansion(row.original).map((f) => (
                              <div key={f.field} className={styles.expansionItem}>
                                <dt className="mono">{f.field}</dt>
                                <dd className="mono">{f.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </>
              );
            })}
          </tbody>
        </table>
      </Scrollable>

      <p className={styles.footNote}>
        <span className="mono">{rows.length.toLocaleString()}</span> rows.
        {expansion ? " Click any row (or press Enter) to see its exact source records." : ""}
      </p>
      {/*
        ★ THE NARROW-WIDTH CAP, STATED. Below 700px every row is a ~550px card, so rendering all
        of them is hundreds of screens: MEASURED at 226,293px on a 331-row board, and the fixed
        70vh scroller was hiding it inside a 630px porthole with 360 windows of nested scroll.
        The cards now flow in the document, and the document has to be a length somebody can use.

        The rows are ordered strongest-basis-first, so the FIRST N are the ones to keep — the
        opposite of the corner award history, which is oldest-first and keeps its tail.

        Hidden in CSS, so every row stays in the DOM, stays findable by the browser's own find,
        and returns in full on a wider screen with no second request. And the count is stated,
        because a cap the reader has to notice is the silent version of a cap.
      */}
      {rows.length > NARROW_ROW_CAP ? (
        <p className={styles.narrowCapNote}>
          Showing the first <span className="mono">{NARROW_ROW_CAP}</span> of{" "}
          <span className="mono">{rows.length.toLocaleString()}</span> on this screen size, ordered
          strongest first. The rest are on this page and appear on a wider screen.
        </p>
      ) : null}
    </div>
  );
}
