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
 *
 * =====================================================================================
 * ★ THE SEEDS THEMSELVES MUST BE PROVEN, BECAUSE THREE OF THEM WERE ZERO FOR WEEKS
 * =====================================================================================
 * MEASURED DEFECT, found 2026-08-18 by a peer lane and proven by construction before it was
 * proven by execution. The seed line read:
 *
 *     ALL.filter(f => f.startsWith('app/') && NEXT_ENTRY.test(...))
 *       .concat(ALL.filter(f => /^(proxy|middleware|instrumentation)\.(tsx?|jsx?)$/.test(f)))
 *
 * `ALL` was built only from `app/ components/ lib/ scripts/ test/`, so EVERY element carries
 * one of those prefixes, and the second filter is anchored `^...$` against the whole relative
 * path. It could never match anything. **Three route entrypoints that looked like three and
 * were zero**, in the one instrument every lane was quoting orphan counts from.
 *
 * It read as maintained, which is why it survived: the regex still names `middleware`, and
 * Next 16 renamed that file to `proxy.ts`. A pattern listing a filename that no longer exists
 * looks like history, not like a bug.
 *
 * THE DEFECT HAD A DIRECTION AND IT IS THE DANGEROUS ONE. A missing seed can only
 * UNDER-report reachability. It cannot hide a real orphan; it can only MANUFACTURE a false
 * one. Measured on this repo at 02680c6 the day it was found, the fix moved zero files:
 * `proxy.ts` imports only `lib/session/pre-release-gate` and `lib/time/clock`, both already
 * route-reachable through the pages. So the cost was not in the past. It is the next module
 * imported only from `proxy.ts`, which this gate would have reported as a NEW ORPHAN and
 * failed the build over, and which `--update-baseline` would then have banked as accepted
 * permanent debt WHILE IT RAN ON EVERY REQUEST. That is worse than a missed orphan, because
 * a gate that cries wolf gets switched off, and this file already argues that at length.
 *
 * Hence `--selftest`, in the shape `lint-gates.mjs` set: **a gate that cannot fail is not a
 * gate, it is a comment.** It builds a synthetic repo in the OS temp dir, never in this tree,
 * whose only path to one module runs through a root-level `proxy.ts`, and asserts that module
 * is route-reachable. That assertion FAILS against the code as it stood before this comment
 * was written, which is the whole point of a positive control. It runs before the census in
 * CI, for the same reason the lint self-test runs before the lints.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, relative, dirname, resolve, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const BASELINE = join(ROOT, '.reachability-baseline.json')
const CODE_EXT = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx']
const SKIP_DIR = new Set(['node_modules', '.next', '.git', '.probe', 'data', 'public'])

/**
 * The directories walked into the graph.
 *
 * `db/` is here so that an edge out of a migration or a seeder is visible to the walk. It is
 * deliberately NOT in SUBJECT below: `db/seed.ts` is reached only by `test/r2-isolation/`,
 * and judging it would manufacture exactly one orphan that has to be banked immediately,
 * which accretes the baseline for no gain. If it should be judged, the honest remedy is a
 * `db:seed` entry in package.json, which makes it script-reachable and TRUE rather than
 * accepted. Recorded here so the next lane does not "fix" it into the baseline.
 */
const WALK_ROOTS = ['app', 'components', 'lib', 'scripts', 'test', 'db']

/** Next.js treats these filenames as entrypoints; nothing needs to import them. */
const NEXT_ENTRY = /^(page|layout|route|error|loading|not-found|template|default|global-error)\.(tsx?|jsx?)$/

/**
 * Root-level framework entrypoints. The framework calls these; no source file imports them,
 * so without seeding them everything below them looks unreachable.
 *
 * `proxy` is Next 16's rename of `middleware`. Both are listed because a repo mid-upgrade can
 * carry either, and a seed regex that silently matches neither is the defect above.
 */
const ROOT_ENTRY = /^(proxy|middleware|instrumentation|instrumentation-client)\.(tsx?|jsx?)$/

function walk(root, dir, out = []) {
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
    if (st.isDirectory()) walk(root, full, out)
    else if (CODE_EXT.includes(extname(name))) out.push(relative(root, full))
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
function resolveSpecifier(root, spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = join(root, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(root, dirname(fromFile), spec)
  else return null // a package, not our source

  const candidates = [
    base,
    ...CODE_EXT.map((e) => base + e),
    ...CODE_EXT.map((e) => join(base, 'index' + e)),
  ]
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return relative(root, c)
    } catch {
      /* keep looking */
    }
  }
  return null
}

/* ------------------------------------------------------------------ the census */

/**
 * The whole measurement, over an arbitrary root.
 *
 * Parameterised on `root` for one reason: the self-test drives this exact code over a
 * synthetic repo. An instrument that can only be pointed at its own repository can only be
 * checked by reading it, and this file is the record of what reading it missed.
 */
function census(root) {
  const rootEntries = (() => {
    let names
    try {
      names = readdirSync(root)
    } catch {
      return []
    }
    return names.filter((n) => {
      if (!ROOT_ENTRY.test(n)) return false
      try {
        return statSync(join(root, n)).isFile()
      } catch {
        return false
      }
    })
  })()

  const ALL = [...WALK_ROOTS.flatMap((d) => walk(root, join(root, d))), ...rootEntries]

  const EDGES = new Map()
  for (const f of ALL) {
    let src
    try {
      src = readFileSync(join(root, f), 'utf8')
    } catch {
      continue
    }
    EDGES.set(
      f,
      importsOf(src)
        .map((s) => resolveSpecifier(root, s, f))
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

  /* ---------------------------------------------------------------- the seeds */

  const pageSeeds = ALL.filter((f) => f.startsWith('app/') && NEXT_ENTRY.test(f.split('/').pop()))
  // Matched against the whole relative path, which for a root-level file IS the filename.
  // The predecessor filtered a list that could not contain one. See the header.
  const rootEntrySeeds = ALL.filter((f) => ROOT_ENTRY.test(f))
  const routeSeeds = [...new Set([...pageSeeds, ...rootEntrySeeds])]

  // A Set, not a list. One file named by three package scripts is ONE entrypoint, and a
  // seed count that reports it as three is a small lie in the line every lane reads first.
  const scriptSeedSet = new Set()
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const cmd of Object.values(pkg.scripts ?? {})) {
      for (const m of String(cmd).matchAll(/[\w./-]+\.(mts|mjs|ts|js)/g)) {
        if (existsSync(join(root, m[0]))) scriptSeedSet.add(m[0])
      }
    }
  } catch {
    /* no package.json: no script seeds */
  }
  const scriptSeeds = [...scriptSeedSet]
  const testSeeds = ALL.filter((f) => f.startsWith('test/'))

  const byRoute = reachFrom(routeSeeds)
  const byScript = reachFrom(scriptSeeds)
  const byTest = reachFrom(testSeeds)

  /* ---------------------------------------------------------------- classify */

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

  const classOf = (f) =>
    cls.route.includes(f) ? 'route' : cls.script.includes(f) ? 'script' : cls.test.includes(f) ? 'test' : cls.none.includes(f) ? 'none' : 'not-a-subject'

  return { ALL, SUBJECT, cls, classOf, routeSeeds, pageSeeds, rootEntrySeeds, scriptSeeds, testSeeds, rootEntries }
}

/* ------------------------------------------------------------------ the self-test */

/**
 * A synthetic repo whose ONLY path to `lib/proxy-only.ts` runs through a root-level
 * `proxy.ts`. Built in the OS temp dir, never in this tree, and removed afterwards.
 *
 * Every rung of the classification gets a fixture, not just the one that regressed: a
 * control that checks a single arm passes for the wrong reason as soon as the arms stop
 * being mutually exclusive.
 */
function buildFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'reachability-selftest-'))
  const write = (rel, body) => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  write('package.json', JSON.stringify({ scripts: { ingest: 'node scripts/only-script.mjs' } }))
  write('proxy.ts', "import { guard } from './lib/proxy-only'\nexport default guard\n")
  write('app/page.tsx', "import { used } from '@/lib/used'\nexport default function P() { return used }\n")
  write('lib/used.ts', 'export const used = 1\n')
  write('lib/proxy-only.ts', 'export const guard = 1\n')
  write('lib/unused.ts', 'export const unused = 1\n')
  write('lib/script-only.ts', 'export const s = 1\n')
  write('lib/test-only.ts', 'export const t = 1\n')
  write('scripts/only-script.mjs', "import { s } from '../lib/script-only'\nexport default s\n")
  write('test/a.test.ts', "import { t } from '@/lib/test-only'\nexport default t\n")
  return dir
}

function selftest() {
  const failures = []
  const dir = buildFixture()
  try {
    const r = census(dir)

    // The regression itself. This assertion fails against the seed line this file replaced.
    const expected = {
      'lib/used.ts': 'route',
      'lib/proxy-only.ts': 'route',
      'lib/script-only.ts': 'script',
      'lib/test-only.ts': 'test',
      'lib/unused.ts': 'none',
    }
    for (const [file, want] of Object.entries(expected)) {
      const got = r.classOf(file)
      if (got !== want) failures.push(`${file}: expected ${want}, got ${got}`)
    }

    // A seed category that silently empties is the failure shape, so name each one.
    if (r.pageSeeds.length === 0) failures.push('fixture produced 0 page seeds')
    if (r.rootEntrySeeds.length === 0) failures.push('fixture produced 0 root-entry seeds (the exact 2026-08-18 defect)')
    if (r.scriptSeeds.length === 0) failures.push('fixture produced 0 script seeds')
    if (r.testSeeds.length === 0) failures.push('fixture produced 0 test seeds')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // And the same question asked of THIS repo, which is the one that ships: every root-level
  // framework entrypoint on disk must actually be in the seed set. Proving the fixture works
  // says nothing about whether the real tree is being seeded.
  const live = census(ROOT)
  for (const f of live.rootEntries) {
    if (!live.rootEntrySeeds.includes(f)) failures.push(`${f} exists at the repo root and is NOT seeded`)
  }
  if (live.pageSeeds.length === 0) failures.push('this repo produced 0 page seeds')

  if (failures.length) {
    console.error('\nREACHABILITY SELF-TEST FAILED. The census cannot be trusted until this passes.\n')
    for (const f of failures) console.error(`  ${f}`)
    console.error(
      '\n  A gate that cannot fail is not a gate, it is a comment. These fixtures exist so a\n' +
        '  seed category cannot silently regress to zero the way the root entrypoints did.\n',
    )
    process.exit(1)
  }
  console.log(
    `reachability self-test: PASS. ${live.rootEntries.length} root entrypoint(s) seeded ` +
      `(${live.rootEntries.join(', ') || 'none on disk'}); all four classification arms proven on a synthetic repo.`,
  )
  process.exit(0)
}

if (process.argv.includes('--selftest')) selftest()

/* ------------------------------------------------------------------ the live run */

const { SUBJECT, cls, routeSeeds, scriptSeeds } = census(ROOT)

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
