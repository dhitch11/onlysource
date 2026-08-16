/**
 * THE PURSUE DEDUPE: one reference, one deal.
 *
 * The pursuit wire puts a Pursue control on every opportunity surface, which means the same
 * stock number can be pursued twice from one surface (double press) or once each from two
 * (the Monopoly row and its dossier). The contract pinned here:
 *
 *   a create whose ref is already a deal   ->  200, {existing:true}, the EXISTING id, NO write
 *   a create with a new ref                ->  a real new deal (positive control)
 *   an EMPTY ref                           ->  never matches anything: two refless manual
 *                                              deals are two deals, not one
 *
 * Ref equality is normalized (case, punctuation, spacing) because the same NSN arrives as
 * "5325-01-705-3574" from the grid and "5325017053574" from a hand-typed manual deal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { normalizeDealRef, PURSUE_NEXT_ACTION } from '@/lib/sales/pipeline'
import { findDealByRef, readDeals, upsertDeal } from '@/lib/sales/deals-store'

// The gate is stubbed to ALLOW: this file is about what the handler does with a request it
// is permitted to serve. The 401 path is measured against the live server by .probe scripts.
vi.mock('@/lib/session/require-gate', () => ({
  readGateVerdict: async () => ({ valid: true, payload: { sub: 'test', iat: 0, exp: 9e9 } }),
  requireGateSession: async () => undefined,
  gateOrJson: async () => null,
}))

let dir: string
let prevStateDir: string | undefined

beforeEach(() => {
  prevStateDir = process.env.ONLYSOURCE_STATE_DIR
  dir = mkdtempSync(path.join(tmpdir(), 'onlysource-deals-'))
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
    deals?: Array<{ id: string; ref: string; title: string; valueUsd: number | null }>
    id?: string
    existing?: boolean
    error?: string
  }
  return { status: res.status, ...json }
}

describe('normalizeDealRef: one stock number, one spelling', () => {
  it('equates the formatted and bare forms of the same NSN', () => {
    expect(normalizeDealRef('5325-01-705-3574')).toBe(normalizeDealRef('5325017053574'))
  })

  it('equates case and spacing on a solicitation number', () => {
    expect(normalizeDealRef('spe4a7-25-t-0001')).toBe(normalizeDealRef('SPE4A7 25 T 0001'))
  })

  it('REFUSES to equate an empty ref with anything, including another empty ref, by normalizing to the empty string the lookups refuse', () => {
    expect(normalizeDealRef('   ')).toBe('')
    expect(normalizeDealRef('---')).toBe('')
  })

  it('POSITIVE CONTROL: two genuinely different refs stay different', () => {
    expect(normalizeDealRef('5325-01-705-3574')).not.toBe(normalizeDealRef('5325-01-705-3575'))
  })
})

describe('findDealByRef reads the store through the same equality', () => {
  it('finds a stored deal by any spelling of its ref', () => {
    upsertDeal({ id: 'd1', title: 'Bushing', ref: '5325-01-705-3574' }, NOW)
    expect(findDealByRef('5325017053574')?.id).toBe('d1')
    expect(findDealByRef('5325-01-705-3574')?.id).toBe('d1')
  })

  it('REFUSES an empty ref even when refless deals exist', () => {
    upsertDeal({ id: 'd1', title: 'Manual deal, no ref', ref: '' }, NOW)
    expect(findDealByRef('')).toBeNull()
    expect(findDealByRef('  ')).toBeNull()
  })

  it('POSITIVE CONTROL: an unknown ref is null, a known one is found, in the same store', () => {
    upsertDeal({ id: 'd1', title: 'Bushing', ref: 'NSN-1' }, NOW)
    expect(findDealByRef('NSN-2')).toBeNull()
    expect(findDealByRef('nsn1')?.id).toBe('d1')
  })
})

describe('POST /api/deals dedupes creates by ref, server-side', () => {
  it('a second create with the same ref returns the EXISTING deal, 200, {existing:true}, and writes nothing', async () => {
    const first = await post({
      title: '5325-01-705-3574 · BUSHING, SLEEVE',
      ref: '5325-01-705-3574',
      niin: '017053574',
      valueUsd: 1234,
      stage: 'opportunities',
      nextAction: PURSUE_NEXT_ACTION,
    })
    expect(first.status).toBe(200)
    expect(first.existing).toBeUndefined()
    const firstId = first.id
    expect(firstId).toBeTruthy()

    // The double press, and the cross-surface press: a DIFFERENT spelling of the same ref.
    const second = await post({ title: 'pursued again', ref: '5325017053574' })
    expect(second.status).toBe(200)
    expect(second.existing).toBe(true)
    expect(second.id).toBe(firstId)

    // THE DEDUPE ASSERTION, on the stored state itself: one deal, the first one's title.
    const stored = readDeals()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.id).toBe(firstId)
    expect(stored[0]?.title).toBe('5325-01-705-3574 · BUSHING, SLEEVE')
    // The seeded next action survived; the dedupe did not overwrite the original deal.
    expect(stored[0]?.nextAction).toBe(PURSUE_NEXT_ACTION)
  })

  it('POSITIVE CONTROL: a create with a DIFFERENT ref writes a second deal', async () => {
    await post({ title: 'first', ref: 'NSN-A' })
    const r = await post({ title: 'second', ref: 'NSN-B' })
    expect(r.status).toBe(200)
    expect(r.existing).toBeUndefined()
    expect(readDeals()).toHaveLength(2)
  })

  it('REFUSES to fold refless manual deals into each other: two empty refs are two deals', async () => {
    await post({ title: 'manual one', ref: '' })
    const r = await post({ title: 'manual two', ref: '' })
    expect(r.existing).toBeUndefined()
    expect(readDeals()).toHaveLength(2)
  })

  it('an UPDATE (id present) is never treated as a duplicate create', async () => {
    const created = await post({ title: 'Bushing', ref: 'NSN-A', stage: 'opportunities' })
    /*
     * Since the stage guard was wired (2026-08-16), a move to Leads needs the operator's
     * attestation that a pursuit is running; without it the move is REFUSED, which is the
     * guard's own contract (asserted in stage-guard.test.ts). With it, the update flows and
     * is never mistaken for a duplicate create.
     */
    const refused = await post({ id: created.id, ref: 'NSN-A', stage: 'leads' })
    expect(refused.status).toBe(409)
    const updated = await post({ id: created.id, ref: 'NSN-A', stage: 'leads', attest: 'outreach_running' })
    expect(updated.status).toBe(200)
    expect(updated.existing).toBeUndefined()
    expect(readDeals()).toHaveLength(1)
    expect(readDeals()[0]?.stage).toBe('leads')
  })

  it('a pursued deal with unmeasured legs stores valueUsd null, never a zero or an invention', async () => {
    await post({ title: '1234-00-000-0001 · WIDGET', ref: '1234-00-000-0001', valueUsd: null })
    expect(readDeals()[0]?.valueUsd).toBeNull()
  })

  it('still refuses a contentless create (the title rule is untouched by the dedupe)', async () => {
    const r = await post({ title: '   ', ref: 'NSN-NEW' })
    expect(r.status).toBe(400)
    expect(r.error).toBe('empty_deal')
    expect(readDeals()).toHaveLength(0)
  })
})
