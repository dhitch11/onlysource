import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeNsn } from './nsn-key'

/**
 * SEEN-STATE — which opportunities this operator has already opened.
 *
 * ==========================================================================================
 * WHY THIS EXISTS
 * ==========================================================================================
 * David, 2026-08-29: "click an opportunity and view it, and its stock number turns a glowing
 * red from then on, so we know we have already looked at it - this helps us better sort
 * things we have not looked into yet because of the complexity of it."
 *
 * The operator is working a board of thousands of corners by hand. The expensive thing is not
 * reading a row, it is REREADING one he already dismissed. So the product's job is to remember
 * what he opened, forever, and let him filter it away.
 *
 * ==========================================================================================
 * WHY A SERVER-SIDE FILE AND NOT COMPONENT STATE OR localStorage
 * ==========================================================================================
 * The requirement is explicitly "persist across sessions ... not component state that dies on
 * reload". `localStorage` would survive a reload but is per-BROWSER: the same operator on his
 * phone would see a board that disagrees with his desk, and there would be no way to tell which
 * one was right. Seen-state is a fact about the PERSON, so it is stored against the account.
 *
 * The shape follows `lib/notify/settings.ts` exactly — one JSON file in a state directory that
 * survives deploys, is gitignored, and is never in the repository. This product has no
 * application database for operator preferences (see `lib/db/` — a single unit-of-work helper),
 * so inventing a schema here would be a larger change than the feature warrants.
 *
 * ==========================================================================================
 * ⛔ THE HONESTY RULE THAT GOVERNS THIS MODULE
 * ==========================================================================================
 * A FAILED READ MUST NEVER RENDER AS "NOTHING HAS BEEN SEEN". Those are opposite claims. An
 * empty set means the operator has opened nothing; an unreadable store means we do not know
 * what he has opened. If the second is served as the first, the board quietly tells him a
 * thousand rows are fresh when he has already worked them, which is precisely the waste this
 * feature exists to remove.
 *
 * So every read returns an `available` flag alongside the set, and the surface renders the
 * unavailable case as a stated condition with the filter disabled, never as a clean board.
 *
 * ==========================================================================================
 * KNOWN LIMITS, STATED RATHER THAN HIDDEN
 * ==========================================================================================
 *  - CONCURRENT WRITES: `markSeen` is a read-modify-write with no file lock. Two marks landing
 *    in the same millisecond can lose one. The harm is bounded and self-healing (the row is
 *    re-marked the next time it is opened) and a lock file is not worth its failure modes for
 *    a single-operator board. Documented, not silently accepted.
 *  - THE CAP is real and is reported. Past `MAX_SEEN` entries the OLDEST marks are dropped, and
 *    `readSeen` returns `truncated: true` so a surface can say so. A silent cap would read as
 *    "you never opened that" for the one row the operator most recently forgot.
 */

/**
 * Upper bound on remembered marks per account. The served board is ~10^3-10^4 rows, so this
 * holds several full passes over the whole map. Dropping is oldest-first and is REPORTED.
 */
export const MAX_SEEN = 50_000

export type SeenState = {
  /** Normalized (digits-only) stock numbers this account has opened. */
  nsns: string[]
  /**
   * FALSE means the store could not be read — NOT that nothing has been seen. A surface must
   * render this as an unknown state, never as an empty one.
   */
  available: boolean
  /** True when the cap dropped the oldest marks, so a surface can say so rather than imply completeness. */
  truncated: boolean
}

/** One account's marks: normalized NSN -> ISO instant it was first opened. */
type AccountMarks = Record<string, string>
type SeenFile = Record<string, AccountMarks>

function stateDir(): string {
  return process.env.ONLYSOURCE_STATE_DIR || path.join(process.cwd(), '.state')
}

function seenPath(): string {
  return path.join(stateDir(), 'seen-state.json')
}

/**
 * The key function lives in `nsn-key.ts` (no imports, so a `"use client"` component can share it)
 * and is re-exported here so a server caller has one obvious place to reach for it.
 */
export { normalizeNsn }

function readFile(): SeenFile | null {
  try {
    const p = seenPath()
    if (!existsSync(p)) return {}
    const raw: unknown = JSON.parse(readFileSync(p, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return raw as SeenFile
  } catch {
    // Unreadable or malformed. NULL, never {} — the caller must be able to tell this apart
    // from "the file exists and this account has marked nothing".
    return null
  }
}

function coerceMarks(raw: unknown): AccountMarks {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: AccountMarks = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeNsn(k)
    if (key && typeof v === 'string') out[key] = v
  }
  return out
}

/**
 * What this account has already opened.
 *
 * `available:false` is the unknown state and is returned whenever the store could not be read
 * or the caller has no account identity. It is NOT an empty board.
 */
export function readSeen(accountId: string | null): SeenState {
  if (!accountId) return { nsns: [], available: false, truncated: false }
  const file = readFile()
  if (file === null) return { nsns: [], available: false, truncated: false }
  const marks = coerceMarks(file[accountId])
  const keys = Object.keys(marks)
  return { nsns: keys, available: true, truncated: keys.length >= MAX_SEEN }
}

export type MarkResult = {
  ok: boolean
  /** The normalized key actually written, so a caller can assert the two ends agree. */
  nsn: string
  /** True when this mark was new; false when the row had already been opened. */
  added: boolean
  /** Set when the cap dropped older marks to make room. Reported, never silent. */
  dropped: number
}

/**
 * Record that this account opened this stock number. Idempotent: marking an already-seen row
 * keeps the ORIGINAL instant, because the question the operator is asking is "have I looked at
 * this", and overwriting the timestamp on every revisit would make the oldest-first cap evict
 * the rows he has never returned to instead of the ones he no longer cares about.
 */
export function markSeen(accountId: string | null, nsnRaw: string, nowIso: string): MarkResult {
  const nsn = normalizeNsn(nsnRaw)
  if (!accountId || !nsn) return { ok: false, nsn, added: false, dropped: 0 }

  const file = readFile()
  if (file === null) return { ok: false, nsn, added: false, dropped: 0 }

  const marks = coerceMarks(file[accountId])
  const added = !(nsn in marks)
  if (added) marks[nsn] = nowIso

  // Oldest-first eviction, and the count is returned rather than swallowed.
  let dropped = 0
  const keys = Object.keys(marks)
  if (keys.length > MAX_SEEN) {
    const byAge = keys.sort((a, b) => (marks[a]! < marks[b]! ? -1 : marks[a]! > marks[b]! ? 1 : a < b ? -1 : 1))
    for (const k of byAge.slice(0, keys.length - MAX_SEEN)) {
      delete marks[k]
      dropped++
    }
  }

  try {
    const dir = stateDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(seenPath(), JSON.stringify({ ...file, [accountId]: marks }, null, 2), 'utf8')
  } catch {
    return { ok: false, nsn, added: false, dropped: 0 }
  }
  return { ok: true, nsn, added, dropped }
}
