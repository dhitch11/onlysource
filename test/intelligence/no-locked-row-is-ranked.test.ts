import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildPortfolioDossier, type EnrichedCorner, type Portfolio } from '@/lib/intelligence/portfolio'

/**
 * ★ DAVID'S PRIORITY #2, ASSERTED AT THE ONE PLACE IT WAS NOT ENFORCED. 2026-08-29.
 *
 * "NEVER RANK A SOLE-SOURCE / PROPRIETARY-TO-ANOTHER-GROUP CONTRACT HIGH. It is not an opportunity
 * for him." The rank key already sinks a locked row by LOCK_PENALTY, but `portfolio.topCorners`
 * was the ONE consumer with no SKIP filter while every other one had had it all along. `candidates`
 * is sole-source-and-silent, a set an AMC 4/5 lockup enters freely, so a locked row took a top-10
 * seat the moment fewer than ten candidates were open.
 *
 * It was not reachable when it was found - the live archive yields zero candidates, so the list is
 * empty - and that is precisely why it needed a test rather than a look. The dangerous version is
 * not the table. It is `buildPortfolioDossier`, where the list stops being data and becomes an LLM
 * prompt labelled "topPlays": a model handed a closed door under that label writes it up as an
 * opportunity in confident prose. That is not a bad ranking, it is a recommendation to bid on a
 * contract that belongs to somebody else.
 */

const corner = (over: Partial<EnrichedCorner> = {}): EnrichedCorner => ({
  nsn: '5325015619853',
  item: 'RING,RETAINING',
  cage: '58794',
  score: 0,
  rankKey: -940,
  grade: 'C',
  disposition: 'SKIP',
  onForecast: false,
  forecastQty: 0,
  machineAward: false,
  lastPrice: null,
  firstPrice: null,
  escalationPct: null,
  awardCount: 0,
  priceSeries: [],
  supplyChains: [],
  endItems: [],
  ...over,
})

const portfolioWith = (topCorners: EnrichedCorner[]): Portfolio =>
  ({
    ok: true,
    feedDay: '2026-08-11',
    coverage: { daysIncluded: 1, statement: 'one archived day', basis: 'archive', firstDay: '2026-08-11', dayCount: 1 },
    totals: {},
    bySupplyChain: [],
    byDisposition: [],
    byAwardPath: [],
    escalationLeaders: [],
    topCorners,
  }) as unknown as Portfolio

describe('a locked row is never presented as an opportunity', () => {
  it('BEHAVIOURAL: a SKIP row placed in topCorners does NOT reach the AI brief as a top play', () => {
    const open = corner({ nsn: '1650013552818', disposition: 'WATCHLIST', rankKey: 60, score: 60 })
    const locked = corner({ nsn: '5325015619853', disposition: 'SKIP' })
    const dossier = buildPortfolioDossier(portfolioWith([locked, open]))
    const nsns = dossier.topPlays.map((p) => p.nsn)
    expect(nsns).toContain('1650013552818')
    expect(nsns).not.toContain('5325015619853')
    expect(dossier.topPlays.every((p) => p.disposition !== 'SKIP')).toBe(true)
  })

  it('BEHAVIOURAL: a brief built from ONLY locked rows is empty, never a padded list', () => {
    // The failure this guards is padding: filling a "top plays" slot because the slot exists.
    // An empty list is an honest answer. A closed door dressed as a play is not.
    const dossier = buildPortfolioDossier(portfolioWith([corner(), corner({ nsn: '5340015003071' })]))
    expect(dossier.topPlays).toEqual([])
  })

  it('SOURCE: buildPortfolio filters SKIP out of topCorners at the source, not only at the brief', () => {
    // buildPortfolio() reads the archive and takes no injectable input, and the live archive
    // currently yields zero candidates - so a behavioural assertion here would pass vacuously and
    // prove nothing. This checks the filter is present and says plainly that is what it is.
    const src = readFileSync(resolve(process.cwd(), 'lib/intelligence/portfolio.ts'), 'utf8')
    const block = src.slice(src.indexOf('const topCorners'), src.indexOf('const portfolio: Portfolio'))
    expect(block).toContain("disposition !== 'SKIP'")
  })

  it('SOURCE: every other consumer of a scored row still filters SKIP too', () => {
    const files = {
      'app/(app)/monopoly/wire-bound.ts': "disposition !== 'SKIP'",
      'app/(app)/page.tsx': 'disposition === "SKIP"',
      'app/(app)/monopoly/MonopolyGrid.tsx': 'disposition === "SKIP"',
    }
    for (const [f, needle] of Object.entries(files)) {
      expect(readFileSync(resolve(process.cwd(), f), 'utf8'), f).toContain(needle)
    }
  })
})
