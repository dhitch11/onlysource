/**
 * THE ADAPTER BETWEEN THE SERVED CORNER ROW AND THE RECOMMENDATION ENGINE.
 *
 * `recommend.ts` is deliberately pure: it reads no file, no index and no clock, so a test can
 * hand it a pool with a known answer. That purity has to be paid for somewhere, and this is
 * where. Everything here is I/O and shape translation, and NOTHING here decides a price.
 *
 * ★ WHY THIS FILE EXISTS AT ALL, and why the peer pool is built once per request rather than
 * per row: the engine's fifth rung asks for every priced peer in a supply class. Asking the
 * award index that question row by row walks the whole index once per row. The corner page
 * renders one row and the pricing index renders hundreds, so the pool is built once from the
 * index the caller already loaded and handed in as a closure.
 */
import type { NsnAwardSummary } from '@/lib/intelligence/awards/nsn-now'
import { buildAwardeeClassifierFromLive } from '@/lib/intelligence/suppliers/classify/live'
import { toDossierAward } from './from-dossier'
import {
  fscOf,
  recommendPrice,
  type AwardeeClassifierPort,
  type OperatorDeclarations,
  type PeerLookup,
  type PriceRecommendation,
  type PricedPeer,
  type SurplusStance,
} from './recommend'

/**
 * Group every priced award in the index by supply class, ONCE.
 *
 * A peer is one award, not one stock number: two awards on the same NSN at different prices are
 * two observations of that class and the engine's own floor decides whether the pool is thick
 * enough to speak. What is NOT allowed in is a row with no usable unit price, because a peer
 * band computed over rows that silently contributed nothing is a band over a smaller pool than
 * the count printed beside it claims.
 */
export function buildFscPeerPool(byNsn: ReadonlyMap<string, NsnAwardSummary>): Map<string, PricedPeer[]> {
  const pool = new Map<string, PricedPeer[]>()
  for (const [, summary] of byNsn) {
    const fsc = fscOf(summary.nsn)
    if (!fsc) continue
    for (const a of summary.awards) {
      const unit = a.effectiveUnitPrice
      if (unit == null || !Number.isFinite(unit) || unit <= 0) continue
      const bucket = pool.get(fsc)
      const peer: PricedPeer = {
        nsn: summary.nsn,
        unitPriceUsd: unit,
        quantity: a.quantity,
        awardDateIso: a.awardDateIso,
        awardeeCage: a.cage,
        surplusAsWorded: a.surplus,
      }
      if (bucket) bucket.push(peer)
      else pool.set(fsc, [peer])
    }
  }
  return pool
}

/** A lookup over a pool built by `buildFscPeerPool`. Absent class returns empty, never null. */
export function peerLookupFrom(pool: ReadonlyMap<string, readonly PricedPeer[]>): PeerLookup {
  return (fsc: string) => pool.get(fsc) ?? []
}

/**
 * The live awardee classifier, or null.
 *
 * NULL IS A REAL ANSWER HERE and it is not the same as "no dealer was found". The engine reads a
 * null port as "the dealer question was not asked" and abstains from the leg that depends on it,
 * rather than reading silence as "the last awardee was the manufacturer" — which is the
 * permissive direction and would price a cornered part as though it were open.
 */
export function liveClassifierOrNull(): AwardeeClassifierPort | null {
  const live = buildAwardeeClassifierFromLive()
  return live.ok ? live.classifier : null
}

export type CornerRecommendationArgs = {
  readonly nsn: string
  readonly award: NsnAwardSummary | null
  readonly requirementQuantity: number | null
  readonly approvedSourceCages: readonly string[]
  readonly feedWindow?: { readonly firstAwardIso: string | null; readonly lastAwardIso: string | null }
  readonly atInstantMs: number
  readonly peerLookup?: PeerLookup | null
  readonly classifier?: AwardeeClassifierPort | null
  readonly surplusStance?: SurplusStance
  readonly declarations?: OperatorDeclarations
}

/**
 * Recommend a price for one served row.
 *
 * A row with NO award summary is passed through with an empty award list rather than being
 * skipped, because the engine has a rung that does not need this stock number's own history and
 * an abstention sentence for when nothing reaches. Deciding here that such a row "has no
 * recommendation" would move a pricing judgement into an adapter.
 */
export function recommendForCorner(args: CornerRecommendationArgs): PriceRecommendation {
  return recommendPrice({
    nsn: args.nsn,
    awards: args.award ? args.award.awards.map(toDossierAward) : [],
    approvedSourceCages: args.approvedSourceCages,
    requirementQuantity: args.requirementQuantity,
    atInstantMs: args.atInstantMs,
    feedWindow: args.feedWindow,
    surplusStance: args.surplusStance,
    classifyAwardee: args.classifier ?? null,
    peerLookup: args.peerLookup ?? null,
    declarations: args.declarations,
  })
}
