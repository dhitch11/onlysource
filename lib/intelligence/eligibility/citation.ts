/**
 * A CITATION AS IT TRAVELS ONTO THE PURSUIT PACKAGE, AND THE LABEL IT IS RENDERED WITH.
 *
 * -----------------------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE, TINY, PURE MODULE
 * -----------------------------------------------------------------------------------------
 * The pursuit package is TWO things at once, and they have opposite requirements.
 *
 *   1. It is the grounding object. `app/api/pursuit-package/route.ts` hands the whole package
 *      to the model as the user message, and `lib/ai/grounding.ts` builds the memo's allowed
 *      number set by walking every string and number in it. ANY digit that sits in a value
 *      position inside the package becomes a figure the memo may state as a quantity.
 *   2. It is the object the downloaded and emailed document is rendered FROM. That document
 *      wants the citation spelled out the way a contracting officer reads it.
 *
 * So the citation is split. The package carries a KEY, a verification level and a pin, none of
 * which can be spent as a number or read as a person. The LABEL, which carries the document
 * numbers a reader wants (Table 71, Chapter 4, DoD 4100.39-M), is looked up at render time from
 * the engine's own citation objects and never stored on the package.
 *
 * The module is pure on purpose: `packageMarkdown` is imported by a client component, so a value
 * import that reached `node:fs` would drag the filesystem into the browser bundle. Nothing here
 * imports anything but the engine's transcription, which is itself pure.
 *
 * -----------------------------------------------------------------------------------------
 * THE MEASURED DEFECT THIS CLOSES, TWICE
 * -----------------------------------------------------------------------------------------
 * MEASURED, on the real assembled package for NSN 5325017053574: copying the engine citation's
 * `authority` and `identifier` onto the package took the memo's allowed number set from 32 to 46
 * entries. 'Table 71, Acquisition Method Suffix Code' blessed 71. 'DoD 4100.39-M Volume 10,
 * Chapter 4' blessed 4100.39, 4100, 10 and 4. 'research digest ... section 7' blessed 7. The
 * fabricated sentence "There are 71 approved sources on this part." was stripped by the guard
 * before the eligibility field existed and survived it afterwards, on a row whose real approved
 * source count is 1. The memo prints "No number appears that this build did not measure"
 * directly above that sentence, so the artifact was carrying a promise its enforcement had
 * stopped keeping.
 *
 * MEASURED, on the same package: copying the citation's `quote` put the internal research
 * digest's warning on the package verbatim, and that warning names a real prospective customer.
 * Copying the citation's `source` put five absolute paths from one developer's laptop on it.
 * Both reached the memo prompt, whose system message tells the model its only source of fact is
 * the package and forbids naming a person "that is not in the package". A person who IS in the
 * package is therefore licensed. Neither was ever rendered anywhere, so neither was buying us
 * anything.
 *
 * `quote` is therefore not copied AT ALL, rather than allow-listed. The three places primary
 * text is actually wanted already carry it as their own value: the Table 71 explanation rides on
 * `AcquisitionCode.meaning`, the dealer note rides as a `Verified<string>`, and the surplus
 * warning is restated in the operator's vocabulary by `SURPLUS_SUPPLY_SENTENCE`. An allowlist
 * would also have to be maintained the day somebody adds a citation, and a list that must be
 * maintained to stay safe fails open the first time it is not.
 */
import {
  AMC_DEALER_NOTE,
  AMC_TABLE_CITATION,
  AMSC_NOT_A_CLOSED_DOOR,
  AMSC_POSTURE_CITATION,
  AMSC_TABLE_CITATION,
  GATE_CITATIONS,
  type Citation,
  type Verification,
} from '../../engine/eligibility'

/**
 * A citation as the package carries it. Three fields, and every one of them is chosen because it
 * cannot be misread as a quantity, a person, or a machine on somebody's desk.
 */
export type EligibilityCitation = {
  /**
   * The engine's stable citation key, in the identifier form (see `identifierSafe`). It is the
   * join key `citationLabel` renders from, so two surfaces citing one rule cite it identically.
   */
  readonly id: string
  readonly verification: Verification
  /** `file.md:Lline`, or `file.md:Lfirst-Llast`. Basename only, never a path off one laptop. */
  readonly pin: string
}

/**
 * Write every digit run in a machine identifier so that it abuts a letter.
 *
 * THIS IS THE GENERALISATION OF THE PIN REWRITE, AND THE MECHANISM IS EXACTLY THE SAME.
 * `lib/ai/grounding.ts` reads a digit run that abuts a letter as an identifier fragment: it is
 * neither harvested into the allowed set nor treated as a value claim in the brief. Both sides
 * use that one rule, so a string written this way is simply invisible to the number guard while
 * naming the same thing to a person. `...md:565` becomes `...md:L565` and `sed -n '565p'` still
 * verifies the quote in one command; `amsc_table_71` becomes `amsc_table_L71` and is still one
 * key, matched by one lookup.
 *
 * It is applied to KEYS AND PINS ONLY. It must never be applied to prose or to a measured figure:
 * a quantity a person reads has to stay a quantity.
 */
export function identifierSafe(text: string): string {
  return text.replace(/(^|[^A-Za-z0-9])(\d)/g, (_all, boundary: string, digit: string) => `${boundary}L${digit}`)
}

/**
 * The engine citation, reduced to what may safely ride on the grounding object.
 *
 * `authority`, `identifier` and `quote` are dropped rather than rewritten: they are prose, and
 * prose cannot be made tokenizer-safe without lying about what it says. The pin keeps the file
 * name and the line, which is the whole re-verification affordance, and drops the directory,
 * which is a fact about one developer's machine and about nobody receiving this memo.
 */
export function packageCitation(c: Citation): EligibilityCitation {
  return {
    id: identifierSafe(c.id),
    verification: c.verification,
    pin: identifierSafe(basename(c.source)),
  }
}

function basename(source: string): string {
  const cut = source.lastIndexOf('/')
  return cut === -1 ? source : source.slice(cut + 1)
}

/**
 * Every citation the engine can emit, indexed by the key the package carries.
 *
 * DISCOVERED, never hand-listed: `GATE_CITATIONS` is spread, so a citation added to the engine
 * is labelled here the day it is added. A hardcoded list would be a defect with a delay on it,
 * and the delay would end with a memo rendering a blank where a source belongs.
 */
const BY_KEY: ReadonlyMap<string, Citation> = new Map(
  [
    AMSC_TABLE_CITATION,
    AMSC_POSTURE_CITATION,
    AMSC_NOT_A_CLOSED_DOOR,
    AMC_TABLE_CITATION,
    AMC_DEALER_NOTE,
    ...Object.values(GATE_CITATIONS),
  ].map((c) => [identifierSafe(c.id), c]),
)

/**
 * The human label for a citation the package carries: the issuing body, and the pin a person
 * would look up, exactly as the engine records them.
 *
 * Rendered into the downloaded document, never stored on the package. An unknown key returns a
 * sentence saying so rather than a blank, because a blank in a provenance slot reads as "no
 * source" and this product's whole claim is that every line has one.
 */
export function citationLabel(id: string): string {
  const c = BY_KEY.get(id)
  if (!c) return 'source not on record in this build'
  return c.identifier ? `${c.authority}, ${c.identifier}` : c.authority
}

/** The keys `citationLabel` can answer for. Exported so a test can assert the map is complete. */
export function knownCitationKeys(): readonly string[] {
  return [...BY_KEY.keys()]
}
