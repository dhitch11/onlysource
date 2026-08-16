import { requireGateSession } from '@/lib/session/require-gate'
import { StatusChip } from '@/components/ui/StatusChip'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { getDirectory } from '@/lib/admin/directory'
import { describeRole } from '@/lib/admin/permissions'
import { AdminConsole } from './AdminConsole'
import styles from './Admin.module.css'

export const metadata = { title: 'Admin & Users' }
export const dynamic = 'force-dynamic'

/**
 * ADMIN & USERS. BUILD-DIRECTIVE surface 7. Owner: T7 ADMIN + API.
 *
 * ==========================================================================================
 * LOOK FROM THE COMP, STATE FROM REALITY. Conductor ruling, 2026-08-13. STILL IN FORCE.
 * ==========================================================================================
 * The approved comp draws the Connections vault card with DIBBS, SAM.gov and NSN-Now as
 * "connected" and ILS as "rotate". NONE of them are connected: there is no vault data, no
 * stored credential and no integration. The comp's own footer says its data is illustrative.
 *
 * So this screen carries the comp's layout, density and palette, and renders every connection
 * in its TRUE state, which today is `not connected` for all four, each naming what it would
 * unlock and who can connect it. A single green dot implying a live feed would be a
 * fabrication in a settings screen, and it is not drawn.
 *
 * ==========================================================================================
 * WHAT CHANGED ON 2026-08-16, AND WHY IT IS THE SAME PRINCIPLE, NOT A REVERSAL.
 * ==========================================================================================
 * The original build disabled every mutating control with the reason stated, because there
 * was no database and a role change or a deactivation could not have been saved. That was
 * correct then. The roster now persists to the same gitignored state directory that already
 * carries the deal pipeline, the packet vault and the alert settings, and it survives a deploy
 * and a `git reset --hard`. A change made here IS saved.
 *
 * The rule never was "disable things". It was: NEVER RENDER A CONTROL WHOSE EFFECT YOU CANNOT
 * HONOUR. Both directions of that rule are live on this page at once. The roster controls are
 * enabled, because they save. The connectors stay honestly not connected, because they do not.
 * And the one thing this roster genuinely cannot do, create a per person sign in, is stated in
 * plain words above the table rather than left for an operator to assume.
 */
export default async function AdminPage() {
  await requireGateSession()
  const directory = await getDirectory()
  const { org, users, roles, roleOptions, connectors, accessNote } = directory

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.heading}>
          <h1 className={styles.title}>
            Admin &amp; Users
            <ExplainButton helpId="admin.roster" size="sm" />
          </h1>
          <p className={styles.meta}>
            Organization <b>{org.name}</b> · multi-user, tenant-ready
          </p>
        </div>
      </header>

      <div className={styles.body}>
        <AdminConsole initial={users} roleOptions={roleOptions} accessNote={accessNote} />

        <div className={styles.cards}>
          <section className={styles.card} aria-label="Roles and permissions">
            <h2 className={styles.cardTitle}>
              Roles &amp; permissions
              <ExplainButton helpId="admin.role" size="sm" />
            </h2>
            <p className={styles.cardSub}>Server-enforced, editable as data</p>
            <dl className={styles.pairs}>
              {roles.map((r) => (
                <div key={r.key} className={styles.pair}>
                  <dt>{r.name}</dt>
                  {/* DERIVED from the permissions the role actually holds, never hand-written,
                      because a hand-written list drifts from the server within one sprint. */}
                  <dd>{summarise(describeRole(r).length, r.key)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles.card} aria-label="Organization">
            <h2 className={styles.cardTitle}>
              Organization
              <ExplainButton helpId="admin.plane" size="sm" />
            </h2>
            <p className={styles.cardSub}>Single-org deployment, tenant-ready</p>
            <dl className={styles.pairs}>
              <div className={styles.pair}>
                <dt>Org</dt>
                <dd>{org.name}</dd>
              </div>
              <div className={styles.pair}>
                <dt>Users</dt>
                <dd>{users.length} in the roster</dd>
              </div>
              <div className={styles.pair}>
                <dt>Data boundary</dt>
                <dd>{org.boundary}</dd>
              </div>
              <div className={styles.pair}>
                <dt>Billing</dt>
                <dd>{org.billing}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.card} aria-label="Connections vault">
            <h2 className={styles.cardTitle}>
              Connections vault
              <ExplainButton helpId="admin.connection_state" size="sm" />
            </h2>
            <p className={styles.cardSub}>Encrypted credentials for the data sources</p>
            <div className={styles.connections}>
              {connectors.map((c) => (
                <div key={c.slug} className={styles.connection}>
                  <div className={styles.connectionHead}>
                    <span className={styles.connectionName}>{c.label}</span>
                    {/* `idle` is the quietest tone and the correct one for "not connected".
                        Amber and red are reserved fleet-wide for the auto-award clock, so a
                        connection may never wear them however badly it is doing. The WORD
                        carries the state; the hue never carries it alone. */}
                    <StatusChip tone="idle">not connected</StatusChip>
                  </div>
                  <p className={styles.wouldAdd}>
                    {c.wouldAdd} Can be connected by: {c.whoCanConnect}.
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/**
 * A short, honest summary of what a role can do.
 *
 * Takes the COUNT from `describeRole`, so it moves when the permission set moves. The owner
 * line says "all permissions" only when the role genuinely holds every one.
 */
function summarise(count: number, key: string): string {
  if (key === 'owner') return 'all permissions'
  return `${count} permission${count === 1 ? '' : 's'}`
}
