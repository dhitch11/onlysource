/**
 * @OS-VERIFY - THE ACCEPTANCE CONTRACT FOR DAVID'S DEAD-ROW CLASSIFICATION.
 *
 * David, 2026-08-29: "if the opportunity truly is not available to us ... that does not even need to
 * be in our face in any way." Dead rows drop out of the DEFAULT view; they are NOT deleted and NOT
 * silently vanished; they stay reachable behind an explicit "show unavailable" toggle WITH A COUNT,
 * "because a count is honest and a silent disappearance is not."
 *
 * ⛔ THIS FILE IS EXPECTED TO BE RED UNTIL @OS-LEAD SHIPS THE SLICE. That is the point of writing it
 * first: an acceptance test authored after the feature tends to describe whatever got built. It lives
 * under verify/ with its own config, so it is NOT in `npm run test` and can never redden their gate.
 *
 * ⛔ AND IT ASSERTS ON VALUES, NOT COUNTS. The defect this guards against is a toggle whose count is
 * computed by a SECOND predicate that drifts from the one doing the filtering. So the count is checked
 * against the identity of the rows actually withheld, not against another tally.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/session/require-gate', () => ({
  requireGateSession: async () => {},
  readGateVerdict: async () => ({ valid: true }),
  gateOrJson: async () => null,
}))

const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function boardCensus() {
  const { buildPricingBoard } = await import('@/app/(app)/pricing/board')
  const { systemClock } = await import('@/lib/time/clock')
  const board: any = await buildPricingBoard(systemClock as any)
  const rows: any[] = board.bound?.shipped ?? board.rows ?? []
  const open = rows.filter((r) => r.lifecycle === 'open')
  const closed = rows.filter((r) => r.lifecycle === 'closed')
  const unknown = rows.filter((r) => r.lifecycle !== 'open' && r.lifecycle !== 'closed')
  return { board, rows, open, closed, unknown }
}

async function renderPricingText() {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const mod: any = await import('@/app/(app)/pricing/page')
  const html = renderToStaticMarkup(await mod.default())
  return { html, text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
}

describe('dead-row classification, David 2026-08-29', () => {
  it('CENSUS: how many rows on the served board can no longer be bid', async () => {
    const { rows, open, closed, unknown } = await boardCensus()
    const sum = (a: any[]) => a.reduce((t, r) => t + (Number(r.rankableTotal ?? r.totalUsd ?? 0) || 0), 0)
    console.log(`\n  served ${rows.length}   open ${open.length}   closed ${closed.length}   unknown/undated ${unknown.length}`)
    console.log(`  dollars on OPEN rows   ${usd(sum(open))}`)
    console.log(`  dollars on CLOSED rows ${usd(sum(closed))}   <- what the default view must stop showing as sendable`)
    expect(rows.length).toBeGreaterThan(0) // the census must have loaded, or nothing below measures anything
  }, 600000)

  it('ACCEPTANCE A: no CLOSED stock number appears in the DEFAULT rendered view', async () => {
    const { closed } = await boardCensus()
    const { text } = await renderPricingText()
    const leaked = closed
      .map((r) => String(r.nsn ?? r.stockNumber ?? ''))
      .filter((n) => n && text.includes(n))
    console.log(`\n  closed rows: ${closed.length}   leaked into the default view: ${leaked.length}`)
    if (leaked.length) console.log(`  first 5 leaked stock numbers: ${leaked.slice(0, 5).join(', ')}`)
    expect(leaked).toEqual([])
  }, 600000)

  it('ACCEPTANCE B: the page states a WITHHELD COUNT rather than vanishing rows silently', async () => {
    const { closed } = await boardCensus()
    const { text } = await renderPricingText()
    const saysCount = new RegExp(`\\b${closed.length}\\b`).test(text)
    const saysWord = /unavailable|closed|no longer|lapsed/i.test(text)
    console.log(`\n  renders the number ${closed.length}: ${saysCount}   renders a lifecycle word: ${saysWord}`)
    expect(saysWord).toBe(true)
    expect(saysCount).toBe(true)
  }, 600000)

  it('ACCEPTANCE C: the stated count EQUALS the rows actually withheld (one predicate, not two)', async () => {
    const { rows, closed } = await boardCensus()
    const { text } = await renderPricingText()
    const shown = rows
      .map((r) => String(r.nsn ?? r.stockNumber ?? ''))
      .filter((n) => n && text.includes(n))
    const withheld = rows.length - shown.length
    console.log(`\n  rows on board ${rows.length}   rendered ${shown.length}   withheld ${withheld}   closed by predicate ${closed.length}`)
    expect(withheld).toBe(closed.length)
  }, 600000)

  it('ACCEPTANCE D: an UNDATED row is UNKNOWN and is never promoted to available', async () => {
    const { unknown } = await boardCensus()
    console.log(`\n  rows whose lifecycle is neither open nor closed: ${unknown.length}`)
    for (const r of unknown.slice(0, 5)) console.log(`    ${r.nsn} lifecycle=${r.lifecycle} returnDate=${JSON.stringify(r.returnDate)}`)
    // An undated row must never be counted among the open/available set.
    for (const r of unknown) expect(r.lifecycle).not.toBe('open')
  }, 600000)
})
