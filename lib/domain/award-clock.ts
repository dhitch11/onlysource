/**
 * THE AUTO-AWARD CLOCK. One constant set, one file. Display and scheduler both import THIS.
 * Gate R1.1 states plainly that three copies of these dates is a FAIL.
 *
 * Stored as a wall-clock local time plus an IANA zone, never a UTC constant and never a fixed
 * offset, because the deadline does not move when the offset does.
 *
 * ==========================================================================================
 * THREE SEPARATE FACTS LIVE HERE AND THEY HAVE THREE DIFFERENT EVIDENCE GRADES.
 * Conflating them is the defect this file exists to prevent, and the previous version of
 * this module did conflate them.
 * ==========================================================================================
 *
 *   1. THE OFFSET IS CITED.       3 business days after issue.
 *                                 DLA Master Solicitation Part I para 2(h), Rev-81 = Rev-104.
 *                                 The DIBBS FAQ 31 "1 business day" reading is a
 *                                 NON-CONTRACTUAL PARAPHRASE. It is not the deadline. It
 *                                 survives here only as the operational scheduling margin.
 *
 *   2. THE TIMEZONE IS CITED.     Eastern, from primary text, as of 2026-08-13.
 *                                 Master Solicitation Rev-81 (2021-08-23), RETURN DATE AND
 *                                 TIME section, verbatim: "The time for receipt of quotations
 *                                 is 3:00 P.M. Eastern Standard Time, or when applicable,
 *                                 Eastern Daylight Savings Time on the return date."
 *                                 "Eastern" occurs exactly twice in the whole document, both
 *                                 in that sentence, and no other zone appears anywhere.
 *                                 GRADED HONESTLY: this is CITED FOR THE STATED DEADLINE and
 *                                 INHERITED BY THE SWEEP. Para 2(h) says "3:00 P.M." and does
 *                                 NOT restate the zone, so the sweep's zone is an inheritance
 *                                 from the same document, not its own citation. That is why
 *                                 this reads CITED and never VERIFIED.
 *                                 The text also settles EST/EDT explicitly, which is why the
 *                                 zone is stored as an IANA name and never as an offset.
 *
 *   3. THE COUNTING CONVENTION IS UNVERIFIED. "3 business days after issue" does not say
 *                                 whether the issue day counts. This module counts
 *                                 EXCLUSIVELY (the day after issue is business day 1), which
 *                                 is the conservative reading because it lands the deadline
 *                                 EARLIER. Being early costs nothing. Being late is silent
 *                                 and unrecoverable.
 *
 * When any of the three is confirmed, exactly one file changes: this one.
 */

import type { Clock } from '../time/clock'
import { isNonBusinessDay } from '../time/federal-holidays'
import { addCivilDays, civilDateString, civilInZone, zonedTimeToInstant } from '../time/zoned'

export type EvidenceGrade = 'CITED' | 'ESTIMATED' | 'UNVERIFIED'

export const AWARD_CLOCK = {
  /** Wall-clock local time of the auto-award cutoff, 24 hour. */
  localTime: { hour: 15, minute: 0 },
  /** IANA zone. Never an offset. CITED from primary text; see `provenance.timezone`. */
  zone: 'America/New_York',
  /** The deadline itself: business days after issue. CITED. */
  citedBusinessDaysAfterIssue: 3,
  /**
   * How far ahead of the cited deadline we actually act. Not a deadline, a safety margin.
   * Early costs nothing; late is silent and unrecoverable.
   */
  operationalMarginBusinessDays: 1,
} as const

export const AWARD_CLOCK_PROVENANCE = {
  offset: {
    grade: 'CITED' as EvidenceGrade,
    value: '3 business days after issue',
    citation:
      'DLA Master Solicitation Rev-104, Part I para 2(h), quoted: "Fast Auto Evaluation commences at 3:00 P.M., 3 business days after the issue date, and continues every day thereafter at 3:00 P.M. until the return date." (Rev-81 = Rev-104 for this paragraph.)',
    note: 'DIBBS FAQ 31 "1 business day" is a non-contractual paraphrase and is NOT the deadline. It is retained only as the operational scheduling margin. VERBATIM QUOTE ADDED 2026-08-17: the grade was already CITED, but the citation named the paragraph without reproducing it, so a reader had to take the reading on trust. It now carries the sentence, from research/dla-procurement-mechanics.md:231 where it is recorded VERIFIED against a full read of the current Rev 104. Provenance a reader can check beats provenance a reader must believe. NOTE WHAT THIS DOES NOT SETTLE: the sentence says "3 business days after the issue date" and is silent on whether the issue day itself counts, so `countingConvention` below stays UNVERIFIED. The quote strengthens the OFFSET and does not touch the CONVENTION; treating one as evidence for the other is how a citation gets stretched past what it says.',
  },
  timezone: {
    grade: 'CITED' as EvidenceGrade,
    value: 'America/New_York',
    citation:
      'DLA Master Solicitation Rev-81 (2021-08-23), RETURN DATE AND TIME section: "The time for receipt of quotations is 3:00 P.M. Eastern Standard Time, or when applicable, Eastern Daylight Savings Time on the return date."',
    note: 'Read from primary text 2026-08-13 (pdftotext over the Rev-81 PDF held on disk). "Eastern" occurs exactly twice in the document, both in that one sentence; no other timezone appears. CITED FOR THE STATED DEADLINE AND INHERITED BY THE SWEEP: para 2(h) states "3:00 P.M." without restating the zone, so the sweep inherits it from the same document rather than carrying its own citation. Graded CITED, never VERIFIED.',
  },
  /**
   * The weekend and federal-holiday rollover, which is what the business-day service runs on.
   * Cited by the sentence immediately following the timezone sentence.
   *
   * `isNonBusinessDay()` implemented this as a reasonable assumption before there was a
   * citation for it. There is one now (T1's observation, recorded here on merge).
   *
   * DEDUPE NOTE, 2026-08-13: T1 and T6 independently added a provenance entry for this same
   * sentence within a minute of each other (commits 858abb2 and a592f2f), producing TWO records
   * of one fact in the file whose own header calls three copies of a date a FAIL. Merged to
   * this single entry, which carries the fuller citation and the scope caveat. The duplicate
   * `businessDayRollover` key is gone; nothing referenced it.
   *
   * Scope kept honest: the cited sentence extends the RETURN DATE. It does not, in terms, say
   * the Fast Auto sweep skips a holiday. Treating the sweep as skipping non-business days is
   * our reading, and it is the safe one, because it never invents an earlier fire.
   */
  weekendHolidayRollover: {
    grade: 'CITED' as EvidenceGrade,
    value: 'a return date on a Saturday, Sunday or federal holiday moves to the next business day',
    citation:
      'DLA Master Solicitation Rev-81 (2021-08-23), RETURN DATE AND TIME section: "If a return date falls on a Saturday, Sunday or federal holiday, the return date will be extended to the next business day."',
    note: 'Read from primary text 2026-08-13. Applies in terms to the RETURN DATE. Its application to the sweep is our reading, taken because it can only move a fire later, never earlier.',
  },
  countingConvention: {
    grade: 'UNVERIFIED' as EvidenceGrade,
    value: 'exclusive of the issue day (the next business day is day 1)',
    citation: null as string | null,
    note: 'The cited text does not say whether the issue day counts. Exclusive counting is used because it lands the deadline earlier, which is the safe direction.',
  },
} as const

/** True while ANY component of the reading is short of CITED. Drives the labeled state. */
export function awardClockIsFullyCited(): boolean {
  return (
    // Every component, checked by iteration rather than by a hand-written list.
    // The hand-written list had already drifted: `weekendHolidayRollover` was added by the
    // 08-13 merge and this function was never updated, so a future downgrade of the
    // rollover would have left `fullyCited` reporting true. A gate that silently stops
    // covering a component is the failure mode this whole module argues against.
    Object.values(AWARD_CLOCK_PROVENANCE).every((part) => part.grade === 'CITED')
  )
}

/** The five staged sweeps, as minute offsets from the cutoff instant. */
export const CUTOFF_SWEEPS = [
  { key: 'T-180m', offsetMinutes: -180 },
  { key: 'T-60m', offsetMinutes: -60 },
  { key: 'T-25m', offsetMinutes: -25 },
  { key: 'T-10m', offsetMinutes: -10 },
  { key: 'T+15m', offsetMinutes: 15 },
] as const

export type SweepKey = (typeof CUTOFF_SWEEPS)[number]['key']

export type CivilDate = { year: number; month: number; day: number }

/** The exact UTC instant of 3:00 PM in the cutoff zone on a given civil date. */
export function cutoffInstantOn(date: CivilDate): number {
  return zonedTimeToInstant(
    AWARD_CLOCK.zone,
    date.year,
    date.month,
    date.day,
    AWARD_CLOCK.localTime.hour,
    AWARD_CLOCK.localTime.minute,
  )
}

/** Advance `count` BUSINESS days from a civil date, skipping weekends and observed holidays. */
export function addBusinessDays(from: CivilDate, count: number): CivilDate {
  let cursor: CivilDate = from
  let remaining = count
  let guard = 0
  while (remaining > 0) {
    cursor = addCivilDays(cursor.year, cursor.month, cursor.day, 1)
    if (!isNonBusinessDay(cursor)) remaining -= 1
    guard += 1
    if (guard > 400) {
      throw new Error('award-clock: 400 days without finding enough business days')
    }
  }
  return cursor
}

export type AwardDeadline = {
  /** UTC instant of the cited auto-award cutoff. */
  instantMs: number
  /** Civil date of the cutoff in the cutoff zone, YYYY-MM-DD. */
  date: string
  /** UTC instant we actually schedule against, one business day earlier. */
  actByInstantMs: number
  actByDate: string
  /** The five staged sweeps for the cutoff fire. */
  sweeps: Record<SweepKey, number>
}

/**
 * The auto-award deadline for a requirement issued on a given civil date.
 *
 * THIS IS THE FUNCTION EVERY LANE SHOULD CALL. It returns both the cited deadline and the
 * instant we act by, because a caller that only gets the deadline will schedule against it
 * and be exactly on time, which for a silent automated award means too late.
 */
export function awardDeadlineForIssueDate(issued: CivilDate): AwardDeadline {
  const cutoffDate = addBusinessDays(issued, AWARD_CLOCK.citedBusinessDaysAfterIssue)
  const instantMs = cutoffInstantOn(cutoffDate)

  // The margin walks BACK business days from the cutoff date, so a weekend or a holiday
  // between the two does not silently eat the margin.
  const actByDate = subtractBusinessDays(cutoffDate, AWARD_CLOCK.operationalMarginBusinessDays)
  const actByInstantMs = cutoffInstantOn(actByDate)

  const sweeps = {} as Record<SweepKey, number>
  for (const s of CUTOFF_SWEEPS) sweeps[s.key] = instantMs + s.offsetMinutes * 60_000

  return {
    instantMs,
    date: civilDateString(instantMs, AWARD_CLOCK.zone),
    actByInstantMs,
    actByDate: civilDateString(actByInstantMs, AWARD_CLOCK.zone),
    sweeps,
  }
}

function subtractBusinessDays(from: CivilDate, count: number): CivilDate {
  let cursor: CivilDate = from
  let remaining = count
  let guard = 0
  while (remaining > 0) {
    cursor = addCivilDays(cursor.year, cursor.month, cursor.day, -1)
    if (!isNonBusinessDay(cursor)) remaining -= 1
    guard += 1
    if (guard > 400) {
      throw new Error('award-clock: 400 days without finding enough business days')
    }
  }
  return cursor
}

export type DailyFire = {
  instantMs: number
  date: string
  sweeps: Record<SweepKey, number>
}

/**
 * The next daily 3:00 PM fire strictly after `fromMs`, skipping weekends and observed
 * federal holidays. This is the SWEEP schedule, not a requirement's deadline.
 *
 * "Strictly after" is deliberate: a scheduler that treats the current instant as eligible
 * double-fires when it restarts inside the cutoff second.
 */
export function nextDailyFire(fromMs: number): DailyFire {
  const civil = civilInZone(fromMs, AWARD_CLOCK.zone)
  let candidate: CivilDate = { year: civil.year, month: civil.month, day: civil.day }

  for (let i = 0; i < 400; i += 1) {
    if (!isNonBusinessDay(candidate)) {
      const instant = cutoffInstantOn(candidate)
      if (instant > fromMs) {
        const sweeps = {} as Record<SweepKey, number>
        for (const s of CUTOFF_SWEEPS) sweeps[s.key] = instant + s.offsetMinutes * 60_000
        return { instantMs: instant, date: civilDateString(instant, AWARD_CLOCK.zone), sweeps }
      }
    }
    candidate = addCivilDays(candidate.year, candidate.month, candidate.day, 1)
  }
  throw new Error('award-clock: no business day within 400 days, the holiday table is wrong')
}

export function nextDailyFireFrom(clock: Clock): DailyFire {
  return nextDailyFire(clock.now())
}

export type DeadlineDisclosure = {
  instantMs: number
  label: string
  /** TRUE while any component is short of CITED. Customer-facing surfaces MUST render this. */
  estimated: boolean
  /** One qualifier line per component that is not CITED. Never a single vague sentence. */
  qualifiers: string[]
}

/**
 * The ONE function customer-facing surfaces call to describe a deadline.
 *
 * It returns a qualifier PER UNRESOLVED COMPONENT rather than one blanket sentence, because
 * the previous version said "not yet confirmed against primary text" about the whole
 * reading, which simultaneously understated a fact that IS cited and overstated confidence
 * in one that is not. A blanket hedge is its own kind of inaccuracy.
 */
export function deadlineDisclosure(instantMs: number): DeadlineDisclosure {
  const qualifiers: string[] = []

  if (AWARD_CLOCK_PROVENANCE.timezone.grade !== 'CITED') {
    qualifiers.push(
      'Timezone is estimated. Eastern is inferred from context, not from primary text.',
    )
  }
  // Repointed on the 2026-08-13 dedupe: T1's `businessDayRollover` and T6's
  // `weekendHolidayRollover` were two records of one sentence, merged into the latter.
  if (AWARD_CLOCK_PROVENANCE.weekendHolidayRollover.grade !== 'CITED') {
    qualifiers.push('The weekend and holiday rollover rule is not confirmed.')
  }
  if (AWARD_CLOCK_PROVENANCE.countingConvention.grade !== 'CITED') {
    qualifiers.push(
      'Business-day counting excludes the issue day. That convention is not stated in the cited text, and it is the earlier of the two readings.',
    )
  }
  if (AWARD_CLOCK_PROVENANCE.offset.grade !== 'CITED') {
    qualifiers.push('The 3 business day offset is not confirmed against primary text.')
  }

  return {
    instantMs,
    label: formatInZone(instantMs),
    estimated: qualifiers.length > 0,
    qualifiers,
  }
}

/** Render an instant in the cutoff zone. Display and scheduler share this file. */
export function formatInZone(instantMs: number): string {
  const c = civilInZone(instantMs, AWARD_CLOCK.zone)
  const p2 = (n: number) => String(n).padStart(2, '0')
  const h12 = c.hour % 12 === 0 ? 12 : c.hour % 12
  const ampm = c.hour < 12 ? 'AM' : 'PM'
  return `${c.year}-${p2(c.month)}-${p2(c.day)} ${h12}:${p2(c.minute)} ${ampm} ${zoneAbbrev(instantMs)}`
}

/** EST or EDT, resolved from the zone database rather than guessed from the month. */
export function zoneAbbrev(instantMs: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AWARD_CLOCK.zone,
    timeZoneName: 'short',
  }).formatToParts(new Date(instantMs))
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? 'ET'
}
