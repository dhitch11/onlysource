/**
 * THE OTHER TWO FIGURES: the resale band and the tripwire, each with its arithmetic worked by
 * hand before the code ran.
 *
 * THE TRIPWIRE, LONGHAND, at the fixture's pricing instant of 2026-01-29:
 *
 *   basis unit price          $2,152.99   the preferred (DoD) anchor line
 *   most recent prior award   $1,450.00   dated 2025-06-02, inside the trailing twelve months
 *   increase                  (215299 - 145000) / 145000 = 70299 / 145000 = 0.4848206896551724
 *                             = 48.48206896551724%, which renders as 48.5%
 *   multiple                  215299 / 145000 = 1.4848206896551725, which renders as 1.48x
 *   procurement value         2152.99 x 8 = $17,223.92
 *   micro-purchase threshold  $15,000 in force at 2026-01-29
 *   17,223.92 >= 15,000       so the band is the AT-OR-ABOVE one, 25%
 *   0.48482 >= 0.25           CROSSED
 *
 * WHAT CROSSING MEANS, and the reason the return type is not a boolean called `blocked`: it does
 * not cap the price and does not make the award illegal. It forces an email to the Head of the
 * Contracting Activity and retention of that message in the contract file, which turns a clean
 * automated award into one carrying senior attention, delay and paperwork. A 400x quote that is
 * entirely lawful would be suppressed by our own screen if this were rendered as "blocked".
 */

import { describe, expect, it } from 'vitest'
import { buildQuoteView, weakestEvidenceState } from '@/lib/intelligence/pricing'
import { DECLARED_OFFER, referenceInput } from './_fixtures'

const view = buildQuoteView(referenceInput({ ...DECLARED_OFFER }))

describe('the tripwire figure', () => {
  const tripwire = view.figures[3]

  it('measures the increase over the most recent prior award, to the hand-computed figure', () => {
    expect(tripwire.resolved).toBe(true)
    if (tripwire.resolved !== true) return
    expect(tripwire.impliedIncreasePercent).toBeCloseTo(48.48206896551724, 10)
    expect(tripwire.impliedMultipleOfPrior).toBeCloseTo(1.4848206896551725, 10)
  })

  it('picks the band from the threshold in force at the pricing instant, not today', () => {
    if (tripwire.resolved !== true) throw new Error('expected a resolved tripwire')
    expect(tripwire.band).toBe('AT_OR_ABOVE_MPT_25_PERCENT')
    expect(tripwire.bandThresholdPercent).toBe(25)
    expect(tripwire.microPurchaseThresholdUsd).toBe(15000)
    expect(tripwire.crossed).toBe(true)
  })

  it('reports the consequence as a pathway, never as a block', () => {
    if (tripwire.resolved !== true) throw new Error('expected a resolved tripwire')
    expect(tripwire.consequence.awardPathway).toBe('REQUIRES_SENIOR_NOTIFICATION')
    expect(tripwire.consequence.capsPrice).toBe(false)
    expect(tripwire.consequence.makesAwardIllegal).toBe(false)
    expect(tripwire.consequence.requiredAction).toContain('notify the HCA by email')
    expect(tripwire.limitation).toContain('does NOT cap the price')
  })

  it('renders the whole chain as one line a person can check', () => {
    if (tripwire.resolved !== true) throw new Error('expected a resolved tripwire')
    expect(tripwire.arithmetic).toBe(
      '(2152.99 - 1450.00) / 1450.00 = 48.5% increase, 1.48x the prior award of 2025-06-02; ' +
        'band is 25% because the procurement at 17223.92 is at or above the micro-purchase ' +
        'threshold of 15000.00; CROSSED',
    )
  })

  it('warns that the pricing instant is past the primary text we have read', () => {
    if (tripwire.resolved !== true) throw new Error('expected a resolved tripwire')
    // FAR 2.101's primary text is read through 2025-10-01 and DLAD Rev 5 through 2026-01-12.
    // Pricing at 2026-01-29 is past both, so the figure says so rather than looking current.
    expect(tripwire.limitation).toContain('re-verify the controlling threshold')
  })

  it('cites the regulation for both the threshold and the band', () => {
    if (tripwire.resolved !== true) throw new Error('expected a resolved tripwire')
    expect(tripwire.bandCitation.authority).toContain('DLAD 17.7505')
    expect(tripwire.bandCitation.grade).toBe('PRIMARY_TEXT')
    const thresholdInput = tripwire.inputs.find((i) => i.label.includes('Micro-purchase'))
    expect(thresholdInput?.citation?.authority).toContain('FAR 2.101')
  })

  it('grades the figure by its weakest input, which is the anchor-derived basis', () => {
    if (tripwire.resolved !== true) throw new Error('expected a resolved tripwire')
    expect(view.basis.kind).toBe('ANCHOR_PREFERRED_INDEX')
    expect(tripwire.evidenceState).toBe('ESTIMATED')
  })

  it('grades it PRIOR instead when the operator types the price themselves', () => {
    const typed = buildQuoteView(
      referenceInput({ ...DECLARED_OFFER, proposedUnitPriceUsd: 3000 }),
    )
    expect(typed.basis.kind).toBe('OPERATOR_PROPOSED')
    const figure = typed.figures[3]
    if (figure.resolved !== true) throw new Error('expected a resolved tripwire')
    // A number a human typed is nobody's measurement. Grading it MEASURED because the $200
    // factor beside it came from the Master Solicitation would launder their guess.
    expect(figure.evidenceState).toBe('PRIOR')
  })
})

describe('the resale band', () => {
  const band = view.figures[1]

  it('reads low and high from the awards inside the stated window', () => {
    expect(band.resolved).toBe(true)
    if (band.resolved !== true) return
    expect(band.lowUnitPriceUsd).toBe(812)
    expect(band.highUnitPriceUsd).toBe(1450)
    expect(band.sampleCount).toBe(2)
    expect(band.evidenceState).toBe('MEASURED')
  })

  it('states the window it used and that the window is ours, not a regulation', () => {
    if (band.resolved !== true) throw new Error('expected a resolved band')
    expect(band.windowMonths).toBe(36)
    // 36 months before 2026-01-29.
    expect(band.windowStartIso).toBe('2023-01-29')
    expect(band.windowEndIso).toBe('2026-01-29')
    const windowInput = band.inputs.find((i) => i.label === 'Window length')
    expect(windowInput?.evidenceState).toBe('PRIOR')
    expect(windowInput?.source).toContain('not a regulation')
  })

  it('says why each award counted as secondary, by two separate routes', () => {
    if (band.resolved !== true) throw new Error('expected a resolved band')
    expect(band.observations.map((o) => o.whyCountedAsSecondary)).toEqual([
      'AWARDEE_NOT_ON_THE_APPROVED_SOURCE_LIST',
      'FLAGGED_SURPLUS_BY_THE_EXPORT',
    ])
  })

  it('renders the band with both endpoints attributed', () => {
    if (band.resolved !== true) throw new Error('expected a resolved band')
    expect(band.arithmetic).toBe(
      'low 812.00 (2024-03-11, RESALE ONE (FIXTURE)) to high 1450.00 (2025-06-02, ' +
        'RESALE TWO (FIXTURE)) across 2 resale award(s) in the 36 months to 2026-01-29',
    )
  })

  it('abstains rather than stretching the window when nothing recent exists', () => {
    // The same rows, priced two years later, so both resale awards fall outside 36 months.
    const later = buildQuoteView(
      referenceInput({ ...DECLARED_OFFER, atInstantMs: Date.UTC(2029, 0, 29) }),
    )
    const figure = later.figures[1]
    expect(figure.resolved).toBe(false)
    if (figure.resolved !== false) return
    expect(figure.reason).toBe('NO_SECONDARY_AWARD_IN_THE_WINDOW')
    expect(figure.sentence).toContain('2 resale award(s) sit outside it')
    expect(figure.sentence).toContain('earliest dated 2024-03-11')
  })

  it('reports "the manufacturer took every buy" as its own finding, not as a window problem', () => {
    // Only the manufacturer award survives, so there is no secondary market at all. That is the
    // shape of a corner, and calling it "nothing recent enough" would bury it.
    const noResale = buildQuoteView(
      referenceInput({
        ...DECLARED_OFFER,
        awards: referenceInput().awards.filter((a) => a.contractNo === 'FIXTURE-OEM-1'),
      }),
    )
    const figure = noResale.figures[1]
    expect(figure.resolved).toBe(false)
    if (figure.resolved !== false) return
    expect(figure.reason).toBe('NO_SECONDARY_AWARD_ON_FILE')
    /*
     * The claim is scoped to PRICED buys, because a priced buy is the only kind this arm looked
     * at. On THIS input the scope costs nothing, and the sentence says so out loud: every award
     * on file carries a price, so "every priced buy" and "every buy" are the same set here. The
     * arm that reads differently when they are not the same set is covered in
     * `band-corner-claim.test.ts`.
     */
    expect(figure.sentence).toContain('has taken every priced buy on file')
    expect(figure.sentence).toContain(
      'every award on file carries a price, so that covers every recorded buy',
    )
  })

  it('is never the anchor, however wide the gap between them', () => {
    if (band.resolved !== true) throw new Error('expected a resolved band')
    const anchor = view.figures[0]
    if (anchor.resolved !== true) throw new Error('expected a resolved anchor')
    // The gap is the point: the band tops out at 1450 while the anchor sits at 2152.99, and the
    // difference is the margin. Nothing in the view lets the band become the price.
    expect(band.highUnitPriceUsd).toBeLessThan(anchor.lines[1].unitPriceUsd)
    expect(view.basis.kind).toBe('ANCHOR_PREFERRED_INDEX')
    if (view.basis.kind === 'ANCHOR_PREFERRED_INDEX') {
      expect(view.basis.unitPriceUsd).not.toBe(band.highUnitPriceUsd)
      expect(view.basis.indexKind).toBe('dod_procurement')
    }
  })
})

describe('weakestEvidenceState is a minimum and never an average', () => {
  it('returns the weaker of two states', () => {
    expect(weakestEvidenceState('MEASURED', 'ESTIMATED')).toBe('ESTIMATED')
    expect(weakestEvidenceState('MEASURED', 'PRIOR')).toBe('PRIOR')
    expect(weakestEvidenceState('ESTIMATED', 'UNREAD')).toBe('UNREAD')
    expect(weakestEvidenceState('MEASURED')).toBe('MEASURED')
  })

  it('never invents a middle grade between two inputs', () => {
    // Averaging MEASURED and PRIOR to "ESTIMATED" would be a grade nobody can cite, which is the
    // same error as blending two inflation indices into one price.
    expect(weakestEvidenceState('MEASURED', 'PRIOR')).not.toBe('ESTIMATED')
  })
})
