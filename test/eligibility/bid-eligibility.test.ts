/**
 * BID ELIGIBILITY TESTS.
 *
 * The expensive error here is one-directional and every test below is aimed at it: reading a
 * blank acquisition code as "not restricted" tells an operator they may quote a part they are
 * not an approved source for. So the abstention paths are tested harder than the happy path,
 * and each one asserts that the ABSENCE of a determination is visible rather than defaulted.
 */
import { describe, expect, it } from 'vitest'

import {
  loadAmscIndex,
  resolveBidEligibility,
  summariseEligibility,
  type AmscIndex,
} from '@/lib/intelligence/eligibility/bid-eligibility'

function index(
  rows: Array<{ niin: string; amc: string; amsc: string; aac?: string; pica: string }>,
  publishers: string[],
): AmscIndex {
  return {
    ok: true,
    lookup: (n: string) => new Map(rows.map((r) => [r.niin, { aac: '', ...r }])).get(n),
    size: rows.length,
    backing: 'binary' as const,
    niins: () => rows.map((r) => r.niin),
    publishers: new Map(publishers.map((p) => [p, { rows: 10000, withAmsc: 10000, rate: 1 }])),
    provenance: {},
  }
}

describe('resolveBidEligibility determines only where the publisher publishes', () => {
  const idx = index(
    [
      { niin: '000000001', amc: '1', amsc: 'G', pica: 'GX' },
      { niin: '000000002', amc: '3', amsc: 'P', pica: 'GX' },
      { niin: '000000003', amc: '', amsc: '', pica: 'ZW' },
    ],
    ['GX'],
  )

  it('renders the government explanation verbatim when determined', () => {
    const e = resolveBidEligibility('000000001', idx)
    expect(e.state).toBe('determined')
    expect(e.amsc).toBe('G')
    expect(e.amscEntry?.explanation).toContain('unlimited rights')
    expect(e.combination).toBe('valid')
  })

  it('keeps the ESTIMATED posture separate from the VERIFIED table entry', () => {
    // They must be separately available so a surface can render them at different confidence.
    // A single merged "verdict" field would make that impossible at the render layer.
    const open = resolveBidEligibility('000000001', idx)
    const closed = resolveBidEligibility('000000002', idx)
    expect(open.posture).toBe('open_to_surplus_dealer')
    expect(closed.posture).toBe('restricted_closed_to_new_manufacturing_source')
    expect(open.amscEntry).not.toBeNull()
    expect(closed.amscEntry?.explanation).toContain('not owned by the Government')
  })

  it('★ ABSTAINS where the managing activity publishes nothing, and never reads it as unrestricted', () => {
    const e = resolveBidEligibility('000000003', idx)
    expect(e.state).toBe('abstained_pica_does_not_publish')
    expect(e.amsc).toBeNull()
    expect(e.posture).toBeNull()
    // The reason must say so in words a surface can render, not leave a blank to be interpreted.
    expect(e.reason).toContain('must not be read as unrestricted')
  })

  it('abstains for a stock number absent from the catalogue', () => {
    const e = resolveBidEligibility('999999999', idx)
    expect(e.state).toBe('abstained_not_in_catalogue')
    expect(e.posture).toBeNull()
    expect(e.reason.length).toBeGreaterThan(20)
  })

  it('accepts a 13 digit NSN and a 9 digit NIIN as the same item', () => {
    const a = resolveBidEligibility('5330000000001', idx)
    const b = resolveBidEligibility('000000001', idx)
    expect(a.state).toBe('determined')
    expect(a.niin).toBe(b.niin)
    expect(a.amsc).toBe(b.amsc)
  })

  it('★ refuses to coerce a malformed stock number onto a neighbouring key', () => {
    // 231 of the 39,224 index rows in the real archive carry a stock-number cell that is not a
    // well-formed NSN, and they are REAL requirements. Silently truncating one onto a valid
    // NIIN would attach another item's data rights to it.
    for (const bad of ['', 'XXXXXXXXXXXXX', '12345', '0000000012345678']) {
      const e = resolveBidEligibility(bad, idx)
      expect(e.state).toBe('abstained_not_in_catalogue')
      expect(e.amsc).toBeNull()
    }
  })

  it('★ an absent index abstains on everything and says why, rather than defaulting', () => {
    const e = resolveBidEligibility('000000001', { ok: false, reason: 'no index on disk' })
    expect(e.state).toBe('index_absent')
    expect(e.reason).toBe('no index on disk')
    expect(e.posture).toBeNull()
    expect(e.amsc).toBeNull()
  })
})

describe('summariseEligibility counts only what was determined', () => {
  const idx = index(
    [
      { niin: '000000001', amc: '1', amsc: 'G', pica: 'GX' },
      { niin: '000000002', amc: '1', amsc: 'Z', pica: 'GX' },
      { niin: '000000003', amc: '', amsc: '', pica: 'ZW' },
    ],
    ['GX'],
  )

  it('separates determined from abstained and never folds an abstention into a posture', () => {
    const s = summariseEligibility(['000000001', '000000002', '000000003', '999999999'], idx)
    expect(s.total).toBe(4)
    expect(s.determined).toBe(2)
    expect(s.abstained).toBe(2)
    expect(s.byPosture.open_to_surplus_dealer).toBe(2)
    // The two abstentions appear in NO posture bucket. An abstention is not a category of answer.
    expect(Object.values(s.byPosture).reduce((a, b) => a + b, 0)).toBe(2)
  })
})

describe('the real derived index on disk', () => {
  const idx = loadAmscIndex()

  it('loads, or states exactly why it did not', () => {
    if (!idx.ok) {
      expect(idx.reason.length).toBeGreaterThan(20)
      return
    }
    expect(idx.size).toBeGreaterThan(1000)
    // Measured 2026-08-17: 44 PICAs clear the publisher threshold on the real extract. Pinned
    // as a floor rather than an equality, because the next monthly refresh may add one.
    expect(idx.publishers.size).toBeGreaterThan(10)
  })

  it('determines eligibility across the catalogue it now covers', () => {
    if (!idx.ok) return
    /*
     * A STRIDED SAMPLE, NEVER A HEAD, and never the whole index.
     *
     * The index is sorted by NIIN and a NIIN's leading digits track its supply class, so the
     * first N records are all from the same few classes. Reporting a rate over a head is the
     * convenience-sample error this estate has already paid for once, where an unordered
     * `limit` turned a true 11.0% into a reported 27.8%. `niins(n)` strides the whole file.
     */
    const sample = idx.niins(20000)
    const s = summariseEligibility(sample, idx)
    /*
     * ★ THIS FLOOR CAME DOWN FROM 0.9 AND IT IS NOT A REGRESSION. THE POPULATION CHANGED.
     *
     * The old index held ONLY NIINs we had seen solicited on DIBBS. Those are DLA-managed, and
     * DLA publishes AMSC on ~100% of its rows, so >0.9 was a statement about DLA rather than
     * about the catalogue. The index now covers all 7,060,851 NIINs the MOE Rule file
     * publishes, including the 51 activities measured at 0.00% publication, so the honest
     * catalogue-wide rate is lower and abstention is doing exactly the job it was built for.
     *
     * MEASURED 2026-08-19 on the real binary: 77.36% determined on a 20,000 stride and 77.05%
     * on a 2,000 stride. Two sample sizes a decade apart in size agreeing to a third of a
     * percent is what says the stride is not manufacturing the number. Pinned as a floor
     * rather than an equality because the next monthly refresh will move it slightly.
     */
    expect(s.determined / s.total).toBeGreaterThan(0.7)
    // And the posture buckets must actually be populated, not all-unclassified, or the
    // interpreter is wired but contributing nothing.
    expect(s.byPosture.open_to_surplus_dealer ?? 0).toBeGreaterThan(1000)
  })
})
