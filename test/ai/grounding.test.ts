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
