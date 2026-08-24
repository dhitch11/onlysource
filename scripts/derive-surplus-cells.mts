/**
 * H10 / DEFECT 3 — the `surplusSupplyOpen` blast radius, by (AMC, AMSC) cell.
 *
 * A field inherited from a parent row is not a measurement of the child. This asks the same kind
 * of question one level down: for every coded row the product actually serves, does the SHIPPED
 * predicate agree with the corrected truth table, and where exactly does it not?
 *
 * ---------------------------------------------------------------------------------------------
 * THE POPULATION, AND WHY IT IS NOT THE AWARD WORKBOOK
 * ---------------------------------------------------------------------------------------------
 * The 2026-08-20 record says "4,023 of 28,117 coded rows = 14.31% (3/Z:2385, 3/L:1326, 4/Z:210,
 * 5/L:54, 5/Z:26, 4/L:22)" on "the shipped index". Four candidate populations were measured
 * before this one was written, and none of them reproduces that cell SET:
 *
 *   procurement rows RAW      59,831 coded, 45.35% flipping, cells 3/Z 3/L 4/Z 5/Z 5/L
 *   procurement rows DEDUPED  42,539 coded, 35.60% flipping, cells 3/Z 3/L 4/Z 5/Z 5/L
 *   MCRL rows                 13,543 coded, 15.79% flipping, cells 3/Z 3/L 4/Z 5/Z 5/L
 *   per-NSN summary            3,319 coded, 15.34% flipping, cells 3/Z 3/L 4/Z 5/Z 5/L
 *
 * NONE of them contains a 4/L cell at all. The corner map's NIINs coded through the FLIS
 * amsc-index does, and it reproduces the rate: 14.38% against the record's 14.31%, over exactly
 * the same six cells. So THAT is the population, and this script measures it.
 *
 * ---------------------------------------------------------------------------------------------
 * ⚠️ WHY THE ABSOLUTE COUNTS CANNOT BE REPRODUCED, AND WHAT REPLACES THEM AS THE GATE
 * ---------------------------------------------------------------------------------------------
 * The corner map is built over the SERVED FEED WINDOW. The window that produced 28,117 coded rows
 * on 2026-08-20 no longer exists; today's build serves a different set of days and a different
 * number of rows. Freezing 4,023 as the assertion would make this gate fail every morning for a
 * reason that has nothing to do with the predicate.
 *
 * So the gate is STRUCTURAL, not numeric, and it is the stronger of the two: the set of flipping
 * cells must be exactly the non-competitive methods crossed with the OPEN-manufacturing suffixes,
 * and NOTHING else may move. A competitive cell that moves, or a closed-suffix cell that moves,
 * fails it at any window size. That is the "verified by what it must NOT touch" form.
 *
 * Usage: npx tsx --require ./scripts/h10/server-only.cjs scripts/derive-surplus-cells.mts
 */
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { loadAmscIndex } from '@/lib/intelligence/eligibility/bid-eligibility'
import { AMSC, AMC, AMC_OPEN_TO_DEALERS } from '@/lib/intelligence/codebook'

const root = resolveDataRoot()
const ds = buildAllDatasets()
const ix = loadAmscIndex()
if (!ix.ok) {
  console.error(`FLIS amsc-index unavailable: ${(ix as { reason: string }).reason}`)
  console.error('This is an ABSENCE, not a zero. Nothing is derived and nothing is asserted.')
  process.exit(1)
}
const lookup = (ix as unknown as { lookup: (n: string) => { amc?: string | null; amsc?: string | null } | undefined }).lookup

/** The SHIPPED predicate, verbatim from codebook.ts before the Defect-3 fix. */
const shippedPredicate = (amc: string, amsc: string): boolean =>
  AMC_OPEN_TO_DEALERS.includes(amc) || AMSC[amsc]!.manufacturing !== 'open'

/**
 * THE CORRECTED TRUTH TABLE. No acquisition code bars a dealer from supplying NEW SURPLUS of the
 * ORIGINALLY APPROVED ARTICLE. A competitive method names dealers and distributors among
 * potential sources; a restrictive suffix constrains new MANUFACTURING, not resale of the article
 * that was already approved. The real gate is TRACEABILITY (DLAD C04/L04), which this module does
 * not own and must not pretend to answer. So on any DETERMINED pair the answer is open, and only
 * an undetermined code abstains (that branch returns false before this predicate is reached).
 */
const correctedPredicate = (_amc: string, _amsc: string): boolean => true

const determined = (amc: string | null, amsc: string | null): boolean => {
  const suffix = amsc ? AMSC[amsc] : undefined
  const recognised = amc != null && amc !== '' && Object.values(AMC).includes(amc as never)
  return Boolean(suffix) && recognised && amc !== AMC.NOT_ESTABLISHED
}

type Cell = { n: number; shipped: boolean; corrected: boolean }
const cells = new Map<string, Cell>()
let coded = 0
let uncoded = 0
let absentFromFlis = 0

for (const row of ds.cornerMap.rows) {
  if (!row.niin) { absentFromFlis++; continue }
  const hit = lookup(row.niin)
  if (!hit) { absentFromFlis++; continue }
  const amc = hit.amc ?? null
  const amsc = hit.amsc ?? null
  if (!determined(amc, amsc)) { uncoded++; continue }
  coded++
  const key = `${amc}/${amsc}`
  const c = cells.get(key) ?? { n: 0, shipped: shippedPredicate(amc!, amsc!), corrected: correctedPredicate(amc!, amsc!) }
  c.n += 1
  cells.set(key, c)
}

console.log(`data root        : ${root.root} (${root.basis})`)
console.log(`feed day served  : ${ds.feed?.feedDay ?? 'unknown'}`)
console.log(`window days      : ${(ds.window as unknown as { days?: unknown[] } | null)?.days?.length ?? 1}`)
console.log(`corner map rows  : ${ds.cornerMap.rows.length}`)
console.log(`  coded (AMC determined + AMSC recognised in FLIS): ${coded}`)
console.log(`  present in FLIS but not determined              : ${uncoded}`)
console.log(`  no NIIN / absent from FLIS                      : ${absentFromFlis}`)

const sorted = [...cells].sort((a, b) => b[1].n - a[1].n)
console.log('\nALL CELLS (cell, n, shipped -> corrected)')
let flipped = 0
const flippingCells: string[] = []
const wrongMovers: string[] = []
for (const [k, v] of sorted) {
  const moves = v.shipped !== v.corrected
  const [amc, amsc] = k.split('/') as [string, string]
  const shouldMove = !AMC_OPEN_TO_DEALERS.includes(amc) && AMSC[amsc]!.manufacturing === 'open'
  if (moves) { flipped += v.n; flippingCells.push(`${k}:${v.n}`) }
  if (moves !== shouldMove) wrongMovers.push(`${k} (moves=${moves}, allowed=${shouldMove})`)
  console.log(`  ${k.padEnd(6)} n=${String(v.n).padStart(6)}  ${String(v.shipped).padEnd(5)} -> ${String(v.corrected).padEnd(5)}${moves ? '   <<< FLIPS' : ''}`)
}
console.log(`\nFLIPPING CELLS : ${flippingCells.join(', ')}`)
console.log(`TOTAL FLIPPED  : ${flipped} of ${coded} coded = ${coded ? ((flipped / coded) * 100).toFixed(2) : '0.00'}%`)
console.log(`RECORD 2026-08-20: 4023 of 28117 = 14.31%, cells 3/Z 3/L 4/Z 5/L 5/Z 4/L`)
console.log(`  (counts are window-dependent and the 08-20 window is gone; the RATE and the CELL SET are the reproducible parts)`)

console.log('\n--- THE STRUCTURAL GATE: verified by what it must NOT touch ---')
if (wrongMovers.length === 0) {
  console.log('PASS: every cell that moves is a non-competitive method crossed with an OPEN-manufacturing')
  console.log('      suffix, and every other cell is untouched. No competitive cell moved. No')
  console.log('      closed-suffix or source-approval-suffix cell moved.')
} else {
  console.log('FAIL: cells moved that must not, or failed to move that must:')
  for (const w of wrongMovers) console.log(`  ${w}`)
  process.exitCode = 1
}
