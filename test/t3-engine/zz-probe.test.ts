import { describe, expect, it } from 'vitest'
import { assertNumeralsGrounded, FIREWALL_FIXTURE_PAYLOAD } from '@/lib/engine/firewall'
import { collectGrounding } from '@/lib/engine/firewall/numerals'

describe('probes', () => {
  it('shipped fixture payload is itself polluted', () => {
    console.log('FIXTURE POOL:', JSON.stringify(collectGrounding(FIREWALL_FIXTURE_PAYLOAD).numbers))
    console.log('$1,650 vs shipped fixture ok =',
      assertNumeralsGrounded('The anchor is $1,650 per unit.', FIREWALL_FIXTURE_PAYLOAD).ok)
  })
  it('printed 0 grounds against a tiny rate (absence imputed)', () => {
    console.log('"0 prior awards" vs {rate:0.0004} ok =',
      assertNumeralsGrounded('There were 0 prior awards.', { rate: 0.0004 }).ok)
    console.log('"0 units" vs {rate:0.4} ok =',
      assertNumeralsGrounded('There were 0 units.', { rate: 0.4 }).ok)
    console.log('"1 unit" vs {factor:1.4} ok =',
      assertNumeralsGrounded('We ship 1 unit.', { factor: 1.4 }).ok)
    console.log('"2 units" vs {factor:1.5} ok =',
      assertNumeralsGrounded('We ship 2 units.', { factor: 1.5 }).ok)
  })
  it('boolean/string-only payload behaviour', () => {
    console.log('"1 unit" vs {flag:true} ok =', assertNumeralsGrounded('We ship 1 unit.', { flag: true }).ok)
  })
  it('numbers-as-identifiers cross pool', () => {
    const g = collectGrounding({ unitPrice: 1537.85, year: 2017 })
    console.log('identifiers:', JSON.stringify([...g.identifiers]))
  })
  it('code candidate swallowing a fabricated number', () => {
    const r = assertNumeralsGrounded('Priced at $2,500-per-unit today.', FIREWALL_FIXTURE_PAYLOAD)
    console.log('hyphen-word case ok =', r.ok, JSON.stringify(r.findings.map(f => [f.raw, f.category])))
  })
  it('a numeral inside a longer NSN-like run', () => {
    const r = assertNumeralsGrounded('Quantity 16500105982211 units.', FIREWALL_FIXTURE_PAYLOAD)
    console.log('14-digit ok =', r.ok, JSON.stringify(r.findings.map(f => [f.raw, f.category])))
  })
  it('NFKC fraction / superscript corruption', () => {
    const r = assertNumeralsGrounded('It is ½ of the lot.', FIREWALL_FIXTURE_PAYLOAD)
    console.log('half ok =', r.ok, 'text=', JSON.stringify(r.text), JSON.stringify(r.findings.map(f => [f.raw, f.category])))
  })
})
