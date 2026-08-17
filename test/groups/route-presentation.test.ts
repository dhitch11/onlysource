/**
 * WHAT THE /groups ROUTE IS ALLOWED TO SAY ABOUT A CLASS.
 *
 * The rollup module owns the arithmetic and its own tests own the grades. THIS file owns the
 * thing between the grade and the operator's eye, which is where the money is lost: a class
 * that is not distinguishable from the map average printing "1.9x the baseline" is a finding
 * invented out of thirty coin flips, and the person who stocks against it loses real money.
 *
 * So every assertion below is written from BOTH directions. It is not enough to check that a
 * significant row renders a lift; the indicative row must be checked for the ABSENCE of one,
 * and the under-floor row for the absence of any percentage at all. A presentation layer that
 * rendered everything identically would pass a one-directional test.
 *
 * The last block runs against the REAL rollup for the served feed day rather than against
 * fixtures, because the fixture is written by the same head as the code and agrees with it.
 */
import { describe, expect, it } from 'vitest'

import {
  buildFscRollup,
  SAMPLE_FLOOR,
  type FscCatalog,
  type FscGroupRow,
} from '@/lib/intelligence/groups/fsc'
import type { CornerRow } from '@/lib/intelligence/corner'
import { buildAllDatasets } from '@/lib/intelligence/datasets'

import { alphaText, count, liftText, pct, pText } from '@/app/(app)/groups/format'
import {
  className,
  commercialRead,
  dominantGroup,
  evidenceChip,
  groupName,
  groupOptions,
  rateCell,
  rowViews,
  scopeLines,
  testSentence,
  verdict,
} from '@/app/(app)/groups/presentation'

/* ------------------------------------------------------------------------------ fixtures */

function row(nsn: string, opts: { sole?: boolean; silent?: number } = {}): CornerRow {
  return {
    niin: nsn.slice(4),
    nsn,
    nomenclature: 'TEST ITEM',
    quantity: 1,
    unitOfIssue: 'EA',
    solicitation: 'SPE1C126Q0000',
    returnDate: '2026-09-01',
    automatedSolicitation: null,
    approvedSources: [],
    approvedSourceCount: opts.sole ? 1 : 2,
    soleSource: opts.sole ?? false,
    signals: [],
    silentSourceCount: opts.silent ?? 0,
    availability: 'unknown_credential_absent',
    availabilityHolders: null,
    availabilityUnits: null,
    legsEstablished: 0,
    gaps: [],
  }
}

/** `n` rows in one class, `cand` of them candidate corners. */
function classOf(fsc: string, n: number, cand: number): CornerRow[] {
  return Array.from({ length: n }, (_, i) =>
    row(`${fsc}${String(i).padStart(9, '0')}`, i < cand ? { sole: true, silent: 1 } : {}),
  )
}

const catalog: FscCatalog = {
  ok: true,
  fsc: new Map([
    [
      '6505',
      {
        fsc: '6505',
        title: 'DRUGS AND BIOLOGICALS',
        notes: '',
        inclusions: 'INCLUDES VACCINES; SERUMS.',
        exclusions: 'EXCLUDES DRUGS IN VETERINARY PACKS (FSC 6509).',
      },
    ],
    ['5340', { fsc: '5340', title: 'HARDWARE, COMMERCIAL', notes: '', inclusions: '', exclusions: '' }],
  ]),
  fsg: new Map([
    ['65', { fsg: '65', title: 'MEDICAL, DENTAL, AND VETERINARY EQUIPMENT', notes: '' }],
    ['53', { fsg: '53', title: 'HARDWARE AND ABRASIVES', notes: '' }],
  ]),
  provenance: { fscFile: 'V_H2_FSC.CSV', fsgFile: 'V_H2_FSG.CSV', fscRows: 2, fsgRows: 2 },
}

/**
 * A board with all three states on it at once: an enriched class well clear of the
 * correction, a background class sitting on the baseline, and a class under the row floor.
 */
function mixedRollup() {
  const rows = [
    ...classOf('6505', 40, 20), // 50% against a low baseline: clears the correction
    ...classOf('5340', 300, 12), // 4%: on the baseline, testable, not distinguishable
    ...classOf('5306', 4, 3), // 75% on four rows, which is nothing
  ]
  return buildFscRollup(rows, catalog)
}

function pick(rollupGroups: FscGroupRow[], fsc: string): FscGroupRow {
  const found = rollupGroups.find((g) => g.fsc === fsc)
  if (!found) throw new Error(`fixture did not produce class ${fsc}`)
  return found
}

/* ------------------------------------------------------------------------------ the fixture
 * A fixture that did not actually produce the three states would let every assertion below
 * pass vacuously, so it is checked before it is used. */

describe('the fixture really does produce all three evidence states', () => {
  const rollup = mixedRollup()
  it('grades one class each way', () => {
    expect(pick(rollup.groups, '6505').evidence).toBe('significant')
    expect(pick(rollup.groups, '5340').evidence).toBe('indicative')
    expect(pick(rollup.groups, '5306').evidence).toBe('insufficient_sample')
    expect(rollup.tested).toBe(2)
  })
})

/* ----------------------------------------------------------------------------- the numbers */

describe('formatting never depends on a locale', () => {
  it('groups thousands by hand', () => {
    expect(count(0)).toBe('0')
    expect(count(186)).toBe('186')
    expect(count(1234)).toBe('1,234')
    expect(count(1234567)).toBe('1,234,567')
  })

  it('does not reach for toLocaleString anywhere in the formatter', () => {
    // The defect this guards is invisible to a value assertion run under en-US, because
    // toLocaleString AGREES with the hand-rolled output there. The only way to catch a
    // regression from a machine whose locale happens to match is to assert on the formatter
    // itself: a locale-dependent string that crosses the hydration boundary is React #418,
    // and this repo has shipped that defect three times.
    for (const fn of [count, pct, liftText, pText, alphaText]) {
      expect(fn.toString()).not.toContain('toLocale')
    }
  })

  it('renders rates, lifts, probabilities and thresholds at a readable precision', () => {
    expect(pct(0.0967741935483871)).toBe('9.7%')
    expect(liftText(2.6666)).toBe('2.7×')
    expect(pText(0.8694049397286877)).toBe('0.869')
    expect(pText(0.00018)).toBe('1.8e-4')
    expect(alphaText(0.05)).toBe('0.05')
    expect(alphaText(0.05 / 30)).toBe('0.0017')
  })
})

/* -------------------------------------------------------------------------- the rate cell */

describe('the rate cell says only what the evidence allows', () => {
  const rollup = mixedRollup()

  it('presents a significant class as a finding, with its lift', () => {
    const cell = rateCell(pick(rollup.groups, '6505'))
    expect(cell.kind).toBe('finding')
    if (cell.kind !== 'finding') throw new Error('unreachable')
    expect(cell.rate).toMatch(/^\d+\.\d%$/)
    expect(cell.lift).toContain('×')
  })

  it('shows an indicative rate and WITHHOLDS the lift entirely', () => {
    const source = pick(rollup.groups, '5340')
    // The rollup DID compute a lift for this class. The presentation layer is what refuses
    // to render it, so the input to this assertion has to carry one or the test proves
    // nothing about the refusal.
    expect(source.lift).not.toBeNull()

    const cell = rateCell(source)
    expect(cell.kind).toBe('measured')
    expect(Object.keys(cell)).not.toContain('lift')
    expect(JSON.stringify(cell)).not.toContain('×')
    if (cell.kind !== 'measured') throw new Error('unreachable')
    expect(cell.rate).toMatch(/^\d+\.\d%$/)
    expect(cell.note).toContain('not distinguishable')
  })

  it('gives an under-floor class counts only, with no percentage anywhere in the cell', () => {
    const source = pick(rollup.groups, '5306')
    expect(source.candidates).toBeGreaterThan(0) // 3 in 4 rows: 75%, and nothing
    const cell = rateCell(source)
    expect(cell.kind).toBe('untested')
    expect(JSON.stringify(cell)).not.toContain('%')
    if (cell.kind !== 'untested') throw new Error('unreachable')
    // The word is IN the cell, not in a footnote.
    expect(cell.word).toBe('not enough rows')
    expect(cell.why).toContain(String(SAMPLE_FLOOR))
  })
})

/* ------------------------------------------------------------------------------ the chips */

describe('the evidence chip', () => {
  it('uses olive, steel and the quietest tone, and never the clock or the accent', () => {
    expect(evidenceChip('significant').tone).toBe('verified')
    expect(evidenceChip('indicative').tone).toBe('active')
    expect(evidenceChip('insufficient_sample').tone).toBe('idle')
    for (const e of ['significant', 'indicative', 'insufficient_sample'] as const) {
      expect(['urgent', 'critical', 'accent']).not.toContain(evidenceChip(e).tone)
      // Shape and text, never colour alone: every chip carries its word.
      expect(evidenceChip(e).word.length).toBeGreaterThan(0)
      expect(evidenceChip(e).srLabel.length).toBeGreaterThan(0)
    }
  })

  it('prints the words the help registry told the operator to look for', () => {
    // `groups.evidence` says: act on the classes marked as tested and holding, treat the
    // ones marked indicative as somewhere to look. If the board prints different words the
    // explainer is instructions for a screen that does not exist.
    expect(evidenceChip('significant').word.toLowerCase()).toContain('tested and holding')
    expect(evidenceChip('indicative').word.toLowerCase()).toContain('indicative')
  })
})

/* -------------------------------------------------------------------------- stated absences */

describe('a missing title is stated, never papered over', () => {
  const noTitles = buildFscRollup(classOf('9999', 3, 1), { ok: false, reason: 'the tables are not in this data directory' })

  it('renders the absence of a class title instead of the bare code', () => {
    const row0 = noTitles.groups[0]!
    expect(row0.title).toBeNull()
    const name = className(row0)
    expect(name.stated).toBe(true)
    expect(name.name).toContain('no title')
    // The code must not be smuggled into the NAME slot dressed up as one.
    expect(name.name).not.toContain('9999')
  })

  it('renders the absence of a group title the same way', () => {
    const name = groupName(noTitles.groups[0]!)
    expect(name.stated).toBe(true)
    expect(name.name).toContain('no title')
  })

  it('passes the catalogue reason through verbatim for the page to print', () => {
    expect(noTitles.catalogAvailable).toBe(false)
    expect(noTitles.catalogReason).toBe('the tables are not in this data directory')
  })

  it('keeps every count real when the catalogue is gone', () => {
    expect(noTitles.groups[0]!.rows).toBe(3)
    expect(noTitles.groups[0]!.candidates).toBe(1)
  })
})

/* ------------------------------------------------------------------------- the scope prose */

describe('the government scope prose', () => {
  const rollup = mixedRollup()

  it('is carried word for word', () => {
    const lines = scopeLines(pick(rollup.groups, '6505'))
    expect(lines[0]!.value).toBe('INCLUDES VACCINES; SERUMS.')
    expect(lines[1]!.value).toBe('EXCLUDES DRUGS IN VETERINARY PACKS (FSC 6509).')
    expect(lines.every((l) => l.stated === false)).toBe(true)
  })

  it('states the absence where the table carries no line, rather than leaving a blank', () => {
    // A blank EXCLUDES reads as "this class excludes nothing", which is a claim.
    const lines = scopeLines(pick(rollup.groups, '5340'))
    expect(lines.every((l) => l.stated)).toBe(true)
    expect(lines[0]!.value).toContain('no includes line')
    expect(lines[1]!.value).toContain('no excludes line')
  })
})

/* ----------------------------------------------------------------------------- the verdict */

describe('the verdict is an answer in every branch', () => {
  it('reads as a real finding of nothing when no class clears the correction', () => {
    // Two testable classes, neither enriched: the significant set is empty by arithmetic,
    // not by an empty array or a failed load.
    const rollup = buildFscRollup([...classOf('5340', 200, 10), ...classOf('6505', 200, 10)], catalog)
    expect(rollup.groups.filter((g) => g.evidence === 'significant')).toHaveLength(0)

    const v = verdict(rollup)
    expect(v.significant).toBe(0)
    expect(v.headline).toContain('separates from the baseline')
    expect(v.body).toContain('That is the answer for this feed day')
    expect(v.body).toContain(String(rollup.tested))
    expect(v.body).toContain(alphaText(rollup.bonferroniAlpha))
    // Never the vocabulary of a failure.
    expect(v.headline.toLowerCase()).not.toMatch(/error|failed|unavailable|no data/)
  })

  it('says so plainly when nothing on the board even clears the row floor', () => {
    const rollup = buildFscRollup(classOf('5306', 4, 3), catalog)
    expect(rollup.tested).toBe(0)
    const v = verdict(rollup)
    expect(v.headline).toContain('holds enough rows')
    expect(v.body).toContain(String(SAMPLE_FLOOR))
  })

  it('names the finding when there is one', () => {
    const v = verdict(mixedRollup())
    expect(v.significant).toBe(1)
    expect(v.headline).toBe('One class separates from the baseline.')
  })
})

/* -------------------------------------------------------------------- the commercial read */

describe('the commercial read', () => {
  const rollup = mixedRollup()

  it('names its subject and refuses to oversell the sample', () => {
    const lines = commercialRead(pick(rollup.groups, '6505'), dominantGroup(rollup))
    const all = lines.join(' ')
    expect(all).toContain('6505 DRUGS AND BIOLOGICALS')
    expect(all).toContain('lead')
    expect(all).toContain('not as a strategy')
  })

  it('places the class against the group that actually holds most of the board', () => {
    const dominant = dominantGroup(rollup)
    expect(dominant?.fsg).toBe('53') // 300 rows against 40 and 4
    const all = commercialRead(pick(rollup.groups, '6505'), dominant).join(' ')
    expect(all).toContain('HARDWARE AND ABRASIVES')
  })

  it('drops the structural sentence when the class IS the dominant group', () => {
    // Otherwise the page would tell an operator that a class sits outside itself.
    const inDominant = commercialRead(pick(rollup.groups, '5340'), dominantGroup(rollup)).join(' ')
    expect(inDominant).not.toContain('It also sits outside')
  })
})

/* ------------------------------------------------------------------------ the test sentence */

describe('the test sentence carries the evidence, computed', () => {
  const rollup = mixedRollup()

  it('gives a tested class its p value and the corrected bar', () => {
    const source = pick(rollup.groups, '5340')
    const sentence = testSentence(source, rollup)
    expect(sentence).toContain(pText(source.pValue!))
    expect(sentence).toContain(alphaText(rollup.bonferroniAlpha))
    expect(sentence).toContain(pct(rollup.baseline))
  })

  it('tells an under-floor class why no test was run, and claims no rate', () => {
    const sentence = testSentence(pick(rollup.groups, '5306'), rollup)
    expect(sentence).toContain('No rate was computed and no test was run')
    expect(sentence).not.toContain('%')
  })
})

/* --------------------------------------------------------------------------- the view model */

describe('the row views handed to the board', () => {
  const rollup = mixedRollup()
  const views = rowViews(rollup)

  it('preserves the module ordering, and never reorders by rate', () => {
    const rank = { significant: 0, indicative: 1, insufficient_sample: 2 }
    const grades = rollup.groups.map((g) => rank[g.evidence])
    expect(grades).toEqual([...grades].sort((a, b) => a - b))
    // The views are the groups in the same order, one for one.
    expect(views.map((v) => v.fsc)).toEqual(rollup.groups.map((g) => g.fsc))
  })

  it('carries the raw candidate count for the filter rather than a parsed string', () => {
    for (const [i, v] of views.entries()) {
      expect(v.candidates).toBe(rollup.groups[i]!.candidates)
    }
  })

  it('carries the scope prose for the explainer verbatim', () => {
    const v = views.find((x) => x.fsc === '6505')!
    expect(v.scopeProse).toContain('INCLUDES VACCINES; SERUMS.')
    expect(v.scopeProse).toContain('EXCLUDES DRUGS IN VETERINARY PACKS (FSC 6509).')
  })

  it('states the absence in the explainer source line too', () => {
    const v = views.find((x) => x.fsc === '5340')!
    expect(v.scopeProse).toContain('no includes or excludes line')
  })
})

describe('the supply group filter options', () => {
  it('counts what the filter would actually leave on screen', () => {
    const rollup = mixedRollup()
    const options = groupOptions(rollup.groups)
    const hardware = options.find((o) => o.fsg === '53')!
    expect(hardware.label).toContain('HARDWARE AND ABRASIVES')
    expect(hardware.classes).toBe(rollup.groups.filter((g) => g.fsg === '53').length)
    expect(hardware.classes).toBe(2) // 5340 and 5306 both live in group 53
    // Ordered by how much of the board each group holds, widest first, so the operator's
    // first option is the lane with the most to work in.
    expect(options.map((o) => o.fsg)).toEqual(['53', '65'])
    expect(options.map((o) => o.rows)).toEqual([304, 40])
  })

  it('names a group with no title as untitled rather than printing the bare code twice', () => {
    const rollup = buildFscRollup(classOf('9999', 3, 1), { ok: false, reason: 'x' })
    expect(groupOptions(rollup.groups)[0]!.label).toContain('no title in the government table')
  })
})

/* --------------------------------------------------------------------------- the real board
 * The fixtures above were written by the same head as the code. This block is the one that
 * runs against the feed the product actually serves. */

describe('the served feed day, through the real rollup', () => {
  const rollup = buildFscRollup(buildAllDatasets().cornerMap.rows)
  const views = rowViews(rollup)

  it('renders no percentage on any class under the row floor', () => {
    const under = views.filter((v) => v.rate.kind === 'untested')
    expect(under.length).toBeGreaterThan(0)
    for (const v of under) expect(JSON.stringify(v.rate)).not.toContain('%')
  })

  it('renders no lift on any class that did not clear the correction', () => {
    for (const v of views.filter((v) => v.rate.kind === 'measured')) {
      expect(JSON.stringify(v.rate)).not.toContain('×')
    }
  })

  it('produces one view per class, in the rollup order', () => {
    expect(views).toHaveLength(rollup.totals.classes)
    expect(views.map((v) => v.fsc)).toEqual(rollup.groups.map((g) => g.fsc))
  })

  it('gives the verdict block something true to say whatever the arithmetic returns', () => {
    const v = verdict(rollup)
    expect(v.headline.length).toBeGreaterThan(0)
    expect(v.body).toContain(pct(rollup.baseline))
    expect(v.significant).toBe(rollup.groups.filter((g) => g.evidence === 'significant').length)
  })
})
