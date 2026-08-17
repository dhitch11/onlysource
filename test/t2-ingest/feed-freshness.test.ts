/**
 * T2 INGESTION. The freshness pill's tone, measured in the publisher's own calendar.
 *
 * The pill previously wore a hardcoded ok-state. These tests pin the replacement to the
 * definition it claims: age in US FEDERAL BUSINESS DAYS on the EASTERN civil calendar,
 * because DLA publishes one file set per business day, Eastern time. Each boundary below is
 * chosen so a plausible wrong implementation (calendar days, UTC dates, no holiday
 * awareness) fails at least one case.
 */

import { describe, expect, it } from 'vitest'
import { measureFeedFreshness } from '../../lib/ingest/feed-days'

/** Friday 2026-08-14 is a real published-shape feed day for these cases. */
const FRIDAY = '2026-08-14'

describe('fresh: 0 or 1 business day behind is the newest publishable state', () => {
  it('a Friday feed day read on SATURDAY is 0 behind: no newer file can exist yet', () => {
    const f = measureFeedFreshness(FRIDAY, Date.parse('2026-08-15T12:00:00-04:00'))
    expect(f.businessDaysBehind).toBe(0)
    expect(f.tone).toBe('fresh')
  })

  it('a Friday feed day read on MONDAY is 1 behind and still fresh', () => {
    const f = measureFeedFreshness(FRIDAY, Date.parse('2026-08-17T09:00:00-04:00'))
    expect(f.businessDaysBehind).toBe(1)
    expect(f.tone).toBe('fresh')
  })

  it('a feed day read on its own day is 0 behind', () => {
    const f = measureFeedFreshness('2026-08-17', Date.parse('2026-08-17T15:00:00-04:00'))
    expect(f.businessDaysBehind).toBe(0)
    expect(f.tone).toBe('fresh')
  })

  it('uses the EASTERN civil date: late Monday UTC-evening is still Monday in Washington', () => {
    // 2026-08-18T02:00Z is Monday 22:00 Eastern. A UTC-date implementation reads Tuesday
    // and calls this aging; the publisher's calendar says 1 behind, fresh.
    const f = measureFeedFreshness(FRIDAY, Date.parse('2026-08-18T02:00:00Z'))
    expect(f.measuredOn).toBe('2026-08-17')
    expect(f.businessDaysBehind).toBe(1)
    expect(f.tone).toBe('fresh')
  })
})

describe('aging: 2 or 3 business days behind means capture is being missed', () => {
  it('Friday read on Tuesday is 2 behind', () => {
    const f = measureFeedFreshness(FRIDAY, Date.parse('2026-08-18T12:00:00-04:00'))
    expect(f.businessDaysBehind).toBe(2)
    expect(f.tone).toBe('aging')
  })

  it('Friday read on Wednesday is 3 behind, the last aging state', () => {
    const f = measureFeedFreshness(FRIDAY, Date.parse('2026-08-19T12:00:00-04:00'))
    expect(f.businessDaysBehind).toBe(3)
    expect(f.tone).toBe('aging')
  })
})

describe('stale: beyond 3 business days, the retention window is consuming unbought history', () => {
  it('Friday read on Thursday is 4 behind and stale', () => {
    const f = measureFeedFreshness(FRIDAY, Date.parse('2026-08-20T12:00:00-04:00'))
    expect(f.businessDaysBehind).toBe(4)
    expect(f.tone).toBe('stale')
  })

  it('the one loaded feed day of this build, aged to the day this gate shipped', () => {
    // 2026-08-11 (Tuesday) measured on Monday 2026-08-17: Wed, Thu, Fri, Mon = 4. The pill
    // that hardcoded ok-state was calling THIS state fine.
    const f = measureFeedFreshness('2026-08-11', Date.parse('2026-08-17T09:00:00-04:00'))
    expect(f.businessDaysBehind).toBe(4)
    expect(f.tone).toBe('stale')
  })
})

describe('federal holidays do not count as missed days', () => {
  it('Wednesday before Thanksgiving, read on Friday, is 1 behind: Thanksgiving is skipped', () => {
    // Thanksgiving 2026 falls on Thursday 2026-11-26. A weekday-only implementation
    // counts 2 here and wrongly ages the pill over a day DLA never published.
    const f = measureFeedFreshness('2026-11-25', Date.parse('2026-11-27T12:00:00-05:00'))
    expect(f.businessDaysBehind).toBe(1)
    expect(f.tone).toBe('fresh')
  })
})

describe('refusals', () => {
  it('refuses a date it cannot parse rather than measuring garbage', () => {
    expect(() => measureFeedFreshness('08/14/26', Date.parse('2026-08-15T12:00:00Z'))).toThrow()
  })
})
