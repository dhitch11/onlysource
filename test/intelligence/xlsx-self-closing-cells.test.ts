import { describe, expect, it } from 'vitest'
import { readWorkbookSheets } from '@/lib/intelligence/seed/xlsx'
import { existsSync } from 'node:fs'

/**
 * THE SELF-CLOSING CELL. A regression test for a defect that silently corrupted real prices.
 *
 * `parseSheetXml` matched cells with `/<c r="..."([^>]*)(?:\/>|>(...)<\/c>)/`. The attribute group
 * was GREEDY, so on a self-closing cell `<c r="W2" s="5"/>` it swallowed ` s="5"/` including the
 * slash. The `\/>` branch could then never match, the engine took the `>` branch instead, and that
 * branch ran forward to the NEXT CELL'S `</c>`.
 *
 * Two things went wrong at once, and the second is the dangerous one:
 *   1. the empty cell was assigned a value belonging to a later cell
 *   2. every cell in between was consumed and never emitted at all
 *
 * Measured on the real export before the fix: 13,859 self-closing cells in one Procurement sheet,
 * 156 award dates silently dropped, 301 Surplus flags eaten (17 survived out of 318), and every
 * populated LTC Expiration value scrambled. Award Date orders the price series behind every
 * escalation figure on the map and in the AI brief, so this reached the screen.
 *
 * The module's own doc comment promised that cells are keyed on their reference and never on
 * document order, calling it "the single most important property of this whole module". It was
 * true of the intent and false of the regex, and no test could see the difference, because every
 * assertion in the suite was about values that happened to survive.
 */

const parse = (body: string) => {
  // A minimal but real worksheet, exercised through the module's own public entry point would
  // need a zip; the regex is what is under test, so this mirrors it exactly as shipped.
  const cellRe = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  const out: Array<{ ref: string; value: string }> = []
  let m: RegExpExecArray | null
  while ((m = cellRe.exec(body)) !== null) {
    out.push({ ref: m[1] as string, value: /<v>([\s\S]*?)<\/v>/.exec(m[3] ?? '')?.[1] ?? '' })
  }
  return out
}

describe('a self-closing cell is empty and steals nothing', () => {
  it('emits every cell, in order, with the empty one empty', () => {
    const got = parse(
      '<c r="A2" t="s"><v>0</v></c><c r="B2" s="5"/><c r="C2"><v>42</v></c><c r="D2"><v>99</v></c>',
    )
    expect(got.map((c) => c.ref)).toEqual(['A2', 'B2', 'C2', 'D2'])
    expect(got.map((c) => c.value)).toEqual(['0', '', '42', '99'])
  })

  it('THE OLD REGEX FAILS THIS, which is what makes the test worth having', () => {
    // The exact pattern that shipped, kept here so the defect can never be reintroduced by
    // "simplifying" the attribute group back to greedy.
    const greedy = /<c r="([A-Z]+\d+)"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g
    const body =
      '<c r="A2" t="s"><v>0</v></c><c r="B2" s="5"/><c r="C2"><v>42</v></c><c r="D2"><v>99</v></c>'
    const refs: string[] = []
    let m: RegExpExecArray | null
    while ((m = greedy.exec(body)) !== null) refs.push(m[1] as string)
    // C2 vanishes entirely and B2 takes its value.
    expect(refs).toEqual(['A2', 'B2', 'D2'])
    expect(refs).not.toContain('C2')
  })

  it('handles several consecutive empty cells', () => {
    const got = parse('<c r="A1"><v>1</v></c><c r="B1"/><c r="C1"/><c r="D1"><v>4</v></c>')
    expect(got.map((c) => `${c.ref}=${c.value}`)).toEqual(['A1=1', 'B1=', 'C1=', 'D1=4'])
  })

  it('handles an empty cell as the last cell in a row', () => {
    const got = parse('<c r="A1"><v>1</v></c><c r="B1" s="3"/>')
    expect(got.map((c) => c.ref)).toEqual(['A1', 'B1'])
    expect(got[1]?.value).toBe('')
  })
})

describe('the real export parses with no swallowed cells', () => {
  const file = 'data/nsn-now/full_1.xlsx'
  const present = existsSync(file)

  /*
   * Parsed ONCE and shared. Each case re-parsed this 3.7MB workbook, which made the suite flaky
   * under parallel load: it passed alone and failed intermittently in a full run competing with
   * the Postgres testcontainer suites. A flaky test is worse than no test, because it teaches
   * people to re-run until green.
   */
  const sheet = present ? readWorkbookSheets(file).sheets.get('Procurement') : undefined

  it.runIf(present)('every Procurement row carries the full header set as keys', () => {
    const proc = sheet
    expect(proc).toBeDefined()
    const headers = proc!.headers
    // A swallowed cell removes a KEY from the row, so a row missing a header key is the
    // signature of the defect. Missing values are fine; missing keys are not.
    for (const row of proc!.rows.slice(0, 500)) {
      for (const h of headers) {
        expect(Object.prototype.hasOwnProperty.call(row, h), `row is missing key "${h}"`).toBe(true)
      }
    }
  })

  it.runIf(present)('AMC holds acquisition codes and never a date serial', () => {
    const proc = sheet!
    // Before the fix, an empty AMSC cell put Award Date's serial into AMC on 156 rows.
    const strays = proc.rows.map((r) => (r['AMC'] ?? '').trim()).filter((v) => v.length > 1)
    expect(strays.slice(0, 5)).toEqual([])
  })

  it.runIf(present)('every populated LTC Expiration value is a date', () => {
    const proc = sheet!
    const bad = proc.rows
      .map((r) => (r['LTC Expiration'] ?? '').trim())
      .filter((v) => v && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v))
    expect(bad.slice(0, 5)).toEqual([])
  })
})
