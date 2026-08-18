/**
 * LIVE-DATA ASSEMBLER for the awardee classifier. Turns the real award index and distressed
 * book into the injected inputs `buildAwardeeClassifier` needs. Kept separate from the pure
 * classifier so the classifier stays testable and does not couple to the index/book internals.
 *
 * Returns the classifier plus the assembler's own provenance, or an honest unavailable when the
 * award index cannot be built. It never fabricates a classifier over absent data.
 */

import { buildNsnAwardIndex } from '../../awards/nsn-now'
import { buildDistressedSuppliers } from '../distressed'
import { buildAwardeeClassifier, type AwardInput, type BookInput, type AwardeeClassifier } from './index'

export type LiveClassifier =
  | { ok: true; classifier: AwardeeClassifier; awardRows: number; bookRows: number }
  | { ok: false; reason: string }

/**
 * Assemble the classifier from live data. The award index is required; the distressed book is
 * optional (its absence only removes the PRIOR half — the measured surplus verdicts still work).
 */
export function buildAwardeeClassifierFromLive(): LiveClassifier {
  const index = buildNsnAwardIndex()
  if (!('byNsn' in index)) {
    return { ok: false, reason: `award index unavailable: ${(index as { reason?: string }).reason ?? 'unknown'}` }
  }

  const awards: AwardInput[] = []
  for (const summary of index.byNsn.values()) {
    for (const a of summary.awards) {
      awards.push({ cage: a.cage, companyName: a.company, surplus: a.surplus, nsn: summary.nsn })
    }
  }

  const book: BookInput[] = []
  const distressed = buildDistressedSuppliers()
  if (distressed.ok) {
    for (const s of distressed.suppliers) {
      book.push({ cage: s.cage, companyName: s.company, holdsInventory: s.holdsInventory })
    }
  }

  return {
    ok: true,
    classifier: buildAwardeeClassifier(awards, book),
    awardRows: awards.length,
    bookRows: book.length,
  }
}
