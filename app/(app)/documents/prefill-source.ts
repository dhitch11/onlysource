import 'server-only'

import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { readDeals } from '@/lib/sales/deals-store'
import type { FeedProvenance } from '@/lib/compliance/deliverables/document-file'
import { looksLikeNsn, type PrefillEvidence } from '@/lib/compliance/deliverables/prefill'

/**
 * WHERE THE PREFILL'S EVIDENCE COMES FROM. The only file in this lane that touches IO.
 *
 * It reads the operator's own pipeline (lib/sales/deals-store.ts) and the government feed the
 * workspace is serving (lib/intelligence/**), and hands the result to the pure builder in
 * lib/compliance/deliverables/prefill.ts, which decides what may be carried and what must be
 * abstained from. Splitting it this way is what lets every sentence the operator reads under a
 * prefilled field be tested without a data directory on disk.
 *
 * =====================================================================================================
 * EVERY READ HERE CAN FAIL, AND A FAILED READ IS NOT AN EMPTY RESULT.
 * =====================================================================================================
 * The data directory is not mounted in every environment, the archive can refuse to resolve, and a
 * requested deal or stock number can simply not exist. Each of those is a DIFFERENT fact and each one
 * returns its own sentence, because a screen that renders "nothing was carried" over "the corner you
 * asked for is not in the feed we are serving" has told the operator the opposite of what happened.
 *
 * Nothing here throws. A builder that raises is caught and reported as an unreadable source by name,
 * because a documents surface must still let a person type a lot in by hand when the intelligence
 * side of the product is down.
 */

export type PrefillRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'deal'; readonly id: string }
  | { readonly kind: 'corner'; readonly nsn: string }

/**
 * Parse the `from` parameter. The contract is deliberately simple and stable, so the surfaces that
 * will link in later (the corner dossier's own page, a pipeline card) need only build a string:
 *
 *   /documents?from=deal:<deal id>
 *   /documents?from=corner:<stock number>
 *
 * Anything else is `none`. An unrecognised prefix never silently becomes a stock number.
 */
export function parsePrefillRequest(from: string): PrefillRequest {
  const raw = from.trim()
  if (raw === '') return { kind: 'none' }
  const sep = raw.indexOf(':')
  if (sep < 1) return { kind: 'none' }
  const head = raw.slice(0, sep).toLowerCase()
  const tail = raw.slice(sep + 1).trim()
  if (tail === '') return { kind: 'none' }
  if (head === 'deal') return { kind: 'deal', id: tail }
  if (head === 'corner') return { kind: 'corner', nsn: tail }
  return { kind: 'none' }
}

export type PrefillResolution = {
  /** Null when nothing was asked for, or when what was asked for could not be resolved. */
  readonly evidence: PrefillEvidence | null
  /** A sentence to render when `evidence` is null and something WAS asked for. */
  readonly problem: string | null
  readonly feed: FeedProvenance
}

/** The pipeline cards an operator can start a document from, newest touched first. */
export type PipelineChoice = {
  readonly id: string
  readonly title: string
  readonly ref: string
  readonly stage: string
  readonly updatedAt: number
}

export function readPipelineChoices(): { readonly ok: true; readonly deals: readonly PipelineChoice[] } | { readonly ok: false; readonly why: string } {
  try {
    const deals = [...readDeals()].sort((a, b) => b.updatedAt - a.updatedAt)
    return {
      ok: true,
      deals: deals.map((d) => ({
        id: d.id,
        title: d.title,
        ref: d.ref,
        stage: d.stage,
        updatedAt: d.updatedAt,
      })),
    }
  } catch {
    return { ok: false, why: 'The pipeline file could not be read in this environment.' }
  }
}

/**
 * The feed provenance strip that travels on every downloaded and printed file.
 *
 * It names the archived government original and its digest, which is the chain a buyer can actually
 * follow. When the data directory is absent this returns a STATED ABSENCE rather than an empty
 * string, so a file generated in such an environment says on its face that no figure in it came from
 * the feed.
 */
export function readFeedProvenance(): FeedProvenance {
  if (!resolveDataRoot().present) {
    return {
      known: false,
      why: 'The government data directory is not mounted in this environment, so no feed day is being served here.',
    }
  }
  try {
    const p = buildAllDatasets().cornerMap.provenance
    return {
      known: true,
      feed_day: p.feedDay,
      archive_key: p.sourceArchiveKey,
      archive_sha256: p.sourceArchiveSha256,
    }
  } catch (e) {
    return {
      known: false,
      why: `The archive could not be resolved in this environment: ${e instanceof Error ? e.message : 'unknown failure'}.`,
    }
  }
}

/** Digits only, the form every index in this product keys stock numbers on. */
function nsnKey(s: string): string {
  return s.replace(/[^0-9]/g, '')
}

export function resolvePrefill(request: PrefillRequest): PrefillResolution {
  const feed = readFeedProvenance()
  const feedDay = feed.known ? feed.feed_day : null

  if (request.kind === 'none') return { evidence: null, problem: null, feed }

  let deal: PrefillEvidence['deal'] = null
  let wantedNsn = ''

  if (request.kind === 'deal') {
    let stored
    try {
      stored = readDeals().find((d) => d.id === request.id) ?? null
    } catch {
      return {
        evidence: null,
        problem:
          'Your pipeline could not be read in this environment, so nothing could be carried from that ' +
          'deal. Enter the lot by hand below.',
        feed,
      }
    }
    if (stored === null) {
      return {
        evidence: null,
        problem:
          `No deal with id ${request.id} is in your pipeline. It may have been deleted since that link ` +
          'was made. Nothing was carried, and no fields were filled from a guess.',
        feed,
      }
    }
    deal = {
      id: stored.id,
      title: stored.title,
      ref: stored.ref,
      niin: stored.niin,
      stage: stored.stage,
      modeled_value_usd: stored.valueUsd,
    }
    wantedNsn = looksLikeNsn(stored.ref) ? nsnKey(stored.ref) : stored.niin === null ? '' : nsnKey(stored.niin)
  } else {
    wantedNsn = nsnKey(request.nsn)
    if (wantedNsn === '') {
      return {
        evidence: null,
        problem: `"${request.nsn}" carries no digits, so it cannot be a stock number and nothing was carried.`,
        feed,
      }
    }
  }

  const base: PrefillEvidence = {
    kind: request.kind,
    requested: request.kind === 'deal' ? request.id : request.nsn,
    feed_day: feedDay,
    deal,
    corner: null,
    latest_award: null,
    part_numbers: [],
  }

  if (!resolveDataRoot().present) {
    if (deal === null) {
      return {
        evidence: null,
        problem:
          'The government data directory is not mounted in this environment, so no corner dossier can be ' +
          'read and nothing could be carried.',
        feed,
      }
    }
    return { evidence: base, problem: null, feed }
  }

  let corner: PrefillEvidence['corner'] = null
  let latestAward: PrefillEvidence['latest_award'] = null
  let partNumbers: string[] = []

  try {
    const row = buildAllDatasets().cornerMap.rows.find((r) => nsnKey(r.nsn) === wantedNsn) ?? null
    if (row !== null) {
      corner = {
        nsn: row.nsn,
        nomenclature: row.nomenclature,
        quantity: row.quantity,
        unit_of_issue: row.unitOfIssue,
        solicitation: row.solicitation,
        approved_sources: row.approvedSources,
        sole_source: row.soleSource,
      }
    }
  } catch {
    // Reported through the honest-absence path below rather than thrown: the operator can still work.
  }

  try {
    const ix = buildNsnAwardIndex()
    if (ix.ok) {
      const summary = ix.byNsn.get(wantedNsn) ?? null
      if (summary !== null) {
        if (summary.latest !== null) {
          latestAward = {
            unit_price: summary.latest.effectiveUnitPrice,
            award_date_iso: summary.latest.awardDateIso,
            company: summary.latest.company,
            cage: summary.latest.cage,
          }
        }
        partNumbers = summary.approvedSources
          .map((s) => s.partNumber)
          .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
      }
    }
  } catch {
    // Same: an unreadable award export is an absent anchor, never an invented one.
  }

  if (corner === null && deal === null) {
    return {
      evidence: null,
      problem:
        `Stock number ${request.kind === 'corner' ? request.nsn : wantedNsn} is not in the feed day this ` +
        'workspace is serving, so there is no dossier to carry anything from. It may not be a ' +
        'sole-source position, or it may not appear on this feed day.',
      feed,
    }
  }

  return {
    evidence: { ...base, corner, latest_award: latestAward, part_numbers: partNumbers },
    problem: null,
    feed,
  }
}
