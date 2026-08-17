import { configReport, env } from '@/lib/env'
import { buildIdentity } from '@/lib/build-identity'
import { LIMITER_KIND } from '@/lib/security/attempt-limiter'
import { readGateVerdict } from '@/lib/session/require-gate'
import { systemClock } from '@/lib/time/clock'
import { AWARD_CLOCK_PROVENANCE, awardClockIsFullyCited, nextDailyFireFrom } from '@/lib/domain/award-clock'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The health surface the conductor can read without a terminal.
 *
 * TWO TIERS, DELIBERATELY. The public tier is liveness and build identity, which is what a
 * monitor needs. The detailed tier, which names which subsystems are unconfigured and why,
 * is behind the gate, because a public list of what is not yet wired is a map for somebody
 * who should not have one.
 *
 * `degraded` is true when something REQUIRED for this environment is missing. It is not a
 * synonym for "some optional plug is empty", because a health check that goes yellow for
 * things nobody intends to fix teaches everyone to ignore it.
 */
export async function GET(request: Request) {
  const e = env()
  const report = configReport()
  const wantsDetail = new URL(request.url).searchParams.get('detail') === '1'

  /*
   * The commit is RESOLVED from the running tree (git first, env stamp second), never read
   * straight from the env stamp: the stamp went 52 commits stale on the live droplet while
   * this endpoint kept reporting it as the build, which is a wrong answer to the exact
   * question a monitor asks. `commitSource` says which kind of answer this is.
   */
  const identity = buildIdentity()
  const base = {
    status: report.degraded ? ('degraded' as const) : ('ok' as const),
    service: 'onlysource',
    environment: e.APP_ENV ?? e.NODE_ENV,
    commit: identity.commit?.slice(0, 8) ?? null,
    commitSource: identity.source,
    server: e.SERVER_ID ?? null,
    time: new Date(systemClock.now()).toISOString(),
  }

  if (!wantsDetail) {
    return Response.json(base, {
      status: report.degraded ? 503 : 200,
      headers: { 'cache-control': 'no-store' },
    })
  }

  const verdict = await readGateVerdict()
  if (!verdict.valid) {
    return Response.json(
      { ...base, detail: 'withheld', reason: 'Detailed health requires the environment gate.' },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  }

  const fire = nextDailyFireFrom(systemClock)

  return Response.json(
    {
      ...base,
      subsystems: report.subsystems,
      rate_limiter: {
        kind: LIMITER_KIND,
        note: 'Per process, not distributed. Resets on a restart. Redis on the box replaces it if a real lock need appears.',
      },
      award_clock: {
        next_daily_fire_utc: new Date(fire.instantMs).toISOString(),
        next_daily_fire_date: fire.date,
        sweeps_utc: Object.fromEntries(
          Object.entries(fire.sweeps).map(([k, v]) => [k, new Date(v).toISOString()]),
        ),
        // Three separate evidence grades, reported separately. A single boolean here would
        // hide that the offset is cited while the timezone is not.
        fully_cited: awardClockIsFullyCited(),
        provenance: {
          offset: AWARD_CLOCK_PROVENANCE.offset.grade,
          timezone: AWARD_CLOCK_PROVENANCE.timezone.grade,
          counting_convention: AWARD_CLOCK_PROVENANCE.countingConvention.grade,
        },
      },
    },
    { status: report.degraded ? 503 : 200, headers: { 'cache-control': 'no-store' } },
  )
}
