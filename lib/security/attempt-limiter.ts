/**
 * Failed-attempt limiting for the pre-release gate.
 *
 * HONEST SCOPE, STATED IN THE CODE AND ON THE HEALTH SURFACE: this counter lives in one
 * process's memory. On Vercel that means it limits per warm instance, not globally, and it
 * resets on a cold start. It genuinely raises the cost of an online guessing attack against
 * a 256-bit random password. It is NOT a distributed lockout and must never be described as
 * one.
 *
 * Upstash Redis replaces it, per the stack ruling. Until then `limiterKind` reports
 * `in_process` so nobody reads a green health check as coverage it does not have.
 *
 * A counter that pretends to be global is worse than one that admits it is local, because
 * the first one stops anybody from building the real thing.
 */

export const LIMITER_KIND = 'in_process' as const

export type AttemptWindow = {
  maxAttempts: number
  windowMs: number
  lockoutMs: number
}

export const GATE_ATTEMPT_POLICY: AttemptWindow = {
  maxAttempts: 8,
  windowMs: 10 * 60_000,
  lockoutMs: 10 * 60_000,
}

type Bucket = { failures: number[]; lockedUntil: number }

const buckets = new Map<string, Bucket>()

/** Bound the map so a spray of distinct keys cannot grow it without limit. */
const MAX_TRACKED_KEYS = 5_000

export type AttemptVerdict =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number }

export function checkAttempt(
  key: string,
  nowMs: number,
  policy: AttemptWindow = GATE_ATTEMPT_POLICY,
): AttemptVerdict {
  const bucket = buckets.get(key)
  if (!bucket) return { allowed: true, remaining: policy.maxAttempts }

  if (bucket.lockedUntil > nowMs) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.lockedUntil - nowMs) / 1000),
    }
  }

  const cutoff = nowMs - policy.windowMs
  const recent = bucket.failures.filter((t) => t > cutoff)
  bucket.failures = recent
  return { allowed: true, remaining: Math.max(0, policy.maxAttempts - recent.length) }
}

export function recordFailure(
  key: string,
  nowMs: number,
  policy: AttemptWindow = GATE_ATTEMPT_POLICY,
): AttemptVerdict {
  if (buckets.size >= MAX_TRACKED_KEYS && !buckets.has(key)) {
    // Evict the oldest tracked key rather than refusing to track, so a spray cannot buy an
    // attacker an untracked slot for the key they actually care about.
    const oldest = buckets.keys().next()
    if (!oldest.done) buckets.delete(oldest.value)
  }

  const bucket = buckets.get(key) ?? { failures: [], lockedUntil: 0 }
  const cutoff = nowMs - policy.windowMs
  bucket.failures = bucket.failures.filter((t) => t > cutoff)
  bucket.failures.push(nowMs)

  if (bucket.failures.length >= policy.maxAttempts) {
    bucket.lockedUntil = nowMs + policy.lockoutMs
    bucket.failures = []
  }
  buckets.set(key, bucket)

  return checkAttempt(key, nowMs, policy)
}

export function recordSuccess(key: string): void {
  buckets.delete(key)
}

/** Tests only. */
export function resetLimiter(): void {
  buckets.clear()
}
