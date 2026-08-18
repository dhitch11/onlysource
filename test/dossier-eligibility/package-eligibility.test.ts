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

const IDX: AmscIndex = {
  ok: true,
  rows: new Map([
    ['017053574', { niin: '017053574', amc: '3', amsc: 'P', aac: '', pica: 'GX' }],
    ['017053575', { niin: '017053575', amc: '', amsc: '', aac: '', pica: 'ZW' }],
    ['017053576', { niin: '017053576', amc: '1', amsc: 'G', aac: '', pica: 'GX' }],
  ]),
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
    expect(text).toContain('AMSC P, VERIFIED verbatim')
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

  it('a number inside a verbatim government quote IS grounded, because the package contains it', () => {
    // The contrast that makes the rule legible: 90 is in the package as the Master Solicitation's
    // own "minimum of 90 days validity period", so a memo may state it. 565 is a line number in a
    // file path and may not.
    expect(allowedNumberSet(pkg()).has('90')).toBe(true)
  })
})
