/**
 * H10 / DEFECT 1 — `Offers` is the PARENT contract's bid count, not the row's.
 *
 * The shipped competition signal read `latestOffers` unconditionally and rendered
 * "3 bidders on the last award. Competition is light." on rows where the last award was a call
 * against an IDIQ awarded years earlier. False on every delivery-order row, labelled MEASURED,
 * and false in the FAVOURABLE direction.
 *
 * These tests assert the classifier's truth table and the three cheap provenance tests from
 * `feedback_a_field_inherited_from_a_parent_row_is_not_a_measurement_of_the_child`, run against
 * the REAL corpus rather than a fixture, because a fixture cannot tell you the corpus changed.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyInstrument,
  offersDescribeThisAward,
  piidPositionNine,
  PIID_IDIQ_POSITION_NINE,
  PIID_ORDER_POSITION_NINE,
} from '@/lib/intelligence/awards/parent-child'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'

describe('H10 defect 1: what entity is the Offers column a fact about', () => {
  it('reads position 9 of a PIID per FAR 4.1603(a)(3)', () => {
    expect(piidPositionNine('SPE7MX15D0070')).toBe(PIID_IDIQ_POSITION_NINE)
    expect(piidPositionNine('SPE7M5-26-F-1234')).toBe(PIID_ORDER_POSITION_NINE)
    // Punctuation is stripped before counting, because the export punctuates inconsistently.
    expect(piidPositionNine('SPE7MX-15-D-0070')).toBe(PIID_IDIQ_POSITION_NINE)
    // Too short to HAVE a position 9. Null, never a guess.
    expect(piidPositionNine('SPE7M')).toBeNull()
    expect(piidPositionNine(null)).toBeNull()
    expect(piidPositionNine('')).toBeNull()
  })

  it('classifies on the COLUMN first and position 9 as the cross-check', () => {
    // The column answers: a populated delivery order is a child, whatever the contract looks like.
    expect(classifyInstrument({ contractNo: 'SPE7MX15D0070', deliveryOrder: 'F001' })).toBe('delivery_order')
    // No column, but the contract itself is an order.
    expect(classifyInstrument({ contractNo: 'SPE7M526F1234', deliveryOrder: null })).toBe('delivery_order')
    // The parent vehicle itself: D in position 9, no order against it on this row.
    expect(classifyInstrument({ contractNo: 'SPE7MX15D0070', deliveryOrder: null })).toBe('standalone')
    // An ordinary definitive contract.
    expect(classifyInstrument({ contractNo: 'SPE7M526V1412', deliveryOrder: null })).toBe('standalone')
  })

  it('★ FAILS CLOSED when neither tell answers', () => {
    /*
     * The direction that matters. An unreadable identifier must NOT default to standalone,
     * because standalone is the branch that credits a bid count. A signal you cannot ground is
     * a signal you do not pay.
     */
    expect(classifyInstrument({ contractNo: 'ABC', deliveryOrder: null })).toBe('unreadable')
    expect(classifyInstrument({ contractNo: null, deliveryOrder: null })).toBe('unreadable')
    expect(
      offersDescribeThisAward({ contractNo: null, deliveryOrder: null, solicitation: 'SPE7M5-26-T-3045', offers: 3 }),
    ).toBe(false)
  })

  it('requires BOTH a standalone instrument AND a solicitation before crediting Offers', () => {
    const base = { contractNo: 'SPE7M526V1412', deliveryOrder: null }
    // Both conditions met.
    expect(offersDescribeThisAward({ ...base, solicitation: 'SPE7M5-26-T-3045', offers: 3 })).toBe(true)
    // The impossible-presence case: a bid count with nothing to bid on. 13,299 rows corpus-wide.
    expect(offersDescribeThisAward({ ...base, solicitation: null, offers: 3 })).toBe(false)
    expect(offersDescribeThisAward({ ...base, solicitation: '   ', offers: 3 })).toBe(false)
    // The inherited case.
    expect(
      offersDescribeThisAward({ contractNo: 'SPE7MX15D0070', deliveryOrder: 'F001', solicitation: 'X', offers: 3 }),
    ).toBe(false)
    // No count at all is not a credit either.
    expect(offersDescribeThisAward({ ...base, solicitation: 'X', offers: null })).toBe(false)
    expect(offersDescribeThisAward({ ...base, solicitation: 'X', offers: 0 })).toBe(false)
  })
})

describe('H10 defect 1: the three cheap provenance tests, against the real corpus', () => {
  const ix = buildNsnAwardIndex()

  it('★ IMPOSSIBLE PRESENCE: no scored award credits Offers where no solicitation exists', () => {
    if (!ix.ok) { expect.fail('award index unavailable; this is an absence, not a pass') }
    let impossible = 0
    let credited = 0
    let total = 0
    for (const [, s] of ix.byNsn) {
      for (const a of s.awards) {
        total += 1
        const noSolicitation = (a.solicitation ?? '').trim() === ''
        if (a.offers != null && a.offers > 0 && noSolicitation) impossible += 1
        if (a.offersDescribeThisAward) {
          credited += 1
          // The invariant: nothing credited may lack a solicitation, and nothing credited
          // may be a call against a parent vehicle.
          expect((a.solicitation ?? '').trim()).not.toBe('')
          expect(a.instrument).toBe('standalone')
        }
      }
    }
    // A vacuous pass is the failure mode this estate has shipped repeatedly. Assert the
    // population is non-empty and that the impossible rows genuinely exist, so a zero here
    // means "nothing wrong" rather than "nothing looked".
    expect(total).toBeGreaterThan(10_000)
    expect(impossible).toBeGreaterThan(0)
    expect(credited).toBeGreaterThan(0)
  })

  it('★ SIBLING VARIANCE: an Offers value identical across every order of one parent is the parent\'s', () => {
    if (!ix.ok) { expect.fail('award index unavailable') }
    const groups = new Map<string, Array<{ order: string; offers: number | null }>>()
    for (const [, s] of ix.byNsn) {
      for (const a of s.awards) {
        if (a.instrument !== 'delivery_order') continue
        const k = `${a.contractNo ?? ''}|${a.nsn}`
        const g = groups.get(k) ?? []
        g.push({ order: a.deliveryOrder ?? '', offers: a.offers })
        groups.set(k, g)
      }
    }
    let multi = 0
    let identical = 0
    for (const [, g] of groups) {
      if (new Set(g.map((x) => x.order)).size < 2) continue
      multi += 1
      if (new Set(g.map((x) => x.offers)).size === 1) identical += 1
    }
    expect(multi).toBeGreaterThan(100)
    // Measured 73.5% on the raw corpus 2026-08-20 and again 2026-08-24. If this ever drops
    // toward chance, the column has changed meaning and this fix needs re-deriving.
    expect(identical / multi).toBeGreaterThan(0.5)
    // And the consequence: not one of those inherited values may be credited.
    for (const [, s] of ix.byNsn) {
      for (const a of s.awards) {
        if (a.instrument === 'delivery_order') expect(a.offersDescribeThisAward).toBe(false)
      }
    }
  })

  it('★ ENTITY CROSSING + LTC CONTAINMENT: the parent-field tells still hold', () => {
    if (!ix.ok) { expect.fail('award index unavailable') }
    // An LTC expiry is a property of the parent VEHICLE. Every populated one must sit on a
    // delivery order. Perfect containment measured at 39,172 of 39,172, twice.
    let ltcRows = 0
    let ltcOnOrders = 0
    for (const [, s] of ix.byNsn) {
      for (const a of s.awards) {
        if (!a.ltcExpirationIso) continue
        ltcRows += 1
        if (a.instrument === 'delivery_order') ltcOnOrders += 1
      }
    }
    expect(ltcRows).toBeGreaterThan(1_000)
    expect(ltcOnOrders).toBe(ltcRows)
  })
})
