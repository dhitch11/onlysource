import 'server-only'
import { execSync } from 'node:child_process'
import { env } from '@/lib/env'
import { log } from '@/lib/log'

/**
 * THE RUNNING COMMIT, RESOLVED HONESTLY.
 *
 * The audit that forced this file: the live site reported `build 1a821be` in its chrome and
 * on /api/health while visibly serving code from 52 commits later. GIT_COMMIT_SHA is written
 * into the systemd unit by the deploy runbook, and a stamp written once and never refreshed
 * is a claim that goes stale silently; anyone using it to diagnose a live incident is
 * debugging the wrong tree.
 *
 * Resolution order, and WHY it is this way round:
 *   1. `git rev-parse HEAD` in the working directory, when a repo is readable there. The
 *      repository IS the running tree on this deployment (the droplet serves a checkout),
 *      so this is a measurement of what is actually running, not a stamp of what somebody
 *      once exported.
 *   2. The GIT_COMMIT_SHA environment variable, when git cannot answer (a container image
 *      shipped without .git, a build box). This is a STAMP, and the source field says so,
 *      so a stale value is at least attributable instead of masquerading as a measurement.
 *
 * When both exist and disagree, git wins and the disagreement is logged once: that exact
 * disagreement is the stale-stamp defect this file exists to surface.
 *
 * Resolved once per process and cached: the commit cannot change under a running server
 * without a restart, and a restart re-resolves.
 */

export type BuildIdentity = {
  /** Full commit sha, or null when neither source can answer. */
  commit: string | null
  /** Which source answered. A 'stamp' can go stale; a 'git' read is the running tree. */
  source: 'git' | 'env' | null
}

let cached: BuildIdentity | null = null

function readGitHead(): string | null {
  try {
    const out = execSync('git rev-parse HEAD', {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000,
    })
      .toString()
      .trim()
    return /^[0-9a-f]{40}$/i.test(out) ? out : null
  } catch {
    return null
  }
}

export function buildIdentity(): BuildIdentity {
  if (cached) return cached
  const fromGit = readGitHead()
  const fromEnv = env().GIT_COMMIT_SHA ?? null
  if (fromGit) {
    if (fromEnv && !fromGit.startsWith(fromEnv) && !fromEnv.startsWith(fromGit)) {
      // The stale-stamp defect, caught live: say so once where an operator will find it.
      log.warn('build_identity.stamp_stale', {
        running: fromGit.slice(0, 8),
        stamped: fromEnv.slice(0, 8),
      })
    }
    cached = { commit: fromGit, source: 'git' }
    return cached
  }
  cached = fromEnv ? { commit: fromEnv, source: 'env' } : { commit: null, source: null }
  return cached
}
