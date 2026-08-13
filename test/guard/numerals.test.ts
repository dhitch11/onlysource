import { describe, expect, it } from 'vitest'
import { extractNumerals, parseSpelledNumber } from '@/lib/guard/numerals'
import { checkNumerals, validateVoicemailScript, type Violation } from '@/lib/guard/firewall'
import { canonicaliseIdentifier, normaliseForGuard } from '@/lib/guard/normalize'

/**
 * Return the first violation, ASSERTING that one exists.
 *
 * This is the repair for strict index checking rather than a silencing of it, and it makes the
 * test stricter: `r.violations[0].reason` quietly passes `undefined === undefined` shapes in a
 * weaker config, whereas this fails loudly when a check produced no violation at all, which is
 * the exact regression these tests exist to catch.
 */
function firstViolation(r: { violations: Violation[] }): Violation {
  expect(r.violations.length).toBeGreaterThan(0)
  const v = r.violations[0]
  if (v === undefined) throw new Error('expected at least one violation')
  return v
}

/**
 * Acceptance Gate R1.3: the numeral extractor property suite, at least 300 evasion cases,
 * 100% catch on protected classes. R1.5: the voicemail digit validator including spelled forms.
 *
 * The suite is built so that it CAN fail. Every negative assertion below has a positive
 * control beside it proving the same instrument reports the other answer on the other input.
 * A negative test with no positive control is a test that would pass against a stub.
 */

describe('the named defect: "eighteen fifty resolves to 68"', () => {
  it('reads "eighteen fifty" as 1850 and never as 68', () => {
    const parsed = parseSpelledNumber(['eighteen', 'fifty'])
    expect(parsed?.value).toBe(1850)
    expect(parsed?.value).not.toBe(68)
  })

  it('still reads "twenty five" as 25, which is what the naive sum gets right', () => {
    expect(parseSpelledNumber(['twenty', 'five'])?.value).toBe(25)
  })

  it('reads year-shaped and price-shaped pairs the way a person says them', () => {
    expect(parseSpelledNumber(['nineteen', 'ninety', 'nine'])?.value).toBe(1999)
    expect(parseSpelledNumber(['twenty', 'twenty', 'six'])?.value).toBe(2026)
    expect(parseSpelledNumber(['nineteen', 'oh', 'five'])?.value).toBe(1905)
  })

  it('reads the explicit scale form identically to the pair form', () => {
    expect(parseSpelledNumber(['eighteen', 'hundred', 'fifty'])?.value).toBe(1850)
    expect(parseSpelledNumber(['one', 'thousand', 'eight', 'hundred', 'fifty'])?.value).toBe(1850)
  })

  it('catches the spelled price in running text', () => {
    const r = checkNumerals('We can supply at eighteen fifty each.', { price: '$1,850.00' })
    expect(r.ok).toBe(true)
    // Positive control: the same sentence against a different approved price must block.
    const bad = checkNumerals('We can supply at eighteen fifty each.', { price: '$68.00' })
    expect(bad.ok).toBe(false)
    expect(firstViolation(bad).reason).toBe('UNAPPROVED_NUMERAL')
  })
})

describe('normalisation closes the script and invisible-character families', () => {
  it('folds non-ASCII digit scripts to ASCII', () => {
    expect(normaliseForGuard('١٨٥٠').text).toBe('1850') // Arabic-Indic
    expect(normaliseForGuard('१८५०').text).toBe('1850') // Devanagari
    expect(normaliseForGuard('１８５０').text).toBe('1850') // fullwidth
  })

  it('removes invisible characters that split a numeral', () => {
    const split = '18​50'
    expect(normaliseForGuard(split).text).toBe('1850')
    expect(normaliseForGuard(split).observed).toContain('invisible-characters')
  })

  it('reports nothing on clean text, so the report is not a rubber stamp', () => {
    expect(normaliseForGuard('1850').observed).toEqual([])
    expect(normaliseForGuard('1850').changed).toBe(false)
  })

  it('folds homoglyphs in identifiers but leaves prose alone', () => {
    // Cyrillic К and Т rendering as Latin K and T inside a CAGE code.
    expect(canonicaliseIdentifier('0КTM3')).toBe(canonicaliseIdentifier('0KTM3'))
    expect(canonicaliseIdentifier('5365-01-180-5372')).toBe('5365011805372')
  })
})

describe('identifiers compare exactly, values compare numerically', () => {
  const slots = { nsn: '5365-01-180-5372', cage: '29372', qty: '190', price: '$1,850.00' }

  it('approves the exact stock number in any separator style', () => {
    expect(checkNumerals('NSN 5365-01-180-5372, 190 each.', slots).ok).toBe(true)
    expect(checkNumerals('NSN 5365 01 180 5372, 190 each.', slots).ok).toBe(true)
  })

  it('BLOCKS a transposed stock number even though it is the same digits', () => {
    const r = checkNumerals('NSN 5365-01-180-5327, 190 each.', slots)
    expect(r.ok).toBe(false)
    expect(firstViolation(r).reason).toBe('IDENTIFIER_MISMATCH')
    expect(firstViolation(r).klass).toBe('NSN_OR_PART')
  })

  it('approves a money value written in a different display form', () => {
    expect(checkNumerals('Our price is 1850 per unit.', slots).ok).toBe(true)
    expect(checkNumerals('Our price is $1,850.00 per unit.', slots).ok).toBe(true)
  })

  it('BLOCKS a quantity the engine never supplied', () => {
    const r = checkNumerals('We can supply 191 each.', slots)
    expect(r.ok).toBe(false)
    expect(firstViolation(r).reason).toBe('UNAPPROVED_NUMERAL')
  })

  it('polices PLAIN COUNTS, inverting the healthcare default', () => {
    const r = checkNumerals('We have 7 on the shelf.', slots)
    expect(r.ok).toBe(false)
    expect(firstViolation(r).klass).toBe('QUANTITY')
  })
})

describe('R1.3 evasion property suite: at least 300 renderings of an unapproved number', () => {
  /** Renderings of a value that a person reads as that value but a naive check misses. */
  function renderings(n: number): string[] {
    const s = String(n)
    const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const spaced = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    const apost = s.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
    const toScript = (base: number) =>
      [...s].map((d) => String.fromCodePoint(base + Number(d))).join('')
    const zwsp = [...s].join('​')
    const zwnj = [...s].join('‌')
    return [
      s, grouped, spaced, apost, `${s}.00`, `$${s}`, `$${grouped}`, `${s} USD`, `${s} each`,
      `${s}%`, `qty ${s}`, `${s}ea`,
      toScript(0x0660), toScript(0x06f0), toScript(0x0966), toScript(0xff10),
      zwsp, zwnj, `‭${s}‬`,
    ]
  }

  const APPROVED = { qty: '190', price: '$1,850.00' }
  // Values that are NOT in the approved set. Each renders ~19 ways, so 20 values clears 300.
  const UNAPPROVED = [
    7, 12, 33, 48, 55, 64, 68, 71, 99, 105, 144, 187, 191, 250, 399, 512, 640, 875, 1200, 2600,
  ]

  const cases: Array<{ value: number; text: string }> = []
  for (const v of UNAPPROVED) for (const r of renderings(v)) cases.push({ value: v, text: r })

  it(`covers at least 300 cases (actual: ${cases.length})`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(300)
  })

  it('catches 100% of unapproved renderings', () => {
    const escaped: string[] = []
    for (const c of cases) {
      const r = checkNumerals(`We can supply ${c.text} on this line.`, APPROVED)
      if (r.ok) escaped.push(`${c.value} rendered as ${JSON.stringify(c.text)}`)
    }
    expect(escaped).toEqual([])
  })

  it('POSITIVE CONTROL: the same instrument approves the approved value in every rendering', () => {
    const missed: string[] = []
    for (const r of renderings(190)) {
      const res = checkNumerals(`We can supply ${r} on this line.`, APPROVED)
      if (!res.ok && res.violations.every((v) => v.reason !== 'EVASION_MARKERS')) {
        missed.push(JSON.stringify(r))
      }
    }
    expect(missed).toEqual([])
  })
})

describe('R1.5 voicemail digit validator: zero generative content, no allow-list', () => {
  const slots = { firm: 'Western Airparts', qty: '190', callback: '555-0142', due: '2026-08-15' }

  it('passes a script composed only from stored fields', () => {
    const script =
      'This is an automated assistant calling on behalf of Western Airparts about 190 units. ' +
      'Please call back on 555-0142 by 2026-08-15.'
    expect(validateVoicemailScript(script, slots).ok).toBe(true)
  })

  it('fails a script carrying a digit outside the slot set', () => {
    const script = 'Please call back on 555-0142. We need 250 units by 2026-08-15.'
    const r = validateVoicemailScript(script, slots)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.raw.includes('250'))).toBe(true)
  })

  it('fails a script carrying a SPELLED digit outside the slot set', () => {
    const script = 'We need two hundred fifty units. Call 555-0142.'
    const r = validateVoicemailScript(script, slots)
    expect(r.ok).toBe(false)
    expect(firstViolation(r).reason).toBe('UNAPPROVED_NUMERAL')
  })
})

describe('unreadable and evasive input fails closed', () => {
  it('surfaces evasion markers even when every numeral is approved', () => {
    const r = checkNumerals('We can supply 1​90 units.', { qty: '190' })
    expect(r.evasion).toContain('invisible-characters')
  })

  it('extracts nothing from text with no numbers, so an empty finding is real', () => {
    expect(extractNumerals('Please confirm availability and send the packing slip.')).toEqual([])
    expect(checkNumerals('Please confirm availability.', {}).ok).toBe(true)
  })
})
