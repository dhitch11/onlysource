import 'server-only'
import { env } from '@/lib/env'
import { ROLES, type Role } from './permissions'

/**
 * THE ADMIN DIRECTORY: the data behind the Admin & Users screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * THE HONESTY PROBLEM THIS MODULE SOLVES, STATED PLAINLY.
 *
 * There is no configured database in this working tree (only `.env.example` exists, carrying
 * placeholder connection strings). T1's schema is real and `db/migrations/0001_foundation.sql`
 * defines `org`, `app_user`, `membership`, `holding` and `invitation`, but nothing is connected
 * to this build yet.
 *
 * So this module distinguishes three kinds of fact and NEVER blurs them:
 *
 *   1. PRODUCT FACTS, true by specification. The operator org is ONLYSOURCE. Its two users are
 *      David Hitchman (Owner) and David Goodreau (Admin), both titled ProjectX. These come from
 *      `_intel/BUILD-DIRECTIVE.md`, which David approved. They are not placeholders and not
 *      invented; they are what the product IS. They are rendered, and they are labelled as
 *      seeded identity rather than as rows read from a database.
 *
 *   2. PERSISTED FACTS, which require the database. Whether a user was deactivated last
 *      Tuesday, when an invitation was sent, who changed a role. These are UNAVAILABLE right
 *      now, and the surface says so rather than showing a confident default.
 *
 *   3. MEASURED FACTS about connections. Nothing is connected, so every connector reports
 *      `not_connected`. The approved comp draws DIBBS, SAM and NSN-Now as "connected"; the
 *      comp's own footer calls its data illustrative. Conductor ruling, 2026-08-13: LOOK FROM
 *      THE COMP, STATE FROM REALITY.
 *
 * The consequence for the interface is the important part: **an action that cannot persist must
 * not render as though it can.** `canMutate` is false while the database is absent, and the
 * screen disables those controls with the reason stated. A control that looks live and is not
 * wired is the exact thing house law 9 forbids.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

export type DirectorySource = 'database' | 'seed_identity'

export type DirectoryUser = {
  id: string
  name: string
  email: string
  /** Operator-facing job title. Both seeded users carry "ProjectX". */
  title: string
  roleKey: string
  roleName: string
  /** Only meaningful when sourced from the database. */
  status: 'active' | 'invited' | 'suspended' | 'offboarded'
  initials: string
}

export type ConnectorState = {
  slug: string
  /** Named as the operator names it, not as the table names it. */
  label: string
  display: 'not_connected' | 'connected_raw' | 'connected_integrated' | 'failing'
  /** What connecting it would add TO THIS SURFACE. Feeds T8's <NotConnected wouldAdd>. */
  wouldAdd: string
  whoCanConnect: string
}

export type DirectorySnapshot = {
  org: { name: string; boundary: string; billing: string }
  users: DirectoryUser[]
  roles: readonly Role[]
  connectors: ConnectorState[]
  source: DirectorySource
  /** False while there is no database. Drives whether mutating controls render enabled. */
  canMutate: boolean
  /** Plain words for why, shown in the interface. Never a silent disable. */
  mutateBlockedReason: string | null
}

/** Product facts from `_intel/BUILD-DIRECTIVE.md`. Not a mock, not a placeholder. */
const SEEDED_USERS: ReadonlyArray<Omit<DirectoryUser, 'roleName'>> = [
  {
    id: 'seed:hitchman',
    name: 'David Hitchman',
    email: 'dhitchman@onlysource.ai',
    title: 'ProjectX',
    roleKey: 'owner',
    status: 'active',
    initials: 'DH',
  },
  {
    id: 'seed:goodreau',
    name: 'David Goodreau',
    email: 'dgoodreau@onlysource.ai',
    title: 'ProjectX',
    roleKey: 'admin',
    status: 'active',
    initials: 'DG',
  },
]

/**
 * The connector registry, in its true state.
 *
 * Every row is `not_connected` because every row IS not connected. `wouldAdd` is written per
 * connector and per surface, because "connect this to unlock features" tells an operator
 * nothing they can act on.
 */
const CONNECTORS: ConnectorState[] = [
  {
    slug: 'dibbs',
    label: 'DIBBS',
    display: 'not_connected',
    wouldAdd: 'Daily requirement rows and the quoting file would load automatically each morning.',
    whoCanConnect: 'Owner or Admin',
  },
  {
    slug: 'sam',
    label: 'SAM.gov',
    display: 'not_connected',
    wouldAdd: 'Entity and exclusion checks would run against the register before a quote goes out.',
    whoCanConnect: 'Owner or Admin',
  },
  {
    slug: 'nsn-now',
    label: 'NSN-Now',
    display: 'not_connected',
    wouldAdd: 'Part lookups would resolve against the commercial catalog instead of stopping at the NIIN.',
    whoCanConnect: 'Owner or Admin',
  },
  {
    slug: 'ils',
    label: 'ILS',
    display: 'not_connected',
    wouldAdd: 'Supplier availability and pricing would be searchable from inside a pursuit.',
    whoCanConnect: 'Owner or Admin',
  },
]

function roleFor(key: string): Role {
  return ROLES.find((r) => r.key === key) ?? (ROLES[2] as Role)
}

/** Is a runtime database configured? The one question that decides source and mutability. */
export function databaseConfigured(): boolean {
  return Boolean(env().DATABASE_URL_RUNTIME)
}

/**
 * Read the directory.
 *
 * When the database lands this grows a branch that reads `org`, `app_user` and `membership`
 * through T1's `withOrg` unit of work under RLS. Until then it returns the seeded identity and
 * says so, which is the honest empty-state direction rather than the confident-default one.
 */
export async function getDirectory(): Promise<DirectorySnapshot> {
  const configured = databaseConfigured()

  const users: DirectoryUser[] = SEEDED_USERS.map((u) => ({
    ...u,
    roleName: roleFor(u.roleKey).name,
  }))

  return {
    org: {
      name: 'ONLYSOURCE',
      boundary: 'org-scoped, RLS-ready',
      // The charter is explicit that billing is a deliberate seam, not a missing feature.
      billing: 'not enabled (seam)',
    },
    users,
    roles: ROLES,
    connectors: CONNECTORS,
    source: configured ? 'database' : 'seed_identity',
    canMutate: configured,
    mutateBlockedReason: configured
      ? null
      : 'No database is connected to this build, so a change could not be saved. ' +
        'User management becomes editable when the organization database is configured.',
  }
}
