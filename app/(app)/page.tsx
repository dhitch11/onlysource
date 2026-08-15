import type { Metadata } from 'next'
import Link from 'next/link'
import { configReport } from '@/lib/env'
import { requireGateSession } from '@/lib/session/require-gate'
import { systemClock } from '@/lib/time/clock'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { buildDistressedSuppliers } from '@/lib/intelligence/suppliers/distressed'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
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
  const nq = present ? buildAllDatasets().noQuote.summary : null
  const awardIx = present ? buildNsnAwardIndex() : null
  const fcIx = present ? buildForecastIndex() : null
  const supIx = present ? buildDistressedSuppliers() : null

  // The single strongest opportunity right now: highest-scored candidate corner.
  let topCorner: { nsn: string; item: string; score: number; onForecast: boolean; price: number | null } | null = null
  if (present) {
    const ds = buildAllDatasets()
    const awardBy = awardIx?.ok ? awardIx.byNsn : null
    const fcBy = fcIx?.ok ? fcIx.byNsn : null
    let best = -1
    for (const r of ds.cornerMap.rows) {
      if (!(r.soleSource && r.silentSourceCount > 0)) continue
      const key = r.nsn.replace(/[^0-9]/g, '')
      const award = awardBy?.get(key) ?? null
      const forecast = fcBy?.get(key) ?? null
      const s = scoreCorner(r, award, forecast)
      if (s.scoreV0 > best) {
        best = s.scoreV0
        topCorner = { nsn: r.nsn, item: r.nomenclature.trim(), score: s.scoreV0, onForecast: !!forecast?.onForecast, price: award?.latest?.unitPrice ?? null }
      }
    }
  }

  const metrics: Array<{ n: string; label: string; hint: string; href: string; hot?: boolean }> = present
    ? [
        { n: (cm?.candidateCorners ?? 0).toLocaleString(), label: 'candidate corners', hint: 'sole source, award-silent, under demand', href: '/monopoly', hot: true },
        { n: (nq?.makeSideOnly ?? 0).toLocaleString(), label: 'no-quote make-side wins', hint: 'government buys nobody quoted, nobody can source', href: '/goldmine', hot: true },
        { n: (fcIx?.ok ? fcIx.counts.onForecastNsns : 0).toLocaleString(), label: 'NSNs on the DLA Forecast', hint: 'the government will buy these again', href: '/monopoly' },
        { n: (awardIx?.ok ? awardIx.counts.nsnsWithAwards : 0).toLocaleString(), label: 'NSNs with award history', hint: 'real prices and ten-year trends', href: '/monopoly' },
        { n: (supIx?.ok ? supIx.counts.tierA : 0).toLocaleString(), label: 'Tier A distressed suppliers', hint: 'dead inventory, verified contacts', href: '/suppliers', hot: true },
      ]
    : []

  return (
    <div className="stack">
      <section className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        <p className="eyebrow">Operator command center</p>
        <h1 className="h1">The market, mapped and ranked by money.</h1>
        <p className="lede">
          Live on the real DLA feed. Every number here is measured from a government file, and every
          position carries its own evidence and gaps. Start with the strongest corner, or work the
          book of business.
        </p>
      </section>

      {present ? (
        <>
          <section className="metricGrid" aria-label="Live metrics">
            {metrics.map((m) => (
              <Link key={m.label} href={m.href as never} className={`metricCard${m.hot ? ' metricCard--hot' : ''}`}>
                <span className="metricN">{m.n}</span>
                <span className="metricLabel">{m.label}</span>
                <span className="metricHint">{m.hint}</span>
              </Link>
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
        </>
      ) : (
        <section className="card">
          <div className="card__body">
            <p className="muted">
              The data directory is not mounted in this environment, so the live metrics abstain rather
              than showing a fabricated zero. They appear the moment the feed is present.
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
                  <strong>Partly estimated.</strong> The 3 business day offset is cited. These
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

      {/* ---------------------------------------------------- what is wired */}
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">What is connected</h2>
        </div>
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
      </section>

    </div>
  )
}
