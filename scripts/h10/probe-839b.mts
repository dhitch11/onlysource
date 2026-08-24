import { readWorkbookSheets, distinctWorkbookPaths } from '@/lib/intelligence/seed/xlsx'
import { resolveDataRoot } from '@/lib/data-root'
import { readdirSync } from 'node:fs'; import path from 'node:path'
const root=resolveDataRoot(); const dir=path.join(root.root,'nsn-now')
const {files}=distinctWorkbookPaths(readdirSync(dir).filter((f)=>f.toLowerCase().endsWith('.xlsx')&&!f.startsWith('~')).map((f)=>path.join(dir,f)).sort())
type R=Record<string,string|null|undefined>; const raw:R[]=[]
for(const f of files){const wb=readWorkbookSheets(f); for(const r of wb.sheets.get('Procurement')?.rows??[]) raw.push(r as R)}
const t=(v:unknown)=>String(v??'').trim(); const has=(v:unknown)=>t(v)!==''
const nsn13=(v:unknown)=>t(v).replace(/[^0-9A-Za-z]/g,'').toUpperCase()
const G=(label:string, rows:R[])=>{
  const m=new Map<string,R[]>()
  for(const r of rows){const k=t(r['Contract No'])+'|'+nsn13(r['NSN Number']); const a=m.get(k)??[]; a.push(r); m.set(k,a)}
  let multi=0,ident=0
  for(const[,g]of m){if(g.length<2)continue;multi++;if(new Set(g.map((r)=>t(r['Offers']))).size===1)ident++}
  console.log(`${label.padEnd(64)} groups=${multi} identical=${ident} (${(ident/multi*100).toFixed(1)}%)`)
}
const DO=raw.filter((r)=>has(r['Delivery Order']))
G('DO rows, ContractNo+NSN (baseline)', DO)
G('DO rows w/ nonempty ContractNo', DO.filter((r)=>has(r['Contract No'])))
// dedup on (nsn, contract, DO number)
const s1=new Set<string>(); G('DO rows deduped on nsn|contract|deliveryOrder', DO.filter((r)=>{const k=nsn13(r['NSN Number'])+'|'+t(r['Contract No'])+'|'+t(r['Delivery Order']); if(s1.has(k))return false; s1.add(k); return true}))
// dedup on product award key
const s2=new Set<string>(); G('DO rows deduped on product award key', DO.filter((r)=>{const k=`${nsn13(r['NSN Number'])}|${r['Contract No']}|${r['Award Date']}|${r['Unit Price']}|${r['Cage']}`; if(s2.has(k))return false; s2.add(k); return true}))
// group by DO's own parent: strip DO, use contract; require >=2 distinct DO numbers
const m=new Map<string,R[]>(); for(const r of DO){const k=t(r['Contract No'])+'|'+nsn13(r['NSN Number']); const a=m.get(k)??[]; a.push(r); m.set(k,a)}
let mm=0,ii=0; for(const[,g]of m){ if(new Set(g.map((r)=>t(r['Delivery Order']))).size<2) continue; mm++; if(new Set(g.map((r)=>t(r['Offers']))).size===1)ii++ }
console.log(`${'DO rows ContractNo+NSN, >=2 DISTINCT DO numbers'.padEnd(64)} groups=${mm} identical=${ii} (${(ii/mm*100).toFixed(1)}%)`)
