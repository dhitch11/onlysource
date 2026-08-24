import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { loadAmscIndex } from '@/lib/intelligence/eligibility/bid-eligibility'
import { AMSC, AMC } from '@/lib/intelligence/codebook'
const ds = buildAllDatasets(); const ix = loadAmscIndex()
if (!ix.ok) { console.log('index unavailable'); process.exit(0) }
const anyIx = ix as unknown as { lookup: (n: string) => unknown; size: number }
console.log('amsc index size:', anyIx.size)
console.log('cornerMap rows:', ds.cornerMap.rows.length)
const idx = ds.index as unknown as { rows: Array<{ niin: string }> }
console.log('daily index rows:', idx.rows.length)
const win = ds.window as unknown as { days?: Array<{ feedDay: string }> } | null
console.log('window days:', win?.days?.length ?? 0)
console.log('sample lookup:', JSON.stringify(anyIx.lookup(ds.cornerMap.rows.find((r)=>r.niin)!.niin)))
const determined=(amc:string|null,amsc:string|null)=>{const s=amsc?AMSC[amsc]:undefined;const rec=amc!=null&&Object.values(AMC).includes(amc as never);return Boolean(s)&&rec&&amc!==AMC.NOT_ESTABLISHED}
const openS=(a:string)=>AMSC[a]!.manufacturing==='open'; const comp=(a:string)=>a==='1'||a==='2'
const tally=(label:string, items:Array<{amc:string|null;amsc:string|null}>)=>{
  const cells=new Map<string,number>(); let coded=0,flip=0
  for(const it of items){if(!determined(it.amc,it.amsc))continue;coded++
    if(!comp(it.amc!)&&openS(it.amsc!)){flip++;const k=`${it.amc}/${it.amsc}`;cells.set(k,(cells.get(k)??0)+1)}}
  console.log(`${label.padEnd(40)} coded=${String(coded).padStart(6)} flip=${String(flip).padStart(5)} ${(coded?flip/coded*100:0).toFixed(2)}%  [${[...cells].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(', ')}]`)
}
const grab=(niins: string[]) => { const out:Array<{amc:string|null;amsc:string|null}>=[]
  for(const n of niins){ if(!n) continue; const h=anyIx.lookup(n) as {amc?:string|null;amsc?:string|null}|null|undefined; if(h) out.push({amc:h.amc??null,amsc:h.amsc??null})} return out }
tally('cornerMap NIINs via FLIS', grab(ds.cornerMap.rows.map((r)=>r.niin)))
tally('daily index NIINs via FLIS', grab([...new Set(idx.rows.map((r)=>r.niin))]))
