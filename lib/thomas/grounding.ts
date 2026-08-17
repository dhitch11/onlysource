/**
 * THE NUMERAL FIREWALL — conversational variant.
 *
 * `lib/ai/grounding.ts` already solves this for BRIEFS, by deleting any sentence carrying a number
 * the dossier does not contain. That is exactly right for a generated document, where a missing
 * sentence is invisible and the whole artifact is one bounded dossier.
 *
 * It is exactly WRONG for a conversation, for two reasons. First, deleting a sentence mid-reply
 * leaves a reply that does not parse as speech, and on a voice line the operator hears a sentence
 * simply missing. Second, chat is full of numbers that are not claims: "two things", "the first
 * one", "back in 2019", "give me a second". Strip those and Thomas stops sounding like a person.
 *
 * So this variant separates NUMBERS THAT ARE CLAIMS from numbers that are speech, and only polices
 * the first kind. A claim is a money figure, a percentage, or a large or precise count: the shapes an
 * operator could act on financially. Everything else passes untouched.
 *
 * THE ALLOW-SET IS BUILT PER CONVERSATION, not per sentence. It holds every figure the curated
 * background knowledge contains, every figure a tool returned during this conversation, and every
 * figure the operator themselves said. If a claim-shaped number is not in that set, Thomas invented
 * it, and the turn is regenerated once under a hard constraint before falling back to an honest
 * empty. A fabricated price on this platform is somebody bidding real money on a fiction.
 */

/** Numbers small enough to be ordinary speech rather than a claim. "Two things", "step 3". */
const SPEECH_CEILING = 12

/** Plausible calendar years pass: "back in 2019" is speech, not a measurement. */
function isYear(n: number): boolean {
  return Number.isInteger(n) && n >= 1900 && n <= 2100
}

/**
 * Pull every number out of a string as a comparable value.
 *
 * Commas are stripped so 47,102,283 reads as one number rather than three. A leading currency symbol
 * or trailing percent sign is not part of the value but IS recorded by the caller as a claim shape.
 */
export function extractNumbers(text: string): number[] {
  const out: number[] = []
  const re = /-?\$?\d[\d,]*(?:\.\d+)?%?/g
  for (const m of text.match(re) ?? []) {
    const v = Number(m.replace(/[$,%]/g, ''))
    if (Number.isFinite(v)) out.push(v)
  }
  return out
}

/**
 * The numbers in this text that are CLAIMS, with their position, so a violation can be reported
 * precisely rather than as "something in there was wrong".
 */
export function claimNumbers(text: string): Array<{ raw: string; value: number }> {
  const out: Array<{ raw: string; value: number }> = []
  const re = /(\$\s?\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?\s?%)|(\d[\d,]*(?:\.\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[0]
    const value = Number(raw.replace(/[$,%\s]/g, ''))
    if (!Number.isFinite(value)) continue

    const isMoney = Boolean(m[1])
    const isPercent = Boolean(m[2])

    /*
     * IDENTIFIERS ARE NOT CLAIMS. A stock number is 13 digits and a CAGE is alphanumeric; saying
     * one back is quoting a name, not asserting a quantity. The brief-side grounding exempts long
     * digit runs for the same reason. Checked on the RAW text so that 6530-00-299-8353 is seen as
     * an identifier rather than as four separate suspicious integers.
     */
    const before = text.slice(Math.max(0, m.index - 1), m.index)
    const after = text.slice(m.index + raw.length, m.index + raw.length + 1)
    if (before === '-' || after === '-') continue
    if (raw.replace(/\D/g, '').length >= 9) continue

    // Money and percentages are always claims, however small: "$5" and "3%" are both actionable.
    if (isMoney || isPercent) {
      out.push({ raw, value })
      continue
    }
    if (Math.abs(value) <= SPEECH_CEILING) continue
    if (isYear(value)) continue
    out.push({ raw, value })
  }
  return out
}

export type AllowSet = Set<number>

/** Build the per-conversation allow-set from every source of real figures. */
export function buildAllowSet(sources: string[]): AllowSet {
  const set: AllowSet = new Set()
  for (const s of sources) for (const n of extractNumbers(s)) set.add(n)
  return set
}

export function addNumbers(set: AllowSet, numbers: number[]): void {
  for (const n of numbers) set.add(n)
}

/**
 * Does a claimed figure match something real?
 *
 * Exact match first. Then a rounding allowance, because Thomas is TOLD to speak numbers for the ear
 * on a voice line: "about forty seven million" against a real 47,102,283 is the instruction being
 * followed, not a fabrication, and a firewall that punishes it would force him to read spreadsheet
 * decimals aloud. The allowance is deliberately tight and PROPORTIONAL, so a rounded headline passes
 * and a materially different number never does.
 */
function isGrounded(value: number, allow: AllowSet): boolean {
  if (allow.has(value)) return true
  for (const real of allow) {
    if (real === 0) continue
    const drift = Math.abs(value - real) / Math.abs(real)
    if (drift <= 0.02) return true
    // A spoken rounding of a large figure: 47,102,283 said as 47 million.
    if (Math.abs(real) >= 1000) {
      for (const unit of [1000, 1_000_000, 1_000_000_000]) {
        if (Math.abs(real) >= unit && Math.abs(value - real / unit) / (Math.abs(real) / unit) <= 0.02) return true
      }
    }
  }
  return false
}

export type GuardVerdict =
  | { ok: true }
  | { ok: false; offenders: string[] }

/** Check a finished reply. Returns the offending figures so the retry can name them. */
export function guard(text: string, allow: AllowSet): GuardVerdict {
  const offenders = claimNumbers(text)
    .filter((c) => !isGrounded(c.value, allow))
    .map((c) => c.raw.trim())
  if (!offenders.length) return { ok: true }
  return { ok: false, offenders: Array.from(new Set(offenders)) }
}

/** The constraint appended for the single regeneration attempt. */
export function constraintFor(offenders: string[]): string {
  return [
    '',
    '## NUMBER CONSTRAINT (you just broke this)',
    `You said ${offenders.map((o) => JSON.stringify(o)).join(', ')}, and none of those figures came from the`,
    'background facts you were given or from a tool result in this conversation. That means you produced',
    'them yourself, which is the one thing you may never do.',
    'Answer again. Use ONLY figures that appeared verbatim above, or call a tool and use what it returns.',
    'If you do not have a real number for something, say you will pull it. Never state one you cannot point to.',
  ].join('\n')
}

/** What Thomas says when even the constrained retry could not be grounded. */
export const HONEST_EMPTY =
  "I had a number in that answer I cannot trace back to the feed, so I am not going to say it. Let me pull the real one before I give you anything you might act on."
