/**
 * DOSSIER ELIGIBILITY: the abstention is the product.
 *
 * The expensive error in this module is one-directional, so the tests are aimed at that
 * direction and not at the happy path. Reading a blank acquisition code as "not restricted"
 * invents permission to bid: the operator quotes a part they are not an approved source for and
 * loses the work plus the hours. Every assertion below that touches a blank therefore checks
 * that the ABSENCE of a determination is visible in the type, in the evidence state, in the
 * posture, in the stance and in a sentence a person reads, all five, because a surface that
 * renders any one of them would otherwise be free to say the wrong thing.
 *
 * The fixture is a synthetic catalogue whose answers are known before the code runs, which is
 * the only kind of check worth having here: a hand-written regex over the real file would
 * reproduce whatever misreading the module has and agree with it.
 */
import { describe, expect, it } from 'vitest'

import {
  resolveDossierEligibility,
  type DossierEligibility,
} from '@/lib/intelligence/eligibility/dossier-eligibility'
import type { AmscIndex } from '@/lib/intelligence/eligibility/bid-eligibility'

function index(
  rows: Array<{ niin: string; amc: string; amsc: string; pica: string }>,
  publishers: string[],
): AmscIndex {
  return {
    ok: true,
    rows: new Map(rows.map((r) => [r.niin, { aac: '', ...r }])),
    publishers: new Map(publishers.map((p) => [p, { rows: 10000, withAmsc: 10000, rate: 1 }])),
    provenance: {},
  }
}

/*
 * GX publishes. ZW does not. That split is the real one: measured on V_MOE_RULE, PICA GX is
 * 100.00% populated (6,056,962 of 6,056,971 rows) while ZW, ZH, ZU, YB, ZC, YA, ZR and YD are
 * all at 0.00%. The 47% overall fill is not a partial fill, it is two populations.
 */
const IDX = index(
  [
    { niin: '000000001', amc: '1', amsc: 'G', pica: 'GX' },
    { niin: '000000002', amc: '3', amsc: 'P', pica: 'GX' },
    { niin: '000000003', amc: '', amsc: '', pica: 'ZW' },
    { niin: '000000004', amc: '1', amsc: '', pica: 'GX' },
    { niin: '000000005', amc: '3', amsc: 'G', pica: 'GX' },
    { niin: '000000006', amc: '1', amsc: 'Q', pica: 'GX' },
    { niin: '000000007', amc: '5', amsc: 'C', pica: 'GX' },
    { niin: '000000008', amc: '3', amsc: 'D', pica: 'GX' },
  ],
  ['GX'],
)

const resolve = (stockNumber: string, solicitationNumber?: string): DossierEligibility =>
  resolveDossierEligibility({ stockNumber, solicitationNumber }, IDX)

/**
 * Every way this verdict could read as permission, checked in one place.
 *
 * It is a list of the five independent things a surface might render, not a single flag, because
 * the defect this guards against is one of them quietly disagreeing with the other four.
 */
function expectNoPermissionAnywhere(v: DossierEligibility): void {
  expect(v.determined).toBe(false)
  expect(v.posture).toBeNull()
  expect(v.amsc).toBeNull()
  expect(v.pursuit.stance).toBe('not_determined')
  expect(v.evidence).not.toBe('MEASURED')
  expect(v.cautions.map((c) => c.code)).toContain('acquisition_posture_not_determined')
  expect(v.headline.toLowerCase()).toContain('not determined')
  // Nothing in the verdict may carry the open grouping, in any field, at any depth.
  expect(JSON.stringify(v)).not.toContain('open_to_surplus_dealer')
}

describe('a PICA that does not publish AMSC yields an ABSTENTION, never "open" and never "not restricted"', () => {
  it('★ THE CONTROL: a blank AMSC under a non-publishing activity abstains on every field', () => {
    const v = resolve('000000003')
    expect(v.state).toBe('abstained_pica_does_not_publish')
    // ABSENT, not UNREAD: the publisher does not publish this field at all, which is a different
    // statement from "the file exists and we have not read it".
    expect(v.evidence).toBe('ABSENT')
    expect(v.publisher.pica).toBe('ZW')
    expect(v.publisher.publishesAmsc).toBe('no')
    expectNoPermissionAnywhere(v)
  })

  it('says WHY in a sentence, and the sentence blames the publisher rather than the item', () => {
    const v = resolve('000000003')
    expect(v.publisher.sentence).toContain('does not publish acquisition codes at all')
    expect(v.headline).toContain("publisher's silence")
  })

  it('a publishing activity with a blank on THIS row also abstains, with its own reason', () => {
    const v = resolve('000000004')
    expect(v.state).toBe('abstained_pica_does_not_publish')
    expect(v.publisher.publishesAmsc).toBe('yes')
    expect(v.headline).toContain('publishes acquisition codes, but this row carries none')
    expectNoPermissionAnywhere(v)
    // The AMC is a separate field of the same row and IS on record, so it is not thrown away.
    expect(v.amc?.value.code).toBe(1)
    expect(v.amc?.evidence).toBe('MEASURED')
  })

  it('a stock number the extract does not carry is UNREAD, which is not ABSENT and not permission', () => {
    const v = resolve('999999999')
    expect(v.state).toBe('abstained_not_in_catalogue')
    expect(v.evidence).toBe('UNREAD')
    expectNoPermissionAnywhere(v)
  })

  it('no index on disk abstains and says so, rather than reporting an unrestricted item', () => {
    const v = resolveDossierEligibility(
      { stockNumber: '000000001' },
      { ok: false, reason: 'the acquisition-code index is not in this data directory' },
    )
    expect(v.state).toBe('index_absent')
    expect(v.evidence).toBe('UNREAD')
    expect(v.publisher.publishesAmsc).toBe('unknown')
    expectNoPermissionAnywhere(v)
  })

  it('a malformed stock number abstains instead of being coerced onto a neighbouring key', () => {
    const v = resolve('not-a-stock-number')
    expect(v.niin).toBe('')
    expectNoPermissionAnywhere(v)
  })
})

describe('where the publisher does publish, the government text and OUR grouping stay apart', () => {
  it('carries the verbatim Table 71 explanation as MEASURED', () => {
    const v = resolve('000000001')
    expect(v.determined).toBe(true)
    expect(v.evidence).toBe('MEASURED')
    expect(v.amsc?.evidence).toBe('MEASURED')
    expect(v.amsc?.value.code).toBe('G')
    expect(v.amsc?.value.meaning).toContain('unlimited rights to the technical data')
    expect(v.amc?.value.meaning).toContain('Suitable for competitive acquisition')
  })

  it('★ carries the posture as ESTIMATED, and the two evidence labels are not the same value', () => {
    const v = resolve('000000001')
    expect(v.posture?.evidence).toBe('ESTIMATED')
    expect(v.posture?.value.code).toBe('open_to_surplus_dealer')
    expect(v.posture?.value.label).toBe('open to competitive acquisition')
    // The structural guarantee, asserted at runtime as well as in the type: a render that reads
    // `evidence` cannot get the same answer from the table entry and from our grouping.
    expect(v.amsc?.evidence).not.toBe(v.posture?.evidence)
    expect(v.posture?.citation.verification).toBe('estimated')
    expect(v.amsc?.citation.verification).toBe('verified_primary')
  })

  it('attaches the dealer note ONLY to the AMCs Table 71 attaches it to', () => {
    // AMC 1 carries it verbatim. AMC 3 and AMC 5 do not, and a quote on the wrong row is a
    // fabricated permission wearing a citation.
    expect(resolve('000000001').dealerNote?.value).toBe('Potential sources shall include dealers/distributors.')
    expect(resolve('000000002').dealerNote).toBeNull()
    expect(resolve('000000007').dealerNote).toBeNull()
  })

  it('a restricted code is a competition signal and NEVER a closed door, on every verdict', () => {
    const closed = resolve('000000002')
    expect(closed.posture?.value.code).toBe('restricted_closed_to_new_manufacturing_source')
    expect(closed.pursuit.stance).toBe('proceed_with_stated_caution')
    expect(closed.cautions.map((c) => c.code)).toContain('closed_to_new_manufacturing_sources')
    // The sentence that stops the row being suppressed rides on every verdict, determined or not.
    expect(closed.surplusSupplyNote.sentence).toContain('does not by itself bar')
    expect(resolve('000000003').surplusSupplyNote.sentence).toContain('does not by itself bar')
  })

  it('an attackable code says a source approval path exists, without promising it is cheap', () => {
    const v = resolve('000000007')
    expect(v.posture?.value.code).toBe('restricted_attackable')
    expect(v.cautions.map((c) => c.code)).toContain('source_approval_required_to_manufacture')
  })

  it('★ a caution QUOTES the code it is about, and never another code\'s mechanism', () => {
    /*
     * B, C and D are one posture group and three different facts. C is "requires engineering
     * source approval by the design control activity", D is "the data needed to produce this item
     * from additional sources is not physically available". A caution that printed C's mechanism
     * under D would be a confident sentence about a code it does not describe. This is the exact
     * class of inaccuracy the first outside reader of this product complained about.
     */
    const d = resolve('000000008')
    const c = resolve('000000007')
    expect(d.posture?.value.code).toBe('restricted_attackable')
    expect(c.posture?.value.code).toBe('restricted_attackable')
    const dSentence = d.cautions.find((x) => x.code === 'source_approval_required_to_manufacture')!.sentence
    const cSentence = c.cautions.find((x) => x.code === 'source_approval_required_to_manufacture')!.sentence
    expect(dSentence).toContain('not physically available')
    expect(dSentence).not.toContain('design control activity')
    expect(cSentence).toContain('design control activity')
    expect(cSentence).not.toContain('not physically available')
    // And both say whose reading the grouping is, because it is ours and not the government's.
    expect(dSentence).toContain("grouped by OUR reading, not the government's")
  })

  it('the closed caution also quotes its own code, and still refuses to close the surplus door', () => {
    const p = resolve('000000002').cautions.find((c) => c.code === 'closed_to_new_manufacturing_sources')!
    expect(p.sentence).toContain('not owned by the Government and cannot be purchased')
    expect(p.sentence).toContain('does not by itself bar supplying new surplus')
  })

  it('an ungrouped code asserts NO posture rather than defaulting to one', () => {
    const v = resolve('000000006')
    expect(v.posture?.value.code).toBe('unclassified_in_primary_source')
    expect(v.cautions.map((c) => c.code)).toContain('posture_unclassified_in_primary_source')
    expect(v.cautions.find((c) => c.code === 'posture_unclassified_in_primary_source')?.evidence).toBe('ABSENT')
  })

  it('an impossible AMC and AMSC pairing is flagged as a DATA defect, not as a bid decision', () => {
    const v = resolve('000000005')
    expect(v.combination).toBe('invalid')
    const caution = v.cautions.find((c) => c.code === 'acquisition_code_combination_invalid')
    expect(caution?.sentence).toContain('suspect')
    // It never moves the stance to "cannot bid": the row is suspect, the operator is not barred.
    expect(v.pursuit.stance).toBe('proceed_with_stated_caution')
  })

  it('a clean determined row says so plainly and claims nothing legal', () => {
    const v = resolve('000000001')
    expect(v.cautions).toEqual([])
    expect(v.pursuit.stance).toBe('no_recorded_bar')
    expect(v.pursuit.sentence).toContain('not legal advice and not a clearance')
  })
})

describe('provenance travels, in a form the grounding guard cannot mistake for a figure', () => {
  it('every citation pins a file and a line, in the identifier form', () => {
    const v = resolve('000000001')
    const pins = [v.amsc?.citation.pin, v.posture?.citation.pin, v.surplusSupplyNote.citation.pin]
    for (const pin of pins) {
      expect(pin).toBeDefined()
      expect(pin).toMatch(/\.md:L\d+(-L\d+)?$/)
    }
  })

  it('★ CONTROL: no bare `:number` pin survives into the verdict, at any depth', () => {
    // A raw `path:565` pin registers 565 in the memo's allowed-number set (measured: eight raw
    // citations took a real package from 30 allowed numbers to 65). The L form is invisible to
    // that tokenizer on both sides. If the rewrite in `pinned()` is removed, this fails.
    const all = JSON.stringify([resolve('000000001'), resolve('000000002'), resolve('000000003')])
    expect(all).not.toMatch(/\.md:\d/)
  })

  it('HOUSE LAW: no em dash in any sentence this module emits', () => {
    for (const sn of ['000000001', '000000002', '000000003', '999999999']) {
      expect(JSON.stringify(resolve(sn))).not.toMatch(/—/)
    }
  })
})
