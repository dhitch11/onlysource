/**
 * PARENT CONTRACT OR CHILD ORDER: ONE DEFINITION, FOR EVERY CONSUMER.
 *
 * ==========================================================================================
 * WHY THIS FILE EXISTS
 * ==========================================================================================
 * A delivery order is a CALL against a standing IDIQ contract. The competition happened ONCE,
 * when the parent was awarded, possibly a decade earlier, and every child order inherits the
 * parent's `Offers` value. So `Offers` on a delivery-order row is not a bid count on that
 * award. It is a bid count on a different award, printed on this row.
 *
 * Measured 2026-08-20 and re-measured 2026-08-24 on the same corpus (59,990 raw procurement
 * rows), all four tells reproducing exactly:
 *
 *   solicitation ABSENT + Offers present                           13,299   structurally impossible
 *   rows carrying a Delivery Order, Offers present                 36,690
 *   multi-order groups 839, Offers IDENTICAL across every order       617   73.5%
 *   contracts spanning >=2 NSNs 111, carrying ONE Offers value         48   43.2%
 *   LTC Expiration populated 39,172, every one carrying a Delivery Order  100.0%
 *
 * That last one is the same shape from the other direction: an expiry is a property of the
 * parent VEHICLE, never of a call against it, and its perfect containment proves it.
 *
 * ★ THE TELL NEEDED NO DOMAIN KNOWLEDGE. A bid count on something that was never solicited is
 * impossible, and it was visible in a two-line group-by. The column had already passed a
 * rigorous integrity census (56,637 valid / 0 invalid / 3,353 empty, sentinel 29 discarded).
 * That census asked "is this column clean?" and the answer was genuinely yes. It never asked
 * "what is this column a fact about?"
 *
 * ==========================================================================================
 * THE DISCRIMINATOR, MEASURED TWO INDEPENDENT WAYS THAT AGREE
 * ==========================================================================================
 * 1. THE COLUMN. The Procurement sheet carries a `Delivery Order` cell that this codebase
 *    never parsed. Populated on 21,917 of the 42,698 deduped rows.
 * 2. THE IDENTIFIER. Per FAR 4.1603(a)(3) position 9 of a PIID names the instrument: `D` an
 *    IDIQ, `F` an order under one. Measured cross-tab on the same rows:
 *
 *      Contract No position 9 = D : 21,306 rows, of which 21,302 carry a Delivery Order
 *      Delivery Order position 9 = F : 19,964 of the 21,917 populated cells (the rest are
 *                                      shorter than 9 characters, not contradictory)
 *
 * Two tells, one answer. The COLUMN is primary because it is a direct statement rather than an
 * inference, and position 9 is kept as the cross-check for a row whose column is short or
 * blank. A single tell would have been a guess wearing a citation.
 *
 * ==========================================================================================
 * WHAT THIS MODULE REFUSES TO DO
 * ==========================================================================================
 * It does not estimate a parent award date. Parent IDIQ rows are essentially absent from this
 * corpus (4 rows carry a D-position-9 contract with no delivery order), so the honest answer to
 * "when was the parent awarded" is usually that we do not hold it. The EARLIEST ORDER observed
 * against the parent is a measured lower bound and is offered as exactly that, never as the
 * award date.
 */

/** Position 9 of a PIID, per FAR 4.1603(a)(3). Null when the identifier is too short to have one. */
export function piidPositionNine(identifier: string | null | undefined): string | null {
  const s = (identifier ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  return s.length >= 9 ? (s[8] as string) : null
}

/** FAR 4.1603(a)(3): `D` in position 9 marks an indefinite delivery contract (the parent). */
export const PIID_IDIQ_POSITION_NINE = 'D'
/** FAR 4.1603(a)(3): `F` in position 9 marks an order under an existing contract (the child). */
export const PIID_ORDER_POSITION_NINE = 'F'

export type AwardInstrument =
  /** A call against a standing contract. Its `Offers` belongs to the parent, not to this row. */
  | 'delivery_order'
  /** A contract or standalone buy competed in its own right. Its `Offers` is its own. */
  | 'standalone'
  /**
   * Neither tell answered: no delivery-order cell, and a contract identifier too short or too
   * unusual to read a position 9 from. NOT quietly treated as standalone, because that is the
   * direction that credits an unearned bid count.
   */
  | 'unreadable'

export type InstrumentInput = {
  contractNo: string | null | undefined
  deliveryOrder: string | null | undefined
}

/**
 * Classify one award row. The delivery-order COLUMN is primary; position 9 is the cross-check.
 *
 * ★ THE UNREADABLE CASE FAILS CLOSED, and that is the whole design. If neither tell answers,
 * this returns `unreadable` and the consumer must not credit `Offers`. Falling back to
 * "probably standalone" would reintroduce the defect on exactly the rows we understand least.
 */
export function classifyInstrument(row: InstrumentInput): AwardInstrument {
  const order = (row.deliveryOrder ?? '').trim()
  if (order !== '') return 'delivery_order'

  const nine = piidPositionNine(row.contractNo)
  if (nine === PIID_ORDER_POSITION_NINE) return 'delivery_order'
  /*
   * A D-position-9 contract with NO delivery-order cell is the parent vehicle itself. Measured
   * at 4 rows in this corpus. It is a standalone record of the competition that created the
   * vehicle, so its Offers IS its own and must keep its credit.
   */
  if (nine === PIID_IDIQ_POSITION_NINE) return 'standalone'
  if (nine === null) return 'unreadable'
  return 'standalone'
}

/**
 * May this row's `Offers` be read as the number of bids received ON THIS AWARD?
 *
 * Two conditions, both required, and the second is the one the shipped code never asked:
 *   1. the row must be a standalone award, not a call against a parent vehicle; AND
 *   2. a SOLICITATION must be present, because a bid count on something that was never
 *      solicited is structurally impossible and 13,299 rows carry exactly that.
 */
export function offersDescribeThisAward(
  row: InstrumentInput & { solicitation: string | null | undefined; offers: number | null | undefined },
): boolean {
  if (row.offers == null || row.offers <= 0) return false
  if ((row.solicitation ?? '').trim() === '') return false
  return classifyInstrument(row) === 'standalone'
}
