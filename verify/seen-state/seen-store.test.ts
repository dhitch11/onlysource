/**
 * @OS-VERIFY - DAVID'S ASK (1): SEEN-STATE MUST PERSIST ACROSS SESSIONS IN A REAL STORE.
 * Every claim below is EXECUTED against the real module. Nothing is asserted from reading it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const FIXED_NOW = '2026-08-29T18:00:00.000Z'

/** A fresh module instance = a new server process = a new SESSION. This is the persistence test. */
async function freshStore() {
  const mod = await import('@/lib/intelligence/seen-store?bust=' + Math.floor(process.hrtime()[1]))
  return mod as typeof import('@/lib/intelligence/seen-store')
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'osverify-seen-'))
  process.env.ONLYSOURCE_STATE_DIR = dir
})

describe('seen-state, David ask (1)', () => {
  it('PERSISTS across a fresh module load (a new session), not just in memory', async () => {
    const a = await freshStore()
    const marked = a.markSeen('acct-1', '1650-01-355-2818', FIXED_NOW)
    expect(marked.ok).toBe(true)
    expect(marked.added).toBe(true)

    // A DIFFERENT module instance, as a reload would produce.
    const b = await freshStore()
    const state = b.readSeen('acct-1')
    console.log(`  after reload: available=${state.available} nsns=${JSON.stringify(state.nsns)}`)
    expect(state.available).toBe(true)
    expect(state.nsns).toContain('1650013552818')
  })

  it('SCOPES marks per account: operator B never sees operator A marks', async () => {
    const s = await freshStore()
    s.markSeen('acct-1', '1650-01-355-2818', FIXED_NOW)
    const other = s.readSeen('acct-2')
    console.log(`  acct-2 sees: ${JSON.stringify(other)}`)
    expect(other.nsns).toEqual([])
    expect(other.available).toBe(true)
  })

  it('NORMALIZES the stock number so the two ends agree (dashes, spaces)', async () => {
    const s = await freshStore()
    const m = s.markSeen('acct-1', ' 1650-01-355-2818 ', FIXED_NOW)
    const read = s.readSeen('acct-1')
    console.log(`  wrote key=${m.nsn}  read back=${JSON.stringify(read.nsns)}`)
    expect(read.nsns).toContain(m.nsn)
  })

  it('AN UNREADABLE STORE READS AS UNKNOWN, NEVER AS A CLEAN BOARD (the honesty rule)', async () => {
    const s = await freshStore()
    s.markSeen('acct-1', '1650-01-355-2818', FIXED_NOW)
    // Corrupt the file the way a truncated write or a bad deploy would.
    writeFileSync(path.join(dir, 'seen-state.json'), '{ this is not json', 'utf8')
    const s2 = await freshStore()
    const state = s2.readSeen('acct-1')
    console.log(`  corrupted store -> available=${state.available} nsns=${state.nsns.length}`)
    expect(state.available).toBe(false)
    expect(state.nsns).toEqual([])
  })

  it('NO ACCOUNT READS AS UNKNOWN, not as an empty board', async () => {
    const s = await freshStore()
    const state = s.readSeen(null)
    console.log(`  null account -> available=${state.available}`)
    expect(state.available).toBe(false)
  })

  it('AN UNWRITABLE STORE FAILS LOUD (ok:false), never a cheerful success', async () => {
    const s = await freshStore()
    const blocked = path.join(dir, 'blocked')
    mkdirSync(blocked, { recursive: true })
    // Point the state dir at a path whose parent is a FILE, so mkdir/write must fail.
    const asFile = path.join(blocked, 'notadir')
    writeFileSync(asFile, 'x', 'utf8')
    process.env.ONLYSOURCE_STATE_DIR = path.join(asFile, 'nested')
    const s2 = await freshStore()
    const r = s2.markSeen('acct-1', '1650-01-355-2818', FIXED_NOW)
    console.log(`  unwritable store -> ok=${r.ok} (must be false)`)
    expect(r.ok).toBe(false)
  })

  it('THE TRUNCATED FLAG: does it claim marks were dropped when none were?', async () => {
    const s = await freshStore()
    const MAX = s.MAX_SEEN
    // Build a store holding EXACTLY MAX marks, with zero evictions ever having occurred.
    const marks: Record<string, string> = {}
    for (let i = 0; i < MAX; i++) marks[String(i).padStart(13, '0')] = FIXED_NOW
    writeFileSync(path.join(dir, 'seen-state.json'), JSON.stringify({ 'acct-1': marks }), 'utf8')
    const s2 = await freshStore()
    const state = s2.readSeen('acct-1')
    console.log(`  exactly MAX_SEEN=${MAX} marks, ZERO evictions ever -> truncated=${state.truncated}`)
    console.log(`  readSeen uses  keys.length >= MAX_SEEN   (seen-store.ts:128)`)
    console.log(`  markSeen evicts at keys.length >  MAX_SEEN (seen-store.ts:167)`)
    if (state.truncated) {
      console.log('  ^ OFF BY ONE: the surface would tell the operator his oldest marks were dropped when none were.')
    }
    expect(state.nsns.length).toBe(MAX)  // the fixture must actually load, or this test measures nothing
    expect(state.truncated).toBe(true)   // MEASURED: reports dropped marks when zero were dropped
  })
})
