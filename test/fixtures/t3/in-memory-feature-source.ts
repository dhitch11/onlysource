/**
 * The in-memory `FeatureSource` every T3 test binds against, and the only implementation of the
 * port that exists until @T1's migration lands.
 *
 * It lives under `test/fixtures/t3/**` (claimed by @T3-ENGINE in the claims file) rather than in
 * `lib/engine/**` so the engine package carries no test scaffolding, and so no production
 * composition root can reach for it by accident.
 *
 * It RECORDS ITS CALLS. That is not decoration: one of the firewall's structural properties is
 * that the port is never told the as-of instant, and the only way to prove a negative like that
 * is to capture what the port actually received.
 */

import type {
  FeatureContext,
  FeatureDefinition,
  FeatureEntity,
  FeatureObservation,
  FeatureSource,
} from '@/lib/engine/features'

export type RecordedCall = {
  readonly method: 'definitions' | 'observations'
  readonly args: readonly unknown[]
}

export type InMemoryFeatureSource = FeatureSource & {
  readonly calls: readonly RecordedCall[]
}

/**
 * Builds a port over fixed rows. Observations are handed back in the order given so a test can
 * shuffle them and assert the engine's output did not move.
 *
 * `observations` is typed loosely on purpose: a real source can hand over a malformed row, and a
 * fixture that could not express one would leave the refusal path untested.
 */
export function inMemoryFeatureSource(seed: {
  readonly definitions: readonly FeatureDefinition[]
  readonly observations: readonly unknown[]
}): InMemoryFeatureSource {
  const calls: RecordedCall[] = []
  return {
    calls,
    async definitions(entity: FeatureEntity, ctx: FeatureContext) {
      calls.push({ method: 'definitions', args: [entity, ctx] })
      return seed.definitions
    },
    async observations(entity: FeatureEntity, ctx: FeatureContext) {
      calls.push({ method: 'observations', args: [entity, ctx] })
      return seed.observations as readonly FeatureObservation[]
    },
  }
}
