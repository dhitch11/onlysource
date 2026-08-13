/**
 * The injectable clock. This file is the ONLY place in the codebase allowed to read
 * wall time, and the R0.3 lint enforces that by failing any other file that calls
 * `Date.now()` or `new Date()` with no argument.
 *
 * Why this is a rule and not a preference: this product's core obligation is a hard
 * external deadline at 3:00 PM Eastern. A deadline calculation that reads the wall
 * clock directly cannot be tested across a DST transition, a federal holiday, or a
 * year boundary, so the bug ships and is discovered by a lost award.
 *
 * `new Date(someNumber)` is deterministic and allowed everywhere. Only the argumentless
 * forms are banned.
 */

export type Clock = {
  /** Milliseconds since the Unix epoch, UTC. */
  now(): number
}

/** Reads real wall time. The only construction of it lives in composition roots. */
export const systemClock: Clock = {
  now(): number {
    // eslint-disable-next-line no-restricted-syntax -- this is the one sanctioned read
    return Date.now()
  },
}

/** A clock frozen at a caller-supplied instant. Tests and replays use this. */
export function fixedClock(instantMs: number): Clock {
  return { now: () => instantMs }
}

/**
 * A clock that can be advanced by hand. Used for expiry, session and scheduler tests
 * where "wait for it" is not an acceptable instrument.
 */
export function controllableClock(startMs: number): Clock & { advance(ms: number): void } {
  let current = startMs
  return {
    now: () => current,
    advance(ms: number) {
      current += ms
    },
  }
}
