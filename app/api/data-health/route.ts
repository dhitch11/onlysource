import { NextResponse } from 'next/server'

import { FRESHNESS_QUERY, PG_DATABASE, PG_HOST, PG_PORT, PG_USER, client } from '@/lib/ingest/db'
import { NAMED_STATES, type NamedState } from '@/lib/ingest/types'
import { resolveServedFeedDay } from '@/lib/intelligence/feed-day'

/**
 * THE FRESHNESS CONTRACT. Every surface in the app can say when its data was last updated
 * without asking this lane, and without querying this lane's tables directly.
 *
 * Route Handlers are not cached by default in this version of Next, and this one must never
 * be: a cached freshness reading is a lie with a timestamp on it. `force-dynamic` is declared
 * explicitly rather than relied upon, because the default changing under us would be silent.
 *
 * WHAT THIS ENDPOINT REFUSES TO DO
 *
 * It never reports a zero where the truth is "unknown". If Postgres is unreachable the
 * response is `offline` with the reason attached, not an empty list of sources that a badge
 * would render as "all quiet". A data-health surface that fails open is worse than none,
 * because it converts an outage into a green light.
 */

export const dynamic = 'force-dynamic'

type SourceHealth = {
  source_key: string
  publisher_unit: string | null
  /** The date of the DATA, which is not the time of the load. */
  logical_date: string | null
  last_load_finished_at: string | null
  status: string | null
  failure_kind: string | null
  rows_loaded: number | null
  rows_quarantined: number | null
  quarantine_held: number
  /** Each carries probeLanded AND gateFired. A probe that never landed proves nothing. */
  assertions: {
    id: string
    description: string
    severity: 'reject' | 'warn'
    probeLanded: boolean
    gateFired: boolean
    passed: boolean
    expected: string
    actual: string
  }[]
  /** The resolved honest state a badge renders. Never invented at the UI layer. */
  state: NamedState
  /** Plain sentence for a non-technical expert. Not a raw timestamp. */
  explanation: string
}

/**
 * Resolve one source to the closed named-state vocabulary.
 *
 * The T+1 rule is applied here rather than in a component, because "yesterday's data is the
 * most recent complete day" is a property of the publisher, not of the badge. A surface that
 * does not know that renders correct behaviour as lateness, every single day.
 */
function resolveState(row: {
  status: string | null
  failure_kind: string | null
  assertions: SourceHealth['assertions']
  rows_loaded: number | null
}): { state: NamedState; explanation: string } {
  if (row.status === null) {
    return {
      state: 'empty',
      explanation: 'This source has never been loaded. Nothing has been ingested from it yet.',
    }
  }
  if (row.status === 'failed') {
    return {
      state: 'degraded',
      explanation: `The last load failed (${row.failure_kind ?? 'reason not recorded'}). Nothing from that attempt was committed.`,
    }
  }
  if (row.status === 'skipped_no_publish') {
    return {
      state: 'empty',
      explanation: 'The publisher did not post a file for that day. This is a stated absence, not a gap in our loading.',
    }
  }

  const blocking = row.assertions.filter((a) => a.probeLanded && !a.passed && a.severity === 'reject')
  if (blocking.length > 0) {
    return {
      state: 'degraded',
      explanation: `The load completed but ${blocking.length} correctness check(s) failed: ${blocking
        .map((a) => a.description)
        .join('; ')}.`,
    }
  }

  const contained = row.assertions.filter((a) => a.probeLanded && !a.passed && a.severity === 'warn')
  const unproven = row.assertions.filter((a) => !a.probeLanded)

  if (row.status === 'partial') {
    return {
      state: 'insufficient',
      explanation:
        'The load committed every row it could and held the rest back. ' +
        (contained.length > 0
          ? `${contained.length} known defect(s) in the published file were detected and contained. `
          : '') +
        'Held rows are listed in the quarantine with the reason each was held. Nothing was guessed.',
    }
  }

  return {
    state: 'ok',
    explanation:
      `Loaded ${row.rows_loaded ?? 0} rows with every correctness check green. ` +
      (unproven.length > 0
        ? `${unproven.length} check(s) cannot run yet and are recorded as not yet proven rather than as passing.`
        : ''),
  }
}

/**
 * Say WHY the database could not be reached, and WHICH one.
 *
 * Written because the first run of this route returned `offline` with an empty reason: a
 * `pg` connection error routinely carries an empty `message`, so `error.message` alone hands
 * an operator a red light and no lead. The target is always named. The password never is.
 */
function describeConnectionFailure(error: unknown): string {
  const target = `${PG_HOST}:${PG_PORT}/${PG_DATABASE} as ${PG_USER}`
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    const parts = [error.message, code, error.name].filter(
      (p): p is string => typeof p === 'string' && p.trim() !== '',
    )
    const reason = parts.length > 0 ? parts.join(' ') : 'the connection was refused with no reason given'
    return `${reason}. Tried ${target}.`
  }
  return `${String(error) || 'unknown failure'}. Tried ${target}.`
}

/**
 * The archive's own reading, which is what the app serves from.
 *
 * Deliberately a separate shape from `SourceHealth`: they answer different questions, and a
 * common shape would invite a surface to render one where it meant the other.
 */
function describeArchive(): {
  readonly basis: 'archive_feed_days'
  readonly servable: boolean
  readonly servedFeedDay: string | null
  readonly heldButNotServable: readonly { readonly feedDay: string; readonly reason: string }[]
  readonly explanation: string
} {
  const r = resolveServedFeedDay()
  if (!r.ok) {
    return {
      basis: 'archive_feed_days',
      servable: false,
      servedFeedDay: null,
      heldButNotServable: r.skipped.map((sk) => ({ feedDay: sk.feedDay, reason: sk.reason })),
      explanation: `No archived feed day can be served: ${r.reason}`,
    }
  }
  const skipped = r.served.skipped.map((sk) => ({ feedDay: sk.feedDay, reason: sk.reason }))
  return {
    basis: 'archive_feed_days',
    servable: true,
    servedFeedDay: r.served.feedDay,
    heldButNotServable: skipped,
    explanation:
      `The app is serving feed day ${r.served.feedDay} from the verified archive.` +
      (skipped.length > 0
        ? ` ${skipped.length} newer day(s) are held but did not pass verification and are named above.`
        : ' No newer day is held, so this is the newest the archive has.'),
  }
}

export async function GET(): Promise<NextResponse> {
  const connection = client()
  try {
    await connection.connect()
  } catch (error) {
    // The database being unreachable is a NAMED state, not an empty result and not a 500 that
    // a badge would silently swallow.
    return NextResponse.json(
      {
        state: 'offline' satisfies NamedState,
        explanation:
          'The ingest database is not reachable, so ingest freshness cannot be reported. This is ' +
          'a statement that we do not know, not a statement that there is nothing. The archive ' +
          'reading below is a DIFFERENT source and does not answer this question.',
        /*
         * ★ WHAT THE ARCHIVE VERIFIABLY HOLDS, REPORTED ALONGSIDE AND NEVER MERGED IN.
         *
         * This endpoint has returned 503 on production for its whole life, because it asks a
         * Postgres that does not exist on the droplet (ECONNREFUSED localhost:55432). The
         * refusal was honest and it meant the one surface reporting data freshness has never
         * once been able to answer.
         *
         * The archive is a different question with a different answer: it is what every serving
         * surface actually reads, and `resolveServedFeedDay` verifies its captures rather than
         * trusting a manifest. So it is reported HERE, under its own key, with its own basis
         * stated. It is NOT folded into `sources`, and the state stays `offline`, because
         * substituting one source's reading for another's is precisely the silent swap this
         * estate keeps paying for. A badge must not read "healthy" from a question it did not
         * ask.
         *
         * The status stays 503 for the same reason: the thing that was asked about is still
         * unknown.
         */
        archive: describeArchive(),
        // A connection error from `pg` frequently carries an EMPTY message, which would leave
        // an operator with "offline" and no reason at 6am. Fall back through the error's code
        // and name, and always state WHICH database was unreachable. Never the password.
        detail: describeConnectionFailure(error),
        sources: [],
        vocabulary: NAMED_STATES,
      },
      { status: 503 },
    )
  }

  try {
    const result = await connection.query<{
      source_key: string
      publisher_unit: string | null
      logical_date: Date | null
      last_load_finished_at: Date | null
      status: string | null
      failure_kind: string | null
      rows_loaded: string | null
      rows_quarantined: string | null
      quarantine_held: string
      assertions: SourceHealth['assertions'] | null
    }>(FRESHNESS_QUERY)

    const sources: SourceHealth[] = result.rows.map((row) => {
      const assertions = row.assertions ?? []
      const rowsLoaded = row.rows_loaded === null ? null : Number(row.rows_loaded)
      const { state, explanation } = resolveState({
        status: row.status,
        failure_kind: row.failure_kind,
        assertions,
        rows_loaded: rowsLoaded,
      })
      return {
        source_key: row.source_key,
        publisher_unit: row.publisher_unit,
        logical_date: row.logical_date ? row.logical_date.toISOString().slice(0, 10) : null,
        last_load_finished_at: row.last_load_finished_at
          ? row.last_load_finished_at.toISOString()
          : null,
        status: row.status,
        failure_kind: row.failure_kind,
        rows_loaded: rowsLoaded,
        rows_quarantined: row.rows_quarantined === null ? null : Number(row.rows_quarantined),
        quarantine_held: Number(row.quarantine_held),
        assertions,
        state,
        explanation,
      }
    })

    // The worst state across sources, so a single badge can be honest without hiding detail.
    const order: NamedState[] = ['ok', 'insufficient', 'stale', 'degraded', 'empty', 'offline']
    const overall =
      sources.length === 0
        ? ('empty' satisfies NamedState)
        : sources
            .map((s) => s.state)
            .sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? 'empty'

    return NextResponse.json({
      state: overall,
      sources,
      vocabulary: NAMED_STATES,
      note:
        'The daily government feed is T+1 by the publisher design: records append to the current ' +
        "day's file during business hours and the complete file publishes the next day. A " +
        'same-day gap is correct behaviour and must never be rendered as lateness.',
    })
  } finally {
    await connection.end()
  }
}
