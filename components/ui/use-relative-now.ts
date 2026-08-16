'use client'

import { useEffect, useState } from 'react'
import { systemClock } from '@/lib/time/clock'

/**
 * A MOUNT-STABLE CLOCK FOR RELATIVE TIME. Read this before rendering "N minutes ago" anywhere.
 *
 * ==========================================================================================
 * THE DEFECT THIS EXISTS TO PREVENT, WHICH WAS LIVE ON PRODUCTION.
 * ==========================================================================================
 * Three shared components computed relative time by calling `Date.now()` DURING RENDER:
 * `TruthStrip` ("received N minutes ago"), `ExplainButton` (its computation record) and
 * `States` ("as of N hours ago"). Each of those renders on the server and then hydrates in the
 * browser, and the two evaluations happen at different instants. The text nodes differ, React
 * throws hydration error #418, and the page is left in whatever state the mismatch produced.
 *
 * It surfaced on /design because that is where all three render with timestamps at once, but the
 * defect was in the COMPONENTS, not the page. Fixing the page alone would have moved the error
 * rather than removed it, and that is exactly what my first attempt did.
 *
 * ==========================================================================================
 * WHY NOT JUST FREEZE THE VALUE.
 * ==========================================================================================
 * Because these components exist to show HOW STALE something is, and a frozen clock makes a
 * staleness indicator lie in the one direction that matters: it would say "2 minutes ago" forever.
 *
 * So both sides render the same fixed instant on the first pass, where they must agree, and the
 * real clock is adopted immediately after mount, where there is no server tree left to disagree
 * with. The visible result is correct within one frame and correct thereafter.
 *
 * `refreshMs` re-reads the clock on an interval for surfaces where a person sits and watches the
 * value age. Off by default: a timer per component is a cost, and most of these are read once.
 */

/**
 * The instant BOTH the server render and the first client render use.
 *
 * Deliberately a constant and not a clock read. Any value works as long as the two sides agree,
 * because it is replaced on mount before a person can read it. It is fixed rather than random so
 * a server-rendered page is byte-identical across replicas, which keeps caching and diffing sane.
 */
export const HYDRATION_SAFE_INSTANT = Date.parse('2026-01-01T00:00:00.000Z')

export function useRelativeNow(refreshMs?: number): number {
  const [now, setNow] = useState<number>(HYDRATION_SAFE_INSTANT)

  useEffect(() => {
    setNow(systemClock.now())
    if (!refreshMs) return
    const id = setInterval(() => setNow(systemClock.now()), refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])

  return now
}

/**
 * Has this component adopted the real clock yet?
 *
 * Exported so a caller can render an honest placeholder for the single frame before mount rather
 * than a relative time computed from the placeholder instant, which would read as an absurd
 * duration ("received 8 months ago") for one frame on a slow device.
 */
export function useClockReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  return ready
}
