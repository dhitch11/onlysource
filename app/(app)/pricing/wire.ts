/**
 * WHAT CROSSES THE WIRE TO THE PRICING GRID, AND WHAT IS ONLY COUNTED.
 *
 * ---------------------------------------------------------------------------------------
 * WHY A BOUND EXISTS AT ALL
 * ---------------------------------------------------------------------------------------
 * /pricing is `force-dynamic`, so every visit serialises every row the page hands to its
 * "use client" grid. /monopoly already paid for this lesson once: when its row set widened
 * the RSC flight payload went 0.342MB to 25.98MB, and virtualising the grid does not touch it,
 * because a virtual list still RECEIVES every row it declines to paint. The only thing that
 * shrinks a flight payload is sending fewer rows, and the only honest way to send fewer rows
 * is to say out loud which ones were sent.
 *
 * A `PriceRecommendation` is far heavier than a monopoly row: it carries all five rungs of the
 * ladder, every rung's inputs with their citations, its arithmetic, its caveats and its
 * roadmap. That whole object is the right shape for ONE stock number on the dossier and the
 * wrong shape for a board. So this module defines the SLIM row, and the slim row is the only
 * thing the grid ever sees. The full recommendation stays on the server.
 *
 * ---------------------------------------------------------------------------------------
 * WHY OPEN ROWS GET FIRST CLAIM ON THE BUDGET, AND STRENGTH ORDERS THEM
 * ---------------------------------------------------------------------------------------
 * The page exists so an operator can work the strongest bases first. A closed requirement
 * cannot be worked at any strength, and the board deliberately keeps closed rows rather than
 * dropping them, so they are counted here and they queue behind the open ones. Inside that,
 * rows are ordered by the RUNG, strongest first, because the rung IS the confidence: there is
 * no separate score to sort on and inventing one would be the exact figure this product
 * refuses to print.
 *
 * The tie-break inside a rung is the QUOTED total, largest first, so that among rows standing
 * on identical evidence the biggest requirement is reached first. On a band it is the LOW
 * endpoint, because ranking on the high endpoint would let a wide band outrank a tight one
 * purely by being less certain.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THE TOTALS COME BACK WITH THE SLICE
 * ---------------------------------------------------------------------------------------
 * A bounded board is honest. A silently bounded board is not, and a count taken off the
 * bounded array is a count of the PAGE wearing the BOARD's label. So every count this module
 * returns is taken over every row handed in, never over `shipped`, and the page prints the
 * bound in visible text rather than leaving the reader to infer it from a row count.
 *
 * PURE. No I/O, no clock, no feed. `test/pricing-surface/wire.test.ts` drives it with rows
 * whose right answers were worked out by hand.
 */
import type { RowLifecycle } from '@/lib/intelligence/feed-window'
import {
  RECOMMENDATION_RUNGS,
  type PriceRecommendation,
  type RecommendationRung,
} from '@/lib/intelligence/pricing/recommend'

/**
 * HOW MANY ROWS MAY CROSS THE WIRE.
 *
 * MEASURED by `.probe/pricing-wire.test.mts` over exactly the object this page hands to
 * <PricingGrid>, by `JSON.stringify().length` on the live archive (feed day 2026-08-14,
 * 5,366 served rows), replaying the page's own map:
 *
 *     rows shipped   200      500      800      1,000    1,200    5,366 (all)
 *     payload        0.134MB  0.328MB  0.521MB  0.649MB  0.780MB  3.926MB
 *
 * 1,200 is the choice, at 0.780MB: under half of the 1.70MB /monopoly ships today, and it
 * covers every one of the 1,129 rows standing on something stronger than the peer band
 * (24 + 1,090 + 12 + 3) with 71 rows of headroom.
 *
 * ★ THE FIRST DRAFT OF THIS ROW WAS 3,493 BYTES AND THE SAME BOUND WOULD HAVE COST 4.19MB.
 * It carried the caveat sentences, the roadmap sentences and the engine's own summary sentence
 * on every row: 2,761 bytes of prose per row that a dense grid has no room to print and that
 * the dossier prints properly one click away. Trimming to what the grid actually renders took
 * the unbounded payload from 17.56MB to 3.93MB. Measure the OBJECT, not the row count.
 *
 * IT IS A CONSTANT, NOT A CALIBRATION. Nothing else in this module reads it, and the numbers
 * above are a reading of one archive state: rows are not a fixed size, and the strongest rows
 * ship first while carrying the longest arithmetic strings, so the cost per shipped row sits
 * above the board's mean by construction. Re-measure before moving it.
 */
export const PRICING_ROW_BUDGET = 1200

/** Strongest first. The ladder's own order, so a reorder there cannot silently desync this. */
const RUNG_STRENGTH: Readonly<Record<RecommendationRung, number>> = Object.freeze(
  Object.fromEntries(RECOMMENDATION_RUNGS.map((r, i) => [r, i])) as Record<
    RecommendationRung,
    number
  >,
)

/**
 * The confidence tier, in the operator's language, DERIVED FROM THE RUNG'S POSITION rather
 * than typed out per rung.
 *
 * A hand-written map would be a second list to keep in step with `RECOMMENDATION_RUNGS`, and a
 * hardcoded list is a defect with a delay on it: add a sixth rung and the map silently returns
 * undefined on the newest, weakest basis. Position in the ladder is the only fact this needs.
 */
/**
 * ★★ CONFIDENCE IS NOT DERIVABLE FROM LADDER POSITION, AND DERIVING IT THAT WAY SHIPPED A FALSE
 * CLAIM ON THE MONEY FIELD. Corrected 2026-08-19.
 *
 * This function used to read the rung's INDEX and return a tier from it: index 1 became
 * "strong basis". That is a reasonable-looking abstraction and it is wrong, because **the ladder
 * is ordered by the PROVENANCE of the evidence, not by the measured OUTCOME of using it.** R2
 * sits second because it stands on this item's own last award, which is excellent provenance.
 * Its outcome is not.
 *
 * MEASURED over 6,042,114 ordered award pairs, asking whether the recommendation would have come
 * in at or below the price the item ACTUALLY cleared at next time: the R2 multiple clears 0.5%,
 * and 0.1% with order quantity held fixed. Repeating the previous price unmultiplied clears
 * 92.5%. So 35 rows on the live board were labelled "strong basis" while carrying a figure our
 * own corpus says wins under one time in two hundred.
 *
 * The dossier panel was corrected first and this was missed, which is the estate's own law: a
 * check validated on one implementation lies about the other. Both renderers read THIS function,
 * so the correction lives here and cannot be half-applied again.
 *
 * The position-derived shape was still right for one reason and it is kept for the rungs where
 * position and outcome agree: a hardcoded list per rung is a defect with a delay on it. What may
 * not be derived from position is a claim about how well the basis WORKS.
 */
export function confidenceTier(rung: RecommendationRung): string {
  const i = RUNG_STRENGTH[rung]
  const last = RECOMMENDATION_RUNGS.length - 1
  /*
   * Named explicitly, not by index, because this is an empirical fact about ONE rung rather than
   * a structural fact about its place. If the ladder is reordered this claim must move with the
   * rung it describes, and an index would silently reattach it to whatever landed in slot 1.
   */
  if (rung === 'R2_LAST_AWARD_MULTIPLE') return 'your stated rule, not a measured basis'
  if (i === 0) return 'strongest basis we hold'
  if (i === last) return 'weakest basis we hold'
  if (i === 1) return 'strong basis'
  return 'medium basis'
}

/** A POINT and a BAND share no numeric field name here either. The distinction survives the wire. */
export type WireFigure =
  | { readonly kind: 'POINT'; readonly unitPriceUsd: number }
  | {
      readonly kind: 'BAND'
      readonly lowUnitPriceUsd: number
      readonly highUnitPriceUsd: number
      readonly widthRatio: number
    }

/**
 * WHAT WE WOULD SEND. There is deliberately NO evaluated figure on this type.
 *
 * BD-18: the $200 and $600 are DLA's evaluation factors, added by the buyer when it ranks us.
 * They are not part of the quote and not a cost we pay. On the dossier they are rendered in
 * their own block under their own heading, because that surface has room to say what they are.
 * A dense grid does not, and a column of buyer arithmetic sitting one cell away from a column
 * of our arithmetic is how a $600 ends up typed into DIBBS. So no evaluated number crosses
 * this wire AT ALL, which makes the mistake unavailable rather than merely discouraged.
 */
export type WireQuotedTotal =
  | { readonly kind: 'TOTAL'; readonly usd: number }
  | { readonly kind: 'RANGE'; readonly lowUsd: number; readonly highUsd: number }

export type PricingWireRow = {
  /** The join key: digits only, so the row links to its dossier. */
  readonly digits: string
  /** The stock number as a person reads it. */
  readonly nsn: string
  readonly nomenclature: string
  readonly solicitation: string
  readonly quantity: number | null
  readonly returnDate: string
  readonly lifecycle: RowLifecycle['status']
  readonly soleSource: boolean
  /** Null when the ladder abstained. There is no "0" rung and no placeholder. */
  readonly rung: RecommendationRung | null
  readonly rungLabel: string
  readonly confidence: string | null
  /**
   * THE RUNG'S POSITION ON THE LADDER, 0 STRONGEST, COMPUTED HERE AND SHIPPED.
   *
   * The grid sorts its Basis column on this, and it is a number on the wire rather than a
   * lookup in the browser for a specific reason: the alternative is importing
   * `RECOMMENDATION_RUNGS` into a "use client" component, which drags the whole 2,346-line
   * engine and everything it imports into the client bundle to read a five-item array. It is
   * not a second source of truth either, because it is derived from `RECOMMENDATION_RUNGS`
   * right here, so reordering the ladder reorders this with no edit anywhere.
   *
   * An abstention sorts LAST rather than first, which is why it is the ladder's length and not
   * a null or a minus one.
   */
  readonly strengthRank: number
  /** Null on an abstention. An abstention carries NO numeric field, exactly as the engine's does. */
  readonly figure: WireFigure | null
  readonly quotedTotal: WireQuotedTotal | null
  /** How many observations the winning rung stood on. The peer count on R5. */
  readonly observationCount: number | null
  /** The newest observation the winning rung consumed, so age is visible in the grid. */
  readonly basisDateIso: string | null
  /** The napkin derivation, verbatim and never truncated. Rendered under the figure. */
  readonly arithmetic: string | null
  /** Set only on an abstention, and then it names the input to go and get. */
  readonly missingInput: string | null
  /** True when this figure crosses DLAD 17.7505 and the buy stops being automatic. */
  readonly crossesDladBand: boolean
  /**
   * HOW MANY CAVEATS APPLIED, not the caveats themselves.
   *
   * MEASURED: carrying the caveat sentences, the roadmap sentences and the engine's own summary
   * sentence on every row cost 3,493 bytes a row, and the served set is 5,366 rows, so the
   * unbounded payload was 17.56 MB. They are the DOSSIER's material, where there is room to read
   * them, and one link away. What a board needs is to know that they EXIST, which is a number.
   * The one caveat a grid cannot defer is the DLAD crossing, and that has its own field above
   * because it changes what the operator does next.
   */
  readonly caveatCount: number
}

/** The minimum a board row must expose for this module to slim it. Structural on purpose. */
export type SlimmableBoardRow = {
  readonly nsn: string
  readonly nomenclature: string
  readonly solicitation: string
  readonly quantity: number | null
  readonly returnDate: string
  readonly lifecycle: RowLifecycle
  readonly standing: { readonly kind: string }
}

const digitsOnly = (v: string): string => v.replace(/[^0-9]/g, '')

/** Slim one served row plus its recommendation into the only shape the grid ever receives. */
export function toPricingWireRow(
  row: SlimmableBoardRow,
  rec: PriceRecommendation,
): PricingWireRow {
  const base = {
    digits: digitsOnly(row.nsn),
    nsn: row.nsn,
    nomenclature: row.nomenclature,
    solicitation: row.solicitation,
    quantity: row.quantity,
    returnDate: row.returnDate,
    lifecycle: row.lifecycle.status,
    soleSource: row.standing.kind === 'sole',
  } as const

  if (rec.resolved !== true) {
    return {
      ...base,
      rung: null,
      rungLabel: 'no rung on the ladder reached',
      confidence: null,
      strengthRank: RECOMMENDATION_RUNGS.length,
      figure: null,
      quotedTotal: null,
      observationCount: null,
      basisDateIso: null,
      arithmetic: null,
      missingInput: rec.missingInput,
      crossesDladBand: false,
      caveatCount: 0,
    }
  }

  const won = rec.ladder.find((r) => r.rung === rec.rung)
  const figure: WireFigure =
    rec.recommended.kind === 'POINT'
      ? { kind: 'POINT', unitPriceUsd: rec.recommended.unitPriceUsd }
      : {
          kind: 'BAND',
          lowUnitPriceUsd: rec.recommended.lowUnitPriceUsd,
          highUnitPriceUsd: rec.recommended.highUnitPriceUsd,
          widthRatio: rec.recommended.widthRatio,
        }

  const quoted: WireQuotedTotal | null =
    rec.quotedTotal === null
      ? null
      : rec.quotedTotal.kind === 'QUOTED_TOTAL_WHAT_WE_SEND'
        ? { kind: 'TOTAL', usd: rec.quotedTotal.usd }
        : { kind: 'RANGE', lowUsd: rec.quotedTotal.lowUsd, highUsd: rec.quotedTotal.highUsd }

  return {
    ...base,
    rung: rec.rung,
    rungLabel: rec.rungLabel,
    confidence: confidenceTier(rec.rung),
    strengthRank: RUNG_STRENGTH[rec.rung],
    figure,
    quotedTotal: quoted,
    observationCount: won !== undefined && won.resolved ? won.observationCount : null,
    basisDateIso: won !== undefined && won.resolved ? won.newestObservationIso : null,
    arithmetic: rec.arithmetic,
    missingInput: null,
    crossesDladBand: rec.caveats.some(
      (c) => c.code === 'RECOMMENDATION_CROSSES_THE_DLAD_PRICE_INCREASE_BAND',
    ),
    caveatCount: rec.caveats.length,
  }
}

/** The money a row is ranked on: the low endpoint of a range, the total of a point. */
function rankableTotal(row: PricingWireRow): number {
  const q = row.quotedTotal
  if (q === null) return -1
  return q.kind === 'TOTAL' ? q.usd : q.lowUsd
}

/**
 * Counted over EVERY row handed in, never over `shipped`. These are the BOARD's counts.
 *
 * There is deliberately no money total here. Adding up a recommended quote across every
 * requirement on the board would produce a headline dollar figure for a set of quotes nobody
 * would ever send together, and a sum of hypotheticals reads as revenue. The counts below are
 * facts about the board; a board-wide dollar total would be a number wearing a fact's clothes.
 */
export type PricingTotals = {
  readonly all: number
  readonly open: number
  readonly covered: number
  readonly abstained: number
  readonly points: number
  readonly bands: number
  readonly crossingDlad: number
  /** Every rung, including the ones that served nobody, so a zero is visible rather than absent. */
  readonly byRung: ReadonlyArray<{ readonly rung: RecommendationRung; readonly count: number }>
}

export type PricingWireBound = {
  /** The rows that travel. Never longer than `budget`. */
  readonly shipped: readonly PricingWireRow[]
  readonly totals: PricingTotals
  /** The budget actually applied, so a surface states it rather than restating a constant. */
  readonly budget: number
  /** The ordering, in words, so the page can print the sentence rather than reinvent it. */
  readonly orderedBy: string
}

/**
 * Bound the board for the wire.
 *
 * Deterministic: rows are ordered on facts already computed (lifecycle, rung, quoted total,
 * stock number) with a total order at the end, so two builds of the same archive ship the same
 * rows in the same order. No clock, no randomness, no pricing done here.
 */
export function boundPricingRowsForWire(
  rows: readonly PricingWireRow[],
  budget: number,
): PricingWireBound {
  const ordered = [...rows].sort((a, b) => {
    const aOpen = a.lifecycle === 'open' ? 0 : 1
    const bOpen = b.lifecycle === 'open' ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    const s = a.strengthRank - b.strengthRank
    if (s !== 0) return s
    const m = rankableTotal(b) - rankableTotal(a)
    if (m !== 0) return m
    return a.digits < b.digits ? -1 : a.digits > b.digits ? 1 : 0
  })

  const byRung = RECOMMENDATION_RUNGS.map((rung) => ({
    rung,
    count: rows.filter((r) => r.rung === rung).length,
  }))

  return {
    shipped: ordered.slice(0, Math.max(0, budget)),
    totals: {
      all: rows.length,
      open: rows.filter((r) => r.lifecycle === 'open').length,
      covered: rows.filter((r) => r.rung !== null).length,
      abstained: rows.filter((r) => r.rung === null).length,
      points: rows.filter((r) => r.figure?.kind === 'POINT').length,
      bands: rows.filter((r) => r.figure?.kind === 'BAND').length,
      crossingDlad: rows.filter((r) => r.crossesDladBand).length,
      byRung,
    },
    budget,
    orderedBy:
      'still open first, then by the strength of the basis, then by the size of the quote on ' +
      'that basis',
  }
}
