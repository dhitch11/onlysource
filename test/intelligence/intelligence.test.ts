/**
 * T4 INTELLIGENCE. The tests that must be able to fail.
 *
 * Each block states the defect it is defending against, because a test whose failure mode is
 * not obvious gets deleted by the next person who sees it go red.
 *
 * The seed-workbook block reads the REAL operator files. It skips, loudly, if they are absent,
 * rather than passing vacuously, because a green run over zero files is the exact shape of the
 * check that reports success while measuring nothing.
 */

import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'

import { abstain, sealClaim, EvidenceContractViolation, evidenceRank, atOrAboveClass, EQUIVALENCE_GENERATORS } from '@/lib/intelligence/evidence'
import { parseNsn, parseCage, parseSolicitation, toNiin, formatNsn } from '@/lib/intelligence/niin'
import { isIdentityGradeReference, readDealerEligibility, PHRASE_CODES, iscIndicatesDeadItem } from '@/lib/intelligence/codebook'
import {
  generateSameSourceIdentity,
  generateCrossCompanyCollision,
  generateWeakReferenceOverlap,
  buildRecordedGraph,
  subtractRecordedGraph,
  type PartRow,
} from '@/lib/intelligence/generators'
import { adjudicate, compareValues, parseValue, validateExplanation, decideVerdict, type CharacteristicRow } from '@/lib/intelligence/adjudicate'
import { evaluateMonopoly, summarizeMap, evaluateCross, invertManufacturer, type SourceStatusReading, type ApprovedSourceRow, type DemandReading } from '@/lib/intelligence/monopoly'
import { assessDistress, describeDistress, type SupplierSignals } from '@/lib/intelligence/distressed'
import { readSeedWorkbook, excelSerialToIso, usDateToIso } from '@/lib/intelligence/seed/xlsx'
import { seedPath } from '@/lib/data-root'

const AS_OF = '2026-08-13T00:00:00.000Z'

const overturn = { label: 'not a real monopoly', claimKey: 'k', reevaluateOnChange: ['source status'] }
const row = (table: string) => ({ table, key: { NIIN: '015277013' }, fields: { RNVC: '2' }, observedAt: AS_OF })

/* =================================================================================== */
describe('evidence contract: Law 1 is enforced at construction, not by convention', () => {
  it('refuses a claim with zero supporting rows', () => {
    expect(() =>
      sealClaim({
        claim: 'these two items are the same part',
        surface: 'equivalence',
        generator: 'same_source_identity',
        evidenceClass: 'near_conclusive',
        verdict: 'IDENTICAL',
        provenance: 'measured',
        confirmationState: 'CONFIRMED',
        supportingRows: [],
        gaps: [],
        counterfactual: null,
        asOf: AS_OF,
        signals: [],
        movedFigures: [],
        overturn,
      }),
    ).toThrow(EvidenceContractViolation)
  })

  it('refuses a conclusive class with no government-recorded row behind it', () => {
    expect(() =>
      sealClaim({
        claim: 'the government recorded these as interchangeable',
        surface: 'equivalence',
        generator: 'recorded_interchangeability',
        evidenceClass: 'conclusive',
        verdict: 'IDENTICAL',
        provenance: 'measured',
        confirmationState: 'CONFIRMED',
        supportingRows: [row('V_FLIS_PART')], // not one of the three recorded tables
        gaps: [],
        counterfactual: null,
        asOf: AS_OF,
        signals: [],
        movedFigures: [],
        overturn,
      }),
    ).toThrow(/conclusive is reserved/)
  })

  it('ACCEPTS conclusive when a recorded table is present (the positive control)', () => {
    const env = sealClaim({
      claim: 'the government recorded these as interchangeable',
      surface: 'equivalence',
      generator: 'recorded_interchangeability',
      evidenceClass: 'conclusive',
      verdict: 'IDENTICAL',
      provenance: 'measured',
      confirmationState: 'CONFIRMED',
      supportingRows: [row('V_FLIS_PHRASE')],
      gaps: [],
      counterfactual: null,
      asOf: AS_OF,
      signals: [],
      movedFigures: [],
      overturn,
    })
    expect(env.evidenceClass).toBe('conclusive')
  })

  it('refuses a supporting row with no observation date, because a claim is about a night', () => {
    expect(() =>
      sealClaim({
        claim: 'x', surface: 'monopoly', generator: 'dead_source_live_demand',
        evidenceClass: 'strong_lead', verdict: 'IDENTICAL', provenance: 'measured',
        confirmationState: 'CONFIRMED',
        supportingRows: [{ table: 'V_FLIS_PART', key: {}, fields: {}, observedAt: '' }],
        gaps: [], counterfactual: null, asOf: AS_OF, signals: [], movedFigures: [], overturn,
      }),
    ).toThrow(/observation date/)
  })

  it('refuses an abstention that names no gap, because that is a shrug', () => {
    expect(() =>
      abstain({
        claim: 'cannot say', surface: 'equivalence', generator: 'same_source_identity',
        reason: 'no data', reasonCode: 'no_shared_characteristics', gaps: [], asOf: AS_OF, overturn,
      }),
    ).toThrow(/names no gap/)
  })

  it('abstention produces the honest empty state rather than a weak assertion', () => {
    const env = abstain({
      claim: 'insufficient characteristics to compare these items',
      surface: 'equivalence', generator: 'same_source_identity',
      reason: 'one side carries no characteristics', reasonCode: 'no_shared_characteristics',
      gaps: [{ what: 'characteristics for 011805372', why: 'not in the loaded extract', restrictedNotAbsent: false }],
      asOf: AS_OF, overturn,
    })
    expect(env.verdict).toBe('INSUFFICIENT_DATA')
    expect(env.provenance).toBe('insufficient')
  })

  it('keeps the generator set closed at exactly five', () => {
    expect(EQUIVALENCE_GENERATORS).toHaveLength(5)
    expect(EQUIVALENCE_GENERATORS).not.toContain('characteristic_equality' as never)
  })

  it('orders evidence classes strongest first so the shelf floor control works', () => {
    expect(evidenceRank('conclusive')).toBeLessThan(evidenceRank('weak_lead'))
    expect(atOrAboveClass('near_conclusive', 'strong_lead')).toBe(true)
    expect(atOrAboveClass('weak_lead', 'near_conclusive')).toBe(false)
  })
})

/* =================================================================================== */
describe('the key: NIIN, not the full stock number', () => {
  it('resolves the two spellings that appear in ONE real seed workbook to the same key', () => {
    // Measured in no_quote_matches.xlsx: `nsn` carries hyphens, `supplier_alt_part_number`
    // carries slashes, same item. A join on either raw string finds nothing.
    expect(toNiin('6530-00-299-8353')).toBe('002998353')
    expect(toNiin('6530/00/299/8353')).toBe('002998353')
  })

  it('accepts a bare NIIN and reports the class as absent rather than inventing one', () => {
    const p = parseNsn('002998353')
    expect(p?.niin).toBe('002998353')
    expect(p?.fsc).toBeNull()
  })

  it('refuses a part number rather than coercing it into a key', () => {
    expect(parseNsn('CA28085-3B-2')).toBeNull()
    expect(parseNsn('')).toBeNull()
    expect(parseNsn('12345')).toBeNull()
  })

  it('formats for display without becoming a join key', () => {
    expect(formatNsn('6530', '002998353')).toBe('6530-00-299-8353')
  })

  it('reads the ninth character that decides whether an alternate offer can win', () => {
    // Both spellings appear in the real seeds: separated and unseparated.
    expect(parseSolicitation('SPE4A5-26-T-8786')?.automated).toBe(true)
    expect(parseSolicitation('SPE2DH26T2029')?.automated).toBe(true)
    expect(parseSolicitation('SPE4A626D801P')?.automated).toBe(false)
  })

  it('validates company codes and rejects malformed ones', () => {
    expect(parseCage('89yt2')).toBe('89YT2')
    expect(parseCage('123')).toBeNull()
  })
})

/* =================================================================================== */
describe('codebooks: the filters that stop 184,000 false equivalences', () => {
  it('accepts only variation code 2 as identity grade', () => {
    expect(isIdentityGradeReference('3', '2')).toBe(true)
    expect(isIdentityGradeReference('3', '1')).toBe(false)
    expect(isIdentityGradeReference('3', '9')).toBe(false)
  })

  it('excludes the three category codes that light up a naive join', () => {
    expect(isIdentityGradeReference('C', '2')).toBe(false) // advisory, recordable against many
    expect(isIdentityGradeReference('D', '2')).toBe(false) // excluded from item-of-supply by rule
    expect(isIdentityGradeReference('7', '2')).toBe(false) // vendor item drawing, not a part id
  })

  it('models the graph as directed, so a one-way edge is not reversible', () => {
    expect(PHRASE_CODES['F']?.direction).toBe('forward')
    expect(PHRASE_CODES['J']?.direction).toBe('symmetric')
    expect(PHRASE_CODES['E']?.direction).toBe('paired')
  })

  it('keeps surplus supply separate from new-source manufacturing', () => {
    // The defect this defends: reading a restricted suffix as "no bid" suppresses the best
    // leads in the business. It bars new MANUFACTURING, not supply of the approved article.
    const restricted = readDealerEligibility('3', 'P')
    expect(restricted.manufacturing).toBe('closed_to_new_manufacturing')
    expect(restricted.surplusSupplyOpen).toBe(true)

    const open = readDealerEligibility('1', 'G')
    expect(open.manufacturing).toBe('open')
    expect(open.unknown).toBe(false)
  })

  it('returns unknown rather than defaulting when a code is missing', () => {
    const e = readDealerEligibility(null, null)
    expect(e.unknown).toBe(true)
    expect(e.surplusSupplyOpen).toBe(false)
  })

  it('flags the standardization codes that mark an item unprocurable', () => {
    expect(iscIndicatesDeadItem('3')).toBe(true)
    expect(iscIndicatesDeadItem('E')).toBe(true)
    expect(iscIndicatesDeadItem('2')).toBe(false)
  })
})

/* =================================================================================== */
describe('generators: the corpus case, which proves both joins are required', () => {
  // The real worked case. One part string under TWO different companies. The identity join
  // structurally cannot see this pair; the cross-company join is the only thing that finds it.
  const parts: PartRow[] = [
    { NIIN: '015277013', PART_NUMBER: 'CA28085-3B-2', CAGE_CODE: '04939', RNCC: '3', RNVC: '2' },
    { NIIN: '011805372', PART_NUMBER: 'CA28085-3B-2', CAGE_CODE: '29372', RNCC: '3', RNVC: '2' },
  ]

  it('the identity join does NOT find the cross-company pair', () => {
    expect(generateSameSourceIdentity(parts)).toHaveLength(0)
  })

  it('the cross-company generator DOES find it, at a lower evidence class', () => {
    const found = generateCrossCompanyCollision(parts)
    expect(found).toHaveLength(1)
    expect(found[0]?.evidenceClass).toBe('strong_lead')
    expect(found[0]?.generator).toBe('cross_company_collision')
  })

  it('the identity join finds a same-company pair, at near-conclusive', () => {
    const same: PartRow[] = [
      { NIIN: '015277013', PART_NUMBER: 'X-1', CAGE_CODE: '04939', RNCC: '3', RNVC: '2' },
      { NIIN: '011805372', PART_NUMBER: 'X-1', CAGE_CODE: '04939', RNCC: '3', RNVC: '2' },
    ]
    const found = generateSameSourceIdentity(same)
    expect(found).toHaveLength(1)
    expect(found[0]?.evidenceClass).toBe('near_conclusive')
  })

  it('drops the pair entirely when the variation code is not identity grade', () => {
    // This is the 30-fold collapse in miniature. Same strings, weaker codes, no identity pair.
    const weak: PartRow[] = parts.map((p) => ({ ...p, RNVC: '1' }))
    expect(generateCrossCompanyCollision(weak)).toHaveLength(0)
    expect(generateSameSourceIdentity(weak)).toHaveLength(0)
    expect(generateWeakReferenceOverlap(weak)).toHaveLength(1) // surfaced as a labeled lead
  })

  it('does not double-report a pair across the identity and weak generators', () => {
    expect(generateWeakReferenceOverlap(parts)).toHaveLength(0)
  })

  it('subtracts what the government already recorded, and reports how much', () => {
    const recorded = buildRecordedGraph({
      phrases: [{ NIIN: '015277013', PHRS_CD: 'J', RELATED_NIIN: '011805372' }],
    })
    const result = subtractRecordedGraph(generateCrossCompanyCollision(parts), recorded)
    expect(result.residual).toHaveLength(0)
    expect(result.subtractedCount).toBe(1)
  })

  it('reads the related stock number from the standardization table by its last nine digits', () => {
    const recorded = buildRecordedGraph({
      standardization: [{ NIIN: '015277013', RELATED_NSN: '5365011805372', ISC: '3' }],
    })
    expect(recorded.has('011805372|015277013')).toBe(true)
  })

  it('never subtracts the recorded generator from itself', () => {
    const recorded = buildRecordedGraph({
      phrases: [{ NIIN: '015277013', PHRS_CD: 'J', RELATED_NIIN: '011805372' }],
    })
    const g1 = [{ a: '015277013', b: '011805372', generator: 'recorded_interchangeability' as const, evidenceClass: 'conclusive' as const, basis: [] }]
    expect(subtractRecordedGraph(g1, recorded).residual).toHaveLength(1)
  })
})

/* =================================================================================== */
describe('adjudicator: the comparator that stops the documented failure', () => {
  it('intersects ranges rather than comparing them as strings', () => {
    const a = parseValue('BETWEEN 0.422 AND 0.452 INCHES')
    const b = parseValue('BETWEEN 0.440 AND 0.470 INCHES')
    expect(a.kind).toBe('interval')
    expect(compareValues(a, b).bucket).toBe('agree')
  })

  it('reports non-overlapping ranges as a conflict', () => {
    expect(
      compareValues(parseValue('BETWEEN 0.100 AND 0.200 INCHES'), parseValue('BETWEEN 0.300 AND 0.400 INCHES')).bucket,
    ).toBe('conflict')
  })

  it('converts between length units rather than comparing the numbers raw', () => {
    expect(compareValues(parseValue('1.000 INCHES'), parseValue('25.4 MM')).bucket).toBe('agree')
  })

  it('CONFLICTS on units it cannot reconcile, instead of silently passing', () => {
    // The defect: comparing 12 of one unit against 12 of another as equal ships wrong metal.
    expect(compareValues(parseValue('12 EA'), parseValue('12 LB')).bucket).toBe('conflict')
  })

  it('conflicts when a unit is present on one side only', () => {
    expect(compareValues(parseValue('0.375 INCHES'), parseValue('0.375')).bucket).toBe('conflict')
  })

  it('refuses to read a number out of free text', () => {
    expect(parseValue('SEE DRAWING 12345').kind).toBe('text')
  })

  it('puts an attribute recorded on one side only in its own bucket and names it as a gap', () => {
    const a: CharacteristicRow[] = [
      { NIIN: 'A', MRC: 'ABHP', REQUIREMENTS_STATEMENT: 'THREAD SERIES', CLEAR_TEXT_REPLY: 'UNJF' },
      { NIIN: 'A', MRC: 'ADAV', REQUIREMENTS_STATEMENT: 'HEAD DIAMETER', CLEAR_TEXT_REPLY: '0.400 INCHES' },
    ]
    const b: CharacteristicRow[] = [
      { NIIN: 'B', MRC: 'ABHP', REQUIREMENTS_STATEMENT: 'THREAD SERIES', CLEAR_TEXT_REPLY: 'UNJF' },
    ]
    const diff = adjudicate('A', 'B', a, b)
    expect(diff.onlyACount).toBe(1)
    expect(diff.gaps.join(' ')).toContain('HEAD DIAMETER')
    // Exactly the corpus failure: head diameter absent on one side must NOT read as agreement.
    expect(diff.verdict).not.toBe('IDENTICAL')
  })

  it('returns INSUFFICIENT_DATA when too few attributes are shared', () => {
    const a: CharacteristicRow[] = [{ NIIN: 'A', MRC: 'ABHP', REQUIREMENTS_STATEMENT: 'T', CLEAR_TEXT_REPLY: 'UNJF' }]
    const b: CharacteristicRow[] = [{ NIIN: 'B', MRC: 'ABHP', REQUIREMENTS_STATEMENT: 'T', CLEAR_TEXT_REPLY: 'UNJF' }]
    expect(adjudicate('A', 'B', a, b).verdict).toBe('INSUFFICIENT_DATA')
  })

  it('lets one conflict decide, however much else agrees', () => {
    expect(decideVerdict({ sharedCount: 20, agreeCount: 19, conflictCount: 1, onlyACount: 0, onlyBCount: 0, minimumShared: 3 })).toBe('CONFLICT')
  })

  it('returns IDENTICAL only when nothing is unmatched on either side', () => {
    expect(decideVerdict({ sharedCount: 5, agreeCount: 5, conflictCount: 0, onlyACount: 0, onlyBCount: 0, minimumShared: 3 })).toBe('IDENTICAL')
    expect(decideVerdict({ sharedCount: 5, agreeCount: 5, conflictCount: 0, onlyACount: 1, onlyBCount: 0, minimumShared: 3 })).toBe('CONFIRM_WITH_EXCEPTIONS')
  })

  it('catches an explanation that invents a measurement', () => {
    const diff = adjudicate(
      'A', 'B',
      [{ NIIN: 'A', MRC: 'ABHP', REQUIREMENTS_STATEMENT: 'THREAD', CLEAR_TEXT_REPLY: 'UNJF' }],
      [{ NIIN: 'B', MRC: 'ABHP', REQUIREMENTS_STATEMENT: 'THREAD', CLEAR_TEXT_REPLY: 'UNJF' }],
    )
    // The real failure: a head diameter that appears in no catalog reply, narrated confidently.
    const violations = validateExplanation('The head diameter is approximately 0.375 inches.', diff)
    expect(violations.some((v) => v.kind === 'introduced_measurement')).toBe(true)
  })

  it('catches an explanation citing an attribute code that is not in the diff', () => {
    const diff = adjudicate(
      'A', 'B',
      [{ NIIN: 'A', MRC: 'ABHP', REQUIREMENTS_STATEMENT: 'THREAD', CLEAR_TEXT_REPLY: 'UNJF' }],
      [{ NIIN: 'B', MRC: 'ABHP', REQUIREMENTS_STATEMENT: 'THREAD', CLEAR_TEXT_REPLY: 'UNJF' }],
    )
    expect(validateExplanation('Attribute ADAV agrees on both sides.', diff).some((v) => v.kind === 'unknown_attribute_code')).toBe(true)
  })

  it('PASSES a faithful explanation, so the guard is not simply always red', () => {
    const diff = adjudicate(
      'A', 'B',
      [{ NIIN: 'A', MRC: 'ABHP', REQUIREMENTS_STATEMENT: 'THREAD', CLEAR_TEXT_REPLY: 'UNJF' }],
      [{ NIIN: 'B', MRC: 'ABHP', REQUIREMENTS_STATEMENT: 'THREAD', CLEAR_TEXT_REPLY: 'UNJF' }],
    )
    expect(validateExplanation('ABHP agrees on both sides. No other attribute was shared.', diff)).toHaveLength(0)
  })
})

/* =================================================================================== */
describe('monopoly map: an unknown source is never a dead one', () => {
  const src = (cage: string): ApprovedSourceRow => ({ NIIN: 'N1', CAGE_CODE: cage, PART_NUMBER: 'P', COMPANY_NAME: 'C', observedAt: AS_OF })
  const status = (cage: string, s: SourceStatusReading['status']): SourceStatusReading => ({ cage, status: s, observedAt: AS_OF, grade: 'recorded_status', evidence: [] })
  const demand: DemandReading = { basis: 'solicitation_recurrence', source: 'daily feed', observedAt: AS_OF, quantity: 3, nonBinding: false }
  const available = { known: true as const, unitsAvailable: 4, holders: 2, observedAt: AS_OF, source: 'locator' }

  it('counts a genuine corner in the headline', () => {
    const r = evaluateMonopoly({
      niin: 'N1', approvedSources: [src('AAAAA')],
      statuses: new Map([['AAAAA', status('AAAAA', 'inactive')]]),
      demand, availability: available, amc: '1', amsc: 'G',
    })
    expect(r.isOnlyApprovedSource).toBe(true)
    expect(r.countsTowardHeadline).toBe(true)
  })

  it('does NOT count an unresolved source as dead, and excludes it from the headline', () => {
    const r = evaluateMonopoly({
      niin: 'N1', approvedSources: [src('AAAAA')],
      statuses: new Map(), // status could not be resolved
      demand, availability: available, amc: '1', amsc: 'G',
    })
    expect(r.sourceStatus).toBe('unknown')
    expect(r.unknownStatus).toBe(true)
    expect(r.countsTowardHeadline).toBe(false)
    expect(r.gaps.join(' ')).toContain('could not be resolved')
  })

  it('does not call a dead source among live ones a monopoly', () => {
    const r = evaluateMonopoly({
      niin: 'N1', approvedSources: [src('AAAAA'), src('BBBBB')],
      statuses: new Map([['AAAAA', status('AAAAA', 'inactive')], ['BBBBB', status('BBBBB', 'active')]]),
      demand, availability: available, amc: '1', amsc: 'G',
    })
    expect(r.isOnlyApprovedSource).toBe(false)
    expect(r.countsTowardHeadline).toBe(false)
  })

  it('treats a merger as survival, not death', () => {
    const r = evaluateMonopoly({
      niin: 'N1', approvedSources: [src('AAAAA')],
      statuses: new Map([['AAAAA', status('AAAAA', 'merged')]]),
      demand, availability: available, amc: '1', amsc: 'G',
    })
    expect(r.countsTowardHeadline).toBe(false)
  })

  it('surfaces a live awardee as disconfirming evidence and drops the row from the headline', () => {
    const r = evaluateMonopoly({
      niin: 'N1', approvedSources: [src('AAAAA')],
      statuses: new Map([['AAAAA', status('AAAAA', 'inactive')]]),
      demand, availability: available, amc: '1', amsc: 'G',
      liveAwardees: [{ cage: 'ZZZZZ', lastAwardAt: '2026-06-01' }],
    })
    expect(r.liveAwardeeCount).toBe(1)
    expect(r.countsTowardHeadline).toBe(false)
    expect(r.reasons.join(' ')).toContain('contradicts')
  })

  it('flags substitution risk, because an equivalence can destroy a corner', () => {
    const r = evaluateMonopoly({
      niin: 'N1', approvedSources: [src('AAAAA')],
      statuses: new Map([['AAAAA', status('AAAAA', 'inactive')]]),
      demand, availability: available, amc: '1', amsc: 'G',
      adjudicatedEquivalents: ['N2'],
    })
    expect(r.substitutionRisk).toBe(true)
  })

  it('reports headline and total as different numbers', () => {
    const rows = [
      evaluateMonopoly({ niin: 'A', approvedSources: [src('AAAAA')], statuses: new Map([['AAAAA', status('AAAAA', 'inactive')]]), demand, availability: available, amc: '1', amsc: 'G' }),
      evaluateMonopoly({ niin: 'B', approvedSources: [src('BBBBB')], statuses: new Map(), demand, availability: available, amc: '1', amsc: 'G' }),
    ]
    const s = summarizeMap(rows)
    expect(s.total).toBe(2)
    expect(s.headlineCount).toBe(1)
    expect(s.unknownDependentCount).toBe(1)
  })
})

/* =================================================================================== */
describe('the cross, and the inversion', () => {
  const demand: DemandReading = { basis: 'vendor_forecast', source: 'forecast app', observedAt: AS_OF, quantity: 80, nonBinding: true }

  it('qualifies a corner when all three legs read', () => {
    const r = evaluateCross({
      niin: 'N1', demand, lastAwardWasSurplus: true,
      availability: { known: true, unitsAvailable: 10, holders: 2, observedAt: AS_OF, source: 'locator' },
      historicalSurplusCompetitors: 6,
    })
    expect(r.qualifies).toBe(true)
    expect(r.thinAvailability).toBe(true)
  })

  it('ABSTAINS rather than qualifying when availability is unknown', () => {
    // Law 1 on this surface: a corner is never fabricated off a missing availability read.
    const r = evaluateCross({
      niin: 'N1', demand, lastAwardWasSurplus: true,
      availability: { known: false, reason: 'credential_absent' },
    })
    expect(r.qualifies).toBe(false)
    expect(r.thinAvailability).toBeNull()
    expect(r.abstainedLegs.join(' ')).toContain('availability unknown')
  })

  it('names an unread leg rather than silently treating it as false', () => {
    const r = evaluateCross({
      niin: 'N1', demand, lastAwardWasSurplus: null,
      availability: { known: true, unitsAvailable: 2, holders: 1, observedAt: AS_OF, source: 'l' },
    })
    expect(r.abstainedLegs).toContain('last award supplier type not resolved')
  })

  it('inverts a manufacturer to its items and marks which have forward demand', () => {
    const rows: ApprovedSourceRow[] = [
      { NIIN: 'N1', CAGE_CODE: 'MFG01', PART_NUMBER: 'P1', COMPANY_NAME: 'M', observedAt: AS_OF },
      { NIIN: 'N2', CAGE_CODE: 'MFG01', PART_NUMBER: 'P2', COMPANY_NAME: 'M', observedAt: AS_OF },
      { NIIN: 'N3', CAGE_CODE: 'OTHER', PART_NUMBER: 'P3', COMPANY_NAME: 'O', observedAt: AS_OF },
    ]
    const result = invertManufacturer({
      cage: 'MFG01',
      status: { cage: 'MFG01', status: 'inactive', observedAt: AS_OF, grade: 'recorded_status', evidence: [] },
      approvedSourceRows: rows,
      demandByNiin: new Map([['N1', demand]]),
      approvedSourceCountByNiin: new Map([['N1', 1], ['N2', 3]]),
    })
    expect(result.items).toHaveLength(2)
    expect(result.itemsWithForwardDemand).toHaveLength(1)
    expect(result.items.find((i) => i.niin === 'N1')?.soleSource).toBe(true)
    expect(result.abstainedOnStatus).toBe(false)
  })

  it('still lists the mapping but abstains on the corner claim when the status is unknown', () => {
    const result = invertManufacturer({
      cage: 'MFG01', status: null,
      approvedSourceRows: [{ NIIN: 'N1', CAGE_CODE: 'MFG01', PART_NUMBER: 'P', COMPANY_NAME: null, observedAt: AS_OF }],
      demandByNiin: new Map([['N1', demand]]),
      approvedSourceCountByNiin: new Map([['N1', 1]]),
    })
    expect(result.items).toHaveLength(1)
    expect(result.abstainedOnStatus).toBe(true)
  })
})

/* =================================================================================== */
describe('distressed supplier: a tier, never a flag', () => {
  const base: SupplierSignals = {
    cage: 'AAAAA', companyName: 'Acme', registrationStatus: 'active',
    registrationExpiresAt: null, lastAwardAt: null, hasHistoricalAward: true,
    ownNinetiethPercentileGapDays: null, onExclusionsList: false,
    successorCageAtSameAddress: null, publicAwardCoverageAdequate: true, observedAt: AS_OF,
  }
  const mfg = { cage: 'AAAAA', entityClass: 'manufacturer' as const, basis: 'award history', observedAt: AS_OF }

  it('fires S1 on a registration lapsed through a full renewal cycle', () => {
    const a = assessDistress({ ...base, registrationStatus: 'expired', registrationExpiresAt: '2024-01-01', lastAwardAt: '2023-01-01' }, AS_OF, mfg)
    expect(a.tier).toBe('S1')
    expect(a.composingSignals.length).toBeGreaterThan(0)
  })

  it('fires S2 in the pre-exit window, which is the tier that makes money', () => {
    const a = assessDistress({ ...base, registrationStatus: 'active', registrationExpiresAt: '2026-10-01', lastAwardAt: '2023-01-01' }, AS_OF, mfg)
    expect(a.tier).toBe('S2')
  })

  it('fires S3 only against the firm\'s own historical gap', () => {
    const a = assessDistress({ ...base, lastAwardAt: '2023-01-01', ownNinetiethPercentileGapDays: 200 }, AS_OF, mfg)
    expect(a.tier).toBe('S3')
  })

  it('suppresses on a recent award at any agency', () => {
    const a = assessDistress({ ...base, registrationStatus: 'expired', registrationExpiresAt: '2024-01-01', lastAwardAt: '2026-06-01' }, AS_OF, mfg)
    expect(a.suppressed).toBe(true)
    expect(a.tier).toBeNull()
  })

  it('suppresses on the exclusions list and on a successor at the same address', () => {
    expect(assessDistress({ ...base, onExclusionsList: true }, AS_OF, mfg).suppressed).toBe(true)
    expect(assessDistress({ ...base, successorCageAtSameAddress: 'BBBBB' }, AS_OF, mfg).suppressed).toBe(true)
  })

  it('reports which suppression checks RAN, so an unrun check is visible as a gap', () => {
    const a = assessDistress(base, AS_OF, mfg)
    expect(a.suppressionChecks).toHaveLength(3)
  })

  it('abstains rather than assigning a low tier when public coverage is thin', () => {
    // The reporting-floor trap. Silence below the threshold carries NO information, and a
    // default low tier would send an operator to buy a shelf from a thriving firm.
    const a = assessDistress({ ...base, publicAwardCoverageAdequate: false, registrationStatus: 'expired', registrationExpiresAt: '2024-01-01' }, AS_OF, mfg)
    expect(a.insufficientPublicData).toBe(true)
    expect(a.tier).toBeNull()
    expect(describeDistress(a)).toBe('Insufficient public award data')
  })

  it('carries an explicit unknown classification as a gap rather than guessing dealer', () => {
    const a = assessDistress(base, AS_OF, { cage: 'AAAAA', entityClass: 'unknown', basis: 'thin', observedAt: AS_OF })
    expect(a.entityClass).toBe('unknown')
    expect(a.gaps.join(' ')).toContain('explicitly unknown')
  })

  it('publishes only the measurement, never the word distressed', () => {
    const a = assessDistress({ ...base, lastAwardAt: '2023-01-01', ownNinetiethPercentileGapDays: 200 }, AS_OF, mfg)
    expect(a.measurement).toBe('no recorded prime award activity since 2023-01-01')
    expect(describeDistress(a).toLowerCase()).not.toContain('distressed')
  })
})

/* =================================================================================== */
describe('seed workbooks: read the real operator files, or skip loudly', () => {
  const NO_QUOTE_MATCHES = seedPath('no_quote_matches.xlsx')
  const NO_QUOTES = seedPath('NO QUOTES.xlsx')
  const present = existsSync(NO_QUOTE_MATCHES) && existsSync(NO_QUOTES)

  it('converts both real date encodings without inventing a date', () => {
    // The same logical date appears as a string in one workbook and a serial in the other.
    expect(usDateToIso('03/03/2026')).toBe('2026-03-03')
    expect(excelSerialToIso(46084)).toBe('2026-03-03')
    expect(excelSerialToIso(12)).toBeNull() // a small integer is a quantity, not a date
    expect(usDateToIso('not a date')).toBeNull()
  })

  it.runIf(present)('reads the supplier-availability snapshot at its stated size', () => {
    const t = readSeedWorkbook(NO_QUOTE_MATCHES)
    expect(t.headers).toHaveLength(27)
    expect(t.rows).toHaveLength(2439)
    expect(t.provenance.role).toBe('candidate_input_only')
    expect(t.provenance.sha256).toHaveLength(64)
  })

  it.runIf(present)('reads the no-quote solicitations at the size the corpus states', () => {
    const t = readSeedWorkbook(NO_QUOTES)
    expect(t.rows).toHaveLength(839)
  })

  it.runIf(present)('does not shift columns when a row omits empty cells', () => {
    // THE DEFECT THIS DEFENDS: Excel omits empty cells, so a positional reader shifts every
    // column after the first gap and produces well-formed wrong rows. Point of inspection is
    // the control: it may only ever hold these two values across all 2,439 rows.
    const t = readSeedWorkbook(NO_QUOTE_MATCHES)
    const values = new Set(t.rows.map((r) => r['point_of_inspection']).filter(Boolean))
    expect([...values].sort()).toEqual(['Destination', 'Origin'])
  })

  it.runIf(present)('resolves every stock number in the real file to a nine digit key', () => {
    const t = readSeedWorkbook(NO_QUOTES)
    const unparseable = t.rows.filter((r) => parseNsn(r['NSN Number']) === null)
    expect(unparseable).toHaveLength(0)
  })

  if (!present) {
    it('SKIPPED the real-file assertions because the seed workbooks are absent', () => {
      // Deliberately visible. A silent skip is how a suite reports success while measuring nothing.
      expect(present).toBe(false)
    })
  }
})
