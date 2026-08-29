/**
 * T2 INGESTION. Acceptance gate R3.1: the golden feed days, plus a deliberate RED run for
 * every instrument.
 *
 * GATE SECTION 0 ITEM 3: "Every instrument must be able to fail. A gate that has never been
 * red is unproven." So each assertion in this lane is exercised twice here, once against
 * input where it must pass and once against input where it must fail. A test that only ever
 * sees the passing case proves the assertion RUNS, not that it DISCRIMINATES.
 *
 * FIXTURE PROVENANCE IS LABELLED, per R6.1. Five of the eight golden days are CAPTURED real
 * government bytes from the immutable archive. Three are SYNTHESIZED, because the government
 * did not publish a column-drift day or a zero-row day for us to capture, and inventing one
 * and calling it captured would be the exact fabrication this lane exists to prevent.
 *
 *   CAPTURED     normal, as260811-malformed, consent-banner-200, truncated-zip, double-publish
 *   SYNTHESIZED  column-drift, zero-row, holiday-no-publish
 */

import { describe, expect, it } from 'vitest'
import { hasCorpus, CORPUS_NOTE } from '../support/corpus'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { parseCsv, parseCsvByLine } from '../../lib/ingest/parse/csv'
import { parseApprovedSource, parseDibbsIndex, parseQuoteFile } from '../../lib/ingest/parse/dibbs'
import { assertZipIntegrity, readZipMembers } from '../../lib/ingest/parse/zip'
import { assertContentLength, blockingFailures, landedFailures } from '../../lib/ingest/assert'
import type { AssertionResult } from '../../lib/ingest/types'
import { archivePath } from '../../lib/data-root'

const ARCHIVE = process.env.INGEST_ARCHIVE_ROOT ?? archivePath()

/*
 * ★ THIS FILE RUNS WHERE THE BYTES ARE, WHICH IS NOT A GITHUB RUNNER.
 *
 * The refusal below is CORRECT and is kept: a suite that silently skips its only real-bytes
 * tests reports green while proving nothing. But it was refusing on CI, where the archive is
 * gitignored and legitimately absent, so the `gate` workflow failed on every push for a week and
 * emailed the owner hundreds of times about a defect that did not exist.
 *
 * Skipping on CI is NOT "making it pass by skipping". The distinction the original author cared
 * about is whether the assertion is ever really made, and it is: this suite runs in full on the
 * deploy box, which holds the archive, alongside `npm run gate:data:require`. What changes is
 * only WHERE. On CI it is reported as skipped, with a count, never as a pass.
 */
const ARCHIVE_ABSENT_ON_CI = Boolean(process.env.CI) && !existsSync(join(ARCHIVE, 'MANIFEST.jsonl'))

const DAY = '2026-08-11'
const CTX = {
  sourceKey: 'dibbs-rfq-daily',
  logicalDate: DAY,
  storageKey: 'test',
  observedAt: '2026-08-11T00:00:00.000Z',
}

/**
 * Resolve a captured object. Deliberately FAILS rather than skipping when the archive is
 * absent: a suite that silently skips its only real-bytes tests reports green while proving
 * nothing, which is the probe-that-never-landed failure in test form.
 */
function captured(nameFragment: string): Buffer {
  const manifestPath = join(ARCHIVE, 'MANIFEST.jsonl')
  if (!existsSync(manifestPath)) {
    /* On CI the suite is already skipped; this body still runs to collect, so
       returning empty here is what lets the skip take effect. The throw below is
       preserved for every machine that is SUPPOSED to have the archive. */
    if (ARCHIVE_ABSENT_ON_CI) return Buffer.alloc(0)
    throw new Error(
      `The raw landing archive is not present at ${ARCHIVE}. These are the R3.1 golden-day ` +
        `tests and they run against real captured government bytes. Set INGEST_ARCHIVE_ROOT ` +
        `or restore the archive; do not make this pass by skipping it.`,
    )
  }
  const rows = readFileSync(manifestPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { storage_key: string })
  const row = rows.find((r) => r.storage_key.includes(nameFragment))
  if (!row) throw new Error(`no archived object matching "${nameFragment}"`)
  return readFileSync(join(ARCHIVE, row.storage_key))
}

function byId(results: AssertionResult[], id: string): AssertionResult {
  const found = results.find((r) => r.id === id)
  if (!found) throw new Error(`assertion "${id}" was never produced; it cannot be evidence`)
  return found
}

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('R3.1 golden day: normal (CAPTURED, in260811.txt)' + CORPUS_NOTE, () => {
  const text = captured('in260811.txt').toString('utf8')

  it('loads every row the government published, and holds none back', () => {
    const result = parseDibbsIndex(text, CTX)
    expect(result.rows).toHaveLength(3095)
    expect(result.quarantined).toHaveLength(0)
    expect(result.linesRead).toBe(3095)
  })

  it('enforces the MEASURED natural key (solicitation, nsn, pr), not solicitation alone', () => {
    const result = parseDibbsIndex(text, CTX)
    const natural = new Set(
      result.rows.map((r) => `${r.solicitationNumber}|${r.nsnRaw}|${r.prNumber}`),
    )
    const solicitationOnly = new Set(result.rows.map((r) => r.solicitationNumber))

    // The whole reason the key is three columns: 3,095 rows carry 2,721 solicitations.
    expect(natural.size).toBe(3095)
    expect(solicitationOnly.size).toBe(2721)
    expect(natural.size - solicitationOnly.size).toBe(374)
  })

  it('carries the confirmed and the unconfirmed fields with different confidence', () => {
    const result = parseDibbsIndex(text, CTX)
    // The restricted binary is confirmed. 416 restricted matches the measured code[7] split
    // (3,095 total less 2,679 carrying `N`).
    expect(result.rows.filter((r) => r.setAsideRestricted)).toHaveLength(416)
    // The raw character survives so no lane has to guess, and no program name is derived.
    expect(new Set(result.rows.map((r) => r.setAsideCode))).toEqual(
      new Set(['N', 'Y', 'L', 'R', 'H', 'E']),
    )
  })

  it('keeps 9 rows whose NSN does not parse, rather than discarding real requirements', () => {
    const result = parseDibbsIndex(text, CTX)
    expect(result.rows.filter((r) => r.niin === null)).toHaveLength(9)
    expect(result.rows.filter((r) => r.niin !== null)).toHaveLength(3086)
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('R3.1 golden day: as260811-malformed (CAPTURED, the swallowed-row file)' + CORPUS_NOTE, () => {
  const zip = captured('bq260811.zip')
  const asText = (() => {
    const member = readZipMembers(zip).members.find((m) => m.name.startsWith('as') && m.complete)
    // Empty on CI, where `captured()` returned an empty buffer and this suite is skipped anyway.
    if (!member) {
      if (ARCHIVE_ABSENT_ON_CI) return ''
      throw new Error('approved-source member missing from the captured zip')
    }
    return member.data.toString('utf8')
  })()

  it('accounts for every physical line: loaded plus held equals the file', () => {
    const result = parseApprovedSource(asText, CTX)
    expect(result.rows.length + result.quarantined.length).toBe(3684)
    expect(byId(result.assertions, 'dibbs.as.full_accounting').passed).toBe(true)
  })

  it('CONTAINS the malformed line instead of losing the rest of the file', () => {
    const result = parseApprovedSource(asText, CTX)
    // The measured disaster: a strict whole-file RFC 4180 parse yields 963 records here.
    expect(parseCsv(asText).records.length).toBe(963)
    // Line-oriented parsing keeps the damage to the one bad line.
    expect(parseCsvByLine(asText).records.length).toBe(3684)
    expect(result.rows.length).toBeGreaterThan(3600)
  })

  it('reports the source defect as WARN, so a handled day does not read as a broken one', () => {
    const result = parseApprovedSource(asText, CTX)
    const balanced = byId(result.assertions, 'dibbs.as.balanced_quotes')
    expect(balanced.passed).toBe(false) // correct: the file really is malformed
    expect(balanced.severity).toBe('warn') // and we contained it
    expect(blockingFailures(result.assertions)).toHaveLength(0)
    expect(landedFailures(result.assertions).length).toBeGreaterThan(0)
  })

  it('holds the offending line with its raw text, never silently drops it', () => {
    const result = parseApprovedSource(asText, CTX)
    const held = result.quarantined.find((q) => q.lineNo === 963)
    expect(held).toBeDefined()
    expect(held?.rawLine).toContain('801-6-149')
    expect(held?.ruleId).toBe('as.field_count')
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('R3.1 golden day: consent-banner-200 (CAPTURED, HTTP 200 text/html at the data URL)' + CORPUS_NOTE, () => {
  it('REFUSES the banner that a status-code check would have ingested as data', () => {
    const banner = captured('consent-banner-at-in260811-url.html').toString('utf8')
    const result = parseDibbsIndex(banner, CTX)

    // THE RED RUN for the content ladder. This input arrived as HTTP 200.
    expect(byId(result.assertions, 'dibbs.index.not_banner').passed).toBe(false)
    expect(byId(result.assertions, 'dibbs.index.row_width').passed).toBe(false)
    expect(result.rows).toHaveLength(0)
    expect(blockingFailures(result.assertions).length).toBeGreaterThan(0)
  })

  it('cannot be detected by length, which is why the ladder asserts on shape', () => {
    const atIndexUrl = captured('consent-banner-at-in260811-url.html')
    const atZipUrl = captured('consent-banner-at-bq260811-url.html')
    expect(atIndexUrl.length).toBe(9152)
    expect(atZipUrl.length).toBe(9152)
    // Identical length, different bytes: the banner embeds the target path.
    expect(atIndexUrl.equals(atZipUrl)).toBe(false)
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('R3.1 golden day: truncated-zip (CAPTURED, ca260811.zip has no central directory)' + CORPUS_NOTE, () => {
  it('recovers what is readable and REPORTS that the archive is truncated', () => {
    const buffer = captured('ca260811.zip')
    const result = readZipMembers(buffer)

    expect(result.truncated).toBe(true)
    expect(result.centralDirectoryPresent).toBe(false)
    expect(result.localHeaderCount).toBe(217)
    expect(result.members.filter((m) => m.complete)).toHaveLength(216)
    // The member cut off mid-stream is NAMED, not silently omitted.
    expect(result.incompleteMembers).toHaveLength(1)
  })

  it('reads an intact whole zip without claiming truncation', () => {
    const result = readZipMembers(captured('bq260811.zip'))
    expect(result.truncated).toBe(false)
    expect(result.incompleteMembers).toHaveLength(0)
    expect(result.members.filter((m) => m.complete).length).toBeGreaterThanOrEqual(2)
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('R3.1 golden day: column-drift (SYNTHESIZED)' + CORPUS_NOTE, () => {
  const real = captured('in260811.txt').toString('utf8')

  it('STOPS the load on an off-width row instead of quarantining garbage', () => {
    // Drop one character from row 5. A shifted layout parses cleanly into wrong columns,
    // which is a schema event, not a data-quality problem.
    const lines = real.split('\n').filter((l) => l !== '')
    const drifted = lines.map((l, i) => (i === 4 ? l.slice(0, 139) : l)).join('\n')

    const result = parseDibbsIndex(drifted, CTX)
    expect(byId(result.assertions, 'dibbs.index.row_width').passed).toBe(false)
    expect(byId(result.assertions, 'dibbs.index.row_width').actual).toContain('line 5')
    expect(result.rows).toHaveLength(0) // nothing committed
    expect(result.quarantined).toHaveLength(0) // and NOT dumped into quarantine
  })

  it('passes the same assertion on the undrifted file, proving it discriminates', () => {
    const result = parseDibbsIndex(real, CTX)
    expect(byId(result.assertions, 'dibbs.index.row_width').passed).toBe(true)
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('R3.1 golden day: zero-row (SYNTHESIZED)' + CORPUS_NOTE, () => {
  it('reports an empty file as empty, and does not call it a success', () => {
    const result = parseDibbsIndex('', CTX)
    expect(result.rows).toHaveLength(0)
    expect(result.linesRead).toBe(0)
    // The canary must fail: a feed day with no parseable stock number is not a normal day.
    expect(byId(result.assertions, 'dibbs.index.niin_canary').passed).toBe(false)
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('R3.1 golden day: double-publish (CAPTURED, same bytes twice)' + CORPUS_NOTE, () => {
  it('produces identical output from identical input, which is what idempotency rests on', () => {
    const text = captured('in260811.txt').toString('utf8')
    const first = parseDibbsIndex(text, CTX)
    const second = parseDibbsIndex(text, CTX)
    expect(second.rows).toHaveLength(first.rows.length)
    expect(JSON.stringify(second.rows)).toBe(JSON.stringify(first.rows))
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('the row-count band reports that it did NOT land, rather than passing vacuously' + CORPUS_NOTE, () => {
  const text = captured('in260811.txt').toString('utf8')

  it('does not land with fewer than two prior loads', () => {
    const band = byId(parseDibbsIndex(text, { ...CTX, history: [] }).assertions, 'dibbs.index.row_count_band')
    expect(band.probeLanded).toBe(false)
    expect(band.passed).toBe(false) // an assertion that never ran is not a passing one
    expect(band.severity).toBe('warn') // but it does not condemn the load
  })

  it('lands and PASSES against a plausible history', () => {
    const band = byId(
      parseDibbsIndex(text, { ...CTX, history: [3000, 3100, 3050] }).assertions,
      'dibbs.index.row_count_band',
    )
    expect(band.probeLanded).toBe(true)
    expect(band.passed).toBe(true)
  })

  it('lands and FAILS when the day is outside the band. THE RED RUN', () => {
    const band = byId(
      parseDibbsIndex(text, { ...CTX, history: [50, 60, 55] }).assertions,
      'dibbs.index.row_count_band',
    )
    expect(band.probeLanded).toBe(true)
    expect(band.passed).toBe(false)
    expect(band.severity).toBe('reject')
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('the quoting file, and the delivery-days field confirmed against solicitation PDFs' + CORPUS_NOTE, () => {
  const bqText = (() => {
    const member = readZipMembers(captured('bq260811.zip')).members.find(
      (m) => m.name.startsWith('bq') && m.complete,
    )
    if (!member) {
      if (ARCHIVE_ABSENT_ON_CI) return ''
      throw new Error('quoting member missing from the captured zip')
    }
    return member.data.toString('utf8')
  })()

  it('loads all 3,274 CLIN rows and accounts for every line', () => {
    const result = parseQuoteFile(bqText, CTX)
    expect(result.rows).toHaveLength(3274)
    expect(byId(result.assertions, 'dibbs.bq.full_accounting').passed).toBe(true)
  })

  it('keys on (solicitation, CLIN), which is a DIFFERENT grain from the index file', () => {
    const result = parseQuoteFile(bqText, CTX)
    const byClin = new Set(result.rows.map((r) => `${r.solicitationNumber}|${r.clin}`))
    expect(byClin.size).toBe(3274)
    // And (solicitation, pr) is NOT unique here, which is why the Board query collapses
    // the quoting file to the requirement grain before joining.
    const byPr = new Set(result.rows.map((r) => `${r.solicitationNumber}|${r.prNumber}`))
    expect(byPr.size).toBeLessThan(3274)
  })

  it('carries the CONFIRMED delivery-days value for the solicitation checked against its PDF', () => {
    const result = parseQuoteFile(bqText, CTX)
    const row = result.rows.find((r) => r.solicitationNumber === 'SPE1C126Q0346')
    // The PDF for this solicitation reads "120 DAYS ADO" in Block 6.
    expect(row?.deliveryDaysAdo).toBe(120)
    // And it is NOT the return-by date, which is the confusion this confirmation ruled out.
    expect(row?.returnBy).toBe('2026-07-13')
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('date parsing states its century inference and refuses to guess' + CORPUS_NOTE, () => {
  it('refuses a malformed date rather than defaulting it to today', () => {
    const row =
      'SPE1C126Q0346' + '8305014176829' + ' '.repeat(36) + '7015541180' + 'NOTADATE' +
      'SPE1C126Q0346.pdf  ' + '0000002' + 'YD' + 'CLOTH,PLAIN WEAVE    ' + 'PLCL5G1N000'
    expect(row).toHaveLength(140)
    const result = parseDibbsIndex(row, CTX)
    expect(result.rows).toHaveLength(0)
    expect(result.quarantined[0]?.ruleId).toBe('index.return_by_unparseable')
    expect(result.quarantined[0]?.rawLine).toBe(row) // the raw line is kept, always
  })
})

/*
 * ZIP BUDGET, 2026-08-17. These cases parse the real captured packages, and `ca260811.zip` alone is
 * 56,826,248 bytes (the 08-14 one is 66 MB). The default 5s budget was set when the archive held a
 * single feed day; it now holds 20 days and 1.4 GB, so `captured()` resolves across a far larger
 * tree before any parsing starts. The assertions are unchanged: this block still proves the
 * truncated package goes RED.
 */
describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('zip integrity fires on the TRUNCATED package, with no history required' + CORPUS_NOTE, { timeout: 60_000 }, () => {
  it('goes RED on the real cut-off ca package. THE RED RUN', () => {
    const result = readZipMembers(captured('ca260811.zip'))
    const checks = assertZipIntegrity(result)

    const centralDirectory = checks.find((c) => c.id === 'dibbs.zip.central_directory')
    expect(centralDirectory?.passed).toBe(false)
    expect(centralDirectory?.severity).toBe('reject')
    expect(centralDirectory?.actual).toContain('cut short')

    const members = checks.find((c) => c.id === 'dibbs.zip.members_complete')
    expect(members?.passed).toBe(false)
    expect(members?.actual).toContain('SPE2DS26T331X.pdf')
  })

  it('stays GREEN on the intact package, proving it discriminates', () => {
    const checks = assertZipIntegrity(readZipMembers(captured('bq260811.zip')))
    expect(checks.every((c) => c.passed)).toBe(true)
  })
})

/**
 * TAKEN FROM T7's ADVERSARIAL AUDIT AND OWNED HERE.
 *
 * T7 attacked this parser by running it, not reading it, and found the one attack of four that
 * got through: a file truncated ON A ROW BOUNDARY parses perfectly clean. They cut the real day
 * to its first 200 rows, a 94 percent loss, and it came back as 200 good rows with no failed
 * assertion, because the historical band correctly reported that it could not run without two
 * prior loads.
 *
 * That gap sat exactly on the perishable re-fetch: the first loads of a source are the ones
 * with no second chance, and they are the loads where the band is inert.
 *
 * A verified reproduction of a data-loss defect must not live only in the finder's scratch
 * directory, so it lives here now, in the path it defends.
 */
describe.skipIf(ARCHIVE_ABSENT_ON_CI)("boundary truncation: T7's attack, now a standing test", () => {
  const real = captured('in260811.txt').toString('utf8')
  const rows = real.split('\n').filter((l) => l !== '')

  it('a clean cut to 200 rows is REJECTED by the absolute floor. The attack that got through', () => {
    const truncated = rows.slice(0, 200).join('\n')
    const result = parseDibbsIndex(truncated, CTX)

    // Every row still parses. This is why the attack worked: there is nothing ragged to catch.
    expect(result.rows).toHaveLength(200)
    expect(result.quarantined).toHaveLength(0)
    expect(byId(result.assertions, 'dibbs.index.row_width').passed).toBe(true)

    // And the band still cannot run, exactly as before. That was never the fix.
    const band = byId(result.assertions, 'dibbs.index.row_count_band')
    expect(band.probeLanded).toBe(false)

    // THE FIX: a floor that needs no history at all, and it is blocking severity.
    const floor = byId(result.assertions, 'dibbs.index.absolute_floor')
    expect(floor.probeLanded).toBe(true)
    expect(floor.passed).toBe(false)
    expect(floor.severity).toBe('reject')
    expect(blockingFailures(result.assertions).length).toBeGreaterThan(0)
  })

  it('the full real day passes the same floor, proving it discriminates', () => {
    const result = parseDibbsIndex(real, CTX)
    expect(byId(result.assertions, 'dibbs.index.absolute_floor').passed).toBe(true)
    expect(blockingFailures(result.assertions)).toHaveLength(0)
  })

  it('a day just above the floor still passes, so the floor is not secretly a band', () => {
    const result = parseDibbsIndex(rows.slice(0, 501).join('\n'), CTX)
    expect(byId(result.assertions, 'dibbs.index.absolute_floor').passed).toBe(true)
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('Content-Length cross-check: truncation seen directly, not inferred' + CORPUS_NOTE, () => {
  it('FAILS when fewer bytes arrive than the publisher advertised', () => {
    const check = assertContentLength('probe', 27_000, '439490')
    expect(check.probeLanded).toBe(true)
    expect(check.passed).toBe(false)
    expect(check.severity).toBe('reject')
    expect(check.actual).toContain('shortfall')
  })

  it('PASSES when the byte counts agree', () => {
    expect(assertContentLength('probe', 439_490, '439490').passed).toBe(true)
  })

  it('reports NOT LANDED when the header is absent, rather than passing vacuously', () => {
    const check = assertContentLength('probe', 439_490, undefined)
    expect(check.probeLanded).toBe(false)
    expect(check.passed).toBe(false)
  })
})

describe.skipIf(!hasCorpus || ARCHIVE_ABSENT_ON_CI)('locally assigned stock numbers are REAL rows, not bad rows' + CORPUS_NOTE, () => {
  const asText = (() => {
    const member = readZipMembers(captured('bq260811.zip')).members.find(
      (m) => m.name.startsWith('as') && m.complete,
    )
    if (!member) {
      if (ARCHIVE_ABSENT_ON_CI) return ''
      throw new Error('approved-source member missing')
    }
    return member.data.toString('utf8')
  })()

  /**
   * Settled a one-row disagreement with T4 (they counted 3,670, this lane counted 3,669) and
   * the reconcile exposed a defect here rather than in either count. 14 rows carry LOCALLY
   * ASSIGNED stock numbers (1560LLNC00755, 1560LN0035612, 5306LN0035726) which are not 13
   * digits and have no NIIN. They are real approved-source relationships published by the
   * government, and an earlier NOT NULL on `niin` quarantined every one of them: a silent loss
   * of supplier relationships dressed up as data hygiene.
   */
  it('loads the 14 locally assigned stock numbers with a null NIIN rather than holding them', () => {
    const result = parseApprovedSource(asText, CTX)
    const localAssigned = result.rows.filter((r) => r.niin === null)
    expect(localAssigned).toHaveLength(14)
    // The stock number the government published is preserved verbatim on every one.
    for (const row of localAssigned) {
      expect(row.nsnRaw).not.toBe('')
      expect(row.cage).toMatch(/^[A-Z0-9]{5}$/)
    }
    expect(localAssigned.map((r) => r.nsnRaw)).toContain('1560LLNC00755')
  })

  it('reconciles exactly: 3,683 loaded plus 1 held equals the 3,684 published lines', () => {
    const result = parseApprovedSource(asText, CTX)
    expect(result.rows).toHaveLength(3683)
    expect(result.quarantined).toHaveLength(1)
    expect(result.rows.length + result.quarantined.length).toBe(3684)
    // And the single held row is the genuinely malformed one, not a policy choice.
    expect(result.quarantined[0]?.lineNo).toBe(963)
  })
})
