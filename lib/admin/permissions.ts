import 'server-only'

/**
 * ROLES AND PERMISSIONS. The security spine behind the Admin & Users screen.
 *
 * The charter's requirement is specific and it rules out the obvious implementation:
 *
 *   "a real, extensible permissions system, not three hard-coded strings. A ROLE is a named set
 *    of server-enforced PERMISSIONS an admin can assign, and the model supports adding new roles
 *    and new permissions without a schema rebuild ... Model permissions as data an admin edits,
 *    not as a fixed enum."
 *
 * So a permission is a ROW, a role is a NAMED SET of permission keys, and `can()` asks the set.
 * Adding a capability later is inserting data, not editing a union type and re-migrating.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * THE TWO-PLANE RULE IS ENFORCED STRUCTURALLY, NOT BY REVIEW.
 *
 * "An operator must never reach /internal/*, and no admin capability is ever expressible in the
 * operator role model." A comment saying so is worth nothing. Every permission therefore carries
 * a `plane`, and `assertRoleWellFormed()` REFUSES to construct an operator-plane role that holds
 * an admin-plane permission. The failure is at construction, in a test, not in production.
 *
 * This is the failure the charter calls "the failure that ends a company rather than a sprint":
 * a `super_admin` value smuggled into the operator role enum breaks every least-privilege check
 * at once and makes "which operator could see this margin last Tuesday" unanswerable.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

export type Plane = 'operator' | 'admin'

export type Permission = {
  key: string
  label: string
  /** Plain language, shown in the interface. The role's help text is DERIVED from these, never
   *  hand-written, because a hand-written explanation of a permission drifts from the
   *  permission within one sprint and a wrong one is worse than none. */
  description: string
  plane: Plane
  /**
   * Reading this is itself the sensitive act, so exercising it emits an audit event.
   * Document bodies, supplier identities, margins and credentials all sit here.
   */
  sensitive: boolean
}

/**
 * The seeded permission catalog. DATA, not a union type.
 *
 * In the deployed system these are rows an admin can extend. They are defined here so the
 * product has a correct starting set and so the well-formedness tests have something to run
 * against before the database exists.
 */
export const PERMISSIONS: readonly Permission[] = [
  // ---- operator plane: the daily pursuit and quoting work ----
  { key: 'board.view', label: 'View the board', description: 'See the daily requirements board.', plane: 'operator', sensitive: false },
  { key: 'board.quote', label: 'Quote', description: 'Prepare and submit quotes against requirements.', plane: 'operator', sensitive: false },
  { key: 'supplier.pursue', label: 'Pursue suppliers', description: 'Contact and chase suppliers for material.', plane: 'operator', sensitive: false },
  { key: 'supplier.identity.view', label: 'See supplier identities', description: 'See which supplier a quote or lot came from.', plane: 'operator', sensitive: true },
  { key: 'margin.view', label: 'See margins', description: 'See cost, margin and pricing on a quote.', plane: 'operator', sensitive: true },
  { key: 'document.view', label: 'Open documents', description: 'Open drawings, specifications and traceability packets.', plane: 'operator', sensitive: true },
  { key: 'data.import', label: 'Import data', description: 'Upload spreadsheets and commit rows.', plane: 'operator', sensitive: false },
  { key: 'data.export', label: 'Export data', description: 'Download the current view as a file.', plane: 'operator', sensitive: true },

  // ---- admin plane: the privileged console at /internal/* ----
  { key: 'users.manage', label: 'Manage users', description: 'Invite, add, deactivate and assign roles.', plane: 'admin', sensitive: false },
  { key: 'roles.manage', label: 'Manage roles', description: 'Create roles and change which permissions they hold.', plane: 'admin', sensitive: false },
  { key: 'connections.manage', label: 'Manage connections', description: 'Add and replace data-source credentials. Never reveals a stored secret.', plane: 'admin', sensitive: true },
  { key: 'audit.read', label: 'Read the audit log', description: 'Read the organization audit log and export it.', plane: 'admin', sensitive: true },
  { key: 'org.manage', label: 'Manage the organization', description: 'Change organization settings and holdings.', plane: 'admin', sensitive: false },
  { key: 'breakglass.use', label: 'Use break-glass view', description: 'View the app as another user to reproduce a defect. Read-only, logged, expiring.', plane: 'admin', sensitive: true },
]

const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]))

export function permission(key: string): Permission | undefined {
  return BY_KEY.get(key)
}

export type Role = {
  key: string
  name: string
  /** The highest plane this role may hold. An operator role can never hold an admin permission. */
  plane: Plane
  permissions: readonly string[]
  /** Built-in roles ship with the product; an admin may add more. */
  builtin: boolean
}

const OPERATOR_PERMISSIONS = [
  'board.view',
  'board.quote',
  'supplier.pursue',
  'supplier.identity.view',
  'margin.view',
  'document.view',
  'data.import',
  'data.export',
]

const ADMIN_PERMISSIONS = [
  'users.manage',
  'roles.manage',
  'connections.manage',
  'audit.read',
  'org.manage',
  'breakglass.use',
]

/**
 * The four roles that ship. Extensible: an admin adds a fifth by inserting a row.
 *
 * READ-ONLY IS THE INTERESTING ONE. It deliberately excludes every `sensitive` permission, which
 * is the charter's "a read-only role never sees a document body, a supplier identity, a margin or
 * a secret." That is a real security control and the sales answer to "can your staff read my
 * supplier negotiations", so it is default-deny in the model rather than a policy memo.
 */
export const ROLES: readonly Role[] = [
  {
    key: 'owner',
    name: 'Owner',
    plane: 'admin',
    permissions: [...OPERATOR_PERMISSIONS, ...ADMIN_PERMISSIONS],
    builtin: true,
  },
  {
    key: 'admin',
    name: 'Admin',
    plane: 'admin',
    permissions: [...OPERATOR_PERMISSIONS, ...ADMIN_PERMISSIONS.filter((p) => p !== 'org.manage')],
    builtin: true,
  },
  {
    key: 'operator',
    name: 'Operator',
    plane: 'operator',
    permissions: OPERATOR_PERMISSIONS,
    builtin: true,
  },
  {
    key: 'read_only',
    name: 'Read-only',
    plane: 'operator',
    // Every non-sensitive operator permission, and nothing marked sensitive.
    permissions: OPERATOR_PERMISSIONS.filter((k) => !BY_KEY.get(k)?.sensitive),
    builtin: true,
  },
]

export class RoleShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoleShapeError'
  }
}

/**
 * Refuse a malformed role AT CONSTRUCTION.
 *
 * This is the structural half of the two-plane rule. An operator-plane role holding an
 * admin-plane permission is not a bug to be caught in review, it is an object that cannot be
 * built. Run it over every seeded role in CI and over every admin-authored role at save time.
 */
export function assertRoleWellFormed(role: Role): void {
  for (const key of role.permissions) {
    const p = BY_KEY.get(key)
    if (!p) {
      throw new RoleShapeError(
        `Role "${role.key}" references unknown permission "${key}". ` +
          `A permission must exist before a role can grant it.`,
      )
    }
    if (p.plane === 'admin' && role.plane === 'operator') {
      throw new RoleShapeError(
        `Role "${role.key}" is an operator-plane role and cannot hold the admin-plane ` +
          `permission "${key}". No admin capability is ever expressible in the operator role model.`,
      )
    }
  }
}

/** Does this set of permission keys allow `permissionKey`? The one authorization question. */
export function can(held: readonly string[], permissionKey: string): boolean {
  return held.includes(permissionKey)
}

/**
 * May this role reach `/internal/*`?
 *
 * Deliberately NOT "is the role named admin". The gate is whether the role is admin-plane AND
 * actually holds an admin-plane permission, so renaming a role cannot grant access and a role
 * stripped of its admin permissions loses the console without a second edit.
 */
export function canReachAdminPlane(role: Role): boolean {
  if (role.plane !== 'admin') return false
  return role.permissions.some((k) => BY_KEY.get(k)?.plane === 'admin')
}

/** Derive a role's human explanation from the permissions it actually holds. Never hand-written. */
export function describeRole(role: Role): string[] {
  return role.permissions
    .map((k) => BY_KEY.get(k))
    .filter((p): p is Permission => Boolean(p))
    .map((p) => p.label)
}
