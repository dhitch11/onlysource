import { requireGateSession } from '@/lib/session/require-gate'
import { EmptyState, NotConnected } from '@/components/ui/States'
import { StatusChip } from '@/components/ui/StatusChip'
import { Money } from '@/components/ui/Money'
import { computeStageMetrics, type Deal } from '@/lib/sales/pipeline'
import { renderWithheldSummary, type HunterCounters, type HunterState } from '@/lib/sales/hunter'
import styles from './SalesHub.module.css'

export const metadata = { title: 'Sales Hub' }

/**
 * THE SALES HUB. BUILD-DIRECTIVE surfaces 3 and 4.
 *
 * ==========================================================================================
 * THE ONE DECISION ON THIS PAGE THAT MATTERS MORE THAN THE LAYOUT
 * ==========================================================================================
 * There is no `deal` table yet. T1 has not migrated this lane's tables.
 *
 * So the honest count of deals in each stage is NOT ZERO. It is UNKNOWN, and those are
 * different facts. A zero rendered from a source that was never written is the exact defect
 * pattern this estate has already been burned by: a column nobody populated reads on screen
 * as a measured result, and the operator believes the pipeline is empty when in truth nothing
 * has ever looked.
 *
 * Therefore this page renders `NotConnected` for the pipeline body until a deal store exists,
 * and the five columns render their real structure with their counts SUPPRESSED rather than
 * shown as 0. The moment T1's migration lands, `deals` becomes a real query and every number
 * on this page becomes a measurement, computed by `computeStageMetrics`, never by a model.
 *
 * The approved mockup shows this surface populated (Moog manifold, 213 opportunities, $4.24M,
 * "12 sequences running, 4 replies today"). That data is illustrative and does not ship. A
 * screen that differs from the comp because reality differs is honest, not defective, and on
 * THIS surface it matters more than anywhere else in the product: Hunter Mode claiming
 * sequences are running is the product claiming it has contacted real people. It has not.
 */

/** True once a deal store exists and can be queried. Hard-wired false until T1 migrates. */
const DEAL_STORE_CONNECTED = false

/** Real deals. Empty array is not "no deals", it is "we have not asked", until the flag flips. */
const deals: Deal[] = []

/**
 * The real Hunter state. Not persisted yet, so it reports the honest configuration state
 * rather than pretending to be a live toggle. A control that looks live and is not wired is
 * banned by house law, so the toggle below renders as a stated OFF, not as a switch that
 * silently does nothing.
 */
const hunter: HunterState | null = DEAL_STORE_CONNECTED
  ? ({ mode: 'paused', changedBy: 'DH', changedAt: 0, reason: null } satisfies HunterState)
  : null

/** Counters come from audited events only. With no event store, they are unknown, not zero. */
const counters: HunterCounters | null = null

export default async function SalesHubPage() {
  await requireGateSession('/sales')

  const metrics = computeStageMetrics(deals)
  const withheldLine =
    counters === null ? null : renderWithheldSummary(counters.withheldToday)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Sales Hub</h1>
        <p className={styles.subtitle}>
          Opportunities through to won revenue. Every figure is computed from a stored record.
        </p>
      </header>

      {/* ---------------------------------------------------------------- Hunter Mode */}
      <section className={styles.banner} aria-labelledby="hunter-heading">
        <div className={styles.bannerMain}>
          <p className={styles.bannerTitle} id="hunter-heading">
            Hunter Mode
            {hunter === null ? (
              <StatusChip tone="idle" srLabel="Hunter Mode status">
                Not configured
              </StatusChip>
            ) : (
              <StatusChip
                tone={hunter.mode === 'active' ? 'active' : 'idle'}
                srLabel="Hunter Mode status"
              >
                {hunter.mode === 'active' ? 'Active' : 'Paused'}
              </StatusChip>
            )}
          </p>

          {counters === null ? (
            <p className={styles.bannerLine}>
              The outreach engine is built and gated, and it has not run. No sequences are
              running, no replies have been received, and no calls have been placed. These
              counters will fill from audited events only, never from an estimate.
            </p>
          ) : (
            <p className={styles.bannerLine}>
              <strong>{counters.sequencesRunning}</strong> sequences running,{' '}
              <strong>{counters.repliesToday}</strong> human replies today,{' '}
              <strong>{counters.connectedCallsToday}</strong> connected calls,{' '}
              <strong>{counters.bookingsToday}</strong> booked.
            </p>
          )}

          {withheldLine === null ? null : <p className={styles.withheld}>{withheldLine}</p>}
        </div>

        <div className={styles.bannerActions}>
          {/*
           * The Active toggle and the two action buttons are DELIBERATELY ABSENT rather than
           * rendered disabled, because a greyed switch still asserts that a switch exists here
           * and works. What exists today is the logic behind them, fully tested. What does not
           * exist is anything for them to write to.
           */}
          <StatusChip tone="idle" srLabel="Why the controls are not shown">
            Controls appear when the deal store is connected
          </StatusChip>
        </div>
      </section>

      {/* ---------------------------------------------------------------- the pipeline */}
      {!DEAL_STORE_CONNECTED ? (
        <div className={styles.notice}>
          <NotConnected
            source="The deal store"
            wouldAdd="every opportunity, lead, quote and won award in the pipeline, with its stage, owner and value"
            whoCanConnect="T1 Foundation, once the deal tables are migrated"
          />
        </div>
      ) : null}

      <section aria-label="Pipeline" className={styles.pipe}>
        {metrics.map((m) => {
          const stageDeals = deals.filter((d) => d.stage === m.stage)
          return (
            <div className={styles.col} key={m.stage}>
              <div className={styles.colHead}>
                <span className={styles.dot} aria-hidden="true" />
                <h2 className={styles.colName}>{m.label}</h2>
                <span className={styles.colCount}>
                  {/*
                   * Not "0". An em-less placeholder that says plainly the number is unknown,
                   * because a suppressed count and a measured zero must never look alike.
                   */}
                  {DEAL_STORE_CONNECTED ? m.count : 'not connected'}
                </span>
                {DEAL_STORE_CONNECTED ? (
                  <span className={styles.colValue}>
                    <Money
                      amount={m.count === 0 ? null : m.valueCents / 100}
                      provenance={m.count === 0 ? 'insufficient' : 'modelled'}
                      precision={0}
                      absentReason="No deals in this stage yet"
                    />
                    {m.unknownValueCount > 0 ? (
                      <> {m.unknownValueCount} without a value</>
                    ) : null}
                  </span>
                ) : null}
              </div>

              <div className={styles.colBody}>
                {stageDeals.length === 0 ? (
                  <p className={styles.columnEmpty}>
                    {DEAL_STORE_CONNECTED
                      ? 'Nothing here yet.'
                      : 'Waiting on the deal store.'}
                  </p>
                ) : (
                  stageDeals.map((d) => (
                    <article className={styles.card} key={d.id}>
                      <p className={styles.cardTitle}>{d.subject.title}</p>
                      <p className={styles.cardMeta}>
                        <span className={styles.owner} aria-label={`Owner ${d.owner}`}>
                          {d.owner}
                        </span>
                        {d.nextAction ?? 'No next action'}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </section>

      {deals.length === 0 && DEAL_STORE_CONNECTED ? (
        <EmptyState
          title="No deals yet"
          body="Deals appear here as the board surfaces scored requirements. Nothing is seeded, so an empty pipeline means the pipeline is genuinely empty."
        />
      ) : null}

      <noscript>
        <p className={styles.bannerLine}>
          This page renders its full state without JavaScript. Nothing above is filled in by
          the browser.
        </p>
      </noscript>
    </div>
  )
}
