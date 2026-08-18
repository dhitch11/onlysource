import { describe, it, expect } from 'vitest'
import {
  buildAwardeeClassifier,
  readSurplus,
  measureSurplusFill,
  type AwardInput,
  type BookInput,
} from '@/lib/intelligence/suppliers/classify'

describe('readSurplus — three-state, conservative (the expensive-direction guard)', () => {
  it('reads yes-shaped tokens as surplus_yes', () => {
    for (const v of ['Yes', 'yes', 'Y', 'y', 'SURPLUS', 'Government Surplus', 'x', 'X']) {
      expect(readSurplus(v), v).toBe('surplus_yes')
    }
  })
  it('reads an explicit no as surplus_no, NEVER surplus (the manufacturer-misclassified bug)', () => {
    for (const v of ['No', 'no', 'N', 'n', 'None', 'N/A']) expect(readSurplus(v), v).toBe('surplus_no')
  })
  it('reads blank / null / unrecognised as surplus_unread, never as a no or a yes', () => {
    for (const v of [null, undefined, '', '   ', 'maybe', '???']) expect(readSurplus(v)).toBe('surplus_unread')
  })
})

const A = (cage: string, surplus: string | null, nsn = '1', name = 'CO'): AwardInput => ({ cage, surplus, nsn, companyName: name })

describe('buildAwardeeClassifier', () => {
  it('POSITIVE CONTROL: a CAGE with a surplus_yes award is a MEASURED surplus_dealer', () => {
    const c = buildAwardeeClassifier([A('1ABC2', 'Yes'), A('1ABC2', '', '2')])
    const v = c.classify('1ABC2')!
    expect(v.class).toBe('surplus_dealer')
    expect(v.evidenceState).toBe('measured')
    expect(v.measured?.surplusYes).toBe(1)
    expect(v.measured?.totalAwards).toBe(2)
    expect(v.prior).toBeNull()
  })

  it('a CAGE with awards but only "No"/unread surplus is UNKNOWN, never a dealer (no false #1 signal)', () => {
    const c = buildAwardeeClassifier([A('2XYZ3', 'No'), A('2XYZ3', '', '2')])
    const v = c.classify('2XYZ3')!
    expect(v.class).toBe('unknown')
    expect(v.evidenceState).toBe('unknown')
    expect(v.measured?.surplusYes).toBe(0)
    // it says WHY: names the unread cell
    expect(v.basis).toMatch(/unread Surplus cell/)
  })

  it('the distressed-book label is a PRIOR, structurally separate, and never outranks a measured surplus', () => {
    const book: BookInput[] = [{ cage: '3MFG4', companyName: 'MFG', holdsInventory: 'U.S./Canada Manufacturer' }]
    // no surplus award → prior classifies it manufacturer
    const c1 = buildAwardeeClassifier([A('3MFG4', 'No')], book)
    const v1 = c1.classify('3MFG4')!
    expect(v1.class).toBe('manufacturer')
    expect(v1.evidenceState).toBe('prior')
    expect(v1.prior?.bookClass).toBe('manufacturer')
    expect(v1.measured?.surplusYes).toBe(0)
    // but a surplus_yes award OVERRIDES the manufacturer prior (measured wins)
    const c2 = buildAwardeeClassifier([A('3MFG4', 'Yes')], book)
    const v2 = c2.classify('3MFG4')!
    expect(v2.class).toBe('surplus_dealer')
    expect(v2.evidenceState).toBe('measured')
    expect(v2.prior?.bookClass).toBe('manufacturer') // the prior is still carried, just not the verdict
  })

  it('"Non-Manufacturer" book text is a distributor, not a manufacturer (substring trap)', () => {
    const c = buildAwardeeClassifier([], [{ cage: '4DIS5', companyName: 'D', holdsInventory: 'Non-Manufacturer' }])
    expect(c.classify('4DIS5')!.class).toBe('distributor')
  })

  it('a CAGE in neither the awards nor the book returns null (not-in-our-data ≠ unknown)', () => {
    const c = buildAwardeeClassifier([A('1ABC2', 'Yes')])
    expect(c.classify('9NOPE9')).toBeNull()
    expect(c.classify('')).toBeNull()
    expect(c.classify(null)).toBeNull()
  })

  it('coverage carries the honesty numbers, including the population surplus fill rate', () => {
    const c = buildAwardeeClassifier([A('1ABC2', 'Yes'), A('2XYZ3', 'No'), A('3AAA3', ''), A('3AAA3', '')])
    expect(c.coverage.distinctAwardees).toBe(3)
    expect(c.coverage.surplusDealers).toBe(1)
    expect(c.coverage.awardRowsSeen).toBe(4)
    expect(c.coverage.awardRowsSurplusRead).toBe(2) // Yes + No are read; the two blanks are unread
    expect(c.coverage.surplusFillRate).toBeCloseTo(0.5, 5)
  })

  it('asClassificationPort maps to the port: surplus_dealer/distributor→dealer, manufacturer→manufacturer', () => {
    const book: BookInput[] = [{ cage: '3MFG4', companyName: 'M', holdsInventory: 'Manufacturer' }]
    const port = buildAwardeeClassifier([A('1ABC2', 'Yes'), A('4DIS5', 'No')], [...book, { cage: '4DIS5', companyName: 'D', holdsInventory: 'Distributor' }]).asClassificationPort()
    expect(port.classify('1ABC2' as never)!.entityClass).toBe('dealer')       // surplus dealer
    expect(port.classify('4DIS5' as never)!.entityClass).toBe('dealer')       // distributor
    expect(port.classify('3MFG4' as never)!.entityClass).toBe('manufacturer')
  })
})

describe('measureSurplusFill', () => {
  it('reports the read fraction over a set of awards', () => {
    const f = measureSurplusFill([A('a', 'Yes'), A('b', 'No'), A('c', ''), A('d', null)])
    expect(f.total).toBe(4)
    expect(f.read).toBe(2)
    expect(f.rate).toBeCloseTo(0.5, 5)
  })
})
