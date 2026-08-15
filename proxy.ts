import { NextResponse, type NextRequest } from 'next/server'
import { readGateCookie, verifyGateToken } from '@/lib/session/pre-release-gate'
import { systemClock } from '@/lib/time/clock'

/**
 * THE PROXY LAYER IS A REDIRECT, NOT A CONTROL.
 *
 * (Next 16 renamed the `middleware.ts` convention to `proxy.ts`. Same layer, same rule.)
 *
 * Next.js CVE-2025-29927 was a middleware bypass, and Vercel's own postmortem says
 * middleware must not be the sole protection. Everything this file does is also done, from
 * scratch, in the server components and route handlers behind it, through
 * `requireGateSession()` and `gateOrJson()`. Deleting this file would degrade the
 * experience (an anonymous visitor would see a refusal instead of a sign-in page) and would
 * not expose a single byte.
 *
 * It also assigns the request id that every log line for this request carries.
 */

// /api/alerts/send is machine-reachable so the scheduler (which has no browser session) can hit it.
// It is NOT ungated: the route itself refuses anything without the ALERT_CRON_TOKEN or a valid gate
// session, so the token is the control and this only stops the redirect from swallowing the request.
const PUBLIC_PATHS = new Set(['/enter', '/api/health', '/api/alerts/send'])

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  if (pathname.startsWith('/_next/')) return true
  if (pathname === '/favicon.ico' || pathname === '/robots.txt') return true
  // Branded app icon (Next serves app/icon.svg here). A favicon carries no data and the browser
  // requests it even on the sign-in page, so it is public. This proxy is a redirect, not the gate.
  if (pathname === '/icon.svg') return true
  return false
}

export async function proxy(request: NextRequest) {
  const requestId = crypto.randomUUID()
  const { pathname, search } = request.nextUrl

  const forward = new Headers(request.headers)
  forward.set('x-request-id', requestId)

  if (isPublic(pathname)) {
    return NextResponse.next({ request: { headers: forward } })
  }

  // Both names, always. The writer's notion of "secure" and this one must never be
  // able to disagree, because when they do the person is locked out permanently.
  const token = readGateCookie(request.cookies)
  const verdict = await verifyGateToken(
    token,
    process.env.PREVIEW_GATE_SECRET,
    systemClock.now(),
  )

  if (verdict.valid) {
    return NextResponse.next({ request: { headers: forward } })
  }

  const url = request.nextUrl.clone()
  url.pathname = '/enter'
  url.search = ''
  // Preserve the deep link so the person lands where they were going, not on a generic home.
  if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
}
