/**
 * Text normalisation for the guard layer.
 *
 * This file exists because every check downstream of it is a BYTE COMPARISON, and a byte
 * comparison is only as honest as the bytes it is handed. An attacker (or a careless model)
 * does not need to invent a number to get one past a naive firewall. They need only spell it
 * in a script the firewall does not read.
 *
 * The three evasion families this closes, all of which are real and all of which render
 * identically to a human reading a supplier email:
 *
 *   1. NON-ASCII DIGIT SCRIPTS. U+0660 to U+0669 (Arabic-Indic), U+06F0 to U+06F9 (Extended
 *      Arabic-Indic), U+0966 to U+096F (Devanagari), U+FF10 to U+FF19 (fullwidth). "١٨٥٠"
 *      and "１８５０" are both 1850 to a reader and neither matches /[0-9]/.
 *   2. INVISIBLE CHARACTERS. Zero-width space, zero-width non-joiner, zero-width joiner, the
 *      word joiner, the BOM, and the bidi overrides. "18​50" reads as 1850 and greps as
 *      two separate numbers, which is how a blocked value walks through a split check.
 *   3. COMPATIBILITY FORMS. Superscripts, subscripts, enclosed alphanumerics, and the ligature
 *      forms NFKC folds. These are the long tail and NFKC handles them as a class rather than
 *      one at a time.
 *
 * NFKC is deliberate and it is not NFC. NFC preserves fullwidth digits as distinct code
 * points; NFKC folds them to ASCII, which is the whole point here. The cost of NFKC is that it
 * also folds some typographic distinctions we do not care about in a numeral check.
 *
 * What this file does NOT do, stated so nobody assumes otherwise: it does not strip homoglyph
 * LETTERS (Cyrillic а for Latin a). Those matter for identifier matching, and they are handled
 * in the identifier canonicaliser in `numerals.ts`, not here, because folding them globally
 * would corrupt legitimate prose.
 */

/** Invisible and directional characters that can split a numeral without being seen. */
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁪-⁯﻿]/g

/**
 * Digit-script ranges folded to ASCII. NFKC already handles fullwidth and several others, but
 * it does NOT fold Arabic-Indic or Devanagari digits, so those are mapped explicitly.
 *
 * Each entry is [firstCodePointOfZero, scriptName]. Ten consecutive code points per script.
 */
const DIGIT_SCRIPTS: Array<[number, string]> = [
  [0x0660, 'arabic-indic'],
  [0x06f0, 'extended-arabic-indic'],
  [0x0966, 'devanagari'],
  [0x09e6, 'bengali'],
  [0x0a66, 'gurmukhi'],
  [0x0ae6, 'gujarati'],
  [0x0b66, 'oriya'],
  [0x0be6, 'tamil'],
  [0x0c66, 'telugu'],
  [0x0ce6, 'kannada'],
  [0x0d66, 'malayalam'],
  [0x0e50, 'thai'],
  [0x0ed0, 'lao'],
  [0x0f20, 'tibetan'],
  [0x1040, 'myanmar'],
  [0x17e0, 'khmer'],
  [0x1810, 'mongolian'],
]

export type NormalisationReport = {
  /** The text after folding. This is what every downstream check reads. */
  text: string
  /** True when folding actually changed something. Recorded so a guard event can say why. */
  changed: boolean
  /** Named evasion families observed, for the block reason code and the guard feed. */
  observed: string[]
}

/**
 * Fold text into the one representation the guard reads.
 *
 * Returns a report rather than a bare string on purpose. When the firewall blocks a clause, the
 * operator-facing guard feed has to be able to say "this was blocked AND the text arrived with
 * fullwidth digits in it", because the second half is the part that tells them something is
 * wrong upstream rather than merely unapproved.
 */
export function normaliseForGuard(input: string): NormalisationReport {
  const observed: string[] = []
  let text = input

  if (INVISIBLE.test(text)) {
    observed.push('invisible-characters')
    text = text.replace(INVISIBLE, '')
  }
  // Reset lastIndex: the regex is global and `test` advances it, which silently breaks the
  // next call on the same regex object. This is a real and famous footgun, not a hypothetical.
  INVISIBLE.lastIndex = 0

  for (const [zero, script] of DIGIT_SCRIPTS) {
    let hit = false
    let out = ''
    for (const ch of text) {
      const cp = ch.codePointAt(0) as number
      if (cp >= zero && cp <= zero + 9) {
        out += String(cp - zero)
        hit = true
      } else {
        out += ch
      }
    }
    if (hit) {
      observed.push(`digit-script:${script}`)
      text = out
    }
  }

  const folded = text.normalize('NFKC')
  if (folded !== text) {
    observed.push('compatibility-forms')
    text = folded
  }

  return { text, changed: text !== input, observed }
}

/**
 * Canonicalise an IDENTIFIER for exact comparison: NSN, part number, CAGE, PO, solicitation.
 *
 * Identifiers compare exactly, never by value, because 5365-01-180-5372 and 5365-01-180-5327
 * are different parts and are numerically meaningless. What we do fold is the presentational
 * noise a human or a model adds without changing which part is meant:
 *   - case, because CAGE codes are alphanumeric and case carries no meaning
 *   - separators (space, hyphen, en dash, em dash, slash, dot, underscore)
 *   - the Cyrillic and Greek homoglyphs that render as Latin letters used in CAGE codes
 *
 * Homoglyph folding is scoped to identifiers rather than applied globally, because folding
 * Cyrillic to Latin across prose would corrupt legitimate non-English text.
 */
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic that renders as Latin
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x',
  // Greek that renders as Latin
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T',
  Υ: 'Y', Χ: 'X',
  ο: 'o', ν: 'v',
}

export function canonicaliseIdentifier(raw: string): string {
  const folded = normaliseForGuard(raw).text
  let out = ''
  for (const ch of folded) out += HOMOGLYPHS[ch] ?? ch
  return out.toUpperCase().replace(/[\s\-‐-―/._]/g, '')
}

/** True when the raw text contained a character that only exists to defeat a byte check. */
export function carriesEvasionMarkers(raw: string): boolean {
  return normaliseForGuard(raw).observed.length > 0
}
