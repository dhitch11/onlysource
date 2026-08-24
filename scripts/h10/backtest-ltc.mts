/**
 * DEFECT 4 BACKTEST — does a LAPSED long-term contract actually predict that the next buy on a
 * sole-source item opens up?
 *
 * ★ NO WEIGHT WITHOUT A MEASURED RECORD. A preset without its record is exactly how the 3x rule
 * shipped behind a "High confidence" label and cleared 0.49% of six million real award pairs.
 * This harness exists so the LTC leg's points can point at a number, and so the INCONCLUSIVE
 * fork can be taken honestly if the number does not clear the bar.
 *
 * THE BAR WAS SET BEFORE THE RESULT WAS SEEN (H10 handoff section 3, defect 4):
 *   - minimum n of 200 treatment NSNs carrying at least one post-expiry buy
 *   - treatment share must beat control by >= 5 percentage points
 *   - the gap must hold across BOTH outcome definitions, not just the flattering one
 *
 * THE TWO OUTCOME DEFINITIONS, both facts in the corpus rather than model output:
 *   (a) NEW FAMILY WON  - the winning CAGE is outside the incumbent's CORPORATE FAMILY, resolved
 *       through the same rollup the Defect-2 fix uses. Comparing raw CAGE strings here would
 *       count Raytheon's plant beating Raytheon's registration as "a new entrant", which is the
 *       Defect-2 mistake wearing a different hat.
 *   (b) COMPETED INSTRUMENT - the buy went out as a standalone award with a solicitation rather
 *       than as a call against a standing vehicle (`offersDescribeThisAward`).
 *
 * THE CONTROL IS CHOSEN BEFORE THE OUTCOME IS COMPUTED, and it is a WITHIN-NSN control: on the
 * same stock numbers, the buys that happened while the vehicle was still LIVE. That matching is
 * strictly tighter than pairing different NSNs by FSC, because item, buyer and cadence are held
 * identical by construction; the only thing that differs is which side of the expiry the buy
 * falls on. A cross-NSN control is reported alongside it as a second, independent cut.
 */
import { buildNsnAwardIndex, type AwardRecord } from '@/lib/intelligence/awards/nsn-now'
import { offersDescribeThisAward } from '@/lib/intelligence/awards/parent-child'
import { loadCageFamilyIndex } from '@/lib/intelligence/scoring/cage-family-load'

const SOLE_AMC = new Set(['3', '4', '5'])

const ix = buildNsnAwardIndex()
if (!ix.ok) { console.error('AWARD INDEX UNAVAILABLE:', ix.reason); process.exit(1) }
const famState = loadCageFamilyIndex()
if (!famState.ok) { console.error('CAGE INDEX UNAVAILABLE:', famState.reason); process.exit(1) }
const fam = famState.index

const dated = (a: AwardRecord) => (a.awardDateIso ?? '') !== ''
/** The AMC on the row itself, so nothing is inherited from a summary. */
const soleRow = (a: AwardRecord) => SOLE_AMC.has((a.amc ?? '').trim())

type Bucket = { buys: number; newFamily: number; competed: number; nsns: Set<string> }
const mk = (): Bucket => ({ buys: 0, newFamily: 0, competed: 0, nsns: new Set() })
const post = mk()   // TREATMENT: buys after the vehicle lapsed
const pre = mk()    // CONTROL A: buys on the same NSNs while the vehicle was live
const never = mk()  // CONTROL B: sole-source NSNs whose LTC never lapsed inside the window

let nsnWithLtc = 0
let nsnTreatment = 0

for (const [nsn, s] of ix.byNsn) {
  const rows = s.awards.filter(dated).filter(soleRow).sort((a, b) => (a.awardDateIso as string).localeCompare(b.awardDateIso as string))
  if (rows.length === 0) continue
  // The expiry instant is the LTC date carried on this stock number's own rows.
  const ltcDates = rows.map((r) => r.ltcExpirationIso).filter((d): d is string => !!d).sort()
  const expiry = ltcDates.length ? (ltcDates[ltcDates.length - 1] as string) : null
  if (expiry) nsnWithLtc += 1

  /*
   * THE INCUMBENT IS FIXED BEFORE THE OUTCOME IS LOOKED AT: whoever won the buy immediately
   * before the comparison instant. Deciding the incumbent from the post-period winners would
   * be reading the answer off the answer sheet.
   */
  const instantFor = (r: AwardRecord) => expiry ?? '9999-12-31'
  const priorTo = (iso: string) => rows.filter((r) => (r.awardDateIso as string) < iso).slice(-1)[0] ?? null

  for (const r of rows) {
    const d = r.awardDateIso as string
    const incumbent = priorTo(expiry && d > expiry ? expiry : d)
    if (!incumbent || !incumbent.cage || !r.cage) continue
    const verdict = fam.sameFamily(incumbent.cage, r.cage).verdict
    if (verdict === 'ungrounded') continue // a signal we cannot ground is a signal we do not count
    const isNew = verdict === 'different_families' ? 1 : 0
    const isCompeted = offersDescribeThisAward(r) ? 1 : 0

    let b: Bucket
    if (expiry && d > expiry) b = post
    else if (expiry) b = pre
    else b = never
    b.buys += 1
    b.newFamily += isNew
    b.competed += isCompeted
    b.nsns.add(nsn)
  }
  if (expiry && rows.some((r) => (r.awardDateIso as string) > expiry)) nsnTreatment += 1
}

const pct = (n: number, d: number) => (d === 0 ? NaN : (100 * n) / d)
const line = (label: string, b: Bucket) =>
  `${label.padEnd(34)} nsns ${String(b.nsns.size).padStart(5)}  buys ${String(b.buys).padStart(6)}  newFamily ${pct(b.newFamily, b.buys).toFixed(2).padStart(6)}%  competed ${pct(b.competed, b.buys).toFixed(2).padStart(6)}%`

console.log('feed window:', ix.window ? JSON.stringify(ix.window) : '(none)')
console.log('NSNs carrying an LTC date (AMC 3/4/5 rows):', nsnWithLtc)
console.log('TREATMENT NSNs with >=1 post-expiry buy:   ', nsnTreatment, '   BAR = 200')
console.log()
console.log(line('TREATMENT  buys after LTC expiry', post))
console.log(line('CONTROL A  same NSNs, vehicle live', pre))
console.log(line('CONTROL B  sole NSNs, no LTC date', never))
console.log()
const gapA_new = pct(post.newFamily, post.buys) - pct(pre.newFamily, pre.buys)
const gapA_comp = pct(post.competed, post.buys) - pct(pre.competed, pre.buys)
const gapB_new = pct(post.newFamily, post.buys) - pct(never.newFamily, never.buys)
const gapB_comp = pct(post.competed, post.buys) - pct(never.competed, never.buys)
console.log(`GAP vs CONTROL A  newFamily ${gapA_new.toFixed(2)}pp   competed ${gapA_comp.toFixed(2)}pp`)
console.log(`GAP vs CONTROL B  newFamily ${gapB_new.toFixed(2)}pp   competed ${gapB_comp.toFixed(2)}pp`)
console.log()
const nOk = nsnTreatment >= 200
const gapOk = gapA_new >= 5 && gapA_comp >= 5
console.log('BAR: n>=200 ->', nOk, '| both outcome gaps >=5pp vs Control A ->', gapOk)
console.log('VERDICT:', nOk && gapOk ? 'CLEARS THE BAR - a measured weight may be proposed' : 'INCONCLUSIVE - ship the FACT at ZERO weight (the ruled fork)')
