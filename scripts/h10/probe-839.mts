/** H10: which grouping yields the memory's "839 multi-order groups / 617 identical (73.5%)"? */
import { readWorkbookSheets, distinctWorkbookPaths } from '@/lib/intelligence/seed/xlsx'
import { resolveDataRoot } from '@/lib/data-root'
import { readdirSync } from 'node:fs'; import path from 'node:path'
const root=resolveDataRoot(); const dir=path.join(root.root,'nsn-now')
const {files}=distinctWorkbookPaths(readdirSync(dir).filter((f)=>f.toLowerCase().endsWith('.xlsx')&&!f.startsWith('~')).map((f)=>path.join(dir,f)).sort())
type R=Record<string,string|null|undefined>; const raw:R[]=[]
for(const f of files){const wb=readWorkbookSheets(f); for(const r of wb.sheets.get('Procurement')?.rows??[]) raw.push(r as R)}
const t=(v:unknown)=>String(v??'').trim(); const has=(v:unknown)=>t(v)!==''
const nsn13=(v:unknown)=>t(v).replace(/[^0-9A-Za-z]/g,'').toUpperCase()
const H=(label:string, rows:R[], key:(r:R)=>string)=>{
  const m=new Map<string,R[]>()
  for(const r of rows){const k=key(r); if(!k)continue; const a=m.get(k)??[]; a.push(r); m.set(k,a)}
  let multi=0,ident=0
  for(const[,g]of m){if(g.length<2)continue;multi++;if(new Set(g.map((r)=>t(r['Offers']))).size===1)ident++}
  console.log(`${label.padEnd(58)} groups=${String(multi).padStart(5)} identical=${String(ident).padStart(5)} (${(ident/Math.max(1,multi)*100).toFixed(1)}%)`)
}
const DO=raw.filter((r)=>has(r['Delivery Order']))
console.log('--- hypotheses for "839 groups / 617 identical (73.5%)" ---')
H('RAW all rows, key=ContractNo', raw, (r)=>t(r['Contract No']))
H('RAW DO rows, key=ContractNo', DO, (r)=>t(r['Contract No']))
H('RAW DO rows, key=ContractNo+NSN', DO, (r)=>t(r['Contract No'])+'|'+nsn13(r['NSN Number']))
H('RAW all rows, key=ContractNo+NSN', raw, (r)=>t(r['Contract No'])+'|'+nsn13(r['NSN Number']))
H('RAW DO rows, key=ContractNo+Cage', DO, (r)=>t(r['Contract No'])+'|'+t(r['Cage']))
H('RAW DO rows offers-present, key=ContractNo', DO.filter((r)=>has(r['Offers'])), (r)=>t(r['Contract No']))
// distinct-DO-number variant
const m=new Map<string,R[]>(); for(const r of DO){const k=t(r['Contract No']); if(!k)continue; const a=m.get(k)??[]; a.push(r); m.set(k,a)}
let dmulti=0,dident=0
for(const[,g]of m){ if(new Set(g.map((r)=>t(r['Delivery Order']))).size<2) continue; dmulti++; if(new Set(g.map((r)=>t(r['Offers']))).size===1)dident++ }
console.log(`${'RAW DO rows, >=2 DISTINCT delivery-order numbers'.padEnd(58)} groups=${String(dmulti).padStart(5)} identical=${String(dident).padStart(5)} (${(dident/Math.max(1,dmulti)*100).toFixed(1)}%)`)
console.log('\n--- hypotheses for "111 spanning / 48 (43.2%)" ---')
const byC=new Map<string,R[]>(); for(const r of raw){const k=t(r['Contract No']); if(!k)continue; const a=byC.get(k)??[]; a.push(r); byC.set(k,a)}
let span=0,allOne=0,allOneIncEmpty=0
for(const[,g]of byC){const n=new Set(g.map((r)=>nsn13(r['NSN Number']))); if(n.size<2)continue; span++
  const vals=g.map((r)=>t(r['Offers'])); if(new Set(vals.filter((v)=>v!=='')).size===1) allOne++
  if(new Set(vals).size===1) allOneIncEmpty++ }
console.log(`spanning=${span}  one-nonempty-Offers=${allOne} (${(allOne/span*100).toFixed(1)}%)  one-value-incl-empty=${allOneIncEmpty} (${(allOneIncEmpty/span*100).toFixed(1)}%)`)
