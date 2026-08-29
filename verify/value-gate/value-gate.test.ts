/**
 * @OS-VERIFY — THE DISCRIMINATING TEST for David's inventory-badge rule (CONDUCTOR 18:50Z).
 *
 * THE RULE, part (3): an inventory match must NOT rescue a sub-threshold opportunity. The VALUE
 * GATE DOMINATES. Below ~$15K, a Wayne-inventory match must not lift a row into a high rank.
 *
 * THESE ARE FIXTURES, NOT DATA. Every row below is synthetic and constructed to isolate ONE
 * variable at a time. Nothing here is presented as a measurement of the real corpus; the real-data
 * measurement lives in verify/winnable and verify/wayne.
 *
 * The test is written to FAIL when the guard is absent. It is RED today, by design: `15000` appears
 * exactly once in cornerscore.ts, as a valueTier LABEL, and rankKey is a flat additive sum with no
 * value gate in it. Making this green is @OS-LEAD's build.
 */
import { describe, it, expect } from 'vitest'
import { scoreCorner, waynePoints, valuePoints } from '@/lib/intelligence/scoring/cornerscore'

/**
 * $14,999 - one dollar under the floor - NOT $4,000. Measured reason: with the taper in place the
 * value term is capped at 45.00 points, so a flat +28 boost is 62% of the entire value signal. A
 * $4,000 row earns 0 value points and loses to a sweet-spot row even with the guard REMOVED, so it
 * cannot discriminate. The worst case, and the only one that fails when the guard is deleted, is
 * the TOP of the sub-floor band. A test that passes in both states protects nothing.
 */
const SUB_FLOOR_USD = 14_999
const SWEET_SPOT_USD = 180_000   // inside the $50K-$250K sweet spot

/** A minimal CornerRow fixture. Competitive (multi-source) so the lockup gate never interferes. */
function row(nsn: string, qty: number) {
  return {
    niin: nsn.slice(-9), nsn, nomenclature: 'FIXTURE', quantity: qty, unitOfIssue: 'EA',
    solicitation: 'SPE-FIXTURE', returnDate: '2026-09-30', automatedSolicitation: false,
    approvedSources: ['AAAAA', 'BBBBB'], approvedSourceCount: 2, soleSource: false,
    signals: [], silentSourceCount: 0,
    availability: 'unknown_credential_absent', availabilityHolders: null, availabilityUnits: null,
    cornerSignalCount: 0,
  } as any
}

/** A minimal award summary. `holders` carries Wayne's CAGE only when `wayneUnits` is given. */
function award(unitPrice: number, qty: number, wayneUnits: number | null) {
  const rec = { date: '2026-01-15', cage: 'CCCCC', quantity: qty, unitPrice, effectiveUnitPrice: unitPrice, finalPrice: unitPrice * qty }
  return {
    nsn: 'FIXTURE', awards: [rec], latest: rec, distinctAwardees: 2,
    firstUnitPrice: unitPrice, lastUnitPrice: unitPrice, priceScaleSuspect: false,
    holders: wayneUnits == null ? [] : [{ cage: '3BQS1', quantity: wayneUnits }],
    // Neutral surplus/AMC so the lockup classifier lands on `competitive` and never interferes.
    surplus: { flaggedAwards: 0, totalAwards: 1, surplusCages: [] },
    amc: '1', approvedSources: ['AAAAA', 'BBBBB'], ltcExpirationIso: null,
  } as any
}

function rankKeyOf(usd: number, qty: number, wayneUnits: number | null): number {
  const s: any = scoreCorner(row('1234567890123', qty), award(usd / qty, qty, wayneUnits), null, { awardIndexLoaded: true }, null)
  return s.rankKey
}

describe('the value gate dominates the inventory boost', () => {
  it('PRINTS the arithmetic first, so a failure is readable', () => {
    console.log(`valuePoints($${SUB_FLOOR_USD.toLocaleString()})  = ${valuePoints(SUB_FLOOR_USD).toFixed(3)}`)
    console.log(`valuePoints($${SWEET_SPOT_USD.toLocaleString()}) = ${valuePoints(SWEET_SPOT_USD).toFixed(3)}`)
    console.log(`waynePoints(full fill)  = ${waynePoints([{ cage: '3BQS1', quantity: 100 }] as any, 100).points.toFixed(3)}`)
    console.log(`waynePoints(no holding) = ${waynePoints([] as any, 100).points.toFixed(3)}`)
    console.log(`\nsub-floor  $${SUB_FLOOR_USD.toLocaleString()} WITH full inventory -> rankKey ${rankKeyOf(SUB_FLOOR_USD, 100, 100).toFixed(3)}`)
    console.log(`sweet-spot $${SWEET_SPOT_USD.toLocaleString()} WITHOUT inventory  -> rankKey ${rankKeyOf(SWEET_SPOT_USD, 100, null).toFixed(3)}`)
  })

  it('★ THE DISCRIMINATOR: a sub-floor row WITH inventory ranks BELOW a sweet-spot row WITHOUT it', () => {
    const subFloorHeld = rankKeyOf(SUB_FLOOR_USD, 100, 100)   // full fill => max boost, worst case
    const sweetSpotBare = rankKeyOf(SWEET_SPOT_USD, 100, null)
    expect(subFloorHeld).toBeLessThan(sweetSpotBare)
  })

  it('holds across the WHOLE sub-floor range against the WHOLE sweet-spot range', () => {
    const offenders: string[] = []
    for (const sub of [500, 1_000, 4_000, 9_999, 14_999]) {
      for (const sweet of [50_000, 120_000, 180_000, 250_000]) {
        const a = rankKeyOf(sub, 100, 100)
        const b = rankKeyOf(sweet, 100, null)
        if (!(a < b)) offenders.push(`$${sub} held (${a.toFixed(2)}) >= $${sweet} bare (${b.toFixed(2)})`)
      }
    }
    if (offenders.length) console.log('INVERSIONS:\n  ' + offenders.join('\n  '))
    expect(offenders).toEqual([])
  })

  it('★ THE ADVERSARIAL CASE — the one real data already exhibits: sub-floor + inventory + corner signals', () => {
    // The corner bucket is worth up to +30 and is INDEPENDENT of value. A sub-floor row that also
    // carries corner signals gets 10 + 0 + 28 + 30. A sweet-spot row with none gets 10 + 41 + 0 + 0.
    // MEASURED ON REAL DATA: NSN 5365008029173, valueUsd $214.24, rankKey 60.0, rank 179 of 10,488.
    const subFloorLoaded = { ...row('1234567890123', 100), cornerSignalCount: 2, silentSourceCount: 2,
      signals: [{ kind: 'award_silent', cage: 'AAAAA', measurement: 'fixture' },
                { kind: 'award_silent', cage: 'BBBBB', measurement: 'fixture' }] } as any
    const a: any = scoreCorner(subFloorLoaded, award(SUB_FLOOR_USD / 100, 100, 100), null, { awardIndexLoaded: true }, null)
    const b = rankKeyOf(SWEET_SPOT_USD, 100, null)
    console.log(`sub-floor $${SUB_FLOOR_USD.toLocaleString()} + full inventory + corner signals -> rankKey ${a.rankKey.toFixed(3)}`)
    console.log(`sweet-spot $180,000, no inventory, no signals      -> rankKey ${b.toFixed(3)}`)
    expect(a.rankKey).toBeLessThan(b)
  })

  it('the boost still WORKS inside the qualified set (rule 2 must not be broken by the fix)', () => {
    const heldQualified = rankKeyOf(SWEET_SPOT_USD, 100, 100)
    const bareQualified = rankKeyOf(SWEET_SPOT_USD, 100, null)
    console.log(`sweet-spot WITH inventory ${heldQualified.toFixed(3)} vs WITHOUT ${bareQualified.toFixed(3)}`)
    expect(heldQualified).toBeGreaterThan(bareQualified)
  })
})
