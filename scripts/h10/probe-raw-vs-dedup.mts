/** H10: does the 08-20 memory's arithmetic reproduce on RAW (undeduped) procurement rows? */
import { readWorkbookSheets, distinctWorkbookPaths } from '@/lib/intelligence/seed/xlsx'
import { resolveDataRoot } from '@/lib/data-root'
import { readdirSync } from 'node:fs'
import path from 'node:path'
const root = resolveDataRoot(); const dir = path.join(root.root, 'nsn-now')
const { files } = distinctWorkbookPaths(readdirSync(dir).filter((f)=>f.toLowerCase().endsWith('.xlsx')&&!f.startsWith('~')).map((f)=>path.join(dir,f)).sort())
type R = Record<string,string|null|undefined>
const raw: R[] = []
for (const f of files) { const wb = readWorkbookSheets(f); for (const r of wb.sheets.get('Procurement')?.rows ?? []) raw.push(r as R) }
const t=(v:unknown)=>String(v??'').trim(); const has=(v:unknown)=>t(v)!==''
const nsn13=(v:unknown)=>t(v).replace(/[^0-9A-Za-z]/g,'').toUpperCase()
const solc=(r:R)=>t(r['Solcitation'])||t(r['Solicitation'])
const report=(label:string, rows:R[])=>{
  let sa_op=0,sp_op=0,sp_oe=0,sa_oe=0
  for(const r of rows){const s=solc(r)!==''; const o=has(r['Offers']); if(s&&o)sp_op++;else if(s&&!o)sp_oe++;else if(!s&&o)sa_op++;else sa_oe++}
  const doOffers = rows.filter((r)=>has(r['Delivery Order'])&&has(r['Offers'])).length
  const byC=new Map<string,R[]>(); for(const r of rows.filter((r)=>has(r['Delivery Order']))){const k=t(r['Contract No']);if(!k)continue;const a=byC.get(k)??[];a.push(r);byC.set(k,a)}
  let multi=0,ident=0; for(const[,g]of byC){if(g.length<2)continue;multi++;if(new Set(g.map((r)=>t(r['Offers']))).size===1)ident++}
  const byC2=new Map<string,R[]>(); for(const r of rows){const k=t(r['Contract No']);if(!k)continue;const a=byC2.get(k)??[];a.push(r);byC2.set(k,a)}
  let span=0,one=0; for(const[,g]of byC2){const n=new Set(g.map((r)=>nsn13(r['NSN Number'])));if(n.size<2)continue;span++;if(new Set(g.map((r)=>t(r['Offers'])).filter((v)=>v!=='')).size===1)one++}
  const ltc=rows.filter((r)=>has(r['LTC Expiration']))
  console.log(`\n### ${label}  rows=${rows.length}`)
  console.log(`  solPresent+offPresent ${sp_op}   solPresent+offEmpty ${sp_oe}   solABSENT+offPresent ${sa_op}   solABSENT+offEmpty ${sa_oe}`)
  console.log(`  DeliveryOrder rows w/ Offers ${doOffers}`)
  console.log(`  multi-DO groups ${multi}  identical ${ident} (${(ident/Math.max(1,multi)*100).toFixed(1)}%)`)
  console.log(`  contracts spanning >=2 NSNs ${span}  one Offers value ${one} (${(one/Math.max(1,span)*100).toFixed(1)}%)`)
  console.log(`  LTC populated ${ltc.length}  all carrying a Delivery Order: ${ltc.every((r)=>has(r['Delivery Order']))}`)
}
report('RAW (no dedup)', raw)
const seen=new Set<string>(); const ded=raw.filter((r)=>{const k=`${nsn13(r['NSN Number'])}|${r['Contract No']}|${r['Award Date']}|${r['Unit Price']}|${r['Cage']}`; if(seen.has(k))return false; seen.add(k); return true})
report('DEDUPED (product corpus)', ded)
