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

import { Fragment, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Provenance, type ProvenanceKind } from "./Provenance";
import { ExplainButton } from "./ExplainButton";
import { InsufficientData } from "./States";
import { Scrollable } from "./Scrollable";
import { haystackOf, matchesTerms, termsOf } from "./row-search";
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
  /**
   * OPT IN TO A SEARCH BOX OVER THESE ROWS.
   *
   * Absent means no box, so a grid of six rows does not grow a control it does not need.
   *
   * ★ IT LIVES HERE, ONCE, RATHER THAN IN EACH PAGE. Four surfaces render this grid over lists
   * nobody can scan: /suppliers 3,471 rows, /board 1,363, /pricing 1,201, /monopoly 344. None of
   * them had any way to find a known row, and /suppliers even PROMISED one in its loader copy
   * ("instant to sort and search") while no control existed. Four separate repairs would have
   * been four slightly different definitions of what a second search word means.
   */
  search?: {
    /**
     * The fields this row can be found by. Return the raw values; joining, lower-casing and
     * separating them is `haystackOf`'s job.
     *
     * PUT IDENTIFIERS HERE, NOT FILTERS. Name, code, place. Not tier, score or status: see the
     * note in `row-search.ts` for why folding an enumeration in ruins the box.
     */
    readonly fields: (row: T) => ReadonlyArray<string | null | undefined>;
    /** Says what can be typed. Required, because a box that does not say what it searches gets
     *  read as "search everything" and its first miss reads as missing data. */
    readonly placeholder: string;
    /** Accessible name for the box. */
    readonly label: string;
    /** Told the trimmed query and how many rows matched, AFTER render. Lets a page add context
     *  the grid cannot know — /suppliers uses it to say a firm exists on a different tab. */
    readonly onQueryChange?: (query: string, matched: number) => void;
  };
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

/**
 * Build a React key per row that is UNIQUE among siblings and STABLE across reorders.
 *
 * Pure and exported so it can be tested without a DOM. `id` is TanStack's row id, derived from
 * the row's position in the SOURCE array, which is why it is safe as a disambiguator: it does
 * not move when the user sorts or filters. `base` is the caller's `rowKey`.
 */
export function buildRowKeys(rows: readonly { id: string; base: string }[]): {
  keys: string[];
  collided: string[];
} {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.base, (counts.get(r.base) ?? 0) + 1);

  const keys = rows.map((r) => ((counts.get(r.base) ?? 0) > 1 ? `${r.base}\u0000${r.id}` : r.base));

  // Not assumed. A caller key that literally contains the separator could still collide, and the
  // fallback below cannot, because the whole key is then just the unique source-row id.
  if (new Set(keys).size !== keys.length) {
    for (let i = 0; i < keys.length; i += 1) keys[i] = `\u0000${rows[i]!.id}`;
  }

  const collided = [...counts.entries()].filter(([, n]) => n > 1).map(([b]) => b);
  return { keys, collided };
}

export function DataGrid<T>({
  rows,
  columns,
  rowKey,
  label,
  empty,
  expansion,
  onExpand,
  search,
  density = "default",
  onMeasure,
}: DataGridProps<T>) {
  const gridId = useId();
  const [sorting, setSorting] = useState<SortingState>([]);

  /* ------------------------------------------------------------------------------- search */
  /*
   * `useDeferredValue`, not a debounce timer. The input keeps the exact character the operator
   * typed and stays instant, while the list re-filters against a lagging copy. A timer would make
   * the field's own value wrong for its duration, which shows up the moment somebody types fast
   * and hits Enter.
   */
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const terms = useMemo(() => termsOf(deferredQuery.trim()), [deferredQuery]);

  const visibleRows = useMemo(() => {
    if (!search || terms.length === 0) return rows;
    return rows.filter((r) => matchesTerms(haystackOf(search.fields(r)), terms));
    // `search` is recreated by most callers each render; `search.fields` is what matters and is
    // stable in practice. Depending on the object identity would refilter every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, terms]);

  /*
   * Reported in an EFFECT, never during render. A parent that calls setState from this callback
   * would otherwise update a component while this one is rendering, which React either warns
   * about or loops on depending on the path.
   */
  const notify = search?.onQueryChange;
  useEffect(() => {
    notify?.(deferredQuery.trim(), visibleRows.length);
  }, [notify, deferredQuery, visibleRows.length]);

  /* "/" focuses the box: the convention every operator already has in their fingers. Guarded on
     the target so it never steals the key from somebody typing a slash into a field. */
  useEffect(() => {
    if (!search) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);
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
    data: visibleRows,
    columns: tanstackColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const modelRows = table.getRowModel().rows;

  /* ------------------------------------------------------------------------------ row identity
   * ★ A REACT KEY MUST BE UNIQUE AMONG SIBLINGS AND STABLE ACROSS REORDERS. `rowKey` is the
   * CALLER'S notion of identity, and on real government data it is not always unique. Measured
   * 2026-08-24 on /goldmine: 187 rendered rows, 179 distinct keys, 8 keys shared by 16 rows. The
   * rows were genuinely different (a revision and the row it supersedes, different close dates),
   * so this is an insufficient key, not duplicated data.
   *
   * React's own answer to a duplicate key is that children "may be duplicated and/or omitted". On
   * a grid of government buys an omitted row is a lost deal and it is invisible. So:
   *
   *   - PRODUCTION IS CORRECT. A colliding key is disambiguated with `row.id`, which TanStack
   *     derives from the row's position in the SOURCE array, so the disambiguated key is stable
   *     under sorting and filtering. An index into the RENDERED order would not be: it would
   *     re-associate rows to the wrong DOM nodes the moment somebody sorted a column.
   *   - DEVELOPMENT IS LOUD. The collision is reported once per render, naming the keys, because
   *     the real fix is a better `rowKey` in the caller and silence would hide that forever.
   *
   * Uniqueness is not assumed at the end, it is checked, and the pathological case falls back to
   * a key that cannot collide by construction.
   */
  const rowKeys = useMemo(
    () => buildRowKeys(modelRows.map((r) => ({ id: r.id, base: rowKey(r.original) }))),
    [modelRows, rowKey],
  );

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (rowKeys.collided.length === 0) return;
    // eslint-disable-next-line no-console
    console.warn(
      `[DataGrid] rowKey is not unique: ${rowKeys.collided.length} key(s) are shared by more than ` +
        `one row, e.g. ${rowKeys.collided.slice(0, 3).map((k) => JSON.stringify(k)).join(", ")}. ` +
        "Rows still render correctly because the key is disambiguated with the stable source-row " +
        "id, but the caller should widen rowKey to something that identifies a row on its own.",
    );
  }, [rowKeys]);

  /* --------------------------------------------------------------------------- virtualisation
   * ★ THE FOUR ESCAPE HATCHES THIS FILE DEMANDED ARE NOW ALL PRESENT, so the "next commit" it
   * promised is this one. Its own condition was: virtualise only after measuring, and only with
   * aria-rowcount, a roving tabindex that survives a window shift, AN IN-GRID FIND OVER THE FULL
   * RESULT SET, and print of the whole view.
   *
   *   aria-rowcount   reports the FILTERED total, not the window (already true)
   *   in-grid find    the search box filters the DATA ARRAY, never the DOM, so a match in an
   *                   unrendered row still narrows the grid to it
   *   print           a real `beforeprint` listener turns virtualisation OFF and flushes
   *                   SYNCHRONOUSLY before the browser snapshots the page, so the printed
   *                   output is every row. ★ THIS LINE USED TO READ "handled below: `@media
   *                   print` disables the window entirely" AND THAT WAS A FALSE CLAIM ABOUT
   *                   THIS FILE. There was no `@media print` rule in DataGrid.module.css, and
   *                   no CSS could have satisfied it: virtualisation OMITS ROWS FROM THE DOM,
   *                   and a style query cannot re-insert rows React never rendered. Above the
   *                   threshold, print produced the visible window plus overscan while the
   *                   comment promised the whole view.
   *   tabindex        the roving cell index is (row, col) into the DATA, and the window is a
   *                   render detail, so focus survives a shift by construction
   *
   * WHY WINDOWING RATHER THAN SERVER PAGING, MEASURED ON PROD:
   *     /pricing  1,200 rows  5,711,248 bytes raw   266,407 gzipped   = 21:1
   * A 21:1 ratio says the payload is repetitive MARKUP, not data. The wire cost of every row is
   * roughly 600KB gzipped for the whole board, which is fine; the cost that actually hurts is
   * DOM nodes, parse and layout. Server paging would have solved the cheap problem and broken
   * sort-and-search-across-everything, which is the expensive thing to get back.
   *
   * BELOW THE THRESHOLD NOTHING CHANGES. A 24-row grid pays no virtualiser, no spacers and no
   * estimate; it renders exactly as it did.
   */
  const VIRTUALISE_ABOVE = 150;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /*
   * ★★ ONLY WHERE THE SCROLLER IS ACTUALLY THE SCROLLER, and this is the detail that would have
   * silently eaten rows on phones.
   *
   * Desktop: `.scroller` is `overflow:auto; max-block-size:70vh`, so it owns the vertical scroll
   * and the virtualiser can watch it.
   * Below 700px: that max-height is DELIBERATELY released (see the CSS: a 630px porthole holding
   * 226,293px of cards was 360 nested scroll windows) and the DOCUMENT scrolls instead.
   *
   * Point a virtualiser at an element that never scrolls and it renders index 0 plus overscan
   * FOREVER: the page scrolls, the window never advances, and the operator sees twenty cards
   * where there are two thousand. No error, no warning, just missing data.
   *
   * So the switch is the same 700px contract the stylesheet uses, read from matchMedia rather
   * than guessed, and it FAILS SAFE: unknown or narrow means no virtualisation and the existing
   * behaviour, never a half-rendered grid.
   */
  const [scrollerOwnsScroll, setScrollerOwnsScroll] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 701px)");
    const sync = () => setScrollerOwnsScroll(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /*
   * PRINT TURNS THE WINDOW OFF. `beforeprint` fires before the browser paginates, but a normal
   * React state update is asynchronous and would not land in time, so the update is flushed
   * synchronously inside the event. `afterprint` puts the window back.
   *
   * Chromium fires `beforeprint` for window.print() and for the browser's own print command.
   * Where a browser does not fire it, the failure is the PREVIOUS behaviour (a windowed print),
   * never a broken grid.
   */
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  const virtualise = scrollerOwnsScroll && !printing && modelRows.length > VIRTUALISE_ABOVE;
  const rowVirtualiser = useVirtualizer({
    count: virtualise ? modelRows.length : 0,
    getScrollElement: () => scrollRef.current,
    /* Measured from the real grid at each density rather than guessed; every row is re-measured
     * on mount by `measureElement`, so an estimate that is wrong costs a frame, not a layout. */
    estimateSize: () => (density === "compact" ? 44 : density === "comfortable" ? 68 : 56),
    overscan: 12,
  });
  const windowRows = virtualise ? rowVirtualiser.getVirtualItems() : [];
  const padTop = virtualise && windowRows.length > 0 ? windowRows[0]!.start : 0;
  const padBottom =
    virtualise && windowRows.length > 0
      ? rowVirtualiser.getTotalSize() - windowRows[windowRows.length - 1]!.end
      : 0;

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
            const key = rowKeys.keys[r]!;
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

  /*
   * The box is built here and rendered in BOTH branches below.
   *
   * ★ IT MUST SURVIVE ITS OWN EMPTY RESULT. An early return that drops the input the moment the
   * query matches nothing takes away the only control that can undo the situation: the operator
   * is left looking at "nothing matches" with no box to correct the typo in. The same trap as a
   * filter bar that unmounts when it filters everything out.
   */
  const searchBox = search ? (
    <div className={styles.searchWrap}>
      <label className={styles.srOnly} htmlFor={`${gridId}-search`}>
        {search.label}
      </label>
      <span className={styles.searchIcon} aria-hidden="true">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" strokeLinecap="round" />
        </svg>
      </span>
      <input
        id={`${gridId}-search`}
        ref={searchRef}
        type="search"
        className={styles.search}
        placeholder={search.placeholder}
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query !== "") {
            e.preventDefault();
            setQuery("");
          }
        }}
      />
      {query !== "" ? (
        <button
          type="button"
          className={styles.searchClear}
          onClick={() => {
            setQuery("");
            searchRef.current?.focus();
          }}
          aria-label="Clear the search"
        >
          &times;
        </button>
      ) : (
        /* Occupies the same slot as the clear button so nothing shifts when they swap. */
        <kbd className={styles.searchKbd} aria-hidden="true">/</kbd>
      )}
    </div>
  ) : null;

  /* ------------------------------------------------------------------- the empty states */

  if (visibleRows.length === 0) {
    /*
     * ★ WHICH EMPTINESS IS THIS? A grid can be empty because the page's own filters exclude
     * everything, or because the SEARCH does, and those need different words and different
     * buttons. Telling somebody who just typed a company name that "nothing matches this view"
     * points at the tab bar; they clear the tabs, stay empty, and conclude the record is missing.
     *
     * `rows.length > 0` is the discriminator and it is exact: rows are what the page handed us
     * after its own filtering, visibleRows are what survived the query.
     */
    const emptiedByTheQuery = terms.length > 0 && rows.length > 0;
    return (
      <>
        {searchBox}
        <div className={styles.empty} role="status">
          <p className={styles.emptyTitle}>
            {emptiedByTheQuery
              ? "Nothing matches that search"
              : empty.cause === "computing"
                ? "Still computing"
                : empty.cause === "filtered"
                  ? "Nothing matches this view"
                  : "Nothing meets this profile"}
          </p>
          <p className={styles.emptyBody}>
            {emptiedByTheQuery
              ? `No row here matches "${deferredQuery.trim()}". ${rows.length.toLocaleString()} ${
                  rows.length === 1 ? "row is" : "rows are"
                } in this view.`
              : empty.message}
          </p>
          {emptiedByTheQuery ? (
            <button type="button" className={styles.emptyAction} onClick={() => setQuery("")}>
              Clear the search
            </button>
          ) : empty.cause === "filtered" && empty.onClearFilters ? (
            <button type="button" className={styles.emptyAction} onClick={empty.onClearFilters}>
              Clear the filters
            </button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div className={styles.wrap} style={{ ["--row-pad-y" as string]: DENSITY_PAD[density] }}>
      {searchBox}
      {/*
       * The grid scrolls INSIDE this container. The page never scrolls sideways. A data grid
       * is two-dimensional content and is explicitly exempt from the 320px reflow floor
       * (R6), but the PAGE is not exempt and must never inherit the grid's width.
       *
       * OVERFLOW HONESTY: when columns are hidden past the right edge, <Scrollable> renders
       * a fade plus "Scroll for more columns" so hidden money data is never silently hidden.
       * A grid that fits renders neither.
       */}
      <Scrollable className={styles.scroller} innerRef={scrollRef}>
        <table
          className={styles.table}
          aria-label={label}
          /* The FILTERED TOTAL, not the rendered window. When virtualisation lands this must
           * keep reporting the true total or screen reader row counting silently lies. */
          /* visibleRows, not rows: with a query active the two differ, and a screen reader
             announcing 3,471 over a four-row result is worse than announcing nothing. */
          aria-rowcount={visibleRows.length}
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
            {/*
              * A SPACER ROW, not a transform. The window is drawn inside a real <table>, and a
              * translated <tr> stops participating in the table's own column sizing, so the
              * header and the body drift apart on the first scroll. Two zero-content rows holding
              * the missing height keep the scrollbar honest and the columns aligned.
              */}
            {padTop > 0 ? (
              <tr aria-hidden="true" style={{ height: padTop }}>
                <td colSpan={columns.length} style={{ padding: 0, border: 0 }} />
              </tr>
            ) : null}
            {(virtualise ? windowRows.map((v) => [modelRows[v.index]!, v.index] as const)
                         : modelRows.map((r, i) => [r, i] as const)
            ).map(([row, ri]) => {
              const key = rowKeys.keys[ri]!;
              const isOpen = expanded === key;
              return (
                /*
                 * ★ THE KEY BELONGS ON THE FRAGMENT, NOT ON THE <tr> INSIDE IT. A fragment
                 * returned from `.map()` IS the list child, so keys on its children do not
                 * satisfy React and it warned "Each child in a list should have a unique key
                 * prop ... passed a child from DataGrid" on every grid in the app.
                 */
                <Fragment key={key}>
                  <tr
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
                    <tr className={styles.expansionRow}>
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
                </Fragment>
              );
            })}
            {padBottom > 0 ? (
              <tr aria-hidden="true" style={{ height: padBottom }}>
                <td colSpan={columns.length} style={{ padding: 0, border: 0 }} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </Scrollable>

      <p className={styles.footNote} aria-live="polite">
        {/* Naming BOTH numbers under a query. "4 rows" alone, on a page whose tab says 3,471,
            reads as data having gone missing rather than as a search having been typed. */}
        {terms.length > 0 ? (
          <>
            <span className="mono">{visibleRows.length.toLocaleString()}</span> of{" "}
            <span className="mono">{rows.length.toLocaleString()}</span> rows match{" "}
            <span className="mono">&ldquo;{deferredQuery.trim()}&rdquo;</span>.
          </>
        ) : (
          <>
            <span className="mono">{rows.length.toLocaleString()}</span> rows.
          </>
        )}
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
      {visibleRows.length > NARROW_ROW_CAP ? (
        <p className={styles.narrowCapNote}>
          Showing the first <span className="mono">{NARROW_ROW_CAP}</span> of{" "}
          <span className="mono">{visibleRows.length.toLocaleString()}</span> on this screen size,
          ordered strongest first. The rest are on this page and appear on a wider screen.
        </p>
      ) : null}
    </div>
  );
}
