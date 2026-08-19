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
import type { AnchorIndexConfig } from '@/lib/engine/pricing/anchor'
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
const poolCache = new WeakMap<ReadonlyMap<string, NsnAwardSummary>, Map<string, PricedPeer[]>>()

export function buildFscPeerPool(byNsn: ReadonlyMap<string, NsnAwardSummary>): Map<string, PricedPeer[]> {
  /*
   * ★ CACHED ON THE INDEX ITSELF, and this is not an optimisation detail: MEASURED at 49.2s for
   * the first dossier view and 0.18s for the second, because the corner page rebuilt this pool
   * on every request while the award index behind it was already cached. A page that takes 49
   * seconds is a page nobody opens twice.
   *
   * A WeakMap keyed on the index MAP is the correct key rather than a feed day string. The pool
   * is a pure function of that map, so a rebuilt index is a different object and misses the
   * cache automatically. A day-keyed cache would keep serving a pool derived from an index that
   * has since been reloaded, which is the stale-basis defect this product keeps paying for, and
   * it would hold the whole index alive after the rest of the process had let it go.
   */
  const hit = poolCache.get(byNsn)
  if (hit) return hit

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
  poolCache.set(byNsn, pool)
  return pool
}

/** A lookup over a pool built by `buildFscPeerPool`. Absent class returns empty, never null. */
export function peerLookupFrom(pool: ReadonlyMap<string, readonly PricedPeer[]>): PeerLookup {
  return (fsc: string) => pool.get(fsc) ?? []
}

/**
 * A ROW IS NEVER ITS OWN PEER.
 *
 * ★ THIS IS A CORRECTNESS CONTROL, NOT A TIDY-UP. The pool is grouped by supply class, and the
 * subject's own awards are in that class. Left in, the weakest rung re-derives the row from its
 * OWN history and then reports it as independent corroboration from N peers. That is the worst
 * shape a wrong number can take here: a weak basis wearing a strong one's clothes, with a peer
 * count printed beside it that an operator reads as breadth.
 *
 * It is enforced HERE rather than inside the engine because `PeerLookup` is `(fsc) => peers` and
 * carries no subject. The adapter is the only layer that knows both, so the engine stays pure
 * and the exclusion still happens on every call that goes through this file.
 *
 * Matching is on DIGITS, because the pool's stock numbers and the subject's arrive from
 * different files and only one of them is dashed. Comparing the raw strings would silently
 * match nothing and leave the subject in the pool while looking like it had been removed.
 */
export function excludeSubject(lookup: PeerLookup, subjectNsn: string): PeerLookup {
  const subject = subjectNsn.replace(/[^0-9]/g, '')
  return (fsc: string) => lookup(fsc).filter((p) => p.nsn.replace(/[^0-9]/g, '') !== subject)
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
  /**
   * The inflation indices the anchor rung carries money forward with.
   *
   * PASSED IN rather than read here, because resolving it needs the ingested series ledger and
   * that read is async while this adapter and the engine beneath it are synchronous. Absent means
   * the engine's own pinned default, which is a dated reading and not a current one.
   */
  readonly indices?: AnchorIndexConfig
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
    /*
     * The subject is filtered out of its own supply class here, on every call. A null lookup
     * stays null: "the class was never read" and "the class holds too few peers" are different
     * sentences and only one of them is a measurement.
     */
    peerLookup: args.peerLookup ? excludeSubject(args.peerLookup, args.nsn) : null,
    indices: args.indices,
    declarations: args.declarations,
  })
}
