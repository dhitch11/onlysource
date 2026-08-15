/**
 * THE PRE-RELEASE GATE. Read this header before you touch it.
 *
 * This is NOT the product's identity layer. It is a shared-secret door that exists so the
 * shell can be a real live URL on day one while Better Auth is being wired. It is deleted
 * when Better Auth lands. It is never kept as a backdoor, and it never coexists with real
 * accounts.
 *
 * What it still has to get right, because a gate that does not gate is worse than no gate:
 *
 *   FAILS CLOSED. No secret configured means every request is denied, in every environment.
 *   There is no falsy-equals-falsy path, no development bypass, and no default password.
 *
 *   THE BYTES NEVER REACH THE BROWSER. The gate is checked on the server before the
 *   protected tree renders. It is not a CSS overlay over content the server already sent.
 *   If the bytes reach the browser, the page is public, whatever is drawn on top of it.
 *
 *   MIDDLEWARE IS NOT THE CONTROL. Next.js CVE-2025-29927 was a middleware bypass and
 *   Vercel's own postmortem says middleware must not be the sole protection. Middleware
 *   here only redirects an anonymous visitor to the entry page. The actual check runs in
 *   the layout and in every route handler, through `requireGateSession()`.
 *
 * Web Crypto only, no `node:crypto`, so the identical verification code runs in the Edge
 * middleware and in Node server components. Two implementations of one check is how the
 * two drift apart.
 */

export const GATE_COOKIE_DEV = 'os_gate'
export const GATE_COOKIE_PROD = '__Host-os_gate'

/** Absolute session lifetime. There is no sliding renewal on a pre-release door. */
export const GATE_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60

export function gateCookieName(secureContext: boolean): string {
  return secureContext ? GATE_COOKIE_PROD : GATE_COOKIE_DEV
}

/**
 * EVERY READER MUST TRY BOTH NAMES, IN THIS ORDER.
 *
 * The writer chooses the cookie NAME from one rule and a reader that chooses it from a
 * different rule locks the person out permanently: the door sets a cookie the guard is not
 * looking for, so the guard bounces them back to the door, forever.
 *
 * That is not hypothetical. It shipped. `app/(auth)/enter/actions.ts` named the cookie from
 * `isProduction()` while `proxy.ts` named it from `request.nextUrl.protocol === 'https:'`.
 * Those two agree on a developer's laptop and disagree in the two places that matter:
 *   - a production build served over http (`next start` locally), and
 *   - PRODUCTION BEHIND A TLS-TERMINATING REVERSE PROXY, which is this product's deploy
 *     target. The proxy speaks https to the world and plain http to the Node process, so the
 *     middleware sees `http:` and looks for `os_gate` while the door set `__Host-os_gate`.
 *     Every user would have been met with an infinite redirect on the live site.
 *
 * The cookie name is NOT a security boundary. The HMAC signature on the token is. Accepting
 * either name therefore gives up nothing and removes the entire class of lockout, including
 * the case where the deployment's notion of "secure" changes between the write and the read.
 */
export function readGateCookie(
  jar: { get(name: string): { value: string } | undefined },
): string | undefined {
  return jar.get(GATE_COOKIE_PROD)?.value ?? jar.get(GATE_COOKIE_DEV)?.value
}

const encoder = new TextEncoder()

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * Constant-time byte comparison.
 *
 * Length is compared first and that IS a length oracle, which is why every caller hashes
 * its inputs to a fixed 32 bytes before calling this. Do not pass raw user input here.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return new Uint8Array(digest)
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return new Uint8Array(sig)
}

export type GatePayload = {
  /** Always the literal string below. There is no user identity behind this door. */
  sub: 'pre-release'
  /** Issued at, epoch seconds. */
  iat: number
  /** Absolute expiry, epoch seconds. */
  exp: number
}

/**
 * Compare a submitted password against the configured one, in constant time.
 *
 * Returns false when either side is absent. That is the fail-closed path and it is the
 * single most important line in this file.
 */
export async function passwordMatches(
  submitted: string,
  configured: string | undefined,
): Promise<boolean> {
  if (!configured || configured.length === 0) return false
  if (typeof submitted !== 'string' || submitted.length === 0) return false
  const [a, b] = await Promise.all([sha256(submitted), sha256(configured)])
  return constantTimeEqual(a, b)
}

/** Mint a signed gate cookie value. */
export async function issueGateToken(
  secret: string,
  nowMs: number,
  maxAgeSeconds = GATE_SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  const iat = Math.floor(nowMs / 1000)
  const payload: GatePayload = { sub: 'pre-release', iat, exp: iat + maxAgeSeconds }
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const sig = base64UrlEncode(await hmac(secret, body))
  return `${body}.${sig}`
}

export type GateVerdict =
  | { valid: true; payload: GatePayload }
  | { valid: false; reason: 'not_configured' | 'absent' | 'malformed' | 'bad_signature' | 'expired' }

/**
 * Verify a gate cookie value.
 *
 * Every failure mode is a distinct named reason so the logs can tell an expired session
 * apart from a forged one. The reasons are never returned to the browser, because
 * "bad_signature" tells an attacker their forgery attempt was well formed.
 */
export async function verifyGateToken(
  token: string | undefined,
  secret: string | undefined,
  nowMs: number,
): Promise<GateVerdict> {
  if (!secret || secret.length < 32) return { valid: false, reason: 'not_configured' }
  if (!token) return { valid: false, reason: 'absent' }

  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return { valid: false, reason: 'malformed' }
  const body = token.slice(0, dot)
  const providedSig = base64UrlDecode(token.slice(dot + 1))
  if (!providedSig) return { valid: false, reason: 'malformed' }

  const expectedSig = await hmac(secret, body)
  if (!constantTimeEqual(providedSig, expectedSig)) {
    return { valid: false, reason: 'bad_signature' }
  }

  const decoded = base64UrlDecode(body)
  if (!decoded) return { valid: false, reason: 'malformed' }

  let payload: GatePayload
  try {
    payload = JSON.parse(new TextDecoder().decode(decoded)) as GatePayload
  } catch {
    return { valid: false, reason: 'malformed' }
  }

  if (payload.sub !== 'pre-release' || typeof payload.exp !== 'number') {
    return { valid: false, reason: 'malformed' }
  }
  if (payload.exp * 1000 <= nowMs) return { valid: false, reason: 'expired' }

  return { valid: true, payload }
}
