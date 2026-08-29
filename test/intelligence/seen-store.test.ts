import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readSeen, markSeen, normalizeNsn, MAX_SEEN } from '@/lib/intelligence/seen-store'

/**
 * SEEN-STATE, the store.
 *
 * The load-bearing assertions here are not "does it save a string". They are the two ways this
 * feature can be silently wrong in a way no error would ever reveal:
 *
 *  1. THE KEY. The grid links with digits and the row displays dashes. If the two ends normalized
 *     differently every mark would be written under one key and read under another: nothing would
 *     throw, and the glow would simply never appear.
 *  2. UNKNOWN vs EMPTY. An unreadable store must not read as "you have opened nothing". That
 *     mistake tells an operator a board he has already worked is untouched.
 */

let dir: string
const A = 'acct_wayne'
const B = 'acct_other'

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'seen-'))
  process.env.ONLYSOURCE_STATE_DIR = dir
})
afterEach(() => {
  delete process.env.ONLYSOURCE_STATE_DIR
  rmSync(dir, { recursive: true, force: true })
})

const AT = '2026-08-29T20:00:00.000Z'

describe('the key both ends share', () => {
  it('reduces a dashed stock number to the digits form the corner URL uses', () => {
    expect(normalizeNsn('5340-01-608-5969')).toBe('5340016085969')
  })

  it('MARKS WITH DASHES AND READS BACK WITH DIGITS — the silent-miss this feature dies on', () => {
    // The grid hands markSeen the DISPLAYED value; the dossier page hands it the URL key. Both
    // must land on one row. If this fails, the glow never appears and nothing errors.
    markSeen(A, '5340-01-608-5969', AT)
    expect(readSeen(A).nsns).toEqual(['5340016085969'])

    markSeen(A, '5340016085969', AT)
    expect(readSeen(A).nsns).toEqual(['5340016085969'])
    expect(readSeen(A).nsns).toHaveLength(1)
  })
})

describe('unknown is not empty', () => {
  it('reports available:false when the store is malformed, and NOT an empty seen set', () => {
    writeFileSync(path.join(dir, 'seen-state.json'), '{ this is not json', 'utf8')
    const s = readSeen(A)
    expect(s.available).toBe(false)
    expect(s.nsns).toEqual([])
  })

  it('reports available:TRUE with an empty set when the file simply does not exist yet', () => {
    // A fresh install genuinely has nothing marked. That is empty, and it is KNOWN to be empty.
    const s = readSeen(A)
    expect(s.available).toBe(true)
    expect(s.nsns).toEqual([])
  })

  it('reports available:false when there is no account to key marks against', () => {
    expect(readSeen(null).available).toBe(false)
  })

  it('refuses the write rather than reporting success when the store cannot be read', () => {
    writeFileSync(path.join(dir, 'seen-state.json'), 'not json at all', 'utf8')
    const r = markSeen(A, '5340-01-608-5969', AT)
    expect(r.ok).toBe(false)
    // The API turns this into a 503 and the grid rolls the optimistic mark back. A cheerful
    // ok:true here would leave the operator believing a row was remembered when it was not.
  })
})

describe('marks belong to one operator', () => {
  it('does not leak one account’s marks into another’s board', () => {
    markSeen(A, '1111-11-111-1111', AT)
    expect(readSeen(A).nsns).toEqual(['1111111111111'])
    expect(readSeen(B).nsns).toEqual([])
    expect(readSeen(B).available).toBe(true)
  })

  it('keeps both operators when the second writes after the first', () => {
    markSeen(A, '1111-11-111-1111', AT)
    markSeen(B, '2222-22-222-2222', AT)
    expect(readSeen(A).nsns).toEqual(['1111111111111'])
    expect(readSeen(B).nsns).toEqual(['2222222222222'])
  })
})

describe('idempotence', () => {
  it('reports added:true once and added:false thereafter', () => {
    expect(markSeen(A, '3333-33-333-3333', AT).added).toBe(true)
    expect(markSeen(A, '3333-33-333-3333', '2026-08-30T00:00:00.000Z').added).toBe(false)
    expect(readSeen(A).nsns).toHaveLength(1)
  })
})

describe('refusals', () => {
  it('refuses a stock number with no digits instead of writing an empty key', () => {
    const r = markSeen(A, 'not-a-stock-number', AT)
    expect(r.ok).toBe(false)
    expect(readSeen(A).nsns).toEqual([])
  })

  it('refuses when there is no account id', () => {
    expect(markSeen(null, '4444-44-444-4444', AT).ok).toBe(false)
  })

  it('survives a store whose account bucket is the wrong shape, rather than throwing', () => {
    writeFileSync(path.join(dir, 'seen-state.json'), JSON.stringify({ [A]: ['an array, not an object'] }), 'utf8')
    const s = readSeen(A)
    expect(s.available).toBe(true)
    expect(s.nsns).toEqual([])
    expect(markSeen(A, '5555-55-555-5555', AT).ok).toBe(true)
    expect(readSeen(A).nsns).toEqual(['5555555555555'])
  })
})

describe('the cap is reported, never silent', () => {
  it('evicts oldest-first and returns how many it dropped', () => {
    // Build a file that is already at the cap, with one unmistakably oldest entry.
    const marks: Record<string, string> = {}
    marks['9'.repeat(13)] = '2000-01-01T00:00:00.000Z' // the oldest
    for (let i = 0; i < MAX_SEEN - 1; i++) {
      marks[String(1_000_000_000_000 + i)] = '2026-08-29T00:00:00.000Z'
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'seen-state.json'), JSON.stringify({ [A]: marks }), 'utf8')

    const r = markSeen(A, '7777-77-777-7777', AT)
    expect(r.ok).toBe(true)
    expect(r.dropped).toBe(1)

    const after = readSeen(A)
    expect(after.nsns).toHaveLength(MAX_SEEN)
    expect(after.nsns).toContain('7777777777777')
    // The OLDEST went, not an arbitrary one.
    expect(after.nsns).not.toContain('9'.repeat(13))
  })
})
