/**
 * The eligibility module's public surface.
 *
 * It exists so the rest of the engine imports one path and cannot reach past it into the internals,
 * and so the AMSC entry point stays narrow. `amscCompetitionSignal` is the only exported way to read
 * an AMSC, which is what keeps the "a restricted code is not a closed door" rule enforceable rather
 * than merely documented: there is no exported function that turns a code into a bid decision.
 */

export {
  AMC_DEALER_NOTE,
  AMC_TABLE,
  AMSC_NOT_A_CLOSED_DOOR,
  AMSC_POSTURE_CITATION,
  AMSC_TABLE,
  AMSC_TABLE_CITATION,
  amcAmscCombinationValid,
  amcEntry,
  amscCompetitionSignal,
  amscEntry,
  amscPosture,
  cite,
} from './amsc'

export type {
  AmcCode,
  AmcEntry,
  AmscCode,
  AmscEntry,
  AmscPosture,
  AmscSignal,
  Citation,
  Verification,
} from './amsc'

export {
  AIDC_MINIMUM_DAYS_QUOTE_VALID,
  ELIGIBILITY_GATE_VERSION,
  GATE_CITATIONS,
  amscReasons,
  blockingUnknownReasons,
  disqualifyingReasons,
  evaluateEligibility,
  instrumentFromNinthPositionChar,
  instrumentFromTypeIndicator,
} from './gate'

export type {
  AmscDerivedReason,
  AwardRouting,
  BidTypeCode,
  EligibilityInputs,
  EligibilityReason,
  EligibilityReasonCode,
  EligibilityResult,
  EligibilityVerdict,
  InstrumentType,
  MaterialRequirementCode,
  OfferorSetAsideStatus,
  ReasonDisposition,
  SetAsideCode,
  SolicitationTypeIndicator,
} from './gate'
