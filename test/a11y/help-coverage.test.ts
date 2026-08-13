/**
 * THE EXPLAINER COVERAGE GATE. Acceptance gate R9.4. Owner: @T8-DESIGN.
 *
 * "A requirement that lives only in a document decays. Make it mechanical."
 *
 * ---------------------------------------------------------------------------------------
 * WHAT THIS EXISTS TO PREVENT, and it already happened once
 * ---------------------------------------------------------------------------------------
 * `HelpRecord` shipped this morning with FOUR content fields. Quality Bar G2 requires five,
 * and gate R9.4 names the fifth explicitly. So R9.4 could not have passed, and no test said
 * so, because the only check was a `validateHelp` function that nothing called.
 *
 * @T5-DOCUMENTS caught it by writing their content and finding nowhere to put it. That is a
 * human catching a gap that an unrun instrument was supposed to catch. This file is the
 * instrument, actually run.
 *
 * ---------------------------------------------------------------------------------------
 * EVERY GATE HERE SHIPS WITH A FIXTURE THAT FIRES
 * ---------------------------------------------------------------------------------------
 * A green run proves nothing on its own. For each rule there is a deliberately-bad record
 * asserted to FAIL, so the check is demonstrated able to fail rather than assumed able to.
 * A test that could not have failed is not a test.
 */

import { describe, expect, it } from 'vitest'
import { allHelp, validateHelp, getHelp, inferOwner, type HelpRecord } from '@/components/help/registry'

const BASE: HelpRecord = {
  id: 'fixture.base',
  owner: 'T8 DESIGN',
  title: 'Fixture',
  what: 'A short line under the cap.',
  how: 'What the reader does with it.',
  why: 'Why it matters, naming money or risk.',
  source: 'Where the number came from.',
}

describe('the instrument can fail', () => {
  it('a record missing "why" is rejected', () => {
    expect(validateHelp({ ...BASE, why: '   ' })).toContainEqual(
      expect.stringContaining('"why" is empty'),
    )
  })

  it('a record whose "what" exceeds the 140 character cap is rejected', () => {
    const long = 'x'.repeat(141)
    expect(validateHelp({ ...BASE, what: long })).toContainEqual(
      expect.stringContaining('cap is 140'),
    )
  })

  it('an em dash in any content field is rejected', () => {
    expect(validateHelp({ ...BASE, why: 'a — b' })).toContainEqual(
      expect.stringContaining('em dash'),
    )
  })

  it('a clean record produces no problems, so the checks are not simply always-on', () => {
    expect(validateHelp(BASE)).toEqual([])
  })
})

describe('R9.4: the FIFTH field, what_this_does_not_do', () => {
  it('is REQUIRED on a record that explains a score, and its absence fails', () => {
    const scoreWithoutFifth: HelpRecord = { ...BASE, id: 'score.fixture', explainsAScore: true }
    expect(validateHelp(scoreWithoutFifth)).toContainEqual(
      expect.stringContaining('whatThisDoesNotDo'),
    )
  })

  it('passes once the score record carries it', () => {
    const scoreWithFifth: HelpRecord = {
      ...BASE,
      id: 'score.fixture',
      explainsAScore: true,
      whatThisDoesNotDo: 'It does not confirm that any candidate is available to buy.',
    }
    expect(validateHelp(scoreWithFifth)).toEqual([])
  })

  it('is NOT forced on non-score chrome, because a sentence written to satisfy a lint is fabricated content', () => {
    // The scope in Quality Bar G2 is "present on every score", not on every record. Forcing
    // it everywhere produces filler in a slot an operator trusts, which is worse than absence.
    expect(validateHelp({ ...BASE, explainsAScore: false })).toEqual([])
  })
})

describe('every registered entry, from every lane, passes its own rules', () => {
  const records = allHelp()

  it('the registry is not empty, or the sweep below is vacuous', () => {
    expect(records.length).toBeGreaterThan(0)
  })

  for (const r of records) {
    it(`[${r.owner}] ${r.id}`, () => {
      const problems = validateHelp(r)
      // The message carries the problems, so a failure reads as the actual defect rather
      // than "expected 1 to be 0".
      expect(problems.join('; ') || 'clean').toBe('clean')
    })
  }

  it('every score explainer in the registry carries the fifth field', () => {
    const offenders = records
      .filter((r) => r.explainsAScore)
      .filter((r) => !r.whatThisDoesNotDo?.trim())
      .map((r) => `${r.owner}:${r.id}`)
    expect(offenders).toEqual([])
  })

  it('ids are unique across lanes', () => {
    const ids = records.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the three tiers of the contract are all still present', () => {
  /*
   * This block exists because L3 WAS silently deleted from HelpRecord on 2026-08-13 while
   * the fifth field was being added, and every test stayed green. Nothing covered it. tsc
   * caught it only because one component happened to read the field.
   *
   * The structure is L1 (one line), L2 (the panel), L3 (one link to the document). Losing a
   * tier is losing a tier, so each is now asserted structurally.
   */
  it('L1, L2 and L3 are all expressible on a record', () => {
    const full: HelpRecord = {
      ...BASE,
      whatThisDoesNotDo: 'Its limits.',
      moreHref: '/help/fixture',
      modelled: true,
    }
    expect(full.what).toBeTypeOf('string')          // L1
    expect(full.how).toBeTypeOf('string')           // L2
    expect(full.why).toBeTypeOf('string')           // L2
    expect(full.source).toBeTypeOf('string')        // L2
    expect(full.whatThisDoesNotDo).toBeTypeOf('string') // L2, the fifth field
    expect(full.moreHref).toBe('/help/fixture')     // L3
    expect(validateHelp(full)).toEqual([])
  })
})

describe('a missing entry is an honest empty state, never an invented one', () => {
  it('an unregistered id resolves to undefined rather than to a generated record', () => {
    expect(getHelp('nobody.wrote.this.one')).toBeUndefined()
  })

  it('and the owing lane can still be named from the namespace, so the panel says who owes it', () => {
    expect(inferOwner('compliance.path.c04')).toBe('T5 DOCUMENTS')
    expect(inferOwner('score.signal.surplus_run')).toBe('T3 ENGINE')
  })

  it('an unknown namespace returns undefined rather than guessing a lane', () => {
    // Naming the WRONG lane sends somebody to the wrong place, which is worse than saying
    // nothing. The panel handles undefined with a generic line.
    expect(inferOwner('wibble.something')).toBeUndefined()
  })
})
