import { requireGateSession } from '@/lib/session/require-gate'
import {
  callerAccountId,
  callerCan,
  callerPermissions,
  readCaller,
  type Caller,
} from '@/lib/session/authz'
import { StatusChip } from '@/components/ui/StatusChip'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { getDirectory } from '@/lib/admin/directory'
import { describeRole } from '@/lib/admin/permissions'
import { SELF_ROLE_REASON, guardRoleGrant, guardRoleRemoval, guardSignInChange } from '@/lib/admin/roster-rules'
import { AdminConsole } from './AdminConsole'
import styles from './Admin.module.css'

export const metadata = { title: 'Admin & Users · ONLYSOURCE' }
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
 *
 * ==========================================================================================
 * WHAT CHANGED ON 2026-08-18: THE PAGE ASKS WHO IS LOOKING.
 * ==========================================================================================
 * It never did. It rendered the whole roster, with live controls, to any signed-in session,
 * because the API behind it authorized nothing and there was nothing for the page to ask. The
 * permission model was on screen and enforced nowhere.
 *
 * Now the viewer is resolved once, and the SAME `callerCan()` and roster-rule functions the API
 * runs decide what is drawn. A viewer without `users.manage` gets a stated refusal instead of a
 * roster, because the API would refuse them too and a screen that shows what the server will
 * not serve is a lie told slowly. A viewer without `roles.manage` sees the role selects
 * disabled with the reason. Nobody, at any level, gets a live control over their own role.
 */
export default async function AdminPage() {
  await requireGateSession()

  const caller = await readCaller()
  if (!callerCan(caller, 'users.manage')) {
    /*
     * No roster, not even a greyed-out one. `users.manage` is admin-plane, the API refuses this
     * viewer, and the roster is the shape of the organization: who is here, what they may do,
     * who can sign in. Drawing it disabled would hand that over anyway and call it a courtesy.
     */
    return (
      <div className={styles.page}>
        <header className={styles.top}>
          <div className={styles.heading}>
            <h1 className={styles.title}>Admin &amp; Users</h1>
            <p className={styles.meta}>
              Your role is <b>{callerRoleName(caller)}</b>
            </p>
          </div>
        </header>
        <div className={styles.body}>
          <p className={styles.accessNote}>
            Managing users is an admin permission, and your role does not hold it, so there is
            nothing on this screen for you. The API refuses the same requests for the same
            reason. Ask an owner if you need it.
          </p>
        </div>
      </div>
    )
  }

  const directory = await getDirectory()
  const { org, users, roles, roleOptions, connectors, accessNote, canMutate, mutateBlockedReason } =
    directory

  /*
   * The viewer's own limits, decided by the SAME functions the route handler calls. Not a second
   * implementation of the rules, a second CALLER of them, which is why the sentence under a
   * disabled control is the exact sentence the API would have answered with.
   */
  const held = callerPermissions(caller)
  const signInBlocked: Record<string, string> = {}
  /*
   * The role rules added on 2026-08-18, asked here for the SAME viewer the route will ask them
   * for. `guardRoleGrant` decides which options may be offered at all; `guardRoleRemoval`
   * decides which ROWS this viewer may rewrite. Asking them here is what keeps the picker from
   * offering a promotion the API is about to refuse, which is the failure mode the roster-rules
   * header calls worse than a control that is honestly dead.
   */
  const roleTargetBlocked: Record<string, string> = {}
  for (const u of users) {
    const g = guardSignInChange(held, {
      id: u.id,
      name: u.name,
      roleKey: u.roleKey,
      status: u.status,
      seeded: u.seeded,
    })
    if (!g.ok) signInBlocked[u.id] = g.reason

    /*
     * Asked with a role that is certainly a change, so the guard answers "may this viewer touch
     * this row's role at all" rather than short-circuiting on a no-op. `read_only` is the
     * smallest role in the product, so any account it does not equal is a real removal.
     */
    const probe = u.roleKey === 'read_only' ? 'operator' : 'read_only'
    const strip = guardRoleRemoval(held, {
      id: u.id,
      name: u.name,
      roleKey: u.roleKey,
      status: u.status,
      seeded: u.seeded,
    }, probe)
    if (!strip.ok) roleTargetBlocked[u.id] = strip.reason
  }
  const canManageRoles = callerCan(caller, 'roles.manage')
  const grantableRoleKeys = roleOptions
    .filter((r) => guardRoleGrant(held, r.key).ok)
    .map((r) => r.key)
  const viewer = {
    id: callerAccountId(caller),
    canManageRoles,
    roleBlockedReason: canManageRoles
      ? null
      : 'Changing somebody\'s role needs the "Manage roles" permission, which your role does not hold.',
    selfRoleReason: SELF_ROLE_REASON,
    signInBlocked,
    grantableRoleKeys,
    roleTargetBlocked,
  }

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
        <AdminConsole
          initial={users}
          roleOptions={roleOptions}
          accessNote={accessNote}
          canMutate={canMutate}
          mutateBlockedReason={mutateBlockedReason}
          viewer={viewer}
        />

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

/** The viewer's role as a person reads it, or the honest absence of one. */
function callerRoleName(caller: Caller): string {
  if (caller.kind === 'account') return caller.account.role.name
  if (caller.kind === 'bootstrap') return 'Break-glass session'
  return 'No account'
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
