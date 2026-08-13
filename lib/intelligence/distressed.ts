/**
 * THE DISTRESSED-SUPPLIER SHELF FINDER.
 *
 * The Shelf holds material the org already owns. This finds material the org could own
 * cheaply this quarter because someone is winding down: the reachable holder who still has
 * stock on the rack and still answers the phone, but is one renewal cycle from disappearing.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS FILE NEVER EMITS THE WORD "DISTRESSED" AS A FACT
 * ---------------------------------------------------------------------------------------
 * Federal award reporting is not required at or below the micro-purchase threshold. So a
 * surplus dealer of exactly this org's size can be winning awards every month and show ZERO
 * activity in the public award databases. "Distressed" read off that silence is a fabricated
 * finding that sends an operator to buy a shelf from a firm that is thriving.
 *
 * The only publishable measurement is "no recorded prime award activity since <date>".
 * Everything above that is an inference, and an inference here renders as the named TIER that
 * fired with its composing signals, never as a flag. Where public coverage falls below the
 * threshold the honest output is "insufficient public award data", NOT a low tier by default.
 * Those are different answers and the difference is the whole discipline of this surface.
 *
 * ---------------------------------------------------------------------------------------
 * THE TIMING INVERSION THAT SHAPES THE TIERS
 * ---------------------------------------------------------------------------------------
 * Award activity is a LAGGING indicator of health. A supplier silent for two full years may
 * already have scrapped the shelf, lost the paperwork or dissolved. The window to buy opens
 * BEFORE the silence, not after it, which is why S2 outranks S1 in usefulness despite being
 * the weaker death signal: S1 finds firms that have already gone, S2 finds firms that are
 * about to.
 */

import type { Cage } from './niin'

/* ------------------------------------------------------------------------------------ */
/* THE CLASSIFICATION PORT. Consumed from T3, never re-derived here.                      */
/* ------------------------------------------------------------------------------------ */

/**
 * Manufacturer versus dealer, with an EXPLICIT UNKNOWN.
 *
 * The third value is not a nicety. A distributor appearing in bid history is quoting someone
 * else's material and tells you little. A manufacturer appearing in bid history is evidence
 * of physical stock on a shelf, which makes them an acquisition target rather than a
 * competitor. An unknown silently read as either one is a fabricated finding, so the port
 * carries the third value and every consumer here abstains on it.
 *
 * The classification itself belongs to T3 and is a join key for two lanes. This lane consumes
 * it through this port and never derives a rival.
 */
export type EntityClass = 'manufacturer' | 'dealer' | 'unknown'

export type EntityClassification = {
  cage: Cage
  entityClass: EntityClass
  /** Stated so the surface can show the basis rather than a bare label. */
  basis: string
  observedAt: string
}

/** The port T3 implements. This lane holds the interface, never the implementation. */
export type ClassificationPort = {
  classify(cage: Cage): EntityClassification | null
}

/* ------------------------------------------------------------------------------------ */
/* INPUTS                                                                                 */
/* ------------------------------------------------------------------------------------ */

export type RegistrationStatus = 'active' | 'expired' | 'unknown'

export type SupplierSignals = {
  cage: Cage
  companyName: string | null
  registrationStatus: RegistrationStatus
  /** Registration expiry. The pre-exit window is measured from this. */
  registrationExpiresAt: string | null
  /** Most recent recorded prime award at ANY agency, not just the one. */
  lastAwardAt: string | null
  /** Whether the firm has any historical award at all. S1 requires at least one. */
  hasHistoricalAward: boolean
  /** The firm's own 90th-percentile historical gap between awards, in days. */
  ownNinetiethPercentileGapDays: number | null
  /** Present on the federal exclusions list. A hard suppression. */
  onExclusionsList: boolean
  /** A successor company code operating from the same address. A hard suppression. */
  successorCageAtSameAddress: Cage | null
  /** Whether public award coverage for this firm is believed adequate at all. */
  publicAwardCoverageAdequate: boolean
  observedAt: string
}

export const DISTRESS_TIERS = ['S1', 'S2', 'S3'] as const
export type DistressTier = (typeof DISTRESS_TIERS)[number]

export type DistressAssessment = {
  cage: Cage
  /** null when no tier fired, or when the honest answer is an abstention. */
  tier: DistressTier | null
  /** The publishable measurement, never an inference. */
  measurement: string
  /** Each signal that composed the tier, with the value that made it fire. */
  composingSignals: Array<{ signal: string; value: string }>
  /** Which suppression checks were RUN and what each returned. Absence of a check is a gap. */
  suppressionChecks: Array<{ check: string; suppressed: boolean; detail: string }>
  suppressed: boolean
  /** True when public coverage is too thin to say anything. Not a low tier. */
  insufficientPublicData: boolean
  entityClass: EntityClass
  gaps: string[]
}

const DAY_MS = 86_400_000

function daysBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso)
  const b = Date.parse(toIso)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / DAY_MS)
}

/**
 * Assess one supplier against the tiering.
 *
 * Order matters. Suppression is evaluated FIRST and reported even when it fires, because
 * "we looked and this firm is excluded" is more useful to an operator than silence. Then the
 * coverage question, because a firm invisible to the public feeds cannot be tiered honestly.
 * Only then the tiers.
 */
export function assessDistress(
  signals: SupplierSignals,
  asOf: string,
  classification: EntityClassification | null,
): DistressAssessment {
  const gaps: string[] = []
  const composing: Array<{ signal: string; value: string }> = []

  // ---- Suppression, always run, always reported -------------------------------------
  const suppressionChecks: DistressAssessment['suppressionChecks'] = []

  const recentAward =
    signals.lastAwardAt != null && (daysBetween(signals.lastAwardAt, asOf) ?? Infinity) <= 730
  suppressionChecks.push({
    check: 'award at any agency in the last 24 months',
    suppressed: recentAward,
    detail: signals.lastAwardAt ? `last recorded award ${signals.lastAwardAt}` : 'no recorded award',
  })

  suppressionChecks.push({
    check: 'present on the federal exclusions list',
    suppressed: signals.onExclusionsList,
    detail: signals.onExclusionsList ? 'listed' : 'not listed',
  })

  suppressionChecks.push({
    check: 'successor company code at the same address',
    suppressed: signals.successorCageAtSameAddress != null,
    detail: signals.successorCageAtSameAddress
      ? `successor ${signals.successorCageAtSameAddress}`
      : 'none found',
  })

  const suppressed = suppressionChecks.some((c) => c.suppressed)

  // ---- The classification, consumed, never derived ----------------------------------
  const entityClass = classification?.entityClass ?? 'unknown'
  if (classification == null) {
    gaps.push(`no manufacturer-versus-dealer classification available for ${signals.cage}`)
  } else if (entityClass === 'unknown') {
    gaps.push(
      `manufacturer-versus-dealer classification is explicitly unknown for ${signals.cage}, so whether a shelf exists is unresolved`,
    )
  }

  // ---- The measurement, which is the only publishable statement ---------------------
  const measurement = signals.lastAwardAt
    ? `no recorded prime award activity since ${signals.lastAwardAt}`
    : 'no recorded prime award activity in the loaded data'

  // ---- Coverage. Thin coverage abstains; it never defaults to a low tier ------------
  if (!signals.publicAwardCoverageAdequate) {
    return {
      cage: signals.cage,
      tier: null,
      measurement,
      composingSignals: composing,
      suppressionChecks,
      suppressed,
      insufficientPublicData: true,
      entityClass,
      gaps: [
        ...gaps,
        'public award coverage for this firm falls below the reporting threshold, so silence carries no information',
      ],
    }
  }

  if (suppressed) {
    return {
      cage: signals.cage,
      tier: null,
      measurement,
      composingSignals: composing,
      suppressionChecks,
      suppressed: true,
      insufficientPublicData: false,
      entityClass,
      gaps,
    }
  }

  const monthsSinceExpiry =
    signals.registrationExpiresAt != null
      ? (daysBetween(signals.registrationExpiresAt, asOf) ?? 0) / 30.44
      : null
  const daysToExpiry =
    signals.registrationExpiresAt != null ? daysBetween(asOf, signals.registrationExpiresAt) : null
  const daysSinceAward = signals.lastAwardAt != null ? daysBetween(signals.lastAwardAt, asOf) : null

  if (signals.registrationExpiresAt == null) {
    gaps.push('registration expiration date not available, so the pre-exit window cannot be computed')
  }

  // ---- S1. The strongest signal of exit ---------------------------------------------
  // A firm that let its registration lapse through a FULL renewal cycle made an affirmative,
  // dated decision to leave. That is an event, not an absence.
  if (
    signals.registrationStatus === 'expired' &&
    monthsSinceExpiry != null &&
    monthsSinceExpiry > 12 &&
    signals.hasHistoricalAward
  ) {
    composing.push({ signal: 'registration status', value: 'expired' })
    composing.push({
      signal: 'months past expiration',
      value: `${Math.floor(monthsSinceExpiry)} (more than 12)`,
    })
    composing.push({ signal: 'historical agency award', value: 'at least one on record' })
    return finish('S1')
  }

  // ---- S2. Most actionable. The pre-exit window ------------------------------------
  // The material is still intact, the phone still answers, the paperwork is not lost yet.
  if (
    signals.registrationStatus === 'active' &&
    daysToExpiry != null &&
    daysToExpiry >= 0 &&
    daysToExpiry <= 90 &&
    (daysSinceAward == null || daysSinceAward >= 730)
  ) {
    composing.push({ signal: 'registration status', value: 'active' })
    composing.push({ signal: 'days to expiration', value: `${daysToExpiry} (within 90)` })
    composing.push({
      signal: 'award activity in 24 months',
      value: daysSinceAward == null ? 'none recorded' : `none, last was ${daysSinceAward} days ago`,
    })
    return finish('S2')
  }

  // ---- S3. Candidate generation only ------------------------------------------------
  if (
    signals.registrationStatus === 'active' &&
    daysSinceAward != null &&
    signals.ownNinetiethPercentileGapDays != null &&
    daysSinceAward > signals.ownNinetiethPercentileGapDays
  ) {
    composing.push({ signal: 'registration status', value: 'active' })
    composing.push({
      signal: 'silence versus own 90th-percentile gap',
      value: `${daysSinceAward} days against ${signals.ownNinetiethPercentileGapDays}`,
    })
    return finish('S3')
  }

  if (signals.ownNinetiethPercentileGapDays == null) {
    gaps.push('own historical award-gap distribution not computed, so S3 could not be evaluated')
  }

  return finish(null)

  function finish(tier: DistressTier | null): DistressAssessment {
    return {
      cage: signals.cage,
      tier,
      measurement,
      composingSignals: composing,
      suppressionChecks,
      suppressed: false,
      insufficientPublicData: false,
      entityClass,
      gaps,
    }
  }
}

/**
 * The sentence a surface is allowed to render for an assessment.
 *
 * Centralised so no screen invents its own phrasing and accidentally promotes an inference to
 * a fact. There is exactly one place in this lane that turns a tier into English.
 */
export function describeDistress(a: DistressAssessment): string {
  if (a.insufficientPublicData) return 'Insufficient public award data'
  if (a.suppressed) {
    const which = a.suppressionChecks.find((c) => c.suppressed)
    return `Suppressed: ${which?.check ?? 'a suppression check fired'}`
  }
  if (a.tier == null) return a.measurement
  return `${a.tier}: ${a.measurement}`
}
