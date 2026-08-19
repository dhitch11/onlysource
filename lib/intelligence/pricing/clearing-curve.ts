/**
 * WHAT QUOTING HIGHER ACTUALLY COSTS YOU, MEASURED.
 *
 * =========================================================================================
 * WHY THIS EXISTS, AND WHY IT REPLACES A RECOMMENDED MULTIPLE RATHER THAN TUNING ONE
 * =========================================================================================
 * The product used to multiply the previous award price by 3 and call the result a
 * recommendation. That came from one customer anecdote. Measured against real outcomes it clears
 * 0.00% of the time once each stock number votes once, so it was refuted and removed as a default.
 *
 * The obvious next move is to find the multiple that maximises expected value and ship THAT. It
 * was computed, and it must NOT be shipped: the expected-value maximum lands at the BOTTOM of the
 * search space, because this product holds no cost of goods anywhere, and a revenue model with no
 * cost floor always says "bid lower". A maximum on the boundary of the grid is not an answer, it
 * is a symptom. Replacing a number derived from one anecdote with a number derived from a model
 * that cannot represent losing money would be the same defect wearing better arithmetic.
 *
 * ★ THE ONE INPUT THAT DECIDES THE ANSWER IS THE ONE INPUT WE DO NOT HOLD. Only the operator
 * knows their cost. So the product stops guessing and hands them the trade-off instead: here is
 * what the market cleared at, and here is what each step above it costs you in the chance of
 * clearing at all. They own the decision because they own the missing input.
 *
 * =========================================================================================
 * WHAT IS MEASURED, EXACTLY
 * =========================================================================================
 * For every ordered pair of priced awards on the SAME stock number (earlier -> later), the later
 * award's unit price is what the item ACTUALLY cleared at. That price beat everyone, so it is an
 * OUTCOME rather than a model. For a multiple m, the pair "clears" when m x earlier <= actual.
 *
 * ★★★ A PAIR MUST BE TWO BIDDING EVENTS, NOT ONE CONTRACT COUNTED TWICE. MEASURED 2026-08-19:
 * 4,142,708 of the 6,042,114 ordered pairs in this corpus, 68.6%, carry the SAME CONTRACT NUMBER
 * on both sides. A DIBBS contract can hold several award lines for one stock number, and pairing
 * those compares a contract against ITSELF: it is not a second chance to win at a different price.
 * 2,026,310 pairs sit at a ratio of exactly 1.000 and 84.8% of THOSE are same-contract.
 *
 * Left in, they inflate every clearing rate at and below 1x, because a contract always matches its
 * own price. Excluding them takes P(clear at 1x) from about 80% to the low sixties. The first
 * version of this module shipped WITH them and overstated the operator's chances on the one screen
 * where that matters.
 *
 * ★★ EACH STOCK NUMBER VOTES ONCE, AND THIS IS NOT A REFINEMENT, IT CHANGES THE ANSWER. An item
 * with N priced awards contributes N(N-1)/2 pairs, so pooling weights by n squared. MEASURED on
 * this corpus: one stock number (1,917 priced awards) carries 30.4% of all 6,042,114 pairs and ten
 * carry 73.3%. Pooled, 3x clears 0.5%; with each item voting once it clears 0.00%. A pooled curve
 * is the curve for one part.
 *
 * =========================================================================================
 * TWO LIMITS THAT TRAVEL WITH EVERY NUMBER THIS MODULE RETURNS
 * =========================================================================================
 * 1. CLEARING IS NECESSARY BUT NOT SUFFICIENT TO WIN. Being at or below the price that won says
 *    nothing about being the LOWEST responsive offer, so every probability here is an UPPER bound
 *    on the chance of winning. It is carried on the type, not in a comment, so a surface cannot
 *    render it as a win rate by accident.
 * 2. IT IS A MARKET-WIDE READING, NOT THIS ITEM'S. Most stock numbers do not have enough of their
 *    own award history to answer this alone. Where a supply class has a real pool the curve is
 *    computed for it and says so; otherwise the market curve is returned and says THAT.
 *
 * PURE. No I/O, no clock, no randomness. The award index is passed in.
 */
import type { NsnAwardSummary } from '@/lib/intelligence/awards/nsn-now'
import { fscOf } from './recommend'

/** The multiples the curve is reported at. Chosen to bracket the whole live bidding space. */
export const CURVE_MULTIPLES: readonly number[] = Object.freeze([
  1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 2.0, 3.0,
])

/**
 * How many stock numbers a pool needs before its curve is reported instead of the market's.
 *
 * THIRTY, and the number is doing real work rather than decorating. Below it a "supply class
 * curve" is a handful of items wearing the authority of a measurement, which is precisely the
 * failure this module exists to stop.
 */
export const CURVE_NSN_FLOOR = 30

export type ClearingPoint = {
  readonly multiple: number
  /**
   * Median across stock numbers of the share of that item's pairs which cleared at this multiple.
   * NAMED `upperBoundOnWinning` and not `winRate` on purpose: clearing is necessary and not
   * sufficient, and a field called `winRate` would be read as one.
   */
  readonly upperBoundOnWinning: number
  /**
   * ★ A CENSUS, NOT A MEDIAN, AND THE REASON THIS FIELD EXISTS.
   *
   * How many stock numbers in the pool were observed clearing at this multiple AT LEAST ONCE.
   * `upperBoundOnWinning` above is a MEDIAN, and a median of exactly 0 means only that fewer
   * than half the stock numbers ever cleared here — it does not mean none did. The interface was
   * reading that zero as "never" and printing "nothing above it was ever observed clearing at
   * all". Measured on the live index (2,019 stock numbers with priced pairs): at 2x the median is
   * 0.0000 while **662 stock numbers (32.8%) were observed clearing**, and at 3x the median is
   * 0.0000 while **363 (18.0%) were**. The claim was false for every one of them, on 4,646 of
   * 4,800 corner dossiers.
   *
   * Only this count may license the word "never". A median may not.
   */
  readonly stockNumbersObservedClearing: number
  /** The denominator for the count above, so a share can be stated without recomputing. */
  readonly stockNumbersInPool: number
}

export type ClearingCurve =
  | {
      readonly available: true
      /** 'FSC' when this supply class had its own pool; 'MARKET' when it fell back. */
      readonly basis: 'FSC' | 'MARKET'
      readonly fsc: string | null
      /** Stock numbers behind the curve. The sample size, always rendered beside the curve. */
      readonly stockNumberCount: number
      readonly points: readonly ClearingPoint[]
      /**
       * The highest reported multiple at which ANY clearing was still observed. Above it the
       * corpus records none, which is the most actionable single number here.
       */
      readonly ceilingMultiple: number | null
      readonly note: string
    }
  | {
      readonly available: false
      readonly reason: 'NO_PRICED_AWARD_PAIRS_ANYWHERE'
      readonly missingInput: string
      /** No numeric field on this arm: an unavailable curve cannot be read as a curve of zeroes. */
      readonly note: string
    }

export type PerNsn = { fsc: string | null; shares: number[] }

const median = (xs: readonly number[]): number => {
  const a = [...xs].sort((x, y) => x - y)
  return a.length === 0 ? 0 : (a[Math.floor(a.length / 2)] as number)
}

/**
 * Reduce the award index to one curve per stock number. Built once and reused; the shape is a
 * pure function of the index, so callers cache it on the index itself.
 */
const clearingCache = new WeakMap<ReadonlyMap<string, NsnAwardSummary>, PerNsn[]>()

export function buildPerNsnClearing(byNsn: ReadonlyMap<string, NsnAwardSummary>): PerNsn[] {
  /*
   * CACHED ON THE INDEX MAP ITSELF, for the same measured reason the peer pool is: this walks
   * every priced award pair on every stock number, and the corner page renders one row while the
   * desk renders hundreds. A WeakMap keyed on the index is the correct key rather than a feed day
   * string, because the curve is a pure function of that map: a rebuilt index is a different
   * object and misses the cache automatically, and nothing is held alive after the index is
   * released. A day-keyed cache would keep serving a curve derived from an index that has since
   * been reloaded.
   */
  const hit = clearingCache.get(byNsn)
  if (hit) return hit

  const out: PerNsn[] = []
  for (const [, s] of byNsn) {
    const priced = s.awards
      .filter(
        (a) =>
          a.awardDateIso != null &&
          a.effectiveUnitPrice != null &&
          Number.isFinite(a.effectiveUnitPrice) &&
          (a.effectiveUnitPrice as number) > 0,
      )
      .sort((a, b) => (a.awardDateIso ?? '').localeCompare(b.awardDateIso ?? ''))
    // One award cannot produce a pair, so it says nothing about clearing and is not a zero.
    if (priced.length < 2) continue
    const clears = CURVE_MULTIPLES.map(() => 0)
    let pairs = 0
    for (let i = 0; i < priced.length; i++) {
      for (let j = i + 1; j < priced.length; j++) {
        /*
         * SAME CONTRACT ON BOTH SIDES IS NOT A PAIR. A row with NO contract number is also
         * skipped rather than treated as distinct: an unknown identifier cannot establish that
         * two lines came from different awards, and reading the silence as "different" is the
         * permissive direction on the number an operator bids against.
         */
        const ca = priced[i]!.contractNo
        const cb = priced[j]!.contractNo
        if (ca == null || cb == null || ca === cb) continue
        const prev = priced[i]!.effectiveUnitPrice as number
        const actual = priced[j]!.effectiveUnitPrice as number
        pairs++
        for (let k = 0; k < CURVE_MULTIPLES.length; k++) {
          if (prev * (CURVE_MULTIPLES[k] as number) <= actual) clears[k] = (clears[k] as number) + 1
        }
      }
    }
    // Every surviving pair was two distinct contracts. A stock number whose whole history is one
    // contract contributes nothing rather than contributing a row of certainties.
    if (pairs === 0) continue
    out.push({ fsc: fscOf(s.nsn), shares: clears.map((c) => c / pairs) })
  }
  clearingCache.set(byNsn, out)
  return out
}

/**
 * The curve for one supply class, falling back to the market when the class is too thin.
 *
 * THE FALLBACK IS NAMED IN THE RETURN VALUE rather than performed silently. An operator reading a
 * class-specific curve makes a different decision from one reading a market-wide curve, and a
 * fallback that does not announce itself turns the second into the first.
 */
export function clearingCurve(perNsn: readonly PerNsn[], fsc: string | null): ClearingCurve {
  if (perNsn.length === 0) {
    return {
      available: false,
      reason: 'NO_PRICED_AWARD_PAIRS_ANYWHERE',
      missingInput: 'at least one stock number with two or more priced awards',
      note:
        'No stock number in the award history carries two priced awards, so nothing here has ' +
        'ever been observed clearing at any price. This is a gap in what we have pulled, not a ' +
        'finding about the market.',
    }
  }
  const inClass = fsc === null ? [] : perNsn.filter((r) => r.fsc === fsc)
  const useClass = inClass.length >= CURVE_NSN_FLOOR
  const pool = useClass ? inClass : perNsn

  const points: ClearingPoint[] = CURVE_MULTIPLES.map((multiple, k) => ({
    multiple,
    upperBoundOnWinning: median(pool.map((r) => r.shares[k] as number)),
    stockNumbersObservedClearing: pool.filter((r) => (r.shares[k] ?? 0) > 0).length,
    stockNumbersInPool: pool.length,
  }))
  /*
   * ★ THE CEILING IS A CENSUS QUESTION AND WAS BEING ANSWERED WITH A MEDIAN. Deriving it from
   * `upperBoundOnWinning > 0` declares a ceiling as soon as fewer than half the stock numbers
   * clear, and the interface then prints that nothing above it EVER cleared. Measured, 662 stock
   * numbers cleared above the ceiling this test produced. The ceiling is now the highest multiple
   * at which anything at all was observed clearing, which is what the sentence claims.
   */
  const cleared = points.filter((p) => p.stockNumbersObservedClearing > 0)
  const ceilingMultiple = cleared.length > 0 ? (cleared[cleared.length - 1] as ClearingPoint).multiple : null

  return {
    available: true,
    basis: useClass ? 'FSC' : 'MARKET',
    fsc: useClass ? fsc : null,
    stockNumberCount: pool.length,
    points,
    ceilingMultiple,
    note: useClass
      ? `Measured across ${pool.length.toLocaleString()} stock numbers in supply class ${fsc}, ` +
        'each counted once however many awards it carries.'
      : `Supply class ${fsc ?? 'unknown'} does not hold ${CURVE_NSN_FLOOR} stock numbers with ` +
        `priced award pairs, so this is the market-wide reading across ` +
        `${pool.length.toLocaleString()} stock numbers rather than this class's own.`,
  }
}
