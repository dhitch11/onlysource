/**
 * THE POSITIVE CONTROL FOR BD-19. A GUARD NOBODY HAS SEEN FAIL IS NOT A GUARD.
 *
 * BD-19, verbatim: "No single blended 'recommended quote' number on the UI. Must show FOUR
 * separately visible numbers: anchor with its arithmetic inline, recent-flip band, evaluated
 * price, tripwire band, so the principal can audit each on a napkin. If David wants one headline
 * number, he must rule that explicitly."
 *
 * `assertFourSeparateFigures` is the runtime statement of that rule. A test that only calls it on
 * a correct view proves nothing: it would pass just as happily against a guard whose body was
 * deleted. So every collapse this file can imagine is CONSTRUCTED and fed to the guard, and each
 * one must throw. If someone removes a branch of the guard, the matching test here goes red.
 *
 * The six collapses below are the six shapes the mistake actually takes:
 *   1. fewer than four figures                        (three shown, one folded away)
 *   2. the four reordered                             (a page reads figures[0] and gets the wrong one)
 *   3. a headline key added to the payload            (the comp's "Recommended quote" row)
 *   4. the anchor reduced to one line                 (CPI and DoD merged)
 *   5. the anchor's two lines carrying the same index (labelled, but the same number twice)
 *   6. the mean of the two anchor lines leaking in    (an average dressed as a figure)
 */

import { describe, expect, it } from 'vitest'
import {
  assertFourSeparateFigures,
  buildQuoteView,
  type QuoteView,
} from '@/lib/intelligence/pricing'
import { DECLARED_OFFER, referenceInput } from './_fixtures'

const view = buildQuoteView(referenceInput({ ...DECLARED_OFFER }))

/** Reaches into the view as a page would, so the collapses below are shaped like real mistakes. */
function mutate(fn: (draft: Record<string, unknown>) => void): QuoteView {
  const draft = JSON.parse(JSON.stringify(view)) as Record<string, unknown>
  fn(draft)
  return draft as unknown as QuoteView
}

describe('the guard passes the view that ships', () => {
  it('does not throw on the real four-figure view', () => {
    expect(() => assertFourSeparateFigures(view)).not.toThrow()
  })

  it('and the view really does carry four resolved figures here, not four abstentions', () => {
    expect(view.figures.filter((f) => f.resolved).length).toBe(4)
  })
})

describe('the guard rejects every shape a collapse takes', () => {
  it('rejects three figures', () => {
    const collapsed = mutate((d) => {
      d.figures = (d.figures as unknown[]).slice(0, 3)
    })
    expect(() => assertFourSeparateFigures(collapsed)).toThrow(/exactly 4 figures, found 3/)
  })

  it('rejects the four in the wrong order', () => {
    const collapsed = mutate((d) => {
      const f = d.figures as unknown[]
      d.figures = [f[1], f[0], f[2], f[3]]
    })
    expect(() => assertFourSeparateFigures(collapsed)).toThrow(/Figure 0 must be ANCHOR/)
  })

  it('rejects a single recommended number added beside the figures', () => {
    const collapsed = mutate((d) => {
      // The comp's "Recommended quote" row, which BD-19 calls comp shorthand and not the spec.
      d.recommendedQuoteUsd = 2152.99
    })
    expect(() => assertFourSeparateFigures(collapsed)).toThrow(/recommendedQuoteUsd/)
  })

  it('rejects an anchor reduced to one line', () => {
    const collapsed = mutate((d) => {
      const anchor = (d.figures as Record<string, unknown>[])[0] as Record<string, unknown>
      anchor.lines = (anchor.lines as unknown[]).slice(0, 1)
    })
    expect(() => assertFourSeparateFigures(collapsed)).toThrow(/exactly two index lines, found 1/)
  })

  it('rejects two anchor lines that report the same index', () => {
    const collapsed = mutate((d) => {
      const anchor = (d.figures as Record<string, unknown>[])[0] as Record<string, unknown>
      const lines = anchor.lines as Record<string, unknown>[]
      ;(lines[1] as Record<string, unknown>).indexKind = 'cpi'
    })
    expect(() => assertFourSeparateFigures(collapsed)).toThrow(/Both anchor lines report the index/)
  })

  it('rejects a scalar anchor price on the figure', () => {
    const collapsed = mutate((d) => {
      const anchor = (d.figures as Record<string, unknown>[])[0] as Record<string, unknown>
      anchor.unitPriceUsd = 2152.99
    })
    expect(() => assertFourSeparateFigures(collapsed)).toThrow(/scalar unitPriceUsd/)
  })

  it('rejects the mean of the two anchor lines appearing anywhere in the payload', () => {
    // (2033.499055 + 2152.99) / 2 = 2093.2445275, worked by hand. This is what a blend looks like.
    const collapsed = mutate((d) => {
      d.gaps = [...(d.gaps as unknown[]), { leaked: 2093.2445275 }]
    })
    expect(() => assertFourSeparateFigures(collapsed)).toThrow(/mean of the two anchor lines/)
  })

  it('rejects the cent-rounded mean too, because a blend often arrives rounded', () => {
    const collapsed = mutate((d) => {
      d.gaps = [...(d.gaps as unknown[]), { leaked: 2093.24 }]
    })
    expect(() => assertFourSeparateFigures(collapsed)).toThrow(/mean of the two anchor lines/)
  })
})

/**
 * A synthetic index config, so a test can put the two factors wherever it needs them. Everything
 * on it is labelled as a probe: nothing here is a corpus figure and nothing asserts doctrine.
 */
function probeIndex(kind: 'cpi' | 'dod_procurement', factor: number, preferred: boolean) {
  return {
    kind,
    factor,
    vintage: {
      baseYear: 2017,
      statedAtSourceDate: '2026-08-18',
      publishedSeriesId: null,
      note: 'A synthetic factor, existing only to drive the blend guard.',
    },
    preferred,
    preferenceRationale: null,
    citation: {
      authority: 'Synthetic test configuration',
      quote: null,
      sourceFile: 'test/pricing-view/four-figures-control.test.ts',
      sourceLines: 'this test',
      grade: 'DERIVED' as const,
    },
  }
}

describe('the blend check does not cry wolf', () => {
  it('accepts a legitimate number whose digits merely contain the mean', () => {
    /*
     * 12093.24 CONTAINS the string "2093.24". An earlier draft of the guard searched the
     * serialised payload for those digits and would have thrown here, on a correct view. A guard
     * that fires on correct input gets switched off within a week, so it compares VALUES.
     */
    const fine = mutate((d) => {
      d.gaps = [...(d.gaps as unknown[]), { legitimate: 12093.24 }]
    })
    expect(() => assertFourSeparateFigures(fine)).not.toThrow()
  })

  /*
   * THE ORDINARY CASE THE GUARD USED TO TAKE DOWN.
   *
   * The mean of two EQUAL numbers is that number, so on a view whose two indices carry the same
   * factor the "blend" is each line's own price and the guard threw on a completely correct view.
   * This is not a freak coincidence at ten significant figures: two published series printing the
   * same reading for one year is ordinary, and moving these factors onto published series is
   * exactly what the anchor's own abstention asks a future lane to do. A guard that fires on
   * correct input is switched off within a week, and then it is not guarding anything.
   */
  it('does not fire when both indices carry the same factor', () => {
    const equal = buildQuoteView(
      referenceInput({
        ...DECLARED_OFFER,
        indices: {
          cpi: probeIndex('cpi', 1.25, false),
          dodProcurement: probeIndex('dod_procurement', 1.25, true),
        },
      }),
    )
    const anchor = equal.figures[0]
    if (anchor.resolved !== true) throw new Error('expected a resolved anchor')
    // The premise of the test, asserted rather than assumed: the two lines really are equal.
    // 1537.85 x 1.25 = 1922.3125, so both lines carry 1922.3125 and the "mean" is 1922.3125.
    expect(anchor.lines[0].exactUnitPriceUsd).toBe(anchor.lines[1].exactUnitPriceUsd)
    expect(anchor.lines[0].exactUnitPriceUsd).toBeCloseTo(1922.3125, 9)
    expect(() => assertFourSeparateFigures(equal)).not.toThrow()
  })

  it('does not fire when the two lines differ but round to the same cent', () => {
    /*
     * The same collision by a second route, which the equality check alone would not catch. The
     * exact products differ, so the lines are genuinely two figures, but the CENT-ROUNDED mean
     * equals both lines' cent-rounded prices, and a payload full of legitimate 2152.99s would
     * have tripped the search. 1537.85 x 1.40 = 2152.99 exactly; 1537.85 x 1.400001 = 2152.99
     * plus a fraction of a cent.
     */
    const nearlyEqual = buildQuoteView(
      referenceInput({
        ...DECLARED_OFFER,
        indices: {
          cpi: probeIndex('cpi', 1.400001, false),
          dodProcurement: probeIndex('dod_procurement', 1.4, true),
        },
      }),
    )
    const anchor = nearlyEqual.figures[0]
    if (anchor.resolved !== true) throw new Error('expected a resolved anchor')
    expect(anchor.lines[0].exactUnitPriceUsd).not.toBe(anchor.lines[1].exactUnitPriceUsd)
    expect(anchor.lines[0].unitPriceUsd).toBe(anchor.lines[1].unitPriceUsd)
    expect(() => assertFourSeparateFigures(nearlyEqual)).not.toThrow()
  })

  it('still catches a real blend when the two lines are far apart, so the skip is narrow', () => {
    /*
     * THE CONTROL FOR THE CONTROL. Without this, "does not cry wolf" could equally describe a
     * blend check that had been disabled outright. Two clearly different factors, and the mean
     * planted in the payload must still be caught. 1537.85 x 1.20 = 1845.42 and 1537.85 x 1.40 =
     * 2152.99, so their mean is 1999.205, which is neither line.
     */
    const apart = buildQuoteView(
      referenceInput({
        ...DECLARED_OFFER,
        indices: {
          cpi: probeIndex('cpi', 1.2, false),
          dodProcurement: probeIndex('dod_procurement', 1.4, true),
        },
      }),
    )
    expect(() => assertFourSeparateFigures(apart)).not.toThrow()
    const leaked = JSON.parse(JSON.stringify(apart)) as Record<string, unknown>
    leaked.gaps = [...(leaked.gaps as unknown[]), { leaked: 1999.205 }]
    expect(() => assertFourSeparateFigures(leaked as unknown as QuoteView)).toThrow(
      /mean of the two anchor lines/,
    )
  })
})

describe('the recorded $3,565 quote is carried without ever being produced', () => {
  it('records the figure with the derivation its own source states', () => {
    const [observation] = view.recordedObservations
    expect(view.recordedObservations).toHaveLength(1)
    expect(observation?.valueUsd).toBe(3565)
    expect(observation?.derivationStatedBySource).toBe(
      'three times the unit price of the previous award',
    )
    expect(observation?.evidenceState).toBe('PRIOR')

    /*
     * ★ THIS ASSERTION USED TO REQUIRE THE DEFECT. It demanded the citation contain
     * `09-corpus-supplement-gmail.md`, and `2e79519` removed exactly that — an exhibit was
     * citing its source by the developer's home directory and naming the customer's private
     * correspondence files. The test outlived the fix and was the last reference to the old
     * filename anywhere in the repo, so it failed on main while the product was RIGHT.
     *
     * It now asserts the property the fix exists to hold, rather than the string it replaced:
     * the citation still says where the figure came from, and it leaks neither a filesystem
     * path nor a private filename into anything a customer can see.
     */
    const cited = observation?.citation.sourceFile ?? ''
    expect(cited).toContain('corpus supplement')
    expect(cited).not.toMatch(/[/\\]/) // no path separators: not a file on anyone's disk
    expect(cited).not.toMatch(/\.(md|xlsx|docx|eml|pdf)\b/i) // no private filename
    expect(cited).not.toContain('Users')
  })

  it('measures that the anchor does not produce it, rather than asserting so', () => {
    const [observation] = view.recordedObservations
    expect(observation?.reproducedByAnchor).toBe(false)
    // 3565 / 1537.85 = 2.318171..., which is neither 1.3223 nor 1.40 nor their product 1.85122.
    expect(observation?.reproductionCheck).toContain('2.318171')
    expect(observation?.reproductionCheck).toContain('neither configured factor')
  })

  it('keeps 3565 off every computed figure', () => {
    const anchor = view.figures[0]
    if (anchor.resolved !== true) throw new Error('expected a resolved anchor')
    for (const line of anchor.lines) {
      expect(line.unitPriceUsd).not.toBe(3565)
      expect(line.exactUnitPriceUsd).not.toBe(3565)
    }
    expect(view.basis.kind).toBe('ANCHOR_PREFERRED_INDEX')
    if (view.basis.kind === 'ANCHOR_PREFERRED_INDEX') {
      expect(view.basis.unitPriceUsd).toBe(2152.99)
    }
  })

  it('attaches the observation to that stock number and to no other', () => {
    const elsewhere = buildQuoteView(referenceInput({ nsn: '5310-00-111-2222' }))
    expect(elsewhere.recordedObservations).toEqual([])
  })

  /**
   * THE CONTROL FOR THE CONTROL. `reproducedByAnchor: false` would read identically if the field
   * were hardcoded false, so this drives the same code with an anchor that DOES produce 3565 and
   * proves the flag flips. Without this, "the anchor does not produce it" is an unfalsifiable
   * claim rather than a measurement.
   */
  it('flips to true when an anchor genuinely produces the recorded figure', () => {
    const identity = {
      kind: 'cpi' as const,
      factor: 1,
      vintage: {
        baseYear: 2017,
        statedAtSourceDate: '2026-08-18',
        publishedSeriesId: null,
        note: 'A synthetic identity factor, existing only to prove this check reads the anchor.',
      },
      preferred: false,
      preferenceRationale: null,
      citation: {
        authority: 'Synthetic test configuration',
        quote: null,
        sourceFile: 'test/pricing-view/four-figures-control.test.ts',
        sourceLines: 'this test',
        grade: 'DERIVED' as const,
      },
    }
    const rigged = buildQuoteView(
      referenceInput({
        // A manufacturer award priced at 3565 and factors of exactly 1 make the anchor land on
        // the recorded figure. Nothing in the shipped configuration can do this.
        awards: referenceInput().awards.map((a) =>
          a.contractNo === 'FIXTURE-OEM-1'
            ? // Both price columns move together. Changing only the derived figure would leave the
              // row contradicting itself, the anchor would refuse it, and this control would go
              // green for the wrong reason: no anchor at all rather than an anchor that misses.
              {
                ...a,
                effectiveUnitPriceUsd: 3565,
                statedUnitPriceUsd: 3565,
                extendedPriceUsd: 3565 * 17,
              }
            : a,
        ),
        indices: {
          cpi: identity,
          dodProcurement: { ...identity, kind: 'dod_procurement' as const, preferred: true },
        },
      }),
    )
    const [observation] = rigged.recordedObservations
    expect(observation?.reproducedByAnchor).toBe(true)
    expect(observation?.reproductionCheck).toContain('anchor configuration changed')
  })
})
