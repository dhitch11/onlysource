/**
 * THE NUMERAL FIREWALL. The model never originates a number that reaches a counterparty.
 *
 * The rule, stated once so it is not softened by paraphrase later: deterministic code owns
 * every number. The engine hands over DISPLAY STRINGS for the values that may appear. The
 * model writes prose around them. Any clause carrying a numeral the engine did not hand over
 * is BLOCKED with a reason code, and the send fails rather than degrades.
 *
 * Why the send fails rather than strips the offending numeral: a message with a number quietly
 * removed is a message whose meaning changed without anyone deciding to change it. "We can
 * supply 190 each" becoming "We can supply each" is worse than not sending. Blocking is loud,
 * recoverable, and lands in front of a human. Editing is silent.
 *
 * This is a BYTE-IDENTICAL CHECK ON TEXT, and that property is load-bearing beyond email: it
 * is the reason no speech-native audio-to-audio model may sit on any call path until one
 * exposes an interposable text seam (never list 14). There is nothing to interpose on in an
 * audio-token stream.
 *
 * ---------------------------------------------------------------------------------------
 * TWO COMPARISON RULES, AND THE DIFFERENCE BETWEEN THEM IS NOT COSMETIC
 * ---------------------------------------------------------------------------------------
 * VALUE classes (MONEY, QUANTITY, DATE_OR_DEADLINE) compare by NUMERIC VALUE, because "$1,850",
 * "1850" and "1,850.00" are the same money and a supplier reads them identically.
 *
 * IDENTIFIER classes (NSN_OR_PART, CAGE, PO_OR_SOLICITATION) compare EXACTLY after folding
 * case, separators and homoglyphs, because 5365-01-180-5372 and 5365-01-180-5327 are different
 * parts. Numeric equality is meaningless on an identifier, and a transposition is exactly the
 * failure this whole layer exists to stop: a wrong part number in a supplier email is a wrong
 * part on a federal quote three steps later.
 */

import { extractNumerals, type NumeralToken, type ProtectedClass } from './numerals'
import { canonicaliseIdentifier, normaliseForGuard } from './normalize'

export type BlockReason =
  /** A numeral appeared that the engine never handed over. The ordinary case. */
  | 'UNAPPROVED_NUMERAL'
  /** An identifier-shaped run that does not exactly match any approved identifier. */
  | 'IDENTIFIER_MISMATCH'
  /** The extractor could not settle on one reading. Unverifiable, therefore blocked. */
  | 'UNREADABLE_NUMERAL'
  /** The text arrived carrying characters whose only purpose is defeating a byte check. */
  | 'EVASION_MARKERS'

export type Violation = {
  reason: BlockReason
  klass: ProtectedClass
  /** The offending text, exactly as it appeared. */
  raw: string
  start: number
  end: number
  /** One sentence an operator can read without knowing what a canonicaliser is. */
  explanation: string
}

export type ApprovedSlots = Record<string, string | number | null | undefined>

export type FirewallOptions = {
  /**
   * Numerals permitted even though no slot carries them. Versioned, explicit, EMPTY BY
   * DEFAULT, and every entry is a security decision that shows up in review.
   *
   * This exists because prose legitimately contains numbers that are not claims about a deal
   * ("one of our suppliers"). It is an allow-list rather than a heuristic for the same reason
   * the log redactor is: a heuristic that decides which numbers "look important" fails on the
   * first one it has not seen.
   */
  neutralAllowlist?: number[]
}

export type FirewallResult = {
  ok: boolean
  violations: Violation[]
  /** Every numeral found, approved or not, so the guard feed can show the approvals too. */
  found: NumeralToken[]
  /** Evasion families observed during normalisation, for the guard event. */
  evasion: string[]
}

/**
 * Build the approved sets from the engine's display strings.
 *
 * The slot VALUES are run through the same extractor as the generated text, which is what
 * makes "$1,850.00" in a slot approve "1850" in prose. Running both sides through one
 * instrument is the only way the two can be compared honestly.
 */
function approvedFrom(slots: ApprovedSlots): { values: Set<number>; identifiers: Set<string> } {
  const values = new Set<number>()
  const identifiers = new Set<string>()

  for (const raw of Object.values(slots)) {
    if (raw === null || raw === undefined) continue
    const asText = String(raw)
    if (asText.trim() === '') continue

    // The whole slot is itself a legitimate identifier form, even if the extractor would split
    // it. A slot holding "0KTM3" has no digits at all and must still approve that CAGE.
    identifiers.add(canonicaliseIdentifier(asText))

    for (const t of extractNumerals(asText)) {
      if (t.value !== null && Number.isFinite(t.value)) values.add(t.value)
      if (t.identifier) identifiers.add(t.identifier)
    }
    const numeric = Number(asText.replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(numeric) && asText.replace(/[^0-9]/g, '') !== '') values.add(numeric)
  }

  return { values, identifiers }
}

const IDENTIFIER_CLASSES: ReadonlySet<ProtectedClass> = new Set<ProtectedClass>([
  'NSN_OR_PART', 'CAGE', 'PO_OR_SOLICITATION',
])

const HUMAN_CLASS: Record<ProtectedClass, string> = {
  MONEY: 'a price',
  QUANTITY: 'a quantity',
  NSN_OR_PART: 'a stock or part number',
  CAGE: 'a CAGE code',
  DATE_OR_DEADLINE: 'a date or deadline',
  PO_OR_SOLICITATION: 'a purchase order or solicitation number',
}

/**
 * Run the firewall over one piece of model-generated text.
 *
 * `slots` is what the engine handed over. Everything else is suspect.
 */
export function checkNumerals(
  generated: string,
  slots: ApprovedSlots,
  options: FirewallOptions = {},
): FirewallResult {
  const norm = normaliseForGuard(generated)
  const approved = approvedFrom(slots)
  const neutral = new Set(options.neutralAllowlist ?? [])
  const found = extractNumerals(generated)
  const violations: Violation[] = []

  for (const t of found) {
    if (t.ambiguous) {
      violations.push({
        reason: 'UNREADABLE_NUMERAL', klass: t.klass, raw: t.raw, start: t.start, end: t.end,
        explanation: `"${t.raw}" could not be read as a single definite number, so it cannot be checked against the approved values. Blocked rather than guessed.`,
      })
      continue
    }

    if (IDENTIFIER_CLASSES.has(t.klass)) {
      const id = t.identifier ?? canonicaliseIdentifier(t.raw)
      if (!approved.identifiers.has(id)) {
        violations.push({
          reason: 'IDENTIFIER_MISMATCH', klass: t.klass, raw: t.raw, start: t.start, end: t.end,
          explanation: `"${t.raw}" reads as ${HUMAN_CLASS[t.klass]} that was not supplied by the system. Identifiers must match exactly, because a single transposed digit is a different part.`,
        })
      }
      continue
    }

    const v = t.value
    if (v === null || !Number.isFinite(v)) {
      violations.push({
        reason: 'UNREADABLE_NUMERAL', klass: t.klass, raw: t.raw, start: t.start, end: t.end,
        explanation: `"${t.raw}" did not resolve to a number that could be checked. Blocked rather than guessed.`,
      })
      continue
    }
    if (neutral.has(v)) continue
    if (!approved.values.has(v)) {
      violations.push({
        reason: 'UNAPPROVED_NUMERAL', klass: t.klass, raw: t.raw, start: t.start, end: t.end,
        explanation: `"${t.raw}" reads as ${HUMAN_CLASS[t.klass]} of ${v}, which the system did not supply. Every number that leaves here is a stored value, never a written one.`,
      })
    }
  }

  // Evasion markers are reported even when every numeral happened to be approved, because
  // their presence is a fact about the input worth surfacing on its own.
  if (norm.observed.length > 0 && violations.length === 0) {
    violations.push({
      reason: 'EVASION_MARKERS', klass: 'QUANTITY', raw: '', start: 0, end: 0,
      explanation: `The text arrived containing ${norm.observed.join(', ')}. Those characters change how a number is read by a machine without changing how it looks to a person, so the message is held for review.`,
    })
  }

  return { ok: violations.length === 0, violations, found, evasion: norm.observed }
}

/**
 * The send-time assertion. Throws rather than returns, so a caller cannot forget to check.
 *
 * Used on the outbound path where the only correct behaviour is to fail the send.
 */
export class NumeralFirewallBlocked extends Error {
  readonly violations: Violation[]
  constructor(violations: Violation[]) {
    super(`Numeral firewall blocked the send: ${violations.map((v) => v.reason).join(', ')}`)
    this.name = 'NumeralFirewallBlocked'
    this.violations = violations
  }
}

export function assertOnlyApprovedNumerals(
  generated: string,
  slots: ApprovedSlots,
  options: FirewallOptions = {},
): void {
  const result = checkNumerals(generated, slots, options)
  if (!result.ok) throw new NumeralFirewallBlocked(result.violations)
}

/**
 * THE VOICEMAIL DIGIT VALIDATOR (Acceptance Gate R1.5).
 *
 * A voicemail drop carries ZERO generative content. It is composed entirely by deterministic
 * code from stored fields, so the correct standard is stricter than the email path: there is
 * no legitimate reason for any numeral in the script that is not in the slot set, and there is
 * no neutral allow-list, because no prose was written by a model to need one.
 *
 * Spelled-out digits are covered by construction: the validator runs the same extractor, which
 * reads "eighteen fifty" as 1850. A script that says the price in words rather than digits is
 * caught by exactly the same check, which is the point of R1.5 naming spelled forms explicitly.
 */
export function validateVoicemailScript(script: string, slots: ApprovedSlots): FirewallResult {
  return checkNumerals(script, slots, { neutralAllowlist: [] })
}
