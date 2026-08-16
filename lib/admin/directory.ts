import 'server-only'
import { env } from '@/lib/env'
import { ROLES, type Role } from './permissions'
import { readRoster, rosterWritable, type Roster, type RosterStatus } from './roster-store'
import {
  guardRemove,
  guardRoleChange,
  guardStatusChange,
  type GuardedUser,
  type RosterGuard,
} from './roster-rules'

/**
 * THE ADMIN DIRECTORY: the data behind the Admin & Users screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * THE HONESTY PROBLEM THIS MODULE SOLVES, STATED PLAINLY.
 *
 * There is still no configured database in this working tree. T1's schema is real and
 * `db/migrations/0001_foundation.sql` defines `org`, `app_user`, `membership`, `holding` and
 * `invitation`, but nothing is connected to this build.
 *
 * This module distinguishes three kinds of fact and NEVER blurs them:
 *
 *   1. PRODUCT FACTS, true by specification. The operator org is ONLYSOURCE. It ships with
 *      two users, David Hitchman (Owner) and David Goodreau (Admin), from
 *      `_intel/BUILD-DIRECTIVE.md`, which David approved. Their names and emails are what the
 *      product IS, so the roster store deliberately cannot overwrite them.
 *
 *   2. OPERATOR FACTS, which used to require the database and no longer do. Who is in the
 *      roster, what role they hold, whether the account is active. These are now REAL and
 *      PERSISTED in `.state/admin-users.json` (see `roster-store.ts`), which survives a
 *      deploy and a `git reset --hard`. This is why `canMutate` is now true: a change made on
 *      this screen is saved, so the controls may honestly render enabled. A screen that
 *      accepts a change it cannot persist is worse than one that says it cannot, and that
 *      cuts both ways: a screen that refuses a change it CAN persist is a product pretending
 *      to be broken.
 *
 *   3. FACTS THAT WOULD STILL NEED A DATABASE AND AN IDENTITY PROVIDER. Who signed in last,
 *      who changed a role and when, whether an invitation was accepted. UNAVAILABLE. Not
 *      stored, not rendered, not guessed. A plausible "last active" date would be a
 *      fabrication in a settings screen, which is the same defect as a green dot on a
 *      connector that is not connected.
 *
 *   4. MEASURED FACTS about connections. Nothing is connected, so every connector reports
 *      `not_connected`. The approved comp draws DIBBS, SAM and NSN-Now as "connected"; the
 *      comp's own footer calls its data illustrative. Conductor ruling, 2026-08-13: LOOK FROM
 *      THE COMP, STATE FROM REALITY. That ruling is UNCHANGED by this work and the connectors
 *      stay honestly unconnected until a real integration exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THE OPERATOR MUST BE TOLD, AND IS, IN `accessNote`.
 *
 * Access to this build is one shared organization phrase. There is no per person sign in yet.
 * So the roster records who is in the organization and what they may do; it does not create a
 * login and it does not email anybody. That sentence lives here, next to the data, so the
 * screen cannot drift away from what is true.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

export type DirectorySource = 'database' | 'operator_roster' | 'seed_identity'

/** Whether an operator may take an action, and if not, the sentence explaining why. */
export type ActionVerdict = { allowed: boolean; reason: string | null }

export type DirectoryUser = {
  id: string
  name: string
  email: string
  /**
   * Whether this person can sign in. A BOOLEAN, never the credential.
   *
   * `DirectoryUser` is serialized to the browser. The scrypt hash lives only in the server state
   * and must never travel on this object, so the interface is told the one thing it needs, which
   * is whether a sign in exists, and nothing it could ever misuse.
   */
  hasPassword: boolean
  /** Operator-facing job title. Both seeded users ship carrying "ProjectX". */
  title: string
  roleKey: string
  roleName: string
  status: RosterStatus
  initials: string
  /** True for the two users the product ships with. They can be changed but never removed. */
  seeded: boolean
  /**
   * What may be done to this row, decided by `roster-rules` on the SERVER. The interface
   * renders these; it never decides them. The route handler re-runs the same functions before
   * it writes, so a client that ignored a disabled attribute still gets refused.
   */
  actions: {
    changeRole: ActionVerdict
    deactivate: ActionVerdict
    activate: ActionVerdict
    remove: ActionVerdict
  }
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

/** A role as the browser needs it: a key and a name, with no server-only import behind it. */
export type RoleOption = { key: string; name: string }

export type DirectorySnapshot = {
  org: { name: string; boundary: string; billing: string }
  users: DirectoryUser[]
  roles: readonly Role[]
  /** Serializable role list for the client control. */
  roleOptions: RoleOption[]
  connectors: ConnectorState[]
  source: DirectorySource
  /**
   * Whether the roster can actually be saved, MEASURED against the state directory on every
   * request. Not "is a database configured" and not a hardcoded true: either of those is a
   * flag that stops tracking the thing it claims to describe.
   */
  canMutate: boolean
  /** Plain words for why not, when not. Never a silent disable. */
  mutateBlockedReason: string | null
  /** The standing truth about what this roster is and is not. Always shown. */
  accessNote: string
}

/** Product facts from `_intel/BUILD-DIRECTIVE.md`. Not a mock, not a placeholder. */
const SEEDED_USERS: ReadonlyArray<{
  id: string
  name: string
  email: string
  title: string
  roleKey: string
  initials: string
}> = [
  {
    // OWNER RULING 2026-08-16, verbatim: "There should only be one login built right now for
    // david@reddenda.com". A live instruction from the owner outranks the older build directive
    // that specified dhitchman@onlysource.ai, so the address is corrected here rather than kept
    // for consistency with a document he has since superseded.
    id: 'seed:hitchman',
    name: 'David Hitchman',
    email: 'david@reddenda.com',
    title: 'ProjectX',
    roleKey: 'owner',
    initials: 'DH',
  },
  {
    id: 'seed:goodreau',
    name: 'David Goodreau',
    email: 'dgoodreau@onlysource.ai',
    title: 'ProjectX',
    roleKey: 'admin',
    initials: 'DG',
  },
]

export const ACCESS_NOTE =
  'Sign in is by email and password. A person in this roster can only sign in once you give ' +
  'them a password here, and their role decides what they can reach. Deactivating somebody ' +
  'takes their sign in away immediately. Nothing on this screen sends an email. Every change ' +
  'is saved on the server.'

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

/** Two letters from a name. Computed, never invented, and never longer than the avatar. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase()
  return `${(parts[0] as string)[0] ?? ''}${(parts[parts.length - 1] as string)[0] ?? ''}`.toUpperCase()
}

/** Is a runtime database configured? Kept for the day the roster moves into Postgres. */
export function databaseConfigured(): boolean {
  return Boolean(env().DATABASE_URL_RUNTIME)
}

function verdict(g: RosterGuard): ActionVerdict {
  return g.ok ? { allowed: true, reason: null } : { allowed: false, reason: g.reason }
}

/**
 * Merge the seeded product facts with the operator's persisted roster.
 *
 * Exported and pure so it can be tested without touching the disk. The order matters and is
 * deliberate: seeded users first, in directive order, then added users in the order they were
 * added, so a row never jumps around under an operator's cursor after an unrelated change.
 */
export function mergeRoster(roster: Roster): Omit<DirectoryUser, 'actions'>[] {
  const seeded = SEEDED_USERS.map((u) => {
    const o = roster.overrides[u.id]
    const roleKey = o?.roleKey ?? u.roleKey
    return {
      ...u,
      title: o?.title ?? u.title,
      roleKey,
      roleName: roleFor(roleKey).name,
      status: o?.status ?? ('active' as RosterStatus),
      seeded: true,
      hasPassword: Boolean(o?.passwordHash),
    }
  })

  const added = roster.added.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    title: m.title,
    roleKey: m.roleKey,
    roleName: roleFor(m.roleKey).name,
    status: m.status,
    initials: initialsFor(m.name),
    seeded: false,
    hasPassword: Boolean(m.passwordHash),
  }))

  return [...seeded, ...added]
}

/** Attach the server's verdict on every action to every row. */
export function withActions(rows: Omit<DirectoryUser, 'actions'>[]): DirectoryUser[] {
  const guarded: GuardedUser[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    roleKey: r.roleKey,
    status: r.status,
    seeded: r.seeded,
  }))

  return rows.map((r) => ({
    ...r,
    actions: {
      // "Can this row's role be changed at all" is asked with the one role change that could
      // ever be refused: moving the last active owner off owner. Asking with a specific target
      // role would make the answer depend on which option the operator happened to hover.
      changeRole: verdict(guardRoleChange(guarded, r.id, r.roleKey === 'owner' ? 'admin' : r.roleKey)),
      deactivate: verdict(guardStatusChange(guarded, r.id, 'deactivated')),
      activate: verdict(guardStatusChange(guarded, r.id, 'active')),
      remove: verdict(guardRemove(guarded, r.id)),
    },
  }))
}

/** The roster as the interface and the API both see it. One path, no second implementation. */
export function buildUsers(roster: Roster): DirectoryUser[] {
  return withActions(mergeRoster(roster))
}

/**
 * Read the directory.
 *
 * Source reports what the rows actually came from: `seed_identity` when the operator has never
 * changed anything, `operator_roster` once they have. It will report `database` on the day the
 * roster moves into Postgres, and not before.
 */
export async function getDirectory(): Promise<DirectorySnapshot> {
  const roster = readRoster()
  const users = buildUsers(roster)
  const touched = Object.keys(roster.overrides).length > 0 || roster.added.length > 0
  const write = rosterWritable()

  return {
    org: {
      name: 'ONLYSOURCE',
      boundary: 'org-scoped, RLS-ready',
      // The charter is explicit that billing is a deliberate seam, not a missing feature.
      billing: 'not enabled (seam)',
    },
    users,
    roles: ROLES,
    roleOptions: ROLES.map((r) => ({ key: r.key, name: r.name })),
    connectors: CONNECTORS,
    source: touched ? 'operator_roster' : 'seed_identity',
    canMutate: write.writable,
    mutateBlockedReason: write.reason,
    accessNote: ACCESS_NOTE,
  }
}
