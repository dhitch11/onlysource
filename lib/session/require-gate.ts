import 'server-only'
import { cookies } from 'next/headers'
import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { env, isProduction } from '@/lib/env'
import { log } from '@/lib/log'
import { systemClock } from '@/lib/time/clock'
import { gateCookieName, verifyGateToken, type GateVerdict } from './pre-release-gate'

/**
 * Server-side enforcement of the pre-release gate.
 *
 * This is the control. Middleware only redirects. Every protected layout and every
 * protected route handler calls one of these two functions, so a middleware bypass reaches
 * a server component that refuses to render rather than a page that quietly serves.
 */

export async function readGateVerdict(): Promise<GateVerdict> {
  const secure = isProduction()
  const jar = await cookies()
  const token = jar.get(gateCookieName(secure))?.value
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

/** For route handlers, which must answer with a status rather than a redirect. */
export async function gateOrJson(): Promise<Response | null> {
  const verdict = await readGateVerdict()
  if (verdict.valid) return null
  log.warn('gate.denied.api', { reason: verdict.reason })
  return Response.json(
    { error: 'not_authorised', message: 'This environment is gated.' },
    { status: 401 },
  )
}
