import { readFileSync } from 'node:fs'
import { buildCageFamilyIndex, normaliseCompanyTokens } from '@/lib/intelligence/scoring/cage-family'
const idx = JSON.parse(readFileSync('data/flis/cage-index.json','utf8'))
console.log('companies', idx.companies.length, 'associations', idx.associations.length)
const fam = buildCageFamilyIndex(idx)
console.log('families(roots)', fam.families, 'genericTokens', fam.genericTokens)
for (const c of ['49956','54X10','61858']) console.log(c, JSON.stringify(fam.resolve(c)), idx.companies.find((x:any)=>x.cage===c)?.company)
console.log('THE WORKED PAIR:', JSON.stringify(fam.sameFamily('49956','54X10')))
// raw edges
for (const c of ['49956','54X10']) console.log('edges', c, JSON.stringify(idx.associations.filter((a:any)=>a.cage===c||a.association===c).slice(0,6)))
// absent fork
console.log('absent:', JSON.stringify(fam.sameFamily('ZZZZZ','54X10')))
// component size distribution
const sizes = new Map<string,number>()
for (const c of idx.companies) { const r = fam.resolve(c.cage); if (r.state==='rollup') sizes.set(r.family,(sizes.get(r.family)??0)+1) }
const arr=[...sizes.values()].sort((a,b)=>b-a)
console.log('rollup components', arr.length, 'largest', arr.slice(0,5), 'pairs', arr.filter(n=>n===2).length)
// RAYTHEON named
const ray = idx.companies.filter((c:any)=>/RAYTHEON/.test((c.company??'').toUpperCase()))
console.log('RAYTHEON-named CAGEs', ray.length)
const roots = new Set(ray.map((c:any)=>{const r=fam.resolve(c.cage); return r.state==='rollup'?r.family:'solo:'+c.cage}))
console.log('distinct roots among RAYTHEON-named', roots.size)
