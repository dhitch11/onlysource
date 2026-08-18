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
  | { ok: false; offenders: string[]; kind: GuardFailure }

/**
 * WHY THERE ARE THREE FAILURES AND NOT ONE.
 *
 *   ungrounded  the figure exists nowhere Thomas was given. He made it up.
 *   unmeasured  the figure is real, and it answers a DIFFERENT DAY than the one he was asked about.
 *   withheld    a tool refused this turn because the CALLER may not read what it returns, so any
 *               figure that is not from a tool that actually ran, or from the operator's own words,
 *               is Thomas filling a permission boundary from memory.
 *
 * They are not interchangeable, because each one gets a different sentence and a different retry.
 * Telling somebody a number could not be traced to the feed, when the truth is that their role does
 * not include it, is a false statement about our own data.
 */
export type GuardFailure = 'ungrounded' | 'unmeasured' | 'withheld'

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
  opts?: {
    measured?: AllowSet
    question?: string
    /**
     * Numbers the OPERATOR themselves put on the table this conversation. Saying one back is
     * quoting them, never a disclosure, so the strict checks accept it. Without this a caller who
     * asks "we quoted eighteen hundred, is that in line" gets their own figure refused on the same
     * turn a tool refused, which reads as the product breaking rather than as a boundary.
     */
    spoken?: AllowSet
    /**
     * The sensitive classes a tool refused to read for THIS caller on THIS turn, said out loud.
     * Non-empty means the fact set shrank, and the firewall has to see the smaller one: otherwise
     * a permission refusal quietly hands the answer back from the background notes, which is the
     * whole control being undone by the model's helpfulness.
     */
    withheld?: readonly string[]
  },
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

  const withheld = opts?.withheld ?? []
  const isStateQuestion = STATE_QUESTION.test(asked)
  /*
   * A REFUSAL IS AS STRICT AS A STATE QUESTION, AND FOR THE SAME REASON. In both cases the only
   * legitimate source for a figure is a tool that ran in this conversation. The state question
   * excludes yesterday's numbers; the refusal excludes numbers this caller is not allowed to hear.
   */
  if (!isStateQuestion && !withheld.length) return { ok: true }

  /*
   * A state question was asked and NO tool ran. Any claim-shaped figure or any date in the reply
   * is therefore being recalled rather than read, which is the exact failure above. If a tool DID
   * run, its numbers are in `measured` and the normal check governs.
   *
   * THE OPERATOR'S OWN FIGURES COUNT ON A REFUSAL TURN, AND NEVER ON A STATE QUESTION.
   *
   * Quoting somebody their own number back is not a disclosure, so on a turn that is strict only
   * because a tool refused, their figures are speakable. A STATE question is different in kind:
   * "is the count still 2,141" carries a number the operator supplied, and answering "yes, 2,141"
   * with no tool in the trace is the recalled-rather-than-read failure this whole block exists to
   * catch, arriving with the operator's own digits as cover. Their figure describes whatever day
   * they last looked, which is exactly the thing a state question must not be answered from.
   */
  const speakable: AllowSet = new Set(measured)
  if (!isStateQuestion) for (const n of opts?.spoken ?? []) speakable.add(n)
  const unmeasured = claimNumbers(text)
    .filter((c) => !isGrounded(c.value, speakable))
    .map((c) => c.raw.trim())
  const dateClaim = DATE_SHAPE.test(text) && measured.size === 0
  if (!unmeasured.length && !dateClaim) return { ok: true }

  const offenders = Array.from(new Set(unmeasured))
  if (dateClaim) offenders.push('a date the feed did not report')
  return { ok: false, offenders, kind: withheld.length ? 'withheld' : 'unmeasured' }
}

/** The constraint appended for the single regeneration attempt. */
export function constraintFor(
  offenders: string[],
  kind: GuardFailure = 'ungrounded',
  withheld: readonly string[] = [],
): string {
  if (kind === 'withheld') {
    return [
      '',
      '## THAT WAS WITHHELD FROM THIS OPERATOR (you just broke this)',
      `A tool refused this turn because their role does not include ${listOf(withheld)}, and you then said ` +
        `${offenders.map((o) => JSON.stringify(o)).join(', ')}.`,
      'Those figures did not come from a tool that ran in this conversation, so you filled a permission',
      'boundary from your background notes. That is the refusal being undone by you, and it is worse than',
      'saying nothing, because it arrives sounding measured.',
      'Answer again. Tell them in one plain sentence which part their role does not include and that an owner',
      'can grant it. Use ONLY figures a tool returned to you in this conversation, or figures the operator',
      'themselves said. Do not substitute a nearby number, and do not quietly drop the subject.',
    ].join('\n')
  }
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

/** "a", "a and b", "a, b and c". Keeps a generated constraint reading like a sentence. */
function listOf(parts: readonly string[]): string {
  if (!parts.length) return 'that'
  if (parts.length === 1) return parts[0]!
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * What Thomas says when a permission refusal could not be turned into an honest answer.
 *
 * It never claims the data is missing, because the data is not missing. It names the boundary, says
 * who can change it, and refuses to fill the hole with a figure from memory. An operator who reads
 * this knows exactly what happened and exactly what to do about it, which is the difference between
 * a control and a dead end.
 */
export function withheldEmpty(classes: readonly string[]): string {
  return (
    `Your role does not include ${listOf(classes)}, so I cannot give you that here, and I am not going to ` +
    'put a number on it from memory. An owner can change your role if you need it. Ask me anything that ' +
    'sits outside that and I will pull it properly.'
  )
}

/** What Thomas says when even the constrained retry could not be grounded. */
export const HONEST_EMPTY =
  "I had a number in that answer I cannot trace back to the feed, so I am not going to say it. Let me pull the real one before I give you anything you might act on."
