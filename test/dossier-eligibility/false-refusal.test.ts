/**
 * A WARNING MAY NOT VANISH BECAUSE A MODEL WROTE A CODE IN ORDINARY PROSE.
 *
 * -----------------------------------------------------------------------------------------
 * THE MEASURED DEFECT, AND WHY IT FAILS IN THE PERMISSIVE DIRECTION
 * -----------------------------------------------------------------------------------------
 * Acquisition codes travel on the package as `AMC-3`, never as `3`, because a bare digit in the
 * grounding object is a figure the memo may state as a quantity: with the AMC carried as the number
 * 3, "There are 3 approved sources on this part." passed the guard on a row with one approved
 * source. The hyphen makes the digit abut a letter, which both sides of `lib/ai/grounding.ts` read
 * as an identifier fragment.
 *
 * That invisibility has a second edge. The memo prompt asks for the package's gaps "verbatim in
 * spirit" and the plan "tightened into prose", so a model writes `AMC 3`. The bare 3 is not in the
 * allowed set, and `groundBrief` deletes the WHOLE SENTENCE carrying it. MEASURED over 1,200 live
 * board rows: on 835 of the 1,157 that carry an AMC (72%) the digit is absent from the allowed set.
 * MEASURED on NSN 5325017053574 (AMC 3, AMSC C): "AMC 3 with AMSC C is not a pairing the transcribed
 * table permits." stripped 1, the hyphenated form stripped 0.
 *
 * Withholding is the refusing direction and is right in general. Withholding a CAUTION is not: the
 * on-screen panel renders only the memo (the deterministic '## Bid eligibility' block exists only in
 * the downloaded and emailed markdown), so on the screen the operator commits from, the restriction
 * warning silently disappears and the panel explains it as "sentences withheld: they carried numbers
 * this build did not measure", which is a false statement about a code transcribed verbatim from
 * Table 71.
 *
 * -----------------------------------------------------------------------------------------
 * WHAT THIS FILE HOLDS, AND WHAT IT DOES NOT CLAIM
 * -----------------------------------------------------------------------------------------
 * The repair is that EVERY sentence this lane emits keeps its operative clause free of any bare
 * digit and puts the code identification in a sentence of its own. `groundBrief` withholds whole
 * sentences, so the most a prose rewrite can now cost is the identification. That is asserted below
 * on every code in both tables and on live board rows, in BOTH spellings.
 *
 * It does NOT claim a model cannot invent a digit-bearing sentence of its own. That residual is
 * real, it is named in the last block, and the complete fix is symmetry in the tokenizer, which
 * lives in `lib/ai/grounding.ts` and belongs to whoever owns that file: `valueTokensIn` should read
 * a digit run whose preceding word is a code or document label (AMC, AMSC, Table, Chapter, Part,
 * section, Volume) as an identifier fragment. That is symmetric, so it neither blesses 3 in the
 * allowed set nor strips it from the memo.
 */
import { describe, expect, it } from 'vitest'
import { hasCorpus, CORPUS_NOTE } from '../support/corpus'

import { groundBrief } from '@/lib/ai/grounding'
import { resolveDataRoot } from '@/lib/data-root'
import { AMC_TABLE, AMSC_TABLE } from '@/lib/engine/eligibility'
import { assemblePursuitPackage } from '@/lib/intelligence/brief/assemble-package'
import { buildCornerDossier } from '@/lib/intelligence/brief/dossier'
import { buildPursuitPackage, type PursuitPackage } from '@/lib/intelligence/brief/package'
import type { CornerRow } from '@/lib/intelligence/corner'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import {
  resolveDossierEligibility,
  type DossierEligibility,
  type PackageEligibility,
} from '@/lib/intelligence/eligibility/dossier-eligibility'
import type { AmscIndex } from '@/lib/intelligence/eligibility/bid-eligibility'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'

/**
 * How a model writes a code it read as `AMC-3`. The hyphen is the ONLY thing keeping the digit
 * invisible, so dropping it is exactly the rewrite that triggers the defect.
 */
/*
 * 100 live rows, and the number is a measurement rather than a guess: grounding one real package
 * costs ~180ms because `allowedNumberSet` walks every string in it, so 100 rows is ~18s and 400 is
 * over a minute. The synthetic block above already covers every code in both tables; this pass
 * exists to prove the same property holds on the packages the corner map actually produces, and
 * 100 consecutive rows of the real board carry every abstention state the feed emits.
 */
const LIVE_SAMPLE = 100

const asProse = (text: string): string => text.replace(/\b(AMC|AMSC|PICA|NSN|NIIN)-/g, '$1 ')

/**
 * THE PHRASES WHOSE DISAPPEARANCE IS A LOST WARNING, not a lost fact.
 *
 * Every one of them is a sentence fragment this lane writes on purpose to stop a silence reading as
 * permission. If a rewrite of the code spelling can delete any of them, the operator loses the one
 * thing this module exists to tell them.
 */
const SAFETY_MARKERS = [
  'not determined',
  'must not be read as unrestricted',
  'not a finding that the item is unrestricted',
  'not a finding of no restriction',
  'does not list',
  'no meaning and no posture are asserted',
  'suspect and should be re-pulled',
  'never as a bid decision',
  'out of automated award',
  'do not read the absence as permission',
  'never a permission',
  'publisher being silent',
  'does not by itself bar',
  'neither clears it nor bars it',
  'not legal advice and not a clearance',
  "grouped by OUR reading, not the government's",
  'closed to a new manufacturing source',
  'Treat the code as unread',
  'settle it before hours go in',
]

/** Every sentence-bearing string a surface or a memo could restate from one verdict. */
function sentencesOf(v: DossierEligibility): string[] {
  return [
    v.headline,
    v.publisher.sentence,
    v.surplusSupplyNote.sentence,
    v.pursuit.sentence,
    ...v.cautions.map((c) => c.sentence),
    ...v.gaps,
    ...(v.lane ? [v.lane.surplusOffer.sentence, v.lane.surplusOffer.hypothesis] : []),
  ]
}

/**
 * Run one sentence through the guard the product actually runs, in one spelling, and report which
 * safety markers it started with and did not come out with.
 */
function lostMarkers(sentence: string, pkg: PursuitPackage, spell: (s: string) => string): string[] {
  const present = SAFETY_MARKERS.filter((m) => sentence.includes(m))
  if (present.length === 0) return []
  const grounded = groundBrief(`RISKS AND GAPS\n${spell(sentence)}`, pkg)
  return present.filter((m) => !grounded.text.includes(m))
}

/* ---------------------------------------------------------------------------------------- */

const rowSeed = {
  niin: '017053574',
  nsn: '5325017053574',
  nomenclature: 'BUSHING, SLEEVE',
  quantity: 213,
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

const index = (amc: string, amsc: string, pica: string): AmscIndex => ({
  ok: true,
  lookup: (n: string) => new Map([['017053574', { niin: '017053574', amc, amsc, aac: '', pica, contested: { amc: false, amsc: false, selfContradiction: false } }]]).get(n),
  size: new Map([['017053574', { niin: '017053574', amc, amsc, aac: '', pica, contested: { amc: false, amsc: false, selfContradiction: false } }]]).size,
  backing: 'binary' as const,
  niins: () => [...new Map([['017053574', { niin: '017053574', amc, amsc, aac: '', pica, contested: { amc: false, amsc: false, selfContradiction: false } }]]).keys()],
  publishers: new Map([[pica, { rows: 10000, withAmsc: 10000, rate: 1 }]]),
  provenance: {},
})

function pkgFor(eligibility: PackageEligibility): PursuitPackage {
  const row = { ...rowSeed } as CornerRow
  const dossier = buildCornerDossier(row, null, null, scoreCorner(row, null, null))
  return buildPursuitPackage({ row, dossier, award: null, byCage: null, savedPacketCount: 0, eligibility, mayReadIdentities: true })
}

const verdictFor = (amc: string, amsc: string, pica = 'GX'): DossierEligibility =>
  resolveDossierEligibility(
    { stockNumber: rowSeed.nsn, solicitationNumber: rowSeed.solicitation },
    index(amc, amsc, pica),
  )

const EVERY_COMBINATION = (() => {
  const out: Array<{ what: string; v: DossierEligibility }> = []
  for (const a of AMC_TABLE) {
    for (const e of AMSC_TABLE) {
      out.push({ what: `AMC-${a.code}/AMSC-${e.code}`, v: verdictFor(String(a.code), e.code) })
      out.push({ what: `AMC-${a.code}/AMSC-${e.code} numeric activity`, v: verdictFor(String(a.code), e.code, '17') })
    }
  }
  for (const c of ['E', 'F', 'I', 'J', 'O', 'W', 'X']) {
    out.push({ what: `unlisted AMSC-${c}`, v: verdictFor('3', c) })
  }
  return out
})()

describe.skipIf(!hasCorpus)('every warning this lane writes survives the guard in BOTH spellings of the code' + CORPUS_NOTE, () => {
  it('★ THE CONTROL: across every code in both tables, no safety marker is lost to a prose rewrite', () => {
    const lost: string[] = []
    for (const { what, v } of EVERY_COMBINATION) {
      const pkg = pkgFor(v)
      for (const sentence of sentencesOf(v)) {
        for (const m of lostMarkers(sentence, pkg, asProse)) lost.push(`${what} lost "${m}" from: ${sentence}`)
        for (const m of lostMarkers(sentence, pkg, (s) => s)) lost.push(`${what} lost "${m}" VERBATIM from: ${sentence}`)
      }
    }
    expect([...new Set(lost)]).toEqual([])
  })

  it('★ the reviewer\'s own failing sentence shape: the invalid-pairing warning, in prose', () => {
    /*
     * MEASURED BEFORE THIS FIX: the caution read "AMC-3 with AMSC-G is not a pairing the transcribed
     * table permits, so this catalogue row is suspect and should be re-pulled." and `groundBrief`
     * deleted the whole thing the moment the hyphen became a space, on any row whose AMC digit was
     * not otherwise in the allowed set (72% of live rows carrying an AMC). The warning now leads,
     * carries no code, and the pairing is a sentence of its own.
     *
     * The pair is AMC 3 with AMSC G, which is the one Table 70 actually rejects. The reviewer's
     * probe fed the guard a hand-written sentence about AMC 3 with AMSC C, which is a pairing the
     * table PERMITS, so the module never writes that caution and the fixture has to be a real
     * invalid pair or this test would assert against a sentence the product cannot emit.
     */
    const v = verdictFor('3', 'G')
    expect(v.combination).toBe('invalid')
    const caution = v.cautions.find((c) => c.code === 'acquisition_code_combination_invalid')!
    const grounded = groundBrief(`RISKS AND GAPS\n${asProse(caution.sentence)}`, pkgFor(v))
    expect(grounded.text).toContain('not a pairing the transcribed table permits')
    expect(grounded.text).toContain('suspect and should be re-pulled')
    expect(grounded.text).toContain('never as a bid decision')
  })

  it('★ the unlisted-code warning, in prose, on the row that used to clear', () => {
    const v = verdictFor('3', 'E')
    const caution = v.cautions.find((c) => c.code === 'acquisition_posture_not_determined')!
    const grounded = groundBrief(`RISKS AND GAPS\n${asProse(caution.sentence)}`, pkgFor(v))
    expect(grounded.text).toContain('does not list')
    expect(grounded.text).toContain('not a finding that the item is unrestricted')
    // And the headline, which is the one line a compact surface renders on its own.
    const head = groundBrief(`RISKS AND GAPS\n${asProse(v.headline)}`, pkgFor(v))
    expect(head.text).toContain('no meaning and no posture are asserted')
    expect(head.text).toContain('not a finding of no restriction')
  })

  it('★ the abstention warning under a NUMERIC managing activity, in prose', () => {
    // 13 of the 44 publishing activities on the real extract are numeric. Writing the activity as
    // `PICA-17` closed one leak and would have opened this one if the sentence had not been split.
    const v = resolveDossierEligibility(
      { stockNumber: rowSeed.nsn, solicitationNumber: rowSeed.solicitation },
      { ...index('3', 'C', '17'), publishers: new Map([['ZW', { rows: 10, withAmsc: 0, rate: 0 }]]) },
    )
    expect(v.determined).toBe(false)
    const grounded = groundBrief(`RISKS AND GAPS\n${asProse(v.publisher.sentence)}`, pkgFor(v))
    expect(grounded.text).toContain('not the item being unrestricted')
  })

  it('★ LIVE: no safety marker is lost on any package the corner map actually produces', () => {
    const root = resolveDataRoot()
    if (!root.present) {
      expect(root.present).toBe(false)
      return
    }
    const { cornerMap } = buildAllDatasets()
    const lost: string[] = []
    let checked = 0
    for (const r of cornerMap.rows.slice(0, LIVE_SAMPLE)) {
      const a = assemblePursuitPackage(r.nsn, true)
      if (!a.ok || a.pkg.eligibility.kind !== 'dossier_eligibility') continue
      checked += 1
      /*
       * ONE DOCUMENT, NOT ONE SENTENCE AT A TIME. `groundBrief` rebuilds the whole allowed set per
       * call, and a memo is a document, so grounding the block once is both the faster read and the
       * truer one: a sentence that survives alone but is dropped in company would be missed by the
       * per-sentence form.
       */
      const said = sentencesOf(a.pkg.eligibility)
      const grounded = groundBrief(`RISKS AND GAPS\n${said.map(asProse).join('\n')}`, a.pkg)
      for (const m of SAFETY_MARKERS) {
        if (said.some((x) => x.includes(m)) && !grounded.text.includes(m)) {
          lost.push(`${r.nsn} lost "${m}"`)
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect([...new Set(lost)]).toEqual([])
  }, 600_000)
})

describe.skipIf(!hasCorpus)('the residual is named, and it is an identification rather than a warning' + CORPUS_NOTE, () => {
  it('what a prose rewrite can still cost is the sentence that names the code, and nothing else', () => {
    /*
     * The honest statement of what is NOT closed here. A sentence naming `AMC 3` still carries a
     * bare digit the allowed set does not hold, so it is still withheld. That is a refusal, which is
     * the safe direction, and every such sentence is now pure identification: the code and nothing
     * else. Anything else being withheld would mean the split has drifted, and this fails.
     */
    const withheld = new Set<string>()
    for (const { v } of EVERY_COMBINATION) {
      const pkg = pkgFor(v)
      for (const sentence of sentencesOf(v)) {
        for (const s of groundBrief(`RISKS AND GAPS\n${asProse(sentence)}`, pkg).stripped) withheld.add(s)
      }
    }
    for (const s of withheld) {
      // It names a code, in the spelling a model would use, and it makes no claim beyond that.
      expect(s).toMatch(/\b(AMC|AMSC|PICA|NSN|NIIN) \d/)
      for (const m of SAFETY_MARKERS) expect(s).not.toContain(m)
    }
  })

  it('the token spelling itself is never withheld, so a memo quoting the package verbatim loses nothing', () => {
    for (const { what, v } of EVERY_COMBINATION) {
      const pkg = pkgFor(v)
      for (const sentence of sentencesOf(v)) {
        const g = groundBrief(`RISKS AND GAPS\n${sentence}`, pkg)
        expect({ what, stripped: g.stripped }).toEqual({ what, stripped: [] })
      }
    }
  })
})
