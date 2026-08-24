/**
 * H10 — CHOOSE THE CONTROL SET BEFORE THE CHANGE EXISTS.
 * Run once, before any fix, so no control can be picked to make a fix look good.
 */
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { readFileSync } from 'node:fs'
import { resolveDataRoot } from '@/lib/data-root'
import path from 'node:path'

const root = resolveDataRoot()
const ds = buildAllDatasets()
const ix = buildNsnAwardIndex()
if (!ix.ok) { console.error('award index unavailable'); process.exit(1) }

type Assoc = { cage: string; association: string; affiliation: string }
type Comp = { cage: string; company: string | null; city?: string; state?: string }
const idx = JSON.parse(readFileSync(path.join(root.root, 'flis', 'cage-index.json'), 'utf8')) as
  { companies: Comp[]; associations: Assoc[] }
const byCage = new Map(idx.companies.map((c) => [c.cage, c]))
const parent = new Map<string, string>()
const find = (x: string): string => { let r = x; while ((parent.get(r) ?? r) !== r) r = parent.get(r)!; return r }
const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
for (const a of idx.associations) { if (a.cage && a.association && a.cage !== a.association) { parent.set(a.cage, parent.get(a.cage) ?? a.cage); parent.set(a.association, parent.get(a.association) ?? a.association); union(a.cage, a.association) } }
const hasEdge = (c: string) => parent.has(c)
const famOf = (c: string) => (hasEdge(c) ? find(c) : `solo:${c}`)

// ---- 2. genuine-silence controls: sole + silent, and NO family member won on that NSN ----
const genuineSilence: Array<Record<string, unknown>> = []
const falseSilence: Array<Record<string, unknown>> = []
for (const r of ds.cornerMap.rows) {
  if (!(r.soleSource && r.silentSourceCount > 0)) continue
  const key = r.nsn.replace(/[^0-9]/g, '')
  const aw = ix.byNsn.get(key)
  if (!aw || aw.awards.length === 0) continue
  const src = r.approvedSources[0]!
  const winners = [...new Set(aw.awards.map((a) => (a.cage ?? '').trim().toUpperCase()).filter(Boolean))]
  const srcFam = famOf(src)
  const familyWon = winners.some((w) => famOf(w) === srcFam)
  const rec = {
    nsn: r.nsn, approvedCage: src, approvedName: byCage.get(src)?.company ?? null,
    srcInIndex: byCage.has(src), srcHasEdge: hasEdge(src), srcFamily: srcFam,
    winners: winners.map((w) => ({ cage: w, name: byCage.get(w)?.company ?? null, family: famOf(w) })),
    awardCount: aw.awards.length, distinctAwardees: aw.distinctAwardees, ltc: aw.ltcExpirationIso,
  }
  if (familyWon) falseSilence.push(rec); else genuineSilence.push(rec)
}
console.log(`### FALSE-SILENCE rows (family member won -> +15 must DIE): ${falseSilence.length}`)
for (const r of falseSilence.slice(0, 6)) console.log('   ', JSON.stringify(r))
console.log(`\n### GENUINE-SILENCE rows (no family member won -> +15 must SURVIVE): ${genuineSilence.length}`)
for (const r of genuineSilence.slice(0, 6)) console.log('   ', JSON.stringify(r))

// ---- 6. approved CAGE absent from cage-index entirely (fail-closed fork) ----
const missing = ds.cornerMap.rows
  .filter((r) => r.soleSource && r.silentSourceCount > 0 && r.approvedSources[0] && !byCage.has(r.approvedSources[0]!))
  .slice(0, 5)
console.log(`\n### APPROVED CAGE ABSENT FROM cage-index (fail-closed fork): ${missing.length} shown`)
for (const r of missing) console.log('   ', r.nsn, r.approvedSources[0])

// ---- 3. distinct companies sharing a first token, DIFFERENT families (must NOT merge) ----
const SUFF = new Set(['INC','LLC','CORP','CO','COMPANY','LTD','LP','DIV','DIVISION','GROUP','HOLDINGS'])
const normTokens = (n: string | null | undefined): string[] => {
  const toks = (n ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  while (toks.length && SUFF.has(toks[toks.length - 1]!)) toks.pop()
  return toks
}
const byToken = new Map<string, Comp[]>()
for (const c of idx.companies) { const t = normTokens(c.company)[0]; if (!t) continue; const a = byToken.get(t) ?? []; a.push(c); byToken.set(t, a) }
console.log('\n### DISTINCT-COMPANIES-SHARING-A-TOKEN candidates (same first token, DIFFERENT rollup family, neither generic)')
let shown = 0
for (const [tok, list] of byToken) {
  if (tok === 'THE' || tok === 'AMERICAN') continue
  if (list.length < 2) continue
  const fams = new Map<string, Comp>()
  for (const c of list) if (!fams.has(famOf(c.cage))) fams.set(famOf(c.cage), c)
  if (fams.size < 2) continue
  const two = [...fams.values()].slice(0, 2)
  // want genuinely DIFFERENT companies: second token must differ
  const a = normTokens(two[0]!.company), b = normTokens(two[1]!.company)
  if (a.length < 2 || b.length < 2 || a[1] === b[1]) continue
  console.log(`   ${tok}: ${two[0]!.cage} "${two[0]!.company}" [${famOf(two[0]!.cage)}]  vs  ${two[1]!.cage} "${two[1]!.company}" [${famOf(two[1]!.cage)}]`)
  if (++shown >= 6) break
}
