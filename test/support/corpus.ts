import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDataRoot } from '@/lib/data-root'

/**
 * THE ONE GUARD FOR "THIS TEST NEEDS THE GOVERNMENT CORPUS".
 *
 * ==========================================================================================
 * WHY CI HAS BEEN RED, AND EMAILING THE OWNER, FOR A WEEK.
 * ==========================================================================================
 * `data/` is gitignored and 1.4GB, so a fresh GitHub checkout does not have it. Nine test files
 * read it directly and died on `readFileSync`, which failed the `gate` workflow on EVERY push to
 * every branch. Hundreds of "All jobs have failed" emails, none of which described a real defect
 * in the product: the code was fine and the runner simply had no corpus.
 *
 * The workflow file already understood this for one step — its own comment says "a fresh checkout
 * has no data/ (gitignored, 1.4GB), so the live run belongs to the deploy" — and that reasoning
 * was applied to `gate:data` and never to `npm test`.
 *
 * ★ FIVE OF THE NINE WERE ADDED BY ME on 2026-08-19, testing real behaviour against the real
 * corpus, which is the right instinct and the reason this helper exists rather than a rule
 * saying "do not read the corpus in tests". The corpus tests are the valuable ones.
 *
 * ==========================================================================================
 * A SKIP IS A CLAIM, SO IT IS MADE OUT LOUD.
 * ==========================================================================================
 * The failure mode this must not create is the one this codebase keeps paying for: a check that
 * quietly passes when it did not run. So:
 *
 *   - the skip is `describe.skipIf`, which vitest REPORTS as skipped with a count, never as a pass
 *   - the suite name carries the reason, so the reader sees WHY in the run output
 *   - `hasCorpus` is exported for the rare file that must branch inside a test rather than skip
 *   - locally the corpus is present, so every one of these still runs on the machine that ships
 *
 * What CI verifies without the corpus: types, lints, secrets, reachability, the self-tests, the
 * build, and ~2,370 tests of pure logic. What it cannot verify is anything that depends on the
 * 1.4GB of government files, and it now says so instead of dying.
 */

/**
 * The corpus root, resolved BY THE APP'S OWN RESOLVER rather than re-derived here.
 *
 * ★ MY FIRST VERSION READ `ONLYSOURCE_DATA_ROOT`. The variable is `ONLYSOURCE_DATA_DIR`, and
 * `lib/data-root.ts` also falls back to a historical development path. A guard that invents its
 * own idea of where the data lives is a guard that disagrees with the app about whether the data
 * is there — which is exactly the state that produced the CI failures it is meant to prevent.
 */
const resolved = resolveDataRoot()
const DATA_ROOT = resolved.root

/**
 * Is the real government corpus on this machine?
 *
 * Probes a FILE, not the directory. An empty `data/` directory exists on more machines than a
 * populated one — a stray mkdir, a partial rsync, a Docker volume mount that never filled — and
 * a directory check would call all of those "present" and put the crash back.
 */
export const hasCorpus: boolean =
  resolved.present &&
  (existsSync(join(DATA_ROOT, 'nsn-now', 'full_1.xlsx')) ||
    existsSync(join(DATA_ROOT, 'seed')) ||
    existsSync(join(DATA_ROOT, 'suppliers', 'distressed-contacts.csv')))

/** Suffix for a suite name, so the run output says why something was skipped. */
export const CORPUS_NOTE = hasCorpus
  ? ''
  : ' [SKIPPED: no local government corpus — data/ is gitignored and 1.4GB, see test/support/corpus.ts]'

/**
 * ==========================================================================================
 * ⛔ THE SUITE-NAME SUFFIX ABOVE IS INVISIBLE ON A DEFAULT RUN. MEASURED 2026-08-24.
 * ==========================================================================================
 * `CORPUS_NOTE` is appended to a `describe` name, and vitest renders suite names only under
 * `--reporter=verbose`. On `npx vitest run` a skipped file is a bare down-arrow and a count:
 *
 *     ↓ |default| test/board/board-lifecycle.test.ts (8 tests | 8 skipped)
 *     ↓ |default| test/filing/source.test.ts         (9 tests | 9 skipped)
 *       Tests  8 passed | 18 skipped (26)
 *
 * Eighteen assertions did not run and NOT ONE WORD said why. The header above promises "the
 * suite name carries the reason, so the reader sees WHY in the run output". That is true of
 * `--reporter=verbose` and false of the command everyone actually types.
 *
 * ==========================================================================================
 * AND THERE IS EXACTLY ONE STATE NOTHING ELSE ANNOUNCES, WHICH IS THE DANGEROUS ONE
 * ==========================================================================================
 * `test/global-setup.ts` already covers an ABSENT data root, loudly and well: it throws locally
 * with the path and the cure, and on CI it states the fact and continues. Neither needs help.
 *
 * The gap is the state BETWEEN those two. `global-setup` gates on `resolveDataRoot().present`,
 * which is true for a directory that merely EXISTS. `hasCorpus` is stricter and probes for a
 * file. So a data root that is present but EMPTY OR PARTIAL — a stray `mkdir`, a half-finished
 * rsync, a Docker volume that never filled, an `ONLYSOURCE_DATA_DIR` pointed one level wrong —
 * passes `global-setup` in silence and then skips roughly twenty suites in silence.
 *
 * ★ THAT IS THIS ESTATE'S DOMINANT DEFECT CLASS WEARING ITS FRIENDLIEST FACE. Not a failure
 * that reads as a wrong answer, but an ABSENCE THAT READS AS A PASS. `global-setup.ts` says its
 * own version of this: "a guard against misread-absence has to say which absence it is looking
 * at." This is the absence it was not looking at.
 *
 * So the reason also goes to stderr, where every reporter shows it. Announced ONLY for the
 * present-but-incomplete case, because duplicating a guard that already speaks is noise, and
 * noise is how a real warning gets scrolled past.
 *
 * ⛔ VERIFY BY RUNNING IT, NOT BY READING IT. This whole comment exists because a suffix that
 * looked correct in the source printed nothing in practice. If you change this, point
 * `ONLYSOURCE_DATA_DIR` at an empty directory and confirm the text APPEARS in the DEFAULT
 * reporter. A message you have not watched print is a message you have not written.
 */
/*
 * ★ IT REPEATS ONCE PER SKIPPING FILE, DELIBERATELY, AND THE MESSAGE IS SHORT BECAUSE OF IT.
 *
 * A first version printed eight lines behind a `globalThis` flag meant to fire once. MEASURED:
 * it printed three times for three files. Vitest runs each test file in its own module registry
 * and its own global context under `isolate: true`, so a module-scope flag cannot dedupe across
 * files, and workers are separate processes so nothing in memory can.
 *
 * Rather than fight that, use it. Vitest attaches stderr to the file that emitted it, so one
 * short line per skipping file LABELS EACH SKIP AT THE POINT IT HAPPENS, which beats a single
 * banner at the top of a long run that scrolls away unread. The cost of that choice is length,
 * so the detail lives in the comment above and the runtime message stays at two lines.
 */
if (!hasCorpus && resolved.present) {
  // eslint-disable-next-line no-console
  console.warn(
    `[corpus] SKIPPING: the data root exists but holds no corpus, so these are not passes. ` +
      `Looked in ${DATA_ROOT} (chosen by ${resolved.basis}), probed for nsn-now/full_1.xlsx, ` +
      `seed/, suppliers/distressed-contacts.csv. Point ONLYSOURCE_DATA_DIR at a populated root.`,
  )
}
