/**
 * THE ABSTENTION IS THE SAME. THE SENTENCE MUST NOT BE.
 *
 * With no award rows the engine abstains either way, and that is correct. What is not correct is
 * telling the operator "No award history is on file for this stock number" when the truth is that
 * we asked and the export report stopped at its row ceiling before reaching it. The first is a
 * statement about the market; the second is a statement about our own acquisition, and only one
 * of them is true for the 669 stock numbers measured on the real export.
 */

import { describe, expect, it } from 'vitest'

import { buildQuoteView, identifyOemAward, type QuoteViewInput } from '../../lib/intelligence/pricing/quote-view'

const base: QuoteViewInput = {
  nsn: '5915014487675',
  awards: [],
  approvedSourceCages: ['12345'],
  solicitationQuantity: 10,
  solicitation: null,
  automatedSolicitation: null,
  atInstantMs: Date.UTC(2026, 7, 19),
  feedWindow: { firstAwardIso: '2016-01-03', lastAwardIso: '2026-01-29' },
}

describe('an unanswered request never reads as an empty market', () => {
  it('★ never_answered says we did not get an answer, and does NOT claim nothing is on file', () => {
    const r = identifyOemAward({ ...base, awardHistoryState: 'never_answered' })
    expect(r.identified).toBe(false)
    if (r.identified) throw new Error('unreachable')
    expect(r.reason).toBe('AWARD_HISTORY_NEVER_ANSWERED')
    expect(r.sentence).toMatch(/never received it|stopped at its row ceiling/)
    expect(r.sentence).not.toContain('No award history is on file')
    expect(r.sentence).toMatch(/re-request/i)
  })

  it('★ none KEEPS the original wording, because that claim is true and useful', () => {
    const r = identifyOemAward({ ...base, awardHistoryState: 'none' })
    if (r.identified) throw new Error('unreachable')
    expect(r.reason).toBe('NO_AWARD_HISTORY')
    expect(r.sentence).toContain('No award history is on file')
  })

  it('★★ AN UNSET FIELD IS NOT "none" — an untaught caller must not assert the market is empty', () => {
    // The whole design turns on this. If absence defaulted to `none`, every call site not yet
    // updated would keep making the claim and the fix would be invisible.
    const untaught = identifyOemAward(base)
    const taught = identifyOemAward({ ...base, awardHistoryState: 'never_answered' })
    if (untaught.identified || taught.identified) throw new Error('unreachable')
    expect(untaught.reason).toBe('NO_AWARD_HISTORY')
    expect(taught.reason).not.toBe(untaught.reason)
  })

  it('the resale band abstains with the honest reason too, not just the OEM leg', () => {
    const view = buildQuoteView({ ...base, awardHistoryState: 'never_answered' })
    const flip = view.figures.find((f) => f.figureId === 'RECENT_FLIP_BAND')
    expect(flip).toBeDefined()
    expect(flip!.resolved).toBe(false)
    if (flip!.resolved) throw new Error('unreachable')
    expect(flip!.reason).toBe('AWARD_HISTORY_NEVER_ANSWERED')
    expect(flip!.sentence).toContain('Unknown, not empty')
  })

  it('NEGATIVE CONTROL: with real award rows the state is irrelevant and nothing abstains on it', () => {
    const r = identifyOemAward({
      ...base,
      awardHistoryState: 'never_answered', // deliberately contradictory
      awards: [
        {
          awardDateIso: '2024-03-01',
          /*
           * The three price columns, kept INTERNALLY CONSISTENT rather than filled with a single
           * number. `effectiveUnitPriceUsd` is a DERIVATION — Final Price over quantity — and the
           * module checks it against the two columns it came from (`checkPriceColumns`). A fixture
           * where 100 x 5 does not equal the extended total would be testing this negative control
           * against a row the product would flag as inconsistent, which is a different test than
           * the one this file means to run.
           */
          effectiveUnitPriceUsd: 100,
          statedUnitPriceUsd: 100,
          extendedPriceUsd: 500,
          quantity: 5,
          awardeeCage: '12345',
          awardeeCompany: 'ACME',
          surplusAsWorded: null,
          contractNo: 'SPE4A6-24-V-0001',
        },
      ],
    })
    if (!r.identified) expect(r.reason).not.toBe('AWARD_HISTORY_NEVER_ANSWERED')
  })
})
