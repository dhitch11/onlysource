import { describe, expect, it } from 'vitest'
import { readMint } from '@/components/thomas/useVoice'

/**
 * THE MINT RESPONSE IS READ IN THE ORDER THE FAILURES ACTUALLY HAPPEN.
 *
 * ==========================================================================================
 * WHAT CLASS OF DEFECT THIS IS, STATED PLAINLY, BECAUSE TWO REVIEWERS GOT IT WRONG.
 * ==========================================================================================
 * It is a ROBUSTNESS AND MESSAGE-QUALITY defect, not a security one. `useVoice` used to call
 * `r.json()` with no check. When the gate has expired, `proxy.ts` answers `/api/thomas/voice` with
 * a 307 to `/enter`, fetch follows it, and the body is HTML. `json()` throws on the leading `<`,
 * the throw is caught, and the code DENIES. Access was never granted on any path. What was wrong
 * was what the person was told:
 *
 *   - `start()` surfaced the parse error itself, so pressing Talk produced something like
 *     "Unexpected token '<'", which tells a trader nothing.
 *   - the probe is the worse half, and it is why `r.redirected` is checked before `r.ok`. A
 *     followed redirect answers 200, so `r.ok` was TRUE, `available` was set to true, and the Talk
 *     button rendered on a session that cannot mint. A control that renders and cannot play is a
 *     named defect on this estate, and this is it arriving through the back door.
 *
 * THE TWO FETCHES IN `app/api/thomas/voice/route.ts` ARE NOT THIS DEFECT. They are server to server
 * calls to api.elevenlabs.io. They already check `.ok`, there is no gate in front of them, and
 * there is no redirect to follow. Nothing here should be "fixed" over there.
 */

/** The sign-in page, exactly as a bounced request receives it: 200, HTML, redirected. */
function bouncedToSignIn(): Response {
  const r = new Response('<!DOCTYPE html><html><body>Sign in</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  })
  // `redirected` is read-only on a constructed Response, so it is defined the way fetch would.
  Object.defineProperty(r, 'redirected', { value: true })
  return r
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('an expired session is named as an expired session', () => {
  it('says the session expired and what to do, rather than surfacing a parse error', async () => {
    const verdict = await readMint(bouncedToSignIn())

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toMatch(/session expired/i)
    expect(verdict.reason).toMatch(/sign in again/i)
    // The failure the operator used to get instead.
    expect(verdict.reason).not.toMatch(/unexpected token|JSON|SyntaxError/i)
  })

  it('refuses it even though the redirect answered 200, which is the whole point', async () => {
    const bounced = bouncedToSignIn()
    expect(bounced.ok).toBe(true)
    expect(await readMint(bounced)).toMatchObject({ ok: false })
  })
})

describe('a stated refusal from the route is repeated to the operator in its own words', () => {
  it('carries the billing message through, because it is the actionable one', async () => {
    const verdict = await readMint(
      json(503, {
        ok: false,
        error: 'voice_billing_blocked',
        message:
          'Voice is paused: the ElevenLabs account has an unpaid invoice, which blocks speech recognition. Typed chat is unaffected.',
      }),
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toMatch(/unpaid invoice/i)
  })

  it('falls back to the status when the route sent no message', async () => {
    const verdict = await readMint(new Response('', { status: 502 }))
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('502')
  })

  it('refuses a 200 that carries no signed URL, rather than opening a socket to undefined', async () => {
    const verdict = await readMint(json(200, { ok: true }))
    expect(verdict.ok).toBe(false)
  })

  /*
   * THE CASE `r.redirected` ALONE WOULD MISS: an HTML error page answered in place, with no
   * redirect to detect. The content-type assertion is what closes it, and it is the proof this
   * repository's own `followed-redirect-read-as-ok` lint rule asks for.
   */
  it('refuses a 200 that is HTML with no redirect at all', async () => {
    const verdict = await readMint(
      new Response('<!DOCTYPE html><html><body>Sign in</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toMatch(/page instead of a session/i)
  })

  it('refuses a 200 whose body is not JSON at all', async () => {
    const verdict = await readMint(new Response('not json', { status: 200 }))
    expect(verdict.ok).toBe(false)
  })
})

/*
 * THE POSITIVE CONTROL. Without it, a `readMint` hardwired to refuse would pass everything above
 * and voice would simply never start, which is a worse product than the defect being fixed.
 */
describe('a real mint is accepted and its URL is handed back untouched', () => {
  it('accepts the shape the route actually returns', async () => {
    const verdict = await readMint(
      json(200, { ok: true, signedUrl: 'wss://api.elevenlabs.io/v1/convai/conversation?token=abc', agentId: 'a1' }),
    )
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.signedUrl).toBe('wss://api.elevenlabs.io/v1/convai/conversation?token=abc')
  })
})
