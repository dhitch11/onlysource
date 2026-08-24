/** H10: which POPULATION yields "4,023 of 28,117 coded rows (14.31%)" with cells 3/Z 3/L 4/Z 5/L 5/Z 4/L? */
import { readWorkbookSheets, distinctWorkbookPaths } from '@/lib/intelligence/seed/xlsx'
import { resolveDataRoot } from '@/lib/data-root'
import { AMSC, AMC } from '@/lib/intelligence/codebook'
import { readdirSync } from 'node:fs'; import path from 'node:path'
const root=resolveDataRoot(); const dir=path.join(root.root,'nsn-now')
const {files}=distinctWorkbookPaths(readdirSync(dir).filter((f)=>f.toLowerCase().endsWith('.xlsx')&&!f.startsWith('~')).map((f)=>path.join(dir,f)).sort())
type R=Record<string,string|null|undefined>
const t=(v:unknown)=>String(v??'').trim()
const nsn13=(v:unknown)=>t(v).replace(/[^0-9A-Za-z]/g,'').toUpperCase()
const single=(v:unknown)=>{const s=t(v).toUpperCase(); return s.length===1?s:null}
const proc:R[]=[]; const mcrl:R[]=[]
for(const f of files){const wb=readWorkbookSheets(f)
  for(const r of wb.sheets.get('Procurement')?.rows??[]) proc.push(r as R)
  for(const r of wb.sheets.get('MCRL')?.rows??[]) mcrl.push(r as R)}
const dedupProc=(()=>{const s=new Set<string>();return proc.filter((r)=>{const k=`${nsn13(r['NSN Number'])}|${r['Contract No']}|${r['Award Date']}|${r['Unit Price']}|${r['Cage']}`;if(s.has(k))return false;s.add(k);return true})})()
const dedupMcrl=(()=>{const s=new Set<string>();return mcrl.filter((r)=>{const k=`${nsn13(r['NSN Number'])}|${t(r['Cage'])}|${t(r['Part Number'])}`;if(s.has(k))return false;s.add(k);return true})})()
const determined=(amc:string|null,amsc:string|null)=>{
  const suffix=amsc?AMSC[amsc]:undefined
  const rec=amc!=null&&Object.values(AMC).includes(amc as never)
  return Boolean(suffix)&&rec&&amc!==AMC.NOT_ESTABLISHED}
const isOpenSuffix=(amsc:string)=>AMSC[amsc]!.manufacturing==='open'
const isComp=(amc:string)=>amc==='1'||amc==='2'
const report=(label:string, items:Array<{amc:string|null;amsc:string|null}>)=>{
  const cells=new Map<string,number>(); let coded=0, flip=0
  for(const it of items){ if(!determined(it.amc,it.amsc)) continue; coded++
    if(!isComp(it.amc!)&&isOpenSuffix(it.amsc!)){flip++; const k=`${it.amc}/${it.amsc}`; cells.set(k,(cells.get(k)??0)+1)} }
  const cs=[...cells].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(', ')
  const pct=coded?((flip/coded)*100).toFixed(2):'0'
  const mark = (flip===4023&&coded===28117)?'   <<<<<< EXACT MATCH':''
  console.log(`${label.padEnd(46)} coded=${String(coded).padStart(6)} flip=${String(flip).padStart(5)} ${pct.padStart(6)}%  [${cs}]${mark}`)
}
report('proc RAW rows', proc.map((r)=>({amc:single(r['AMC']),amsc:single(r['AMSC'])})))
report('proc DEDUPED rows', dedupProc.map((r)=>({amc:single(r['AMC']),amsc:single(r['AMSC'])})))
report('MCRL RAW rows', mcrl.map((r)=>({amc:single(r['AMC']),amsc:single(r['AMSC'])})))
report('MCRL DEDUPED rows', dedupMcrl.map((r)=>({amc:single(r['AMC']),amsc:single(r['AMSC'])})))
// per-NSN, product rule: MCRL first then latest award
const mcrlByNsn=new Map<string,R[]>(); for(const r of dedupMcrl){const k=nsn13(r['NSN Number']); const a=mcrlByNsn.get(k)??[]; a.push(r); mcrlByNsn.set(k,a)}
const procByNsn=new Map<string,R[]>(); for(const r of dedupProc){const k=nsn13(r['NSN Number']); const a=procByNsn.get(k)??[]; a.push(r); procByNsn.set(k,a)}
const perNsn:Array<{amc:string|null;amsc:string|null}>=[]
const allN=new Set([...mcrlByNsn.keys(),...procByNsn.keys()])
for(const n of allN){
  const ms=mcrlByNsn.get(n)??[]; const ps=procByNsn.get(n)??[]
  const amc=ms.map((r)=>single(r['AMC'])).find(Boolean)??ps.map((r)=>single(r['AMC'])).filter(Boolean).pop()??null
  const amsc=ms.map((r)=>single(r['AMSC'])).find(Boolean)??ps.map((r)=>single(r['AMSC'])).filter(Boolean).pop()??null
  perNsn.push({amc,amsc})}
report('per-NSN (MCRL first, then award)', perNsn)
// proc raw + mcrl raw combined
report('proc RAW + MCRL RAW combined', [...proc,...mcrl].map((r)=>({amc:single(r['AMC']),amsc:single(r['AMSC'])})))
report('proc DEDUP + MCRL DEDUP combined', [...dedupProc,...dedupMcrl].map((r)=>({amc:single(r['AMC']),amsc:single(r['AMSC'])})))
