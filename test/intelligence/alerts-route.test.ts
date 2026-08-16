/**
 * THE ALERT SEND ROUTE: an intentional no-op must not wear an outage's status code.
 *
 * Before this suite existed, a deliberately DISARMED deployment (ONLYSOURCE_EMAIL_ARMED
 * unset, the owner's standing posture) answered the Settings "Send me a test" click with the
 * same 502 a genuine Resend outage produces. With errors going only to stdout, a real
 * delivery failure would have been invisible inside the noise of intended refusals. The
 * contract pinned here:
 *
 *   refusedBy present (disarmed / recipient policy)  ->  HTTP 200, ok:true, sent:false, reason
 *   genuine transport failure                        ->  HTTP 5xx, error:'send_failed'
 *
 * Both directions carry a positive control: the disarmed case asserts a 200 that still says
 * NOTHING WAS SENT, and the armed case proves the handler actually attempted delivery (the
 * mocked transport is hit exactly once) before reporting the failure as a failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { checkDataAvailability } from '@/lib/intelligence/datasets'

// The gate is stubbed to ALLOW: this file is about what the handler does with a request it is
// permitted to serve. The 401 path is measured against the live server by the .probe scripts.
vi.mock('@/lib/session/require-gate', () => ({
  readGateVerdict: async () => ({ valid: true, payload: { sub: 'test', iat: 0, exp: 9e9 } }),
  requireGateSession: async () => undefined,
  gateOrJson: async () => null,
}))

const KEY = 'ONLYSOURCE_RESEND_KEY'
const ARM = 'ONLYSOURCE_EMAIL_ARMED'
const TEST_RCPT = 'ONLYSOURCE_TEST_RECIPIENT'
const ALLOWED = 'ONLYSOURCE_ALLOWED_RECIPIENTS'
const ENV_KEYS = [KEY, ARM, TEST_RCPT, ALLOWED, 'ALERT_CRON_TOKEN', 'ONLYSOURCE_STATE_DIR'] as const

let dir: string
const prev: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) prev[k] = process.env[k]
  dir = mkdtempSync(path.join(tmpdir(), 'onlysource-alerts-'))
  process.env.ONLYSOURCE_STATE_DIR = dir
  delete process.env[ARM]
  delete process.env[TEST_RCPT]
  delete process.env[ALLOWED]
  delete process.env.ALERT_CRON_TOKEN
  // A syntactically-present fake so emailConfigured() passes; nothing here may ever reach the
  // network, and the armed test stubs fetch to guarantee it.
  process.env[KEY] = 'test-key-not-a-real-credential'
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (prev[k] === undefined) delete process.env[k]
    else process.env[k] = prev[k]
  }
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

async function post() {
  const { POST } = await import('@/app/api/alerts/send/route')
  const req = new Request('http://localhost/api/alerts/send?test=1', { method: 'POST' })
  const res = await POST(req as never)
  const json = (await res.json()) as {
    ok?: boolean
    sent?: boolean
    reason?: string
    refusedBy?: string
    error?: string
    message?: string
  }
  return { status: res.status, ...json }
}

const ALL_PRESENT = checkDataAvailability().every((i) => i.present)

describe('POST /api/alerts/send', () => {
  if (!ALL_PRESENT) {
    it('SKIPPED: the feed inputs are absent, so the signal engine cannot produce a digest', () => {
      expect(ALL_PRESENT).toBe(false)
    })
    return
  }

  // 30s: the first call in this worker cold-parses the NSN-Now workbooks for the signal
  // engine, which takes seconds under parallel test CPU. Same allowance as the data suites.
  it('answers 200 with sent:false while the deployment is deliberately disarmed', { timeout: 30_000 }, async () => {
    const r = await post()
    expect(r.status).toBe(200)
    expect(r.ok).toBe(true)
    expect(r.sent).toBe(false)
    expect(r.refusedBy).toBe('disarmed')
    expect(r.reason).toContain('disarmed')
    // No error vocabulary on an intended refusal: the words that mean "outage" stay reserved.
    expect(r.error).toBeUndefined()
  })

  it('is stable across repeated clicks: the second answer is byte-equivalent in kind', async () => {
    const first = await post()
    const second = await post()
    expect(second.status).toBe(200)
    expect(second.sent).toBe(false)
    expect(second.refusedBy).toBe('disarmed')
    expect(first.status).toBe(second.status)
  })

  it('POSITIVE CONTROL: armed, a genuine transport failure is still a 502', async () => {
    process.env[ARM] = 'true'
    const transport = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init
      void input
      return new Response('upstream exploded', { status: 500 })
    })
    vi.stubGlobal('fetch', transport)

    const r = await post()
    expect(r.status).toBe(502)
    expect(r.error).toBe('send_failed')
    expect(r.sent).toBeUndefined()
    // The handler genuinely attempted delivery before calling it a failure: the transport
    // was hit exactly once, and only the Resend endpoint was dialed.
    expect(transport).toHaveBeenCalledTimes(1)
    const dialed = String(transport.mock.calls[0]?.[0] ?? '')
    expect(dialed).toContain('api.resend.com')
  })
})
