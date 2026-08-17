import type { Metadata } from 'next'
import Link from 'next/link'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { systemClock } from '@/lib/time/clock'
import { StatusChip } from '@/components/ui/StatusChip'
import { Scrollable } from '@/components/ui/Scrollable'
import { PursueButton } from '@/components/sales/PursueButton'
import { readDeals } from '@/lib/sales/deals-store'
import { normalizeDealRef } from '@/lib/sales/pipeline'
import { ExplainButton } from '@/components/ui/ExplainButton'
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
  recent: boolean
  holders: Array<{ name: string; unitsAvailable: number | null; basePrice: number | null }>
}

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000

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

  const { noQuote, cornerMap } = buildAllDatasets()
  const nowMs = systemClock.now()
  // Only link a stock number into the dossier when a dossier actually exists for it. Many no-quote
  // solicitations are not in the approved-source corner map, and a dossier for those 404s. Those
  // render as plain text so no row ever links to a dead page.
  const cornerDigits = new Set(cornerMap.rows.map((r) => r.nsn.replace(/[^0-9]/g, '')))

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
      recent: Number.isFinite(closeMs) && closeMs <= nowMs && closeMs >= nowMs - NINETY_DAYS,
      holders: r.holders,
    }
  }

  const all = noQuote.rows.map(enrich)
  const bySize = (a: Enriched, b: Enriched) => b.estValue - a.estValue
  const makeSide = all.filter((r) => r.holders.length === 0).sort(bySize)
  const sourcing = all.filter((r) => r.holders.length > 0).sort(bySize)
  const makeSideValue = makeSide.reduce((s, r) => s + r.estValue, 0)

  // The refs already in the pipeline, so a pursued row renders flipped on first paint.
  const pursued = new Set(readDeals().map((d) => normalizeDealRef(d.ref)).filter(Boolean))

  // The live provenance line each tile's explainer carries: the actual files this page's
  // numbers were joined from, read from the dataset's own provenance object at render time.
  const nqProv = noQuote.provenance
  const nqSource = `Counted from ${nqProv.solicitations.path.split('/').pop()} joined to ${nqProv.availability.path.split('/').pop()}`

  const metrics: Array<{ display: string; label: string; hint: string; hot: boolean; helpId?: string; sourceDetail?: string }> = [
    { display: noQuote.summary.solicitations.toLocaleString(), label: 'solicitations, zero quotes', hint: 'nobody sent the government a price', hot: false, helpId: 'capability.no_quote', sourceDetail: nqSource },
    { display: noQuote.summary.makeSideOnly.toLocaleString(), label: 'nobody can even source it', hint: 'the make-side: you win by building it', hot: true },
    { display: noQuote.summary.withHolder.toLocaleString(), label: 'someone holds material', hint: 'a sourcing job, an hour of work', hot: false },
    { display: makeSideValue > 0 ? usd0(makeSideValue) : '—', label: 'make-side size of buy', hint: 'last price times quantity, every make-side buy added up', hot: true, helpId: 'capability.modeled_size_of_buy', sourceDetail: nqSource },
  ]

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Opportunities</p>
        <h1 className={styles.h1}>No-Quote Goldmine</h1>
        <p className={styles.sub}>
          Parts the government tried to buy and got <b>zero</b> quotes back on. No competition showed
          up, so the buyer has to come back and ask again. These closed buys are the proof that the
          lane is wide open, and the same order returns. Get in front of the next one. A stock number
          that is also on the corner map links into its dossier.
        </p>
      </header>

      <section className={styles.metricStrip} aria-label="Goldmine totals">
        {metrics.map((m) => (
          <div key={m.label} className={`${styles.metric} ${m.hot ? styles.metricHot : ''}`}>
            {m.helpId ? (
              <div className={styles.metricHelp}>
                <ExplainButton helpId={m.helpId} size="sm" sourceDetail={m.sourceDetail} />
              </div>
            ) : null}
            <span className={styles.metricN}>{m.display}</span>
            <span className={styles.metricLabel}>{m.label}</span>
            <span className={styles.metricHint}>{m.hint}</span>
          </div>
        ))}
      </section>

      {/* -------------------------------------------------- make-side: the millions class */}
      <Section
        title="Make-side: nobody holds it anywhere"
        blurb="No supplier shows any material for these. The only way to fill the order is to make the part, which means whoever can make it faces no one. This is the set a person cannot work by hand, sorted by the size of the buy."
        rows={makeSide}
        linkable={cornerDigits}
        pursued={pursued}
      />

      {/* ---------------------------------------------------------- sourcing: someone holds */}
      <Section
        title="Sourcing: someone already holds material"
        blurb="A supplier shows stock against these, so the job is finding and moving material, not making it. Faster to win, smaller edge. Sorted by the size of the buy."
        rows={sourcing}
        linkable={cornerDigits}
        pursued={pursued}
        showHolders
      />
    </main>
  )
}

function Section({
  title,
  blurb,
  rows,
  linkable,
  pursued,
  showHolders = false,
}: {
  title: string
  blurb: string
  rows: Enriched[]
  linkable: Set<string>
  /** Normalized deal refs already in the pipeline. */
  pursued: Set<string>
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
      <Scrollable className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Stock number</th>
              <th>Part</th>
              <th className={styles.numCol}>Qty</th>
              <th className={styles.numCol}>Last price</th>
              <th className={styles.numCol}>Size of buy</th>
              <th>Close date</th>
              {showHolders ? <th>Holders</th> : null}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.digits}:${r.solicitation}`}>
                <td className="mono">
                  {linkable.has(r.digits) ? (
                    <Link href={`/corner/${r.digits}` as never} className={styles.nsnLink}>
                      {r.nsn}
                    </Link>
                  ) : (
                    <span className={styles.nsnPlain}>{r.nsn}</span>
                  )}
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
                      {r.recent ? <StatusChip tone="verified">Recent</StatusChip> : null}
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
                <td>
                  {/* The pursuit wire, on rows whose corner dossier exists (the same rows
                      whose stock number links in). The modeled buy value is the last unit
                      price times the quantity, only when both are on the government line. */}
                  {linkable.has(r.digits) ? (
                    <PursueButton
                      nsn={r.nsn}
                      niin={r.digits.length === 13 ? r.digits.slice(4) : null}
                      item={r.description === 'not described on this line' ? '' : r.description}
                      valueUsd={
                        r.lastSoldPrice != null && r.quantity != null
                          ? r.lastSoldPrice * r.quantity
                          : null
                      }
                      initiallyInPipeline={pursued.has(normalizeDealRef(r.nsn))}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scrollable>
      <p className={styles.tableFoot}>
        Showing the top {shown.length.toLocaleString()} of {rows.length.toLocaleString()} by size of
        buy. &ldquo;Size of buy&rdquo; is the last unit price times the quantity asked for, a rough
        figure, not a quote.
      </p>
    </section>
  )
}
