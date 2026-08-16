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
        <p className={styles.eyebrow}>Intelligence · feed day {pf.feedDay}</p>
        <h1 className={styles.h1}>Where the money is</h1>
        <p className={styles.sub}>
          The whole candidate book for this feed day, aggregated. The brief and every chart read the
          same measured numbers. Start with the AI read, then work the ranked plays.
        </p>
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
          <h2 className={styles.chartTitle}>Candidate corners by supply chain</h2>
          <p className={styles.chartSub}>Where the forward demand concentrates.</p>
          <HBars data={pf.bySupplyChain.slice(0, 8)} emptyNote="No forecast supply chains matched these corners yet." />
        </div>
        <div className={styles.chartCard}>
          <h2 className={styles.chartTitle}>CornerScore distribution</h2>
          <p className={styles.chartSub}>How the book spreads across the watchlist rank.</p>
          <HBars data={pf.scoreBuckets} />
        </div>
        <div className={styles.chartCard}>
          <h2 className={styles.chartTitle}>Disposition mix</h2>
          <p className={styles.chartSub}>How many are actionable versus still waiting on evidence.</p>
          {/* Same enum, same label map as the Monopoly grid: a raw WATCHLIST token on one
              surface and "Watchlist" on another would be two spellings of one fact. */}
          <HBars data={pf.byDisposition.map((b) => ({ ...b, label: dispositionLabel(b.label) }))} />
        </div>
        <div className={styles.chartCard}>
          <h2 className={styles.chartTitle}>Award path</h2>
          <p className={styles.chartSub}>Machine-award corners win on price alone.</p>
          <HBars data={pf.byAwardPath} />
        </div>
      </section>

      {/* -------------------------------------------------------- escalation leaders */}
      {pf.escalationLeaders.length > 0 ? (
        <section className={styles.card}>
          <h2 className={styles.chartTitle}>Price-escalation leaders</h2>
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
        <Scrollable className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Stock number</th>
                <th>Item</th>
                <th className={styles.numCol}>Score</th>
                <th className={styles.numCol}>Last award</th>
                <th>Trend</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              {pf.topCorners.map((c) => (
                <tr key={c.nsn}>
                  <td className="mono">
                    <Link href={`/corner/${c.nsn.replace(/[^0-9]/g, '')}` as never} className={styles.escNsn}>
                      {c.nsn}
                    </Link>
                  </td>
                  <td className={styles.itemCell} title={c.item}>
                    {c.item}
                  </td>
                  <td className={`mono ${styles.numCol}`}>{c.score}</td>
                  <td className={`mono ${styles.numCol}`}>{usd(c.lastPrice)}</td>
                  <td>
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
                  <td>
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
