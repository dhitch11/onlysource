/**
 * THE PURSUIT PACKAGE CARRIES ELIGIBILITY, OR THE MEMO CANNOT STATE IT.
 *
 * The memo is written by a model that may quote nothing outside the package, so a fact that is
 * not in the package is a fact the flagship deliverable structurally cannot mention. Before this
 * wave the package carried the corner dossier, the economics, the supplier book and the gaps, and
 * carried NO eligibility at all: the memo could recommend pursuing an item whose acquisition codes
 * say a new manufacturing source cannot be approved, and never say so.
 *
 * These tests pin three things: the field is on the package, its sentences reach the two arrays
 * the memo prompt is required to name (gaps and next steps), and the downloaded document renders
 * the block deterministically so the artifact carries it whether or not the model mentioned it.
 *
 * The last block is about the grounding guard. Adding provenance to the package widens the set of
 * numbers a memo is allowed to state, and a document line number blessed as a spendable figure is
 * a real regression in a real control. That is measured here rather than asserted.
 */
import { describe, expect, it } from 'vitest'

import type { CornerRow } from '@/lib/intelligence/corner'
import { buildCornerDossier } from '@/lib/intelligence/brief/dossier'
import { buildPursuitPackage, packageMarkdown } from '@/lib/intelligence/brief/package'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { allowedNumberSet, groundBrief } from '@/lib/ai/grounding'
import {
  ELIGIBILITY_NOT_RESOLVED,
  resolveDossierEligibility,
} from '@/lib/intelligence/eligibility/dossier-eligibility'
import type { AmscIndex } from '@/lib/intelligence/eligibility/bid-eligibility'

const FIXTURE_ROWS = new Map([
    ['017053574', { niin: '017053574', amc: '3', amsc: 'P', aac: '', pica: 'GX' }],
    ['017053575', { niin: '017053575', amc: '', amsc: '', aac: '', pica: 'ZW' }],
    ['017053576', { niin: '017053576', amc: '1', amsc: 'G', aac: '', pica: 'GX' }],
  ])

const IDX: AmscIndex = {
  ok: true,
  lookup: (n: string) => FIXTURE_ROWS.get(n),
  size: FIXTURE_ROWS.size,
  backing: 'binary' as const,
  niins: () => [...FIXTURE_ROWS.keys()],
  publishers: new Map([['GX', { rows: 10000, withAmsc: 10000, rate: 1 }]]),
  provenance: {},
}

/*
 * Spread rather than a bare literal so a field another lane is adding to `CornerRow` in this same
 * wave cannot fail this file on an excess-property check while their edit is in flight. Every
 * field this package actually reads is set explicitly below.
 */
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

function build(over: Partial<CornerRow> = {}, eligibility?: ReturnType<typeof resolveDossierEligibility>) {
  const row = { ...rowSeed, ...over } as CornerRow
  const dossier = buildCornerDossier(row, null, null, scoreCorner(row, null, null))
  return buildPursuitPackage({ row, dossier, award: null, byCage: null, savedPacketCount: 0, eligibility })
}

const verdictFor = (row: { nsn: string; solicitation: string }) =>
  resolveDossierEligibility({ stockNumber: row.nsn, solicitationNumber: row.solicitation }, IDX)

describe('the assembled package carries eligibility as a first-class field', () => {
  it('★ CONTROL: the verdict is ON the package, and it is the caller\'s object, not a copy', () => {
    const verdict = verdictFor(rowSeed)
    const pkg = build({}, verdict)
    expect(pkg.eligibility.kind).toBe('dossier_eligibility')
    // Identity, not equality: the panel and the memo must read one object, so a package that
    // rebuilt or trimmed the verdict would be two sources of one fact.
    expect(pkg.eligibility).toBe(verdict)
  })

  it('★ CONTROL: the eligibility sentences reach the gaps, which the memo prompt must name', () => {
    const pkg = build({}, verdictFor(rowSeed))
    const gaps = pkg.gaps.join('\n')
    expect(gaps).toContain('Bid eligibility:')
    expect(gaps).toContain('closed to a new manufacturing source')
    expect(gaps).toContain('out of automated award')
    // First, ahead of the dossier's own gaps: it is the only gap that can say the operator should
    // not be doing this at all.
    expect(pkg.gaps[0]).toContain('Bid eligibility:')
  })

  it('the stance is in the plan on every package, including one with no caution at all', () => {
    // An open code (AMSC G) on the automated lane (T): the one combination that produces no
    // caution at all. The stance sentence still has to be in the plan, because a plan that
    // mentions eligibility only when it is adverse teaches an operator that silence means clear.
    const clean = { ...rowSeed, niin: '017053576', nsn: '5325017053576', solicitation: 'SPE4A626T15HA' }
    const pkg = build(clean as Partial<CornerRow>, verdictFor(clean))
    expect(pkg.eligibility.kind === 'dossier_eligibility' && pkg.eligibility.cautions).toEqual([])
    expect(pkg.nextSteps.join('\n')).toContain('not legal advice and not a clearance')
  })

  it('an abstaining verdict reaches the plan as an abstention, never as silence', () => {
    const row = { ...rowSeed, niin: '017053575', nsn: '5325017053575' }
    const pkg = build(row as Partial<CornerRow>, verdictFor(row))
    expect(pkg.nextSteps.join('\n')).toContain('neither clears it nor bars it')
    expect(pkg.gaps.join('\n')).toContain('does not publish acquisition codes')
  })

  it('the row is never suppressed: a closed posture still produces a full package', () => {
    const pkg = build({}, verdictFor(rowSeed))
    expect(pkg.kind).toBe('pursuit_package')
    expect(pkg.nextSteps.length).toBeGreaterThan(3)
    expect(pkg.requirement.solicitation).toBe('SPE7L426U1037')
  })
})

describe('a caller that does not resolve eligibility gets an abstention, never a permission', () => {
  it('★ CONTROL: the default is the not-resolved verdict, word for word', () => {
    const pkg = build({})
    // Pins the literal `package.ts` spells out (it cannot import the constant without dragging
    // node:fs into the client bundle) to the constant itself. If either drifts, this fails.
    expect(pkg.eligibility).toEqual(ELIGIBILITY_NOT_RESOLVED)
  })

  it('the not-resolved sentence reaches the gaps, the plan and the document', () => {
    const pkg = build({})
    expect(pkg.gaps[0]).toContain('was not resolved')
    expect(pkg.nextSteps.join('\n')).toContain('was not resolved')
    expect(packageMarkdown(pkg, 'THE OPPORTUNITY\nA memo.', 'claude-opus-5')).toContain('not a finding that the item is unrestricted')
  })
})

describe('the downloaded document renders eligibility deterministically', () => {
  const md = () => packageMarkdown(build({}, verdictFor(rowSeed)), 'THE OPPORTUNITY\nA memo.', 'claude-opus-5')

  it('★ CONTROL: the block exists, above the measured appendix', () => {
    const text = md()
    expect(text).toContain('## Bid eligibility')
    expect(text.indexOf('## Bid eligibility')).toBeLessThan(text.indexOf('## The measured package'))
  })

  it('renders the VERIFIED government text and the ESTIMATED grouping as different claims', () => {
    const text = md()
    // The code is written as a token, `AMSC-P`, and the hyphen is load-bearing: it is what keeps
    // the memo's number guard from reading a bare government code as a spendable quantity.
    expect(text).toContain('AMSC-P, VERIFIED verbatim')
    // The document still names the source in full. The digits live in the RENDERED label, which
    // is looked up from the engine's own citation at document time and is not on the package.
    expect(text).toContain('Table 71')
    expect(text).toContain('not owned by the Government and cannot be purchased')
    expect(text).toContain('ESTIMATED by us and NOT a government statement')
    expect(text).toContain('restricted, closed to a new manufacturing source')
  })

  it('renders the lane consequence and the stance', () => {
    expect(md()).toContain('Award lane:')
    expect(md()).toContain('out of automated award')
    expect(md()).toContain('Stance:')
  })

  it('HOUSE LAW: no em dash in the eligibility block', () => {
    const block = md().split('## Bid eligibility')[1]!.split('## The measured package')[0]!
    expect(block).not.toMatch(/—/)
  })
})

describe('the grounding guard is not widened by provenance', () => {
  const pkg = () => build({}, verdictFor(rowSeed))

  it('★ CONTROL: no citation line number becomes a number the memo may state', () => {
    const allowed = allowedNumberSet(pkg())
    // The pins carried by this package, in raw form, are dla-procurement-mechanics.md:452-457
    // (the AIDC exception paragraph) and nsn-cataloging-and-interchangeability.md:523-546 and
    // :553-564 and :565. None of those may be spendable figures. If `pinned()` stops rewriting
    // them, this fails.
    for (const n of ['452', '457', '523', '546', '553', '564', '565']) {
      expect(allowed.has(n)).toBe(false)
    }
    const out = groundBrief('THE ECONOMICS\nThe holder lists 565 units on the shelf.', pkg())
    expect(out.stripped).toHaveLength(1)
  })

  /*
   * THE CLAIM THIS BLOCK USED TO MAKE HAS BEEN STRUCK, ON MEASUREMENT.
   *
   * It used to assert that 90 IS grounded, "because the package contains it": the Master
   * Solicitation's own phrase "the minimum of 90 days validity period" travelled inside a
   * citation quote. That reasoning was circular. The quote was on the package only because the
   * citation copied it, nothing rendered it anywhere, and its only effect was to license the
   * memo to write "90" as a quantity about anything at all. The quote is no longer copied (see
   * `lib/intelligence/eligibility/citation.ts`), so 90 is no longer spendable, and the document
   * lost nothing because it never showed that sentence.
   */
  it('★ CONTROL: a document number inside a citation is not a figure the memo may state', () => {
    const allowed = allowedNumberSet(pkg())
    for (const n of ['71', '4100', '90', '7', '4']) {
      expect(allowed.has(n)).toBe(false)
    }
  })

  it('★ CONTROL: the three fabricated counts the reviewer measured are stripped again', () => {
    /*
     * MEASURED on this exact fixture, whose true approvedSourceCount is 1: each of these was
     * stripped by the guard before the eligibility field existed and survived it afterwards,
     * because `Table 71` blessed 71, `section 7` blessed 7 and `Chapter 4` blessed 4. The memo
     * prints "No number appears that this build did not measure" directly above this content.
     */
    for (const claim of [
      'THE SUPPLY\nThere are 71 approved sources on this part.',
      'THE ECONOMICS\nThe last buy ran 7 units.',
      'THE SUPPLY\nFour of the 4 holders list stock.',
    ]) {
      expect(groundBrief(claim, pkg()).stripped).toHaveLength(1)
    }
  })

  it('★ CONTROL: a real package names no person and no path off this machine', () => {
    /*
     * MEASURED on the first live corner row with a solicitation, before the fix:
     * `JSON.stringify(pkg).includes('Wayne')` true, `.includes('/Users/')` true, five distinct
     * absolute paths, and both false with the eligibility field deleted. The route stringifies
     * the whole package as the memo's user message, so anything here is something the model is
     * told it may say.
     */
    const json = JSON.stringify(pkg())
    expect(json).not.toContain('/Users/')
    expect(json).not.toContain('Wayne')
    expect(json).not.toMatch(/(?:^|[\s"'(=])\/[A-Za-z0-9._-]+\//)
  })

  it('the provenance a reader can act on is still there: a file and a line, in one command', () => {
    const el = pkg().eligibility
    expect(el.kind).toBe('dossier_eligibility')
    if (el.kind !== 'dossier_eligibility') return
    expect(el.amsc?.citation.pin).toBe('nsn-cataloging-and-interchangeability.md:L523-L546')
  })
})
