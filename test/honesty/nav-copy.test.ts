/**
 * THE NAV TEASERS ARE COPY THAT SHIPS, SO THEY ARE CLAIMS THAT SHIP.
 *
 * Every nav row carries a one-line `description`. It renders twice: as visible prose inside the
 * "What each tool does" guide (components/shell/NavGuide.tsx), and as the row's `title`
 * supplement in the shell (components/shell/AppShell.tsx). The guide is reachable from every
 * page, which makes these the sentences a person reads most often in this product, and they were
 * the only place the day-scoping discipline every page enforces had been dropped.
 *
 * ==========================================================================================
 * WHAT WAS WRONG, VERIFIED IN CODE 2026-08-18.
 * ==========================================================================================
 *   /intelligence  "The whole market added up"           the page itself serves "the whole
 *                                                        candidate book for THIS FEED DAY"
 *   /board         "Every open government requirement    the page itself says "Feed day X,
 *                  today"                                 N requirements as published by DLA",
 *                                                        and a close date on the file may
 *                                                        already have passed
 *   /sales         "it is not running until you switch    there is no switch. No toggle in
 *                  it on"                                 app/(app)/sales, no component in
 *                                                        components/sales, no /api/*hunter*
 *                                                        route, no settings entry.
 *
 * ==========================================================================================
 * WHY THIS TEST READS SOURCE TEXT, AND WHAT STOPS THAT FROM BEING WORTHLESS.
 * ==========================================================================================
 * The claim under test IS the string literal in the file, so the literal is the right thing to
 * read. The danger with a hand-written extractor is the one this codebase has already been
 * burned by: a regex that matches nothing passes every assertion and reports a clean bill of
 * health. So the extractor's own yield is asserted FIRST, against the known row count and the
 * known href set. If the regex stops matching, this file fails loudly instead of going quiet.
 *
 * The Hunter Mode claim gets a second, structural control that owes nothing to the wording: it
 * fails the day a switch appears anywhere, so whoever builds one is forced to come back and
 * make this sentence true again.
 *
 * POSITIVE CONTROL, EXERCISED: restoring any one of the three old strings in
 * app/(app)/layout.tsx fails this file. Measured by doing it, not by assuming it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..', '..')
const LAYOUT = path.join(ROOT, 'app', '(app)', 'layout.tsx')
const NAV_GUIDE = path.join(ROOT, 'components', 'shell', 'NavGuide.tsx')

const layoutSource = readFileSync(LAYOUT, 'utf8')

/**
 * PREPROCESSING IS PART OF THE INSTRUMENT, and this file learned it the same way the lint gate
 * did (see the comment on `explainbutton-inside-a-paragraph` in scripts/lint-gates.mjs).
 *
 * The first run of these two assertions FAILED, on the comments that were added to NavGuide.tsx
 * to explain why each phrase was removed. The instrument read prose about a defect as the
 * defect. A rule that cannot tell an explanation from an occurrence punishes the one habit worth
 * keeping, so comments come out before the copy is judged.
 *
 * Line comments are stripped only when they start a line, so a `//` inside a URL in a string is
 * left alone. The stripper is then itself checked, below, against prose we know must survive:
 * an over-eager stripper would make every absence assertion vacuously true.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
}

const navGuideSource = withoutComments(readFileSync(NAV_GUIDE, 'utf8'))

/**
 * Pull every `{ href, ..., description }` pair out of the nav table. Non-greedy, so each href
 * binds to the first description after it, which is the one inside its own object literal.
 */
function navDescriptions(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /href:\s*'([^']+)',[\s\S]*?description:\s*'([^']*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) out.set(m[1] as string, m[2] as string)
  return out
}

const DESCRIPTIONS = navDescriptions(layoutSource)

/** Every href the nav ships today. Named here so a silently missing row is a failure. */
const EXPECTED_HREFS = [
  '/',
  '/monopoly',
  '/groups',
  '/goldmine',
  '/hubzone',
  '/intelligence',
  '/board',
  '/competitor',
  '/sales',
  '/suppliers',
  '/documents',
  '/admin',
  '/settings',
]

describe('the extractor itself, asserted before anything is concluded from it', () => {
  it('found a description for every nav row, so a silent miss cannot pass as a clean bill', () => {
    expect([...DESCRIPTIONS.keys()].sort()).toEqual([...EXPECTED_HREFS].sort())
    for (const [href, text] of DESCRIPTIONS) {
      expect(text.length, `${href} has an empty description`).toBeGreaterThan(20)
    }
  })
})

describe('the nav claims only what this product serves', () => {
  it('/intelligence no longer claims the whole market, and scopes to what was captured', () => {
    const d = DESCRIPTIONS.get('/intelligence') as string
    expect(d).not.toMatch(/whole market/i)
    // The page serves an aggregate over a captured book, so the teaser must name the capture.
    expect(d).toMatch(/captur/i)
  })

  it('/board no longer claims every requirement that exists today, and names the feed', () => {
    const d = DESCRIPTIONS.get('/board') as string
    expect(d).not.toMatch(/every open government requirement today/i)
    expect(d).toMatch(/feed/i)
    expect(d).toMatch(/captur/i)
  })

  it('/sales no longer offers a switch, because there is no switch', () => {
    const d = DESCRIPTIONS.get('/sales') as string
    expect(d).not.toMatch(/switch it on/i)
    // It must still say what Hunter Mode's real state is, in the page's own words.
    expect(d).toMatch(/built and gated/i)
    expect(d).toMatch(/never run/i)
  })

  it('/monopoly says approved to make, which is what a sole-source record actually means', () => {
    const d = DESCRIPTIONS.get('/monopoly') as string
    expect(d).toMatch(/approved to make/i)
    expect(d).not.toMatch(/only one company can make/i)
  })

  it('/suppliers does not assert measured inventory it has never measured', () => {
    // lib/intelligence/help.ts, suppliers.prospect_score: "It does not measure inventory ...
    // Silence is a signal, not proof a company is gone." The teaser used to say the companies
    // ARE holding dead stock, which is the researcher's bet stated as a fact.
    const d = DESCRIPTIONS.get('/suppliers') as string
    expect(d).not.toMatch(/companies holding dead stock/i)
    expect(d).toMatch(/likely|ranked/i)
  })

  it('/settings describes the screen that exists, which is alerts and channels only', () => {
    const d = DESCRIPTIONS.get('/settings') as string
    expect(d).not.toMatch(/your account/i)
  })

  it('no nav teaser claims totality over anything but a capture', () => {
    for (const [href, text] of DESCRIPTIONS) {
      expect(
        /\bthe whole market\b|\ball government\b|\bevery requirement (?:that exists|today)\b/i.test(text),
        `${href}: "${text}" claims totality over the world rather than over what was captured`,
      ).toBe(false)
    }
  })
})

describe('the nav guide prose', () => {
  it('the comment stripper left the rendered prose intact, so an absence below means something', () => {
    expect(navGuideSource).toMatch(/The menu is the method, top to bottom/)
    expect(navGuideSource).toMatch(/Closing happens in Pipeline and Documents/)
    expect(navGuideSource).toMatch(/Anywhere you see the small eye mark/)
  })

  it('does not promise every explainer names a government file, because three do not', () => {
    // Measured against lib/intelligence/help.ts: 22 entries, of which suppliers.prospect_score
    // reads a researcher's workbook and monopoly.availability_unknown / monopoly.ils name an
    // absent credential. Naming a file for those would be the wrong answer, not a missing one.
    expect(navGuideSource).not.toMatch(/which government file it was read from/i)
    expect(navGuideSource).toMatch(/exactly where it came from/i)
  })

  it('does not say a quote goes out, because nothing sends from this product', () => {
    // lib/notify/email.ts: ONLYSOURCE_EMAIL_ARMED must be exactly "true" and is absent, and the
    // recipient allowlist holds one internal address. No quote has ever left here.
    expect(navGuideSource).not.toMatch(/a quote goes out/i)
  })
})

/**
 * THE STRUCTURAL CONTROL FOR THE HUNTER MODE CLAIM.
 *
 * Wording checks can only prove the sentence changed. This proves the sentence is TRUE, and it
 * keeps proving it: the day somebody builds a hunter switch, this fails and points them at the
 * copy that would otherwise quietly become correct-by-accident or, worse, stay wrong in the
 * other direction. It asserts nothing about whether a switch SHOULD exist.
 */
describe('the Hunter Mode claim is structurally true, not just reworded', () => {
  function filesUnder(dir: string): string[] {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return []
    }
    return entries.flatMap((name) => {
      const full = path.join(dir, name)
      return statSync(full).isDirectory() ? filesUnder(full) : [full]
    })
  }

  it('there is no route, component or control that could switch Hunter Mode on', () => {
    const apiRoutes = filesUnder(path.join(ROOT, 'app', 'api'))
    expect(apiRoutes.filter((f) => /hunter/i.test(f))).toEqual([])

    // `startOutreach` is the engine's entry point. It must be reachable only from the engine
    // itself and from tests; a call from a route handler or a component is an armed path.
    const surfaces = [
      ...filesUnder(path.join(ROOT, 'app')),
      ...filesUnder(path.join(ROOT, 'components')),
    ].filter((f) => /\.tsx?$/.test(f))
    const callers = surfaces.filter((f) => /\bstartOutreach\s*\(/.test(readFileSync(f, 'utf8')))
    expect(callers.map((f) => path.relative(ROOT, f))).toEqual([])
  })
})
