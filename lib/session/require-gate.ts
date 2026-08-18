import 'server-only'
import { cookies } from 'next/headers'
import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { env, isProduction } from '@/lib/env'
import { log } from '@/lib/log'
import { systemClock } from '@/lib/time/clock'
import { readGateCookie, verifyGateToken, type GateVerdict } from './pre-release-gate'

/**
 * Server-side enforcement of the pre-release gate.
 *
 * This is the control. Middleware only redirects. Every protected layout and every
 * protected route handler calls one of these two functions, so a middleware bypass reaches
 * a server component that refuses to render rather than a page that quietly serves.
 */

export async function readGateVerdict(): Promise<GateVerdict> {
  const jar = await cookies()
  const token = readGateCookie(jar)
  return verifyGateToken(token, env().PREVIEW_GATE_SECRET, systemClock.now())
}

/**
 * Redirect an unauthenticated visitor to the entry page, preserving where they were going.
 *
 * The deep link survives the round trip, because landing a person on a generic home page
 * after they clicked a specific link is a small theft of their time that happens every day.
 */
export async function requireGateSession(returnTo?: string): Promise<void> {
  const verdict = await readGateVerdict()
  if (verdict.valid) return

  log.warn('gate.denied', { reason: verdict.reason, route: returnTo ?? null })

  // `typedRoutes` cannot know a runtime-built query string. The cast is narrow and it sits
  // directly under the check that makes it safe: same-origin, absolute, not protocol-relative.
  const target =
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? (`/enter?next=${encodeURIComponent(returnTo)}` as Route)
      : ('/enter' as Route)
  redirect(target)
}

/**
 * For route handlers, which must answer with a status rather than a redirect.
 *
 * ★ THIS IS NOT AUTHORIZATION AND IT NEVER WAS. It answers one question, "is any account
 * signed in", and it cannot answer who or what they may do. It was the only check on
 * `POST /api/admin/users` until 2026-08-18, and a `read_only` session used that route to
 * promote itself to `owner`. Any handler that CHANGES state calls
 * `requirePermission(key)` from `lib/session/authz.ts` instead. This function is correct
 * only for a read that every signed-in person may make.
 *
 * WHAT AN ANONYMOUS CALLER ACTUALLY SEES IN PRODUCTION: a 307 to /enter, not this 401.
 * The edge proxy (Caddy) intercepts unauthenticated requests before they reach Next, so
 * this JSON answer is the DEFENSE-IN-DEPTH layer behind it: it fires when the edge is
 * bypassed, misconfigured, or absent (local dev, tests). Measured 2026-08-16:
 * `curl /api/deals` with no cookie answers `HTTP/2 307, location: /enter?...` from Caddy
 * and discloses nothing. Both layers refusing is the design; do not "fix" the mismatch by
 * removing either one.
 */
export async function gateOrJson(): Promise<Response | null> {
  const verdict = await readGateVerdict()
  if (verdict.valid) return null
  log.warn('gate.denied.api', { reason: verdict.reason })
  return Response.json(
    { error: 'not_authorised', message: 'This environment is gated.' },
    { status: 401 },
  )
}
