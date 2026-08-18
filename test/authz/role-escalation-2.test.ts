import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * THE TWO ESCALATIONS THE FIRST FIX MISSED, REPRODUCED AND REFUSED.
 *
 * ==========================================================================================
 * WHY THIS FILE EXISTS SEPARATELY FROM `escalation.test.ts`.
 * ==========================================================================================
 * That file closed the read_only self-promotion, and its own commit message then claimed two
 * security properties the code did not have. An adversarial review on 2026-08-18 executed both
 * claims and both were false:
 *
 *   1. "roleFor() ... now resolves to a zero-permission role that denies." It did not. The
 *      roster STORE repaired every unrecognised key to `operator` before the account layer ever
 *      saw it, so the zero-permission role was unreachable dead code. Measured: a member stored
 *      as `"roleKey": "read_onlyy"` resolved to the operator role with eight permissions, held
 *      the two SENSITIVE ones read_only exists to withhold, and POST /api/packets answered 200.
 *
 *   2. "no privilege increase is ever a single-person act." One human holding the seeded `admin`
 *      role reached `owner` alone in three permitted requests, by minting a second account of
 *      its own rank, giving it a password, and promoting itself from it. Measured end to end:
 *      every request answered 200 and `seed:goodreau` ended the run holding `owner`.
 *
 * Both are attacks here, not paraphrases of attacks, and both run through the REAL route
 * handlers against a REAL temporary state directory. Only `next/headers` is stubbed, because
 * there is no HTTP request in a unit test to carry a cookie. The token is minted by the
 * product's own `issueGateToken` and verified by the product's own verifier, so no hand-written
 * stand-in for "a signed-in caller" can quietly confirm the wrong conclusion.
 *
 * ==========================================================================================
 * POSITIVE CONTROLS, EACH EXERCISED BY REVERTING THE REPAIR IN A SCRATCH COPY.
 * ==========================================================================================
 *   - Restore `knownRole()` in roster-store.ts (coerce any unrecognised key to `'operator'`):
 *     the unrecognised-role tests below go red, including the 403 through the real route.
 *   - Delete the `guardRoleGrant` call from the change path in app/api/admin/users/route.ts:
 *     the puppet chain goes red at its final assertion, answering 200 with `owner` stored.
 *   - Delete the `guardRoleGrant` call from the CREATE path: the direct create-an-owner test
 *     goes red on its own, which is why both call sites are asserted separately.
 */

const SECRET = 'a-test-gate-secret-that-is-long-enough-to-pass-validation'

const jar = vi.hoisted(() => ({ token: undefined as string | undefined }))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.token && name === 'os_gate' ? { value: jar.token } : undefined),
  }),
}))

/**
 * A stored credential shaped like the real thing. Nobody can sign in with it and nothing here
 * tries: it exists so `credentialedAccountCount()` sees a credentialed account, which is the
 * fact that closes the break-glass door and makes these callers ordinary roster accounts.
 */
const A_STORED_CREDENTIAL = 'scrypt$32768$8$1$ZmFrZS1zYWx0LWZvci10ZXN0cw==$fixture-not-a-derivation'

const SEEDED_OWNER = 'seed:hitchman'
const SEEDED_ADMIN = 'seed:goodreau'

let dir: string
const previousDir = process.env.ONLYSOURCE_STATE_DIR
const previousSecret = process.env.PREVIEW_GATE_SECRET

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'onlysource-authz2-'))
  process.env.ONLYSOURCE_STATE_DIR = dir
  process.env.PREVIEW_GATE_SECRET = SECRET
  const { resetEnvCache } = await import('@/lib/env')
  resetEnvCache()
  jar.token = undefined
})

afterEach(async () => {
  rmSync(dir, { recursive: true, force: true })
  if (previousDir === undefined) delete process.env.ONLYSOURCE_STATE_DIR
  else process.env.ONLYSOURCE_STATE_DIR = previousDir
  if (previousSecret === undefined) delete process.env.PREVIEW_GATE_SECRET
  else process.env.PREVIEW_GATE_SECRET = previousSecret
  const { resetEnvCache } = await import('@/lib/env')
  resetEnvCache()
})

async function credentialSeeded(id: string) {
  const { setOverride } = await import('@/lib/admin/roster-store')
  setOverride(id, { passwordHash: A_STORED_CREDENTIAL }, 2)
}

async function signIn(subject: string) {
  const { issueGateToken } = await import('@/lib/session/pre-release-gate')
  jar.token = await issueGateToken(SECRET, Date.now(), 3600, subject)
}

type RosterAnswer = {
  status: number
  error?: string
  message?: string
  users?: Array<{ id: string; roleKey: string; email: string }>
}

async function postRoster(body: unknown): Promise<RosterAnswer> {
  const { POST } = await import('@/app/api/admin/users/route')
  const res = await POST(
    new Request('http://localhost/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  )
  return { status: res.status, ...((await res.json()) as Record<string, unknown>) }
}

async function roleOf(id: string): Promise<string | undefined> {
  const { buildUsers } = await import('@/lib/admin/directory')
  const { readRoster } = await import('@/lib/admin/roster-store')
  return buildUsers(readRoster()).find((u) => u.id === id)?.roleKey
}

// ============================================================================================
// DEFECT 1. A TYPO IN THE STATE FILE IS NOT A GRANT.
// ============================================================================================

describe('an unrecognised stored role holds nothing, and says so', () => {
  /** The exact state file the reviewer wrote, one character away from the smallest real role. */
  function writeTypoRoster() {
    writeFileSync(
      path.join(dir, 'admin-users.json'),
      JSON.stringify({
        overrides: {},
        added: [
          {
            id: 'user:typo',
            name: 'Typo Person',
            email: 'typo@example.com',
            title: '',
            roleKey: 'read_onlyy',
            status: 'active',
            passwordHash: A_STORED_CREDENTIAL,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
      'utf8',
    )
  }

  it('resolves the account to a role with ZERO permissions, not to the operator plane', async () => {
    writeTypoRoster()
    const { findAccountById } = await import('@/lib/auth/accounts')
    const account = findAccountById('user:typo')

    expect(account).not.toBeNull()
    // The stored string survives the read, which is the whole repair: a reader that fixes data
    // hides the fact that it was ever broken.
    expect(account?.roleKey).toBe('read_onlyy')
    expect(account?.role.permissions).toEqual([])
    expect(account?.role.name).toBe('Unrecognised role')
  })

  it('holds neither of the SENSITIVE permissions the old fallback handed out', async () => {
    writeTypoRoster()
    await signIn('user:typo')
    const { readCaller, callerCan, callerPermissions } = await import('@/lib/session/authz')
    const caller = await readCaller()

    expect(callerPermissions(caller)).toEqual([])
    // These two are the measured damage: read_only deliberately withholds both, and the
    // repair-to-operator handed both over for a one character typo.
    expect(callerCan(caller, 'document.view')).toBe(false)
    expect(callerCan(caller, 'margin.view')).toBe(false)
    // And nothing on the admin plane either, which is the failure that ends a company.
    expect(callerCan(caller, 'users.manage')).toBe(false)
    expect(callerCan(caller, 'roles.manage')).toBe(false)
  })

  it('is refused 403 by a REAL gated route, which answered 200 before this repair', async () => {
    writeTypoRoster()
    await signIn('user:typo')
    const { POST } = await import('@/app/api/packets/route')
    const res = await POST(
      new Request('http://localhost/api/packets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'probe', nsn: '5340015541274', query: 'x' }),
      }) as never,
    )

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: string; message?: string }
    expect(body.error).toBe('not_permitted')
    // The refusal NAMES the unrecognised role rather than a real one, so an operator reading it
    // learns what is actually wrong with the account.
    expect(body.message).toContain('Unrecognised role')
  })

  it('the CONSOLE names it honestly, and leaves the row repairable', async () => {
    /*
     * The second copy of the same fallback lived in `directory.ts` as `?? (ROLES[2] as Role)`,
     * and `ROLES[2]` is `operator`. That is the copy that decided the NAME on screen, so the
     * roster printed "Operator" beside an account holding nothing, which is worse than either
     * fact on its own. Both copies are gone; this asserts the surviving behaviour.
     */
    writeTypoRoster()
    const { buildUsers } = await import('@/lib/admin/directory')
    const { readRoster } = await import('@/lib/admin/roster-store')
    const row = buildUsers(readRoster()).find((u) => u.id === 'user:typo')

    expect(row?.roleKey).toBe('read_onlyy')
    expect(row?.roleName).toBe('Unrecognised role')
    // A damaged row must stay fixable. Probing the guard with the broken key itself would have
    // answered "That role does not exist" and disabled the one control that repairs it.
    expect(row?.actions.changeRole.allowed).toBe(true)
  })

  it('POSITIVE CONTROL COMPANION: a REAL role key still works, so the gate is not simply shut', async () => {
    const { addMember } = await import('@/lib/admin/roster-store')
    addMember({
      id: 'user:real',
      name: 'Real Person',
      email: 'real@example.com',
      title: '',
      roleKey: 'operator',
      status: 'active',
      passwordHash: A_STORED_CREDENTIAL,
      createdAt: 1,
      updatedAt: 1,
    })
    await signIn('user:real')
    const { POST } = await import('@/app/api/packets/route')
    const res = await POST(
      new Request('http://localhost/api/packets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'real', nsn: '5340015541274', query: 'x' }),
      }) as never,
    )
    expect(res.status).toBe(200)
  })
})

// ============================================================================================
// DEFECT 2. ONE PERSON CANNOT REACH OWNER, WHATEVER IDENTITIES THEY MINT.
// ============================================================================================

describe('nobody hands out a role they do not hold', () => {
  beforeEach(async () => {
    await credentialSeeded(SEEDED_OWNER)
    await credentialSeeded(SEEDED_ADMIN)
  })

  it('THE MEASURED CHAIN: an admin mints a puppet and cannot promote itself through it', async () => {
    await signIn(SEEDED_ADMIN)

    // STEP 1 still succeeds, and should: creating an account of your OWN rank is legitimate.
    const created = await postRoster({ name: 'Puppet', email: 'puppet@example.com', roleKey: 'admin' })
    expect(created.status).toBe(200)
    const puppet = created.users?.find((u) => u.email === 'puppet@example.com')
    expect(puppet).toBeTruthy()

    // STEP 2 still succeeds, and should: the puppet holds exactly what the caller holds.
    const pw = await postRoster({ id: puppet?.id, password: 'a-long-enough-password' })
    expect(pw.status).toBe(200)

    // STEP 3 is where the chain used to complete. The caller is now a DIFFERENT id, so the
    // self-role rule has nothing to compare, and only the permission-set rule can refuse it.
    await signIn(puppet?.id as string)
    const promoted = await postRoster({ id: SEEDED_ADMIN, roleKey: 'owner' })

    expect(promoted.status).toBe(400)
    expect(promoted.error).toBe('role_refused')
    // The sentence names the first permission out of reach, so it is actionable rather than
    // a bare "forbidden".
    expect(promoted.message).toContain('Manage the organization')
    // And the refusal did not write anyway, which is the worse version of this defect.
    expect(await roleOf(SEEDED_ADMIN)).toBe('admin')
  })

  it('closes the shorter path too: an admin cannot CREATE an owner to sign in as', async () => {
    await signIn(SEEDED_ADMIN)
    const created = await postRoster({ name: 'Shadow', email: 'shadow@example.com', roleKey: 'owner' })

    expect(created.status).toBe(400)
    expect(created.error).toBe('role_refused')
    expect(created.message).toContain('Manage the organization')
    // Nothing was added. A refusal that still writes the row is not a refusal.
    const { readRoster } = await import('@/lib/admin/roster-store')
    expect(readRoster().added).toHaveLength(0)
  })

  it('an admin cannot strip an owner either, in the direction the sign-in rule already guarded', async () => {
    await signIn(SEEDED_ADMIN)
    const stripped = await postRoster({ id: SEEDED_OWNER, roleKey: 'read_only' })

    expect(stripped.status).toBe(400)
    expect(stripped.error).toBe('role_refused')
    expect(await roleOf(SEEDED_OWNER)).toBe('owner')
  })

  it('THE RULE IS NOT A WALL: an owner may still grant owner, and an admin may still grant below itself', async () => {
    await signIn(SEEDED_OWNER)
    const madeOwner = await postRoster({ name: 'Second Owner', email: 'so@example.com', roleKey: 'owner' })
    expect(madeOwner.status).toBe(200)

    await signIn(SEEDED_ADMIN)
    const madeOperator = await postRoster({ name: 'Hand', email: 'hand@example.com', roleKey: 'operator' })
    expect(madeOperator.status).toBe(200)
    const hand = madeOperator.users?.find((u) => u.email === 'hand@example.com')
    const demoted = await postRoster({ id: hand?.id, roleKey: 'read_only' })
    expect(demoted.status).toBe(200)
    expect(await roleOf(hand?.id as string)).toBe('read_only')
  })

  it('compares PERMISSION SETS and not role names, so it survives a role nobody has seen', async () => {
    const { guardRoleGrant } = await import('@/lib/admin/roster-rules')
    const { role } = await import('@/lib/admin/permissions')
    const adminHeld = role('admin')?.permissions ?? []
    const ownerHeld = role('owner')?.permissions ?? []

    // Nothing here reads a role NAME. Rename every role tomorrow and these still hold.
    expect(guardRoleGrant(adminHeld, 'owner').ok).toBe(false)
    expect(guardRoleGrant(adminHeld, 'admin').ok).toBe(true)
    expect(guardRoleGrant(ownerHeld, 'owner').ok).toBe(true)
    expect(guardRoleGrant([], 'read_only').ok).toBe(false)
    // A role that does not exist is not grantable, whatever the caller holds.
    expect(guardRoleGrant(ownerHeld, 'read_onlyy').ok).toBe(false)
  })

  it('leaves first-run setup working: the break-glass caller may still create an owner', async () => {
    /*
     * A fresh state directory with NO credential anywhere is the product's real first run. The
     * break-glass caller is owner-equivalent and is NOBODY, so a rule bounded by "what the
     * caller holds" must not lock the first owner out of existing.
     */
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(path.join(tmpdir(), 'onlysource-authz2-firstrun-'))
    process.env.ONLYSOURCE_STATE_DIR = dir
    const { ANONYMOUS_SUBJECT } = await import('@/lib/session/pre-release-gate')
    await signIn(ANONYMOUS_SUBJECT)

    const created = await postRoster({ name: 'First Owner', email: 'first@example.com', roleKey: 'owner' })
    expect(created.status).toBe(200)
    expect(created.users?.find((u) => u.email === 'first@example.com')?.roleKey).toBe('owner')
  })
})
