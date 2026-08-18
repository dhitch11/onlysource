import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readPacketResponse } from '@/app/(app)/documents/PacketVault'

/**
 * A REFUSAL THIS ESTATE INTRODUCED WAS BEING RENDERED AS A SUCCESS.
 *
 * ==========================================================================================
 * THE DEFECT, MEASURED BEFORE IT WAS FIXED.
 * ==========================================================================================
 * On 2026-08-18 POST/DELETE /api/packets were gated on `document.view`, the sensitive
 * permission the `read_only` role deliberately does not hold. `PacketVault.save()` read only
 * `d.packets` and then called `setLabel('')` unconditionally. So a read_only operator pressing
 * "Save this packet" received:
 *
 *   403 {"error":"not_permitted","message":"Your role, Read-only, does not include
 *        \"Open documents\", so nothing was changed. Ask an owner to change your role if you
 *        need it."}
 *
 * and saw the name field empty and the button un-busy, which is precisely what a successful
 * save looks like. The list did not move, nothing was rendered, and the server's perfectly good
 * sentence was thrown away. Before that commit the route used `gateOrJson` and answered 200 to
 * the same request, so this path became reachable by an ordinary signed-in person on the day the
 * gate landed.
 *
 * ==========================================================================================
 * WHY THIS TEST IS NOT A CHECK WRITTEN BY THE SAME HEAD AS THE FIX.
 * ==========================================================================================
 * The refusal is not hand-written here. It is PRODUCED by the real `POST /api/packets` handler,
 * against a real temporary state directory, for a real `read_only` roster account signed in with
 * a token minted by the product's own `issueGateToken`. The exact Response that a browser would
 * receive is then handed to `readPacketResponse`, the one function the component uses to decide
 * what happened. If either half changes its mind about what a 403 means, these fail.
 *
 * The remaining cases are synthetic on purpose, and their answers are known before they run:
 * a followed redirect and an unreadable body are conditions no local handler can produce, and
 * `r.ok` is TRUE for the redirect, which is the entire trap.
 *
 * POSITIVE CONTROL, EXERCISED: reverting `readPacketResponse` to the old logic (read `packets`,
 * ignore the status) fails the first three tests below. Reverting only the `if (saved)` guard
 * around `setLabel('')` fails the last one.
 */

const SECRET = 'a-test-gate-secret-that-is-long-enough-to-pass-validation'
const A_STORED_CREDENTIAL = 'scrypt$32768$8$1$ZmFrZS1zYWx0LWZvci10ZXN0cw==$fixture-not-a-derivation'

const jar = vi.hoisted(() => ({ token: undefined as string | undefined }))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.token && name === 'os_gate' ? { value: jar.token } : undefined),
  }),
}))

let dir: string
const previousDir = process.env.ONLYSOURCE_STATE_DIR
const previousSecret = process.env.PREVIEW_GATE_SECRET

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'onlysource-packets-'))
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

async function signedInAs(roleKey: string) {
  const { addMember } = await import('@/lib/admin/roster-store')
  addMember({
    id: `user:${roleKey}`,
    name: 'A Person',
    email: `${roleKey}@example.com`,
    title: '',
    roleKey,
    status: 'active',
    passwordHash: A_STORED_CREDENTIAL,
    createdAt: 1,
    updatedAt: 1,
  })
  const { issueGateToken } = await import('@/lib/session/pre-release-gate')
  jar.token = await issueGateToken(SECRET, Date.now(), 3600, `user:${roleKey}`)
}

/** The real handler, answering the real request a browser would have made. */
async function savePacket(): Promise<Response> {
  const { POST } = await import('@/app/api/packets/route')
  return (await POST(
    new Request('http://localhost/api/packets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'my packet', nsn: '5340015541274', query: '' }),
    }) as never,
  )) as Response
}

describe('the vault reads a refusal as a refusal', () => {
  it('a read_only save is REFUSED, and the outcome carries the server own sentence', async () => {
    await signedInAs('read_only')
    const res = await savePacket()
    const body = await res.json()

    // The pre-conditions, so a later change that stops refusing does not make this vacuous.
    expect(res.status).toBe(403)
    expect((body as { packets?: unknown }).packets).toBeUndefined()

    const outcome = readPacketResponse(res, body)
    expect(outcome.kind).toBe('refused')
    // Verbatim, not paraphrased. The component renders this string and nothing over it.
    expect(outcome.kind === 'refused' && outcome.problem).toBe((body as { message: string }).message)
    expect(outcome.kind === 'refused' && outcome.problem).toContain('Open documents')
  })

  it('a permitted save is SAVED, so the reader is not simply refusing everything', async () => {
    await signedInAs('operator')
    const res = await savePacket()
    const body = await res.json()

    expect(res.status).toBe(200)
    const outcome = readPacketResponse(res, body)
    expect(outcome.kind).toBe('saved')
    expect(outcome.kind === 'saved' && outcome.packets).toHaveLength(1)
  })

  it('a FOLLOWED REDIRECT is a refusal even though it answers 200 with a body', () => {
    // The expired-cookie shape: proxy answers 307 to /enter, fetch follows, /enter answers 200.
    // `ok` is true, so any reader that checks only the status believes a save happened.
    const outcome = readPacketResponse({ ok: true, redirected: true }, { packets: [] })
    expect(outcome.kind).toBe('refused')
    expect(outcome.kind === 'refused' && outcome.problem).toContain('no longer signed in')
  })

  it('a 200 that is not our JSON is a refusal, not an empty vault', () => {
    expect(readPacketResponse({ ok: true, redirected: false }, null).kind).toBe('refused')
    expect(readPacketResponse({ ok: true, redirected: false }, { hello: 'world' }).kind).toBe('refused')
    // An empty list is still a real answer, and must NOT be mistaken for a failure.
    const empty = readPacketResponse({ ok: true, redirected: false }, { packets: [] })
    expect(empty.kind).toBe('saved')
  })

  it('a refusal with no message still says something, rather than saying nothing', () => {
    const outcome = readPacketResponse({ ok: false, redirected: false }, { error: 'boom' })
    expect(outcome.kind).toBe('refused')
    expect(outcome.kind === 'refused' && outcome.problem.length).toBeGreaterThan(0)
  })
})

describe('the form is not cleared by a refusal', () => {
  const SOURCE = path.resolve(__dirname, '..', '..', 'app', '(app)', 'documents', 'PacketVault.tsx')

  /** Comments explain the defect at length, so they are removed before the code is judged. */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
  }

  const code = withoutComments(readFileSync(SOURCE, 'utf8'))

  it('the stripper left the code intact, so an absence below means something', () => {
    // Without this guard an over-eager strip would make the assertion after it vacuous.
    expect(code).toContain('readPacketResponse')
    expect(code).toContain('setLabel')
  })

  it('setLabel is only ever reached behind the saved result', () => {
    /*
     * The original bug was one unconditional line. There is exactly one clearing call and it is
     * guarded by the boolean `write()` returns, which is true only when the server answered with
     * a saved list. A future edit that moves it back out of the guard fails here.
     */
    const clears = code.match(/setLabel\(''\)/g) ?? []
    expect(clears).toHaveLength(1)
    expect(code).toContain("if (saved) setLabel('')")
  })

  it('the component renders the refusal it stored, rather than swallowing it', () => {
    expect(code).toContain('setProblem(outcome.problem)')
    expect(code).toMatch(/\{problem\}/)
  })
})
