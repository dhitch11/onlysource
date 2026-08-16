/**
 * THE WIRED STAGE GUARD AND THE HONEST CLOSE.
 *
 * lib/sales/pipeline.ts always DOCUMENTED an evidence-gated state machine; until 2026-08-16
 * nothing in the serving path called it. The audit's live probe proved it: an AI-owned deal
 * POSTed straight into Won & Revenue at $999,999 with zero evidence, no audit row, 200 OK.
 * This file pins the wiring:
 *
 *   REFUSALS  unknown stage / owner -> 400, never silent coercion to a default
 *             AI-owned deal into Won -> 409 AI_CANNOT_FILE
 *             Won without the actual amount / award ref / basis -> 400 or 409, named
 *             Quoting without a saved Documents packet -> 409 NO_PACKET
 *             Leads without the operator's attestation -> 409 NO_ACTIVE_PURSUIT
 *             recorded-close fields on a generic update -> 400 won_fields_locked
 *             a deal CREATED directly in Won -> 400 cannot_create_won
 *             audit write fails -> 503 and the stage DOES NOT MOVE (4.17.4)
 *   POSITIVE  each refusal's mirror image succeeds with the evidence supplied, the audit
 *             row lands BEFORE the store moves, Won sums recorded closes only, and leaving
 *             Won clears the recorded close and says so.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { readDeals, upsertDeal } from '@/lib/sales/deals-store'
import { readDealAudit } from '@/lib/sales/deal-audit'
import { STAGE_NEXT_ACTION, PURSUE_NEXT_ACTION } from '@/lib/sales/pipeline'
import { savePacket } from '@/lib/compliance/packets-store'

vi.mock('@/lib/session/require-gate', () => ({
  readGateVerdict: async () => ({ valid: true, payload: { sub: 'test', iat: 0, exp: 9e9 } }),
  requireGateSession: async () => undefined,
  gateOrJson: async () => null,
}))

let dir: string
let prevStateDir: string | undefined

beforeEach(() => {
  prevStateDir = process.env.ONLYSOURCE_STATE_DIR
  dir = mkdtempSync(path.join(tmpdir(), 'onlysource-guard-'))
  process.env.ONLYSOURCE_STATE_DIR = dir
})

afterEach(() => {
  if (prevStateDir === undefined) delete process.env.ONLYSOURCE_STATE_DIR
  else process.env.ONLYSOURCE_STATE_DIR = prevStateDir
  rmSync(dir, { recursive: true, force: true })
})

const NOW = 1_760_000_000_000

async function post(body: unknown) {
  const { POST } = await import('@/app/api/deals/route')
  const req = new Request('http://localhost/api/deals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await POST(req as never)
  const json = (await res.json()) as {
    deals?: Array<Record<string, unknown>>
    id?: string
    error?: string
    code?: string
    message?: string
    clearedRecordedClose?: boolean
    note?: string
  }
  return { status: res.status, ...json }
}

const seed = (over: Record<string, unknown> = {}) => {
  upsertDeal(
    {
      id: 'd1',
      title: 'Bushing corner',
      ref: '5325-01-705-3574',
      stage: 'opportunities',
      owner: 'DH',
      valueUsd: 13962,
      nextAction: PURSUE_NEXT_ACTION,
      ...over,
    } as never,
    NOW,
  )
}

describe('enum validation: a wrong value is refused, never coerced', () => {
  it('REFUSES an unknown stage with 400 and leaves the deal exactly where it was', async () => {
    seed({ stage: 'quoting' })
    const r = await post({ id: 'd1', stage: 'made_up_stage_xyz' })
    expect(r.status).toBe(400)
    expect(r.error).toBe('bad_stage')
    expect(readDeals()[0]?.stage).toBe('quoting') // NOT silently reset to opportunities
  })

  it('REFUSES an unknown owner with 400 instead of silently reassigning to a human', async () => {
    seed({ owner: 'AI' })
    const r = await post({ id: 'd1', owner: 'TOTALLY_FAKE_OWNER' })
    expect(r.status).toBe(400)
    expect(r.error).toBe('bad_owner')
    expect(readDeals()[0]?.owner).toBe('AI') // NOT flipped to DH
  })

  it('REFUSES an unknown attestation and an unknown close basis', async () => {
    seed()
    expect((await post({ id: 'd1', stage: 'leads', attest: 'trust_me' })).status).toBe(400)
    expect(
      (await post({ id: 'd1', stage: 'won_revenue', wonValueUsd: 1, wonRef: 'X', wonBasis: 'vibes' })).status,
    ).toBe(400)
  })

  it('POSITIVE CONTROL: a valid update still flows', async () => {
    seed()
    const r = await post({ id: 'd1', title: 'Renamed' })
    expect(r.status).toBe(200)
    expect(readDeals()[0]?.title).toBe('Renamed')
  })
})

describe('the evidence gate, wired into the serving path', () => {
  it('REFUSES a jump to Leads without the attestation, allows it with one, and audits the attestation', async () => {
    seed()
    const refused = await post({ id: 'd1', stage: 'leads' })
    expect(refused.status).toBe(409)
    expect(refused.code).toBe('NO_ACTIVE_PURSUIT')
    expect(readDeals()[0]?.stage).toBe('opportunities')
    expect(readDealAudit()).toHaveLength(0) // a refused move writes no history

    const ok = await post({ id: 'd1', stage: 'leads', attest: 'outreach_running' })
    expect(ok.status).toBe(200)
    expect(readDeals()[0]?.stage).toBe('leads')
    const audit = readDealAudit()
    expect(audit).toHaveLength(1)
    expect(audit[0]?.reason).toContain('attested')
  })

  it('REFUSES Quoting with no saved Documents packet, allows it when one matches the ref (any spelling)', async () => {
    seed({ stage: 'leads' })
    const refused = await post({ id: 'd1', stage: 'quoting' })
    expect(refused.status).toBe(409)
    expect(refused.code).toBe('NO_PACKET')

    // The documents lane reports the state: a saved packet for the SAME stock number,
    // spelled without hyphens, must count (normalized ref equality).
    savePacket({ label: 'Bushing packet', nsn: '5325017053574', query: 'nsn=5325017053574' }, 'p1', NOW)
    const ok = await post({ id: 'd1', stage: 'quoting' })
    expect(ok.status).toBe(200)
    expect(readDeals()[0]?.stage).toBe('quoting')
  })

  it('REFUSES an AI-owned deal into Won & Revenue outright, with the reassignment named', async () => {
    seed({ stage: 'customers', owner: 'AI' })
    const r = await post({
      id: 'd1',
      stage: 'won_revenue',
      wonValueUsd: 999999,
      wonRef: 'SPE4A6-26-V-0001',
      wonBasis: 'material_confirmed',
    })
    expect(r.status).toBe(409)
    expect(r.code).toBe('AI_CANNOT_FILE')
    expect(readDeals()[0]?.stage).toBe('customers')
    expect(readDeals()[0]?.wonValueUsd).toBeNull()
  })

  it('REFUSES Won without the actual amount, without the award ref, and without the basis, each named', async () => {
    seed({ stage: 'customers' })

    const noValue = await post({ id: 'd1', stage: 'won_revenue', wonRef: 'PO-1', wonBasis: 'material_confirmed' })
    expect(noValue.status).toBe(400)
    expect(noValue.error).toBe('won_value_required')

    const noRef = await post({ id: 'd1', stage: 'won_revenue', wonValueUsd: 5000, wonBasis: 'material_confirmed' })
    expect(noRef.status).toBe(409)
    expect(noRef.code).toBe('NO_AWARD_RECORD')

    const noBasis = await post({ id: 'd1', stage: 'won_revenue', wonValueUsd: 5000, wonRef: 'PO-1' })
    expect(noBasis.status).toBe(409)
    expect(noBasis.code).toBe('NO_TERMINAL_OUTCOME')

    expect(readDeals()[0]?.stage).toBe('customers')
  })

  it('POSITIVE CONTROL: a complete close lands, stores the RECORDED value distinct from the model, stamps the clock, and audits first', async () => {
    seed({ stage: 'customers', valueUsd: 13962 })
    const r = await post({
      id: 'd1',
      stage: 'won_revenue',
      wonValueUsd: 11500,
      wonRef: 'SPE4A6-26-V-0001',
      wonBasis: 'documents_received',
    })
    expect(r.status).toBe(200)
    const d = readDeals()[0]
    expect(d?.stage).toBe('won_revenue')
    expect(d?.wonValueUsd).toBe(11500) // the RECORDED close, not the modeled 13962
    expect(d?.valueUsd).toBe(13962) // the model survives as what it always was
    expect(typeof d?.wonAtMs).toBe('number')
    expect(d?.wonRef).toBe('SPE4A6-26-V-0001')

    const audit = readDealAudit()
    expect(audit).toHaveLength(1)
    expect(audit[0]?.to).toBe('won_revenue')
    expect(audit[0]?.reason).toContain('SPE4A6-26-V-0001')
  })

  it('a deal moved OUT of Won clears the recorded close and SAYS SO', async () => {
    seed({ stage: 'customers' })
    await post({ id: 'd1', stage: 'won_revenue', wonValueUsd: 8000, wonRef: 'PO-9', wonBasis: 'material_confirmed' })
    const back = await post({ id: 'd1', stage: 'customers' })
    expect(back.status).toBe(200)
    expect(back.clearedRecordedClose).toBe(true)
    expect(String(back.note)).toContain('recorded close was cleared')
    const d = readDeals()[0]
    expect(d?.wonValueUsd).toBeNull()
    expect(d?.wonAtMs).toBeNull()
    expect(d?.wonRef).toBeNull()
  })

  it('REFUSES recorded-close fields on a generic update: the number is not editable in place', async () => {
    seed({ stage: 'customers' })
    await post({ id: 'd1', stage: 'won_revenue', wonValueUsd: 8000, wonRef: 'PO-9', wonBasis: 'material_confirmed' })
    const r = await post({ id: 'd1', wonValueUsd: 55555 })
    expect(r.status).toBe(400)
    expect(r.error).toBe('won_fields_locked')
    expect(readDeals()[0]?.wonValueUsd).toBe(8000)
  })

  it('REFUSES a deal CREATED directly in Won & Revenue', async () => {
    const r = await post({ title: 'Backfilled win', ref: 'NSN-X', stage: 'won_revenue' })
    expect(r.status).toBe(400)
    expect(r.error).toBe('cannot_create_won')
    expect(readDeals()).toHaveLength(0)
  })

  it('4.17.4: WHEN THE AUDIT WRITE FAILS, THE STAGE DOES NOT MOVE', async () => {
    seed()
    // Make the audit path unwritable: the trail's filename occupied by a DIRECTORY, so
    // appendFileSync throws EISDIR while the deals store around it still works.
    mkdirSync(path.join(dir, 'deal-audit.jsonl'))
    const r = await post({ id: 'd1', stage: 'leads', attest: 'outreach_running' })
    expect(r.status).toBe(503)
    expect(r.error).toBe('audit_failed')
    expect(readDeals()[0]?.stage).toBe('opportunities') // unmoved, exactly as documented

    // POSITIVE CONTROL: clear the obstruction and the same move lands and audits.
    rmSync(path.join(dir, 'deal-audit.jsonl'), { recursive: true, force: true })
    const ok = await post({ id: 'd1', stage: 'leads', attest: 'outreach_running' })
    expect(ok.status).toBe(200)
    expect(readDeals()[0]?.stage).toBe('leads')
    expect(readDealAudit()).toHaveLength(1)
  })

  it('the audit trail is append-only across moves and survives as JSONL on disk', async () => {
    seed()
    await post({ id: 'd1', stage: 'leads', attest: 'outreach_running' })
    savePacket({ label: 'p', nsn: '5325017053574', query: 'q' }, 'p1', NOW)
    await post({ id: 'd1', stage: 'quoting' })
    const audit = readDealAudit()
    expect(audit.map((a) => a.to)).toEqual(['leads', 'quoting'])
    const raw = readFileSync(path.join(dir, 'deal-audit.jsonl'), 'utf8').trim().split('\n')
    expect(raw).toHaveLength(2)
  })
})

describe('stage-seeded next actions: honest suggestions that never eat operator text', () => {
  it('seeds the new stage action over a previous SEED', async () => {
    seed({ nextAction: PURSUE_NEXT_ACTION })
    await post({ id: 'd1', stage: 'leads', attest: 'outreach_running' })
    expect(readDeals()[0]?.nextAction).toBe(STAGE_NEXT_ACTION.leads)
  })

  it("NEVER overwrites the operator's own text", async () => {
    seed({ nextAction: 'Call Frank about the fixture tooling' })
    await post({ id: 'd1', stage: 'leads', attest: 'outreach_running' })
    expect(readDeals()[0]?.nextAction).toBe('Call Frank about the fixture tooling')
  })

  it('a NEW deal with no next action gets its stage seed; a written one is kept verbatim', async () => {
    const seeded = await post({ title: 'Seeded', ref: 'NSN-S', stage: 'leads' })
    expect(seeded.status).toBe(200)
    expect(readDeals().find((d) => d.ref === 'NSN-S')?.nextAction).toBe(STAGE_NEXT_ACTION.leads)

    await post({ title: 'Written', ref: 'NSN-W', stage: 'leads', nextAction: 'ping Maria' })
    expect(readDeals().find((d) => d.ref === 'NSN-W')?.nextAction).toBe('ping Maria')
  })

  it('the Quoting seed names DIBBS, the government site, as where quotes are filed', () => {
    expect(STAGE_NEXT_ACTION.quoting).toContain('DIBBS')
    expect(STAGE_NEXT_ACTION.quoting.toLowerCase()).toContain('government site')
  })
})

describe('the coercion boundary backs the API: stored files cannot smuggle a close', () => {
  it('a won value stored on a NON-won deal reads back null', () => {
    upsertDeal(
      { id: 'x', title: 'tampered', ref: '', stage: 'leads', wonValueUsd: 90000, wonAtMs: NOW, wonRef: 'X' } as never,
      NOW,
    )
    const d = readDeals().find((x) => x.id === 'x')
    expect(d?.wonValueUsd).toBeNull()
    expect(d?.wonAtMs).toBeNull()
    expect(d?.wonRef).toBeNull()
  })
})
