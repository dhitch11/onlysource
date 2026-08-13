/**
 * Timezone arithmetic with no dependency and no fixed offsets.
 *
 * A fixed UTC offset for "Eastern" is wrong for roughly half the year and the failure is
 * silent: the deadline renders, the scheduler fires, and it is an hour off for five months.
 * Everything here resolves through the IANA database that ships with the runtime.
 */

const PART_CACHE = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = PART_CACHE.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    PART_CACHE.set(zone, f)
  }
  return f
}

export type CivilDateTime = {
  year: number
  month: number // 1 to 12
  day: number // 1 to 31
  hour: number // 0 to 23
  minute: number
  second: number
}

/** The wall-clock civil time in `zone` at a given UTC instant. */
export function civilInZone(instantMs: number, zone: string): CivilDateTime {
  const parts = formatterFor(zone).formatToParts(new Date(instantMs))
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type)
    if (!found) throw new Error(`zoned: missing ${type} for zone ${zone}`)
    return Number(found.value)
  }
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  }
}

/** The offset of `zone` from UTC, in milliseconds, at a given UTC instant. */
export function zoneOffsetMs(instantMs: number, zone: string): number {
  const c = civilInZone(instantMs, zone)
  const asIfUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second)
  // Round to the second because the formatter drops sub-second precision.
  return asIfUtc - Math.floor(instantMs / 1000) * 1000
}

/**
 * The UTC instant at which the wall clock in `zone` reads the given civil time.
 *
 * Two iterations converge for every real zone, including the ones with 30 and 45 minute
 * offsets. The result is verified by reading the civil time back, which is what makes this
 * safe across a DST boundary: on a spring-forward gap the requested wall time does not
 * exist, and on a fall-back overlap it happens twice.
 */
export function zonedTimeToInstant(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): number {
  const target = Date.UTC(year, month - 1, day, hour, minute, second)
  let instant = target
  for (let i = 0; i < 3; i += 1) {
    const next = target - zoneOffsetMs(instant, zone)
    if (next === instant) break
    instant = next
  }
  return instant
}

/**
 * Whether the requested civil time actually exists in `zone`.
 *
 * On the spring-forward morning, 02:30 America/New_York does not exist. Any scheduler that
 * assumes it does will fire at a time nobody asked for. The 3:00 PM cutoff is nowhere near
 * a transition boundary, but the primitive refuses to lie about it, and a future lane will
 * schedule something at 2 AM.
 */
export function civilTimeExists(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): boolean {
  const instant = zonedTimeToInstant(zone, year, month, day, hour, minute)
  const back = civilInZone(instant, zone)
  return (
    back.year === year &&
    back.month === month &&
    back.day === day &&
    back.hour === hour &&
    back.minute === minute
  )
}

/** The civil calendar date in `zone`, as a `YYYY-MM-DD` string. */
export function civilDateString(instantMs: number, zone: string): string {
  const c = civilInZone(instantMs, zone)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${c.year}-${p2(c.month)}-${p2(c.day)}`
}

/** Day of week for a civil date, 0 Sunday through 6 Saturday. Calendar arithmetic only. */
export function civilDayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Advance a civil date by whole days. Returns a new civil date, no time component. */
export function addCivilDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() + days)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}
