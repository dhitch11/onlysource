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

import { AMC_TABLE, AMSC_TABLE } from '@/lib/engine/eligibility'
import { allowedNumberSet, valueTokensIn } from '@/lib/ai/grounding'
import { citationLabel, knownCitationKeys } from '@/lib/intelligence/eligibility/citation'
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
    lookup: (n: string) => new Map(rows.map((r) => [r.niin, { aac: '', contested: { amc: false, amsc: false, selfContradiction: false }, ...r }])).get(n),
    size: rows.length,
    backing: 'binary' as const,
    niins: () => rows.map((r) => r.niin),
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
    /*
     * 'E' IS THE ONE THE MODULE GOT WRONG. `lib/engine/eligibility/amsc.ts` names E, F, I, J, O,
     * W and X as codes absent from the transcribed table, so this is a value the government file
     * can carry and our reading cannot resolve. It is a synthetic row whose answer is known before
     * the code runs: the publisher publishes, the row carries a character, and there is no meaning
     * and no posture to assert for it.
     */
    { niin: '000000009', amc: '3', amsc: 'E', pica: 'GX' },
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
    // TOKEN FORM, and the prefix is load-bearing: 13 of the 44 publishing activities on the real
    // extract are numeric, and a bare `17` in a value position is a number the memo may then state
    // as a quantity. See `identifierToken` in ./bid-eligibility for the measurement.
    expect(v.publisher.pica).toBe('PICA-ZW')
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
    expect(v.amc?.value.token).toBe('AMC-1')
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
    expect(v.amsc?.value.token).toBe('AMSC-G')
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

describe('an AMSC the feed carries and the transcribed table does not list ABSTAINS, never clears', () => {
  /*
   * MEASURED BEFORE THE FIX, on this exact fixture: state 'determined', evidence 'MEASURED',
   * amsc null, posture null, cautions [], stance 'no_recorded_bar' with the sentence "Nothing in
   * the acquisition codes recorded for this item bars pursuing it", and the character 'E' nowhere
   * on the object. The else-if chain had branches for the three postures and for the not-determined
   * state, and no branch for determined-with-no-posture, so it emitted nothing, and no caution is
   * what `pursuitFor` reads as a clean row. That is the blank-is-not-a-zero rule failing on an
   * unlisted value instead of a blank, in the direction that costs hours.
   */
  it('★ THE CONTROL: an unlisted suffix code abstains on every field a surface could render', () => {
    const v = resolve('000000009')
    expectNoPermissionAnywhere(v)
    // UNREAD, not ABSENT and not MEASURED: the publisher published, we hold the row, and we
    // cannot say what the character means.
    expect(v.evidence).toBe('UNREAD')
  })

  it('★ the code itself is NAMED, in the headline, in a caution and in the gaps', () => {
    const v = resolve('000000009')
    expect(v.amscCodeNotInTable).toBe('AMSC-E')
    expect(v.headline).toContain('AMSC-E')
    expect(v.headline).toContain('does not list')
    const c = v.cautions.find((x) => x.code === 'acquisition_posture_not_determined')!
    expect(c.evidence).toBe('UNREAD')
    expect(c.sentence).toContain('AMSC-E')
    expect(c.sentence).toContain('does not list')
    expect(v.gaps.join(' ')).toContain('AMSC-E')
  })

  it('the AMC on the same row is still read, because it is a separate measured field', () => {
    const v = resolve('000000009')
    expect(v.amc?.value.token).toBe('AMC-3')
    expect(v.amc?.evidence).toBe('MEASURED')
  })

  it('a suffix code cell holding only whitespace is a row that carries NO code, not an unreadable one', () => {
    /*
     * Two different unknowns, and they must not collapse into one another. A character the table
     * does not list is "we cannot read this code". A cell holding a space is "this row carries no
     * code", which is the publisher-silence case the module was built around. Measured before the
     * trim: a single space took the verdict to `determined` with `evidence: MEASURED`.
     */
    const idx = index([{ niin: '000000010', amc: '3', amsc: '   ', pica: 'GX' }], ['GX'])
    const v = resolveDossierEligibility({ stockNumber: '000000010' }, idx)
    expect(v.state).toBe('abstained_pica_does_not_publish')
    expect(v.amscCodeNotInTable).toBeNull()
    expect(v.headline).toContain('this row carries none')
    expectNoPermissionAnywhere(v)
  })

  it('a listed code on the same shape of row still resolves, so the branch is not a blanket refusal', () => {
    // The negative control for the control: change one character and the verdict determines.
    const v = resolve('000000002')
    expect(v.determined).toBe(true)
    expect(v.amscCodeNotInTable).toBeNull()
    expect(v.evidence).toBe('MEASURED')
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

  it('★ CONTROL: every citation key a verdict carries has a label to render', () => {
    /*
     * The package carries keys; the document renders labels from `citationLabel`. If a citation
     * reaches a verdict and the label map cannot answer for it, the memo's provenance line reads
     * "source not on record in this build", which is honest and useless. The map is DISCOVERED
     * from the engine's exports, and this is the check that the discovery is actually complete.
     */
    const ids = new Set<string>()
    for (const v of EVERY_CODE) {
      for (const [where, text] of strings(v)) {
        if (where.endsWith('.citation.id')) ids.add(text)
      }
    }
    expect(ids.size).toBeGreaterThan(3)
    for (const id of ids) {
      expect(knownCitationKeys()).toContain(id)
      expect(citationLabel(id)).not.toContain('not on record')
    }
  })

  it('the AMC is pinned to the AMC rows, not to the suffix-code rows it does not appear in', () => {
    // A pin at 523-546 beside "Acquire directly from the actual manufacturer" sends a reader to a
    // range that does not carry the sentence, which is a citation that does not verify.
    const v = resolve('000000002')
    expect(v.amc?.citation.pin).toBe('nsn-cataloging-and-interchangeability.md:L510-L515')
    expect(v.amsc?.citation.pin).toBe('nsn-cataloging-and-interchangeability.md:L523-L546')
  })

  it('HOUSE LAW: no em dash in any sentence this module emits', () => {
    for (const sn of ['000000001', '000000002', '000000003', '999999999']) {
      expect(JSON.stringify(resolve(sn))).not.toMatch(/—/)
    }
  })
})

/* ------------------------------------------------------------------------------------ */

/** Every (path, string) pair in a verdict, so a scan can name WHERE it found what it found. */
function strings(value: unknown, at = '$', into: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === 'string') into.push([at, value])
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${at}[${i}]`, into))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, `${at}.${k}`, into)
  }
  return into
}

/** Every key name in a verdict, at any depth. */
function keys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keys(v, into))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k)
      keys(v, into)
    }
  }
  return into
}

/**
 * THE SWEEP: every code in both transcribed tables, on a publishing activity, on both lanes.
 *
 * A control written against one fixture proves one fixture. The three defects this block guards
 * were each found on a DIFFERENT code and a DIFFERENT citation, so the fixture here is the whole
 * cross product of the tables rather than a row somebody picked.
 */
const EVERY_CODE = (() => {
  const rows: Array<{ niin: string; amc: string; amsc: string; pica: string }> = []
  /*
   * ZERO-PADDED, AND THE PADDING IS THE POINT. Every NIIN in the government file is nine digits and
   * 28,119 of 28,119 rows in the derived index start with a zero, so a fixture built from bare
   * counters (this one used to start at 100000000) is a shape the feed never produces. It is also
   * the exact shape that hid a leak: `Number('001760600')` is 1760600, seven digits, which the memo
   * may spend, while the nine-digit run it came from is one the brief side ignores. The seed is the
   * real NIIN from that measurement.
   */
  let n = 1760600
  const niin = () => String(n++).padStart(9, '0')
  for (const a of AMC_TABLE) {
    for (const e of AMSC_TABLE) {
      rows.push({ niin: niin(), amc: String(a.code), amsc: e.code, pica: 'GX' })
    }
  }
  // Plus the codes the transcription does not carry, which are the defect-3 shape.
  for (const c of ['E', 'F', 'I', 'J', 'O', 'W', 'X']) {
    rows.push({ niin: niin(), amc: '3', amsc: c, pica: 'GX' })
  }
  const byLetteredActivity = index(rows, ['GX'])
  /*
   * THE SAME ROWS UNDER A NUMERIC MANAGING ACTIVITY. 13 of the 44 publishing activities on the real
   * extract are numeric (17, 18, 19, 28, 47, 48, 54, 75, 80, 86, 92, 93, 94), and a fixture that
   * only ever uses GX and ZW cannot see an activity code sitting in a value position. It could not,
   * and the sweep below was green while `PICA 17` was licensing the number 17 in a memo.
   */
  const numeric = rows.map((r) => ({ ...r, pica: '17' }))
  const byNumericActivity = index(numeric, ['17'])
  const lanes = ['SPE7L426U1037', 'SPE4A626T15HA']
  const out = rows.flatMap((r) =>
    lanes.flatMap((solicitationNumber) => [
      resolveDossierEligibility({ stockNumber: r.niin, solicitationNumber }, byLetteredActivity),
      resolveDossierEligibility({ stockNumber: r.niin, solicitationNumber }, byNumericActivity),
    ]),
  )
  // And the shapes that are not a catalogue hit at all, because every one of them still renders.
  const first = rows[0]!
  out.push(
    resolveDossierEligibility({ stockNumber: `5325${first.niin}` }, byLetteredActivity),
    resolveDossierEligibility({ stockNumber: '999999999' }, byLetteredActivity),
    resolveDossierEligibility({ stockNumber: 'not-a-stock-number' }, byLetteredActivity),
    resolveDossierEligibility({ stockNumber: first.niin }, { ok: false, reason: 'no index on disk' }),
  )
  return out
})()

describe('NOTHING THAT NAMES A PERSON OR A MACHINE REACHES THE PARTNER-FACING PACKAGE', () => {
  /*
   * MEASURED BEFORE THE FIX, on the first live corner row with a solicitation:
   * `JSON.stringify(pkg).includes('Wayne')` was true and `.includes('/Users/')` was true, with
   * five distinct absolute paths, and both went false when the eligibility field was deleted from
   * the same object. The route hands `JSON.stringify(pkg)` to the model as the entire user
   * message under a system prompt that says its only source of fact is the package and that it
   * may not name a person who is not in it, so a person who IS in the package was licensed. The
   * quote was deliberately kept out of the rendered document and shipped into the prompt, which
   * is the higher-stakes surface of the two.
   */
  it('★ CONTROL: no absolute path survives into any verdict, at any depth', () => {
    for (const v of EVERY_CODE) {
      for (const [where, text] of strings(v)) {
        expect(`${where} ${text}`).not.toContain('/Users/')
        // Any rooted path of two or more segments, not just this laptop's.
        expect(text).not.toMatch(/(?:^|[\s"'(=])\/[A-Za-z0-9._-]+\//)
      }
    }
  })

  it('★ CONTROL: the engine citation quote is not copied onto the verdict, in any form', () => {
    // Structural: the field cannot be there. If `packageCitation` starts copying `quote` again,
    // this fails before anybody has to think of the right name to search for.
    const k = keys(EVERY_CODE[0])
    for (const forbidden of ['quote', 'authority', 'identifier', 'source']) {
      expect([...k]).not.toContain(forbidden)
    }
  })

  it('the digest sentence that names an individual is nowhere in any verdict', () => {
    /*
     * The value check behind the structural one, aimed at the actual text: the warning at the
     * pin `nsn-cataloging-and-interchangeability.md:L565` ends "...the system will suppress
     * Wayne's best leads." Our own restatement of it must still be present, in our vocabulary.
     */
    for (const v of EVERY_CODE) {
      const json = JSON.stringify(v)
      expect(json).not.toContain('Wayne')
      expect(json).not.toContain('best leads')
    }
    expect(EVERY_CODE[0]!.surplusSupplyNote.sentence).toContain('does not by itself bar')
  })
})

describe('THE VERDICT SPENDS NO NUMBER: the grounding guard is not widened by provenance', () => {
  /*
   * MEASURED BEFORE THE FIX: adding the eligibility field took a real package's allowed-number
   * set from 32 entries to 46, and a synthetic one from 28 to 42. The additions were 3 (the AMC
   * carried as a number), 4 and 4100 and 4100.39 ('DoD 4100.39-M Volume 10, Chapter 4'), 7
   * ('research digest ... section 7'), 71 ('Table 71, Acquisition Method Suffix Code') and 90
   * ('the minimum of 90 days validity period', inside a citation quote nothing rendered). The
   * fabricated sentences "There are 71 approved sources on this part." and "The last buy ran 7
   * units." and "Four of the 4 holders list stock." were each stripped by the guard before the
   * field existed and each survived it afterwards.
   *
   * THE ONE ALLOWED EXCEPTION IS NAMED, NOT SWEPT UP. AMSC L's verbatim explanation says the
   * annual buy value "falls below the $10,000 screening threshold". That is a measured fact about
   * the item, in the government's own words, and it is exactly the kind of number the package is
   * supposed to license. Everything else the eligibility block used to contribute was citation
   * plumbing: a table number, a chapter number, a section number, a document number.
   */
  const AMSC_L_THRESHOLD = 10000

  /**
   * THE ALLOWLIST. One entry, named, with the reason it belongs: it is a measured fact about the
   * item in the government's own words. Everything else the eligibility block has ever contributed
   * was citation plumbing or a machine identifier. A number that turns up here and is not on this
   * list is a defect until somebody adds it deliberately and says why.
   */
  const ALLOWED = new Set([String(AMSC_L_THRESHOLD), AMSC_L_THRESHOLD.toFixed(2)])

  it('★ CONTROL: across every code in both tables, the only value the verdict adds is the one named above', () => {
    /*
     * THE REAL HARVESTER, NOT A MODEL OF IT. THIS CONTROL USED TO PASS FOR THE WRONG REASON.
     *
     * It walked the verdict with `valueTokensIn` and skipped every digit run of 8 or more
     * characters, on the stated premise that "8+ contiguous digits is an identifier, not a value
     * claim, on both sides of the guard". That premise is false and it was the assumption under
     * test. Only the BRIEF side skips long runs; `collectNumbers`, which builds the allowed set,
     * harvests them and `Number()` collapses the leading zeros. MEASURED on this file's own
     * fixture: `resolveDossierEligibility({stockNumber:'000000002'})` made
     * `allowedNumberSet(verdict)` equal {'2','2.00'} while this control computed an empty spent
     * set and passed. On the live corner map the same shape licensed "The modeled buy value is
     * $1,760,600." on a row whose real modeled value is $57,634.32. A control that passes for the
     * wrong reason is worse than no control, because it retires the question.
     *
     * So the harvest is now `allowedNumberSet` itself, the exact function the product runs, and
     * the per-leaf attribution below is asserted to reconstruct it exactly rather than to
     * approximate it.
     */
    const spent = new Map<string, string>()
    for (const v of EVERY_CODE) {
      for (const [where, text] of strings(v)) {
        for (const n of allowedNumberSet(text)) if (!spent.has(n)) spent.set(n, `${where} :: ${text}`)
      }
      for (const n of collectNumbers(v)) {
        for (const f of allowedNumberSet(n)) if (!spent.has(f)) spent.set(f, `a numeric field carrying ${n}`)
      }
      // The attribution must BE the real set, or the diagnostic above is a fiction and a number
      // could be donated by a leaf shape this walk does not visit.
      for (const n of allowedNumberSet(v)) expect(spent.has(n)).toBe(true)
    }
    expect([...spent.entries()].filter(([n]) => !ALLOWED.has(n))).toEqual([])
  })

  it('the AMSC L threshold is present, and it is present as the government wrote it', () => {
    // The negative half of the control above: it is not asserting that the verdict is number-free,
    // it is asserting that the ONLY number is the measured one. If that disappeared, the control
    // above would still pass while the memo lost a real fact.
    const l = EVERY_CODE.find((v) => v.amsc?.value.token === 'AMSC-L')!
    expect(l.amsc?.value.meaning).toContain('$10,000 screening threshold')
  })

  it('★ CONTROL: a code and a citation both survive the round trip as identifier fragments', () => {
    const v = resolve('000000002')
    // If `AcquisitionCode.token` reverts to a bare number, or `pinned` stops rewriting, the
    // tokenizer starts seeing a value here and the control above goes red.
    expect(valueTokensIn(v.amc!.value.token)).toEqual([])
    expect(valueTokensIn(v.amsc!.citation.id)).toEqual([])
    expect(valueTokensIn(v.amsc!.citation.pin)).toEqual([])
  })
})

/** Every raw number field in a value, at any depth. Numbers never pass through the tokenizer. */
function collectNumbers(value: unknown, into: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) into.push(value)
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, into))
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectNumbers(v, into)
  }
  return into
}
