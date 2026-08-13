/**
 * THE PROVENANCE FIREWALL. Acceptance gate R3.8, disqualifying.
 *
 * Any numeral in generated prose that does not resolve to a field in the structured payload is a
 * BUILD FAILURE. Not a style issue, not a prompt-tuning task. The language layer is allowed to
 * choose words; it is never allowed to choose a number. A fabricated figure on a federal quote
 * destroys the customer's standing with their buyer, and no amount of iteration recovers it,
 * which is why this is a code gate and not a review checklist.
 *
 * WHAT IT DOES ON FAILURE, AND WHY THE SHAPE MATTERS: it returns the structured facts and it
 * returns `prose: null`. It never returns a partially cleaned sentence, never redacts the bad
 * numeral and ships the rest, and never downgrades to a warning. A sentence containing one
 * numeral the engine cannot vouch for is a sentence the engine did not write, so the caller
 * renders the facts alone. That is a shippable answer. A polished sentence with an invented
 * figure in it is not.
 *
 * WHY THE RESULT IS DECOMPOSED INTO NAMED CATEGORIES RATHER THAN ONE COUNT: a check that
 * over-reports destroys trust in its real findings. "14 numeral violations" on a sentence whose
 * only defect is one price, because the stock number was counted as four numbers and three
 * spelled words were never resolved, teaches the operator to ignore the gate. So the result
 * separates what CLEARED and how it cleared (grounded, spelled, identifier) from what BLOCKS
 * (ungrounded, template_dangling), and `blocking` is exactly the set that fails the render.
 */

import {
  candidateResolves,
  collectGrounding,
  extractTokens,
  normaliseForFirewall,
  type ExtractedToken,
  type GroundedFact,
  type PayloadGrounding,
  type TokenForm,
} from './numerals'

export {
  canonicaliseIdentifier,
  candidateResolves,
  collectGrounding,
  extractTokens,
  normaliseForFirewall,
  parseSpelledWords,
} from './numerals'
export type {
  ExtractedToken,
  GroundedFact,
  NumericCandidate,
  PayloadGrounding,
  TokenForm,
} from './numerals'

/** The release-gate identifier this module enforces, carried so a log line can name it. */
export const FIREWALL_GATE = 'R3.8'

/**
 * The five buckets. Three of them cleared, two of them block, and the split is the point.
 *
 * grounded          a digit-form numeral whose value is a member of the payload
 * spelled           a spelled cardinal whose value is a member of the payload after
 *                   word-to-value normalisation, reported separately so that normalisation is
 *                   visible rather than merely trusted
 * identifier        a stock number, solicitation number, date or part code whose canonical form
 *                   matches a payload string exactly, so its digits are one fact and not four
 * ungrounded        BLOCKING. A numeral or identifier with no member in the payload. An
 *                   identifier that does not match lands here and not in `identifier`, because
 *                   an invented stock number is a fabrication and must not hide behind a class
 * template_dangling BLOCKING. An unsubstituted slot such as {{f7}}, which is proof that the
 *                   render lost a field rather than that a writer was careless
 */
export type FirewallCategory =
  | 'grounded'
  | 'spelled'
  | 'identifier'
  | 'ungrounded'
  | 'template_dangling'

export const FIREWALL_CATEGORIES: readonly FirewallCategory[] = [
  'grounded',
  'spelled',
  'identifier',
  'ungrounded',
  'template_dangling',
]

export type FirewallFinding = {
  /** Exactly as printed in the normalised sentence. */
  raw: string
  /** Offsets into `text`, so an operator surface can point at the character. */
  start: number
  end: number
  category: FirewallCategory
  form: TokenForm
  /** The reading that cleared it, or the printed reading that failed. Null for identifiers. */
  value: number | null
  /** The canonical form compared against the payload. Set for identifiers only. */
  canonical: string | null
  /** Operator facing, one line, no jargon the principal has not already heard. */
  reason: string
}

export type FirewallResult = {
  /** True only when nothing blocks. There is no partial pass. */
  ok: boolean
  gate: typeof FIREWALL_GATE
  /** The normalised sentence that was actually inspected, which is what offsets index. */
  text: string
  /** The prose, and ONLY when ok. Null on failure, always, with no redacted variant offered. */
  prose: string | null
  findings: FirewallFinding[]
  /** Exactly the findings that fail the render. Empty when ok. */
  blocking: FirewallFinding[]
  counts: Record<FirewallCategory, number>
  /** The structured payload flattened to path and value. This is the fallback render. */
  facts: GroundedFact[]
}

function emptyCounts(): Record<FirewallCategory, number> {
  return { grounded: 0, spelled: 0, identifier: 0, ungrounded: 0, template_dangling: 0 }
}

function judge(token: ExtractedToken, grounding: PayloadGrounding): FirewallFinding {
  if (token.form === 'template') {
    return {
      raw: token.raw,
      start: token.start,
      end: token.end,
      category: 'template_dangling',
      form: token.form,
      value: null,
      canonical: null,
      reason: `Unsubstituted template slot ${token.raw}. The render lost a field.`,
    }
  }

  if (token.form === 'identifier') {
    const canonical = token.canonical ?? ''
    if (grounding.identifiers.has(canonical)) {
      return {
        raw: token.raw,
        start: token.start,
        end: token.end,
        category: 'identifier',
        form: token.form,
        value: null,
        canonical,
        reason: `Identifier ${token.raw} matches a payload field exactly (${token.shape}).`,
      }
    }
    return {
      raw: token.raw,
      start: token.start,
      end: token.end,
      category: 'ungrounded',
      form: token.form,
      value: null,
      canonical,
      reason: `Identifier ${token.raw} is in no payload field. An invented identifier is a fabrication.`,
    }
  }

  const resolved = token.candidates.find((c) => candidateResolves(c, grounding.numbers))
  const printed = token.candidates[0]
  const printedValue = printed === undefined ? null : printed.value

  if (resolved !== undefined) {
    return {
      raw: token.raw,
      start: token.start,
      end: token.end,
      category: token.form === 'spelled' ? 'spelled' : 'grounded',
      form: token.form,
      value: resolved.value,
      canonical: null,
      reason:
        token.form === 'spelled'
          ? `Spelled number ${token.raw} reads as ${resolved.value}, which is in the payload.`
          : `${token.raw} resolves to a payload field (${resolved.label}).`,
    }
  }

  return {
    raw: token.raw,
    start: token.start,
    end: token.end,
    category: 'ungrounded',
    form: token.form,
    value: printedValue,
    canonical: null,
    reason: `${token.raw} is in no payload field. The engine did not compute this number.`,
  }
}

/**
 * Assert that every numeral in one generated sentence came from the structured payload.
 *
 * Exists as the single choke point between the language layer and anything a supplier can read.
 * It is deliberately pure and deliberately synchronous: a gate that needs a network call, a
 * clock or a database is a gate that will one day be skipped for being slow, and this one is
 * disqualifying, so it must be cheap enough that nobody ever wants to skip it.
 */
export function assertNumeralsGrounded(sentence: string, payload: unknown): FirewallResult {
  const text = normaliseForFirewall(sentence)
  const grounding = collectGrounding(payload)
  const findings = extractTokens(text).map((token) => judge(token, grounding))

  const counts = emptyCounts()
  for (const finding of findings) counts[finding.category] += 1

  const blocking = findings.filter(
    (f) => f.category === 'ungrounded' || f.category === 'template_dangling',
  )
  const ok = blocking.length === 0

  return {
    ok,
    gate: FIREWALL_GATE,
    text,
    prose: ok ? text : null,
    findings,
    blocking,
    counts,
    facts: grounding.facts,
  }
}

/**
 * The two known-bad fixtures, shipped with the module rather than only with its test.
 *
 * Exists so the firewall can prove it fires from anywhere it is installed: a release check, a
 * smoke test after a prompt change, or an operator asking whether the gate is on. A gate whose
 * only evidence of working lives in a test file is a gate nobody can verify in production.
 *
 * Every number in the payload below is from the worked example in the T3 handoff
 * (HANDOFFS/T3-ENGINE.md lines 452 to 465): NSN 1650-01-059-8221, the 2017 OEM buy of 17 units
 * at $1,537.85, a CPI factor of 1.3223 and a DoD-procurement factor of 1.40. The fabricated
 * figure $2,500 appears in no field of it.
 */
export const FIREWALL_FIXTURE_PAYLOAD = {
  nsn: '1650-01-059-8221',
  buyingOffice: 'SPE4A5',
  lastOemAward: { year: 2017, quantity: 17, unitPrice: 1537.85 },
  anchors: {
    cpiFactor: 1.3223,
    cpiUnitPrice: 2033.499055,
    dodFactor: 1.4,
    dodUnitPrice: 2152.99,
    preferred: 'dod',
  },
  quote: { unitPrice: 3565 },
} as const

export type KnownBadFixture = {
  name: string
  sentence: string
  payload: unknown
  /** The category the blocking finding must land in. Asserted, never assumed. */
  expectCategory: FirewallCategory
  /** The exact text of the blocking finding, so a silent reclassification cannot pass. */
  expectRaw: string
}

export const KNOWN_BAD_FIXTURES: readonly KnownBadFixture[] = [
  {
    name: 'out_of_payload_numeral',
    sentence: 'NSN 1650-01-059-8221 anchors at $2,500 per unit.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    expectCategory: 'ungrounded',
    expectRaw: '$2,500',
  },
  {
    name: 'dangling_template_reference',
    sentence: 'The DoD anchor is {{f7}} per unit on NSN 1650-01-059-8221.',
    payload: FIREWALL_FIXTURE_PAYLOAD,
    expectCategory: 'template_dangling',
    expectRaw: '{{f7}}',
  },
]

/**
 * Run both known-bad fixtures and report whether the firewall still blocks them.
 *
 * Exists to make the gate self-proving at call sites that are not tests. It returns a result
 * rather than throwing, because the caller (a release check, a health endpoint) decides what a
 * broken firewall means to it.
 */
export function firewallSelfTest(): { passed: boolean; failures: string[] } {
  const failures: string[] = []
  for (const fixture of KNOWN_BAD_FIXTURES) {
    const result = assertNumeralsGrounded(fixture.sentence, fixture.payload)
    if (result.ok) {
      failures.push(`${fixture.name}: the firewall passed a sentence it must block`)
      continue
    }
    if (result.prose !== null) {
      failures.push(`${fixture.name}: prose was returned on a blocked render`)
    }
    const hit = result.blocking.find((f) => f.raw === fixture.expectRaw)
    if (hit === undefined) {
      failures.push(`${fixture.name}: expected ${fixture.expectRaw} in the blocking set`)
      continue
    }
    if (hit.category !== fixture.expectCategory) {
      failures.push(
        `${fixture.name}: ${fixture.expectRaw} landed in ${hit.category}, expected ${fixture.expectCategory}`,
      )
    }
  }
  return { passed: failures.length === 0, failures }
}
