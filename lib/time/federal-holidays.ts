/**
 * United States federal holidays, with the observance rule from 5 U.S.C. 6103(b).
 *
 * This exists because the award clock is a BUSINESS-day clock. A scheduler that only skips
 * Saturday and Sunday fires on Thanksgiving, and the requirement it was chasing was never
 * going to be awarded that day.
 *
 * The observance rule, stated because it is the part people get wrong:
 *   a fixed-date holiday on a Saturday is observed the preceding Friday,
 *   a fixed-date holiday on a Sunday is observed the following Monday.
 * That is why Independence Day 2026 is observed on Friday 2026-07-03, and Independence Day
 * 2027 on Monday 2027-07-05. A test written on a holiday that falls midweek passes while
 * proving nothing.
 *
 * The Saturday case for New Year's Day reaches backward into the previous December, so
 * `observedFederalHolidays(year)` returns any 31 December date that is in force for the
 * following year's New Year's Day.
 *
 * SCOPE, stated honestly: these are FEDERAL holidays. Whether DLA suspends automated award
 * on every one of them, and on no other day, is not confirmed from primary text. The
 * calendar is correct; its application to the award clock carries the same unconfirmed flag
 * as the cutoff itself. See `lib/domain/award-clock.ts` provenance.
 */

import { addCivilDays, civilDayOfWeek } from './zoned'

export type CivilDate = { year: number; month: number; day: number }

export type FederalHoliday = {
  /** The observed date, which is what actually closes the office. */
  observed: CivilDate
  /** The statutory date, which can differ from the observed date. */
  actual: CivilDate
  name: string
}

const p2 = (n: number) => String(n).padStart(2, '0')

export function dateKey(d: CivilDate): string {
  return `${d.year}-${p2(d.month)}-${p2(d.day)}`
}

/** The nth given weekday of a month. `nth` of -1 means the last one in the month. */
function nthWeekdayOf(year: number, month: number, weekday: number, nth: number): CivilDate {
  if (nth > 0) {
    const firstDow = civilDayOfWeek(year, month, 1)
    const offset = (weekday - firstDow + 7) % 7
    return { year, month, day: 1 + offset + (nth - 1) * 7 }
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const lastDow = civilDayOfWeek(year, month, daysInMonth)
  const back = (lastDow - weekday + 7) % 7
  return { year, month, day: daysInMonth - back }
}

/** Apply 5 U.S.C. 6103(b) to a fixed-date holiday. */
function observeFixed(actual: CivilDate): CivilDate {
  const dow = civilDayOfWeek(actual.year, actual.month, actual.day)
  if (dow === 6) return addCivilDays(actual.year, actual.month, actual.day, -1) // Saturday to Friday
  if (dow === 0) return addCivilDays(actual.year, actual.month, actual.day, 1) // Sunday to Monday
  return actual
}

/**
 * Every federal holiday observed during the given calendar year.
 *
 * Includes a 31 December entry when the NEXT year's New Year's Day falls on a Saturday,
 * because that Friday is the observed holiday and it lands in this year.
 */
export function observedFederalHolidays(year: number): FederalHoliday[] {
  const fixed: Array<[string, number, number]> = [
    ["New Year's Day", 1, 1],
    ['Juneteenth National Independence Day', 6, 19],
    ['Independence Day', 7, 4],
    ['Veterans Day', 11, 11],
    ['Christmas Day', 12, 25],
  ]

  const out: FederalHoliday[] = []

  for (const [name, month, day] of fixed) {
    const actual = { year, month, day }
    out.push({ name, actual, observed: observeFixed(actual) })
  }

  const floating: Array<[string, number, number, number]> = [
    ['Birthday of Martin Luther King, Jr.', 1, 1, 3], // third Monday in January
    ["Washington's Birthday", 2, 1, 3], // third Monday in February
    ['Memorial Day', 5, 1, -1], // last Monday in May
    ['Labor Day', 9, 1, 1], // first Monday in September
    ['Columbus Day', 10, 1, 2], // second Monday in October
    ['Thanksgiving Day', 11, 4, 4], // fourth Thursday in November
  ]

  for (const [name, month, weekday, nth] of floating) {
    const d = nthWeekdayOf(year, month, weekday, nth)
    out.push({ name, actual: d, observed: d })
  }

  // Next year's New Year's Day on a Saturday is observed on 31 December of THIS year.
  const nextNewYear = { year: year + 1, month: 1, day: 1 }
  if (civilDayOfWeek(nextNewYear.year, 1, 1) === 6) {
    out.push({
      name: "New Year's Day (observed)",
      actual: nextNewYear,
      observed: { year, month: 12, day: 31 },
    })
  }

  // A Saturday 1 January is observed on the previous 31 December, so it does not close a
  // day in this year. Drop it here and let the previous year carry it.
  return out.filter((h) => h.observed.year === year)
}

const CACHE = new Map<number, Set<string>>()

/** The observed-holiday date keys for a year, memoised. */
export function observedHolidayKeys(year: number): Set<string> {
  let s = CACHE.get(year)
  if (!s) {
    s = new Set(observedFederalHolidays(year).map((h) => dateKey(h.observed)))
    CACHE.set(year, s)
  }
  return s
}

export function isObservedFederalHoliday(d: CivilDate): boolean {
  return observedHolidayKeys(d.year).has(dateKey(d))
}

/** Saturday, Sunday, or an observed federal holiday. */
export function isNonBusinessDay(d: CivilDate): boolean {
  const dow = civilDayOfWeek(d.year, d.month, d.day)
  if (dow === 0 || dow === 6) return true
  return isObservedFederalHoliday(d)
}
