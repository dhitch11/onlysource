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
   * ⛔ DOES HOLDING THIS LET SOMEBODY CHANGE SOMETHING? A SEPARATE AXIS FROM `sensitive`.
   *
   * `sensitive` is a READ concept: it marks what is costly to SEE. It says nothing about what
   * is costly to DO, and until 2026-08-24 the read-only role was derived from `sensitive`
   * alone. That correctly withheld every sensitive read and then silently granted every
   * non-sensitive WRITE.
   *
   * MEASURED, END TO END, ON A REAL SIGN-IN, NOT INFERRED FROM THE MODEL: an account holding
   * `read_only`, whose role is displayed to a human as "Read-only", posted to
   * `/api/suppliers/contacted` and received HTTP 200 with `{"contacted":["1ABC5"]}`. The
   * supplier was marked contacted. The same session was correctly refused 403 on
   * `/api/admin/users`, which is the control: the enforcement layer was working exactly as
   * written. The permission SET was wrong, not the check.
   *
   * The role is sold as the seat for an auditor, a lender, or somebody new. By the old
   * derivation it also held `board.quote` ("Prepare and submit quotes"), `supplier.pursue`
   * ("Contact and chase suppliers", which gates five write routes including outreach drafting
   * and sending), and `data.import` ("Upload spreadsheets and commit rows").
   *
   * So the axis is explicit now rather than inferred. A permission that changes state carries
   * `mutating: true` and no read-only role can hold it, whatever its sensitivity.
   */
  mutating: boolean
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
  { key: 'board.view', label: 'View the board', description: 'See the daily requirements board.', mutating: false, plane: 'operator', sensitive: false },
  { key: 'board.quote', label: 'Quote', description: 'Prepare and submit quotes against requirements.', mutating: true, plane: 'operator', sensitive: false },
  { key: 'supplier.pursue', label: 'Pursue suppliers', description: 'Contact and chase suppliers for material.', mutating: true, plane: 'operator', sensitive: false },
  { key: 'supplier.identity.view', label: 'See supplier identities', description: 'See which supplier a quote or lot came from.', mutating: false, plane: 'operator', sensitive: true },
  { key: 'margin.view', label: 'See margins', description: 'See cost, margin and pricing on a quote.', mutating: false, plane: 'operator', sensitive: true },
  { key: 'document.view', label: 'Open documents', description: 'Open drawings, specifications and traceability packets.', mutating: false, plane: 'operator', sensitive: true },
  { key: 'data.import', label: 'Import data', description: 'Upload spreadsheets and commit rows.', mutating: true, plane: 'operator', sensitive: false },
  { key: 'data.export', label: 'Export data', description: 'Download the current view as a file.', mutating: false, plane: 'operator', sensitive: true },

  // ---- admin plane: the privileged console at /internal/* ----
  { key: 'users.manage', label: 'Manage users', description: 'Invite, add, deactivate and assign roles.', mutating: true, plane: 'admin', sensitive: false },
  { key: 'roles.manage', label: 'Manage roles', description: 'Create roles and change which permissions they hold.', mutating: true, plane: 'admin', sensitive: false },
  { key: 'connections.manage', label: 'Manage connections', description: 'Add and replace data-source credentials. Never reveals a stored secret.', mutating: true, plane: 'admin', sensitive: true },
  { key: 'audit.read', label: 'Read the audit log', description: 'Read the organization audit log and export it.', mutating: false, plane: 'admin', sensitive: true },
  { key: 'org.manage', label: 'Manage the organization', description: 'Change organization settings and holdings.', mutating: true, plane: 'admin', sensitive: false },
  { key: 'breakglass.use', label: 'Use break-glass view', description: 'View the app as another user to reproduce a defect. Read-only, logged, expiring.', mutating: false, plane: 'admin', sensitive: true },
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
    /*
     * ⛔ TWO TESTS, NOT ONE. IT MUST BE UNABLE TO SEE, AND UNABLE TO DO.
     *
     * This read `!sensitive` alone until 2026-08-24, which is a READ test standing in for both
     * questions. It withheld every sensitive read correctly and granted every non-sensitive
     * WRITE, so a role displayed to a human as "Read-only" held `board.quote`,
     * `supplier.pursue` and `data.import`. Proven live, not argued: a real account on this
     * role signed in through the form and POSTed `/api/suppliers/contacted` to a 200, while
     * the same session was correctly refused 403 on `/api/admin/users`.
     *
     * Adding `!mutating` is the fix at the GENERATOR rather than at the next symptom. The same
     * shape has already cost this product once: `lib/intelligence/brief/package.ts:157` records
     * two people's names, emails and phone numbers reaching a read_only session on live
     * production. That leak was closed at its own surface, correctly, but the derivation that
     * produced it was left standing and this is that derivation.
     *
     * ⚠️ THE RESULT IS DELIBERATELY SMALL: `board.view`, and nothing else. Every other operator
     * permission is either sensitive to read or changes something. That is the honest content
     * of the promise this role's NAME makes. If a customer needs an auditor who can also export,
     * that is a new role holding `data.export`, added as data, and it should be named for what
     * it can do rather than quietly widening the one called "Read-only".
     */
    permissions: OPERATOR_PERMISSIONS.filter((k) => {
      const p = BY_KEY.get(k)
      return p !== undefined && !p.sensitive && !p.mutating
    }),
    builtin: true,
  },
]

/**
 * The role with this key, or undefined when no role has it.
 *
 * It answers undefined on purpose, and every caller has to handle that. A lookup that answers
 * an unknown key with a working role is a silent grant: the roster only has to carry a typo,
 * or the key of a role somebody deleted, for its holder to quietly acquire whatever the
 * fallback happened to be. Denying is recoverable, an admin sets the role again. A grant
 * nobody made is not.
 */
export function role(key: string): Role | undefined {
  return ROLES.find((r) => r.key === key)
}

/**
 * THE KEY THAT MATCHES NO ROLE, AND THE ROLE THAT HOLDS NOTHING.
 *
 * A stored role key can stop being a real role in three ordinary ways: an admin deletes or
 * renames a role, or somebody hand-edits the state file and mistypes. What must NOT happen is
 * the thing that shipped on 2026-08-18 and was measured on 2026-08-18: `read_onlyy`, a one
 * character typo of the smallest role in the product, was repaired at read time into
 * `operator` and handed its holder `document.view` and `margin.view`, the two sensitive
 * permissions the read-only role exists to withhold. A repair like that is a grant nobody made
 * and nothing recorded.
 *
 * So the answer to an unrecognised key is this role. It holds no permissions, so every
 * `can()` is false and every gated route refuses, and it carries a NAME that says what
 * happened, so the console prints "Unrecognised role" instead of a real role's name. An
 * unknown is typed as unknown and it says so on screen.
 *
 * It is deliberately NOT a member of `ROLES`: it must never appear in a role picker, never be
 * assignable, and never be granted. `assertNoRoleUsesUnrecognisedKey()` keeps that true.
 */
export const UNRECOGNISED_ROLE_KEY = 'unrecognised'

export const UNRECOGNISED_ROLE: Role = {
  key: UNRECOGNISED_ROLE_KEY,
  name: 'Unrecognised role',
  plane: 'operator',
  permissions: [],
  builtin: false,
}

/**
 * The role behind a stored key, fail closed.
 *
 * The one resolver for persisted role keys, used by the directory and by the account layer, so
 * the name the console prints and the permissions the API enforces can never come from two
 * different answers to the same question.
 */
export function roleOrUnrecognised(key: string): Role {
  return role(key) ?? UNRECOGNISED_ROLE
}

/** The sentinel is only safe while no real role claims its key. Asserted, never assumed. */
export function assertNoRoleUsesUnrecognisedKey(): void {
  const clash = ROLES.find((r) => r.key === UNRECOGNISED_ROLE_KEY)
  if (clash) {
    throw new RoleShapeError(
      `Role "${clash.key}" uses the reserved key "${UNRECOGNISED_ROLE_KEY}", which is how an ` +
        'unrecognised stored role is represented. A real role holding it would turn every ' +
        'unreadable key into a working grant.',
    )
  }
}

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
