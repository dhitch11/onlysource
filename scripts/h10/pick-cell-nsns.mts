/** H10: pick NSNs for each flipping AMC/AMSC cell and for AMC 1/2 controls, plus parent/child Offers rows. */
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { loadAmscIndex } from '@/lib/intelligence/eligibility/bid-eligibility'
import { AMSC, AMC, AMC_OPEN_TO_DEALERS } from '@/lib/intelligence/codebook'
const ds = buildAllDatasets(); const ix = loadAmscIndex(); const aw = buildNsnAwardIndex()
if (!ix.ok || !aw.ok) { console.error('index unavailable'); process.exit(1) }
const lookup = (ix as unknown as { lookup: (n: string) => { amc?: string|null; amsc?: string|null } | undefined }).lookup
const determined=(a:string|null,s:string|null)=>Boolean(s&&AMSC[s])&&a!=null&&Object.values(AMC).includes(a as never)&&a!==AMC.NOT_ESTABLISHED
const byCell = new Map<string, string[]>()
for (const r of ds.cornerMap.rows) {
  if (!r.niin) continue
  const h = lookup(r.niin); if (!h) continue
  const amc = h.amc ?? null, amsc = h.amsc ?? null
  if (!determined(amc, amsc)) continue
  const k = `${amc}/${amsc}`
  const a = byCell.get(k) ?? []; if (a.length < 2) a.push(r.nsn); byCell.set(k, a)
}
console.log('### FLIPPING CELLS (must move):')
for (const [k, v] of byCell) { const [m,s]=k.split('/') as [string,string]
  if (!AMC_OPEN_TO_DEALERS.includes(m) && AMSC[s]!.manufacturing==='open') console.log(`  ${k}  ${v.join(' ')}`) }
console.log('### AMC 1/2 CONTROLS (must NOT move):')
for (const [k, v] of byCell) { const [m]=k.split('/') as [string]
  if (AMC_OPEN_TO_DEALERS.includes(m)) console.log(`  ${k}  ${v.join(' ')}`) }
console.log('### NON-COMPETITIVE CLOSED-SUFFIX CONTROLS (must NOT move):')
let n=0
for (const [k, v] of byCell) { const [m,s]=k.split('/') as [string,string]
  if (!AMC_OPEN_TO_DEALERS.includes(m) && AMSC[s]!.manufacturing!=='open' && n++<4) console.log(`  ${k}  ${v.join(' ')}`) }
// parent/child Offers rows among corner-map NSNs
console.log('\n### CORNER NSNs whose award history is DELIVERY-ORDER-ONLY with Offers present (Defect 1 child rows):')
let c=0
for (const r of ds.cornerMap.rows) {
  const key = r.nsn.replace(/[^0-9]/g,''); const s = aw.byNsn.get(key)
  if (!s || s.awards.length===0) continue
  if (s.latestOffers == null || s.latestOffers <= 0) continue
  if (s.ltcExpirationIso == null) continue   // LTC populated => every such row carries a Delivery Order
  if (c++ < 6) console.log(`  ${r.nsn}  offers=${s.latestOffers} ltc=${s.ltcExpirationIso} awards=${s.awards.length} contract=${s.latest?.contractNo}`)
}
console.log('\n### CORNER NSNs with Offers present and NO LTC (candidate parent/standalone, Defect 1 control):')
let d=0
for (const r of ds.cornerMap.rows) {
  const key = r.nsn.replace(/[^0-9]/g,''); const s = aw.byNsn.get(key)
  if (!s || s.awards.length===0) continue
  if (s.latestOffers == null || s.latestOffers <= 0) continue
  if (s.ltcExpirationIso != null) continue
  if (d++ < 6) console.log(`  ${r.nsn}  offers=${s.latestOffers} awards=${s.awards.length} contract=${s.latest?.contractNo} solicitation=${s.latest?.solicitation}`)
}
