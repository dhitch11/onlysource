/**
 * THE GUARD-AGNOSTIC KNOWN-BAD CORPUS. The positive control this estate kept not having.
 *
 * WHY THIS FILE EXISTS, stated as the defect it closes rather than as a feature.
 *
 * A numeral guard reports what it stripped. When it strips nothing it reports nothing, and
 * "nothing stripped" is exactly what a guard that has stopped working also reports. The two
 * states are indistinguishable from the output, on every call, forever. `lib/ai/grounding.ts`
 * is in that position today: six live AI routes call it, it carries a real fixed defect (the
 * end item `MIDS JTRS AN/USQ190` once blessed the bare number 190 and a live brief served
 * "escalation above 190 percent" through it), and there is no call anywhere that can show it
 * WOULD have stripped something. That is a negative control with no positive one beside it.
 *
 * So the corpus below is deliberately NOT tied to one guard. `KNOWN_BAD_FIXTURES` in
 * ./index.ts is shaped for this module's own firewall, carrying `expectCategory` and
 * `expectRaw` that only this firewall produces. The fixtures here carry no implementation
 * detail at all: a sentence, the payload it is checked against, and the single reason it is
 * bad. Any guard with any API can be driven through `runKnownBadCorpus` by wrapping it in one
 * line, which is the whole point. A guard that cannot be pointed at this corpus is a guard
 * nobody can prove.
 *
 * WHAT MAKES A FIXTURE ELIGIBLE, and the rule is strict because a corpus that over-claims is
 * worse than none: every MUST_BLOCK sentence states a figure that appears in NO field of its
 * payload, in any normal form. Not a rounding of one, not a derivation from two. If a guard
 * passes one of these it has served an operator a number this build never measured, and on a
 * federal quote that is the defect that ends the customer's standing with their buyer.
 *
 * THE SECOND TIER IS NOT A DEFECT LIST. `STRICTER_BY_DESIGN` holds sentences this module's
 * firewall blocks where a reasonable guard may legitimately disagree: an ordinal in ordinary
 * prose ("the 3rd award"), a lettered designator ("Q47"). They are reported so the difference
 * between two guards is visible and argued about on purpose, never asserted as a failure. A
 * check that over-reports destroys trust in its real findings, which is the same reason the
 * firewall decomposes its result into named categories instead of one count.
 */

import { FIREWALL_FIXTURE_PAYLOAD } from './index'

/**
 * A guard reduced to the only question a corpus can ask of it: did this sentence get through?
 *
 * Deliberately boolean and deliberately synchronous. Guards in this repo disagree about
 * everything else -- one returns cleaned text plus a stripped list, another returns findings in
 * five named categories and withholds the prose entirely -- and forcing them into a shared
 * result shape would mean changing a live guard to suit its test, which is backwards.
 */
export type GuardUnderTest = (sentence: string, payload: unknown) => boolean

export type KnownBadCase = {
  /** The defect class, not the sentence. Two fixtures may share a class only if they differ in form. */
  readonly klass: string
  readonly sentence: string
  readonly payload: unknown
  /** The figure that is not in the payload, exactly as printed. Null for a template slot. */
  readonly fabricated: string | null
  /** One line, operator-facing: why this sentence must never reach a supplier. */
  readonly why: string
}

/**
 * Every figure below is absent from `FIREWALL_FIXTURE_PAYLOAD`, which carries only the worked
 * example from the T3 handoff: NSN 1650-01-059-8221, a 2017 OEM buy of 17 units at $1,537.85,
 * a CPI factor of 1.3223 giving $2,033.499055, a DoD factor of 1.40 giving $2,152.99, and a
 * quote of $3,565. Nothing else. Checked fixture by fixture, not assumed.
 */
export const MUST_BLOCK: readonly KnownBadCase[] = [
  {
    klass: 'bare_ungrounded_price',
    sentence: 'The unit price is $2,500 per each.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: '$2,500',
    why: 'A price no column produced. This is the plain case every guard must catch.',
  },
  {
    klass: 'unit_of_issue_suffix',
    sentence: 'The buy was 1200EA at the anchor price.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: '1200',
    why: 'DIBBS writes quantities as 1200EA, 12PR, 6BX. A guard that treats a digit run touching a letter as an identifier fragment is blind to the most common numeric form in this domain.',
  },
  {
    klass: 'unit_of_issue_suffix_lowercase',
    sentence: 'The buy was 1200ea at the anchor price.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: '1200',
    why: 'The same form a model lowercases. Case must not decide whether a figure is checked.',
  },
  {
    klass: 'multiplier_suffix',
    sentence: 'The price rose 12x since the last award.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: '12',
    why: 'A multiplicative claim is a computed figure. The engine computes escalation; prose quoting its own multiple is inventing one.',
  },
  {
    klass: 'currency_suffix',
    sentence: 'The anchor is 2500USD per unit.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: '2500',
    why: 'A price wearing a currency code. Same fabrication as the bare price, one letter away from invisible.',
  },
  {
    klass: 'percent_word_form',
    sentence: 'Escalation ran 47 percent above the anchor.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: '47',
    why: 'The exact shape of the live MIDS JTRS defect: a percentage no file measured, stated as fact.',
  },
  {
    klass: 'spelled_magnitude',
    sentence: 'The lot covered three hundred units.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: 'three hundred',
    why: 'A figure written in words is still a figure. No digit scan sees it.',
  },
  {
    klass: 'bare_integer',
    sentence: 'There were 43 bidders on the last solicitation.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: '43',
    why: 'A count presented as observed. Competitor counts drive bid decisions.',
  },
  {
    klass: 'bare_decimal',
    sentence: 'The CPI factor applied was 1.9912 for this year.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: '1.9912',
    why: 'An index factor close enough to the real 1.3223 to read as a typo and wrong enough to reprice the quote.',
  },
  {
    klass: 'range_with_dash',
    sentence: 'Awards ran 300-900 units per year.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: '300-900',
    why: 'A range is two figures. Neither endpoint exists.',
  },
  {
    klass: 'dangling_template_slot',
    sentence: 'The DoD anchor is {{f7}} per unit.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: null,
    why: 'Not a model defect: proof the render lost a field. lib/compliance/deliverables/assembler.ts emits exactly this form and hard-throws on it, so the shape is live in this repo, not hypothetical.',
  },
]

/**
 * Blocked by this module's firewall, arguably fine elsewhere. Reported, never asserted.
 *
 * These are the cases where two honest guards can disagree. Keeping them out of MUST_BLOCK is
 * what makes MUST_BLOCK worth failing a build over.
 */
export const STRICTER_BY_DESIGN: readonly KnownBadCase[] = [
  {
    klass: 'ordinal_in_prose',
    sentence: 'This is the 3rd award in the series.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: '3',
    why: 'An ordinal is a position, not a measurement. Blocking it is defensible; so is allowing it.',
  },
  {
    klass: 'lettered_designator',
    sentence: 'Quantity Q47 shipped against the order.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    fabricated: 'Q47',
    why: 'This firewall treats an unmatched identifier as a fabrication on purpose, because an invented stock number must not hide behind a class. A guard scoped to value claims may reasonably ignore it.',
  },
]

export type CorpusResult = {
  readonly klass: string
  readonly blocked: boolean
  readonly sentence: string
  readonly why: string
}

/**
 * Drive any guard through any case list.
 *
 * Returns results rather than throwing so the caller decides what a hole means to it: a test
 * fails the build, a health endpoint reports degraded, a release check writes a line. The
 * firewall's own `firewallSelfTest()` makes the same choice for the same reason.
 */
export function runKnownBadCorpus(
  guard: GuardUnderTest,
  cases: readonly KnownBadCase[] = MUST_BLOCK,
): CorpusResult[] {
  return cases.map((c) => ({
    klass: c.klass,
    blocked: guard(c.sentence, c.payload),
    sentence: c.sentence,
    why: c.why,
  }))
}

/**
 * The sentence every guard must PASS, so a guard that blocks everything cannot score a clean run.
 *
 * A corpus of only bad inputs is satisfied by `() => true`. Without this control the positive
 * control is not one: it cannot tell a working guard from a guard that has been replaced by a
 * function that rejects all prose.
 */
export const GROUNDED_CONTROL: { sentence: string; payload: unknown } = {
  sentence: 'The 2017 award was 17 units at $1,537.85 each.',
  payload: FIREWALL_FIXTURE_PAYLOAD,
}
