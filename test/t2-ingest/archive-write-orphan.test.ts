/**
 * THE DEDUPE IS ALSO AN INSTRUMENT THAT EXAMINES ONLY ITS OWN HANDIWORK.
 *
 * `heldFiles()` was fixed to ask the disk instead of the manifest, which stops the capture
 * skipping a file whose bytes are gone. That fix reaches exactly as far as the next
 * function. `archiveBytes()` is idempotent on (source_key, logical_date, content_sha256),
 * all three read out of the MANIFEST, so when the re-fetched bytes arrive it finds the
 * orphaned row, says `already_present`, and writes nothing.
 *
 * The consequence measured against production's manifest: ~1.47 GB pulled from a government
 * origin and discarded, a WAF budget spent, an exit code of 0, and a log line that reads
 * like good news while the hole is exactly where it was.
 *
 * A dedupe key is a claim about what exists. It has to be checked against what exists.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createHash } from 'node:crypto'

import { archiveBytes, bytesHeldAt, hashFileStreaming, readArchiveManifest, readManifestEntries } from '../../lib/ingest/archive'
import { reconcileArchive } from '../../lib/ingest/archive-reconcile'

const roots: string[] = []

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'onlysource-archive-write-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

const BYTES = Buffer.from('PK pretend this is a 696 MB solicitation package')

function input(root: string) {
  return {
    bytes: BYTES,
    sourceKey: 'dibbs-rfq-daily',
    logicalDate: '2026-08-12',
    filename: 'ca260812.zip',
    sourceUrl: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/ca260812.zip',
    retrievedAt: '2026-08-19T00:00:00.000Z',
    retrievedAtBasis: 'http_response',
    retrievalMethod: 'pipeline_fetch' as const,
    retrievedBy: 'test',
    httpStatus: 200,
    contentType: 'application/octet-stream',
    responseHeaders: null,
    note: 'feed day 2026-08-12, ca file',
    archivedAt: '2026-08-19T00:00:00.000Z',
    root,
  }
}

describe('archiveBytes when the manifest records bytes the disk does not hold', () => {
  it('re-writes the file instead of reporting already_present over an orphaned row', async () => {
    const root = freshRoot()

    // 1. A real, honest first capture.
    const first = await archiveBytes(input(root), root)
    expect(first.status).toBe('archived')
    const storageKey = first.record.storage_key
    expect(existsSync(join(root, storageKey))).toBe(true)

    // 2. THE PRODUCTION CONDITION: the bytes are removed and the manifest row stays.
    //    This is exactly the restore that shipped 7 MB instead of 2 GB.
    rmSync(join(root, storageKey))
    expect(existsSync(join(root, storageKey))).toBe(false)
    expect((await readArchiveManifest(root)).length).toBe(1)

    // 3. The capture re-fetches, because heldFiles() now asks the disk. Identical bytes,
    //    therefore an identical sha256, therefore a dedupe hit on the orphaned row.
    const second = await archiveBytes(input(root), root)

    // THE DEFECT: before the fix this was `already_present` and nothing was written, so the
    // download was paid for and thrown away.
    expect(second.status).toBe('archived')
    expect(existsSync(join(root, second.record.storage_key))).toBe(true)
    expect(readFileSync(join(root, second.record.storage_key))).toEqual(BYTES)
  })

  it('still reports already_present when the bytes really are on disk', async () => {
    const root = freshRoot()
    const first = await archiveBytes(input(root), root)
    expect(first.status).toBe('archived')

    // POSITIVE CONTROL FOR THE OTHER DIRECTION. The whole value of the dedupe is that a
    // re-run of a 28 day backfill costs the origin nothing. If this test ever fails, the
    // fix above has turned every re-run into a full re-write.
    const second = await archiveBytes(input(root), root)
    expect(second.status).toBe('already_present')
    expect(second.record.storage_key).toBe(first.record.storage_key)
    expect((await readArchiveManifest(root)).length).toBe(1)
  })

  it('re-writes when the file is present but the wrong length', async () => {
    const root = freshRoot()
    const first = await archiveBytes(input(root), root)
    const path = join(root, first.record.storage_key)

    // Present is not whole. A truncated file must not satisfy the dedupe either, for the
    // same reason it must not satisfy heldFiles(): this repo has a recorded incident where
    // a row-boundary-exact truncation parsed clean with zero failed assertions.
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, BYTES.subarray(0, BYTES.length - 5))

    const second = await archiveBytes(input(root), root)
    expect(second.status).toBe('archived')
    expect(readFileSync(join(root, second.record.storage_key))).toEqual(BYTES)
  })

  it('does not let one day\'s orphan force a re-write of another day', async () => {
    const root = freshRoot()
    const twelfth = await archiveBytes(input(root), root)
    const thirteenth = await archiveBytes(
      { ...input(root), logicalDate: '2026-08-13', filename: 'ca260813.zip' },
      root,
    )
    rmSync(join(root, twelfth.record.storage_key))

    // The 13th is untouched and must still dedupe. Scoping matters: a reconciliation that
    // over-reaches turns one lost file into a whole-window re-download.
    const again = await archiveBytes(
      { ...input(root), logicalDate: '2026-08-13', filename: 'ca260813.zip' },
      root,
    )
    expect(again.status).toBe('already_present')
    expect(again.record.storage_key).toBe(thirteenth.record.storage_key)
  })
})

/* ---------------------------------------------------------------------------------- */
/* THE READER AND THE WRITER MUST NEVER DISAGREE ABOUT WHAT HOLDING MEANS              */
/* ---------------------------------------------------------------------------------- */

describe('bytesHeldAt() and the reconciler', () => {
  it('agree, file for file, over the same staged archive', async () => {
    const root = freshRoot()

    const kept = await archiveBytes(input(root), root)
    const removed = await archiveBytes(
      { ...input(root), logicalDate: '2026-08-13', filename: 'ca260813.zip' },
      root,
    )
    const shortened = await archiveBytes(
      { ...input(root), logicalDate: '2026-08-14', filename: 'ca260814.zip' },
      root,
    )
    rmSync(join(root, removed.record.storage_key))
    writeFileSync(join(root, shortened.record.storage_key), BYTES.subarray(0, 4))

    const entries = await readManifestEntries(root)
    const reconciliation = reconcileArchive(entries, root)

    // The guarantee: the writer's boolean is true for exactly the files the reader calls
    // `held`. Two implementations of one idea, proven to agree rather than asserted to.
    for (const f of reconciliation.files) {
      if (f.storageKey === null || f.expectedBytes === null) continue
      const writerSaysHeld = bytesHeldAt(join(root, f.storageKey), f.expectedBytes)
      expect(writerSaysHeld).toBe(f.state === 'held')
    }

    expect(reconciliation.counts.held).toBe(1)
    expect(reconciliation.counts.lost).toBe(1)
    expect(reconciliation.counts.truncated).toBe(1)
    expect(kept.record.storage_key).toBeTruthy()
  })
})

/* ---------------------------------------------------------------------------------- */
/* THE ROUND TRIP. THE ONLY CONTROL THAT PROVES THE ARCHIVE IS REPAIRED                */
/* ---------------------------------------------------------------------------------- */

describe('the whole recovery journey', () => {
  it('ends with the BYTES on disk, not with a function returning the right enum', async () => {
    const root = freshRoot()

    // A day we captured honestly, then lost, exactly as production lost its ca packages.
    const original = await archiveBytes(input(root), root)
    const lostPath = join(root, original.record.storage_key)
    rmSync(lostPath)

    // The reader must stop calling it held, or nothing downstream will ever re-fetch it.
    const before = reconcileArchive(await readManifestEntries(root), root)
    expect(before.heldKeys.has('2026-08-12/ca260812.zip')).toBe(false)
    expect(before.counts.lost).toBe(1)

    // The capture re-fetches and hands the identical bytes to the writer.
    const rewritten = await archiveBytes(input(root), root)

    // THE ASSERTION THAT MATTERS. Not the status, not the manifest: the bytes.
    const after = reconcileArchive(await readManifestEntries(root), root)
    expect(after.heldKeys.has('2026-08-12/ca260812.zip')).toBe(true)
    expect(after.counts.lost).toBe(0)
    expect(existsSync(join(root, rewritten.record.storage_key))).toBe(true)
    expect(readFileSync(join(root, rewritten.record.storage_key))).toEqual(BYTES)

    // The ledger keeps both rows. What happened is that we captured it, lost it, and
    // captured it again, and an append-only ledger should say so.
    const rows = await readManifestEntries(root)
    expect(rows.length).toBe(2)
  })
})

/* ---------------------------------------------------------------------------------- */
/* THE VERIFICATION STREAMS NOW. SAME STRICTNESS, WITHOUT A SECOND COPY IN RAM         */
/* ---------------------------------------------------------------------------------- */

describe('hashFileStreaming', () => {
  it('agrees byte for byte with hashing the whole buffer at once', async () => {
    const root = freshRoot()
    const r = await archiveBytes(input(root), root)
    const path = join(root, r.record.storage_key)

    const streamed = await hashFileStreaming(path)
    const slurped = createHash('sha256').update(readFileSync(path)).digest('hex')

    // POSITIVE CONTROL FOR THE REPLACEMENT ITSELF. The old verification hashed a whole
    // Buffer; the new one hashes a stream. If these ever disagree, the archive's write
    // verification has quietly become a different check than the one it replaced.
    expect(streamed.sha256).toBe(slurped)
    expect(streamed.sha256).toBe(r.record.content_sha256)
    expect(streamed.byteLen).toBe(BYTES.length)
  })

  it('crosses chunk boundaries correctly, which is where an incremental hash goes wrong', async () => {
    const root = freshRoot()
    // Bigger than the 1 MB high-water mark, so the hash is fed several chunks rather than
    // one. An incremental digest that mishandles boundaries passes every small-file test.
    const big = Buffer.alloc(3 * 1024 * 1024 + 12345, 0x5a)
    const r = await archiveBytes({ ...input(root), bytes: big }, root)
    const path = join(root, r.record.storage_key)

    const streamed = await hashFileStreaming(path)
    expect(streamed.byteLen).toBe(big.length)
    expect(streamed.sha256).toBe(createHash('sha256').update(big).digest('hex'))
    expect(streamed.sha256).toBe(r.record.content_sha256)
  })

  it('still refuses a write whose bytes did not land as sent', async () => {
    const root = freshRoot()
    const r = await archiveBytes(input(root), root)
    const path = join(root, r.record.storage_key)

    // Corrupt the destination after the fact and confirm the streaming hash notices. The
    // verification exists because a copy is not evidence that a copy worked, and swapping
    // slurp for stream must not have softened that.
    writeFileSync(path, Buffer.concat([BYTES, Buffer.from('x')]))
    const after = await hashFileStreaming(path)
    expect(after.sha256).not.toBe(r.record.content_sha256)
    expect(after.byteLen).toBe(BYTES.length + 1)
  })
})
