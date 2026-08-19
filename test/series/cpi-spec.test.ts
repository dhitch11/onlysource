/**
 * THE ONE-LINE WIRE, AND THE THREE REFUSALS THAT MAKE IT SAFE TO TAKE.
 *
 * Driven against a REAL ledger written to a temp root, not a mock, because the whole class of
 * defect this closes was a ledger that existed and was read from the wrong place.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { refreshFromLedger } from '@/lib/intelligence/series/cpi-spec'
import { CPI_INDEX_1650, DOD_PROCUREMENT_INDEX_1650 } from '@/lib/engine/pricing/anchor'

const made: string[] = []
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** The publisher's real readings, in the ledger's own shape. */
function ledgerWith(rows: Array<{ period: string; value: number; vintage?: string; method?: string }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cpi-spec-'))
  made.push(dir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SERIES.jsonl'),
    rows
      .map((r) =>
        JSON.stringify({
          series_id: 'CUUR0000SA0', period: r.period, year: Number(r.period.slice(0, 4)),
          period_code: r.period.slice(5), value: r.value, vintage: r.vintage ?? '2026-08-19',
          retrieved_at: '2026-08-19T00:00:00.000Z', retrieval_method: r.method ?? 'api_fetch',
          retrieved_at_basis: 'http_response',
          source_url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/', footnotes: null,
        }),
      )
      .join('\n') + '\n',
  )
  return dir
}

const REAL = [
  { period: '2017-M13', value: 245.12 },
  { period: '2025-M11', value: 324.122 },
  { period: '2026-M07', value: 333.918 },
]

describe('it refreshes the pinned factor out of the dated ledger', () => {
  it('resolves the CURRENT factor and says which two readings made it', async () => {
    const r = await refreshFromLedger(CPI_INDEX_1650, {
      toPeriod: '2026-M07', asOfVintage: '2026-08-19', ledgerRoot: ledgerWith(REAL),
    })
    expect(r.refreshed).toBe(true)
    expect(r.spec.factor).toBeCloseTo(1.362263, 6)
    expect(r.spec.vintage.note).toContain('CUUR0000SA0')
    expect(r.spec.vintage.note).toContain('333.918')
    expect(r.spec.vintage.note).toContain('245.12')
    expect(r.spec.vintage.statedAtSourceDate).toBe('2026-08-19')
  })

  /* The pinned figure was never wrong, it was UNDATED. It must stay reproducible forever. */
  it('reproduces the shipped 1.3223 exactly when asked for the period it was read on', async () => {
    const r = await refreshFromLedger(CPI_INDEX_1650, {
      toPeriod: '2025-M11', asOfVintage: '2026-08-19', ledgerRoot: ledgerWith(REAL),
    })
    expect(r.refreshed).toBe(true)
    expect(Number(r.spec.factor.toFixed(4))).toBe(1.3223)
    expect(Number(CPI_INDEX_1650.factor.toFixed(4))).toBe(1.3223)
  })

  it('derives the base period from the spec’s own base year, not from a constant here', async () => {
    // 2017 -> "2017-M13". A ledger missing that period must abstain rather than pick another.
    const r = await refreshFromLedger(CPI_INDEX_1650, {
      toPeriod: '2026-M07', asOfVintage: '2026-08-19',
      ledgerRoot: ledgerWith(REAL.filter((x) => x.period !== '2017-M13')),
    })
    expect(r.refreshed).toBe(false)
    expect(r.resolution.resolved).toBe(false)
    if (!r.resolution.resolved) expect(r.resolution.reason).toBe('from_period_not_held')
  })
})

describe('★ on abstention it returns the spec UNCHANGED and dates it, never a fallback figure', () => {
  it('keeps the pinned number and says it is a reading, not a current one', async () => {
    const r = await refreshFromLedger(CPI_INDEX_1650, {
      toPeriod: '2026-M07', asOfVintage: '2026-08-19', ledgerRoot: ledgerWith([]),
    })
    expect(r.refreshed).toBe(false)
    // The rung does NOT go dark: the factor survives untouched.
    expect(r.spec.factor).toBe(CPI_INDEX_1650.factor)
    expect(r.spec.vintage.note).toContain('NOT REFRESHED')
    expect(r.spec.vintage.note).toContain('presented as that reading, not as a current one')
  })

  it('never substitutes a later vintage for one it does not hold', async () => {
    const r = await refreshFromLedger(CPI_INDEX_1650, {
      toPeriod: '2026-M07', asOfVintage: '2026-01-01', ledgerRoot: ledgerWith(REAL),
    })
    expect(r.refreshed).toBe(false)
    if (!r.resolution.resolved) expect(r.resolution.reason).toBe('no_vintage_at_or_before_as_of')
    expect(r.spec.factor).toBe(CPI_INDEX_1650.factor)
  })

  it('refuses a row below the provenance grade the caller requires', async () => {
    const root = ledgerWith(REAL.map((r) => ({ ...r, method: 'operator_entry' })))
    const strict = await refreshFromLedger(CPI_INDEX_1650, {
      toPeriod: '2026-M07', asOfVintage: '2026-08-19', ledgerRoot: root,
    })
    expect(strict.refreshed).toBe(false)
    const loose = await refreshFromLedger(CPI_INDEX_1650, {
      toPeriod: '2026-M07', asOfVintage: '2026-08-19', ledgerRoot: root,
      acceptRetrievalMethods: ['operator_entry'],
    })
    expect(loose.refreshed).toBe(true)
  })

  /* A stated judgement is not a reading and no ledger may dress it as one. */
  it('refuses to refresh a spec that names no published series', async () => {
    expect(DOD_PROCUREMENT_INDEX_1650.vintage.publishedSeriesId).toBeNull()
    const r = await refreshFromLedger(DOD_PROCUREMENT_INDEX_1650, {
      toPeriod: '2026-M07', asOfVintage: '2026-08-19', ledgerRoot: ledgerWith(REAL),
    })
    expect(r.refreshed).toBe(false)
    expect(r.spec.factor).toBe(DOD_PROCUREMENT_INDEX_1650.factor)
    if (!r.resolution.resolved) expect(r.resolution.sentence).toContain('stated judgement')
  })
})
