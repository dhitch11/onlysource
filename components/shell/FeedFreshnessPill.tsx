/**
 * THE CHROME FRESHNESS PILL. Owner: T2 DATA (the measurement), rendered in T8's shell.
 *
 * Server component, deliberately: the age is measured per request on the server clock and
 * shipped as static text, so there is no hydration boundary for a relative time to disagree
 * across, and nothing here renders locale-dependent text (dates are ISO, always).
 *
 * THE TONE IS COMPUTED, NEVER HARDCODED. This pill previously wore `pill--ok` as a class
 * literal, which made the chrome assert "fresh" about a feed day it had never measured; on
 * the day this was fixed, the one loaded feed day was four business days old. The tone now
 * comes from `measureFeedFreshness`: fresh (0 or 1 business day behind, the newest
 * publishable state), aging (2 or 3), stale (older). Amber and red are not used at any age;
 * they are reserved for the award clock (styles/tokens.css).
 *
 * The eye button beside it opens the plain-language explainer (help id
 * `data.feed_freshness`), whose live line names the feed day, the capture instant from the
 * manifest, the measured age, and whether a newer day is archived but not yet loaded.
 */

import { systemClock } from '@/lib/time/clock'
import {
  discoverFeedDays,
  measureFeedFreshness,
  newestCompleteFeedDay,
} from '@/lib/ingest/feed-days'
import { ExplainButton } from '@/components/ui/ExplainButton'

const TONE_CLASS = {
  fresh: 'pill--ok',
  aging: 'pill--aging',
  stale: 'pill--stale',
} as const

export function FeedFreshnessPill({ servedFeedDay }: { servedFeedDay: string | null }) {
  if (!servedFeedDay) {
    // The honest empty state: no feed is loaded, which is a fact worth a pill, not a blank.
    return (
      <>
        <span className="pill pill--stale">
          <span className="vh">Government data: </span>
          Gov data · none loaded
        </span>
        <ExplainButton
          helpId="data.feed_freshness"
          size="sm"
          sourceDetail="no feed day is loaded: the data directory or its archive manifest is absent in this environment"
        />
      </>
    )
  }

  const freshness = measureFeedFreshness(servedFeedDay, systemClock.now())
  const discovery = discoverFeedDays()
  const servedDay = discovery.days.find((d) => d.logicalDate === servedFeedDay)
  const newest = newestCompleteFeedDay(discovery)

  const capturedAt = servedDay?.in?.retrievedAt ?? null
  const behind =
    freshness.businessDaysBehind === 1
      ? '1 business day behind'
      : `${freshness.businessDaysBehind} business days behind`

  const parts = [
    `feed day ${servedFeedDay}`,
    capturedAt
      ? `captured ${capturedAt.slice(0, 16)}Z`
      : 'capture instant not recorded in the manifest',
    `${behind} as of ${freshness.measuredOn} (US federal business days, Eastern)`,
  ]
  if (newest && newest.logicalDate > servedFeedDay) {
    parts.push(`newer day ${newest.logicalDate} is archived and not yet loaded`)
  }

  return (
    <>
      <span className={`pill ${TONE_CLASS[freshness.tone]}`}>
        <span className="vh">Government data, measured age: </span>
        Gov data · {servedFeedDay} · {freshness.tone}
      </span>
      <ExplainButton helpId="data.feed_freshness" size="sm" sourceDetail={parts.join(' · ')} />
    </>
  )
}
