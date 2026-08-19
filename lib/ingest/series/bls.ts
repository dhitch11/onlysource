/**
 * T2 INGESTION. DATED PRICE SERIES, STORED AS VINTAGED OBSERVATIONS.
 *
 * WHY THIS EXISTS. The price anchor inflates an OEM award using two factors that were stored
 * as naked constants pinned to base year 2017: a CPI factor of 1.3223 and a DoD procurement
 * factor of 1.40. `anchor.ts` recorded `publishedSeriesId: null` for both, with the comment
 * that the corpus "does not name the published series it came from, so the series id is an
 * honest null rather than a plausible guess at a BLS code". That refusal to guess was right,
 * and it is why this was worth solving properly.
 *
 * MEASURED 2026-08-19, and it settles the CPI leg: BLS series CUUR0000SA0 (CPI-U, US city
 * average, all items, not seasonally adjusted) reads 324.122 for 2025-M11 against a 2017
 * annual average of 245.120. 324.122 / 245.120 = 1.32229928, which is 1.3223 to four
 * decimals and is unique across every annual and monthly reading from 2017 to 2026. The
 * expert's factor was a real series reading all along. It can now be cited.
 *
 * AND IT IS ALREADY STALE. The latest published reading, 2026-M07, is 333.918, a ratio to
 * 2017 of 1.3623. Production has been applying a November 2025 number for nine months, so
 * every anchor is roughly 3% low, and it drifts further every month with no one touching it.
 * THAT is the defect a stored constant guarantees and a dated series removes.
 *
 * ---------------------------------------------------------------------------------------
 * THE FOUR PROPERTIES THIS STORE GUARANTEES, agreed with the pricing lane before either
 * side wrote code, so a resolver can be built against them.
 * ---------------------------------------------------------------------------------------
 * 1. THE IDENTIFIER IS THE PUBLISHER'S, NEVER OURS. `series_id` is what a citation prints.
 *    If a series cannot be obtained under a published id, it does not get ingested and the
 *    anchor keeps abstaining. Removing "never recommend" did not remove "never fabricate".
 *
 * 2. APPEND-ONLY, AND VINTAGED. The key is (series_id, period, vintage). A revision is a NEW
 *    row, never an overwrite, so a figure shown to a customer last week stays reproducible
 *    from the vintage that was current then. CPI-U's NSA series is not revised the way a
 *    deflator is, and this store does not rely on that: a belief about a publisher's
 *    revision policy is exactly the kind of thing that holds until it does not.
 *
 * 3. A PERIOD WE DID NOT OBSERVE IS ABSENT. No interpolation, no carry-forward, no nearest
 *    year, no derived rows of any kind. An unobserved period must never be answerable.
 *
 * 4. PROVENANCE GRADE TRAVELS WITH THE ROW. `retrieval_method` and `retrieved_at_basis` are
 *    recorded so a consumer can refuse a row it does not consider well-enough observed. The
 *    archive already had these fields and nothing read them, and on 2026-08-18 that cost us:
 *    a file matched its recorded byte count exactly and was 8% of the real file, and the only
 *    tell was that its row said `research_capture` rather than `pipeline_fetch`.
 *
 * ★ THE PARSER IS PURE AND SEPARATE FROM THE FETCH, so every response shape can be tested
 * without a network call, including the one that already bit me: BLS returns the STRING "-"
 * as the value for a period it has not published yet. A non-numeric placeholder in a numeric
 * field is a silent zero waiting to happen. It is ABSENT here, and it is never 0.
 */

export const BLS_API_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'

/** How a value was obtained. The vocabulary matches the archive's, deliberately. */
export type SeriesRetrievalMethod = 'api_fetch' | 'published_table' | 'operator_entry'

export type SeriesObservation = {
  /** The publisher's own identifier, verbatim. Never one we invent. */
  series_id: string
  /** The period the figure DESCRIBES: "2017-M13" (annual average) or "2025-M11". */
  period: string
  /** The four-digit year of `period`, denormalised for the common lookup. */
  year: number
  /** BLS period code: M01..M12 monthly, M13 annual average, Q01..Q05 quarterly, A01 annual. */
  period_code: string
  value: number
  /** The release this figure was READ FROM. Two rows may share a period and differ here. */
  vintage: string
  retrieved_at: string
  retrieval_method: SeriesRetrievalMethod
  /** What makes the timestamp meaningful. `http_response` for a live API read. */
  retrieved_at_basis: string
  source_url: string
  /** The publisher's own footnote text, kept verbatim when present. */
  footnotes: string | null
}

export type SeriesParseResult = {
  observations: SeriesObservation[]
  /** Periods the publisher returned WITHOUT a usable number. Recorded, never silently dropped. */
  unpublished: { series_id: string; period: string; raw: string }[]
  /** Series the request asked for that came back with no data at all. */
  emptySeries: string[]
  /**
   * The publisher's own `message` array on a SUCCESSFUL request.
   *
   * ★ MEASURED LIVE 2026-08-19, AND IT COST ME THE CURRENT YEAR. Asking CUUR0000SA0 for
   * 2016-2026 returns `status: REQUEST_SUCCEEDED` together with
   * `["Year range has been reduced to the system-allowed limit of 10 years."]`, having
   * dropped 2026 entirely. The first version of this parser checked `status` and threw away
   * `message` on success, so the ingest reported "129 observations, 129 appended" and was
   * missing the only year that makes the factor current. A SUCCESS CARRYING AN UNREAD
   * WARNING IS NOT A SUCCESS.
   */
  warnings: string[]
}

/** BLS caps a single request at ten years and narrows the range rather than refusing it. */
export const BLS_MAX_YEARS_PER_REQUEST = 10

/**
 * Split a year range into windows the publisher will answer whole, so the limit is never
 * reached in the first place. Preventing the truncation beats detecting it, and the detection
 * stays as the belt for the day the limit changes without telling us.
 */
export function yearWindows(
  startYear: number,
  endYear: number,
  maxYears: number = BLS_MAX_YEARS_PER_REQUEST,
): { startYear: number; endYear: number }[] {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear) {
    throw new Error(`yearWindows: bad range ${startYear}-${endYear}`)
  }
  if (!Number.isInteger(maxYears) || maxYears < 1) {
    throw new Error(`yearWindows: maxYears must be a positive integer, got ${maxYears}`)
  }
  const out: { startYear: number; endYear: number }[] = []
  for (let y = startYear; y <= endYear; y += maxYears) {
    out.push({ startYear: y, endYear: Math.min(y + maxYears - 1, endYear) })
  }
  return out
}

/**
 * Requested years that came back with NOTHING: no observation and no per-period "not yet
 * published" marker either.
 *
 * The distinction is the point. A year the publisher answered with "-" for a month is an
 * honest empty state and must not raise an alarm, or the alarm fires every month on a normal
 * publication lag and stops being read. A year that produced no row of any kind was dropped,
 * and that is the silent narrowing this function exists to make loud.
 */
export function missingYears(
  result: SeriesParseResult,
  input: { seriesId: string; startYear: number; endYear: number },
): number[] {
  const answered = new Set<number>()
  for (const o of result.observations) {
    if (o.series_id === input.seriesId) answered.add(o.year)
  }
  for (const u of result.unpublished) {
    if (u.series_id !== input.seriesId) continue
    const y = Number(u.period.slice(0, 4))
    if (Number.isInteger(y)) answered.add(y)
  }
  const missing: number[] = []
  for (let y = input.startYear; y <= input.endYear; y += 1) {
    if (!answered.has(y)) missing.push(y)
  }
  return missing
}

/** BLS wraps everything in this. Typed loosely on purpose: it is someone else's contract. */
type BlsPayload = {
  status?: string
  message?: unknown
  Results?: {
    series?: {
      seriesID?: string
      data?: {
        year?: string
        period?: string
        periodName?: string
        value?: string
        footnotes?: { text?: string }[]
      }[]
    }[]
  }
}

export class BlsRequestFailed extends Error {
  constructor(
    readonly status: string,
    readonly messages: string[],
  ) {
    super(`BLS refused the request: status=${status}${messages.length ? ` - ${messages.join('; ')}` : ''}`)
    this.name = 'BlsRequestFailed'
  }
}

/**
 * Parse one BLS API response into observations.
 *
 * THROWS on a refused request rather than returning an empty result. A request the publisher
 * refused and a series with no data are different facts, and collapsing them would let a
 * quota rejection read as "this series is empty", which is how an outage becomes a silent
 * gap in a price history.
 */
export function parseBlsResponse(
  payload: unknown,
  opts: { vintage: string; retrievedAt: string; sourceUrl?: string },
): SeriesParseResult {
  const p = payload as BlsPayload
  const status = p?.status ?? 'NO_STATUS_FIELD'
  if (status !== 'REQUEST_SUCCEEDED') {
    const msgs = Array.isArray(p?.message) ? (p.message as unknown[]).map(String) : []
    throw new BlsRequestFailed(status, msgs)
  }

  const observations: SeriesObservation[] = []
  const unpublished: SeriesParseResult['unpublished'] = []
  const emptySeries: string[] = []
  /* A successful request can still carry a warning, and the warning can mean the answer is
   * incomplete. Kept, never discarded. */
  const warnings: string[] = Array.isArray(p?.message)
    ? (p.message as unknown[]).map(String).filter((m) => m.trim() !== '')
    : []

  for (const series of p.Results?.series ?? []) {
    const seriesId = series.seriesID ?? ''
    if (!seriesId) continue
    const rows = series.data ?? []
    if (rows.length === 0) {
      emptySeries.push(seriesId)
      continue
    }

    for (const row of rows) {
      const year = Number(row.year)
      const periodCode = row.period ?? ''
      if (!Number.isInteger(year) || !periodCode) continue
      const period = `${year}-${periodCode}`

      /*
       * THE PLACEHOLDER. BLS sends "-" (and has been observed sending an empty string) for a
       * period it has not published. `Number('-')` is NaN and `Number('')` is 0, so a
       * tolerant parser turns an unpublished month into a price index of ZERO. Absent.
       */
      const raw = row.value ?? ''
      const value = /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : null
      if (value === null) {
        unpublished.push({ series_id: seriesId, period, raw })
        continue
      }

      const footnote = (row.footnotes ?? [])
        .map((f) => f?.text)
        .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
        .join(' | ')

      observations.push({
        series_id: seriesId,
        period,
        year,
        period_code: periodCode,
        value,
        vintage: opts.vintage,
        retrieved_at: opts.retrievedAt,
        retrieval_method: 'api_fetch',
        retrieved_at_basis: 'http_response',
        source_url: opts.sourceUrl ?? BLS_API_URL,
        footnotes: footnote === '' ? null : footnote,
      })
    }
  }

  return { observations, unpublished, emptySeries, warnings }
}

/** The request body BLS expects. Separated so a test can assert it without a network call. */
export function blsRequestBody(input: {
  seriesIds: readonly string[]
  startYear: number
  endYear: number
  annualAverage?: boolean
  apiKey?: string | null
}): Record<string, unknown> {
  if (input.seriesIds.length === 0) {
    throw new Error('blsRequestBody: refusing to build a request that asks for no series')
  }
  if (!Number.isInteger(input.startYear) || !Number.isInteger(input.endYear)) {
    throw new Error('blsRequestBody: startYear and endYear must be integers')
  }
  if (input.endYear < input.startYear) {
    throw new Error(
      `blsRequestBody: endYear ${input.endYear} precedes startYear ${input.startYear}`,
    )
  }
  const body: Record<string, unknown> = {
    seriesid: [...input.seriesIds],
    startyear: String(input.startYear),
    endyear: String(input.endYear),
  }
  // The v2 API returns annual averages (period M13) only when asked.
  if (input.annualAverage) body.annualaverage = true
  // Keyless works and is rate-limited. A key raises the ceiling; it is never required.
  if (input.apiKey) body.registrationkey = input.apiKey
  return body
}

/**
 * The escalation ratio between two periods of ONE series.
 *
 * RETURNS null RATHER THAN GUESSING. A period we did not observe is not answerable, and the
 * nearest covered period is a different fact wearing the right shape. Under the recommendation
 * doctrine an unresolvable ratio must surface as a named abstention identifying the missing
 * period, never as a silently substituted neighbour. Judging against "the nearest year I have"
 * instead of the year actually asked for is the same error that judged solicitations against
 * the newest day captured instead of today, and that produced three wrong headline numbers in
 * a single day on this build.
 */
export function escalationRatio(
  observations: readonly SeriesObservation[],
  input: { seriesId: string; fromPeriod: string; toPeriod: string; asOfVintage?: string },
): { ratio: number; from: SeriesObservation; to: SeriesObservation } | null {
  const pick = (period: string): SeriesObservation | null => {
    const candidates = observations.filter(
      (o) =>
        o.series_id === input.seriesId &&
        o.period === period &&
        (input.asOfVintage === undefined || o.vintage <= input.asOfVintage),
    )
    if (candidates.length === 0) return null
    // The newest vintage at or before the as-of point: what we would have said then.
    return candidates.reduce((a, b) => (b.vintage > a.vintage ? b : a))
  }
  const from = pick(input.fromPeriod)
  const to = pick(input.toPeriod)
  if (!from || !to) return null
  if (from.value === 0) return null // a zero base is not a ratio, it is a division by zero
  return { ratio: to.value / from.value, from, to }
}
