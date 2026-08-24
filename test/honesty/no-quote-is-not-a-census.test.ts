/**
 * "NOBODY CAN SOURCE" IS A CLAIM ABOUT THE WORLD, AND NOBODY EVER MEASURED IT.
 *
 * ==========================================================================================
 * WHAT WAS WRONG, AND THE MEASUREMENT THAT SETTLES IT
 * ==========================================================================================
 * The make-side count (`noQuote.summary.makeSideOnly`) is the set of no-quote solicitations
 * that found NO MATCH when joined to the availability workbook. Two surfaces rendered that as
 * "nobody can source", which is a census of every supplier on earth.
 *
 * MEASURED over that set:
 *
 *     rows with NO holder                                        479
 *       solicitation ABSENT from no_quote_matches.xlsx entirely   479   (100%)
 *       solicitation PRESENT but carrying zero holder rows          0   (0%)
 *
 *     availability join coverage, distinct solicitations:  350 of 803 looked up (43.6%)
 *                                                          453 of 803 NEVER looked up (56.4%)
 *
 * NOT ONE of the 479 was checked and found empty. The make-side set is exactly the set nobody
 * queried, so it cannot support a claim about who can supply the part. An absence of a lookup
 * is not an absence of a supplier.
 *
 * ==========================================================================================
 * WHY THIS IS A DRIFT TEST ACROSS THREE SURFACES, NOT A SPELLING TEST ON ONE
 * ==========================================================================================
 * The same count is described in three places, and they had already drifted apart: the
 * concierge (`lib/thomas/tools.ts`) and the Goldmine page had been corrected while the
 * dashboard tile and the notification label still stated the overclaim as measured. One
 * surface being honest did nothing for the operator reading a different one.
 *
 * So this file asserts all three AGREE, and it bans the class of phrase rather than the one
 * sentence that happened to be wrong. Fixing the wording in one place and regressing another
 * is the failure this test exists to catch.
 *
 * ==========================================================================================
 * THE INSTRUMENT IS ASSERTED BEFORE THE CLAIM IS, BECAUSE A DEAD REGEX PASSES EVERYTHING
 * ==========================================================================================
 * Two of these surfaces can only be read as source text: `app/(app)/page.tsx` is an async
 * React Server Component that reaches the filesystem, and the strings under test ARE string
 * literals in it. `test/honesty/nav-copy.test.ts` established the discipline this file copies:
 *
 *   1. COMMENTS COME OUT FIRST. Every one of these files now carries a comment EXPLAINING the
 *      old overclaim, and those comments quote it verbatim. An instrument that cannot tell an
 *      explanation from an occurrence would fail on the very habit worth keeping. (This is not
 *      hypothetical: writing that comment is what made the stripper necessary.)
 *   2. THE STRIPPER IS ITSELF CONTROLLED, both ways. An over-eager stripper deletes the code
 *      too and makes every absence assertion vacuously true, so a string known to live ONLY in
 *      a comment must vanish AND a string known to live only in code must survive.
 *   3. THE EXTRACTOR'S YIELD IS ASSERTED against a known key set before any claim is judged.
 *      A regex that stops matching must fail loudly rather than report a clean bill of health.
 *
 * `SIGNAL_KINDS` needs none of that: it is a plain exported constant, so it is imported and
 * read directly. Reading the real value beats reading the text that produces it, wherever the
 * import is possible.
 *
 * POSITIVE CONTROL, EXERCISED BY DOING IT: restoring either old string fails this file. See
 * the note at the foot of this comment block for the measured result rather than the intent.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIGNAL_KINDS } from '@/lib/notify/signals'

const ROOT = path.resolve(__dirname, '..', '..')
const DASHBOARD = path.join(ROOT, 'app', '(app)', 'page.tsx')
const GOLDMINE = path.join(ROOT, 'app', '(app)', 'goldmine', 'page.tsx')
const CONCIERGE = path.join(ROOT, 'lib', 'thomas', 'tools.ts')

/**
 * THE BANNED CLASS. Not one sentence: every way of saying that an unqueried absence proves
 * nobody holds the part. `nobody holds` is deliberately absent from this list, because the
 * builders use it correctly in `lib/intelligence/datasets.ts` to describe the CONCEPT of a
 * make-side item, and banning a concept because a surface once overstated it would be the
 * wrong lesson.
 */
const CENSUS_CLAIMS: readonly RegExp[] = [
  /nobody can source/i,
  /nobody can supply/i,
  /no one can source/i,
  /no one can supply/i,
  /nobody else can (?:make|source|supply)/i,
  /cannot be sourced anywhere/i,
]

/** The phrase the corrected surfaces share. Present-tense assertion, so drift shows up as red. */
const HONEST_PHRASE = /no supplier matched/i

/** Strip block and line comments. Line comments only when they begin a line, so a `//` inside a URL survives. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
}

const dashboardRaw = readFileSync(DASHBOARD, 'utf8')
const dashboardSource = withoutComments(dashboardRaw)
const goldmineSource = withoutComments(readFileSync(GOLDMINE, 'utf8'))
const conciergeSource = withoutComments(readFileSync(CONCIERGE, 'utf8'))

/**
 * Pull `helpId -> hint` out of the dashboard tile table. Non-greedy, so each hint binds to the
 * first helpId after it, which is the one inside its own object literal.
 */
function tileHints(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /hint:\s*'([^']*)',[\s\S]*?helpId:\s*'([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) out.set(m[2] as string, m[1] as string)
  return out
}

/** Pull `helpId -> sourceDetail` (a template literal, so backticks). */
function tileSourceDetails(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /helpId:\s*'([^']+)',\s*sourceDetail:\s*`([\s\S]*?)`,/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) out.set(m[1] as string, m[2] as string)
  return out
}

describe('THE INSTRUMENT, checked before it is trusted', () => {
  it('the comment stripper removes comments AND leaves code, both directions asserted', () => {
    // Lives ONLY in the corrective comment now. If the stripper is asleep, this survives.
    expect(dashboardRaw).toMatch(/nobody can source/i)
    expect(dashboardSource).not.toMatch(/nobody can source/i)
    // Lives only in shipped code. If the stripper is over-eager, this vanishes and every
    // absence assertion below becomes vacuously true.
    expect(dashboardSource).toMatch(/helpId:\s*'capability\.no_quote'/)
  })

  it('the tile extractor yields the known dashboard tiles, so a dead regex cannot pass', () => {
    const hints = tileHints(dashboardSource)
    const details = tileSourceDetails(dashboardSource)
    expect(hints.size).toBeGreaterThanOrEqual(3)
    expect([...hints.keys()]).toContain('capability.no_quote')
    expect([...hints.keys()]).toContain('monopoly.candidate_corner')
    expect([...details.keys()]).toContain('capability.no_quote')
    // A yield is not enough: the value must be non-empty prose, not a matched blank.
    expect((hints.get('capability.no_quote') ?? '').length).toBeGreaterThan(10)
    expect((details.get('capability.no_quote') ?? '').length).toBeGreaterThan(10)
  })

  it('SIGNAL_KINDS is the real constant and carries the no_quote row', () => {
    expect(SIGNAL_KINDS.length).toBeGreaterThanOrEqual(5)
    expect(SIGNAL_KINDS.map((k) => k.kind)).toContain('no_quote')
  })
})

describe('the make-side count is never rendered as a census of the world', () => {
  it('the notification label states an absence of a match, not an absence of suppliers', () => {
    const noQuote = SIGNAL_KINDS.find((k) => k.kind === 'no_quote')
    expect(noQuote).toBeDefined()
    const describe_ = noQuote?.describe ?? ''
    for (const claim of CENSUS_CLAIMS) expect(describe_).not.toMatch(claim)
    expect(describe_).toMatch(HONEST_PHRASE)
    // The qualifier travels with the claim: a hedge nobody reads is not a hedge.
    expect(describe_).toMatch(/not proof nobody holds the part/i)
  })

  it('the dashboard tile hint states an absence of a match', () => {
    const hint = tileHints(dashboardSource).get('capability.no_quote') ?? ''
    for (const claim of CENSUS_CLAIMS) expect(hint).not.toMatch(claim)
    expect(hint).toMatch(HONEST_PHRASE)
  })

  it('the dashboard tile label names what was counted, not an outcome nobody measured', () => {
    /*
     * The label read "no-quote make-side WINS". A win is a thing that happened; these are buys
     * that drew no quote, which is a lane. Correcting the hint while the label still claimed an
     * outcome would have left the tile overclaiming in larger type than the part that was fixed.
     */
    const labels = [...dashboardSource.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1] as string)
    expect(labels.length).toBeGreaterThanOrEqual(4)
    const makeSide = labels.filter((l) => /make-side/i.test(l))
    expect(makeSide).toHaveLength(1)
    expect(makeSide[0]).not.toMatch(/\bwins?\b/i)
    expect(makeSide[0]).toMatch(/buys/i)
  })

  it('the dashboard tile carries its denominator, because a total over an unchecked fraction reads as a total over all of it', () => {
    const detail = tileSourceDetails(dashboardSource).get('capability.no_quote') ?? ''
    expect(detail).toMatch(/not a census of the world/i)
  })

  it('NO surface in the tile table makes the claim, not merely the one that was fixed', () => {
    for (const claim of CENSUS_CLAIMS) expect(dashboardSource).not.toMatch(claim)
  })
})

describe('DRIFT CONTROL: all three surfaces describing this count agree', () => {
  /*
   * The reason this file exists at all. Two surfaces were corrected and two were not, and
   * nothing noticed for days. Asserting the corrected ones stay corrected is what turns a
   * one-time fix into a property.
   */
  it('the Goldmine page still labels the count "no supplier matched"', () => {
    expect(goldmineSource).toMatch(HONEST_PHRASE)
    for (const claim of CENSUS_CLAIMS) expect(goldmineSource).not.toMatch(claim)
  })

  it('the concierge still refuses the overclaim in its own voice', () => {
    expect(conciergeSource).toMatch(/no supplier matched in the availability data/i)
    expect(conciergeSource).toMatch(/NOT a census of the world/i)
    expect(conciergeSource).toMatch(/do not say nobody holds it anywhere/i)
  })

  it('the four surfaces are the complete set, so a fifth cannot appear unnoticed', () => {
    /*
     * A STRUCTURAL CONTROL THAT OWES NOTHING TO WORDING. If a new surface starts rendering
     * `makeSideOnly`, it is a new place the claim can be restated, and this assertion drags
     * whoever adds it back to this file. Counted, not assumed: the four known readers are the
     * dashboard, the Goldmine page, the concierge and the signal engine.
     */
    const readers = ['app/(app)/page.tsx', 'app/(app)/goldmine/page.tsx', 'lib/thomas/tools.ts', 'lib/notify/signals.ts']
    for (const rel of readers) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8')
      expect(src, `${rel} should still read the make-side count`).toMatch(/makeSideOnly/)
    }
  })
})
