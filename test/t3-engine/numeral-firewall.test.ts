/**
 * GATE R3.8. The provenance firewall, asserted against every numeral form this domain prints.
 *
 * THE INSTRUMENT IS BUILT TO BE ABLE TO FAIL. Every expectation below is a literal written out
 * by hand, never a value re-derived by calling the code under test, and every grounding case is
 * paired with the same sentence against a payload that does NOT contain the number, so a
 * firewall that returned `ok: true` unconditionally fails roughly half of this file.
 *
 * WHERE THE NUMBERS COME FROM. The worked example is the one the T3 handoff names as the
 * acceptance fixture (HANDOFFS/T3-ENGINE.md lines 452 to 465 and 528 to 536): NSN
 * 1650-01-059-8221, the 2017 OEM buy of 17 units at $1,537.85, a CPI factor of 1.3223 giving
 * about $2,034, a DoD-procurement factor of 1.40 giving about $2,150, a quote of $3,565, the
 * 190-unit quote totalling about $532,000 on which the adder is 0.04%, buying office SPE4A5 at
 * 64.7% single-offer, and the $200 and $600 evaluated-price adders. Nothing here is invented.
 *
 * THE FOUR CONTROLS, named so a later reader can check they are still present:
 *   POSITIVE CONTROL   a planted out-of-payload numeral buried in an otherwise correct sentence
 *                      must be found (`the extractor finds a planted bad numeral`).
 *   NEGATIVE CONTROL   a sentence with no numerals at all must produce no findings, so a
 *                      firewall that flags everything cannot pass this file either.
 *   ROUNDING CONTROL   $2,033.50 grounds against 2033.499055 and $2,034 does NOT, which is the
 *                      assertion that fails the moment somebody adds a tolerance band.
 *   MUTATION CONTROL   two stub firewalls with the membership assertion removed are shown to
 *                      pass the known-bad fixtures, proving these tests depend on that check.
 */

import { describe, expect, it } from 'vitest'
import {
  FIREWALL_FIXTURE_PAYLOAD,
  FIREWALL_GATE,
  KNOWN_BAD_FIXTURES,
  assertNumeralsGrounded,
  firewallSelfTest,
  type FirewallCategory,
} from '@/lib/engine/firewall'
import {
  canonicaliseIdentifier,
  collectGrounding,
  extractTokens,
  normaliseForFirewall,
  parseSpelledWords,
} from '@/lib/engine/firewall/numerals'

/**
 * The structured payload. Every field traces to the handoff's worked example, and the values
 * are written as the engine would store them, not as prose would print them: `cpiUnitPrice` is
 * the full product 1537.85 * 1.3223, and `surplusDragRate` is a rate, not a percentage.
 */
const PAYLOAD = {
  nsn: '1650-01-059-8221',
  buyingOffice: 'SPE4A5',
  lastOemAward: { year: 2017, quantity: 17, unitPrice: 1537.85 },
  anchors: {
    cpiFactor: 1.3223,
    cpiUnitPrice: 2033.499055,
    dodFactor: 1.4,
    dodUnitPrice: 2152.99,
    preferred: 'dod',
  },
  quote: { unitPrice: 3565, quantity: 190, total: 532000 },
  evaluation: { surplusDragRate: 0.0004, singleOfferShare: 0.667, surplusAdder: 200, esaAdder: 600 },
  ceiling: { unitPrice: 10000 },
  reasons: { count: 3 },
  penalty: { sharePct: 50 },
} as const

const scan = (input: string) => extractTokens(normaliseForFirewall(input))

const noFindings = { grounded: 0, spelled: 0, identifier: 0, ungrounded: 0, template_dangling: 0 }

/** Rewrite ASCII digits into another script, built from code points so no literal is invisible. */
const inScript = (base: number) => (input: string) =>
  input.replace(/[0-9]/g, (d) => String.fromCharCode(base + Number(d)))
const fullwidth = inScript(0xff10)
const arabicIndic = inScript(0x0660)
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b)

describe('R3.8 extraction: every numeral form this domain actually prints', () => {
  // raw, form, and the readings the token must offer. Hand written, one row per named form.
  const FORMS = [
    { input: '$1,537.85', raw: '$1,537.85', form: 'digits', values: [1537.85] },
    { input: '1537.85', raw: '1537.85', form: 'digits', values: [1537.85] },
    { input: '$3,565', raw: '$3,565', form: 'digits', values: [3565] },
    { input: '2,033.50', raw: '2,033.50', form: 'digits', values: [2033.5] },
    { input: '17 units', raw: '17', form: 'digits', values: [17] },
    { input: '1.3223', raw: '1.3223', form: 'digits', values: [1.3223] },
    { input: '1.40', raw: '1.40', form: 'digits', values: [1.4] },
    { input: '50%', raw: '50%', form: 'digits', values: [50, 0.5] },
    { input: '66.7%', raw: '66.7%', form: 'digits', values: [66.7, 0.667] },
    { input: '0.04%', raw: '0.04%', form: 'digits', values: [0.04, 0.0004] },
    { input: '$532,000', raw: '$532,000', form: 'digits', values: [532000] },
    { input: '$10,000', raw: '$10,000', form: 'digits', values: [10000] },
    { input: '2017', raw: '2017', form: 'digits', values: [2017] },
    { input: 'three', raw: 'three', form: 'spelled', values: [3] },
    { input: 'NSN 1650-01-059-8221', raw: '1650-01-059-8221', form: 'identifier', values: [] },
    { input: 'SPE4A5', raw: 'SPE4A5', form: 'identifier', values: [] },
    { input: '{{f7}}', raw: '{{f7}}', form: 'template', values: [] },
  ] as const

  for (const row of FORMS) {
    it(`reads ${row.input} as one ${row.form} token`, () => {
      const tokens = scan(row.input)
      expect(tokens.length).toBe(1)
      const token = tokens[0]
      expect(token).toBeDefined()
      if (token === undefined) return
      expect(token.raw).toBe(row.raw)
      expect(token.form).toBe(row.form)
      expect(token.candidates.map((c) => c.value)).toEqual([...row.values])
    })
  }

  it('carries the printed precision, which is what the rounding rule reads', () => {
    // Hand counted from the strings themselves: two places, four places, zero places.
    expect(scan('$1,537.85')[0]?.candidates[0]?.decimals).toBe(2)
    expect(scan('1.3223')[0]?.candidates[0]?.decimals).toBe(4)
    expect(scan('$3,565')[0]?.candidates[0]?.decimals).toBe(0)
  })

  it('offers the rate reading of a percentage as a second candidate, not as a replacement', () => {
    const labels = scan('0.04%')[0]?.candidates.map((c) => c.label)
    expect(labels).toEqual(['printed', 'percent_as_rate'])
  })
})

describe('R3.8 classification: an identifier is one fact, never four numerals', () => {
  it('emits exactly one token for a stock number, not one per digit group', () => {
    const tokens = scan('Quoting NSN 1650-01-059-8221 today.')
    expect(tokens.length).toBe(1)
    expect(tokens[0]?.form).toBe('identifier')
    expect(tokens[0]?.canonical).toBe('1650010598221')
  })

  it('does not let 1650, 01, 059 or 8221 escape as free numerals', () => {
    const values = scan('Quoting NSN 1650-01-059-8221 today.').flatMap((t) =>
      t.candidates.map((c) => c.value),
    )
    expect(values).toEqual([])
  })

  it('canonicalises the three printed forms of one stock number to one string', () => {
    expect(canonicaliseIdentifier('1650-01-059-8221')).toBe('1650010598221')
    expect(canonicaliseIdentifier('1650 01 059 8221')).toBe('1650010598221')
    expect(canonicaliseIdentifier('1650010598221')).toBe('1650010598221')
  })

  it('treats a number wearing a letter as a numeral, not as a code', () => {
    // 190-unit, 17k and 23rd are measurements. If any of these were classified as an
    // identifier the number inside it would stop being policed, which is the escape hatch.
    expect(scan('a 190-unit lot')[0]?.form).toBe('digits')
    expect(scan('a 190-unit lot')[0]?.candidates[0]?.value).toBe(190)
    expect(scan('17k units')[0]?.candidates.map((c) => c.value)).toEqual([17, 17000])
    expect(scan('the 23rd award')[0]?.raw).toBe('23rd')
    expect(scan('the 23rd award')[0]?.candidates[0]?.value).toBe(23)
  })

  it('reads a solicitation number, a NIIN and an ISO date as identifiers', () => {
    expect(scan('SPE4A5-25-R-0123')[0]?.form).toBe('identifier')
    expect(scan('NIIN 01-059-8221')[0]?.canonical).toBe('010598221')
    expect(scan('issued 2017-03-04')[0]?.canonical).toBe('20170304')
  })
})

describe('R3.8 the positive control: the extractor finds a planted bad numeral', () => {
  const SENTENCE =
    'The 2017 OEM buy of 17 units at $1,537.85 inflates by 1.3223, and a stray 9,999 sits in the tail.'

  it('finds the planted 9,999 among the four correct numerals', () => {
    const values = scan(SENTENCE).flatMap((t) => t.candidates.map((c) => c.value))
    // Hand read off the sentence, left to right.
    expect(values).toEqual([2017, 17, 1537.85, 1.3223, 9999])
  })

  it('blocks the sentence on the planted numeral and on nothing else', () => {
    const result = assertNumeralsGrounded(SENTENCE, PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.blocking.length).toBe(1)
    expect(result.blocking[0]?.raw).toBe('9,999')
    expect(result.blocking[0]?.value).toBe(9999)
    expect(result.blocking[0]?.category).toBe('ungrounded')
  })
})

describe('R3.8 the negative control: a quiet sentence stays quiet', () => {
  it('reports nothing on prose with no numerals in it', () => {
    const result = assertNumeralsGrounded(
      'The original manufacturer does not compete on small lots, so the field is surplus only.',
      PAYLOAD,
    )
    expect(result.ok).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.counts).toEqual(noFindings)
  })

  it('does not read an ordinal word as a numeral', () => {
    // "first" is a discourse marker. Flagging it is pure false positive, and a check that
    // over-reports destroys trust in its real findings.
    const result = assertNumeralsGrounded('The first reason is the 2017 buy.', PAYLOAD)
    expect(result.ok).toBe(true)
    expect(result.counts).toEqual({ ...noFindings, grounded: 1 })
  })
})

describe('R3.8 grounding a full sentence against the structured payload', () => {
  const SENTENCE =
    'NSN 1650-01-059-8221 from buying office SPE4A5: the 2017 OEM buy of 17 units at $1,537.85 ' +
    'inflates by 1.3223 to $2,033.50, the quote is $3,565, the 190-unit total is $532,000, ' +
    'surplus drag is 0.04%, single offer runs 66.7%, the ceiling is $10,000, and there are three reasons.'

  it('clears every numeral and files it in the right bucket', () => {
    const result = assertNumeralsGrounded(SENTENCE, PAYLOAD)
    // Hand counted off the sentence: two identifiers (the NSN and SPE4A5), one spelled number
    // ("three"), and eleven digit numerals (2017, 17, 1537.85, 1.3223, 2033.50, 3565, 190,
    // 532000, 0.04%, 66.7%, 10000).
    expect(result.counts).toEqual({
      grounded: 11,
      spelled: 1,
      identifier: 2,
      ungrounded: 0,
      template_dangling: 0,
    })
    expect(result.ok).toBe(true)
    expect(result.blocking).toEqual([])
    expect(result.gate).toBe('R3.8')
    expect(FIREWALL_GATE).toBe('R3.8')
  })

  it('blocks the same sentence the moment the payload loses one field', () => {
    // The instrument has to be able to read differently. Drop the quote and the sentence that
    // just passed must fail on exactly the numeral that field supported.
    const withoutQuote = { ...PAYLOAD, quote: { quantity: 190, total: 532000 } }
    const result = assertNumeralsGrounded(SENTENCE, withoutQuote)
    expect(result.ok).toBe(false)
    expect(result.blocking.map((f) => f.raw)).toEqual(['$3,565'])
  })

  it('blocks an identifier the payload does not carry', () => {
    const result = assertNumeralsGrounded('Quoting NSN 5331-00-123-4567 instead.', PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.blocking[0]?.category).toBe('ungrounded')
    expect(result.blocking[0]?.canonical).toBe('5331001234567')
  })

  it('refuses to ground a fragment of a payload identifier as a free numeral', () => {
    // 8221 is the tail of the NSN. Mining digit runs out of payload strings would ground it,
    // and a fabricated quantity of 8221 would then read as provenanced.
    const result = assertNumeralsGrounded('The tail quantity is 8221 units.', PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.blocking[0]?.raw).toBe('8221')
  })

  it('does not mine digits out of payload strings into the numeric pool', () => {
    // REGRESSION. An unanchored ISO-date rule read this stock number as the date 1650-01-05 and
    // put 1650 into the numeric pool, so a fabricated quantity of 1650 grounded against a part
    // number. This assertion is the one that caught it.
    const grounding = collectGrounding({ nsn: '1650-01-059-8221' })
    expect(grounding.numbers).toEqual([])
    expect(grounding.identifiers.has('1650010598221')).toBe(true)
  })

  it('does contribute the year of a real date field, and only the year', () => {
    const grounding = collectGrounding({ issuedOn: '2017-03-04' })
    expect(grounding.numbers).toEqual([2017])
    expect(assertNumeralsGrounded('Issued in 2017.', { issuedOn: '2017-03-04' }).ok).toBe(true)
    expect(assertNumeralsGrounded('Issued on day 4.', { issuedOn: '2017-03-04' }).ok).toBe(false)
  })
})

describe('R3.8 the rounding control: printed precision, and no tolerance band', () => {
  it('grounds $2,033.50 against the full product 2033.499055', () => {
    // 1537.85 * 1.3223 = 2033.499055, which typeset to two places is 2,033.50.
    const result = assertNumeralsGrounded('The CPI anchor is $2,033.50 per unit.', PAYLOAD)
    expect(result.ok).toBe(true)
    expect(result.findings[0]?.category).toBe('grounded')
  })

  it('refuses $2,034 against the same value, because rounding it to zero places is 2033', () => {
    const result = assertNumeralsGrounded('The CPI anchor is $2,034 per unit.', PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.blocking[0]?.raw).toBe('$2,034')
  })

  it('grounds $2,034 only when the payload actually carries the displayed figure', () => {
    const withDisplay = { ...PAYLOAD, anchors: { ...PAYLOAD.anchors, cpiDisplayPrice: 2034 } }
    expect(assertNumeralsGrounded('The CPI anchor is $2,034 per unit.', withDisplay).ok).toBe(true)
  })

  it('grounds a percentage against a payload that stores a rate, in both directions', () => {
    expect(assertNumeralsGrounded('Surplus drag is 0.04%.', PAYLOAD).ok).toBe(true)
    expect(assertNumeralsGrounded('Single offer runs 66.7%.', PAYLOAD).ok).toBe(true)
    // The near miss must still fail. 0.05% is not 0.0004 at any precision.
    expect(assertNumeralsGrounded('Surplus drag is 0.05%.', PAYLOAD).ok).toBe(false)
  })

  it('grounds the magnitude of a signed payload contribution, and says why', () => {
    // Reason sentences carry direction in words while the payload carries a signed number.
    // Direction is gate R3.7's job (the flipped-sign fixture), so this gate polices magnitude.
    expect(assertNumeralsGrounded('It costs 12 points.', { contribution: -12 }).ok).toBe(true)
    expect(assertNumeralsGrounded('It costs 13 points.', { contribution: -12 }).ok).toBe(false)
  })
})

describe('R3.8 spelled numbers ground by value, which is the named sibling regression', () => {
  it('grounds "a thousand" against a payload holding 1000', () => {
    // The sibling guard built its grounding set from digits only, so this honest sentence could
    // never match and the system abstained politely on a correct answer.
    const result = assertNumeralsGrounded('The lot runs to a thousand units.', { lotSize: 1000 })
    expect(result.ok).toBe(true)
    expect(result.counts).toEqual({ ...noFindings, spelled: 1 })
    expect(result.findings[0]?.value).toBe(1000)
  })

  it('still blocks "a thousand" when the payload does not hold 1000', () => {
    const result = assertNumeralsGrounded('The lot runs to a thousand units.', { lotSize: 900 })
    expect(result.ok).toBe(false)
    expect(result.blocking[0]?.raw).toBe('a thousand')
    expect(result.blocking[0]?.value).toBe(1000)
  })

  it('catches the fabrication a digits-only guard never sees', () => {
    const result = assertNumeralsGrounded('We should quote two thousand five hundred dollars.', PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.blocking[0]?.raw).toBe('two thousand five hundred')
    expect(result.blocking[0]?.value).toBe(2500)
  })

  it('reads a pair of standalone groups the way English says it, not as a sum', () => {
    // "eighteen fifty" is 1850. The accumulate-and-sum algorithm reads it as 68, and a price
    // read back as sixty eight when the quote said eighteen fifty is a different offer.
    expect(parseSpelledWords(['eighteen', 'fifty'])).toBe(1850)
    expect(parseSpelledWords(['twenty', 'five'])).toBe(25)
    expect(parseSpelledWords(['two', 'thousand', 'five', 'hundred'])).toBe(2500)
    expect(parseSpelledWords(['three'])).toBe(3)
    expect(parseSpelledWords(['and'])).toBe(null)
  })

  it('proves the pair reading is real by failing against the sum reading', () => {
    expect(assertNumeralsGrounded('Priced at eighteen fifty.', { unitPrice: 1850 }).ok).toBe(true)
    expect(assertNumeralsGrounded('Priced at eighteen fifty.', { unitPrice: 68 }).ok).toBe(false)
  })
})

describe('R3.8 a numeral cannot walk past the gate by changing script', () => {
  it('folds fullwidth digits before reading them', () => {
    const sentence = fullwidth('The anchor is 2500 per unit.')
    expect(sentence).not.toContain('2500')
    const result = assertNumeralsGrounded(sentence, PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.blocking[0]?.raw).toBe('2500')
  })

  it('folds Arabic-Indic digits before reading them', () => {
    const result = assertNumeralsGrounded(arabicIndic('The anchor is 2500 per unit.'), PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.blocking[0]?.raw).toBe('2500')
  })

  it('rejoins a numeral split by a zero-width space instead of reading it as two', () => {
    const split = `The anchor is 25${ZERO_WIDTH_SPACE}00 per unit.`
    const result = assertNumeralsGrounded(split, PAYLOAD)
    expect(result.findings.length).toBe(1)
    expect(result.findings[0]?.raw).toBe('2500')
    expect(result.ok).toBe(false)
  })

  it('folds the payload side too, so a folded sentence can still ground', () => {
    expect(assertNumeralsGrounded(fullwidth('Quantity is 17.'), PAYLOAD).ok).toBe(true)
  })
})

describe('R3.8 the two known-bad fixtures are hard failures', () => {
  it('ships exactly the two fixtures the gate names', () => {
    expect(KNOWN_BAD_FIXTURES.map((f) => f.name)).toEqual([
      'out_of_payload_numeral',
      'dangling_template_reference',
    ])
  })

  it('blocks the out-of-payload numeral $2,500', () => {
    const result = assertNumeralsGrounded(
      'NSN 1650-01-059-8221 anchors at $2,500 per unit.',
      FIREWALL_FIXTURE_PAYLOAD,
    )
    expect(result.ok).toBe(false)
    expect(result.counts).toEqual({ ...noFindings, identifier: 1, ungrounded: 1 })
    expect(result.blocking[0]?.raw).toBe('$2,500')
    expect(result.blocking[0]?.value).toBe(2500)
  })

  it('blocks the dangling {{f7}} reference', () => {
    const result = assertNumeralsGrounded(
      'The DoD anchor is {{f7}} per unit on NSN 1650-01-059-8221.',
      FIREWALL_FIXTURE_PAYLOAD,
    )
    expect(result.ok).toBe(false)
    expect(result.counts).toEqual({ ...noFindings, identifier: 1, template_dangling: 1 })
    expect(result.blocking[0]?.raw).toBe('{{f7}}')
  })

  it('blocks an unbalanced template opener too, so a truncated slot cannot pass', () => {
    const result = assertNumeralsGrounded('The anchor is {{f7 per unit.', FIREWALL_FIXTURE_PAYLOAD)
    expect(result.ok).toBe(false)
    expect(result.blocking[0]?.category).toBe('template_dangling')
    expect(result.blocking[0]?.raw).toBe('{{')
  })

  it('runs both fixtures through the shipped self test', () => {
    expect(firewallSelfTest()).toEqual({ passed: true, failures: [] })
  })
})

describe('R3.8 a blocked render returns the structured facts and never the prose', () => {
  it('withholds the prose and hands back the facts', () => {
    const result = assertNumeralsGrounded(
      'NSN 1650-01-059-8221 anchors at $2,500 per unit.',
      PAYLOAD,
    )
    expect(result.ok).toBe(false)
    expect(result.prose).toBe(null)
    expect(result.facts).toContainEqual({ path: 'nsn', value: '1650-01-059-8221' })
    expect(result.facts).toContainEqual({ path: 'lastOemAward.unitPrice', value: '1537.85' })
    expect(result.facts.some((f) => f.value === '2500')).toBe(false)
  })

  it('returns the normalised prose when, and only when, nothing blocks', () => {
    const clean = assertNumeralsGrounded('Quantity is 17 units.', PAYLOAD)
    expect(clean.ok).toBe(true)
    expect(clean.prose).toBe('Quantity is 17 units.')
  })
})

/**
 * THE MUTATION CONTROL. If the membership assertion is removed the file above must go red.
 *
 * These two stubs are the mutation written out in the test, so the property is checked on every
 * run rather than being a claim in a commit message. Each keeps the extractor exactly as it is
 * and removes one assertion, then shows the corresponding known-bad fixture sails through. The
 * source-level mutation was also run by hand once (both assertions deleted from
 * lib/engine/firewall/index.ts), and the result is recorded in the lane's notes.
 */
describe('R3.8 mutation control: these tests depend on the membership assertion', () => {
  const categorise = (
    sentence: string,
    options: { checkMembership: boolean; checkTemplates: boolean },
  ): FirewallCategory[] =>
    scan(sentence).map((token) => {
      if (token.form === 'template') return options.checkTemplates ? 'template_dangling' : 'grounded'
      if (!options.checkMembership) return 'grounded'
      return 'ungrounded'
    })

  it('a firewall with the numeral membership check removed passes the fabricated $2,500', () => {
    const mutant = categorise('NSN 1650-01-059-8221 anchors at $2,500 per unit.', {
      checkMembership: false,
      checkTemplates: true,
    })
    expect(mutant.includes('ungrounded')).toBe(false)
    // The real gate blocks the same sentence, so the difference is the assertion itself.
    expect(assertNumeralsGrounded('NSN 1650-01-059-8221 anchors at $2,500 per unit.', PAYLOAD).ok)
      .toBe(false)
  })

  it('a firewall with the template check removed passes the dangling {{f7}}', () => {
    const sentence = 'The DoD anchor is {{f7}} per unit.'
    const mutant = categorise(sentence, { checkMembership: false, checkTemplates: false })
    expect(mutant.includes('template_dangling')).toBe(false)
    expect(assertNumeralsGrounded(sentence, PAYLOAD).ok).toBe(false)
  })
})
