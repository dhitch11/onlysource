import { describe, it, expect } from 'vitest'
import { groundBrief, allowedNumberSet } from '@/lib/ai/grounding'

// A realistic dossier for a cornered stock number (the shape buildCornerDossier returns).
const dossier = {
  nsn: '5325-01-705-3574',
  item: 'RING,RETAINING G',
  source: { soleSource: true, approvedSourceCount: 1, approvedSources: ['1SR57'], awardSilent: true },
  awardPath: 'machine_award',
  demandQuantity: { value: 213, unitOfIssue: 'EA' },
  priceHistory: [
    { dateIso: '2023-10-10', unitPrice: 54.14, finalPrice: 15050.92, quantity: 278, cage: '0ZBE8', company: 'TRIMAN' },
    { dateIso: '2024-02-27', unitPrice: 103.29, finalPrice: 15286.92, quantity: 148, cage: '0ZBE8', company: 'TRIMAN' },
    { dateIso: '2024-05-14', unitPrice: 82.58, finalPrice: 14864.4, quantity: 180, cage: '0ZBE8', company: 'TRIMAN' },
    { dateIso: '2025-11-26', unitPrice: 65.55, finalPrice: 31005.15, quantity: 473, cage: '0ZBE8', company: 'TRIMAN' },
  ],
  pricing: { firstUnitPrice: 54.14, lastUnitPrice: 65.55, escalationPct: 21, distinctAwardees: 1, awardCount: 4 },
  forecast: { onForecast: true, totalForecastQty: 357, solicitationCount: 11, supplyChains: ['Aviation'], endItems: ['AH-64D LONGBOW', 'AH-64E'] },
  score: { scoreV0: 100, grade: 'D', disposition: 'INSUFFICIENT_DATA', legs: [], reasons: [] },
  openGaps: ['ILS availability not connected.'],
}

describe('grounding guard', () => {
  it('keeps a faithful brief intact (no false positives)', () => {
    const faithful = [
      'THE CORNER',
      'A retaining ring for AH-64 Apache variants, sole-sourced to 1SR57, last made by Triman.',
      'THE MONEY',
      'Unit price ran $54.14, $103.29, $82.58, $65.55 across 4 awards, a 21% change first to last. Demand is 213 units. The forecast lists 357 units across 11 solicitations.',
    ].join('\n')
    const r = groundBrief(faithful, dossier)
    expect(r.stripped).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.text).toContain('$54.14')
    expect(r.text).toContain('357 units')
  })

  it('strips a sentence carrying a fabricated number', () => {
    const withLie = [
      'THE MONEY',
      'The price is $65.55 today. The contract is worth $9,900,000 in total value.',
    ].join('\n')
    const r = groundBrief(withLie, dossier)
    expect(r.ok).toBe(false)
    expect(r.stripped.length).toBe(1)
    expect(r.stripped[0]).toContain('9,900,000')
    expect(r.text).toContain('$65.55 today')
    expect(r.text).not.toContain('9,900,000')
  })

  it('does not treat the 13-digit NSN as a value claim', () => {
    const r = groundBrief('THE CORNER\nStock number 5325017053574 is the ring.', dossier)
    expect(r.stripped).toEqual([])
  })

  it('registers the dossier numbers in multiple forms', () => {
    const allowed = allowedNumberSet(dossier)
    expect(allowed.has('54.14')).toBe(true)
    expect(allowed.has('357')).toBe(true)
    expect(allowed.has('21')).toBe(true)
  })
})

/*
 * THE IDENTIFIER-POISONING HOLE, measured live on 2026-08-17: an end item named "AN/USQ190"
 * blessed the bare number 190 and "recorded escalation above 190 percent" shipped through the
 * guard. These tests pin the closure AND its symmetry: the same boundary rule runs on both
 * sides, so quoting the identifier itself is never a false strip.
 */
describe('grounding guard: identifier boundaries and number words', () => {
  const poisoned = {
    ...dossier,
    forecast: { ...dossier.forecast, endItems: ['MIDS JTRS AN/USQ190', 'B-52 STRATOFORTRESS'] },
  }

  it('a digit run embedded in a designator does NOT enter the allowed set', () => {
    const allowed = allowedNumberSet(poisoned)
    expect(allowed.has('190')).toBe(false)
    expect(allowed.has('52')).toBe(false)
  })

  it('the live leak is closed: a bare number sourced only from a designator is stripped', () => {
    const r = groundBrief('THE MONEY\nEscalation above 190 percent is recorded here.', poisoned)
    expect(r.stripped).toHaveLength(1)
    expect(r.stripped[0]).toContain('190')
  })

  it('SYMMETRY: quoting the designator itself is never a false strip', () => {
    const r = groundBrief('THE CORNER\nThe part rides on MIDS JTRS AN/USQ190 and the B-52.', poisoned)
    expect(r.stripped).toEqual([])
  })

  it('a date cannot bless its own fragments: day-of-month quoted as a quantity is stripped', () => {
    // 2023-10-10 exists in the price history; the bare 10 as a count was never measured.
    const r = groundBrief('THE MONEY\nDemand is 10 units.', dossier)
    expect(r.stripped).toHaveLength(1)
    // ...while quoting the full date passes untouched.
    const ok = groundBrief('THE MONEY\nThe first award landed 2023-10-10 at $54.14.', dossier)
    expect(ok.stripped).toEqual([])
  })

  it('numbers written in WORDS are caught: spelled magnitudes and multiplicative claims', () => {
    const r = groundBrief(
      'THE MONEY\nRoughly three hundred awards exist. The price doubled since then. The last award was $65.55.',
      dossier,
    )
    expect(r.stripped).toHaveLength(2)
    expect(r.text).toContain('$65.55')
  })

  it('control: an ordinary word containing a magnitude substring is untouched', () => {
    const r = groundBrief('THE CORNER\nVermillion Industries is not in this dossier, and 213 units are.', dossier)
    expect(r.stripped).toEqual([])
  })
})
