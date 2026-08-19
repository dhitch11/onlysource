/**
 * WHERE THE GOVERNMENT DOES NOT AGREE WITH ITSELF, THE SCREEN SAYS SO.
 *
 * An item appears under several MOE rules and the derivation picks the managing activity's row.
 * Picking is correct. Presenting the pick as though the record were unanimous is not, and an
 * arbitrary pick presented as a determination is the defect this product removed elsewhere.
 *
 * Measured on the live catalogue: 116 stock numbers where two activities state a different
 * acquisition method, 319 a different suffix code, and 24 where ONE activity contradicts its own
 * rows. Until now those flags reached the index and stopped there, which is this estate's
 * dominant failure mode named out loud by the lane that built them.
 */
import { describe, expect, it } from 'vitest'

import { acquisitionCodeCell, type CornerRowWithAward } from '@/app/(app)/monopoly/MonopolyGrid'

const NONE = { amc: false, amsc: false, selfContradiction: false }

const row = (contested: typeof NONE, over: Partial<{ state: string; amsc: string }> = {}) =>
  ({
    nsn: '5306014626778',
    eligibility: {
      state: (over.state ?? 'determined') as never,
      amsc: over.amsc ?? 'G',
      posture: 'open_to_surplus_dealer',
      explanation: 'the government explanation, verbatim',
      reason: 'the managing activity publishes acquisition codes',
      contested,
    },
  }) as unknown as CornerRowWithAward

const textOf = (v: unknown): string => JSON.stringify(v)

describe('an uncontested item renders exactly as before', () => {
  it('keeps the verified chip and says nothing extra', () => {
    const c = acquisitionCodeCell(row(NONE))
    expect(c.state).toBe('known')
    const s = textOf(c)
    expect(s).toContain('AMSC G')
    expect(s).toContain('verified')
    expect(s).not.toContain('disagree')
    expect(s).not.toContain('contradicts')
  })
})

describe('a contested item keeps the claim and qualifies it', () => {
  it('still renders the code, because it is still the managing activity’s answer', () => {
    const c = acquisitionCodeCell(row({ ...NONE, amsc: true }))
    expect(c.state).toBe('known')
    expect(textOf(c)).toContain('AMSC G')
  })

  it('holds the same fact less firmly: the tone moves off verified', () => {
    const s = textOf(acquisitionCodeCell(row({ ...NONE, amsc: true })))
    expect(s).toContain('active')
    expect(s).not.toContain('"verified"')
  })

  it('names a code disagreement', () => {
    expect(textOf(acquisitionCodeCell(row({ ...NONE, amsc: true })))).toContain(
      'two activities disagree on the code',
    )
  })

  it('names a method disagreement', () => {
    expect(textOf(acquisitionCodeCell(row({ ...NONE, amc: true })))).toContain(
      'two activities disagree on the method',
    )
  })

  it('names both when both disagree, rather than picking one to mention', () => {
    expect(textOf(acquisitionCodeCell(row({ ...NONE, amc: true, amsc: true })))).toContain(
      'two activities disagree on the method and the code',
    )
  })

  /*
   * ★ THE DISTINCTION THAT MATTERS. A tie between two sources is a fact about the catalogue. One
   * source disagreeing with its OWN rows is a fact about the quality of that source's record, and
   * it is the one an operator should weigh hardest before spending money. They must not share a
   * sentence.
   */
  it('says a self-contradiction is a self-contradiction, not a tie', () => {
    const s = textOf(acquisitionCodeCell(row({ ...NONE, selfContradiction: true })))
    expect(s).toContain('one activity contradicts its own rows')
    expect(s).not.toContain('two activities disagree')
  })

  it('reports the self-contradiction even when a tie is also present, because it is the graver fact', () => {
    const s = textOf(acquisitionCodeCell(row({ amc: true, amsc: true, selfContradiction: true })))
    expect(s).toContain('one activity contradicts its own rows')
  })
})

describe('an eligibility object without the field renders, it does not throw', () => {
  /*
   * ★ FOUND BY AN EXISTING TEST, NOT BY THIS ONE. A fixture built before `contested` existed
   * reached the cell as undefined and the dereference threw. This runs inside a SERVER COMPONENT,
   * so the cost is not one wrong cell: the whole page renders as the error boundary. Absent flags
   * mean nothing contested, which is the same answer the binary index gives for a file written
   * before byte 7 carried them.
   */
  it('treats absent flags as nothing contested', () => {
    const legacy = { nsn: '5306014626778', eligibility: { state: 'determined', amsc: 'G', posture: null, explanation: null, reason: 'r' } } as unknown as CornerRowWithAward
    expect(() => acquisitionCodeCell(legacy)).not.toThrow()
    const c = acquisitionCodeCell(legacy)
    expect(c.state).toBe('known')
    expect(textOf(c)).not.toContain('disagree')
  })
})

describe('it never turns an abstention into a claim', () => {
  it('an abstaining row stays unknown no matter what is contested', () => {
    const c = acquisitionCodeCell(row({ amc: true, amsc: true, selfContradiction: true }, { state: 'abstained_pica_does_not_publish' }))
    expect(c.state).toBe('unknown')
  })

  it('a determined row with no code stays unknown', () => {
    const c = acquisitionCodeCell(row(NONE, { amsc: '' }))
    expect(c.state).toBe('unknown')
  })
})
