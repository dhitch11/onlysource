#!/usr/bin/env node
/**
 * THE REACHABILITY CENSUS — a build-failing answer to "does anything actually reach this?"
 *
 * =====================================================================================
 * WHY THIS IS A GATE AND NOT A REPORT
 * =====================================================================================
 * A 12-agent audit of this repo produced 424 findings over about four hours. Classified:
 *
 *     BUILT_NOT_WIRED        149  (45.6%)   code exists, is correct, reaches no operator
 *     WIRED_BUT_INCOMPLETE   143  (43.7%)
 *     NOT_BUILT                6  (1.8%)    and all six named the missing CI gate scripts
 *
 * The product was not missing features. It was missing CONNECTIONS. And 149 of those
 * findings — 35% of the entire audit — implicate 77 files this script identifies in about a
 * second, with no agent, no corpus and no judgement. `lib/engine/` alone held ~5,578 lines
 * reachable only from its own tests, every test passing: THE SUITE PROVED THE CODE WAS
 * CORRECT AND PROVED NOTHING ABOUT WHETHER IT RAN.
 *
 * =====================================================================================
 * REACHABILITY IS A GRAPH PROPERTY. CHECKING ONE EDGE IS A SAMPLE, NOT A MEASUREMENT.
 * =====================================================================================
 * This was learned the expensive way. `lib/intelligence/shelf.ts` imports
 * `@/lib/engine/pricing`, and that single edge was reported as proof that the pricing engine
 * was live. It was not: `shelf.ts` IS ITSELF UNREACHABLE, so the engine had ZERO
 * route-reachable paths, not one. **An import chain that starts in an orphan proves nothing.**
 * Hence a transitive walk from real entrypoints, every time.
 *
 * =====================================================================================
 * THREE-WAY CLASSIFICATION, BECAUSE A BINARY ONE WOULD LIE
 * =====================================================================================
 * `lib/connectors/dibbs/consent.ts`, `lib/egress/*` and `lib/ingest/parse/*` are reached by
 * SCRIPTS (the capture cron), not by routes, and that is correct — they are supposed to be
 * script-only. A binary reachable/unreachable gate would flag them forever, someone would
 * add an exception, and the exception would eventually hide a real orphan. So:
 *
 *     route     reachable from an app entrypoint  — serves an operator
 *     script    reachable only from a package.json script — correct for ingest/egress
 *     test      reachable only from test/ — the built-and-never-wired signature
 *     none      reached by nothing at all — dead
 *
 * =====================================================================================
 * IT IS A RATCHET, NOT A WALL
 * =====================================================================================
 * 77 files are unreachable today. A gate that fails on all of them gets switched off within
 * a day, and a switched-off gate is worse than none. So the baseline is recorded and the
 * gate fails only when a NEW orphan appears — the debt is visible, and it cannot grow.
 * Fixing one and forgetting to shrink the baseline is not an error; the run says so and
 * `--update-baseline` records it.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, dirname, resolve, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const BASELINE = join(ROOT, '.reachability-baseline.json')
const CODE_EXT = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx']
const SKIP_DIR = new Set(['node_modules', '.next', '.git', '.probe', 'data', 'public'])

/** Next.js treats these filenames as entrypoints; nothing needs to import them. */
const NEXT_ENTRY = /^(page|layout|route|error|loading|not-found|template|default|global-error)\.(tsx?|jsx?)$/

function walk(dir, out = []) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (SKIP_DIR.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (CODE_EXT.includes(extname(name))) out.push(relative(ROOT, full))
  }
  return out
}

/**
 * Import specifiers in a source file.
 *
 * Deliberately regex rather than the compiler API: this must run on every commit in a
 * second, and it needs no type information to answer "what does this file pull in". It
 * catches static imports, re-exports, bare side-effect imports and dynamic `import()`.
 * What it cannot see is a module named by a runtime-computed string — noted here rather
 * than left for someone to discover, because a limitation you have written down is a
 * caveat and one you have not is a bug.
 */
function importsOf(src) {
  const out = new Set()
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) for (const m of src.matchAll(re)) out.add(m[1])
  return [...out]
}

/** Resolve a specifier to a repo-relative file, or null if it is external. */
function resolveSpecifier(spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(ROOT, dirname(fromFile), spec)
  else return null // a package, not our source

  const candidates = [
    base,
    ...CODE_EXT.map((e) => base + e),
    ...CODE_EXT.map((e) => join(base, 'index' + e)),
  ]
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return relative(ROOT, c)
    } catch {
      /* keep looking */
    }
  }
  return null
}

/* ------------------------------------------------------------------ the graph */

const ALL = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'scripts')), ...walk(join(ROOT, 'test'))]

const EDGES = new Map()
for (const f of ALL) {
  let src
  try {
    src = readFileSync(join(ROOT, f), 'utf8')
  } catch {
    continue
  }
  EDGES.set(
    f,
    importsOf(src)
      .map((s) => resolveSpecifier(s, f))
      .filter(Boolean),
  )
}

function reachFrom(seeds) {
  const seen = new Set()
  const stack = [...seeds]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    for (const next of EDGES.get(f) ?? []) if (!seen.has(next)) stack.push(next)
  }
  return seen
}

/* ------------------------------------------------------------------ the seeds */

const routeSeeds = ALL.filter(
  (f) => f.startsWith('app/') && NEXT_ENTRY.test(f.split('/').pop()),
).concat(ALL.filter((f) => /^(proxy|middleware|instrumentation)\.(tsx?|jsx?)$/.test(f)))

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const scriptSeeds = []
for (const cmd of Object.values(pkg.scripts ?? {})) {
  for (const m of String(cmd).matchAll(/[\w./-]+\.(mts|mjs|ts|js)/g)) {
    if (existsSync(join(ROOT, m[0]))) scriptSeeds.push(m[0])
  }
}
const testSeeds = ALL.filter((f) => f.startsWith('test/'))

const byRoute = reachFrom(routeSeeds)
const byScript = reachFrom(scriptSeeds)
const byTest = reachFrom(testSeeds)

/* ------------------------------------------------------------------ classify */

/** Only product source is judged. Tests and scripts are the instruments, not the subject. */
const SUBJECT = ALL.filter(
  (f) => (f.startsWith('lib/') || f.startsWith('components/') || f.startsWith('app/')) && !f.startsWith('test/'),
)

const cls = { route: [], script: [], test: [], none: [] }
for (const f of SUBJECT) {
  if (byRoute.has(f)) cls.route.push(f)
  else if (byScript.has(f)) cls.script.push(f)
  else if (byTest.has(f)) cls.test.push(f)
  else cls.none.push(f)
}

/**
 * ★ UNTRACKED FILES ARE IN FLIGHT AND ARE NEVER BASELINED.
 *
 * MEASURED DEFECT IN THE FIRST VERSION OF THIS FILE, caught by a peer lane before it could
 * do damage. The baseline was recorded while two agents were mid-build, and it swallowed
 * `lib/intelligence/feed-window.ts` (765 lines) and `lib/engine/firewall/known-bad.ts` —
 * both untracked, both unfinished, and both certain to need wiring. Baselining them meant
 * **the two files most guaranteed to be orphans were the two the gate would never mention
 * again.** A ratchet that absorbs work-in-progress as permanent accepted debt is worse than
 * no ratchet, because it launders the exact thing it exists to surface.
 *
 * So untracked files are reported separately as IN FLIGHT, never written to the baseline,
 * and never counted as accepted. In CI this is a no-op — a fresh checkout has no untracked
 * files — which is the point: **the moment such a file is committed it must be either wired
 * or explicitly baselined with a reason.** It cannot slip in while nobody is looking.
 */
function untrackedFiles() {
  try {
    return new Set(
      execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: ROOT,
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean),
    )
  } catch {
    return new Set() // not a git repo: treat everything as tracked
  }
}

const UNTRACKED = untrackedFiles()
const allOrphans = [...cls.test, ...cls.none].sort()
const inFlight = allOrphans.filter((f) => UNTRACKED.has(f))
const orphans = allOrphans.filter((f) => !UNTRACKED.has(f))

function lines(f) {
  try {
    return readFileSync(join(ROOT, f), 'utf8').split('\n').length
  } catch {
    return 0
  }
}

const orphanLines = orphans.reduce((t, f) => t + lines(f), 0)

console.log(`reachability census: ${SUBJECT.length} product files, ${routeSeeds.length} route entrypoints, ${scriptSeeds.length} script entrypoints.`)
console.log(`  route-reachable        ${String(cls.route.length).padStart(4)}   serves an operator`)
console.log(`  script-reachable only  ${String(cls.script.length).padStart(4)}   correct for ingest/egress`)
console.log(`  TEST-reachable only    ${String(cls.test.length).padStart(4)}   built, correct, wired to nobody`)
console.log(`  reached by NOTHING     ${String(cls.none.length).padStart(4)}   dead`)
console.log(`  orphan total           ${String(orphans.length).padStart(4)}   (${orphanLines.toLocaleString()} lines, tracked only)`)
if (inFlight.length) {
  console.log(
    `  IN FLIGHT (untracked)  ${String(inFlight.length).padStart(4)}   never baselined; must be wired or explicitly accepted before commit`,
  )
  for (const f of inFlight) console.log(`      ${String(lines(f)).padStart(5)}  ${f}`)
}

if (process.argv.includes('--list')) {
  console.log('\nORPHANS, largest first:')
  for (const f of orphans.slice().sort((a, b) => lines(b) - lines(a)).slice(0, 40)) {
    console.log(`  ${String(lines(f)).padStart(5)}  ${cls.test.includes(f) ? 'test-only' : 'dead     '}  ${f}`)
  }
}

/* ------------------------------------------------------------------ the ratchet */

if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE, JSON.stringify({ orphans, recordedLines: orphanLines }, null, 2) + '\n')
  console.log(`\nbaseline updated: ${orphans.length} orphans recorded.`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.log('\nno baseline recorded yet. Run with --update-baseline to record the current debt.')
  process.exit(0)
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
const known = new Set(base.orphans ?? [])
const added = orphans.filter((f) => !known.has(f))
const fixed = [...known].filter((f) => !orphans.includes(f))

if (fixed.length) {
  // Split, because "wired" and "no longer counted" are different facts and reporting the
  // second as the first is the kind of small lie that makes an instrument untrustworthy.
  const wired = fixed.filter((f) => !UNTRACKED.has(f))
  const reclassified = fixed.filter((f) => UNTRACKED.has(f))
  if (wired.length) {
    console.log(`\n${wired.length} orphan(s) WIRED since the baseline — run --update-baseline to bank it:`)
    for (const f of wired) console.log(`  + ${f}`)
  }
  if (reclassified.length) {
    console.log(
      `\n${reclassified.length} baseline entr${reclassified.length === 1 ? 'y is' : 'ies are'} now IN FLIGHT (untracked), not wired.` +
        ` They were baselined in error while mid-build and are excluded now:`,
    )
    for (const f of reclassified) console.log(`  ~ ${f}`)
  }
}

if (added.length === 0) {
  console.log('\nreachability: no new orphans.')
  process.exit(0)
}

console.error(`\nREACHABILITY: ${added.length} NEW ORPHAN(S). Code was added that nothing reaches.\n`)
for (const f of added) {
  console.error(`  ${String(lines(f)).padStart(5)} lines  ${cls.test.includes(f) ? 'reachable ONLY from tests' : 'reached by NOTHING'}  ${f}`)
}
console.error(
  '\n  This is the repo\'s dominant failure mode: 149 of 424 audit findings were built-and-\n' +
    '  not-wired. If the file is genuinely script-only, add its script to package.json so the\n' +
    '  census can see it. If it is real product code, wire it to a route. If it is deliberate\n' +
    '  future work, run --update-baseline and say so in the commit.\n',
)
process.exit(1)
