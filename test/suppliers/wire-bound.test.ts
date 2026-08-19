/**
 * THE SUPPLIERS WIRE BOUND.
 *
 * Two things are being asserted and only one of them is about speed. The other is that ~2,900
 * suppliers' contact records stop crossing the wire on every authorized page load, which is a
 * privacy property and is tested as one.
 */
import { describe, expect, it } from 'vitest'

import {
  SUPPLIER_WIRE_BUDGET_BYTES,
  boundSuppliersForWire,
  isHotSupplier,
  isManufacturer,
} from '@/app/(app)/suppliers/wire-bound'
import type { DistressedSupplier } from '@/lib/intelligence/suppliers/distressed'

const contact = (n: number) => ({
  name: `Person ${n}`,
  title: 'Director of Sales',
  email: `person${n}@example.com`,
  emailType: 'verified',
  verified: true,
  linkedin: `https://linkedin.com/in/person${n}`,
  phone: '+1 555 0100',
})

const supplier = (o: Partial<DistressedSupplier> & { cage: string }): DistressedSupplier => ({
  company: `Co ${o.cage}`, city: null, state: null, url: null, phone: null, email: null,
  executive: null, executiveTitle: null, executiveLinkedin: null, currentlyInBusiness: null,
  awardsInWindow: null, lastAwardedAt: null, whyNoAwards: null, prospectTier: 'C',
  prospectScore: 0, prospectRationale: null, keyFindings: null, uei: null, cageStatus: null,
  holdsInventory: null, samExpiration: null, samStatus: null, employees: null, industry: null,
  companyLinkedin: null, contacts: [], ...o,
})

/** 300 suppliers, each carrying 3 contacts, so the set is comfortably over any small budget. */
const BOOK: DistressedSupplier[] = Array.from({ length: 300 }, (_, i) =>
  supplier({
    cage: String(10000 + i),
    prospectScore: i,
    prospectTier: i >= 290 ? 'A - hot' : 'C',
    holdsInventory: i % 5 === 0 ? 'manufacturer, holds stock' : 'dealer',
    keyFindings: 'x'.repeat(400),
    contacts: [contact(i), contact(i + 1000), contact(i + 2000)],
  }),
)

describe('the bound is measured in bytes, not guessed in rows', () => {
  it('never exceeds the byte budget it was given', () => {
    for (const budget of [5_000, 50_000, 200_000]) {
      const b = boundSuppliersForWire(BOOK, budget)
      expect(b.shippedBytes).toBeLessThanOrEqual(budget)
      expect(b.budgetBytes).toBe(budget)
    }
  })

  it('charges the REAL serialised length of each row, not an average', () => {
    const b = boundSuppliersForWire(BOOK, 60_000)
    const actual = b.shipped.reduce((t, r) => t + JSON.stringify(r).length, 0)
    expect(b.shippedBytes).toBe(actual)
  })

  /* One unusually verbose supplier must not end the list and cost every smaller row behind it. */
  it('skips a row that does not fit and keeps going', () => {
    const withWhale = [
      supplier({ cage: 'WHALE', prospectScore: 999, keyFindings: 'x'.repeat(80_000) }),
      ...BOOK.slice(0, 5),
    ]
    const b = boundSuppliersForWire(withWhale, 20_000)
    expect(b.shipped.map((r) => r.cage)).not.toContain('WHALE')
    expect(b.shipped.length).toBeGreaterThan(0)
  })

  it('gives Tier A first claim, then ranks by the researcher’s score', () => {
    const b = boundSuppliersForWire(BOOK, 40_000)
    const hotInBook = BOOK.filter(isHotSupplier).length
    // Every Tier A row in the book is on the wire before any C row is considered.
    expect(b.shipped.filter(isHotSupplier)).toHaveLength(hotInBook)
    const scores = b.shipped.filter((r) => !isHotSupplier(r)).map((r) => r.prospectScore ?? -1)
    expect([...scores].sort((a, z) => z - a)).toEqual(scores)
  })

  it('is deterministic: the same book bounds to the same suppliers', () => {
    const a = boundSuppliersForWire(BOOK, 40_000).shipped.map((r) => r.cage)
    const z = boundSuppliersForWire([...BOOK].reverse(), 40_000).shipped.map((r) => r.cage)
    expect(a).toEqual(z)
  })
})

describe('the counts stay the book’s counts, never the page’s', () => {
  it('totals are taken over every row handed in, not over what shipped', () => {
    const b = boundSuppliersForWire(BOOK, 40_000)
    expect(b.shipped.length).toBeLessThan(BOOK.length)
    expect(b.totals.all).toBe(300)
    expect(b.totals.hot).toBe(BOOK.filter(isHotSupplier).length)
    expect(b.totals.manufacturer).toBe(BOOK.filter(isManufacturer).length)
  })

  it('an unbounded book ships whole and reports the same totals', () => {
    const b = boundSuppliersForWire(BOOK, 100_000_000)
    expect(b.shipped).toHaveLength(300)
    expect(b.totals.all).toBe(300)
    expect(b.contactsWithheld).toBe(0)
  })
})

describe('★ the privacy property, asserted as one', () => {
  it('withholds the contact records of every supplier that does not ship', () => {
    const b = boundSuppliersForWire(BOOK, 40_000)
    const shipped = new Set(b.shipped.map((r) => r.cage))
    const expected = BOOK.filter((r) => !shipped.has(r.cage)).reduce((t, r) => t + r.contacts.length, 0)
    expect(b.contactsWithheld).toBe(expected)
    expect(b.contactsWithheld).toBeGreaterThan(0)
  })

  it('no contact record of a withheld supplier appears anywhere in what ships', () => {
    const b = boundSuppliersForWire(BOOK, 40_000)
    const shipped = new Set(b.shipped.map((r) => r.cage))
    const withheldEmails = BOOK.filter((r) => !shipped.has(r.cage)).flatMap((r) =>
      r.contacts.map((c) => c.email),
    )
    const wire = JSON.stringify(b.shipped)
    for (const email of withheldEmails.slice(0, 50)) {
      expect(wire.includes(email as string), `${email} must not cross the wire`).toBe(false)
    }
  })
})

describe('the shipped budget is a ceiling a caller states, not a constant callers assume', () => {
  it('defaults to the stated budget and reports it back', () => {
    const b = boundSuppliersForWire(BOOK)
    expect(b.budgetBytes).toBe(SUPPLIER_WIRE_BUDGET_BYTES)
  })
})
