/**
 * INPUT CHECK FOR THE LTC BACKTEST. Before believing n=82, verify the filter is not the thing
 * doing the limiting. A threshold that sits above its own input reports a defect in working code.
 */
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
const ix = buildNsnAwardIndex()
if (!ix.ok) { console.error(ix.reason); process.exit(1) }
let rowsTotal = 0, rowsLtc = 0, rowsLtcDated = 0
const amcOfLtcRows = new Map<string, number>()
const nsnAny = new Set<string>(), nsnSole = new Set<string>()
const nsnAnyPost = new Set<string>(), nsnSolePost = new Set<string>()
for (const [nsn, s] of ix.byNsn) {
  for (const a of s.awards) {
    rowsTotal += 1
    if (!a.ltcExpirationIso) continue
    rowsLtc += 1
    if (a.awardDateIso) rowsLtcDated += 1
    const amc = (a.amc ?? '(null)').trim() || '(blank)'
    amcOfLtcRows.set(amc, (amcOfLtcRows.get(amc) ?? 0) + 1)
    nsnAny.add(nsn)
    if (['3','4','5'].includes(amc)) nsnSole.add(nsn)
  }
  const dated = s.awards.filter((a) => a.awardDateIso)
  const ltcs = dated.map((a) => a.ltcExpirationIso).filter((d): d is string => !!d).sort()
  if (!ltcs.length) continue
  const exp = ltcs[ltcs.length - 1] as string
  if (dated.some((a) => (a.awardDateIso as string) > exp)) {
    nsnAnyPost.add(nsn)
    if (dated.some((a) => ['3','4','5'].includes((a.amc ?? '').trim()))) nsnSolePost.add(nsn)
  }
}
console.log('award rows total          ', rowsTotal)
console.log('rows carrying an LTC date ', rowsLtc, ' of which dated awards', rowsLtcDated)
console.log('AMC distribution on LTC rows:', JSON.stringify([...amcOfLtcRows].sort((a,b)=>b[1]-a[1])))
console.log('NSNs with any LTC row     ', nsnAny.size, '| sole-source(3/4/5) LTC rows', nsnSole.size)
console.log('NSNs with a POST-expiry buy: ANY AMC', nsnAnyPost.size, '| sole-source', nsnSolePost.size)
