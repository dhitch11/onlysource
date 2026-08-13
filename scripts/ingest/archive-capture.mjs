#!/usr/bin/env node
/**
 * T2 INGESTION. Rescue captured government bytes into the immutable landing archive.
 *
 * WHY THIS EXISTS AND WHY IT RAN BEFORE ANY PARSER
 *
 * Charter heuristic 12: raw bytes are the only thing that cannot be re-acquired. The DIBBS
 * listing retains roughly 28 business days, and the 2026-08-11 feed day is already inside
 * that decay window. The real measured files for that day were sitting in `/tmp` and in
 * another session's scratchpad, both of which are purged without warning. Copying them to
 * durable storage is worth more than any code written on top of them.
 *
 * PROVENANCE IS RECORDED HONESTLY, WHICH IS THE ENTIRE POINT OF THIS LANE
 *
 * These bytes were retrieved by the research session on 2026-08-12, NOT by our fetch client
 * and NOT through the consent handshake. Every manifest row therefore carries
 * `retrieval_method: "research_capture"`. A row that claimed `pipeline_fetch` would be a
 * fabricated measurement, and this lane exists so the estate can say where each byte came
 * from and how fresh it is.
 *
 * THE MANIFEST IS THE `raw_object` TABLE UNTIL T1's MIGRATION LANDS
 *
 * One JSON object per line, columns matching the proposed Zone B `raw_object` DDL exactly,
 * so the load into Postgres is a read of this file and not a re-derivation. No database is
 * stubbed, mocked or pretended into existence.
 *
 * SAFE TO RUN TWICE. Idempotent on (source_key, logical_date, content_sha256): identical
 * bytes already archived are skipped, never rewritten and never double-listed. Every write
 * is verified by re-hashing the destination, because a copy that silently truncates is
 * exactly the class of quiet failure this lane is built to refuse.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile, copyFile, appendFile, access } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'

const ARCHIVE_ROOT = process.env.INGEST_ARCHIVE_ROOT ?? '/Users/user/onlysource-data/archive'
const MANIFEST = join(ARCHIVE_ROOT, 'MANIFEST.jsonl')

/**
 * The captures, each with the origin the research session retrieved it from.
 *
 * `sourceUrl` is the URL the bytes actually came from, recorded so a future replay can diff
 * against a fresh fetch of the same path. `note` records what the object IS, including the
 * two objects that are traps rather than data.
 */
const CAPTURES = [
  {
    sourceKey: 'dibbs-rfq-daily',
    logicalDate: '2026-08-11',
    filename: 'in260811.txt',
    originPath: '/tmp/real_in.txt',
    sourceUrl: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in260811.txt',
    contentType: 'text/plain',
    httpStatus: 200,
    expectBytes: 439490,
    note: 'Fixed-width requirement index. 3,095 rows, every row exactly 140 characters.',
  },
  {
    sourceKey: 'dibbs-rfq-daily',
    logicalDate: '2026-08-11',
    filename: 'bq260811.zip',
    originPath: '/tmp/real_bq.zip',
    sourceUrl: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/bq260811.zip',
    contentType: 'application/zip',
    httpStatus: 200,
    expectBytes: 119233,
    note:
      'Quoting file plus approved-source file. Contains bq260811.txt (1,464,017 B, 3,274 rows ' +
      'of 121 fields) and as260811.txt (151,716 B, 3,684 physical lines), the malformed ' +
      'approved-source file named by acceptance gate R3.1.',
  },
  {
    sourceKey: 'dibbs-rfq-daily',
    logicalDate: '2026-08-11',
    filename: 'ca260811.zip',
    originPath:
      '/tmp/claude-501/-Users-user/a4dee38f-5fe3-4526-bc5c-ce48f8c13e3d/scratchpad/ca260811.zip',
    sourceUrl: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/ca260811.zip',
    contentType: 'application/zip',
    httpStatus: 200,
    expectBytes: 56826248,
    note:
      "The day's full solicitation PDF package. This is the artifact that confirms or refutes " +
      'bq[50] (delivery days) and code[7] (set-aside indicator), the two ESTIMATED fields T3 ' +
      'wants to score on.',
  },
  {
    sourceKey: 'dibbs-consent-banner',
    logicalDate: '2026-08-11',
    filename: 'consent-banner-at-in260811-url.html',
    originPath: '/tmp/in260811.txt',
    sourceUrl: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in260811.txt',
    contentType: 'text/html',
    httpStatus: 200,
    expectBytes: 9152,
    note:
      'NOT DATA. The DoD consent banner served with HTTP 200 at the exact URL of the index ' +
      'file, to an unconsented client. Golden fixture for acceptance gate R3.1 ' +
      'consent-banner-200. A loader asserting on status code ingests this as the day\'s ' +
      'requirements.',
  },
  {
    sourceKey: 'dibbs-consent-banner',
    logicalDate: '2026-08-11',
    filename: 'consent-banner-at-bq260811-url.html',
    originPath: '/tmp/bq260811.zip',
    sourceUrl: 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/bq260811.zip',
    contentType: 'text/html',
    httpStatus: 200,
    expectBytes: 9152,
    note:
      'NOT DATA. The same trap at the zip URL, and a DIFFERENT body from the index-URL banner ' +
      'despite the identical byte length. Proves the banner cannot be detected by size.',
  },
]

function sha256Stream(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readManifest() {
  if (!(await exists(MANIFEST))) return []
  const text = await readFile(MANIFEST, 'utf8')
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

/** UTC instant compacted for a filesystem path: 2026-08-12T00:19:04Z -> 20260812T001904Z */
function compactInstant(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

async function main() {
  await mkdir(ARCHIVE_ROOT, { recursive: true })
  const existing = await readManifest()
  const seen = new Set(
    existing.map((row) => `${row.source_key}|${row.logical_date}|${row.content_sha256}`),
  )

  let archived = 0
  let skipped = 0
  let missing = 0
  const results = []

  for (const capture of CAPTURES) {
    if (!(await exists(capture.originPath))) {
      // An absent origin is stated plainly and does not stop the rescue of the others.
      missing += 1
      results.push({ filename: capture.filename, verdict: 'ORIGIN GONE', detail: capture.originPath })
      continue
    }

    const stats = await stat(capture.originPath)
    const sha = await sha256Stream(capture.originPath)
    const key = `${capture.sourceKey}|${capture.logicalDate}|${sha}`

    // The byte length is asserted against the independently measured value, so a truncated
    // or substituted origin is caught here rather than believed.
    if (capture.expectBytes !== undefined && stats.size !== capture.expectBytes) {
      results.push({
        filename: capture.filename,
        verdict: 'SIZE MISMATCH',
        detail: `expected ${capture.expectBytes} bytes, origin has ${stats.size}`,
      })
      continue
    }

    if (seen.has(key)) {
      skipped += 1
      results.push({ filename: capture.filename, verdict: 'already archived', detail: sha.slice(0, 16) })
      continue
    }

    const retrievedAt = stats.mtime.toISOString()
    const storageKey = join(
      capture.sourceKey,
      capture.logicalDate,
      compactInstant(retrievedAt),
      capture.filename,
    )
    const destination = join(ARCHIVE_ROOT, storageKey)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(capture.originPath, destination)

    // Verify by re-hashing what actually landed. A copy is not evidence that a copy worked.
    const writtenSha = await sha256Stream(destination)
    const writtenSize = (await stat(destination)).size
    if (writtenSha !== sha || writtenSize !== stats.size) {
      throw new Error(
        `Archive write failed verification for ${capture.filename}: ` +
          `origin ${sha} / ${stats.size} B, written ${writtenSha} / ${writtenSize} B`,
      )
    }

    const row = {
      source_key: capture.sourceKey,
      logical_date: capture.logicalDate,
      retrieved_at: retrievedAt,
      storage_key: storageKey,
      content_sha256: sha,
      byte_len: stats.size,
      source_url: capture.sourceUrl,
      http_status: capture.httpStatus,
      content_type: capture.contentType,
      response_headers: null, // Not captured by the research session. Absent, not invented.
      retrieval_method: 'research_capture',
      // `retrieved_at` above is the ORIGIN FILE'S MTIME, which is when the research session
      // wrote the bytes to disk. It is a close proxy for the HTTP response instant and it is
      // not the same thing. Stated rather than left to be assumed, because a future reader
      // resolving a provenance question needs to know which clock they are reading.
      retrieved_at_basis: 'origin_file_mtime',
      retrieved_by: 'research session 2026-08-12, rescued by T2 lane',
      archived_at: new Date().toISOString(),
      origin_path: capture.originPath,
      note: capture.note,
    }
    await appendFile(MANIFEST, JSON.stringify(row) + '\n', 'utf8')
    seen.add(key)
    archived += 1
    results.push({ filename: capture.filename, verdict: 'ARCHIVED', detail: `${stats.size} B` })
  }

  const readme = join(ARCHIVE_ROOT, 'README.md')
  if (!(await exists(readme))) {
    await writeFile(
      readme,
      [
        '# ONLYSOURCE.ai raw landing archive',
        '',
        'Immutable original bytes as published, before any parse. Owned by the T2 ingestion lane.',
        '',
        'Deliberately outside the git repository. Government payloads reach 57 MB per day and must',
        'never enter version control.',
        '',
        '`MANIFEST.jsonl` carries one JSON object per archived object, with columns matching the',
        'proposed Zone B `raw_object` table, so loading it into Postgres is a read and not a',
        're-derivation.',
        '',
        '**Nothing in here is ever edited or deleted.** A parser reads from this archive, never from',
        'the network. `retrieval_method` states how each object was obtained and is never upgraded to',
        'imply a fetch that did not happen.',
        '',
      ].join('\n'),
      'utf8',
    )
  }

  const width = Math.max(...results.map((r) => r.filename.length))
  for (const r of results) {
    console.log(`  ${r.filename.padEnd(width)}  ${r.verdict.padEnd(16)}  ${r.detail}`)
  }
  console.log(
    `\n  archived ${archived}, already present ${skipped}, origin gone ${missing}\n` +
      `  archive root: ${ARCHIVE_ROOT}\n  manifest:     ${MANIFEST}`,
  )

  if (missing > 0) process.exitCode = 0 // Stated, not fatal. The rescue is best effort by design.
}

main().catch((error) => {
  console.error(`archive-capture FAILED: ${error.message}`)
  process.exitCode = 1
})
