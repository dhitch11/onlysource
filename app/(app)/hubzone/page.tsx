import type { Metadata } from 'next'
import Link from 'next/link'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildHubzoneMatches } from '@/lib/intelligence/opportunities/hubzone'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { systemClock } from '@/lib/time/clock'
import { StatusChip } from '@/components/ui/StatusChip'
import { Scrollable } from '@/components/ui/Scrollable'
import { PursueButton } from '@/components/sales/PursueButton'
import { readDeals } from '@/lib/sales/deals-store'
import { normalizeDealRef } from '@/lib/sales/pipeline'
import { ExplainButton } from '@/components/ui/ExplainButton'
import styles from '../goldmine/goldmine.module.css'

export const metadata: Metadata = { title: 'HUBZone set-asides · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

const usd = (n: number | null): string =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const usd0 = (n: number): string => `$${Math.round(n).toLocaleString()}`

/**
 * HUBZONE SET-ASIDES — a distinct opportunity class, framed honestly.
 *
 * These are government solicitations reserved for HUBZone-certified small businesses. Whether they are
 * yours to bid depends on your certification; if you are not certified, they are still intelligence
 * (what is being bought, at what price, by when) and a partner angle. The page says that plainly.
 */
export default async function HubzonePage() {
  await requireGateSession('/hubzone')

  if (!resolveDataRoot().present) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Opportunities</p>
          <h1 className={styles.h1}>HUBZone set-asides</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>Today&rsquo;s data hasn&rsquo;t loaded yet</h2>
          <p>This list is built from the government export. It appears the moment the feed is here.</p>
        </div>
      </main>
    )
  }

  const hz = buildHubzoneMatches()
  if (!hz.ok) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Opportunities</p>
          <h1 className={styles.h1}>HUBZone set-asides</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>No HUBZone solicitations loaded</h2>
          <p>{hz.reason}</p>
        </div>
      </main>
    )
  }

  const nowMs = systemClock.now()
  const cornerDigits = new Set(
    buildAllDatasets()
      .cornerMap.rows.filter((r) => r.soleSource && r.silentSourceCount > 0)
      .map((r) => r.nsn.replace(/[^0-9]/g, '')),
  )
  const openCount = hz.matches.filter((m) => {
    const c = m.closeDate ? Date.parse(m.closeDate) : NaN
    return Number.isFinite(c) && c >= nowMs
  }).length

  // The refs already in the pipeline, so a pursued row renders flipped on first paint.
  const pursued = new Set(readDeals().map((d) => normalizeDealRef(d.ref)).filter(Boolean))

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Opportunities</p>
        <h1 className={styles.h1}>HUBZone set-asides</h1>
        <p className={styles.sub}>
          Government buys the agency has reserved for <b>HUBZone-certified</b> small businesses. If
          you hold the certification these are yours to bid; if not, they are still intelligence on
          what is being bought and at what price, and a reason to partner with a certified firm.
          Nothing here assumes you qualify.
        </p>
      </header>

      <section className={styles.metricStrip} aria-label="HUBZone totals">
        <div className={`${styles.metric} ${styles.metricHot}`}>
          <span className={styles.metricN}>{hz.summary.total.toLocaleString()}</span>
          <span className={styles.metricLabel}>set-aside solicitations</span>
          <span className={styles.metricHint}>reserved for HUBZone firms</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricN}>{openCount.toLocaleString()}</span>
          <span className={styles.metricLabel}>still open</span>
          <span className={styles.metricHint}>the close date has not passed</span>
        </div>
        <div className={`${styles.metric} ${styles.metricHot}`}>
          {/* A modeled dollar figure carries its own explainer, fifth field included. */}
          <div className={styles.metricHelp}>
            <ExplainButton helpId="capability.modeled_size_of_buy" size="sm" />
          </div>
          <span className={styles.metricN}>
            {hz.summary.size.counted > 0 ? usd0(hz.summary.size.usd) : '—'}
          </span>
          <span className={styles.metricLabel}>total size of buys</span>
          {/*
           * The hint states WHAT THE TOTAL LEFT OUT, computed, never assumed. Every row on the
           * current export carries both a price and a quantity, so today it reads as the
           * everything-case; the day one does not, the operator is told the count rather than
           * shown a total quietly missing rows.
           */}
          <span className={styles.metricHint}>
            {hz.summary.size.unsized === 0
              ? 'last price times quantity, every solicitation on the file'
              : `last price times quantity. ${hz.summary.size.unsized.toLocaleString()} of ${hz.summary.total.toLocaleString()} have no computable size and are not in this total`}
          </span>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>The solicitations</h2>
        <p className={styles.cardSub}>
          Ordered by close date, earliest first. These dates come from the feed-day export, so many
          have already passed; an <b>Open</b> chip marks the ones still open to quote. A stock
          number that is also one of our candidate corners links into its dossier.
        </p>
        <Scrollable className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Stock number</th>
                <th>
                  Solicitation
                  {/* The T versus U chips render in this column, and the branch they encode
                      is the opposite of what most people assume; the trap explainer sits
                      where the chips are read. */}
                  <ExplainButton helpId="traceability.surplus_type_branch" size="sm" />
                </th>
                <th>Part</th>
                <th className={styles.numCol}>Qty</th>
                <th className={styles.numCol}>Last price</th>
                <th className={styles.numCol}>Size of buy</th>
                <th>Close date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {hz.matches.map((m) => {
                const isCorner = cornerDigits.has(m.niin) || cornerDigits.has(m.nsn.replace(/[^0-9]/g, ''))
                const open = m.closeDate ? Date.parse(m.closeDate) >= nowMs : false
                return (
                  <tr key={`${m.nsn}:${m.solicitation}`}>
                    <td className="mono">
                      {isCorner ? (
                        <Link href={`/corner/${m.nsn.replace(/[^0-9]/g, '')}` as never} className={styles.nsnLink}>
                          {m.nsn}
                        </Link>
                      ) : (
                        <span className={styles.nsnPlain}>{m.nsn || '—'}</span>
                      )}
                    </td>
                    <td className="mono">
                      {m.solicitation || '—'}
                      {m.typeChar === 'U' ? <StatusChip tone="idle">U</StatusChip> : m.typeChar === 'T' ? <StatusChip tone="idle">T</StatusChip> : null}
                    </td>
                    <td className={styles.partCell} title={m.description}>
                      {m.description || '—'}
                    </td>
                    <td className={`mono ${styles.numCol}`}>{m.quantity?.toLocaleString() ?? '—'}</td>
                    <td className={`mono ${styles.numCol}`}>{usd(m.lastSoldPrice)}</td>
                    <td className={`mono ${styles.numCol} ${styles.sizeCol}`}>
                      {m.size.known ? usd0(m.size.usd) : '—'}
                    </td>
                    <td className={styles.closeCell}>
                      {m.closeDate ? (
                        <span className={styles.closeRow}>
                          <span className="mono">{m.closeDate}</span>
                          {open ? <StatusChip tone="verified">Open</StatusChip> : null}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {/* The pursuit wire, on rows that are also candidate corners (the same
                          rows whose stock number links into a dossier). */}
                      {isCorner && m.nsn ? (
                        <PursueButton
                          nsn={m.nsn}
                          niin={m.niin || null}
                          item={m.description ?? ''}
                          valueUsd={m.size.known ? m.size.usd : null}
                          initiallyInPipeline={pursued.has(normalizeDealRef(m.nsn))}
                        />
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Scrollable>
        <p className={styles.tableFoot}>
          &ldquo;Size of buy&rdquo; is the last unit price times the quantity requested, a rough
          figure, not a quote.{' '}
          {hz.summary.size.unsized > 0
            ? `A dash in that column means the government file is missing one of the two legs, so the size cannot be computed: ${hz.summary.size.unsized.toLocaleString()} of these ${hz.summary.total.toLocaleString()} rows. Unknown is not the same as small, and none of them is ranked as though it were worth nothing. `
            : ''}
          The <span className="mono">T</span> and <span className="mono">U</span>{' '}
          chips are the solicitation&rsquo;s ninth character: both mark the automated award path,
          where the buy is decided by machine and an alternate offer cannot win it.
        </p>
      </section>
    </main>
  )
}
