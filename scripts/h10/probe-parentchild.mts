/** H10 probe: reproduce the 08-20 parent/child measurements from the raw Procurement rows. Read-only. */
import { readWorkbookSheets, distinctWorkbookPaths } from '@/lib/intelligence/seed/xlsx'
import { resolveDataRoot } from '@/lib/data-root'
import { readdirSync } from 'node:fs'
import path from 'node:path'

const root = resolveDataRoot()
const dir = path.join(root.root, 'nsn-now')
const { files } = distinctWorkbookPaths(
  readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~')).map((f) => path.join(dir, f)).sort(),
)
type R = Record<string, string | null | undefined>
const rows: R[] = []
const seen = new Set<string>()
const nsn13 = (v: string | null | undefined) => (v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
for (const f of files) {
  const wb = readWorkbookSheets(f)
  const proc = wb.sheets.get('Procurement')
  for (const r of proc?.rows ?? []) {
    // Same dedup key shape the product uses, on RAW cells.
    const key = `${nsn13(r['NSN Number'])}|${r['Contract No']}|${r['Award Date']}|${r['Unit Price']}|${r['Cage']}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(r as R)
  }
}
const t = (v: unknown) => String(v ?? '').trim()
const has = (v: unknown) => t(v) !== ''
console.log('deduped procurement rows:', rows.length)

// --- the 2x2 the memory records -------------------------------------------------
const solc = (r: R) => t(r['Solcitation']) || t(r['Solicitation'])
let sp_op = 0, sp_oe = 0, sa_op = 0, sa_oe = 0
const offersRaw = (r: R) => t(r['Offers'])
for (const r of rows) {
  const s = solc(r) !== ''
  const o = offersRaw(r) !== ''
  if (s && o) sp_op++; else if (s && !o) sp_oe++; else if (!s && o) sa_op++; else sa_oe++
}
console.log('\n2x2 (RAW Offers cell, before sentinel discard):')
console.log('  solicitation present + offers present ', sp_op)
console.log('  solicitation present + offers empty   ', sp_oe)
console.log('  solicitation ABSENT  + offers present ', sa_op, '  <-- impossible presence')
console.log('  solicitation ABSENT  + offers empty   ', sa_oe)

// --- delivery order column vs offers --------------------------------------------
const doRows = rows.filter((r) => has(r['Delivery Order']))
console.log('\nrows carrying a Delivery Order:', doRows.length)
console.log('  of those, Offers present:', doRows.filter((r) => offersRaw(r) !== '').length)

// --- PIID position 9 on Contract No and on Delivery Order ------------------------
const pos9 = (v: unknown) => { const s = t(v).replace(/[^0-9A-Za-z]/g, '').toUpperCase(); return s.length >= 9 ? s[8]! : '?' }
const tally = (get: (r: R) => unknown, label: string) => {
  const m = new Map<string, number>()
  for (const r of rows) { const c = has(get(r)) ? pos9(get(r)) : '(empty)'; m.set(c, (m.get(c) ?? 0) + 1) }
  console.log(`\nposition-9 tally on ${label}:`, JSON.stringify(Object.fromEntries([...m].sort((a,b)=>b[1]-a[1]))))
}
tally((r) => r['Contract No'], 'Contract No')
tally((r) => r['Delivery Order'], 'Delivery Order')

// cross-tab: Contract No pos9 vs has Delivery Order
const cross = new Map<string, number>()
for (const r of rows) {
  const c = has(r['Contract No']) ? pos9(r['Contract No']) : '(empty)'
  const d = has(r['Delivery Order']) ? 'DO' : 'noDO'
  const k = `${c}/${d}`
  cross.set(k, (cross.get(k) ?? 0) + 1)
}
console.log('\nContractNo pos9 x hasDeliveryOrder:', JSON.stringify(Object.fromEntries([...cross].sort((a,b)=>b[1]-a[1]))))

// --- LTC containment -------------------------------------------------------------
const ltcRows = rows.filter((r) => has(r['LTC Expiration']))
console.log('\nLTC Expiration populated:', ltcRows.length, ' of those also carrying a Delivery Order:', ltcRows.filter((r)=>has(r['Delivery Order'])).length)

// --- sibling variance: groups of >=2 delivery orders under one Contract No -------
const byContract = new Map<string, R[]>()
for (const r of doRows) { const k = t(r['Contract No']); if (!k) continue; const a = byContract.get(k) ?? []; a.push(r); byContract.set(k, a) }
let multi = 0, identical = 0
for (const [, g] of byContract) {
  if (g.length < 2) continue
  multi++
  const vals = new Set(g.map(offersRaw))
  if (vals.size === 1) identical++
}
console.log('\ngroups with >=2 delivery orders:', multi, ' Offers IDENTICAL across all:', identical, `(${((identical/Math.max(1,multi))*100).toFixed(1)}%)`)

// --- entity crossing: contracts spanning >=2 NSNs --------------------------------
const byC2 = new Map<string, R[]>()
for (const r of rows) { const k = t(r['Contract No']); if (!k) continue; const a = byC2.get(k) ?? []; a.push(r); byC2.set(k, a) }
let spanning = 0, oneOffers = 0
for (const [, g] of byC2) {
  const nsns = new Set(g.map((r) => nsn13(r['NSN Number'])))
  if (nsns.size < 2) continue
  spanning++
  if (new Set(g.map(offersRaw).filter((v)=>v!=='')).size === 1) oneOffers++
}
console.log('contracts spanning >=2 NSNs:', spanning, ' carrying ONE Offers value:', oneOffers, `(${((oneOffers/Math.max(1,spanning))*100).toFixed(1)}%)`)
