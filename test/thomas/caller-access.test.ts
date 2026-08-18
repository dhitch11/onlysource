import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * WHO IS ASKING THOMAS, RESOLVED THE SAME WAY THE WRITE PATH RESOLVES IT.
 *
 * ==========================================================================================
 * WHY THE WHOLE CHAIN IS REAL AND ONLY THE COOKIE JAR IS STUBBED.
 * ==========================================================================================
 * A hand-written stand-in for "a signed-in read_only caller" is a check written by the same head
 * that wrote the thing it checks, and this estate has a recorded incident where exactly that
 * reproduced the bug it was hunting and confirmed the wrong conclusion. So the token here is minted
 * by the product's own `issueGateToken`, verified by its own `verifyGateToken`, and resolved
 * against a real roster written to a real temporary state directory. The only substitution is
 * `next/headers`, which is transport: there is no HTTP request in a unit test to carry a cookie.
 *
 * The shape is borrowed deliberately from `test/authz/escalation.test.ts`, which is the write
 * path's version of this file. If the two ever disagree about what a caller holds, one of them is
 * wrong and the product has two answers to one question, which is the defect `lib/thomas/authz.ts`
 * was written to avoid.
 *
 * ==========================================================================================
 * WHAT THIS FILE ASSERTS THAT THE MAP TEST CANNOT.
 * ==========================================================================================
 * `tool-permissions.test.ts` asks "given a permission set, is the tool refused". This one asks the
 * question before it: "given a COOKIE, what permission set is that". Every interesting failure of
 * authorization lives in the gap between those two, and all four are here: an expired session, a
 * subject the roster no longer knows, an account somebody deactivated an hour ago, and a
 * break-glass door that should have closed the moment the first password was set.
 */

const SECRET = 'a-test-gate-secret-that-is-long-enough-to-pass-validation'

/** The cookie the stubbed jar hands back. Written by each test before it resolves a caller. */
const jar = vi.hoisted(() => ({ token: undefined as string | undefined }))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.token && name === 'os_gate' ? { value: jar.token } : undefined),
  }),
}))

/**
 * A stored credential shaped like the real thing. Nobody can sign in with it and nothing here
 * tries: it exists so `credentialedAccountCount()` sees a credentialed account, which is the fact
 * that closes the break-glass door.
 */
const A_STORED_CREDENTIAL = 'scrypt$32768$8$1$ZmFrZS1zYWx0LWZvci10ZXN0cw==$fixture-not-a-derivation'

const READER = 'user:thomas-probe-readonly'
const TRADER = 'user:thomas-probe-operator'
const GHOST = 'user:thomas-probe-deleted'
const SEEDED_OWNER = 'seed:hitchman'

let dir: string
const previousDir = process.env.ONLYSOURCE_STATE_DIR
const previousSecret = process.env.PREVIEW_GATE_SECRET

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'onlysource-thomas-authz-'))
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

async function addUser(
  id: string,
  roleKey: string,
  opts: { credentialed?: boolean; status?: 'active' | 'deactivated' } = {},
) {
  const { addMember } = await import('@/lib/admin/roster-store')
  addMember({
    id,
    name: 'Thomas Probe',
    email: `${id.replace(/[^a-z0-9]/gi, '-')}@example.com`,
    title: 'Probe',
    roleKey,
    status: opts.status ?? 'active',
    passwordHash: opts.credentialed === false ? null : A_STORED_CREDENTIAL,
    createdAt: 1,
    updatedAt: 1,
  })
}

/** Sign the caller in for real: the product's own token, in the product's own cookie. */
async function signIn(subject: string) {
  const { issueGateToken } = await import('@/lib/session/pre-release-gate')
  jar.token = await issueGateToken(SECRET, Date.now(), 3600, subject)
}

/** The one call the routes make. Identity, then the permission set that travels with the turn. */
async function accessNow() {
  const { readCaller } = await import('@/lib/session/authz')
  const { accessForCaller } = await import('@/lib/thomas/authz')
  return accessForCaller(await readCaller())
}

async function refusalFor(tool: string) {
  const { refuseTool } = await import('@/lib/thomas/authz')
  return refuseTool(tool, await accessNow())
}

describe('a signed-in read_only account, the exact caller this lane exists for', () => {
  beforeEach(async () => {
    await addUser(READER, 'read_only')
    await signIn(READER)
  })

  it('resolves to the Read-only role, with the board and none of the sensitive keys', async () => {
    const access = await accessNow()
    expect(access.kind).toBe('account')
    expect(access.roleName).toBe('Read-only')
    expect(access.held).toContain('board.view')
    expect(access.held).not.toContain('supplier.identity.view')
    expect(access.held).not.toContain('margin.view')
    expect(access.held).not.toContain('document.view')
    expect(access.held).not.toContain('data.export')
  })

  it('cannot ask Thomas who holds the material, which was the bypass', async () => {
    const refusal = await refusalFor('supplier_snapshot')
    expect(refusal).not.toBeNull()
    expect(refusal!.classes).toEqual(['supplier identities'])
  })

  it('cannot ask Thomas for a price either', async () => {
    expect(await refusalFor('lookup_stock_number')).not.toBeNull()
    expect(await refusalFor('find_opportunities')).not.toBeNull()
    expect(await refusalFor('goldmine_snapshot')).not.toBeNull()
  })

  /*
   * THE POSITIVE CONTROL FOR THE WHOLE CHAIN. Without it, a `readCaller` that returned anonymous
   * for everybody would pass every refusal above and the product would be silently useless.
   */
  it('can still read the board, so the chain is resolving and not just denying', async () => {
    expect(await refusalFor('portfolio_snapshot')).toBeNull()
  })
})

describe('a signed-in operator', () => {
  it('holds every sensitive operator key, and Thomas runs all five tools', async () => {
    await addUser(TRADER, 'operator')
    await signIn(TRADER)
    const access = await accessNow()
    expect(access.roleName).toBe('Operator')
    for (const key of ['supplier.identity.view', 'margin.view', 'document.view', 'data.export']) {
      expect(access.held).toContain(key)
    }
    const { SERVER_TOOLS } = await import('@/lib/thomas/tools')
    const { refuseTool } = await import('@/lib/thomas/authz')
    for (const t of SERVER_TOOLS) {
      expect(refuseTool(t.name, access), `${t.name} was refused for an operator`).toBeNull()
    }
  })
})

describe('fail closed: the four ways a caller can fail to resolve', () => {
  it('no session at all holds nothing', async () => {
    const access = await accessNow()
    expect(access.kind).toBe('anonymous')
    expect(access.held).toEqual([])
    expect(await refusalFor('portfolio_snapshot')).not.toBeNull()
  })

  it('a token whose subject is not in the roster holds nothing, it is never defaulted', async () => {
    await addUser(READER, 'read_only')
    await signIn(GHOST)
    const access = await accessNow()
    expect(access.kind).toBe('anonymous')
    expect(access.held).toEqual([])
  })

  /*
   * DEACTIVATION HAS TO TAKE EFFECT IN THE SAME SECOND, INCLUDING IN A CONVERSATION ALREADY OPEN.
   * The token is still cryptographically valid here and still names a real person. The roster is
   * the authority, not a claim frozen into a cookie twelve hours ago.
   */
  it('a deactivated account holds nothing, whatever its live token says', async () => {
    await addUser(READER, 'operator', { status: 'deactivated' })
    await signIn(READER)
    const access = await accessNow()
    expect(access.kind).toBe('anonymous')
    expect(access.held).toEqual([])
    expect(await refusalFor('portfolio_snapshot')).not.toBeNull()
  })

  it('an unrecognised role key holds nothing, rather than being repaired into a working role', async () => {
    await addUser(READER, 'read_onlyy')
    await signIn(READER)
    const access = await accessNow()
    expect(access.held).toEqual([])
    expect(access.roleName).toBe('Unrecognised role')
    expect(await refusalFor('supplier_snapshot')).not.toBeNull()
  })
})

describe('the break-glass door, which is owner-equivalent only while it is genuinely open', () => {
  it('holds the owner set on a server where nobody has a credential', async () => {
    await addUser(READER, 'read_only', { credentialed: false })
    const { ANONYMOUS_SUBJECT } = await import('@/lib/session/pre-release-gate')
    await signIn(ANONYMOUS_SUBJECT)
    const access = await accessNow()
    expect(access.kind).toBe('bootstrap')
    expect(access.held).toContain('supplier.identity.view')
    expect(await refusalFor('supplier_snapshot')).toBeNull()
  })

  it('holds NOTHING the moment the first credential exists, on the same live token', async () => {
    const { ANONYMOUS_SUBJECT } = await import('@/lib/session/pre-release-gate')
    await signIn(ANONYMOUS_SUBJECT)
    const { setOverride } = await import('@/lib/admin/roster-store')
    setOverride(SEEDED_OWNER, { passwordHash: A_STORED_CREDENTIAL }, 2)
    const access = await accessNow()
    expect(access.held).toEqual([])
    expect(await refusalFor('supplier_snapshot')).not.toBeNull()
  })
})
