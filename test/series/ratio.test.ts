/**
 * THE PRICE-SERIES RESOLVER.
 *
 * Every refusal has a control, because the refusals ARE the design: a resolver that always
 * returns a number is the stale constant this module replaced, wearing a citation.
 *
 * The first test is the one that matters most. It reproduces the figure the product has been
 * shipping, 1.3223, from the publisher's own two readings, and then shows the SAME series
 * answering a different question with a different number. If that pair ever collapses to one
 * answer, the ratio has quietly become a constant again.
 */
import { describe, expect, it } from 'vitest'

import { resolveSeriesRatio } from '@/lib/intelligence/series/ratio'
import type { SeriesObservation } from '@/lib/ingest/series/bls'

const obs = (o: Partial<SeriesObservation> & Pick<SeriesObservation, 'period' | 'value' | 'vintage'>): SeriesObservation => ({
  series_id: 'CUUR0000SA0',
  year: Number(o.period.slice(0, 4)),
  period_code: o.period.slice(5) || 'M13',
  retrieved_at: '2026-08-19T00:00:00.000Z',
  retrieval_method: 'api_fetch',
  retrieved_at_basis: 'http_response',
  source_url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
  footnotes: null,
  ...o,
})

/** The real readings, from the publisher. */
const CPI_2017 = obs({ period: '2017-M13', value: 245.12, vintage: '2026-08-19' })
const CPI_2025_NOV = obs({ period: '2025-M11', value: 324.122, vintage: '2026-08-19' })
const CPI_2026_JUL = obs({ period: '2026-M07', value: 333.918, vintage: '2026-08-19' })
const LEDGER = [CPI_2017, CPI_2025_NOV, CPI_2026_JUL]

const req = {
  seriesId: 'CUUR0000SA0',
  fromPeriod: '2017-M13',
  toPeriod: '2025-M11',
  asOfVintage: '2026-08-19',
}

describe('the ratio reproduces the published arithmetic and keeps moving', () => {
  it('reproduces the shipped 1.3223 from the publisher’s own two readings', () => {
    const r = resolveSeriesRatio(LEDGER, req)
    expect(r.resolved).toBe(true)
    if (!r.resolved) return
    // 324.122 / 245.120 = 1.32229928..., which is the 1.3223 the product has been carrying.
    expect(r.ratio).toBeCloseTo(1.32229928, 8)
    expect(Number(r.ratio.toFixed(4))).toBe(1.3223)
    expect(r.from.value).toBe(245.12)
    expect(r.to.value).toBe(324.122)
    expect(r.citation).toContain('CUUR0000SA0')
    expect(r.citation).toContain('245.12')
    expect(r.citation).toContain('324.122')
  })

  /*
   * ★ THE CONTROL AGAINST THE WHOLE DEFECT. The stored multiplier was not merely stale, it was
   * a number that goes wrong on a schedule with no code change. The same series asked a
   * different question must answer differently, or the ratio has become a constant again.
   */
  it('answers a later period with a different number, which is the point', () => {
    const later = resolveSeriesRatio(LEDGER, { ...req, toPeriod: '2026-M07' })
    expect(later.resolved).toBe(true)
    if (!later.resolved) return
    expect(Number(later.ratio.toFixed(4))).toBe(1.3623)
    const pinned = resolveSeriesRatio(LEDGER, req)
    if (!pinned.resolved) throw new Error('base case must resolve')
    // ~3% apart: the drift the product was silently carrying.
    expect(later.ratio / pinned.ratio).toBeGreaterThan(1.02)
  })
})

describe('it abstains rather than inventing, and names what is missing every time', () => {
  it('refuses a series it does not hold', () => {
    const r = resolveSeriesRatio(LEDGER, { ...req, seriesId: 'WPU10' })
    expect(r.resolved).toBe(false)
    if (r.resolved) return
    expect(r.reason).toBe('series_not_held')
    expect(r.missingInput).toContain('WPU10')
  })

  it('refuses a base period it does not hold, and does not reach for a neighbour', () => {
    const r = resolveSeriesRatio(LEDGER, { ...req, fromPeriod: '2016-M13' })
    expect(r.resolved).toBe(false)
    if (r.resolved) return
    expect(r.reason).toBe('from_period_not_held')
    expect(r.missingInput).toContain('2016-M13')
    expect(r.sentence).toContain('not filled from a neighbouring period')
  })

  it('refuses an endpoint it does not hold, and does not carry the last one forward', () => {
    const r = resolveSeriesRatio(LEDGER, { ...req, toPeriod: '2026-M12' })
    expect(r.resolved).toBe(false)
    if (r.resolved) return
    expect(r.reason).toBe('to_period_not_held')
    expect(r.sentence).toContain('not carried forward')
  })

  /*
   * ★ THE REFUSAL @DATA-CURRENCY ASKED FOR BY NAME. A missing vintage must never fall back to
   * the latest. Answering a question about the past with a reading that did not exist yet is
   * the same defect as judging "still biddable" against the newest day we captured.
   */
  it('never substitutes a later vintage for a missing one', () => {
    const r = resolveSeriesRatio(LEDGER, { ...req, asOfVintage: '2026-01-01' })
    expect(r.resolved).toBe(false)
    if (r.resolved) return
    expect(r.reason).toBe('no_vintage_at_or_before_as_of')
    expect(r.sentence).toContain('did not exist yet')
  })

  it('reads the series as it stood at the vintage asked for, not as it stands now', () => {
    const revised = obs({ period: '2025-M11', value: 999.999, vintage: '2026-09-01' })
    const r = resolveSeriesRatio([...LEDGER, revised], req)
    expect(r.resolved).toBe(true)
    if (!r.resolved) return
    // The revision exists and is NEWER, and is correctly not used for an earlier as-of.
    expect(r.to.value).toBe(324.122)
    const after = resolveSeriesRatio([...LEDGER, revised], { ...req, asOfVintage: '2026-09-30' })
    if (!after.resolved) throw new Error('later as-of must resolve')
    expect(after.to.value).toBe(999.999)
  })

  it('refuses when the publisher contradicts itself at one vintage', () => {
    const contradiction = obs({ period: '2025-M11', value: 324.5, vintage: '2026-08-19' })
    const r = resolveSeriesRatio([...LEDGER, contradiction], req)
    expect(r.resolved).toBe(false)
    if (r.resolved) return
    expect(r.reason).toBe('readings_contradict')
    expect(r.sentence).toContain('does not choose between them')
  })

  it('refuses a non-positive base rather than dividing by a sentinel', () => {
    const zero = obs({ period: '2017-M13', value: 0, vintage: '2026-08-20' })
    const r = resolveSeriesRatio([...LEDGER, zero], { ...req, asOfVintage: '2026-08-20' })
    expect(r.resolved).toBe(false)
    if (r.resolved) return
    expect(r.reason).toBe('base_not_positive')
  })

  /*
   * The provenance gate. Measured on this estate the same week: a file matched its recorded
   * byte count exactly and was 8% of the real thing, and the only tell was how it was fetched.
   */
  it('lets a caller refuse a row below the provenance grade it requires', () => {
    const typed = [
      obs({ period: '2017-M13', value: 245.12, vintage: '2026-08-19', retrieval_method: 'operator_entry' }),
      obs({ period: '2025-M11', value: 324.122, vintage: '2026-08-19', retrieval_method: 'operator_entry' }),
    ]
    const loose = resolveSeriesRatio(typed, req)
    expect(loose.resolved).toBe(true)

    const strict = resolveSeriesRatio(typed, { ...req, acceptRetrievalMethods: ['api_fetch'] })
    expect(strict.resolved).toBe(false)
    if (strict.resolved) return
    expect(strict.reason).toBe('below_required_provenance')
    expect(strict.missingInput).toContain('api_fetch')
  })

  it('an abstention carries no number at all, so a page cannot read a price off it', () => {
    const r = resolveSeriesRatio(LEDGER, { ...req, seriesId: 'NOPE' })
    expect(r.resolved).toBe(false)
    expect(Object.keys(r)).toEqual(['resolved', 'reason', 'missingInput', 'sentence'])
    expect(JSON.stringify(r)).not.toMatch(/\d+\.\d+/)
  })
})
