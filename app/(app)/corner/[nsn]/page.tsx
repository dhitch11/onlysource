import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { buildCornerDossier, priceSeries } from '@/lib/intelligence/brief/dossier'
import { PriceSparkline } from '@/components/ui/PriceSparkline'
import { StatusChip } from '@/components/ui/StatusChip'
import { aiConfigured } from '@/lib/ai/anthropic'
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

const LEG_STATE_TONE: Record<string, 'verified' | 'urgent' | 'idle'> = {
  MEASURED: 'verified',
  PRIOR: 'idle',
  UNAVAILABLE: 'idle',
  GATE_FAIL: 'urgent',
}
const LEG_LABEL: Record<string, string> = {
  demand: 'Demand',
  competition: 'Competition',
  priceAnchor: 'Price anchor',
  forwardDemand: 'Forward demand',
  feasibility: 'Feasibility',
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
  if (!row) notFound()

  const awardIx = buildNsnAwardIndex()
  const fcIx = buildForecastIndex()
  const award = awardIx.ok ? awardIx.byNsn.get(key) ?? null : null
  const forecast = fcIx.ok ? fcIx.byNsn.get(key) ?? null : null
  const score = scoreCorner(row, award, forecast)
  const dossier = buildCornerDossier(row, award, forecast, score)
  const series = priceSeries(dossier)

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
              <StatusChip tone={dossier.source.awardSilent ? 'urgent' : 'verified'}>
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
              <StatusChip tone="urgent">Machine award</StatusChip>
            ) : dossier.awardPath === 'manual' ? (
              <StatusChip tone="idle">Manual award</StatusChip>
            ) : null}
          </div>
        </div>
        <div className={styles.scoreBox}>
          <span className={styles.scoreN}>{score.scoreV0}</span>
          <span className={styles.scoreCaption}>CornerScore</span>
          <StatusChip tone={score.disposition === 'FLAG' ? 'verified' : 'idle'}>
            {score.disposition} · {score.grade}
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

      {/* ---------------------------------------------------------- award history */}
      {dossier.priceHistory.length > 0 ? (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Award history</h2>
          <p className={styles.cardSub}>
            Every prime award in the NSN-Now export for this stock number, in order. Real prices, not
            modeled.
          </p>
          <div className={styles.tableWrap}>
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
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------------------- the legs */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>How the score is built</h2>
        <p className={styles.cardSub}>
          Five legs, each carrying its own evidence state. A leg that was not measured is marked, and
          the score is capped honestly rather than pretending the leg was read.
        </p>
        <div className={styles.legGrid}>
          {score.reasons.map((r, i) => (
            <div key={i} className={styles.legRow}>
              <div className={styles.legHead}>
                <span className={styles.legName}>{LEG_LABEL[r.leg] ?? r.leg}</span>
                <StatusChip tone={r.calibration === 'measured' ? 'verified' : 'idle'}>
                  {r.calibration}
                  {r.points ? ` · ${r.points > 0 ? '+' : ''}${r.points}` : ''}
                </StatusChip>
              </div>
              <p className={styles.legPlain}>{r.plain}</p>
            </div>
          ))}
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
