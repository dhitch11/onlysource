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

/**
 * ★ THE BUILD DIRECTORY IS OVERRIDABLE SO A DEPLOY NEED NOT REWRITE THE ONE BEING SERVED.
 *
 * MEASURED ON PRODUCTION 2026-08-19 02:01 UTC, during a live demo. `/enter` returned HTTP 500
 * with a bare "Internal Server Error", on both the droplet and the Netlify host, for the
 * duration of a promote. The pm2 log named it exactly:
 *
 *     InvariantError: The client reference manifest for route "/enter" does not exist
 *     Failed to load static file for page: /500  ENOENT .next/server/pages/500.html
 *
 * Neither file was missing from the build. They were missing from the build **that was being
 * overwritten underneath the running server**, because `npm run build` writes into the same
 * `.next` the live process is reading from. Both existed again 53 seconds later.
 *
 * WHY THIS IS WORSE THAN IT SOUNDS, AND WHY IT SURVIVED EVERY CHECK WE HAVE. Signed-in traffic
 * notices nothing: every app route is a correct 307 and every page still serves from chunks
 * already resolved. **The only route that breaks is `/enter`, which is the only route an
 * anonymous visitor can load.** So anyone holding a cookie sees a perfect product and anyone
 * arriving fresh sees a bare error, with no error boundary, because `500.html` is being
 * rewritten in the same instant. Production moved 14 times in one day. That is 14 windows on
 * the one URL you would hand to a stranger.
 *
 * And the deploy protocol cannot see it BY CONSTRUCTION: it reads back health and sweeps the
 * routes AFTER the restart, so every check looks at the far side of the gap.
 *
 * The remedy is not a better check. It is to stop writing where something is reading:
 * `NEXT_DIST_DIR=.next-staging npm run build`, then swap the finished directory into place and
 * restart. The running server reads a complete `.next` until the instant it reads the new one.
 * Same rule as the archive's bytes-then-record ordering, one layer up: **never let a reader see
 * a fact that is not yet durable.** `scripts/deploy-swap.sh` is that sequence.
 */
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  typedRoutes: true,
  /*
   * ==========================================================================================
   * SIGN-IN WAS IMPOSSIBLE THROUGH THE PUBLIC URL, FOR EVERYONE, AND NO CHECK WE HAD SAW IT.
   * ==========================================================================================
   * The public host onlysourceai.netlify.app is a pure proxy to the droplet. Next.js validates
   * every Server Action by comparing the `origin` header against `x-forwarded-host`, and through
   * the proxy those legitimately differ:
   *
   *     origin            onlysourceai.netlify.app     (the browser, telling the truth)
   *     x-forwarded-host  206.189.230.237.nip.io       (the proxy, also telling the truth)
   *
   * so every submit of the /enter form died server-side with "Invalid Server Actions request"
   * and the operator saw the error boundary: "Try again. If it keeps happening, send the
   * reference below to the build team." The owner found it by trying to log in.
   *
   * WHY EVERY CHECK MISSED IT: our probes authenticate with a minted cookie against the droplet
   * host, so the one thing they never do is SUBMIT A FORM THROUGH THE PROXY. A GET through
   * Netlify renders fine; only a POSTed action trips the origin comparison. "The site works on
   * Netlify" was measured on reads and asserted about writes.
   *
   * The allow-list below is every host this app is legitimately served through. It is the
   * ORIGINS the check will accept for a forwarded action, not a CORS wildcard: an attacker's
   * page still fails the check because their origin is not here.
   */
  experimental: {
    serverActions: {
      allowedOrigins: ['onlysourceai.netlify.app', '206.189.230.237.nip.io', 'localhost:3000'],
    },
  },
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
