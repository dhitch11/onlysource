import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

/**
 * Security headers.
 *
 * What is here is enforced. What is NOT here is owed and named, because a header
 * we cannot prove is worse than a header we admit is missing:
 *   OWED (week one): Content-Security-Policy with a per-request nonce. It needs the
 *   nonce threaded through middleware and a report sink to be worth anything. A
 *   report-only CSP with nowhere to report is theater, so it is not shipped here.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  typedRoutes: true,
  // Pin the workspace root. Without this, Turbopack walks up and adopts the lockfile in the
  // home directory, which silently changes what is in the build context.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
  /*
   * Client router caching is left at the framework default. The authenticated tree does not
   * rely on it: every page under `(app)` is `force-dynamic` and re-renders on the server,
   * which is the property that actually matters once there is more than one tenant. Setting
   * `experimental.staleTimes` here was tried and rejected: `static` is floor-clamped to 30
   * seconds, so the config was rewriting itself and reading as a guarantee it did not give.
   */
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

/**
 * Sentry wraps the config only when it is actually configured.
 *
 * With no DSN and no org, the wrapper is skipped entirely rather than half applied.
 * The health surface reports `sentry: "not_configured"` so an absent plug is a
 * stated fact, never a silent no-op that looks like coverage.
 */
const sentryConfigured =
  Boolean(process.env.SENTRY_ORG) && Boolean(process.env.SENTRY_PROJECT)

export default sentryConfigured
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      widenClientFileUpload: true,
      disableLogger: true,
      tunnelRoute: '/monitoring',
    })
  : nextConfig
