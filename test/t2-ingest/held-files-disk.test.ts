/**
 * THE SHIPPED BEHAVIOUR, NOT JUST THE PURE FUNCTION BEHIND IT.
 *
 * `test/t2-ingest/archive-reconcile.test.ts` proves the reconciler classifies correctly.
 * This file proves the thing the capture ACTUALLY calls, `heldFiles()`, reaches the disk,
 * against a real archive staged on a real filesystem with a real MANIFEST.jsonl.
 *
 * That distinction is the whole point. A check validated one layer away from the code that
 * runs can pass on the exact defect it exists to catch, and this repo has shipped that
 * mistake more than once. `heldFiles()` is what decides whether the origin is asked for a
 * file, so `heldFiles()` is what has to be measured.
 *
 * ARCHIVE_ROOT is read from the environment at module load, so every case sets
 * INGEST_ARCHIVE_ROOT and then imports the module fresh.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
const ORIGINAL_ROOT = process.env.INGEST_ARCHIVE_ROOT

function stagedArchive(): string {
  const root = mkdtempSync(join(tmpdir(), 'onlysource-heldfiles-'))
  roots.push(root)
  mkdirSync(root, { recursive: true })
  return root
}

function appendRow(root: string, row: Record<string, unknown>): void {
  appendFileSync(join(root, 'MANIFEST.jsonl'), JSON.stringify(row) + '\n', 'utf8')
}

function acceptedRow(logicalDate: string, filename: string, byteLen: number) {
  return {
    source_key: 'dibbs-rfq-daily',
    logical_date: logicalDate,
    retrieved_at: `${logicalDate}T12:00:00.000Z`,
    retrieved_at_basis: 'http_response',
    storage_key: `dibbs-rfq-daily/${logicalDate}/20260818T000000Z/${filename}`,
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
  }
}

function writeBytes(root: string, storageKey: string, byteLen: number): void {
  const path = join(root, storageKey)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, Buffer.alloc(byteLen, 0x41))
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
  if (ORIGINAL_ROOT === undefined) delete process.env.INGEST_ARCHIVE_ROOT
  else process.env.INGEST_ARCHIVE_ROOT = ORIGINAL_ROOT
})

describe('heldFiles(), the set that decides whether the origin is asked', () => {
  it('holds a file whose bytes are on disk at the recorded length', async () => {
    const root = stagedArchive()
    const row = acceptedRow('2026-08-17', 'in260817.txt', 391_494)
    appendRow(root, row)
    writeBytes(root, row.storage_key, 391_494)

    process.env.INGEST_ARCHIVE_ROOT = root
    const { heldFiles } = await import('../../scripts/ingest/capture-shared')

    expect(await heldFiles()).toContain('2026-08-17/in260817.txt')
  })

  it('DOES NOT hold a file the manifest accepted whose bytes are gone', async () => {
    const root = stagedArchive()
    const present = acceptedRow('2026-08-14', 'in260814.txt', 47_002)
    const gone = acceptedRow('2026-08-14', 'ca260814.zip', 66_000_000)
    appendRow(root, present)
    appendRow(root, gone)
    writeBytes(root, present.storage_key, 47_002)
    // `gone` is recorded and never written. This is production on 2026-08-18.

    process.env.INGEST_ARCHIVE_ROOT = root
    const { heldFiles } = await import('../../scripts/ingest/capture-shared')
    const held = await heldFiles()

    // THE DEFECT: before the fix this returned true, and the file was never re-fetched.
    expect(held.has('2026-08-14/ca260814.zip')).toBe(false)
    expect(held.has('2026-08-14/in260814.txt')).toBe(true)
  })

  it('DOES NOT hold a file that is present but short', async () => {
    const root = stagedArchive()
    const row = acceptedRow('2026-08-13', 'in260813.txt', 260_144)
    appendRow(root, row)
    writeBytes(root, row.storage_key, 260_000)

    process.env.INGEST_ARCHIVE_ROOT = root
    const { heldFiles } = await import('../../scripts/ingest/capture-shared')

    expect((await heldFiles()).has('2026-08-13/in260813.txt')).toBe(false)
  })

  it('does not treat an origin 404 as a held file', async () => {
    const root = stagedArchive()
    appendRow(root, {
      kind: 'rejected',
      source_key: 'dibbs-rfq-daily',
      logical_date: '2026-08-07',
      filename: 'in260807.txt',
      source_url: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in260807.txt',
      http_status: 404,
      content_type: null,
      byte_len: null,
      content_sha256: null,
      reason: 'origin refused with HTTP 404',
      verdict: 'not_published',
      retrieved_at: '2026-08-17T12:00:00.000Z',
      recorded_at: '2026-08-17T12:00:00.000Z',
      retrieval_method: 'pipeline_fetch',
      retrieved_by: 'test',
      note: '',
    })

    process.env.INGEST_ARCHIVE_ROOT = root
    const { heldFiles } = await import('../../scripts/ingest/capture-shared')

    // A refusal must never suppress a later attempt: this is why 08-17 could be recovered
    // at all after it had been recorded as not published earlier the same week.
    expect((await heldFiles()).has('2026-08-07/in260807.txt')).toBe(false)
  })

  it('reconcileHeld() reports the loss in words the capture log can print', async () => {
    const root = stagedArchive()
    const gone = acceptedRow('2026-08-12', 'ca260812.zip', 696_320_291)
    appendRow(root, gone)

    process.env.INGEST_ARCHIVE_ROOT = root
    const { reconcileHeld } = await import('../../scripts/ingest/capture-shared')
    const { reconciliationReport } = await import('../../lib/ingest/archive-reconcile')

    const reconciliation = await reconcileHeld()
    expect(reconciliation.counts.lost).toBe(1)
    expect(reconciliation.lostBytes).toBe(696_320_291)
    expect(reconciliationReport(reconciliation).join('\n')).toContain('ca260812.zip')
  })

  it('returns an empty set for an archive with no manifest, rather than throwing', async () => {
    const root = stagedArchive()
    process.env.INGEST_ARCHIVE_ROOT = root
    const { heldFiles } = await import('../../scripts/ingest/capture-shared')
    expect((await heldFiles()).size).toBe(0)
  })
})
