/**
 * THE POSITIVE CONTROL ON THE LIVE NUMERAL GUARD.
 *
 * `lib/ai/grounding.ts` is the guard six AI routes actually call. Every existing test of it
 * feeds it prose and checks the result. None of them can answer the only question that matters
 * when a guard goes quiet: could it still have stripped something? "Nothing stripped" is the
 * output of a working guard and of a guard whose tokenizer stopped matching, and the two are
 * indistinguishable from the return value on every call.
 *
 * This file drives the LIVE guard through the guard-agnostic known-bad corpus and fails if a
 * fabricated figure gets through. It also drives this module's own firewall through the same
 * corpus, so the two are measured against one input set instead of two, and the difference
 * between them is a number rather than an opinion.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY SOME CASES ARE PINNED AS ESCAPES RATHER THAN ASSERTED AS PASSES. READ BEFORE EDITING.
 * ---------------------------------------------------------------------------------------------
 * `LIVE_GUARD_KNOWN_ESCAPES` is not a list of things that are fine. It is a list of MEASURED
 * HOLES in a file this lane does not own (`lib/ai/*` is user-b0's and is dirty in the tree, so
 * a silent fix here would clobber their edit). Writing them down as an assertion, rather than
 * as a sentence in a report nobody re-reads, is what makes them impossible to lose.
 *
 * The pin is BIDIRECTIONAL on purpose. The test fails if a pinned case starts being blocked,
 * exactly as loudly as if an unpinned one stops being blocked. That failure is the good one:
 * it means somebody closed the hole, and the fixture's next home is the must-block set. A pin
 * that only fires on regression would let a fix land silently and leave a stale note claiming a
 * defect that no longer exists, which is how a comment becomes a lie.
 */

import { describe, expect, it } from 'vitest'
import { groundBrief } from '@/lib/ai/grounding'
import { assertNumeralsGrounded, firewallSelfTest } from '@/lib/engine/firewall'
import {
  GROUNDED_CONTROL,
  MUST_BLOCK,
  STRICTER_BY_DESIGN,
  runKnownBadCorpus,
  type GuardUnderTest,
} from '@/lib/engine/firewall/known-bad'

/** The live guard, reduced to "did this get through". `ok` is true when it stripped nothing. */
const liveGuard: GuardUnderTest = (sentence, payload) => !groundBrief(sentence, payload).ok

/** This module's firewall, same reduction. */
const engineFirewall: GuardUnderTest = (sentence, payload) =>
  !assertNumeralsGrounded(sentence, payload).ok

/**
 * MEASURED 2026-08-17 against lib/ai/grounding.ts. Each of these states a figure that is in no
 * field of the payload, and the live guard returns ok:true and hands the sentence to the
 * operator unchanged.
 *
 * ALL FIVE HAVE ONE CAUSE, which is why they are one fix and not five: `valueTokensIn` skips
 * any digit run whose neighbouring character is a letter. That rule is correct and load-bearing
 * -- it is the MIDS JTRS AN/USQ190 fix, and removing it re-opens that defect -- but it is
 * applied to the BRIEF side as well as the dossier side, so `1200EA` reads as an identifier
 * fragment rather than as the quantity DIBBS writes on every solicitation.
 *
 * THE SHAPE OF THE FIX, for whoever owns lib/ai when this is scheduled: the asymmetry is the
 * answer. A digit run touching letters should stay OUT of the allowed set (an item name must
 * not bless a bare number) while still being CHECKED in the brief, by testing the surrounding
 * token against the payload's identifier strings instead of discarding it. `AN/USQ190` then
 * clears because the payload contains that identifier; `1200EA` blocks because it does not.
 * That is the rule lib/engine/firewall/numerals.ts already implements in `looksLikeIdentifier`,
 * and it is why the firewall column below is clean.
 */
const LIVE_GUARD_KNOWN_ESCAPES: ReadonlySet<string> = new Set([
  'unit_of_issue_suffix',
  'unit_of_issue_suffix_lowercase',
  'multiplier_suffix',
  'currency_suffix',
  'dangling_template_slot',
])

describe('the known-bad corpus can tell a working guard from a broken one', () => {
  it('reports a hole when pointed at a guard that blocks nothing', () => {
    const results = runKnownBadCorpus(() => false)
    expect(results.every((r) => !r.blocked)).toBe(true)
    expect(results).toHaveLength(MUST_BLOCK.length)
  })

  it('does not score a clean run for a guard that blocks everything', () => {
    // The negative control. Without it, `() => true` passes the corpus perfectly.
    const blocksEverything: GuardUnderTest = () => true
    expect(blocksEverything(GROUNDED_CONTROL.sentence, GROUNDED_CONTROL.payload)).toBe(true)
    // A guard that blocks the grounded control is broken, however well it scores on bad input.
    expect(engineFirewall(GROUNDED_CONTROL.sentence, GROUNDED_CONTROL.payload)).toBe(false)
    expect(liveGuard(GROUNDED_CONTROL.sentence, GROUNDED_CONTROL.payload)).toBe(false)
  })

  it('every must-block case states a figure that is genuinely absent from its payload', () => {
    // Guards against the corpus rotting into cases that are not actually bad.
    for (const c of MUST_BLOCK) {
      if (c.fabricated === null) continue
      const digits = c.fabricated.replace(/[^\d.]/g, '')
      if (digits === '') continue
      expect(JSON.stringify(c.payload)).not.toContain(digits)
    }
  })
})

describe('R3.8 the engine firewall blocks the whole corpus', () => {
  it('blocks every must-block case', () => {
    const holes = runKnownBadCorpus(engineFirewall).filter((r) => !r.blocked)
    expect(holes.map((h) => h.klass)).toEqual([])
  })

  it('passes the grounded control, so it is not merely rejecting all prose', () => {
    expect(engineFirewall(GROUNDED_CONTROL.sentence, GROUNDED_CONTROL.payload)).toBe(false)
  })

  it('still passes its own shipped self test', () => {
    expect(firewallSelfTest()).toEqual({ passed: true, failures: [] })
  })
})

describe('the LIVE guard six AI routes call, driven through the same corpus', () => {
  it('blocks every must-block case that is not a pinned, measured escape', () => {
    const holes = runKnownBadCorpus(liveGuard)
      .filter((r) => !r.blocked)
      .filter((r) => !LIVE_GUARD_KNOWN_ESCAPES.has(r.klass))
    // A name here is a fabricated figure reaching an operator through a live AI route.
    expect(holes.map((h) => h.klass)).toEqual([])
  })

  it('still catches the ungrounded percentage that caused the MIDS JTRS defect', () => {
    // The regression this guard exists for. Pinned separately so it can never be quietly
    // demoted into the escape list.
    expect(liveGuard('Escalation ran 47 percent above the anchor.', GROUNDED_CONTROL.payload)).toBe(
      true,
    )
  })

  it('does not strip a legitimately grounded sentence', () => {
    const r = groundBrief(GROUNDED_CONTROL.sentence, GROUNDED_CONTROL.payload)
    expect(r.ok).toBe(true)
    expect(r.stripped).toEqual([])
    expect(r.text).toBe(GROUNDED_CONTROL.sentence)
  })

  it('each pinned escape still escapes, so a closed hole cannot go unnoticed', () => {
    const stillEscaping = runKnownBadCorpus(liveGuard)
      .filter((r) => LIVE_GUARD_KNOWN_ESCAPES.has(r.klass))
      .filter((r) => r.blocked)
      .map((r) => r.klass)
    // If this fails, the hole was CLOSED. Delete the name from LIVE_GUARD_KNOWN_ESCAPES;
    // the must-block assertion above then covers it permanently.
    expect(stillEscaping).toEqual([])
  })
})

describe('the two guards disagree, and the disagreement is recorded not hidden', () => {
  it('the firewall is stricter on cases where guards may legitimately differ', () => {
    const fw = runKnownBadCorpus(engineFirewall, STRICTER_BY_DESIGN)
    expect(fw.every((r) => r.blocked)).toBe(true)
    // The live guard is not asserted here in either direction. These are judgement calls,
    // not defects, and asserting one guard's judgement as the other's contract is how a
    // preference becomes a false failure.
  })
})
