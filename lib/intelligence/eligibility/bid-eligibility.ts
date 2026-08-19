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
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'

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
  /**
   * ★ TWO GOVERNMENT ACTIVITIES DISAGREE ABOUT THIS ITEM, AND THE ROW ABOVE IS ONE OF THEM.
   *
   * When several MOE rules reach the same top rank -- all determinations, all from publishing
   * activities -- the builder keeps the earliest in file order. That is harmless when they
   * agree and it is a coin flip when they do not, and the coin flip was being rendered as a
   * government fact.
   *
   * MEASURED across the whole catalogue: 3,260,593 NIINs carry more than one rule and
   * 1,076,346 produce a genuine tie, but in 99.99% of those the tied rows AGREE. Only 116
   * disagree on AMC and 319 on AMSC. Exposure is not harm -- and 116 is not zero.
   *
   * `selfContradiction` is a different and worse fact: the disagreeing rows come from the SAME
   * activity. That is not an ambiguity between two sources, it is a data-quality signal about
   * one, and an operator should be able to tell them apart. Twenty-four NIINs carry it.
   */
  contested: { amc: boolean; amsc: boolean; selfContradiction: boolean }
}

export type AmscIndex = {
  ok: true
  /**
   * Resolve one NIIN. A FUNCTION rather than a Map, and that is the whole point of the
   * 2026-08-19 change: the catalogue-wide index holds 7,060,851 NIINs and a Map of that many
   * string keys and row objects is on the order of 1.5 GB on a 2 GB production box.
   */
  lookup: (niin: string) => AmscIndexRow | undefined
  /** How many NIINs the index holds, for provenance strips. */
  size: number
  /**
   * A sample of NIINs spread EVENLY across the whole index, for sweeps and summaries.
   *
   * Strided, never the first N. The index is sorted by NIIN and a NIIN's leading digits track
   * the supply class, so the first N records are all from the same few classes. Taking a head
   * and reporting a rate over it is the convenience-sample error this estate has already paid
   * for once, where an unordered `limit` turned a true 11.0% into a reported 27.8%.
   */
  niins: (limit?: number) => string[]
  /** Which backing file served, so a surface can say so rather than imply currency. */
  backing: 'binary' | 'legacy-json'
  /** PICA -> measured publish rate. Presence in this map IS the publisher test. */
  publishers: Map<string, { rows: number; withAmsc: number; rate: number }>
  provenance: Record<string, unknown>
}

export type AmscIndexUnavailable = { ok: false; reason: string }

let cache: { key: string; value: AmscIndex | AmscIndexUnavailable } | null = null

export function loadAmscIndex(): AmscIndex | AmscIndexUnavailable {
  const bin = dataPath('flis', 'amsc-index.bin')
  const legacy = dataPath('flis', 'amsc-index.json')
  const key = existsSync(bin) ? bin : legacy
  if (cache && cache.key === key) return cache.value
  const value = key === bin ? readBinary(bin, dataPath('flis', 'amsc-index.meta.json')) : read(legacy)
  cache = { key, value }
  return value
}

/**
 * THE BINARY INDEX: a sorted array of fixed-width records, binary-searched on a file
 * descriptor. Nothing is held resident but the sidecar's publisher map and PICA dictionary.
 *
 * Resolving one NIIN costs about log2(7,060,851) = 23 reads of ten bytes. That is chosen over
 * loading the 70 MB buffer because production is a 2 GB box also serving Next.js, and over a
 * datastore because this is a read-only catalogue republished monthly and a database is the
 * heavier answer to "binary-search a sorted array".
 *
 * The descriptor is opened once and kept, because reopening per lookup would turn 371 corner
 * rows into 371 opens. It is never closed on the happy path: the process outlives the index.
 */
function readBinary(binFile: string, metaFile: string): AmscIndex | AmscIndexUnavailable {
  if (!existsSync(metaFile)) {
    return {
      ok: false,
      reason:
        'the acquisition-code index binary is present but its sidecar is not, so the PICA dictionary and the measured publisher list cannot be read and eligibility is not determined',
    }
  }
  let meta: {
    recordBytes?: number
    records?: number
    picaDictionary?: string[]
    publishers?: Record<string, { rows: number; withAmsc: number; rate: number }>
    provenance?: Record<string, unknown>
  }
  try {
    meta = JSON.parse(readFileSync(metaFile, 'utf8')) as typeof meta
  } catch {
    return { ok: false, reason: 'the acquisition-code index sidecar is present but could not be read' }
  }
  const stride = meta.recordBytes ?? 0
  const dict = meta.picaDictionary ?? []
  if (stride <= 0) {
    return { ok: false, reason: 'the acquisition-code index sidecar does not state its record width' }
  }
  const bytes = statSync(binFile).size
  if (bytes === 0 || bytes % stride !== 0) {
    // A truncated copy is the failure this catches. It is exactly the shape of the 1.47 GB
    // manifest hole: a file that is present, readable, and not what it claims to be.
    return {
      ok: false,
      reason: `the acquisition-code index is ${bytes} bytes, which is not a whole number of ${stride}-byte records, so it is truncated or of another format`,
    }
  }
  const count = bytes / stride
  if (meta.records !== undefined && meta.records !== count) {
    return {
      ok: false,
      reason: `the acquisition-code index holds ${count} records and its sidecar claims ${meta.records}, so the two were not written together`,
    }
  }

  const fd = openSync(binFile, 'r')
  const rec = Buffer.allocUnsafe(stride)
  const readAt = (i: number): Buffer => {
    readSync(fd, rec, 0, stride, i * stride)
    return rec
  }
  const chr = (b: number): string => (b === 0 ? '' : String.fromCharCode(b))

  const lookup = (niinText: string): AmscIndexRow | undefined => {
    if (niinText.length !== 9) return undefined
    const target = Number(niinText)
    if (!Number.isInteger(target)) return undefined
    let lo = 0
    let hi = count - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const b = readAt(mid)
      const key = b.readUInt32BE(0)
      if (key === target) {
        const picaIdx = b.readUInt16BE(8)
        // Byte 7 was `reserved, always 0` before the contested flags. An older index therefore
        // reads as "nothing contested", which is the correct answer for a file that could not
        // record the fact -- not a silent claim that the authorities agreed.
        const flags = b.readUInt8(7)
        return {
          niin: niinText,
          amc: chr(b.readUInt8(4)),
          amsc: chr(b.readUInt8(5)),
          aac: chr(b.readUInt8(6)),
          pica: picaIdx > 0 ? (dict[picaIdx - 1] ?? '') : '',
          contested: {
            amc: (flags & 1) !== 0,
            amsc: (flags & 2) !== 0,
            selfContradiction: (flags & 4) !== 0,
          },
        }
      }
      if (key < target) lo = mid + 1
      else hi = mid - 1
    }
    return undefined
  }

  if (count === 0) {
    closeSync(fd)
    return { ok: false, reason: 'the acquisition-code index is present but carries no records' }
  }
  const niins = (limit?: number): string[] => {
    const want = limit === undefined ? count : Math.min(limit, count)
    if (want <= 0) return []
    const out: string[] = []
    // Spans the FULL range including both ends: k * (count-1) / (want-1). A `count / want`
    // stride never reaches the last record, which biases a sample toward the low NIINs the
    // very same way a head does, only less obviously.
    for (let k = 0; k < want; k += 1) {
      const i = want === 1 ? 0 : Math.round((k * (count - 1)) / (want - 1))
      out.push(String(readAt(i).readUInt32BE(0)).padStart(9, '0'))
    }
    return out
  }
  return {
    ok: true,
    lookup,
    size: count,
    backing: 'binary',
    niins,
    publishers: new Map(Object.entries(meta.publishers ?? {})),
    provenance: meta.provenance ?? {},
  }
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
    lookup: (niin: string) => rows.get(niin),
    size: rows.size,
    backing: 'legacy-json',
    niins: (limit?: number) => {
      const all = [...rows.keys()]
      if (limit === undefined || limit >= all.length) return all
      if (limit <= 0) return []
      if (limit === 1) return [all[0]!]
      // Same full-range stride as the binary backing, so a sample means the same thing
      // whichever file happens to be serving.
      return Array.from({ length: limit }, (_, k) => all[Math.round((k * (all.length - 1)) / (limit - 1))]!)
    },
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
  /**
   * ★ WHERE THE GOVERNMENT DOES NOT AGREE WITH ITSELF ABOUT THIS ITEM.
   *
   * An item appears under several MOE rules and the derivation picks the managing activity's
   * row. Picking is correct and it is not the whole truth: on 116 stock numbers two activities
   * state a DIFFERENT acquisition method, on 319 a different suffix code, and on 24 a single
   * activity contradicts ITSELF across its own rows.
   *
   * These are carried rather than resolved. An arbitrary pick presented as a determination is
   * the defect this product removed elsewhere, and the honest replacement is the claim plus
   * "and these two disagree", not a quieter claim.
   *
   * `selfContradiction` is deliberately separate from the other two and is the more serious
   * one: a tie between two sources is a fact about the catalogue, while one source disagreeing
   * with itself is a fact about the quality of that source's record.
   */
  contested: { amc: boolean; amsc: boolean; selfContradiction: boolean }
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
  // Absent evidence is not agreement. A row we never found cannot be contested, and it must
  // not read as "the authorities concur" either: `state` already says we are abstaining.
  contested: { amc: false, amsc: false, selfContradiction: false },
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

  const row = index.lookup(niin)
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
      contested: row.contested ?? { amc: false, amsc: false, selfContradiction: false },
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
    contested: row.contested ?? { amc: false, amsc: false, selfContradiction: false },
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
