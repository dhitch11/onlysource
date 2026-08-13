/**
 * PRINCIPAL REASONS, AND THE SIGN AGREEMENT GATE.
 *
 * Up to three reasons, ordered by points contributed, NEVER padded to three. Padding is not a
 * cosmetic sin: a reason list that always has three entries teaches the operator that the third
 * one is filler, and within a week he stops reading any of them. A row with one reason gets one
 * reason.
 *
 * Ordering is by ABSOLUTE points, then by the card's feature order. Ranking by signed points
 * would bury the single strongest argument against a row underneath three weak arguments for it,
 * which is exactly the row a person most needs to see explained.
 *
 * WHY `checkSignAgreement` EXISTS. Acceptance gate R3.7 fails CI on a reason sentence whose
 * direction word contradicts the sign of its contribution. That defect is invisible to every
 * ordinary test: the score is right, the points are right, the payload validates, and the
 * sentence tells the reader the opposite of what the arithmetic did. It is caught only by
 * comparing the prose against the sign, which is what this does.
 */

import {
  type Scorecard,
  type FeatureValue,
  actionabilityRank,
  expertSpan,
  featureOrder,
  type ExpertSpan,
} from './card'
import type { Contribution, ScoreResult } from './score'

export type PrincipalReason = {
  readonly feature: string
  readonly value: FeatureValue | null
  readonly points: number
  readonly sentence: string
  readonly expert_span_ref: string | null
  readonly expert_span: ExpertSpan | null
}

export type SignAgreement = {
  readonly ok: boolean
  readonly problem: string | null
}

/**
 * Fill the placeholders a band sentence declares. The only values that can reach rendered prose
 * are the ones carried on the emitted reason, which is what lets the numeral firewall trace every
 * digit in a sentence back to a field in the payload.
 */
export function renderSentence(
  template: string,
  bind: { readonly value: FeatureValue | null; readonly points: number },
): string {
  const valueText = bind.value === null ? 'unobserved' : String(bind.value)
  return template
    .split('{value}')
    .join(valueText)
    .split('{abs_points}')
    .join(String(Math.abs(bind.points)))
    .split('{points}')
    .join(String(bind.points))
}

function directionWordsIn(
  sentence: string,
  lexicon: { readonly raises: readonly string[]; readonly lowers: readonly string[] },
): { readonly raises: number; readonly lowers: number } {
  const lower = sentence.toLowerCase()
  const count = (words: readonly string[]): number =>
    words.reduce((total, word) => total + lower.split(word.toLowerCase()).length - 1, 0)
  return { raises: count(lexicon.raises), lowers: count(lexicon.lowers) }
}

/**
 * THE R3.7 INSTRUMENT. A rendered sentence must state a direction, and that direction must agree
 * with the sign of the points it is explaining.
 *
 * A zero point contribution never becomes a reason, so a sentence for one must carry no direction
 * word at all: claiming a direction for a contribution of zero is the same class of lie in the
 * other direction.
 */
export function checkSignAgreement(
  card: Scorecard,
  reason: { readonly points: number; readonly sentence: string; readonly feature?: string },
): SignAgreement {
  const where = reason.feature ? `${reason.feature}: ` : ''
  const found = directionWordsIn(reason.sentence, card.reasons.direction_lexicon)

  if (reason.points === 0) {
    if (found.raises > 0 || found.lowers > 0) {
      return {
        ok: false,
        problem: `${where}a contribution of zero points carries a direction word, which claims a direction the arithmetic did not take`,
      }
    }
    return { ok: true, problem: null }
  }

  if (found.raises === 0 && found.lowers === 0) {
    return {
      ok: false,
      problem: `${where}the sentence states no direction, so a reader cannot tell whether the contribution helped or hurt`,
    }
  }
  if (found.raises > 0 && found.lowers > 0) {
    return {
      ok: false,
      problem: `${where}the sentence states both directions at once`,
    }
  }
  const saysRaises = found.raises > 0
  if (saysRaises && reason.points < 0) {
    return {
      ok: false,
      problem: `${where}the sentence says the score is raised while the contribution is negative`,
    }
  }
  if (!saysRaises && reason.points > 0) {
    return {
      ok: false,
      problem: `${where}the sentence says the score is lowered while the contribution is positive`,
    }
  }
  return { ok: true, problem: null }
}

/**
 * Check every band sentence on a card before it can produce a reason. Run in CI so a flipped
 * direction word is caught at review time rather than at render time, which is the difference
 * between a failed build and a customer reading a false statement about a federal quote.
 */
export function auditCardSentences(card: Scorecard): readonly string[] {
  const problems: string[] = []
  for (const feature of card.features) {
    for (const band of feature.bands) {
      const rendered = renderSentence(band.sentence, {
        value: band.representative_value,
        points: band.points,
      })
      const verdict = checkSignAgreement(card, {
        points: band.points,
        sentence: rendered,
        feature: `${feature.key}.${band.id}`,
      })
      if (!verdict.ok && verdict.problem !== null) problems.push(verdict.problem)
    }
  }
  return problems
}

function rankContributions(card: Scorecard, contributions: readonly Contribution[]): Contribution[] {
  return contributions
    .filter((c) => c.observed && c.points !== 0 && c.sentence_template !== null)
    .slice()
    .sort((a, b) => {
      const byMagnitude = Math.abs(b.points) - Math.abs(a.points)
      if (byMagnitude !== 0) return byMagnitude
      return featureOrder(card, a.feature) - featureOrder(card, b.feature)
    })
}

/**
 * The principal reasons for a score, capped by the card and never padded to the cap.
 *
 * A reason is emitted only for a contribution that actually moved the number. A feature that was
 * observed and scored zero explains nothing, and an unobserved feature is a data gap rather than
 * a reason, so neither can appear here.
 */
export function buildPrincipalReasons(card: Scorecard, result: ScoreResult): readonly PrincipalReason[] {
  const ranked = rankContributions(card, result.contributions)
  const reasons: PrincipalReason[] = []
  for (const contribution of ranked.slice(0, card.reasons.max_principal_reasons)) {
    const template = contribution.sentence_template
    if (template === null) continue
    const sentence = renderSentence(template, { value: contribution.value, points: contribution.points })
    const agreement = checkSignAgreement(card, {
      points: contribution.points,
      sentence,
      feature: contribution.feature,
    })
    if (!agreement.ok) {
      // A sentence that contradicts its own arithmetic is never rendered, it is a build failure.
      throw new Error(`scorecard ${card.version}: reason sign disagreement, ${agreement.problem}`)
    }
    reasons.push({
      feature: contribution.feature,
      value: contribution.value,
      points: contribution.points,
      sentence,
      expert_span_ref: contribution.expert_span_ref,
      expert_span: expertSpan(card, contribution.expert_span_ref),
    })
  }
  return reasons
}

/** Re-exported so a caller ordering its own list uses the card's ranking, not a second one. */
export { actionabilityRank }
