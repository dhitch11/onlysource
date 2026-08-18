import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * THE PRIVILEGE ESCALATION, REPRODUCED AND REFUSED.
 *
 * ==========================================================================================
 * WHAT THIS FILE IS. It is the attack, not a paraphrase of the attack.
 * ==========================================================================================
 * On 2026-08-18 a security audit signed in as a `read_only` account on the running build,
 * POSTed its own roster id to /api/admin/users with `roleKey: 'owner'`, was promoted, and then
 * set a password on the seeded owner account. The artifact of that attack is still sitting in
 * this repository's local `.state/admin-users.json` as `user:probe-readonly`, a row created
 * read_only and now carrying `"roleKey": "owner"` and a credential.
 *
 * The first test below is that exact request. It asserts a 403, and it asserts the roster did
 * not move, because a route that refuses and writes anyway is the worse defect.
 *
 * ==========================================================================================
 * WHY THE CHAIN IS REAL AND ONLY THE COOKIE JAR IS STUBBED.
 * ==========================================================================================
 * A hand-written stand-in for "a signed-in read_only caller" is a check written by the same
 * head that wrote the thing it checks, and this estate has a recorded incident where exactly
 * that reproduced the bug it was hunting and confirmed the wrong conclusion. So the token here
 * is minted by the product's own `issueGateToken`, verified by the product's own
 * `verifyGateToken`, and resolved against a real roster written to a real temporary state
 * directory. The only substitution is `next/headers`, which is transport: there is no HTTP
 * request in a unit test to carry a cookie.
 *
 * HOW THE POSITIVE CONTROL WAS PROVEN TO FIRE, since a suite that passes both before and after
 * a fix measures nothing. Three scratch runs, each reverted the moment it was read:
 *
 *   1. `permissionRefusal` neutered to return null, which IS the pre-fix world where no route
 *      authorized anything: 9 of the 16 tests in this file failed.
 *   2. That, plus `guardSelfRoleChange` neutered: 10 failed, and the first test below answered
 *      200 with the attacker's `roleKey` reading `owner`. That is the live defect, reproduced.
 *   3. Only the `users.manage` check on POST removed: 1 failed. The `roles.manage` check and
 *      the self-role rule are independent controls over the same attack, so no single deletion
 *      in that route re-opens it. Worth knowing before somebody simplifies one of them away.
 */

const SECRET = 'a-test-gate-secret-that-is-long-enough-to-pass-validation'

/** The cookie the stubbed jar hands back. Written by each test before it calls a handler. */
const jar = vi.hoisted(() => ({ token: undefined as string | undefined }))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.token && name === 'os_gate' ? { value: jar.token } : undefined,
  }),
}))

/**
 * A stored credential shaped like the real thing. Nobody can sign in with it and nothing here
 * tries: it exists so `credentialedAccountCount()` sees a credentialed account, which is the
 * fact that closes the break-glass door.
 */
const A_STORED_CREDENTIAL = 'scrypt$32768$8$1$ZmFrZS1zYWx0LWZvci10ZXN0cw==$fixture-not-a-derivation'

const ATTACKER = 'user:probe-readonly'
const SEEDED_OWNER = 'seed:hitchman'
const SEEDED_ADMIN = 'seed:goodreau'

let dir: string
const previousDir = process.env.ONLYSOURCE_STATE_DIR
const previousSecret = process.env.PREVIEW_GATE_SECRET

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'onlysource-authz-'))
  process.env.ONLYSOURCE_STATE_DIR = dir
  process.env.PREVIEW_GATE_SECRET = SECRET
  const { resetEnvCache } = await import('@/lib/env')
  resetEnvCache()
  jar.token = undefined
})

afterEach(async () => {
  if (previousDir === undefined) delete process.env.ONLYSOURCE_STATE_DIR
  else process.env.ONLYSOURCE_STATE_DIR = previousDir
  if (previousSecret === undefined) delete process.env.PREVIEW_GATE_SECRET
  else process.env.PREVIEW_GATE_SECRET = previousSecret
  const { resetEnvCache } = await import('@/lib/env')
  resetEnvCache()
  rmSync(dir, { recursive: true, force: true })
})

/** Put somebody in the roster. `credentialed` decides whether break-glass is still open. */
async function addUser(
  id: string,
  roleKey: string,
  opts: { credentialed?: boolean; status?: 'active' | 'deactivated' } = {},
) {
  const { addMember } = await import('@/lib/admin/roster-store')
  addMember({
    id,
    name: 'Probe ReadOnly',
    email: `${id.replace(/[^a-z0-9]/gi, '-')}@example.com`,
    title: 'Probe',
    roleKey,
    status: opts.status ?? 'active',
    passwordHash: opts.credentialed === false ? null : A_STORED_CREDENTIAL,
    createdAt: 1,
    updatedAt: 1,
  })
}

/** Give a seeded user a credential, which is what closes the break-glass door on a real box. */
async function credentialSeeded(id: string) {
  const { setOverride } = await import('@/lib/admin/roster-store')
  setOverride(id, { passwordHash: A_STORED_CREDENTIAL }, 2)
}

/** Sign the caller in for real: the product's own token, in the product's own cookie. */
async function signIn(subject: string) {
  const { issueGateToken } = await import('@/lib/session/pre-release-gate')
  jar.token = await issueGateToken(SECRET, Date.now(), 3600, subject)
}

async function post(body: unknown) {
  const { POST } = await import('@/app/api/admin/users/route')
  const req = new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await POST(req as never)
  const json = (await res.json()) as {
    error?: string
    message?: string
    users?: Array<{ id: string; roleKey: string; hasPassword: boolean }>
  }
  return { status: res.status, ...json }
}

async function roleOf(id: string): Promise<string | undefined> {
  const { buildUsers } = await import('@/lib/admin/directory')
  const { readRoster } = await import('@/lib/admin/roster-store')
  return buildUsers(readRoster()).find((u) => u.id === id)?.roleKey
}

describe('the reproduced attack: a read_only session promotes itself to owner', () => {
  it('is refused with a 403, and the roster does not move', async () => {
    await addUser(ATTACKER, 'read_only')
    await signIn(ATTACKER)

    const r = await post({ id: ATTACKER, roleKey: 'owner' })

    expect(r.status).toBe(403)
    expect(r.error).toBe('not_permitted')
    expect(await roleOf(ATTACKER)).toBe('read_only')
  })

  it('is refused when it goes for the owner password instead of the owner role', async () => {
    await addUser(ATTACKER, 'read_only')
    await signIn(ATTACKER)

    const r = await post({ id: SEEDED_OWNER, password: 'take-over-the-account' })

    expect(r.status).toBe(403)
    const { buildUsers } = await import('@/lib/admin/directory')
    const { readRoster } = await import('@/lib/admin/roster-store')
    expect(buildUsers(readRoster()).find((u) => u.id === SEEDED_OWNER)?.hasPassword).toBe(false)
  })

  it('is refused when it tries to add a new owner it would then log in as', async () => {
    await addUser(ATTACKER, 'read_only')
    await signIn(ATTACKER)

    const r = await post({ name: 'Second Owner', email: 'so@example.com', roleKey: 'owner' })

    expect(r.status).toBe(403)
  })

  it('is refused when it tries to delete somebody', async () => {
    await addUser(ATTACKER, 'read_only')
    await signIn(ATTACKER)

    const { DELETE } = await import('@/app/api/admin/users/route')
    const res = await DELETE(
      new Request(`http://localhost/api/admin/users?id=${SEEDED_ADMIN}`, {
        method: 'DELETE',
      }) as never,
    )
    expect(res.status).toBe(403)
  })
})

/*
 * WITHOUT THESE, EVERY REFUSAL ABOVE PROVES NOTHING. A handler hardwired to 403 would pass the
 * whole block above and fail here.
 */
describe('the same requests succeed for a caller who actually holds the permission', () => {
  it('an owner promotes somebody else and it saves', async () => {
    await addUser(ATTACKER, 'read_only')
    await credentialSeeded(SEEDED_OWNER)
    await signIn(SEEDED_OWNER)

    const r = await post({ id: ATTACKER, roleKey: 'operator' })

    expect(r.status).toBe(200)
    expect(await roleOf(ATTACKER)).toBe('operator')
  })

  it('an owner sets a password on a lesser account', async () => {
    await addUser(ATTACKER, 'read_only', { credentialed: false })
    await credentialSeeded(SEEDED_OWNER)
    await signIn(SEEDED_OWNER)

    const r = await post({ id: ATTACKER, password: 'a-long-enough-password' })

    expect(r.status).toBe(200)
    expect(r.users?.find((u) => u.id === ATTACKER)?.hasPassword).toBe(true)
  })
})

describe('nobody edits their own role, whatever they hold', () => {
  it('refuses the owner demoting themselves, with the sentence the screen shows', async () => {
    const { SELF_ROLE_REASON } = await import('@/lib/admin/roster-rules')
    // A second owner exists, so the last-owner rule is NOT what refuses this. Without it the
    // test would pass for the wrong reason and would keep passing if the self rule vanished.
    await addUser('user:second-owner', 'owner')
    await credentialSeeded(SEEDED_OWNER)
    await signIn(SEEDED_OWNER)

    const r = await post({ id: SEEDED_OWNER, roleKey: 'operator' })

    expect(r.status).toBe(400)
    expect(r.error).toBe('self_role_refused')
    expect(r.message).toBe(SELF_ROLE_REASON)
    expect(await roleOf(SEEDED_OWNER)).toBe('owner')
  })

  it('still lets that owner change somebody else, so the rule is about self and not about roles', async () => {
    await addUser('user:second-owner', 'owner')
    await credentialSeeded(SEEDED_OWNER)
    await signIn(SEEDED_OWNER)

    expect((await post({ id: 'user:second-owner', roleKey: 'admin' })).status).toBe(200)
  })
})

describe('an admin cannot take the owner account by setting its password', () => {
  it('refuses, and names the access the admin does not hold', async () => {
    await credentialSeeded(SEEDED_ADMIN)
    await signIn(SEEDED_ADMIN)

    const r = await post({ id: SEEDED_OWNER, password: 'become-the-owner' })

    expect(r.status).toBe(400)
    expect(r.error).toBe('sign_in_refused')
    expect(r.message).toContain('Manage the organization')
  })

  it('lets that same admin set a password on an account no bigger than their own', async () => {
    await addUser(ATTACKER, 'read_only', { credentialed: false })
    await credentialSeeded(SEEDED_ADMIN)
    await signIn(SEEDED_ADMIN)

    expect((await post({ id: ATTACKER, password: 'a-long-enough-password' })).status).toBe(200)
  })
})

describe('a session that is not a person holds nothing', () => {
  it('no cookie at all is a 401, not a 403', async () => {
    // The two are different facts. 401 says sign in; 403 says your role is the problem.
    const r = await post({ id: SEEDED_ADMIN, roleKey: 'operator' })
    expect(r.status).toBe(401)
  })

  it('a valid token for a subject that is not in the roster is refused', async () => {
    await credentialSeeded(SEEDED_OWNER)
    await signIn('user:deleted-last-tuesday')

    const r = await post({ id: SEEDED_ADMIN, roleKey: 'operator' })

    expect(r.status).toBe(401)
    expect(r.error).toBe('session_unknown')
  })

  it('a deactivated account is refused immediately, not at token expiry', async () => {
    await addUser('user:switched-off', 'owner', { status: 'deactivated' })
    await signIn('user:switched-off')

    const r = await post({ id: SEEDED_ADMIN, roleKey: 'operator' })

    expect(r.status).toBe(401)
    expect(r.error).toBe('account_deactivated')
  })

  it('a forged token is refused', async () => {
    await credentialSeeded(SEEDED_OWNER)
    const { issueGateToken } = await import('@/lib/session/pre-release-gate')
    jar.token = await issueGateToken('a-different-secret-of-sufficient-length-here', Date.now(), 3600, SEEDED_OWNER)

    expect((await post({ id: SEEDED_ADMIN, roleKey: 'operator' })).status).toBe(401)
  })
})

describe('break-glass is a recovery path while it is needed and a closed door afterwards', () => {
  it('acts as an owner while NO account has a credential', async () => {
    await signIn('pre-release')

    const r = await post({ name: 'First Person', email: 'first@example.com', roleKey: 'owner' })

    expect(r.status).toBe(200)
  })

  it('holds nothing the moment one account has a credential, with the same token', async () => {
    await signIn('pre-release')
    const bootstrapToken = jar.token

    // The door works, then the first sign in is created, then the SAME token is used again.
    expect((await post({ id: SEEDED_ADMIN, roleKey: 'operator' })).status).toBe(200)
    await credentialSeeded(SEEDED_OWNER)
    jar.token = bootstrapToken

    const r = await post({ id: SEEDED_ADMIN, roleKey: 'admin' })

    expect(r.status).toBe(401)
    expect(r.error).toBe('bootstrap_closed')
  })
})
