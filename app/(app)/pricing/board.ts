/**
 * THE SERVER SIDE OF /pricing: every served row, priced, counted, then bounded for the wire.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT THE PAGE
 * ---------------------------------------------------------------------------------------
 * Two reasons, and neither is tidiness. The first is that pricing 5,366 rows costs real time
 * (MEASURED: 1,540 ms for the recommendations plus 187 ms to group the peer pool, on top of the
 * 2.1 s the datasets and the award index take to load), and the page is `force-dynamic`, so
 * without a cache every visit pays it again for an answer that cannot change until the feed
 * day does. The cache is keyed on the FEED DAY for exactly that reason, which is the same
 * shape `lib/intelligence/monopoly-view.ts` and `lib/board/build.ts` already use.
 *
 * The second is that the shape it returns is the thing the tests and the payload probe drive,
 * and a page component is not drivable.
 *
 * ---------------------------------------------------------------------------------------
 * THE PEER POOL IS BUILT ONCE, NOT ONCE PER ROW
 * ---------------------------------------------------------------------------------------
 * The ladder's weakest rung asks for every priced peer in a supply class. Asking the award
 * index that question row by row walks the whole index 5,366 times. `buildFscPeerPool` groups
 * it once and `peerLookupFrom` closes over the result, which is why the pool line above reads
 * 187 ms rather than minutes.
 *
 * A ROW IS NEVER ITS OWN PEER. The pool is grouped by supply class, and this stock number's own
 * awards are in that class. Leaving them in would let the peer rung quietly re-derive the row
 * from its own history and then report it as independent corroboration from N peers, which is
 * the worst kind of wrong: a weak basis wearing a strong one's clothes. `recommendForCorner`
 * filters the subject out on every call, so the peer count printed beside a band is a count of
 * OTHER items.
 *
 * ---------------------------------------------------------------------------------------
 * ★ WHY THIS PRICES `buildBoard()` AND NOT THE CORNER MAP (changed 2026-08-19)
 * ---------------------------------------------------------------------------------------
 * It priced `cornerMap.rows` for its first hour and that shipped a CONTRADICTION, caught by
 * serving both pages and reading them: on feed day 2026-08-14 this desk said "5,366 published
 * requirements, 5,366 still open" while /board said "331 requirements, 307 still open" on the
 * same day. Both cannot be true, and the operator sees both screens.
 *
 * The corner map is a WINDOW across several captured days, so its row count is not a count of
 * what DLA published, and judging every row in a multi-day window against a single `asOf` with
 * `onNewestDay: true` hardcoded states something about each row that was never measured. The
 * board is the requirements as published on the served day, and it is the only source in the
 * product that already owns lifecycle. Reading it here means the two surfaces cannot disagree,
 * because there is now one implementation rather than two.
 *
 * It is also the honest scope of a pricing desk: what can I bid, today.
 */
import { buildBoard } from '@/lib/board/build'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { measureFeedFreshness } from '@/lib/ingest/feed-days'
import { systemClock, type Clock } from '@/lib/time/clock'
import {
  buildFscPeerPool,
  liveClassifierOrNull,
  peerLookupFrom,
  recommendForCorner,
} from '@/lib/intelligence/pricing/for-corner'
import {
  boundPricingRowsForWire,
  toPricingWireRow,
  PRICING_ROW_BUDGET,
  type PricingWireBound,
} from './wire'

export type PricingBoard = {
  readonly ok: true
  readonly feedDay: string
  /** TODAY on the publisher's calendar, which is not the feed day. Both are printed. */
  readonly asOf: string
  /** How many stock numbers the ladder could reach at all, before the wire bound. */
  readonly bound: PricingWireBound
  /** True when the award index is joined. False means the ladder had almost nothing to read. */
  readonly awardsJoined: boolean
  /** Named, so the page can say why a rung is empty rather than implying the evidence is. */
  readonly awardsUnavailableReason: string | null
  /** Whether the surplus-dealer verdict was readable. A null port is not a "no dealer". */
  readonly classifierJoined: boolean
}

export type PricingBoardUnavailable = {
  readonly ok: false
  readonly reason: string
}

const cache = new Map<string, PricingBoard>()

/**
 * Build the priced board.
 *
 * `clock` is a parameter so a suite can pin the day this is judged against. The pricing instant
 * is read ONCE, here, and handed to every row, because every threshold and band the engine
 * resolves is dated: two reads inside one render would let two halves of one page price the
 * same board against two different instants.
 */
export function buildPricingBoard(clock: Clock = systemClock): PricingBoard | PricingBoardUnavailable {
  const board = buildBoard(clock)
  if (!board.ok) return { ok: false, reason: board.reason }

  const feedDay = board.feedDay
  const cached = cache.get(feedDay)
  if (cached) return cached

  if (board.rows.length === 0) {
    return {
      ok: false,
      reason:
        'The served feed day carries no published requirements, so there is nothing to price. ' +
        'Nothing has been assumed in its place.',
    }
  }

  const idx = buildNsnAwardIndex()
  const awardsJoined = idx.ok === true
  const nowMs = clock.now()
  const asOf = measureFeedFreshness(feedDay, nowMs).measuredOn

  /*
   * A FAILED AWARD INDEX IS PASSED THROUGH AS A NULL LOOKUP, NEVER AS AN EMPTY ONE.
   *
   * Handing the engine an empty peer lookup off an index that did not load would let the
   * weakest rung report "fewer than three priced peers in this supply class", which is a
   * measurement, when the truth is that the class was never read. Those are different
   * sentences and only one of them is true.
   */
  const peers = idx.ok ? peerLookupFrom(buildFscPeerPool(idx.byNsn)) : null
  const classifier = liveClassifierOrNull()

  /*
   * The board's rows already carry their own lifecycle, judged against today by the module
   * that owns that judgement. Nothing is recomputed here: a second implementation of "is this
   * still biddable" is how the two screens disagreed in the first place.
   */
  const wire = board.rows.map((row) => {
    const digits = row.nsn.replace(/[^0-9]/g, '')
    const summary = idx.ok ? idx.byNsn.get(digits) ?? null : null
    const rec = recommendForCorner({
      nsn: row.nsn,
      award: summary,
      requirementQuantity: row.quantity,
      // The MCRL CAGEs off the award index. An empty list stays empty: the engine reads it as
      // a silence, never as a statement that nobody is approved to make the part.
      approvedSourceCages:
        summary?.approvedSources
          .map((s) => s.cage)
          .filter((c): c is string => c !== null && c.trim() !== '') ?? [],
      feedWindow: idx.ok ? idx.window : undefined,
      atInstantMs: nowMs,
      peerLookup: peers,
      classifier,
    })
    return toPricingWireRow(row, rec)
  })

  const board_: PricingBoard = {
    ok: true,
    feedDay,
    asOf,
    bound: boundPricingRowsForWire(wire, PRICING_ROW_BUDGET),
    awardsJoined,
    awardsUnavailableReason: idx.ok ? null : idx.reason,
    classifierJoined: classifier !== null,
  }
  cache.set(feedDay, board_)
  return board_
}
