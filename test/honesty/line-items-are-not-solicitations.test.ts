/**
 * THE ASSISTANT MUST NOT REPORT A COUNT OF CHILDREN AS A COUNT OF PARENTS.
 *
 * =========================================================================================
 * WHAT WENT WRONG, MEASURED
 * =========================================================================================
 * `lib/thomas/tools.ts` said, out loud, to an operator:
 *
 *     "Solicitations that drew no quote at all: 839."
 *
 * 839 is the ROW count. A row is one stock number on one dated version of one solicitation.
 * Measured over this corpus on 2026-08-24: 839 rows against **803 distinct solicitation
 * numbers**. 34 rows carry `***REVISED***`, an amendment that keeps the solicitation number
 * and moves the close date, so the amendment and the row it supersedes are two line items of
 * ONE solicitation. 36 solicitation numbers appear on more than one row and only 3 of those
 * are a genuine multi-part buy. So the sentence overstated distinct solicitations by 36.
 *
 * The field itself was named `summary.solicitations` and assigned `rows.length`, so the
 * category error was in the data layer and every surface that read it inherited the error.
 * A field inherited from a parent row is not a measurement of the child, and the converse
 * holds too: a count of children is not a count of parents.
 *
 * ⛔ WHY THIS IS A TEST AND NOT A COMMENT. This estate's House Law 2 is that a hallucinated
 * figure on a federal quote is an existential event. The number here was not hallucinated by
 * a model, which is worse: it was handed to the model as ground truth, correctly labelled in
 * the prompt as something it was not, and the model would have repeated it faithfully. No
 * amount of model discipline catches that. Only the tool text can.
 *
 * This asserts the CLASS, not the sentence. It bans reporting the line-item number as a
 * solicitation count in any phrasing, so a future rewrite of the wording cannot quietly
 * reintroduce the claim while passing a string match.
 */

import { describe, expect, it } from 'vitest'

import { runServerTool } from '@/lib/thomas/tools'
import { role } from '@/lib/admin/permissions'
import type { ToolAccess } from '@/lib/thomas/authz'
import { buildNoQuoteGoldmine } from '@/lib/intelligence/datasets'

function asRole(key: string): ToolAccess {
  const r = role(key)
  if (!r) throw new Error(`No role "${key}" in the catalog, so this test is asserting nothing.`)
  return { held: r.permissions, kind: 'account', roleName: r.name }
}

describe('the goldmine tool text separates line items from solicitations', () => {
  const summary = buildNoQuoteGoldmine().summary

  /*
   * THE INSTRUMENT IS CHECKED BEFORE ITS VERDICT IS TRUSTED. If the tool ever returns an
   * error, a refusal or an empty string, every "does not contain" assertion below passes
   * vacuously and this file becomes a ritual. So the yield is asserted first: real text, and
   * both real numbers present in it.
   */
  it('yields real text containing both figures, so the bans below are not vacuous', async () => {
    const out = await runServerTool('goldmine_snapshot', {}, asRole('operator'))
    const text = String((out as { text?: string }).text ?? '')
    expect(text.length).toBeGreaterThan(200)
    expect(text).toContain(String(summary.lineItems))
    expect(text).toContain(String(summary.distinctSolicitations))
  })

  it('never presents the line-item count as a count of solicitations', async () => {
    const out = await runServerTool('goldmine_snapshot', {}, asRole('operator'))
    const text = String((out as { text?: string }).text ?? '')

    /*
     * The banned CLASS: the word "solicitations" adjacent to the line-item number, in either
     * order, with anything short between them. That catches "Solicitations that drew no quote
     * at all: 839" and "839 solicitations" and the rewrites in between, without depending on
     * the exact sentence anyone happens to have written.
     */
    const n = String(summary.lineItems)
    const numberThenWord = new RegExp(`${n}[^.]{0,40}\\bsolicitations\\b`, 'i')
    const wordThenNumber = new RegExp(`\\bsolicitations\\b[^.]{0,40}${n}`, 'i')

    expect(text).not.toMatch(numberThenWord)
    expect(text).not.toMatch(wordThenNumber)
  })

  it('states the distinct-solicitation count as solicitations, which is what it is', async () => {
    const out = await runServerTool('goldmine_snapshot', {}, asRole('operator'))
    const text = String((out as { text?: string }).text ?? '')
    const d = String(summary.distinctSolicitations)
    expect(text).toMatch(new RegExp(`${d}[^.]{0,40}\\bsolicitation`, 'i'))
  })

  /*
   * The two numbers must not be equal, or every assertion above is testing one value twice and
   * the regexes cannot distinguish which concept they matched. This is the same guard the
   * dataset test carries, repeated here because THIS file's logic depends on the gap existing.
   */
  it('carries a real gap between the two counts, so the assertions can discriminate', () => {
    expect(summary.distinctSolicitations).toBeLessThan(summary.lineItems)
    expect(summary.lineItems - summary.distinctSolicitations).toBe(36)
  })
})
