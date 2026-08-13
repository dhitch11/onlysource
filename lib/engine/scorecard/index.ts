/**
 * The scorecard package boundary.
 *
 * `evaluateScorecard` exists so the four lanes that consume the score payload call ONE function
 * and receive the score, the disposition, the ranked reasons, the counterfactual and the data
 * gaps as a single consistent object. Assembling those four pieces separately is how two surfaces
 * end up showing a score from one card version beside reasons from another.
 *
 * This package imports node builtins, zod and its own modules, and nothing else. It is a pure
 * library: no framework, no database client, no wall clock.
 */

export {
  type BandCondition,
  type BandDirection,
  type ExpertSpan,
  type FeatureValue,
  type Scorecard,
  type ScorecardBand,
  type ScorecardFeature,
  ScorecardCardError,
  SCORECARD_V0,
  actionabilityRank,
  assertValueInDomain,
  bandFor,
  expertSpan,
  featureByKey,
  featureOrder,
  loadScorecard,
  maxPointsFor,
  minPointsFor,
} from './card'

export {
  type AbstentionGround,
  type Contribution,
  type DataGap,
  type Disposition,
  type FeatureObservations,
  type ScoreResult,
  canonicalInputVector,
  contributionFor,
  disposeScore,
  inputVectorSha256,
  scoreOpportunity,
} from './score'

export {
  type PrincipalReason,
  type SignAgreement,
  auditCardSentences,
  buildPrincipalReasons,
  checkSignAgreement,
  renderSentence,
} from './reasons'

export {
  type Counterfactual,
  type CounterfactualChange,
  type CounterfactualDirection,
  buildCounterfactual,
} from './counterfactual'

import { SCORECARD_V0, type Scorecard } from './card'
import { type FeatureObservations, type ScoreResult, scoreOpportunity } from './score'
import { type PrincipalReason, buildPrincipalReasons } from './reasons'
import { type Counterfactual, buildCounterfactual } from './counterfactual'

export type ScorecardEvaluation = {
  readonly scorecard_version: string
  readonly as_of: string
  readonly input_vector_sha256: string
  readonly score: number
  readonly disposition: ScoreResult['disposition']
  readonly abstention_ground: ScoreResult['abstention_ground']
  readonly disposition_sentence: string
  readonly principal_reasons: readonly PrincipalReason[]
  readonly counterfactual: Counterfactual
  readonly data_gaps: ScoreResult['data_gaps']
  readonly weights_are_a_prior: string
  readonly detail: ScoreResult
}

/**
 * The one call the consuming lanes make. Every field on the returned object is present on every
 * call: absence is an explicit null or an empty array, never a missing key, because a conditional
 * omission is how a consumer silently renders nothing where a disclosure belonged.
 */
export function evaluateScorecard(
  observations: FeatureObservations,
  asOf: string,
  card: Scorecard = SCORECARD_V0,
): ScorecardEvaluation {
  const result = scoreOpportunity(card, observations, asOf)
  return {
    scorecard_version: result.scorecard_version,
    as_of: result.as_of,
    input_vector_sha256: result.input_vector_sha256,
    score: result.score,
    disposition: result.disposition,
    abstention_ground: result.abstention_ground,
    disposition_sentence: result.disposition_sentence,
    principal_reasons: buildPrincipalReasons(card, result),
    counterfactual: buildCounterfactual(card, result),
    data_gaps: result.data_gaps,
    weights_are_a_prior: card.epistemic_status.statement,
    detail: result,
  }
}
