/** H10: does the FLIS amsc-index over the served demand set yield 4,023 of 28,117? */
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { loadAmscIndex } from '@/lib/intelligence/eligibility/bid-eligibility'
import { AMSC, AMC } from '@/lib/intelligence/codebook'

const root = resolveDataRoot()
const ds = buildAllDatasets()
const ix = loadAmscIndex()
console.log('data root:', root.root)
console.log('cornerMap rows:', ds.cornerMap.rows.length)
console.log('daily index rows:', (ds.index as unknown as { rows?: unknown[] }).rows?.length ?? 'n/a')
console.log('amsc index ok:', ix.ok, ix.ok ? `records=${(ix as unknown as {records?:number}).records ?? 'n/a'}` : (ix as {reason:string}).reason)
const determined=(amc:string|null,amsc:string|null)=>{
  const s=amsc?AMSC[amsc]:undefined
  const rec=amc!=null&&Object.values(AMC).includes(amc as never)
  return Boolean(s)&&rec&&amc!==AMC.NOT_ESTABLISHED}
const openS=(a:string)=>AMSC[a]!.manufacturing==='open'
const comp=(a:string)=>a==='1'||a==='2'
const tally=(label:string, items:Array<{amc:string|null;amsc:string|null}>)=>{
  const cells=new Map<string,number>(); let coded=0,flip=0
  for(const it of items){ if(!determined(it.amc,it.amsc))continue; coded++
    if(!comp(it.amc!)&&openS(it.amsc!)){flip++;const k=`${it.amc}/${it.amsc}`;cells.set(k,(cells.get(k)??0)+1)} }
  console.log(`${label.padEnd(44)} coded=${String(coded).padStart(6)} flip=${String(flip).padStart(5)} ${(coded?flip/coded*100:0).toFixed(2)}%  [${[...cells].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(', ')}]`)
}
if (ix.ok) {
  const anyIx = ix as unknown as { byNiin?: Map<string, { amc: string|null; amsc: string|null }>; lookup?: (n:string)=>unknown }
  console.log('amsc index keys:', Object.keys(ix))
  // corner map rows via FLIS
  const viaFlis: Array<{amc:string|null;amsc:string|null}> = []
  for (const r of ds.cornerMap.rows) {
    const hit = anyIx.byNiin?.get(r.niin) as { amc?: string|null; amsc?: string|null } | undefined
    if (hit) viaFlis.push({ amc: hit.amc ?? null, amsc: hit.amsc ?? null })
  }
  tally('cornerMap rows via FLIS', viaFlis)
}
// daily index rows
const idx = ds.index as unknown as { rows?: Array<{ niin?: string }> }
console.log('index sample keys:', Object.keys((idx.rows?.[0] ?? {}) as object).slice(0,20))
