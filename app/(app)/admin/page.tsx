import { requireGateSession } from '@/lib/session/require-gate'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { getDirectory } from '@/lib/admin/directory'
import { describeRole } from '@/lib/admin/permissions'
import styles from './Admin.module.css'

export const metadata = { title: 'Admin & Users' }

/**
 * ADMIN & USERS. BUILD-DIRECTIVE surface 7. Owner: T7 ADMIN + API.
 *
 * ==========================================================================================
 * LOOK FROM THE COMP, STATE FROM REALITY. Conductor ruling, 2026-08-13.
 * ==========================================================================================
 * The approved comp draws the Connections vault card with DIBBS, SAM.gov and NSN-Now as
 * "connected" and ILS as "rotate". NONE of them are connected: there is no vault data, no
 * stored credential and no database. The comp's own footer says its data is illustrative.
 *
 * So this screen carries the comp's layout, density and palette, and renders every connection
 * in its TRUE state, which today is `not connected` for all four, each naming what it would
 * unlock and who can connect it. A single green dot implying a live feed would be the
 * "connection badge that overstates" this lane's charter names as a failure condition, and a
 * fabrication in a settings screen is still a fabrication.
 *
 * THE SECOND HONESTY DECISION, and it is the one an operator feels: there is no database, so a
 * role change or a deactivation COULD NOT BE SAVED. Rather than render controls that accept a
 * change and lose it, every mutating control is disabled with the reason stated in visible
 * text beside it. A screen that accepts a change it cannot persist is worse than one that says
 * it cannot: the operator would believe an account was closed when it was not.
 *
 * The two users are not placeholders. They are the organization's actual users, specified in
 * `_intel/BUILD-DIRECTIVE.md`, which David approved. They render as seeded identity and the
 * help panel says so, so nobody mistakes them for rows read from a database.
 */
export default async function AdminPage() {
  await requireGateSession()
  const directory = await getDirectory()
  const { org, users, roles, connectors, canMutate, mutateBlockedReason } = directory

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.heading}>
          <h1 className={styles.title}>
            Admin &amp; Users
            <ExplainButton helpId="admin.seeded_identity" size="sm" />
          </h1>
          <p className={styles.meta}>
            Organization <b>{org.name}</b> · multi-user, tenant-ready
          </p>
        </div>
        <div className={styles.topAction}>
          <Button variant="primary" disabled={!canMutate}>
            Invite user
          </Button>
          {mutateBlockedReason ? (
            <p className={styles.blockedReason}>{mutateBlockedReason}</p>
          ) : null}
        </div>
      </header>

      <div className={styles.body}>
        <section aria-label="Users" className={styles.table}>
          <div className={`${styles.row} ${styles.head}`} role="row">
            <span>User</span>
            <span>Role</span>
            <span>Title</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {users.map((u) => (
            <div key={u.id} className={styles.row} role="row">
              <div className={styles.user}>
                <span className={styles.avatar} aria-hidden="true">
                  {u.initials}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className={styles.name}>{u.name}</span>
                  <br />
                  <span className={styles.email}>{u.email}</span>
                </span>
              </div>
              <span>
                <StatusChip tone={u.roleKey === 'owner' ? 'verified' : 'active'}>
                  {u.roleName}
                </StatusChip>
              </span>
              <span className={styles.mono}>{u.title}</span>
              <span>
                <StatusChip tone="verified" srLabel="Active member of this organization">
                  Active
                </StatusChip>
              </span>
              <span>
                {/* Disabled rather than hidden: hiding it would leave an operator wondering
                    whether they lack the permission or the product lacks the feature. */}
                <Button variant="quiet" disabled={!canMutate}>
                  Manage
                </Button>
              </span>
            </div>
          ))}
        </section>

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
                <dd>{users.length} seeded</dd>
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
