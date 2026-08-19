/**
 * THE PURSUIT PACKAGE: engine-assembled, model-forbidden.
 *
 * The package is the single grounding object for the flagship deliverable, so what this file
 * pins is its honesty properties:
 *
 *   - ECONOMICS WITH THEIR BASIS: modeled value = quantity x last award unit price, computed
 *     here and stated in words; either leg missing means null WITH the reason, never a guess.
 *   - THE SUPPLIER JOINS: holders / approved sources / past awardees joined to the book by
 *     CAGE; a missing CAGE is an honest "no contact on file" gap, named.
 *   - THE GAPS ARE NAMED, including listed-not-confirmed and the missing Documents packet.
 *   - THE GROUNDING GUARD ACCEPTS the package's own numbers and STRIPS invented ones, so the
 *     memo cannot carry a figure the package does not.
 */

import { describe, expect, it } from 'vitest'
import type { CornerRow } from '@/lib/intelligence/corner'
import type { AwardRecord, NsnAwardSummary } from '@/lib/intelligence/awards/nsn-now'
import { rollUpSurplus } from '@/lib/intelligence/awards/surplus'
import type { DistressedSupplier } from '@/lib/intelligence/suppliers/distressed'
import { buildCornerDossier } from '@/lib/intelligence/brief/dossier'
import { buildPursuitPackage, packageMarkdown } from '@/lib/intelligence/brief/package'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { groundBrief } from '@/lib/ai/grounding'

const row = (over: Partial<CornerRow> = {}): CornerRow => ({
  niin: '017053574',
  nsn: '5325017053574',
  nomenclature: 'BUSHING, SLEEVE',
  quantity: 213,
  unitOfIssue: 'EA',
  solicitation: 'SPE4A626T15HA',
  returnDate: '08/19/26',
  automatedSolicitation: true,
  approvedSources: ['1SR57'],
  approvedSourceCount: 1,
  soleSource: true,
  signals: [{ kind: 'award_silent', cage: '1SR57', measurement: 'no prime award in two years' }],
  silentSourceCount: 1,
  availability: 'unknown_credential_absent',
  availabilityHolders: null,
  availabilityUnits: null,
  legsEstablished: 2,
  gaps: [],
  ...over,
})

const award = (over: Partial<AwardRecord> & { contractNo: string }): AwardRecord => ({
  nsn: '5325017053574',
  awardDateIso: null,
  quantity: null,
  unitPrice: null,
  company: 'TRIMAN INDUSTRIES',
  cage: '0ZBE8',
  finalPrice: null,
  effectiveUnitPrice: null,
  amc: null,
  amsc: null,
  offers: null,
  deliveryDays: null,
  setAside: null,
  firstArticle: null,
  ltcExpirationIso: null,
  surplus: null,
  solicitation: null,
  closeDateIso: null,
  ...over,
})

const summary = (over: Partial<NsnAwardSummary> = {}): NsnAwardSummary => {
  const latest = award({
    contractNo: 'C2',
    awardDateIso: '2021-11-09',
    quantity: 100,
    unitPrice: 65.55,
    finalPrice: 6555,
    effectiveUnitPrice: 65.55,
  })
  const awards = [
    award({ contractNo: 'C1', awardDateIso: '2016-02-01', quantity: 50, unitPrice: 41.1, finalPrice: 2055, effectiveUnitPrice: 41.1 }),
    latest,
  ]
  return {
    nsn: '5325017053574',
    awards,
    latest,
    distinctAwardees: 1,
    firstUnitPrice: 41.1,
    lastUnitPrice: 65.55,
    priceScaleSuspect: null,
    holders: [{ nsn: '5325017053574', company: 'DMS AIRCRAFT SERVICES', cage: '1YYB4', quantity: 400 }],
    amc: null,
    amsc: null,
    latestOffers: null,
    minOffers: null,
    latestDeliveryDays: null,
    longestDemandGapYears: 5.8,
    yearsSinceLastAward: 4.2,
    approvedSources: [
      {
        nsn: '5325017053574',
        company: 'PRECISION APPROVED CO',
        cage: '1SR57',
        partNumber: 'PA-100',
        amc: null,
        amsc: null,
        prints: null,
        rncc: null,
        rnvc: null,
        assignDateIso: null,
        munitions: null,
      },
    ],
    ltcExpirationIso: null,
    // Derived from this fixture's own awards, never hand-written, so the rollup and the rows it
    // claims to summarise cannot disagree.
    surplus: rollUpSurplus(awards),
    ...over,
  }
}

const bookSupplier = (over: Partial<DistressedSupplier> = {}): DistressedSupplier => ({
  cage: '1YYB4',
  company: 'DMS AIRCRAFT SERVICES',
  city: 'Tulsa',
  state: 'OK',
  url: null,
  phone: '918-555-0101',
  email: null,
  executive: null,
  executiveTitle: null,
  executiveLinkedin: null,
  currentlyInBusiness: null,
  awardsInWindow: 0,
  lastAwardedAt: '2021-11-09',
  whyNoAwards: 'Federal entity code retired, merged or re-issued',
  prospectTier: 'A - Hot',
  prospectScore: 92,
  prospectRationale: null,
  keyFindings: null,
  uei: null,
  cageStatus: null,
  holdsInventory: 'U.S./Canada Manufacturer',
  samExpiration: null,
  samStatus: null,
  employees: null,
  industry: null,
  companyLinkedin: null,
  contacts: [
    { name: 'Rita Vaughn', title: 'Owner', email: 'rita@dmsaircraft.example', emailType: null, verified: true, linkedin: null, phone: null },
  ],
  ...over,
})

function build(opts: {
  rowOver?: Partial<CornerRow>
  award?: NsnAwardSummary | null
  byCage?: Map<string, DistressedSupplier> | null
  savedPacketCount?: number
  mayReadIdentities?: boolean
}) {
  const r = row(opts.rowOver)
  const a = opts.award === undefined ? summary() : opts.award
  const dossier = buildCornerDossier(r, a, null, scoreCorner(r, a, null))
  return buildPursuitPackage({
    row: r,
    dossier,
    award: a,
    byCage: opts.byCage === undefined ? new Map([['1YYB4', bookSupplier()]]) : opts.byCage,
    savedPacketCount: opts.savedPacketCount ?? 0,
    mayReadIdentities: opts.mayReadIdentities ?? true,
  })
}

describe('economics: the modeled value carries its basis, or a stated reason for its absence', () => {
  it('computes quantity x last award unit price and writes the arithmetic into the basis', () => {
    const pkg = build({})
    expect(pkg.economics.modeledBuyValueUsd).toBe(13962.15) // 213 x 65.55
    expect(pkg.economics.basis).toContain('13,962.15')
    expect(pkg.economics.basis).toContain('213')
    expect(pkg.economics.basis).toContain('65.55')
    expect(pkg.economics.basis).toContain('not a quote')
    expect(pkg.economics.lastAwardDateIso).toBe('2021-11-09')
  })

  it('REFUSES to model with a missing quantity: null value, reason stated, nothing estimated', () => {
    const pkg = build({ rowOver: { quantity: null } })
    expect(pkg.economics.modeledBuyValueUsd).toBeNull()
    expect(pkg.economics.basis).toContain('quantity is not on record')
  })

  it('REFUSES to model with no award history: null value, reason stated', () => {
    const pkg = build({ award: null })
    expect(pkg.economics.modeledBuyValueUsd).toBeNull()
    expect(pkg.economics.basis).toContain('no award unit price is on record')
  })
})

describe('the supplier joins: holders, approved sources and past awardees, honest about reach', () => {
  it('joins a listed holder to the book by CAGE and resolves the person the address belongs to', () => {
    const pkg = build({})
    expect(pkg.suppliers.holders).toHaveLength(1)
    const h = pkg.suppliers.holders[0]!
    expect(h.cage).toBe('1YYB4')
    expect(h.quantityListed).toBe(400)
    expect(h.inBook?.person).toBe('Rita Vaughn')
    expect(h.inBook?.email).toBe('rita@dmsaircraft.example')
    expect(h.inBook?.prospectTier).toBe('A - Hot')
  })

  it('names past awardees distinctly with their latest award date', () => {
    const pkg = build({})
    expect(pkg.suppliers.pastAwardees).toEqual([
      expect.objectContaining({ cage: '0ZBE8', company: 'TRIMAN INDUSTRIES', lastAwardDateIso: '2021-11-09' }),
    ])
  })

  it('a CAGE the book does not carry is a NAMED gap, not a silent absence', () => {
    const pkg = build({})
    // 1SR57 (approved source) and 0ZBE8 (past awardee) are not in the book fixture.
    expect(pkg.gaps.some((g) => g.includes('No contact channel on file for CAGE 1SR57'))).toBe(true)
    expect(pkg.gaps.some((g) => g.includes('No contact channel on file for CAGE 0ZBE8'))).toBe(true)
    expect(pkg.suppliers.contactChannelsOnFile).toBe(1)
  })

  it('with NO book on disk every join is null and the counts say zero, never invented', () => {
    const pkg = build({ byCage: null })
    expect(pkg.suppliers.holders[0]?.inBook).toBeNull()
    expect(pkg.suppliers.contactChannelsOnFile).toBe(0)
  })

  it('contactChannelsOnFile counts DISTINCT companies, never rows: one CAGE on three rows is ONE supplier to reach', () => {
    // The live RIM defect (2026-08-17): a contactable CAGE on two approved-source part rows
    // read as "reach the two suppliers with a contact channel" when one reachable company
    // existed. Here 1YYB4 is the holder AND holds two approved-source part-number rows.
    const pkg = build({
      award: summary({
        approvedSources: [
          { nsn: '5325017053574', company: 'DMS AIRCRAFT SERVICES', cage: '1YYB4', partNumber: 'PA-100', amc: null, amsc: null, prints: null, rncc: null, rnvc: null, assignDateIso: null, munitions: null },
          { nsn: '5325017053574', company: 'DMS AIRCRAFT SERVICES', cage: '1YYB4', partNumber: 'PA-200', amc: null, amsc: null, prints: null, rncc: null, rnvc: null, assignDateIso: null, munitions: null },
        ],
      }),
    })
    expect(pkg.suppliers.contactChannelsOnFile).toBe(1)
    expect(pkg.nextSteps[0]).toContain('(1 with a contact channel on file)')
  })
})

describe('the dossier reconciles the approved-source counters itself', () => {
  it('rows versus distinct CAGEs is resolved in the dossier, with the one-side CAGEs named', () => {
    const pkg = build({
      award: summary({
        approvedSources: [
          { nsn: '5325017053574', company: 'PRECISION APPROVED CO', cage: '1SR57', partNumber: 'PA-100', amc: null, amsc: null, prints: null, rncc: null, rnvc: null, assignDateIso: null, munitions: null },
          { nsn: '5325017053574', company: 'PRECISION APPROVED CO', cage: '1SR57', partNumber: 'PA-200', amc: null, amsc: null, prints: null, rncc: null, rnvc: null, assignDateIso: null, munitions: null },
          { nsn: '5325017053574', company: 'NCB FINLAND', cage: 'A486G', partNumber: 'NCB-1', amc: null, amsc: null, prints: null, rncc: null, rnvc: null, assignDateIso: null, munitions: null },
        ],
      }),
    })
    const xr = pkg.dossier.source.crossReference
    expect(xr).not.toBeNull()
    expect(xr!.rows).toBe(3)
    expect(xr!.distinctCages).toBe(2)
    expect(xr!.cagesOnlyInCrossReference).toEqual(['A486G'])
    expect(xr!.cagesOnlyInSourceList).toEqual([])
    expect(xr!.note).toContain('rows can outnumber companies')
    expect(xr!.note).toContain('A486G')
  })

  it('with no cross-reference rows the block is null, never an invented reconciliation', () => {
    const pkg = build({ award: summary({ approvedSources: [] }) })
    expect(pkg.dossier.source.crossReference).toBeNull()
  })

  it('agreement is stated as agreement', () => {
    const pkg = build({}) // fixture: one xr row, CAGE 1SR57, same as the row's source list
    const xr = pkg.dossier.source.crossReference
    expect(xr!.note).toContain('The two sources name the same companies.')
  })

  it('the reconciliation numbers are grounded: a memo quoting them survives the guard', () => {
    const pkg = build({})
    const out = groundBrief('THE CORNER\nThe cross-reference carries 1 row resolving to 1 company.', pkg)
    expect(out.stripped).toEqual([])
  })
})

describe('the named gaps and the honest next steps', () => {
  it('availability is listed-not-confirmed when holders exist, unconfirmed-who-holds when none do', () => {
    expect(build({}).gaps.some((g) => g.includes('self-reported'))).toBe(true)
    const none = build({ award: summary({ holders: [] }) })
    expect(none.gaps.some((g) => g.includes('who holds the article is unconfirmed'))).toBe(true)
  })

  it('zero saved packets is a named Documents gap; a saved one clears it', () => {
    expect(build({ savedPacketCount: 0 }).gaps.some((g) => g.includes('No quote packet is saved'))).toBe(true)
    expect(build({ savedPacketCount: 2 }).gaps.some((g) => g.includes('No quote packet is saved'))).toBe(false)
    expect(build({ savedPacketCount: 2 }).documents.savedPacketCount).toBe(2)
  })

  it('the plan names the live solicitation and states that FILING IS THE OPERATOR\'S, never the product\'s', () => {
    const steps = build({}).nextSteps.join('\n')
    expect(steps).toContain('SPE4A626T15HA')
    expect(steps).toContain('DIBBS')
    expect(steps).toContain('never submits to a government system')
    expect(steps).toContain('record the close in the pipeline')
  })

  it('HOUSE LAW: no em dash anywhere in the package copy or the markdown', () => {
    const pkg = build({})
    expect(JSON.stringify(pkg)).not.toMatch(/—/)
    expect(packageMarkdown(pkg, 'THE OPPORTUNITY\nA memo.', 'claude-opus-5')).not.toMatch(/—/)
  })
})

describe('the grounding guard over the package: measured numbers pass, invented ones die', () => {
  it('POSITIVE CONTROL: a memo quoting the package\'s own figures survives intact', () => {
    const pkg = build({})
    const memo =
      'THE ECONOMICS\nThe modeled buy value is $13,962.15, which is 213 units at $65.55, the last recorded award unit price. The first award was $41.10.'
    const out = groundBrief(memo, pkg)
    expect(out.stripped).toEqual([])
    expect(out.text).toContain('13,962.15')
  })

  it('an INVENTED figure is stripped and reported', () => {
    const pkg = build({})
    const memo =
      'THE ECONOMICS\nThe modeled buy value is $13,962.15. Comparable corners typically clear $50,000 in the first year.'
    const out = groundBrief(memo, pkg)
    expect(out.stripped).toHaveLength(1)
    expect(out.stripped[0]).toContain('50,000')
    expect(out.text).not.toContain('50,000')
    expect(out.text).toContain('13,962.15')
  })
})

describe('packageMarkdown: what the operator downloads is the memo plus the measured appendix', () => {
  it('carries the memo, the served model, the basis, the suppliers and the steps', () => {
    const pkg = build({})
    const md = packageMarkdown(pkg, 'THE OPPORTUNITY\nA disciplined read.', 'claude-opus-5')
    expect(md).toContain('# Pursuit package · 5325017053574')
    expect(md).toContain('A disciplined read.')
    expect(md).toContain('Written by claude-opus-5')
    expect(md).toContain('Modeled buy value $13,962.15')
    expect(md).toContain('DMS AIRCRAFT SERVICES')
    expect(md).toContain('rita@dmsaircraft.example')
    expect(md).toContain('no contact on file') // the unreachable CAGEs say so
    expect(md).toContain('### Named gaps')
    expect(md).toContain('Saved packets for this stock number in Documents: 0')
  })
})

/*
 * ============================================================================================
 * `supplier.identity.view` ON THE PURSUIT PACKAGE
 * ============================================================================================
 * `/api/pursuit-package` and its email sibling gated on `board.quote` and nothing else.
 * `board.quote` is `sensitive: false`, so `read_only` holds it; `supplier.identity.view` is
 * `sensitive: true`, so `read_only` does not. Proven end-to-end on live prod by another lane with
 * controls: a session the server refuses identities to on `/api/suppliers/detail` (403) and on
 * `/documents` (refusal rendered) was handed two people's names, emails and phone numbers here.
 *
 * These assert the SECRET IS ABSENT FROM THE SERIALISED OBJECT, not that a guard is present. A
 * guard check passes the day someone adds a second field; a shape check over the whole object does
 * not. This package is fed to a language model, so anything left on it gets spoken.
 */
describe('the pursuit package and supplier.identity.view', () => {
  const contact = () => bookSupplier()

  it('withholds the person, email and phone from a caller without the permission', () => {
    const pkg = build({ mayReadIdentities: false, byCage: new Map([['1YYB4', contact()]]) })
    const json = JSON.stringify(pkg)
    const rows = [...pkg.suppliers.holders, ...pkg.suppliers.approvedSources, ...pkg.suppliers.pastAwardees]
    for (const r of rows) {
      if (!r.inBook) continue
      expect(r.inBook.person).toBeNull()
      expect(r.inBook.email).toBeNull()
      expect(r.inBook.phone).toBeNull()
    }
    // and nothing reintroduced them elsewhere in the object
    const c = contact()
    const secrets = [c.email, c.phone, c.executive, ...c.contacts.map((x) => x.email), ...c.contacts.map((x) => x.name)]
    for (const secret of secrets) {
      if (!secret) continue
      expect(json).not.toContain(secret)
    }
  })

  it('POSITIVE CONTROL: the same fixture DOES carry them when the caller holds it', () => {
    const pkg = build({ mayReadIdentities: true, byCage: new Map([['1YYB4', contact()]]) })
    const rows = [...pkg.suppliers.holders, ...pkg.suppliers.approvedSources, ...pkg.suppliers.pastAwardees]
    const withBook = rows.filter((r) => r.inBook)
    expect(withBook.length).toBeGreaterThan(0)
    expect(withBook.some((r) => r.inBook!.email || r.inBook!.phone || r.inBook!.person)).toBe(true)
  })

  /*
   * ★ THE ONE THAT MATTERS MOST. Withholding must not turn into a FALSE statement.
   *
   * `contactChannelsOnFile` was counted by filtering on `email || phone`. Once those are withheld
   * the filter matches nothing, the count collapses to zero, and the memo's own sentence — "reach
   * the N suppliers with a contact channel" — starts telling an operator that nobody is reachable.
   * The gap list had the same defect inverted: every company would be listed as unreachable.
   *
   * A count of reachable companies is not an identity, and `/suppliers` already shows exactly that
   * to every caller: "Show contacts (32)" with the true number, the names behind the permission.
   */
  it('does not turn a withheld identity into a false zero', () => {
    const byCage = new Map([['1YYB4', contact()]])
    const shown = build({ mayReadIdentities: true, byCage })
    const hidden = build({ mayReadIdentities: false, byCage })
    expect(shown.suppliers.contactChannelsOnFile).toBeGreaterThan(0)
    expect(hidden.suppliers.contactChannelsOnFile).toBe(shown.suppliers.contactChannelsOnFile)
    // and the gap sentences must not gain a "no channel" claim that is untrue
    expect(hidden.gaps).toEqual(shown.gaps)
  })
})
