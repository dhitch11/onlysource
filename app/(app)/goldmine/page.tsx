import type { Metadata } from 'next'
import Link from 'next/link'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { systemClock } from '@/lib/time/clock'
import { StatusChip } from '@/components/ui/StatusChip'
import styles from './goldmine.module.css'

export const metadata: Metadata = { title: 'No-Quote Goldmine · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

const usd = (n: number | null): string =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const usd0 = (n: number): string => `$${Math.round(n).toLocaleString()}`

const SHOWN = 60

type Enriched = {
  nsn: string
  digits: string
  description: string
  solicitation: string
  quantity: number | null
  lastSoldPrice: number | null
  closeDate: string | null
  estValue: number
  open: boolean
  holders: Array<{ name: string; unitsAvailable: number | null; basePrice: number | null }>
}

/**
 * THE NO-QUOTE GOLDMINE.
 *
 * The government put these parts out to buy and not one company sent back a price. When nobody
 * quotes, the buyer has to come back and ask again, which means these are the lanes where a supplier
 * walks in with no competition. The split is the whole point: where nobody holds material anywhere,
 * the only way to win is to make it, and that make-side set is the one a person cannot work by hand.
 *
 * Every row is a real solicitation from the government file. Nothing is estimated except the labelled
 * "size" figure, which is simply the last unit price times the quantity asked for.
 */
export default async function GoldminePage() {
  await requireGateSession('/goldmine')

  if (!resolveDataRoot().present) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Opportunities</p>
          <h1 className={styles.h1}>No-Quote Goldmine</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>Today&rsquo;s government data hasn&rsquo;t loaded yet</h2>
          <p>This list is built straight from the DLA solicitation files. It appears the moment the feed is here.</p>
        </div>
      </main>
    )
  }

  const { noQuote } = buildAllDatasets()
  const nowMs = systemClock.now()

  const enrich = (r: (typeof noQuote.rows)[number]): Enriched => {
    const est =
      r.lastSoldPrice != null && r.quantity != null
        ? r.lastSoldPrice * r.quantity
        : r.lastSoldPrice ?? 0
    const closeMs = r.closeDate ? Date.parse(r.closeDate) : NaN
    return {
      nsn: r.nsn,
      digits: r.nsn.replace(/[^0-9]/g, ''),
      description: r.description.trim() || 'not described on this line',
      solicitation: r.solicitation,
      quantity: r.quantity,
      lastSoldPrice: r.lastSoldPrice,
      closeDate: r.closeDate,
      estValue: est,
      open: Number.isFinite(closeMs) && closeMs >= nowMs,
      holders: r.holders,
    }
  }

  const all = noQuote.rows.map(enrich)
  const bySize = (a: Enriched, b: Enriched) => b.estValue - a.estValue
  const makeSide = all.filter((r) => r.holders.length === 0).sort(bySize)
  const sourcing = all.filter((r) => r.holders.length > 0).sort(bySize)
  const openCount = all.filter((r) => r.open).length

  const metrics = [
    { n: noQuote.summary.solicitations, label: 'solicitations, zero quotes', hint: 'nobody sent the government a price', hot: false },
    { n: noQuote.summary.makeSideOnly, label: 'nobody can even source it', hint: 'the make-side: you win by building it', hot: true },
    { n: noQuote.summary.withHolder, label: 'someone holds material', hint: 'a sourcing job, an hour of work', hot: false },
    { n: openCount, label: 'still open right now', hint: 'the close date has not passed', hot: openCount > 0 },
  ]

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Opportunities</p>
        <h1 className={styles.h1}>No-Quote Goldmine</h1>
        <p className={styles.sub}>
          Parts the government tried to buy and got <b>zero</b> quotes back on. No competition showed
          up. When that happens the buyer has to ask again, so these are the lanes where you win by
          default. Open any part for its full history.
        </p>
      </header>

      <section className={styles.metricStrip} aria-label="Goldmine totals">
        {metrics.map((m) => (
          <div key={m.label} className={`${styles.metric} ${m.hot ? styles.metricHot : ''}`}>
            <span className={styles.metricN}>{m.n.toLocaleString()}</span>
            <span className={styles.metricLabel}>{m.label}</span>
            <span className={styles.metricHint}>{m.hint}</span>
          </div>
        ))}
      </section>

      {/* -------------------------------------------------- make-side: the millions class */}
      <Section
        title="Make-side — nobody holds it anywhere"
        blurb="No supplier shows any material for these. The only way to fill the order is to make the part, which means whoever can make it faces no one. This is the set a person cannot work by hand, sorted by the size of the buy."
        rows={makeSide}
      />

      {/* ---------------------------------------------------------- sourcing: someone holds */}
      <Section
        title="Sourcing — someone already holds material"
        blurb="A supplier shows stock against these, so the job is finding and moving material, not making it. Faster to win, smaller edge. Sorted by the size of the buy."
        rows={sourcing}
        showHolders
      />
    </main>
  )
}

function Section({
  title,
  blurb,
  rows,
  showHolders = false,
}: {
  title: string
  blurb: string
  rows: Enriched[]
  showHolders?: boolean
}) {
  if (rows.length === 0) {
    return (
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{title}</h2>
        <p className={styles.empty}>Nothing in this class on today&rsquo;s file.</p>
      </section>
    )
  }
  const shown = rows.slice(0, SHOWN)
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <p className={styles.cardSub}>{blurb}</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Stock number</th>
              <th>Part</th>
              <th className={styles.numCol}>Qty</th>
              <th className={styles.numCol}>Last price</th>
              <th className={styles.numCol}>Size of buy</th>
              <th>Closes</th>
              {showHolders ? <th>Holders</th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.digits}:${r.solicitation}`}>
                <td className="mono">
                  <Link href={`/corner/${r.digits}` as never} className={styles.nsnLink}>
                    {r.nsn}
                  </Link>
                </td>
                <td className={styles.partCell} title={r.description}>
                  {r.description}
                </td>
                <td className={`mono ${styles.numCol}`}>{r.quantity?.toLocaleString() ?? '—'}</td>
                <td className={`mono ${styles.numCol}`}>{usd(r.lastSoldPrice)}</td>
                <td className={`mono ${styles.numCol} ${styles.sizeCol}`}>
                  {r.estValue > 0 ? usd0(r.estValue) : '—'}
                </td>
                <td className={styles.closeCell}>
                  {r.closeDate ? (
                    <span className={styles.closeRow}>
                      <span className="mono">{r.closeDate}</span>
                      {r.open ? <StatusChip tone="urgent">Open now</StatusChip> : null}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                {showHolders ? (
                  <td className={styles.holderCell}>
                    {r.holders.slice(0, 2).map((h) => h.name).join(', ')}
                    {r.holders.length > 2 ? ` +${r.holders.length - 2}` : ''}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.tableFoot}>
        Showing the top {shown.length.toLocaleString()} of {rows.length.toLocaleString()} by size of
        buy. &ldquo;Size of buy&rdquo; is the last unit price times the quantity asked for, a rough
        figure, not a quote.
      </p>
    </section>
  )
}
