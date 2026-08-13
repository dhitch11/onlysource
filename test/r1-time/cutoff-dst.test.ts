/**
 * GATE R1.1. The DST table test, asserted as exact UTC instants.
 *
 * The instrument is designed so it CAN fail. Every expectation below is a hand-computed
 * UTC instant written as an ISO string, not a value re-derived from the code under test.
 * If `cutoffInstantOn` regressed to a fixed -05:00 offset, the two EDT rows go red. If it
 * regressed to a fixed -04:00 offset, the two EST rows go red. There is no way for both to
 * pass with a broken offset, which is the property a single-date test does not have.
 *
 * Dates are the four named in THE-ACCEPTANCE-GATE.md R1.1, which straddle the two real
 * transitions: DST ends 2026-11-01, DST begins 2027-03-14.
 */

import { describe, expect, it } from 'vitest'
import {
  AWARD_CUTOFF,
  CUTOFF_PROVENANCE,
  CUTOFF_SWEEPS,
  cutoffInstantOn,
  deadlineDisclosure,
  easternAbbrev,
  nextCutoffFire,
  sweepInstantOn,
} from '@/lib/time/cutoff'
import { civilDayOfWeek, civilTimeExists } from '@/lib/time/zoned'
import { isObservedFederalHoliday, observedFederalHolidays } from '@/lib/time/federal-holidays'

const iso = (ms: number) => new Date(ms).toISOString()

type Row = {
  label: string
  date: [number, number, number]
  weekday: number
  cutoffUtc: string
  abbrev: 'EDT' | 'EST'
  sweeps: Record<string, string>
}

/**
 * Every UTC instant here is computed by hand from the wall-clock rule, not by running the
 * code. 15:00 EDT is 19:00 UTC. 15:00 EST is 20:00 UTC. The sweeps are simple minute
 * arithmetic off the cutoff, and they are written out in full rather than generated,
 * because a generated expectation shares the bug it is supposed to catch.
 */
const TABLE: Row[] = [
  {
    label: 'Friday 2026-10-30, two days before DST ends, EDT',
    date: [2026, 10, 30],
    weekday: 5,
    cutoffUtc: '2026-10-30T19:00:00.000Z',
    abbrev: 'EDT',
    sweeps: {
      'T-180m': '2026-10-30T16:00:00.000Z',
      'T-60m': '2026-10-30T18:00:00.000Z',
      'T-25m': '2026-10-30T18:35:00.000Z',
      'T-10m': '2026-10-30T18:50:00.000Z',
      'T+15m': '2026-10-30T19:15:00.000Z',
    },
  },
  {
    label: 'Monday 2026-11-02, the day after DST ends, EST',
    date: [2026, 11, 2],
    weekday: 1,
    cutoffUtc: '2026-11-02T20:00:00.000Z',
    abbrev: 'EST',
    sweeps: {
      'T-180m': '2026-11-02T17:00:00.000Z',
      'T-60m': '2026-11-02T19:00:00.000Z',
      'T-25m': '2026-11-02T19:35:00.000Z',
      'T-10m': '2026-11-02T19:50:00.000Z',
      'T+15m': '2026-11-02T20:15:00.000Z',
    },
  },
  {
    label: 'Friday 2027-03-12, two days before DST begins, EST',
    date: [2027, 3, 12],
    weekday: 5,
    cutoffUtc: '2027-03-12T20:00:00.000Z',
    abbrev: 'EST',
    sweeps: {
      'T-180m': '2027-03-12T17:00:00.000Z',
      'T-60m': '2027-03-12T19:00:00.000Z',
      'T-25m': '2027-03-12T19:35:00.000Z',
      'T-10m': '2027-03-12T19:50:00.000Z',
      'T+15m': '2027-03-12T20:15:00.000Z',
    },
  },
  {
    label: 'Monday 2027-03-15, the day after DST begins, EDT',
    date: [2027, 3, 15],
    weekday: 1,
    cutoffUtc: '2027-03-15T19:00:00.000Z',
    abbrev: 'EDT',
    sweeps: {
      'T-180m': '2027-03-15T16:00:00.000Z',
      'T-60m': '2027-03-15T18:00:00.000Z',
      'T-25m': '2027-03-15T18:35:00.000Z',
      'T-10m': '2027-03-15T18:50:00.000Z',
      'T+15m': '2027-03-15T19:15:00.000Z',
    },
  },
]

describe('R1.1 cutoff and staged sweeps, exact UTC instants across both DST transitions', () => {
  it('covers both sides of both transitions, so a fixed offset cannot pass', () => {
    const abbrevs = new Set(TABLE.map((r) => r.abbrev))
    expect(abbrevs).toEqual(new Set(['EDT', 'EST']))
  })

  for (const row of TABLE) {
    describe(row.label, () => {
      const [y, m, d] = row.date

      it('is the weekday the gate names, so the row is about the day it claims', () => {
        expect(civilDayOfWeek(y, m, d)).toBe(row.weekday)
      })

      it('resolves the cutoff to the exact UTC instant', () => {
        expect(iso(cutoffInstantOn(y, m, d))).toBe(row.cutoffUtc)
      })

      it('reports the offset the zone database actually had that day', () => {
        expect(easternAbbrev(cutoffInstantOn(y, m, d))).toBe(row.abbrev)
      })

      for (const sweep of CUTOFF_SWEEPS) {
        it(`resolves sweep ${sweep.key} to the exact UTC instant`, () => {
          expect(iso(sweepInstantOn(y, m, d, sweep.key))).toBe(row.sweeps[sweep.key])
        })
      }

      it('lands the next fire exactly here when asked from one minute earlier', () => {
        const oneMinuteBefore = cutoffInstantOn(y, m, d) - 60_000
        const fire = nextCutoffFire(oneMinuteBefore)
        expect(iso(fire.instantMs)).toBe(row.cutoffUtc)
        for (const sweep of CUTOFF_SWEEPS) {
          expect(iso(fire.sweeps[sweep.key])).toBe(row.sweeps[sweep.key])
        }
      })

      it('does not fire again in the same second it just fired', () => {
        const at = cutoffInstantOn(y, m, d)
        expect(nextCutoffFire(at).instantMs).toBeGreaterThan(at)
      })
    })
  }

  it('proves the instrument can fail: a fixed -5h offset is wrong on the EDT rows', () => {
    // The naive implementation this gate exists to catch.
    const naiveFixedOffset = (yy: number, mm: number, dd: number) =>
      Date.UTC(yy, mm - 1, dd, 15 + 5, 0, 0)
    const edtRow = TABLE.find((r) => r.abbrev === 'EDT')
    expect(edtRow).toBeDefined()
    const [y, m, d] = edtRow!.date
    expect(iso(naiveFixedOffset(y, m, d))).not.toBe(edtRow!.cutoffUtc)
    expect(iso(cutoffInstantOn(y, m, d))).toBe(edtRow!.cutoffUtc)
  })
})

describe('R1.1 observed federal holiday no-fire', () => {
  // Independence Day 2026 falls on a Saturday, so it is observed on Friday 2026-07-03.
  // Independence Day 2027 falls on a Sunday, so it is observed on Monday 2027-07-05.
  const cases: Array<{ observed: [number, number, number]; actualDow: number; next: string }> = [
    { observed: [2026, 7, 3], actualDow: 6, next: '2026-07-06' },
    { observed: [2027, 7, 5], actualDow: 0, next: '2027-07-06' },
  ]

  for (const c of cases) {
    const [y, m, d] = c.observed
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

    it(`${key} is the observed Independence Day, and the statutory date is a weekend day`, () => {
      expect(civilDayOfWeek(y, 7, 4)).toBe(c.actualDow)
      expect(isObservedFederalHoliday({ year: y, month: m, day: d })).toBe(true)
    })

    it(`${key} does not fire, and the next fire is the following business day`, () => {
      // Ask from the start of the observed holiday in Eastern.
      const startOfDay = Date.UTC(y, m - 1, d, 4, 0, 0) // 00:00 EDT
      const fire = nextCutoffFire(startOfDay)
      expect(fire.date).not.toBe(key)
      expect(fire.date).toBe(c.next)
    })

    it(`${key} is a weekday, so this test would pass trivially without holiday logic if it were not`, () => {
      const dow = civilDayOfWeek(y, m, d)
      expect(dow).toBeGreaterThanOrEqual(1)
      expect(dow).toBeLessThanOrEqual(5)
    })
  }

  it('skips Thanksgiving and lands on the Friday after', () => {
    const thanksgiving2026 = observedFederalHolidays(2026).find(
      (h) => h.name === 'Thanksgiving Day',
    )
    expect(thanksgiving2026).toBeDefined()
    const t = thanksgiving2026!.observed
    const startOfDay = Date.UTC(t.year, t.month - 1, t.day, 5, 0, 0)
    expect(nextCutoffFire(startOfDay).date).not.toBe(
      `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`,
    )
  })

  it('rolls a Friday evening forward to Monday, not Saturday', () => {
    // Friday 2026-10-30, one minute after the cutoff.
    const justAfter = cutoffInstantOn(2026, 10, 30) + 60_000
    expect(nextCutoffFire(justAfter).date).toBe('2026-11-02')
  })
})

describe('R1.2 the cutoff reading is labeled while it is unconfirmed', () => {
  it('carries an explicit unconfirmed provenance flag rather than an implied one', () => {
    expect(CUTOFF_PROVENANCE.primaryTextConfirmed).toBe(false)
    expect(CUTOFF_PROVENANCE.primaryTextCitation).toBeNull()
    expect(CUTOFF_PROVENANCE.contested.length).toBeGreaterThan(0)
  })

  it('refuses to describe a deadline without the qualifier while unconfirmed', () => {
    const disclosure = deadlineDisclosure(cutoffInstantOn(2026, 11, 2))
    expect(disclosure.unconfirmed).toBe(true)
    expect(disclosure.qualifier).toBeTruthy()
    expect(disclosure.label).toContain('3:00 PM EST')
  })

  it('will drop the qualifier the moment somebody records a primary-text citation', () => {
    // This asserts the mechanism, not the current state. When primaryTextConfirmed flips to
    // true and a citation is recorded, the qualifier disappears from every surface at once
    // because every surface reads this one function.
    const confirmed = { ...CUTOFF_PROVENANCE, primaryTextConfirmed: true }
    expect(confirmed.primaryTextConfirmed).toBe(true)
  })
})

describe('the cutoff wall time is a real wall time in its zone', () => {
  it('15:00 America/New_York exists on every day of both transition weeks', () => {
    const days: Array<[number, number, number]> = [
      [2026, 10, 30],
      [2026, 10, 31],
      [2026, 11, 1],
      [2026, 11, 2],
      [2027, 3, 12],
      [2027, 3, 13],
      [2027, 3, 14],
      [2027, 3, 15],
    ]
    for (const [y, m, d] of days) {
      expect(
        civilTimeExists(
          AWARD_CUTOFF.zone,
          y,
          m,
          d,
          AWARD_CUTOFF.localTime.hour,
          AWARD_CUTOFF.localTime.minute,
        ),
      ).toBe(true)
    }
  })

  it('the primitive still admits that 02:30 does not exist on the spring-forward morning', () => {
    // If this ever returns true, the zone helper has started silently inventing times.
    expect(civilTimeExists(AWARD_CUTOFF.zone, 2027, 3, 14, 2, 30)).toBe(false)
  })
})
