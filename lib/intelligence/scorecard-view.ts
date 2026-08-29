/**
 * THE SCORECARD BOARD, PRESENTED HONESTLY — abstention is the design, not the exception.
 *
 * ==========================================================================================
 * WHY ABSTENTION LEADS.
 * ==========================================================================================
 * `lib/engine/scorecard/**` turns a candidate's observed features into a disposition — `flag`,
 * `skip`, or `insufficient_data` — with ranked reasons and an honest "what would change my mind"
 * counterfactual. It reaches no page. On the live feed today it returns `insufficient_data` on
 * the large majority of rows, because most candidates lack the observed availability/pricing legs
 * the card needs. That is the true state of the book, and a reasons surface has to make it the
 * FIRST thing an operator sees, not a footnote under a handful of scored rows.
 *
 * The estate has learned this exact lesson elsewhere: styling the dominant state as an exception
 * teaches the operator to read the exceptions as the norm. So this presenter groups by
 * disposition, leads with the count that dominates, summarises WHY the abstained rows abstained
 * (by ground), and only then exposes the reasons and counterfactuals for the rows that actually
 * scored. It invents nothing: every number is a count of evaluations it was handed.
 *
 * DECOUPLED BY DESIGN. It imports only the scorecard's own result types (a stable, pure package)
 * and takes an array of already-computed evaluations as input. It does not call the candidate-map
 * builders — which are under active change in another lane — so it cannot break when they change.
 * The page maps its rows to observations, calls `evaluateScorecard`, and hands the results here.
 */

import type {
  ScorecardEvaluation,
  Disposition,
  AbstentionGround,
} from '@/lib/engine/scorecard'

export type DispositionCounts = {
  readonly flag: number
  readonly skip: number
  readonly insufficient_data: number
}

export type AbstentionGroundSummary = {
  readonly ground: NonNullable<AbstentionGround>
  readonly label: string
  readonly count: number
}

export type ScorecardBoardView = {
  readonly feedDay: string
  readonly total: number
  readonly counts: DispositionCounts
  /** The disposition that dominates the book. Drives which group the interface leads with. */
  readonly dominant: Disposition
  /** One plain sentence stating the true shape of the book, abstention-first when that dominates. */
  readonly headline: string
  /** Why the abstained rows abstained, grouped by ground and counted. Empty when none abstained. */
  readonly abstentionGrounds: readonly AbstentionGroundSummary[]
  /** The rows that actually resolved to flag or skip, carrying their reasons and counterfactual. */
  readonly scored: readonly ScorecardEvaluation[]
  /** The card's own statement that its weights are a prior, carried through verbatim. */
  readonly epistemicNote: string | null
}

const GROUND_LABEL: Record<NonNullable<AbstentionGround>, string> = {
  thin_core_coverage:
    'too few of the core legs were observed to score the position — the government files did not carry them on this feed day',
  unobserved_could_cross:
    'an unobserved leg could still cross the threshold either way, so a score would overstate what was measured',
}

function dominantDisposition(counts: DispositionCounts): Disposition {
  const ranked: readonly [Disposition, number][] = [
    ['insufficient_data', counts.insufficient_data],
    ['flag', counts.flag],
    ['skip', counts.skip],
  ]
  return ranked.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0]
}

function headlineFor(counts: DispositionCounts, total: number): string {
  if (total === 0) return 'No candidates were evaluated on this feed day.'
  const dom = dominantDisposition(counts)
  if (dom === 'insufficient_data') {
    const pct = Math.round((counts.insufficient_data / total) * 100)
    return `${counts.insufficient_data} of ${total} candidates (${pct}%) cannot yet be scored — the evidence to rank them was not in this feed. ${counts.flag} scored as worth pursuing, ${counts.skip} as pass.`
  }
  if (dom === 'flag') {
    return `${counts.flag} of ${total} candidates scored as worth pursuing, ${counts.skip} as pass, and ${counts.insufficient_data} could not be scored on this feed.`
  }
  return `${counts.skip} of ${total} candidates scored as pass, ${counts.flag} as worth pursuing, and ${counts.insufficient_data} could not be scored on this feed.`
}

/**
 * Build the board view from a set of scorecard evaluations. Pure; counts only what it is given.
 * The scored list preserves input order (the caller ranks); this presenter never re-scores.
 */
export function buildScorecardView(
  evaluations: readonly ScorecardEvaluation[],
  feedDay: string,
): ScorecardBoardView {
  const counts = { flag: 0, skip: 0, insufficient_data: 0 }
  const grounds = new Map<NonNullable<AbstentionGround>, number>()

  for (const e of evaluations) {
    counts[e.disposition] += 1
    if (e.disposition === 'insufficient_data' && e.abstention_ground) {
      grounds.set(e.abstention_ground, (grounds.get(e.abstention_ground) ?? 0) + 1)
    }
  }

  const abstentionGrounds: AbstentionGroundSummary[] = [...grounds.entries()]
    .map(([ground, count]) => ({ ground, label: GROUND_LABEL[ground], count }))
    .sort((a, b) => b.count - a.count)

  const scored = evaluations.filter((e) => e.disposition === 'flag' || e.disposition === 'skip')

  return {
    feedDay,
    total: evaluations.length,
    counts,
    dominant: dominantDisposition(counts),
    headline: headlineFor(counts, evaluations.length),
    abstentionGrounds,
    scored,
    epistemicNote: evaluations[0]?.weights_are_a_prior ?? null,
  }
}
