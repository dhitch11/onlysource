/**
 * WHERE THE DATA LIVES, RESOLVED ONCE, AT RUNTIME.
 *
 * Every file this product reads is government feed data or a seed export. None of it is in
 * the repository and none of it ever will be, so no module may hardcode a path to it.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS: github.com/dhitch11/onlysource IS A PUBLIC REPOSITORY
 * ---------------------------------------------------------------------------------------
 * Verified 2026-08-14: an unauthenticated request to the GitHub API for this repository
 * answered 200. Two of the four seed workbooks carry the name, city, state, phone number and
 * email address of 3,471 real companies, and all four together are the entire analytical edge
 * of this product. A commit is world readable forever and deleting it does not recall it.
 *
 * So the data directory is gitignored, the app resolves it at runtime, and deployments ship
 * it out of band as an included file. The consequence to design around is that THE DIRECTORY
 * IS LEGITIMATELY ABSENT in some environments, which is not an error and must never render as
 * a zero. `resolveDataRoot()` reports which candidate it chose and whether it exists, and the
 * surfaces render a stated empty state from that.
 *
 * ---------------------------------------------------------------------------------------
 * RESOLUTION ORDER, MOST EXPLICIT FIRST
 * ---------------------------------------------------------------------------------------
 *   1. ONLYSOURCE_DATA_DIR   an operator said exactly where it is. Always wins.
 *   2. <cwd>/data            the deployed shape. The bundle ships the directory beside the app.
 *   3. /Users/user/onlysource-data  the historical development location, kept so a working
 *                            checkout with no environment set behaves as it did before.
 *
 * A candidate is only chosen if it exists on disk, EXCEPT an explicitly configured one:
 * if an operator sets ONLYSOURCE_DATA_DIR and gets it wrong, the honest outcome is a stated
 * failure naming the path they chose, not a silent fall through to a different dataset. A
 * surface quietly reading yesterday's directory is the failure this ordering exists to prevent.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

export type DataRootResolution = {
  /** The chosen root, whether or not it exists. Always absolute. */
  root: string
  /** Which rule selected it, for display in the operator-facing health surface. */
  basis: 'ONLYSOURCE_DATA_DIR' | 'bundled' | 'development-default'
  /** Measured, not assumed. False means every surface renders its stated empty state. */
  present: boolean
}

/**
 * Resolve the data root. Cheap enough to call per request and deliberately NOT cached:
 * a mounted volume can appear after boot, and a cached absence would outlive it.
 */
export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): DataRootResolution {
  const configured = env.ONLYSOURCE_DATA_DIR?.trim()
  if (configured) {
    // Explicit wins even when wrong. See the note above: a stated failure beats a silent swap.
    return { root: path.resolve(configured), basis: 'ONLYSOURCE_DATA_DIR', present: existsSync(configured) }
  }

  const bundled = path.join(process.cwd(), 'data')
  if (existsSync(bundled)) return { root: bundled, basis: 'bundled', present: true }

  const dev = '/Users/user/onlysource-data'
  return { root: dev, basis: 'development-default', present: existsSync(dev) }
}

/** Join a path relative to the data root. Does not check existence: callers report absence. */
export function dataPath(...segments: string[]): string {
  return path.join(resolveDataRoot().root, ...segments)
}

/**
 * The archive subtree, which mirrors the retrieval structure exactly.
 *
 * The shape is part of the provenance record: a surface cites
 * `dibbs-rfq-daily/<day>/<capture>/<file>` and that string has to resolve to the artifact it
 * names. Flattening the tree for convenience would break the only link between a rendered
 * number and the file it was counted from.
 */
export function archivePath(...segments: string[]): string {
  return dataPath('archive', ...segments)
}

/** The seed workbook subtree. Exports, not government feed files, kept separate for that reason. */
export function seedPath(...segments: string[]): string {
  return dataPath('seed', ...segments)
}
