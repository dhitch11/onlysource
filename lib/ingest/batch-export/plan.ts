/**
 * T2 ACQUISITION. PLANNING A BATCH EXPORT SO IT CANNOT SILENTLY RETURN 0.5% OF WHAT IT ASKED.
 *
 * ★ THE DEFECT THIS EXISTS TO PREVENT, CAUGHT BEFORE THE FIRST REPORT RAN. The NSN-Now Batch
 * Export accepts a very large pasted NSN list per report and returns at most a fixed number of
 * RECORDS. Those two limits are not compatible, and the mismatch fails in the worst possible
 * direction: paste 250,000 stock numbers, receive the first ~20,000 records — roughly 1,176
 * NSNs at the measured density of 17 award rows each — as a plausible, complete-looking
 * workbook with no error anywhere. **0.5% of the request, indistinguishable from all of it.**
 *
 *     A SUCCESS CARRYING AN UNREAD TRUNCATION IS NOT A SUCCESS.
 *
 * This matters more here than almost anywhere else in the product, because the whole purpose of
 * the acquisition is VERIFICATION. A silently truncated pull does not merely lose data; it
 * produces a confident statistic over a convenience sample, which is the exact failure this
 * estate has already paid for once — a `limit` with no `order by` reported 27.8% where the truth
 * was 11.0%.
 *
 * ---------------------------------------------------------------------------------------
 * ★★ TIER 1 CAN BE PACKED EXACTLY, AND THAT IS WHY IT GOES FIRST.
 * ---------------------------------------------------------------------------------------
 * For NSNs we already hold awards for, we KNOW how many rows each one returns, so a batch can
 * be filled to just under the cap by arithmetic rather than by hope. For NSNs we have never
 * seen, the row count is unknowable in advance and the plan must estimate — which is precisely
 * why the assertion below is not optional for those tiers.
 *
 * The density is measured, not assumed: mean 17.0 rows per NSN, median 5, p90 26, MAX 1,917.
 * That spread is the reason a plan built on the mean is unsafe. A single 1,917-row stock number
 * consumes a tenth of a report on its own, so batches are packed by SUMMED KNOWN ROWS where the
 * counts exist, and by a conservative per-NSN estimate where they do not.
 */

/** What one report will return at most. The binding constraint on every plan here. */
export const RECORDS_PER_REPORT = 20_000

/** Reports the account may generate per rolling 7 days. Confirmed by the quota line. */
export const REPORTS_PER_WEEK = 25

/**
 * Rows to assume for an NSN whose history we have never seen.
 *
 * NOT THE MEAN. The mean is 17.0 and the median is 5, so the distribution is long-tailed and a
 * mean-based plan under-fills for most stock numbers while a single outlier blows the cap. p90
 * (26) is used deliberately: it over-reserves for the common case, which wastes a little of the
 * allowance and CANNOT silently truncate. Wasting capacity is recoverable. Truncating is not.
 */
export const ASSUMED_ROWS_PER_UNKNOWN_NSN = 26

export type BatchTier = 'held_history' | 'amc5_corner' | 'board_served'

export type BatchPlanInput = {
  nsn: string
  tier: BatchTier
  /** Rows this NSN is known to return, when we already hold its history. Null when unknown. */
  knownRows: number | null
}

export type PlannedBatch = {
  index: number
  tier: BatchTier
  nsns: string[]
  /** Rows this batch is predicted to return. Exact where knownRows was present. */
  predictedRows: number
  /** True when every NSN in the batch had a known row count, so the prediction is arithmetic. */
  predictionIsExact: boolean
}

export type BatchPlan = {
  batches: PlannedBatch[]
  /** Per tier: how many stock numbers were planned. Published with the result, never inferred. */
  tierCounts: Record<BatchTier, number>
  totalNsns: number
  predictedRows: number
  /** Whole weeks of allowance this plan consumes at REPORTS_PER_WEEK. */
  weeksAtFullAllowance: number
}

/**
 * Pack stock numbers into reports that stay under the record cap.
 *
 * Order is preserved WITHIN a tier and tiers are emitted in the order given, because the tier
 * order is a deliberate research decision (the tier we can CHECK goes first) and a planner that
 * reordered for packing efficiency would silently change the sample.
 */
export function planBatches(
  inputs: readonly BatchPlanInput[],
  opts: { recordsPerReport?: number; reportsPerWeek?: number } = {},
): BatchPlan {
  const cap = opts.recordsPerReport ?? RECORDS_PER_REPORT
  const perWeek = opts.reportsPerWeek ?? REPORTS_PER_WEEK
  if (cap < 1) throw new Error(`planBatches: recordsPerReport must be positive, got ${cap}`)

  const batches: PlannedBatch[] = []
  const tierCounts: Record<BatchTier, number> = {
    held_history: 0,
    amc5_corner: 0,
    board_served: 0,
  }

  let current: PlannedBatch | null = null
  for (const input of inputs) {
    tierCounts[input.tier] += 1
    const rows = input.knownRows ?? ASSUMED_ROWS_PER_UNKNOWN_NSN

    /*
     * A SINGLE STOCK NUMBER CAN EXCEED A WHOLE REPORT. The measured maximum is 1,917 rows, and
     * nothing stops a future one being larger than the cap itself. Such an NSN gets its own
     * batch and is flagged by the prediction rather than being packed alongside others and
     * quietly truncating everything after it.
     */
    const startsNewBatch =
      current === null || current.tier !== input.tier || current.predictedRows + rows > cap

    if (startsNewBatch) {
      current = {
        index: batches.length + 1,
        tier: input.tier,
        nsns: [],
        predictedRows: 0,
        predictionIsExact: true,
      }
      batches.push(current)
    }
    current!.nsns.push(input.nsn)
    current!.predictedRows += rows
    if (input.knownRows === null) current!.predictionIsExact = false
  }

  const predictedRows = batches.reduce((s, b) => s + b.predictedRows, 0)
  return {
    batches,
    tierCounts,
    totalNsns: inputs.length,
    predictedRows,
    weeksAtFullAllowance: Math.ceil(batches.length / perWeek),
  }
}

export type TruncationVerdict =
  | { truncated: false; recordsReturned: number; nsnsRequested: number; nsnsSeen: number }
  | {
      truncated: true
      recordsReturned: number
      nsnsRequested: number
      nsnsSeen: number
      missingNsns: string[]
      reason: string
    }

/**
 * THE ASSERTION. Did the report answer the question we asked?
 *
 * ★ IT COMPARES STOCK NUMBERS, NOT RECORD COUNTS, AND THAT IS THE WHOLE POINT. A record count
 * cannot detect this failure: 20,000 records is exactly what a truncated report and a complete
 * one both return when the cap binds. The only thing that distinguishes them is whether every
 * NSN we ASKED about appears in the answer.
 *
 * An NSN that legitimately has no award history is NOT a truncation — the origin answered, and
 * the answer was "nothing". That is an honest empty state and it must not raise the alarm, or
 * the alarm fires on every batch containing a stock number nobody has ever bought and stops
 * being read. So absence alone is not the test: absence PLUS the record count sitting at the
 * cap is, because that is the signature of a list cut short rather than a question answered.
 */
export function assertNoTruncation(input: {
  nsnsRequested: readonly string[]
  nsnsSeenInResult: readonly string[]
  recordsReturned: number
  recordsPerReport?: number
}): TruncationVerdict {
  const cap = input.recordsPerReport ?? RECORDS_PER_REPORT
  const seen = new Set(input.nsnsSeenInResult)
  const missing = input.nsnsRequested.filter((n) => !seen.has(n))
  const base = {
    recordsReturned: input.recordsReturned,
    nsnsRequested: input.nsnsRequested.length,
    nsnsSeen: seen.size,
  }

  if (input.recordsReturned >= cap && missing.length > 0) {
    return {
      ...base,
      truncated: true,
      missingNsns: missing,
      reason:
        `the report returned ${input.recordsReturned.toLocaleString('en-US')} records, at or above the ` +
        `${cap.toLocaleString('en-US')} record cap, and ${missing.length.toLocaleString('en-US')} of the ` +
        `${input.nsnsRequested.length.toLocaleString('en-US')} stock numbers requested do not appear in it. ` +
        `That is a list cut short, not a question answered. Re-run the missing stock numbers as their own ` +
        `report; do NOT treat this file as complete.`,
    }
  }

  /*
   * A result claiming stock numbers we did not ask about is a different failure with the same
   * cost: it means the input we believe we sent is not the input that ran, so the sample is not
   * the sample we designed. Reported through the same channel because both invalidate the pull.
   */
  const requested = new Set(input.nsnsRequested)
  const unexpected = input.nsnsSeenInResult.filter((n) => !requested.has(n))
  if (unexpected.length > 0) {
    return {
      ...base,
      truncated: true,
      missingNsns: missing,
      reason:
        `the report contains ${unexpected.length.toLocaleString('en-US')} stock number(s) that were NOT ` +
        `requested (for example ${unexpected.slice(0, 3).join(', ')}). The input that ran is not the input ` +
        `we designed, so the sample is not the sample we intended and the statistics over it would not ` +
        `mean what they claim.`,
    }
  }

  return { ...base, truncated: false }
}
