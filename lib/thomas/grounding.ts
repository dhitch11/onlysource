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
  /*
   * The leading minus is only a minus when it does not follow a digit or another hyphen. Without
   * that guard, "2026-08-14" parses as 2026, -8 and -14, so a feed day harvested from a tool never
   * matches the same date spoken back as "August 14", and a correct answer gets blocked. The same
   * bug splits every stock number into negative fragments.
   */
  const re = /(?<![\d-])-?\$?\d[\d,]*(?:\.\d+)?%?/g
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
  | { ok: false; offenders: string[]; kind: 'ungrounded' | 'unmeasured' }

/**
 * ==========================================================================================
 * THE SECOND GUARD: A NUMBER CAN BE REAL AND STILL BE THE WRONG ANSWER.
 * ==========================================================================================
 * The firewall above asks "does this figure exist in what Thomas was given". An adversarial
 * audit showed that question is not sufficient, twice, in the two most expensive ways available:
 *
 *   Asked for the feed date, he answered "August seventeenth, that's the date stamped on this
 *   build". That date was the knowledge-base stamp, so it WAS in the allow-set and passed
 *   cleanly, while being three days newer than the actual feed and carrying invented provenance.
 *
 *   Asked how many corners to print in a press release, he answered "eighteen thousand two
 *   hundred seventy one percent" — the screw's escalation figure, also genuinely in the
 *   allow-set, also completely unrelated to the question.
 *
 * Both were grounded. Neither was an answer. So a question ABOUT THE CURRENT STATE OF THE BOOK
 * is held to a stricter standard: its figures must come from a tool result in THIS conversation,
 * not from the curated background, because background numbers describe a different day.
 */
const STATE_QUESTION = new RegExp(
  [
    'how many',
    'how much',
    'how fresh',
    'how old',
    'how stale',
    'what is the (count|total|number)',
    'feed ?(day|date)',
    'date of the feed',
    'when was .{0,20}(measured|captured|pulled|updated|refreshed)',
    'as of',
    'right now',
    'currently',
    'today',
    'latest',
    'current',
    'exact (date|count|number)',
  ].join('|'),
  'i',
)

/** A spoken or written date. Thomas must never produce one that a tool did not hand him. */
const DATE_SHAPE =
  /\b(\d{4}-\d{2}-\d{2}|(january|february|march|april|may|june|july|august|september|october|november|december)\s+\w+)/i

export function guard(
  text: string,
  allow: AllowSet,
  opts?: { measured?: AllowSet; question?: string },
): GuardVerdict {
  const ungrounded = claimNumbers(text)
    .filter((c) => !isGrounded(c.value, allow))
    .map((c) => c.raw.trim())
  if (ungrounded.length) {
    return { ok: false, offenders: Array.from(new Set(ungrounded)), kind: 'ungrounded' }
  }

  const measured = opts?.measured
  const asked = opts?.question ?? ''
  if (!measured) return { ok: true }

  const isStateQuestion = STATE_QUESTION.test(asked)
  if (!isStateQuestion) return { ok: true }

  /*
   * A state question was asked and NO tool ran. Any claim-shaped figure or any date in the reply
   * is therefore being recalled rather than read, which is the exact failure above. If a tool DID
   * run, its numbers are in `measured` and the normal check governs.
   */
  const unmeasured = claimNumbers(text)
    .filter((c) => !isGrounded(c.value, measured))
    .map((c) => c.raw.trim())
  const dateClaim = DATE_SHAPE.test(text) && measured.size === 0
  if (!unmeasured.length && !dateClaim) return { ok: true }

  const offenders = Array.from(new Set(unmeasured))
  if (dateClaim) offenders.push('a date the feed did not report')
  return { ok: false, offenders, kind: 'unmeasured' }
}

/** The constraint appended for the single regeneration attempt. */
export function constraintFor(offenders: string[], kind: 'ungrounded' | 'unmeasured' = 'ungrounded'): string {
  if (kind === 'unmeasured') {
    return [
      '',
      '## THAT WAS THE WRONG NUMBER FOR THE QUESTION (you just broke this)',
      `You were asked about the CURRENT state of the book and you answered with ${offenders
        .map((o) => JSON.stringify(o))
        .join(', ')}.`,
      'Those figures exist in your background notes, so they are real, but they describe a DIFFERENT DAY and',
      'they are not answers to what was asked. A real number in the wrong slot is still a wrong answer, and on',
      'this platform it is one somebody may bid against.',
      'Answer again. Call the tool, and speak only what it returns. Never state a count or a date you did not',
      'just read from a tool result. If you cannot call one, say plainly that you will pull it.',
    ].join('\n')
  }
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
