/**
 * THE NUMERAL EXTRACTOR BEHIND THE PROVENANCE FIREWALL (acceptance gate R3.8, disqualifying).
 *
 * The firewall's rule is one sentence: a numeral that reaches a supplier must resolve to a field
 * the engine actually computed. All of the difficulty lives here, in noticing that a numeral is
 * present at all and in reading it the way a human reads it.
 *
 * ------------------------------------------------------------------------------------------
 * THE FIVE DECISIONS, STATED SO NOBODY HAS TO REVERSE ENGINEER THEM
 * ------------------------------------------------------------------------------------------
 *
 * 1. DIGIT FORMS ARE READ TO A VALUE, NOT TO A STRING. `$1,537.85`, `1537.85` and `1,537.85`
 *    are the same fact printed three ways. Grounding compares VALUES, so a payload that stores
 *    1537.85 grounds all three. A string comparison would ground none of them and would send
 *    the operator an abstention on a correct sentence.
 *
 * 2. SPELLED FORMS ARE READ TO A VALUE TOO, AND THEY STILL HAVE TO GROUND. This is the named
 *    past failure: a sibling system's guard built its grounding set from digits only, so the
 *    honest sentence "a thousand" could never match a payload holding 1000, and the system
 *    abstained politely on a correct answer. The fix for that defect is NORMALISATION, not an
 *    exemption. An exemption would have been the worse bug in the other direction, because
 *    "two thousand five hundred dollars" is a fabrication that a digits-only guard never sees.
 *    So spelled cardinals are parsed to a number and checked exactly like digits, and the
 *    firewall reports them in their own `spelled` bucket so an operator can see the
 *    normalisation working rather than having to trust that it is.
 *    The cost is stated honestly: a bare idiomatic cardinal ("for three reasons") blocks unless
 *    3 is in the payload. That is the fail-closed direction, and on a federal quote the
 *    fail-closed direction is the only defensible one.
 *    ORDINAL WORDS ("first", "second", "third") are deliberately NOT numerals. They are
 *    discourse markers in this prose, never measurements, and treating them as numerals is
 *    pure false-positive with no fabrication risk closed in exchange.
 *
 * 3. IDENTIFIERS ARE NOT FREE NUMERALS, BUT THEY ARE NOT EXEMPT EITHER. NSN 1650-01-059-8221
 *    must produce ONE finding, not four (1650, 01, 059, 8221). Identifier shapes are matched
 *    first and their spans reserved, so their digits can never be re-emitted as quantities.
 *    An identifier is then checked by EXACT canonical string membership, because an invented
 *    stock number is every bit as fatal as an invented price, and an exemption dressed as a
 *    class would be the obvious place to hide one.
 *
 * 4. A NUMBER MUST NOT ESCAPE BY STANDING NEXT TO A LETTER. `17k`, `2.5M`, `23rd` and `17-inch`
 *    are numerals wearing a letter, not identifiers. The identifier test therefore requires the
 *    token to start with a letter or to carry a hyphen or slash, and it explicitly rejects the
 *    `<number><separator><word>` shape. Everything rejected there falls through to the digit
 *    scanner, which is the safe direction: a token can only ever fall from the exempt class into
 *    the policed class, never the other way.
 *
 * 5. THE TEXT IS FOLDED BEFORE ANYTHING READS IT. A model (or a supplier replying in kind) does
 *    not need to invent a number to walk past a naive guard, only to spell it in a script the
 *    guard does not read. Fullwidth digits, Arabic-Indic digits and a zero-width space inserted
 *    mid-number all render identically to a human and defeat /[0-9]/ entirely.
 *
 * Offsets reported by this module index the NORMALISED text, not the caller's original string,
 * because NFKC can change length. The firewall returns the normalised text alongside the
 * findings so the two always agree.
 */

/**
 * Code points that can split a numeral without a reader ever seeing that it happened.
 * Held as numbers rather than as a regex character class on purpose: a literal zero-width
 * character sitting in source is invisible to the next person to read this file, which is the
 * same defect it is here to close.
 */
const INVISIBLE_RANGES: Array<[number, number]> = [
  [0x00ad, 0x00ad], // soft hyphen
  [0x180e, 0x180e], // Mongolian vowel separator
  [0x200b, 0x200f], // zero width space through right-to-left mark
  [0x202a, 0x202e], // bidi embedding and override
  [0x2060, 0x2064], // word joiner and the invisible operators
  [0x206a, 0x206f], // deprecated formatting
  [0xfeff, 0xfeff], // byte order mark used mid-string
]

function isInvisible(cp: number): boolean {
  return INVISIBLE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)
}

/**
 * Code point of the digit zero in each non-ASCII digit script that NFKC does NOT fold.
 * Ten consecutive code points per script, which is guaranteed by Unicode for these blocks.
 */
const DIGIT_SCRIPT_ZEROS = [
  0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66,
  0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x17e0, 0x1810,
]

/**
 * Fold text into the single representation every downstream check reads.
 *
 * Exists because every comparison below this line is a value or byte comparison, and a value
 * comparison is only as honest as the characters it is handed.
 */
export function normaliseForFirewall(input: string): string {
  let visible = ''
  for (const ch of input) {
    const cp = ch.codePointAt(0)
    if (cp !== undefined && isInvisible(cp)) continue
    visible += ch
  }
  const stripped = visible.normalize('NFKC')
  let out = ''
  for (const ch of stripped) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    let folded = ch
    for (const zero of DIGIT_SCRIPT_ZEROS) {
      if (cp >= zero && cp <= zero + 9) {
        folded = String.fromCharCode(48 + (cp - zero))
        break
      }
    }
    out += folded
  }
  return out
}

/**
 * The exact-comparison form of an identifier.
 *
 * Exists because the same stock number is printed as 1650-01-059-8221, 1650 01 059 8221 and
 * 1650010598221 by three different systems, and all three name one part.
 */
export function canonicaliseIdentifier(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export type TokenForm = 'digits' | 'spelled' | 'identifier' | 'template'

/**
 * One reading of a printed numeral. A single token can carry several: `0.04%` is honestly
 * either 0.04 (the printed percentage) or 0.0004 (the rate a payload usually stores).
 */
export type NumericCandidate = {
  value: number
  /** Decimal places actually printed, which is the precision a rounded payload may match at. */
  decimals: number
  label: 'printed' | 'percent_as_rate' | 'scaled_by_suffix'
}

export type ExtractedToken = {
  /** Exactly as it appears in the normalised text, including any $ or % that belongs to it. */
  raw: string
  start: number
  end: number
  form: TokenForm
  /** Which rule claimed it, for the operator-facing reason. */
  shape: string
  /** Empty for identifiers and template slots, where a numeric value is meaningless. */
  candidates: NumericCandidate[]
  /** Set for identifiers only. */
  canonical: string | null
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
}

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
}

function isNumberWord(word: string): boolean {
  return UNITS[word] !== undefined || TENS[word] !== undefined || SCALES[word] !== undefined
}

/**
 * Turn a run of number words into one value.
 *
 * Exists because the textbook accumulate-and-sum algorithm reads "eighteen fifty" as 68, and a
 * price read back as sixty eight when the quote said eighteen fifty is not a rounding error, it
 * is a different offer. The grouping pass below produces the reading a human hears (1850) and
 * never produces the sum reading.
 */
export function parseSpelledWords(words: string[]): number | null {
  const groups: Array<{ kind: 'value' | 'scale'; n: number }> = []
  let i = 0
  while (i < words.length) {
    const w = words[i]
    if (w === undefined) {
      i += 1
      continue
    }
    const scale = SCALES[w]
    if (scale !== undefined) {
      groups.push({ kind: 'scale', n: scale })
      i += 1
      continue
    }
    const ten = TENS[w]
    if (ten !== undefined) {
      let n = ten
      const next = words[i + 1]
      const nextUnit = next === undefined ? undefined : UNITS[next]
      // "twenty five" is ONE group worth 25. This merge is what stops the pair reading below
      // from firing on an ordinary two-word number.
      if (nextUnit !== undefined && nextUnit >= 1 && nextUnit <= 9) {
        n += nextUnit
        i += 1
      }
      groups.push({ kind: 'value', n })
      i += 1
      continue
    }
    const unit = UNITS[w]
    if (unit !== undefined) {
      groups.push({ kind: 'value', n: unit })
      i += 1
      continue
    }
    i += 1
  }
  if (groups.length === 0) return null

  const hasScale = groups.some((g) => g.kind === 'scale')
  const values = groups.filter((g) => g.kind === 'value').map((g) => g.n)
  const [first, second] = values
  // The pair reading: two standalone groups, both at least ten, no scale word between them.
  // That is how English says a year or a price, and it is never a sum.
  if (
    !hasScale &&
    values.length === 2 &&
    first !== undefined &&
    second !== undefined &&
    first >= 10 &&
    second >= 10
  ) {
    return first * 100 + second
  }

  let total = 0
  let current = 0
  for (const g of groups) {
    if (g.kind === 'value') {
      current += g.n
      continue
    }
    if (g.n === 100) {
      current = (current === 0 ? 1 : current) * 100
      continue
    }
    total += (current === 0 ? 1 : current) * g.n
    current = 0
  }
  return total + current
}

/**
 * Identifier shapes, matched before anything else so their digits are never re-emitted as
 * quantities. Order matters: the longest shape wins its span first.
 */
const IDENTIFIER_SHAPES: Array<{ re: RegExp; shape: string }> = [
  { re: /\bSP[A-Z0-9]{1,4}-\d{2}-[A-Z]-[A-Z0-9]{3,6}\b/gi, shape: 'solicitation' },
  { re: /\b\d{4}-\d{2}-\d{3}-\d{4}\b/g, shape: 'nsn' },
  { re: /\b\d{13}\b/g, shape: 'nsn_unpunctuated' },
  { re: /\b\d{2}-\d{3}-\d{4}\b/g, shape: 'niin' },
  { re: /\b\d{4}-\d{2}-\d{2}\b/g, shape: 'iso_date' },
]

/** A run of characters that could be a code. Filtered in `looksLikeIdentifier` below. */
const RE_CODE_CANDIDATE = /[A-Za-z0-9][A-Za-z0-9./-]*[A-Za-z0-9]/g

/**
 * `<number><optional separator><word>` is a measurement wearing a letter, never a code.
 * 17k, 2.5M, 23rd, 17-inch, 190-unit. These fall through to the digit scanner on purpose.
 */
const RE_NUMBER_WITH_WORD = /^\d[\d,.]*[-/]?[A-Za-z]+$/

function looksLikeIdentifier(token: string): boolean {
  if (token.length < 4) return false
  if (!/[A-Za-z]/.test(token)) return false
  if (!/\d/.test(token)) return false
  if (RE_NUMBER_WITH_WORD.test(token)) return false
  return /^[A-Za-z]/.test(token) || token.includes('-') || token.includes('/')
}

/**
 * A template slot that survived substitution. `{{f7}}` on a federal quote is not a cosmetic
 * defect, it is proof that the render lost a field, so the unbalanced halves are caught too.
 */
const RE_TEMPLATE = /\{\{[^{}]*\}\}|\{\{|\}\}/g

/** Digit runs, with optional thousands grouping and an optional decimal tail. */
const RE_DIGITS = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

/** Words, including the hyphenated forms ("twenty-three"). */
const RE_WORD = /[A-Za-z]+(?:-[A-Za-z]+)*/g

const SUFFIX_SCALES: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000, bn: 1_000_000_000 }

function decimalsOf(numeric: string): number {
  const dot = numeric.indexOf('.')
  return dot === -1 ? 0 : numeric.length - dot - 1
}

/**
 * Extract every numeral, identifier and dangling template slot from ALREADY NORMALISED text.
 *
 * Exists as its own exported function so the firewall's instrument can be tested directly:
 * a gate whose extractor is only reachable through the gate cannot be shown to find anything.
 */
export function extractTokens(text: string): ExtractedToken[] {
  const tokens: ExtractedToken[] = []
  const taken: Array<[number, number]> = []
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a)
  const reserve = (s: number, e: number) => {
    taken.push([s, e])
  }

  RE_TEMPLATE.lastIndex = 0
  for (const m of text.matchAll(RE_TEMPLATE)) {
    const s = m.index
    const e = s + m[0].length
    if (overlaps(s, e)) continue
    reserve(s, e)
    tokens.push({
      raw: m[0], start: s, end: e, form: 'template', shape: 'template_slot',
      candidates: [], canonical: null,
    })
  }

  for (const { re, shape } of IDENTIFIER_SHAPES) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      const s = m.index
      const e = s + m[0].length
      if (overlaps(s, e)) continue
      reserve(s, e)
      tokens.push({
        raw: m[0], start: s, end: e, form: 'identifier', shape,
        candidates: [], canonical: canonicaliseIdentifier(m[0]),
      })
    }
  }

  RE_CODE_CANDIDATE.lastIndex = 0
  for (const m of text.matchAll(RE_CODE_CANDIDATE)) {
    const s = m.index
    const e = s + m[0].length
    if (overlaps(s, e)) continue
    if (!looksLikeIdentifier(m[0])) continue
    reserve(s, e)
    tokens.push({
      raw: m[0], start: s, end: e, form: 'identifier', shape: 'alphanumeric_code',
      candidates: [], canonical: canonicaliseIdentifier(m[0]),
    })
  }

  // Spelled runs. Collected before the digit scan so a mixed form cannot be split in half.
  const hits: Array<{ word: string; parts: string[]; start: number; end: number }> = []
  RE_WORD.lastIndex = 0
  for (const m of text.matchAll(RE_WORD)) {
    hits.push({
      word: m[0].toLowerCase(),
      parts: m[0].toLowerCase().split('-'),
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  const allNumberWords = (parts: string[]) => parts.length > 0 && parts.every(isNumberWord)
  const isScaleWord = (w: string | undefined) => w !== undefined && SCALES[w] !== undefined
  const onlyGlue = (from: number, to: number) => /^[\s-]*$/.test(text.slice(from, to))

  let i = 0
  while (i < hits.length) {
    const head = hits[i]
    if (head === undefined) {
      i += 1
      continue
    }
    const nextHit = hits[i + 1]
    const startsRun =
      allNumberWords(head.parts) ||
      ((head.word === 'a' || head.word === 'an') &&
        nextHit !== undefined &&
        isScaleWord(nextHit.word) &&
        onlyGlue(head.end, nextHit.start))
    if (!startsRun) {
      i += 1
      continue
    }

    const words: string[] = []
    let start = head.start
    let end = head.start
    let j = i
    while (j < hits.length) {
      const h = hits[j]
      if (h === undefined) break
      if (j > i && !onlyGlue(end, h.start)) break
      if (allNumberWords(h.parts)) {
        words.push(...h.parts)
        end = h.end
        j += 1
        continue
      }
      const after = hits[j + 1]
      if (
        (h.word === 'a' || h.word === 'an') &&
        after !== undefined &&
        isScaleWord(after.word) &&
        onlyGlue(h.end, after.start)
      ) {
        // "a thousand" is 1000. The article carries no value of its own, so nothing is pushed.
        if (words.length === 0) start = h.start
        end = h.end
        j += 1
        continue
      }
      if (h.word === 'and' && after !== undefined && allNumberWords(after.parts) && onlyGlue(h.end, after.start)) {
        j += 1
        continue
      }
      break
    }

    const value = parseSpelledWords(words)
    if (value !== null && !overlaps(start, end)) {
      reserve(start, end)
      tokens.push({
        raw: text.slice(start, end), start, end, form: 'spelled', shape: 'spelled_cardinal',
        candidates: [{ value, decimals: 0, label: 'printed' }], canonical: null,
      })
    }
    i = Math.max(j, i + 1)
  }

  RE_DIGITS.lastIndex = 0
  for (const m of text.matchAll(RE_DIGITS)) {
    let s = m.index
    let e = s + m[0].length
    if (overlaps(s, e)) continue

    const numeric = m[0].replace(/,/g, '')
    const base = Number(numeric)
    if (!Number.isFinite(base)) continue
    const decimals = decimalsOf(numeric)
    const candidates: NumericCandidate[] = [{ value: base, decimals, label: 'printed' }]

    const currency = /(\$\s?)$/.exec(text.slice(0, s))
    const currencyPrefix = currency === null ? undefined : currency[1]
    if (currencyPrefix !== undefined) s -= currencyPrefix.length

    const tail = text.slice(e)
    if (tail.startsWith('%')) {
      e += 1
      // A payload that stores a rate stores 0.0004, and the sentence honestly prints 0.04%.
      // Both readings are offered; grounding needs only one of them to land.
      candidates.push({ value: base / 100, decimals: decimals + 2, label: 'percent_as_rate' })
    } else {
      const suffix = /^(bn|k|m|b)(?![A-Za-z])/i.exec(tail)
      const suffixText = suffix === null ? undefined : suffix[1]
      if (suffixText !== undefined) {
        const mult = SUFFIX_SCALES[suffixText.toLowerCase()]
        if (mult !== undefined) {
          e += suffixText.length
          candidates.push({
            value: base * mult,
            decimals: Math.max(0, decimals - String(mult).length + 1),
            label: 'scaled_by_suffix',
          })
        }
      } else {
        const ordinal = /^(st|nd|rd|th)(?![A-Za-z])/i.exec(tail)
        const ordinalText = ordinal === null ? undefined : ordinal[1]
        if (ordinalText !== undefined) e += ordinalText.length
      }
    }

    reserve(s, e)
    tokens.push({
      raw: text.slice(s, e), start: s, end: e, form: 'digits', shape: 'digit_run',
      candidates, canonical: null,
    })
  }

  return tokens.sort((a, b) => a.start - b.start)
}

/** One primitive reachable in the payload, addressed by path. This is what a blocked render shows. */
export type GroundedFact = { path: string; value: string }

export type PayloadGrounding = {
  /** Every finite number reachable in the payload. Order is walk order, never sorted. */
  numbers: number[]
  /** Canonical forms of every payload string and every payload number. */
  identifiers: Set<string>
  facts: GroundedFact[]
}

/**
 * Flatten a structured payload into the sets the firewall checks membership against.
 *
 * Exists to make one refusal explicit: digit runs are NEVER mined out of the middle of a payload
 * string. Doing so would add 1650, 01, 059 and 8221 to the numeric pool from a single stock
 * number, and the fabricated numeral "8221" would then ground against a part number. A payload
 * string contributes its whole-string numeric reading and its canonical identifier form, nothing
 * in between.
 */
export function collectGrounding(payload: unknown): PayloadGrounding {
  const numbers: number[] = []
  const identifiers = new Set<string>()
  const facts: GroundedFact[] = []
  const seen = new Set<object>()

  const addIdentifier = (raw: string) => {
    const canonical = canonicaliseIdentifier(raw)
    if (canonical.length >= 2) identifiers.add(canonical)
  }

  const walk = (node: unknown, path: string): void => {
    if (node === null || node === undefined) return
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) return
      numbers.push(node)
      addIdentifier(String(node))
      facts.push({ path, value: String(node) })
      return
    }
    if (typeof node === 'bigint') {
      const asNumber = Number(node)
      if (Number.isFinite(asNumber)) numbers.push(asNumber)
      addIdentifier(node.toString())
      facts.push({ path, value: node.toString() })
      return
    }
    if (typeof node === 'boolean') {
      facts.push({ path, value: String(node) })
      return
    }
    if (typeof node === 'string') {
      const trimmed = node.trim()
      facts.push({ path, value: node })
      addIdentifier(trimmed)
      const numericLike = trimmed.replace(/[$,\s]/g, '')
      if (/^-?\d+(?:\.\d+)?%?$/.test(numericLike)) {
        const isPercent = numericLike.endsWith('%')
        const parsed = Number(isPercent ? numericLike.slice(0, -1) : numericLike)
        if (Number.isFinite(parsed)) {
          numbers.push(parsed)
          if (isPercent) numbers.push(parsed / 100)
        }
      }
      // THE WHOLE STRING MUST BE A DATE, and the calendar fields must be in range.
      //
      // This pattern was anchored only at the start, so it matched the PREFIX of anything shaped
      // like four digits, a dash, two digits, a dash, two digits. A stock number satisfies that:
      // '1650-01-059-8221' matched as though it read '1650-01-05', and the FSC 1650 entered the
      // numeric pool as a year. The consequence runs in the dangerous direction. The pool is the
      // set of numerals the firewall treats as GROUNDED, so a fabricated "$1,650" in generated
      // prose would have resolved against a stock number and passed, which is the exact failure
      // this module exists to make impossible. It also contradicted the refusal stated in this
      // function's own header comment: digit runs are never mined out of the middle of a string.
      //
      // Anchoring both ends and range-checking the month and day is what makes an identifier fail
      // to parse as a date. A trailing-time form is allowed because that is still wholly a date.
      const isoDate = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
        trimmed,
      )
      if (isoDate !== null) {
        const month = Number(isoDate[2])
        const day = Number(isoDate[3])
        // A date field is the only place a bare year legitimately comes from. Year only: adding
        // the month and the day would quietly widen the numeric pool by two small integers per
        // date, which is exactly the kind of generosity a fabricated count hides inside.
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          numbers.push(Number(isoDate[1]))
        }
      }
      return
    }
    if (typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walk(value, path === '' ? key : `${path}.${key}`)
    }
  }

  walk(payload, '')
  return { numbers, identifiers, facts }
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, Math.min(decimals, 12))
  return Math.round(value * factor) / factor
}

function nearlyEqual(a: number, b: number): boolean {
  if (a === b) return true
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}

/**
 * Whether one printed reading of a numeral resolves to a payload value.
 *
 * Exists to keep the two deliberate generosities in one visible place, both of them narrow:
 * (1) MAGNITUDE, not sign. A reason sentence carries direction in words while the payload
 *     carries a signed contribution, so -12 in the payload grounds a printed 12. Direction is
 *     policed by gate R3.7 (the flipped-sign fixture), not here, and the two must not overlap.
 * (2) ROUNDING TO THE PRECISION ACTUALLY PRINTED. A payload holding 2033.499055 grounds a
 *     printed 2,033.50 because that is the same fact typeset for a human. It does NOT ground a
 *     printed 2,034, because rounding 2033.499055 to zero decimals is 2033. There is no
 *     tolerance band, and there must never be one: a tolerance band is how a fabricated figure
 *     that happens to land nearby gets waved through.
 */
export function candidateResolves(candidate: NumericCandidate, pool: readonly number[]): boolean {
  for (const raw of pool) {
    const magnitude = Math.abs(raw)
    if (nearlyEqual(magnitude, candidate.value)) return true
    if (nearlyEqual(roundTo(magnitude, candidate.decimals), candidate.value)) return true
  }
  return false
}
