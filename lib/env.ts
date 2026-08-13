import 'server-only'
import { z } from 'zod'

/**
 * Environment configuration.
 *
 * Two properties matter more than tidiness here.
 *
 * ONE, IT FAILS CLOSED. A missing gate secret in production denies every request. It does
 * not fall back to an empty string, a default, or an open door. The most common way a
 * preview gate turns out to have protected nothing is a falsy secret compared against a
 * falsy input and found equal.
 *
 * TWO, IT NEVER CRASHES THE BUILD. Validation is lazy and cached, so a build container with
 * no runtime secrets still builds. Absence is reported by `configReport()` as a plain
 * stated fact, which is what the health surface renders.
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // The day-one pre-release gate. Deleted when Better Auth lands.
  PREVIEW_GATE_SECRET: z.string().min(32).optional(),
  PREVIEW_GATE_PASSWORD: z.string().min(12).optional(),

  // Observability.
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional().or(z.literal('')),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),

  // Postgres. Two roles, never one. Lands with the schema on day two.
  DATABASE_URL_MIGRATOR: z.string().optional(),
  DATABASE_URL_RUNTIME: z.string().optional(),

  // Deploy identity, surfaced on the health endpoint so a promote is traceable.
  VERCEL_ENV: z.string().optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  VERCEL_REGION: z.string().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    // A malformed value is different from an absent one and must be loud.
    throw new Error(
      `Environment is malformed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    )
  }
  cached = parsed.data
  return cached
}

/** Reset the memoised environment. Tests only. */
export function resetEnvCache(): void {
  cached = null
}

export function isProduction(): boolean {
  const e = env()
  return e.NODE_ENV === 'production' || e.VERCEL_ENV === 'production'
}

export type ConfigStatus = 'configured' | 'not_configured'

export type ConfigReport = {
  /** Every subsystem, and whether its plug is in. Never a guess, never a silent no-op. */
  subsystems: Record<string, { status: ConfigStatus; detail: string }>
  /** True when something REQUIRED for this environment is missing. */
  degraded: boolean
}

/**
 * What is connected and what is not, in words a person can act on.
 *
 * Deliberately reports the ABSENCE of an optional plug as `not_configured` rather than
 * hiding it. A pasted credential that was never valid, in a system that never told anyone,
 * is how an integration ends up built and wired but never fed.
 */
export function configReport(): ConfigReport {
  const e = env()
  const prod = isProduction()

  const gateConfigured = Boolean(e.PREVIEW_GATE_SECRET && e.PREVIEW_GATE_PASSWORD)
  const sentryConfigured = Boolean(e.NEXT_PUBLIC_SENTRY_DSN)
  const dbConfigured = Boolean(e.DATABASE_URL_RUNTIME)

  const subsystems: ConfigReport['subsystems'] = {
    pre_release_gate: {
      status: gateConfigured ? 'configured' : 'not_configured',
      detail: gateConfigured
        ? 'Shared-secret gate active. This is a pre-release door, not the product identity layer.'
        : 'PREVIEW_GATE_SECRET or PREVIEW_GATE_PASSWORD is absent. Every request is denied.',
    },
    error_tracking: {
      status: sentryConfigured ? 'configured' : 'not_configured',
      detail: sentryConfigured
        ? 'Sentry DSN present. Errors are reported.'
        : 'No Sentry DSN. Errors are logged to stdout only and are not reported anywhere.',
    },
    database: {
      status: dbConfigured ? 'configured' : 'not_configured',
      detail: dbConfigured
        ? 'Runtime database URL present.'
        : 'No database yet. Identity, tenancy and the audit spine land with it. Nothing reads a database in this build.',
    },
  }

  // In production the gate is required. Everything else states its absence and carries on.
  const degraded = prod && !gateConfigured

  return { subsystems, degraded }
}
