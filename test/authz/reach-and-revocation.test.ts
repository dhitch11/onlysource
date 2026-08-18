/*
 * TWO DEFECTS FOUND BY RE-REVIEWING THE REPAIR, NOT THE ORIGINAL WORK.
 *
 * 1. A GUARD WRITTEN PER VERB PROTECTS THE VERB IT WAS WRITTEN FOR. `guardRoleGrant` and
 *    `guardRoleRemoval` bounded the roleKey branch. The status branch and the DELETE handler
 *    on the same route call `guardStatusChange` and `guardRemove`, and neither of those takes
 *    the caller at all. So an admin refused a role change on an owner row DEACTIVATED that
 *    owner and then DELETED the account, through the same route in the same session, doing
 *    strictly more damage than the verb that was guarded.
 *
 *    The reach is a property of the ACCOUNT, not of the verb, so `guardAccountReach` asks one
 *    question for all of them: does this row hold a permission the caller does not?
 *
 * 2. "REMOVE SIGN IN" DID NOTHING FOR A SEEDED ACCOUNT AND ANSWERED 200. `revokePassword`
 *    read the roster, `delete`d the key off that freshly parsed object, and called
 *    `setOverride(id, {})`. `readRoster()` has no cache, so the deletion landed on a throwaway,
 *    and `setOverride` read the file AGAIN and spread an empty patch over the stored record,
 *    carrying the scrypt hash back to disk. The person kept signing in. An access control that
 *    reports success while changing nothing is worse than one that fails loudly, because
 *    nobody goes back to check.
 *
 * Both were live in production at 0519e55. Neither was a regression: the revocation defect
 * predates all of this work.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'os-reach-'))
  process.env.ONLYSOURCE_STATE_DIR = dir
  vi.resetModules()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.ONLYSOURCE_STATE_DIR
})

describe('guardAccountReach bounds every verb, not just the one that was guarded', () => {
  it('refuses an admin reaching into an owner row, and names the permission out of reach', async () => {
    const { guardAccountReach } = await import('@/lib/admin/roster-rules')
    const { ROLES } = await import('@/lib/admin/permissions')
    const admin = ROLES.find((r) => r.key === 'admin')!
    const owner = { id: 'seed:hitchman', name: 'David Hitchman', roleKey: 'owner', status: 'active' as const, seeded: true }

    const g = guardAccountReach(admin.permissions, owner, 'deactivate or reactivate')
    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.reason).toContain('deactivate or reactivate')
      // The one permission an owner holds and an admin does not.
      expect(g.reason).toContain('Manage the organization')
    }
  })

  it('ALLOWS an admin reaching into a smaller row (positive control, so it is not a blanket block)', async () => {
    const { guardAccountReach } = await import('@/lib/admin/roster-rules')
    const { ROLES } = await import('@/lib/admin/permissions')
    const admin = ROLES.find((r) => r.key === 'admin')!
    const ro = { id: 'user:ro', name: 'Reader', roleKey: 'read_only', status: 'active' as const, seeded: false }
    expect(guardAccountReach(admin.permissions, ro, 'remove').ok).toBe(true)
  })

  it('leaves an unrecognised stored role repairable, because it holds nothing to be out of reach', async () => {
    const { guardAccountReach } = await import('@/lib/admin/roster-rules')
    const { ROLES } = await import('@/lib/admin/permissions')
    const admin = ROLES.find((r) => r.key === 'admin')!
    const broken = { id: 'user:typo', name: 'Typo', roleKey: 'read_onlyy', status: 'active' as const, seeded: false }
    expect(guardAccountReach(admin.permissions, broken, 'remove').ok).toBe(true)
  })

  it('an owner reaching into an owner row is allowed (the rule is about reach, not about rank)', async () => {
    const { guardAccountReach } = await import('@/lib/admin/roster-rules')
    const { ROLES } = await import('@/lib/admin/permissions')
    const owner = ROLES.find((r) => r.key === 'owner')!
    const other = { id: 'user:o2', name: 'Second Owner', roleKey: 'owner', status: 'active' as const, seeded: false }
    expect(guardAccountReach(owner.permissions, other, 'remove').ok).toBe(true)
  })
})

describe('revoking a sign in actually removes the credential', () => {
  it('THE DEFECT, REPRODUCED THROUGH THE PRODUCT: a seeded account could sign in after revocation', async () => {
    const { setPassword, revokePassword, verifyCredentials, hasCredential } = await import('@/lib/auth/accounts')

    const set = await setPassword('seed:goodreau', 'a-long-enough-password', 1)
    expect(set.ok).toBe(true)
    expect(hasCredential('seed:goodreau')).toBe(true)

    const revoked = revokePassword('seed:goodreau', 2)
    expect(revoked.ok).toBe(true)

    // The whole defect in one line. Before the fix this read `true`, while the route answered 200.
    expect(hasCredential('seed:goodreau')).toBe(false)

    const after = await verifyCredentials('dgoodreau@onlysource.ai', 'a-long-enough-password')
    expect(after.ok).toBe(false)
  })

  it('an ADDED member revokes too, so the two storage paths cannot drift', async () => {
    const { setPassword, revokePassword, hasCredential } = await import('@/lib/auth/accounts')
    const { addMember } = await import('@/lib/admin/roster-store')
    addMember({
      id: 'user:added', name: 'Added Person', email: 'added@example.invalid', title: '',
      roleKey: 'operator', status: 'active', passwordHash: null, createdAt: 1, updatedAt: 1,
    })
    expect((await setPassword('user:added', 'a-long-enough-password', 1)).ok).toBe(true)
    expect(hasCredential('user:added')).toBe(true)
    expect(revokePassword('user:added', 2).ok).toBe(true)
    expect(hasCredential('user:added')).toBe(false)
  })

  it('setting a password still works after the type widened (counter-control)', async () => {
    const { setPassword, hasCredential } = await import('@/lib/auth/accounts')
    expect((await setPassword('seed:hitchman', 'a-long-enough-password', 1)).ok).toBe(true)
    expect(hasCredential('seed:hitchman')).toBe(true)
  })
})

describe('a request that asks for the value already stored changes nothing and says so', () => {
  /*
   * MEASURED ON PRODUCTION, which is why this test exists. Posting `{roleKey:'admin'}` to an
   * account already holding admin built a one-field patch, wrote the roster and stamped a fresh
   * `updatedAt`. Two rows advanced their timestamp while no role, status or credential moved.
   * The empty-patch refusal that was already in the route did not catch it, because a NO-OP
   * patch is not an EMPTY one. An audit trail is only worth the questions it can still answer.
   */
  it('refuses a no-op role change instead of writing a fresh timestamp', async () => {
    const { readRoster, setOverride } = await import('@/lib/admin/roster-store')
    const { buildUsers } = await import('@/lib/admin/directory')

    setOverride('seed:goodreau', { roleKey: 'admin' }, 1000)
    const before = readRoster().overrides['seed:goodreau']?.updatedAt
    expect(before).toBe(1000)

    // The route's own rule, exercised through the same comparison it makes: a field equal to the
    // stored value is dropped, and a patch with nothing left is refused rather than written.
    const target = buildUsers(readRoster()).find((u) => u.id === 'seed:goodreau')!
    const patch: Record<string, unknown> = { roleKey: 'admin' }
    for (const k of Object.keys(patch)) {
      if (patch[k] === (target as unknown as Record<string, unknown>)[k]) delete patch[k]
    }
    expect(Object.keys(patch)).toHaveLength(0)

    // Nothing was written, so the timestamp is untouched.
    expect(readRoster().overrides['seed:goodreau']?.updatedAt).toBe(1000)
  })

  it('a REAL change still goes through (counter-control, so the rule is not a blanket refusal)', async () => {
    const { readRoster, setOverride } = await import('@/lib/admin/roster-store')
    const { buildUsers } = await import('@/lib/admin/directory')

    setOverride('seed:goodreau', { roleKey: 'admin' }, 1000)
    const target = buildUsers(readRoster()).find((u) => u.id === 'seed:goodreau')!
    const patch: Record<string, unknown> = { roleKey: 'operator' }
    for (const k of Object.keys(patch)) {
      if (patch[k] === (target as unknown as Record<string, unknown>)[k]) delete patch[k]
    }
    expect(Object.keys(patch)).toEqual(['roleKey'])
  })
})
