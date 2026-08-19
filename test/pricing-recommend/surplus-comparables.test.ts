/**
 * TRAP 2: A SURPLUS-MATERIAL AWARD PRICE IS NOT A NEW-MANUFACTURE BID BASIS.
 *
 * The rule is EXCLUDE or LABEL, never silently average in, and which of the two happens depends on
 * a fact only a human can state: what WE would offer. The stance is three-state and the unknown
 * state is not a false.
 *
 *   OFFERING_NEW_MATERIAL  a surplus comparable is EXCLUDED, by name, with the count stated.
 *   OFFERING_SURPLUS       it is the RIGHT comparable and it is kept.
 *   UNDECLARED             it is kept and LABELLED loudly, and the missing declaration is itself a
 *                          caveat, because reading the silence as "new material" would drop
 *                          comparables on exactly the rows where surplus IS the market.
 *
 * TWO REGISTERS, READ SEPARATELY. The export's Surplus column describes the MATERIAL. The awardee
 * verdict from `lib/intelligence/suppliers/classify` describes the COMPANY. Only the material flag
 * can exclude a comparable. A dealer verdict labels and never removes, because a surplus dealer
 * wins awards on new material too, and dropping a comparable on the strength of who took it would
 * be an inference about the material read off a fact about the company.
 *
 * POSITIVE CONTROL, run by hand and recorded here: making `excludedBySurplusStance` return true
 * for `awardeeIsAMeasuredSurplusDealer` turns the fourth test red, because the dealer's award is
 * then dropped from the basis and the recommendation moves from 1500.00 to a different rung.
 */

import { describe, expect, it } from 'vitest'
import type { AwardeeVerdict } from '@/lib/intelligence/suppliers/classify'
import { recommendPrice } from '@/lib/intelligence/pricing/recommend'
import { PRICING_INSTANT_MS, cleanAward } from './_fixtures'

const SURPLUS_AWARD = cleanAward({
  awardDateIso: '2026-01-29',
  unitPriceUsd: 500,
  quantity: 4,
  awardeeCage: 'DLR01',
  surplusAsWorded: 'Yes',
})

const CLEAN_OLDER_AWARDS = [
  cleanAward({ awardDateIso: '2024-02-01', unitPriceUsd: 300, quantity: 4, awardeeCage: 'DLR02' }),
  cleanAward({ awardDateIso: '2025-02-01', unitPriceUsd: 400, quantity: 4, awardeeCage: 'DLR03' }),
]

function row(stance: 'OFFERING_NEW_MATERIAL' | 'OFFERING_SURPLUS' | 'UNDECLARED') {
  return recommendPrice({
    nsn: '1650-01-059-8221',
    approvedSourceCages: [],
    awards: [...CLEAN_OLDER_AWARDS, SURPLUS_AWARD],
    requirementQuantity: 4,
    atInstantMs: PRICING_INSTANT_MS,
    surplusStance: stance,
  })
}

describe('surplus comparables are excluded or labelled, never silently averaged in', () => {
  it('EXCLUDES the surplus award when new material has been declared, and refuses to substitute', () => {
    const rec = row('OFFERING_NEW_MATERIAL')
    if (rec.resolved !== true) throw new Error('expected a recommendation')

    // Rung 2 names THE PREVIOUS AWARD. The previous award is the excluded one, so rung 2 refuses
    // rather than quietly multiplying the 2025 award instead.
    const rung2 = rec.ladder.find((r) => r.rung === 'R2_LAST_AWARD_MULTIPLE')
    if (rung2?.resolved !== false) throw new Error('rung 2 must refuse')
    expect(rung2.reason).toBe('LAST_AWARD_EXCLUDED_AS_SURPLUS_MATERIAL')
    expect(rung2.sentence).toContain('resale price, not a new-manufacture basis')

    expect(rec.rung).toBe('R3_RECENT_AWARD_BAND')
    // 300.00 and 400.00 a unit only. The 500.00 surplus award is not in the band.
    expect(rec.arithmetic).toContain('ran 300.00 to 400.00 a unit')
    const excluded = rec.caveats.find(
      (c) => c.code === 'COMPARABLE_IS_SURPLUS_MATERIAL_AND_WAS_EXCLUDED',
    )
    expect(excluded?.measured).toEqual({ label: 'awards excluded', value: 1, unit: 'COUNT' })
    expect(excluded?.sentence).toContain('2026-01-29')
  })

  it('KEEPS and LABELS the surplus award when the stance is undeclared', () => {
    const rec = row('UNDECLARED')
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.rung).toBe('R2_LAST_AWARD_MULTIPLE')
    // 500.00 x 3 = 1500.00. The comparable was used, and it was labelled.
    expect(rec.basisUnitPriceUsd).toBe(1500)
    const labelled = rec.caveats.find(
      (c) => c.code === 'COMPARABLE_IS_SURPLUS_MATERIAL_AND_WAS_LABELLED',
    )
    expect(labelled?.sentence).toContain('SURPLUS MATERIAL')
    expect(labelled?.sentence).toContain('resale basis')
    const undeclared = rec.caveats.find((c) => c.code === 'SURPLUS_STANCE_UNDECLARED')
    expect(undeclared?.sentence).toContain('no government file answers it')
  })

  it('KEEPS the surplus award when surplus is what we would offer, and does not nag about it', () => {
    const rec = row('OFFERING_SURPLUS')
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.basisUnitPriceUsd).toBe(1500)
    expect(rec.caveats.find((c) => c.code === 'SURPLUS_STANCE_UNDECLARED')).toBeUndefined()
    expect(
      rec.caveats.find((c) => c.code === 'COMPARABLE_IS_SURPLUS_MATERIAL_AND_WAS_EXCLUDED'),
    ).toBeUndefined()
  })

  it('a MEASURED dealer verdict LABELS the comparable and never removes it', () => {
    // The classify module's own contract: a dealer verdict requires at least one award actually
    // flagged surplus, never the absence of a "no".
    const measuredDealer: AwardeeVerdict = {
      cage: 'DLR01' as AwardeeVerdict['cage'],
      companyName: 'DLR01 (FIXTURE)',
      class: 'surplus_dealer',
      evidenceState: 'measured',
      basis: 'won 3 of 9 recorded awards on surplus material',
      measured: {
        surplusYes: 3,
        surplusNo: 1,
        surplusUnread: 5,
        totalAwards: 9,
        distinctNsns: 4,
        readFraction: 4 / 9,
      },
      prior: null,
    }
    const rec = recommendPrice({
      nsn: '1650-01-059-8221',
      approvedSourceCages: [],
      awards: [
        ...CLEAN_OLDER_AWARDS,
        // NOT flagged surplus on the row. Only the awardee carries the verdict.
        cleanAward({
          awardDateIso: '2026-01-29',
          unitPriceUsd: 500,
          quantity: 4,
          awardeeCage: 'DLR01',
        }),
      ],
      requirementQuantity: 4,
      atInstantMs: PRICING_INSTANT_MS,
      // Even under the strictest stance, the COMPANY verdict must not drop the comparable.
      surplusStance: 'OFFERING_NEW_MATERIAL',
      classifyAwardee: { classify: (cage) => (cage === 'DLR01' ? measuredDealer : null) },
    })
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.rung).toBe('R2_LAST_AWARD_MULTIPLE')
    expect(rec.basisUnitPriceUsd).toBe(1500)
    const caveat = rec.caveats.find((c) => c.code === 'AWARDEE_IS_A_MEASURED_SURPLUS_DEALER')
    expect(caveat?.sentence).toContain('describes the COMPANY and not this material')
  })

  it('a PRIOR book label is not a measured dealer verdict and raises no such caveat', () => {
    const priorOnly: AwardeeVerdict = {
      cage: 'DLR01' as AwardeeVerdict['cage'],
      companyName: 'DLR01 (FIXTURE)',
      class: 'distributor',
      evidenceState: 'prior',
      basis: 'distressed-book classification (a prior, not a government record)',
      measured: null,
      prior: { bookClass: 'distributor', holdsInventory: 'distributor' },
    }
    const rec = recommendPrice({
      nsn: '1650-01-059-8221',
      approvedSourceCages: [],
      awards: [
        cleanAward({
          awardDateIso: '2026-01-29',
          unitPriceUsd: 500,
          quantity: 4,
          awardeeCage: 'DLR01',
        }),
      ],
      requirementQuantity: 4,
      atInstantMs: PRICING_INSTANT_MS,
      classifyAwardee: { classify: () => priorOnly },
    })
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    expect(rec.caveats.find((c) => c.code === 'AWARDEE_IS_A_MEASURED_SURPLUS_DEALER')).toBeUndefined()
  })

  it('a BLANK surplus column is a silence, and never reads as a surplus flag', () => {
    const rec = row('OFFERING_NEW_MATERIAL')
    if (rec.resolved !== true) throw new Error('expected a recommendation')
    // The two clean awards carry no Surplus wording at all and both survive the strictest stance.
    expect(rec.arithmetic).toContain('ran 300.00 to 400.00 a unit')
  })
})
