/**
 * THE MANIFEST IS NOT THE DISK.
 *
 * Every test here is written against the production defect measured on 2026-08-18: the
 * manifest recorded seven accepted captures whose 1.47 GB of bytes were not on disk, and the
 * capture's skip-set was built from that record, so those files would have been skipped
 * forever with no request and no report.
 *
 * POSITIVE CONTROLS. Several tests below assert BOTH the correct new behaviour AND that the
 * old manifest-only rule would have got it wrong on the same input. A test that only asserts
 * the fix cannot tell you whether it is testing the fix or testing nothing, and this repo
 * has shipped a control that passed while the defect it named was live.
 *
 * NO NETWORK. Real files in a real temp directory for the states that are about real files;
 * an injected stat for the states that are not worth staging gigabytes to reach.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DIBBS_SOURCE_KEY,
  reconcileArchive,
  reconciliationKey,
  reconciliationReport,
  stateFor,
  type StatFile,
} from '../../lib/ingest/archive-reconcile'
import type { ManifestEntry } from '../../lib/ingest/archive'

/* ---------------------------------------------------------------------------------- */
/* FIXTURES                                                                            */
/* ---------------------------------------------------------------------------------- */

const roots: string[] = []

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'onlysource-reconcile-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()!
    rmSync(root, { recursive: true, force: true })
  }
})

function acceptedRow(
  logicalDate: string,
  filename: string,
  byteLen: number,
  sourceKey = DIBBS_SOURCE_KEY,
): ManifestEntry {
  return {
    source_key: sourceKey,
    logical_date: logicalDate,
    retrieved_at: `${logicalDate}T12:00:00.000Z`,
    retrieved_at_basis: 'http_response',
    storage_key: `${sourceKey}/${logicalDate}/20260818T000000Z/${filename}`,
    content_sha256: 'a'.repeat(64),
    byte_len: byteLen,
    source_url: `https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/${filename}`,
    http_status: 200,
    content_type: 'application/octet-stream',
    response_headers: null,
    retrieval_method: 'pipeline_fetch',
    retrieved_by: 'test',
    archived_at: `${logicalDate}T12:00:00.000Z`,
    note: '',
  } as ManifestEntry
}

function rejectedRow(
  logicalDate: string,
  filename: string,
  verdict: string,
  httpStatus: number | null,
): ManifestEntry {
  return {
    kind: 'rejected',
    source_key: DIBBS_SOURCE_KEY,
    logical_date: logicalDate,
    filename,
    source_url: `https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/${filename}`,
    http_status: httpStatus,
    content_type: null,
    byte_len: null,
    content_sha256: null,
    reason: `origin refused with HTTP ${httpStatus}`,
    verdict,
    retrieved_at: `${logicalDate}T12:00:00.000Z`,
    recorded_at: `${logicalDate}T12:00:00.000Z`,
    retrieval_method: 'pipeline_fetch',
    retrieved_by: 'test',
    note: '',
  } as unknown as ManifestEntry
}

/** Stage a row's bytes on disk, optionally at a different length than recorded. */
function stage(root: string, row: ManifestEntry, actualBytes?: number): void {
  const record = row as { storage_key: string; byte_len: number }
  const path = join(root, record.storage_key)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, Buffer.alloc(actualBytes ?? record.byte_len, 0x41))
}

/** What the OLD, manifest-only rule produced. The positive control for the whole fix. */
function manifestOnlyHeldKeys(entries: readonly ManifestEntry[]): Set<string> {
  return new Set(
    entries
      .filter((e) => (e as { kind?: string }).kind !== 'rejected')
      .filter((e) => (e as { source_key: string }).source_key === DIBBS_SOURCE_KEY)
      .map((e) => {
        const r = e as { logical_date: string; storage_key: string }
        return `${r.logical_date}/${r.storage_key.split('/').pop() ?? ''}`
      }),
  )
}

/* ---------------------------------------------------------------------------------- */
/* THE DEFECT ITSELF                                                                   */
/* ---------------------------------------------------------------------------------- */

describe('a manifest row whose bytes are gone', () => {
  it('is LOST, is not held, and the old manifest-only rule would have called it held', () => {
    const root = freshRoot()
    const present = acceptedRow('2026-08-14', 'in260814.txt', 47_002)
    const gone = acceptedRow('2026-08-14', 'ca260814.zip', 66_000_000)
    stage(root, present)
    // `gone` is deliberately NOT staged. This is the production condition.

    const entries = [present, gone]
    const reconciliation = reconcileArchive(entries, root)

    expect(stateFor(reconciliation, DIBBS_SOURCE_KEY, '2026-08-14', 'ca260814.zip')).toBe('lost')
    expect(reconciliation.heldKeys.has(reconciliationKey('2026-08-14', 'ca260814.zip'))).toBe(false)
    expect(reconciliation.heldKeys.has(reconciliationKey('2026-08-14', 'in260814.txt'))).toBe(true)
    expect(reconciliation.counts.lost).toBe(1)
    expect(reconciliation.lostBytes).toBe(66_000_000)

    // POSITIVE CONTROL: the rule this replaced gets it wrong on exactly this input.
    const old = manifestOnlyHeldKeys(entries)
    expect(old.has(reconciliationKey('2026-08-14', 'ca260814.zip'))).toBe(true)
  })

  it('reports the loss in words, naming the file and the bytes', () => {
    const root = freshRoot()
    const gone = acceptedRow('2026-08-12', 'ca260812.zip', 696_320_291)
    const lines = reconciliationReport(reconcileArchive([gone], root))

    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join('\n')).toContain('NOT on disk')
    expect(lines.join('\n')).toContain('ca260812.zip')
    expect(lines.join('\n')).toContain('696,320,291')
    expect(lines.join('\n')).toContain('re-fetched')
  })

  it('says nothing at all when everything reconciles', () => {
    const root = freshRoot()
    const row = acceptedRow('2026-08-14', 'in260814.txt', 128)
    stage(root, row)
    expect(reconciliationReport(reconcileArchive([row], root))).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------- */
/* PRESENT IS NOT WHOLE                                                                */
/* ---------------------------------------------------------------------------------- */

describe('a file on disk at the wrong length', () => {
  it('is TRUNCATED rather than held, and is reported separately from a loss', () => {
    const root = freshRoot()
    const row = acceptedRow('2026-08-13', 'in260813.txt', 260_144)
    stage(root, row, 260_000) // short by 144 bytes: a row-boundary-exact truncation

    const reconciliation = reconcileArchive([row], root)

    expect(stateFor(reconciliation, DIBBS_SOURCE_KEY, '2026-08-13', 'in260813.txt')).toBe('truncated')
    expect(reconciliation.heldKeys.size).toBe(0)
    expect(reconciliation.counts.truncated).toBe(1)
    expect(reconciliation.counts.lost).toBe(0)

    const report = reconciliationReport(reconciliation).join('\n')
    expect(report).toContain('wrong length')
    expect(report).toContain('260,000')
    expect(report).toContain('260,144')

    // POSITIVE CONTROL: existence alone would have admitted this file.
    const existenceOnly: StatFile = () => ({ size: 260_000 })
    const naive = reconcileArchive([row], root, existenceOnly)
    expect(naive.counts.truncated).toBe(1) // still caught, because length is checked
    const trulyNaive = manifestOnlyHeldKeys([row])
    expect(trulyNaive.has(reconciliationKey('2026-08-13', 'in260813.txt'))).toBe(true)
  })
})

/* ---------------------------------------------------------------------------------- */
/* THE THREE DIFFERENT WAYS TO NOT HAVE A FILE                                         */
/* ---------------------------------------------------------------------------------- */

describe('not having a file is three different facts', () => {
  it('separates not_published (theirs) from lost (ours) from never_asked', () => {
    const root = freshRoot()
    const lost = acceptedRow('2026-08-10', 'ca260810.zip', 225_908_180)
    const notPublished = rejectedRow('2026-08-07', 'in260807.txt', 'not_published', 404)
    const entries = [lost, notPublished]

    const reconciliation = reconcileArchive(entries, root)

    expect(stateFor(reconciliation, DIBBS_SOURCE_KEY, '2026-08-10', 'ca260810.zip')).toBe('lost')
    expect(stateFor(reconciliation, DIBBS_SOURCE_KEY, '2026-08-07', 'in260807.txt')).toBe(
      'not_published',
    )
    expect(stateFor(reconciliation, DIBBS_SOURCE_KEY, '2026-08-99', 'in260899.txt')).toBe(
      'never_asked',
    )

    // A day the origin never published is an honest empty state, not a data loss, so it
    // must never be counted into the recoverable-loss figure an operator acts on.
    expect(reconciliation.lostBytes).toBe(225_908_180)
    expect(reconciliation.counts.not_published).toBe(1)
    expect(reconciliationReport(reconciliation).join('\n')).not.toContain('in260807.txt')
  })

  it('separates a WAF or transport refusal from an origin 404', () => {
    const root = freshRoot()
    const blocked = rejectedRow('2026-08-11', 'ca260811.zip', 'waf_blocked', null)
    const reconciliation = reconcileArchive([blocked], root)
    expect(stateFor(reconciliation, DIBBS_SOURCE_KEY, '2026-08-11', 'ca260811.zip')).toBe('refused')
    expect(reconciliation.counts.not_published).toBe(0)
  })
})

/* ---------------------------------------------------------------------------------- */
/* THE APPEND-ONLY LEDGER MEANS SEVERAL ROWS CAN DESCRIBE ONE FILE                     */
/* ---------------------------------------------------------------------------------- */

describe('several rows describing one file', () => {
  it('lets a later successful capture outrank an earlier 404', () => {
    const root = freshRoot()
    // Exactly production's 08-17: refused at 17:22 on the 17th, captured at 06:18 on the 18th.
    const refusedFirst = rejectedRow('2026-08-17', 'in260817.txt', 'not_published', 404)
    const capturedLater = acceptedRow('2026-08-17', 'in260817.txt', 391_494)
    stage(root, capturedLater)

    const reconciliation = reconcileArchive([refusedFirst, capturedLater], root)
    expect(stateFor(reconciliation, DIBBS_SOURCE_KEY, '2026-08-17', 'in260817.txt')).toBe('held')
    expect(reconciliation.heldKeys.has(reconciliationKey('2026-08-17', 'in260817.txt'))).toBe(true)
  })

  it('lets a lost capture outrank a 404, because the origin published it at least once', () => {
    const root = freshRoot()
    const refused = rejectedRow('2026-08-14', 'ca260814.zip', 'not_published', 404)
    const accepted = acceptedRow('2026-08-14', 'ca260814.zip', 66_000_000) // never staged
    const reconciliation = reconcileArchive([refused, accepted], root)
    expect(stateFor(reconciliation, DIBBS_SOURCE_KEY, '2026-08-14', 'ca260814.zip')).toBe('lost')
  })

  it('does not let one source key mask another', () => {
    const root = freshRoot()
    const banner = acceptedRow('2026-08-11', 'in260811.txt', 512, 'dibbs-consent-banner')
    const feed = acceptedRow('2026-08-11', 'in260811.txt', 439_490)
    stage(root, feed)

    const reconciliation = reconcileArchive([banner, feed], root)
    expect(stateFor(reconciliation, DIBBS_SOURCE_KEY, '2026-08-11', 'in260811.txt')).toBe('held')
    expect(stateFor(reconciliation, 'dibbs-consent-banner', '2026-08-11', 'in260811.txt')).toBe(
      'lost',
    )
    // The report is scoped to one source key, so another source's loss cannot pad the number
    // an operator reads for the feed.
    expect(reconciliationReport(reconciliation, DIBBS_SOURCE_KEY)).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------- */
/* THE SOURCE KEY IS DECLARED IN MORE THAN ONE PLACE                                   */
/* ---------------------------------------------------------------------------------- */

describe('the DIBBS source key', () => {
  it('agrees with the one feed-days.ts and the fetch pipeline declare', async () => {
    const feedDays = await import('../../lib/ingest/feed-days')
    const fetchSource = await import('../../lib/ingest/sources/dibbs-fetch')
    expect(DIBBS_SOURCE_KEY).toBe(feedDays.DIBBS_SOURCE_KEY)
    expect(DIBBS_SOURCE_KEY).toBe(fetchSource.DIBBS_SOURCE_KEY)
  })
})

/* ---------------------------------------------------------------------------------- */
/* THE PRODUCTION CASE, REPRODUCED WHOLE                                               */
/* ---------------------------------------------------------------------------------- */

describe('the 2026-08-18 production archive', () => {
  it('reports exactly the five lost PDF packages and holds the rest', () => {
    const root = freshRoot()
    const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']
    const entries: ManifestEntry[] = []

    for (const day of days) {
      const yy = day.slice(2).replace(/-/g, '')
      const index = acceptedRow(day, `in${yy}.txt`, 47_002)
      const quotes = acceptedRow(day, `bq${yy}.zip`, 13_891)
      const packages = acceptedRow(day, `ca${yy}.zip`, 100_000_000)
      stage(root, index)
      stage(root, quotes)
      // The packages are recorded and absent: the shipped-7MB-instead-of-2GB restore.
      entries.push(index, quotes, packages)
    }

    const reconciliation = reconcileArchive(entries, root)

    expect(reconciliation.counts.held).toBe(10)
    expect(reconciliation.counts.lost).toBe(5)
    expect(reconciliation.lostBytes).toBe(500_000_000)
    expect(reconciliation.lost.every((f) => f.filename.startsWith('ca'))).toBe(true)

    // The index and quote files, which the board actually parses, are unaffected: the board
    // was right to keep serving. Both facts are true at once and the reconciler says so.
    for (const day of days) {
      const yy = day.slice(2).replace(/-/g, '')
      expect(reconciliation.heldKeys.has(reconciliationKey(day, `in${yy}.txt`))).toBe(true)
      expect(reconciliation.heldKeys.has(reconciliationKey(day, `ca${yy}.zip`))).toBe(false)
    }

    // POSITIVE CONTROL: the old rule held all fifteen, which is how the hole sealed itself.
    expect(manifestOnlyHeldKeys(entries).size).toBe(15)
  })
})
