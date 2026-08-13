/**
 * T2 INGESTION. The immutable raw landing archive.
 *
 * FETCH AND ARCHIVE IS A SEPARATE STEP FROM PARSE AND LOAD, AND THE ARCHIVE COMES FIRST.
 * Original bytes go down unmodified under a deterministic key, with the response headers and
 * a content hash beside them. Only then does a parser read, and it reads from the archive,
 * never from the network.
 *
 * That ordering buys four things within a month: replay of any historical load against a
 * fixed parser, a diff when a layout changes, an answer to "what exactly did they publish
 * that day", and an appreciating asset nobody else is building. The DIBBS listing retains
 * roughly 28 business days. Every day not captured is market history that cannot be
 * reconstructed at any price.
 *
 * The archive lives on the box's disk beside Postgres, per the hosting decision, and
 * deliberately outside the git repository: it grows about 57 MB per business day, roughly
 * 1.2 GB a month, forever, as append-only binary. Git is the wrong shape for that
 * permanently, not merely at today's size.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, appendFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { ARCHIVE_ROOT } from './db'
import type { RetrievalMethod } from './types'

export type ArchiveRecord = {
  source_key: string
  logical_date: string
  retrieved_at: string
  retrieved_at_basis: string
  storage_key: string
  content_sha256: string
  byte_len: number
  source_url: string
  http_status: number | null
  content_type: string | null
  response_headers: Record<string, string> | null
  retrieval_method: RetrievalMethod
  retrieved_by: string
  archived_at: string
  note: string
}

export type ArchiveOutcome =
  | { status: 'archived'; record: ArchiveRecord }
  | { status: 'already_present'; record: ArchiveRecord }

const MANIFEST = join(ARCHIVE_ROOT, 'MANIFEST.jsonl')

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function readArchiveManifest(): Promise<ArchiveRecord[]> {
  if (!(await exists(MANIFEST))) return []
  const text = await readFile(MANIFEST, 'utf8')
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as ArchiveRecord)
}

/** UTC instant compacted for a filesystem path: 2026-08-12T00:19:04Z -> 20260812T001904Z */
function compactInstant(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

/**
 * Write bytes to the archive and record them.
 *
 * IDEMPOTENT ON (source_key, logical_date, content_sha256). Re-archiving identical bytes is a
 * no-op rather than a duplicate, which is what makes a re-run of a backfill safe.
 *
 * VERIFIES BY RE-HASHING THE DESTINATION. A copy is not evidence that a copy worked, and a
 * write that silently truncates is exactly the quiet failure this layer exists to refuse.
 */
export async function archiveBytes(input: {
  bytes: Buffer
  sourceKey: string
  logicalDate: string
  filename: string
  sourceUrl: string
  retrievedAt: string
  retrievedAtBasis: string
  retrievalMethod: RetrievalMethod
  retrievedBy: string
  httpStatus?: number | null
  contentType?: string | null
  responseHeaders?: Record<string, string> | null
  note?: string
  archivedAt: string
}): Promise<ArchiveOutcome> {
  const sha = createHash('sha256').update(input.bytes).digest('hex')
  const existing = await readArchiveManifest()
  const already = existing.find(
    (r) =>
      r.source_key === input.sourceKey &&
      r.logical_date === input.logicalDate &&
      r.content_sha256 === sha,
  )
  if (already) return { status: 'already_present', record: already }

  const storageKey = join(
    input.sourceKey,
    input.logicalDate,
    compactInstant(input.retrievedAt),
    input.filename,
  )
  const destination = join(ARCHIVE_ROOT, storageKey)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, input.bytes)

  const writtenBytes = await readFile(destination)
  const writtenSha = createHash('sha256').update(writtenBytes).digest('hex')
  if (writtenSha !== sha || writtenBytes.length !== input.bytes.length) {
    throw new Error(
      `archive write failed verification for ${input.filename}: ` +
        `source ${sha} / ${input.bytes.length} B, written ${writtenSha} / ${writtenBytes.length} B`,
    )
  }

  const record: ArchiveRecord = {
    source_key: input.sourceKey,
    logical_date: input.logicalDate,
    retrieved_at: input.retrievedAt,
    retrieved_at_basis: input.retrievedAtBasis,
    storage_key: storageKey,
    content_sha256: sha,
    byte_len: input.bytes.length,
    source_url: input.sourceUrl,
    http_status: input.httpStatus ?? null,
    content_type: input.contentType ?? null,
    response_headers: input.responseHeaders ?? null,
    retrieval_method: input.retrievalMethod,
    retrieved_by: input.retrievedBy,
    archived_at: input.archivedAt,
    note: input.note ?? '',
  }
  await appendFile(MANIFEST, JSON.stringify(record) + '\n', 'utf8')
  return { status: 'archived', record }
}

/** Which logical dates of a source are already in the archive. The backfill reads this. */
export async function archivedDates(sourceKey: string): Promise<Set<string>> {
  const manifest = await readArchiveManifest()
  return new Set(manifest.filter((r) => r.source_key === sourceKey).map((r) => r.logical_date))
}
