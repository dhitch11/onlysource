/**
 * THE DATED PRICE SERIES: PARSING, THE LEDGER, AND THE RATIO.
 *
 * Every test drives real code with real response shapes. No network: the parser is pure and
 * separate from the fetch precisely so every publisher behaviour can be reproduced here,
 * including the two that are dangerous rather than merely awkward.
 *
 * THE FIXTURE NUMBERS ARE REAL, read from the BLS public API on 2026-08-19. They are not
 * invented, because the central assertion is a retro-validation of a constant that has been
 * shipping in production, and inventing the inputs to that would prove nothing at all.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  BlsRequestFailed,
  blsRequestBody,
  escalationRatio,
  missingYears,
  parseBlsResponse,
  yearWindows,
  type SeriesObservation,
} from '../../lib/ingest/series/bls'
import {
  appendObservations,
  measureSeriesFreshness,
  readSeriesLedger,
  seriesFreshnessReport,
  summariseCoverage,
} from '../../lib/ingest/series/store'

const roots: string[] = []
const freshRoot = (): string => {
  const r = mkdtempSync(join(tmpdir(), 'onlysource-series-'))
  roots.push(r)
  return r
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

const OPTS = { vintage: '2026-08-19', retrievedAt: '2026-08-19T00:00:00.000Z' }

function payload(rows: { year: string; period: string; value: string }[]) {
  return {
    status: 'REQUEST_SUCCEEDED',
    responseTime: 132,
    message: [],
    Results: { series: [{ seriesID: 'CUUR0000SA0', data: rows.map((r) => ({ ...r, footnotes: [{}] })) }] },
  }
}

/* ---------------------------------------------------------------------------------- */
/* THE PLACEHOLDER THAT WOULD HAVE BECOME A ZERO                                       */
/* ---------------------------------------------------------------------------------- */

describe('a period the publisher has not published', () => {
  it('is ABSENT, never zero, and is reported rather than dropped', () => {
    const result = parseBlsResponse(
      payload([
        { year: '2026', period: 'M07', value: '333.918' },
        { year: '2026', period: 'M08', value: '-' }, // BLS sends this literal string
        { year: '2026', period: 'M09', value: '' },
      ]),
      OPTS,
    )

    expect(result.observations).toHaveLength(1)
    expect(result.observations[0]!.value).toBe(333.918)
    expect(result.unpublished.map((u) => u.period)).toEqual(['2026-M08', '2026-M09'])

    // THE DEFECT THIS EXISTS TO PREVENT. `Number('-')` is NaN and `Number('')` is 0, so a
    // tolerant parser turns an unpublished month into a price index of zero, and a zero index
    // in a ratio is either a division by zero or an escalation of minus one hundred percent.
    expect(result.observations.some((o) => o.value === 0)).toBe(false)
    // POSITIVE CONTROL: the naive coercion really does produce a zero on this input.
    expect(Number('')).toBe(0)
  })

  it('keeps a legitimate negative number, which is not the same as a placeholder', () => {
    const result = parseBlsResponse(payload([{ year: '2026', period: 'M01', value: '-1.5' }]), OPTS)
    expect(result.observations[0]!.value).toBe(-1.5)
    expect(result.unpublished).toHaveLength(0)
  })
})

/* ---------------------------------------------------------------------------------- */
/* A REFUSED REQUEST IS NOT AN EMPTY SERIES                                            */
/* ---------------------------------------------------------------------------------- */

describe('a request the publisher refused', () => {
  it('throws rather than returning zero observations', () => {
    expect(() =>
      parseBlsResponse(
        { status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold reached'], Results: {} },
        OPTS,
      ),
    ).toThrow(BlsRequestFailed)

    // Collapsing these would let a quota rejection read as "this series is empty", which puts
    // a silent hole in a price history and looks identical to a series that genuinely ended.
    const empty = parseBlsResponse(
      { status: 'REQUEST_SUCCEEDED', Results: { series: [{ seriesID: 'WPU999', data: [] }] } },
      OPTS,
    )
    expect(empty.emptySeries).toEqual(['WPU999'])
    expect(empty.observations).toHaveLength(0)
  })

  it('treats a missing status field as a refusal, not as success', () => {
    expect(() => parseBlsResponse({ Results: { series: [] } }, OPTS)).toThrow(BlsRequestFailed)
  })
})

/* ---------------------------------------------------------------------------------- */
/* ★ THE RETRO-VALIDATION: THE CONSTANT IN PRODUCTION IS A READING OF THIS SERIES      */
/* ---------------------------------------------------------------------------------- */

describe('the 1.3223 factor shipping in production', () => {
  // Real readings, BLS CUUR0000SA0, retrieved 2026-08-19.
  const REAL = payload([
    { year: '2017', period: 'M13', value: '245.120' }, // annual average
    { year: '2025', period: 'M11', value: '324.122' },
    { year: '2025', period: 'M13', value: '321.943' },
    { year: '2026', period: 'M07', value: '333.918' }, // latest published
  ])

  it('is exactly CPI-U 2025-M11 over the 2017 annual average', () => {
    const { observations } = parseBlsResponse(REAL, OPTS)
    const r = escalationRatio(observations, {
      seriesId: 'CUUR0000SA0',
      fromPeriod: '2017-M13',
      toPeriod: '2025-M11',
    })
    expect(r).not.toBeNull()
    expect(Number(r!.ratio.toFixed(4))).toBe(1.3223)
  })

  it('★ and is ~3% STALE against the latest published reading', () => {
    const { observations } = parseBlsResponse(REAL, OPTS)
    const latest = escalationRatio(observations, {
      seriesId: 'CUUR0000SA0',
      fromPeriod: '2017-M13',
      toPeriod: '2026-M07',
    })
    expect(Number(latest!.ratio.toFixed(4))).toBe(1.3623)

    // The whole case for a dated series in one assertion: the stored constant and the current
    // truth differ by more than three percent, and the gap widens every month unattended.
    expect(latest!.ratio).toBeGreaterThan(1.3223)
    expect((latest!.ratio / 1.3223 - 1) * 100).toBeGreaterThan(3)
  })
})

/* ---------------------------------------------------------------------------------- */
/* A PERIOD WE DID NOT OBSERVE IS NOT ANSWERABLE                                       */
/* ---------------------------------------------------------------------------------- */

describe('escalationRatio', () => {
  const { observations } = parseBlsResponse(
    payload([
      { year: '2017', period: 'M13', value: '245.120' },
      { year: '2025', period: 'M13', value: '321.943' },
    ]),
    OPTS,
  )

  it('returns null for a period we do not hold, instead of the nearest one', () => {
    // 2021 is inside the covered range and is NOT held. Substituting the nearest year is the
    // same error as judging a solicitation against the newest day captured instead of today,
    // and it wears exactly the right shape while being a different fact.
    expect(
      escalationRatio(observations, {
        seriesId: 'CUUR0000SA0',
        fromPeriod: '2021-M13',
        toPeriod: '2025-M13',
      }),
    ).toBeNull()
  })

  it('returns null for a series we do not hold', () => {
    expect(
      escalationRatio(observations, {
        seriesId: 'WPU10',
        fromPeriod: '2017-M13',
        toPeriod: '2025-M13',
      }),
    ).toBeNull()
  })

  it('resolves at an as-of vintage, so a figure shown last week stays reproducible', () => {
    // Both legs must have existed at the as-of point. A ratio is two readings, and holding
    // only one of them then is not a figure we could have shown.
    const baseThen: SeriesObservation = { ...observations[0]!, vintage: '2026-08-01' }
    const old: SeriesObservation = { ...observations[1]!, value: 320.0, vintage: '2026-08-01' }
    const revised: SeriesObservation = { ...observations[1]!, value: 321.943, vintage: '2026-08-19' }
    const all = [baseThen, observations[0]!, old, revised]

    const asOfThen = escalationRatio(all, {
      seriesId: 'CUUR0000SA0',
      fromPeriod: '2017-M13',
      toPeriod: '2025-M13',
      asOfVintage: '2026-08-05',
    })
    const asOfNow = escalationRatio(all, {
      seriesId: 'CUUR0000SA0',
      fromPeriod: '2017-M13',
      toPeriod: '2025-M13',
    })

    expect(asOfThen!.to.value).toBe(320.0)
    expect(asOfNow!.to.value).toBe(321.943)
    expect(asOfThen!.ratio).not.toBe(asOfNow!.ratio)
  })

  it('★ refuses an as-of point at which we did not yet hold BOTH legs', () => {
    // This started as a broken fixture and the behaviour it exposed is worth keeping. Asked
    // to reproduce a figure from before we had read the base period, the honest answer is
    // that there was no such figure. Answering with today's base and a back-dated numerator
    // would invent a number we never showed anyone, which is exactly what an as-of exists to
    // prevent.
    const revisedOnly: SeriesObservation = { ...observations[1]!, vintage: '2026-08-19' }
    expect(
      escalationRatio([observations[0]!, revisedOnly], {
        seriesId: 'CUUR0000SA0',
        fromPeriod: '2017-M13',
        toPeriod: '2025-M13',
        asOfVintage: '2026-08-05',
      }),
    ).toBeNull()
  })
})

/* ---------------------------------------------------------------------------------- */
/* THE LEDGER IS APPEND-ONLY, AND A CHANGED VALUE IS NOT A DUPLICATE                   */
/* ---------------------------------------------------------------------------------- */

describe('the series ledger', () => {
  const obs = (over: Partial<SeriesObservation> = {}): SeriesObservation => ({
    series_id: 'CUUR0000SA0',
    period: '2025-M11',
    year: 2025,
    period_code: 'M11',
    value: 324.122,
    vintage: '2026-08-19',
    retrieved_at: '2026-08-19T00:00:00.000Z',
    retrieval_method: 'api_fetch',
    retrieved_at_basis: 'http_response',
    source_url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
    footnotes: null,
    ...over,
  })

  it('is idempotent on an identical observation, so a re-run costs nothing', async () => {
    const root = freshRoot()
    expect((await appendObservations([obs()], root)).appended).toBe(1)
    const second = await appendObservations([obs()], root)
    expect(second.appended).toBe(0)
    expect(second.alreadyHeld).toBe(1)
    expect(await readSeriesLedger(root)).toHaveLength(1)
  })

  it('★ records a CONTRADICTION rather than swallowing it as a duplicate', async () => {
    const root = freshRoot()
    await appendObservations([obs()], root)
    // Same series, same period, SAME vintage, different number: the publisher contradicting
    // itself. A dedupe keyed only on identity would drop this and the correction would vanish.
    const out = await appendObservations([obs({ value: 324.5 })], root)

    expect(out.appended).toBe(1)
    expect(out.contradictions).toEqual([
      { series_id: 'CUUR0000SA0', period: '2025-M11', vintage: '2026-08-19', held: 324.122, incoming: 324.5 },
    ])
    expect(await readSeriesLedger(root)).toHaveLength(2) // both kept, neither overwritten
  })

  it('treats a new vintage as a revision, not a contradiction', async () => {
    const root = freshRoot()
    await appendObservations([obs()], root)
    const out = await appendObservations([obs({ value: 324.5, vintage: '2026-09-01' })], root)
    expect(out.appended).toBe(1)
    expect(out.contradictions).toHaveLength(0)

    const coverage = summariseCoverage(await readSeriesLedger(root))
    expect(coverage[0]!.revisedPeriods).toBe(1)
    expect(coverage[0]!.vintages).toEqual(['2026-08-19', '2026-09-01'])
  })

  it('returns an empty ledger rather than throwing when none exists', async () => {
    expect(await readSeriesLedger(freshRoot())).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------- */
/* THE REQUEST BODY REFUSES WHAT IT CANNOT MEAN                                        */
/* ---------------------------------------------------------------------------------- */

describe('blsRequestBody', () => {
  it('builds the documented shape and omits the key when there is none', () => {
    const body = blsRequestBody({ seriesIds: ['CUUR0000SA0'], startYear: 2016, endYear: 2026, annualAverage: true })
    expect(body).toEqual({
      seriesid: ['CUUR0000SA0'],
      startyear: '2016',
      endyear: '2026',
      annualaverage: true,
    })
    expect('registrationkey' in body).toBe(false)
  })

  it('refuses a request that asks for nothing, or for a backwards window', () => {
    expect(() => blsRequestBody({ seriesIds: [], startYear: 2016, endYear: 2026 })).toThrow()
    expect(() => blsRequestBody({ seriesIds: ['X'], startYear: 2026, endYear: 2016 })).toThrow()
  })
})

/* ---------------------------------------------------------------------------------- */
/* ★ A SUCCESS STATUS CARRYING A WARNING NOBODY READ                                   */
/* ---------------------------------------------------------------------------------- */

describe('a request the publisher silently narrowed', () => {
  /*
   * MEASURED LIVE 2026-08-19, not hypothesised. Asking CUUR0000SA0 for 2016-2026 returns
   * status REQUEST_SUCCEEDED and this exact message, having dropped 2026 entirely:
   *
   *   message: ['Year range has been reduced to the system-allowed limit of 10 years.']
   *
   * The first version of this parser checked only `status` and discarded `message` on
   * success, so the ingest reported "129 observations, 129 appended" and was missing the
   * current year -- the one that takes the CPI factor from 1.3223 to 1.3623 and is the entire
   * reason for doing this work. A success carrying an unread warning is this estate's
   * signature failure and this time it was mine.
   */
  const TRUNCATED = {
    status: 'REQUEST_SUCCEEDED',
    message: ['Year range has been reduced to the system-allowed limit of 10 years.'],
    Results: { series: [{ seriesID: 'CUUR0000SA0', data: [{ year: '2025', period: 'M13', value: '321.943', footnotes: [{}] }] }] },
  }

  it('surfaces the publisher warning instead of discarding it on success', () => {
    const r = parseBlsResponse(TRUNCATED, OPTS)
    expect(r.warnings).toEqual(['Year range has been reduced to the system-allowed limit of 10 years.'])
    // The observations are real and usable. The warning is what says they are INCOMPLETE.
    expect(r.observations).toHaveLength(1)
  })

  it('★ names the requested years that came back with nothing at all', () => {
    const r = parseBlsResponse(TRUNCATED, OPTS)
    const missing = missingYears(r, { seriesId: 'CUUR0000SA0', startYear: 2024, endYear: 2026 })
    // 2025 came back. 2024 and 2026 did not, and neither was reported as unpublished, so they
    // are absent for a reason the publisher did not state per-period.
    expect(missing).toEqual([2024, 2026])
  })

  it('does not accuse the publisher when a year is merely unpublished', () => {
    const r = parseBlsResponse(
      {
        status: 'REQUEST_SUCCEEDED',
        message: [],
        Results: { series: [{ seriesID: 'CUUR0000SA0', data: [{ year: '2026', period: 'M08', value: '-', footnotes: [{}] }] }] },
      },
      OPTS,
    )
    // The year WAS answered: the publisher said "not published yet" for a period in it. That
    // is an honest empty state, not a dropped year, and conflating them would make the loud
    // alarm fire every month on a normal publication lag.
    expect(missingYears(r, { seriesId: 'CUUR0000SA0', startYear: 2026, endYear: 2026 })).toEqual([])
  })

  it('splits a window so the limit is never reached in the first place', () => {
    expect(yearWindows(2016, 2026, 10)).toEqual([
      { startYear: 2016, endYear: 2025 },
      { startYear: 2026, endYear: 2026 },
    ])
    expect(yearWindows(2020, 2022, 10)).toEqual([{ startYear: 2020, endYear: 2022 }])
    expect(yearWindows(2000, 2026, 10)).toHaveLength(3)
  })
})

/* ---------------------------------------------------------------------------------- */
/* ★ A DATED SERIES NOBODY REFRESHES IS A SLOWER STALE CONSTANT                        */
/* ---------------------------------------------------------------------------------- */

describe('series freshness', () => {
  const AUG_2026 = Date.parse('2026-08-19T12:00:00Z')
  const row = (period_code: string, year: number, value = 300): SeriesObservation => ({
    series_id: 'CUUR0000SA0',
    period: `${year}-${period_code}`,
    year,
    period_code,
    value,
    vintage: '2026-08-19',
    retrieved_at: '2026-08-19T00:00:00.000Z',
    retrieval_method: 'api_fetch',
    retrieved_at_basis: 'http_response',
    source_url: 'x',
    footnotes: null,
  })

  it('treats one month behind as FRESH, because that is the publisher cadence', () => {
    // BLS publishes a month's CPI-U in the middle of the FOLLOWING month, so in August the
    // July reading is the newest that can exist. An alarm firing on a source's normal
    // operating lag is an alarm nobody reads by the end of the month.
    const [f] = measureSeriesFreshness([row('M07', 2026)], AUG_2026)
    expect(f!.monthsBehind).toBe(1)
    expect(f!.tone).toBe('fresh')
    expect(f!.measuredIn).toBe('2026-08')
    expect(seriesFreshnessReport([f!])).toEqual([])
  })

  it('escalates to aging and then stale, and says what to run', () => {
    expect(measureSeriesFreshness([row('M06', 2026)], AUG_2026)[0]!.tone).toBe('aging')
    const stale = measureSeriesFreshness([row('M01', 2026)], AUG_2026)[0]!
    expect(stale.monthsBehind).toBe(7)
    expect(stale.tone).toBe('stale')
    expect(seriesFreshnessReport([stale]).join('\n')).toContain('npm run ingest:series')
  })

  it('★ is NOT fooled by a recent ANNUAL AVERAGE, which is the comfortable number', () => {
    // A ledger holding 2025-M13 (the 2025 annual average) and nothing newer looks respectable
    // and is eight months behind on the monthly series the anchor actually resolves against.
    // Judging freshness by the annual average reports the flattering figure instead of the
    // true one, which is the same error as judging a solicitation against the newest day
    // captured rather than against today.
    const withAnnualOnly = measureSeriesFreshness([row('M13', 2025)], AUG_2026)[0]!
    expect(withAnnualOnly.newestMonthlyPeriod).toBeNull()
    expect(withAnnualOnly.tone).toBe('stale')
    expect(seriesFreshnessReport([withAnnualOnly]).join('\n')).toContain('NO MONTHLY READING HELD')

    // POSITIVE CONTROL: an annual average alongside a CURRENT monthly reading must not drag
    // the measurement down either. The annual is ignored in both directions.
    const both = measureSeriesFreshness([row('M13', 2025), row('M07', 2026)], AUG_2026)[0]!
    expect(both.newestMonthlyPeriod).toBe('2026-M07')
    expect(both.tone).toBe('fresh')
  })

  it('measures each series separately, so one current series cannot mask a dead one', () => {
    const dead = { ...row('M01', 2025), series_id: 'WPU10' }
    const out = measureSeriesFreshness([row('M07', 2026), dead], AUG_2026)
    expect(out.map((f) => [f.series_id, f.tone])).toEqual([
      ['CUUR0000SA0', 'fresh'],
      ['WPU10', 'stale'],
    ])
    expect(seriesFreshnessReport(out)).toHaveLength(1)
  })
})

/* ---------------------------------------------------------------------------------- */
/* ★ THE LEDGER MUST LIVE UNDER THE SAME DATA ROOT THE APPLICATION READS               */
/* ---------------------------------------------------------------------------------- */

describe('where the ledger lives', () => {
  it('★ shares a root with the archive, so it cannot be written where nothing reads', async () => {
    const { SERIES_ROOT: root } = await import('../../lib/ingest/series/store')
    const { dataPath, archivePath } = await import('../../lib/data-root')

    expect(root).toBe(dataPath('series'))
    // Same parent as the archive. If these ever diverge, one of them is being written to a
    // tree the application does not read, which is exactly what happened here.
    expect(dirname(root)).toBe(dirname(archivePath()))
  })

  it('★ POSITIVE CONTROL: the two roots are different MECHANISMS, not the same one twice', async () => {
    const { DATA_ROOT } = await import('../../lib/ingest/db')
    const { resolveDataRoot } = await import('../../lib/data-root')

    // A first draft of this control asserted the two paths were literally different, and it
    // passed in the repo and FAILED in a detached worktree -- because `resolveDataRoot()` only
    // returns `<cwd>/data` when that directory exists, and otherwise falls back to the same
    // development default `DATA_ROOT` hardcodes. So the two roots coincide exactly when nobody
    // is looking and diverge on the server. THAT is the defect, and a control whose result
    // depends on the caller's working directory cannot state it.
    //
    // So this asserts the thing that is true everywhere: they are governed by DIFFERENT
    // environment variables and therefore cannot be assumed to agree.
    const steered = resolveDataRoot({
      ...process.env,
      ONLYSOURCE_DATA_DIR: '/tmp/a-deliberately-different-root',
    })
    expect(steered.root).toBe('/tmp/a-deliberately-different-root')
    expect(steered.basis).toBe('ONLYSOURCE_DATA_DIR')

    // DATA_ROOT does not respond to that variable at all. It answers to ONLYSOURCE_DATA_ROOT
    // and otherwise to a hardcoded macOS home path, which is why it resolved to a directory
    // that does not exist on the production droplet.
    expect(DATA_ROOT).not.toBe(steered.root)
    expect(DATA_ROOT.startsWith('/Users/') || process.env.ONLYSOURCE_DATA_ROOT !== undefined).toBe(true)
  })
})
