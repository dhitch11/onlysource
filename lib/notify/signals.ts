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
}

/** Human labels + one-line descriptions for each kind. Used by settings and the help affordance. */
export const SIGNAL_KINDS: Array<{ kind: SignalKind; label: string; describe: string }> = [
  { kind: 'award_clock', label: 'Award-cutoff deadline', describe: 'The daily 3:00 PM ET machine-award cutoff. Miss it and the buy is decided without you.' },
  { kind: 'perfect_storm', label: 'Perfect-storm corners', describe: 'Corners that line up on every measured leg at once: one silent source, on the forecast, machine-award, and a rising price.' },
  { kind: 'no_quote', label: 'No-quote make-side', describe: 'Government buys that drew zero quotes and nobody can source: you win by making the part.' },
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
    })
  }

  // 3. No-quote make-side.
  if (noQuote.summary.makeSideOnly > 0) {
    signals.push({
      id: `no_quote:${noQuote.summary.makeSideOnly}`,
      kind: 'no_quote',
      severity: 'medium',
      title: `${noQuote.summary.makeSideOnly.toLocaleString()} no-quote lanes nobody can source`,
      body: `${noQuote.summary.makeSideOnly.toLocaleString()} government buys drew zero quotes and no supplier holds any material. Whoever can make the part wins with no competition.`,
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
      title: `Biggest price ramp: +${leader.escalationPct}%`,
      body: `${leader.nsn} (${leader.item}) has climbed ${leader.escalationPct}% across its award history, the steepest in the book. A cornered part whose price only goes up.`,
      href: `/corner/${leader.nsn.replace(/[^0-9]/g, '')}`,
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
