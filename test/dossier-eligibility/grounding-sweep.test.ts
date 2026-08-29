/**
 * THE GROUNDING SWEEP: what the pursuit package lets the deal memo spend.
 *
 * -----------------------------------------------------------------------------------------
 * WHY THIS IS A SWEEP AND NOT ANOTHER ASSERTION ABOUT ONE FIELD
 * -----------------------------------------------------------------------------------------
 * The pursuit package is the grounding object: `app/api/pursuit-package/route.ts` hands the whole
 * of it to the model as the user message, and `lib/ai/grounding.ts` builds the set of numbers the
 * memo is allowed to state by walking every string and number in it. So any digit sitting in a
 * value position becomes a figure the memo may state as a quantity, and the document prints "No
 * number appears that this build did not measure" directly above the result.
 *
 * This leak has now MOVED TWICE rather than closed. First it was the citation: `Table 71` blessed
 * 71 and the fabricated sentence "There are 71 approved sources on this part." passed the guard on
 * a row with one approved source. The citation was reduced to a key, a level and a pin, and the
 * leak reappeared one field over, on `eligibility.niin`: `Number('001760600')` is 1760600, and on
 * NSN 5340001760600, whose real modeled buy value is $57,634.32, "The modeled buy value is
 * $1,760,600." passed. 4,744 of the 28,119 rows in the derived index are in that state.
 *
 * Patching the field the reviewer named would move it a third time. THIS FILE ASSERTS THE CLASS:
 *
 *   A. the eligibility block donates EXACTLY the numbers on a named allowlist, and nothing else,
 *      measured as the difference between the real allowed sets of a package with the block and
 *      the same package without it;
 *   B. no leaf ANYWHERE on the package turns an identifier into a number the memo can spend;
 *   C. every path on a live package that carries a long digit run is on a named list which says,
 *      per path, whether it is a measured value or an identifier that only survives because the
 *      two sides of the guard do not yet use one rule.
 *
 * Every check calls `allowedNumberSet` and `groundBrief` themselves. The control this replaces
 * re-implemented the harvester, skipped what it assumed was safe, and was green while the verdict
 * was donating numbers, which is how the leak got reported closed.
 */
import { describe, expect, it } from 'vitest'
import { hasCorpus, CORPUS_NOTE } from '../support/corpus'

import { allowedNumberSet, groundBrief, valueTokensIn } from '@/lib/ai/grounding'
import { resolveDataRoot } from '@/lib/data-root'
import { AMC_TABLE, AMSC_TABLE } from '@/lib/engine/eligibility'
import { assemblePursuitPackage } from '@/lib/intelligence/brief/assemble-package'
import { buildCornerDossier } from '@/lib/intelligence/brief/dossier'
import { buildPursuitPackage, type PursuitPackage } from '@/lib/intelligence/brief/package'
import type { CornerRow } from '@/lib/intelligence/corner'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { resolveDossierEligibility } from '@/lib/intelligence/eligibility/dossier-eligibility'
import type { AmscIndex } from '@/lib/intelligence/eligibility/bid-eligibility'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'

/* ---------------------------------------------------------------------------------------- */

/** Every leaf of a value, with the path it sits at. Array indices collapse, so a path is stable. */
type Leaf = { path: string; value: string | number }
function leaves(v: unknown, at = '$', out: Leaf[] = []): Leaf[] {
  if (typeof v === 'string' || typeof v === 'number') out.push({ path: at, value: v })
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, `${at}[]`, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, `${at}.${k}`, out)
  return out
}

/**
 * Could the memo actually SPEND this number?
 *
 * `groundBrief` ignores any digit run of 8 or more characters in the brief, on the grounds that it
 * is an identifier rather than a value claim. So a number the memo can write in 7 digits or fewer
 * is checked against the allowed set and is therefore spendable; one that needs 8 or more is not.
 * This asymmetry is the whole defect: `collectNumbers` has no such rule on the harvest side.
 */
const spendable = (n: number): boolean => String(Math.abs(n)).replace(/[^\d]/g, '').length <= 7

/*
 * THE ONE NUMBER THE ELIGIBILITY BLOCK IS ALLOWED TO DONATE, NAMED, WITH THE REASON.
 * AMSC L's verbatim explanation says the annual buy value "falls below the $10,000 screening
 * threshold". That is a measured fact about the item in the government's own words, which is
 * exactly the kind of figure the package exists to license. Everything else the block has ever
 * contributed was citation plumbing or a machine identifier.
 */
const ELIGIBILITY_ALLOWLIST = new Set(['10000', '10000.00'])

/*
 * THE LIVE PACKAGES, ASSEMBLED ONCE AND SHARED.
 *
 * Three checks below want the same real packages, and assembling them is the expensive part of this
 * file (the whole corner map is built on the first call). Assembling them per check took 77s and
 * measured nothing extra. 150 consecutive rows of the real board, which is where every abstention
 * state the feed emits actually turns up.
 */
const LIVE_SAMPLE = 150
let livePkgCache: PursuitPackage[] | null = null
function livePackages(): PursuitPackage[] {
  if (livePkgCache) return livePkgCache
  const { cornerMap } = buildAllDatasets()
  const out: PursuitPackage[] = []
  for (const r of cornerMap.rows.slice(0, LIVE_SAMPLE)) {
    const a = assemblePursuitPackage(r.nsn, true)
    if (a.ok) out.push(a.pkg)
  }
  livePkgCache = out
  return out
}

/* ---------------------------------------------------------------------------------------- */

const rowSeed = {
  niin: '001760600',
  nsn: '5340001760600',
  nomenclature: 'BUSHING, SLEEVE',
  quantity: 212,
  unitOfIssue: 'EA',
  solicitation: 'SPE7L426U1037',
  returnDate: '08/19/26',
  automatedSolicitation: true,
  approvedSources: ['1SR57'],
  approvedSourceCount: 1,
  soleSource: true,
  signals: [],
  silentSourceCount: 1,
  availability: 'unknown_credential_absent',
  availabilityHolders: null,
  availabilityUnits: null,
  legsEstablished: 2,
  demand: null,
  gaps: [],
}

function pkgFor(eligibility?: ReturnType<typeof resolveDossierEligibility>, over: Partial<CornerRow> = {}) {
  const row = { ...rowSeed, ...over } as CornerRow
  const dossier = buildCornerDossier(row, null, null, scoreCorner(row, null, null))
  return buildPursuitPackage({ row, dossier, award: null, byCage: null, savedPacketCount: 0, eligibility, mayReadIdentities: true })
}

const index = (niin: string, amc: string, amsc: string, pica: string): AmscIndex => ({
  ok: true,
  lookup: (n: string) => new Map([[niin, { niin, amc, amsc, aac: '', pica, contested: { amc: false, amsc: false, selfContradiction: false } }]]).get(n),
  size: new Map([[niin, { niin, amc, amsc, aac: '', pica, contested: { amc: false, amsc: false, selfContradiction: false } }]]).size,
  backing: 'binary' as const,
  niins: () => [...new Map([[niin, { niin, amc, amsc, aac: '', pica, contested: { amc: false, amsc: false, selfContradiction: false } }]]).keys()],
  publishers: new Map([[pica, { rows: 10000, withAmsc: 10000, rate: 1 }]]),
  provenance: {},
})

/*
 * THE FIXTURE IS THE SHAPES THE FEED ACTUALLY PRODUCES, not the shapes that are easy to write.
 *   - a NIIN with leading zeros, because 28,119 of 28,119 index rows have them, and the collapse
 *     of those zeros is the defect;
 *   - a NIIN whose numeric value is short enough to spend (001760600 -> 1760600, seven digits);
 *   - a numeric managing activity, because 13 of the 44 publishing activities are numeric;
 *   - the 13 digit NSN form and the 9 digit NIIN form of the same lookup;
 *   - every AMC against every AMSC, plus the seven characters the transcription does not carry.
 */
const CASES: Array<{ what: string; stockNumber: string; niin: string; amc: string; amsc: string; pica: string }> = []
for (const a of AMC_TABLE) {
  for (const e of AMSC_TABLE) {
    CASES.push({ what: `AMC-${a.code}/AMSC-${e.code}`, stockNumber: '5340001760600', niin: '001760600', amc: String(a.code), amsc: e.code, pica: 'GX' })
    CASES.push({ what: `AMC-${a.code}/AMSC-${e.code} numeric activity`, stockNumber: '5340001760600', niin: '001760600', amc: String(a.code), amsc: e.code, pica: '17' })
  }
}
for (const c of ['E', 'F', 'I', 'J', 'O', 'W', 'X']) {
  CASES.push({ what: `unlisted AMSC-${c}`, stockNumber: '5340001760600', niin: '001760600', amc: '3', amsc: c, pica: 'GX' })
  CASES.push({ what: `unlisted AMSC-${c} numeric activity`, stockNumber: '5340001760600', niin: '001760600', amc: '3', amsc: c, pica: '17' })
}
CASES.push({ what: 'looked up by the 9 digit NIIN', stockNumber: '001760600', niin: '001760600', amc: '3', amsc: 'C', pica: 'GX' })
CASES.push({ what: 'a NIIN that is all zeros but one', stockNumber: '000000002', niin: '000000002', amc: '3', amsc: 'P', pica: '92' })
CASES.push({ what: 'not in the catalogue', stockNumber: '999999999', niin: '001760600', amc: '3', amsc: 'C', pica: 'GX' })
CASES.push({ what: 'a non-publishing activity', stockNumber: '001760600', niin: '001760600', amc: '', amsc: '', pica: 'ZW' })

describe.skipIf(!hasCorpus)('A. the eligibility block donates exactly the numbers on a named allowlist' + CORPUS_NOTE, () => {
  it('★ THE CLASS CONTROL: with the block minus without the block, on every shape the feed produces', () => {
    /*
     * MEASURED BEFORE THIS FIX, through `assemblePursuitPackage` on the live corner map: on NSN
     * 5340001760600 the block donated 1760600, `allowedNumberSet(pkg).has('1760600')` was true, and
     * "The modeled buy value is $1,760,600." was stripped WITHOUT the eligibility field and
     * survived WITH it. The package's own basis for that row reads "Modeled buy value $57,634.32 =
     * 212 units x $271.86". On 5310001743746, whose basis reads "No modeled value: no award unit
     * price is on record for this stock number", "The modeled buy value is $1,743,746." survived
     * the same way.
     */
    const without = allowedNumberSet(pkgFor())
    const offenders: string[] = []
    for (const c of CASES) {
      const verdict = resolveDossierEligibility(
        { stockNumber: c.stockNumber, solicitationNumber: rowSeed.solicitation },
        index(c.niin, c.amc, c.amsc, c.pica),
      )
      const donated = [...allowedNumberSet(pkgFor(verdict))].filter((n) => !without.has(n))
      for (const n of donated) {
        if (!ELIGIBILITY_ALLOWLIST.has(n)) offenders.push(`${c.what} donated ${n}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the allowlisted number is really there, so the control above is not asserting an empty block', () => {
    // The negative half. Without this, deleting the whole eligibility field would pass the control
    // above while the memo silently lost a measured government figure.
    const verdict = resolveDossierEligibility(
      { stockNumber: '5340001760600', solicitationNumber: rowSeed.solicitation },
      index('001760600', '3', 'L', 'GX'),
    )
    const donated = [...allowedNumberSet(pkgFor(verdict))].filter((n) => !allowedNumberSet(pkgFor()).has(n))
    expect(donated.sort()).toEqual(['10000', '10000.00'])
  })

  it('the fabricated figure the reviewer measured is stripped again, on the synthetic twin', () => {
    const verdict = resolveDossierEligibility(
      { stockNumber: '5340001760600', solicitationNumber: rowSeed.solicitation },
      index('001760600', '3', 'C', 'GX'),
    )
    const claim = 'THE ECONOMICS\nThe modeled buy value is $1,760,600.'
    expect(groundBrief(claim, pkgFor(verdict)).stripped).toHaveLength(1)
    // And the same sentence about the activity code, on a numeric managing activity.
    const numeric = resolveDossierEligibility(
      { stockNumber: '5340001760600', solicitationNumber: rowSeed.solicitation },
      index('001760600', '3', 'C', '17'),
    )
    expect(groundBrief('THE SUPPLY\nThere are 17 approved sources on this part.', pkgFor(numeric)).stripped).toHaveLength(1)
  })
})

describe.skipIf(!hasCorpus)('B. no identifier anywhere on the package becomes a number the memo can spend' + CORPUS_NOTE, () => {
  /*
   * THE SIGNATURE, STATED EXACTLY. An identifier is written with leading zeros and `Number()` drops
   * them, so the value that enters the allowed set is SHORTER than the run it came from. The brief
   * side ignores runs of 8 or more characters, so the long run itself can never be spent; the short
   * value it collapsed to can. A leaf in that state is licensing a figure no reader of the leaf
   * would recognise, and it is precisely the defect measured on `eligibility.niin`.
   *
   * It is stated as leading zeros rather than as "the value is shorter than the run" so that a
   * genuine price like "237,387.80" (eight digits, no leading zero, and the number IS what the leaf
   * says) is not reported as a leak.
   */
  const collapses = (leaf: Leaf): string[] => {
    const out: string[] = []
    const tokens = typeof leaf.value === 'number' ? [{ raw: String(leaf.value), n: leaf.value }] : valueTokensIn(leaf.value)
    for (const t of tokens) {
      if (!Number.isFinite(t.n)) continue
      const digits = t.raw.replace(/[^\d]/g, '')
      if (digits.length >= 8 && /^0/.test(digits) && spendable(t.n)) {
        out.push(`${leaf.path} :: ${t.raw} collapses to ${t.n} :: ${String(leaf.value).slice(0, 80)}`)
      }
    }
    return out
  }

  it('★ THE COLLAPSE CONTROL: synthetic packages, every shape the feed produces', () => {
    const offenders: string[] = []
    for (const c of CASES) {
      const verdict = resolveDossierEligibility(
        { stockNumber: c.stockNumber, solicitationNumber: rowSeed.solicitation },
        index(c.niin, c.amc, c.amsc, c.pica),
      )
      for (const leaf of leaves(pkgFor(verdict))) offenders.push(...collapses(leaf))
    }
    expect([...new Set(offenders)]).toEqual([])
  })

  it('★ THE COLLAPSE CONTROL: live packages off the corner map', () => {
    const root = resolveDataRoot()
    if (!root.present) {
      // An honest skip, not a silent pass: this environment has no government files to sweep.
      expect(root.present).toBe(false)
      return
    }
    const pkgs = livePackages()
    expect(pkgs.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const pkg of pkgs) for (const leaf of leaves(pkg)) offenders.push(...collapses(leaf))
    expect([...new Set(offenders)]).toEqual([])
  }, 600_000)

  it('the detector fires on the shape it is looking for, so a green sweep means something', () => {
    // A positive control for the CONTROL. Without it, a detector that never fires is indistinguishable
    // from a package that never leaks.
    expect(collapses({ path: '$.someIdentifier', value: '001760600' })).toHaveLength(1)
    expect(collapses({ path: '$.aPrice', value: 'Modeled buy value $237,387.80' })).toHaveLength(0)
    expect(collapses({ path: '$.token', value: 'NIIN-001760600' })).toHaveLength(0)
  })
})

describe.skipIf(!hasCorpus)('C. every path that carries a long digit run is named, and says what kind of thing it is' + CORPUS_NOTE, () => {
  /*
   * THE DELIBERATE ALLOWLIST. A digit run of four or more characters is either a measured figure
   * this product computed, or an identifier that only reaches the model because the harvest side
   * and the brief side of `lib/ai/grounding.ts` do not yet use one rule.
   *
   * The second list is NOT an approval. Those paths are the same defect one layer out from this
   * lane: a CAGE code like 68999, a company literally named "11400 LLC", a phone number, an ISO
   * date. Each of them licenses its own digits as a quantity the memo may state. The complete fix
   * is symmetry in the tokenizer, which belongs to `lib/ai/grounding.ts` and to whoever owns it:
   * `collectNumbers` should skip runs of 8 or more characters the way the brief side already does,
   * and `valueTokensIn` should read a digit run whose preceding word is a code or document label
   * as an identifier fragment. Until that lands, this list is the tripwire: nothing may JOIN it
   * without a person deciding to add it, and nothing under `$.eligibility` may be on it at all.
   */
  const MEASURED_VALUE_PATHS = new Set([
    '$.dossier.demandQuantity.value',
    '$.dossier.forecast.totalForecastQty',
    '$.dossier.priceHistory[].finalPrice',
    '$.dossier.priceHistory[].quantity',
    '$.dossier.priceHistory[].unitPrice',
    '$.dossier.pricing.escalationPct',
    '$.dossier.pricing.firstUnitPrice',
    '$.dossier.pricing.lastUnitPrice',
    /*
     * PROSE, DELIBERATELY ADMITTED, AND THE REASONING IS THE POINT.
     *
     * `priceScaleNote` is the sentence a surface prints when a stock number's award series jumps by
     * an exact power of ten inside one contract. It names the contract and BOTH prices — "moves
     * from $13.73 to $1373, exactly 100x, with no change of contract or vendor" — so it carries a
     * contract identifier and two figures into the allow-set.
     *
     * The estate's standing rule is to build the sentence WITHOUT the protected clause rather than
     * strip it afterwards, and that rule was weighed here and deliberately not applied: a warning
     * that says "some price in this history is wrong" without saying WHICH one is not auditable,
     * and an operator cannot act on it. The figures are real rows this product read, and every use
     * of the sentence is an instruction NOT to rely on them.
     *
     * `lib/thomas/tools.ts` pairs it with an explicit instruction not to narrate the item as rising
     * or escalating, because admitting the figures without that is admitting the trend.
     */
    '$.dossier.pricing.priceScaleNote',
    '$.dossier.score.legs[].value',
    '$.dossier.score.reasons[].plain',
    /*
     * A SCORE TERM THAT IS FOUR DIGITS LONG, AND WHY THAT IS NOT AN IDENTIFIER. Added 2026-08-29.
     *
     * Every other reason code contributes single or double digits, so `points` never carried a long
     * digit run until the lockup penalty was corrected to report the magnitude the sort actually
     * subtracts (`LOCK_PENALTY`, 1000 — see `lib/intelligence/scoring/cornerscore.ts`). It had been
     * rendering −40 while the rank key removed 1000, which left the operator a decomposition that
     * could not be added up to the score beside it.
     *
     * This is a MEASURED value in the strict sense this list means: a term the scorer computed and
     * spent, reproducible from the same inputs, and carrying no identity of a part, a company or a
     * contract. It is admitted here rather than shortened at the source, because a penalty printed
     * smaller than the one that was applied is the exact defect this entry exists to record the fix
     * for. If a future term needs four digits to be honest, it belongs here too — and if one needs
     * four digits to look impressive, it does not.
     */
    '$.dossier.score.reasons[].points',
    '$.economics.basis',
    '$.economics.lastAwardUnitPriceUsd',
    '$.economics.modeledBuyValueUsd',
    '$.economics.quantity',
    '$.eligibility.amsc.value.meaning',
    '$.requirement.quantity',
    '$.suppliers.holders[].quantityListed',
    '$.suppliers.holders[].inBook.holdsInventory',
  ])
  const IDENTIFIER_PATHS_OWNED_BY_THE_TOKENIZER = new Set([
    '$.dossier.forecast.endItems[]',
    '$.dossier.nsn',
    '$.dossier.priceHistory[].cage',
    '$.dossier.priceHistory[].company',
    '$.dossier.priceHistory[].dateIso',
    '$.dossier.quoteSignals[].leg.because',
    '$.dossier.quoteSignals[].leg.value',
    '$.dossier.quoteSignals[].limitation',
    '$.dossier.quoteSignals[].reading',
    '$.dossier.source.approvedSources[]',
    '$.dossier.source.crossReference.cagesOnlyInCrossReference[]',
    '$.dossier.source.crossReference.note',
    '$.economics.lastAwardDateIso',
    '$.gaps[]',
    '$.nextSteps[]',
    '$.nsn',
    '$.suppliers.approvedSources[].cage',
    '$.suppliers.approvedSources[].company',
    '$.suppliers.approvedSources[].inBook.cage',
    '$.suppliers.approvedSources[].inBook.company',
    '$.suppliers.approvedSources[].inBook.lastAwardedAt',
    '$.suppliers.approvedSources[].inBook.phone',
    '$.suppliers.approvedSources[].partNumber',
    '$.suppliers.holders[].cage',
    '$.suppliers.holders[].company',
    '$.suppliers.holders[].inBook.cage',
    '$.suppliers.holders[].inBook.company',
    '$.suppliers.holders[].inBook.lastAwardedAt',
    '$.suppliers.holders[].inBook.phone',
    '$.suppliers.pastAwardees[].cage',
    '$.suppliers.pastAwardees[].company',
    '$.suppliers.pastAwardees[].inBook.cage',
    '$.suppliers.pastAwardees[].inBook.company',
    '$.suppliers.pastAwardees[].inBook.lastAwardedAt',
    '$.suppliers.pastAwardees[].inBook.phone',
    '$.suppliers.pastAwardees[].lastAwardDateIso',
    '$.requirement.quoteReturnDate',
  ])

  const longRunPaths = (pkg: unknown): Set<string> => {
    const out = new Set<string>()
    for (const leaf of leaves(pkg)) {
      const tokens = typeof leaf.value === 'number' ? [{ raw: String(leaf.value), n: leaf.value }] : valueTokensIn(leaf.value)
      for (const t of tokens) {
        if (!Number.isFinite(t.n)) continue
        if (t.raw.replace(/[^\d]/g, '').length >= 4) out.add(leaf.path)
      }
    }
    return out
  }

  it('★ THE ALLOWLIST: no path on a live package carries a long digit run without being named', () => {
    const root = resolveDataRoot()
    if (!root.present) {
      expect(root.present).toBe(false)
      return
    }
    const unnamed = new Set<string>()
    for (const pkg of livePackages()) {
      for (const path of longRunPaths(pkg)) {
        if (MEASURED_VALUE_PATHS.has(path)) continue
        if (IDENTIFIER_PATHS_OWNED_BY_THE_TOKENIZER.has(path)) continue
        unnamed.add(path)
      }
    }
    expect([...unnamed].sort()).toEqual([])
  }, 600_000)

  it('★ nothing under the eligibility block is on the identifier list, on any live row', () => {
    // The half that is this lane's to keep. The block used to contribute `$.eligibility.nsn`,
    // `$.eligibility.niin`, `$.eligibility.publisher.pica` and `$.eligibility.headline`.
    for (const p of IDENTIFIER_PATHS_OWNED_BY_THE_TOKENIZER) expect(p.startsWith('$.eligibility')).toBe(false)
    const root = resolveDataRoot()
    if (!root.present) {
      expect(root.present).toBe(false)
      return
    }
    const found = new Set<string>()
    for (const pkg of livePackages()) {
      for (const path of longRunPaths(pkg)) if (path.startsWith('$.eligibility')) found.add(path)
    }
    // The AMSC L threshold is a measured government figure and is the one exception, named above.
    expect([...found].sort()).toEqual(['$.eligibility.amsc.value.meaning'])
  }, 600_000)
})

describe.skipIf(!hasCorpus)('D. the reviewer’s live failing input, re-run as an assertion' + CORPUS_NOTE, () => {
  it('★ the two fabricated modeled-buy-value sentences are stripped on the real corner map', () => {
    const root = resolveDataRoot()
    if (!root.present) {
      expect(root.present).toBe(false)
      return
    }
    let checked = 0
    for (const [nsn, fabricated] of [
      ['5340001760600', 'The modeled buy value is $1,760,600.'],
      ['5310001743746', 'The modeled buy value is $1,743,746.'],
    ] as const) {
      const a = assemblePursuitPackage(nsn, true)
      if (!a.ok) continue
      checked += 1
      expect(groundBrief(`THE ECONOMICS\n${fabricated}`, a.pkg).stripped).toEqual([fabricated])
      // And the number itself is not in the allowed set at all, in any of its normal forms.
      const digits = fabricated.replace(/[^\d]/g, '')
      expect(allowedNumberSet(a.pkg).has(digits)).toBe(false)
    }
    // If the feed day no longer carries either row, say so rather than passing on an empty loop.
    expect(checked).toBeGreaterThan(0)
  }, 600_000)
})
