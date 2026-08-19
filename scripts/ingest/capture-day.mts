/**
 * T2 INGESTION. CAPTURE TODAY'S AVAILABLE DIBBS FILES, GATED, PACED, IDEMPOTENT.
 *
 *   npx tsx scripts/ingest/capture-day.mts [YYYY-MM-DD] [--kinds in,bq,ca]
 *
 * Run from the repo root. With no date it finds the newest published feed day itself:
 * starting at the newest possible business day (Eastern), it walks backwards over business
 * days until one answers with data, stopping after five misses, because a morning run can
 * legitimately precede the day's publication and the previous days are then the newest
 * that exist. Days the manifest already holds are skipped without touching the network.
 *
 * EVERY byte passes the content gate (classifyFeedResponse plus the full-file index
 * assertion) before it is archived; every refusal, origin 404 included, becomes a manifest
 * row. Nothing here can log a banner as data, because the code that would have to is the
 * same code the fixtures prove refuses it.
 *
 * Exit codes: 0 all outcomes healthy (archived / already held / not published),
 *             2 something needs an operator (rejected, WAF, consent failure).
 */

/*
 * BOOTSTRAP. The pipeline imports the `server-only` marker, which throws unless this
 * process resolves modules with the `react-server` condition. Plain `npx tsx` does not, so
 * the script measures (an import attempt, not an environment guess) and re-execs itself
 * with the condition when it is missing. No static imports may precede this.
 */
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

const shared = await import('./capture-shared')
const {
  DAILY_FILES,
  WafBudgetExhausted,
  archiveRootResolution,
  businessDaysBack,
  captureDay,
  heldFiles,
  isFailure,
  newestPossibleFeedDay,
  printResult,
  realClientProvider,
  reconcileHeld,
} = shared
const { reconciliationReport } = await import('../../lib/ingest/archive-reconcile')

type DailyFileKind = (typeof DAILY_FILES)[number]

const args = process.argv.slice(2)
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? null

/*
 * FLAG PARSING REFUSES WHAT IT CANNOT READ. The first live run of this script passed
 * `--kinds in` as two argv entries, a parser here read the bare flag as an empty list,
 * captured NOTHING, and then reported five days "not published" without having asked the
 * origin a single question. Wrong in the register of having measured. So: both `--kinds=x`
 * and `--kinds x` parse, an unreadable or empty kinds list is a refusal, and the day walk
 * below only ever describes days it actually queried.
 */
function flagValue(name: string): string | null {
  const ix = args.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (ix === -1) return null
  const inline = args[ix]!.includes('=') ? args[ix]!.split('=').slice(1).join('=') : null
  return inline ?? args[ix + 1] ?? null
}

const kindsRaw = flagValue('--kinds')
const kinds: readonly DailyFileKind[] = kindsRaw
  ? (kindsRaw.split(',') as DailyFileKind[]).filter((k): k is DailyFileKind =>
      (DAILY_FILES as readonly string[]).includes(k),
    )
  : DAILY_FILES
if (kinds.length === 0) {
  process.stderr.write(
    `capture-day: --kinds "${kindsRaw}" named no valid file kind (valid: ${DAILY_FILES.join(', ')}). ` +
      `Refusing to run a capture that captures nothing.\n`,
  )
  process.exit(1)
}
if (!dateArg && !kinds.includes('in')) {
  process.stderr.write(
    `capture-day: without an explicit date, the day walk needs the 'in' index file to measure ` +
      `whether a day exists. Add 'in' to --kinds or pass a date.\n`,
  )
  process.exit(1)
}

const root = archiveRootResolution()
process.stdout.write(
  `capture-day: archive root ${root.root} (via ${root.basis}, ${root.present ? 'present' : 'ABSENT'})\n`,
)
if (!root.present) {
  process.stderr.write('capture-day: the archive root does not exist; refusing to invent one silently is wrong here, mkdir happens on first write, continuing\n')
}

/** With an explicit date: that day only. Without: newest first, walking back over misses. */
const candidates = dateArg ? [dateArg] : businessDaysBack(newestPossibleFeedDay(), 5)

/*
 * RECONCILE BEFORE CAPTURING, AND SAY WHAT THE RECONCILIATION FOUND. A file the manifest
 * accepted whose bytes are gone stops counting as held, which means this run may fetch
 * something a reader believed we already had. That must be announced: a run that silently
 * re-fetches gigabytes is very nearly as surprising as one that silently skips them.
 */
const reconciliation = await reconcileHeld()
for (const line of reconciliationReport(reconciliation)) process.stdout.write(`${line}\n`)

const held = await heldFiles()
const state = { wafStrikes: 0, requestsMade: 0 }
let anyFailure = false

try {
  for (const day of candidates) {
    process.stdout.write(`feed day ${day}:\n`)
    const report = await captureDay(realClientProvider, day, kinds, held, state)
    for (const r of report.results) printResult(r)
    anyFailure = anyFailure || report.results.some(isFailure)

    // The index-driven walk applies only when this script CHOSE the day. An explicit date
    // is the operator's claim, fetched as asked, judged only by its own outcomes.
    if (dateArg) break

    const indexResult = report.results.find((r) => r.kind === 'in')
    if (!indexResult) {
      // The walk's evidence is the index fetch. No index result means this day was never
      // measured, and describing an unmeasured day in either direction would be invented.
      process.stderr.write(
        `capture-day: no index outcome came back for ${day}; stopping rather than guessing\n`,
      )
      anyFailure = true
      break
    }
    const dayExists = ['archived', 'already_present', 'skipped_already_held'].includes(
      indexResult.status,
    )
    if (dayExists) {
      // The newest published day is captured (or already held). Older days are the
      // backfill's job, not this cron's; stop rather than crawl history every morning.
      break
    }
    if (indexResult.status !== 'not_published') {
      // A refusal that is not "does not exist" (rejected content, consent failure, WAF).
      // Walking further back would paper over it with an older success.
      anyFailure = true
      break
    }
    process.stdout.write(
      `  ${day}: the origin answered HTTP 404 for ${indexResult.filename}; trying the previous business day\n`,
    )
  }
} catch (error) {
  if (error instanceof WafBudgetExhausted) {
    for (const r of error.partial.results) printResult(r)
    process.stderr.write(`${error.message}\n`)
    process.exit(2)
  }
  throw error
}

process.exit(anyFailure ? 2 : 0)
