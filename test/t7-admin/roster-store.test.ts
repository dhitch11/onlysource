import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  addMember,
  coerceRoster,
  readRoster,
  removeMember,
  rosterWritable,
  setOverride,
  updateMember,
  writeRoster,
  type RosterMember,
} from '@/lib/admin/roster-store'
import { buildUsers, initialsFor, mergeRoster } from '@/lib/admin/directory'

/**
 * THE ROSTER STORE, exercised against a REAL temporary directory rather than a mocked one.
 *
 * A store is the one place a mock proves the least: the entire question is whether the bytes
 * reach the disk and read back as the same roster. So every test here points
 * ONLYSOURCE_STATE_DIR at a real temp directory, writes, and reads it back through the same
 * public functions the route handler calls.
 *
 * The coercion tests matter more than they look. This file is hand editable and lives on a
 * server; a half written or hand mangled roster must degrade to something safe rather than
 * take the admin console down or, far worse, silently grant a role nobody assigned.
 *
 * ★ THIS HEADER USED TO END "an unknown role must land on `operator`, the least privileged real
 * role, and never on `owner`", AND THE TEST BELOW ASSERTED IT. Both were wrong, and the test is
 * why the defect shipped: it certified the bug. `operator` is not the least privileged real
 * role, `read_only` is, and operator holds four SENSITIVE permissions read_only deliberately
 * withholds. Measured on 2026-08-18: a member stored with `"roleKey": "read_onlyy"` resolved to
 * the operator role with eight permissions and POST /api/packets, gated on `document.view`,
 * answered 200. An unknown role must now land on NOTHING: the stored string is preserved
 * verbatim, `roleOrUnrecognised` answers it with a zero-permission role, and every gate refuses.
 */

let dir: string
const previous = process.env.ONLYSOURCE_STATE_DIR

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'onlysource-roster-'))
  process.env.ONLYSOURCE_STATE_DIR = dir
})

afterEach(() => {
  if (previous === undefined) delete process.env.ONLYSOURCE_STATE_DIR
  else process.env.ONLYSOURCE_STATE_DIR = previous
  rmSync(dir, { recursive: true, force: true })
})

const file = () => path.join(dir, 'admin-users.json')

const member = (over: Partial<RosterMember> & { id: string }): RosterMember => ({
  name: 'Added Person',
  email: 'added@example.com',
  title: '',
  roleKey: 'operator',
  status: 'active',
  passwordHash: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

describe('it round-trips through a real file', () => {
  it('starts empty when no file exists, and says so without throwing', () => {
    expect(existsSync(file())).toBe(false)
    expect(readRoster()).toEqual({ overrides: {}, added: [] })
  })

  it('creates the state directory on demand and writes readable JSON', () => {
    const nested = path.join(dir, 'does', 'not', 'exist', 'yet')
    process.env.ONLYSOURCE_STATE_DIR = nested
    writeRoster({ overrides: {}, added: [member({ id: 'user:1' })] })
    const onDisk = JSON.parse(readFileSync(path.join(nested, 'admin-users.json'), 'utf8'))
    expect(onDisk.added).toHaveLength(1)
  })

  it('persists an added member and reads it back identically', () => {
    addMember(member({ id: 'user:1', name: 'Rae Okafor', email: 'rae@example.com' }))
    const back = readRoster()
    expect(back.added).toHaveLength(1)
    expect(back.added[0]?.name).toBe('Rae Okafor')
  })

  it('persists an override on a seeded user', () => {
    setOverride('seed:goodreau', { roleKey: 'operator', status: 'deactivated' }, 1234)
    const back = readRoster()
    expect(back.overrides['seed:goodreau']).toMatchObject({
      roleKey: 'operator',
      status: 'deactivated',
      updatedAt: 1234,
    })
  })

  it('merges an override rather than replacing it, so changing a role keeps the title', () => {
    setOverride('seed:goodreau', { title: 'Contracts' }, 1)
    setOverride('seed:goodreau', { roleKey: 'operator' }, 2)
    expect(readRoster().overrides['seed:goodreau']).toMatchObject({
      title: 'Contracts',
      roleKey: 'operator',
    })
  })

  it('updates and removes an added member', () => {
    addMember(member({ id: 'user:1' }))
    updateMember('user:1', { roleKey: 'admin' }, 9)
    expect(readRoster().added[0]).toMatchObject({ roleKey: 'admin', updatedAt: 9 })
    removeMember('user:1')
    expect(readRoster().added).toHaveLength(0)
  })

  it('leaves the roster alone when asked to update an id that is not an added member', () => {
    addMember(member({ id: 'user:1' }))
    updateMember('seed:hitchman', { roleKey: 'operator' }, 9)
    expect(readRoster().added).toHaveLength(1)
    expect(readRoster().overrides).toEqual({})
  })
})

describe('a broken state file degrades safely instead of taking the console down', () => {
  it('survives unparseable JSON', () => {
    writeFileSync(file(), '{ this is not json', 'utf8')
    expect(readRoster()).toEqual({ overrides: {}, added: [] })
  })

  it('survives a top-level array, a string and a null', () => {
    for (const bad of ['[]', '"hello"', 'null', '42']) {
      writeFileSync(file(), bad, 'utf8')
      expect(readRoster()).toEqual({ overrides: {}, added: [] })
    }
  })

  it('drops an added row with no id, no name or no email rather than inventing a person', () => {
    writeFileSync(
      file(),
      JSON.stringify({
        overrides: {},
        added: [
          { id: '', name: 'No Id', email: 'a@b.co' },
          { id: 'user:2', name: '', email: 'a@b.co' },
          { id: 'user:3', name: 'No Email', email: '' },
          { id: 'user:4', name: 'Real Person', email: 'real@example.com' },
        ],
      }),
      'utf8',
    )
    const back = readRoster()
    expect(back.added).toHaveLength(1)
    expect(back.added[0]?.name).toBe('Real Person')
  })

  /**
   * POSITIVE CONTROL for the read-time repair. Restoring the old `knownRole()` (returning
   * `'operator'` for any key not in ROLES) fails all three assertions below, because all three
   * are about the key SURVIVING rather than about which role it lands on.
   */
  it('PRESERVES an unknown role instead of repairing it into a real one', () => {
    const r = coerceRoster({
      overrides: { 'seed:goodreau': { roleKey: 'super_admin', updatedAt: 0 } },
      added: [
        { id: 'user:1', name: 'X Y', email: 'x@y.co', roleKey: 'root' },
        // The measured case: one character away from the smallest role in the product.
        { id: 'user:2', name: 'T P', email: 't@p.co', roleKey: 'read_onlyy' },
      ],
    })
    expect(r.overrides['seed:goodreau']?.roleKey).toBe('super_admin')
    expect(r.added[0]?.roleKey).toBe('root')
    expect(r.added[1]?.roleKey).toBe('read_onlyy')
  })

  it('resolves every one of those preserved keys to a role holding NOTHING', async () => {
    const { roleOrUnrecognised, UNRECOGNISED_ROLE_KEY } = await import('@/lib/admin/permissions')
    for (const key of ['super_admin', 'root', 'read_onlyy', ' owner ', UNRECOGNISED_ROLE_KEY]) {
      const resolved = roleOrUnrecognised(key)
      expect(resolved.permissions).toEqual([])
      expect(resolved.name).toBe('Unrecognised role')
    }
    // And a real key still resolves to the real role, so the resolver is not simply denying.
    expect(roleOrUnrecognised('owner').permissions.length).toBeGreaterThan(0)
  })

  it('lands a role key that is not a usable string on the reserved sentinel, never on a real role', async () => {
    const { UNRECOGNISED_ROLE_KEY, role } = await import('@/lib/admin/permissions')
    const r = coerceRoster({
      overrides: { 'seed:goodreau': { roleKey: 7, updatedAt: 0 } },
      added: [{ id: 'user:1', name: 'X Y', email: 'x@y.co', roleKey: '' }],
    })
    expect(r.overrides['seed:goodreau']?.roleKey).toBe(UNRECOGNISED_ROLE_KEY)
    expect(r.added[0]?.roleKey).toBe(UNRECOGNISED_ROLE_KEY)
    // The sentinel is only safe while it matches no real role.
    expect(role(UNRECOGNISED_ROLE_KEY)).toBeUndefined()
  })

  it('keeps a role that IS real, so the coercion is not simply overwriting everything', () => {
    const r = coerceRoster({
      overrides: { 'seed:goodreau': { roleKey: 'read_only', updatedAt: 0 } },
      added: [{ id: 'user:1', name: 'X Y', email: 'x@y.co', roleKey: 'admin' }],
    })
    expect(r.overrides['seed:goodreau']?.roleKey).toBe('read_only')
    expect(r.added[0]?.roleKey).toBe('admin')
  })

  it('coerces an unknown status to active rather than hiding a user', () => {
    const r = coerceRoster({ overrides: {}, added: [{ id: 'u', name: 'A B', email: 'a@b.co', status: 'banished' }] })
    expect(r.added[0]?.status).toBe('active')
  })

  it('keeps the first of two rows sharing an id, so "remove this one" is never ambiguous', () => {
    const r = coerceRoster({
      overrides: {},
      added: [
        { id: 'user:1', name: 'First', email: 'a@b.co' },
        { id: 'user:1', name: 'Second', email: 'c@d.co' },
      ],
    })
    expect(r.added).toHaveLength(1)
    expect(r.added[0]?.name).toBe('First')
  })

  it('ignores a name or an email smuggled into a seeded override', () => {
    // Product facts. The store must not be a route for rewriting who the seeded users are.
    const r = coerceRoster({
      overrides: { 'seed:hitchman': { name: 'Somebody Else', email: 'attacker@example.com', updatedAt: 0 } },
      added: [],
    })
    expect(r.overrides['seed:hitchman']).not.toHaveProperty('name')
    expect(r.overrides['seed:hitchman']).not.toHaveProperty('email')
  })
})

describe('writability is measured, not assumed', () => {
  it('reports writable for a directory this process can write', () => {
    expect(rosterWritable()).toEqual({ writable: true, reason: null })
  })

  it('reports NOT writable, with a reason, when the directory is read only', () => {
    // Skipped when the test runs as root, because root ignores the mode bits and the probe
    // would be measuring nothing. Saying so beats a green test that proved nothing.
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      console.log('(skipped: running as root, where W_OK always succeeds)')
      return
    }
    chmodSync(dir, 0o500)
    try {
      const w = rosterWritable()
      expect(w.writable).toBe(false)
      expect(w.reason).toContain('could not be saved')
    } finally {
      chmodSync(dir, 0o700)
    }
  })

  it('reports writable when the state directory does not exist yet but its parent does', () => {
    process.env.ONLYSOURCE_STATE_DIR = path.join(dir, 'not-created-yet')
    expect(rosterWritable().writable).toBe(true)
    // and the probe CREATED NOTHING while answering
    expect(existsSync(path.join(dir, 'not-created-yet'))).toBe(false)
  })

  it('reports NOT writable when neither the directory nor its parent exists', () => {
    process.env.ONLYSOURCE_STATE_DIR = path.join(dir, 'no', 'such', 'tree')
    expect(rosterWritable().writable).toBe(false)
  })
})

describe('the merge into the directory', () => {
  it('shows the two seeded users when nothing has ever been changed', () => {
    const rows = mergeRoster({ overrides: {}, added: [] })
    expect(rows.map((r) => r.name)).toEqual(['David Hitchman', 'David Goodreau'])
    expect(rows.every((r) => r.seeded)).toBe(true)
    expect(rows.every((r) => r.status === 'active')).toBe(true)
  })

  it('applies an override to a seeded user without touching their name or email', () => {
    const rows = mergeRoster({
      overrides: { 'seed:goodreau': { roleKey: 'read_only', status: 'deactivated', updatedAt: 1 } },
      added: [],
    })
    const dg = rows.find((r) => r.id === 'seed:goodreau')
    expect(dg).toMatchObject({
      name: 'David Goodreau',
      email: 'dgoodreau@onlysource.ai',
      roleKey: 'read_only',
      roleName: 'Read-only',
      status: 'deactivated',
    })
  })

  it('appends added users after the seeded ones, in the order they were added', () => {
    const rows = mergeRoster({
      overrides: {},
      added: [member({ id: 'user:1', name: 'First Added' }), member({ id: 'user:2', name: 'Second Added' })],
    })
    expect(rows.map((r) => r.name)).toEqual([
      'David Hitchman',
      'David Goodreau',
      'First Added',
      'Second Added',
    ])
    expect(rows[2]?.seeded).toBe(false)
  })

  it('computes initials rather than storing them, and never renders more than two letters', () => {
    expect(initialsFor('Rae Okafor')).toBe('RO')
    expect(initialsFor('Mary Jane Watson')).toBe('MW')
    expect(initialsFor('Cher')).toBe('CH')
    expect(initialsFor('   ')).toBe('?')
    expect(initialsFor('rae okafor')).toBe('RO')
  })

  it('attaches a server verdict to every action on every row', () => {
    const users = buildUsers({ overrides: {}, added: [] })
    const dh = users.find((u) => u.id === 'seed:hitchman')
    // Sole owner: role and deactivation locked, removal locked because seeded.
    expect(dh?.actions.changeRole.allowed).toBe(false)
    expect(dh?.actions.deactivate.allowed).toBe(false)
    expect(dh?.actions.remove.allowed).toBe(false)
    expect(dh?.actions.changeRole.reason).toBeTruthy()

    const dg = users.find((u) => u.id === 'seed:goodreau')
    // Not the owner: role change is free. Still seeded, so still not removable.
    expect(dg?.actions.changeRole.allowed).toBe(true)
    expect(dg?.actions.deactivate.allowed).toBe(true)
    expect(dg?.actions.remove.allowed).toBe(false)
  })

  it('unlocks the first owner once a second owner exists, which is the whole point of recomputing', () => {
    const users = buildUsers({
      overrides: { 'seed:goodreau': { roleKey: 'owner', updatedAt: 1 } },
      added: [],
    })
    expect(users.find((u) => u.id === 'seed:hitchman')?.actions.changeRole.allowed).toBe(true)
    expect(users.find((u) => u.id === 'seed:hitchman')?.actions.deactivate.allowed).toBe(true)
  })
})
