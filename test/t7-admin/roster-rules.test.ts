import { describe, expect, it } from 'vitest'
import {
  LAST_OWNER_REASON,
  SELF_ROLE_REASON,
  guardRemove,
  guardRoleChange,
  guardSelfRoleChange,
  guardSignInChange,
  guardStatusChange,
  validateNewUser,
  type GuardedUser,
} from '@/lib/admin/roster-rules'
import { ROLES, role } from '@/lib/admin/permissions'

/**
 * THE ONE RULE THAT CANNOT BE ALLOWED TO FAIL: the organization keeps an active owner.
 *
 * `owner` is the only role holding `org.manage`, and granting the owner role is itself an
 * owner capability. So demoting or deactivating the last active owner locks the organization
 * out of itself permanently, in one click, with no path back through the interface.
 *
 * Every refusal below is paired with a POSITIVE CONTROL: the same operation, in a roster that
 * has a second active owner, asserted to be ALLOWED. A guard that refused everything would
 * pass every refusal test in this file and be worthless.
 */

const user = (over: Partial<GuardedUser> & { id: string }): GuardedUser => ({
  name: 'A Person',
  roleKey: 'operator',
  status: 'active',
  seeded: false,
  ...over,
})

const soleOwner: GuardedUser[] = [
  user({ id: 'seed:hitchman', name: 'David Hitchman', roleKey: 'owner', seeded: true }),
  user({ id: 'seed:goodreau', name: 'David Goodreau', roleKey: 'admin', seeded: true }),
]

const twoOwners: GuardedUser[] = [
  user({ id: 'seed:hitchman', name: 'David Hitchman', roleKey: 'owner', seeded: true }),
  user({ id: 'seed:goodreau', name: 'David Goodreau', roleKey: 'owner', seeded: true }),
]

describe('the last active owner is protected', () => {
  it('refuses to demote the only owner', () => {
    const g = guardRoleChange(soleOwner, 'seed:hitchman', 'operator')
    expect(g.ok).toBe(false)
    expect(g.ok === false && g.reason).toBe(LAST_OWNER_REASON)
  })

  it('ALLOWS the same demotion once a second owner exists, so the guard is not simply always-on', () => {
    expect(guardRoleChange(twoOwners, 'seed:hitchman', 'operator').ok).toBe(true)
  })

  it('refuses to deactivate the only owner', () => {
    expect(guardStatusChange(soleOwner, 'seed:hitchman', 'deactivated').ok).toBe(false)
  })

  it('ALLOWS deactivating one of two owners', () => {
    expect(guardStatusChange(twoOwners, 'seed:hitchman', 'deactivated').ok).toBe(true)
  })

  it('does not count a DEACTIVATED owner as cover for demoting the active one', () => {
    const oneAsleep: GuardedUser[] = [
      user({ id: 'a', roleKey: 'owner', status: 'active' }),
      user({ id: 'b', roleKey: 'owner', status: 'deactivated' }),
    ]
    expect(guardRoleChange(oneAsleep, 'a', 'admin').ok).toBe(false)
  })

  it('never blocks reactivation, which can only ever increase the owner count', () => {
    const asleep: GuardedUser[] = [user({ id: 'a', roleKey: 'owner', status: 'deactivated' })]
    expect(guardStatusChange(asleep, 'a', 'active').ok).toBe(true)
  })

  it('never blocks a change that leaves the role where it was', () => {
    expect(guardRoleChange(soleOwner, 'seed:hitchman', 'owner').ok).toBe(true)
    expect(guardStatusChange(soleOwner, 'seed:hitchman', 'active').ok).toBe(true)
  })
})

describe('the invariant holds under EVERY single operation, not just the ones I thought of', () => {
  /*
   * Written as a sweep rather than as cases because the interesting failure is the operation
   * nobody enumerated. Any roster with at least one active owner, put through any allowed
   * role change, status change or removal, must still have an active owner afterwards.
   */
  const rosters: GuardedUser[][] = [
    soleOwner,
    twoOwners,
    [user({ id: 'a', roleKey: 'owner' })],
    [user({ id: 'a', roleKey: 'owner' }), user({ id: 'b', roleKey: 'owner', status: 'deactivated' })],
    [
      user({ id: 'a', roleKey: 'owner' }),
      user({ id: 'b', roleKey: 'owner' }),
      user({ id: 'c', roleKey: 'read_only' }),
    ],
  ]

  const activeOwners = (rows: GuardedUser[]) =>
    rows.filter((r) => r.roleKey === 'owner' && r.status === 'active').length

  it('no allowed role change can drop the active owner count to zero', () => {
    for (const rows of rosters) {
      for (const target of rows) {
        for (const role of ROLES) {
          if (!guardRoleChange(rows, target.id, role.key).ok) continue
          const after = rows.map((r) => (r.id === target.id ? { ...r, roleKey: role.key } : r))
          expect(activeOwners(after), `${target.id} to ${role.key}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('no allowed deactivation can drop the active owner count to zero', () => {
    for (const rows of rosters) {
      for (const target of rows) {
        if (!guardStatusChange(rows, target.id, 'deactivated').ok) continue
        const after = rows.map((r) => (r.id === target.id ? { ...r, status: 'deactivated' as const } : r))
        expect(activeOwners(after), `deactivate ${target.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('no allowed removal can drop the active owner count to zero', () => {
    for (const rows of rosters) {
      for (const target of rows) {
        if (!guardRemove(rows, target.id).ok) continue
        const after = rows.filter((r) => r.id !== target.id)
        expect(activeOwners(after), `remove ${target.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('the sweep is not vacuous: at least one operation IS allowed in it', () => {
    const allowed = rosters.flatMap((rows) =>
      rows.flatMap((t) => ROLES.filter((role) => guardRoleChange(rows, t.id, role.key).ok)),
    )
    expect(allowed.length).toBeGreaterThan(0)
  })
})

describe('seeded users can be changed but never removed', () => {
  it('refuses to remove a seeded user and names them in the reason', () => {
    const g = guardRemove(soleOwner, 'seed:goodreau')
    expect(g.ok).toBe(false)
    expect(g.ok === false && g.reason).toContain('David Goodreau')
  })

  it('ALLOWS removing an added user, so the refusal is about seeding and not about removal', () => {
    const rows = [...soleOwner, user({ id: 'user:1', name: 'Added Person' })]
    expect(guardRemove(rows, 'user:1').ok).toBe(true)
  })
})

describe('unknown targets and unknown roles are refused rather than coerced', () => {
  it('refuses a change to a user that is not in the roster', () => {
    expect(guardRoleChange(soleOwner, 'user:nope', 'admin').ok).toBe(false)
    expect(guardStatusChange(soleOwner, 'user:nope', 'active').ok).toBe(false)
    expect(guardRemove(soleOwner, 'user:nope').ok).toBe(false)
  })

  it('refuses a role that does not exist rather than quietly landing on a default', () => {
    const g = guardRoleChange(soleOwner, 'seed:goodreau', 'super_admin')
    expect(g.ok).toBe(false)
    expect(g.ok === false && g.reason).toContain('does not exist')
  })
})

describe('a new user is validated before anything is written', () => {
  const emails = ['dhitchman@onlysource.ai', 'dgoodreau@onlysource.ai']
  const good = { name: 'New Person', email: 'new@example.com', roleKey: 'operator', title: 'Buyer' }

  it('accepts a complete one, or every rejection below proves nothing', () => {
    const r = validateNewUser(soleOwner, emails, good)
    expect(r.ok).toBe(true)
    expect(r.ok === true && r.value.name).toBe('New Person')
  })

  it('refuses a create with no name', () => {
    expect(validateNewUser(soleOwner, emails, { ...good, name: '   ' }).ok).toBe(false)
  })

  it('refuses a create with no email', () => {
    expect(validateNewUser(soleOwner, emails, { ...good, email: '' }).ok).toBe(false)
  })

  it('refuses something that is plainly not an address', () => {
    expect(validateNewUser(soleOwner, emails, { ...good, email: 'not an address' }).ok).toBe(false)
    expect(validateNewUser(soleOwner, emails, { ...good, email: 'a@b' }).ok).toBe(false)
  })

  it('refuses a duplicate email whatever its case', () => {
    const r = validateNewUser(soleOwner, emails, { ...good, email: 'DHitchman@OnlySource.ai' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('already uses that email')
  })

  it('refuses an unknown role instead of silently granting the default one', () => {
    expect(validateNewUser(soleOwner, emails, { ...good, roleKey: 'wibble' }).ok).toBe(false)
  })

  it('refuses non-string junk in every field', () => {
    expect(validateNewUser(soleOwner, emails, { ...good, name: 42 }).ok).toBe(false)
    expect(validateNewUser(soleOwner, emails, { ...good, email: { at: 'x' } }).ok).toBe(false)
    expect(validateNewUser(soleOwner, emails, { ...good, roleKey: null }).ok).toBe(false)
  })

  it('trims what it accepts, so a padded name is not stored padded', () => {
    const r = validateNewUser(soleOwner, emails, { ...good, name: '  Padded Name  ' })
    expect(r.ok === true && r.value.name).toBe('Padded Name')
  })
})

/**
 * THE TWO RULES ADDED WITH THE AUTHORIZATION LANE, 2026-08-18.
 *
 * Neither is a permission. A permission asks whether somebody may do this KIND of thing at
 * all; both of these ask about a specific target and refuse even a caller who holds the
 * permission, because the alternative is that one compromised session is a promotion.
 */
describe('nobody changes their own role', () => {
  const roster: GuardedUser[] = [
    user({ id: 'seed:hitchman', name: 'David Hitchman', roleKey: 'owner', seeded: true }),
    user({ id: 'user:probe', name: 'Probe ReadOnly', roleKey: 'read_only' }),
  ]

  it('refuses the read_only self-promotion that was reproduced on the live build', () => {
    const r = guardSelfRoleChange(roster, 'user:probe', 'user:probe', 'owner')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe(SELF_ROLE_REASON)
  })

  it('refuses the owner too, because the rule is about self and not about rank', () => {
    expect(guardSelfRoleChange(roster, 'seed:hitchman', 'seed:hitchman', 'operator').ok).toBe(false)
  })

  it('ALLOWS changing somebody else, so the rule is not a wall', () => {
    expect(guardSelfRoleChange(roster, 'seed:hitchman', 'user:probe', 'operator').ok).toBe(true)
  })

  it('ALLOWS a request that asks for the role already held, which changes nothing', () => {
    expect(guardSelfRoleChange(roster, 'user:probe', 'user:probe', 'read_only').ok).toBe(true)
  })

  it('ALLOWS a caller with no identity, which is first-run break-glass and has no self', () => {
    expect(guardSelfRoleChange(roster, null, 'user:probe', 'owner').ok).toBe(true)
  })
})

describe('nobody hands a sign in to an account that outranks them', () => {
  const owner = user({ id: 'seed:hitchman', name: 'David Hitchman', roleKey: 'owner', seeded: true })
  const admin = user({ id: 'seed:goodreau', name: 'David Goodreau', roleKey: 'admin', seeded: true })
  const held = (key: string) => role(key)?.permissions ?? []

  it('refuses an admin setting the owner password, and names what they lack', () => {
    const r = guardSignInChange(held('admin'), owner)
    expect(r.ok).toBe(false)
    // `org.manage` is the one permission owner holds and admin does not, so it is the whole
    // reason this refusal exists and the sentence has to say so.
    expect(r.ok === false && r.reason).toContain('Manage the organization')
  })

  it('ALLOWS the owner setting the admin password, so the rule has a direction', () => {
    expect(guardSignInChange(held('owner'), admin).ok).toBe(true)
  })

  it('ALLOWS an admin setting another admin password, equal reach being enough', () => {
    expect(guardSignInChange(held('admin'), admin).ok).toBe(true)
  })

  it('refuses a caller holding nothing at all', () => {
    expect(guardSignInChange([], admin).ok).toBe(false)
  })

  it('ALLOWS a target whose stored role key matches no role, because it holds nothing', () => {
    expect(guardSignInChange([], user({ id: 'user:corrupt', roleKey: 'wibble' })).ok).toBe(true)
  })
})
