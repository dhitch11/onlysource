/**
 * WHAT CROSSES THE WIRE TO THE SUPPLIERS GRID, AND WHAT IS ONLY COUNTED.
 *
 * ---------------------------------------------------------------------------------------
 * THE MEASUREMENT THIS EXISTS FOR
 * ---------------------------------------------------------------------------------------
 * MEASURED on production 2026-08-19, signed in, over the served HTML:
 *
 *     /suppliers            8,027,937 bytes total
 *     RSC flight payload    6,223,236 bytes  (77.5% of the page)
 *     suppliers serialised  3,471
 *     rows actually painted 544
 *     contact records       9,748  (2.8 per supplier, 248 bytes each)
 *                           ~2,417,504 bytes, THIRTY-NINE PERCENT of the flight payload
 *
 * The grid is virtualised, so 544 rows are painted. `@tanstack/react-virtual` bounds what is
 * PAINTED and nothing else: every one of the 3,471 rows still crosses the wire as a prop. This
 * is the opposite shape to /monopoly's, which bounds rows and paints them all. Here the window
 * is bounded and the payload is not.
 *
 * ---------------------------------------------------------------------------------------
 * ★ THE PAYLOAD IS THE SMALLER HALF. THE OTHER HALF IS THAT THESE ARE REAL PEOPLE.
 * ---------------------------------------------------------------------------------------
 * A `SupplierContact` is a name, a title, an email, a phone number and a LinkedIn profile.
 * **9,748 of them ship to the browser on every authorized page load, and about 2,900 suppliers'
 * worth are never displayed at all** — they exist in the payload because the array was passed
 * whole, not because anyone asked to see them.
 *
 * The page's own truth strip already says it: *"This page holds real people's contact details,
 * so it lives behind the gate and is never public."* That is true and it is not the whole
 * obligation. Behind a gate is not the same as need-to-know, and the smallest honest version of
 * this screen does not put nine thousand people's phone numbers in a browser to render 544 rows.
 *
 * So the performance fix and the privacy fix are ONE fix, and that is why this bounds rather
 * than compresses. Sending fewer rows is the only thing that shrinks a flight payload, and it
 * is also the only thing that stops shipping contact details nobody opened.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THE BUDGET IS IN BYTES AND NOT IN ROWS
 * ---------------------------------------------------------------------------------------
 * /monopoly's `wire-bound.ts` bounds ROWS, and that was right for a corner map. It is wrong
 * here, and the reason is visible in this very file's numbers: rows are not a fixed size. A
 * supplier carries `keyFindings`, `prospectRationale` and `whyNoAwards` (653,823 + 454,712 +
 * 228,721 bytes across the set) plus a contact array of unpredictable length. The rows that
 * ship first are the highest-scoring ones, and those are exactly the ones the researcher wrote
 * the most about, so **cost per row is above the set's mean by construction.**
 *
 * A row budget therefore drifts in bytes while nobody changes it, which is the same slow climb
 * that took /pricing from 1.55MB to 5.45MB across a handful of promotes without ever tripping
 * a 1.5x regression guard. **State the byte ceiling, and let the row count fall out of a
 * measurement taken on the actual objects being sent.** Nothing here is assumed: every row is
 * serialised and its real length is charged against the budget.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THE TOTALS COME BACK WITH THE SLICE
 * ---------------------------------------------------------------------------------------
 * A bounded list is honest. A silently bounded list is not. Every count the grid prints about
 * the BOOK has to be counted over the whole set, so `totals` is returned from here rather than
 * derived downstream from `shipped`. A tab reading "Tier A · hot 41" counted off a bounded
 * array is a count of the page wearing the book's label. The page's own headline stats already
 * come from the full index and are unaffected.
 */
import type { DistressedSupplier } from '@/lib/intelligence/suppliers/distressed'

/**
 * HOW MANY BYTES OF SUPPLIER MAY CROSS THE WIRE.
 *
 * MEASURED, not chosen: the served payload is 1,793 bytes per supplier across the whole set
 * (6,223,236 / 3,471), and the highest-scoring rows run above that mean. 1.5MB therefore buys
 * roughly 700 to 800 suppliers, against 544 the virtualiser can paint before a human scrolls
 * and every Tier A row in the book.
 *
 * It is a CEILING, not a calibration. Nothing else reads it, and moving it wants a fresh
 * measurement rather than a guess, because the researcher's prose is the largest variable field
 * on the row and it grows whenever the book is re-researched.
 */
export const SUPPLIER_WIRE_BUDGET_BYTES = 1_500_000

/** Tier A is the researcher's own judgement, carried through unchanged, never recomputed here. */
export const isHotSupplier = (r: DistressedSupplier): boolean =>
  /hot|^a/i.test(r.prospectTier ?? '')

export const isManufacturer = (r: DistressedSupplier): boolean =>
  /manufact/i.test(r.holdsInventory ?? '')

export type SupplierWireBound = {
  /** The suppliers that travel, highest prospect score first. Charged against the budget. */
  readonly shipped: DistressedSupplier[]
  /** Counted over EVERY supplier handed in, never over `shipped`. These are the book's counts. */
  readonly totals: { readonly all: number; readonly hot: number; readonly manufacturer: number }
  /** What the bound actually cost and allowed, so a surface can state it rather than a constant. */
  readonly budgetBytes: number
  readonly shippedBytes: number
  /**
   * Contact records held back. Named because it is the privacy number, not a performance one,
   * and a surface that shows fewer people should be able to say how many it withheld.
   */
  readonly contactsWithheld: number
}

/**
 * Bound the book for the wire, by measured bytes.
 *
 * Deterministic: sorted by prospect score descending with Tier A taking first claim, and a
 * stable sort, so two renders of the same book send the same suppliers. No clock, no
 * randomness, and no scoring done here — the score is the researcher's and is carried.
 *
 * A row that does not fit is SKIPPED, not truncated, and the walk continues: one unusually
 * verbose supplier must not end the list early and silently cost every smaller row behind it.
 */
export function boundSuppliersForWire(
  rows: readonly DistressedSupplier[],
  budgetBytes: number = SUPPLIER_WIRE_BUDGET_BYTES,
): SupplierWireBound {
  const score = (r: DistressedSupplier): number => r.prospectScore ?? -1
  const ranked = [...rows].sort((a, b) => {
    const hot = Number(isHotSupplier(b)) - Number(isHotSupplier(a))
    return hot !== 0 ? hot : score(b) - score(a)
  })

  const shipped: DistressedSupplier[] = []
  let spent = 0
  for (const r of ranked) {
    // The REAL length of the object being sent, not an estimate from a sample row.
    const cost = JSON.stringify(r).length
    if (spent + cost > budgetBytes) continue
    shipped.push(r)
    spent += cost
  }

  const shippedCages = new Set(shipped.map((r) => r.cage))
  let contactsWithheld = 0
  for (const r of rows) if (!shippedCages.has(r.cage)) contactsWithheld += r.contacts.length

  return {
    shipped,
    totals: {
      all: rows.length,
      hot: rows.filter(isHotSupplier).length,
      manufacturer: rows.filter(isManufacturer).length,
    },
    budgetBytes,
    shippedBytes: spent,
    contactsWithheld,
  }
}
