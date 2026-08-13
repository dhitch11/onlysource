/**
 * THE AWARD CUTOFF. One constant set. Display logic and scheduler logic both import THIS
 * file, and gate R1.1 states plainly that three copies of these dates is a FAIL.
 *
 * Stored as a local time plus an IANA zone, never as a UTC constant and never as a fixed
 * offset, because the wall-clock deadline does not move when the offset does.
 *
 * ---------------------------------------------------------------------------------------
 * PROVENANCE, AND WHY EVERY DEADLINE THIS PRODUCES RENDERS LABELED
 * ---------------------------------------------------------------------------------------
 * Gate R1.2 is disqualifying while the cutoff reading is unresolved AND unlabeled. It is
 * unresolved: the domain fact carried into this build states 3:00 PM Eastern the next
 * business day, then daily, and the war room separately flags that the DLA primary text
 * states no timezone, and that the 1-versus-3-business-day offset is contested.
 *
 * So this module ships two things at once. The arithmetic, which is correct for whatever
 * reading is finally confirmed, and an honest `provenance` block saying the reading is not
 * confirmed. `deadlineDisclosure()` is what customer-facing surfaces must render. When
 * somebody confirms the reading from primary text, exactly one file changes: this one.
 */

import type { Clock } from './clock'
import { isNonBusinessDay } from './federal-holidays'
import { addCivilDays, civilDateString, civilInZone, zonedTimeToInstant } from './zoned'

export const AWARD_CUTOFF = {
  /** Wall-clock local time of the cutoff, 24 hour. */
  localTime: { hour: 15, minute: 0 },
  /** IANA zone. Never an offset. */
  zone: 'America/New_York',
  /** Business days after publication that the cutoff first applies. Contested, see below. */
  firstFireBusinessDayOffset: 1,
} as const

export const CUTOFF_PROVENANCE = {
  statedAs: '3:00 PM Eastern, the next business day, then daily',
  source: 'HANDOFFS/00-READ-THIS-FIRST.md section 6, restated in T1-FOUNDATION.md 4.10',
  /**
   * FALSE until somebody reads DLA primary text and records the citation here.
   * While this is false, every customer-facing deadline renders the labeled state and the
   * R1.2 laundering lint fails any copy that asserts the reading as settled fact.
   */
  primaryTextConfirmed: false,
  primaryTextCitation: null as string | null,
  contested: [
    'The DLA primary text does not state a timezone. Eastern is the working reading, not a citation.',
    'The offset from publication is recorded as 1 business day here and as 3 business days elsewhere.',
  ],
} as const

/**
 * The five staged sweeps, as offsets in minutes from the cutoff instant.
 * Named because a bare number in a scheduler is unreadable at 2 AM during an incident.
 */
export const CUTOFF_SWEEPS = [
  { key: 'T-180m', offsetMinutes: -180 },
  { key: 'T-60m', offsetMinutes: -60 },
  { key: 'T-25m', offsetMinutes: -25 },
  { key: 'T-10m', offsetMinutes: -10 },
  { key: 'T+15m', offsetMinutes: 15 },
] as const

export type SweepKey = (typeof CUTOFF_SWEEPS)[number]['key']

/** The exact UTC instant of the cutoff on a given civil date in the cutoff zone. */
export function cutoffInstantOn(year: number, month: number, day: number): number {
  return zonedTimeToInstant(
    AWARD_CUTOFF.zone,
    year,
    month,
    day,
    AWARD_CUTOFF.localTime.hour,
    AWARD_CUTOFF.localTime.minute,
  )
}

/** The exact UTC instant of one staged sweep on a given civil date. */
export function sweepInstantOn(
  year: number,
  month: number,
  day: number,
  sweep: SweepKey,
): number {
  const found = CUTOFF_SWEEPS.find((s) => s.key === sweep)
  if (!found) throw new Error(`cutoff: unknown sweep ${sweep}`)
  return cutoffInstantOn(year, month, day) + found.offsetMinutes * 60_000
}

export type CutoffFire = {
  /** UTC instant of the cutoff. */
  instantMs: number
  /** Civil date in the cutoff zone, YYYY-MM-DD. */
  date: string
  /** UTC instants of the five staged sweeps for this fire, keyed by sweep name. */
  sweeps: Record<SweepKey, number>
}

/**
 * The next cutoff fire strictly after `fromMs`, skipping weekends and observed federal
 * holidays.
 *
 * "Strictly after" is deliberate. A scheduler that treats the current instant as still
 * eligible double-fires the moment it restarts inside the cutoff second.
 */
export function nextCutoffFire(fromMs: number): CutoffFire {
  const civil = civilInZone(fromMs, AWARD_CUTOFF.zone)
  let candidate = { year: civil.year, month: civil.month, day: civil.day }

  for (let i = 0; i < 400; i += 1) {
    if (!isNonBusinessDay(candidate)) {
      const instant = cutoffInstantOn(candidate.year, candidate.month, candidate.day)
      if (instant > fromMs) {
        const sweeps = {} as Record<SweepKey, number>
        for (const s of CUTOFF_SWEEPS) sweeps[s.key] = instant + s.offsetMinutes * 60_000
        return {
          instantMs: instant,
          date: civilDateString(instant, AWARD_CUTOFF.zone),
          sweeps,
        }
      }
    }
    candidate = addCivilDays(candidate.year, candidate.month, candidate.day, 1)
  }
  // 400 consecutive non-business days is not a calendar, it is a bug in the holiday table.
  throw new Error('cutoff: no business day found within 400 days, holiday table is wrong')
}

/** Convenience wrapper for callers that hold a clock rather than an instant. */
export function nextCutoffFireFrom(clock: Clock): CutoffFire {
  return nextCutoffFire(clock.now())
}

export type DeadlineDisclosure = {
  /** The instant the deadline falls, UTC. */
  instantMs: number
  /** How the deadline should be described, in the operator's own terms. */
  label: string
  /**
   * TRUE while the reading is unconfirmed. A customer-facing surface that renders a
   * deadline MUST render this qualifier. Gate R1.2 is disqualifying otherwise.
   */
  unconfirmed: boolean
  /** The qualifier text itself, so every surface says the same thing. */
  qualifier: string | null
}

/**
 * The one function customer-facing surfaces call to describe a deadline.
 *
 * It refuses to hand back a bare instant while the reading is unconfirmed, which is what
 * stops a well-meaning surface from printing "due 3:00 PM ET" as settled fact.
 */
export function deadlineDisclosure(instantMs: number): DeadlineDisclosure {
  const confirmed = CUTOFF_PROVENANCE.primaryTextConfirmed
  return {
    instantMs,
    label: formatCutoffLocal(instantMs),
    unconfirmed: !confirmed,
    qualifier: confirmed
      ? null
      : 'Cutoff time not yet confirmed against DLA primary text. Treat as our working reading, not a citation.',
  }
}

/** Render an instant in the cutoff zone. Display path and scheduler path share this file. */
export function formatCutoffLocal(instantMs: number): string {
  const c = civilInZone(instantMs, AWARD_CUTOFF.zone)
  const p2 = (n: number) => String(n).padStart(2, '0')
  const h12 = c.hour % 12 === 0 ? 12 : c.hour % 12
  const ampm = c.hour < 12 ? 'AM' : 'PM'
  const zoneAbbrev = easternAbbrev(instantMs)
  return `${c.year}-${p2(c.month)}-${p2(c.day)} ${h12}:${p2(c.minute)} ${ampm} ${zoneAbbrev}`
}

/** EST or EDT, resolved from the zone database rather than guessed from the month. */
export function easternAbbrev(instantMs: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AWARD_CUTOFF.zone,
    timeZoneName: 'short',
  }).formatToParts(new Date(instantMs))
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? 'ET'
}
