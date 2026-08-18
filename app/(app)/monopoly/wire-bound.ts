/**
 * WHAT CROSSES THE WIRE TO THE MONOPOLY GRID, AND WHAT IS ONLY COUNTED.
 *
 * ---------------------------------------------------------------------------------------
 * WHY A BOUND EXISTS AT ALL
 * ---------------------------------------------------------------------------------------
 * /monopoly is `force-dynamic` with no caching, so every visit serialises every row the page
 * hands to its "use client" grid. When demand widened from one feed day to the archived window
 * the row count went 186 to 10,488 and the RSC flight payload went 0.342MB to 25.98MB, measured
 * by `JSON.stringify` over the exact array the page passes down. That is the same defect
 * lib/intelligence/monopoly-view.ts already fought once from the FIELD side (its header records
 * the 26MB payload and the slim wire type built to beat it), returning from the ROW side.
 *
 * Virtualising the grid does not touch this. `@tanstack/react-virtual` bounds what is PAINTED;
 * a virtual list still receives every row as a prop and every one of those rows still crosses
 * the wire. The only thing that shrinks a flight payload is sending fewer rows.
 *
 * ---------------------------------------------------------------------------------------
 * WHY CANDIDATES GET FIRST CLAIM ON THE BUDGET
 * ---------------------------------------------------------------------------------------
 * MEASURED on this archive: ranking by CornerScore and taking the top 500 holds 57 of the 273
 * candidate corners. The other 216 would have vanished from the tab the page OPENS on,
 * which is the one thing this page is for. Score does not order candidacy: a candidate is
 * sole-sourced with an award-silent incumbent, and CornerScore weighs price history and forward
 * demand that a candidate may simply have no record of. So candidates fill the budget first.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THE TOTALS COME BACK WITH THE SLICE
 * ---------------------------------------------------------------------------------------
 * A bounded board is honest. A silently bounded board is not. Every count the page and the grid
 * print about the MAP has to be counted over the whole served set, so `totals` is returned from
 * here rather than derived downstream from `shipped`: a count taken off the bounded array is a
 * count of the page wearing the map's label, and that is the exact shape of the defect this
 * module exists to avoid reintroducing one level down.
 */

/**
 * HOW MANY ROWS MAY CROSS THE WIRE.
 *
 * MEASURED on this archive, judged against 2026-08-18, over exactly the object /monopoly hands
 * to <MonopolyGrid> (the slim view row plus the five eligibility and operator fields the page
 * joins on, built by replaying the page's own `enriched` map), by `JSON.stringify().length`:
 *
 *     rows shipped     400      500      600      700     1000     5,366 (all)
 *     payload          1.29MB   1.70MB   2.09MB   2.45MB  3.44MB   14.27MB
 *
 * 500 is the choice: 1.70MB. About five times the pre-window page (0.342MB at 186 rows) and
 * 6.5% of the 25.98MB the defect shipped, with room for every candidate corner this archive
 * holds (273) and 227 rows of headroom for the wider tabs.
 *
 * ★ RE-MEASURE BEFORE YOU TRUST THIS TABLE, AND MEASURE THE WHOLE OBJECT. A review measured
 * 1.489MB / 12.06MB for what it called the same thing on the same archive the same day, and
 * the gap is not the archive: the RAW view rows agree to the byte (11.80MB unbounded both
 * times), so the difference is entirely in the five joined fields, one of which is the
 * verbatim DoD 4100.39-M Table 71 explanation string. That join changes whenever
 * lib/intelligence/eligibility/bid-eligibility.ts changes, and it did on 2026-08-18. So a
 * payload measured over `view.rows` alone, or over a stale eligibility index, is a different
 * number wearing this table's label.
 *
 * IT IS A CONSTANT, NOT A CALIBRATION. Nothing else in this module reads it, the numbers above
 * are a reading of one archive state, and moving it wants a fresh measurement rather than a
 * guess: rows are not a fixed size, and the high-scoring rows that ship first carry the longest
 * award histories, so the cost per row is above the board's mean by construction.
 */
export const GRID_ROW_BUDGET = 500

/** The only properties the bound reads. Structural, so the page's enriched row type fits. */
export type BoundableRow = {
  soleSource: boolean
  silentSourceCount: number
  score: { scoreV0: number }
}

export type WireBound<T> = {
  /** The rows that travel, highest CornerScore first. Never longer than `budget`. */
  shipped: T[]
  /** Counted over EVERY row handed in, never over `shipped`. These are the map's counts. */
  totals: { candidate: number; sole: number; all: number }
  /** The budget actually applied, so a surface can state it rather than restate a constant. */
  budget: number
}

/** The map's own definition of a candidate corner: sole-sourced, and the incumbent is silent. */
export function isCandidateCorner(row: BoundableRow): boolean {
  return row.soleSource && row.silentSourceCount > 0
}

/**
 * Bound the board for the wire.
 *
 * Deterministic: a stable sort key (CornerScore descending, then the input order preserved by
 * `Array.prototype.sort` being stable in every runtime this ships on) so two builds of the same
 * archive ship the same rows. No clock, no randomness, no scoring done here.
 */
export function boundRowsForWire<T extends BoundableRow>(rows: T[], budget: number): WireBound<T> {
  const ranked = [...rows].sort((a, b) => b.score.scoreV0 - a.score.scoreV0)
  const candidates = ranked.filter(isCandidateCorner)
  const others = ranked.filter((r) => !isCandidateCorner(r))

  const shipped = [
    ...candidates.slice(0, budget),
    ...others.slice(0, Math.max(0, budget - candidates.length)),
  ].sort((a, b) => b.score.scoreV0 - a.score.scoreV0)

  return {
    shipped,
    totals: {
      candidate: candidates.length,
      sole: ranked.filter((r) => r.soleSource).length,
      all: ranked.length,
    },
    budget,
  }
}
