/**
 * THE NUMERAL EXTRACTOR. Finds every number in a piece of text, however it is spelled.
 *
 * This is the instrument the numeral firewall stands on, and its only job is to be impossible
 * to walk past. The firewall's rule is simple (a numeral the engine did not hand over must not
 * reach a supplier), and every bit of the difficulty is here, in noticing that a numeral is
 * present at all.
 *
 * ---------------------------------------------------------------------------------------
 * THE NAMED DEFECT THIS FILE EXISTS TO FIX: "eighteen fifty resolves to 68"
 * ---------------------------------------------------------------------------------------
 * The standard textbook algorithm for spelled-out numbers accumulates and sums:
 *
 *     current = 0; total = 0
 *     "eighteen" -> current = 18
 *     "fifty"    -> current = 18 + 50 = 68        <-- WRONG
 *
 * That is correct for "twenty five" (25) and catastrophically wrong for "eighteen fifty",
 * which every English speaker reads as 1850. A price read back as sixty eight when the quote
 * said eighteen fifty is not a rounding error, it is a different offer.
 *
 * The fix is a GROUPING pass before the arithmetic. A tens word followed by a unit word is one
 * group ("twenty five" -> [25]). A teen is its own group. Two adjacent standalone groups that
 * are both at least ten, with no scale word between them, are a PAIR READING and concatenate:
 * [18][50] -> 1850, [19][99] -> 1999. That is how English says years and prices, and the sum
 * reading is never produced, because it is not a reading a human would ever hear.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT COUNTS AS FOUND
 * ---------------------------------------------------------------------------------------
 * Digit runs, separated digit runs (1,850 / 1 850 / 1'850), decimals, currency-marked amounts,
 * percentages, ordinals (23rd, twenty-third), spelled cardinals at any scale, mixed forms
 * ("18 hundred"), and identifier-shaped runs (NSN, NIIN, CAGE, solicitation, PO). Anything in
 * a non-ASCII digit script or split by an invisible character is folded first by
 * `normaliseForGuard`, so this file only ever sees one representation.
 */

import { canonicaliseIdentifier, normaliseForGuard } from './normalize'

/**
 * The six protected classes, per the voice verdict N6 as recalibrated for the parts domain.
 *
 * QUANTITY includes PLAIN COUNTS, which inverts the healthcare default where a bare count is
 * usually harmless. Here a bare count is the quantity on a quote, so it is policed.
 */
export type ProtectedClass =
  | 'MONEY'
  | 'QUANTITY'
  | 'NSN_OR_PART'
  | 'CAGE'
  | 'DATE_OR_DEADLINE'
  | 'PO_OR_SOLICITATION'

export type NumeralKind = 'digits' | 'spelled' | 'mixed' | 'identifier'

export type NumeralToken = {
  /** Exactly as it appeared in the normalised text. */
  raw: string
  /** Character offsets into the normalised text, so a guard event can point at it. */
  start: number
  end: number
  kind: NumeralKind
  klass: ProtectedClass
  /**
   * The numeric value, for value-comparable classes (MONEY, QUANTITY, DATE_OR_DEADLINE).
   * Null for identifiers, where a numeric value is meaningless and comparison is exact.
   */
  value: number | null
  /**
   * The exact-comparison form, for identifier classes. Case folded, separators and homoglyphs
   * removed. Null for value classes.
   */
  identifier: string | null
  /**
   * True when the extractor could not settle on a single reading. An ambiguous token is ALWAYS
   * treated as a violation by the firewall, because a number we cannot read is a number we
   * cannot verify, and fail-closed means fail-honest.
   */
  ambiguous: boolean
}

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, nought: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
  ninety: 90,
}

const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
}

/** Ordinal spellings map back to their cardinal value: "twenty-third" is still 23. */
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
  fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90,
  hundredth: 100, thousandth: 1000,
}

const NUMBER_WORD = new Set([
  ...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(SCALES), ...Object.keys(ORDINALS),
  'and', 'a',
])

/**
 * Turn a run of number words into a single value, with the pair reading applied.
 *
 * Returns null when the run does not parse to anything (for example a bare "and"), which the
 * caller treats as "not a numeral" rather than as a zero.
 */
export function parseSpelledNumber(words: string[]): { value: number; ambiguous: boolean } | null {
  const w = words.map((x) => x.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean)
  if (w.length === 0) return null

  // PASS ONE: collapse into groups. A group is a value below 100, or a scale marker.
  type Group = { kind: 'value'; n: number } | { kind: 'scale'; n: number }
  const groups: Group[] = []
  let i = 0
  let sawAnyNumber = false

  while (i < w.length) {
    const word = w[i]
    // Every lookup below reads through a guard rather than an index assertion. In a numeral
    // firewall an undefined that silently becomes NaN is how a wrong number reaches a quote,
    // so the strict index checking stays on and the code bends to it.
    if (word === undefined || word === 'and' || word === 'a') { i += 1; continue }

    const scale = SCALES[word]
    if (scale !== undefined) {
      groups.push({ kind: 'scale', n: scale })
      sawAnyNumber = true
      i += 1
      continue
    }

    const ten = TENS[word]
    if (ten !== undefined) {
      let n = ten
      const next = w[i + 1]
      // "twenty five" is ONE group worth 25. This merge is what stops the pair reading from
      // firing on ordinary two-word numbers.
      if (next !== undefined) {
        const nextUnit = UNITS[next]
        const nextOrdinal = ORDINALS[next]
        if (nextUnit !== undefined && nextUnit >= 1 && nextUnit <= 9) {
          n += nextUnit
          i += 1
        } else if (nextOrdinal !== undefined && nextOrdinal >= 1 && nextOrdinal <= 9) {
          n += nextOrdinal
          i += 1
        }
      }
      groups.push({ kind: 'value', n })
      sawAnyNumber = true
      i += 1
      continue
    }

    const unit = UNITS[word]
    if (unit !== undefined) {
      groups.push({ kind: 'value', n: unit })
      sawAnyNumber = true
      i += 1
      continue
    }

    const ordinal = ORDINALS[word]
    if (ordinal !== undefined) {
      groups.push({ kind: 'value', n: ordinal })
      sawAnyNumber = true
      i += 1
      continue
    }
    i += 1
  }

  if (!sawAnyNumber) return null

  // PASS TWO: the pair reading. Exactly two value groups, no scale anywhere, both at least ten.
  // "eighteen fifty" -> 1850. "nineteen ninety nine" -> [19][99] -> 1999.
  const hasScale = groups.some((g) => g.kind === 'scale')
  const values = groups
    .filter((g): g is { kind: 'value'; n: number } => g.kind === 'value')
    .map((g) => g.n)

  // Destructuring with an explicit undefined check, so the pair reading only fires when both
  // members genuinely exist. `values.length === 2` and `values[0]!` would be equivalent to the
  // compiler and NOT equivalent under mutation: a repair that silences the type here would let
  // a one-element run reach the multiplication and produce NaN, which compares unequal to every
  // approved value and therefore blocks. Blocking is the safe direction, but it would block for
  // the wrong reason and hide a parser bug behind a correct-looking outcome.
  const [first, second, third] = values
  if (!hasScale && values.length === 2 && first !== undefined && second !== undefined) {
    if (first >= 10 && second >= 10) {
      return { value: first * 100 + second, ambiguous: false }
    }
  }
  // "nineteen oh five" -> 1905. The zero word is what disambiguates it from a sum.
  if (
    !hasScale && values.length === 3 &&
    first !== undefined && second !== undefined && third !== undefined
  ) {
    if (first >= 10 && second === 0 && third < 10) {
      return { value: first * 100 + third, ambiguous: false }
    }
  }

  // PASS THREE: ordinary scale arithmetic for everything else.
  let total = 0
  let current = 0
  for (const g of groups) {
    if (g.kind === 'value') { current += g.n; continue }
    if (g.n === 100) {
      current = (current === 0 ? 1 : current) * 100
    } else {
      total += (current === 0 ? 1 : current) * g.n
      current = 0
    }
  }
  return { value: total + current, ambiguous: false }
}

/** NSN: thirteen digits, usually grouped 4-2-3-4. NIIN: the last nine. */
const RE_NSN = /\b\d{4}[-\s]?\d{2}[-\s]?\d{3}[-\s]?\d{4}\b/g
/** DIBBS solicitation numbers: SPE + 3, then the dash-separated tail. */
const RE_SOLICITATION = /\b(?:SPE|SPM|SP[A-Z0-9])[A-Z0-9]{2,4}-\d{2}-[A-Z]-[A-Z0-9]{3,5}\b/gi
/** A digit run with optional grouping separators and an optional decimal tail. */
const RE_DIGITS = /\d+(?:[.,'   ]\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/g

function contextWindow(text: string, start: number, end: number, span = 24): string {
  return text.slice(Math.max(0, start - span), Math.min(text.length, end + span)).toLowerCase()
}

/**
 * Decide which protected class a numeral belongs to, from its shape and its neighbours.
 *
 * Classification drives the BLOCK REASON shown to the operator, not whether it blocks. An
 * unapproved numeral is blocked whatever class it lands in, so a misclassification degrades
 * an explanation, never a control. That ordering is deliberate: a classifier that has to be
 * right for the gate to hold is a classifier that will eventually let something through.
 */
function classify(raw: string, ctx: string): ProtectedClass {
  if (/\bcage\b/.test(ctx)) return 'CAGE'
  if (/\b(nsn|niin|part\s*(number|no)|p\/n)\b/.test(ctx)) return 'NSN_OR_PART'
  if (/\b(solicitation|rfq|award|purchase\s*order|\bpo\b|contract)\b/.test(ctx)) return 'PO_OR_SOLICITATION'
  if (/[$£€]|\b(usd|dollar|dollars|cents?|price|priced|quote[ds]?|unit\s*price|each\b)/.test(ctx)) return 'MONEY'
  if (/\b(due|deadline|by|expires?|close[sd]?|cutoff|return\s*date|am|pm|hours?|days?|weeks?|months?|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/.test(ctx)) {
    return 'DATE_OR_DEADLINE'
  }
  return 'QUANTITY'
}

/**
 * Extract every numeral in `input`.
 *
 * Identifier-shaped runs are matched FIRST and their spans are reserved, so the thirteen digits
 * of an NSN are never also reported as four separate quantities. Overlap handling is the
 * difference between one honest finding and four noisy ones on the same text.
 */
export function extractNumerals(input: string): NumeralToken[] {
  const { text } = normaliseForGuard(input)
  const tokens: NumeralToken[] = []
  const taken: Array<[number, number]> = []

  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a)
  const reserve = (s: number, e: number) => taken.push([s, e])

  const scanIdentifier = (re: RegExp, klass: ProtectedClass) => {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      const s = m.index as number
      const e = s + m[0].length
      if (overlaps(s, e)) continue
      reserve(s, e)
      tokens.push({
        raw: m[0], start: s, end: e, kind: 'identifier', klass,
        value: null, identifier: canonicaliseIdentifier(m[0]), ambiguous: false,
      })
    }
  }

  scanIdentifier(RE_SOLICITATION, 'PO_OR_SOLICITATION')
  scanIdentifier(RE_NSN, 'NSN_OR_PART')

  // Spelled-out runs, including mixed forms like "18 hundred" and hyphenated "twenty-three".
  const wordRe = /\b[A-Za-z]+(?:-[A-Za-z]+)*\b/g
  let run: { words: string[]; start: number; end: number } | null = null
  const flush = () => {
    if (!run) return
    const parsed = parseSpelledNumber(run.words)
    if (parsed && !overlaps(run.start, run.end)) {
      reserve(run.start, run.end)
      const raw = text.slice(run.start, run.end)
      tokens.push({
        raw, start: run.start, end: run.end, kind: 'spelled',
        klass: classify(raw, contextWindow(text, run.start, run.end)),
        value: parsed.value, identifier: null, ambiguous: parsed.ambiguous,
      })
    }
    run = null
  }
  for (const m of text.matchAll(wordRe)) {
    const parts = m[0].toLowerCase().split('-')
    const isNumberish = parts.every((p) => NUMBER_WORD.has(p))
    const s = m.index as number
    const e = s + m[0].length
    if (isNumberish) {
      if (run && s - run.end <= 2) {
        run.words.push(...parts)
        run.end = e
      } else {
        flush()
        run = { words: [...parts], start: s, end: e }
      }
    } else {
      flush()
    }
  }
  flush()
  // A run consisting only of "and" or "a" parses to null and is correctly dropped by `flush`.

  // Bare digit runs last, so identifiers and spelled forms have already claimed their spans.
  RE_DIGITS.lastIndex = 0
  for (const m of text.matchAll(RE_DIGITS)) {
    const s = m.index as number
    const e = s + m[0].length
    if (overlaps(s, e)) continue
    reserve(s, e)
    const cleaned = m[0].replace(/[,'   ]/g, '')
    const value = Number(cleaned)
    const ctx = contextWindow(text, s, e)
    tokens.push({
      raw: m[0], start: s, end: e, kind: 'digits', klass: classify(m[0], ctx),
      value: Number.isFinite(value) ? value : null,
      identifier: canonicaliseIdentifier(m[0]),
      ambiguous: !Number.isFinite(value),
    })
  }

  return tokens.sort((a, b) => a.start - b.start)
}
