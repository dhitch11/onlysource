/**
 * GATE R1.1 and R1.2. The auto-award clock, asserted as exact UTC instants.
 *
 * THE INSTRUMENT IS BUILT TO BE ABLE TO FAIL. Every expectation is a hand-computed UTC
 * instant written as an ISO string, never a value re-derived from the code under test. The
 * table straddles both real DST transitions, so a fixed -05:00 offset fails the two EDT rows
 * and a fixed -04:00 offset fails the two EST rows. There is no way for both to pass with a
 * broken offset, which is the property a single-date test does not have.
 *
 * DST ends 2026-11-01. DST begins 2027-03-14 (the second Sunday, not the 8th).
 */

import { describe, expect, it } from 'vitest'
import {
  AWARD_CLOCK,
  AWARD_CLOCK_PROVENANCE,
  CUTOFF_SWEEPS,
  addBusinessDays,
  awardClockIsFullyCited,
  awardDeadlineForIssueDate,
  cutoffInstantOn,
  deadlineDisclosure,
  nextDailyFire,
  zoneAbbrev,
} from '@/lib/domain/award-clock'
import { civilDayOfWeek, civilTimeExists } from '@/lib/time/zoned'
import { isObservedFederalHoliday } from '@/lib/time/federal-holidays'

const iso = (ms: number) => new Date(ms).toISOString()
const d = (year: number, month: number, day: number) => ({ year, month, day })

// 15:00 EDT is 19:00 UTC. 15:00 EST is 20:00 UTC. Written out, not generated, because a
// generated expectation shares the bug it is supposed to catch.
const TABLE = [
  { label: 'Fri 2026-10-30, EDT, two days before DST ends', date: d(2026, 10, 30), dow: 5, utc: '2026-10-30T19:00:00.000Z', abbrev: 'EDT',
    sweeps: { 'T-180m': '2026-10-30T16:00:00.000Z', 'T-60m': '2026-10-30T18:00:00.000Z', 'T-25m': '2026-10-30T18:35:00.000Z', 'T-10m': '2026-10-30T18:50:00.000Z', 'T+15m': '2026-10-30T19:15:00.000Z' } },
  { label: 'Mon 2026-11-02, EST, the day after DST ends', date: d(2026, 11, 2), dow: 1, utc: '2026-11-02T20:00:00.000Z', abbrev: 'EST',
    sweeps: { 'T-180m': '2026-11-02T17:00:00.000Z', 'T-60m': '2026-11-02T19:00:00.000Z', 'T-25m': '2026-11-02T19:35:00.000Z', 'T-10m': '2026-11-02T19:50:00.000Z', 'T+15m': '2026-11-02T20:15:00.000Z' } },
  { label: 'Fri 2027-03-12, EST, two days before DST begins', date: d(2027, 3, 12), dow: 5, utc: '2027-03-12T20:00:00.000Z', abbrev: 'EST',
    sweeps: { 'T-180m': '2027-03-12T17:00:00.000Z', 'T-60m': '2027-03-12T19:00:00.000Z', 'T-25m': '2027-03-12T19:35:00.000Z', 'T-10m': '2027-03-12T19:50:00.000Z', 'T+15m': '2027-03-12T20:15:00.000Z' } },
  { label: 'Mon 2027-03-15, EDT, the day after DST begins', date: d(2027, 3, 15), dow: 1, utc: '2027-03-15T19:00:00.000Z', abbrev: 'EDT',
    sweeps: { 'T-180m': '2027-03-15T16:00:00.000Z', 'T-60m': '2027-03-15T18:00:00.000Z', 'T-25m': '2027-03-15T18:35:00.000Z', 'T-10m': '2027-03-15T18:50:00.000Z', 'T+15m': '2027-03-15T19:15:00.000Z' } },
] as const

describe('R1.1 exact UTC instants across both DST transitions', () => {
  it('covers both offsets, so a hardcoded offset cannot pass the table', () => {
    expect(new Set(TABLE.map((r) => r.abbrev))).toEqual(new Set(['EDT', 'EST']))
  })

  for (const row of TABLE) {
    describe(row.label, () => {
      it('is the weekday the row claims', () => {
        expect(civilDayOfWeek(row.date.year, row.date.month, row.date.day)).toBe(row.dow)
      })
      it('resolves 3:00 PM to the exact UTC instant', () => {
        expect(iso(cutoffInstantOn(row.date))).toBe(row.utc)
      })
      it('reports the offset the zone database actually had that day', () => {
        expect(zoneAbbrev(cutoffInstantOn(row.date))).toBe(row.abbrev)
      })
      for (const sweep of CUTOFF_SWEEPS) {
        it(`resolves sweep ${sweep.key} exactly`, () => {
          const fire = nextDailyFire(cutoffInstantOn(row.date) - 60_000)
          expect(iso(fire.sweeps[sweep.key])).toBe(row.sweeps[sweep.key])
        })
      }
      it('does not fire twice inside the same second', () => {
        const at = cutoffInstantOn(row.date)
        expect(nextDailyFire(at).instantMs).toBeGreaterThan(at)
      })
    })
  }

  it('proves it can fail: a fixed -5h offset is wrong on the EDT rows', () => {
    const naive = (r: (typeof TABLE)[number]) =>
      iso(Date.UTC(r.date.year, r.date.month - 1, r.date.day, 20, 0, 0))
    const edt = TABLE.find((r) => r.abbrev === 'EDT')!
    expect(naive(edt)).not.toBe(edt.utc)
    expect(iso(cutoffInstantOn(edt.date))).toBe(edt.utc)
  })
})

/**
 * THE CORRECTION. The previous module carried a single `firstFireBusinessDayOffset: 1`,
 * which conflated the CITED 3-business-day deadline with the 1-business-day operational
 * margin. These tests exist to make that conflation impossible to reintroduce.
 */
describe('R1 the cited deadline is 3 business days after issue, and the margin is separate', () => {
  it('holds the two numbers as two distinct named constants', () => {
    expect(AWARD_CLOCK.citedBusinessDaysAfterIssue).toBe(3)
    expect(AWARD_CLOCK.operationalMarginBusinessDays).toBe(1)
    expect(AWARD_CLOCK.citedBusinessDaysAfterIssue).not.toBe(
      AWARD_CLOCK.operationalMarginBusinessDays,
    )
  })

  it('counts three plain weekdays when no weekend or holiday intervenes', () => {
    // Mon 2026-11-02 issued. Tue 3rd is day 1, Wed 4th day 2, Thu 5th day 3.
    expect(civilDayOfWeek(2026, 11, 2)).toBe(1)
    const deadline = awardDeadlineForIssueDate(d(2026, 11, 2))
    expect(deadline.date).toBe('2026-11-05')
    expect(iso(deadline.instantMs)).toBe('2026-11-05T20:00:00.000Z')
    // The margin is one business day earlier.
    expect(deadline.actByDate).toBe('2026-11-04')
    expect(iso(deadline.actByInstantMs)).toBe('2026-11-04T20:00:00.000Z')
  })

  it('skips the weekend, so a Thursday issue does not land on a Sunday', () => {
    // Thu 2026-10-29 issued. Fri 30th is day 1, Mon Nov 2 day 2, Tue Nov 3 day 3.
    expect(civilDayOfWeek(2026, 10, 29)).toBe(4)
    const deadline = awardDeadlineForIssueDate(d(2026, 10, 29))
    expect(deadline.date).toBe('2026-11-03')
  })

  it('crosses the DST boundary correctly inside a single requirement window', () => {
    // Issued in EDT, deadline lands in EST. The instant must be 20:00 UTC, not 19:00.
    const deadline = awardDeadlineForIssueDate(d(2026, 10, 29))
    expect(zoneAbbrev(deadline.instantMs)).toBe('EST')
    expect(iso(deadline.instantMs)).toBe('2026-11-03T20:00:00.000Z')
  })

  it('skips an observed federal holiday inside the window', () => {
    // Wed 2026-07-01 issued. Thu 2nd is day 1. Fri 3rd is the OBSERVED Independence Day and
    // does not count. Mon 6th is day 2, Tue 7th is day 3.
    expect(civilDayOfWeek(2026, 7, 1)).toBe(3)
    expect(isObservedFederalHoliday(d(2026, 7, 3))).toBe(true)
    const deadline = awardDeadlineForIssueDate(d(2026, 7, 1))
    expect(deadline.date).toBe('2026-07-07')
    expect(iso(deadline.instantMs)).toBe('2026-07-07T19:00:00.000Z')
  })

  it('walks the margin BACK across a weekend rather than losing it', () => {
    // Wed 2026-10-28 issued: Thu 29 (1), Fri 30 (2), Mon Nov 2 (3). Deadline Monday.
    // One business day earlier is the preceding FRIDAY, not Sunday.
    const deadline = awardDeadlineForIssueDate(d(2026, 10, 28))
    expect(deadline.date).toBe('2026-11-02')
    expect(deadline.actByDate).toBe('2026-10-30')
    expect(civilDayOfWeek(2026, 10, 30)).toBe(5)
  })

  it('always acts strictly before the cited deadline', () => {
    for (let day = 1; day <= 28; day += 1) {
      const deadline = awardDeadlineForIssueDate(d(2026, 7, day))
      expect(deadline.actByInstantMs).toBeLessThan(deadline.instantMs)
    }
  })

  it('never lands a deadline on a weekend or an observed holiday, across a full year', () => {
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= 28; day += 1) {
        const deadline = awardDeadlineForIssueDate(d(2026, month, day))
        const [y, m, dd] = deadline.date.split('-').map(Number)
        const dow = civilDayOfWeek(y!, m!, dd!)
        expect(dow).toBeGreaterThanOrEqual(1)
        expect(dow).toBeLessThanOrEqual(5)
        expect(isObservedFederalHoliday({ year: y!, month: m!, day: dd! })).toBe(false)
      }
    }
  })

  it('proves the business-day walker is not just adding calendar days', () => {
    // Three calendar days from Thu 2026-10-29 is Sun Nov 1. Three BUSINESS days is Tue Nov 3.
    expect(addBusinessDays(d(2026, 10, 29), 3)).toEqual(d(2026, 11, 3))
  })
})

describe('R1.2 each component of the reading carries its own evidence grade', () => {
  it('grades the offset CITED, with the citation recorded', () => {
    expect(AWARD_CLOCK_PROVENANCE.offset.grade).toBe('CITED')
    expect(AWARD_CLOCK_PROVENANCE.offset.citation).toContain('Master Solicitation')
  })

  /*
   * UPDATED 2026-08-13 by @T6-AUTOMATION. This assertion previously required the timezone to be
   * ESTIMATED with a null citation, and it was correct when written. The fact changed: the zone
   * was read from primary text (Master Solicitation Rev-81, RETURN DATE AND TIME section) and
   * the PDF was on disk the whole time. The research recorded it unverifiable because dla.mil
   * returns 403, which was a block on FETCHING the document, not on HAVING it.
   *
   * The test is kept strict in the other direction now: the citation must be real, and the
   * grade must be CITED and never VERIFIED, because para 2(h) does not restate the zone.
   */
  it('grades the timezone CITED with a real citation, and never claims VERIFIED', () => {
    expect(AWARD_CLOCK_PROVENANCE.timezone.grade).toBe('CITED')
    expect(AWARD_CLOCK_PROVENANCE.timezone.citation).toContain('Master Solicitation Rev-81')
    expect(AWARD_CLOCK_PROVENANCE.timezone.citation).toContain('Eastern Standard Time')
    // The sweep inherits the zone rather than citing it, so the strongest honest grade is CITED.
    expect(AWARD_CLOCK_PROVENANCE.timezone.grade).not.toBe('VERIFIED')
  })

  it('grades the weekend and federal-holiday rollover CITED, scoped to the return date', () => {
    expect(AWARD_CLOCK_PROVENANCE.weekendHolidayRollover.grade).toBe('CITED')
    expect(AWARD_CLOCK_PROVENANCE.weekendHolidayRollover.citation)
      .toContain('Saturday, Sunday or federal holiday')
    // The honesty that matters: the cited sentence extends the RETURN DATE. Applying it to the
    // sweep is our reading, and the note must say so rather than quietly widening the citation.
    expect(AWARD_CLOCK_PROVENANCE.weekendHolidayRollover.note).toContain('our reading')
  })

  it('grades the counting convention UNVERIFIED rather than pretending it is settled', () => {
    expect(AWARD_CLOCK_PROVENANCE.countingConvention.grade).toBe('UNVERIFIED')
  })

  it('is not fully cited, so every customer-facing deadline renders labeled', () => {
    expect(awardClockIsFullyCited()).toBe(false)
  })

  it('returns one qualifier PER unresolved component, not a single blanket hedge', () => {
    const disclosure = deadlineDisclosure(cutoffInstantOn(d(2026, 11, 2)))
    expect(disclosure.estimated).toBe(true)
    // ONE qualifier now, not two. The timezone was cited from primary text on 2026-08-13, so a
    // qualifier for it would be a hedge on a settled fact, which is its own kind of dishonesty.
    // The counting convention is genuinely still open and still earns its qualifier.
    expect(disclosure.qualifiers.length).toBe(1)
    expect(disclosure.qualifiers.some((q) => q.toLowerCase().includes('counting'))).toBe(true)
    // The offset and the timezone are BOTH cited, so nothing may imply either is open.
    expect(disclosure.qualifiers.some((q) => q.includes('3 business day'))).toBe(false)
    expect(disclosure.qualifiers.some((q) => q.toLowerCase().includes('timezone'))).toBe(false)
    expect(disclosure.label).toContain('3:00 PM EST')
  })
})

describe('observed federal holidays, where a midweek-holiday test would prove nothing', () => {
  /*
   * The literal ISO strings are carried alongside the constructed dates ON PURPOSE.
   * THE-ACCEPTANCE-GATE R1.1 names 2026-07-03 and 2027-07-05 by date, and a reviewer or a
   * coverage script will grep for exactly those strings. Building them with d(2026, 7, 3)
   * made the assertions real but ungreppable, so an audit would have reported this gate
   * uncovered while it was passing. `key` below is asserted against the constructed date,
   * so the two can never drift apart silently.
   */
  const cases = [
    { key: '2026-07-03', observed: d(2026, 7, 3), statutoryDow: 6, next: '2026-07-06' },
    { key: '2027-07-05', observed: d(2027, 7, 5), statutoryDow: 0, next: '2027-07-06' },
  ]
  for (const c of cases) {
    const key = c.key
    it(`${key}: the literal gate date matches the constructed date, so grep and code agree`, () => {
      const built = `${c.observed.year}-${String(c.observed.month).padStart(2, '0')}-${String(c.observed.day).padStart(2, '0')}`
      expect(built).toBe(c.key)
    })
    it(`${key}: the statutory 4 July falls on a weekend, so this date is the observed holiday`, () => {
      expect(civilDayOfWeek(c.observed.year, 7, 4)).toBe(c.statutoryDow)
      expect(isObservedFederalHoliday(c.observed)).toBe(true)
      // And it is a weekday, so the no-fire below cannot pass just because it is a weekend.
      const dow = civilDayOfWeek(c.observed.year, c.observed.month, c.observed.day)
      expect(dow).toBeGreaterThanOrEqual(1)
      expect(dow).toBeLessThanOrEqual(5)
    })
    it(`${key}: does not fire, and the next fire is the following business day`, () => {
      const startOfDay = Date.UTC(c.observed.year, c.observed.month - 1, c.observed.day, 4, 0, 0)
      const fire = nextDailyFire(startOfDay)
      expect(fire.date).not.toBe(key)
      expect(fire.date).toBe(c.next)
    })
  }

  it('rolls a Friday evening forward to Monday, not Saturday', () => {
    expect(nextDailyFire(cutoffInstantOn(d(2026, 10, 30)) + 60_000).date).toBe('2026-11-02')
  })
})

describe('the cutoff wall time is a real wall time in its zone', () => {
  it('15:00 America/New_York exists on every day of both transition weeks', () => {
    for (const day of [d(2026, 10, 30), d(2026, 10, 31), d(2026, 11, 1), d(2026, 11, 2), d(2027, 3, 12), d(2027, 3, 13), d(2027, 3, 14), d(2027, 3, 15)]) {
      expect(civilTimeExists(AWARD_CLOCK.zone, day.year, day.month, day.day, 15, 0)).toBe(true)
    }
  })

  it('still admits 02:30 does not exist on the spring-forward morning', () => {
    expect(civilTimeExists(AWARD_CLOCK.zone, 2027, 3, 14, 2, 30)).toBe(false)
  })
})
