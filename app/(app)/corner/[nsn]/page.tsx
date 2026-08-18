import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { buildCornerDossier, priceSeries } from '@/lib/intelligence/brief/dossier'
import { dispositionLabel } from '@/lib/intelligence/scoring/evidence-state'
import { PriceSparkline } from '@/components/ui/PriceSparkline'
import { StatusChip } from '@/components/ui/StatusChip'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { PursueButton } from '@/components/sales/PursueButton'
import { PursuitPackagePanel } from '@/components/sales/PursuitPackagePanel'
import { findDealByRef } from '@/lib/sales/deals-store'
import { aiConfigured } from '@/lib/ai/anthropic'
import { sendPreflight } from '@/lib/notify/email'
import { readSettings } from '@/lib/notify/settings'
import { Scrollable } from '@/components/ui/Scrollable'
import { AiBrief } from './AiBrief'
import styles from './corner.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ nsn: string }>
}): Promise<Metadata> {
  const { nsn } = await params
  return { title: `${nsn} · Corner dossier · ONLYSOURCE` }
}

const usd = (n: number | null): string =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const LEG_LABEL: Record<string, string> = {
  demand: 'Demand',
  competition: 'Competition',
  path: 'Award path',
  priceAnchor: 'Price anchor',
  forwardDemand: 'Forward demand',
  feasibility: 'Feasibility',
}

/**
 * Micro-explainers on specific score signals. Keyed on `leg` alone or `leg·facet`, so the
 * jargon-heavy cards (the flat surplus evaluated adder, the unwired ILS feed) carry the
 * eye-in-circle affordance the house requires on every metric.
 */
const REASON_HELP: Record<string, string> = {
  'priceAnchor·surplus drag': 'monopoly.surplus_drag',
  feasibility: 'monopoly.ils',
}

/**
 * THE CORNER DOSSIER PAGE.
 *
 * One stock number, read all the way down: the real price trajectory, the whole award history, the
 * forecast demand, the score decomposed into its five evidence-graded legs, and the open gaps. On
 * top of that sits the AI opportunity brief, which is written only from the same measured dossier
 * this page renders. Nothing here is estimated to fill a gap; an unread leg says it is unread.
 */
export default async function CornerPage({ params }: { params: Promise<{ nsn: string }> }) {
  await requireGateSession('/monopoly')
  const { nsn: nsnParam } = await params
  const key = decodeURIComponent(nsnParam).replace(/[^0-9]/g, '')

  const root = resolveDataRoot()
  if (!root.present) {
    return (
      <main className={styles.page}>
        <Link href={'/monopoly' as never} className={styles.back}>
          ← Monopoly Map
        </Link>
        <div className={styles.unavailable}>
          <h1 className={styles.unavailableTitle}>The data directory is not mounted here</h1>
          <p>This dossier is computed from the government feed files, and this environment has none.</p>
        </div>
      </main>
    )
  }

  const { cornerMap } = buildAllDatasets()
  const row = cornerMap.rows.find((r) => r.nsn.replace(/[^0-9]/g, '') === key)
  if (!row) {
    // An honest in-shell message rather than a bare 404. (A streamed shell means notFound() would
    // land after the layout flushes and read as a blank page, so this is both clearer and correct.)
    return (
      <main className={styles.page}>
        <Link href={'/monopoly' as never} className={styles.back}>
          ← Monopoly Map
        </Link>
        <div className={styles.unavailable}>
          <h1 className={styles.unavailableTitle}>That stock number isn&rsquo;t in this feed</h1>
          <p>
            No dossier exists for <span className="mono">{decodeURIComponent(nsnParam)}</span> in today&rsquo;s
            data. It may not be a sole-source position, or it may not appear on this feed day. Head back to
            the Monopoly Map to find the corners that are here.
          </p>
        </div>
      </main>
    )
  }

  const awardIx = buildNsnAwardIndex()
  const fcIx = buildForecastIndex()
  const award = awardIx.ok ? awardIx.byNsn.get(key) ?? null : null
  const forecast = fcIx.ok ? fcIx.byNsn.get(key) ?? null : null
  const score = scoreCorner(row, award, forecast, {
    awardIndexLoaded: awardIx.ok,
    forecastIndexLoaded: fcIx.ok,
  })
  const dossier = buildCornerDossier(row, award, forecast, score, awardIx.ok ? awardIx.window : undefined)
  const series = priceSeries(dossier)

  // THE PURSUIT WIRE: the dossier's primary action. The modeled buy value is quantity x the
  // latest measured award unit price, only when both are on record; otherwise the deal is
  // created honestly valueless. Pursued state reads from the real store on every visit.
  const latestUnit = award?.latest?.effectiveUnitPrice ?? null
  const modeledBuyValue =
    row.quantity != null && latestUnit != null && latestUnit > 0 ? row.quantity * latestUnit : null
  const alreadyPursued = findDealByRef(row.nsn) != null

  return (
    <main className={styles.page}>
      <Link href={'/monopoly' as never} className={styles.back}>
        ← Monopoly Map
      </Link>

      {/* ------------------------------------------------------------------ header */}
      <header className={styles.head}>
        <div className={styles.headMain}>
          <p className={styles.eyebrow}>Corner dossier</p>
          <h1 className={`mono ${styles.nsn}`}>{row.nsn}</h1>
          <p className={styles.item}>{dossier.item}</p>
          <div className={styles.chips}>
            {row.soleSource ? (
              // Brass accent, matching the Monopoly grid's chip for the same fact. Amber is
              // reserved for the award clock.
              <StatusChip tone={dossier.source.awardSilent ? 'accent' : 'verified'}>
                {dossier.source.awardSilent ? 'Sole + silent' : 'Sole source'}
                {row.approvedSources[0] ? ` · ${row.approvedSources[0]}` : ''}
              </StatusChip>
            ) : (
              <StatusChip tone="idle">{row.approvedSourceCount} approved sources</StatusChip>
            )}
            {dossier.forecast.onForecast ? (
              <StatusChip tone="verified">
                On DLA Forecast
                {dossier.forecast.totalForecastQty ? ` · ${dossier.forecast.totalForecastQty.toLocaleString()}` : ''}
              </StatusChip>
            ) : null}
            {dossier.awardPath === 'machine_award' ? (
              <StatusChip tone="active">Machine award</StatusChip>
            ) : dossier.awardPath === 'manual' ? (
              <StatusChip tone="idle">Manual award</StatusChip>
            ) : null}
            {dossier.awardPath !== 'unknown' ? (
              <ExplainButton helpId="monopoly.award_path" size="sm" />
            ) : null}
          </div>
          <div className={styles.pursueRow}>
            <PursueButton
              appearance="primary"
              nsn={row.nsn}
              niin={row.niin}
              item={dossier.item}
              valueUsd={modeledBuyValue}
              initiallyInPipeline={alreadyPursued}
            />
            {/*
             * THE DOOR THAT EXISTED AND WAS NEVER OPENED.
             *
             * `/documents?from=corner:<nsn>` was fully implemented on the receiving side,
             * tested, and documented as a stable contract, and nothing in the product linked
             * to it. So the operator finished deciding here and then retyped the stock number,
             * the item and the quantity into a blank form on the next screen, which is the
             * whole reason that screen was described as producing "a checklist and a wall of
             * text" rather than paperwork.
             *
             * It is one link. That is exactly what makes it worth writing down: this estate's
             * dominant failure is not missing code, it is finished code with no way in.
             */}
            <Link
              href={`/documents?from=corner:${encodeURIComponent(row.nsn)}` as Route}
              className={styles.docsLink}
              prefetch={false}
            >
              Build the paperwork for this part
            </Link>
          </div>
        </div>
        <div className={styles.scoreBox}>
          <span className={styles.scoreN}>{score.scoreV0}</span>
          {/* A div row, not a span: the explainer's popover is a <div>, invalid inside a span. */}
          <div className={styles.scoreCaptionRow}>
            <span className={styles.scoreCaption}>CornerScore</span>
            {/* The flagship score, explained where it is biggest: the entry plus this row's
                real point decomposition and its named data gaps. */}
            <ExplainButton
              helpId="score.corner_v0"
              size="sm"
              sourceDetail={`Scored from the feed-day corner row joined to the NSN-Now export · feed day ${cornerMap.provenance.feedDay}`}
              computation={{
                factors: score.reasons
                  .filter((x) => x.points !== 0)
                  .map((x) => ({ label: x.plain, contribution: x.points })),
                dataGaps: score.dataGaps,
                modelVersion: 'cornerscore-v0',
                asOf: cornerMap.provenance.feedDay,
              }}
            />
          </div>
          <StatusChip tone={score.disposition === 'FLAG' ? 'verified' : 'idle'}>
            {dispositionLabel(score.disposition)} · {score.grade}
          </StatusChip>
        </div>
      </header>

      {/* ------------------------------------------------------------ money + demand */}
      <section className={styles.cards}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Award price</h2>
          {series.length > 0 ? (
            <>
              <div className={styles.chartFrame}>
                <PriceSparkline
                  points={series}
                  width={520}
                  height={140}
                  ariaLabel={`Unit price across ${series.length} awards for ${row.nsn}, from ${usd(dossier.pricing.firstUnitPrice)} to ${usd(dossier.pricing.lastUnitPrice)}`}
                  className={styles.chart}
                />
              </div>
              <dl className={styles.priceRow}>
                <div>
                  <dt>First award</dt>
                  <dd className="mono">{usd(dossier.pricing.firstUnitPrice)}</dd>
                </div>
                <div>
                  <dt>Latest award</dt>
                  <dd className="mono">{usd(dossier.pricing.lastUnitPrice)}</dd>
                </div>
                <div>
                  <dt>Change</dt>
                  <dd className="mono">
                    {dossier.pricing.escalationPct == null
                      ? '—'
                      : `${dossier.pricing.escalationPct > 0 ? '+' : ''}${dossier.pricing.escalationPct}%`}
                  </dd>
                </div>
                <div>
                  <dt>Awardees</dt>
                  <dd className="mono">{dossier.pricing.distinctAwardees ?? '—'}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className={styles.empty}>
              No award price is ingested for this stock number yet. Nothing is estimated in its place.
            </p>
          )}
        </div>

        {/*
          THE QUOTE CHECKLIST, COMPUTED. Every row is an indicator the operator who taught this
          business wrote down himself while deciding whether to quote a real requirement. Two of
          them are deliberately WITHHELD rather than shown, because the export column that would
          carry them is measurably contaminated, and the row says so in the operator's own view
          rather than in a comment nobody reads.
        */}
        {dossier.quoteSignals.length > 0 ? (
          <div className={`${styles.card} ${styles.signalsCard}`}>
            <h2 className={styles.cardTitle}>Quote signals</h2>
            <p className={styles.signalsIntro}>
              The indicators a trader checks before quoting, read from the government files on disk.
              Each one says what it is, and where the files cannot answer it says that instead.
            </p>
            <ul className={styles.signals}>
              {dossier.quoteSignals.map((s) => (
                <li key={s.id} className={styles.signal} data-state={s.leg.state} data-direction={s.direction}>
                  <div className={styles.signalHead}>
                    <span className={styles.signalDot} aria-hidden="true" />
                    <span className={styles.signalLabel}>{s.label}</span>
                    <StatusChip tone={s.leg.state === 'MEASURED' ? 'verified' : 'idle'}>
                      {s.leg.state === 'MEASURED'
                        ? s.direction === 'favourable'
                          ? 'in favor'
                          : s.direction === 'unfavourable'
                            ? 'against'
                            : 'measured'
                        : 'not read'}
                    </StatusChip>
                  </div>
                  <p className={styles.signalReading}>{s.reading}</p>
                  {s.limitation ? <p className={styles.signalLimit}>{s.limitation}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Forward demand</h2>
          {dossier.forecast.onForecast ? (
            <dl className={styles.factRows}>
              <div>
                <dt>On the DLA Forecast</dt>
                <dd>
                  <StatusChip tone="verified">Yes</StatusChip>
                </dd>
              </div>
              {dossier.forecast.totalForecastQty ? (
                <div>
                  <dt>Forecast quantity</dt>
                  <dd className="mono">{dossier.forecast.totalForecastQty.toLocaleString()}</dd>
                </div>
              ) : null}
              {dossier.forecast.solicitationCount ? (
                <div>
                  <dt>Solicitations drawn</dt>
                  <dd className="mono">{dossier.forecast.solicitationCount.toLocaleString()}</dd>
                </div>
              ) : null}
              {dossier.forecast.supplyChains.length > 0 ? (
                <div>
                  <dt>Supply chain</dt>
                  <dd>{dossier.forecast.supplyChains.join(', ')}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className={styles.empty}>
              This stock number is not on the government forward-buy list in the data on disk. Demand
              is read from the open solicitation only, not projected.
            </p>
          )}
          {dossier.forecast.endItems.length > 0 ? (
            <div className={styles.endItems}>
              <span className={styles.endItemsLabel}>Goes on</span>
              <div className={styles.endItemChips}>
                {dossier.forecast.endItems.slice(0, 8).map((e) => (
                  <span key={e} className={styles.endItemChip}>
                    {e}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------------------ AI brief */}
      <AiBrief nsn={key} configured={aiConfigured()} />

      {/* ------------------------------------------------------------ pursuit package */}
      {(() => {
        // The email channel's TRUE state, computed server-side so the panel can say
        // "disarmed" before a click is ever spent. sendPreflight finally has its caller.
        const recipient = readSettings().emailRecipient
        const pf = sendPreflight(recipient)
        return (
          <PursuitPackagePanel
            nsn={key}
            configured={aiConfigured()}
            emailChannel={{ wouldSend: pf.wouldSend, reason: pf.reason, recipient }}
          />
        )
      })()}

      {/* ---------------------------------------------------------- award history */}
      {dossier.priceHistory.length > 0 ? (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Award history</h2>
          <p className={styles.cardSub}>
            Every prime award in the NSN-Now export for this stock number, in order. Real prices, not
            modeled.
          </p>
          <Scrollable className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Award date</th>
                  <th>Awardee</th>
                  <th className={styles.numCol}>Qty</th>
                  <th className={styles.numCol}>Unit price</th>
                  <th className={styles.numCol}>Final price</th>
                </tr>
              </thead>
              <tbody>
                {dossier.priceHistory.map((p, i) => (
                  <tr key={i}>
                    <td className="mono">{p.dateIso ?? '—'}</td>
                    <td>
                      {p.company ?? '—'}
                      {p.cage ? <span className={styles.cage}> {p.cage}</span> : null}
                    </td>
                    <td className={`mono ${styles.numCol}`}>{p.quantity?.toLocaleString() ?? '—'}</td>
                    <td className={`mono ${styles.numCol}`}>{usd(p.unitPrice)}</td>
                    <td className={`mono ${styles.numCol}`}>{usd(p.finalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scrollable>
        </section>
      ) : null}

      {/* --------------------------------------------------------------- the legs */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>How the score is built</h2>
        <p className={styles.cardSub}>
          Five legs, each carrying its own evidence state. A leg can contribute more than one
          signal, so each card below names its leg and the signal it scores. A leg that was not
          measured is marked, and the score is capped honestly rather than pretending the leg was
          read.
        </p>
        <div className={styles.legGrid}>
          {score.reasons.map((r, i) => {
            const helpId = REASON_HELP[r.facet ? `${r.leg}·${r.facet}` : r.leg]
            return (
              <div key={i} className={styles.legRow}>
                <div className={styles.legHead}>
                  <span className={styles.legName}>
                    {LEG_LABEL[r.leg] ?? r.leg}
                    {r.facet ? ` · ${r.facet}` : ''}
                  </span>
                  {helpId ? <ExplainButton helpId={helpId} size="sm" /> : null}
                  <StatusChip tone={r.calibration === 'measured' ? 'verified' : 'idle'}>
                    {r.calibration}
                    {r.points ? ` · ${r.points > 0 ? '+' : ''}${r.points}` : ''}
                  </StatusChip>
                </div>
                <p className={styles.legPlain}>{r.plain}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* -------------------------------------------------------------- open gaps */}
      {dossier.openGaps.length > 0 ? (
        <section className={styles.gaps}>
          <h2 className={styles.gapsTitle}>What a full read is still waiting on</h2>
          <ul className={styles.gapList}>
            {dossier.openGaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
