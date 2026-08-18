/**
 * /monopoly's ACQUISITION-CODE CELL: an unread code must not render as a read one.
 *
 * -----------------------------------------------------------------------------------------
 * THE MEASURED DEFECT
 * -----------------------------------------------------------------------------------------
 * On an index row {niin:'000000001', amc:'3', amsc:'E', pica:'GX'}, with GX in the publishers
 * map, `resolveBidEligibility` returned state 'determined' with a non-empty `amsc`, a null
 * `amscEntry` and a null `posture`. The grid's acquisition-code cell tested only
 * `state !== "determined" || !e.amsc`, so it returned
 * `{state:'known', provenance:'measured', value:<StatusChip tone="verified">AMSC E</StatusChip>}`:
 * a VERIFIED, MEASURED chip naming a code the transcribed Table 71 does not list and nobody has
 * read. The posture cell beside it abstained, so the row was not fully permissive, but the code
 * chip claimed a reading that does not exist. Latent rather than live (all 28,119 rows in today's
 * derived index carry a listed code), and latent is not fixed.
 *
 * The repair is a NAMED STATE rather than a smarter render. `abstained_suffix_code_not_in_table`
 * is returned by the engine, so the grid's existing abstention branch is reached and no surface
 * has to re-derive the difference for itself. The last time each render derived it, one of them
 * derived it wrongly, and that is the whole argument for putting it in the type.
 *
 * The cell is pressed here rather than described. Reading the source and agreeing with it is what
 * the previous round did.
 */
import { describe, expect, it } from 'vitest'

import { acquisitionCodeCell, type CornerRowWithAward } from '@/app/(app)/monopoly/MonopolyGrid'
import { resolveBidEligibility, type AmscIndex } from '@/lib/intelligence/eligibility/bid-eligibility'

const IDX: AmscIndex = {
  ok: true,
  rows: new Map([
    // The reviewer's own failing input, unchanged.
    ['000000001', { niin: '000000001', amc: '3', amsc: 'E', aac: '', pica: 'GX' }],
    // Two characters, which is not a code at all, and the same shape.
    ['000000002', { niin: '000000002', amc: '3', amsc: 'XX', aac: '', pica: 'GX' }],
    // The negative control: a code the table DOES list, on an identical row.
    ['000000003', { niin: '000000003', amc: '3', amsc: 'P', aac: '', pica: 'GX' }],
    // A publisher that publishes nothing, which was already abstaining and must keep abstaining.
    ['000000004', { niin: '000000004', amc: '', amsc: '', aac: '', pica: 'ZW' }],
  ]),
  publishers: new Map([['GX', { rows: 10000, withAmsc: 10000, rate: 1 }]]),
  provenance: {},
}

/** The row exactly as `app/(app)/monopoly/page.tsx` builds it: five short fields, nothing else. */
function rowFor(niin: string): CornerRowWithAward {
  const e = resolveBidEligibility(niin, IDX)
  return {
    eligibility: {
      state: e.state,
      amsc: e.amsc,
      posture: e.posture,
      explanation: e.amscEntry?.explanation ?? null,
      reason: e.reason,
    },
  } as CornerRowWithAward
}

describe('a suffix code the transcribed table does not list renders as an UNKNOWN, never as MEASURED', () => {
  it('★ THE CONTROL: an unlisted code produces an unknown cell carrying a reason', () => {
    for (const niin of ['000000001', '000000002']) {
      const cell = acquisitionCodeCell(rowFor(niin))
      expect(cell.state).toBe('unknown')
      // A blank in a provenance slot reads as permission. The cell must SAY what it does not know.
      expect(cell.state === 'unknown' && cell.reason).toBeTruthy()
      expect(cell.state === 'unknown' && cell.reason).toContain('does not list')
      expect(cell.state === 'unknown' && cell.reason).toContain('must not be read as unrestricted')
      // And it must not have claimed a reading anywhere in the cell it returned.
      expect(JSON.stringify(cell)).not.toContain('measured')
      expect(JSON.stringify(cell)).not.toContain('verified')
    }
  })

  it('the state itself is the named one, so no render has to derive it', () => {
    expect(resolveBidEligibility('000000001', IDX).state).toBe('abstained_suffix_code_not_in_table')
    // The two fields a reading would live in are both null, and the raw character still travels,
    // because we DO hold the character. What is absent is a reading of it.
    expect(resolveBidEligibility('000000001', IDX).amscEntry).toBeNull()
    expect(resolveBidEligibility('000000001', IDX).posture).toBeNull()
    expect(resolveBidEligibility('000000001', IDX).amsc).toBe('E')
  })

  it('THE NEGATIVE CONTROL: a listed code on an identical row still renders as measured', () => {
    // Without this, the fix above could be a blanket refusal and every assertion would still pass.
    const cell = acquisitionCodeCell(rowFor('000000003'))
    expect(cell.state).toBe('known')
    expect(cell.state === 'known' && cell.provenance).toBe('measured')
  })

  it('a publisher that publishes nothing still abstains with its own, different reason', () => {
    const cell = acquisitionCodeCell(rowFor('000000004'))
    expect(cell.state).toBe('unknown')
    expect(cell.state === 'unknown' && cell.reason).toContain('does not publish acquisition codes')
  })

  it('no eligibility on the row at all is an abstention too, and says which lookup did not run', () => {
    const cell = acquisitionCodeCell({} as CornerRowWithAward)
    expect(cell.state).toBe('unknown')
    expect(cell.state === 'unknown' && cell.reason).toContain('index is not loaded')
  })
})
