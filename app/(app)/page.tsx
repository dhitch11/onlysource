import type { Metadata } from 'next'
import Link from 'next/link'
import path from 'node:path'
import { configReport } from '@/lib/env'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { requireGateSession } from '@/lib/session/require-gate'
import { systemClock } from '@/lib/time/clock'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { buildDistressedSuppliers } from '@/lib/intelligence/suppliers/distressed'
import { buildMonopolyView } from '@/lib/intelligence/monopoly-view'
import { computeSignals } from '@/lib/notify/signals'
import {
  AWARD_CLOCK,
  AWARD_CLOCK_PROVENANCE,
  CUTOFF_SWEEPS,
  deadlineDisclosure,
  formatInZone,
  nextDailyFireFrom,
} from '@/lib/domain/award-clock'

export const metadata: Metadata = { title: 'Workspace · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

/**
 * The empty authenticated workspace.
 *
 * IT IS EMPTY AND IT SAYS SO. There is no placeholder requirement, no sample score, no
 * greyed-out control that would work later. Everything on this page is either computed by
 * this build or read from this build's own configuration, and every number carries the file
 * it came from.
 *
 * The award clock is here because it is the one thing the foundation genuinely owns and
 * genuinely knows on day one, and because rendering it exercises the labeled-unconfirmed
 * state that gate R1.2 requires of every customer-facing deadline.
 */
export default async function WorkspacePage() {
  await requireGateSession('/')

  const report = configReport()
  const fire = nextDailyFireFrom(systemClock)
  const disclosure = deadlineDisclosure(fire.instantMs)

  // Live command-center metrics. Computed from the real data on disk; when the data directory is
  // absent every figure abstains rather than showing a fabricated zero.
  const present = resolveDataRoot().present
  const cm = present ? buildAllDatasets().cornerMap.summary : null
  // The feed day the whole workspace is reading. The hero names it because "live" would be a
  // claim about freshness this snapshot cannot make; the honest sentence names the day.
  const feedDay = present ? buildAllDatasets().cornerMap.provenance.feedDay : null
  const nq = present ? buildAllDatasets().noQuote.summary : null
  const signals = present ? computeSignals().signals : []
  const awardIx = present ? buildNsnAwardIndex() : null
  const fcIx = present ? buildForecastIndex() : null
  const supIx = present ? buildDistressedSuppliers() : null

  // The single strongest opportunity right now: highest-scored candidate corner. Read from
  // the same memoized view /monopoly renders, so the two surfaces cannot disagree and the
  // dashboard stops re-scoring 2,141 rows on every visit.
  let topCorner: { nsn: string; item: string; score: number; onForecast: boolean; price: number | null } | null = null
  if (present) {
    const view = buildMonopolyView()
    let best = -1
    for (const r of view.rows) {
      if (!(r.soleSource && r.silentSourceCount > 0)) continue
      if (r.score.scoreV0 > best) {
        best = r.score.scoreV0
        topCorner = {
          nsn: r.nsn,
          item: r.nomenclature.trim(),
          score: r.score.scoreV0,
          onForecast: !!r.forecast?.onForecast,
          price: r.award?.latestPrice ?? null,
        }
      }
    }
  }

  /*
   * The provenance line each tile's explainer shows: the actual files this instance counted
   * from plus the feed day, read from the same provenance objects the builders return. It is
   * passed live (never typed into static help text) so it can never go stale against the data.
   */
  const base = (p: string) => path.basename(p)
  const feedNote = feedDay ? `feed day ${feedDay}` : 'no feed loaded'
  const nqProv = present ? buildAllDatasets().noQuote.provenance : null
  const cmProv = present ? buildAllDatasets().cornerMap.provenance : null
  const nsnNowFiles = (awardIx?.ok ? awardIx.provenance : fcIx?.ok ? fcIx.provenance : []).map((p) => base(p.path))
  const nsnNowNote =
    nsnNowFiles.length > 0
      ? `${nsnNowFiles.length} NSN-Now export workbook${nsnNowFiles.length === 1 ? '' : 's'} (${nsnNowFiles[0]} … ${nsnNowFiles[nsnNowFiles.length - 1]})`
      : 'no NSN-Now export on disk'

  const metrics: Array<{
    n: string
    label: string
    hint: string
    href: string
    hot?: boolean
    helpId: string
    sourceDetail: string
  }> = present
    ? [
        {
          n: (cm?.candidateCorners ?? 0).toLocaleString(),
          label: 'candidate corners',
          hint: 'sole source, under open demand, award-silent',
          href: '/monopoly',
          hot: true,
          helpId: 'monopoly.candidate_corner',
          sourceDetail: `Counted from ${cmProv?.sourceArchiveKey ?? 'the daily archive'} · ${feedNote}`,
        },
        {
          n: (nq?.makeSideOnly ?? 0).toLocaleString(),
          label: 'no-quote make-side wins',
          hint: 'government buys nobody quoted, nobody can source',
          href: '/goldmine',
          hot: true,
          helpId: 'capability.no_quote',
          sourceDetail: `Counted from ${nqProv ? base(nqProv.solicitations.path) : '?'} joined to ${nqProv ? base(nqProv.availability.path) : '?'} · workspace ${feedNote}`,
        },
        {
          n: (fcIx?.ok ? fcIx.counts.onForecastNsns : 0).toLocaleString(),
          label: 'NSNs on the DLA Forecast',
          hint: 'the government will buy these again',
          href: '/monopoly',
          helpId: 'monopoly.forecast_nsns',
          sourceDetail: `Counted from the DLA Forecast sheets of ${nsnNowNote} · workspace ${feedNote}`,
        },
        {
          n: (awardIx?.ok ? awardIx.counts.nsnsWithAwards : 0).toLocaleString(),
          label: 'NSNs with award history',
          hint: 'real prices and ten-year trends',
          href: '/monopoly',
          helpId: 'monopoly.award_history_nsns',
          sourceDetail: `Counted from the procurement history sheets of ${nsnNowNote} · workspace ${feedNote}`,
        },
        {
          n: (supIx?.ok ? supIx.counts.tierA : 0).toLocaleString(),
          label: 'Tier A distressed suppliers',
          hint: 'dead inventory, verified contacts',
          href: '/suppliers',
          hot: true,
          helpId: 'monopoly.distressed_tier_a',
          sourceDetail: `Counted from ${supIx?.ok ? supIx.provenance.map((p) => base(p.path)).join(' + ') : 'the researched workbook'} · workspace ${feedNote}`,
        },
      ]
    : []

  return (
    <div className="stack">
      <section className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="eyebrow">Operator command center</p>
        <h1 className="h1">The market, mapped and ranked by money.</h1>
        <p className="lede">
          {feedDay
            ? `Built from the real DLA files for feed day ${feedDay}. `
            : 'Built from the real DLA files; no feed is loaded here yet. '}
          Every number here is measured from a government file, and every position carries its own
          evidence and gaps. Start with the strongest corner, or work the book of business.
        </p>
      </section>

      {present ? (
        <>
          <section className="metricGrid" aria-label="Live metrics">
            {/*
             * Each tile is a wrapper holding a full-bleed Link plus the eye-in-circle
             * explainer as a SIBLING, never a child, of the anchor: a button nested inside a
             * link is invalid markup and a coin-toss click. The explainer names the source
             * file, the count method, and the feed day for the number under it.
             */}
            {metrics.map((m) => (
              <div key={m.label} className={`metricCard metricCard--withHelp${m.hot ? ' metricCard--hot' : ''}`}>
                {/* div, not span: the explainer's popover is a <div>, invalid inside a span. */}
                <div className="metricHelp">
                  <ExplainButton helpId={m.helpId} size="sm" sourceDetail={m.sourceDetail} />
                </div>
                <Link href={m.href as never} className="metricCard__body">
                  <span className="metricN">{m.n}</span>
                  <span className="metricLabel">{m.label}</span>
                  <span className="metricHint">{m.hint}</span>
                </Link>
              </div>
            ))}
          </section>

          {topCorner ? (
            <Link href={'/monopoly' as never} className="topCorner">
              <span className="topCorner__eyebrow">Strongest position right now</span>
              <span className="topCorner__nsn mono">{topCorner.nsn}</span>
              <span className="topCorner__item">{topCorner.item}</span>
              <span className="topCorner__meta">
                CornerScore <b>{topCorner.score}</b>
                {topCorner.onForecast ? ' · on the DLA Forecast' : ''}
                {topCorner.price != null ? ` · last award $${topCorner.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
              </span>
            </Link>
          ) : null}

          {/* -------------------------------------------- what needs attention today */}
          {signals.length > 0 ? (
            <section className="signalBlock" aria-label="What needs your attention">
              <h2 className="signalBlock__title">What needs your attention today</h2>
              <div className="signalGrid">
                {signals.map((s) => (
                  <Link key={s.id} href={s.href as never} className={`signalCard signalCard--${s.severity}`}>
                    <span className="signalCard__sev">
                      {s.severity === 'high' ? 'Act now' : s.severity === 'medium' ? 'Worth an hour' : 'Good to know'}
                    </span>
                    <span className="signalCard__title">{s.title}</span>
                    <span className="signalCard__body">{s.body}</span>
                    <span className="signalCard__go">Open →</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <section className="card">
          <div className="card__body">
            <p className="muted">
              Today&rsquo;s government data hasn&rsquo;t loaded yet. Every number here is built straight
              from the live DLA files, so nothing shows until the feed is in, no guesses and no
              placeholders. It fills in the moment the data lands.
            </p>
          </div>
        </section>
      )}

      {/* --------------------------------------------------------- the clock */}
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Next award cutoff</h2>
        </div>
        <div className="card__body stack stack--tight">
          {disclosure.estimated ? (
            <div className="banner banner--attention" role="note">
              <div>
                <p>
                  <strong>Partly estimated.</strong> The offset and the timezone are cited. These
                  parts are not:
                </p>
                <ul className="bullets">
                  {disclosure.qualifiers.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <dl className="rows">
            <div className="row">
              <dt className="row__key">Next fire</dt>
              <dd className="row__val mono">{formatInZone(fire.instantMs)}</dd>
            </div>
            <div className="row">
              <dt className="row__key">As a UTC instant</dt>
              <dd className="row__val mono">{new Date(fire.instantMs).toISOString()}</dd>
            </div>
            <div className="row">
              <dt className="row__key">Staged sweeps</dt>
              <dd className="row__val mono">
                {CUTOFF_SWEEPS.map((s) => (
                  <div key={s.key}>
                    {s.key}
                    {'  '}
                    {new Date(fire.sweeps[s.key]).toISOString()}
                  </div>
                ))}
              </dd>
            </div>
            <div className="row">
              <dt className="row__key">Rule</dt>
              <dd className="row__val">
                {String(AWARD_CLOCK.localTime.hour).padStart(2, '0')}:
                {String(AWARD_CLOCK.localTime.minute).padStart(2, '0')} wall clock in{' '}
                <span className="mono">{AWARD_CLOCK.zone}</span>,{' '}
                <strong>{AWARD_CLOCK.citedBusinessDaysAfterIssue} business days after issue</strong>,
                skipping weekends and observed federal holidays. We act{' '}
                {AWARD_CLOCK.operationalMarginBusinessDays} business day earlier. Stored as a local
                time plus a zone, never as a fixed offset.
              </dd>
            </div>
          </dl>

          <details>
            <summary className="label" style={{ cursor: 'pointer' }}>
              Where this number came from, and which parts of it are proven
            </summary>
            <div className="stack--tight" style={{ paddingTop: 'var(--s-2)' }}>
              <p className="muted">
                <strong>What it is.</strong> The deadline the automated award program works
                from. Everything in this product that has to file something is bound by it.
              </p>
              <p className="muted">
                <strong>Where it is computed.</strong>{' '}
                <span className="mono">lib/domain/award-clock.ts</span>, which is the only copy of
                this constant in the codebase. Display and scheduling both read it.
              </p>
              <p className="muted">
                <strong>Three parts, three evidence grades.</strong> They are reported separately
                because a single hedge would understate a fact that is cited and overstate one
                that is not.
              </p>
              <dl className="rows">
                {(
                  [
                    ['Offset', AWARD_CLOCK_PROVENANCE.offset],
                    ['Timezone', AWARD_CLOCK_PROVENANCE.timezone],
                    ['Counting convention', AWARD_CLOCK_PROVENANCE.countingConvention],
                  ] as const
                ).map(([name, part]) => (
                  <div className="row" key={name}>
                    <dt className="row__key">{name}</dt>
                    <dd className="row__val">
                      <span
                        className={`pill ${part.grade === 'CITED' ? 'pill--ok' : 'pill--attention'}`}
                      >
                        {part.grade}
                      </span>{' '}
                      <span className="muted">{part.value}. </span>
                      {part.citation ? (
                        <span className="mono">{part.citation}</span>
                      ) : (
                        <span className="muted">{part.note}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </details>
        </div>
      </section>

      {/* -------------------------------------------- system status (tucked away) */}
      <details className="card">
        <summary className="card__head" style={{ cursor: 'pointer' }}>
          <h2 className="card__title" style={{ display: 'inline' }}>System status</h2>
        </summary>
        <div className="card__body">
          <dl className="rows">
            {Object.entries(report.subsystems).map(([key, value]) => (
              <div className="row" key={key}>
                <dt className="row__key">
                  <span className="mono">{key}</span>
                </dt>
                <dd className="row__val">
                  <span
                    className={`pill ${value.status === 'configured' ? 'pill--ok' : 'pill--off'}`}
                  >
                    {value.status === 'configured' ? 'connected' : 'not connected'}
                  </span>{' '}
                  <span className="muted">{value.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </details>

    </div>
  )
}
