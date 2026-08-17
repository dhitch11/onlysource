/**
 * A CLIPPED DELIVERABLE IS NEVER SERVED AS FINISHED.
 *
 * Measured defect this pins (2026-08-17): the live portfolio brief twice shipped ending
 * MID-WORD ("…remain at INSUFFICIEN") with a 200 and a bill, because the client discarded
 * stop_reason. The contract now: stop_reason=max_tokens gets ONE retry on the same model
 * with doubled headroom; a second clip fails over to the next model; and if every model
 * clips, the caller gets an honest failure, never the cut text.
 *
 * The endpoint is mocked; no request leaves this process and no real key is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generate } from '@/lib/ai/anthropic'

type MockResp = { stop_reason: string; text: string }

function anthropicOk({ stop_reason, text }: MockResp) {
  return new Response(
    JSON.stringify({ content: [{ type: 'text', text }], stop_reason }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const FULL = 'THE SHAPE OF THE BOOK\nA complete read that ends on a full stop.'
const CLIPPED = 'THE SHAPE OF THE BOOK\nA read that ends mid-wo'

describe('generate() refuses to serve stop_reason=max_tokens', () => {
  const calls: Array<{ model: string; max_tokens: number }> = []

  beforeEach(() => {
    calls.length = 0
    vi.stubEnv('ANTHROPIC_API_KEY', 'not-a-real-key-test-double')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function stubFetch(script: MockResp[]) {
    let i = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model: string; max_tokens: number }
        calls.push({ model: body.model, max_tokens: body.max_tokens })
        const step = script[Math.min(i, script.length - 1)]!
        i += 1
        return anthropicOk(step)
      }),
    )
  }

  it('a clean end_turn response passes through untouched (positive control)', async () => {
    stubFetch([{ stop_reason: 'end_turn', text: FULL }])
    const r = await generate('sys', 'user', 1200, 'portfolio_brief')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe(FULL)
    expect(calls).toHaveLength(1)
  })

  it('one clip earns one retry on the SAME model with doubled headroom, and the full text is served', async () => {
    stubFetch([
      { stop_reason: 'max_tokens', text: CLIPPED },
      { stop_reason: 'end_turn', text: FULL },
    ])
    const r = await generate('sys', 'user', 1200, 'portfolio_brief')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe(FULL)
      expect(r.model).toBe(calls[0]!.model)
    }
    expect(calls).toHaveLength(2)
    expect(calls[1]!.model).toBe(calls[0]!.model)
    expect(calls[1]!.max_tokens).toBe(2400)
  })

  it('two clips on one model fail over to the next model in the chain', async () => {
    stubFetch([
      { stop_reason: 'max_tokens', text: CLIPPED },
      { stop_reason: 'max_tokens', text: CLIPPED },
      { stop_reason: 'end_turn', text: FULL },
    ])
    const r = await generate('sys', 'user', 1000, 'deliverable')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe(FULL)
      expect(r.model).toBe(calls[2]!.model)
      expect(r.model).not.toBe(calls[0]!.model)
    }
  })

  it('when EVERY model clips, the caller gets an honest failure and never the cut text', async () => {
    stubFetch([{ stop_reason: 'max_tokens', text: CLIPPED }])
    const r = await generate('sys', 'user', 1000, 'deliverable')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('clipped deliverable')
      expect(JSON.stringify(r)).not.toContain('mid-wo')
    }
    // deliverable chain has two models, each tried twice (base + doubled budget).
    expect(calls).toHaveLength(4)
  })
})
