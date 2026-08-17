/**
 * BID ELIGIBILITY: can anyone other than the incumbent legally make this part?
 *
 * ---------------------------------------------------------------------------------------
 * THIS MODULE EXISTS TO FEED AN ORPHAN, NOT TO REPLACE IT
 * ---------------------------------------------------------------------------------------
 * `lib/engine/eligibility/amsc.ts` is 471 lines of transcribed DoD 4100.39-M Volume 10
 * Table 70/71, with per-entry source line numbers, verification levels and citations. It is
 * correct, it is tested, and until now **nothing outside `lib/engine/` imported it**, so the
 * layer that decides whether an opportunity is biddable at all reached no operator.
 *
 * Nothing here re-implements it. This module supplies the DATA it never had — the acquisition
 * codes for every stock number we have ever seen solicited — and calls the existing interpreter.
 * The engine was never wrong. It was never fed.
 *
 * ---------------------------------------------------------------------------------------
 * THE ABSTENTION RULE, WHICH IS THE WHOLE DESIGN
 * ---------------------------------------------------------------------------------------
 * AMSC is populated on 47.09% of the 18,208,227 rows in `V_MOE_RULE`, and that number invites
 * exactly the wrong conclusion. The fill is not random, it is **bimodal by PICA**: the
 * activities that publish AMSC publish it on ~100% of their rows, and the rest publish it on
 * none. Measured on our own window, 23 PICAs sit at 100.00% and 51 sit at 0.00%.
 *
 * **So a blank AMSC is not a missing value. It is a different publisher.** Reading it as
 * "not restricted" would invent permission to bid, which is the expensive direction of this
 * error: an operator quotes a part they are not an approved source for, and loses the work
 * plus the time. This module therefore resolves the PICA first and ABSTAINS wherever that
 * PICA is not a measured publisher, rather than returning a cheerful default.
 *
 * The publisher list is READ FROM THE DERIVED INDEX, never hardcoded here. A hardcoded list of
 * publishers is a defect with a delay on it, wrong the first month DLA changes who publishes.
 */
import { existsSync, readFileSync } from 'node:fs'

import { dataPath } from '../../data-root'
import {
  amcAmscCombinationValid,
  amcEntry,
  amscEntry,
  amscPosture,
  type AmcEntry,
  type AmscCode,
  type AmscEntry,
  type AmscPosture,
} from '../../engine/eligibility/amsc'

export type AmscIndexRow = {
  niin: string
  amc: string
  amsc: string
  aac: string
  pica: string
}

export type AmscIndex = {
  ok: true
  rows: Map<string, AmscIndexRow>
  /** PICA -> measured publish rate. Presence in this map IS the publisher test. */
  publishers: Map<string, { rows: number; withAmsc: number; rate: number }>
  provenance: Record<string, unknown>
}

export type AmscIndexUnavailable = { ok: false; reason: string }

let cache: { key: string; value: AmscIndex | AmscIndexUnavailable } | null = null

export function loadAmscIndex(): AmscIndex | AmscIndexUnavailable {
  const file = dataPath('flis', 'amsc-index.json')
  if (cache && cache.key === file) return cache.value
  const value = read(file)
  cache = { key: file, value }
  return value
}

export function resetAmscIndexCache(): void {
  cache = null
}

function read(file: string): AmscIndex | AmscIndexUnavailable {
  if (!existsSync(file)) {
    return {
      ok: false,
      reason:
        'the acquisition-code index derived from the free MOE Rule file is not in this data directory, so bid eligibility is not determined',
    }
  }
  let parsed: {
    rows?: AmscIndexRow[]
    publishers?: Record<string, { rows: number; withAmsc: number; rate: number }>
    provenance?: Record<string, unknown>
  }
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as typeof parsed
  } catch {
    return { ok: false, reason: 'the acquisition-code index is present but could not be read' }
  }
  const rows = new Map<string, AmscIndexRow>()
  for (const r of parsed.rows ?? []) rows.set(r.niin, r)
  if (rows.size === 0) {
    return { ok: false, reason: 'the acquisition-code index is present but carries no rows' }
  }
  return {
    ok: true,
    rows,
    publishers: new Map(Object.entries(parsed.publishers ?? {})),
    provenance: parsed.provenance ?? {},
  }
}

/* ------------------------------------------------------------------------------------ */

export type EligibilityState =
  /** The managing activity publishes AMSC and we have it. The codes below are authoritative. */
  | 'determined'
  /** We hold a row, but this PICA publishes no AMSC. NOT "unrestricted". */
  | 'abstained_pica_does_not_publish'
  /** The stock number is not in the MOE Rule extract at all. */
  | 'abstained_not_in_catalogue'
  /** No index on disk. Every surface renders its stated empty state. */
  | 'index_absent'

export type BidEligibility = {
  niin: string
  state: EligibilityState
  /** The sentence a surface renders. Never empty, never a euphemism for an unknown. */
  reason: string
  amc: string | null
  amsc: string | null
  aac: string | null
  pica: string | null
  /** The VERIFIED table entry, i.e. the government's own words. Null when abstaining. */
  amscEntry: AmscEntry | null
  amcEntry: AmcEntry | null
  /**
   * ESTIMATED grouping from the research digest, NOT a government statement. It must never
   * render at the same confidence as `amscEntry.explanation`, which is a verbatim quote.
   */
  posture: AmscPosture | null
  /** Table 70 says whether this AMC/AMSC pair is even legal. An impossible pair means a bad row. */
  combination: 'valid' | 'invalid' | 'unknown'
}

const ABSENT: Omit<BidEligibility, 'niin' | 'state' | 'reason'> = {
  amc: null,
  amsc: null,
  aac: null,
  pica: null,
  amscEntry: null,
  amcEntry: null,
  posture: null,
  combination: 'unknown',
}

/**
 * Resolve bid eligibility for a stock number.
 *
 * Accepts a 13 digit NSN or a 9 digit NIIN; anything else abstains rather than guessing, because
 * 231 of the 39,224 index rows in our own archive carry a stock-number cell that is not a
 * well-formed NSN, and those are REAL requirements that must not be silently coerced into a
 * neighbouring key.
 */
export function resolveBidEligibility(
  stockNumber: string,
  index: AmscIndex | AmscIndexUnavailable = loadAmscIndex(),
): BidEligibility {
  const digits = String(stockNumber ?? '').replace(/[^0-9]/g, '')
  const niin = digits.length === 13 ? digits.slice(4) : digits.length === 9 ? digits : ''

  if (!index.ok) {
    return { niin, state: 'index_absent', reason: index.reason, ...ABSENT }
  }
  if (!niin) {
    return {
      niin: '',
      state: 'abstained_not_in_catalogue',
      reason: 'this stock number is not in the national format, so it cannot be looked up in the catalogue',
      ...ABSENT,
    }
  }

  const row = index.rows.get(niin)
  if (!row) {
    return {
      niin,
      state: 'abstained_not_in_catalogue',
      reason: 'this stock number does not appear in the government MOE Rule file, so no acquisition code is available',
      ...ABSENT,
    }
  }

  const publishes = index.publishers.has(row.pica)
  if (!publishes || !row.amsc) {
    return {
      niin,
      state: 'abstained_pica_does_not_publish',
      reason: publishes
        ? `the activity that manages this item (${row.pica}) publishes acquisition codes, but this row carries none`
        : `the activity that manages this item (${row.pica}) does not publish acquisition codes, so restriction is not determined here and must not be read as unrestricted`,
      ...ABSENT,
      amc: row.amc || null,
      aac: row.aac || null,
      pica: row.pica || null,
    }
  }

  const entry = amscEntry(row.amsc)
  const amcNum = /^\d$/.test(row.amc) ? Number(row.amc) : null
  return {
    niin,
    state: 'determined',
    reason: `the managing activity (${row.pica}) publishes acquisition codes and this item carries AMSC ${row.amsc}`,
    amc: row.amc || null,
    amsc: row.amsc,
    aac: row.aac || null,
    pica: row.pica,
    amscEntry: entry,
    amcEntry: amcEntry(amcNum),
    posture: entry ? amscPosture(entry.code as AmscCode) : null,
    combination: amcAmscCombinationValid(amcNum, row.amsc),
  }
}

/** Counts for a surface header. Every figure is a count of real rows. */
export function summariseEligibility(
  stockNumbers: readonly string[],
  index: AmscIndex | AmscIndexUnavailable = loadAmscIndex(),
): {
  total: number
  determined: number
  abstained: number
  byPosture: Record<string, number>
  indexAvailable: boolean
} {
  const byPosture: Record<string, number> = {}
  let determined = 0
  for (const sn of stockNumbers) {
    const e = resolveBidEligibility(sn, index)
    if (e.state === 'determined') {
      determined += 1
      const key = e.posture ?? 'unclassified_in_primary_source'
      byPosture[key] = (byPosture[key] ?? 0) + 1
    }
  }
  return {
    total: stockNumbers.length,
    determined,
    abstained: stockNumbers.length - determined,
    byPosture,
    indexAvailable: index.ok,
  }
}
