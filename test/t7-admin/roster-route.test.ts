import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * THE ROUTE HANDLER, EXERCISED DIRECTLY.
 *
 * The browser probe already presses every control, but a probe runs when somebody runs it and
 * a test runs on every change. The rule this file protects is the one the estate keeps
 * relearning: **a malformed request is a 400 with a sentence, never a 500 and never a
 * cheerful 200.** A route that answers 200 to a body it did not understand is how "it saved"
 * becomes something an operator believes.
 *
 * The gate is stubbed to ALLOW, deliberately: this file is about what the handler does with a
 * request it is permitted to serve. The refusal path is a one-liner in every handler
 * (`const denied = await gateOrJson(); if (denied) return denied`) and is measured for real,
 * against the running server with the cookie jar cleared, in `.probe/admin-verify.mjs`.
 *
 * Every refusal below is paired with a POSITIVE CONTROL that succeeds, so a handler that
 * returned 400 unconditionally would fail this suite rather than pass it.
 */

vi.mock('@/lib/session/require-gate', () => ({
  gateOrJson: async () => null,
  requireGateSession: async () => undefined,
}))

let dir: string
const previous = process.env.ONLYSOURCE_STATE_DIR

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'onlysource-route-'))
  process.env.ONLYSOURCE_STATE_DIR = dir
})

afterEach(() => {
  if (previous === undefined) delete process.env.ONLYSOURCE_STATE_DIR
  else process.env.ONLYSOURCE_STATE_DIR = previous
  rmSync(dir, { recursive: true, force: true })
})

const URL_BASE = 'http://localhost/api/admin/users'

async function post(body: string | unknown, raw = false) {
  const { POST } = await import('@/app/api/admin/users/route')
  const req = new Request(URL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
  const res = await POST(req as never)
  const json = (await res.json()) as { error?: string; message?: string; users?: unknown[] }
  return { status: res.status, ...json }
}

async function del(qs = '') {
  const { DELETE } = await import('@/app/api/admin/users/route')
  const req = new Request(`${URL_BASE}${qs}`, { method: 'DELETE' })
  const res = await DELETE(req as never)
  const json = (await res.json()) as { error?: string; message?: string; users?: unknown[] }
  return { status: res.status, ...json }
}

async function list() {
  const { GET } = await import('@/app/api/admin/users/route')
  const res = await GET()
  return (await res.json()) as { users: Array<{ id: string; seeded: boolean; roleKey: string }> }
}

describe('the happy paths work, or every refusal below proves nothing', () => {
  it('GET returns the two seeded users', async () => {
    const d = await list()
    expect(d.users).toHaveLength(2)
    expect(d.users.every((u) => u.seeded)).toBe(true)
  })

  it('POST creates a user and answers with the whole recomputed roster', async () => {
    const r = await post({ name: 'Rae Okafor', email: 'rae@example.com', roleKey: 'operator' })
    expect(r.status).toBe(200)
    expect(r.users).toHaveLength(3)
  })

  it('POST changes a role on a seeded user', async () => {
    const r = await post({ id: 'seed:goodreau', roleKey: 'read_only' })
    expect(r.status).toBe(200)
    const d = await list()
    expect(d.users.find((u) => u.id === 'seed:goodreau')?.roleKey).toBe('read_only')
  })

  it('DELETE removes an added user', async () => {
    const created = await post({ name: 'Temp Person', email: 'temp@example.com', roleKey: 'operator' })
    const id = (created.users as Array<{ id: string; seeded: boolean }>).find((u) => !u.seeded)?.id
    const r = await del(`?id=${encodeURIComponent(id as string)}`)
    expect(r.status).toBe(200)
    expect(r.users).toHaveLength(2)
  })
})

describe('a malformed request is a 400 with a sentence, never a 500 and never a 200', () => {
  const cases: Array<[string, () => Promise<{ status: number; error?: string; message?: string }>]> = [
    ['unparseable JSON', () => post('{ not json', true)],
    ['a bare null', () => post('null', true)],
    ['a JSON array', () => post([1, 2, 3])],
    ['a bare string', () => post('"hello"', true)],
    ['a bare number', () => post('42', true)],
    ['a create with nothing in it', () => post({})],
    ['a create with a blank name', () => post({ name: '   ', email: 'a@b.co', roleKey: 'operator' })],
    ['a create with no email', () => post({ name: 'A B', email: '', roleKey: 'operator' })],
    ['a create with a non-address', () => post({ name: 'A B', email: 'nope', roleKey: 'operator' })],
    ['a create with an unknown role', () => post({ name: 'A B', email: 'a@b.co', roleKey: 'root' })],
    ['a change to a user that does not exist', () => post({ id: 'user:nope', roleKey: 'admin' })],
    ['a change that asks for nothing', () => post({ id: 'seed:goodreau' })],
    ['a status that is not a status', () => post({ id: 'seed:goodreau', status: 'banished' })],
    ['a title that is not text', () => post({ id: 'seed:goodreau', title: 42 })],
    ['a DELETE with no id', () => del('')],
  ]

  for (const [label, run] of cases) {
    it(`refuses ${label}`, async () => {
      const r = await run()
      expect(r.status, `${label} answered ${r.status}`).toBe(400)
      expect(r.message, `${label} refused without telling anybody why`).toBeTruthy()
    })
  }
})

describe('the rules the interface shows are re-decided here, so a client cannot talk past them', () => {
  it('refuses to demote the last active owner, with the same sentence the screen shows', async () => {
    const { LAST_OWNER_REASON } = await import('@/lib/admin/roster-rules')
    const r = await post({ id: 'seed:hitchman', roleKey: 'operator' })
    expect(r.status).toBe(400)
    expect(r.error).toBe('role_refused')
    expect(r.message).toBe(LAST_OWNER_REASON)
  })

  it('refuses to deactivate the last active owner', async () => {
    const r = await post({ id: 'seed:hitchman', status: 'deactivated' })
    expect(r.status).toBe(400)
    expect(r.error).toBe('status_refused')
  })

  it('ALLOWS the demotion once a second owner exists, so the refusal is a rule and not a wall', async () => {
    const created = await post({ name: 'Second Owner', email: 'so@example.com', roleKey: 'owner' })
    expect(created.status).toBe(200)
    const r = await post({ id: 'seed:hitchman', roleKey: 'operator' })
    expect(r.status).toBe(200)
  })

  it('refuses to remove a seeded user', async () => {
    const r = await del('?id=seed:goodreau')
    expect(r.status).toBe(400)
    expect(r.error).toBe('remove_refused')
  })

  it('refuses a duplicate email whatever its case', async () => {
    const r = await post({ name: 'Impostor', email: 'David@Reddenda.COM', roleKey: 'operator' })
    expect(r.status).toBe(400)
    expect(r.message).toContain('already uses that email')
  })

  it('cannot be used to rewrite a seeded user name or email', async () => {
    await post({ id: 'seed:hitchman', name: 'Somebody Else', email: 'attacker@example.com', title: 'X' })
    const d = await list()
    const dh = d.users.find((u) => u.id === 'seed:hitchman') as unknown as { name: string; email: string }
    expect(dh.name).toBe('David Hitchman')
    // The seeded owner address was corrected to david@reddenda.com on 2026-08-16 by owner
    // ruling. It is still a PRODUCT FACT the API cannot rewrite, which is what this asserts.
    expect(dh.email).toBe('david@reddenda.com')
  })
})
