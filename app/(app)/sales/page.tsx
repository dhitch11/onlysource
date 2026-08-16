import { requireGateSession } from '@/lib/session/require-gate'
import { StatusChip } from '@/components/ui/StatusChip'
import { readDeals } from '@/lib/sales/deals-store'
import { PipelineBoard } from './PipelineBoard'
import styles from './SalesHub.module.css'

export const metadata = { title: 'Pipeline · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

/**
 * THE PIPELINE — the operator's real deals, the one PURSUE surface.
 *
 * Named "Pipeline" in the nav and here (owner directive 2026-08-16: one entry, one name,
 * elementary language; "Sales Hub" and a second "Hunter Mode" nav row were two doors to this
 * same page). Deals are stored records the operator creates and moves through five stages;
 * every count and total is computed from those records, never estimated. Hunter Mode
 * (autonomous outreach) is the emphasised module below: it is built and gated, and its banner
 * states plainly that it has not run. Nothing here claims to have contacted a real person
 * until it has.
 */
export default async function SalesHubPage() {
  await requireGateSession('/sales')
  const deals = readDeals()

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Pipeline</h1>
        <p className={styles.subtitle}>
          Your deals, from first opportunity to won revenue. Pursue a find from any surface, or add
          one here, then move it through the stages. Every figure is counted from your stored deals.
        </p>
      </header>

      {/* ---------------------------------------------------------------- Hunter Mode */}
      <section className={styles.banner} aria-labelledby="hunter-heading">
        <div className={styles.bannerMain}>
          <p className={styles.bannerTitle} id="hunter-heading">
            Hunter Mode
            <StatusChip tone="idle" srLabel="Hunter Mode status">
              Not running
            </StatusChip>
          </p>
          <p className={styles.bannerLine}>
            Hunter Mode is the autonomous outreach engine. It is built and gated, and it has not run:
            no sequences are going out, no replies have come in, and no calls have been placed. When
            it is switched on, these numbers fill from real events only, never from an estimate.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- the pipeline */}
      <PipelineBoard initial={deals} />
    </div>
  )
}
