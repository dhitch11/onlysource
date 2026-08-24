/**
 * H10 — SCORE ONE OR MORE STOCK NUMBERS OFFLINE, THROUGH THE SERVING PATH'S OWN CALLS.
 *
 * There was no way to score an NSN outside a request. That is why a four-defect regression could
 * only be argued about instead of re-derived, so this exists before the fixes do.
 *
 * It deliberately mirrors `app/(app)/corner/[nsn]/page.tsx` call for call: buildAllDatasets ->
 * find the corner row -> buildNsnAwardIndex + buildForecastIndex -> scoreCorner with the same
 * `sources` flags. It does NOT re-parse the workbooks itself. A harness with its own parser is a
 * second implementation that will drift from the one that ships, and then disagree with it at the
 * worst moment.
 *
 * It records the DATA ROOT and the FEED DAY it was built from, because a before/after comparison
 * whose two halves came from different corpora is not a comparison.
 *
 * Usage: npx tsx scripts/score-nsn.mts 5340-01-608-5969 [more NSNs...]
 *        npx tsx scripts/score-nsn.mts --json 5340-01-608-5969   (JSON only, for fixtures)
 */
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { awardHistoryState, buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { readQuoteSignals } from '@/lib/intelligence/scoring/quote-signals'

const argv = process.argv.slice(2)
const jsonOnly = argv.includes('--json')
const nsns = argv.filter((a) => !a.startsWith('--'))
if (nsns.length === 0) {
  console.error('usage: npx tsx scripts/score-nsn.mts <nsn> [nsn...]  [--json]')
  process.exit(2)
}

const root = resolveDataRoot()
const { cornerMap, feed } = buildAllDatasets()
const awardIx = buildNsnAwardIndex()
const fcIx = buildForecastIndex()

const out: unknown[] = []
for (const raw of nsns) {
  const key = raw.replace(/[^0-9]/g, '')
  const row = cornerMap.rows.find((r) => r.nsn.replace(/[^0-9]/g, '') === key)
  if (!row) {
    out.push({ nsn: raw, key, found: false, reason: 'not in this feed day\'s corner map' })
    continue
  }
  const award = awardIx.ok ? awardIx.byNsn.get(key) ?? null : null
  const forecast = fcIx.ok ? fcIx.byNsn.get(key) ?? null : null
  const score = scoreCorner(row, award, forecast, {
    awardIndexLoaded: awardIx.ok,
    forecastIndexLoaded: fcIx.ok,
  })
  const signals =
    award && awardIx.ok
      ? readQuoteSignals(award, awardIx.window, awardHistoryState(awardIx, key)).map((s) => ({
          id: s.id,
          label: s.label,
          state: s.leg.state,
          value: 'value' in s.leg ? (s.leg as { value: unknown }).value : null,
          reading: s.reading,
          direction: s.direction,
        }))
      : []
  out.push({
    nsn: row.nsn,
    key,
    found: true,
    scoreV0: score.scoreV0,
    disposition: score.disposition,
    grade: score.grade,
    // The whole point of the harness: every leg, every reason, every point.
    reasons: score.reasons.map((r) => ({ leg: r.leg, facet: r.facet ?? null, points: r.points, calibration: r.calibration, plain: r.plain })),
    pointsSum: score.reasons.reduce((s, r) => s + r.points, 0),
    legStates: Object.fromEntries(Object.entries(score.legs).map(([k, v]) => [k, v.state])),
    dataGaps: score.dataGaps,
    row: {
      soleSource: row.soleSource,
      approvedSources: row.approvedSources,
      approvedSourceCount: row.approvedSourceCount,
      silentSourceCount: row.silentSourceCount,
      signals: row.signals,
      automatedSolicitation: row.automatedSolicitation,
      quantity: row.quantity,
      solicitation: row.solicitation,
    },
    award: award
      ? {
          awardCount: award.awards.length,
          distinctAwardees: award.distinctAwardees,
          latestCage: award.latest?.cage ?? null,
          latestCompany: award.latest?.company ?? null,
          latestOffers: award.latestOffers,
          minOffers: award.minOffers,
          amc: award.amc,
          amsc: award.amsc,
          ltcExpirationIso: award.ltcExpirationIso,
          approvedSourceCages: award.approvedSources.map((s) => s.cage),
          awardCages: [...new Set(award.awards.map((a) => a.cage))],
        }
      : null,
    quoteSignals: signals,
  })
}

const payload = {
  harness: 'scripts/score-nsn.mts',
  dataRoot: root.root,
  dataRootBasis: root.basis,
  feedDay: feed?.feedDay ?? null,
  awardIndexLoaded: awardIx.ok,
  forecastIndexLoaded: fcIx.ok,
  cornerMapRows: cornerMap.rows.length,
  results: out,
}
console.log(JSON.stringify(payload, null, 2))
if (!jsonOnly) {
  console.error('\n--- summary (stderr, so stdout stays clean JSON) ---')
  for (const r of out as Array<Record<string, unknown>>) {
    if (!r.found) { console.error(`${r.nsn}  NOT FOUND: ${r.reason}`); continue }
    console.error(`${r.nsn}  score=${r.scoreV0}  grade=${r.grade}  disposition=${r.disposition}`)
    for (const x of r.reasons as Array<Record<string, unknown>>) {
      console.error(`    ${String(x.points).padStart(4)}  ${x.leg}${x.facet ? '·' + x.facet : ''}  ${x.plain}`)
    }
  }
}
