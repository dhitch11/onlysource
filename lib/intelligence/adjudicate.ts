/**
 * STAGE 2. CHARACTERISTIC ADJUDICATION. Deterministic, type aware, and the reason this lane
 * exists.
 *
 * Comparing two parts is an INTERSECTION over attribute codes plus a comparator, producing
 * agree, conflict, and present-on-one-side-only. It is not a paragraph. The moment it becomes
 * a paragraph the model starts filling gaps with assumption.
 *
 * ---------------------------------------------------------------------------------------
 * THE FAILURE THIS FILE IS BUILT AGAINST, WHICH IS DOCUMENTED, NOT HYPOTHETICAL
 * ---------------------------------------------------------------------------------------
 * The expert's own chat-window comparison in the corpus estimated a head diameter twice, and
 * in one case reasoned circularly: it assumed the two parts were identical in order to prove
 * they were identical. A set-difference report would have put head diameter in the
 * present-on-one-side-only bucket and forced a human decision.
 *
 * So: any attribute absent from the data is REPORTED ABSENT, by its code and its name. The
 * language layer may explain the diff and may never introduce a dimension the diff does not
 * contain, which is enforced by `validateExplanation` below rather than merely requested in
 * a prompt.
 *
 * ---------------------------------------------------------------------------------------
 * ASYMMETRIC ERROR COST, AND WHAT IT MEANS FOR THE DEFAULTS
 * ---------------------------------------------------------------------------------------
 * A missed equivalence costs an opportunity. A false equivalence ships the wrong metal
 * against a federal contract. These are not symmetric, so every ambiguous case here resolves
 * toward LESS confidence, never more: an unparseable pair is a conflict rather than an
 * agreement, a unit we cannot convert is a conflict rather than a pass, and too few shared
 * attributes is INSUFFICIENT_DATA rather than a verdict.
 */

import type { Verdict } from './evidence'
import type { Niin } from './niin'

/** One characteristic row: the item, the attribute code, the question, the answer. */
export type CharacteristicRow = {
  NIIN: Niin
  /** Master requirement code, the attribute's identifier. */
  MRC: string
  /** The question text, for display. */
  REQUIREMENTS_STATEMENT: string
  /** The answer text, which is what gets compared. */
  CLEAR_TEXT_REPLY: string
}

/* ------------------------------------------------------------------------------------ */
/* VALUE PARSING                                                                          */
/* ------------------------------------------------------------------------------------ */

export type ParsedValue =
  | { kind: 'numeric'; value: number; unit: string | null; raw: string }
  | { kind: 'interval'; low: number; high: number; unit: string | null; raw: string }
  | { kind: 'text'; normalized: string; raw: string }

/** Units we can convert between, expressed as a factor to a canonical base. */
const LENGTH_UNITS: Record<string, number> = {
  INCHES: 1,
  INCH: 1,
  IN: 1,
  MILLIMETERS: 1 / 25.4,
  MILLIMETER: 1 / 25.4,
  MM: 1 / 25.4,
  CENTIMETERS: 10 / 25.4,
  CM: 10 / 25.4,
  FEET: 12,
  FT: 12,
}

function canonicalUnit(unit: string | null): { family: 'length' | null; factor: number } {
  if (!unit) return { family: null, factor: 1 }
  const u = unit.toUpperCase()
  if (u in LENGTH_UNITS) return { family: 'length', factor: LENGTH_UNITS[u] as number }
  return { family: null, factor: 1 }
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?`

/**
 * Parse a characteristic reply into a comparable value.
 *
 * Deliberately conservative. Anything not confidently numeric or interval falls through to
 * normalized text, where comparison is exact. A parser that tries hard to find a number in
 * free text is how "SEE DRAWING" becomes 0.
 */
export function parseValue(raw: string): ParsedValue {
  const trimmed = raw.trim()
  const upper = trimmed.toUpperCase()

  // "BETWEEN 0.422 AND 0.452 INCHES", "0.422 TO 0.452 INCHES", "0.422-0.452 IN"
  const interval =
    new RegExp(`^(?:BETWEEN\\s+)?(${NUMBER})\\s*(?:AND|TO|-)\\s*(${NUMBER})\\s*([A-Z]+)?$`).exec(upper)
  if (interval) {
    const low = Number(interval[1])
    const high = Number(interval[2])
    if (Number.isFinite(low) && Number.isFinite(high) && low <= high) {
      return { kind: 'interval', low, high, unit: interval[3] ?? null, raw: trimmed }
    }
  }

  // "0.375 INCHES", "0.4370 INCHES NOMINAL", "12 EA"
  const numeric = new RegExp(`^(${NUMBER})\\s*([A-Z]+)?(?:\\s+(?:NOMINAL|MAXIMUM|MINIMUM|REF|REFERENCE))?$`).exec(upper)
  if (numeric) {
    const value = Number(numeric[1])
    if (Number.isFinite(value)) {
      return { kind: 'numeric', value, unit: numeric[2] ?? null, raw: trimmed }
    }
  }

  return { kind: 'text', normalized: upper.replace(/\s+/g, ' '), raw: trimmed }
}

/* ------------------------------------------------------------------------------------ */
/* COMPARISON                                                                             */
/* ------------------------------------------------------------------------------------ */

export type Bucket = 'agree' | 'conflict' | 'one_side_only'

export type AttributeComparison = {
  mrc: string
  statement: string
  bucket: Bucket
  a: string | null
  b: string | null
  /** Why the comparator decided this, in one phrase, for the evidence panel. */
  reason: string
}

/** Relative tolerance for numeric equality. Catalog replies carry varying precision. */
export const NUMERIC_RELATIVE_TOLERANCE = 0.001

function numbersAgree(x: number, y: number): boolean {
  if (x === y) return true
  const scale = Math.max(Math.abs(x), Math.abs(y))
  if (scale === 0) return true
  return Math.abs(x - y) / scale <= NUMERIC_RELATIVE_TOLERANCE
}

/**
 * Compare two parsed values.
 *
 * Unit handling is the sharp edge. If both sides carry units in a family we can convert, they
 * are converted. If they carry units we cannot reconcile, that is a CONFLICT, never a pass:
 * silently comparing 12 millimetres against 12 inches as equal is precisely the class of
 * error that ships the wrong metal.
 */
export function compareValues(a: ParsedValue, b: ParsedValue): { bucket: Bucket; reason: string } {
  if (a.kind === 'text' || b.kind === 'text') {
    if (a.kind === 'text' && b.kind === 'text') {
      return a.normalized === b.normalized
        ? { bucket: 'agree', reason: 'identical coded reply' }
        : { bucket: 'conflict', reason: 'coded replies differ' }
    }
    // One side is a measurement and the other is prose. Not comparable, so not agreement.
    return { bucket: 'conflict', reason: 'one side is a measurement, the other is free text' }
  }

  const ua = canonicalUnit(a.unit)
  const ub = canonicalUnit(b.unit)

  // A unit on one side and none on the other is not evidence of agreement.
  if ((a.unit == null) !== (b.unit == null)) {
    return { bucket: 'conflict', reason: 'unit present on one side only' }
  }
  if (a.unit != null && b.unit != null) {
    const sameLiteral = a.unit.toUpperCase() === b.unit.toUpperCase()
    const bothLength = ua.family === 'length' && ub.family === 'length'
    if (!sameLiteral && !bothLength) {
      return { bucket: 'conflict', reason: `units not reconcilable (${a.unit} vs ${b.unit})` }
    }
  }

  const fa = ua.family === 'length' ? ua.factor : 1
  const fb = ub.family === 'length' ? ub.factor : 1

  if (a.kind === 'numeric' && b.kind === 'numeric') {
    return numbersAgree(a.value * fa, b.value * fb)
      ? { bucket: 'agree', reason: 'values equal within tolerance' }
      : { bucket: 'conflict', reason: 'values differ beyond tolerance' }
  }

  if (a.kind === 'interval' && b.kind === 'interval') {
    const lo = Math.max(a.low * fa, b.low * fb)
    const hi = Math.min(a.high * fa, b.high * fb)
    return lo <= hi
      ? { bucket: 'agree', reason: 'ranges intersect' }
      : { bucket: 'conflict', reason: 'ranges do not intersect' }
  }

  // One value, one range: containment.
  const point = a.kind === 'numeric' ? a.value * fa : (b as { value: number }).value * fb
  const range = a.kind === 'interval' ? a : (b as { low: number; high: number })
  const rf = a.kind === 'interval' ? fa : fb
  return point >= range.low * rf && point <= range.high * rf
    ? { bucket: 'agree', reason: 'value falls inside the stated range' }
    : { bucket: 'conflict', reason: 'value falls outside the stated range' }
}

/* ------------------------------------------------------------------------------------ */
/* THE DIFF                                                                               */
/* ------------------------------------------------------------------------------------ */

export type CharacteristicDiff = {
  niinA: Niin
  niinB: Niin
  sharedCount: number
  agreeCount: number
  conflictCount: number
  onlyACount: number
  onlyBCount: number
  comparisons: AttributeComparison[]
  verdict: Verdict
  /** Named, never empty by omission. Every attribute present on one side only appears here. */
  gaps: string[]
}

/** Below this many shared attributes a verdict is not supportable and the engine abstains. */
export const MINIMUM_SHARED_ATTRIBUTES = 3

export function adjudicate(
  niinA: Niin,
  niinB: Niin,
  rowsA: CharacteristicRow[],
  rowsB: CharacteristicRow[],
  options: { minimumShared?: number } = {},
): CharacteristicDiff {
  const minimumShared = options.minimumShared ?? MINIMUM_SHARED_ATTRIBUTES
  const mapA = indexByMrc(rowsA)
  const mapB = indexByMrc(rowsB)

  const comparisons: AttributeComparison[] = []
  const gaps: string[] = []

  for (const [mrc, rowA] of mapA) {
    const rowB = mapB.get(mrc)
    if (!rowB) {
      comparisons.push({
        mrc,
        statement: rowA.REQUIREMENTS_STATEMENT,
        bucket: 'one_side_only',
        a: rowA.CLEAR_TEXT_REPLY,
        b: null,
        reason: 'attribute recorded on the first item only',
      })
      gaps.push(`${mrc} ${rowA.REQUIREMENTS_STATEMENT}: absent on ${niinB}`)
      continue
    }
    const result = compareValues(parseValue(rowA.CLEAR_TEXT_REPLY), parseValue(rowB.CLEAR_TEXT_REPLY))
    comparisons.push({
      mrc,
      statement: rowA.REQUIREMENTS_STATEMENT,
      bucket: result.bucket,
      a: rowA.CLEAR_TEXT_REPLY,
      b: rowB.CLEAR_TEXT_REPLY,
      reason: result.reason,
    })
  }

  for (const [mrc, rowB] of mapB) {
    if (mapA.has(mrc)) continue
    comparisons.push({
      mrc,
      statement: rowB.REQUIREMENTS_STATEMENT,
      bucket: 'one_side_only',
      a: null,
      b: rowB.CLEAR_TEXT_REPLY,
      reason: 'attribute recorded on the second item only',
    })
    gaps.push(`${mrc} ${rowB.REQUIREMENTS_STATEMENT}: absent on ${niinA}`)
  }

  const agreeCount = comparisons.filter((c) => c.bucket === 'agree').length
  const conflictCount = comparisons.filter((c) => c.bucket === 'conflict').length
  const onlyACount = comparisons.filter((c) => c.bucket === 'one_side_only' && c.a !== null).length
  const onlyBCount = comparisons.filter((c) => c.bucket === 'one_side_only' && c.b !== null).length
  const sharedCount = agreeCount + conflictCount

  return {
    niinA,
    niinB,
    sharedCount,
    agreeCount,
    conflictCount,
    onlyACount,
    onlyBCount,
    comparisons: comparisons.sort(byBucketThenMrc),
    verdict: decideVerdict({ sharedCount, agreeCount, conflictCount, onlyACount, onlyBCount, minimumShared }),
    gaps,
  }
}

/**
 * The verdict, from the closed set, decided by rule.
 *
 * `INSUFFICIENT_DATA` is deliberately cheap to reach. It must be a real, common, non
 * embarrassing outcome, and its rate is instrumented per surface. A vocabulary whose
 * abstention token never fires is a system that is guessing.
 */
export function decideVerdict(input: {
  sharedCount: number
  agreeCount: number
  conflictCount: number
  onlyACount: number
  onlyBCount: number
  minimumShared: number
}): Verdict {
  // A conflict is decisive regardless of how much else agrees. One incompatible dimension
  // means the parts are not interchangeable, whatever the other twenty attributes say.
  if (input.conflictCount > 0) return 'CONFLICT'
  if (input.sharedCount < input.minimumShared) return 'INSUFFICIENT_DATA'
  if (input.onlyACount === 0 && input.onlyBCount === 0) return 'IDENTICAL'
  return 'CONFIRM_WITH_EXCEPTIONS'
}

function indexByMrc(rows: CharacteristicRow[]): Map<string, CharacteristicRow> {
  const map = new Map<string, CharacteristicRow>()
  for (const row of rows) if (!map.has(row.MRC)) map.set(row.MRC, row)
  return map
}

const BUCKET_ORDER: Record<Bucket, number> = { conflict: 0, one_side_only: 1, agree: 2 }

function byBucketThenMrc(x: AttributeComparison, y: AttributeComparison): number {
  const d = BUCKET_ORDER[x.bucket] - BUCKET_ORDER[y.bucket]
  return d !== 0 ? d : x.mrc.localeCompare(y.mrc)
}

/* ------------------------------------------------------------------------------------ */
/* STAGE 4 GUARD. The language layer explains; it never adds.                             */
/* ------------------------------------------------------------------------------------ */

export type ExplanationViolation = {
  kind: 'unknown_attribute_code' | 'introduced_measurement'
  detail: string
}

/**
 * Check a generated explanation against the diff it was given.
 *
 * Two checks, both cheap, both catching a documented real failure:
 *  1. Every attribute code cited must exist in the diff. A model citing a plausible code it
 *     invented is the single most convincing way to be wrong.
 *  2. Every measurement in the prose must appear in a reply the diff actually carried. This
 *     is the head-diameter failure: a number that appears nowhere in the data, narrated with
 *     confidence.
 *
 * A violation is not a warning. The explanation is discarded and the surface renders the
 * structured diff alone, which was always the load-bearing artifact.
 */
export function validateExplanation(
  explanation: string,
  diff: CharacteristicDiff,
): ExplanationViolation[] {
  const violations: ExplanationViolation[] = []

  const knownCodes = new Set(diff.comparisons.map((c) => c.mrc.toUpperCase()))
  // Attribute codes are four alphanumerics, cited in prose as bare tokens.
  for (const token of explanation.match(/\b[A-Z]{4}\b/g) ?? []) {
    if (!knownCodes.has(token) && !ENGLISH_FOUR_LETTER_ALLOWLIST.has(token)) {
      violations.push({
        kind: 'unknown_attribute_code',
        detail: `cites attribute code ${token}, which is not in the diff`,
      })
    }
  }

  const knownNumbers = new Set<string>()
  for (const c of diff.comparisons) {
    for (const side of [c.a, c.b]) {
      if (!side) continue
      for (const n of side.match(/\d+(?:\.\d+)?/g) ?? []) knownNumbers.add(stripTrailingZeros(n))
    }
  }
  for (const n of explanation.match(/\d+(?:\.\d+)?/g) ?? []) {
    const normalized = stripTrailingZeros(n)
    if (!knownNumbers.has(normalized) && !isCountLikeReference(explanation, n)) {
      violations.push({
        kind: 'introduced_measurement',
        detail: `states the value ${n}, which appears in no reply in the diff`,
      })
    }
  }

  return violations
}

function stripTrailingZeros(n: string): string {
  return n.includes('.') ? n.replace(/0+$/, '').replace(/\.$/, '') : n
}

/**
 * The counts the explanation is allowed to state, because the diff itself produced them.
 * Anything else numeric has to come from a reply.
 */
function isCountLikeReference(explanation: string, n: string): boolean {
  const idx = explanation.indexOf(n)
  if (idx < 0) return false
  const window = explanation.slice(Math.max(0, idx - 40), idx + n.length + 40).toLowerCase()
  return /attribute|shared|agree|conflict|differ|of the|characteristic/.test(window)
}

/** Four-letter English words that appear in ordinary prose and are not attribute codes. */
const ENGLISH_FOUR_LETTER_ALLOWLIST = new Set([
  'BOTH', 'THIS', 'THAT', 'WITH', 'FROM', 'HAVE', 'ONLY', 'SAME', 'ITEM', 'PART',
  'DATA', 'NOTE', 'THEY', 'THEN', 'ALSO', 'EACH', 'SIDE', 'NONE', 'MUST', 'WHEN',
])
