import { describe, it, expect } from 'vitest'
import {
  classifyActionability,
  countActionability,
  hideDeadByDefault,
  SAFE_HIDE_CEILING,
  type ActionabilityInput,
} from '@/lib/intelligence/actionability'

/**
 * ACTIONABILITY.
 *
 * The assertion that matters most here is the one about the UNLOADED INDEX. Every other rule in
 * this module is a small readable condition; that one is the difference between a filter that
 * tidies a board and a filter that hides the entire product behind a toggle, silently, while
 * looking like it works.
 */

const LOADED = { awards: true }
const NOT_LOADED = { awards: false }

const ready: ActionabilityInput = { valueUsd: 90_000, quantity: 300, latestPrice: 300 }

describe('the unloaded index is not evidence of anything', () => {
  it('rules EVERY row unknown when the award index was never loaded, however complete the row looks', () => {
    // This is the total-failure guard. Without it a board with no award index marks all of its
    // rows dead and hides them, which looks exactly like a working filter.
    expect(classifyActionability(ready, NOT_LOADED).verdict).toBe('unknown')
    expect(classifyActionability(ready, NOT_LOADED).reason).toBe('award_index_not_loaded')
  })

  it('still rules unknown, never unactionable, for a row that is ALSO missing everything', () => {
    const empty: ActionabilityInput = { valueUsd: null, quantity: null, latestPrice: null }
    // Two absences that would each be damning if checked, but neither was checked.
    expect(classifyActionability(empty, NOT_LOADED).verdict).toBe('unknown')
  })

  it('flips to a real verdict for the same row once the index IS loaded', () => {
    const empty: ActionabilityInput = { valueUsd: null, quantity: null, latestPrice: null }
    expect(classifyActionability(empty, NOT_LOADED).verdict).toBe('unknown')
    expect(classifyActionability(empty, LOADED).verdict).toBe('unactionable')
  })
})

describe('positive evidence of dead, with the reason named', () => {
  it('names no_price_or_quantity when neither is on file', () => {
    const r = classifyActionability({ valueUsd: null, quantity: null, latestPrice: null }, LOADED)
    expect(r.verdict).toBe('unactionable')
    expect(r.reason).toBe('no_price_or_quantity')
  })

  it('names no_price_anchor when the quantity is there but no award price is', () => {
    const r = classifyActionability({ valueUsd: null, quantity: 300, latestPrice: null }, LOADED)
    expect(r.verdict).toBe('unactionable')
    expect(r.reason).toBe('no_price_anchor')
  })

  it('names no_quantity when the price is there but the requirement carries none', () => {
    const r = classifyActionability({ valueUsd: null, quantity: null, latestPrice: 300 }, LOADED)
    expect(r.verdict).toBe('unactionable')
    expect(r.reason).toBe('no_quantity')
  })

  it('treats a zero or negative price as no anchor, not as a price of zero', () => {
    expect(classifyActionability({ valueUsd: null, quantity: 300, latestPrice: 0 }, LOADED).reason).toBe(
      'no_price_anchor',
    )
    expect(classifyActionability({ valueUsd: null, quantity: 300, latestPrice: -5 }, LOADED).reason).toBe(
      'no_price_anchor',
    )
  })

  it('treats a zero quantity as no quantity', () => {
    expect(classifyActionability({ valueUsd: null, quantity: 0, latestPrice: 300 }, LOADED).reason).toBe(
      'no_quantity',
    )
  })

  it('refuses a NaN price or quantity rather than letting it through as a number', () => {
    expect(classifyActionability({ valueUsd: 1, quantity: 300, latestPrice: NaN }, LOADED).verdict).toBe(
      'unactionable',
    )
    expect(classifyActionability({ valueUsd: 1, quantity: NaN, latestPrice: 300 }, LOADED).verdict).toBe(
      'unactionable',
    )
  })
})

describe('nothing is quietly promoted', () => {
  it('rules a fully-priceable row actionable', () => {
    const r = classifyActionability(ready, LOADED)
    expect(r.verdict).toBe('actionable')
    expect(r.reason).toBe('ready')
  })

  it('refuses to call a row actionable when its inputs are present but no value was modeled', () => {
    // Price and quantity are both there, so it is not dead — but the scorer produced no size, and
    // a state we cannot explain is shown and labelled, never promoted.
    const r = classifyActionability({ valueUsd: null, quantity: 300, latestPrice: 300 }, LOADED)
    expect(r.verdict).toBe('unknown')
  })

  it('is a large modeled value, and is still not special-cased', () => {
    // No hidden ceiling and no hidden floor: actionability is about DATA, never about size.
    expect(classifyActionability({ valueUsd: 50_000_000, quantity: 1, latestPrice: 50_000_000 }, LOADED).verdict).toBe(
      'actionable',
    )
    expect(classifyActionability({ valueUsd: 12, quantity: 1, latestPrice: 12 }, LOADED).verdict).toBe('actionable')
  })
})

describe('the count that makes the toggle honest', () => {
  it('counts each verdict and loses none', () => {
    const c = countActionability([
      'actionable',
      'actionable',
      'unactionable',
      'unknown',
      'unknown',
      'unknown',
    ])
    expect(c).toEqual({ actionable: 2, unactionable: 1, unknown: 3 })
    expect(c.actionable + c.unactionable + c.unknown).toBe(6)
  })

  it('counts an empty board as three zeroes rather than throwing', () => {
    expect(countActionability([])).toEqual({ actionable: 0, unactionable: 0, unknown: 0 })
  })
})

describe('the interlock that stops a correct filter from emptying the console', () => {
  it('hides by default while dead rows are a minority', () => {
    const d = hideDeadByDefault({ actionable: 80, unactionable: 20, unknown: 0 })
    expect(d.hideByDefault).toBe(true)
    expect(d.plain).toBeNull()
  })

  it('REFUSES to hide when dead rows dominate, and says why', () => {
    // The real 2026-08-29 board: 1 actionable, 14 unactionable. Hiding would leave one row.
    const d = hideDeadByDefault({ actionable: 1, unactionable: 14, unknown: 0 })
    expect(d.hideByDefault).toBe(false)
    expect(d.share).toBeCloseTo(14 / 15, 5)
    expect(d.plain).toContain('14 of 15')
    // The sentence must blame the FEED, not the opportunities.
    expect(d.plain).toMatch(/gap in the feed/i)
  })

  it('measures the share against the whole board, unknown included', () => {
    // 10 dead out of 100 is a minority even though it is 100% of what could be CLASSIFIED dead.
    const d = hideDeadByDefault({ actionable: 0, unactionable: 10, unknown: 90 })
    expect(d.share).toBeCloseTo(0.1, 5)
    expect(d.hideByDefault).toBe(true)
  })

  it('holds exactly at the ceiling and flips just past it', () => {
    expect(hideDeadByDefault({ actionable: 60, unactionable: 40, unknown: 0 }).hideByDefault).toBe(true)
    expect(hideDeadByDefault({ actionable: 59, unactionable: 41, unknown: 0 }).hideByDefault).toBe(false)
    expect(SAFE_HIDE_CEILING).toBe(0.4)
  })

  it('does not divide by zero on an empty board', () => {
    const d = hideDeadByDefault({ actionable: 0, unactionable: 0, unknown: 0 })
    expect(d.hideByDefault).toBe(false)
    expect(d.share).toBe(0)
  })
})
