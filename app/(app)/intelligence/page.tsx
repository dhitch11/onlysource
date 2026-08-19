import { TextNote } from "@/components/ui/Note";
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildPortfolio } from '@/lib/intelligence/portfolio'
import { dispositionLabel } from '@/lib/intelligence/scoring/evidence-state'
import { aiConfigured } from '@/lib/ai/anthropic'
import { HBars } from '@/components/ui/HBars'
import { PriceSparkline } from '@/components/ui/PriceSparkline'
import { StatusChip } from '@/components/ui/StatusChip'
import { Scrollable } from '@/components/ui/Scrollable'
import rt from '@/components/ui/responsive-table.module.css'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { PortfolioBrief } from './PortfolioBrief'
import styles from './intelligence.module.css'

export const metadata: Metadata = { title: 'Intelligence · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

const usd = (n: number | null): string =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * THE INTELLIGENCE DASHBOARD.
 *
 * The whole candidate book on one screen: the AI portfolio brief up top, the measured shape of the
 * book in charts, and the ranked plays below. Every figure is counted from the feed by
 * buildPortfolio(); the charts and the brief read the same object, so they can never disagree.
 */
export default async function IntelligencePage() {
  await requireGateSession('/intelligence')

  if (!resolveDataRoot().present) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Intelligence</p>
          <h1 className={styles.h1}>Where the money is</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>The data directory is not mounted here</h2>
          <p>The dashboard is computed from the government feed files, and this environment has none.</p>
        </div>
      </main>
    )
  }

  const pf = buildPortfolio()

  /**
   * THE BASIS FOR EVERY TOTAL BELOW, AND IT IS A SPAN.
   *
   * This header read "Intelligence · feed day 2026-08-14" over "The whole candidate book for
   * this feed day", while `buildPortfolio` counts across the whole archived window. MEASURED
   * through the serving path: the rows behind these totals cite 13 distinct feed days across a
   * 20-day span, and only 3.4% of them come from the capture that was named. `pf.coverage` has
   * carried the honest sentence since the window landed and was rendered on no surface at all;
   * it is rendered here, from the one definition in lib/intelligence/corner.ts, so this page
   * and /monopoly cannot describe the same book two different ways.
   */
  const coverage = pf.coverage
  const spanLabel =
    coverage.basis === 'window'
      ? `${coverage.dayCount} archived feed days, ${coverage.firstDay} to ${coverage.lastDay}`
      : `the single archived feed day ${coverage.firstDay}`
  const judgedOn = coverage.excludedFromDemand?.asOf ?? null

  const metrics: Array<{ n: number; label: string; hint: string }> = [
    { n: pf.totals.candidateCorners, label: 'candidate corners', hint: 'sole source, under open demand, award-silent' },
    { n: pf.totals.onForecast, label: 'on the DLA Forecast', hint: 'forward demand is measured' },
    { n: pf.totals.priced, label: 'with real award prices', hint: 'a government-paid anchor' },
    { n: pf.totals.machineAward, label: 'machine-award path', hint: 'price wins, no manual evaluation' },
    { n: pf.totals.withEscalation, label: 'with rising prices', hint: 'the incumbent has been pushing price up' },
  ]

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Intelligence · counted across {spanLabel}</p>
        <h1 className={styles.h1}>Where the money is</h1>
        <p className={styles.sub}>
          The whole candidate book across{' '}
          {coverage.basis === 'window'
            ? `every archived feed day this build could parse-verify, ${coverage.firstDay} to ${coverage.lastDay}`
            : `the single archived feed day ${coverage.firstDay}`}
          , aggregated
          {judgedOn ? `, with open demand judged against ${judgedOn}` : ''}. The brief and every
          chart read the same measured numbers. Start with the AI read, then work the ranked
          plays.
        </p>
        {/* The stored sentence, not a second hand-written copy of it: the span, the thin-day
            disclosure, what was excluded from demand and on which day, and what the newest
            archived day alone shows judged the same way. */}
        <TextNote text={coverage.statement} label="How the window is counted" tone="quiet" />
      </header>

      {/* --------------------------------------------------------- AI portfolio brief */}
      <PortfolioBrief configured={aiConfigured()} />

      {/* ------------------------------------------------------------------- metrics */}
      <section className={styles.metricStrip} aria-label="Book totals">
        {metrics.map((m) => (
          <div key={m.label} className={styles.metric}>
            <span className={styles.metricN}>{m.n.toLocaleString()}</span>
            <span className={styles.metricLabel}>{m.label}</span>
            <span className={styles.metricHint}>{m.hint}</span>
          </div>
        ))}
      </section>

      {/* -------------------------------------------------------------------- charts */}
      <section className={styles.chartGrid}>
        <div className={styles.chartCard}>
          <div className={styles.chartTitleRow}>
            <h2 className={styles.chartTitle}>Candidate corners by supply chain</h2>
            <ExplainButton helpId="monopoly.supply_chain" size="sm" />
          </div>
          <p className={styles.chartSub}>Where the forward demand concentrates.</p>
          <HBars data={pf.bySupplyChain.slice(0, 8)} emptyNote="No forecast supply chains matched these corners yet." />
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartTitleRow}>
            <h2 className={styles.chartTitle}>CornerScore distribution</h2>
            <ExplainButton helpId="score.corner_v0" size="sm" />
          </div>
          <p className={styles.chartSub}>How the book spreads across the watchlist rank.</p>
          <HBars data={pf.scoreBuckets} />
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartTitleRow}>
            <h2 className={styles.chartTitle}>Disposition mix</h2>
            <ExplainButton helpId="score.disposition_mix" size="sm" />
          </div>
          <p className={styles.chartSub}>How many are actionable versus still waiting on evidence.</p>
          {/* Same enum, same label map as the Monopoly grid: a raw WATCHLIST token on one
              surface and "Watchlist" on another would be two spellings of one fact. */}
          <HBars data={pf.byDisposition.map((b) => ({ ...b, label: dispositionLabel(b.label) }))} />
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartTitleRow}>
            <h2 className={styles.chartTitle}>Award path</h2>
            <ExplainButton helpId="monopoly.award_path" size="sm" />
          </div>
          <p className={styles.chartSub}>Machine-award corners win on price alone.</p>
          <HBars data={pf.byAwardPath} />
        </div>
      </section>

      {/* -------------------------------------------------------- escalation leaders */}
      {pf.escalationLeaders.length > 0 ? (
        <section className={styles.card}>
          <div className={styles.chartTitleRow}>
            <h2 className={styles.chartTitle}>Price-escalation leaders</h2>
            <ExplainButton helpId="monopoly.price_escalation" size="sm" />
          </div>
          <p className={styles.chartSub}>
            Cornered parts where the sole source has pushed the unit price up the most, measured across
            its own award history.
          </p>
          <ul className={styles.escList}>
            {pf.escalationLeaders.map((c) => (
              <li key={c.nsn} className={styles.escRow}>
                <Link href={`/corner/${c.nsn.replace(/[^0-9]/g, '')}` as never} className={styles.escNsn}>
                  {c.nsn}
                </Link>
                <span className={styles.escItem} title={c.item}>
                  {c.item}
                </span>
                <span className={styles.escPrices}>
                  {usd(c.firstPrice)} → {usd(c.lastPrice)}
                </span>
                <span className={styles.escPct}>+{c.escalationPct?.toLocaleString()}%</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- top plays */}
      <section className={styles.card}>
        <h2 className={styles.chartTitle}>Top plays</h2>
        <p className={styles.chartSub}>The highest-ranked corners in the book. Open any for its full dossier.</p>
        <Scrollable className={`${styles.tableWrap} ${rt.cards}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Stock number</th>
                <th>Item</th>
                <th className={styles.numCol}>
                  Score
                  <ExplainButton helpId="score.corner_v0" size="sm" />
                </th>
                <th className={styles.numCol}>Last award</th>
                <th>Trend</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              {pf.topCorners.map((c) => (
                <tr key={c.nsn}>
                  <td className="mono" data-label="Stock number">
                    <Link href={`/corner/${c.nsn.replace(/[^0-9]/g, '')}` as never} className={styles.escNsn}>
                      {c.nsn}
                    </Link>
                  </td>
                  <td className={styles.itemCell} title={c.item} data-label="Item">
                    {c.item}
                  </td>
                  <td className={`mono ${styles.numCol}`} data-label="Score">{c.score}</td>
                  <td className={`mono ${styles.numCol}`} data-label="Last award">{usd(c.lastPrice)}</td>
                  <td data-label="Trend">
                    {c.priceSeries.length >= 2 ? (
                      <PriceSparkline
                        points={c.priceSeries}
                        width={72}
                        height={22}
                        ariaLabel={`Award unit price across ${c.priceSeries.length} awards, ${usd(c.firstPrice)} to ${usd(c.lastPrice)}`}
                        area={false}
                      />
                    ) : (
                      <span className={styles.dash}>—</span>
                    )}
                  </td>
                  <td data-label="Signals">
                    <span className={styles.signals}>
                      {c.onForecast ? <StatusChip tone="verified">Forecast</StatusChip> : null}
                      {c.machineAward ? <StatusChip tone="active">Machine</StatusChip> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scrollable>
      </section>
    </main>
  )
}
