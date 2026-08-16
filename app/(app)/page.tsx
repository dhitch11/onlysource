import type { Metadata } from 'next'
import Link from 'next/link'
import path from 'node:path'
import { configReport } from '@/lib/env'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { PursueButton } from '@/components/sales/PursueButton'
import { requireGateSession } from '@/lib/session/require-gate'
import { systemClock } from '@/lib/time/clock'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { buildDistressedSuppliers } from '@/lib/intelligence/suppliers/distressed'
import { buildMonopolyView } from '@/lib/intelligence/monopoly-view'
import { computeSignals } from '@/lib/notify/signals'
import { readDeals } from '@/lib/sales/deals-store'
import { normalizeDealRef, PIPELINE_STAGES, STAGE_LABEL } from '@/lib/sales/pipeline'
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

  /*
   * THE PIPELINE IN MINIATURE (the flagship thread). Three real reads:
   *   1. the operator's stored deals, counted by stage, never estimated;
   *   2. the refs already pursued, so the strongest corner offered below is genuinely the
   *      strongest UNPURSUED one (offering a corner already in the pipeline is noise);
   *   3. that corner's measured facts, so its Pursue button carries an honest modeled value.
   */
  const deals = readDeals()
  const pursued = new Set(deals.map((d) => normalizeDealRef(d.ref)).filter(Boolean))
  const stageCounts = PIPELINE_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    count: deals.filter((d) => d.stage === stage).length,
  }))

  // The single strongest UNPURSUED opportunity right now: highest-scored candidate corner
  // not already in the pipeline. Read from the same memoized view /monopoly renders, so the
  // two surfaces cannot disagree and the dashboard stops re-scoring 2,141 rows per visit.
  let topCorner: {
    nsn: string
    niin: string
    item: string
    score: number
    onForecast: boolean
    price: number | null
    quantity: number | null
  } | null = null
  let candidateCount = 0
  if (present) {
    const view = buildMonopolyView()
    let best = -1
    for (const r of view.rows) {
      if (!(r.soleSource && r.silentSourceCount > 0)) continue
      candidateCount += 1
      if (pursued.has(normalizeDealRef(r.nsn))) continue
      if (r.score.scoreV0 > best) {
        best = r.score.scoreV0
        topCorner = {
          nsn: r.nsn,
          niin: r.niin,
          item: r.nomenclature.trim(),
          score: r.score.scoreV0,
          onForecast: !!r.forecast?.onForecast,
          price: r.award?.latestPrice ?? null,
          quantity: r.quantity,
        }
      }
    }
  }

  /** Pursue facts for a signal card that names one NSN: joined from the same view. */
  const pursueFactsFor = (nsn: string) => {
    if (!present) return null
    const r = buildMonopolyView().rows.find((x) => x.nsn === nsn)
    if (!r) return null
    return {
      niin: r.niin,
      item: r.nomenclature.trim(),
      valueUsd:
        r.quantity != null && r.award?.latestPrice != null && r.award.latestPrice > 0
          ? r.quantity * r.award.latestPrice
          : null,
      initiallyInPipeline: pursued.has(normalizeDealRef(r.nsn)),
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

      {/* -------------------------------------------- how this system works, in one line.
        * Each word is a real link to that stage's first surface. Close is the paperwork:
        * a quote goes out and a purchase order comes back, which lives in Documents. */}
      <nav className="flowStrip" aria-label="How this system works">
        <span className="flowStrip__lead">How this system works:</span>
        <Link href={'/monopoly' as never} className="flowStrip__step">Find</Link>
        <span className="flowStrip__arrow" aria-hidden="true">→</span>
        <Link href={'/intelligence' as never} className="flowStrip__step">Decide</Link>
        <span className="flowStrip__arrow" aria-hidden="true">→</span>
        <Link href={'/sales' as never} className="flowStrip__step">Pursue</Link>
        <span className="flowStrip__arrow" aria-hidden="true">→</span>
        <Link href={'/documents' as never} className="flowStrip__step">Close</Link>
        <span className="flowStrip__note">
          Find a part worth owning, check the evidence, press Pursue, then quote it and paper it.
        </span>
      </nav>

      {/* -------------------------------------------- the pipeline in miniature.
        * The strongest corner nobody has pursued yet, beside the real count of deals in
        * each stage. Both are reads: the corner from the same memoized view /monopoly
        * renders, the counts from the stored pipeline itself. */}
      {present && topCorner ? (
        <section className="pipeMini" aria-label="The pipeline in miniature">
          <div className="topCorner topCorner--withAction">
            <div className="metricHelp">
              <ExplainButton helpId="pursuit.modeled_buy_value" size="sm" />
            </div>
            <Link href={`/corner/${topCorner.nsn.replace(/[^0-9]/g, '')}` as never} className="topCorner__body">
              <span className="topCorner__eyebrow">Strongest position nobody has pursued</span>
              <span className="topCorner__nsn mono">{topCorner.nsn}</span>
              <span className="topCorner__item">{topCorner.item || 'not described on this line'}</span>
              <span className="topCorner__meta">
                CornerScore <b>{topCorner.score}</b>
                {topCorner.onForecast ? ' · on the DLA Forecast' : ''}
                {topCorner.price != null ? ` · last award $${topCorner.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
              </span>
            </Link>
            <div className="topCorner__act">
              <PursueButton
                appearance="primary"
                nsn={topCorner.nsn}
                niin={topCorner.niin}
                item={topCorner.item}
                valueUsd={
                  topCorner.quantity != null && topCorner.price != null && topCorner.price > 0
                    ? topCorner.quantity * topCorner.price
                    : null
                }
                initiallyInPipeline={false}
              />
            </div>
          </div>

          <div className="stageStrip">
            <div className="stageStrip__head">
              <span className="stageStrip__title">Your pipeline</span>
              <ExplainButton helpId="pursuit.stage_counts" size="sm" />
            </div>
            <div className="stageStrip__stages">
              {stageCounts.map((s) => (
                <Link key={s.stage} href={'/sales' as never} className="stageStrip__stage">
                  <span className="stageStrip__n mono">{s.count}</span>
                  <span className="stageStrip__label">{s.label}</span>
                </Link>
              ))}
            </div>
            <span className="stageStrip__foot">
              {deals.length === 0
                ? 'Nothing pursued yet. Press Pursue on any find to start.'
                : `${deals.length.toLocaleString()} deal${deals.length === 1 ? '' : 's'}, counted from your stored pipeline.`}
            </span>
          </div>
        </section>
      ) : present && candidateCount > 0 ? (
        /* Every candidate corner is already a deal: an honest state, said plainly. */
        <section className="pipeMini pipeMini--allPursued" aria-label="The pipeline in miniature">
          <p className="muted">
            All {candidateCount.toLocaleString()} candidate corners are already in your pipeline.
            Work them in <Link href={'/sales' as never}>Pipeline</Link>.
          </p>
        </section>
      ) : null}

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

          {/* -------------------------------------------- what needs attention today.
            * A card that names exactly one stock number carries the pursuit wire: the
            * Pursue sits as a SIBLING of the link (a button inside an anchor is invalid
            * and a coin-toss click), with the same measured facts the grids use.
            * Aggregate cards (the cutoff, the no-quote total) carry no part-level action,
            * honestly: there is no one part to pursue. */}
          {signals.length > 0 ? (
            <section className="signalBlock" aria-label="What needs your attention">
              <h2 className="signalBlock__title">What needs your attention today</h2>
              <div className="signalGrid">
                {signals.map((s) => {
                  const facts = s.nsn ? pursueFactsFor(s.nsn) : null
                  return (
                    <div key={s.id} className={`signalCard signalCard--${s.severity}${facts ? ' signalCard--withAction' : ''}`}>
                      <Link href={s.href as never} className="signalCard__link">
                        <span className="signalCard__sev">
                          {s.severity === 'high' ? 'Act now' : s.severity === 'medium' ? 'Worth an hour' : 'Good to know'}
                        </span>
                        <span className="signalCard__title">{s.title}</span>
                        <span className="signalCard__body">{s.body}</span>
                        <span className="signalCard__go">Open →</span>
                      </Link>
                      {facts && s.nsn ? (
                        <div className="signalCard__act">
                          <PursueButton
                            nsn={s.nsn}
                            niin={facts.niin}
                            item={facts.item}
                            valueUsd={facts.valueUsd}
                            initiallyInPipeline={facts.initiallyInPipeline}
                          />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
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
