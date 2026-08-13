/**
 * Let a plain `node` process run this repo's TypeScript directly.
 *
 * THE TENSION THIS RESOLVES, RECORDED SO NOBODY "FIXES" IT THE WRONG WAY
 *
 * `tsc` rejects an import written as `./csv.ts` (TS5097) unless
 * `allowImportingTsExtensions` is enabled, and that flag is for bundler-only setups while
 * this app really compiles. Node's ESM resolver does the opposite: it requires the full
 * specifier and will not try `./csv.ts` for `./csv`.
 *
 * So the source keeps EXTENSIONLESS imports, which is what the rest of the repo uses and
 * what the compiler wants, and this hook appends the extension at resolution time for the
 * loader processes only. Nothing about the app build changes, and no compiler option is
 * loosened to make an error message go away.
 *
 * Used as: `node --import ./scripts/ingest/ts-resolve.mjs scripts/ingest/<script>.ts`
 */

import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./ts-resolve-hooks.mjs', pathToFileURL(import.meta.filename))
