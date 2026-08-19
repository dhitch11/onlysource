import type { Metadata } from 'next'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { RUNG_LABELS } from '@/lib/intelligence/pricing/recommend'
import { buildPricingBoard } from './board'
import { PricingGrid } from './PricingGrid'
import styles from './pricing.module.css'

export const metadata: Metadata = { title: 'Recommended quotes · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

/**
 * THE PRICING BOARD.
 *
 * =========================================================================================
 * WHY THIS ROUTE EXISTS, AND WHAT CHANGED TO MAKE IT LEGAL
 * =========================================================================================
 * For months this product published four separately auditable figures and deliberately no
 * single recommended number, and the measured consequence was silence on 98.1% of rows. The
 * owner lifted that rule on 2026-08-18: silence is now the product failure. So every served
 * requirement gets the strongest defensible figure its own evidence can carry, with the basis
 * named, the arithmetic shown, and an honest abstention where the evidence runs out.
 *
 * =========================================================================================
 * CONFIDENCE IS THE RUNG, AND THE BAND WIDENS AS YOU DESCEND
 * =========================================================================================
 * There is no confidence score on this page and there will not be one. A 0 to 100 number
 * nobody can audit reads as a measurement and is a feeling. What a row carries instead is the
 * RUNG it landed on, in the operator's own words, and the ladder is ordered so a weaker basis
 * can never report a tighter band than a stronger one on the same row. A row whose only basis
 * is the supply-class peer group shows a BAND with its peer count in the sentence, never a
 * point estimate with a caveat: a caveat is read once and a number is read every time, while a
 * band's width IS its uncertainty and is therefore self-describing.
 *
 * =========================================================================================
 * THE BOUND IS PRINTED, NOT IMPLIED
 * =========================================================================================
 * MEASURED on the live archive: the full 5,366-row payload is 3.93MB per visit, and the first
 * draft of the row (carrying every caveat and roadmap sentence) was 17.56MB. /monopoly already
 * shipped that defect once at 25.98MB. So the wire is bounded in ./wire.ts, the page prints
 * exactly what it shipped and what it left out, and EVERY COUNT below is taken over all served
 * rows rather than over the slice. A bounded board is honest; a silently bounded one is not.
 */
export default async function PricingPage() {
  await requireGateSession('/pricing')

  const root = resolveDataRoot()
  if (!root.present) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Pricing</p>
          <h1 className={styles.h1}>Recommended quotes</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>The data directory is not mounted here</h2>
          <p>
            Every figure on this page is computed from the government feed files and the award
            history on disk, and this environment has neither. Nothing is shown rather than a
            fabricated board, and nothing has been assumed in its place.
          </p>
          <p className="mono">{root.root}</p>
        </div>
      </main>
    )
  }

  const board = buildPricingBoard()
  if (!board.ok) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Pricing</p>
          <h1 className={styles.h1}>Recommended quotes</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>There is nothing to price today</h2>
          <p>{board.reason}</p>
        </div>
      </main>
    )
  }

  const { totals, shipped, budget, orderedBy } = board.bound
  const pct = (n: number): string => `${((n / Math.max(1, totals.all)) * 100).toFixed(1)}%`
  const bounded = shipped.length < totals.all

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Pricing</p>
        <h1 className={styles.h1}>Recommended quotes</h1>
        <p className={styles.lede}>
          One defensible figure on every requirement the evidence can carry one, on the strongest
          basis that row holds. The basis is named on every row, the arithmetic is printed under
          the figure, and where nothing reaches, the row says so and names the input it needs. A
          figure here is what we would SEND. The evaluation factors DLA adds when it ranks us are
          the buyer&rsquo;s arithmetic and appear only on the dossier, never folded into a quote.
        </p>
      </header>

      {/* ------------------------------------------------------------------ the register */}
      <section className={styles.register} aria-labelledby="reg-title">
        <h2 className={styles.registerTitle} id="reg-title">
          What this board is showing
        </h2>

        <p className={styles.bound}>
          {bounded ? (
            <>
              Showing the top <span className={styles.boundNum}>{shipped.length.toLocaleString()}</span>{' '}
              of <span className={styles.boundNum}>{totals.all.toLocaleString()}</span> served
              requirements, ordered {orderedBy}.
            </>
          ) : (
            <>
              Showing all <span className={styles.boundNum}>{totals.all.toLocaleString()}</span>{' '}
              served requirements, ordered {orderedBy}.
            </>
          )}
        </p>
        <p className={styles.registerNote}>
          {bounded
            ? `The wire is bounded at ${budget.toLocaleString()} rows because the full board serialises to 3.93MB on every visit and this page is not cached. Every number below is counted over all ${totals.all.toLocaleString()} served rows, never over the ${shipped.length.toLocaleString()} shown, so the counts are the board's and not the page's. `
            : `The wire is bounded at ${budget.toLocaleString()} rows and today's board is inside that bound, so nothing was left out. Every number below is counted over all ${totals.all.toLocaleString()} served rows. `}
          Feed day <span className="mono">{board.feedDay}</span>, judged against{' '}
          <span className="mono">{board.asOf}</span>. There is deliberately no board-wide dollar
          total: adding a recommended quote across every requirement would produce a headline for
          a set of quotes nobody would ever send together.
        </p>

        <div className={styles.tiles}>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{totals.all.toLocaleString()}</span>
            <span className={styles.tileLabel}>served requirements</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{pct(totals.covered)}</span>
            <span className={styles.tileLabel}>
              carry a figure ({totals.covered.toLocaleString()} rows)
            </span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{totals.abstained.toLocaleString()}</span>
            <span className={styles.tileLabel}>
              abstain, each naming the input it needs
            </span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{totals.bands.toLocaleString()}</span>
            <span className={styles.tileLabel}>
              are a band, {totals.points.toLocaleString()} a single figure
            </span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{totals.crossingDlad.toLocaleString()}</span>
            <span className={styles.tileLabel}>
              cross the DLAD 17.7505 band, so the buy stops being automatic
            </span>
          </div>
        </div>

        {/* ------------------------------------------------------------- the ladder key */}
        <div className={styles.ladder}>
          <p className={styles.ladderTitle}>
            The basis ladder, counted over all {totals.all.toLocaleString()} rows
          </p>
          {totals.byRung.map((r, i) => {
            const share = totals.all === 0 ? 0 : (r.count / totals.all) * 100
            return (
              <div key={r.rung} className={styles.rungRow}>
                <span className={styles.rungId}>R{i + 1}</span>
                <span className={styles.rungLabel}>{RUNG_LABELS[r.rung]}</span>
                <span className={styles.rungCount}>{r.count.toLocaleString()}</span>
                <span className={styles.rungPct}>{share.toFixed(1)}%</span>
                <span className={styles.rungBarWrap}>
                  <span
                    className={styles.rungBar}
                    data-weakest={i === totals.byRung.length - 1 ? 'true' : 'false'}
                    style={{ inlineSize: `${share.toFixed(2)}%` }}
                  />
                </span>
              </div>
            )
          })}
        </div>

        {board.awardsJoined ? null : (
          <p className={styles.registerNote}>
            The award index is not loaded here, so no rung that reads this item&rsquo;s own award
            history could run: {board.awardsUnavailableReason}. Nothing was estimated in its place.
          </p>
        )}
        {board.classifierJoined ? null : (
          <p className={styles.registerNote}>
            The surplus-dealer verdict could not be read, so no comparable was excluded or labelled
            as surplus material on any row. That is a silence, not a finding that every awardee was
            a manufacturer.
          </p>
        )}
      </section>

      <PricingGrid rows={[...shipped]} />
    </main>
  )
}
