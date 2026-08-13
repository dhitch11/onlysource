import { describe, expect, it } from 'vitest'
import {
  ROLES,
  PERMISSIONS,
  RoleShapeError,
  assertRoleWellFormed,
  can,
  canReachAdminPlane,
  describeRole,
  permission,
  type Role,
} from '@/lib/admin/permissions'

/**
 * The two-plane rule, which the charter calls "the failure that ends a company rather than a
 * sprint": an operator reaching /internal/*, or one permission check shared between the admin
 * plane and the operator surface.
 *
 * Every refusal below is paired with a positive control. A `assertRoleWellFormed` that threw
 * unconditionally would pass every rejection test in this file and be worthless.
 */

const role = (over: Partial<Role>): Role => ({
  key: 'test',
  name: 'Test',
  plane: 'operator',
  permissions: [],
  builtin: false,
  ...over,
})

describe('the seeded roles are well formed', () => {
  it('accepts every built-in role (POSITIVE CONTROL)', () => {
    for (const r of ROLES) {
      expect(() => assertRoleWellFormed(r), r.key).not.toThrow()
    }
  })

  it('ships exactly the four roles the charter names', () => {
    expect(ROLES.map((r) => r.key)).toEqual(['owner', 'admin', 'operator', 'read_only'])
  })
})

describe('an operator role CANNOT hold an admin capability', () => {
  it('REFUSES an operator-plane role holding an admin-plane permission', () => {
    // The `super_admin`-smuggled-into-the-operator-enum failure, made unconstructable.
    expect(() =>
      assertRoleWellFormed(role({ plane: 'operator', permissions: ['board.view', 'users.manage'] })),
    ).toThrow(RoleShapeError)
  })

  it('REFUSES a role referencing a permission that does not exist', () => {
    expect(() => assertRoleWellFormed(role({ permissions: ['does.not.exist'] }))).toThrow(
      RoleShapeError,
    )
  })

  it('ALLOWS the same permission on an admin-plane role (POSITIVE CONTROL)', () => {
    // Proves the refusal above is about the PLANE, not about the permission being unusable.
    expect(() =>
      assertRoleWellFormed(role({ plane: 'admin', permissions: ['users.manage'] })),
    ).not.toThrow()
  })

  it('no shipped operator-plane role holds any admin-plane permission', () => {
    const adminKeys = PERMISSIONS.filter((p) => p.plane === 'admin').map((p) => p.key)
    for (const r of ROLES.filter((x) => x.plane === 'operator')) {
      for (const k of adminKeys) {
        expect(r.permissions, `${r.key} must not hold ${k}`).not.toContain(k)
      }
    }
  })
})

describe('reaching the admin plane', () => {
  it('lets Owner and Admin reach /internal/*, and refuses Operator and Read-only', () => {
    expect(canReachAdminPlane(ROLES[0] as Role)).toBe(true) // owner
    expect(canReachAdminPlane(ROLES[1] as Role)).toBe(true) // admin
    expect(canReachAdminPlane(ROLES[2] as Role)).toBe(false) // operator
    expect(canReachAdminPlane(ROLES[3] as Role)).toBe(false) // read_only
  })

  it('does not gate on the role NAME, so renaming a role grants nothing', () => {
    // A role called "admin" with no admin permissions must not reach the console.
    const impostor = role({ key: 'admin', name: 'Admin', plane: 'admin', permissions: ['board.view'] })
    expect(canReachAdminPlane(impostor)).toBe(false)
  })

  it('loses console access when the admin permissions are stripped, with no second edit', () => {
    const stripped = role({ plane: 'admin', permissions: [] })
    expect(canReachAdminPlane(stripped)).toBe(false)
  })
})

describe('read-only is default-deny on everything sensitive', () => {
  it('holds no permission marked sensitive', () => {
    // The charter: a read-only role never sees a document body, a supplier identity, a margin or
    // a secret. This is the sales answer to "can your staff read my supplier negotiations", so
    // it must be default-deny in the model rather than a policy memo.
    const readOnly = ROLES.find((r) => r.key === 'read_only')
    expect(readOnly).toBeDefined()
    for (const key of readOnly?.permissions ?? []) {
      expect(permission(key)?.sensitive, `read-only must not hold sensitive ${key}`).toBe(false)
    }
  })

  it('specifically cannot see margins, supplier identities, documents or exports', () => {
    const readOnly = ROLES.find((r) => r.key === 'read_only')?.permissions ?? []
    for (const k of ['margin.view', 'supplier.identity.view', 'document.view', 'data.export']) {
      expect(can(readOnly, k), k).toBe(false)
    }
    // POSITIVE CONTROL: it can still do the non-sensitive thing its name implies.
    expect(can(readOnly, 'board.view')).toBe(true)
  })
})

describe('role explanations are derived, never hand-written', () => {
  it('describes a role from the permissions it actually holds', () => {
    // A hand-written explanation of a permission drifts from the permission within one sprint,
    // and a wrong explanation of a permission is worse than none.
    const operator = ROLES.find((r) => r.key === 'operator') as Role
    expect(describeRole(operator)).toContain('View the board')
    expect(describeRole(operator)).not.toContain('Manage users')
  })

  it('a described role changes when its permissions change, with no second edit', () => {
    const r = role({ permissions: ['board.view'] })
    expect(describeRole(r)).toEqual(['View the board'])
    expect(describeRole(role({ permissions: ['board.view', 'board.quote'] }))).toHaveLength(2)
  })
})
