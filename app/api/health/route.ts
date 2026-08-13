import { configReport, env } from '@/lib/env'
import { LIMITER_KIND } from '@/lib/security/attempt-limiter'
import { readGateVerdict } from '@/lib/session/require-gate'
import { systemClock } from '@/lib/time/clock'
import { CUTOFF_PROVENANCE, nextCutoffFireFrom } from '@/lib/time/cutoff'

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

  const base = {
    status: report.degraded ? ('degraded' as const) : ('ok' as const),
    service: 'onlysource',
    environment: e.VERCEL_ENV ?? e.NODE_ENV,
    commit: e.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? null,
    region: e.VERCEL_REGION ?? null,
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

  const fire = nextCutoffFireFrom(systemClock)

  return Response.json(
    {
      ...base,
      subsystems: report.subsystems,
      rate_limiter: {
        kind: LIMITER_KIND,
        note: 'Per process, not distributed. Resets on a cold start. Upstash Redis replaces it.',
      },
      award_cutoff: {
        next_fire_utc: new Date(fire.instantMs).toISOString(),
        next_fire_date: fire.date,
        sweeps_utc: Object.fromEntries(
          Object.entries(fire.sweeps).map(([k, v]) => [k, new Date(v).toISOString()]),
        ),
        primary_text_confirmed: CUTOFF_PROVENANCE.primaryTextConfirmed,
        source: CUTOFF_PROVENANCE.source,
      },
    },
    { status: report.degraded ? 503 : 200, headers: { 'cache-control': 'no-store' } },
  )
}
