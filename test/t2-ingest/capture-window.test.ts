/**
 * A SCHEDULE THAT CANNOT SEE A HOLE WILL NEVER FILL ONE.
 *
 * The daily capture used to walk back from the newest business day and STOP at the first day
 * that answered with data. Production captured 2026-08-17 at 06:18 and lost it to a stale
 * restore hours later; the next morning's run would have found 08-18, stopped, and never
 * returned for it. A deleted day was permanently invisible to the only process that could
 * have noticed.
 *
 * THESE TESTS DRIVE THE REAL `captureWindow`, through the repo's own fake consented client,
 * and assert on THE DAYS THE ORIGIN WAS ACTUALLY ASKED ABOUT. An earlier draft of this file
 * asserted against a reimplementation of the walk instead, which would have been the exact
 * defect this whole night has been about: an instrument that only examines its own handiwork
 * confirms your write, not the state of the system.
 *
 * NO NETWORK, AND NO WRITES TO THE REAL ARCHIVE. `INGEST_ARCHIVE_ROOT` points at a temp
 * directory before the module is imported, because a 404 is a manifest row and these tests
 * generate a lot of them.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
const ORIGINAL_ROOT = process.env.INGEST_ARCHIVE_ROOT

/** Newest first, exactly the order businessDaysBack() produces. */
const WINDOW = ['2026-08-18', '2026-08-17', '2026-08-14', '2026-08-13', '2026-08-12']

const indexName = (day: string): string => `in${day.slice(2).replace(/-/g, '')}.txt`
const heldKey = (day: string): string => `${day}/${indexName(day)}`

beforeEach(() => {
  vi.resetModules()
  const root = mkdtempSync(join(tmpdir(), 'onlysource-window-'))
  roots.push(root)
  process.env.INGEST_ARCHIVE_ROOT = root
})

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
  if (ORIGINAL_ROOT === undefined) delete process.env.INGEST_ARCHIVE_ROOT
  else process.env.INGEST_ARCHIVE_ROOT = ORIGINAL_ROOT
})

/**
 * A client that answers every request with the origin's 404, and records what it was asked
 * for. 404 is the right default here: it is the outcome that made the OLD walk continue and
 * the NEW walk continue, so it isolates the thing under test, which is WHICH DAYS GET ASKED.
 */
function recordingClient(status = 404) {
  const askedFor: string[] = []
  const client = {
    host: 'dibbs2',
    async get(path: string) {
      askedFor.push(path)
      return {
        status,
        headers: { 'content-type': 'text/html' },
        finalUrl: `https://dibbs2.bsm.dla.mil${path}`,
        bytes: async () => Buffer.alloc(0),
      }
    },
    async refresh() {},
  }
  return { provider: async () => client, askedFor }
}

/** The feed days a run actually put a question to the origin about, in order. */
function daysAsked(askedFor: readonly string[]): string[] {
  return askedFor
    .map((p) => /in(\d{2})(\d{2})(\d{2})\.txt$/.exec(p))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `20${m[1]}-${m[2]}-${m[3]}`)
}

/* ---------------------------------------------------------------------------------- */
/* THE HOLE IN THE MIDDLE OF THE WINDOW                                                */
/* ---------------------------------------------------------------------------------- */

describe('a day lost from the middle of the window', () => {
  it('★ is asked for, on the morning after the newest day has already been captured', async () => {
    const { captureWindow } = await import('../../scripts/ingest/capture-shared')
    const { provider, askedFor } = recordingClient()

    // THE PRODUCTION CONDITION, exactly. 08-18 published and captured overnight, everything
    // older held, and 08-17 the hole left by the restore. Under the old stop-at-first-hit
    // walk this run would have looked at 08-18, found it held, and stopped forever.
    const held = new Set(
      ['2026-08-18', '2026-08-14', '2026-08-13', '2026-08-12'].map(heldKey),
    )

    const report = await captureWindow(provider as never, WINDOW, ['in'], held, {
      wafStrikes: 0,
      requestsMade: 0,
    })

    expect(daysAsked(askedFor)).toEqual(['2026-08-17'])
    expect(report.requested).toEqual(['2026-08-17'])
    expect(report.alreadyComplete).toEqual([
      '2026-08-18',
      '2026-08-14',
      '2026-08-13',
      '2026-08-12',
    ])
    expect(report.stopReason).toBe('window_complete')
  })

  it('costs the origin nothing when the whole window is held', async () => {
    const { captureWindow } = await import('../../scripts/ingest/capture-shared')
    const { provider, askedFor } = recordingClient()
    const held = new Set(WINDOW.map(heldKey))

    const report = await captureWindow(provider as never, WINDOW, ['in'], held, {
      wafStrikes: 0,
      requestsMade: 0,
    })

    // The steady state has to stay free, or a window walk is just a daily re-download.
    expect(askedFor).toEqual([])
    expect(report.requested).toEqual([])
    expect(report.alreadyComplete).toEqual(WINDOW)
  })

  it('walks PAST an unpublished newest day to reach an older gap, in one run', async () => {
    const { captureWindow } = await import('../../scripts/ingest/capture-shared')
    const { provider, askedFor } = recordingClient()
    // Nothing held for the two newest. A 404 on 08-18 must not end the walk, because the
    // origin legitimately has not published today's file yet at 06:15.
    const held = new Set(['2026-08-14', '2026-08-13', '2026-08-12'].map(heldKey))

    const report = await captureWindow(provider as never, WINDOW, ['in'], held, {
      wafStrikes: 0,
      requestsMade: 0,
    })

    expect(daysAsked(askedFor)).toEqual(['2026-08-18', '2026-08-17'])
    expect(report.stopReason).toBe('window_complete')
  }, 20_000)
})

/* ---------------------------------------------------------------------------------- */
/* THE REQUEST BUDGET, BECAUSE PACING IS CITIZENSHIP                                   */
/* ---------------------------------------------------------------------------------- */

describe('the per-run request budget', () => {
  it('stops at the cap and reports it, rather than fetching a whole window in one burst', async () => {
    const { captureWindow } = await import('../../scripts/ingest/capture-shared')
    const { provider, askedFor } = recordingClient()

    const report = await captureWindow(provider as never, WINDOW, ['in'], new Set(), {
      wafStrikes: 0,
      requestsMade: 0,
    }, { maxDaysRequested: 2 })

    expect(daysAsked(askedFor)).toEqual(['2026-08-18', '2026-08-17'])
    expect(report.requested).toEqual(['2026-08-18', '2026-08-17'])
    expect(report.stopReason).toBe('request_budget_spent')

    // AND THE DAYS BEYOND THE CAP ARE NOT CLAIMED EITHER WAY. An unmeasured day reported as
    // absent is the same class of lie as a manifest vouching for bytes it does not hold.
    expect(report.alreadyComplete).not.toContain('2026-08-12')
    expect(report.requested).not.toContain('2026-08-12')
  }, 20_000)

  it('has a default below the measured WAF threshold', async () => {
    const { DEFAULT_MAX_DAYS_REQUESTED, DEFAULT_WINDOW_DAYS } = await import(
      '../../scripts/ingest/capture-shared'
    )
    // The F5 ASM in front of DIBBS is measured on this estate to trip at roughly 30 rapid
    // requests. Three file kinds times the cap has to stay well under that.
    expect(DEFAULT_MAX_DAYS_REQUESTED * 3).toBeLessThan(30)
    expect(DEFAULT_WINDOW_DAYS).toBeGreaterThanOrEqual(DEFAULT_MAX_DAYS_REQUESTED)
  })
})

/* ---------------------------------------------------------------------------------- */
/* A REFUSAL THAT IS NOT ABSENCE STILL STOPS THE WALK                                  */
/* ---------------------------------------------------------------------------------- */

describe('a refusal that is not the origin saying the day does not exist', () => {
  it('stops the walk instead of papering over it with an older success', async () => {
    const { captureWindow } = await import('../../scripts/ingest/capture-shared')
    // 500 is not "this day was never published". Walking on would hide a real outage behind
    // a day that happened to work.
    const { provider, askedFor } = recordingClient(500)

    const report = await captureWindow(provider as never, WINDOW, ['in'], new Set(), {
      wafStrikes: 0,
      requestsMade: 0,
    })

    expect(report.stopReason).toBe('refusal')
    // The claim is about WHICH DAYS the walk reached, not how many times it asked about one.
    // A 500 legitimately costs a second request: the consent client refreshes and retries the
    // same file once, which is correct behaviour and not the walk moving on.
    expect([...new Set(daysAsked(askedFor))]).toEqual(['2026-08-18'])
    expect(daysAsked(askedFor)).not.toContain('2026-08-17')
    expect(report.requested).toEqual(['2026-08-18'])
  }, 20_000)
})
