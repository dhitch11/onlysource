/**
 * THE FRESHNESS ENDPOINT ANSWERS SOMETHING TRUE EVEN WHEN THE DATABASE IT ASKS IS ABSENT.
 *
 * `/api/data-health` has returned 503 on production for its whole life: it queries an ingest
 * Postgres that does not exist on the droplet (ECONNREFUSED localhost:55432). The refusal was
 * honest and correctly worded — "a statement that we do not know, not a statement that there is
 * nothing" — and it meant THE ONE SURFACE REPORTING DATA FRESHNESS HAS NEVER ONCE ANSWERED.
 *
 * The archive is a DIFFERENT question with a different answer, and it is the one every serving
 * surface actually reads. So it is reported alongside, under its own key, with its own basis.
 *
 * ★★ THE THREE PROPERTIES THAT MAKE THIS A FIX RATHER THAN A FAIL-OPEN, ALL ASSERTED BELOW:
 *   1. `state` STAYS `offline`. The question that was asked is still unknown.
 *   2. The status STAYS 503, so a badge cannot read health from a question it did not ask.
 *   3. The archive reading is NEVER merged into `sources`. Substituting one source's reading for
 *      another's is the silent swap this estate keeps paying for.
 *
 * These tests run in exactly the production condition: no ingest Postgres is listening.
 *
 * POSITIVE CONTROL, run by hand and recorded: folding the archive reading into `sources` and
 * flipping the state to the archive's turns the first three red.
 */
import { describe, expect, it } from 'vitest'
import { hasCorpus, CORPUS_NOTE } from '../support/corpus'
import { GET } from '@/app/api/data-health/route'

describe.skipIf(!hasCorpus)('data-health with no ingest database, which is production' + CORPUS_NOTE, () => {
  it('still refuses the question it was asked, and says so', async () => {
    const res = await GET()
    expect(res.status).toBe(503)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.state).toBe('offline')
    expect(String(body.explanation)).toMatch(/do not know/i)
  })

  it('does not merge the archive reading into the ingest sources', async () => {
    // `sources` answers "what did the ingest pipeline load". The archive answers "what is the app
    // serving". A surface that reads one where it meant the other is the defect being avoided.
    const body = (await (await GET()).json()) as { sources?: unknown[] }
    expect(Array.isArray(body.sources)).toBe(true)
    expect(body.sources).toHaveLength(0)
  })

  it('reports what the archive verifiably holds, under its own basis', async () => {
    const body = (await (await GET()).json()) as {
      archive?: { basis?: string; servable?: boolean; servedFeedDay?: string | null; explanation?: string }
    }
    expect(body.archive?.basis).toBe('archive_feed_days')
    expect(body.archive?.servable).toBe(true)
    // A served day is an ISO date, never a placeholder and never the empty string.
    expect(body.archive?.servedFeedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(String(body.archive?.explanation)).toContain(String(body.archive?.servedFeedDay))
  })

  it('names the days it is holding but refusing to serve, rather than hiding them', async () => {
    // A newer day that failed verification is the single most useful thing this endpoint can say,
    // because it is the difference between "we are current" and "we are current on purpose".
    const body = (await (await GET()).json()) as {
      archive?: { heldButNotServable?: { feedDay: string; reason: string }[] }
    }
    const held = body.archive?.heldButNotServable
    expect(Array.isArray(held)).toBe(true)
    for (const d of held ?? []) {
      expect(d.feedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // A reason that does not say anything is the same as no reason.
      expect(d.reason.length).toBeGreaterThan(20)
    }
  })

  it('names which database was unreachable, without the credential', async () => {
    const body = (await (await GET()).json()) as { detail?: string }
    expect(String(body.detail)).toContain('55432')
    expect(String(body.detail)).not.toMatch(/password/i)
  })
})
