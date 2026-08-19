#!/usr/bin/env node
/**
 * THE DATA REACHABILITY CENSUS. Does anything actually SUPPLY what the code reads?
 *
 * =====================================================================================
 * WHY THIS EXISTS, AND WHY THE OTHER CENSUS COULD NOT CATCH IT
 * =====================================================================================
 * `scripts/reachability-census.mjs` answers "does anything reach this MODULE". It is the
 * repo's best instrument and it is blind to the other half of the same failure: a module that
 * is reached perfectly and reads a directory nothing ever wrote.
 *
 * MEASURED, 2026-08-19, and it cost this build most of a night. `lib/ingest/series/store.ts`
 * was written, tested, wired and correct. The BLS capture ran and produced 136 real
 * observations. The price anchor's resolver was built and proven. And production shipped a
 * stale hardcoded 1.3223 against a true 1.3623 for hours, because the ingest had written to
 * `/Users/user/onlysource-data/series/` (a laptop path baked into `DATA_ROOT`) while the app
 * read `dataPath('series')`. Two roots, one letter of difference in intent, no error anywhere.
 *
 * Every lane independently ran `ls` on the roots the app reads, found nothing, and concluded
 * "the ledger has not been captured yet". **The data existed the whole time.** `store.ts`'s own
 * header even names the trap — "BUILT, CORRECT, AND WRITING WHERE NOTHING READS" — and the
 * comment could not fail a build, so it did not stop the second instance of itself.
 *
 * =====================================================================================
 * WHAT IT DOES
 * =====================================================================================
 * Discovers every literal `dataPath(...)`, `archivePath(...)` and `seedPath(...)` in the
 * source, resolves each against the SAME root the app resolves, and reports whether anything
 * is actually there. It does not read a hardcoded list of expected directories: a hardcoded
 * list is a defect with a delay on it, wrong the first time someone adds a dataset.
 *
 * ★ AND IT REPORTS WHAT IT COULD NOT CHECK. A call built from a variable cannot be resolved
 * statically, so those are counted and NAMED rather than skipped. An instrument that silently
 * ignores what it cannot see reports a clean bill over its own blind spot, which is the exact
 * defect class this file exists for.
 *
 * IT IS A REPORT BY DEFAULT AND A GATE ON DEMAND. Absent data is normal in a fresh checkout
 * (`data/` is gitignored and 1.4GB), so failing by default would make it noise CI switches off.
 * `--require <name,name>` fails when a NAMED dataset is missing, which is what a deploy wants:
 * on the droplet, `--require series,archive,flis` is the check that would have caught this.
 *
 * USAGE
 *   node scripts/data-reachability.mjs
 *   node scripts/data-reachability.mjs --require series,archive
 *   node scripts/data-reachability.mjs --selftest
 */
import { readdirSync, readFileSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const SKIP_DIR = new Set(['node_modules', '.next', '.git', '.probe', 'data', 'public', 'tmp'])
const CODE_EXT = ['.ts', '.tsx', '.mts', '.mjs', '.js']

function walk(dir, out = []) {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (SKIP_DIR.has(name)) continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walk(full, out)
    else if (CODE_EXT.includes(extname(name))) out.push(full)
  }
  return out
}

/** The app's own root resolution, mirrored. Kept in one place so the two cannot drift silently. */
function resolveRoot() {
  const env = process.env.ONLYSOURCE_DATA_DIR
  if (env) return { root: env, from: 'ONLYSOURCE_DATA_DIR' }
  return { root: join(ROOT, 'data'), from: '<repo>/data' }
}

const CALL = /\b(dataPath|archivePath|seedPath)\(\s*(['"])([^'"]+)\2/g
const ANY_CALL = /\b(dataPath|archivePath|seedPath)\(/g
/** `dataPath()` with no argument is the root itself, which is the most checkable path there is. */
const ZERO_ARG = /\b(dataPath|archivePath|seedPath)\(\s*\)/g
/** `dataPath(NAME, ...)` where NAME is a bare identifier, resolvable if it is a same-file literal. */
const CALL_IDENT = /\b(dataPath|archivePath|seedPath)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g
const PREFIX = { dataPath: [], archivePath: ['archive'], seedPath: ['seed'] }

/**
 * ★ ONE HOP OF INDIRECTION IS RESOLVED, AND THE REASON IS AN ARGUMENT I LOST.
 *
 * The first version reported 16 calls it could not check because their first segment was an
 * identifier rather than a literal, and I suggested to the ingest lane that inlining the
 * constants would close the gap. **They measured all 16 and pushed back, correctly.**
 *
 * Seven are genuinely identifier-first, and every one is a module-level `const` bound to a
 * string literal in the same file (`const SUPPLIERS_DIR = 'suppliers'`). The rest are
 * ZERO-ARGUMENT calls: the data root itself, which is the most checkable path of all and was
 * being counted as a blind spot.
 *
 * **Inlining would have made the code worse.** The constant exists so the path is written once,
 * and duplicating it at each call site is how two copies drift and one becomes wrong. Degrading
 * real code to satisfy an instrument is the same instinct as silencing a linter instead of
 * closing the hole, and it points the wrong way.
 *
 * So the instrument resolves one hop instead. It is deliberately ONE hop and same-file only: a
 * general constant-folder would be a small interpreter, and an instrument that can be wrong in
 * subtle ways is worse than one with a stated boundary. Anything beyond one hop is still
 * reported as unresolvable, by name.
 */
function sameFileLiterals(src) {
  const out = new Map()
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(['"])([^'"]+)\2/g)) {
    out.set(m[1], m[3])
  }
  return out
}

/**
 * Discover every statically-resolvable dataset root the code reads, and count what it cannot.
 *
 * ★ THIS FILE EXCLUDES ITSELF, AND THAT IS NOT TIDINESS. Its self-test writes fixture sources
 * containing `dataPath('present')` and `dataPath('missing')`, and the first live run duly
 * reported two datasets named "present" and "missing" as ABSENT. The instrument was reading its
 * own handiwork and reporting it as a finding about the product. An instrument that cannot tell
 * its own fixtures from the subject reports on itself, which is the failure this estate has
 * recorded five times in one day under a different name.
 */
const SELF = 'scripts/data-reachability.mjs'

export function discover(root) {
  const wanted = new Map() // dataset -> Set of "file:line"
  let unresolvable = []
  for (const file of walk(join(root, 'lib')).concat(walk(join(root, 'app')), walk(join(root, 'scripts')))) {
    if (relative(root, file) === SELF) continue
    let src
    try { src = readFileSync(file, 'utf8') } catch { continue }
    const rel = relative(root, file)
    const consts = sameFileLiterals(src)
    let resolved = 0
    const note = (fn, seg, index) => {
      const first = [...PREFIX[fn], seg][0]
      if (!first || first.startsWith('.')) return
      const line = src.slice(0, index).split('\n').length
      if (!wanted.has(first)) wanted.set(first, new Set())
      wanted.get(first).add(`${rel}:${line}`)
    }
    for (const m of src.matchAll(CALL)) { resolved += 1; note(m[1], m[3], m.index) }
    // Zero-argument: the root itself. Checkable, and previously counted as a blind spot.
    for (const m of src.matchAll(ZERO_ARG)) { resolved += 1; note(m[1], PREFIX[m[1]][0] ?? '', m.index) }
    // One hop: an identifier bound to a string literal in this same file.
    for (const m of src.matchAll(CALL_IDENT)) {
      const lit = consts.get(m[2])
      if (lit === undefined) continue
      resolved += 1
      note(m[1], lit, m.index)
    }
    const total = [...src.matchAll(ANY_CALL)].length
    // Still unresolvable after one hop: real, and NAMED rather than dropped.
    if (total > resolved) unresolvable.push({ file: rel, count: total - resolved })
  }
  return { wanted, unresolvable }
}

/** Is a dataset actually supplied? Present-but-empty is its own answer, not "present". */
export function inspect(dataRoot, dataset) {
  const p = join(dataRoot, dataset)
  if (!existsSync(p)) return { dataset, state: 'ABSENT', bytes: 0, entries: 0 }
  let entries = 0
  let bytes = 0
  const stack = [p]
  while (stack.length) {
    const d = stack.pop()
    let st
    try { st = statSync(d) } catch { continue }
    if (st.isDirectory()) {
      let names
      try { names = readdirSync(d) } catch { continue }
      for (const n of names) stack.push(join(d, n))
    } else { entries += 1; bytes += st.size }
  }
  return { dataset, state: entries === 0 ? 'EMPTY' : 'present', bytes, entries }
}

/* ------------------------------------------------------------------ the self-test */

function selftest() {
  const failures = []
  const dir = mkdtempSync(join(tmpdir(), 'data-reach-'))
  try {
    const w = (rel, body) => { mkdirSync(join(dir, rel.split('/').slice(0, -1).join('/')), { recursive: true }); writeFileSync(join(dir, rel), body) }
    w('lib/a.ts', "import {dataPath} from './x'\nconst p = dataPath('present', 'f.json')\n")
    w('lib/b.ts', "const q = dataPath('missing')\n")
    w('lib/c.ts', "const r = archivePath('dibbs')\n")
    w('lib/d.ts', "const s = dataPath(SOME_VAR, 'x')\n")
    mkdirSync(join(dir, 'data', 'present'), { recursive: true })
    writeFileSync(join(dir, 'data', 'present', 'f.json'), '{}')
    mkdirSync(join(dir, 'data', 'empty'), { recursive: true })

    const { wanted, unresolvable } = discover(dir)
    if (!wanted.has('present')) failures.push('did not discover a literal dataPath dataset')
    if (!wanted.has('missing')) failures.push('did not discover a dataset that is absent on disk')
    if (!wanted.has('archive')) failures.push('did not map archivePath() to the archive dataset')
    if (unresolvable.length === 0) failures.push('★ did not REPORT the call built from a variable, so it would report a clean bill over its own blind spot')

    const dataRoot = join(dir, 'data')
    if (inspect(dataRoot, 'present').state !== 'present') failures.push('a supplied dataset must read as present')
    if (inspect(dataRoot, 'missing').state !== 'ABSENT') failures.push('★ an absent dataset must read ABSENT: this is the whole instrument')
    if (inspect(dataRoot, 'empty').state !== 'EMPTY') failures.push('★ a directory that exists and holds nothing must read EMPTY, not present')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (failures.length) {
    console.error('\nDATA REACHABILITY SELF-TEST FAILED.\n')
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('data reachability self-test: PASS. 7 arms, including an absent dataset, an EMPTY one, and a call it cannot resolve being reported rather than dropped.')
  process.exit(0)
}

if (process.argv.includes('--selftest')) selftest()

/* ------------------------------------------------------------------ the live run */

const { root: dataRoot, from } = resolveRoot()
const { wanted, unresolvable } = discover(ROOT)
const rows = [...wanted.keys()].sort().map((d) => ({ ...inspect(dataRoot, d), readers: wanted.get(d) }))

console.log(`data reachability: root ${dataRoot} (${from}) · ${rows.length} dataset(s) read by the code`)
for (const r of rows) {
  const mark = r.state === 'present' ? 'ok  ' : r.state === 'EMPTY' ? 'EMPTY' : 'ABSENT'
  console.log(
    `  ${mark.padEnd(6)} ${r.dataset.padEnd(12)} ${r.entries.toLocaleString().padStart(7)} file(s)  ${(r.bytes / 1e6).toFixed(1).padStart(8)} MB   read from ${[...r.readers][0]}${r.readers.size > 1 ? ` +${r.readers.size - 1}` : ''}`,
  )
}
if (unresolvable.length) {
  const n = unresolvable.reduce((t, u) => t + u.count, 0)
  console.log(`\n  ${n} call(s) in ${unresolvable.length} file(s) build their path from a variable and CANNOT be checked here:`)
  for (const u of unresolvable) console.log(`    ${u.count}x  ${u.file}`)
  console.log('  Reported rather than skipped: an instrument that ignores what it cannot see reports a clean bill over its own blind spot.')
}

const missing = rows.filter((r) => r.state !== 'present')
const requireArg = process.argv.indexOf('--require')
if (requireArg >= 0 && process.argv[requireArg + 1]) {
  const required = process.argv[requireArg + 1].split(',').map((s) => s.trim()).filter(Boolean)
  const bad = required.filter((d) => (rows.find((r) => r.dataset === d)?.state ?? 'ABSENT') !== 'present')
  if (bad.length) {
    console.error(
      `\nDATA REACHABILITY: ${bad.length} REQUIRED dataset(s) are not supplied: ${bad.join(', ')}.\n\n` +
        '  The code reads them and nothing wrote them at this root. This is the shape that shipped a stale\n' +
        '  1.3223 against a true 1.3623 for hours on 2026-08-19: the capture had run and written to a\n' +
        '  different root, and every check that looked only at code passed.\n',
    )
    process.exit(1)
  }
  console.log(`\ndata reachability: all ${required.length} required dataset(s) supplied.`)
  process.exit(0)
}
console.log(missing.length ? `\n  ${missing.length} dataset(s) not supplied at this root. Normal in a fresh checkout; use --require <names> to gate.` : '\n  every dataset the code reads is supplied.')
