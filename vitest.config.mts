import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// MEASURED CAUSE (not a guess -- see the corrected comments in the files themselves):
// `rg -l "buildAllDatasets|buildForecastIndex|buildPortfolio|readNsnAwards|buildCompetitorCatalog" test/`
// names exactly these four files. Their builders memoize per module graph, but Vitest's
// default `forks` pool spreads parallel test files across SEPARATE child processes, and
// `isolate: true` (the default) additionally gives every file its own module registry even
// within one worker -- so the memoization never had a chance to share. The same ~15MB of
// source xlsx got parsed up to four times, in four processes contending for the same CPUs.
// rising-price.test.ts alone measured 13.9s / 23.3s / 126s on three consecutive runs of
// byte-identical code -- fork scheduling + CPU contention, not archive growth. A plain tsx
// process runs the whole chain (buildAllDatasets + buildPortfolio + the NSN award index) in
// 4.0s once, cold.
//
// Fix: give these four files their own project with `fileParallelism: false` (pins them to
// one worker) and `isolate: false` (that worker keeps one shared module registry across the
// files instead of a fresh one per file), so the module-level memoization actually fires on
// files 2-4 instead of re-parsing. Every other test file stays on the default project,
// parallel and untouched -- this does NOT serialize the whole suite.
//
// The two projects also need distinct `sequence.groupOrder`: Vitest's own spec grouper
// (`groupSpecs` in cli-api.BK8pd4xc.js) throws if two projects share a groupOrder but
// disagree on `maxWorkers`, which "default" (many workers) and this project (pinned to 1)
// always will. Distinct groupOrder makes the two GROUPS run one after the other -- the ~50
// "default" files still run fully parallel AMONG THEMSELVES inside their own group; only
// these four heavy files, which is what needed serializing, run after them in one batch.
const HEAVY_INTELLIGENCE_TESTS = [
  'test/intelligence/rising-price.test.ts',
  'test/intelligence/datasets.test.ts',
  'test/intelligence/alerts-route.test.ts',
  'test/intelligence/monopoly-view.test.ts',
  // ---------------------------------------------------------------------------------
  // THE SAME DEFECT, A SECOND SCARCE RESOURCE. Found by running the full suite after the
  // xlsx fix above landed: `test/t2-ingest/false-absence.test.ts` failed with
  // `TypeError: Cannot read properties of undefined (reading 'end')` at its afterAll --
  // which is not a query failing, it is `beforeAll` never having assigned the client
  // because the EMBEDDED POSTGRES SERVER NEVER STARTED. Run alone the same file passes 4
  // tests in 449ms.
  //
  // So the read is identical in shape to the xlsx one and different in resource: these two
  // files each boot a real postgres (see test/support/database.ts) and under ~10 parallel
  // workers the start races and loses. Pinning them into this serialized group fixes it for
  // the same reason, with a bonus: `isolate: false` means the two files SHARE one module
  // registry, so they share ONE server instead of booting two.
  //
  // ★ THE TELL, WORTH KEEPING: the error surfaced in `afterAll`, pointing at teardown, while
  // the actual failure was in setup. A cleanup that assumes setup succeeded reports the wrong
  // line and sends the next reader to the wrong file.
  'test/t2-ingest/false-absence.test.ts',
  'test/t2-ingest/data-health-route.test.ts',
  // THE SAME SCARCE RESOURCE AS THE FIRST FOUR, added 2026-08-18 with the surplus rollup. This
  // file calls buildNsnAwardIndex() AND buildAwardeeClassifierFromLive(), which is the same
  // ~15MB xlsx parse the four above share. Left in the default project it would fork its own
  // worker and pay that parse a fifth time, concurrently with them; here it shares their
  // module registry and the parse is already done by the time it runs.
  'test/intelligence/surplus-rollup.test.ts',
  // A THIRD SCARCE RESOURCE, SAME SHAPE AGAIN. `bid-eligibility.test.ts > determines eligibility
  // across the catalogue it now covers` reads the real derived AMSC index off disk — a 70MB
  // binary — and it timed out at 5,000ms in the full suite while passing 10/10 alone. Nothing is
  // wrong with the assertion: it is a heavy real-data test that had been living in the LIGHT
  // project, where it forked its own worker and competed with everything else for the same disk.
  //
  // ★ THE PROJECT BOUNDARY IS SUPPOSED TO MEAN SOMETHING, so the fix is to put the file where it
  // belongs rather than to grant it a private timeout in place. A per-test timeout would have made
  // this one green and left the next real-data test to rediscover the whole thing.
  'test/eligibility/bid-eligibility.test.ts',
]

// The known-bad lint fixtures are deliberately broken source. They are input to the
// lint self-test, never to the type checker or the test runner.
const SHARED_EXCLUDE = ['node_modules/**', 'test/fixtures/**']

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // @T7 addition, additive and surgical, named to @T1 in the claims file.
      // `server-only` THROWS on import outside a React Server Component, so any test that
      // imports a server module (lib/env.ts, lib/log.ts, lib/vault/**) dies at import time
      // rather than running. Resolving it to the package's own `empty.js` (the file its
      // `react-server` export condition already points at) restores that. Scoped to this one
      // specifier deliberately: switching `resolve.conditions` globally would change how
      // react and next resolve for every test, which is a much larger blast radius.
      'server-only': fileURLToPath(
        new URL('./node_modules/server-only/empty.js', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    reporters: ['default'],
    /*
     * Refuse once, before any test file is collected, when the gitignored `data/` root is absent.
     * Without it the dependent tests fail as assertion failures and an absence reads as the code
     * being wrong. See test/global-setup.ts for the measurement that prompted it.
     */
    globalSetup: ['./test/global-setup.ts'],
    // Vitest 4 removed `test.workspace` / `poolOptions.forks.singleFork` in favor of
    // `test.projects` (each project a full sub-config that can override pool behavior).
    // Once `projects` is set, the root-level `test.include` is NOT run as an implicit
    // project, so both projects below are listed explicitly -- confirmed by reading
    // `resolveProjects()` in node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js.
    projects: [
      {
        extends: true,
        test: {
          name: 'default',
          include: ['test/**/*.test.ts'],
          exclude: [...SHARED_EXCLUDE, ...HEAVY_INTELLIGENCE_TESTS],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'intelligence-heavy-shared-parse',
          include: HEAVY_INTELLIGENCE_TESTS,
          exclude: SHARED_EXCLUDE,
          fileParallelism: false,
          isolate: false,
          sequence: { groupOrder: 1 },
          /*
           * THE PROJECT IS CALLED "HEAVY" AND WAS INHERITING A TIMEOUT SIZED FOR UNIT TESTS.
           *
           * `datasets.test.ts > the pill day, the provenance day, the map, the view and the Board
           * all name ONE day` builds the map, the view AND the board over the real corpus in one
           * assertion. Measured:
           *
           *     alone, machine quiet     1,692ms   passes
           *     inside the full suite    6,324ms   TIMED OUT at the inherited 5,000ms default
           *
           * SO IT IS CONTENTION, NOT COST. The same assertion, on the same data, is fine with
           * headroom and fails under parallel load. `bid-eligibility` (10/10) and
           * `engine-authz` (15/15) show the same signature: green alone, red in the suite.
           *
           * ⚠️ THE ASSERTIONS ARE NOT TOUCHED AND MUST NOT BE. "Fails in the suite, passes alone"
           * is the signature of contention over shared state, and the tempting repair — relax
           * what the test checks until it stops complaining — would trade a real invariant for a
           * green tick. This project already runs serially (`fileParallelism: false`) and shares
           * one parse (`isolate: false`); it contends with the OTHER projects, not with itself.
           *
           * 30s is roughly 18x the measured cost, which is deliberate: a timeout set just above
           * the observed number is a timeout that fails again the first time the corpus grows or
           * the machine is busier. It is a guard against a hang, not a performance budget. If one
           * of these ever genuinely takes 30s, that is a real finding and it should fail.
           *
           * I checked my own recent change first rather than assuming it was innocent: the
           * end-of-central-directory read added to `discoverFeedDays` costs 1ms across all 25
           * archived zips, 0.0ms each, and the whole discovery is 48ms cold and 1ms cached.
           * Not the cause.
           */
          testTimeout: 30_000,
        },
      },
    ],
  },
})
