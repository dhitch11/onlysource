/**
 * THE SIZE OF A BUY, AND THE HONEST ADMISSION THAT WE SOMETIMES CANNOT COMPUTE IT.
 *
 * ==========================================================================================
 * THE DEFECT THIS MODULE EXISTS TO END.
 * ==========================================================================================
 * Two surfaces computed the modeled size of a solicitation inline, and both wrote the same
 * line:
 *
 *     const est = price != null && qty != null ? price * qty : price ?? 0
 *
 * The trailing `0` is the whole problem. It is not a size; it is the ABSENCE of a size,
 * spelled with a digit. Everything downstream then treated that absence as a measurement of
 * smallness: both pages sort by this number descending and both cut the list at 60 rows, so a
 * solicitation with no recorded last price sorted below every priced row on the file and was
 * never rendered at all.
 *
 * MEASURED against the real seed workbook (data/seed/NO QUOTES.xlsx, 2026-08-18, read with a
 * stdlib OOXML reader that shares no code with this repo's parser):
 *
 *     839 no-quote solicitations
 *      68 carry a real government quantity and NO recorded last sold price  (8.1%)
 *       0 carry a price with no quantity
 *      61 of those 68 are make-side rows; the make-side list's 60th row by size is $211,500
 *
 * So 68 real buys, every one of them with a real quantity the government published, ranked
 * beneath a $211,500 row at a fabricated zero and fell off the end of a page captioned
 * "sorted by the size of the buy". Nothing on screen was a fabricated number. What was
 * fabricated was the ORDER, and the order decides what an operator ever sees.
 *
 * ==========================================================================================
 * THE SECOND FABRICATION IN THE SAME LINE, LATENT TODAY.
 * ==========================================================================================
 * `: price ?? 0` also means "price with no stated quantity contributes the price alone",
 * which silently asserts a quantity of one. The government did not say one; it said nothing.
 * No row in either workbook takes that branch today (measured: 0 of 839, 0 of 23), so the
 * change is unobservable on the current feed and the reasoning is what matters: a quantity
 * nobody published is not a quantity of one, and a unit price is not a size of buy.
 *
 * ==========================================================================================
 * WHY THE ORDERING IS WHAT IT IS.
 * ==========================================================================================
 * A dealer ranks by money at stake. An unpriced row is not a small buy, it is an UNMEASURED
 * buy, and the two must not be spelled the same way.
 *
 *   - Rows with a computed size come first, largest first. That is the ranking that was
 *     always intended and it is unchanged.
 *   - Rows with no computed size come after, and among themselves they rank by the one
 *     magnitude the government DID publish for them: the solicitation quantity. A 268-unit
 *     buy with no price history is a bigger piece of work than a 1-unit buy with no price
 *     history, and that comparison is measured, not modeled.
 *   - They come after rather than before, because promoting an unmeasured row above a
 *     measured $2M buy is the mirror image of the same lie: it would assert the unknown is
 *     larger. Ranking cannot claim what the file does not say, in either direction.
 *   - A row with neither price nor quantity ranks last, because there is nothing to rank it
 *     by at all.
 *
 * Order alone is not enough. A class that always sorts last is still invisible behind a
 * 60-row cut, so the surfaces render the unknown-size rows as their own labelled block with
 * their own count. Being told "these exist, there are 61 of them, here they are" is the part
 * the zero destroyed.
 */

/**
 * A modeled size of buy, or the stated reason there is not one.
 *
 * The unknown case carries WHICH leg was missing rather than a bare null, because the two
 * absences are different facts for an operator: no recorded price means the government has
 * never bought this at a price we hold, which on a make-side row is itself a signal; no
 * stated quantity means the line did not say how many. A surface that wants to say something
 * true about the gap needs to know which gap it is.
 */
export type SizeOfBuy =
  | { readonly known: true; readonly usd: number }
  | {
      readonly known: false
      readonly reason: 'no_recorded_price' | 'no_stated_quantity' | 'neither_recorded'
    }

/** The operator-facing sentence for each absence. One place, so every surface says the same thing. */
export const SIZE_UNKNOWN_REASON: Record<
  Extract<SizeOfBuy, { known: false }>['reason'],
  string
> = {
  no_recorded_price:
    'the government file carries a quantity for this buy but no last sold price, so its size cannot be computed',
  no_stated_quantity:
    'the government file carries a last sold price for this buy but no quantity, so its size cannot be computed',
  neither_recorded:
    'the government file carries neither a last sold price nor a quantity for this buy, so its size cannot be computed',
}

/** A finite, non-negative number, or null. Guards against a parser handing back NaN or Infinity. */
function usable(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * The modeled size of one buy: the last recorded unit price times the quantity asked for.
 *
 * Returns an explicit unknown whenever either leg is missing. It never substitutes a zero, a
 * one, or a price standing in for a total.
 */
export function sizeOfBuy(lastSoldPrice: number | null, quantity: number | null): SizeOfBuy {
  const price = usable(lastSoldPrice)
  const qty = usable(quantity)
  if (price != null && qty != null) return { known: true, usd: price * qty }
  if (price == null && qty == null) return { known: false, reason: 'neither_recorded' }
  if (price == null) return { known: false, reason: 'no_recorded_price' }
  return { known: false, reason: 'no_stated_quantity' }
}

/** What a row must expose to be ranked. Deliberately structural, so both surfaces qualify as they are. */
export interface Sizable {
  readonly size: SizeOfBuy
  /** The published solicitation quantity, which is what ranks the unknown class. */
  readonly quantity: number | null
}

/**
 * Rank two rows for a list captioned "by the size of the buy".
 *
 * Known sizes descend first; unknown sizes follow, descending by published quantity; rows
 * with no quantity to rank by come last. Stable for equal rows, so the caller's own ordering
 * survives a tie.
 */
export function compareBySizeOfBuy(a: Sizable, b: Sizable): number {
  if (a.size.known && b.size.known) return b.size.usd - a.size.usd
  if (a.size.known) return -1
  if (b.size.known) return 1
  const aq = usable(a.quantity)
  const bq = usable(b.quantity)
  if (aq != null && bq != null) return bq - aq
  if (aq != null) return -1
  if (bq != null) return 1
  return 0
}

/** Split a list into the rows we could size and the rows we could not, each already ranked. */
export function partitionBySizeKnown<T extends Sizable>(
  rows: readonly T[],
): { sized: T[]; unsized: T[] } {
  const ranked = [...rows].sort(compareBySizeOfBuy)
  return {
    sized: ranked.filter((r) => r.size.known),
    unsized: ranked.filter((r) => !r.size.known),
  }
}

/**
 * Add up the sizes we actually have.
 *
 * The count of rows left out travels WITH the total, so a caller cannot render the money
 * without being handed the disclosure. A total that quietly omits rows is the same defect one
 * level up from the zero this module replaced.
 */
export function totalKnownSize(rows: readonly Sizable[]): {
  usd: number
  counted: number
  unsized: number
} {
  let usd = 0
  let counted = 0
  let unsized = 0
  for (const r of rows) {
    if (r.size.known) {
      usd += r.size.usd
      counted += 1
    } else {
      unsized += 1
    }
  }
  return { usd, counted, unsized }
}
