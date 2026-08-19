/**
 * T2 ACQUISITION. REBUILD THE AWARD-HISTORY PULL LISTS ON THE RIGHT UNIT.
 *
 *   npx tsx scripts/ingest/rebuild-award-pull-lists.mts [--out data/nsn-now/pull-lists]
 *
 * The previous lists were chunked at 20,000 STOCK NUMBERS per report against a 20,000 RECORD
 * cap. One stock number is 17.5 records, so each of those reports would have returned ~1,140 of
 * its 20,000 stock numbers — 5.7% — as a clean, complete-looking workbook. This rebuilds at
 * SAFE_NSNS_PER_REPORT and puts the stock numbers we are currently WRONG about first.
 *
 * Ordering is the point. The 669 never-answered stock numbers are not merely missing: they are
 * already in the index as "no award history", which is a claim we cannot support. Every other
 * stock number on the list is honestly unknown and says so. Fixing a wrong answer outranks
 * filling a gap.
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
  const nodeOptions = [process.env.NODE_OPTIONS, '--conditions=react-server'].filter(Boolean).join(' ')
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1]!, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  })
  process.exit(r.status ?? 1)
}

const { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } = await import('node:fs')
const { join } = await import('node:path')
const { readBatchExportWorkbook, auditWorkbook, SAFE_NSNS_PER_REPORT, MEASURED_ROWS_PER_REQUESTED_NSN, SHEET_ROW_CAP } =
  await import('../../lib/ingest/batch-export/workbook')

const args = process.argv.slice(2)
const flag = (n: string): string | null => {
  const i = args.findIndex((a) => a === n || a.startsWith(`${n}=`))
  if (i === -1) return null
  return args[i]!.includes('=') ? args[i]!.split('=').slice(1).join('=') : (args[i + 1] ?? null)
}

const SRC = join(process.cwd(), 'data', 'nsn-now')
const OUT = flag('--out') ?? join(SRC, 'pull-lists')

if (!existsSync(SRC)) {
  process.stderr.write(`rebuild-award-pull-lists: ${SRC} does not exist. Nothing to read.\n`)
  process.exit(1)
}

const workbooks = readdirSync(SRC)
  .filter((f) => f.endsWith('.xlsx') && !f.startsWith('~'))
  .sort()

if (workbooks.length === 0) {
  process.stderr.write(`rebuild-award-pull-lists: no workbooks in ${SRC}.\n`)
  process.exit(1)
}

process.stdout.write(`rebuild-award-pull-lists: reading ${workbooks.length} workbook(s) from ${SRC}\n`)

const neverAnswered = new Set<string>()
const honestlyAbsent = new Set<string>()
const haveHistory = new Set<string>()

for (const f of workbooks) {
  const path = join(SRC, f)
  let reading
  try {
    reading = readBatchExportWorkbook(path)
  } catch (e) {
    process.stderr.write(`  ${f}: UNREADABLE (${e instanceof Error ? e.message : String(e)}) — skipped\n`)
    continue
  }

  /*
   * THE REQUESTED SET IS RECONSTRUCTED, NOT RECORDED, AND THAT IS ITSELF THE PROBLEM.
   *
   * Nobody wrote down which stock numbers were pasted into each report, so the best available
   * stand-in is the union of every sheet in the file: a stock number that appears anywhere was
   * certainly asked about. That is a LOWER BOUND on the request — a stock number that returned
   * nothing on EVERY sheet is invisible to it — so the never-answered count below can only be
   * under-stated, never inflated. Under-stating costs a later re-request. Inflating would put
   * stock numbers on a paid report that nobody ever asked for.
   *
   * Going forward the loader records the request list beside the file, so this reconstruction
   * is never needed twice.
   */
  const requested = [...new Set(reading.sheets.flatMap((s) => s.nsns))]
  const audit = auditWorkbook({ reading, requested })

  const proc = audit.sheets.find((s) => s.sheet === 'Procurement')
  if (!proc) {
    process.stdout.write(`  ${f}: no Procurement sheet — award history not in scope for this report\n`)
    continue
  }
  for (const n of proc.answered) haveHistory.add(n)
  for (const n of proc.neverAnswered) neverAnswered.add(n)
  for (const n of proc.absent) honestlyAbsent.add(n)

  process.stdout.write(
    `  ${f}: Procurement ${proc.dataRows} rows${proc.atCap ? ' *** AT CAP' : ''} | ` +
      `requested(reconstructed) ${requested.length} | answered ${proc.answered.length} | ` +
      `absent ${proc.absent.length} | NEVER ANSWERED ${proc.neverAnswered.length}\n`,
  )
}

/* A stock number answered in one report is not unknown because another report cut it short. */
for (const n of haveHistory) neverAnswered.delete(n)
for (const n of haveHistory) honestlyAbsent.delete(n)

process.stdout.write(
  `\nrebuild-award-pull-lists: with history ${haveHistory.size} | honestly absent ${honestlyAbsent.size} | ` +
    `NEVER ANSWERED ${neverAnswered.size}\n`,
)

/* The wider gap list, if a previous run left one. Never invented. */
const gapPath = join(OUT, 'award-pull-list.txt')
const gap: string[] = existsSync(gapPath)
  ? readFileSync(gapPath, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s !== '')
  : []

const seen = new Set<string>()
const ordered: string[] = []
for (const n of [...neverAnswered, ...gap]) {
  if (seen.has(n) || haveHistory.has(n) || honestlyAbsent.has(n)) continue
  seen.add(n)
  ordered.push(n)
}

const chunks: string[][] = []
for (let i = 0; i < ordered.length; i += SAFE_NSNS_PER_REPORT) {
  chunks.push(ordered.slice(i, i + SAFE_NSNS_PER_REPORT))
}

mkdirSync(OUT, { recursive: true })
const width = String(chunks.length).length
for (const [i, c] of chunks.entries()) {
  const name = `report-${String(i + 1).padStart(width, '0')}.txt`
  writeFileSync(join(OUT, name), c.join('\n') + '\n', 'utf8')
}
writeFileSync(join(OUT, 'never-answered.txt'), [...neverAnswered].join('\n') + '\n', 'utf8')

const readme = `AWARD-HISTORY PULL LISTS — rebuilt ${new Date().toISOString().slice(0, 10)} by @DATA-CURRENCY

WHY THESE REPLACE award-pull-1/2.txt
Those were chunked at 20,000 STOCK NUMBERS per report. The cap is 20,000 RECORDS. Measured on
full_2.xlsx — the only Procurement sheet that did not hit the ceiling, so nothing was cut — one
requested stock number costs ${MEASURED_ROWS_PER_REQUESTED_NSN} records. A 20,000-NSN paste
therefore returns about 1,140 of them, 5.7%, as a workbook that looks complete.

  records per report (per SHEET, measured)   ${SHEET_ROW_CAP}
  records per requested stock number          ${MEASURED_ROWS_PER_REQUESTED_NSN}
  stock numbers per report USED HERE          ${SAFE_NSNS_PER_REPORT}   (= ${SAFE_NSNS_PER_REPORT * MEASURED_ROWS_PER_REQUESTED_NSN} records)

1,140 is NOT used even though it fits on paper: it is the observed edge and two of the three
reports that used it overflowed.

ORDER — READ THIS BEFORE RESEQUENCING
never-answered.txt (${neverAnswered.size} stock numbers) is at the FRONT of report-01 onward.
Those are not gaps. They are already in the index as "no award history" because the report that
should have answered stopped at exactly 20,000 rows. We are currently WRONG about them, not
merely ignorant, and a wrong answer outranks a missing one.

  stock numbers with award history held        ${haveHistory.size}
  honestly absent (asked, answered "nothing")  ${honestlyAbsent.size}
  NEVER ANSWERED — re-request these first      ${neverAnswered.size}
  total queued across ${chunks.length} report(s)                ${ordered.length}

CAPACITY
The site counter is the authority, not this file. At the time of writing it read 7 of 25
generated, so 18 remained in the rolling week — about ${18 * SAFE_NSNS_PER_REPORT} stock numbers.
${chunks.length} reports is ${Math.ceil(chunks.length / 25)} week(s) at a full allowance.

★ EVERY DOWNLOADED FILE GOES THROUGH auditWorkbook() BEFORE ANYTHING PARSES IT.
Not the row count — the stock numbers. A truncated report and a complete one both return the cap.
`
writeFileSync(join(OUT, 'README.txt'), readme, 'utf8')

process.stdout.write(
  `rebuild-award-pull-lists: wrote ${chunks.length} report list(s) of <=${SAFE_NSNS_PER_REPORT} to ${OUT}\n` +
    `rebuild-award-pull-lists: ${ordered.length} stock numbers queued, ${neverAnswered.size} of them re-requests\n`,
)
process.exit(0)
