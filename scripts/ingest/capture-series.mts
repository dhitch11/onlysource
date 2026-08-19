/**
 * T2 INGESTION. CAPTURE A DATED PRICE SERIES INTO THE APPEND-ONLY LEDGER.
 *
 *   npx tsx scripts/ingest/capture-series.mts [--series ID,ID] [--from YYYY] [--to YYYY]
 *
 * Default series is CUUR0000SA0, the BLS CPI-U all-items index for the US city average, not
 * seasonally adjusted. That is not a preference: it is the series the price anchor's stored
 * 1.3223 factor was measured to be a reading of (2025-M11 = 324.122 over the 2017 annual
 * average of 245.120 = 1.32229928), so ingesting it replaces a naked constant with the thing
 * the constant was copied from.
 *
 * The DoD leg is deliberately NOT defaulted. The expert's 1.40 is his stated judgement rather
 * than an index reading, and `--series` takes any published id so a chosen producer-price
 * series can be added without touching this file.
 *
 * Exit codes: 0 healthy, 2 something needs an operator (a refused request, or the publisher
 * contradicting a figure it has already given us at the same vintage).
 */

/* BOOTSTRAP: identical to the other entry points, and it must precede every pipeline import. */
async function hasReactServerCondition(): Promise<boolean> {
  try {
    await import('server-only')
    return true
  } catch {
    return false
  }
}

if (!(await hasReactServerCondition())) {
  const { spawnSync } = await import('node:child_process')
  const nodeOptions = [process.env.NODE_OPTIONS, '--conditions=react-server']
    .filter(Boolean)
    .join(' ')
  const result = spawnSync(
    process.execPath,
    [...process.execArgv, process.argv[1]!, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: nodeOptions } },
  )
  process.exit(result.status ?? 1)
}

const { BLS_API_URL, blsRequestBody, parseBlsResponse, BlsRequestFailed, yearWindows, missingYears } =
  await import('../../lib/ingest/series/bls')
type ParseResult = Awaited<ReturnType<typeof parseBlsResponse>>
const { appendObservations, readSeriesLedger, seriesLedgerPath, summariseCoverage, SERIES_ROOT } =
  await import('../../lib/ingest/series/store')

const args = process.argv.slice(2)
function flag(name: string): string | null {
  const ix = args.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (ix === -1) return null
  const inline = args[ix]!.includes('=') ? args[ix]!.split('=').slice(1).join('=') : null
  return inline ?? args[ix + 1] ?? null
}

const DEFAULT_SERIES = ['CUUR0000SA0']
const seriesRaw = flag('--series')
const seriesIds = seriesRaw
  ? seriesRaw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s !== '')
  : DEFAULT_SERIES
if (seriesIds.length === 0) {
  process.stderr.write(
    `capture-series: --series "${seriesRaw}" named no series. Refusing to run a capture that ` +
      `captures nothing.\n`,
  )
  process.exit(1)
}

/*
 * THE WINDOW. The anchor has to reach every year an OEM award can fall in, and the award
 * index spans 2016-01-03 to 2026-01-29, so the default start is 2016. The 2017 base year the
 * stored factors were pinned to is inside it rather than being the whole of it, which is the
 * entire point of the change.
 */
const fromYear = Number(flag('--from') ?? 2016)
const toYear = Number(flag('--to') ?? new Date().getUTCFullYear())
for (const [name, v] of [
  ['--from', fromYear],
  ['--to', toYear],
] as const) {
  if (!Number.isInteger(v) || v < 1900 || v > 2200) {
    process.stderr.write(`capture-series: ${name} must be a four digit year, got ${v}\n`)
    process.exit(1)
  }
}
if (toYear < fromYear) {
  process.stderr.write(`capture-series: --to ${toYear} precedes --from ${fromYear}\n`)
  process.exit(1)
}

/*
 * THE VINTAGE IS THE DAY WE READ IT, in UTC. It is what makes a figure we published last week
 * reproducible after the publisher revises: the ledger key is (series_id, period, vintage),
 * so a revision lands as a new row beside the old one rather than on top of it.
 */
const retrievedAt = new Date().toISOString()
const vintage = retrievedAt.slice(0, 10)

process.stdout.write(
  `capture-series: ${seriesIds.join(', ')} | years ${fromYear}-${toYear} | vintage ${vintage}\n` +
    `capture-series: ledger ${seriesLedgerPath(SERIES_ROOT)}\n`,
)

const apiKey = process.env.BLS_API_KEY ?? null
process.stdout.write(
  `capture-series: registration key ${apiKey ? 'present' : 'ABSENT (keyless is rate limited, not broken)'}\n`,
)

/*
 * ONE REQUEST PER WINDOW. BLS caps a request at ten years and NARROWS the range rather than
 * refusing it, answering REQUEST_SUCCEEDED with a warning in `message`. The first live run of
 * this script asked for 2016-2026, was silently given 2016-2025, reported "129 observations,
 * 129 appended", and was missing 2026 -- the only year that makes the factor current. So the
 * windows are split to stay inside the limit, AND the warning is read, AND the returned years
 * are checked against the requested ones. Prevent it, then detect it anyway.
 */
const windows = yearWindows(fromYear, toYear)
process.stdout.write(
  `capture-series: ${windows.length} request window(s): ${windows.map((w) => `${w.startYear}-${w.endYear}`).join(', ')}\n`,
)

const allObservations: ParseResult['observations'] = []
const allUnpublished: ParseResult['unpublished'] = []
const allEmpty: string[] = []
const allWarnings: string[] = []
const droppedYears: { seriesId: string; years: number[] }[] = []

for (const [i, w] of windows.entries()) {
  // Pacing between windows: this is a public API and citizenship is cheap.
  if (i > 0) await new Promise((r) => setTimeout(r, 1500))

  let payload: unknown
  try {
    const response = await fetch(BLS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        blsRequestBody({
          seriesIds,
          startYear: w.startYear,
          endYear: w.endYear,
          annualAverage: true,
          apiKey,
        }),
      ),
      redirect: 'manual',
    })
    /*
     * A REDIRECT IS NOT A SUCCESS. This estate has a measured defect where an edge proxy
     * answered with a 307, fetch followed it, the destination returned 200 HTML, and `.ok`
     * was therefore true for a request that never happened.
     */
    if (response.status >= 300 && response.status < 400) {
      process.stderr.write(
        `capture-series: the origin answered ${response.status} with a redirect. Refusing to ` +
          `follow it and read the destination as data.\n`,
      )
      process.exit(2)
    }
    if (!response.ok) {
      process.stderr.write(`capture-series: HTTP ${response.status} from ${BLS_API_URL}\n`)
      process.exit(2)
    }
    payload = await response.json()
  } catch (error) {
    process.stderr.write(
      `capture-series: the request for ${w.startYear}-${w.endYear} failed: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(2)
  }

  let parsedWindow: ParseResult
  try {
    parsedWindow = parseBlsResponse(payload, { vintage, retrievedAt, sourceUrl: BLS_API_URL })
  } catch (error) {
    if (error instanceof BlsRequestFailed) {
      // A refused request and an empty series are different facts. Never let a quota
      // rejection read as "this series has no data", which puts a silent hole in a price
      // history and looks identical to a series that genuinely ended.
      process.stderr.write(`capture-series: ${error.message}\n`)
      process.exit(2)
    }
    throw error
  }

  allObservations.push(...parsedWindow.observations)
  allUnpublished.push(...parsedWindow.unpublished)
  allEmpty.push(...parsedWindow.emptySeries)
  allWarnings.push(...parsedWindow.warnings)

  for (const id of seriesIds) {
    const gone = missingYears(parsedWindow, {
      seriesId: id,
      startYear: w.startYear,
      endYear: w.endYear,
    })
    if (gone.length > 0) droppedYears.push({ seriesId: id, years: gone })
  }
}

const parsed = {
  observations: allObservations,
  unpublished: allUnpublished,
  emptySeries: [...new Set(allEmpty)],
  warnings: [...new Set(allWarnings)],
}

if (parsed.warnings.length > 0) {
  // A SUCCESS CARRYING AN UNREAD WARNING IS NOT A SUCCESS.
  process.stderr.write(`capture-series: the publisher returned ${parsed.warnings.length} warning(s):\n`)
  for (const w of parsed.warnings) process.stderr.write(`  WARNING: ${w}\n`)
}
if (droppedYears.length > 0) {
  process.stderr.write(
    `capture-series: requested year(s) came back with NOTHING, neither data nor a not-published ` +
      `marker. The answer is incomplete:\n`,
  )
  for (const d of droppedYears) {
    process.stderr.write(`  ${d.seriesId}: ${d.years.join(', ')}\n`)
  }
}

const outcome = await appendObservations(parsed.observations, SERIES_ROOT)
process.stdout.write(
  `capture-series: ${parsed.observations.length} observation(s) read | ${outcome.appended} appended | ` +
    `${outcome.alreadyHeld} already held\n`,
)

if (outcome.contradictions.length > 0) {
  process.stderr.write(
    `capture-series: ${outcome.contradictions.length} CONTRADICTION(S). The publisher returned a ` +
      `different value for a period at a vintage we already hold. Both rows are kept; an operator ` +
      `decides which is right.\n`,
  )
  for (const c of outcome.contradictions) {
    process.stderr.write(
      `  ${c.series_id} ${c.period} vintage ${c.vintage}: held ${c.held}, incoming ${c.incoming}\n`,
    )
  }
}

const coverage = summariseCoverage(await readSeriesLedger(SERIES_ROOT))
process.stdout.write(`\ncapture-series coverage:\n`)
for (const c of coverage) {
  process.stdout.write(
    `  ${c.series_id}: ${c.periods} period(s) ${c.firstPeriod} to ${c.lastPeriod} | ` +
      `vintages ${c.vintages.join(', ')} | revised periods ${c.revisedPeriods}\n`,
  )
}

process.exit(
  parsed.emptySeries.length > 0 ||
    outcome.contradictions.length > 0 ||
    droppedYears.length > 0 ||
    parsed.warnings.length > 0
    ? 2
    : 0,
)
