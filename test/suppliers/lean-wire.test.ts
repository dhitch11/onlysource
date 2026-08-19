/**
 * ★ THE CONTROL FOR A PRIVACY PROPERTY, NOT A PERFORMANCE ONE.
 *
 * `/suppliers` shipped the names, titles, emails, phone numbers and LinkedIn profiles of every
 * contact at 3,471 companies to any signed-in caller, including the `read_only` role, which is
 * defined as every non-sensitive operator permission and therefore deliberately does NOT hold
 * `supplier.identity.view`. The permission existed and was correctly marked sensitive. The read
 * path never asked.
 *
 * The assertion that matters is NOT that the endpoint returns 403 on the happy path. It is that
 * a caller without the permission cannot obtain a contact record BY ANY ROUTE LEFT OPEN, and in
 * particular that the row itself carries no contact field even when nothing renders one.
 */
import { describe, expect, it } from 'vitest'

import { leanBook, toLean, toDetail, type LeanSupplier } from '@/app/(app)/suppliers/wire-lean'
import type { DistressedSupplier } from '@/lib/intelligence/suppliers/distressed'

const supplier = (o: Partial<DistressedSupplier> & { cage: string }): DistressedSupplier => ({
  company: `Co ${o.cage}`, city: 'DAYTON', state: 'OH', url: 'https://example.com',
  phone: '+1 555 0100', email: 'switchboard@example.com',
  executive: 'Jane Executive', executiveTitle: 'CEO',
  executiveLinkedin: 'https://linkedin.com/in/jane', currentlyInBusiness: 'ACTIVE',
  awardsInWindow: 3, lastAwardedAt: '2025-01-01', whyNoAwards: 'prose about awards',
  prospectTier: 'C', prospectScore: 10, prospectRationale: 'prose rationale',
  keyFindings: 'prose findings', uei: 'ABC123', cageStatus: 'Active',
  holdsInventory: 'dealer', samExpiration: '2027-01-01', samStatus: 'Active',
  employees: '50', industry: 'Aerospace', companyLinkedin: 'https://linkedin.com/company/x',
  contacts: [
    { name: 'Alice Buyer', title: 'Director', email: 'alice@example.com', emailType: 'verified', verified: true, linkedin: 'https://linkedin.com/in/alice', phone: '+1 555 0111' },
    { name: 'Bob Seller', title: 'VP', email: 'bob@example.com', emailType: 'verified', verified: true, linkedin: 'https://linkedin.com/in/bob', phone: '+1 555 0222' },
  ],
  ...o,
})

const BOOK = [
  supplier({ cage: 'AAAA1', prospectTier: 'A - hot', prospectScore: 90 }),
  supplier({ cage: 'BBBB2', prospectScore: 50 }),
  supplier({ cage: 'CCCC3', prospectScore: 70, contacts: [] }),
]

/** Every string that must never appear on the wire, taken from the fixtures themselves. */
const SECRETS = [
  'alice@example.com', 'bob@example.com', 'switchboard@example.com',
  '+1 555 0100', '+1 555 0111', '+1 555 0222',
  'Alice Buyer', 'Bob Seller', 'Jane Executive',
  'linkedin.com/in/alice', 'linkedin.com/in/bob', 'linkedin.com/in/jane',
]

describe('★ no contact record crosses the wire, by any route', () => {
  it('the serialised lean book contains none of it', () => {
    const wire = JSON.stringify(leanBook(BOOK))
    for (const secret of SECRETS) {
      expect(wire.includes(secret), `"${secret}" must not be on the wire`).toBe(false)
    }
  })

  /*
   * Matching against the SECRET rather than against a list of field names. A field-name check
   * passes the day someone adds `primaryEmail`, and this estate has already paid for the
   * difference between checking the request and checking the output.
   */
  it('carries no email-shaped or phone-shaped string at all', () => {
    const wire = JSON.stringify(leanBook(BOOK))
    expect(wire).not.toMatch(/[\w.]+@[\w.]+/)
    expect(wire).not.toMatch(/\+\d[\d\s-]{7,}/)
    expect(wire).not.toMatch(/linkedin\.com/)
  })

  it('the lean type carries no contact key even when a value would be null', () => {
    const keys = Object.keys(toLean(BOOK[0]!))
    for (const forbidden of ['contacts', 'email', 'phone', 'executive', 'executiveTitle', 'executiveLinkedin', 'companyLinkedin', 'url', 'prospectRationale', 'keyFindings', 'whyNoAwards']) {
      expect(keys, `lean row must not carry "${forbidden}"`).not.toContain(forbidden)
    }
  })
})

describe('it says people exist without saying who they are', () => {
  it('carries a count and a reachable flag, and nothing identifying', () => {
    const lean = toLean(BOOK[0]!)
    expect(lean.contactCount).toBe(2)
    expect(lean.hasPhone).toBe(true)
    expect(JSON.stringify(lean)).not.toContain('Alice')
  })

  it('a company with nobody on file reads as zero, not as withheld', () => {
    const lean = toLean(BOOK[2]!)
    expect(lean.contactCount).toBe(0)
  })
})

describe('the book is whole, which is the capacity half', () => {
  it('ships every supplier handed in, with nothing dropped', () => {
    const book = leanBook(BOOK)
    expect(book).toHaveLength(BOOK.length)
    expect(new Set(book.map((r) => r.cage))).toEqual(new Set(['AAAA1', 'BBBB2', 'CCCC3']))
  })

  it('orders Tier A first, then the researcher’s score, deterministically', () => {
    const a = leanBook(BOOK).map((r) => r.cage)
    const b = leanBook([...BOOK].reverse()).map((r) => r.cage)
    expect(a).toEqual(b)
    expect(a[0]).toBe('AAAA1')
  })
})

describe('the detail projection carries exactly what the lean row withheld', () => {
  it('holds the contact records', () => {
    const d = toDetail(BOOK[0]!)
    expect(d.contacts).toHaveLength(2)
    expect(d.executive).toBe('Jane Executive')
    expect(d.prospectRationale).toBe('prose rationale')
  })

  it('and the two halves do not overlap on any field but the cage', () => {
    const lean = new Set(Object.keys(toLean(BOOK[0]!)) as (keyof LeanSupplier)[])
    const det = Object.keys(toDetail(BOOK[0]!))
    const both = det.filter((k) => lean.has(k as keyof LeanSupplier))
    expect(both).toEqual(['cage'])
  })
})
