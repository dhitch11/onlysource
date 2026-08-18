/**
 * WHO THE RECORD SAYS DID IT.
 *
 * components/sales/PursueButton.tsx used to send `owner: 'DH'` as a literal in the create body,
 * so every deal any account started was filed under one man's initials. Reproduced in an audit
 * on 2026-08-18: signed in as David Goodreau, pressed Pursue, and the deal card came back owned
 * by DH. In a product with more than one login that is a false record of who did what.
 *
 * ==========================================================================================
 * THE FIX IS AN OMISSION, AND AN OMISSION IS EXACTLY WHAT REGRESSES SILENTLY.
 * ==========================================================================================
 * A browser cannot be trusted to assert an identity: whatever the component sends, a hand-rolled
 * POST can send something else. So the client stops claiming ownership at all and the server
 * stamps it from the gate session. Nothing about that shows up in a screenshot, a typecheck or a
 * green deploy, and the next person to touch this file will feel the urge to "restore" the field
 * that looks missing. This test is what stops that.
 *
 * POSITIVE CONTROL, EXERCISED: putting `owner: 'DH'` back into the POST body fails the first
 * test here. Measured by doing it.
 *
 * ==========================================================================================
 * THIS TEST DOES NOT CLAIM THE DEFECT IS FULLY FIXED, AND THE SECOND CASE IS WHY.
 * ==========================================================================================
 * lib/sales/deals-store.ts `coerce` defaults an unknown owner to 'DH'. So removing the client's
 * claim moves the fabrication one layer down rather than ending it: a create with no owner still
 * lands as DH. The remaining half is the server stamp, and it belongs to the lane that owns
 * app/api/**. The second case below pins that gap as a fact rather than leaving it to be
 * rediscovered, and it is written so it FAILS the day the server starts stamping, which is the
 * day somebody should come back and turn it into an assertion about the session instead.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readDeals, upsertDeal } from '@/lib/sales/deals-store'

const ROOT = path.resolve(__dirname, '..', '..')
const PURSUE = path.join(ROOT, 'components', 'sales', 'PursueButton.tsx')

/** Comments explain the omission at length, so they are removed before the code is judged. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
}

describe('the client never asserts who owns a deal', () => {
  const code = withoutComments(readFileSync(PURSUE, 'utf8'))

  it('the stripper left the request body intact, so an absence below means something', () => {
    // Without this guard an over-eager strip would make every assertion here vacuous.
    expect(code).toMatch(/stage:\s*'opportunities'/)
    expect(code).toMatch(/nextAction:\s*PURSUE_NEXT_ACTION/)
    expect(code).toMatch(/fetch\('\/api\/deals'/)
  })

  it('sends no owner field at all, and names no operator initials', () => {
    expect(code).not.toMatch(/owner\s*:/)
    // The literal itself, in any position: the defect was the string, not the key.
    expect(code).not.toMatch(/'(?:DH|DG|AI)'/)
  })

  it('does not import the owner type either, so there is nothing to reach for', () => {
    expect(code).not.toMatch(/DealOwner/)
  })
})

describe('the half of the defect that is NOT fixed here, pinned so it cannot be forgotten', () => {
  let dir: string
  let prev: string | undefined

  beforeEach(() => {
    prev = process.env.ONLYSOURCE_STATE_DIR
    dir = mkdtempSync(path.join(tmpdir(), 'onlysource-owner-'))
    process.env.ONLYSOURCE_STATE_DIR = dir
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.ONLYSOURCE_STATE_DIR
    else process.env.ONLYSOURCE_STATE_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  })

  it('a deal created with no owner STILL lands as DH, because the store defaults it', () => {
    /*
     * Not an endorsement. This is the measurement that says the client-side removal alone is
     * insufficient, and it is here so the lane that owns app/api/deals/route.ts can see exactly
     * what it has to overwrite. When that lane stamps the owner from the gate session, a create
     * from David Goodreau's session must land as DG and this assertion must be rewritten to say
     * so. A failure here is progress, not a break.
     */
    upsertDeal({ id: 'test-no-owner', title: 'A deal with no stated owner', ref: 'X1' }, 1)
    const stored = readDeals().find((d) => d.id === 'test-no-owner')
    expect(stored?.owner).toBe('DH')
  })
})
