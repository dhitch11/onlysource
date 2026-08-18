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
  /**
   * THE PUBLISHER PUBLISHED AND WE CANNOT READ WHAT IT SAID.
   *
   * The activity publishes acquisition codes, this row carries a suffix code, and the transcribed
   * Table 71 does not list that character. It is a NAMED state rather than `determined` with a null
   * entry, because every render was inferring the difference at its own render site and one of them
   * got it wrong: `/monopoly` painted a `verified` / `measured` chip reading the raw character for a
   * code nobody has read, because its only test was `state !== 'determined'`. A state a surface has
   * to derive is a state some surface will derive differently. This one is not derivable.
   */
  | 'abstained_suffix_code_not_in_table'
  /** The stock number is not in the MOE Rule extract at all. */
  | 'abstained_not_in_catalogue'
  /** No index on disk. Every surface renders its stated empty state. */
  | 'index_absent'

/**
 * A MACHINE IDENTIFIER, WRITTEN SO THE MEMO'S NUMBER GUARD CANNOT SPEND IT.
 *
 * MEASURED, and this is the second time the same leak moved rather than closed. The pursuit
 * package is the grounding object for the deal memo: `lib/ai/grounding.ts` harvests every digit run
 * in it into the set of numbers the memo is allowed to state, and it harvests a bare digit string
 * as its NUMERIC value. So the NIIN `001760600` registered 1760600, and on NSN 5340001760600, whose
 * real modeled buy value is $57,634.32, the fabricated sentence "The modeled buy value is
 * $1,760,600." passed the guard. 4,744 of the 28,119 rows in the derived index carry a NIIN whose
 * numeric value is short enough to be spent this way. The managing activity is the same shape: 13
 * of the 44 publishing activities on the real extract are numeric (17, 18, 19, 28, 47, 48, 54, 75,
 * 80, 86, 92, 93, 94), so `(17)` in a rendered sentence licensed the number 17.
 *
 * The rewrite is the one mechanism this estate already uses for pins and citation keys: a digit run
 * that abuts a letter is an identifier fragment on BOTH sides of the guard, so it is neither
 * harvested into the allowed set nor read as a value claim in the memo. `PICA-17` names the same
 * activity to a person and is invisible to the tokenizer. It must never be applied to a measured
 * figure: a quantity a person reads has to stay a quantity.
 */
export function identifierToken(
  label: 'NSN' | 'NIIN' | 'PICA' | 'AMC' | 'AMSC',
  value: string | number | null | undefined,
): string {
  const v = String(value ?? '').trim()
  return v === '' ? '' : `${label}-${v}`
}

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
  /*
   * TRIMMED BEFORE IT IS TESTED FOR EMPTINESS, and that is not tidying.
   * A cell holding a single space is a row that carries no code, and reading it as a code was
   * measured taking the dossier verdict to `determined` with `evidence: MEASURED` on a value
   * nothing can interpret. The derivation script trims today, so this is the guard for the day
   * a different producer does not, which is the shape of every "cannot happen" defect on this
   * estate. The raw value is not otherwise altered: the case the feed carries is the case a
   * surface shows.
   */
  const amscCell = (row.amsc ?? '').trim()
  if (!publishes || !amscCell) {
    return {
      niin,
      state: 'abstained_pica_does_not_publish',
      /*
       * THE ACTIVITY IS NAMED IN A SENTENCE OF ITS OWN, AND IN TOKEN FORM. Two separate reasons.
       * The token stops a numeric activity code being spent as a quantity (see `identifierToken`).
       * The sentence break stops the fix creating a false refusal: `groundBrief` withholds whole
       * SENTENCES, so a sentence that carried both the identifier and the warning would have taken
       * "must not be read as unrestricted" with it the moment a memo wrote the code in prose.
       */
      reason: publishes
        ? `the activity that manages this item publishes acquisition codes, but this row carries none. The managing activity is ${identifierToken('PICA', row.pica)}`
        : `the activity that manages this item does not publish acquisition codes, so restriction is not determined here and must not be read as unrestricted. The managing activity is ${identifierToken('PICA', row.pica)}`,
      ...ABSENT,
      amc: row.amc || null,
      aac: row.aac || null,
      pica: row.pica || null,
    }
  }

  const entry = amscEntry(amscCell)
  const amcNum = /^\d$/.test(row.amc) ? Number(row.amc) : null

  /*
   * THE CHARACTER THE TRANSCRIBED TABLE DOES NOT LIST GETS ITS OWN STATE.
   *
   * `amsc.ts` names E, F, I, J, O, W and X as codes absent from the transcription, so the domain
   * says the input occurs. Returning `determined` with a null entry left every consumer to notice
   * the null for itself, and `/monopoly` did not: its acquisition-code cell tested `state !==
   * 'determined'` and therefore painted a VERIFIED, MEASURED chip reading the raw character for a
   * code nobody has read. The state is the honest one and it is not derivable, so no render can
   * derive it wrongly. The raw character still travels on `amsc` because we DO hold it; what is
   * absent is a reading of it, which is `amscEntry` and `posture`, both null.
   */
  if (!entry) {
    return {
      niin,
      state: 'abstained_suffix_code_not_in_table',
      reason:
        'the activity that manages this item publishes acquisition codes and this row carries a suffix ' +
        'code the transcribed table does not list, so its meaning is not determined here and must not ' +
        `be read as unrestricted. The managing activity is ${identifierToken('PICA', row.pica)} and the ` +
        `code on this row is ${identifierToken('AMSC', amscCell)}`,
      amc: row.amc || null,
      amsc: amscCell,
      aac: row.aac || null,
      pica: row.pica,
      amscEntry: null,
      amcEntry: amcEntry(amcNum),
      posture: null,
      combination: amcAmscCombinationValid(amcNum, amscCell),
    }
  }

  return {
    niin,
    state: 'determined',
    reason:
      'the managing activity publishes acquisition codes and this item carries the suffix code ' +
      `${identifierToken('AMSC', amscCell)}. The managing activity is ${identifierToken('PICA', row.pica)}`,
    amc: row.amc || null,
    amsc: amscCell,
    aac: row.aac || null,
    pica: row.pica,
    amscEntry: entry,
    amcEntry: amcEntry(amcNum),
    posture: amscPosture(entry.code as AmscCode),
    combination: amcAmscCombinationValid(amcNum, amscCell),
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
