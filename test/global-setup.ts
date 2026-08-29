/**
 * REFUSE ONCE, BEFORE ANY ASSERTION, WHEN THE DATA ROOT IS ABSENT.
 *
 * =========================================================================================
 * WHY THIS EXISTS
 * =========================================================================================
 * Most of this suite reads the government feed files under `data/`, which is GITIGNORED. On a
 * fresh clone, a CI runner, or a detached worktree, that directory does not exist and the tests
 * that depend on it do not say so. They fail as ASSERTION FAILURES: expected 5,488, received 0.
 *
 * MEASURED 2026-08-19: a clean checkout of `origin/main` in a worktree with no `data/` produced
 * SIX failures across FIVE files, every one of them phrased as though the code were wrong. The
 * lane that saw them was one step from telling every other lane that main was red. The same
 * checkout with `data/` present runs 123 files, 2,368 tests, 0 failed.
 *
 * ★ THAT IS THIS ESTATE'S DOMINANT DEFECT CLASS, POINTED AT ITSELF: AN ABSENCE PRESENTING AS A
 * WRONG ANSWER. The product has shipped it nine times in other forms, and the test suite has been
 * doing it to us all along.
 *
 * =========================================================================================
 * WHAT IT DOES, AND THE TWO PROPERTIES THAT MAKE IT WORTH HAVING
 * =========================================================================================
 * 1. IT FAILS ONCE AND EARLY. A `globalSetup` runs before any test file is collected, so the
 *    reader gets one refusal instead of six red assertions to triage. Six lies become one fact.
 * 2. IT NAMES THE PATH, NOT THE CONDITION. "The data root is missing" sends somebody hunting.
 *    Naming the exact directory that was looked for, and how it was chosen, sends them to the fix.
 *
 * It does NOT try to guess whether the current run happens to need data. A suite whose results are
 * meaningless without the feed should say so plainly rather than pass 117 files and quietly
 * mis-report six.
 */
import { resolveDataRoot } from '@/lib/data-root'

export default function setup(): void {
  const root = resolveDataRoot()

  /*
   * ★ A PRESENT ROOT REACHED BY THE DEVELOPMENT DEFAULT IS A SILENT SUBSTITUTION, AND IT NEARLY
   * COST ME THE POSITIVE CONTROL FOR THIS VERY GUARD.
   *
   * `resolveDataRoot` falls back to a hardcoded developer path when `<cwd>/data` is absent. On a
   * machine where BOTH exist, deleting the repo's own `data/` does not fail: the suite quietly
   * reads a DIFFERENT corpus and reports confidently on it. I found this by moving `data/` aside
   * to watch this guard refuse, and it did not refuse, because the fallback caught it.
   *
   * It is not made an error here, because a developer legitimately running against that root
   * should not be blocked. It is STATED, every run, naming the path, so a surprising result is
   * traceable to the corpus it was actually computed from rather than the one in the checkout.
   */
  if (root.present && root.basis === 'development-default') {
    console.warn(
      `\n[data root] Reading ${root.root} via the development default, NOT this checkout's ` +
        "own data/. If a number here surprises you, it was computed from that corpus.\n",
    )
  }

  if (root.present) return

  /*
   * ==========================================================================================
   * ★ CI IS THE ONE PLACE WHERE AN ABSENT CORPUS IS NORMAL, AND REFUSING THERE COST A WEEK.
   * ==========================================================================================
   * This guard is right on a developer machine: absent data/ means a broken working copy, and
   * failing once beats six lying assertions. It was WRONG on GitHub Actions, where data/ is
   * gitignored, 1.4GB, and legitimately never present.
   *
   * The result: the `gate` workflow threw here before collecting a single test, on EVERY push to
   * every branch, for about a week. Hundreds of "All jobs have failed" emails to the owner, none
   * of which described a real defect. The failure took 34 seconds and looked like a broken build;
   * it was a runner correctly not having a 1.4GB directory.
   *
   * ★★ AND THE IRONY IS THE LESSON. This file's own header calls an absence presenting as a wrong
   * answer "this estate's dominant defect class, pointed at itself". It then did exactly that one
   * level up: the ABSENCE of a corpus presented as a FAILING BUILD. A guard against
   * misread-absence has to say which absence it is looking at.
   *
   * So on CI it states the fact and continues. The corpus-dependent suites skip themselves via
   * `test/support/corpus.ts` and are REPORTED as skipped with a count, never as passes, and
   * everything that does not need the feed — types, lints, the engines, the pure logic, roughly
   * 2,500 tests — still runs and can still fail the build honestly.
   */
  if (process.env.CI) {
    console.warn(
      [
        '',
        '[data root] ABSENT, and this is CI, so the run continues.',
        `  looked for: ${root.root}`,
        '  data/ is gitignored and 1.4GB; a runner is not expected to have it.',
        '  Corpus-dependent suites SKIP and are reported as skipped. Everything else runs.',
        '  The corpus is verified on the deploy box instead, by `npm run gate:data:require`.',
        '',
      ].join('\n'),
    )
    return
  }

  const how =
    root.basis === 'ONLYSOURCE_DATA_DIR'
      ? 'ONLYSOURCE_DATA_DIR is set and points there'
      : root.basis === 'bundled'
        ? 'it was resolved as <cwd>/data'
        : 'ONLYSOURCE_DATA_DIR is unset and <cwd>/data does not exist, so the development default was used'

  throw new Error(
    [
      '',
      'THE DATA ROOT IS ABSENT, SO THIS RUN WAS STOPPED BEFORE ANY TEST EXECUTED.',
      '',
      `  looked for : ${root.root}`,
      `  because    : ${how}`,
      '',
      'Most of this suite reads the government feed files under that directory, and `data/` is',
      'gitignored, so a fresh clone or a detached worktree does not have it. Without this check',
      'the dependent tests fail as ordinary assertion failures (expected 5,488, received 0), which',
      'reads as the code being wrong rather than the data being missing. That has already cost one',
      'lane a false "main is red".',
      '',
      'To fix: point ONLYSOURCE_DATA_DIR at a populated data root, or run from a checkout that has',
      'one. In a git worktree, symlink it:  ln -s /path/to/onlysource-build/data ./data',
      '',
    ].join('\n'),
  )
}
