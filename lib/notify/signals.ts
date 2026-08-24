import { resolveDataRoot } from '@/lib/data-root'
import { buildPortfolio } from '@/lib/intelligence/portfolio'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { systemClock } from '@/lib/time/clock'
import { nextDailyFireFrom, formatInZone } from '@/lib/domain/award-clock'

/**
 * THE SIGNAL ENGINE — what an operator should act on right now, computed from the live feed.
 *
 * Every signal is a real, measured fact about today's data: a deadline the clock owns, corners that
 * line up on every measured leg, the size of the no-quote make-side. Nothing here is "new since
 * yesterday" (there is no prior-day snapshot yet, so that claim would be invented); these are
 * current-state signals worth an operator's attention. Each one names a number we measured and links
 * to the surface where the operator works it.
 *
 * The engine is the single source both the in-app notification centre and the email digest read, so
 * a bell badge and an alert email can never disagree.
 */

export type SignalKind = 'award_clock' | 'perfect_storm' | 'no_quote' | 'escalation' | 'forecast'
export type SignalSeverity = 'high' | 'medium' | 'info'

export type Signal = {
  id: string
  kind: SignalKind
  severity: SignalSeverity
  title: string
  body: string
  href: string
  /**
   * The ONE stock number this signal names, when it names exactly one (the perfect-storm
   * leader, the escalation leader). Structured so a surface can wire an action to it (the
   * dashboard's Pursue) without parsing prose. Absent on aggregate signals, deliberately:
   * a "cutoff coming up" card names no part, so no part-level action can honestly hang on it.
   */
  nsn?: string
}

/** Human labels + one-line descriptions for each kind. Used by settings and the help affordance. */
export const SIGNAL_KINDS: Array<{ kind: SignalKind; label: string; describe: string }> = [
  { kind: 'award_clock', label: 'Award-cutoff deadline', describe: 'The 3:00 PM ET machine-award cutoff, every business day. Miss it and the buy is decided without you.' },
  { kind: 'perfect_storm', label: 'Perfect-storm corners', describe: 'Corners that line up on every measured leg at once: one silent source, on the forecast, machine-award, and a rising price.' },
  /*
   * ★ "NOBODY CAN SOURCE" WAS NEVER MEASURED, AND THIS LABEL USED TO SAY IT. Corrected 2026-08-24.
   *
   * The make-side set is the rows where the solicitation found no match in the availability
   * workbook. MEASURED over that set: 479 of 479 are solicitations ABSENT from
   * `no_quote_matches.xlsx` entirely, and ZERO were present and carrying no holder. Availability
   * join coverage over distinct solicitations is 350 of 803 looked up, 453 never looked up.
   *
   * So the set is exactly the set we did not query. Not one of those rows was checked and found
   * empty, which is the only thing that could support "nobody can source".
   *
   * The honest claim is an ABSENCE OF A MATCH over the suppliers the availability data covers.
   * `lib/thomas/tools.ts` already refuses the overclaim in the concierge's own voice, and
   * `app/(app)/goldmine/page.tsx` already labels the same count "no supplier matched". This
   * string and the dashboard tile were the last two surfaces still stating it as measured.
   */
  { kind: 'no_quote', label: 'No-quote make-side', describe: 'Government buys that drew zero quotes where no supplier matched in the availability data: likely built rather than sourced. That is an absence of a match over the suppliers that data covers, not proof nobody holds the part.' },
  { kind: 'escalation', label: 'Biggest price ramps', describe: 'The cornered parts where the sole source has pushed the price up the most.' },
  { kind: 'forecast', label: 'Forward demand', describe: 'How many candidate corners the government has put on its own forward-buy list.' },
]

const usd0 = (n: number): string => `$${Math.round(n).toLocaleString()}`

export type SignalSet = {
  present: boolean
  feedDay: string | null
  generatedAtMs: number
  signals: Signal[]
}

/**
 * Compute every signal from today's feed. Pure read of the memoized datasets; safe to call per
 * request. Returns an honest empty set when the data directory is not mounted.
 */
export function computeSignals(): SignalSet {
  const generatedAtMs = systemClock.now()
  if (!resolveDataRoot().present) {
    return { present: false, feedDay: null, generatedAtMs, signals: [] }
  }

  const pf = buildPortfolio()
  const { noQuote } = buildAllDatasets()
  const signals: Signal[] = []

  // 1. The clock. Always present, because the deadline is real every business day.
  const fire = nextDailyFireFrom(systemClock)
  signals.push({
    id: `award_clock:${fire.instantMs}`,
    kind: 'award_clock',
    severity: 'high',
    title: 'Machine-award cutoff coming up',
    body: `The next automated award cutoff is ${formatInZone(fire.instantMs)}. Machine-award corners are decided on price at that moment, so anything you mean to bid has to be in before it.`,
    href: '/monopoly',
  })

  // 2. Perfect-storm corners: silent + on forecast + machine award + rising price.
  const storm = pf.topCorners.filter(
    (c) => c.onForecast && c.machineAward && (c.escalationPct ?? 0) > 0,
  )
  if (storm.length > 0) {
    const top = storm[0]!
    signals.push({
      id: `perfect_storm:${storm.length}`,
      kind: 'perfect_storm',
      severity: 'high',
      title: `${storm.length} perfect-storm ${storm.length === 1 ? 'corner' : 'corners'} right now`,
      body: `${storm.length} ${storm.length === 1 ? 'corner lines' : 'corners line'} up on every measured leg at once: the source is silent, it is on the forecast, it awards by machine, and the price is rising. The strongest is ${top.nsn} (${top.item}).`,
      href: '/monopoly',
      nsn: top.nsn,
    })
  }

  // 3. No-quote make-side.
  if (noQuote.summary.makeSideOnly > 0) {
    signals.push({
      id: `no_quote:${noQuote.summary.makeSideOnly}`,
      kind: 'no_quote',
      severity: 'medium',
      title: `${noQuote.summary.makeSideOnly.toLocaleString()} no-quote lanes with no supplier match`,
      /*
       * ★ NOT "no supplier holds any material", WHICH IS A CENSUS OF THE WORLD. 479 of 839 rows
       * land here because the availability workbook this joins carries no match for them, over
       * whatever suppliers that run covered. A holder outside it would look identical. The lead
       * is real; the absolute claim was not.
       */
      body: `${noQuote.summary.makeSideOnly.toLocaleString()} government buys drew zero quotes and the supplier match found no one holding material. Whoever can make the part likely faces little competition. No match is not a census: a holder outside the availability data we joined would not appear.`,
      href: '/goldmine',
    })
  }

  // 4. Biggest price ramp.
  const leader = pf.escalationLeaders[0]
  if (leader && leader.escalationPct != null) {
    signals.push({
      id: `escalation:${leader.nsn}`,
      kind: 'escalation',
      severity: 'info',
      title: `Biggest price ramp: +${leader.escalationPct.toLocaleString()}%`,
      body: `${leader.nsn} (${leader.item}) has climbed ${leader.escalationPct.toLocaleString()}% across its award history, the steepest in the book. A cornered part whose price only goes up.`,
      href: `/corner/${leader.nsn.replace(/[^0-9]/g, '')}`,
      nsn: leader.nsn,
    })
  }

  // 5. Forward demand.
  if (pf.totals.onForecast > 0) {
    signals.push({
      id: `forecast:${pf.totals.onForecast}`,
      kind: 'forecast',
      severity: 'info',
      title: `${pf.totals.onForecast} corners on the government's forward-buy list`,
      body: `${pf.totals.onForecast} of your candidate corners are on the DLA Forecast, so the demand is not a guess: the government has said it will buy them again.`,
      href: '/intelligence',
    })
  }

  return { present: true, feedDay: pf.feedDay, generatedAtMs, signals }
}
