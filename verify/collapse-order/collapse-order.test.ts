/**
 * @OS-VERIFY - THE COLLAPSE TIEBREAK. Does the row an operator SEES depend on file parse order?
 *
 * @OS-LEAD closed the SORT hole with rankCompare (rankKey desc, then stock number asc). This asks
 * the question one layer upstream: collapseByNsn picks WHICH row represents a stock number using
 * `r.score.rankKey > prev.score.rankKey`, a STRICT greater-than, so a tie keeps whichever row the
 * parser yielded first. The flat value band makes ties routine by design. Measured, not asserted.
 */
import { describe, it } from 'vitest'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { resolveFeedDayInputs } from '@/lib/intelligence/feed-day'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { loadCageFamilyIndex } from '@/lib/intelligence/scoring/cage-family-load'
import { buildAwardeeClassifierFromLive } from '@/lib/intelligence/suppliers/classify/live'
import { scoreCorner, rankCompare } from '@/lib/intelligence/scoring/cornerscore'
import { sizeOfBuy } from '@/lib/intelligence/opportunities/size-of-buy'

const DAY = process.env.VERIFY_DAY ?? '2026-08-11'
const usd = (n: number | null) => (n == null ? 'NULL' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }))

type Row = {
  nsn: string
  key: string
  rankKey: number
  money: number | null
  qty: number | null
  sol: string
  hidden: boolean
  raw: any
}

/** The real collapse, reimplemented byte-for-byte from monopoly-view.ts:345 so I can run it on any order. */
function collapseByNsnLocal(rows: Row[]): Row[] {
  const best = new Map<string, Row>()
  const order: string[] = []
  for (const r of rows) {
    const key = r.key
    const prev = best.get(key)
    if (!prev) {
      best.set(key, r)
      order.push(key)
    } else if (r.rankKey > prev.rankKey) {
      best.set(key, r)
    }
  }
  return order.map((k) => best.get(k)!)
}

describe('collapseByNsn tiebreak', () => {
  it('measures whether the displayed representative is a function of parse order', () => {
    const res = resolveFeedDayInputs(DAY)
    if (!res.ok) {
      console.log(`UNRESOLVABLE FEED DAY ${DAY} - measuring nothing rather than guessing.`)
      return
    }
    const ds = buildAllDatasets(res.served)
    const map = ds.cornerMap
    const aIx = buildNsnAwardIndex()
    const fIx = buildForecastIndex()
    const cIx = loadCageFamilyIndex()
    const lv = buildAwardeeClassifierFromLive()

    const rows: Row[] = map.rows.map((r: any) => {
      const d = r.nsn.replace(/[^0-9]/g, '')
      const aw = aIx.ok ? aIx.byNsn.get(d) ?? null : null
      let money: number | null = null
      if (aw && !aw.priceScaleSuspect && aw.latest?.effectiveUnitPrice != null) {
        const b = sizeOfBuy(aw.latest.effectiveUnitPrice, r.quantity)
        if (b.known) money = b.usd
      }
      const la = lv.ok && aw?.latest?.cage ? lv.classifier.classify(aw.latest.cage) : null
      const s: any = scoreCorner(
        r,
        aw,
        fIx.ok ? fIx.byNsn.get(d) ?? null : null,
        { awardIndexLoaded: aIx.ok, forecastIndexLoaded: fIx.ok, cageFamily: cIx.ok ? cIx.index : null },
        la,
      )
      return {
        nsn: r.nsn,
        key: d || r.nsn,
        rankKey: s.rankKey ?? s.scoreV0,
        money,
        qty: r.quantity ?? null,
        sol: r.solicitation ?? r.solicitationNumber ?? r.sol ?? '',
        hidden: !!s.lockup?.hidden,
        raw: r,
      }
    })

    console.log(`\nBOARD ${DAY}: ${rows.length} pre-collapse rows`)

    // ---- 1. HOW MANY STOCK NUMBERS HAVE A TIE AT THE TOP, AND DO THE TIED ROWS DIFFER? ----
    const groups = new Map<string, Row[]>()
    for (const r of rows) {
      const g = groups.get(r.key)
      if (g) g.push(r)
      else groups.set(r.key, [r])
    }
    let multi = 0
    let tiedAtMax = 0
    let tiedAndDiffer = 0
    const examples: string[] = []
    for (const [k, g] of groups) {
      if (g.length < 2) continue
      multi += 1
      const max = Math.max(...g.map((r) => r.rankKey))
      const top = g.filter((r) => r.rankKey === max)
      if (top.length < 2) continue
      tiedAtMax += 1
      const payloads = new Set(top.map((r) => `${r.money}|${r.qty}|${r.sol}`))
      if (payloads.size > 1) {
        tiedAndDiffer += 1
        if (examples.length < 8) {
          examples.push(
            `  NSN ${k}  ${top.length} rows tied at rankKey ${max.toFixed(3)}  ->  ` +
              top.map((r) => `[value ${usd(r.money)} qty ${r.qty} sol ${r.sol || 'n/a'}]`).join('  vs  '),
          )
        }
      }
    }
    console.log(`stock numbers appearing more than once ......... ${multi}`)
    console.log(`  ...of those, TIED at the max rankKey ......... ${tiedAtMax}`)
    console.log(`  ...of those, tied rows DISPLAY DIFFERENTLY ... ${tiedAndDiffer}   <- parse-order dependent`)
    if (examples.length) {
      console.log('EXAMPLES (what the operator sees depends on which row the parser yielded first):')
      for (const e of examples) console.log(e)
    }

    // ---- 2. THE END-TO-END PROOF: same data, three input orders, compare the painted board ----
    const orders: Array<[string, Row[]]> = [
      ['as-parsed', rows],
      ['reversed', [...rows].reverse()],
      ['stride-7', (() => { const out: Row[] = []; for (let s = 0; s < 7; s++) for (let i = s; i < rows.length; i += 7) out.push(rows[i]); return out })()],
    ]
    const boards = orders.map(([name, input]) => {
      const collapsed = collapseByNsnLocal(input).filter((r) => !r.hidden)
      const sorted = [...collapsed].sort((a, b) => rankCompare(a.rankKey, a.nsn, b.rankKey, b.nsn))
      return { name, sig: sorted.map((r) => `${r.nsn}:${r.rankKey.toFixed(6)}:${r.money}:${r.qty}`), sorted }
    })
    const base = boards[0]
    console.log(`\nAFTER collapse + rankCompare sort: ${base.sig.length} visible rows`)
    let anyDiff = false
    for (const b of boards.slice(1)) {
      const diffs: number[] = []
      for (let i = 0; i < Math.max(base.sig.length, b.sig.length); i++) {
        if (base.sig[i] !== b.sig[i]) diffs.push(i)
      }
      if (diffs.length === 0) {
        console.log(`  ${b.name.padEnd(10)} IDENTICAL to as-parsed`)
      } else {
        anyDiff = true
        console.log(`  ${b.name.padEnd(10)} DIFFERS at ${diffs.length} of ${base.sig.length} positions. First 3:`)
        for (const i of diffs.slice(0, 3)) {
          console.log(`      pos ${i}  as-parsed: ${base.sig[i]}`)
          console.log(`             ${b.name}: ${b.sig[i]}`)
        }
      }
    }
    console.log(
      anyDiff
        ? '\nVERDICT: the board an operator sees is a FUNCTION OF PARSE ORDER. rankCompare fixed the sort; the collapse upstream still breaks ties by input order.'
        : '\nVERDICT: identical across all three input orders on this day.',
    )

    // ---- 3. Is rankCompare itself total AFTER collapse? (two rows sharing rankKey AND nsn) ----
    const seen = new Map<string, number>()
    let sortCollisions = 0
    for (const r of base.sorted) {
      const k = `${r.rankKey.toFixed(6)}|${r.nsn}`
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    for (const [, n] of seen) if (n > 1) sortCollisions += n
    console.log(`rows sharing BOTH rankKey and stock number after collapse: ${sortCollisions} (rankCompare is total iff 0)`)
  })
})
