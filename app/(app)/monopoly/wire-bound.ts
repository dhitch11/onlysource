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

import { rankCompare } from '@/lib/intelligence/scoring/cornerscore'

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
  /**
   * The tiebreak key. The board's sort was rankKey alone, which was survivable only while the
   * value term was a continuous ramp and two rows almost never shared a float. The $50K-$250K band
   * is FLAT by design, so exact ties are now routine and the order needs a second, stable key.
   */
  nsn: string
  soleSource: boolean
  silentSourceCount: number
  /**
   * rankKey drives the order (unclamped, so saturated-at-100 whales still order correctly);
   * disposition 'SKIP' marks a locked closed door that must not consume the wire budget; hidden
   * mirrors lockup.hidden for the grid.
   */
  score: { scoreV0: number; rankKey: number; hidden: boolean; disposition: string }
}

export type WireBound<T> = {
  /**
   * The rows that travel: up to `budget` VISIBLE rows highest-rankKey first, then a bounded
   * allotment of locked closed doors appended at the bottom for the grid's "show locked" toggle.
   * The visible slice is never longer than `budget`; the locked tail is separately bounded.
   */
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
 * Deterministic: a TOTAL order (rankKey descending, then stock number ascending) so two builds of
 * the same archive ship the same rows in the same order. No clock, no randomness, no scoring here.
 *
 * ★ THIS USED TO LEAN ON SORT STABILITY, AND THAT STOPPED BEING ENOUGH. The old comment read
 * "then the input order preserved by `Array.prototype.sort` being stable". True of the sort, but it
 * makes the board's order a function of FILE-PARSE ORDER rather than of the data - reproducible
 * only while nothing upstream reorders, and silent when it breaks. The flat value band made exact
 * ties routine (246 of 771 priceable rows on the real seed corpus), so the latent ambiguity became
 * a live one and is now closed with a real second key.
 */
export function boundRowsForWire<T extends BoundableRow>(rows: T[], budget: number): WireBound<T> {
  // Locked closed doors (disposition SKIP) are never dropped from the dataset, but they must not
  // eat the VISIBLE wire budget: they are filtered out here, before the cut, and reach the grid
  // only behind its explicit "show locked" toggle. Order is by the unclamped rankKey, not the
  // clamped badge, so two whales both showing 100 still order by their real value underneath.
  const visible = rows.filter((r) => r.score.disposition !== 'SKIP')
  const ranked = [...visible].sort((a, b) => rankCompare(a.score.rankKey, a.nsn, b.score.rankKey, b.nsn))
  const candidates = ranked.filter(isCandidateCorner)
  const others = ranked.filter((r) => !isCandidateCorner(r))

  const visibleShipped = [
    ...candidates.slice(0, budget),
    ...others.slice(0, Math.max(0, budget - candidates.length)),
  ].sort((a, b) => rankCompare(a.score.rankKey, a.nsn, b.score.rankKey, b.nsn))

  // A bounded allotment of the locked rows travels TOO, appended at the bottom, so the grid's
  // "show locked" toggle reveals real rows rather than an empty promise. They carry the full LOCK_PENALTY,
  // so even when revealed they sort last; they never displace a visible row from the budget above.
  const locked = [...rows.filter((r) => r.score.disposition === 'SKIP')]
    .sort((a, b) => rankCompare(a.score.rankKey, a.nsn, b.score.rankKey, b.nsn))
    .slice(0, budget)

  const shipped = [...visibleShipped, ...locked]

  return {
    shipped,
    // Totals count the WHOLE input (locked rows included): they are the map's funnel counts, and a
    // closed door is still a position that exists. Only the budget above excludes the locked rows.
    totals: {
      candidate: rows.filter(isCandidateCorner).length,
      sole: rows.filter((r) => r.soleSource).length,
      all: rows.length,
    },
    budget,
  }
}
