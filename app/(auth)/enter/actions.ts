'use server'

import { cookies, headers } from 'next/headers'
import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { env, isProduction } from '@/lib/env'
import { log } from '@/lib/log'
import { checkAttempt, recordFailure, recordSuccess } from '@/lib/security/attempt-limiter'
import {
  ANONYMOUS_SUBJECT,
  GATE_SESSION_MAX_AGE_SECONDS,
  gateCookieName,
  issueGateToken,
  passwordMatches,
} from '@/lib/session/pre-release-gate'
import { credentialedAccountCount, verifyCredentials } from '@/lib/auth/accounts'
import { systemClock } from '@/lib/time/clock'

/**
 * The pre-release gate action.
 *
 * IT WORKS WITH JAVASCRIPT DISABLED. Failure redirects back to the entry page carrying an
 * error code in the query string rather than returning client state, because server-side
 * validation that depends on client JavaScript is not server-side validation. The form is a
 * plain POST that Next progressively enhances, not a fetch that a broken bundle can break.
 */

/** Only same-origin relative paths survive. A protocol-relative URL is an open redirect. */
function safeNext(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string') return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

function backToEntry(next: string, params: Record<string, string>): never {
  const search = new URLSearchParams(params)
  if (next !== '/') search.set('next', next)
  redirect(`/enter?${search.toString()}` as Route)
}

/**
 * The limiter key.
 *
 * Honest about its own weakness: at this layer the client address is the best signal
 * available, and it is shared by everyone behind one corporate NAT. Acceptable for a
 * pre-release door in front of a 256-bit random phrase. Not acceptable for real account
 * lockout, which lands with Better Auth against the database, keyed on the account.
 */
async function limiterKey(): Promise<string> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded && forwarded.length > 0 ? `ip:${forwarded}` : 'ip:unknown'
}

export async function enterAction(formData: FormData): Promise<void> {
  const configured = env()
  const now = systemClock.now()
  const key = await limiterKey()
  const next = safeNext(formData.get('next'))

  // FAIL CLOSED. No secret means no door, in every environment, with no development bypass
  // and no falsy-equals-falsy path.
  if (!configured.PREVIEW_GATE_SECRET || !configured.PREVIEW_GATE_PASSWORD) {
    log.error('gate.not_configured', { outcome: 'denied', gate: 'pre_release' })
    backToEntry(next, { e: 'unconfigured' })
  }

  const pre = checkAttempt(key, now)
  if (!pre.allowed) {
    log.warn('gate.rate_limited', {
      outcome: 'locked',
      reason: 'too_many_attempts',
      gate: 'pre_release',
    })
    backToEntry(next, {
      e: 'locked',
      m: String(Math.max(1, Math.ceil(pre.retryAfterSeconds / 60))),
    })
  }

  const submitted = formData.get('password')
  const password = typeof submitted === 'string' ? submitted : ''
  const emailRaw = formData.get('email')
  const email = typeof emailRaw === 'string' ? emailRaw.trim() : ''

  /*
   * ==========================================================================================
   * TWO DOORS, AND ONLY ONE OF THEM IS OPEN AT A TIME.
   * ==========================================================================================
   * Owner ruling 2026-08-16: "There should only be one login built right now for
   * david@reddenda.com."
   *
   * THE REAL DOOR is email plus password, verified against the roster. It is the only door that
   * exists once any account has a credential.
   *
   * THE BREAK-GLASS DOOR is the old shared phrase, and it is reachable ONLY while
   * `credentialedAccountCount() === 0`. It exists so that a wiped, restored or freshly deployed
   * state directory cannot lock every human out of a live server with no way back in except SSH.
   * The moment the first password is set it goes inert, permanently, without anybody having to
   * remember to turn it off. That is the difference between a recovery path and a backdoor: a
   * backdoor keeps working after you no longer need it.
   */
  const accounts = credentialedAccountCount()

  if (accounts > 0) {
    const result = await verifyCredentials(email, password)
    if (!result.ok) {
      const after = recordFailure(key, now)
      // The LOG distinguishes the cases for an operator; the BROWSER is told only that the pair
      // did not work, because naming which half was wrong confirms which addresses are real.
      log.warn('signin.failed', {
        outcome: 'denied',
        reason: 'bad_credentials',
        gate: 'account',
        emailGiven: email.length > 0,
        count: after.allowed ? after.remaining : 0,
      })
      backToEntry(next, { e: 'bad' })
    }

    recordSuccess(key)
    const token = await issueGateToken(
      configured.PREVIEW_GATE_SECRET,
      now,
      GATE_SESSION_MAX_AGE_SECONDS,
      result.account.id,
    )
    const secureAcct = isProduction()
    const jarAcct = await cookies()
    jarAcct.set(gateCookieName(secureAcct), token, {
      httpOnly: true,
      secure: secureAcct,
      sameSite: 'lax',
      path: '/',
      maxAge: GATE_SESSION_MAX_AGE_SECONDS,
    })
    log.info('signin.opened', { outcome: 'allowed', gate: 'account', role: result.account.roleKey })
    redirect(next as Route)
  }

  // ---- break-glass only: no account has a credential yet ----
  const ok = await passwordMatches(password, configured.PREVIEW_GATE_PASSWORD)

  if (!ok) {
    const after = recordFailure(key, now)
    log.warn('gate.failed', {
      outcome: 'denied',
      reason: 'bad_phrase',
      gate: 'break_glass',
      count: after.allowed ? after.remaining : 0,
    })
    backToEntry(next, { e: 'bad' })
  }

  recordSuccess(key)
  const token = await issueGateToken(
    configured.PREVIEW_GATE_SECRET,
    now,
    GATE_SESSION_MAX_AGE_SECONDS,
    ANONYMOUS_SUBJECT,
  )
  const secure = isProduction()
  const jar = await cookies()
  jar.set(gateCookieName(secure), token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: GATE_SESSION_MAX_AGE_SECONDS,
  })

  log.info('gate.opened', { outcome: 'allowed', gate: 'break_glass' })
  redirect(next as Route)
}

export async function leaveAction(): Promise<void> {
  const jar = await cookies()
  jar.delete(gateCookieName(isProduction()))
  log.info('gate.closed', { outcome: 'signed_out', gate: 'pre_release' })
  redirect('/enter')
}
