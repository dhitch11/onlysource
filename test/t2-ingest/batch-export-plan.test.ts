/**
 * THE ACQUISITION MUST NOT BE ABLE TO RETURN 0.5% OF ITS REQUEST AND LOOK COMPLETE.
 *
 * The Batch Export accepts a very large pasted NSN list and returns at most a fixed number of
 * RECORDS. Paste 250,000 stock numbers into a 20,000-record cap and you receive roughly 1,176
 * NSNs at the measured density — a plausible workbook, no error, 0.5% of what was asked.
 *
 * That is fatal here specifically because the pull exists to VERIFY a pricing claim. A silently
 * truncated acquisition does not lose data, it manufactures a confident statistic over a
 * convenience sample, which this estate has already paid for once: a `limit` with no `order by`
 * reported 27.8% where the truth was 11.0%.
 */

import { describe, expect, it } from 'vitest'

import {
  ASSUMED_ROWS_PER_UNKNOWN_NSN,
  RECORDS_PER_REPORT,
  assertNoTruncation,
  planBatches,
  type BatchPlanInput,
} from '../../lib/ingest/batch-export/plan'

const held = (nsn: string, rows: number): BatchPlanInput => ({
  nsn,
  tier: 'held_history',
  knownRows: rows,
})
const unknown = (nsn: string): BatchPlanInput => ({ nsn, tier: 'amc5_corner', knownRows: null })

/* ---------------------------------------------------------------------------------- */
/* ★ THE ASSERTION — WHY IT CANNOT BE A RECORD COUNT                                   */
/* ---------------------------------------------------------------------------------- */

describe('assertNoTruncation', () => {
  it('★ catches the 250,000-in / 20,000-out truncation the plan was nearly run under', () => {
    // The real shape: a huge request, a capped answer, and a file that looks complete.
    const requested = Array.from({ length: 250_000 }, (_, i) => `NSN${i}`)
    const seen = requested.slice(0, 1_176) // ~20,000 records at 17 rows per NSN

    const v = assertNoTruncation({
      nsnsRequested: requested,
      nsnsSeenInResult: seen,
      recordsReturned: RECORDS_PER_REPORT,
    })

    expect(v.truncated).toBe(true)
    if (!v.truncated) throw new Error('unreachable')
    expect(v.missingNsns).toHaveLength(250_000 - 1_176)
    expect(v.reason).toContain('list cut short')
    expect(v.reason).toContain('do NOT treat this file as complete')
  })

  it('★ POSITIVE CONTROL: a record count alone CANNOT distinguish these two cases', () => {
    // Both return exactly the cap. Only the stock numbers tell them apart, which is why the
    // assertion compares NSNs and not counts.
    const requested = ['A', 'B', 'C']
    const truncatedCase = assertNoTruncation({
      nsnsRequested: requested,
      nsnsSeenInResult: ['A'],
      recordsReturned: RECORDS_PER_REPORT,
    })
    const completeCase = assertNoTruncation({
      nsnsRequested: requested,
      nsnsSeenInResult: ['A', 'B', 'C'],
      recordsReturned: RECORDS_PER_REPORT,
    })

    expect(truncatedCase.recordsReturned).toBe(completeCase.recordsReturned) // identical signal
    expect(truncatedCase.truncated).toBe(true)
    expect(completeCase.truncated).toBe(false) // and opposite verdicts
  })

  it('does NOT cry wolf when a stock number simply has no award history', () => {
    // The origin answered; the answer was "nothing". An honest empty state is not a truncation,
    // and an alarm that fires on every batch containing a never-bought NSN stops being read.
    const v = assertNoTruncation({
      nsnsRequested: ['A', 'B', 'C'],
      nsnsSeenInResult: ['A', 'C'],
      recordsReturned: 4_000, // well under the cap: the list was not cut short
    })
    expect(v.truncated).toBe(false)
    expect(v.nsnsSeen).toBe(2)
  })

  it('flags a result carrying stock numbers we did not ask for', () => {
    // The input that ran is not the input we designed, so the sample is not our sample.
    const v = assertNoTruncation({
      nsnsRequested: ['A', 'B'],
      nsnsSeenInResult: ['A', 'B', 'Z'],
      recordsReturned: 500,
    })
    expect(v.truncated).toBe(true)
    if (!v.truncated) throw new Error('unreachable')
    expect(v.reason).toContain('NOT requested')
  })
})

/* ---------------------------------------------------------------------------------- */
/* PACKING — EXACT WHERE WE KNOW, CONSERVATIVE WHERE WE DO NOT                         */
/* ---------------------------------------------------------------------------------- */

describe('planBatches', () => {
  it('★ packs held-history NSNs EXACTLY, because their row counts are known', () => {
    const plan = planBatches([held('A', 8_000), held('B', 8_000), held('C', 8_000)], {
      recordsPerReport: 20_000,
    })
    // 8k + 8k fits; the third would make 24,000 and starts a new report.
    expect(plan.batches).toHaveLength(2)
    expect(plan.batches[0]!.nsns).toEqual(['A', 'B'])
    expect(plan.batches[0]!.predictedRows).toBe(16_000)
    expect(plan.batches[0]!.predictionIsExact).toBe(true)
    expect(plan.batches.every((b) => b.predictedRows <= 20_000)).toBe(true)
  })

  it('★ isolates a single stock number that exceeds a whole report', () => {
    // The measured maximum is 1,917 rows and nothing prevents a larger one. Packed alongside
    // others it would truncate everything after it.
    const plan = planBatches([held('BIG', 25_000), held('SMALL', 10)], { recordsPerReport: 20_000 })
    expect(plan.batches[0]!.nsns).toEqual(['BIG'])
    expect(plan.batches[1]!.nsns).toEqual(['SMALL'])
  })

  it('reserves at p90 for unknown NSNs, not at the mean', () => {
    // Mean is 17.0 and median is 5, so the distribution is long-tailed. Reserving at p90 (26)
    // over-fills a little and CANNOT silently truncate. Wasting allowance is recoverable.
    expect(ASSUMED_ROWS_PER_UNKNOWN_NSN).toBeGreaterThan(17)
    const plan = planBatches([unknown('X'), unknown('Y')], { recordsPerReport: 20_000 })
    expect(plan.batches[0]!.predictedRows).toBe(2 * ASSUMED_ROWS_PER_UNKNOWN_NSN)
    expect(plan.batches[0]!.predictionIsExact).toBe(false)
  })

  it('never mixes tiers in one report, and preserves order within a tier', () => {
    // Tier order is a research decision (the tier we can CHECK goes first). A planner that
    // reordered for packing efficiency would silently change the sample.
    const plan = planBatches([held('A', 10), unknown('X'), held('B', 10)], {
      recordsPerReport: 20_000,
    })
    expect(plan.batches.map((b) => b.tier)).toEqual(['held_history', 'amc5_corner', 'held_history'])
    expect(plan.tierCounts.held_history).toBe(2)
    expect(plan.tierCounts.amc5_corner).toBe(1)
  })

  it('reports the weeks of allowance a plan consumes', () => {
    const inputs = Array.from({ length: 60 }, (_, i) => held(`N${i}`, 20_000))
    const plan = planBatches(inputs, { recordsPerReport: 20_000, reportsPerWeek: 25 })
    expect(plan.batches).toHaveLength(60)
    expect(plan.weeksAtFullAllowance).toBe(3) // 60 reports / 25 per week, rounded up
  })
})
