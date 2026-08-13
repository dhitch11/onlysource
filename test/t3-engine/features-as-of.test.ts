/**
 * GATE R3.6 and T3 charter 4.1. The as-of firewall and the leakage canary.
 *
 * THE INSTRUMENT IS BUILT TO BE ABLE TO FAIL. Every expectation below is a hand-written
 * literal: the winning value, the availability word, the counts, the lateness in milliseconds.
 * Nothing is re-derived by calling the code under test, so a broken implementation cannot make
 * the expectation agree with it.
 *
 * Three of these tests carry an explicit negative control, because the failure mode this file
 * exists to prevent is silent by construction. A backtest that leaked a post-award artifact
 * does not throw, does not warn and does not look wrong: it looks EXCELLENT. So each firewall
 * assertion is paired with a deliberately leaky second path that admits everything, and the
 * pair proves two things at once: that the real path excludes, and that the assertion would
 * have caught it if it did not. Delete the three lines of the firewall in `as-of.ts` and this
 * file goes red in nine places.
 *
 * FIXTURE IDENTIFIERS ARE PLAINLY SYNTHETIC on purpose (`FIXTURE-NSN-A`, `FIXTURE-DOC-1`). A
 * fixture that borrowed a real NSN or a real solicitation number would attach invented values
 * to a real item, and somebody would eventually read one back as a finding.
 */

import { describe, expect, it } from 'vitest'
import {
  SOURCE_CLASSES,
  SOURCE_CLASS_DEFAULT,
  SOURCE_CLASS_FEATURE,
  detectLeakage,
  featureValue,
  featuresAsOf,
  sourceClassOf,
  type AvailableFeatureValue,
  type FeatureContext,
  type FeatureDefinition,
  type FeatureEntity,
  type FeatureSet,
  type FeatureSource,
  type UnavailableFeatureValue,
} from '@/lib/engine/features'
import { inMemoryFeatureSource } from '@/test/fixtures/t3/in-memory-feature-source'

/* ------------------------------------------------------------------------------------ */
/* THE TIMELINE. Written as UTC calendar arithmetic, then asserted against the ISO string */
/* the comments claim, so a wrong constant is caught by the fixture's own first test.     */
/* ------------------------------------------------------------------------------------ */

const DAY = 86_400_000
const T_EARLY = Date.UTC(2026, 5, 1) // 2026-06-01T00:00:00.000Z, the decision instant
const T_LATE = Date.UTC(2026, 11, 1) // 2026-12-01T00:00:00.000Z, a later decision instant
const LOSING_BID_START = Date.UTC(2026, 8, 1) // 2026-09-01T00:00:00.000Z, between the two

const ENTITY: FeatureEntity = { kind: 'nsn', id: 'FIXTURE-NSN-A' }
const CTX: FeatureContext = { orgId: 'FIXTURE-ORG-1' }

/**
 * The registry. Publication windows are supplied by the source, never by the engine, so this
 * is where a fixture states what a citable lane would state in production.
 */
const DEFINITIONS: readonly FeatureDefinition[] = [
  {
    name: 'last_award_unit_price',
    publication: {
      kind: 'always',
      note: 'The procurement history table is printed on the face of the solicitation itself.',
    },
    whatWouldResolveAbsence:
      'Parse the procurement history table on the solicitation face for this item.',
  },
  {
    name: 'surplus_material_flag',
    publication: {
      kind: 'always',
      note: 'The Surplus Material Y/N flag sits in the same printed table as the award history.',
    },
    allowedValues: ['Y', 'N'],
    whatWouldResolveAbsence: 'Read the Surplus Material column of the printed procurement history.',
  },
  {
    name: 'observed_losing_bid',
    publication: {
      kind: 'from',
      startMs: LOSING_BID_START,
      note: 'The publishing tool has a start date, so items older than it can never carry this value.',
    },
    whatWouldResolveAbsence:
      'Recover the unsuccessful bidder report for this solicitation from the operator mailbox.',
  },
  {
    name: SOURCE_CLASS_FEATURE,
    publication: { kind: 'always', note: 'Recorded per supplier when evidence establishes it.' },
    allowedValues: SOURCE_CLASSES,
    whatWouldResolveAbsence:
      'Establish from primary evidence whether this supplier manufactures the article or resells it.',
  },
  {
    name: 'delivery_days_ado',
    publication: {
      kind: 'unknown',
      note: 'The date this field began appearing in the feed is not established.',
    },
    whatWouldResolveAbsence: 'Read Block 6, DELIVER BY, on the solicitation for this item.',
  },
]

/** A well-formed observation with the fixture's entity and org already filled in. */
function obs(over: {
  feature: string
  value: string | number | boolean
  extractedAt: number
  sourceDocumentId: string
  entityId?: string
  orgId?: string
}) {
  return {
    feature: over.feature,
    entityKind: 'nsn' as const,
    entityId: over.entityId ?? ENTITY.id,
    orgId: over.orgId ?? CTX.orgId,
    value: over.value,
    sourceDocumentId: over.sourceDocumentId,
    locator: { kind: 'field' as const, field: 'procurement_history.unit_cost' },
    extractedAt: over.extractedAt,
    grade: 'VERIFIED' as const,
  }
}

/**
 * The main scenario. Three observations of one feature straddling the decision instant, and one
 * classification observation before it.
 *
 * 1537.85 was extracted 30 days before the decision. 1720.5 was extracted at the exact instant
 * of the decision. 9999.99 was extracted ONE MILLISECOND AFTER it, and is the planted
 * post-award value every leakage assertion in this file hunts for.
 */
const OBSERVATIONS: readonly unknown[] = [
  obs({ feature: 'last_award_unit_price', value: 1537.85, extractedAt: T_EARLY - 30 * DAY, sourceDocumentId: 'FIXTURE-DOC-1' }),
  obs({ feature: 'last_award_unit_price', value: 1720.5, extractedAt: T_EARLY, sourceDocumentId: 'FIXTURE-DOC-2' }),
  obs({ feature: 'last_award_unit_price', value: 9999.99, extractedAt: T_EARLY + 1, sourceDocumentId: 'FIXTURE-DOC-3' }),
  obs({ feature: SOURCE_CLASS_FEATURE, value: 'dealer', extractedAt: T_EARLY - DAY, sourceDocumentId: 'FIXTURE-DOC-4' }),
]

function sourceOf(observations: readonly unknown[], definitions = DEFINITIONS) {
  return inMemoryFeatureSource({ definitions, observations })
}

function available(set: FeatureSet, name: string): AvailableFeatureValue {
  const v = featureValue(set, name)
  if (!v || v.availability !== 'available') {
    throw new Error(`expected "${name}" available, found "${v ? v.availability : 'no such feature'}"`)
  }
  return v
}

function unavailable(set: FeatureSet, name: string): UnavailableFeatureValue {
  const v = featureValue(set, name)
  if (!v || v.availability === 'available') {
    throw new Error(`expected "${name}" unavailable, found "${v ? v.availability : 'no such feature'}"`)
  }
  return v
}

/**
 * THE DELIBERATELY LEAKY SECOND PATH. This is what `featuresAsOf` would degrade into if the
 * firewall were deleted: it admits every observation and lets the newest one win, which is the
 * shape almost every feature loader in the world has.
 *
 * It exists only as a negative control. Every assertion about the real path is paired with the
 * same assertion about this one, so an assertion that could not fail is visible immediately.
 */
async function leakyFeaturesAsOf(
  entity: FeatureEntity,
  at: number,
  ctx: FeatureContext,
  source: FeatureSource,
): Promise<FeatureSet> {
  const definitions = await source.definitions(entity, ctx)
  const observations = (await source.observations(entity, ctx)) as readonly {
    feature: string
    value: string | number | boolean
    sourceDocumentId: string
    locator: { kind: 'field'; field: string }
    extractedAt: number
    grade: 'VERIFIED'
  }[]
  const values: AvailableFeatureValue[] = []
  for (const def of definitions) {
    const rows = observations.filter((o) => o.feature === def.name)
    let best = rows[0]
    for (const row of rows) if (best && row.extractedAt > best.extractedAt) best = row
    if (!best) continue
    values.push({
      feature: def.name,
      availability: 'available',
      value: best.value,
      sourceDocumentId: best.sourceDocumentId,
      locator: best.locator,
      extractedAt: best.extractedAt,
      asOf: at,
      grade: best.grade,
    })
  }
  return {
    entity,
    orgId: ctx.orgId,
    asOf: at,
    values,
    dataGaps: [],
    withheldByAsOf: [],
    refused: [],
  }
}

/* ------------------------------------------------------------------------------------ */

describe('the fixture timeline is the timeline the comments claim', () => {
  it('resolves to the exact UTC instants named above', () => {
    expect(new Date(T_EARLY).toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(new Date(T_LATE).toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(new Date(LOSING_BID_START).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    // The publication start sits BETWEEN the two decision instants. That is the whole design of
    // the informative-absence pair below, so it is asserted rather than assumed.
    expect(T_EARLY < LOSING_BID_START).toBe(true)
    expect(T_LATE > LOSING_BID_START).toBe(true)
  })
})

describe('R3.6 the as-of firewall excludes every observation extracted after the decision', () => {
  it('admits an observation extracted at the exact decision instant and rejects one 1ms later', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    const price = available(set, 'last_award_unit_price')

    // 1720.5 was extracted AT the instant, so it was on the desk when the decision was made.
    expect(price.value).toBe(1720.5)
    expect(price.extractedAt).toBe(T_EARLY)
    expect(price.sourceDocumentId).toBe('FIXTURE-DOC-2')
    expect(price.asOf).toBe(T_EARLY)
    expect(price.grade).toBe('VERIFIED')
    expect(price.locator).toEqual({ kind: 'field', field: 'procurement_history.unit_cost' })
  })

  it('records the excluded observation in the audit trail, with no value in it', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    expect(set.withheldByAsOf).toEqual([
      {
        feature: 'last_award_unit_price',
        sourceDocumentId: 'FIXTURE-DOC-3',
        extractedAt: T_EARLY + 1,
      },
    ])
    // The audit record names the document and the instant and never the number. An audit trail
    // that quoted the withheld value would be a leak with a paper trail.
    expect(Object.keys(set.withheldByAsOf[0] ?? {}).sort()).toEqual([
      'extractedAt',
      'feature',
      'sourceDocumentId',
    ])
  })

  it('never lets the post-award value appear anywhere in the serialised set', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    expect(JSON.stringify(set)).not.toContain('9999.99')
  })

  it('NEGATIVE CONTROL: the same assertions catch the leaky path, so they can fail', async () => {
    const leaked = await leakyFeaturesAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    // Remove the firewall and this is what you get: the post-award number, silently, as the answer.
    expect(available(leaked, 'last_award_unit_price').value).toBe(9999.99)
    expect(JSON.stringify(leaked)).toContain('9999.99')
  })

  it('reads as-of, not latest: an older in-window value wins over a newer out-of-window one', async () => {
    // Only the 30-days-before observation and the post-decision one. The answer must be the old
    // one, because "the most recent thing we know now" is precisely the wrong question.
    const twoRows = [OBSERVATIONS[0], OBSERVATIONS[2]]
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(twoRows))
    const price = available(set, 'last_award_unit_price')
    expect(price.value).toBe(1537.85)
    expect(price.extractedAt).toBe(T_EARLY - 30 * DAY)
    expect(new Date(price.extractedAt).toISOString()).toBe('2026-05-02T00:00:00.000Z')
  })

  it('moves the answer when the decision instant moves, which is the point of the whole module', async () => {
    const before = await featuresAsOf(ENTITY, T_EARLY - 1, CTX, sourceOf(OBSERVATIONS))
    const after = await featuresAsOf(ENTITY, T_EARLY + 1, CTX, sourceOf(OBSERVATIONS))
    // One millisecond before the decision, the 1720.5 extraction had not happened yet.
    expect(available(before, 'last_award_unit_price').value).toBe(1537.85)
    // One millisecond after it, the post-award row is legitimately visible.
    expect(available(after, 'last_award_unit_price').value).toBe(9999.99)
  })

  it('refuses a non-finite as-of instant instead of comparing against it', async () => {
    // The MESSAGE is asserted, not just the type. Removing the guard also throws a RangeError,
    // from `new Date(NaN).toISOString()` several frames deeper, so a bare `toThrow(RangeError)`
    // passes against the broken build. A mutation run caught that, and this is the correction.
    await expect(featuresAsOf(ENTITY, Number.NaN, CTX, sourceOf(OBSERVATIONS))).rejects.toThrow(
      /`at` must be a finite epoch-ms instant/,
    )
    await expect(
      featuresAsOf(ENTITY, Number.POSITIVE_INFINITY, CTX, sourceOf(OBSERVATIONS)),
    ).rejects.toThrow(/`at` must be a finite epoch-ms instant/)
  })

  it('never hands the as-of instant to the source, so no adapter can filter behind our back', async () => {
    const source = sourceOf(OBSERVATIONS)
    await featuresAsOf(ENTITY, T_EARLY, CTX, source)
    expect(source.calls.map((c) => c.method)).toEqual(['definitions', 'observations'])
    for (const call of source.calls) {
      expect(call.args).toHaveLength(2)
      expect(call.args.some((a) => typeof a === 'number')).toBe(false)
    }
  })
})

describe('R3.6 the leakage canary', () => {
  it('POSITIVE CONTROL: reports clean on a set the firewall built, and says how many it checked', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    const report = detectLeakage(set, T_EARLY)
    expect(report.clean).toBe(true)
    expect(report.violations).toEqual([])
    // A green over zero inspected values is a probe that never landed. Two features are
    // available in this scenario: the price and the source class. Hand counted.
    expect(report.checked).toBe(2)
  })

  it('CATCHES a planted post-award feature in a hand-assembled set', () => {
    // This set was NOT built by `featuresAsOf`. That is deliberate: the canary's job is to catch
    // a set built by any other means, which is the only way leakage can still reach the model.
    const planted: FeatureSet = {
      entity: ENTITY,
      orgId: CTX.orgId,
      asOf: T_EARLY,
      values: [
        {
          feature: 'last_award_unit_price',
          availability: 'available',
          value: 9999.99,
          sourceDocumentId: 'FIXTURE-DOC-3',
          locator: { kind: 'field', field: 'procurement_history.unit_cost' },
          extractedAt: T_EARLY + DAY,
          asOf: T_EARLY,
          grade: 'VERIFIED',
        },
      ],
      dataGaps: [],
      withheldByAsOf: [],
      refused: [],
    }
    const report = detectLeakage(planted, T_EARLY)
    expect(report.clean).toBe(false)
    expect(report.checked).toBe(1)
    expect(report.violations).toHaveLength(1)
    const violation = report.violations[0]
    if (!violation || violation.kind !== 'value_extracted_after_as_of') {
      throw new Error('expected a value_extracted_after_as_of violation')
    }
    expect(violation.feature).toBe('last_award_unit_price')
    expect(violation.sourceDocumentId).toBe('FIXTURE-DOC-3')
    expect(violation.latenessMs).toBe(86_400_000)
    expect(violation.sentence).toContain('2026-06-02T00:00:00.000Z')
    expect(violation.sentence).toContain('must not score')
  })

  it('catches the leaky second path end to end', async () => {
    const leaked = await leakyFeaturesAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    const report = detectLeakage(leaked, T_EARLY)
    expect(report.clean).toBe(false)
    expect(report.violations.map((v) => v.kind)).toEqual(['value_extracted_after_as_of'])
  })

  it('fires on a one millisecond edit, so the instrument is not merely agreeable', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    expect(detectLeakage(set, T_EARLY).clean).toBe(true)
    const nudged: FeatureSet = {
      ...set,
      values: set.values.map((v) =>
        v.availability === 'available' && v.feature === 'last_award_unit_price'
          ? { ...v, extractedAt: v.extractedAt + 1 }
          : v,
      ),
    }
    const report = detectLeakage(nudged, T_EARLY)
    expect(report.clean).toBe(false)
    expect(report.violations).toHaveLength(1)
    const violation = report.violations[0]
    if (!violation || violation.kind !== 'value_extracted_after_as_of') {
      throw new Error('expected a value_extracted_after_as_of violation')
    }
    expect(violation.latenessMs).toBe(1)
  })

  it('flags a value whose extracted_at is not a usable timestamp at all', () => {
    // The canary validates artifacts that the source-side schema never saw, so it carries its
    // own finite check. Without it, `!(NaN > at)` reads as visible and the row clears silently.
    // This test was added after a mutation run: removing that guard broke nothing until now.
    const nonFinite: FeatureSet = {
      entity: ENTITY,
      orgId: CTX.orgId,
      asOf: T_EARLY,
      values: [
        {
          feature: 'last_award_unit_price',
          availability: 'available',
          value: 4242.42,
          sourceDocumentId: 'FIXTURE-DOC-13',
          locator: { kind: 'field', field: 'procurement_history.unit_cost' },
          extractedAt: Number.NaN,
          asOf: T_EARLY,
          grade: 'UNVERIFIED',
        },
      ],
      dataGaps: [],
      withheldByAsOf: [],
      refused: [],
    }
    const report = detectLeakage(nonFinite, T_EARLY)
    expect(report.clean).toBe(false)
    expect(report.checked).toBe(1)
    expect(report.violations).toHaveLength(1)
    const violation = report.violations[0]
    if (!violation || violation.kind !== 'value_extracted_after_as_of') {
      throw new Error('expected a value_extracted_after_as_of violation')
    }
    expect(Number.isNaN(violation.latenessMs)).toBe(true)
    // It reports rather than crashing, and it does not render NaN as a date.
    expect(violation.sentence).toContain('an unusable timestamp (NaN)')
  })

  it('refuses to clear a set that was built for a different instant', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    const report = detectLeakage(set, T_EARLY - 1)
    expect(report.clean).toBe(false)
    const kinds = report.violations.map((v) => v.kind)
    expect(kinds).toContain('set_as_of_mismatch')
    const mismatch = report.violations.find((v) => v.kind === 'set_as_of_mismatch')
    if (!mismatch || mismatch.kind !== 'set_as_of_mismatch') throw new Error('expected a mismatch')
    expect(mismatch.setAsOf).toBe(T_EARLY)
    expect(mismatch.requestedAsOf).toBe(T_EARLY - 1)
  })
})

describe('informative absence, never imputed', () => {
  it('says not_yet_published before the tool existed and absent after it, for the same feature', async () => {
    // Neither run has an observation of `observed_losing_bid`. The two answers differ anyway,
    // because absence before a publisher started is a fact about the calendar and absence after
    // it is a fact about the item. Collapsing them teaches a model that old items lack a
    // property they merely predate.
    const early = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    const late = await featuresAsOf(ENTITY, T_LATE, CTX, sourceOf(OBSERVATIONS))
    expect(unavailable(early, 'observed_losing_bid').availability).toBe('not_yet_published')
    expect(unavailable(late, 'observed_losing_bid').availability).toBe('absent')
  })

  it('says the not_yet_published gap is not resolvable by anything about the item', async () => {
    const early = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    const gap = early.dataGaps.find((g) => g.field === 'observed_losing_bid')
    if (!gap) throw new Error('expected a data gap for observed_losing_bid')
    expect(gap.whatWouldResolveIt).toContain('Nothing about this item')
    expect(gap.whatWouldResolveIt).toContain('2026-09-01T00:00:00.000Z')
    expect(gap.why).toContain('a fact about the calendar')
  })

  it('says unknown_publication_window when the publisher start date is not established', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    const v = unavailable(set, 'delivery_days_ado')
    expect(v.availability).toBe('unknown_publication_window')
    const gap = set.dataGaps.find((g) => g.field === 'delivery_days_ado')
    if (!gap) throw new Error('expected a data gap for delivery_days_ado')
    expect(gap.whatWouldResolveIt).toContain('Establish and record the date')
  })

  it('does not invent a fourth state for a firewalled observation, because that state is the future', async () => {
    // `surplus_material_flag` has no observation at all. `last_award_unit_price` has one that the
    // firewall withheld. If the withheld one produced a distinct state, the set would be telling
    // the model that a value ARRIVES LATER, which is post-decision knowledge wearing a label.
    const withheldOnly = [OBSERVATIONS[2]]
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(withheldOnly))
    expect(unavailable(set, 'last_award_unit_price').availability).toBe('absent')
    expect(unavailable(set, 'surplus_material_flag').availability).toBe('absent')
    expect(set.withheldByAsOf).toHaveLength(1)
  })

  it('never carries a value key on an unavailable feature, so `?? 0` has nothing to grab', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    const missing = set.values.filter((v) => v.availability !== 'available')
    expect(missing.map((v) => v.feature)).toEqual([
      'delivery_days_ado',
      'observed_losing_bid',
      'surplus_material_flag',
    ])
    for (const v of missing) {
      expect('value' in v).toBe(false)
      expect(v.why.length).toBeGreaterThan(0)
    }
  })

  it('files exactly one data gap per unavailable feature, and none for an available one', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    expect(set.dataGaps.map((g) => g.field)).toEqual([
      'delivery_days_ado',
      'observed_losing_bid',
      'surplus_material_flag',
    ])
    expect(set.values).toHaveLength(5)
  })
})

describe('manufacturer versus dealer, with unknown as the default', () => {
  it('defaults to unknown when nothing was ever recorded', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf([]))
    expect(sourceClassOf(set)).toBe('unknown')
    expect(SOURCE_CLASS_DEFAULT).toBe('unknown')
    expect(unavailable(set, SOURCE_CLASS_FEATURE).availability).toBe('absent')
  })

  it('reads a recorded classification that was knowable at the decision instant', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    expect(sourceClassOf(set)).toBe('dealer')
  })

  it('falls back to unknown when the only classification was extracted after the decision', async () => {
    const late = [
      obs({
        feature: SOURCE_CLASS_FEATURE,
        value: 'manufacturer',
        extractedAt: T_EARLY + 1,
        sourceDocumentId: 'FIXTURE-DOC-5',
      }),
    ]
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(late))
    // Not 'manufacturer'. We did not know it yet, and an as-of read must say so.
    expect(sourceClassOf(set)).toBe('unknown')
  })

  it('refuses a small-business status planted in the classification field, and stays unknown', async () => {
    // The rule this encodes: a large manufacturer reaches set-aside dollars through an approved
    // small-business source that can be a pass-through shell holding no shelf and adding 20 to 30
    // percent. Reading such a row as physical availability is a fabricated readiness finding.
    const planted = [
      obs({
        feature: SOURCE_CLASS_FEATURE,
        value: 'small_business',
        extractedAt: T_EARLY - DAY,
        sourceDocumentId: 'FIXTURE-DOC-6',
      }),
    ]
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(planted))
    expect(set.refused).toEqual([
      { feature: SOURCE_CLASS_FEATURE, reason: 'value_not_in_allowed_set' },
    ])
    expect(sourceClassOf(set)).toBe('unknown')
    // Refused, not coerced to the nearest enum member, and not admitted with a warning.
    expect(unavailable(set, SOURCE_CLASS_FEATURE).availability).toBe('absent')
    expect(JSON.stringify(set)).not.toContain('small_business')
  })

  it('stays unknown when a set claims the feature is absent but carries a value anyway', () => {
    // A set that arrived as JSON from a cache, a replay file or somebody's second path is not
    // type checked. This one is internally contradictory: marked absent, carrying a class. The
    // reader trusts the availability word, because that is the field that says whether we knew.
    const contradictory = {
      entity: ENTITY,
      orgId: CTX.orgId,
      asOf: T_EARLY,
      values: [
        {
          feature: SOURCE_CLASS_FEATURE,
          availability: 'absent',
          asOf: T_EARLY,
          why: 'no observation',
          value: 'manufacturer',
        },
      ],
      dataGaps: [],
      withheldByAsOf: [],
      refused: [],
    } as unknown as FeatureSet
    expect(sourceClassOf(contradictory)).toBe('unknown')
  })

  it('stays unknown even if a registry forgets to declare the allowed values', async () => {
    // `allowedValues` is optional on a definition, so the enum list is not guaranteed to be the
    // thing standing between a foreign string and this field. The reader carries its own check.
    // A mutation run proved that check was untested: with the registry list in place, nothing
    // foreign ever reached the reader.
    const noEnumList: readonly FeatureDefinition[] = DEFINITIONS.map((d) =>
      d.name === SOURCE_CLASS_FEATURE
        ? {
            name: d.name,
            publication: d.publication,
            whatWouldResolveAbsence: d.whatWouldResolveAbsence,
          }
        : d,
    )
    const source = inMemoryFeatureSource({
      definitions: noEnumList,
      observations: [
        obs({
          feature: SOURCE_CLASS_FEATURE,
          value: 'small_business',
          extractedAt: T_EARLY - DAY,
          sourceDocumentId: 'FIXTURE-DOC-14',
        }),
      ],
    })
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, source)
    // The value is admitted as a feature, because the registry allowed it.
    expect(available(set, SOURCE_CLASS_FEATURE).value).toBe('small_business')
    // The classification still refuses to become one. It is not one of the three, so it is unknown.
    expect(sourceClassOf(set)).toBe('unknown')
  })

  it('is unmoved by a set-aside indicator sitting right next to it in the same set', async () => {
    const withSetAside: readonly FeatureDefinition[] = [
      ...DEFINITIONS,
      {
        name: 'set_aside_indicator_raw',
        publication: { kind: 'always', note: 'Carried on the solicitation record.' },
        whatWouldResolveAbsence: 'Read the set-aside indicator from the solicitation record.',
      },
    ]
    const source = inMemoryFeatureSource({
      definitions: withSetAside,
      observations: [
        obs({
          feature: 'set_aside_indicator_raw',
          value: 'FIXTURE-SET-ASIDE',
          extractedAt: T_EARLY - DAY,
          sourceDocumentId: 'FIXTURE-DOC-7',
        }),
      ],
    })
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, source)
    expect(available(set, 'set_aside_indicator_raw').value).toBe('FIXTURE-SET-ASIDE')
    // The classification is not derivable from that, and the engine does not derive it.
    expect(sourceClassOf(set)).toBe('unknown')
  })
})

describe('determinism, because R3.5 needs a byte-identical replay', () => {
  it('produces identical output when the source returns the rows in the opposite order', async () => {
    const forward = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    const reversed = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf([...OBSERVATIONS].reverse()))
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward))
  })

  it('breaks an exact tie on extracted_at by document id, the same way in both input orders', async () => {
    const tied = [
      obs({ feature: 'last_award_unit_price', value: 11, extractedAt: T_EARLY - DAY, sourceDocumentId: 'FIXTURE-DOC-A' }),
      obs({ feature: 'last_award_unit_price', value: 22, extractedAt: T_EARLY - DAY, sourceDocumentId: 'FIXTURE-DOC-B' }),
    ]
    const forward = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(tied))
    const backward = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf([...tied].reverse()))
    // DOC-A sorts first, so DOC-A wins, in both orders. Never "whichever arrived first".
    expect(available(forward, 'last_award_unit_price').value).toBe(11)
    expect(available(backward, 'last_award_unit_price').value).toBe(11)
  })

  it('orders values, gaps, refusals and withholdings by name rather than by arrival', async () => {
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS))
    expect(set.values.map((v) => v.feature)).toEqual([
      'delivery_days_ado',
      'last_award_unit_price',
      'observed_losing_bid',
      'supplier_source_class',
      'surplus_material_flag',
    ])
  })
})

describe('the source is an injected boundary, so its output is checked and not trusted', () => {
  it('refuses a NaN extracted_at instead of admitting it through a naive comparison', async () => {
    // THE TRAP, stated as an assertion: `NaN > at` is false, so a firewall written as
    // `if (extractedAt > at) exclude` ADMITS a row with no usable timestamp. The structural
    // check runs first so the comparison never gets the chance.
    expect(Number.NaN > T_EARLY).toBe(false)
    const malformed = [
      obs({ feature: 'last_award_unit_price', value: 4242.42, extractedAt: Number.NaN, sourceDocumentId: 'FIXTURE-DOC-8' }),
    ]
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(malformed))
    expect(set.refused).toEqual([
      { feature: 'last_award_unit_price', reason: 'malformed_observation' },
    ])
    expect(unavailable(set, 'last_award_unit_price').availability).toBe('absent')
    expect(JSON.stringify(set)).not.toContain('4242.42')
  })

  it('refuses an observation for an entity we did not ask about', async () => {
    const other = [
      obs({
        feature: 'last_award_unit_price',
        value: 5,
        extractedAt: T_EARLY - DAY,
        sourceDocumentId: 'FIXTURE-DOC-9',
        entityId: 'FIXTURE-NSN-OTHER',
      }),
    ]
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(other))
    expect(set.refused).toEqual([{ feature: 'last_award_unit_price', reason: 'entity_mismatch' }])
    expect(unavailable(set, 'last_award_unit_price').availability).toBe('absent')
  })

  it('refuses an observation belonging to another org', async () => {
    const other = [
      obs({
        feature: 'last_award_unit_price',
        value: 6,
        extractedAt: T_EARLY - DAY,
        sourceDocumentId: 'FIXTURE-DOC-10',
        orgId: 'FIXTURE-ORG-2',
      }),
    ]
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(other))
    expect(set.refused).toEqual([{ feature: 'last_award_unit_price', reason: 'org_mismatch' }])
  })

  it('refuses a feature nobody registered, so an unreviewed column cannot reach a score', async () => {
    const stray = [
      obs({ feature: 'not_in_the_registry', value: 7, extractedAt: T_EARLY - DAY, sourceDocumentId: 'FIXTURE-DOC-11' }),
    ]
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(stray))
    expect(set.refused).toEqual([{ feature: 'not_in_the_registry', reason: 'unregistered_feature' }])
    expect(featureValue(set, 'not_in_the_registry')).toBeUndefined()
  })

  it('never names a refused value in the refusal record', async () => {
    const set = await featuresAsOf(
      ENTITY,
      T_EARLY,
      CTX,
      sourceOf([{ feature: 'last_award_unit_price', nonsense: true }]),
    )
    expect(set.refused).toEqual([
      { feature: 'last_award_unit_price', reason: 'malformed_observation' },
    ])
    expect(Object.keys(set.refused[0] ?? {}).sort()).toEqual(['feature', 'reason'])
  })

  it('strips a key the engine never asked for rather than carrying it into the set', async () => {
    const smuggled = [
      { ...obs({ feature: 'last_award_unit_price', value: 12, extractedAt: T_EARLY - DAY, sourceDocumentId: 'FIXTURE-DOC-12' }), postAwardWinner: 'FIXTURE-CAGE-Z' },
    ]
    const set = await featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(smuggled))
    expect(available(set, 'last_award_unit_price').value).toBe(12)
    expect(JSON.stringify(set)).not.toContain('postAwardWinner')
    expect(JSON.stringify(set)).not.toContain('FIXTURE-CAGE-Z')
  })

  it('throws on a registry whose publication start is not a usable instant', async () => {
    // A definition is CONFIG. A non-finite start date cannot separate the calendar from the item
    // for any row that uses it, so every absence it produces would be unreadable. Fail the build,
    // do not score thousands of rows against a window nobody can evaluate.
    const broken = [
      {
        name: 'observed_losing_bid',
        publication: { kind: 'from', startMs: Number.NaN, note: 'unset' },
        whatWouldResolveAbsence: 'x',
      } as unknown as FeatureDefinition,
    ]
    await expect(
      featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS, broken)),
    ).rejects.toThrow(/observed_losing_bid" is malformed/)
  })

  it('throws when the registry holds the same feature twice, because one of them is wrong', async () => {
    const duplicated = [...DEFINITIONS, DEFINITIONS[0] as FeatureDefinition]
    await expect(
      featuresAsOf(ENTITY, T_EARLY, CTX, sourceOf(OBSERVATIONS, duplicated)),
    ).rejects.toThrow(/registered twice/)
  })
})
