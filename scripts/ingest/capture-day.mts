/**
 * T2 INGESTION. CAPTURE TODAY'S AVAILABLE DIBBS FILES, GATED, PACED, IDEMPOTENT.
 *
 *   npx tsx scripts/ingest/capture-day.mts [YYYY-MM-DD] [--kinds in,bq,ca]
 *                                          [--window N] [--max-days N]
 *
 * Run from the repo root. With no date it RECONCILES A WINDOW of business days (Eastern,
 * federal holidays out) against the bytes on disk and captures every day it does not hold,
 * newest first. Days whose files are already on disk cost no request, so an ordinary morning
 * still makes one or two fetches; the difference only appears when there is a gap.
 *
 * IT USED TO STOP AT THE FIRST DAY THAT EXISTED, and that is why this changed. Production
 * captured 2026-08-17 at 06:18 and lost it hours later to a restore. The next morning's run
 * would have found 08-18, stopped, and never returned for it: a deleted day was permanently
 * invisible to the only process that could have noticed. A schedule that cannot see a hole
 * will never fill one.
 *
 * An explicit date is the operator's claim: that day only, no walking.
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
  captureWindow,
  DEFAULT_MAX_DAYS_REQUESTED,
  DEFAULT_WINDOW_DAYS,
  heldFiles,
  isFailure,
  newestPossibleFeedDay,
  printResult,
  realClientProvider,
  reconcileHeld,
} = shared
const { reconciliationReport, provenanceReport, findOrphans, listArchiveFiles, unreadableArchives } =
  await import('../../lib/ingest/archive-reconcile')
const { readManifestEntries: readEntriesForOrphans } = await import('../../lib/ingest/archive')

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

/*
 * THE WINDOW, NOT THE NEWEST DAY. See captureWindow() for why this stopped being a walk that
 * halts at the first day it finds. `--window` sets how many business days back to reconcile,
 * `--max-days` how many of the gaps one run may actually ask the origin about.
 */
const windowDays = Number(flagValue('--window') ?? DEFAULT_WINDOW_DAYS)
if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 60) {
  process.stderr.write(`capture-day: --window must be an integer 1 to 60, got ${flagValue('--window')}\n`)
  process.exit(1)
}
const maxDays = Number(flagValue('--max-days') ?? DEFAULT_MAX_DAYS_REQUESTED)
if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 60) {
  process.stderr.write(`capture-day: --max-days must be an integer 1 to 60, got ${flagValue('--max-days')}\n`)
  process.exit(1)
}

const candidates = dateArg ? [dateArg] : businessDaysBack(newestPossibleFeedDay(), windowDays)

/*
 * RECONCILE BEFORE CAPTURING, AND SAY WHAT THE RECONCILIATION FOUND. A file the manifest
 * accepted whose bytes are gone stops counting as held, which means this run may fetch
 * something a reader believed we already had. That must be announced: a run that silently
 * re-fetches gigabytes is very nearly as surprising as one that silently skips them.
 */
const reconciliation = await reconcileHeld()
for (const line of reconciliationReport(reconciliation)) process.stdout.write(`${line}\n`)

/*
 * AND THE TWO THINGS THE RE-FETCH LIST CANNOT SAY. A file can be held, at its recorded length,
 * and be 8% of the real thing (ca260811, 2026-08-19), so the GRADE has to be visible. And the
 * manifest walk is structurally incapable of seeing bytes with no row, so the DISK gets walked
 * too. Both are reported here and neither is ever acted on automatically.
 */
const orphans = findOrphans(await readEntriesForOrphans(root.root), listArchiveFiles(root.root))
for (const line of provenanceReport(reconciliation, orphans)) process.stdout.write(`${line}\n`)

/*
 * AND THE THIRD THING A FILE CAN BE WRONG ABOUT. `ca260811.zip` matched its recorded length,
 * began with a valid local file header, and had no central directory: a truncated transfer keeps
 * a perfect beginning and loses the end. PRESENT is not WHOLE, and WHOLE is not READABLE.
 */
const unreadable = unreadableArchives(reconciliation)
if (unreadable.length > 0) {
  process.stderr.write(
    `archive readability: ${unreadable.length} archive(s) are present at the recorded length and ` +
      `CANNOT BE OPENED (no end-of-central-directory record, the signature of a truncated transfer):\n`,
  )
  for (const f of unreadable) {
    process.stderr.write(`  UNREADABLE ${f.logicalDate} ${f.filename} - ${(f.actualBytes ?? 0).toLocaleString('en-US')} bytes on disk\n`)
  }
}

const held = await heldFiles()
const state = { wafStrikes: 0, requestsMade: 0 }
let anyFailure = false

try {
  if (dateArg) {
    /*
     * AN EXPLICIT DATE IS THE OPERATOR'S CLAIM. Fetched as asked, judged only by its own
     * outcomes, no walking in either direction.
     */
    process.stdout.write(`feed day ${dateArg}:\n`)
    const report = await captureDay(realClientProvider, dateArg, kinds, held, state)
    for (const r of report.results) printResult(r)
    anyFailure = report.results.some(isFailure)
  } else {
    const window = await captureWindow(realClientProvider, candidates, kinds, held, state, {
      maxDaysRequested: maxDays,
    })
    anyFailure = window.days.some((d) => d.results.some(isFailure))

    /*
     * SAY WHAT THE WINDOW DID, INCLUDING THE DAYS IT DID NOT ASK ABOUT. A run that reports
     * only its fetches reads as though the rest of the window does not exist, and the whole
     * point of walking a window is that a day nobody mentions is exactly how 08-17 stayed
     * lost. Silence about a skipped day is the defect, restated.
     */
    process.stdout.write(
      `\ncapture window: ${candidates.length} business days ${candidates[candidates.length - 1]} to ` +
        `${candidates[0]} | already held: ${window.alreadyComplete.length} | requested: ` +
        `${window.requested.length}${window.requested.length > 0 ? ` (${window.requested.join(', ')})` : ''} | ` +
        `stopped: ${window.stopReason}\n`,
    )
    if (window.stopReason === 'request_budget_spent') {
      process.stdout.write(
        `capture window: the per-run request budget of ${maxDays} day(s) is spent. Days older than ` +
          `the ones listed above were NOT measured this run and are not claimed either way; the next ` +
          `run continues from the same window.\n`,
      )
    }
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
