import { describe, expect, it } from 'vitest'
import { hasCorpus, CORPUS_NOTE } from '../support/corpus'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDibbsIndex } from '@/lib/ingest/parse/dibbs'
import { archivePath } from '@/lib/data-root'

/**
 * HANDED OVER FROM @T7 TO @T2, WHO OWN IT FROM HERE.
 *
 * This is the verified reproduction of the cold-start truncation gap, moved out of a scratchpad
 * and into the lane that owns the parse, on the conductor's ruling. Rewrite it freely: it is
 * yours, and a test living in someone else's head is not a test.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IT FOUND. Run against the real archived 2026-08-11 index, four inputs:
 *
 *   real 3,095-row day     -> 3,095 rows, every assertion passes.          DEFENDED
 *   consent banner         -> 0 rows, not_banner=false, row_width=false.   DEFENDED
 *   truncated MID-ROW      -> 0 rows, row_width=false (ragged line).       DEFENDED
 *   truncated ON A ROW BOUNDARY, no history  -> 200 rows, PARSED CLEAN.    THE GAP
 *
 * The count band reported, verbatim:
 *   "did not run: only 0 prior load(s) recorded, a band needs at least 2"
 *   probeLanded: false, gateFired: false, severity: warn
 *
 * So the truncation gate cannot run until two prior loads exist, and the first loads are the
 * 08-11 re-fetch of the perishable window. The one ingest with no second chance is the one
 * running with the gate inert. A 94% loss reads as a clean parse, and unlike the mid-row case
 * there is no ragged line to catch it.
 *
 * THE GAP WAS ONLY VISIBLE BECAUSE THIS PARSER IS HONEST: it reports probeLanded and gateFired
 * as two booleans and says "did not run" in words instead of returning a pass. A parser that
 * reported passed=true there would have hidden it until the window closed.
 *
 * CONDUCTOR RULING, binding before the re-fetch runs: an absolute history-independent floor,
 * `error` severity on the re-fetch path, and Content-Length cross-checked against bytes
 * received, which is the only one of the three that catches boundary truncation directly rather
 * than through its statistical shadow.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

const REAL_INDEX = archivePath('dibbs-rfq-daily', '2026-08-11', '20260812T225616Z', 'in260811.txt')
const BANNER = join(process.cwd(), 'test/fixtures/dibbs/consent-banner-in.html')

// A cold start: no prior loads, which is the state the re-fetch runs in.
const coldStart = () => ({ sourceKey: 'dibbs.index', logicalDate: '2026-08-11', history: [] })

function failing(assertions: Array<{ id: string; passed?: boolean }>): string[] {
  return assertions.filter((a) => a.passed === false).map((a) => a.id)
}

describe.skipIf(!hasCorpus)('cold-start truncation: the gap, and the three cases that already hold' + CORPUS_NOTE, () => {
  it('POSITIVE CONTROL: the real 3,095-row day parses clean', () => {
    const r = parseDibbsIndex(readFileSync(REAL_INDEX, 'latin1'), coldStart() as never)
    expect(r.rows.length).toBe(3095)
  })

  it('DEFENDED: a consent banner yields no rows', () => {
    const r = parseDibbsIndex(readFileSync(BANNER, 'latin1'), coldStart() as never)
    expect(r.rows.length).toBe(0)
    expect(failing(r.assertions as never)).toContain('dibbs.index.not_banner')
  })

  it('DEFENDED: a mid-row truncation yields no rows', () => {
    const raw = readFileSync(REAL_INDEX, 'latin1')
    const r = parseDibbsIndex(raw.slice(0, Math.floor(raw.length / 2) - 37), coldStart() as never)
    expect(r.rows.length).toBe(0)
    expect(failing(r.assertions as never)).toContain('dibbs.index.row_width')
  })

  it('THE GAP: a row-boundary truncation to 200 rows must be REFUSED on a cold start', () => {
    const lines = readFileSync(REAL_INDEX, 'latin1').split('\n')
    const truncated = lines.slice(0, 200).join('\n')
    const r = parseDibbsIndex(truncated, coldStart() as never)

    // ─────────────────────────────────────────────────────────────────────────────────
    // READ THIS BEFORE CHANGING THE ASSERTION. The first version of this test PASSED while
    // the defect was live, and I nearly handed it over that way.
    //
    // It asserted `rows === 0 || someAssertion.passed === false`, and the band assertion DOES
    // report passed:false here. But it reports it with `probeLanded:false, gateFired:false`
    // and the text "did not run: only 0 prior load(s) recorded". A gate that never ran is not
    // a gate that refused. Counting "did not run" as a refusal is how a test goes green over a
    // live data-loss defect.
    //
    // So the bar is a gate that ACTUALLY FIRED, or no rows at all. Nothing else is protection.
    // ─────────────────────────────────────────────────────────────────────────────────
    // AND ONE MORE TIME, BECAUSE THE SECOND VERSION WAS ALSO WRONG. Filtering on
    // `gateFired === true` alone still passed with the floor deleted, because `gateFired` is
    // true on gates that ran and PASSED (not_banner, row_width and niin_canary all fire and
    // pass on a truncated file, since 200 rows of real data are genuinely well-formed).
    //
    // The bar is a gate that ran, FAILED, and does so at a severity that stops a load.
    const blocking = (
      r.assertions as Array<{
        id: string
        severity?: string
        gateFired?: boolean
        passed?: boolean
      }>
    ).filter((a) => a.gateFired === true && a.passed === false && a.severity === 'reject')
    const refused = r.rows.length === 0 || blocking.length > 0
    expect(
      refused,
      `200 of 3,095 rows (a 94 percent loss) parsed with no gate firing. ` +
        `Assertions seen: ${JSON.stringify(r.assertions)}`,
    ).toBe(true)
  })
})
