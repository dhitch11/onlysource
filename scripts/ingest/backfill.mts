/**
 * T2 INGESTION. BACKFILL THE DIBBS RETENTION WINDOW BEFORE IT CLOSES ON EACH DAY.
 *
 *   npx tsx scripts/ingest/backfill.mts [--days N] [--kinds in,bq,ca] [--from YYYY-MM-DD]
 *
 * Walks BUSINESS days backwards (Eastern calendar, federal holidays skipped) from the
 * newest possible feed day, default 28 of them, which is the approximate depth of the
 * origin's rolling retention. Each file takes the same gated path as the daily capture:
 * classifier before archive, full-file index assertion, one manifest row per file INCLUDING
 * refusals, so an origin 404 on an expired day is a recorded fact with its status, never
 * silence. Idempotent: files the manifest already holds are skipped with no request, so
 * re-running after an abort resumes where the work stopped.
 *
 * Paced for the F5 WAF (seconds between requests, 90s backoff on a measured block, hard
 * abort on the third unresolved block). A whole-window run with in+bq+ca moves roughly
 * 1.5 GB; --kinds exists so the perishable small files can be secured first.
 *
 * Exit codes: 0 every outcome healthy (archived / already held / not published),
 *             2 something was refused or blocked; the summary names each one.
 */

/* BOOTSTRAP: identical to capture-day.mts, and it must precede every pipeline import. */
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
type DayFileResult = import('./capture-shared').DayFileResult

type DailyFileKind = (typeof DAILY_FILES)[number]

const args = process.argv.slice(2)
function flag(name: string): string | null {
  const ix = args.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (ix === -1) return null
  const inline = args[ix]!.split('=')[1]
  return inline ?? args[ix + 1] ?? null
}

const days = Number(flag('--days') ?? 28)
if (!Number.isInteger(days) || days < 1 || days > 60) {
  process.stderr.write(`backfill: --days must be an integer between 1 and 60, got ${flag('--days')}\n`)
  process.exit(1)
}
const kindsRaw = flag('--kinds')
const kinds: readonly DailyFileKind[] = kindsRaw
  ? (kindsRaw.split(',') as DailyFileKind[]).filter((k): k is DailyFileKind =>
      (DAILY_FILES as readonly string[]).includes(k),
    )
  : DAILY_FILES
if (kinds.length === 0) {
  // Same refusal as capture-day: an empty kinds list once made a run report on days it
  // never queried. A backfill that backfills nothing is an error, not a quiet success.
  process.stderr.write(
    `backfill: --kinds "${kindsRaw}" named no valid file kind (valid: ${DAILY_FILES.join(', ')}).\n`,
  )
  process.exit(1)
}
const fromRaw = flag('--from')
if (fromRaw && !/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
  process.stderr.write(`backfill: --from must be YYYY-MM-DD, got ${fromRaw}\n`)
  process.exit(1)
}

const from = fromRaw
  ? { year: Number(fromRaw.slice(0, 4)), month: Number(fromRaw.slice(5, 7)), day: Number(fromRaw.slice(8, 10)) }
  : newestPossibleFeedDay()

const root = archiveRootResolution()
const window = businessDaysBack(from, days)
process.stdout.write(
  `backfill: ${window.length} business days, ${window[0]} back to ${window[window.length - 1]}, ` +
    `kinds [${kinds.join(', ')}]\n` +
    `backfill: archive root ${root.root} (via ${root.basis}, ${root.present ? 'present' : 'ABSENT'})\n`,
)

/*
 * RECONCILE FIRST, AND ANNOUNCE IT. The backfill is the run most likely to re-fetch a file
 * the manifest claims and the disk lost, so the reason has to be on screen before the
 * requests start rather than inferred afterwards from a bandwidth bill.
 */
const reconciliation = await reconcileHeld()
for (const line of reconciliationReport(reconciliation)) process.stdout.write(`${line}\n`)

const held = await heldFiles()
const state = { wafStrikes: 0, requestsMade: 0 }
const all: DayFileResult[] = []
let aborted: string | null = null

try {
  for (const day of window) {
    process.stdout.write(`feed day ${day}:\n`)
    const report = await captureDay(realClientProvider, day, kinds, held, state)
    for (const r of report.results) printResult(r)
    all.push(...report.results)
  }
} catch (error) {
  if (error instanceof WafBudgetExhausted) {
    for (const r of error.partial.results) printResult(r)
    all.push(...error.partial.results)
    aborted = error.message
  } else {
    throw error
  }
}

/* The summary, one line per state, so the run's honesty survives the scrollback. */
const byStatus = new Map<string, number>()
for (const r of all) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)
process.stdout.write('\nbackfill summary:\n')
for (const [status, count] of [...byStatus.entries()].sort()) {
  process.stdout.write(`  ${status}: ${count}\n`)
}
process.stdout.write(`  requests made: ${state.requestsMade}, WAF strikes: ${state.wafStrikes}\n`)
if (aborted) process.stderr.write(`${aborted}\n`)

const failures = all.filter(isFailure)
for (const f of failures) {
  process.stderr.write(`  needs an operator: ${f.logicalDate} ${f.filename} ${f.status} - ${f.detail}\n`)
}
process.exit(aborted || failures.length > 0 ? 2 : 0)
