/**
 * The public surface of the backtest module.
 *
 * The two pinned fixtures are STATIC JSON IMPORTS parsed through their schemas at module load.
 * Two reasons, both deliberate:
 *
 *   1. NO FILE SYSTEM. A pure engine that reads a path is not pure, cannot run in every place
 *      this code has to run, and turns a missing file into a runtime surprise rather than a
 *      build error.
 *
 *   2. A FIXTURE THAT DRIFTS SILENTLY IS WORSE THAN NO FIXTURE. `strictObject` rejects an
 *      unknown key, so a field renamed or quietly added to the JSON fails at load with the
 *      path to the offending key, rather than being read as undefined by a check that then
 *      passes.
 *
 * Keep the two kinds separate at every level, including here. `PRICING_FIXTURE` gates
 * arithmetic and `DECISION_FIXTURE` gates signal choice. There is no combined runner, because
 * a single "fixtures pass" boolean is exactly the abstraction that lets one kind cover for the
 * other.
 */

import pricingFixtureJson from './fixtures/nsn-1650-01-059-8221.json'
import decisionFixtureJson from './fixtures/nsn-4730-00-536-2210.json'
import { decisionFixtureSchema, pricingFixtureSchema } from './harness'
import type { DecisionFixture, PricingFixture } from './harness'

export * from './harness'

/** NSN 1650-01-059-8221. Gates the dual-inflation anchor arithmetic, to the cent. */
export const PRICING_FIXTURE: PricingFixture = pricingFixtureSchema.parse(pricingFixtureJson)

/** NSN 4730-00-536-2210. Gates the scorecard's signal choice and disposition. Carries no arithmetic. */
export const DECISION_FIXTURE: DecisionFixture = decisionFixtureSchema.parse(decisionFixtureJson)

/** Both pinned fixtures, labelled by kind so a caller cannot reach for the wrong one by accident. */
export const PINNED_FIXTURES = {
  pricing_arithmetic: PRICING_FIXTURE,
  decision: DECISION_FIXTURE,
} as const
