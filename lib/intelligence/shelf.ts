/**
 * SHELF VALUATION. What a held position is worth, rendered as the model it is.
 *
 * ---------------------------------------------------------------------------------------
 * THIS FILE IMPLEMENTS NO PRICING ARITHMETIC AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------------------
 * T3 owns price anchoring and the evaluated-price arithmetic, and there is exactly one
 * implementation of each. This lane CALLS theirs, renders it with its inputs exposed, and
 * abstains when it is missing. If you find yourself computing an inflation factor or summing
 * an adder here, stop: you are writing a second pricing engine that will drift from the first
 * and nobody will notice until a quote is wrong.
 *
 * What this file DOES own is the honesty of the rendered figure, which is a separate job from
 * computing it.
 *
 * ---------------------------------------------------------------------------------------
 * THE FLOOR, AND WHY IT IS A DISTINCT TYPE RATHER THAN A FLAG
 * ---------------------------------------------------------------------------------------
 * The evaluation factors the buying program adds to a quotation are an OPEN set, verified
 * from primary text. Two of them carry stated dollar amounts. A third, which applies when the
 * solicitation is subject to the Buy American statute or the Balance of Payments Program,
 * states no amount at all.
 *
 * So an evaluated figure can be in one of three states, and they are not degrees of the same
 * thing:
 *   - a TOTAL, when every applicable factor resolved to an amount
 *   - a FLOOR, when a factor applies and cannot be priced. The real evaluated number is at
 *     least this and we do not know by how much
 *   - an ABSTENTION, when the anchor itself is missing
 *
 * A floor rendered as a total understates what the buyer will compare us against, which
 * overstates our competitiveness on a price-alone evaluation and loses the award while every
 * figure on the screen looks correct. So `floor` is its own arm of a discriminated union and
 * carries the names of the factors it could not price. A caller cannot read the number
 * without stepping through the arm that says what kind of number it is.
 */

import type { Cage, Niin } from './niin'
import type { EvidenceClass } from './evidence'
import { atOrAboveClass } from './evidence'

/* ------------------------------------------------------------------------------------ */
/* HOLDINGS                                                                               */
/* ------------------------------------------------------------------------------------ */

/**
 * Who holds the material. An affiliate's stock is sourceable ONLY when the holder and the
 * relationship are both on record. Absent that record the holder is `unknown` and the stock
 * is never silently counted as ours, which is Law 1 restated for inventory.
 */
export type HolderKind = 'org_own' | 'affiliate' | 'unknown'

export type ShelfPosition = {
  positionId: string
  niin: Niin
  holderKind: HolderKind
  /** The affiliate's company code, where the holder is an affiliate on record. */
  holderCage: Cage | null
  quantity: number
  /** What we paid. A measurement, always renderable, never modelled. */
  costBasisUsd: number | null
  /** Stock numbers this position can fill, at or above the chosen evidence floor. */
  fillableNiins: Array<{ niin: Niin; evidenceClass: EvidenceClass }>
  /** The customer's chosen risk appetite. Visible and adjustable, never a hidden constant. */
  evidenceClassFloor: EvidenceClass
}

/**
 * What a position can actually fill at the operator's chosen risk appetite.
 *
 * The floor is a control on the screen rather than a constant in the code, because the risk
 * appetite on a low-value fastener is not the risk appetite on a flight-critical item, and
 * one hardcoded threshold is wrong for one of those two every time.
 */
export function fillableAtFloor(position: ShelfPosition): Niin[] {
  return position.fillableNiins
    .filter((f) => atOrAboveClass(f.evidenceClass, position.evidenceClassFloor))
    .map((f) => f.niin)
}

/* ------------------------------------------------------------------------------------ */
/* THE PORT TO T3. Their arithmetic, consumed, never reimplemented.                       */
/* ------------------------------------------------------------------------------------ */

/** An evaluation factor that applies to this line but carries no resolvable amount. */
export type UnpricedFactor = {
  /** The factor's name as the governing clause states it. */
  name: string
  /** Why no amount could be attached. Never "unknown" with no explanation. */
  reason: string
  /** The clause it comes from, so an operator can read it. */
  citation: string
}

/**
 * What T3's pricing returns, as this lane needs to consume it.
 *
 * Modelled as a discriminated union so the floor case cannot be read as a total by a caller
 * that forgot to check a boolean. If T3's own outcome type gains a floor arm, this port
 * becomes a direct alias and this shape goes away.
 */
export type EvaluatedOutcome =
  | {
      kind: 'total'
      evaluatedTotalUsd: number
      quotedTotalUsd: number
      appliedFactors: Array<{ name: string; amountUsd: number }>
    }
  | {
      kind: 'floor'
      /** The evaluated figure is AT LEAST this. The true total is higher by an unknown amount. */
      atLeastUsd: number
      quotedTotalUsd: number
      appliedFactors: Array<{ name: string; amountUsd: number }>
      /** Named, never counted. This is what makes the number a floor. */
      unpricedFactors: UnpricedFactor[]
    }
  | {
      kind: 'abstained'
      reason: string
    }

export type AnchorOutcome =
  | {
      kind: 'anchored'
      anchorUsd: number
      /** The adjustment applied, named, so the screen can show it beside the result. */
      method: string
      comparisonSet: string
      horizonMonths: number
      asOf: string
    }
  | { kind: 'abstained'; reason: string }

/** The functions this lane calls. T3 implements them; this lane never does. */
export type PricingPort = {
  anchorFor(niin: Niin): AnchorOutcome
  evaluatedFor(niin: Niin, quantity: number): EvaluatedOutcome
}

/* ------------------------------------------------------------------------------------ */
/* THE VALUATION                                                                          */
/* ------------------------------------------------------------------------------------ */

export type PositionValuation = {
  positionId: string
  niin: Niin
  /** Always present. What we paid is a measurement and never abstains. */
  costBasisUsd: number | null
  /**
   * The modelled value. `null` whenever the anchor is missing, and the surface then shows the
   * cost basis alone. A position never renders a value it could not compute.
   */
  modelledValueUsd: number | null
  /** How the modelled figure should be described. Drives the glyph and the wording. */
  valueState: 'modelled' | 'floor' | 'insufficient'
  /** The four things a modelled figure must carry or it does not render. */
  basis: {
    method: string | null
    comparisonSet: string | null
    horizonMonths: number | null
    asOf: string | null
  } | null
  /** Factors that apply and could not be priced. Non-empty means the figure is a floor. */
  unpricedFactors: UnpricedFactor[]
  /** Named, never empty by omission. */
  gaps: string[]
  /** The sentence the surface renders. One place, so no screen invents its own phrasing. */
  statement: string
}

/**
 * Value one position.
 *
 * Reads as a sequence of refusals on purpose. Each branch is a case where a confident number
 * would be available and would be wrong, and the honest output is narrower.
 */
export function valuePosition(position: ShelfPosition, pricing: PricingPort): PositionValuation {
  const gaps: string[] = []

  if (position.holderKind === 'unknown') {
    gaps.push(
      'the holder of this material is not on record, so it is not counted as sourceable by this org',
    )
  }

  const anchor = pricing.anchorFor(position.niin)

  if (anchor.kind === 'abstained') {
    // No anchor means no modelled value. The cost basis is a measurement and still renders.
    gaps.push(`price anchor unavailable: ${anchor.reason}`)
    return {
      positionId: position.positionId,
      niin: position.niin,
      costBasisUsd: position.costBasisUsd,
      modelledValueUsd: null,
      valueState: 'insufficient',
      basis: null,
      unpricedFactors: [],
      gaps,
      statement:
        position.costBasisUsd == null
          ? 'No value can be shown: neither a price anchor nor a cost basis is available.'
          : 'Showing cost basis only. The price anchor is not available, so no value is modelled.',
    }
  }

  const evaluated = pricing.evaluatedFor(position.niin, position.quantity)

  if (evaluated.kind === 'abstained') {
    gaps.push(`evaluated price unavailable: ${evaluated.reason}`)
  }

  const unpricedFactors = evaluated.kind === 'floor' ? evaluated.unpricedFactors : []
  const isFloor = unpricedFactors.length > 0

  if (isFloor) {
    for (const f of unpricedFactors) {
      gaps.push(`evaluation factor "${f.name}" applies and carries no resolvable amount: ${f.reason}`)
    }
  }

  const modelledValueUsd = anchor.anchorUsd * position.quantity

  return {
    positionId: position.positionId,
    niin: position.niin,
    costBasisUsd: position.costBasisUsd,
    modelledValueUsd,
    valueState: isFloor ? 'floor' : 'modelled',
    basis: {
      method: anchor.method,
      comparisonSet: anchor.comparisonSet,
      horizonMonths: anchor.horizonMonths,
      asOf: anchor.asOf,
    },
    unpricedFactors,
    gaps,
    statement: buildStatement(isFloor, unpricedFactors),
  }
}

/**
 * The only place a valuation turns into English.
 *
 * Centralised so no screen writes its own wording and accidentally promotes a floor to a
 * total. The floor sentence names the missing input rather than hedging vaguely, because
 * "approximately" tells an operator nothing about which direction the number is wrong in.
 */
function buildStatement(isFloor: boolean, unpriced: UnpricedFactor[]): string {
  if (!isFloor) {
    return 'Modelled value, not a measurement. The anchor, the adjustment, the comparison set and the horizon are shown beside it.'
  }
  const names = unpriced.map((f) => f.name).join(', ')
  return `At least this much. ${names} applies to this line and carries no stated amount, so the evaluated figure is a floor rather than a total and the true figure is higher by an amount we cannot yet determine.`
}

/**
 * Aggregate a portfolio.
 *
 * Positions whose value could not be modelled are counted and reported SEPARATELY rather than
 * summed as zero. A total that quietly treats an unknown as nothing is the same defect as a
 * measured zero over an unwritten column, one level up.
 */
export type PortfolioSummary = {
  positions: number
  /** Positions carrying a modelled value. */
  valued: number
  /** Positions whose value is a floor, so the portfolio total is itself a floor. */
  floored: number
  /** Positions with no modelled value at all. Never summed as zero. */
  unvalued: number
  modelledTotalUsd: number
  costBasisTotalUsd: number
  /** TRUE when any position is a floor, which makes the portfolio figure a floor too. */
  totalIsFloor: boolean
}

export function summarizePortfolio(valuations: PositionValuation[]): PortfolioSummary {
  const valued = valuations.filter((v) => v.modelledValueUsd != null)
  const floored = valuations.filter((v) => v.valueState === 'floor')
  return {
    positions: valuations.length,
    valued: valued.length,
    floored: floored.length,
    unvalued: valuations.length - valued.length,
    modelledTotalUsd: valued.reduce((sum, v) => sum + (v.modelledValueUsd ?? 0), 0),
    costBasisTotalUsd: valuations.reduce((sum, v) => sum + (v.costBasisUsd ?? 0), 0),
    totalIsFloor: floored.length > 0,
  }
}
