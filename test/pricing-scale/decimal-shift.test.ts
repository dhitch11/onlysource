import { describe, expect, it } from 'vitest'
import { buildNsnAwardIndex, detectPriceScaleShift } from '@/lib/intelligence/awards/nsn-now'
import { buildFscPeerPool, peerLookupFrom, recommendForCorner } from '@/lib/intelligence/pricing/for-corner'

/*
 * A DECIMAL SHIFT IN THE SOURCE, PRICED AS IF IT WERE A MARKET.
 *
 * Found by reading the dashboard as an operator. It promoted "Biggest price ramp: +18,271% — a
 * cornered part whose price only goes up", and the pricing desk recommended $1,822.98-$1,829.14 PER
 * UNIT with "WHAT WE SEND $236,987" for 130 units, on a screw assembly that had run $6.98-$13.73
 * for eight years at quantities up to 7,911.
 *
 * The cause, on ONE contract with the same vendor and CAGE either side:
 *     2023-09-12  qty   5  unit 13.73  final     68.65
 *     2024-06-03  qty 100  unit 1373   final 137,300
 * Both rows are internally consistent, so every arithmetic check passes. The only tell is the
 * ratio: exactly 100.00x, without a change of contract.
 */
describe('the decimal shift, and the two cases it must not fire on', () => {
  const built = buildNsnAwardIndex()
  /*
   * A missing corpus and a clean corpus must not read alike. Without this the whole file passes
   * vacuously on a checkout that has no `data/` — the exact shape of failure the estate has already
   * been bitten by (a gitignored fixture dir failing like a product bug, and its inverse).
   */
  if (!built.ok) throw new Error(`award index unavailable, so nothing here was tested: ${built.reason}`)
  const idx = built
  const byDigits = (d: string) =>
    [...idx.byNsn.values()].find((s) => String(s.nsn).replace(/\D/g, '') === d)

  it('fires on the real corrupted series', () => {
    const s = byDigits('5305016205067')
    expect(s, 'the corpus must still contain the subject').toBeTruthy()
    const hit = s!.priceScaleSuspect
    expect(hit).toBeTruthy()
    expect(hit!.factor).toBe(100)
    expect(hit!.fromUsd).toBeCloseTo(13.73, 2)
    expect(hit!.toUsd).toBeCloseTo(1373, 2)
    // same contract is the whole basis for calling it a data shift rather than a market move
    expect(hit!.contractNo).toBe('SPE4AX23D9408')
  })

  /*
   * ★ THE HALF THAT MATTERS MORE. Two other stock numbers move by roughly 10x — 9.99x and 9.81x —
   * ACROSS DIFFERENT CONTRACTS. Those are plausibly real escalation on cornered parts, which is the
   * thing this product exists to find. A flag that swallowed them would be deleting the product's
   * own signal, and an operator who sees a flag on a real finding learns to ignore the flag.
   */
  it('does NOT fire on a large move across different contracts', () => {
    for (const d of ['6515015379013', '5315010969169']) {
      const s = byDigits(d)
      if (!s) continue
      expect(s.priceScaleSuspect, `${d} is a cross-contract move and must stay unflagged`).toBeNull()
    }
  })

  it('fires on exactly one stock number in the whole corpus', () => {
    const flagged = [...idx.byNsn.values()].filter((s) => s.priceScaleSuspect)
    expect(flagged.map((s) => String(s.nsn).replace(/\D/g, ''))).toEqual(['5305016205067'])
  })

  it('requires the SAME contract, not merely a power-of-ten ratio', () => {
    const base = {
      quantity: 1, company: null, cage: null, finalPrice: null, amc: null, amsc: null,
      offers: null, deliveryDays: null, setAside: null, firstArticle: null,
      ltcExpirationIso: null, surplus: null, solicitation: null, closeDateIso: null, nsn: 'x',
    }
    const same = detectPriceScaleShift([
      { ...base, contractNo: 'C1', awardDateIso: '2024-01-01', unitPrice: 10, effectiveUnitPrice: 10 },
      { ...base, contractNo: 'C1', awardDateIso: '2024-06-01', unitPrice: 1000, effectiveUnitPrice: 1000 },
    ] as never)
    const across = detectPriceScaleShift([
      { ...base, contractNo: 'C1', awardDateIso: '2024-01-01', unitPrice: 10, effectiveUnitPrice: 10 },
      { ...base, contractNo: 'C2', awardDateIso: '2024-06-01', unitPrice: 1000, effectiveUnitPrice: 1000 },
    ] as never)
    expect(same).toBeTruthy()
    expect(same!.factor).toBe(100)
    expect(across, 'a different contract is a different buy, and may legitimately reprice').toBeNull()
  })

  it('leaves a 2x move alone', () => {
    const base = {
      quantity: 1, company: null, cage: null, finalPrice: null, amc: null, amsc: null,
      offers: null, deliveryDays: null, setAside: null, firstArticle: null,
      ltcExpirationIso: null, surplus: null, solicitation: null, closeDateIso: null, nsn: 'x',
    }
    expect(detectPriceScaleShift([
      { ...base, contractNo: 'C1', awardDateIso: '2024-01-01', unitPrice: 10, effectiveUnitPrice: 10 },
      { ...base, contractNo: 'C1', awardDateIso: '2024-06-01', unitPrice: 20, effectiveUnitPrice: 20 },
    ] as never)).toBeNull()
  })
})

/*
 * THE REGRESSION GUARD, PINNED TO WHAT THE PAGE ACTUALLY SAID.
 *
 * /corner/5305016205067, read as an operator on the live build before this fix:
 *     "Recommended quote  $1,822.98 to $1,829.14 PER UNIT"
 *     "WHAT WE SEND       $236,987 to $237,788, 130 units"
 * A screw assembly that had never cleared above $13.73. Roughly 133x.
 *
 * This asserts against the ENGINE OUTPUT the page renders rather than the page's HTML, so it
 * fails in CI without a browser. The live page is checked separately, because a passing unit test
 * is not evidence that a deployed page changed.
 */
describe('the recommendation the corrupted series was producing', () => {
  const built = buildNsnAwardIndex()

  it('no longer quotes a four-figure unit price for the screw assembly', () => {
    if (!built.ok) throw new Error(`award index unavailable: ${built.reason}`)
    const award = [...built.byNsn.values()].find(
      (s) => String(s.nsn).replace(/\D/g, '') === '5305016205067',
    )
    expect(award, 'the subject must still be in the corpus').toBeTruthy()

    const rec = recommendForCorner({
      nsn: award!.nsn,
      award: award!,
      requirementQuantity: 130,
      approvedSourceCages: [],
      atInstantMs: Date.parse('2026-08-19T00:00:00Z'),
      peerLookup: peerLookupFrom(buildFscPeerPool(built.byNsn)),
      feedWindow: built.window,
    })

    /*
     * The upper bound is the number that reached the operator, so the upper bound is what is
     * asserted. A test on the midpoint would pass while the page still printed $1,829.
     */
    const quoted = !rec.resolved
      ? 0
      : rec.recommended.kind === 'POINT'
        ? rec.recommended.unitPriceUsd
        : rec.recommended.highUnitPriceUsd
    expect(quoted, `still quoting $${quoted.toFixed(2)}/unit`).toBeLessThan(200)

    // and it must SAY why, rather than quietly producing a different number
    const said = rec.resolved
      ? rec.caveats.map((c) => c.code).join(',')
      : `${rec.sentence} ${rec.missingInput ?? ''}`
    expect(said).toContain(
      rec.resolved ? 'AWARD_SERIES_HAS_A_DECIMAL_SHIFT_AND_WAS_SET_ASIDE' : 'decimal shift',
    )
  })
})

/*
 * THE SECOND HALF, AND THE ONE THAT WAS NEARLY MISSED.
 *
 * Withholding the corrupted awards fixed the suspect's OWN page immediately, because the engine
 * already excludes a stock number from its own peer band. It did nothing for the rest of the
 * supply class: 104 of the 119 rows over $1,000 in all of FSC 5305 were that one stock number,
 * and a different 5305 part was being quoted up to $53.99 against a clean p75 of $19.50.
 *
 * A fix verified only on the row that revealed the defect is a fix verified on its own handiwork.
 */
describe('the peer pool a whole supply class reads', () => {
  const built = buildNsnAwardIndex()

  it('contributes no peers from a stock number with a decimal shift', () => {
    if (!built.ok) throw new Error(`award index unavailable: ${built.reason}`)
    const suspects = new Set(
      [...built.byNsn.values()].filter((s) => s.priceScaleSuspect).map((s) => s.nsn),
    )
    expect(suspects.size, 'the test is vacuous if nothing is suspect').toBeGreaterThan(0)

    const pool = buildFscPeerPool(built.byNsn)
    const leaked: string[] = []
    for (const [, peers] of pool) {
      for (const p of peers) if (suspects.has(p.nsn)) leaked.push(p.nsn)
    }
    expect(leaked, `${leaked.length} peers leaked from a suspect series`).toEqual([])
  })

  it('no longer lets one bad series set the ceiling for its class', () => {
    if (!built.ok) throw new Error(`award index unavailable: ${built.reason}`)
    const look = peerLookupFrom(buildFscPeerPool(built.byNsn))
    /*
     * A 5305 part with NO priced awards of its own, so its whole recommendation is the peer band
     * and any inflation in the pool lands directly on what the operator would send.
     */
    const victim = [...built.byNsn.values()].find(
      (s) =>
        String(s.nsn).replace(/\D/g, '').startsWith('5305') &&
        !s.priceScaleSuspect &&
        s.awards.every((a) => typeof a.effectiveUnitPrice !== 'number'),
    )
    expect(victim, 'no clean 5305 part with an empty price history to test with').toBeTruthy()

    const rec = recommendForCorner({
      nsn: victim!.nsn,
      award: victim!,
      requirementQuantity: 100,
      approvedSourceCages: [],
      atInstantMs: Date.parse('2026-08-19T00:00:00Z'),
      peerLookup: look,
      feedWindow: built.window,
    })
    expect(rec.resolved).toBe(true)
    if (!rec.resolved) return
    const top =
      rec.recommended.kind === 'POINT'
        ? rec.recommended.unitPriceUsd
        : rec.recommended.highUnitPriceUsd
    // was $53.99 with the suspect in the pool; the clean p75 of the class is $19.50
    expect(top, `class ceiling is $${top.toFixed(2)}`).toBeLessThan(30)
  })
})
